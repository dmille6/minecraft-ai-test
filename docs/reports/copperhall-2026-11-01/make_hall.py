#!/usr/bin/env python3
"""DRAFT generator for hall@1 (copper hall, design 2026-11-01, r2). Writes hall@1.draft.json in the house@1/workshop@1 cell format
(u, v, y, role, seg) and prints the bill. Not loaded by any bot: buildsite.mjs loadBlueprint reads bots/src/blueprints/ only.

r2 geometry (Claude review r1 blocker 1): house@1's shape scaled up -- walls SET BACK one cell from the pad edge with a step ring at
s+1 outside them, walls two courses (s+1, s+2), roof at s+3. A builder on the step (feet s+2, eye s+3.62) sees the wall tops' face at
s+3, which is what buildsite.mjs stepFor needs for the eaves; roof-inner cells are placed from inside off their neighbours, as in the
house. No cell above s+3 (the lightning-rod crown of r1 had no stand and is dropped)."""
import json, collections
U, V = 15, 13                      # pad; walls on u 1..13, v 1..11 (13 x 11); interior u 2..12, v 2..10 (11 x 9)
W0, W1, Z0, Z1 = 1, 13, 1, 11
DOOR = {6, 7, 8}                   # doorway in the front wall (v 1), y 1..2 open; the y 3 cells above it = the copper lintel
PIL = {(1, 1), (5, 1), (9, 1), (13, 1), (1, 11), (5, 11), (9, 11), (13, 11), (1, 6), (13, 6)}
cells = []
def add(u, v, y, role, seg): cells.append({'u': u, 'v': v, 'y': y, 'role': role, 'seg': seg})
def wall_seg(u, v):
    return 'wall-F' if v == Z0 else 'wall-B' if v == Z1 else 'wall-L' if u == W0 else 'wall-R'
wall = [(u, v) for u in range(W0, W1 + 1) for v in range(Z0, Z1 + 1) if u in (W0, W1) or v in (Z0, Z1)]
ring = [(u, v) for u in range(U) for v in range(V) if (u in (0, U - 1) or v in (0, V - 1)) and not (v == 0 and u in DOOR)]
for u in range(U):
    for v in range(V):
        add(u, v, 0, 'base', 'pad')
for (u, v) in ring:
    add(u, v, 1, 'step', 'ring')                             # the builders' step outside the walls (house@1's ring)
for (u, v) in wall:
    door = v == Z0 and u in DOOR
    for y in (1, 2):
        if door:
            continue                                         # doorway 3 wide, 2 high
        if (u, v) in PIL:
            add(u, v, y, 'copper', 'copper-trim'); continue  # pilasters, both courses
        if y == 1:
            add(u, v, y, 'course', wall_seg(u, v)); continue # stone-brick base course
        bay = (v in (Z0, Z1) and u not in (W0, W1) and (u, v) not in PIL) or (u in (W0, W1) and v not in (Z0, Z1) and (u, v) not in PIL)
        add(u, v, y, 'window' if bay and (u + v) % 2 == 0 else 'wall', wall_seg(u, v))
    if door:
        add(u, v, 3, 'copper', 'copper-lintel')              # placed off the roof-inner cell behind it, after roof-inner
    elif (u, v) in PIL:
        add(u, v, 3, 'copper', 'copper-trim')                # pilaster caps
    else:
        add(u, v, 3, 'eave', 'roof-edge')
for u in range(W0 + 1, W1):
    for v in range(Z0 + 1, Z1):
        add(u, v, 3, 'roof', 'roof-inner')
for (u, v) in ((2, 2), (12, 2), (2, 10), (12, 10)):
    add(u, v, 1, 'light', 'fit-out')                         # floor torches in the four interior corners (off the map floor)
for (u, v) in ((2, 4), (2, 8), (12, 4), (12, 8)):
    add(u, v, 1, 'chest', 'fit-out')                         # the expedition depot: two chests on each side wall
bp = {
    'id': 'hall@1', 'kind': 'hall', 'footprint': {'u': U, 'v': V}, 'pad': {'w': U, 'd': V},
    'front': {'u': 7, 'v': 0, 'note': 'copperhall: the 3-wide, 2-high doorway (u 6..8, v 1, s+1 and s+2) opens toward v < 0; the planner turns v < 0 toward home. An open doorway (owner Q2)'},
    'doorway': [[u, Z0, y] for u in sorted(DOOR) for y in (1, 2)],
    'interior': [[u, v, y] for u in range(W0 + 1, W1) for v in range(Z0 + 1, Z1) for y in (1, 2)],
    'mapfloor': {'u': [3, 11], 'v': [2, 10], 'y': 0, 'note': 'v2: the 9 x 9 coverage map (pad cells), design 7.2'},
    'palette': {'base': ['stone_bricks'], 'step': ['stone_bricks'], 'course': ['stone_bricks'], 'wall': ['$planks'],
                'window': ['glass_pane', '$wall'], 'eave': ['stone_bricks'], 'copper': ['cut_copper'], 'roof': ['$planks'],
                'light': ['torch'], 'chest': ['chest']},
    'segments': [
        {'seg': 'pad', 'layer': 0, 'deps': []},
        {'seg': 'ring', 'layer': 1, 'deps': ['pad']},
        {'seg': 'wall-F', 'layer': 1, 'deps': ['pad']}, {'seg': 'wall-B', 'layer': 1, 'deps': ['pad']},
        {'seg': 'wall-L', 'layer': 1, 'deps': ['pad']}, {'seg': 'wall-R', 'layer': 1, 'deps': ['pad']},
        {'seg': 'copper-trim', 'layer': 1, 'deps': ['pad', 'ring'], 'note': 'NO fallback material'},
        {'seg': 'roof-edge', 'layer': 2, 'deps': ['ring', 'wall-F', 'wall-B', 'wall-L', 'wall-R']},
        {'seg': 'roof-inner', 'layer': 3, 'deps': ['roof-edge']},
        {'seg': 'copper-lintel', 'layer': 4, 'deps': ['roof-inner', 'copper-trim'], 'note': 'NO fallback material'},
        {'seg': 'fit-out', 'layer': 5, 'deps': ['roof-inner']},
    ],
    'structural': ['base', 'step', 'course', 'wall', 'eave', 'copper', 'roof', 'light'],
    'cells': cells,
}
json.dump(bp, open('hall@1.draft.json', 'w'), indent=1)
c = collections.Counter(x['role'] for x in cells)
seg = collections.Counter(x['seg'] for x in cells)
print('cells', len(cells), dict(c)); print('segments', dict(seg))
pal = {'base': 'stone_bricks', 'step': 'stone_bricks', 'course': 'stone_bricks', 'eave': 'stone_bricks', 'wall': 'planks', 'roof': 'planks',
       'window': 'glass_pane', 'copper': 'cut_copper', 'light': 'torch', 'chest': 'chest'}
bill = collections.Counter()
for r, n in c.items(): bill[pal[r]] += n
print('bill', dict(bill))
print('copper ingots', bill['cut_copper'] * 9, '(cut_copper 9 each: 36 ingots -> 4 copper_block -> 4 cut_copper)')
