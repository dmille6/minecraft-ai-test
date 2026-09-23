# pocketread.py [post-min] -- the change's own line for the flooded-pocket canary (-10): drowning deaths per bot-h
# (DiD, counts), flooded_pocket_rung rows by outcome, side-exit rows, blocks spent per rung (p90), and the water
# hold's release rate as the friction guard. Cutoff from the manifest. Rotation-aware load. Kinds carry the underscore.
import os, sys, json, os, re, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
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
K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)
bots = defaultdict(set); rows = Counter(); deaths = Counter(); drown = Counter(); rung = defaultdict(Counter); side = defaultdict(Counter); blocks = defaultdict(list); hold = defaultdict(Counter); sealed = Counter(); unparsed = Counter(); ex = []
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from exposure import Spans
EXPO = Spans()

for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    k = K(b, 'post' if d >= 0 else 'pre'); bots[k].add(b); rows[k] += 1; EXPO.add(k, b, r['t'])
    n = r['name']; det = r['detail'] or ''; st = (r['raw'].get('skill') or {}).get('status') or (r['raw'].get('outcome') or {}).get('status')
    if n == '_death':
        deaths[k] += 1
        if 'drown' in det: drown[k] += 1; ex.append((k, b, r['t'].strftime('%H:%M:%S'), det[:100]))
    if n == '_flooded_pocket_rung':
        rung[k][st or '?'] += 1; m = re.search(r'blocks (\d+)', det)
        if m: blocks[k].append(int(m.group(1)))
        else: unparsed[k] += 1
        if k[0] == 'canary' and k[1] == 'post': ex.append((k, b, r['t'].strftime('%H:%M:%S'), 'rung: ' + det[:120]))
    if n == '_flooded_pocket_side_exit': side[k][st or '?'] += 1
    if n == '_drowning_ceiling_no_air' and 'sealed' in det: sealed[k] += 1
    if n in ('_drowning_breathing', '_water_no_air_route_ended', '_drowning_ceiling_no_air'): hold[k][n] += 1
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
def p90(v): v = sorted(v); return v[int(0.9 * (len(v) - 1))] if v else None
print(f"canary_pool={CAN} code={CV} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- FLOODED POCKET read (descriptive)")
print("positive control: rows", sum(rows.values()), "deaths", sum(deaths.values()), "drownings", sum(drown.values()), "sealed verdicts", sum(sealed.values()))
rate = {}
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = bh(k); rate[k] = drown[k] / h if h else 0
        rel = hold[k]['_drowning_breathing']; tot = rel + hold[k]['_drowning_ceiling_no_air']
        print(f"  {arm:7} {era:4} bots {len(bots[k]):2d} bot-h {h:6.1f}  deaths {deaths[k]:2d}  drownings {drown[k]:2d} ({rate[k]:.3f}/bh)  sealed verdicts {sealed[k]:3d}  rung {dict(rung[k]) or '{}'} blocks p90 {p90(blocks[k])}  side-exit {dict(side[k]) or '{}'}  hold releases {rel}/{tot} ({100*rel/tot if tot else 0:.0f}%)")
did = (rate[('canary','post')] - rate[('canary','pre')]) - (rate[('control','post')] - rate[('control','pre')])
print(f"drowning deaths DiD: {did:+.3f}/bh (counts above; unmeasurable on 10 bots in 6 h, reported not judged)")
cp = ('canary', 'post'); print(f"EXPOSURE: canary post rung rows {sum(rung[cp].values())} (KEEP needs >= 1 with a sealed verdict present: {sealed[cp]}); side-exit rows {sum(side[cp].values())}; blocks per rung p90 {p90(blocks[cp])} (<= 12) over {len(blocks[cp])} measured rungs, {unparsed[cp]} unparsed (EXCLUDED, not scored as 0); control post rung rows (old code, must be 0): {sum(rung[('control','post')].values())}")
def rr(k): rel = hold[k]['_drowning_breathing']; tot = rel + hold[k]['_drowning_ceiling_no_air']; return (rel / tot) if tot else float('nan')
print(f"FRICTION: hold release share canary {100*rr(('canary','pre')):.0f}% -> {100*rr(('canary','post')):.0f}% vs control {100*rr(('control','pre')):.0f}% -> {100*rr(('control','post')):.0f}% (one-sided guard -30 pp)")
for e in ex[:30]: print('   ', e)
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('pocketread', W, {'canary_bot_h': bh(cp), 'sealed_verdicts_canary': sealed[cp], 'rung_rows': dict(rung[cp]), 'side_exit_rows': dict(side[cp]), 'blocks_p90': (p90(blocks[cp]) if blocks[cp] else None), 'blocks_measured_canary': len(blocks[cp]), 'blocks_unparsed_canary': unparsed[cp],
        'control_rung_rows': sum(rung[('control', 'post')].values()), 'drownings_canary': drown[cp], 'drownings_control': drown[('control', 'post')], 'drown_did': did,
        'hold_release_canary_post': rr(cp), 'hold_release_control_post': rr(('control', 'post')), 'positive_control_rows': sum(rows.values())})
except Exception as _e: print('VERDICT_JSON failed:', _e)
