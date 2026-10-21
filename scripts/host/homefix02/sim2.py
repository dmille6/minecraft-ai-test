#!/usr/bin/env python3
"""Sizing for homefix-02 against the saved worlds (read-only). For each start (stagnation verdict / requested rescue):
  submerged   the head cell (feet+1) is not breathable and the feet or head cell is water (C3 would decline)
  old_target  the old relocation target (random 45-70 at the current y): its column surface is wet / ice / unknown
  dry_found   the C2 chooser finds a dry, standable target in <= 16 tries (else it falls back to `home`)
Python mirror of the planned JS predicates; approximate block shapes (names, not bounding boxes)."""
import sys, json, os, math, random, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anvil
ROOT = '/srv/block2'
LIQ = re.compile(r'^(water|lava|flowing_water|flowing_lava|bubble_column)')
ICE = re.compile(r'^(ice|packed_ice|blue_ice|frosted_ice)$')
EMPTY = re.compile(r'^(air|cave_air|void_air|short_grass|grass|tall_grass|fern|large_fern|dead_bush|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sweet_berry_bush|torch|wall_torch|vine|snow|sugar_cane|.*_sapling|brown_mushroom|red_mushroom|glow_lichen|moss_carpet|pink_petals|.*_carpet|rail|lever|.*_button|.*pressure_plate|ladder|cobweb|bush|firefly_bush|leaf_litter|short_dry_grass|tall_dry_grass|wildflowers)$')
FALLING = re.compile(r'^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$')
def nm(b): return (b or '').split('[')[0]
def wet(b): return b is not None and (LIQ.match(nm(b)) is not None or b.endswith('[wl]') or nm(b) in ('kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'))
def passable(b): return b is not None and b != 'air?' and EMPTY.match(nm(b)) is not None and not wet(b) or b == 'air?'
def solid(b): return b is not None and b != 'air?' and not passable(b) and not wet(b)
def breathable(b): return b is not None and (b == 'air?' or (passable(b) and not wet(b)))

def column_surface(read, x, z, hy):
    for y in range(hy + 8, hy - 9, -1):
        c, u = read(x, y, z), read(x, y - 1, z)
        if c is None or u is None: return None
        if passable(c) and solid(u): return y - 1
    return 'none'

def dry_target(read, x, z, hy, R=int(os.environ.get("SIM_R","2"))):
    f = column_surface(read, x, z, hy)
    if f is None: return False, 'unknown'
    if f == 'none': return False, 'no_surface'
    fy = f + 1
    floor = read(x, f, z)
    if not (passable(read(x, fy, z)) and passable(read(x, fy + 1, z)) and solid(floor)): return False, 'not_standable'
    if ICE.match(nm(floor)) or nm(floor) == 'magma_block': return False, 'floor_' + nm(floor)
    if wet(read(x, fy + 2, z)): return False, 'liquid_overhead'
    for dx in range(-R, R + 1):
        for dz in range(-R, R + 1):
            for dy in range(int(os.environ.get("SIM_DY0","-2")), int(os.environ.get("SIM_DY1","2"))):
                b = read(x + dx, fy + dy, z + dz)
                if b is None: return False, 'unknown_near'
                if wet(b) or ICE.match(nm(b)): return False, 'water_near'
    return True, 'dry'

rng = random.Random(20261021)
out = collections.Counter(); why_old = collections.Counter(); per = collections.defaultdict(collections.Counter)
for line in open(sys.argv[1]):
    r = json.loads(line); p = r['pos']
    rdir = os.path.join(ROOT, r['pool'], 'world', 'region')
    read = lambda x, y, z: anvil.block(rdir, x, y, z)
    fx, fy, fz = math.floor(p['x']), math.floor(p['y']), math.floor(p['z'])
    try:
        feet, head = read(fx, fy, fz), read(fx, fy + 1, fz)
    except Exception as e:
        out['err'] += 1; continue
    sub = (not breathable(head)) and (wet(feet) or wet(head) or ICE.match(nm(head)) is not None)
    key = (r['kind'], r['arm'], r.get('level'))
    per[key]['n'] += 1; per[key]['submerged'] += sub
    if r['kind'] == 'verdict' and r.get('level') == 1:
        ang = rng.random() * 2 * math.pi; d = 45 + rng.random() * 25
        ok, why = dry_target(read, round(p['x'] + math.cos(ang) * d), round(p['z'] + math.sin(ang) * d), round(p['y']))
        per[key]['old_target_dry'] += ok; why_old[(r['arm'], why)] += 1
        found = False; tries = 0
        for i in range(16):
            tries += 1
            ang = rng.random() * 2 * math.pi; d = 45 + rng.random() * 25
            ok, why = dry_target(read, round(p['x'] + math.cos(ang) * d), round(p['z'] + math.sin(ang) * d), round(p['y']))
            if ok: found = True; break
        per[key]['dry_found'] += found; per[key]['tries_sum'] += tries
        per[(r['pool'], 'L1')]['n'] += 1; per[(r['pool'], 'L1')]['dry_found'] += found
for k, v in sorted(per.items(), key=lambda kv: str(kv[0])): print(k, dict(v))
print('old-target reasons:', sorted(why_old.items(), key=lambda kv: -kv[1]))
print(dict(out))
