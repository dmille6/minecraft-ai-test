#!/usr/bin/env python3
"""ugsafe2_column.py <world> x y z [x y z ...]  -- READ-ONLY look at a fleet world's saved region file around a death
site: the column at (x,z) from y-4 to y+8 and its four neighbours. Reads /srv/block2/<world>/world/region/*.mca with
scripts/lib/anvil.py (no RCON, nothing written). The save can lag the live world by the autosave interval, and a bot's
own digs after the death are in it too: treat it as the terrain, not the instant of death."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anvil

world = sys.argv[1]
pts = list(map(float, sys.argv[2:]))
cache = {}


def block(x, y, z):
    x, y, z = int(x // 1), int(y // 1), int(z // 1)
    cx, cz = x >> 4, z >> 4
    if (cx, cz) not in cache:
        path = f'/srv/block2/{world}/world/region/r.{cx >> 5}.{cz >> 5}.mca'
        try:
            ch = anvil.get_chunk(path, cx, cz)
            cache[(cx, cz)] = anvil.blocks(ch) if ch else None
        except Exception as e:
            cache[(cx, cz)] = None
    b = cache[(cx, cz)]
    if b is None: return '??'
    return b.get((x & 15, y, z & 15), '??').replace('minecraft:', '')


for i in range(0, len(pts), 3):
    x, y, z = pts[i:i + 3]
    fx, fy, fz = int(x // 1), int(y // 1), int(z // 1)
    print(f'== {world} {x},{y},{z}  (feet cell {fx},{fy},{fz})')
    for yy in range(fy + 8, fy - 5, -1):
        row = [block(fx, yy, fz)] + [block(fx + dx, yy, fz + dz) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))]
        mark = '<feet' if yy == fy else ('<head' if yy == fy + 1 else '')
        print(f'  y={yy:4d} C={row[0]:16s} E={row[1]:16s} W={row[2]:16s} S={row[3]:16s} N={row[4]:16s} {mark}')
