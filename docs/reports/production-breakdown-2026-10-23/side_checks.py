"""Side checks from the compact rows (no ES): (1) tools the toolkit skill crafts per day (crafting that
moved out of the `craft` skill); (2) water-float hold hours per world per day (where the float
time went); (3) craft refusals that never became a craft row (_redundant_craft).
"""
import os, sys, gzip, json, glob, re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402

HELD = re.compile(r'held ([0-9.]+)s')
print('day         toolkit ok  tools+ (from toolkit inventory_delta)           | redundant-craft refusals | float h: top worlds')
for path in sorted(glob.glob(os.path.join(HERE, 'out', 'rows', '*.jsonl.gz'))):
    day = os.path.basename(path)[:10]
    tk_ok = 0
    tools = Counter()
    red = 0
    fl = defaultdict(float)
    with gzip.open(path, 'rt') as f:
        for l in f:
            r = json.loads(l)
            k = r['k']
            if k == 'toolkit':
                if r['s'] == 'success':
                    tk_ok += 1
                for it, v in (r['inv'] or {}).items():
                    if v > 0 and re.search(r'_(pickaxe|axe|shovel|sword|hoe)$', it):
                        tools[it] += v
            elif k == '_redundant_craft':
                red += 1
            elif k == '_water_float_ended':
                m = HELD.search(r['d'] or '')
                if m:
                    fl[world(r['p'])] += float(m.group(1)) / 3600
    top = sorted(fl.items(), key=lambda x: -x[1])[:4]
    print(f'{day}  {tk_ok:6d}   {dict(tools)!s} | {red:6d} | total {sum(fl.values()):5.1f}: ' +
          ', '.join(f'{w} {h:.1f}' for w, h in top))
