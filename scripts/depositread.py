# depositread.py [post-min] -- descriptive deposit read for a canary: tools/stations deposited per bot-day and deposit
# outcomes by class, canary vs control, pre 180 / post W. Cutoff from the manifest. CANARY_DRYRUN=pool:sha:iso for dry runs.
import sys, json, os, re, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
from collections import Counter, defaultdict
from lib.telemetry import Events
man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}   # one pool or a comma-separated list (two pools of five, 2026-09-13)
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)

# ROTATION-AWARE LOAD (2026-09-15 00:00 UTC: logrotate copytruncated the live files at midnight and the -07 reads lost
# their pre-period). The live files plus the rotated .gz generations whose date tag falls inside the window -- one
# narrow glob per date so the loader's size cap is judged per generation, never over 14 days of history.
def load_window(since_minutes):
    import glob as _g, datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc); start = now - _dt.timedelta(minutes=since_minutes)
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + _dt.timedelta(days=1)).strftime('%Y%m%d')   # the rows of day d rotate into skill-<bot>.jsonl-<d+1>.gz
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz', since_minutes=since_minutes).rows)
        d += _dt.timedelta(days=1)
    ev.rows.sort(key=lambda r: r.get('@timestamp', ''))
    return ev

ev = load_window(int(elapsed + PRE) + 20)
K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)
tools = Counter(); runs = Counter(); cls = defaultdict(Counter); span = defaultdict(lambda: [None, None]); bots = defaultdict(set)
TOOLISH = lambda n: n.endswith('_pickaxe') or n.endswith('_axe') or n.endswith('_sword') or n.endswith('_shovel') or n in ('crafting_table', 'furnace', 'bucket', 'water_bucket', 'blast_furnace', 'smoker')
for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    era = 'post' if d >= 0 else 'pre'; k = K(b, era); bots[k].add(b)
    sp = span[(k, b)]; sp[0] = r['t'] if sp[0] is None or r['t'] < sp[0] else sp[0]; sp[1] = r['t'] if sp[1] is None or r['t'] > sp[1] else sp[1]
    if str(r['name']) != 'deposit': continue
    sk = r['raw'].get('skill') or {}; st = sk.get('status') or '?'; fc = sk.get('failClass') or ''
    runs[k] += 1; cls[k][f"{st}{('/' + fc) if fc else ''}"] += 1
    if st == 'success':
        for it, v in (sk.get('inventory_delta') or {}).items():
            if v < 0 and TOOLISH(it): tools[k] += -v
def bh(k): return sum((s[1] - s[0]).total_seconds() / 3600 for (kk, b), s in span.items() if kk == k and s[0] and s[1])
print(f"canary_pool={CAN} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- DESCRIPTIVE deposit read")
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = bh(k)
        print(f"{arm}/{era:5s} bots {len(bots[k])} bot-h {h:5.1f} deposit runs {runs[k]:4d} ({runs[k] / h if h else float('nan'):.1f}/bh)  tools+stations banked {tools[k]:3d} ({tools[k] / h * 24 if h else float('nan'):.1f}/bot-day)  outcomes {dict(cls[k].most_common(6))}")
print("positive control: rows", len(ev.rows), "bots", sum(len(v) for v in bots.values()))
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    def _share(k, c): return (cls[k][c] / runs[k]) if runs[k] else None
    emit('depositread', W, {'runs_canary': runs[('canary', 'post')], 'runs_control': runs[('control', 'post')], 'canary_bot_h': bh(('canary', 'post')),
        'skill_error_share_canary': _share(('canary', 'post'), 'skill_error'), 'skill_error_share_control': _share(('control', 'post'), 'skill_error'),
        'success_share_canary': _share(('canary', 'post'), 'success'), 'success_share_control': _share(('control', 'post'), 'success'),
        'outcomes_canary': dict(cls[('canary', 'post')]), 'positive_control_rows': len(ev.rows)})
except Exception as _e: print('VERDICT_JSON failed:', _e)
