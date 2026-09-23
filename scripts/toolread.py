# toolread.py [post-min] -- the change's own line for the iron-retention canary: iron pickaxes LOST during work per
# bot-hour (count drops between consecutive inventory-carrying rows, not at a death/deposit row), canary vs control,
# pre 180 / post W, DiD; plus canary-only wear (iron uses consumed per bot-h from the per-copy tools snapshot) and
# tool_broke / tool_gone rows (the control code has neither). Cutoff from the manifest. Rotation-aware load.
import os, sys, json, os, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
from collections import Counter, defaultdict
from lib.telemetry import Events
from lib.arms import arm_of   # ONE definition of which arm a bot is in; accepts pool names (unchanged) AND bot names, which is what a within-world design needs
man = json.load(open('/srv/mcbots/trial-manifest.json')); ovr = os.environ.get('CANARY_DRYRUN')
if ovr: CAN, CV, ISO = ovr.split(':', 2); CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else: CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00')); CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc); elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
PRE = 180; W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
def load_window(since_minutes):
    import glob as _g
    start = now - dt.timedelta(minutes=since_minutes)
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz', since_minutes=since_minutes).rows)
        d += dt.timedelta(days=1)
    ev.rows.sort(key=lambda r: r['t'])
    return ev
ev = load_window(int(elapsed + PRE) + 20)
K = lambda b, era: (arm_of(b, CANS), era)
PICKS = ('iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe', 'diamond_pickaxe')
bots = defaultdict(set); lost = defaultdict(Counter); where = defaultdict(Counter); rows = Counter(); last = {}
wear = Counter(); wearseen = defaultdict(dict); broke = defaultdict(Counter); gs = defaultdict(Counter)
def uses(tw, name):
    v = (tw or {}).get(name); v = v if isinstance(v, list) else ([v] if v else [])
    return sum((x.get('used') or 0) for x in v if x)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from exposure import Spans
EXPO = Spans()

for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    k = K(b, 'post' if d >= 0 else 'pre'); bots[k].add(b); rows[k] += 1; EXPO.add(k, b, r['t'])
    n = r['name']; st = (r['raw'].get('outcome') or {}).get('status') or (r['raw'].get('skill') or {}).get('status')
    if n in ('gather', 'mine'): gs[k][(n, 'ok' if st == 'success' else 'other')] += 1
    if n in ('_tool_broke', '_tool_gone'): broke[k][n.lstrip('_')] += 1   # logEvent kinds carry the underscore in skill.name
    inv = r['bot'].get('inventory'); tw = r['bot'].get('tools')
    if isinstance(inv, dict):
        prev = last.get(b)
        if prev and prev[0] == k[0]:
            for p in PICKS:
                drop = prev[1].get(p, 0) - inv.get(p, 0)
                if drop > 0 and n not in ('_death', 'deposit'): lost[k][p] += drop; where[k][n or '?'] += drop
        last[b] = (k[0], inv)
        if tw and k[0] == 'canary':
            u = uses(tw, 'iron_pickaxe'); pu = wearseen[k].get(b)
            if pu is not None and u > pu: wear[k] += u - pu
            wearseen[k][b] = u
# ONE BOT-HOUR DEFINITION (2026-09-23). This was
#     def bh(k): return len(bots[k]) * (PRE if k[1] == 'pre' else W) / 60
# -- wall-clock x bot count, which credits a bot that crashed at minute 10 of a 180-minute
# window with the full three hours. That OVERSTATES exposure and so UNDERSTATES every rate
# computed from it, which for a harm rate is the dangerous direction.
#
# docs/TODO-block2-shakedown.md recorded that four scripts computed exposure four
# incompatible ways, "none convertible to another, so no two reports have ever been
# comparable", and prescribed one shared function. lib/exposure.py is that function; this
# read now uses it, matching depositread, banktruthread, immobiledid, shoreread, leafread
# and leafbread, which already summed per-bot spans.
def bh(k): return EXPO.hours(k, allow_zero=True)
print(f"canary_pool={CAN} code={CV} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- TOOL RETENTION read (descriptive)")
print("positive control: rows", sum(rows.values()), "pickaxes lost during work, all arms:", sum(sum(c.values()) for c in lost.values()))
rate = {}
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = bh(k); ir = lost[k]['iron_pickaxe'] / h if h else 0; rate[k] = ir
        g = gs[k]; gok = g[('gather', 'ok')]; gall = gok + g[('gather', 'other')]; mok = g[('mine', 'ok')]; mall = mok + g[('mine', 'other')]
        print(f"  {arm:7} {era:4} bots {len(bots[k]):2d} bot-h {h:6.1f}  iron picks lost in work {lost[k]['iron_pickaxe']:2d} ({ir:.3f}/bh)  stone {lost[k]['stone_pickaxe']:2d} wooden {lost[k]['wooden_pickaxe']:2d}  where {dict(where[k].most_common(3))}  gather ok {gok}/{gall}  mine ok {mok}/{mall}" + (f"  iron uses consumed {wear[k]} ({wear[k]/h if h else 0:.1f}/bh)  rows broke/gone {broke[k]['tool_broke']}/{broke[k]['tool_gone']}" if arm == 'canary' else ''))
did = (rate[('canary','post')] - rate[('canary','pre')]) - (rate[('control','post')] - rate[('control','pre')])
print(f"iron pickaxes lost in work, DiD: {did:+.3f}/bh (counts above; the fleet holds few iron pickaxes, so this is reported, not judged)")
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    cpk = ('canary', 'post'); h = bh(cpk)
    emit('toolread', W, {'canary_bot_h': h, 'iron_lost_canary': lost[cpk]['iron_pickaxe'], 'iron_lost_control': lost[('control', 'post')]['iron_pickaxe'], 'iron_lost_did': did,
        'stone_lost_per_bh_canary': (lost[cpk]['stone_pickaxe'] / h if h else 0), 'stone_lost_per_bh_control': (lost[('control', 'post')]['stone_pickaxe'] / bh(('control', 'post')) if bh(('control', 'post')) else 0),
        'iron_uses_canary': wear[cpk], 'tool_broke': broke[cpk]['tool_broke'], 'tool_gone': broke[cpk]['tool_gone'], 'positive_control_rows': sum(rows.values())})
except Exception as _e: print('VERDICT_JSON failed:', _e)
