# shoreread.py [post-min] -- the SHORELINE LOG canary's read. Cutoff from the manifest.
# CANARY_DRYRUN=pool:sha:iso for dry runs.
#
# THE ENDPOINT IS A RATE, NOT A SUM. Every wood canary before this one was read on
# acquired-logs-per-bot-hour, whose placebo null is sd 3.00 against a canary-arm baseline
# of 0.64 -- blind at any effect this change could produce, and the line that reverted
# leaf-01 fired on 43.3% of windows where nothing was deployed. Items per bot-hour is a
# heavy-tailed SUM: one bamboo stack contributes 91 in a single row.
#
# So the primary is PRODUCTIVE LOG GATHERS PER LOG GATHER -- a Bernoulli trial per run,
# n ~ 900 per arm in a 3 h 5-bot window, binomial se ~ 1.1 pp. It is bounded, it cannot
# be moved by one lucky row, and it is measured WITHIN the arm as well as across arms.
#
# THE DECIDING TEST IS CONSERVATION, pre-registered before deploy. leaf-01 halved the
# refusal it targeted (unreachable -8.9 pp) and the freed attempts became a DIFFERENT
# refusal (no_safe_target +13.6 pp) rather than wood. If no_safe_target falls here and
# the other classes absorb more than half of that fall, this is the same failure and it
# is a REVERT whatever the endpoint says.
import sys, json, os, math, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
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
runs = Counter(); ok = Counter(); cls = defaultdict(Counter); logs = Counter()
exempt = Counter(); deaths = Counter(); canopy = Counter()
span = defaultdict(lambda: [None, None]); bots = defaultdict(set)
FILTER_OTHER = {'no_path', 'unreachable', 'collect_budget', 'nothing_found'}
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
    # LINKAGE: this kind does not exist in the baseline 842e017.
    if n == '_shoreline_exempt': exempt[k] += 1
    if n != 'gather': continue
    sk = r['raw'].get('skill') or {}
    if not str((sk.get('args') or {}).get('block') or '').endswith('_log'): continue
    runs[k] += 1
    fc = sk.get('fail_class') or ''
    gained = sum(v for it, v in (sk.get('inventory_delta') or {}).items() if v > 0 and it.endswith('_log'))
    if gained > 0: ok[k] += 1; logs[k] += gained
    cls[k][fc or ('ok' if sk.get('status') == 'success' else 'other')] += 1
def bh(k): return sum((s[1]-s[0]).total_seconds()/3600 for (kk,b),s in span.items() if kk==k and s[0] and s[1])
rate = lambda k: (ok[k]/runs[k]) if runs[k] else None
se = lambda k: (math.sqrt(max(rate(k),1e-9)*(1-rate(k))/runs[k]) if runs[k] else None)
share = lambda k, c: (cls[k][c]/runs[k]) if runs[k] else None
print(f"canary_pool={CAN} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- SHORELINE LOG read")
print(f"{'arm/era':14s} {'bots':>4s} {'bot-h':>6s} {'log runs':>9s} {'productive':>11s} {'rate':>8s} {'+-se':>7s} {'logs':>6s} {'exempt':>7s} {'deaths':>7s}")
for arm in ('canary','control'):
    for era in ('pre','post'):
        k=(arm,era); rr=rate(k)
        print(f"{arm+'/'+era:14s} {len(bots[k]):4d} {bh(k):6.1f} {runs[k]:9d} {ok[k]:11d} "
              f"{('%7.1f%%'%(100*rr)) if rr is not None else '       -'} {('%6.1f'%(100*se(k))) if rr is not None else '      -'} "
              f"{logs[k]:6d} {exempt[k]:7d} {deaths[k]:7d}")
def did(f):
    try: return (f(('canary','post')) - f(('canary','pre'))) - (f(('control','post')) - f(('control','pre')))
    except TypeError: return None
d_rate = did(rate)
d_nst = did(lambda k: share(k, 'no_safe_target'))
d_other = did(lambda k: sum(cls[k][c] for c in FILTER_OTHER)/runs[k] if runs[k] else None)
print(f"\nPRIMARY  productive log gathers per log gather, DiD: "
      f"{('%+.1f pp' % (100*d_rate)) if d_rate is not None else 'UNREADABLE'}"
      f"   (canary post {('%.1f%%'%(100*rate(('canary','post')))) if rate(('canary','post')) is not None else '-'}"
      f" +- {('%.1f'%(100*se(('canary','post')))) if runs[('canary','post')] else '-'} pp, n={runs[('canary','post')]})")
print(f"CONSERVATION  no_safe_target DiD {('%+.1f pp'%(100*d_nst)) if d_nst is not None else '-'}"
      f"   |  no_path+unreachable+collect_budget+nothing_found DiD {('%+.1f pp'%(100*d_other)) if d_other is not None else '-'}")
absorbed = None
if d_nst is not None and d_other is not None and d_nst < 0:
    absorbed = d_other / (-d_nst)
    print(f"   -> the fall in no_safe_target was {100*absorbed:.0f}% ABSORBED by the other refusals. "
          f"{'THIS IS leaf-01 AGAIN' if absorbed > 0.5 else 'below the 50% pre-registered line'}")
elif d_nst is not None:
    print("   -> no_safe_target did NOT fall; the change did not do the thing it exists to do")
print(f"LINKAGE  shoreline_exempt rows: canary {exempt[('canary','post')]}, control {exempt[('control','post')]} (control MUST be 0)")
print(f"CONVERSION canary post: {dict(cls[('canary','post')].most_common(8))}")
print(f"           control post: {dict(cls[('control','post')].most_common(8))}")
print("positive control: rows", len(ev.rows), "bots", sum(len(v) for v in bots.values()))
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('shoreread', W, {
        'rate_did': d_rate, 'rate_canary': rate(('canary','post')), 'rate_control': rate(('control','post')),
        'rate_se_canary': se(('canary','post')), 'runs_canary': runs[('canary','post')],
        'no_safe_target_did': d_nst, 'other_refusals_did': d_other,
        'absorbed_fraction': absorbed,
        'exempt_rows_canary': exempt[('canary','post')], 'exempt_rows_control': exempt[('control','post')],
        'canary_bot_h': bh(('canary','post')), 'canopy_events_canary': canopy[('canary','post')],
        'outcomes_canary': dict(cls[('canary','post')]), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
