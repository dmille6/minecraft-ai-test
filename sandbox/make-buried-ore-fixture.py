# make-buried-ore-fixture.py -- a SYNTHETIC scene: a stone block at depth, a one-wide three-high pocket for the bot,
# and an iron_ore cell D blocks along +x inside the rock at the bot's feet level. Writes the scene JSON.
# Usage: python3 sandbox/make-buried-ore-fixture.py <out.json> [--origin 300,40,300] [--dist 5]
import json, sys, argparse, datetime
ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--origin', default='300,40,300'); ap.add_argument('--dist', type=int, default=5)
ap.add_argument('--ore-dy', type=int, default=0, help='ore row relative to the feet: -1 puts the ore in the FLOOR of the final stance (stance-on-target)')
ap.add_argument('--blocks', type=int, default=8, help='cobblestone in the pocket (0 = the entombment reflex cannot pillar the bot out of its level before the script fires)')
ap.add_argument('--water-behind', action='store_true', help='a water cell directly behind the ore along +x (liquid-behind-target): the pick must refuse it)')
a = ap.parse_args(); ox, oy, oz = [int(v) for v in a.origin.split(',')]
R, DY = 7, 4
cells = {}
for dx in range(-R, R + 1):
    for dy in range(-DY, DY + 1):
        for dz in range(-R, R + 1):
            cells[f"{ox+dx},{oy+dy},{oz+dz}"] = 'stone'
cells[f"{ox},{oy},{oz}"] = 'air'; cells[f"{ox},{oy+1},{oz}"] = 'air'; cells[f"{ox},{oy+2},{oz}"] = 'air'   # the pocket the bot stands in
ore = (ox + a.dist, oy + a.ore_dy, oz)
cells[f"{ore[0]},{ore[1]},{ore[2]}"] = 'iron_ore'                                                # buried ore, +x (feet level unless --ore-dy)
if a.water_behind: cells[f"{ore[0]+1},{ore[1]},{ore[2]}"] = 'water'                            # sealed behind the ore: breaking the ore opens it
variant = ('-floor' if a.ore_dy == -1 else f'-dy{a.ore_dy}' if a.ore_dy else '') + ('-water' if a.water_behind else '')
scene = { 'name': f'synthetic-buried-ore-d{a.dist}{variant}', 'arm': 'synthetic', 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'origin': [ox, oy, oz], 'radius': R, 'dy': DY, 'unknown_cells': 0, 'cells': cells, 'gametime': None, 'deployed_sha': 'synthetic',
          'bot': { 'name': 'synthetic-Ore', 'pos': [ox + 0.5, oy, oz + 0.5], 'on_ground': True, 'inventory': { 'stone_pickaxe': 1, 'cobblestone': a.blocks } } }
json.dump(scene, open(a.out, 'w'))
print(a.out, len(cells), 'cells; bot at', scene['bot']['pos'], 'ore at', ore, 'water behind' if a.water_behind else '')
