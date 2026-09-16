# lavaread.py [post-min] -- the change's own line for recovery-ladder-08 (lava guards): lava/fire deaths and guard rows,
# canary pools vs control, pre 180 / post W, counts beside rates. Cutoff from the manifest. Rotation-aware load.
import sys, json, os, re, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
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
    import glob as _g
    start = now - dt.timedelta(minutes=since_minutes)
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz', since_minutes=since_minutes).rows)
        d += dt.timedelta(days=1)
    return ev
ev = load_window(int(elapsed + PRE) + 20)
GUARDS = ('_lava_corridor', '_hold_lava_ahead', '_lava_adjacent_stand_off', '_lava_adjacent_no_retreat')   # logEvent kinds carry the underscore in skill.name (2026-09-15: the first run of this read counted 0 of 134 rows)
K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)
deaths = Counter(); lava = Counter(); guard = defaultdict(Counter); bots = defaultdict(set); rows = Counter(); ex = []; reason = defaultdict(Counter); mine = defaultdict(Counter); blind = defaultdict(Counter)
for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    k = K(b, 'post' if d >= 0 else 'pre'); bots[k].add(b); rows[k] += 1
    n = r['name']; det = (r['detail'] or '')
    if n == '_death':
        deaths[k] += 1
        if 'lava' in det or 'fire' in det or 'burn' in det or 'magma' in det: lava[k] += 1; ex.append((k, b, r['t'].strftime('%H:%M:%S'), det[:90]))
    if n in GUARDS: guard[k][n] += 1
    if n == '_lava_corridor': reason[k][re.sub(r' at .*', '', det.split(':', 1)[-1]).strip()[:24]] += 1
    if n == '_explore_blind_step_refused': blind[k][re.sub(r' at .*', '', det.split(':', 1)[-1]).strip()[:28]] += 1
    if n == 'mine': mine[k]['ok' if (r['raw'].get('outcome') or {}).get('status') == 'success' or (r['raw'].get('skill') or {}).get('status') == 'success' else 'other'] += 1
    if n in GUARDS and k[0] == 'canary' and k[1] == 'post' and len(ex) < 40: ex.append((k, b, r['t'].strftime('%H:%M:%S'), n + ': ' + det[:80]))
print(f"canary_pool={CAN} code={CV} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- LAVA GUARDS read (descriptive)")
print("positive control: rows", sum(rows.values()), "deaths total", sum(deaths.values()))
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); nb = len(bots[k]); bh = nb * (PRE if era == 'pre' else W) / 60
        g = guard[k]
        print(f"  {arm:7} {era:4} bots {nb:2d} bot-h {bh:6.1f}  deaths {deaths[k]:2d} ({deaths[k]/bh if bh else 0:.3f}/bh)  lava/fire {lava[k]:2d} ({lava[k]/bh if bh else 0:.3f}/bh)  guards " + ' '.join(f"{n.lstrip('_').split('_',1)[1][:12]}={g[n]}" for n in GUARDS))
def rate(k, c): nb = len(bots[k]); bh = nb * (PRE if k[1] == 'pre' else W) / 60; return c[k] / bh if bh else 0.0
did = (rate(('canary','post'), lava) - rate(('canary','pre'), lava)) - (rate(('control','post'), lava) - rate(('control','pre'), lava))
print(f"lava/fire deaths DiD: {did:+.3f}/bh (counts above; unmeasurable on 10 bots in 6 h, reported not judged)")
cp = ('canary', 'post'); h = len(bots[cp]) * W / 60
print(f"INSTRUMENT (-08b line): lava_corridor refusals on the canary post {sum(reason[cp].values())} = {sum(reason[cp].values())/h if h else 0:.2f}/bot-h by reason {dict(reason[cp])} (KEEP needs < 3/bot-h at +90; -08 ran 18/bot-h)")
print(f"INSTRUMENT (-08c line): explore blind-step refusals on the canary post {sum(blind[cp].values())} = {sum(blind[cp].values())/h if h else 0:.2f}/bot-h by reason {dict(blind[cp])}; control post (old code, must be 0): {sum(blind[('control','post')].values())}")
def ms(k): c = mine[k]; t = c['ok'] + c['other']; return (c['ok'] / t if t else float('nan')), t
mdid = (ms(('canary','post'))[0] - ms(('canary','pre'))[0]) - (ms(('control','post'))[0] - ms(('control','pre'))[0])
print(f"FRICTION: mine success canary {100*ms(('canary','pre'))[0]:.0f}% -> {100*ms(('canary','post'))[0]:.0f}% ({ms(('canary','post'))[1]} runs) vs control {100*ms(('control','pre'))[0]:.0f}% -> {100*ms(('control','post'))[0]:.0f}%  DiD {100*mdid:+.0f} pp (one-sided guard -30 pp)")
gp = sum(guard[('canary','post')].values()); print(f"guard rows on the canary post: {gp} ({'exposure PRESENT' if gp else 'NONE -- mechanism INCONCLUSIVE, safety still reads'}); control post (should be 0, old code): {sum(guard[('control','post')].values())}")
for e in ex[:40]: print('   ', e)
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    cpk = ('canary', 'post'); h = len(bots[cpk]) * W / 60
    emit('lavaread', W, {'canary_bot_h': h, 'lava_deaths_canary': lava[cpk], 'lava_deaths_control': lava[('control', 'post')], 'control_bot_h': len(bots[('control', 'post')]) * W / 60,
        'corridor_refusals_per_bh': (sum(reason[cpk].values()) / h if h else 0), 'corridor_by_reason': dict(reason[cpk]), 'blind_refusals_per_bh': (sum(blind[cpk].values()) / h if h else 0), 'blind_by_reason': dict(blind[cpk]),
        'guard_rows': int(gp), 'control_guard_rows': int(sum(guard[('control', 'post')].values())), 'mine_did_pp': mdid, 'lava_did': did, 'positive_control_rows': sum(rows.values())})
except Exception as _e: print('VERDICT_JSON failed:', _e)
