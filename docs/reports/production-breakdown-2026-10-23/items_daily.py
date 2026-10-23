"""Value-side check: items gained per day by the gathering skills (gather, mine, explore: positive
inventory_delta), for the items that matter, fleet-wide. No ES access (compact rows).
A skill's inventory_delta is the bag before vs after the skill, so pickups during it count."""
import os, sys, gzip, json, glob
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ITEMS = ['raw_iron', 'coal', 'raw_copper', 'lapis_lazuli', 'diamond', 'redstone', 'raw_gold', 'cobblestone',
         'cobbled_deepslate', 'oak_log', 'birch_log', 'spruce_log', 'dirt', 'sand']
print('day        ' + ' '.join(f'{i[:10]:>10s}' for i in ITEMS) + '   raw_iron by skill (gather/mine/explore)')
for path in sorted(glob.glob(os.path.join(HERE, 'out', 'rows', '*.jsonl.gz'))):
    day = os.path.basename(path)[:10]
    c = Counter()
    ri = Counter()
    with gzip.open(path, 'rt') as f:
        for l in f:
            r = json.loads(l)
            if r['k'] in ('gather', 'mine', 'explore'):
                for it, v in (r['inv'] or {}).items():
                    if v > 0:
                        c[it] += v
                        if it == 'raw_iron':
                            ri[r['k']] += v
    print(day + ' ' + ' '.join(f'{c[i]:10d}' for i in ITEMS) + f'   {ri["gather"]}/{ri["mine"]}/{ri["explore"]}')
