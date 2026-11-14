#!/usr/bin/env python3
"""regiondump.py -- the blocks of a box, read from a Paper world's saved region files (READ ONLY; owner 11-14).

    python3 regiondump.py --region /srv/showcase/server/world/region --box -80 80 -80 80 --y 52 100 > blocks.json
    from regiondump import dump     # dump(region_dir, x0, x1, z0, z1, y0, y1) -> the same dict

-> { saved: iso (the oldest region file's mtime: the box is no newer than that), chunks, missing_chunks, floor_y: y0,
     palette: [{name, props}], cells: [[x, y, z, palette index]] }   every non-air block with y0 <= y <= y1 in the box.
The file is the server's own save (Paper autosaves every few minutes), so the answer is minutes old, never live; `saved` says
how old. Nothing is written and the server is not asked anything. Anvil: 1.18+ sections (block_states palette + packed
longs, indices never span a long)."""
import argparse
import datetime as dt
import gzip
import json
import math
import os
import struct
import sys
import zlib

AIRS = ('minecraft:air', 'minecraft:cave_air', 'minecraft:void_air')


def parse_nbt(buf):
    pos = [0]

    def rd(fmt, n):
        v = struct.unpack_from(fmt, buf, pos[0])
        pos[0] += n
        return v[0]

    def name():
        n = rd('>H', 2)
        s = buf[pos[0]:pos[0] + n]
        pos[0] += n
        return s.decode('utf-8', 'replace')

    def payload(t):
        if t == 1:
            return rd('>b', 1)
        if t == 2:
            return rd('>h', 2)
        if t == 3:
            return rd('>i', 4)
        if t == 4:
            return rd('>q', 8)
        if t == 5:
            return rd('>f', 4)
        if t == 6:
            return rd('>d', 8)
        if t == 7:
            n = rd('>i', 4)
            pos[0] += n
            return None
        if t == 8:
            return name()
        if t == 9:
            et = rd('>b', 1)
            n = rd('>i', 4)
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = rd('>b', 1)
                if tt == 0:
                    return d
                k = name()
                d[k] = payload(tt)
        if t == 11:
            n = rd('>i', 4)
            pos[0] += 4 * n
            return None
        if t == 12:
            n = rd('>i', 4)
            v = struct.unpack_from('>%dq' % n, buf, pos[0])
            pos[0] += 8 * n
            return v
        raise ValueError('nbt tag %r' % t)
    t = rd('>b', 1)
    name()
    return payload(t)


def section_blocks(sec):
    """One section -> yield (index 0..4095, palette entry) for its non-air blocks. index = y*256 + z*16 + x."""
    bs = sec.get('block_states') or {}
    pal = bs.get('palette') or []
    if not pal:
        return
    longs = bs.get('data')
    bits = max(4, math.ceil(math.log2(len(pal)))) if len(pal) > 1 else 0
    if not bits or not longs:
        if pal[0].get('Name') in AIRS:
            return
        for i in range(4096):
            yield i, pal[0]
        return
    per, mask = 64 // bits, (1 << bits) - 1
    for i in range(4096):
        idx = ((longs[i // per] & 0xFFFFFFFFFFFFFFFF) >> ((i % per) * bits)) & mask
        e = pal[idx] if idx < len(pal) else None
        if e is None or e.get('Name') in AIRS:
            continue
        yield i, e


def dump(region_dir, x0, x1, z0, z1, y0, y1):
    palette, pal_ix, cells = [], {}, []
    got = missing = 0
    oldest = None
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            p = os.path.join(region_dir, 'r.%d.%d.mca' % (cx >> 5, cz >> 5))
            try:
                mt = os.path.getmtime(p)
                with open(p, 'rb') as f:
                    head = f.read(4096)
                    off = struct.unpack_from('>I', head, 4 * ((cx & 31) + (cz & 31) * 32))[0]
                    if off == 0:
                        missing += 1
                        continue
                    f.seek((off >> 8) * 4096)
                    ln, ct = struct.unpack('>IB', f.read(5))
                    raw = f.read(ln - 1)
            except OSError:
                missing += 1
                continue
            oldest = mt if oldest is None else min(oldest, mt)
            nbt = parse_nbt(zlib.decompress(raw) if ct == 2 else gzip.decompress(raw) if ct == 1 else raw)
            got += 1
            for sec in nbt.get('sections') or []:
                sy = sec.get('Y')
                if sy is None or sy * 16 + 15 < y0 or sy * 16 > y1:
                    continue
                for i, e in section_blocks(sec):
                    y = sy * 16 + (i >> 8)
                    z = cz * 16 + ((i >> 4) & 15)
                    x = cx * 16 + (i & 15)
                    if not (y0 <= y <= y1 and x0 <= x <= x1 and z0 <= z <= z1):
                        continue
                    props = e.get('Properties') or {}
                    k = (e.get('Name'), tuple(sorted(props.items())))
                    ix = pal_ix.get(k)
                    if ix is None:
                        ix = pal_ix[k] = len(palette)
                        palette.append({'name': str(e.get('Name')).replace('minecraft:', ''), 'props': {a: str(b) for a, b in props.items()}})
                    cells.append([x, y, z, ix])
    return {'saved': dt.datetime.fromtimestamp(oldest, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if oldest else None,
            'chunks': got, 'missing_chunks': missing, 'floor_y': y0, 'box': [x0, x1, z0, z1, y0, y1], 'palette': palette, 'cells': cells}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--region', required=True)
    ap.add_argument('--box', nargs=4, type=int, required=True, metavar=('X0', 'X1', 'Z0', 'Z1'))
    ap.add_argument('--y', nargs=2, type=int, default=[52, 100], metavar=('Y0', 'Y1'))
    a = ap.parse_args(argv)
    json.dump(dump(a.region, a.box[0], a.box[1], a.box[2], a.box[3], a.y[0], a.y[1]), sys.stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main())
