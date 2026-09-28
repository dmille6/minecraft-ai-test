# make-hollow-stair-fixture.py -- a SYNTHETIC scene for mine's step landing: solid stone around the bot, and under the
# FIRST tread in every bearing a hollow of N blocks (default 1) -- the hollow mine tolerates, that the old exact-cell
# `arrived` read as "cut a step but could not stand in it". With --gravel the first tread in every bearing has gravel
# above it so the cut tread refills (the stood-one-above case). The bot has a stone pickaxe and no blocks.
# Usage: python3 sandbox/make-hollow-stair-fixture.py <out.json> [--origin 300,60,300] [--hollow 1] [--gravel]
import json, sys, argparse, datetime
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--origin', default='300,60,300')
ap.add_argument('--hollow', type=int, default=1); ap.add_argument('--gravel', action='store_true')
a = ap.parse_args(); ox, oy, oz = [int(v) for v in a.origin.split(',')]
R, DY = 6, 12
cells = {}
for dx in range(-R, R + 1):
    for dy in range(-DY, 4):
        for dz in range(-R, R + 1): cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'stone'
for dy in range(0, 3): cells[f"{ox},{oy+dy},{oz}"] = 'air'                        # the bot's 1x3 pocket
# OPEN SKY over the pocket (runs of 10:09-10:17: a stone lid made the pocket "entombed" for the reflex and a "3-block
# climb out" for mine's exit-reserve guard, which refused to descend without 6 scaffold blocks). Give 16 cobblestone too.
for dy in range(3, 9): cells[f"{ox},{oy+dy},{oz}"] = 'air'
# under the first tread in each bearing: tread at (o+bear, oy-1), floor cell at oy-2 .. hollow N deep, then stone
for bx, bz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
    for d in range(a.hollow): cells[f"{ox+bx},{oy-2-d},{oz+bz}"] = 'air'
    if a.gravel:
        cells[f"{ox+bx},{oy+2},{oz+bz}"] = 'gravel'; cells[f"{ox+bx},{oy+3},{oz+bz}"] = 'gravel'   # falls into the cut tread
variant = f"-h{a.hollow}" + ("-gravel" if a.gravel else "")
scene = { 'name': f'synthetic-hollow-stair{variant}', 'arm': 'synthetic', 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'origin': [ox, oy, oz], 'radius': R, 'dy': DY, 'unknown_cells': 0, 'cells': cells, 'gametime': None, 'deployed_sha': 'synthetic',
          'bot': { 'name': 'synthetic-Landing', 'pos': [ox + 0.5, oy, oz + 0.5], 'on_ground': True, 'inventory': { 'stone_pickaxe': 1 } } }
json.dump(scene, open(a.out, 'w'))
print(a.out, len(cells), 'cells; bot at', scene['bot']['pos'], f'hollow {a.hollow} under every first tread', '(gravel above)' if a.gravel else '')
