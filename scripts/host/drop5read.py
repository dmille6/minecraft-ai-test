# drop5read.py [post-min] -- the maxDrop 3->5 canary's read. Cutoff from the manifest.
# CANARY_DRYRUN=pool:sha:iso for dry runs.
#
# THIS CHANGE EMITS NO NEW EVENT KIND -- it is the 36%-of-changes class that death-linkage cannot
# reach. But it does not need one, because the refusal ROW ALREADY CARRIES THE BOUND:
#   baseline  "blind_step: drop of 7 ahead (limit 3)"
#   canary    "blind_step: drop of 7 ahead (limit 5)"
# So an existing row, emitted by BOTH arms, discriminates by its own text. That is strictly better
# than a new kind: a treatment-only row has a control rate of zero BY CONSTRUCTION and therefore
# cannot discriminate at all, which is what falsely reverted blindstep-01.
#
# THE MECHANISM IS A DISAPPEARANCE. Refusals with N in (3,5] are exactly the ones that flip from
# refused to admitted, so the canary's rate of them must go to ~0 while control keeps emitting
# them. Measured baseline: 80.6% of boxed episodes have at least one direction with a drop <= 5.
#
# THE HARM IS FALL DAMAGE, and it is pre-registered rather than discovered. Minecraft fall damage
# is (blocks - 3) half-hearts, so at the OLD bound every admitted drop cost ZERO -- that is why
# nothing ever capped the total descent along the line. At 5 each landing costs 2 and ten kill a
# 20 half-heart bot, which is why efa2853 also caps total damage along the line at 4 half-hearts.
# This read counts fall deaths and low-health fires per bot-hour in both arms.
import sys, json, os, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
from collections import Counter, defaultdict
from lib.telemetry import Events
import re
man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
REFUSE = '_explore_blind_step_refused'
DROPRE = re.compile(r'drop of (\d+) ahead \(limit (\d+)\)')


def load_window(since_minutes):
    """ROTATION-AWARE and deduped: day D's rows live in -{D+1}.gz, generations overlap, and a
    plain read of live files alone once returned a confident zero for an 8-hour-old event."""
    import glob as _g
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    start = now - dt.timedelta(minutes=since_minutes); d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz',
                                       since_minutes=since_minutes).rows)
        d += dt.timedelta(days=1)
    seen = set(); out = []
    for r in ev.rows:
        k = (str(r.get('t')), (r['bot'] or {}).get('name'), r['name'], r.get('detail'))
        if k in seen: continue
        seen.add(k); out.append(r)
    out.sort(key=lambda r: str(r['t'])); ev.rows = out
    return ev


ev = load_window(int(PRE + W + 10))
pool_of = lambda b: b.rsplit('-', 1)[0]
arm = lambda b: 'canary' if pool_of(b) in CANS else (None if pool_of(b).startswith('isolated') else 'control')
era = lambda t: 'pre' if t < CUT else ('post' if (t - CUT).total_seconds() / 60 <= W else None)

span = defaultdict(dict); lim = defaultdict(Counter); flip = Counter(); refus = Counter()
boxed = defaultdict(lambda: defaultdict(list)); capped = Counter()
falls = Counter(); lowhp = Counter(); deaths = Counter()
for r in ev.rows:
    b = (r['bot'] or {}).get('name')
    if not b: continue
    a = arm(b)
    if a is None: continue
    t = r['t']; e = era(t)
    if e is None: continue
    k = (a, e)
    s = span[k].setdefault(b, [t, t])
    if t < s[0]: s[0] = t
    if t > s[1]: s[1] = t
    n = r['name']; d = r['detail'] or ''
    if n == REFUSE:
        refus[k] += 1; boxed[k][b].append(t)
        m = DROPRE.search(d)
        if m:
            N, L = int(m.group(1)), int(m.group(2))
            lim[k][L] += 1
            if 3 < N <= 5: flip[k] += 1          # exactly the refusals the change removes
        elif 'half-hearts of fall damage' in d:
            capped[k] += 1                        # the new total-damage cap firing
    elif n == '_death':
        deaths[k] += 1
        if 'fell' in d or 'high place' in d: falls[k] += 1
    elif n == '_reflex_low_health':
        lowhp[k] += 1

bh = lambda k: sum((v[1] - v[0]).total_seconds() / 3600.0 for v in span[k].values() if v[1] > v[0])
CP, CTL, CPRE, KPRE = ('canary', 'post'), ('control', 'post'), ('canary', 'pre'), ('control', 'pre')


def boxedshare(k):
    tot = n4 = 0
    for b, ts in boxed[k].items():
        ts.sort(); cur = []
        for t in ts:
            if cur and (t - cur[-1]).total_seconds() > 5:
                tot += len(cur); n4 += len(cur) if len(cur) >= 4 else 0; cur = []
            cur.append(t)
        if cur: tot += len(cur); n4 += len(cur) if len(cur) >= 4 else 0
    return (n4 / tot) if tot else None


def did(f):
    v = [f(x) for x in (CP, CPRE, CTL, KPRE)]
    return None if any(x is None for x in v) else (v[0] - v[1]) - (v[2] - v[3])


per = lambda c, k: (c[k] / bh(k)) if bh(k) else None
print(f"WINDOW  cut {CUT.isoformat()}  post {W:.0f} min  canary pools {sorted(CANS)}")
for k in (CPRE, CP, KPRE, CTL):
    print(f"  {k[0]:7s} {k[1]:4s} bots {len(span[k]):2d} bot-h {bh(k):7.1f} refusals {refus[k]:5d} "
          f"limits {dict(lim[k])}  drop4-5 {flip[k]:4d}  capped {capped[k]:3d}  falls {falls[k]}  deaths {deaths[k]}")
print(f"LIVENESS canary rows saying (limit 5): {lim[CP].get(5,0)}  saying (limit 3): {lim[CP].get(3,0)} (MUST be 0)")
print(f"MECHANISM drop-4-to-5 refusals/bot-h: canary {per(flip,CP)}  control {per(flip,CTL)} "
      f"(the canary's must collapse toward 0 -- those are the ones now admitted)")
print(f"OUTCOME boxed-share DiD {did(boxedshare)} (should FALL)")
print(f"HARM    fall deaths/bot-h canary {per(falls,CP)} control {per(falls,CTL)}; "
      f"low-health fires/bot-h canary {per(lowhp,CP)} control {per(lowhp,CTL)}")
print(f"NEW CAP total-fall-damage refusals: canary {capped[CP]}, control {capped[CTL]} (control MUST be 0)")
print("positive control: rows", len(ev.rows), "refusal rows", sum(refus.values()))
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('drop5read', W, {
        'limit5_rows_canary': lim[CP].get(5, 0), 'limit3_rows_canary': lim[CP].get(3, 0),
        'limit5_rows_control': lim[CTL].get(5, 0),
        'drop4to5_per_bh_canary': per(flip, CP), 'drop4to5_per_bh_control': per(flip, CTL),
        'boxed_share_did': did(boxedshare),
        'fall_deaths_canary': falls[CP], 'fall_deaths_control': falls[CTL],
        'lowhp_per_bh_canary': per(lowhp, CP), 'lowhp_per_bh_control': per(lowhp, CTL),
        'capped_rows_canary': capped[CP], 'capped_rows_control': capped[CTL],
        'canary_bot_h': bh(CP), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
