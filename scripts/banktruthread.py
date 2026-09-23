#!/usr/bin/env python3
"""banktruthread.py [post-min] -- the registered read for canary `banktruth-01`.

PRIMARY, DECIDING, CALIBRATED: repeat refusals PER BOT-HOUR,
difference-in-differences canary(post-pre) - control(post-pre).

  PER BOT-HOUR, NOT A SHARE OF RUNS. The share version conditioned on attempts:
  its denominator was deposit runs, which is exactly what the treatment moves --
  `metric-must-not-condition-on-attempts`, the mistake that had escape rate
  rising while deaths tripled. Bot-hours are a denominator the change cannot
  touch, and the recalibrated null is centred on +0.006 against the share
  version's +2.18 pp, which is the same point arriving as evidence.

  A false refusal is  skill.status == 'no_effect' AND a named skill.args.item.
  A repeat is the same (bot, item) pair already refused inside the window.

  TYPED, NEVER PROSE. The change REWRITES the refusal sentence, so any endpoint
  that matched "nothing matching <item> to hand over" would read -100% in the
  canary arm because of the wording alone. Both builds emit the typed form.

  NULL, measured 2026-09-23 on 300 placebo draws, 4 pools / 20 bots, pre 180 /
  post 360, single version 9b572aa, 502,713 rows, 0 skipped:
      mean +0.006 /bot-h   sd 0.507   p05 -0.885
      a gate at -0.50/bot-h fires on 15.3% of NO-CHANGE draws -- noise
      a gate at -0.75/bot-h fires on  7.7%
      a gate at -0.885/bot-h fires on 5%   <-- the gate
  GATE: DiD <= -0.885 repeats/bot-h (the empirical one-sided 5% point).
  Effect ceiling, stated before the read: 1,874 repeats / 1,296 bot-h =
  -1.446/bot-h. THE GATE NEEDS 61% OF THE CEILING, so this read can only see a
  LARGE effect; a half effect reads INCONCLUSIVE and that is the honest answer,
  not a failure of the change.

EXPOSURE, must clear before ANY verdict: the change row. Canary rows whose
detail begins "you are carrying" -- a string the control build cannot produce,
so it discriminates by construction (v19). Floor 60; ~192 expected.

WATCH, report only, NOT calibrated and NOT deciding:
  deposit runs/bot-h   -- the way this could make things worse is the model
                          concluding it cannot bank at all and abandoning the
                          skill. A collapse here is a finding, not a gate.
  stock net items/bot-h, deposit success share.

Deaths are handled by verdict.py under v21/v23 and the owner's two-death floor.

CANARY_DRYRUN=pool,pool:sha:iso for a pre-deploy dry run.
"""
import sys, json, os, collections, datetime as dt
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
assert CANS, 'no canary declared'
now = dt.datetime.now(dt.timezone.utc)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0, f'cutoff is in the future by {-elapsed:.0f} min'
PRE = 180.0
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 360.0)
GATE = -0.885

ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(elapsed + PRE) + 30)
rows = [r for r in ev.rows
        if (r['bot'] or {}).get('name')
        and not (r['bot'] or {}).get('name', '').startswith(('isolated', 'self-isolated'))]
print(f"canary_pool={CAN} cutoff={CUT:%H:%M:%S}Z  pre {PRE:.0f} / post {W:.0f} min")
print(f"positive control: {len(ev.rows)} rows walked, {len(rows)} in-scope, "
      f"{len({(r['bot'] or {}).get('name') for r in rows})} bots; "
      f"versions {dict(collections.Counter(((r['raw'].get('code') or {}).get('version') or '?') for r in rows))}")

def named_item(sk):
    a = sk.get('args')
    v = a.get('item') if isinstance(a, dict) else (a[0] if isinstance(a, list) and a else a)
    v = None if v is None else str(v).strip()
    return v if v and v.lower() not in ('', 'none', 'null', 'any', 'all', 'everything',
                                        'items', 'inventory', 'undefined') else None

arm = lambda b: 'canary' if b.rsplit('-', 1)[0] in CANS else 'control'
buckets = collections.defaultdict(list)
span = collections.defaultdict(lambda: [None, None])
botset = collections.defaultdict(set)
newrow = collections.Counter()
for r in rows:
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W:
        continue
    b = (r['bot'] or {}).get('name')
    k = (arm(b), 'post' if d >= 0 else 'pre')
    botset[k].add(b)
    s = span[(k, b)]
    s[0] = r['t'] if s[0] is None or r['t'] < s[0] else s[0]
    s[1] = r['t'] if s[1] is None or r['t'] > s[1] else s[1]
    if str(r['name']) != 'deposit':
        continue
    buckets[k].append(r)
    if ((r['raw'].get('skill') or {}).get('detail') or '').startswith('you are carrying'):
        newrow[k] += 1

def bh(k):
    return sum((s[1] - s[0]).total_seconds() / 3600
               for (kk, _), s in span.items() if kk == k and s[0] and s[1])

def stats(sub):
    seen, rep, n, ok, net = set(), 0, 0, 0, 0
    for r in sorted(sub, key=lambda x: x['t']):
        n += 1
        sk = r['raw'].get('skill') or {}
        if (sk.get('status') or '') == 'success':
            ok += 1
        for v in (sk.get('inventory_delta') or {}).values():
            net -= v
        if (sk.get('status') or '') != 'no_effect':
            continue
        it = named_item(sk)
        if not it:
            continue
        key = ((r['bot'] or {}).get('name'), it)
        if key in seen:
            rep += 1
        seen.add(key)
    return n, rep, ok, net

print(f"\n{'arm/era':<14}{'bots':>5}{'bot-h':>8}{'runs':>7}{'repeat':>8}{'rep/bh':>9}"
      f"{'runs/bh':>9}{'succ%':>7}{'net/bh':>8}{'newrow':>8}")
S = {}
for a in ('canary', 'control'):
    for e in ('pre', 'post'):
        k = (a, e); h = bh(k); n, rep, ok, net = stats(buckets[k])
        S[k] = (n, rep, (rep / h) if h else None, h)
        print(f"{a+'/'+e:<14}{len(botset[k]):>5}{h:>8.1f}{n:>7}{rep:>8}"
              f"{(rep/h if h else float('nan')):>9.3f}"
              f"{(n/h if h else float('nan')):>9.2f}{(100.0*ok/n if n else float('nan')):>6.1f}%"
              f"{(net/h if h else float('nan')):>8.2f}{newrow[k]:>8}")

exposure = newrow[('canary', 'post')]
ctrl_leak = newrow[('control', 'post')] + newrow[('canary', 'pre')] + newrow[('control', 'pre')]
print(f"\nCHANGE ROW (v19): canary/post rows with the new sentence = {exposure}  [floor 60]")
print(f"  DISCRIMINATION CHECK: the same row in control/post or in either pre = {ctrl_leak} "
      f"(must be 0 -- the control build cannot emit this string)")

vals = {k: S[k][2] for k in S}
if any(v is None for v in vals.values()):
    print("\nVERDICT: UNREADABLE -- an arm had no deposit runs (v24: None is not a failure)")
    sys.exit(0)
did = (vals[('canary', 'post')] - vals[('canary', 'pre')]) \
    - (vals[('control', 'post')] - vals[('control', 'pre')])
print(f"\nPRIMARY  repeat-refusal RATE DiD = "
      f"({vals[('canary','post')]:.3f} - {vals[('canary','pre')]:.3f}) - "
      f"({vals[('control','post')]:.3f} - {vals[('control','pre')]:.3f}) = {did:+.3f} /bot-h")
print(f"         gate {GATE:+.3f} /bot-h (null sd 0.507, the empirical 5% point)")
print(f"         ceiling stated before the read: -1.446 /bot-h; the gate needs 61% of it")
if exposure < 60:
    print(f"\nVERDICT: NOT_YET -- exposure {exposure} below the floor of 60")
elif ctrl_leak:
    print(f"\nVERDICT: UNREADABLE -- the change row is not discriminating ({ctrl_leak} leaks)")
elif did <= GATE:
    print(f"\nPRIMARY PASSES: {did:+.3f} <= {GATE:+.3f}")
else:
    print(f"\nPRIMARY DOES NOT PASS: {did:+.3f} > {GATE:+.3f} -- INCONCLUSIVE is the honest close "
          f"unless a WATCH line is moving")

try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('banktruthread', W, {
        'repeat_rate_did': did,
        'repeat_rate_canary_post': vals[('canary', 'post')],
        'repeat_rate_canary_pre':  vals[('canary', 'pre')],
        'repeat_rate_control_post': vals[('control', 'post')],
        'repeat_rate_control_pre':  vals[('control', 'pre')],
        'newmsg_rows_canary': exposure,
        'newmsg_rows_leaked': ctrl_leak,
        'deposit_runs_canary_post': S[('canary', 'post')][0],
        'deposit_runs_control_post': S[('control', 'post')][0],
        'deposit_runs_per_bh_canary_post': (S[('canary','post')][0] / S[('canary','post')][3]) if S[('canary','post')][3] else None,
        'deposit_runs_per_bh_control_post': (S[('control','post')][0] / S[('control','post')][3]) if S[('control','post')][3] else None,
        'canary_bot_h': S[('canary', 'post')][3],
        'positive_control_rows': len(ev.rows)})
except Exception as _e:
    print('VERDICT_JSON failed:', _e)
