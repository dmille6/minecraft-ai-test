# leafbread.py [post-min] -- the COVER FALLBACK canary's read (leaf-02). Cutoff from the manifest.
# CANARY_DRYRUN=pool:sha:iso for dry runs.
#
# SAME PRIMARY ENDPOINT AS leaf-01, ON PURPOSE: acquired logs per bot-hour, DiD.
# leaf-01 put foliage-covered logs in the MAIN candidate list and read logs_did
# -0.65. This build admits the identical set only when the primary list is empty.
# Rank is the single variable, so the two reads are comparable only if the
# endpoint is identical -- it is, down to the inventory_delta walk below.
#
# WHAT DECIDES THIS CANARY IS NOT THE DiD (measured 2026-09-21, leafnull.py).
# 300 placebo canaries -- random 2-pool draws on windows with NO deployment, so
# the true effect is zero by construction -- put the null band for logs_did at
# median +0.00 with sd 3.00 and p5 at -4.49. leaf-01's -0.65 sits at p=0.413,
# and its typed `>= -0.5` REVERT line would have fired on 43.3% of no-change
# windows. That threshold was noise, so leaf-01's REVERT is not evidence the
# widening was harmful -- and repeating the line here would repeat the coin flip.
#
# So logs_did is kept, reported, and gated only at the placebo p5 (-4.49), where
# it is a genuine safety tripwire. The DECIDING number is cover_productive_share:
# of the rounds where the fallback actually attempted a covered log, what share
# banked one. That is a within-canary binomial at n >= 100, needs no control arm,
# and answers the only question that matters -- whether breaking a log inside a
# canopy delivers wood, given pickupNearbyItems gives up on seeing the same
# entity twice.
#
# THE DENOMINATOR IS THE OUTCOME ROW, NEVER THE ADMISSION ROW (Codex pass 2).
# Measured by executing the loop: when every covered candidate is already
# excluded, the admission row fires again and nothing is attempted -- 2
# admissions against 1 outcome. `_gather_cover_fallback` counts intentions;
# `_gather_cover_outcome` counts rounds that were actually accounted for.
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

def load_window(since_minutes):
    # Rotated generations are part of the population. A reader that walks only the
    # live file silently drops the baseline it is differencing against.
    import glob as _g, datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc); start = now - _dt.timedelta(minutes=since_minutes)
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + _dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz', since_minutes=since_minutes).rows)
        d += _dt.timedelta(days=1)
    ev.rows.sort(key=lambda r: r.get('@timestamp', ''))
    return ev

ev = load_window(int(elapsed + PRE) + 20)
K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)
logs = Counter(); buried = Counter(); runs = Counter(); cls = defaultdict(Counter)
canopy = Counter(); deaths = Counter(); span = defaultdict(lambda: [None, None]); bots = defaultdict(set)
admits = Counter(); outcomes = Counter(); outcome_ok = Counter(); nopath = Counter(); not_attempted = Counter()
for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    era = 'post' if d >= 0 else 'pre'; k = K(b, era); bots[k].add(b)
    sp = span[(k, b)]; sp[0] = r['t'] if sp[0] is None or r['t'] < sp[0] else sp[0]; sp[1] = r['t'] if sp[1] is None or r['t'] > sp[1] else sp[1]
    n = str(r['name'])
    if n == '_death': deaths[k] += 1
    if n in ('_canopy_refused', '_canopy_failed', '_canopy_descent_failed'): canopy[k] += 1
    # LINKAGE. Neither kind exists in the baseline 7dd3775, so a control pool
    # cannot emit either -- verified against HEAD by Codex pass 1.
    if n == '_gather_cover_fallback': admits[k] += 1
    if n == '_gather_cover_outcome':
        # NOT EVERY OUTCOME ROW IS AN ATTEMPT (Codex, 21 Sep 20:05Z, before any
        # read verdict -- so this is prospective, not an amendment to a decision).
        # The row emitted at the all-excluded return says "nothing attempted": the
        # fallback admitted candidates that a previous round had already excluded,
        # and the run returned without touching one. Counting those in the
        # denominator would deflate cover_productive_share with rounds where the
        # change had no opportunity to produce anything -- measuring the wrong
        # thing in the safe direction, which is still the wrong thing.
        sk_ = r['raw'].get('skill') or {}
        if 'nothing attempted' in (sk_.get('detail') or ''):
            not_attempted[k] += 1
        else:
            outcomes[k] += 1
            if sk_.get('status') == 'success': outcome_ok[k] += 1
    if n != 'gather': continue
    sk = r['raw'].get('skill') or {}
    st = sk.get('status') or '?'; fc = sk.get('fail_class') or sk.get('failClass') or ''
    runs[k] += 1; cls[k][f"{st}{('/' + fc) if fc else ''}"] += 1
    if fc == 'no_path': nopath[k] += 1
    if 'buried' in (sk.get('detail') or ''): buried[k] += 1
    # THE ENDPOINT: wood that actually arrived, whatever the row's status says.
    for it, v in (sk.get('inventory_delta') or {}).items():
        if v > 0 and it.endswith('_log'): logs[k] += v
def bh(k): return sum((s[1] - s[0]).total_seconds() / 3600 for (kk, b), s in span.items() if kk == k and s[0] and s[1])
def rate(c, k): h = bh(k); return (c[k] / h) if h else None
def share(c, k): return (c[k] / runs[k]) if runs[k] else None
print(f"canary_pool={CAN} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- COVER FALLBACK read (leaf-02)")
print(f"{'arm/era':14s} {'bots':>4s} {'bot-h':>6s} {'logs':>6s} {'logs/bh':>8s} {'buried':>7s} {'gather':>7s} {'no_path%':>9s} {'admit':>6s} {'outcome':>8s} {'produced':>9s} {'canopy':>7s} {'deaths':>7s}")
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = bh(k); lr = rate(logs, k); npf = share(nopath, k)
        print(f"{arm + '/' + era:14s} {len(bots[k]):4d} {h:6.1f} {logs[k]:6d} {('%8.2f' % lr) if lr is not None else '       -'} "
              f"{buried[k]:7d} {runs[k]:7d} {('%8.1f%%' % (100*npf)) if npf is not None else '        -'} "
              f"{admits[k]:6d} {outcomes[k]:8d} {outcome_ok[k]:9d} {canopy[k]:7d} {deaths[k]:7d}")
def did(c):
    try: return (rate(c, ('canary','post')) - rate(c, ('canary','pre'))) - (rate(c, ('control','post')) - rate(c, ('control','pre')))
    except TypeError: return None
def did_share(c):
    try: return (share(c, ('canary','post')) - share(c, ('canary','pre'))) - (share(c, ('control','post')) - share(c, ('control','pre')))
    except TypeError: return None
dl, db, dnp = did(logs), did(buried), did_share(nopath)
oc, ok_ = outcomes[('canary','post')], outcome_ok[('canary','post')]
print(f"\nPRIMARY  acquired logs/bot-h, DiD: {('%+.2f' % dl) if dl is not None else 'UNREADABLE (an arm has no bot-hours)'}   (leaf-01 read -0.65 on the SAME endpoint with the same blocks ranked FIRST)")
print(f"LINKAGE  cover fallback: {admits[('canary','post')]} admitted, {not_attempted[('canary','post')]} admitted-but-never-attempted (all candidates already excluded), {oc} ATTEMPTED, {ok_} produced a log"
      + (f"  ({100*ok_/oc:.0f}% productive)" if oc else "   -- ZERO ATTEMPTS: the change did not act, and the verdict is INCONCLUSIVE, not KEEP"))
print(f"DECIDING cover productivity: {('%.1f%%' % (100*ok_/oc)) if oc else 'no attempts'} of {oc} attempts banked a log"
      + ("   (fleet-wide an ORDINARY log gather succeeds 12.4%; the counterfactual here is a refusal, which banks nothing)" if oc else ""))
print(f"TRIPWIRE no_path share of gather, DiD: {('%+.1f pp' % (100*dnp)) if dnp is not None else 'UNREADABLE'}  (no_path is EVIDENCE_ABOUT_THE_ACTION and writes a persistent avoid rule; barrenFailClass is supposed to hold this flat)")
print(f"MECHANISM buried refusals/bot-h, DiD: {('%+.2f' % db) if db is not None else 'UNREADABLE'}  (a fall here with NO rise in logs is the failure mode, not the win)")
print(f"CONVERSION canary post failure classes: {dict(cls[('canary','post')].most_common(8))}")
print("positive control: rows", len(ev.rows), "bots", sum(len(v) for v in bots.values()),
      "| control arm emitted", admits[('control','post')] + outcomes[('control','post')],
      "cover rows (MUST be 0 -- neither kind exists in the baseline)")
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('leafbread', W, {
        'logs_per_bh_canary': rate(logs, ('canary','post')), 'logs_per_bh_control': rate(logs, ('control','post')),
        'logs_did': dl, 'buried_did': db, 'no_path_share_did': dnp,
        'cover_admits_canary': admits[('canary','post')], 'cover_outcomes_canary': oc,
        'cover_not_attempted_canary': not_attempted[('canary','post')],
        'cover_produced_canary': ok_,
        'cover_rows_control': admits[('control','post')] + outcomes[('control','post')] + not_attempted[('control','post')],
        # THE DECIDING NUMBER, and it needs no control arm. See the header note
        # on why logs_did cannot decide this at two pools and 180 minutes.
        'cover_productive_share': (ok_ / oc) if oc else None,
        'canary_bot_h': bh(('canary','post')), 'gather_runs_canary': runs[('canary','post')],
        'canopy_events_canary': canopy[('canary','post')], 'canopy_events_control': canopy[('control','post')],
        'outcomes_canary': dict(cls[('canary','post')]), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
