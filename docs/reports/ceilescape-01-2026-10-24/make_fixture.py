#!/usr/bin/env python3
"""ceilescape-01 fixtures from read-only region-file copies (no RCON, no world access).

    python3 make_fixture.py <region.mca> <name> <x> <y> <z> <out.json> [r=5] [down=3] [up=6]

Cells are keyed "dx,dy,dz" relative to the anchor (the bot's FEET cell). Values keep the block state the bot code and the
Paper driver need: water as `water[<level>]` (0 source, 1-7 flowing, 8+ falling), a waterlogged block as `<name>[wl]`, a
ladder as `ladder[facing=<f>]`; everything else by its plain name. Sources used for the two fixtures:
  board-a r.0.0.mca (board-a-Comet, feet 359,40,187; chunk saved 18:45:07Z 10-23)
  placebo-c r.1.0.mca (placebo-c-Bravo, feet 559,35,219)
"""
import json, sys
from anvil_read import Region

src, name, X, Y, Z, out = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:6]), sys.argv[6]
R = int(sys.argv[7]) if len(sys.argv) > 7 else 5
DN = int(sys.argv[8]) if len(sys.argv) > 8 else 3
UP = int(sys.argv[9]) if len(sys.argv) > 9 else 6
reg = Region(src)


def state(b):
    n = b['Name'].replace('minecraft:', '')
    p = b.get('Properties') or {}
    if n == 'water':
        return f"water[{int(p.get('level', 0))}]"
    if n == 'ladder':
        return f"ladder[facing={p.get('facing', 'north')}]"
    if p.get('waterlogged') == 'true':
        return f'{n}[wl]'
    return n


cells = {}
for dx in range(-R, R + 1):
    for dz in range(-R, R + 1):
        for dy in range(-DN, UP + 1):
            cells[f'{dx},{dy},{dz}'] = state(reg.block(X + dx, Y + dy, Z + dz))
json.dump({'name': name, 'anchor': [X, Y, Z], 'source': src.split('/')[-1], 'radius': R, 'down': DN, 'up': UP,
           'note': 'cells relative to the bot FEET cell; read from a region-file copy, read-only', 'cells': cells},
          open(out, 'w'), sort_keys=True)
print(name, len(cells), 'cells ->', out)
