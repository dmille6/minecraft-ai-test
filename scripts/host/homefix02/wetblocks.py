#!/usr/bin/env python3
"""Read-only: classify each logged position against the saved world (region files).
stdin: JSON lines with pool,pos{x,y,z},id. stdout: same + flags.
  feet      block at the feet cell; below: the block stood on; head: feet+1
  wet_feet  feet or head cell is water / waterlogged / bubble column
  on_ice    the block stood on is ice/packed/blue ice
  ice_over_water   standing on ice with water directly below the ice (a frozen sheet)
  water_r2  any water (or ice) within Chebyshev 2 horizontally, dy -2..+1
  sky       no solid block in the 12 cells above the head
"""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anvil
ROOT = sys.argv[1] if len(sys.argv) > 1 else '/srv/block2'
WETS = ('water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass')
ICES = ('ice', 'packed_ice', 'blue_ice', 'frosted_ice')
def wet(b): return bool(b) and (b.split('[')[0] in WETS or b.endswith('[wl]'))
def solid(b): return bool(b) and b.split('[')[0] not in ('air', 'cave_air', 'void_air', 'air?') and not wet(b) and b.split('[')[0] not in ('snow', 'short_grass', 'tall_grass', 'fern', 'torch')
for line in sys.stdin:
    r = json.loads(line)
    p = r.get('pos') or {}
    if 'x' not in p or p.get('y') is None:
        continue
    rdir = os.path.join(ROOT, r['pool'], 'world', 'region')
    x, y, z = int(p['x'] // 1), int(p['y'] // 1), int(p['z'] // 1)
    try:
        B = lambda dx, dy, dz: anvil.block(rdir, x + dx, y + dy, z + dz)
        feet, head, below, below2 = B(0, 0, 0), B(0, 1, 0), B(0, -1, 0), B(0, -2, 0)
        on_ice = (below or '').split('[')[0] in ICES
        wr2 = any(wet(B(dx, dy, dz)) or (B(dx, dy, dz) or '').split('[')[0] in ICES
                  for dx in range(-2, 3) for dz in range(-2, 3) for dy in range(-2, 2))
        sky = not any(solid(B(0, dy, 0)) for dy in range(2, 14))
        r.update(feet=feet, head=head, below=below, wet_feet=wet(feet) or wet(head), on_ice=on_ice,
                 ice_over_water=on_ice and wet(below2), water_r2=wr2, sky=sky, err=None)
    except Exception as e:
        r.update(err=f'{type(e).__name__}: {e}'[:120])
    print(json.dumps(r), flush=True)
