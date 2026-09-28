#!/usr/bin/env python3
"""needsdrop-01 read: did disarming the harvest watchdog remove the cancellations?

PRIMARY, as registered before deploy: share of gather runs whose detail contains
'Digging aborted', ratio-DiD, expected -54%. KEEP at <= -25% with the readability
floor met.

NOT items/bot-hour. Measured null sd at k=20 over 3 h is 0.313 (MDE ~85%), and the
ceiling for a perfect fix is about +2.9% because 83.9% of the affected blocks are
stone and cobblestone. items and gather success are REPORTED, never gated.

DEATHS ARE THE ONLY GATE, under the standing two-death floor. Codex pass 2
corrected my framing that the cost of disarming is 'latency, never a hang': extra
delay while submerged or under attack can kill inside a finite budget. So harm is
the thing to watch, not the mechanism count.

Difference-in-differences against each arm's own pre-period -- never
canary-vs-fleet -- and the first RESTART_SKIP_MIN after the cutoff are discarded,
because a restarted bot decides before it gathers.

The cutoff is READ FROM THE MANIFEST, never typed.
"""
import sys, json, math, datetime as dt
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events
from collections import Counter, defaultdict

RESTART_SKIP_MIN = 10
FLOOR_RUNS = 200          # registered readability floor, canary gather terminal rows

MAN = json.load(open('/srv/mcbots/trial-manifest.json'))
CAN = {x.strip() for x in str(MAN.get('canary_pool') or '').split(',') if x.strip()}
SHA = MAN.get('canary_code_version')
DECL = dt.datetime.fromisoformat(str(MAN['declared_at']).replace('Z', '+00:00'))
now = dt.datetime.now(dt.timezone.utc)
age = (now - DECL).total_seconds() / 60
assert now > DECL, 'cutoff is in the future'

POST_FROM = DECL + dt.timedelta(minutes=RESTART_SKIP_MIN)
post_min = max(0.0, (now - POST_FROM).total_seconds() / 60)
pre_min = max(post_min, 60.0)
PRE_FROM = DECL - dt.timedelta(minutes=pre_min)

print('needsdrop-01  canary %s on %s' % (SHA, ','.join(sorted(CAN))))
print('declared_at %s (from the manifest), age %.0f min' % (DECL.isoformat(), age))
print('pre  %s .. %s (%.0f min)   post %s .. now (%.0f min usable, first %d discarded)'
      % (PRE_FROM.strftime('%H:%MZ'), DECL.strftime('%H:%MZ'), pre_min,
         POST_FROM.strftime('%H:%MZ'), post_min, RESTART_SKIP_MIN))

ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(pre_min + age) + 5)
runs = Counter(); aborts = Counter(); bots = defaultdict(set)
items = Counter(); deaths = Counter(); succ = Counter()
coll = Counter(); callers = defaultdict(Counter)
for r in ev.rows:
    b = (r['bot'] or {}).get('name')
    if not b or b.startswith('isolated'):
        continue
    p = b.rsplit('-', 1)[0]
    arm = 'CANARY' if p in CAN else 'control'
    t = r['t']
    if t < PRE_FROM:
        continue
    if t < DECL:
        ph = 'pre'
    elif t < POST_FROM:
        continue
    else:
        ph = 'post'
    k = (arm, ph)
    bots[k].add(b)
    sk = r['raw'].get('skill') or {}
    det = str(sk.get('detail') or '')
    nm = r['name'].lstrip('_')
    if nm == 'gather':
        runs[k] += 1
        if 'Digging aborted' in det:
            aborts[k] += 1
        if sk.get('status') == 'success':
            succ[k] += 1
    if r['name'] == '_dig_collision':
        coll[k] += 1
        callers[k][det.split('stopDigging called from', 1)[-1].strip()[:60]] += 1
    if r['name'] == '_death':
        deaths[k] += 1
    for _i, v in (sk.get('inventory_delta') or {}).items():
        if v > 0:
            items[k] += v

mins = {'pre': pre_min, 'post': post_min}
bh = {k: len(v) * mins[k[1]] / 60 for k, v in bots.items()}

print()
print('POSITIVE CONTROL: %d rows in scope, %d gather runs, %d aborts, %d collision rows'
      % (len(ev.rows), sum(runs.values()), sum(aborts.values()), sum(coll.values())))
if sum(runs.values()) == 0:
    raise SystemExit('no gather runs in scope -- the query is broken, not the fleet')

print()
print('(1) PRIMARY -- abort share of gather runs, ratio-DiD')
print('    %-9s %10s %10s %9s' % ('arm/era', 'runs', 'aborts', 'share'))
sh = {}
for a in ('CANARY', 'control'):
    for ph in ('pre', 'post'):
        k = (a, ph)
        s = aborts[k] / runs[k] if runs[k] else None
        sh[k] = s
        print('    %-9s %10d %10d %8s' % ('%s/%s' % (a, ph), runs[k], aborts[k],
                                          ('%.1f%%' % (100 * s)) if s is not None else '-'))
canary_runs_post = runs[('CANARY', 'post')]
readable = canary_runs_post >= FLOOR_RUNS
print()
print('    readability floor: %d canary gather runs post (need >= %d) -> %s'
      % (canary_runs_post, FLOOR_RUNS, 'READABLE' if readable else 'NOT YET READABLE'))
if all(sh.get(k) for k in sh) and readable:
    did = (sh[('CANARY', 'post')] / sh[('CANARY', 'pre')]) / (sh[('control', 'post')] / sh[('control', 'pre')])
    print('    ratio-DiD %.3f  (%+.0f%%)   registered expectation -54%%, KEEP at <= -25%%'
          % (did, 100 * (did - 1)))
    print('    -> %s' % ('MEETS the KEEP threshold' if did <= 0.75 else 'does NOT meet -25% yet'))
elif not readable:
    print('    no verdict: below the registered floor')

print()
print('(2) dig_collision caller mix -- the recorder is FLEET-WIDE, so control is the counterfactual')
for a in ('CANARY', 'control'):
    tot = coll[(a, 'post')]
    print('    %-9s %d rows post' % (a, tot))
    for c, n in callers[(a, 'post')].most_common(4):
        print('        %4d  %s' % (n, c or '(unknown)'))
print('    watch for the share merely MOVING to reflex.mjs:4880 or digging.js:127,')
print('    which would mean the cancels were relocated rather than removed.')

print()
print('(3) HARM -- the only gate')
for a in ('CANARY', 'control'):
    k = (a, 'post')
    if bh.get(k):
        print('    %-9s %d deaths in %.1f bot-h = %.3f/bot-h' % (a, deaths[k], bh[k], deaths[k] / bh[k]))
dc, dk = deaths[('CANARY', 'post')], deaths[('control', 'post')]
if dc < 2:
    print('    -> %d canary death(s): REPORTED, not a verdict (two-death floor)' % dc)
else:
    rc = deaths[('CANARY', 'post')] / bh[('CANARY', 'post')]
    rk = deaths[('control', 'post')] / bh[('control', 'post')] if bh.get(('control', 'post')) else 0
    print('    -> %d canary deaths, ratio %.2fx control (gate needs > 1.25x)' % (dc, rc / rk if rk else 0))

print()
print('(4) DESCRIPTIVE ONLY -- not gates (items null sd 0.313 at k=20, MDE ~85%)')
for a in ('CANARY', 'control'):
    for ph in ('pre', 'post'):
        k = (a, ph)
        if bh.get(k):
            print('    %-9s %-5s items/bot-h %6.1f   gather success %5.1f%%'
                  % (a, ph, items[k] / bh[k], 100 * succ[k] / runs[k] if runs[k] else 0))
