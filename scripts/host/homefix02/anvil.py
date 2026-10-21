#!/usr/bin/env python3
"""Minimal read-only Anvil (1.18+) block + biome reader. usage: anvil.py REGION_DIR x0 x1 y0 y1 z0 z1"""
import sys, struct, zlib, os, math

def nbt(buf, i=0):
    def rd(t, i):
        if t == 1: return struct.unpack_from('>b', buf, i)[0], i + 1
        if t == 2: return struct.unpack_from('>h', buf, i)[0], i + 2
        if t == 3: return struct.unpack_from('>i', buf, i)[0], i + 4
        if t == 4: return struct.unpack_from('>q', buf, i)[0], i + 8
        if t == 5: return struct.unpack_from('>f', buf, i)[0], i + 4
        if t == 6: return struct.unpack_from('>d', buf, i)[0], i + 8
        if t == 7:
            n = struct.unpack_from('>i', buf, i)[0]; i += 4; return buf[i:i + n], i + n
        if t == 8:
            n = struct.unpack_from('>H', buf, i)[0]; i += 2; return buf[i:i + n].decode('utf8', 'replace'), i + n
        if t == 9:
            et = buf[i]; n = struct.unpack_from('>i', buf, i + 1)[0]; i += 5; out = []
            for _ in range(n):
                v, i = rd(et, i); out.append(v)
            return out, i
        if t == 10:
            d = {}
            while True:
                tt = buf[i]; i += 1
                if tt == 0: return d, i
                n = struct.unpack_from('>H', buf, i)[0]; i += 2; name = buf[i:i + n].decode('utf8', 'replace'); i += n
                v, i = rd(tt, i); d[name] = v
        if t == 11:
            n = struct.unpack_from('>i', buf, i)[0]; i += 4
            return list(struct.unpack_from(f'>{n}i', buf, i)), i + 4 * n
        if t == 12:
            n = struct.unpack_from('>i', buf, i)[0]; i += 4
            return list(struct.unpack_from(f'>{n}q', buf, i)), i + 8 * n
        raise ValueError(t)
    t = buf[i]; n = struct.unpack_from('>H', buf, i + 1)[0]
    v, _ = rd(t, i + 3 + n)
    return v

_cache = {}
_files = {}
def chunk(rdir, cx, cz):
    k = (rdir, cx, cz)
    if k in _cache: return _cache[k]
    rx, rz = cx >> 5, cz >> 5
    path = os.path.join(rdir, f'r.{rx}.{rz}.mca')
    data = _files.get(path)
    if data is None:
        if not os.path.exists(path):
            _cache[k] = None; return None
        with open(path, 'rb') as f:
            data = f.read()
        _files[path] = data
    idx = 4 * ((cx & 31) + (cz & 31) * 32)
    off = int.from_bytes(data[idx:idx + 3], 'big'); cnt = data[idx + 3]
    if off == 0: _cache[k] = None; return None
    p = off * 4096
    ln = struct.unpack_from('>i', data, p)[0]; comp = data[p + 4]
    raw = data[p + 5:p + 4 + ln]
    raw = zlib.decompress(raw) if comp == 2 else raw
    c = nbt(raw)
    secs = {}
    for s in c.get('sections', []):
        secs[s['Y']] = s
    _cache[k] = secs
    return secs

def unpack(longs, bits, n):
    per = 64 // bits; out = []; mask = (1 << bits) - 1
    for L in longs:
        L &= (1 << 64) - 1
        for j in range(per):
            out.append((L >> (j * bits)) & mask)
            if len(out) == n: return out
    return out

def block(rdir, x, y, z):
    secs = chunk(rdir, x >> 4, z >> 4)
    if secs is None: return None
    s = secs.get(y >> 4)
    if s is None or 'block_states' not in s: return 'air?'
    bs = s['block_states']; pal = bs['palette']
    if len(pal) == 1 or 'data' not in bs: e = pal[0]
    else:
        bits = max(4, math.ceil(math.log2(len(pal))))
        arr = unpack(bs['data'], bits, 4096)
        e = pal[arr[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)]]
    nm = e['Name'].replace('minecraft:', '')
    pr = e.get('Properties')
    if pr and ('waterlogged' in pr and pr['waterlogged'] == 'true'): nm += '[wl]'
    if nm == 'water' and pr and pr.get('level', '0') != '0': nm += f"[{pr['level']}]"
    return nm

def biome(rdir, x, y, z):
    secs = chunk(rdir, x >> 4, z >> 4)
    s = secs.get(y >> 4) if secs else None
    if not s or 'biomes' not in s: return None
    b = s['biomes']; pal = b['palette']
    if len(pal) == 1 or 'data' not in b: return pal[0]
    bits = max(1, math.ceil(math.log2(len(pal))))
    arr = unpack(b['data'], bits, 64)
    return pal[arr[(((y & 15) >> 2) * 4 + ((z & 15) >> 2)) * 4 + ((x & 15) >> 2)]]

ABBR = {'air': '.', 'water': 'w', 'ice': 'I', 'packed_ice': 'P', 'blue_ice': 'B', 'stone': 's', 'dirt': 'd', 'grass_block': 'g',
        'snow': '~', 'snow_block': 'S', 'gravel': 'v', 'sand': 'a', 'cobblestone': 'c', 'cave_air': ',', 'deepslate': 'D',
        'andesite': 'n', 'diorite': 'o', 'granite': 'r', 'clay': 'y', 'tuff': 't', 'lava': 'L', 'seagrass': 'e', 'kelp': 'k', 'kelp_plant': 'k',
        'tall_seagrass': 'e', 'copper_ore': '$', 'iron_ore': '$', 'coal_ore': '$', 'spruce_log': 'T', 'spruce_leaves': 'l', 'oak_log': 'T', 'oak_leaves': 'l'}

if __name__ == '__main__':
    rdir = sys.argv[1]
    x0, x1, y0, y1, z0, z1 = map(int, sys.argv[2:8])
    legend = {}
    for y in range(y1, y0 - 1, -1):
        print(f'--- y={y}  (rows z={z0}..{z1}, cols x={x0}..{x1})')
        for z in range(z0, z1 + 1):
            row = ''
            for x in range(x0, x1 + 1):
                b = block(rdir, x, y, z) or '?'
                ch = ABBR.get(b)
                if ch is None:
                    ch = b[0].upper() if b[0] not in 'wIPBsdgSvacDnortLek.' else '#'
                    legend[ch] = legend.get(ch, set()) | {b}
                if b.startswith('water['): ch = 'f'
                row += ch
            print(f'z={z:5d} {row}')
    print('legend extra:', {k: sorted(v) for k, v in legend.items()})
    print('biome at centre:', biome(rdir, (x0 + x1) // 2, (y0 + y1) // 2, (z0 + z1) // 2))
