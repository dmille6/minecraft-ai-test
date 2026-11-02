#!/usr/bin/env python3
"""make_yard.py -> bots/src/blueprints/yard@1.json (stockyard-01, OWNER 11-02 ~13:00Z "a town stockpile at the side of town").

THE YARD: an 18 x 15 paved floor (u along the front, v away from it; the planner turns v < 0 toward home), one block above the
ground (stone: saplings, grass and bamboo cannot root on it), four BAYS of 2 x 11 floor cells (u 2-3, 6-7, 10-11, 14-15; v 2..12)
with 2-wide aisles between and around them (u 0-1, 4-5, 8-9, 12-13, 16-17; v 0-1 the front aisle, v 13-14 the back), eight torches
on the corners and the back aisle. TWO wide, not three: every pile cell is beside an aisle (fake server 11-02: a 3-wide bay's
middle row above the eye had no sight line, through a placed edge or an open one). A bay's floor cells have their own role (bay0..bay2: the same paving) so the record says where the piles go;
the piles themselves are never record cells (a pile that shrinks is never damage). `interior` = the aisle cells at y 1: the
siting proof walks to every one of them from town.
"""
import json, os
U, V = 18, 15
BAYS = [(2, 3), (6, 7), (10, 11), (14, 15)]
BV = (2, 12)
TORCH = [(0, 0), (17, 0), (0, 14), (17, 14), (4, 14), (8, 14), (9, 14), (13, 14)]
cells, interior = [], []
for u in range(U):
    for v in range(V):
        bay = next((i for i, (a, b) in enumerate(BAYS) if a <= u <= b and BV[0] <= v <= BV[1]), None)
        cells.append({'u': u, 'v': v, 'y': 0, 'role': f'bay{bay}' if bay is not None else 'base', 'seg': 'pad'})
        if bay is None and (u, v) not in TORCH:
            interior.append([u, v, 1])
for u, v in TORCH:
    cells.append({'u': u, 'v': v, 'y': 1, 'role': 'light', 'seg': 'lights'})
PAVE = ['cobblestone', 'stone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'stone_bricks', 'smooth_stone', 'deepslate', 'polished_andesite', 'mossy_cobblestone']
bp = {
    'id': 'yard@1', 'kind': 'yard', 'footprint': {'u': U, 'v': V}, 'pad': {'w': U, 'd': V},
    'front': {'u': 8, 'v': 0, 'note': 'stockyard-01: the front aisle (v 0..1) faces home; the paths leg ends here'},
    'interior': interior,
    'bays': [{'id': i, 'u': [a, b], 'v': list(BV)} for i, (a, b) in enumerate(BAYS)],
    'palette': {'base': PAVE, **{f'bay{i}': PAVE for i in range(len(BAYS))}, 'light': ['torch']},
    'segments': [{'seg': 'pad', 'layer': 0, 'deps': []}, {'seg': 'lights', 'layer': 1, 'deps': ['pad']}],
    'structural': ['base', *[f'bay{i}' for i in range(len(BAYS))], 'light'],
    'cells': cells,
    'note': 'stockyard-01 (docs/reports/stockyard-2026-11-02/make_yard.py): the paved floor and its lights; the piles are yard.mjs pileSlots over the bayN cells',
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'bots', 'src', 'blueprints', 'yard@1.json')
json.dump(bp, open(out, 'w'), separators=(',', ':'))
print(out, len(cells), 'cells', len(interior), 'interior')
