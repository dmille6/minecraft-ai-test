# leafread.py [post-min] -- the LEAF EXPOSURE canary's read. Cutoff from the manifest.
# CANARY_DRYRUN=pool:sha:iso for dry runs.
#
# PRIMARY ENDPOINT IS ACQUIRED WOOD, NOT REFUSALS AVOIDED (Codex pass 1, 19 Sep).
# The change makes leaf-covered logs selectable. It can therefore turn a cheap
# early refusal into an expensive late failure -- pickup restores the digging
# profile and never clears cover (skills.mjs:1227-1244), so a log that drops
# INSIDE foliage can be broken and never collected. Counting "buried refusals
# avoided" would score that as a win. So refusals are a MECHANISM CHECK and the
# endpoint is logs actually in the inventory.
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
    if n != 'gather': continue
    sk = r['raw'].get('skill') or {}
    st = sk.get('status') or '?'; fc = sk.get('fail_class') or sk.get('failClass') or ''
    runs[k] += 1; cls[k][f"{st}{('/' + fc) if fc else ''}"] += 1
    if 'buried' in (sk.get('detail') or ''): buried[k] += 1
    # THE ENDPOINT: wood that actually arrived, whatever the row's status says.
    # A run marked failed can still have banked a log, and a success can bank none.
    for it, v in (sk.get('inventory_delta') or {}).items():
        if v > 0 and it.endswith('_log'): logs[k] += v
def bh(k): return sum((s[1] - s[0]).total_seconds() / 3600 for (kk, b), s in span.items() if kk == k and s[0] and s[1])
def rate(c, k): h = bh(k); return (c[k] / h) if h else None
print(f"canary_pool={CAN} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- LEAF EXPOSURE read")
print(f"{'arm/era':14s} {'bots':>4s} {'bot-h':>6s} {'logs':>6s} {'logs/bh':>8s} {'buried':>7s} {'buried/bh':>10s} {'gather':>7s} {'canopy':>7s} {'deaths':>7s}")
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = bh(k)
        lr = rate(logs, k); br = rate(buried, k)
        print(f"{arm + '/' + era:14s} {len(bots[k]):4d} {h:6.1f} {logs[k]:6d} {('%8.2f' % lr) if lr is not None else '       -'} "
              f"{buried[k]:7d} {('%10.2f' % br) if br is not None else '         -'} {runs[k]:7d} {canopy[k]:7d} {deaths[k]:7d}")
def did(c):
    try: return (rate(c, ('canary','post')) - rate(c, ('canary','pre'))) - (rate(c, ('control','post')) - rate(c, ('control','pre')))
    except TypeError: return None
dl, db = did(logs), did(buried)
print(f"\nPRIMARY  acquired logs/bot-h, difference-in-differences: {('%+.2f' % dl) if dl is not None else 'UNREADABLE (an arm has no bot-hours)'}")
print(f"MECHANISM buried refusals/bot-h, DiD: {('%+.2f' % db) if db is not None else 'UNREADABLE'}  (a fall here with NO rise in logs is the failure mode, not the win)")
print(f"CONVERSION canary post failure classes: {dict(cls[('canary','post')].most_common(8))}")
print("positive control: rows", len(ev.rows), "bots", sum(len(v) for v in bots.values()))
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('leafread', W, {
        'logs_per_bh_canary': rate(logs, ('canary','post')), 'logs_per_bh_control': rate(logs, ('control','post')),
        'logs_did': dl, 'buried_did': db,
        'buried_per_bh_canary': rate(buried, ('canary','post')),
        'canary_bot_h': bh(('canary','post')), 'gather_runs_canary': runs[('canary','post')],
        'canopy_events_canary': canopy[('canary','post')], 'canopy_events_control': canopy[('control','post')],
        'outcomes_canary': dict(cls[('canary','post')]), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
