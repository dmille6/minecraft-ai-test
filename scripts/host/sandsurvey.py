#!/usr/bin/env python3
# READ-ONLY sand survey (glass-01, 11-08): where a town's surface sand is, how far, how wet. Run on COPIES or read-only live region files.
# usage: ssurvey.py <world_dir> <hx> <hy> <hz> [R] [--cells out.json]
import sys, struct, zlib, math, os, json, re, collections
def nbt(b, i, t):
    if t == 1: return struct.unpack_from('>b', b, i)[0], i+1
    if t == 2: return struct.unpack_from('>h', b, i)[0], i+2
    if t == 3: return struct.unpack_from('>i', b, i)[0], i+4
    if t == 4: return struct.unpack_from('>q', b, i)[0], i+8
    if t == 5: return None, i+4
    if t == 6: return None, i+8
    if t == 7: n = struct.unpack_from('>i', b, i)[0]; return None, i+4+n
    if t == 8: n = struct.unpack_from('>H', b, i)[0]; return b[i+2:i+2+n].decode('utf8', 'replace'), i+2+n
    if t == 9:
        et = b[i]; n = struct.unpack_from('>i', b, i+1)[0]; i += 5; out = []
        for _ in range(n): v, i = nbt(b, i, et); out.append(v)
        return out, i
    if t == 10:
        d = {}
        while True:
            tt = b[i]; i += 1
            if tt == 0: return d, i
            n = struct.unpack_from('>H', b, i)[0]; name = b[i+2:i+2+n].decode('utf8', 'replace'); i += 2+n
            v, i = nbt(b, i, tt); d[name] = v
    if t == 11: n = struct.unpack_from('>i', b, i)[0]; return None, i+4+4*n
    if t == 12:
        n = struct.unpack_from('>i', b, i)[0]; return list(struct.unpack_from('>%dq' % n, b, i+4)), i+4+8*n
    raise ValueError(t)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
world = args[0]; HX, HY, HZ = map(int, args[1:4]); R = int(args[4]) if len(args) > 4 else 128
cells_out = sys.argv[sys.argv.index('--cells') + 1] if '--cells' in sys.argv else None
regs, chunks = {}, {}
def chunk(cx, cz):
    if (cx, cz) in chunks: return chunks[(cx, cz)]
    f = f'{world}/region/r.{cx>>5}.{cz>>5}.mca'
    if f not in regs: regs[f] = open(f, 'rb').read() if os.path.exists(f) else b''
    d = regs[f]; secs = {}
    idx = 4 * ((cx & 31) + (cz & 31) * 32)
    off = int.from_bytes(d[idx:idx+3], 'big') if len(d) > idx+3 else 0
    if not off: chunks[(cx, cz)] = None; return None
    try:
        o = off*4096; ln = struct.unpack_from('>i', d, o)[0]
        raw = zlib.decompress(d[o+5:o+4+ln]); root, _ = nbt(raw, 3 + struct.unpack_from('>H', raw, 1)[0], 10)
        for s in root.get('sections', []):
            bs = s.get('block_states') or {}
            pal = [p.get('Name', '').replace('minecraft:', '') + ('[wl]' if (p.get('Properties') or {}).get('waterlogged') == 'true' else '') for p in (bs.get('palette') or [])]
            secs[s['Y']] = (pal, bs.get('data'))
    except Exception:
        secs = None
    chunks[(cx, cz)] = secs; return secs
def block(x, y, z):
    c = chunk(x >> 4, z >> 4)
    if c is None: return '?'
    s = c.get(y >> 4)
    if not s: return 'air'
    pal, data = s
    if not data: return pal[0] if pal else '?'
    bits = max(4, math.ceil(math.log2(len(pal)))); per = 64 // bits; mask = (1 << bits) - 1
    j = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15)
    return pal[(data[j // per] >> ((j % per) * bits)) & mask]
AIR = re.compile(r'^(air|cave_air|short_grass|tall_grass|fern|large_fern|snow|dead_bush|.*flower.*|poppy|dandelion|.*_tulip|cornflower|azure_bluet|oxeye_daisy|allium|lily_of_the_valley|sweet_berry_bush|torch|wall_torch|.*sapling|vine|cactus|sugar_cane|lily_pad|short_dry_grass|tall_dry_grass|bush|leaf_litter|firefly_bush)$')
WATER = re.compile(r'^(water|bubble_column)$|\[wl\]$|^(kelp|kelp_plant|seagrass|tall_seagrass)$')
LEAF = re.compile(r'_leaves$'); LOG = re.compile(r'_(log|wood)$')
SAND = re.compile(r'^(sand|red_sand)$')
def top(x, z, ylo=30, yhi=130):
    for y in range(yhi, ylo, -1):
        n = block(x, y, z)
        if n == '?': return (None, '?')
        if AIR.match(n) or LEAF.search(n) or LOG.search(n): continue
        return (y, n)
    return (None, 'none')
tops = {}
for x in range(HX - R, HX + R + 1):
    for z in range(HZ - R, HZ + R + 1):
        tops[(x, z)] = top(x, z)
N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
N8 = [(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1) if a or b]
def iswater(k): v = tops.get(k); return bool(v and v[0] is not None and WATER.search(v[1]))
def sanddepth(x, y, z):
    d = 0
    while d < 6 and SAND.match(block(x, y - d, z)): d += 1
    return d
def waterdepth(x, y, z):
    d = 0
    while d < 30 and WATER.search(block(x, y - d, z)): d += 1
    return d, block(x, y - d, z)
cls = collections.Counter(); bydist = collections.defaultdict(collections.Counter); yield_ = collections.Counter()
nearest = {}; cells = []
for (x, z), (y, n) in tops.items():
    if y is None: continue
    dist = math.hypot(x - HX, z - HZ)
    if SAND.match(n):
        wet4 = [k for k in ((x+dx, z+dz) for dx, dz in N4) if iswater(k)]
        # deepest water touching this column (8-neighbourhood): the hole floods from it; a slip goes into it
        deep = 0
        for dx, dz in N8:
            k = (x+dx, z+dz)
            if iswater(k): deep = max(deep, waterdepth(x+dx, tops[k][0], z+dz)[0])
        # a dry stand: a 4-neighbour land column (not water) within 1 of the sand's top, its feet+head cells air
        stand = None
        for dx, dz in N4:
            k = (x+dx, z+dz); v = tops.get(k)
            if not v or v[0] is None or iswater(k): continue
            if abs(v[0] - y) <= 1 and not WATER.search(block(x+dx, v[0]+1, z+dz)) and not WATER.search(block(x+dx, v[0]+2, z+dz)):
                stand = (x+dx, v[0]+1, z+dz); break
        above = block(x, y + 1, z)
        c = 'dry' if not wet4 and deep == 0 else 'shore'
        if WATER.search(above): c = 'wet_top'
        kind = f'{c}{"" if stand else "_nostand"}'
        cls[kind] += 1
        sd = sanddepth(x, y, z)
        for r in (32, 48, 64, 96, 128):
            if dist <= r: bydist[kind][r] += 1
            if dist <= r and stand and c in ('dry', 'shore'): yield_[r] += sd
        if stand and c in ('dry', 'shore'):
            nearest[c] = min(nearest.get(c, 1e9), dist)
            cells.append([x, y, z, c, deep, sd, round(dist)])
            cls[f'{c}_deep_adj_{"0" if deep == 0 else "1" if deep == 1 else "2+"}'] += 1
    elif WATER.search(n):
        d, bed = waterdepth(x, y, z)
        if SAND.match(bed):
            k = 'seabed_d1' if d == 1 else 'seabed_d2' if d == 2 else 'seabed_d3+'
            cls[k] += 1
            for r in (32, 48, 64, 96, 128):
                if dist <= r: bydist[k][r] += 1
            if d == 1: nearest['seabed_d1'] = min(nearest.get('seabed_d1', 1e9), dist)
out = {'home': [HX, HY, HZ], 'R': R, 'cols': len(tops), 'unread': sum(1 for v in tops.values() if v[0] is None),
       'water_cols': sum(1 for k in tops if iswater(k)), 'sand_top_any': sum(1 for v in tops.values() if v[0] is not None and SAND.match(v[1])),
       'classes': dict(cls), 'by_dist': {k: dict(v) for k, v in bydist.items()}, 'yield_standable_blocks': dict(yield_),
       'nearest': {k: round(v) for k, v in nearest.items()}}
print(json.dumps(out))
if cells_out: json.dump(cells, open(cells_out, 'w'))
