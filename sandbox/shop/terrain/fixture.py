#!/usr/bin/env python3
"""fixture.py <dump.json> <home_x> <home_y> <home_z> <out.cmds.json> -- a SANDBOX TERRAIN FIXTURE for shop-e2e.cjs's terrain
scenes: a fleet world's ground around its home (townplan_blockdump.py over COPIED region files: dump-world.sh, read-only), as RCON
commands that rebuild it in the sandbox arena with the world's home at the arena's (760, 120, 760).

The arena is x, z 704..816; the dump is home +-50 (x, z 710..810 here), y home-16 .. home+32 (104..152 here). The 6-block margin
copies the nearest dump column, so the ground runs on to the arena's edge. What is NOT copied, and why:
  - the town's own furniture (chests, furnaces, tables, composters, lecterns, beds, trapdoors, ladders, torches) -> air: the
    scene's stock is the two scene chests only, and an empty extra container would be a town chest the oracle cannot see;
  - lava -> stone (fire spread would change the fixture during the scene); blocks that need a face or a partner to stand
    (vine, cocoa, glow_lichen, beds) -> air, or water when the dump says waterlogged;
  - every water cell within 7 of the arena's edge -> stone (the arena's outside is the sandbox world's own ground);
  - leaves -> [persistent=true] (they never decay during a scene); the dump keeps no other block state (log axis, stairs).
Water is placed LAST (after every solid) so it meets its own banks; the dump has no fluid level, so a flowing cell becomes a
source. Output: {"world", "home", "dy", "box", "cmds": [...]} -- `fill` runs merged over x then z per layer, bottom-up."""
import base64, json, struct, sys

A0, A1, HX, HY, HZ = 704, 816, 760, 120, 760
FURNITURE = {'chest', 'trapped_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'composter', 'lectern',
             'oak_trapdoor', 'spruce_trapdoor', 'birch_trapdoor', 'ladder', 'torch', 'wall_torch', 'lantern', 'bell', 'cartography_table',
             'fletching_table', 'smithing_table', 'stonecutter', 'loom', 'grindstone', 'anvil', 'brewing_stand', 'cauldron', 'hopper'}
NEEDS_FACE = {'vine', 'cocoa', 'glow_lichen'}


def mapname(n):
    base, _, st = n.partition('[')
    wet = 'waterlogged' in st
    if base.endswith('_bed') or base in FURNITURE:
        return 'air'
    if base in ('lava',):
        return 'stone'
    if base in NEEDS_FACE:
        return 'water' if wet else 'air'
    if base in ('air', 'cave_air', 'void_air', '?'):
        return 'air'
    if base.endswith('_leaves'):
        return base + '[persistent=true' + (',waterlogged=true' if wet else '') + ']'
    if wet:
        return base + '[waterlogged=true]'
    return n


def main():
    dump, hx, hy, hz, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
    d = json.load(open(dump))
    assert not d['missing'], 'a missing chunk in the dump: refusing a fixture with holes'
    x0, z0, x1, z1 = d['box']; y0, y1 = d['y']
    nx, nz, ny = x1 - x0 + 1, z1 - z0 + 1, y1 - y0 + 1
    raw = base64.b64decode(d['cells'])
    cells = list(raw) if d['bits'] == 8 else list(struct.unpack('<%dH' % (len(raw) // 2), raw))
    assert len(cells) == nx * nz * ny
    pal = [mapname(p) for p in d['palette']]
    assert 'air' in pal or True
    dx, dy, dz = HX - hx, HY - hy, HZ - hz

    def at(ax, ay, az):
        # arena coords -> name (the margin copies the nearest dump column)
        wx = min(max(ax - dx, x0), x1); wz = min(max(az - dz, z0), z1); wy = ay - dy
        if wy < y0 or wy > y1:
            return 'air'
        n = pal[cells[((wy - y0) * nz + (wz - z0)) * nx + (wx - x0)]]
        if n.startswith('water') and min(ax - A0, A1 - ax, az - A0, A1 - az) < 7:
            return 'stone'
        return n
    Y0, Y1 = y0 + dy, y1 + dy
    cmds = []
    # the volume to air (2 layers a fill, under the 32768 limit), a stone bed below it
    for y in (Y0 - 4, Y0 - 2):
        cmds.append(f'fill {A0} {y} {A0} {A1} {y + 1} {A1} minecraft:stone')
    for y in range(Y0, Y1 + 1, 2):
        cmds.append(f'fill {A0} {y} {A0} {A1} {min(y + 1, Y1)} {A1} minecraft:air')
    water = []
    for y in range(Y0, Y1 + 1):
        # runs over x per z, then identical runs merged over consecutive z
        rows = {}
        for z in range(A0, A1 + 1):
            x = A0
            while x <= A1:
                n = at(x, y, z)
                e = x
                while e + 1 <= A1 and at(e + 1, y, z) == n:
                    e += 1
                if n != 'air':
                    rows.setdefault((x, e, n), []).append(z)
                x = e + 1
        for (xa, xb, n), zs in sorted(rows.items(), key=lambda kv: kv[1][0]):
            za = zs[0]; prev = zs[0]
            for z in zs[1:] + [None]:
                if z is not None and z == prev + 1:
                    prev = z; continue
                c = f'fill {xa} {y} {za} {xb} {y} {prev} minecraft:{n}'
                (water if n == 'water' else cmds).append(c)
                if z is not None:
                    za = prev = z
    cmds.extend(water)
    json.dump({'world': d.get('world'), 'home': [hx, hy, hz], 'dy': dy, 'box': [A0, Y0, A0, A1, Y1, A1], 'cmds': cmds}, open(out, 'w'))
    feet = [at(HX, HY, HZ), at(HX, HY + 1, HZ), at(HX, HY - 1, HZ)]
    print(out, 'cmds', len(cmds), 'water', len(water), 'y', Y0, Y1, 'home feet/head/under', feet)


if __name__ == '__main__':
    main()
