#!/usr/bin/env python3
"""ugsafe2_admit.py <an.pkl> <roof.tsv>  (roof.tsv = ugsafe2_roof.py output with the air-pocket column)
  -- how many drowning sites would `roofbreach` ADMIT, by its own rules:
  - the head cell (feet+1) is water in the save (a bot whose head cell is solid is not 'head and feet in water');
  - after that water, 1-2 solid, non-falling cells, then air (ugsafe2_roof.py's ELIGIBLE1/2);
  - the health budget: sum of vanilla dig times for the cells with the best pickaxe the bot carried at death
    (iron if it carried a usable iron pickaxe, else stone/wood by its best uses; ice also bare-handed), x5 under water,
    x5 more when floating (no solid floor directly under the feet in the save), x1.5, + 3 s to rise, must fit in
    health_at_dispatch / max(slope, 0.5 HP/s) with health_at_dispatch = 18.7 (phase 1 / sandbox: ~19 at the first
    no-air ceiling) and slope 0.31 (sandbox, peaceful) -> 37.4 s.
Vanilla dig time: ticks = ceil(1 / (speed / hardness / 30)) when the tool is effective, else speed 1; seconds = ticks/20.
Sandbox check (sandbox2, 10-07): stone with a stone pickaxe on the floor 2.88 s measured vs 3.0 s here; floating
14.1 s vs 15.0 s here (this is slightly CONSERVATIVE)."""
import sys, math, csv
sys.argv, ARGS = sys.argv[:2], sys.argv[2:]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R
from collections import Counter

HARD = {'stone': 1.5, 'andesite': 1.5, 'diorite': 1.5, 'granite': 1.5, 'tuff': 1.5, 'cobblestone': 2.0, 'deepslate': 3.0,
        'cobbled_deepslate': 3.5, 'dirt': 0.5, 'grass_block': 0.6, 'coarse_dirt': 0.5, 'clay': 0.6, 'ice': 0.5,
        'packed_ice': 0.5, 'sandstone': 0.8, 'oak_planks': 2.0, 'oak_log': 2.0, 'spruce_log': 2.0, 'birch_log': 2.0,
        'snow_block': 0.2, 'stone_bricks': 1.5, 'mud': 0.5, 'calcite': 0.75, 'dripstone_block': 1.5}
PICK_EFFECTIVE = lambda n: n in ('stone', 'andesite', 'diorite', 'granite', 'tuff', 'cobblestone', 'deepslate', 'cobbled_deepslate',
                                 'ice', 'packed_ice', 'sandstone', 'stone_bricks', 'calcite', 'dripstone_block')
SPEED = {'iron': 6.0, 'stone': 4.0, 'wood': 2.0, 'hand': 1.0}
BUDGET = (18.7 - 4.0) / 0.5   # health at dispatch minus a 4 HP reserve, over the peaceful envelope 0.5 HP/s (sandbox steady 0.31-0.32)


def dig_s(name, tool, floating):
    h = HARD.get(name)
    if h is None: return None
    sp = SPEED[tool] if PICK_EFFECTIVE(name) else 1.0
    if not PICK_EFFECTIVE(name) and name not in ('dirt', 'grass_block', 'coarse_dirt', 'clay', 'ice', 'snow_block', 'mud',
                                                  'oak_planks', 'oak_log', 'spruce_log', 'birch_log'):
        return None
    ticks = math.ceil(1 / (sp / h / 30))
    return ticks / 20 * 5 * (5 if floating else 1)


deaths = {f"{w}:{d['bot']}:{int(d['t'])}": d for w in R.WIN for d in R.dwin(w) if d['cause'] == 'drowning'}
# Input: ugsafe2_roof.py output; column 6 is the AIR-POCKET class (POCKET:<material> | ICE_OPEN | pocket_leaks | ...).
# ONE dig: the first solid cell above the head's water (POCKET: the dug cell stays air), or the ice with air above it
# (ICE_OPEN: break, then rise one cell).
c = Counter(); per_w = Counter(); why = Counter()
for row in csv.reader(open(ARGS[0]), delimiter='\t'):
    label, pocket = row[0], row[5]
    w = label.split(':')[0]
    per_w[(w, 'all')] += 1
    if not (pocket.startswith('POCKET') or pocket == 'ICE_OPEN'):
        why[pocket.split(':')[0]] += 1; continue
    first = pocket.split(':')[1] if pocket.startswith('POCKET') else 'ice'
    floor = [f for f in row if f.startswith('floor_below=')][0].replace('floor_below=', '')
    d = deaths.get(label)
    bag = d['bag'] if d else {'iron_pick': 0, 'pick': -1}
    tool = 'iron' if bag['iron_pick'] > 0 else ('stone' if bag['pick'] > 0 else 'hand')
    floating = floor != '0'
    s = dig_s(first, tool, floating)
    if s is None and first == 'ice': s = dig_s(first, 'hand', floating)
    if s is None:
        why['material not diggable: ' + first] += 1; continue
    need = s * 1.5 + 3
    if need > BUDGET:
        why[f'over budget ({first}, {tool}, {"floating" if floating else "on floor"}, {need:.0f} s)'] += 1; continue
    per_w[(w, 'admitted')] += 1
    per_w[(w, 'admitted_' + ('ice' if first == 'ice' else 'pocket'))] += 1
    c[(first, tool, 'floating' if floating else 'floor')] += 1
print(f'budget {BUDGET:.1f} s ((18.7 - 4 HP reserve) / 0.5 HP/s peaceful envelope); requirement = one dig x1.5 + 3 s')
for w in R.WIN:
    print(f"{w}: admitted {per_w[(w, 'admitted')]} of {per_w[(w, 'all')]} drownings (air pocket {per_w[(w, 'admitted_pocket')]}, ice {per_w[(w, 'admitted_ice')]})")
print('admitted by (material, tool, floor):')
for k, v in c.most_common(): print('  ', v, k)
print('not admitted:')
for k, v in why.most_common(): print('  ', v, k)
