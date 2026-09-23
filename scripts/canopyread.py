# canopyread.py [post-min] -- the change's own line for the canopy descent: fall deaths within 60 s of a trapped_in_canopy
# or canopy_drop_refused row (must be 0 on the canary), canopy_drop_refused rows per bot-h (exposure), trapped_in_canopy
# success share (DiD, report), fall deaths per bot-h (counts). Cutoff from the manifest. Rotation-aware. Kinds carry '_'.
import os, sys, json, os, datetime as dt; sys.path.insert(0, '/opt/minecraft-ai/scripts')
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
    ev.rows.sort(key=lambda r: r['t'])
    return ev
ev = load_window(int(elapsed + PRE) + 20)
K = lambda b, era: (('canary' if b.rsplit('-', 1)[0] in CANS else 'control'), era)
bots = defaultdict(set); rows = Counter(); falls = Counter(); linked = Counter(); refused = Counter(); canopy = defaultdict(Counter); recent = defaultdict(list); ex = []
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from exposure import Spans
EXPO = Spans()

for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated'): continue
    d = (r['t'] - CUT).total_seconds() / 60
    if d < -PRE or d > W: continue
    k = K(b, 'post' if d >= 0 else 'pre'); bots[k].add(b); rows[k] += 1; EXPO.add(k, b, r['t'])
    n = r['name']; det = r['detail'] or ''; st = (r['raw'].get('skill') or {}).get('status')
    if n in ('_trapped_in_canopy', '_canopy_drop_refused'): recent[b].append(r['t'])
    if n == '_trapped_in_canopy': canopy[k][st or '?'] += 1
    if n == '_canopy_drop_refused': refused[k] += 1
    if n == '_death' and 'fell' in det:
        falls[k] += 1
        if any((r['t'] - t).total_seconds() <= 60 for t in recent[b][-5:]): linked[k] += 1; ex.append((k, b, r['t'].strftime('%H:%M:%S'), det[:90]))
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
print(f"canary_pool={CAN} code={CV} cutoff={CUT.strftime('%H:%M:%S')} pre {PRE} / post {W:.0f} min -- CANOPY read (descriptive)")
print("positive control: rows", sum(rows.values()), "fall deaths", sum(falls.values()), "canopy rows", sum(sum(c.values()) for c in canopy.values()))
for arm in ('canary', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era); h = bh(k); c = canopy[k]; t = sum(c.values())
        print(f"  {arm:7} {era:4} bots {len(bots[k]):2d} bot-h {h:6.1f}  fall deaths {falls[k]:2d} ({falls[k]/h if h else 0:.3f}/bh)  within 60 s of a canopy row {linked[k]}  canopy_drop_refused {refused[k]} ({refused[k]/h if h else 0:.2f}/bh)  trapped_in_canopy {dict(c) or '{}'} success {100*c['success']/t if t else float('nan'):.0f}%")
cp = ('canary', 'post')
print(f"OWN LINE: canary fall deaths within 60 s of a canopy row = {linked[cp]} (must be 0); canopy_drop_refused rows {refused[cp]} (exposure); control post refusals (old code, must be 0): {refused[('control','post')]}")
for e in ex[:10]: print('   ', e)
try:
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp'); from readjson import emit
    emit('canopyread', W, {'canary_bot_h': bh(cp), 'falls_linked_canary': linked[cp], 'refusals_canary': refused[cp], 'canopy_rows_canary': dict(canopy[cp]), 'falls_canary': falls[cp], 'falls_control': falls[('control', 'post')],
        'control_refusals': refused[('control', 'post')], 'positive_control_rows': sum(rows.values())})
except Exception as _e: print('VERDICT_JSON failed:', _e)
