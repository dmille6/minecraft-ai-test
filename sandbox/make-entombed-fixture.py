# make-entombed-fixture.py -- a SYNTHETIC entombment for the movement owner's corpus: the bot stands in a 1x1 pocket
# two cells high, sealed by stone on every side and a 3-thick stone cap overhead, with open sky above that. isEntombed
# is true by construction (ceiling solid, four head walls, higher terrain within 4). With a pickaxe the pillar rung
# hands off to digStraightUp and the bot digs up three blocks; bare-handed the pillar refuses (needs_pickaxe) and the
# stair ramp has to cut stone by hand. Usage: python3 sandbox/make-entombed-fixture.py <out.json> [--origin x,y,z] [--no-pick]
import json, sys, argparse, datetime
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--origin', default='300,60,300'); ap.add_argument('--no-pick', action='store_true')
a = ap.parse_args(); ox, oy, oz = [int(v) for v in a.origin.split(',')]
cells = {}
R = 4
for dx in range(-R, R + 1):
    for dz in range(-R, R + 1):
        for dy in range(-2, 5): cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'stone'   # solid block from 2 below the feet to 4 above (the cap is oy+2..oy+4)
        for dy in range(5, 10): cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'air'    # open sky above the cap
cells[f"{ox},{oy},{oz}"] = 'air'; cells[f"{ox},{oy+1},{oz}"] = 'air'        # the pocket: feet and head
inv = {'dirt': 12} if a.no_pick else {'wooden_pickaxe': 1, 'dirt': 12}
scene = { 'name': f"synthetic-entombed{'-nopick' if a.no_pick else ''}", 'arm': 'synthetic', 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'origin': [ox, oy, oz], 'radius': R, 'dy': 10, 'unknown_cells': 0, 'cells': cells, 'gametime': None, 'deployed_sha': 'synthetic',
          'bot': { 'name': 'synthetic-Tomb', 'pos': [ox + 0.5, oy, oz + 0.5], 'on_ground': True, 'inventory': inv } }
json.dump(scene, open(a.out, 'w'))
print(a.out, len(cells), 'cells; bot sealed at', scene['bot']['pos'], 'cap', oy + 2, '..', oy + 4, 'sky from', oy + 5, 'inventory', inv)
