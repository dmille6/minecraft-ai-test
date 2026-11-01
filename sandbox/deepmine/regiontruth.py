#!/usr/bin/env python3
# READ-ONLY truth over a SANDBOX world's region files (deepminer-01 Paper driver): after `save-all flush`, inside a box report
#   breach    opened (air/cave_air) cells with a lava or water face neighbour that were NOT air when the arena was built
#             (the driver passes the arena's own cave/pocket cells as `native`) -- the probe-ahead and seal must keep this 0
#   flowing   lava/water blocks with level > 0 (a flow the bot let loose)
#   dug       air cells below y=`dugBelow` that the arena did not make (the miner's footprint)
#   ores      diamond / iron ore blocks still standing
# usage: regiontruth.py <world_dir> <x0> <y0> <z0> <x1> <y1> <z1> <native_json_file> <dugBelow>
import sys, struct, zlib, math, os, json
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
world = sys.argv[1]
x0, y0, z0, x1, y1, z1 = map(int, sys.argv[2:8])
native = set(tuple(c) for c in json.load(open(sys.argv[8])))
dug_below = int(sys.argv[9])
regs, chunks = {}, {}
def chunk(cx, cz):
    if (cx, cz) in chunks: return chunks[(cx, cz)]
    f = f'{world}/region/r.{cx>>5}.{cz>>5}.mca'
    if f not in regs: regs[f] = open(f, 'rb').read() if os.path.exists(f) else b''
    d = regs[f]; secs = {}
    idx = 4 * ((cx & 31) + (cz & 31) * 32)
    off = int.from_bytes(d[idx:idx+3], 'big') if d else 0
    if off:
        o = off*4096; ln = struct.unpack_from('>i', d, o)[0]
        raw = zlib.decompress(d[o+5:o+4+ln]); root, _ = nbt(raw, 3 + struct.unpack_from('>H', raw, 1)[0], 10)
        for s in root.get('sections', []):
            bs = s.get('block_states') or {}
            pal = [(p.get('Name', '').replace('minecraft:', ''), (p.get('Properties') or {})) for p in (bs.get('palette') or [])]
            secs[s['Y']] = (pal, bs.get('data'))
    chunks[(cx, cz)] = secs; return secs
def block(x, y, z):
    s = chunk(x >> 4, z >> 4).get(y >> 4)
    if not s: return ('?', {})
    pal, data = s
    if not data: return pal[0] if pal else ('?', {})
    bits = max(4, math.ceil(math.log2(len(pal)))); per = 64 // bits; mask = (1 << bits) - 1
    j = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15)
    return pal[(data[j // per] >> ((j % per) * bits)) & mask]
AIR = ('air', 'cave_air')
N6 = [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
out = {'breach': [], 'flowing': 0, 'dug': 0, 'ores': {}, 'cobble_deep': 0, 'torches': 0}
for x in range(x0, x1+1):
    for z in range(z0, z1+1):
        for y in range(y0, y1+1):
            n, p = block(x, y, z)
            if n in ('lava', 'water') and str(p.get('level', '0')) != '0': out['flowing'] += 1
            if n.endswith('_ore') and ('diamond' in n or 'iron' in n): out['ores'][n] = out['ores'].get(n, 0) + 1
            if n in ('torch', 'wall_torch') and y < dug_below: out['torches'] += 1
            if n in ('cobblestone', 'cobbled_deepslate') and y < dug_below: out['cobble_deep'] += 1
            if n in AIR and (x, y, z) not in native:
                if y < dug_below: out['dug'] += 1
                for dx, dy, dz in N6:
                    q = block(x+dx, y+dy, z+dz)[0]
                    if q in ('lava', 'water'):
                        out['breach'].append([x, y, z, q]); break
out['breach_n'] = len(out['breach']); out['breach'] = out['breach'][:20]
print(json.dumps(out))
