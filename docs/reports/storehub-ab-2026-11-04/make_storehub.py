#!/usr/bin/env python3
"""Generator for storehub@1, the sorted hall (storehub piece A, design docs/reports/storehub-design-2026-11-03.md section 3.1;
build notes docs/reports/storehub-ab-2026-11-04.md). Writes bots/src/blueprints/storehub@1.json in the house@1 / hall@1 cell
format (u, v, y, role, seg) and prints the bill.

Shape: the copper hall's (hall@1, make_hall.py r2): walls SET BACK one cell from the pad edge with a step ring at s+1 outside them,
two courses (s+1 stone, s+2 planks with glass bays), eaves and a plank roof at s+3. Pad 19 x 11; walls u 1..17, v 1..9; interior
u 2..16, v 2..8 (15 x 7). A 3-wide doorway in the front wall (v 1, u 8..10) toward home.

THE CHESTS stand against the inner face of the walls, ONE CELL APART (two single chests side by side join into a double chest:
wiki; the gap keeps every chest single and its sign its own), each with an aisle cell in front of it as its stand and a WALL
SIGN on the wall above it (s+2: the wall cell behind the sign is always a plank `wall`, never a glass `window`). 18 chests:
  back row  v 8, u 2 4 6 8 10 12 14 16   (8)
  front row v 2, u 2 4 6 12 14 16        (6; the doorway's stands u 7..11 stay clear)
  sides     u 2 and u 16, v 4 6          (4)
Their sections (the clerk's homes) are storehub.mjs HALL_LAYOUT's, by cell -- not here: the blueprint is geometry only.
Lights: four floor torches in the gaps of the back and front rows."""
import json, collections, os
U, V = 19, 11
W0, W1, Z0, Z1 = 1, 17, 1, 9
DOOR = {8, 9, 10}
CHESTS = [(u, 8) for u in (2, 4, 6, 8, 10, 12, 14, 16)] + [(u, 2) for u in (2, 4, 6, 12, 14, 16)] + [(2, 4), (2, 6), (16, 4), (16, 6)]
LIGHTS = [(5, 8), (13, 8), (5, 2), (13, 2)]
cells = []
def add(u, v, y, role, seg): cells.append({'u': u, 'v': v, 'y': y, 'role': role, 'seg': seg})
def wall_seg(u, v):
    return 'wall-F' if v == Z0 else 'wall-B' if v == Z1 else 'wall-L' if u == W0 else 'wall-R'
def behind(u, v):
    """the wall cell straight behind an interior chest cell (its sign's wall)."""
    if v == Z1 - 1: return (u, Z1)
    if v == Z0 + 1: return (u, Z0)
    if u == W0 + 1: return (W0, v)
    return (W1, v)
signwall = set(behind(u, v) for (u, v) in CHESTS)
wall = [(u, v) for u in range(W0, W1 + 1) for v in range(Z0, Z1 + 1) if u in (W0, W1) or v in (Z0, Z1)]
ring = [(u, v) for u in range(U) for v in range(V) if (u in (0, U - 1) or v in (0, V - 1)) and not (v == 0 and u in DOOR)]
corner = lambda u, v: u in (W0, W1) and v in (Z0, Z1)
for u in range(U):
    for v in range(V):
        add(u, v, 0, 'base', 'pad')
for (u, v) in ring:
    add(u, v, 1, 'step', 'ring')
for (u, v) in wall:
    door = v == Z0 and u in DOOR
    for y in (1, 2):
        if door:
            continue
        if corner(u, v):
            add(u, v, y, 'corner', wall_seg(u, v)); continue
        if y == 1:
            add(u, v, y, 'course', wall_seg(u, v)); continue
        bay = (u, v) not in signwall and (u in (W0, W1) or u % 2 == 1)
        add(u, v, y, 'window' if bay else 'wall', wall_seg(u, v))
    add(u, v, 3, 'eave', 'roof-edge')
for u in range(W0 + 1, W1):
    for v in range(Z0 + 1, Z1):
        add(u, v, 3, 'roof', 'roof-inner')
for (u, v) in LIGHTS:
    add(u, v, 1, 'light', 'fit-out')
for (u, v) in CHESTS:
    add(u, v, 1, 'chest', 'fit-out')
assert len(CHESTS) == 18 and len(set(CHESTS)) == 18
for a in CHESTS:
    for b in CHESTS:
        assert a == b or abs(a[0] - b[0]) + abs(a[1] - b[1]) > 1, ('chests side by side', a, b)
bp = {
    'id': 'storehub@1', 'kind': 'storehub', 'footprint': {'u': U, 'v': V}, 'pad': {'w': U, 'd': V},
    'front': {'u': 9, 'v': 0, 'note': 'storehub: the 3-wide, 2-high doorway (u 8..10, v 1, s+1 and s+2) opens toward v < 0; the planner turns v < 0 toward home. An open doorway (owner Q2)'},
    'doorway': [[u, Z0, y] for u in sorted(DOOR) for y in (1, 2)],
    'interior': [[u, v, y] for u in range(W0 + 1, W1) for v in range(Z0 + 1, Z1) for y in (1, 2)],
    'chests': [[u, v, 1] for (u, v) in CHESTS],
    'palette': {'base': ['cobblestone', 'stone_bricks'], 'step': ['cobblestone', 'stone_bricks'], 'course': ['stone_bricks', 'cobblestone'],
                'corner': ['stone_bricks', 'cobblestone'], 'wall': ['$planks'], 'window': ['glass_pane', '$wall'], 'eave': ['stone_bricks', 'cobblestone'],
                'roof': ['$planks'], 'light': ['torch'], 'chest': ['chest']},
    'segments': [
        {'seg': 'pad', 'layer': 0, 'deps': []},
        {'seg': 'ring', 'layer': 1, 'deps': ['pad']},
        {'seg': 'wall-F', 'layer': 1, 'deps': ['pad']}, {'seg': 'wall-B', 'layer': 1, 'deps': ['pad']},
        {'seg': 'wall-L', 'layer': 1, 'deps': ['pad']}, {'seg': 'wall-R', 'layer': 1, 'deps': ['pad']},
        {'seg': 'roof-edge', 'layer': 2, 'deps': ['ring', 'wall-F', 'wall-B', 'wall-L', 'wall-R']},
        {'seg': 'roof-inner', 'layer': 3, 'deps': ['roof-edge']},
        {'seg': 'fit-out', 'layer': 4, 'deps': ['roof-inner']},
    ],
    'structural': ['base', 'step', 'course', 'corner', 'wall', 'eave', 'roof', 'light'],
    'cells': cells,
    'note': 'storehub-01 piece A (docs/reports/storehub-ab-2026-11-04.md): generated by docs/reports/storehub-ab-2026-11-04/make_storehub.py',
}
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', '..', '..', 'bots', 'src', 'blueprints', 'storehub@1.json')
with open(out, 'w') as f:
    json.dump(bp, f, indent=1)
    f.write('\n')
c = collections.Counter(x['role'] for x in cells)
print('cells', len(cells), dict(c))
pal = {'base': 'cobblestone', 'step': 'cobblestone', 'course': 'stone_bricks', 'corner': 'stone_bricks', 'eave': 'stone_bricks', 'wall': 'planks',
       'roof': 'planks', 'window': 'glass_pane', 'light': 'torch', 'chest': 'chest'}
bill = collections.Counter()
for r, n in c.items(): bill[pal[r]] += n
print('bill', dict(bill))
print('planks incl. chests (8 each) and 18 signs (6 crafts x 6 planks + 1 stick)', bill['planks'] + 8 * bill['chest'] + 6 * 6 + 3)
