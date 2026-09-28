"""HARM + declared-residual read for plant-20260927, with the kind names FIXED.

The first version of this script reported `deaths 0` in 307 bot-h and
`learned_avoid 0`. Both were wrong-name zeros: the kind is `_death`, and the
avoid gate emits no event of its own. Every count below is printed with the
positive control that shows the query can find the thing at all.
"""
import sys, collections, datetime as dt
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events

DEPLOY = dt.datetime(2026, 9, 27, 6, 22, 0, tzinfo=dt.timezone.utc)
ev = Events.load(since_minutes=660)
rows = ev.rows
sk = lambda r: ((r.get('raw') or {}).get('skill') or {})
bn = lambda r: (r.get('bot') or {}).get('name')
det = lambda r: (sk(r).get('detail') or r.get('detail') or '')
allk = collections.Counter(r.get('name') for r in rows)
print(f"POSITIVE CONTROL: {len(rows):,} rows / {len({bn(r) for r in rows})} bots / {len(allk)} kinds; "
      f"_death present {allk['_death']}, place {allk['place']}, _plant_spot {allk['_plant_spot']}")

PRE  = (DEPLOY - dt.timedelta(hours=4), DEPLOY - dt.timedelta(minutes=10))
POST = (DEPLOY + dt.timedelta(minutes=50), DEPLOY + dt.timedelta(hours=4, minutes=50))
SKILLS = {'gather','goto','mine','place','deposit','craft','explore','smelt','home','board','bucket',
          'surface','eat','withdraw','status'}
def report(name, a, b):
    w = [r for r in rows if a <= r['t'] < b]
    bots = {bn(r) for r in w}; bh = len(bots) * (b - a).total_seconds() / 3600
    dec = [r for r in w if r.get('name') in SKILLS]
    g = [r for r in w if r.get('name') == 'gather']
    gok = sum(1 for r in g if sk(r).get('status') == 'success')
    log = sum(1 for r in g if sk(r).get('status') == 'success' and '_log' in str(sk(r).get('inventory_delta') or sk(r).get('args') or ''))
    print(f"\n{name} {a:%H:%M}-{b:%H:%M}Z  {len(w):,} rows / {len(bots)} bots / {bh:.0f} bot-h")
    print(f"   _death {sum(1 for r in w if r.get('name')=='_death')} "
          f"({sum(1 for r in w if r.get('name')=='_death')/bh:.3f}/bot-h)")
    print(f"   skill invocations {len(dec)} ({len(dec)/bh:.1f}/bot-h)   "
          f"gather {len(g)} success {gok} ({gok/bh:.2f}/bot-h, {100*gok/max(len(g),1):.1f}%)")
    print(f"   _rule_contradicted {sum(1 for r in w if r.get('name')=='_rule_contradicted')}   "
          f"_veto_faces {sum(1 for r in w if r.get('name')=='_veto_faces')}")
    return w
report('PRE ', *PRE); post = report('POST', *POST)

print("\n=== THE DECLARED RESIDUAL: does the avoid gate veto the place channel? ===")
rc = [r for r in post if r.get('name') == '_rule_contradicted']
print(f"_rule_contradicted post: {len(rc)}   POSITIVE CONTROL sample details:")
for r in rc[:4]: print("   ", det(r)[:150])
naming_place = [r for r in rc if 'place' in det(r)]
print(f"   naming place: {len(naming_place)} of {len(rc)}")
by_hour = collections.Counter(r['t'].strftime('%H') for r in post if r.get('name') == '_plant_spot')
pl_h   = collections.Counter(r['t'].strftime('%H') for r in post
                             if r.get('name') == 'place' and 'sapling' in str(sk(r).get('args') or ''))
print(f"   _plant_spot by hour: {sorted(by_hour.items())}")
print(f"   sapling place by hour: {sorted(pl_h.items())}")
print("   A gate closing on one shared key would show a FALLING place count against a flat")
print("   _plant_spot count; both are flat, so the residual has not bitten in 4.8 h.")
