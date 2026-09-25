# retraceread.py [post-min] -- the BREADCRUMB RETRACE canary's read. Cutoff from the manifest.
# CANARY_DRYRUN=pool:sha:iso for dry runs.
#
# THE ENDPOINT IS A BINOMIAL MECHANISM RATE, NOT A PRODUCTIVITY DiD, and that is deliberate.
# Measured 2026-09-25 over 2,028 bot-h: boxed episodes (every candidate refused, the bot does not
# move) run at 1.05/bot-h, and blindstep-01's RANDOM reverse escaped 9 of 70 reached = 12.9%.
# The freed-episode yield of any version of this is ~0.1-0.4/bot-h, which is inside the noise of
# a boxed-share DiD at two or four pools -- shoreline's own null was sd 8.2 pp. So this canary
# does NOT claim a productivity effect. It asks ONE bounded question with a pre-registered
# comparator: of the times the retrace is reached, how often does the bot actually move?
#
#   reached  = explore_blind_step_retrace rows (emitted AFTER the walk, so it is an outcome)
#   escaped  = those with status success, i.e. displacement >= 1 block
#   rate     = escaped / reached, against blindstep-01's measured 12.9% (9/70)
#
# WHY THE COMPARATOR IS HISTORICAL AND NOT THE CONTROL ARM: the control arm cannot emit this row
# at all -- it has no breadcrumb trail and no fifth candidate -- so there is no contemporaneous
# rate to difference against. That is stated here rather than papered over, and it is exactly why
# the DECIDING line below is the linkage one and not this rate.
import sys, json, os, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
from collections import Counter, defaultdict
from lib.telemetry import Events
man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
RETRACE, REFUSE = '_explore_blind_step_retrace', '_explore_blind_step_refused'
BASELINE_RATE = 9.0 / 70.0          # blindstep-01, measured: 9 escapes of 70 reached reverses


def load_window(since_minutes):
    """ROTATION-AWARE. logrotate uses copytruncate and day D's rows live in -{D+1}.gz, so a
    reader that only opens live files reports an absence that is its own. That cost a false
    negative on 2026-09-25."""
    import glob as _g
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    start = now - dt.timedelta(minutes=since_minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz',
                                       since_minutes=since_minutes).rows)
        d += dt.timedelta(days=1)
    seen = set(); out = []
    for r in ev.rows:                      # .gz generations OVERLAP at the boundary
        k = (str(r.get('t')), (r['bot'] or {}).get('name'), r['name'], r.get('detail'))
        if k in seen: continue
        seen.add(k); out.append(r)
    out.sort(key=lambda r: str(r['t'])); ev.rows = out
    return ev


ev = load_window(int(PRE + W + 10))
pool_of = lambda b: b.rsplit('-', 1)[0]
arm = lambda b: 'canary' if pool_of(b) in CANS else (None if pool_of(b).startswith('isolated') else 'control')
era = lambda t: 'pre' if t < CUT else ('post' if (t - CUT).total_seconds() / 60 <= W else None)

span = defaultdict(dict); reached = Counter(); escaped = Counter(); refus = Counter()
moved = defaultdict(list); crumbs_held = []
BUILDOK = Counter()
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
    if r['name'] == REFUSE: refus[k] += 1
    elif r['name'] == RETRACE:
        reached[k] += 1
        if r['status'] == 'success': escaped[k] += 1
        d = (r['detail'] or '')
        # THE BUILD ON THE ROW, not the pool: blindstep-01's first 8 canary-arm rows carried the
        # BASELINE build because the bots had not restarted, and their shape would have read as
        # "the fix is inert" if the pool label had been trusted.
        v = ((r.get('raw') or {}).get('code') or {}).get('version') or '?'
        BUILDOK[(a, e, v.startswith(CV))] += 1
        try:
            moved[k].append(float(d.split('moved ')[1].split(' ')[0]))
        except Exception: pass
        try:
            crumbs_held.append(int(d.split('(')[1].split(' ')[0]))
        except Exception: pass

bh = lambda k: sum((v[1] - v[0]).total_seconds() / 3600.0 for v in span[k].values() if v[1] > v[0])
CP, CTL = ('canary', 'post'), ('control', 'post')
rate = (escaped[CP] / reached[CP]) if reached[CP] else None


def wilson(k, n, z=1.96):
    if not n: return (None, None)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (max(0.0, c - h), min(1.0, c + h))


lo, hi = wilson(escaped[CP], reached[CP])
print(f"WINDOW  cut {CUT.isoformat()}  post {W:.0f} min  canary pools {sorted(CANS)}")
for k in [('canary', 'pre'), CP, ('control', 'pre'), CTL]:
    print(f"  {k[0]:7s} {k[1]:4s}  bots {len(span[k]):2d}  bot-h {bh(k):7.1f}  "
          f"refusals {refus[k]:5d}  retrace reached {reached[k]:4d}  escaped {escaped[k]:4d}")
print(f"PRIMARY escape rate {('%.3f' % rate) if rate is not None else 'n/a'} "
      f"({escaped[CP]}/{reached[CP]}), 95% CI [{('%.3f' % lo) if lo is not None else '?'}, "
      f"{('%.3f' % hi) if hi is not None else '?'}] vs blindstep-01's measured {BASELINE_RATE:.3f} (9/70)")
if lo is not None:
    print(f"        -> {'BEATS' if lo > BASELINE_RATE else ('BELOW' if hi < BASELINE_RATE else 'OVERLAPS')} the comparator")
if moved[CP]:
    m = sorted(moved[CP]); print(f"        displacement blocks: median {m[len(m)//2]:.2f} max {m[-1]:.2f} n={len(m)}")
if crumbs_held:
    c = sorted(crumbs_held); print(f"        crumbs held at retrace: median {c[len(c)//2]} min {c[0]} max {c[-1]}")
print(f"LINKAGE {RETRACE} rows: canary {reached[CP]}, control {reached[CTL]} (control MUST be 0 -- "
      f"the baseline has no trail and no fifth candidate)")
print(f"BUILD   canary-arm retrace rows on the canary build: {BUILDOK[('canary','post',True)]}, "
      f"on the baseline build: {BUILDOK[('canary','post',False)]} (the second MUST be 0)")
print("positive control: rows", len(ev.rows), "refusal rows", sum(refus.values()))
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('retraceread', W, {
        'retrace_reached_canary': reached[CP], 'retrace_escaped_canary': escaped[CP],
        'retrace_rows_control': reached[CTL],
        'escape_rate_canary': rate, 'escape_rate_ci_lo': lo, 'escape_rate_ci_hi': hi,
        'escape_rate_baseline': BASELINE_RATE,
        'retrace_rows_wrong_build': BUILDOK[('canary', 'post', False)],
        'refusals_per_bh_canary': (refus[CP] / bh(CP)) if bh(CP) else None,
        'canary_bot_h': bh(CP), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
