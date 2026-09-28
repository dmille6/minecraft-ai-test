#!/usr/bin/env python3
"""make-island-fixture.py -- a SURFACE ISLAND: a 3x3 stone platform at y=70 in open sky, ringed by a dry pit
9 deep and 8 wide (deeper than maxDropDown=6, so the travel profile says noPath), with ordinary ground beyond
the pit at y=70. The bot holds 128 cobblestone and no tools: bridging or pillaring down is the only way off.
    python3 make-island-fixture.py out.json [--origin 300,70,300] [--gap 8] [--depth 9]
"""
import argparse, json, datetime
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--origin', default='300,70,300')
ap.add_argument('--gap', type=int, default=8); ap.add_argument('--depth', type=int, default=9)
a = ap.parse_args(); ox, oy, oz = map(int, a.origin.split(',')); R = a.gap + 6; cells = {}
for dx in range(-R, R + 1):
    for dz in range(-R, R + 1):
        d = max(abs(dx), abs(dz))
        for dy in range(-a.depth - 2, 8):
            y = oy + dy; x, z = ox + dx, oz + dz
            if d <= 1: kind = 'stone' if dy <= -1 else 'air'                      # the island: solid down, open above
            elif d <= 1 + a.gap: kind = 'stone' if dy <= -a.depth - 1 else 'air'    # the pit: floor `depth` below
            else: kind = 'stone' if dy <= -1 else 'air'                             # ground beyond
            cells[f'{x},{y},{z}'] = kind
fx = {'name': f'synthetic-island-g{a.gap}-d{a.depth}', 'arm': 'synthetic', 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'origin': [ox, oy, oz], 'radius': R, 'dy': a.depth + 8, 'unknown_cells': 0, 'cells': cells, 'gametime': None, 'deployed_sha': 'synthetic',
      'bot': {'name': 'sandbox-Comet', 'pos': [ox + 0.5, oy, oz + 0.5], 'on_ground': True, 'inventory': {'cobblestone': 128, 'oak_log': 2, 'stick': 1}}}
json.dump(fx, open(a.out, 'w')); print(a.out, len(cells), 'cells')
