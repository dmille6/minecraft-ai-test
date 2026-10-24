"""Minimal read-only Anvil (1.18+) reader: block at (x,y,z) from a region-file copy."""
import struct, zlib, gzip, io, sys, math


def nbt_parse(buf):
    f = io.BytesIO(buf)

    def rd(n):
        return f.read(n)

    def name():
        (l,) = struct.unpack('>H', rd(2))
        return rd(l).decode('utf-8', 'replace')

    def payload(t):
        if t == 1: return struct.unpack('>b', rd(1))[0]
        if t == 2: return struct.unpack('>h', rd(2))[0]
        if t == 3: return struct.unpack('>i', rd(4))[0]
        if t == 4: return struct.unpack('>q', rd(8))[0]
        if t == 5: return struct.unpack('>f', rd(4))[0]
        if t == 6: return struct.unpack('>d', rd(8))[0]
        if t == 7:
            (n,) = struct.unpack('>i', rd(4)); return rd(n)
        if t == 8: return name()
        if t == 9:
            et = rd(1)[0]; (n,) = struct.unpack('>i', rd(4))
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = rd(1)[0]
                if tt == 0: return d
                k = name(); d[k] = payload(tt)
        if t == 11:
            (n,) = struct.unpack('>i', rd(4)); return list(struct.unpack('>%di' % n, rd(4 * n)))
        if t == 12:
            (n,) = struct.unpack('>i', rd(4)); return list(struct.unpack('>%dq' % n, rd(8 * n)))
        raise ValueError(t)

    t = rd(1)[0]; name(); return payload(t)


class Region:
    def __init__(self, path):
        self.data = open(path, 'rb').read()
        self.cache = {}

    def chunk(self, cx, cz):
        key = (cx & 31, cz & 31)
        if key in self.cache: return self.cache[key]
        i = 4 * (key[0] + key[1] * 32)
        off = int.from_bytes(self.data[i:i + 3], 'big'); cnt = self.data[i + 3]
        ts = struct.unpack('>I', self.data[4096 + i:4096 + i + 4])[0]
        if off == 0:
            self.cache[key] = None; return None
        p = off * 4096
        (ln,) = struct.unpack('>I', self.data[p:p + 4]); comp = self.data[p + 4]
        raw = self.data[p + 5:p + 4 + ln]
        raw = zlib.decompress(raw) if comp == 2 else gzip.decompress(raw) if comp == 1 else raw
        c = nbt_parse(raw); c['_ts'] = ts
        self.cache[key] = c
        return c

    def block(self, x, y, z):
        c = self.chunk(x >> 4, z >> 4)
        if c is None: return None
        sy = y >> 4
        for s in c.get('sections', []):
            if s.get('Y') != sy: continue
            bs = s.get('block_states')
            if not bs: return None
            pal = bs['palette']
            if len(pal) == 1: return pal[0]
            bits = max(4, math.ceil(math.log2(len(pal))))
            per = 64 // bits
            idx = ((y & 15) * 16 + (z & 15)) * 16 + (x & 15)
            lng = bs['data'][idx // per] & ((1 << 64) - 1)
            v = (lng >> ((idx % per) * bits)) & ((1 << bits) - 1)
            return pal[v]
        return None


def short(b):
    if b is None: return '??'
    n = b['Name'].replace('minecraft:', '')
    p = b.get('Properties', {})
    if n == 'water': return 'W%s' % p.get('level', '?')
    if n in ('air', 'cave_air'): return '.'
    s = n
    if p.get('waterlogged') == 'true': s += '[wl]'
    return s


if __name__ == '__main__':
    import datetime
    r = Region(sys.argv[1])
    X, Y, Z = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    rad = int(sys.argv[5]) if len(sys.argv) > 5 else 3
    lo = int(sys.argv[6]) if len(sys.argv) > 6 else -4
    hi = int(sys.argv[7]) if len(sys.argv) > 7 else 6
    c = r.chunk(X >> 4, Z >> 4)
    print('chunk', X >> 4, Z >> 4, 'saved', datetime.datetime.utcfromtimestamp(c['_ts']).isoformat() + 'Z', 'status', c.get('Status'), 'DataVersion', c.get('DataVersion'))
    for dy in range(hi, lo - 1, -1):
        y = Y + dy
        print('\n y=%d (dy %+d)   x: %s' % (y, dy, ' '.join('%-14d' % (X + dx) for dx in range(-rad, rad + 1))))
        for dz in range(-rad, rad + 1):
            z = Z + dz
            print('  z=%d  ' % z + ' '.join('%-14s' % short(r.block(X + dx, y, z))[:14] for dx in range(-rad, rad + 1)))
