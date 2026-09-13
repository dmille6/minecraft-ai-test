# make-ledge-fixture.py -- a SYNTHETIC scene for explore's blind walk: a stone platform at height with a wall on
# three sides and a sheer drop (air down to a stone floor 30 below, or a lava lake) on the fourth (+x).
# The pathfinder cannot plan any leg that leaves the platform, so every leg fails and explore takes its blind
# forward+jump walk in a random heading. The verdict is simply: is the bot still on the platform, alive?
# Usage: python3 sandbox/make-ledge-fixture.py <out.json> [--origin 300,70,300] [--lava]
import json, sys, argparse, datetime
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--origin', default='300,100,300'); ap.add_argument('--lava', action='store_true')
ap.add_argument('--corridor', action='store_true', help='a ONE-wide corridor along x instead of a 7x7 platform: any heading with a +x component walks off the end')
a = ap.parse_args(); ox, oy, oz = [int(v) for v in a.origin.split(',')]
cells = {}
R = 3            # platform half-width: 7x7 stone at oy-1 (or a 1-wide corridor with --corridor)
for dx in range(-R, R + 1):
    for dz in range(-R, R + 1):
        corridor_wall = a.corridor and dz != 0
        cells[f"{ox+dx},{oy-1},{oz+dz}"] = 'stone'
        for dy in range(0, 4): cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'stone' if corridor_wall else 'air'
# walls on -x, +z, -z sides, 4 high; the +x side is open
for dy in range(0, 4):
    for dz in range(-R, R + 1): cells[f"{ox-R-1},{oy+dy},{oz+dz}"] = 'stone'
    for dx in range(-R - 1, R + 1):
        cells[f"{ox+dx},{oy+dy},{oz+R+1}"] = 'stone'; cells[f"{ox+dx},{oy+dy},{oz-R-1}"] = 'stone'
# the drop: +x side, 8 wide, 30 deep, air; the floor is stone (or lava). ENCLOSED: a stone shell around the
# pit (far wall at +x, side walls at +-z, the platform's own face at -x) so no outside water or lava flows in --
# the first cut at y=70 sat over this seed's ocean and the pit filled with water, which the pathfinder treats
# as a safe landing at any height (run 06:43 / 06:47: both bots took the 10-block drop into water on leg 1).
for dx in range(R + 1, R + 10):
    for dz in range(-R - 2, R + 3):
        edge = dx == R + 9 or dz in (-R - 2, R + 2)
        for dy in range(-31, 4):
            cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'stone' if edge else 'air'
        if not edge:
            cells[f"{ox+dx},{oy-31},{oz+dz}"] = 'lava' if a.lava else 'stone'
            if a.lava: cells[f"{ox+dx},{oy-30},{oz+dz}"] = 'lava'
        cells[f"{ox+dx},{oy-32},{oz+dz}"] = 'stone'
# and the platform's own underside/face so the pit is sealed on the -x side too
for dz in range(-R - 2, R + 3):
    for dy in range(-32, 0): cells[f"{ox+R},{oy+dy},{oz+dz}"] = 'stone'
# NO ceiling: a ceiling plus three walls is isEntombed's definition, and the entombment reflex then digs a ramp
# through a wall (run 06:43). Open sky above; the walls are 4 high and the bot carries no blocks, so nothing
# legal leaves the platform except the drop.
for dx in range(-R - 1, R + 9):
    for dz in range(-R - 1, R + 2):
        for dy in range(4, 8): cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'air'
variant = ('-corridor' if a.corridor else '') + ('-lava' if a.lava else '')
scene = { 'name': f'synthetic-ledge{variant}', 'arm': 'synthetic', 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'origin': [ox, oy, oz], 'radius': R + 9, 'dy': 35, 'unknown_cells': 0, 'cells': cells, 'gametime': None, 'deployed_sha': 'synthetic',
          'bot': { 'name': 'synthetic-Ledge', 'pos': [ox + 0.5, oy, oz + 0.5], 'on_ground': True, 'inventory': { 'stone_pickaxe': 1 } } }
json.dump(scene, open(a.out, 'w'))
print(a.out, len(cells), 'cells; bot at', scene['bot']['pos'], 'drop on +x from x =', ox + R + 1, 'to the floor at y =', oy - 31, '(lava)' if a.lava else '')
