#!/usr/bin/env python3
"""Generator for enchantshop@1, the enchanting + anvil workshop (enchantshop-01, docs/reports/enchantshop-design-2026-11-04.md on
main). Writes bots/src/blueprints/enchantshop@1.json in the hall@1 / storehub@1 cell format (u, v, y, role, seg) and prints the bill.

Shape: the storage hall's (storehub@1, make_storehub.py): walls SET BACK one cell from the pad edge with a step ring at s+1 outside
them, two courses (s+1 stone bricks, s+2 planks with glass bays), stone-brick eaves and a plank roof at s+3. Pad 17 x 11: with its
1-cell stand ring it is the wall extension's hall-size plot X1 (19 x 13) exactly (offline 11-04: a 19 x 13 pad's ring met the hall's
reservation and an expedition marker); walls u 1..15, v 1..9; interior u 2..14, v 2..8 (13 x 7); a 3-wide doorway (v 1, u 7..9) toward home.

THE SHELL (record cells, built by the ordinary build visit from what the town has): pad, ring, walls, roof, four floor torches, the
BOOK CHEST (u 11, v 8) and the CRAFTING TABLE (u 13, v 8) the fitter crafts at.

THE FIT-OUT (NOT record cells: the record's `fit` list, placed one at a time by the fitter's upkeep as each item's inputs arrive):
  anvil             u 14, v 5, s+1 (against the right wall; its stand u 13, v 5)
  enchanting_table  u 5, v 5, s+1
  bookshelf x 15    the 5 x 5 ring round the table (u 3..7, v 3..7) at the table's level, LESS its front middle (u 5, v 3): the
                    way in. Vanilla rule (minecraft.wiki Enchanting_Table / enchanting mechanics): a shelf at a horizontal offset
                    with max(|dx|, |dz|) = 2 from the table, at the table's level or one above, counts when the block between them
                    (offset / 2, toward zero) is air or replaceable -- a torch blocks it. 15 shelves = level 30.
THE GAP (`gap`): the 3 x 3 round the table (less the table) at s+1 and s+2 is kept AIR: no light, sign or cell is ever placed there.
SIGNS (`signs`, written by the label writer as the storage hall's): ENCHANTING on the left wall beside the ring, ANVIL above the
anvil, BOOKS above the book chest."""
import json, collections, os
U, V = 17, 11
W0, W1, Z0, Z1 = 1, 15, 1, 9
DOOR = {7, 8, 9}
TABLE = (5, 5)
RING = [(u, v) for u in range(3, 8) for v in range(3, 8) if (u in (3, 7) or v in (3, 7))]
ENTRY = (5, 3)
SHELVES = [c for c in RING if c != ENTRY]
GAP = [(u, v) for u in range(4, 7) for v in range(4, 7) if (u, v) != TABLE]
ANVIL = (14, 5)
CHEST = (11, 8)
CRAFT = (13, 8)
LIGHTS = [(2, 2), (14, 2), (2, 8), (9, 8)]
SIGNS = [
    {'at': (2, 5), 'wall': (1, 5), 'stand': (2, 3), 'lines': ['ENCHANTING', '15 shelves', 'level 30']},
    {'at': (14, 5), 'wall': (15, 5), 'stand': (13, 4), 'lines': ['ANVIL']},
    {'at': (11, 8), 'wall': (11, 9), 'stand': (11, 7), 'lines': ['BOOKS']},
]
assert len(SHELVES) == 15
for (u, v) in SHELVES:
    du, dv = u - TABLE[0], v - TABLE[1]
    assert max(abs(du), abs(dv)) == 2
    mid = (TABLE[0] + int(du / 2), TABLE[1] + int(dv / 2))
    assert mid in GAP, ('shelf without an air gap', (u, v), mid)
for c in LIGHTS + [s['at'] for s in SIGNS] + [s['stand'] for s in SIGNS] + [ANVIL, CHEST, CRAFT]:
    assert c not in GAP and c not in RING and c != TABLE, c
cells = []
def add(u, v, y, role, seg): cells.append({'u': u, 'v': v, 'y': y, 'role': role, 'seg': seg})
def wall_seg(u, v):
    return 'wall-F' if v == Z0 else 'wall-B' if v == Z1 else 'wall-L' if u == W0 else 'wall-R'
signwall = set(s['wall'] for s in SIGNS)
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
        bay = (u, v) not in signwall and (u in (W0, W1) and v % 2 == 1 or v in (Z0, Z1) and u % 2 == 1)
        add(u, v, y, 'window' if bay else 'wall', wall_seg(u, v))
    add(u, v, 3, 'eave', 'roof-edge')
for u in range(W0 + 1, W1):
    for v in range(Z0 + 1, Z1):
        add(u, v, 3, 'roof', 'roof-inner')
for (u, v) in LIGHTS:
    add(u, v, 1, 'light', 'fit-out')
add(CHEST[0], CHEST[1], 1, 'chest', 'fit-out')
add(CRAFT[0], CRAFT[1], 1, 'table', 'fit-out')
fit = [{'slot': 'anvil', 'item': 'anvil', 'u': ANVIL[0], 'v': ANVIL[1], 'y': 1, 'stand': [ANVIL[0] - 1, ANVIL[1], 1]},
       {'slot': 'table', 'item': 'enchanting_table', 'u': TABLE[0], 'v': TABLE[1], 'y': 1, 'stand': [ENTRY[0], ENTRY[1], 1]}]
# the shelves in the order they are placed: the back row first, then the sides front to back (the way in stays open to the last)
order = sorted(SHELVES, key=lambda c: (0 if c[1] == 7 else 1, -c[1], c[0]))
for i, (u, v) in enumerate(order):
    fit.append({'slot': f'shelf-{i + 1:02d}', 'item': 'bookshelf', 'u': u, 'v': v, 'y': 1, 'stand': None})
bp = {
    'id': 'enchantshop@1', 'kind': 'enchantshop', 'footprint': {'u': U, 'v': V}, 'pad': {'w': U, 'd': V},
    'front': {'u': 8, 'v': 0, 'note': 'enchantshop: the 3-wide, 2-high doorway (u 7..9, v 1, s+1 and s+2) opens toward v < 0; the planner turns v < 0 toward home. An open doorway (owner Q2, as the halls)'},
    'doorway': [[u, Z0, y] for u in sorted(DOOR) for y in (1, 2)],
    'interior': [[u, v, y] for u in range(W0 + 1, W1) for v in range(Z0 + 1, Z1) for y in (1, 2)],
    'fit': fit,
    'gap': [[u, v, y] for (u, v) in GAP for y in (1, 2)],
    'entry': [ENTRY[0], ENTRY[1], 1],
    'signs': [{'at': [s['at'][0], s['at'][1], 2], 'wall': [s['wall'][0], s['wall'][1], 2], 'stand': [s['stand'][0], s['stand'][1], 1], 'lines': s['lines']} for s in SIGNS],
    'palette': {'base': ['cobblestone', 'stone_bricks'], 'step': ['cobblestone', 'stone_bricks'], 'course': ['stone_bricks', 'cobblestone'],
                'corner': ['stone_bricks', 'cobblestone'], 'wall': ['$planks'], 'window': ['glass_pane', '$wall'], 'eave': ['stone_bricks', 'cobblestone'],
                'roof': ['$planks'], 'light': ['torch'], 'chest': ['chest'], 'table': ['crafting_table']},
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
    'note': 'enchantshop-01 (docs/reports/enchantshop-design-2026-11-04.md): generated by docs/reports/enchantshop-2026-11-04/make_enchantshop.py; the fit-out (anvil, table, 15 shelves) is the record `fit`, never cells',
}
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', '..', '..', 'bots', 'src', 'blueprints', 'enchantshop@1.json')
with open(out, 'w') as f:
    json.dump(bp, f, indent=1)
    f.write('\n')
c = collections.Counter(x['role'] for x in cells)
print('cells', len(cells), dict(c))
pal = {'base': 'cobblestone', 'step': 'cobblestone', 'course': 'stone_bricks', 'corner': 'stone_bricks', 'eave': 'stone_bricks', 'wall': 'planks',
       'roof': 'planks', 'window': 'glass_pane', 'light': 'torch', 'chest': 'chest', 'table': 'crafting_table'}
bill = collections.Counter()
for r, n in c.items(): bill[pal[r]] += n
print('bill', dict(bill))
print('planks incl. chest (8), table (4), 3 signs (1 craft: 6 planks + 1 stick)', bill['planks'] + 8 + 4 + 6)
print('fit', collections.Counter(x['item'] for x in fit))
