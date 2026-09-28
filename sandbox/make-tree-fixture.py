#!/usr/bin/env python3
"""make-tree-fixture.py -- the WOOD corpus: the two refusals that account for 69.3% of log gathers,
plus the three controls that say whether a reading means anything.

    python3 make-tree-fixture.py <kind> out.json [--origin 300,70,300]

Measured 24 h to 2026-09-21 19:00Z: 14,562 of 34,791 gather runs ask for a *_log and 12.4% succeed.
37.3% end `no_safe_target` (liquid on one of five faces) and 32.0% `unreachable` (no candidate has an
exposed face). Those two are the corpus. On the fleet a wood idea costs 10 bots x 3 hours and usually
answers nothing -- the placebo null for that read is sd 3.00 against a canary-arm baseline of 0.64.
Here it costs minutes.

WHAT THIS RIG IS FOR, AND WHAT IT IS NOT FOR. It KILLS candidates. It does not calibrate thresholds:
the sandbox refusal floor was measured ~3x tighter than live (owner-01b WATCHed at 102/bot-h against a
sandbox-derived 30). A candidate that cannot chop a tree HERE will not chop one on the fleet; a
candidate that can has earned a canary slot, not a verdict.

The kinds:

  canopy       THE `unreachable` FAMILY. A trunk sealed inside its own canopy -- leaves on all four
               sides at every trunk level and a leaf cap above. `oak_leaves.boundingBox` is 'block',
               so `isExposed` sees six solid neighbours and gather refuses "every candidate is buried
               -- use mine to dig down" for a log at head height. WORTH_TUNNELLING is ores by design,
               so the gather->mine escalation cannot rescue it either.

  shoreline    THE `no_safe_target` FAMILY. An open tree whose basal log has a pond source block on one
               horizontal face. The canopy is deliberately held clear of the trunk base so the ONLY
               thing refusing is the liquid rule -- one variable, or the fixture proves nothing.
               `veto_faces` on the fleet: 43.1% of refusals are side-water-only, and 0.0% are lava.

  open         POSITIVE CONTROL, and the most important fixture here. An ordinary tree on dry ground.
               Both arms MUST take it. A corpus where every arm scores zero is indistinguishable from
               a rig that cannot chop wood at all, and this project has published that mistake before.

  buried       NEGATIVE CONTROL. A log entombed in stone with no foliage anywhere. That refusal is
               CORRECT and must survive every change. A candidate that takes this one has widened
               something it should not have.

  wetstone     LEAKAGE CONTROL. Underground stone with water beside it and no wood in the world. The
               liquid rule exists for exactly this: dig it and the chamber floods. Any relaxation
               scoped to shoreline trees must leave this refused. If it ever succeeds, the scope
               leaked into mining and the change is dead whatever the tree fixtures said.

Leaves are placed `persistent=true` so they do not decay mid-run. Nothing in a candidate predicate may
therefore depend on `persistent=false` -- naturally generated leaves carry it and these do not, so such
a test would pass here and fail on the fleet.
"""
import argparse, json, datetime

ap = argparse.ArgumentParser()
ap.add_argument('kind', choices=['canopy', 'shoreline', 'open', 'buried', 'wetstone'])
ap.add_argument('out')
ap.add_argument('--origin', default='300,70,300')
a = ap.parse_args()
ox, oy, oz = map(int, a.origin.split(','))
R = 12
cells = {}
def put(x, y, z, kind): cells[f'{x},{y},{z}'] = kind

# --- the ground everything stands on: grass over dirt over stone, open sky above.
for dx in range(-R, R + 1):
    for dz in range(-R, R + 1):
        for dy in range(-12, 12):
            y = oy + dy
            put(ox + dx, y, oz + dz,
                'grass_block' if dy == -1 else 'dirt' if -4 < dy < -1 else 'stone' if dy <= -4 else 'air')

TRUNK_TOP = 4          # logs at oy .. oy+4
bot_pos = [ox + 6.5, oy, oz + 0.5]
inv = {'oak_log': 0}   # starts with no wood on purpose: the run must produce it
ask = 'oak_log'

if a.kind in ('canopy', 'shoreline', 'open'):
    for dy in range(0, TRUNK_TOP + 1):
        put(ox, oy + dy, oz, 'oak_log')

if a.kind == 'canopy':
    # Leaves on all four sides at EVERY trunk level, and a cap above the top log. The basal log then
    # has: grass below, log above, leaves on four sides -- six non-empty neighbours, which is the
    # refusal this fixture exists to reproduce.
    for dy in range(0, TRUNK_TOP + 2):
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if dx == 0 and dz == 0 and dy <= TRUNK_TOP: continue
                put(ox + dx, oy + dy, oz + dz, 'oak_leaves[persistent=true]')

elif a.kind == 'shoreline':
    # A pond whose SURFACE is level with the basal log, touching it on one face. dontCreateFlow tests
    # the five faces of the target, so the source block must be at the log's own y -- a pond one block
    # lower would not refuse and the fixture would silently test nothing.
    for dx in range(1, 7):
        for dz in range(-3, 4):
            put(ox + dx, oy - 1, oz + dz, 'stone')          # a floor, so the pond does not drain
            put(ox + dx, oy, oz + dz, 'water')
            put(ox + dx, oy + 1, oz + dz, 'air')            # open sky over the water
    # The canopy is held THREE blocks clear of the base. The basal log keeps air on its -x face, so it
    # passes isExposed and reaches the liquid rule. One variable.
    for dy in range(TRUNK_TOP - 1, TRUNK_TOP + 2):
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if dx == 0 and dz == 0 and dy <= TRUNK_TOP: continue
                put(ox + dx, oy + dy, oz + dz, 'oak_leaves[persistent=true]')
    # The dry stance the bot is meant to use, stated explicitly rather than hoped for.
    for dy in (0, 1): put(ox - 1, oy + dy, oz, 'air')
    put(ox - 1, oy - 1, oz, 'grass_block')
    bot_pos = [ox - 5.5, oy, oz + 0.5]

elif a.kind == 'open':
    for dy in range(TRUNK_TOP - 1, TRUNK_TOP + 2):
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if dx == 0 and dz == 0 and dy <= TRUNK_TOP: continue
                put(ox + dx, oy + dy, oz + dz, 'oak_leaves[persistent=true]')

elif a.kind == 'buried':
    # No foliage anywhere in the world, so `foliageCovered` cannot fire and the refusal must stand.
    put(ox, oy - 6, oz, 'oak_log')

elif a.kind == 'wetstone':
    # A sealed chamber at depth with a wet wall. No wood exists in this world at all, so a candidate
    # cannot pass by wandering off to a tree: the only thing it can dig is the thing it must not.
    for dx in range(-3, 4):
        for dz in range(-3, 4):
            for dy in (-10, -9):
                put(ox + dx, oy + dy, oz + dz, 'air')
    put(ox + 2, oy - 10, oz, 'water')
    put(ox + 2, oy - 9, oz, 'water')
    put(ox + 1, oy - 10, oz, 'stone')      # the target: stone with a water face
    bot_pos = [ox - 1.5, oy - 10, oz + 0.5]
    inv = {'stone_pickaxe': 1}
    ask = 'stone'

fx = {
    'name': f'synthetic-tree-{a.kind}',
    'arm': 'synthetic',
    'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'origin': [ox, oy, oz], 'radius': R, 'dy': 24, 'unknown_cells': 0,
    'cells': cells, 'gametime': None, 'deployed_sha': 'synthetic',
    'asks': ask,
    'bot': {'name': 'sandbox-Comet', 'pos': bot_pos, 'on_ground': True, 'inventory': inv},
}
json.dump(fx, open(a.out, 'w'))
print(a.out, len(cells), 'cells, asks', ask)
