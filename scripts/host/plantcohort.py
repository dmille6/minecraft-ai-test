"""Build the growth cohort for plant-20260927: every planting whose sapling
place() actually landed, with the coordinate plant_spot recorded.

The coordinate is the instrument. This script only produces it; the RCON read on
.30 decides. A planting is IN the cohort when the bot emitted plant_spot with
ordered=1 and its NEXT place row within 120 s was a sapling place with
status=success -- both halves, because an order is not a placement.
"""
import sys, re, csv, collections, datetime as dt
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events

MIN = int(sys.argv[1]) if len(sys.argv) > 1 else 330
OUT = sys.argv[2] if len(sys.argv) > 2 else '/home/mike/plant-cohort.tsv'
ev = Events.load(since_minutes=MIN)
rows = ev.rows
bots = {(r.get('bot') or {}).get('name') for r in rows}
print(f"POSITIVE CONTROL: {len(rows):,} rows / {len(bots)} bots over {MIN} min")

sk = lambda r: ((r.get('raw') or {}).get('skill') or {})
bn = lambda r: (r.get('bot') or {}).get('name')
PAT = re.compile(r'^(found|none) at=(\S+) item=(\S+) sap=(\d+) kinds=(\d+) ordered=([01])')

# per-bot timeline of successful sapling placements
places = collections.defaultdict(list)
for r in rows:
    if sk(r).get('name') != 'place' and r.get('name') != 'place':
        continue
    if 'sapling' not in str(sk(r).get('args') or ''):
        continue
    places[bn(r)].append((r['t'], sk(r).get('status')))
for k in places: places[k].sort()

cohort, ordered_n, unmatched = [], 0, 0
for r in rows:
    if r.get('name') != '_plant_spot':
        continue
    m = PAT.match(sk(r).get('detail') or r.get('detail') or '')
    if not m or m.group(6) != '1':
        continue
    ordered_n += 1
    b, t, at, item = bn(r), r['t'], m.group(2), m.group(3)
    hit = next((st for (pt, st) in places.get(b, [])
                if dt.timedelta(0) <= pt - t <= dt.timedelta(seconds=120)), None)
    if hit != 'success':
        unmatched += 1
        continue
    x, y, z = at.split(',')
    cohort.append((t.isoformat(), b, b.rsplit('-', 1)[0], x, y, z, item))

print(f"ordered=1 rows: {ordered_n}   matched to a successful sapling place: {len(cohort)}"
      f"   unmatched/failed: {unmatched}")
if not cohort:
    sys.exit("EMPTY COHORT -- stop, the matcher is wrong before the world is")
cohort.sort()
print(f"cohort span: {cohort[0][0]} .. {cohort[-1][0]}")
print("by pool:", collections.Counter(c[2] for c in cohort).most_common())
print("by item:", collections.Counter(c[6] for c in cohort).most_common())
ys = sorted(int(c[4]) for c in cohort)
print(f"y of planting: min {ys[0]} median {ys[len(ys)//2]} max {ys[-1]}")
dup = collections.Counter((c[2], c[3], c[4], c[5]) for c in cohort)
print(f"distinct pool+coord: {len(dup)} of {len(cohort)}  (repeats: "
      f"{sum(v-1 for v in dup.values() if v > 1)} -- two bots planting the same cell)")
with open(OUT + '.tmp', 'w', newline='') as f:
    w = csv.writer(f, delimiter='\t')
    w.writerow(['ts', 'bot', 'pool', 'x', 'y', 'z', 'item'])
    w.writerows(cohort)
import os; os.replace(OUT + '.tmp', OUT)
print("wrote", OUT)
