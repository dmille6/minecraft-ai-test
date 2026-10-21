#!/usr/bin/env python3
"""townplan_blockdump.py <region_dir> --box X0 Z0 X1 Z1 --y Y0 Y1 [--out dump.json]  -- READ-ONLY block dump for the town plan.

townplan-01 (docs/reports/townplan-found-spec-2026-10-21.md). Reads COPIES of a world's region files (never the live world:
copy them first, e.g. `tar -C <world>/region -cf - r.0.0.mca ...`) and writes every block name in the box, so the bots' own
planner (bots/src/townplan.mjs, pure over a `read(x, y, z)`) can be run OFFLINE on that ground (bots/scripts/townplan-offline.mjs):
the showcase's founding plan is then computed by the same code that will write it, and a Paper arena can be rebuilt from the
same cells. Stdlib only.

Output: { box: [x0, z0, x1, z1], y: [y0, y1], palette: [name, ...], cells: "<base64 of uint16 LE palette index, x fastest,
then z, then y>", missing: [[cx, cz], ...] }. A name carries `[waterlogged]` when its state says waterlogged=true (the planner
reads that as liquid). A chunk that is absent from the files is listed in `missing` and its cells are `?` (index 0): the
planner reads `?` as UNKNOWN, never as air.
"""
import argparse, base64, json, os, struct, sys, zlib


def read_nbt(b):
    i = 0

    def payload(t):
        nonlocal i
        if t == 1: v = struct.unpack_from('>b', b, i)[0]; i += 1; return v
        if t == 2: v = struct.unpack_from('>h', b, i)[0]; i += 2; return v
        if t == 3: v = struct.unpack_from('>i', b, i)[0]; i += 4; return v
        if t == 4: v = struct.unpack_from('>q', b, i)[0]; i += 8; return v
        if t == 5: v = struct.unpack_from('>f', b, i)[0]; i += 4; return v
        if t == 6: v = struct.unpack_from('>d', b, i)[0]; i += 8; return v
        if t == 7: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = b[i:i + n]; i += n; return v
        if t == 8: n = struct.unpack_from('>H', b, i)[0]; i += 2; v = b[i:i + n].decode('utf-8', 'replace'); i += n; return v
        if t == 9:
            et = b[i]; i += 1; n = struct.unpack_from('>i', b, i)[0]; i += 4
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = b[i]; i += 1
                if tt == 0: return d
                n = struct.unpack_from('>H', b, i)[0]; i += 2; k = b[i:i + n].decode('utf-8', 'replace'); i += n
                d[k] = payload(tt)
        if t == 11: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = struct.unpack_from('>%di' % n, b, i); i += 4 * n; return v
        if t == 12: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = struct.unpack_from('>%dq' % n, b, i); i += 8 * n; return v
        raise ValueError('tag %d' % t)
    t = b[i]; i += 1
    n = struct.unpack_from('>H', b, i)[0]; i += 2 + n
    return payload(t)


_regions = {}


def chunk(rdir, cx, cz):
    p = os.path.join(rdir, 'r.%d.%d.mca' % (cx >> 5, cz >> 5))
    if p not in _regions:
        _regions[p] = open(p, 'rb').read() if os.path.exists(p) else b''
    data = _regions[p]
    if not data: return None
    idx = 4 * ((cx & 31) + (cz & 31) * 32)
    off = int.from_bytes(data[idx:idx + 3], 'big') * 4096
    if off == 0: return None
    ln = int.from_bytes(data[off:off + 4], 'big')
    comp = data[off + 4]
    raw = data[off + 5:off + 4 + ln]
    if comp == 2: raw = zlib.decompress(raw)
    elif comp == 1: raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
    elif comp != 3: return None
    return read_nbt(raw)


def section_values(bs):
    pal = bs.get('palette') or []
    dat = bs.get('data')
    if dat is None or len(pal) <= 1: return None
    bits = max(4, (len(pal) - 1).bit_length())
    per = 64 // bits; mask = (1 << bits) - 1
    vals = []
    for lo in dat:
        lo &= (1 << 64) - 1
        for k in range(per):
            vals.append((lo >> (k * bits)) & mask)
            if len(vals) >= 4096: return vals
    return vals


def name_of(entry):
    n = entry.get('Name', '?').replace('minecraft:', '')
    if (entry.get('Properties') or {}).get('waterlogged') == 'true': n += '[waterlogged]'
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('region_dir')
    ap.add_argument('--box', nargs=4, type=int, required=True, metavar=('X0', 'Z0', 'X1', 'Z1'))
    ap.add_argument('--y', nargs=2, type=int, required=True, metavar=('Y0', 'Y1'))
    ap.add_argument('--out')
    a = ap.parse_args()
    x0, z0, x1, z1 = a.box
    y0, y1 = a.y
    palette, index = ['?'], {'?': 0}
    nx, nz, ny = x1 - x0 + 1, z1 - z0 + 1, y1 - y0 + 1
    cells = [0] * (nx * nz * ny)
    missing = []
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            ch = chunk(a.region_dir, cx, cz)
            if ch is None or ch.get('Status', 'minecraft:full') not in ('minecraft:full', 'full'):
                missing.append([cx, cz]); continue
            secs = {s.get('Y'): s.get('block_states') or {} for s in ch.get('sections', [])}
            for sy in range((y0 >> 4), (y1 >> 4) + 1):
                bs = secs.get(sy)
                if bs is None: continue
                pal = [name_of(p) for p in (bs.get('palette') or [])]
                vals = section_values(bs)
                for ly in range(16):
                    y = sy * 16 + ly
                    if y < y0 or y > y1: continue
                    for lz in range(16):
                        z = cz * 16 + lz
                        if z < z0 or z > z1: continue
                        for lx in range(16):
                            x = cx * 16 + lx
                            if x < x0 or x > x1: continue
                            nm = pal[vals[(ly * 16 + lz) * 16 + lx]] if vals is not None else (pal[0] if pal else 'air')
                            if nm not in index: index[nm] = len(palette); palette.append(nm)
                            cells[((y - y0) * nz + (z - z0)) * nx + (x - x0)] = index[nm]
    buf = struct.pack('<%dH' % len(cells), *cells)
    out = {'box': [x0, z0, x1, z1], 'y': [y0, y1], 'palette': palette, 'cells': base64.b64encode(buf).decode('ascii'), 'missing': missing}
    s = json.dumps(out)
    if a.out:
        open(a.out, 'w').write(s)
    else:
        sys.stdout.write(s)
    print('cells=%d palette=%d missing_chunks=%d' % (len(cells), len(palette), len(missing)), file=sys.stderr)


if __name__ == '__main__':
    main()
