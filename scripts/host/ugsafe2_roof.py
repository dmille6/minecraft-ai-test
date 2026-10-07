#!/usr/bin/env python3
"""ugsafe2_roof.py < sites.tsv  -- READ-ONLY classification of the column above each drowning site from the saved
region files (scripts/lib/anvil.py; /srv/block2/<world>/world/region). Input lines: label world x y z.
For the column at the death cell, from the head cell (feet+1) upward: the run of cells until the first air -- e.g.
`water water | AIR` (open: a swim of 2), `stone | AIR` (a roof one block thick), `?? ` (chunk not saved).
Also the cheapest of the four side columns (a sideways dig then up), and whether lava is anywhere within 1 of the
upward path. The save lags the live world (autosave) and includes later digs: it is the terrain, not the instant."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anvil

cache = {}
SOLIDISH = lambda n: n not in ('air', 'cave_air', 'water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass',
                               'tall_seagrass', '??') and not n.endswith(('_sapling', 'torch', 'short_grass', 'fern'))


def block(world, x, y, z):
    cx, cz = x >> 4, z >> 4
    key = (world, cx, cz)
    if key not in cache:
        try:
            ch = anvil.get_chunk(f'/srv/block2/{world}/world/region/r.{cx >> 5}.{cz >> 5}.mca', cx, cz)
            cache[key] = anvil.blocks(ch) if ch else None
        except Exception:
            cache[key] = None
    b = cache[key]
    return '??' if b is None else b.get((x & 15, y, z & 15), '??').replace('minecraft:', '')


def column(world, x, y0, z, cap=12):
    seq = []
    for y in range(y0, y0 + cap):
        n = block(world, x, y, z)
        if n in ('air', 'cave_air'):
            return seq, y
        seq.append(n)
        if n == '??':
            return seq, None
    return seq, None


for line in sys.stdin:
    p = line.split()
    if len(p) < 5: continue
    label, world = p[0], p[1]
    x, y, z = (int(float(v) // 1) for v in p[2:5])
    seq, airy = column(world, x, y + 1, z)
    solid = sum(1 for n in seq if SOLIDISH(n))
    liquid = sum(1 for n in seq if n in ('water', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column'))
    if airy is None: cls = 'no air within 12' if '??' not in seq else 'unsaved chunk'
    elif solid == 0: cls = f'OPEN swim {len(seq)}'
    else: cls = f'ROOF {solid} solid + {liquid} water'
    floor = None
    for dy in range(0, 8):
        if SOLIDISH(block(world, x, y - 1 - dy, z)): floor = dy; break
    # ROOFBREACH ELIGIBILITY (Codex 10-07): after the water directly over the head, ONLY solid, non-falling cells (<= 2)
    # and then air. A roof with water ABOVE a solid cell, or sand/gravel in it, is not eligible; open water is not a
    # breach (nothing to dig).
    rest = list(seq)
    while rest and rest[0] in ('water', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column'):
        rest.pop(0)
    falling = any(n in ('sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel') or n.endswith('concrete_powder') for n in rest)
    elig = airy is not None and 1 <= len(rest) <= 2 and all(SOLIDISH(n) for n in rest) and not falling
    cls = cls + ('\tELIGIBLE%d' % len(rest) if elig else '\tnot_eligible')
    # AIR POCKET (sandbox2 10-07: a dug cell directly above the head stays AIR -- water does not flow upward -- so the bot
    # breathes after ONE dig whatever the roof's thickness, provided the dug cell's four sides and the cell above it hold
    # no liquid and nothing that falls). ICE is different: broken over water it becomes water, so it only helps when air
    # is directly above the ice (break, then swim one cell).
    LIQ = ('water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass')
    nlead = len(seq) - len(rest)
    pocket = 'no_pocket'
    if rest and seq and seq[0] in LIQ:
        fy = y + 1 + nlead
        first = rest[0]
        fall = lambda n: n in ('sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel') or n.endswith('concrete_powder')
        if first == 'ice':   # packed/blue ice do NOT turn to water when broken: they fall through to the POCKET rule
            pocket = 'ICE_OPEN' if block(world, x, fy + 1, z) in ('air', 'cave_air') else 'ice_closed'
        elif SOLIDISH(first) and not fall(first):
            sides = [block(world, x + dx, fy, z + dz) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            top = block(world, x, fy + 1, z)
            if '??' in sides or top == '??': pocket = 'unknown'
            elif any(s in LIQ for s in sides) or top in LIQ or fall(top): pocket = 'pocket_leaks'
            else: pocket = 'POCKET:' + first
        else:
            pocket = 'first_not_diggable:' + first
    elif seq and seq[0] not in LIQ:
        pocket = 'head_cell_solid:' + seq[0]
    cls = cls + '\t' + pocket
    lava = any(block(world, x + dx, yy, z + dz) in ('lava',) for yy in range(y, y + 4 + len(seq)) for dx, dz in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)))
    print(f'{label}\t{world}\t{x},{y},{z}\t{cls}\tabove_head={"|".join(seq) or "-"}\tair_at={airy}\tfloor_below={floor}\tlava_near_path={lava}')
