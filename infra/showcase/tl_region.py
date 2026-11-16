#!/usr/bin/env python3
"""tl_region.py -- read a box of blocks straight from region files (camunder-01, for tl_under.py `slot`). Stdlib only.

The showcase's tools are installed FLAT in /srv/showcase/bin with no access to scripts/host, so the reading logic of
scripts/host/townplan_blockdump.py lives here as a COPY: `read_nbt`, `section_values` and `name_of` are that file's
functions, verbatim (test_tl_under.py compares the source text while both files are in the checkout, so the copy cannot
drift unnoticed). What is new here:

  chunk_at       the region header maths of townplan_blockdump.chunk, but it SEEKS to the one chunk instead of reading
                 the whole .mca (a slot reads ~70 chunks of four files of several MB each), and a chunk that cannot be
                 read (torn, truncated, unknown compression) is None, never an exception;
  section_bytes  a section's 4096 palette indices as bytes, by whole-array integer arithmetic (16 big-integer shifts
                 instead of 4096 Python steps); the same values as section_values (tested for every bit width);
  read_box       a box of block names in the dump's own layout (x fastest, then z, then y), one palette, 8 bits;
  write_regions  the inverse, for the tests and the bench ONLY: region files from a box (never used on a live world).

Read-only on the region files: they are opened 'rb' and nothing is written beside them.
"""
import os, struct, zlib

SECTOR = 4096
MAX_NAMES = 256


# ---------------------------------------------------------------- the copy (scripts/host/townplan_blockdump.py)
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
    props = entry.get('Properties') or {}
    if n == 'snow': n += '[layers=%s]' % props.get('layers', '?')   # a snow layer is replaceable only at one layer
    if props.get('waterlogged') == 'true': n += '[waterlogged]'
    return n


# ---------------------------------------------------------------- reading
class Regions:
    """The region files of one directory, opened on demand and kept open for one read_box (close() when done)."""
    def __init__(self, region_dir):
        self.dir, self.files, self.bytes_read = region_dir, {}, 0

    def _open(self, rx, rz):
        key = (rx, rz)
        if key not in self.files:
            p = os.path.join(self.dir, 'r.%d.%d.mca' % (rx, rz))
            try:
                f = open(p, 'rb')
                head = f.read(SECTOR)
                self.bytes_read += len(head)
                self.files[key] = (f, head) if len(head) == SECTOR else None
                if self.files[key] is None:
                    f.close()
            except OSError:
                self.files[key] = None
        return self.files[key]

    def chunk_at(self, cx, cz):
        """The chunk's NBT as a dict, or None: no region file, no such chunk, or one that cannot be read whole (a file
        being rewritten must cost a chunk, not the slot)."""
        fh = self._open(cx >> 5, cz >> 5)
        if fh is None:
            return None
        f, head = fh
        idx = 4 * ((cx & 31) + (cz & 31) * 32)
        off = int.from_bytes(head[idx:idx + 3], 'big') * SECTOR
        if off == 0:
            return None
        try:
            f.seek(off)
            blob = f.read(max(1, head[idx + 3]) * SECTOR)
            self.bytes_read += len(blob)
            ln = int.from_bytes(blob[0:4], 'big')
            comp = blob[4]
            if ln < 2 or ln + 4 > len(blob):
                f.seek(off)
                blob = f.read(ln + 4)                         # a chunk longer than its sector count says (255 cap)
                self.bytes_read += len(blob)
                if ln < 2 or ln + 4 > len(blob):
                    return None
            raw = blob[5:4 + ln]
            if comp == 2: raw = zlib.decompress(raw)
            elif comp == 1: raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
            elif comp != 3: return None
            d = read_nbt(raw)
            return d if isinstance(d, dict) else None
        except (OSError, zlib.error, struct.error, IndexError, ValueError, UnicodeError, MemoryError):
            return None

    def close(self):
        for fh in self.files.values():
            if fh:
                fh[0].close()
        self.files = {}


def section_bytes(bs):
    """A section's 4096 palette indices as bytes, in the section's own order (x fastest, then z, then y). None for a
    section of one block (no data); a list (section_values) past 256 palette entries. Each 64-bit word holds
    64 // bits values from its low end; value k of EVERY word is one shift and one mask of the whole array read as
    a single integer."""
    pal = bs.get('palette') or []
    dat = bs.get('data')
    if dat is None or len(pal) <= 1:
        return None
    bits = max(4, (len(pal) - 1).bit_length())
    if bits > 8:
        return section_values(bs)
    n = len(dat)
    per = 64 // bits
    big = int.from_bytes(struct.pack('<%dq' % n, *dat), 'little')
    mask = int.from_bytes(bytes([(1 << bits) - 1, 0, 0, 0, 0, 0, 0, 0]) * n, 'little')
    out = bytearray(n * per)
    for k in range(per):
        out[k::per] = ((big >> (k * bits)) & mask).to_bytes(n * 8, 'little')[0::8]
    return bytes(out[:4096]) if len(out) >= 4096 else bytes(out) + bytes(4096 - len(out))


def read_box(region_dir, x0, z0, x1, z1, y0, y1, fold=None, max_real=190, absent=None):
    """Every block name in a box (inclusive), read from the region files. -> {box, y, palette, cells, bits: 8,
    missing: [[cx, cz], ...], chunks, folded, bytes_read}; cells is one palette index per cell, x fastest, then z,
    then y, exactly as townplan_blockdump writes a dump. A chunk that is absent, not fully generated or unreadable is
    listed in `missing` and its cells are '?' (index 0). A section a full chunk does not carry is '?' too, as in
    townplan_blockdump (its planner must never take unknown for air), unless `absent` names the block to read there
    (tl_under passes 'air': to the game a section that is not stored IS air, and a picture's sky must not be unknown).

    One byte per cell: past max_real names a new name is stored as fold(name) (tl_under folds it to '#<class>', which
    draws the same); with no fold it becomes '?'. `folded` counts the names that lost their spelling."""
    nx, nz, ny = x1 - x0 + 1, z1 - z0 + 1, y1 - y0 + 1
    palette, index = ['?'], {'?': 0}
    cells = bytearray(nx * nz * ny)
    missing, folded, nchunks = [], set(), 0
    R = Regions(region_dir)

    def idx(name):
        i = index.get(name)
        if i is None:
            if len(palette) >= max_real:
                alt = fold(name) if fold else '?'
                folded.add(name)
                if alt in index:
                    i = index[alt]
                elif len(palette) < MAX_NAMES:
                    i = index[alt] = len(palette)
                    palette.append(alt)
                else:
                    i = 0
            else:
                i = len(palette)
                palette.append(name)
            index[name] = i
        return i
    try:
        for cx in range(x0 >> 4, (x1 >> 4) + 1):
            lx0, lx1 = max(x0, cx * 16) - cx * 16, min(x1, cx * 16 + 15) - cx * 16
            dx = cx * 16 + lx0 - x0
            w = lx1 - lx0 + 1
            for cz in range(z0 >> 4, (z1 >> 4) + 1):
                ch = R.chunk_at(cx, cz)
                if ch is None or ch.get('Status', 'minecraft:full') not in ('minecraft:full', 'full'):
                    missing.append([cx, cz])
                    continue
                nchunks += 1
                lz0, lz1 = max(z0, cz * 16) - cz * 16, min(z1, cz * 16 + 15) - cz * 16
                secs = {s.get('Y'): s.get('block_states') or {} for s in ch.get('sections', []) if isinstance(s, dict)}
                for sy in range(y0 >> 4, (y1 >> 4) + 1):
                    bs = secs.get(sy)
                    if bs is None:
                        if absent is None:
                            continue
                        bs = {'palette': [{'Name': absent}]}
                    pal = [idx(name_of(p)) for p in (bs.get('palette') or [])]
                    ly0, ly1 = max(y0, sy * 16) - sy * 16, min(y1, sy * 16 + 15) - sy * 16
                    sec = section_bytes(bs)
                    if sec is None:                              # one block fills the section
                        row = bytes([pal[0] if pal else idx('air')]) * w
                        for ly in range(ly0, ly1 + 1):
                            base = ((sy * 16 + ly - y0) * nz + cz * 16 - z0) * nx + dx
                            for lz in range(lz0, lz1 + 1):
                                o = base + lz * nx
                                cells[o:o + w] = row
                        continue
                    if isinstance(sec, list):
                        sec = bytes(pal[v] if v < len(pal) else 0 for v in sec)
                    else:
                        sec = sec.translate(bytes(pal + [0] * (256 - len(pal))))
                    for ly in range(ly0, ly1 + 1):
                        base = ((sy * 16 + ly - y0) * nz + cz * 16 - z0) * nx + dx
                        so = ly * 256 + lx0
                        for lz in range(lz0, lz1 + 1):
                            o = base + lz * nx
                            s = so + lz * 16
                            cells[o:o + w] = sec[s:s + w]
    finally:
        R.close()
    return {'box': [x0, z0, x1, z1], 'y': [y0, y1], 'palette': palette, 'cells': bytes(cells), 'bits': 8,
            'missing': missing, 'chunks': nchunks, 'folded': len(folded), 'bytes_read': R.bytes_read}


# ---------------------------------------------------------------- writing (tests and bench only)
def _s(name):
    b = name.encode()
    return struct.pack('>H', len(b)) + b


def _tag(t, name, payload):
    return bytes([t]) + _s(name) + payload


def _compound(items):
    return b''.join(items) + b'\x00'


def _entry(name):
    """A dump name ('stone', 'oak_log', 'snow[layers=3]', 'glow_lichen[waterlogged]') -> a palette compound's payload."""
    base, _, rest = name.partition('[')
    props = []
    for part in rest.rstrip(']').split('][') if rest else []:
        if part == 'waterlogged':
            props.append(_tag(8, 'waterlogged', _s('true')))
        elif part.startswith('layers='):
            props.append(_tag(8, 'layers', _s(part[7:])))
    items = [_tag(8, 'Name', _s('minecraft:' + base))]
    if props:
        items.append(_tag(10, 'Properties', _compound(props)))
    return _compound(items)


def pack_section(vals, n_palette):
    """4096 palette indices -> the section's long array (signed), the inverse of section_values."""
    bits = max(4, (n_palette - 1).bit_length())
    per = 64 // bits
    n = -(-4096 // per)
    big = 0
    vals = bytes(vals) if bits <= 8 else None
    if vals is None:
        raise ValueError('pack_section writes sections of at most 256 names')
    for k in range(per):
        col = vals[k::per]
        limb = bytearray(n * 8)
        limb[0:len(col) * 8:8] = col
        big |= int.from_bytes(limb, 'little') << (k * bits)
    return struct.unpack('<%dq' % n, (big & ((1 << (64 * n)) - 1)).to_bytes(n * 8, 'little'))


def write_regions(region_dir, box, yr, palette, cells, baggage=True, fill='air', sections=(-4, 19)):
    """Region files holding a dump's box (and `fill` everywhere else in the chunks it touches, over `sections`).
    baggage: also what a real chunk carries beside its blocks (biomes, light arrays, height maps, a block entity), so
    the NBT walk costs what it costs on a real file. FOR TESTS AND THE BENCH: it creates files in region_dir.
    -> the file names written."""
    x0, z0, x1, z1 = box
    y0, y1 = yr
    nx, nz = x1 - x0 + 1, z1 - z0 + 1
    fi = palette.index(fill) if fill in palette else None
    names = list(palette) + ([] if fi is not None else [fill])
    fi = names.index(fill)
    light = _tag(7, 'BlockLight', struct.pack('>i', 2048) + bytes(2048)) + _tag(7, 'SkyLight', struct.pack('>i', 2048) + b'\xff' * 2048)
    biomes = _tag(10, 'biomes', _compound([_tag(9, 'palette', bytes([8]) + struct.pack('>i', 1) + _s('minecraft:taiga'))]))
    hm = _tag(10, 'Heightmaps', _compound([_tag(12, k, struct.pack('>i', 37) + bytes(37 * 8))
                                           for k in ('MOTION_BLOCKING', 'MOTION_BLOCKING_NO_LEAVES', 'OCEAN_FLOOR', 'WORLD_SURFACE')]))
    be = _tag(9, 'block_entities', bytes([10]) + struct.pack('>i', 1) + _compound(
        [_tag(8, 'id', _s('minecraft:chest')), _tag(3, 'x', struct.pack('>i', 0)), _tag(3, 'y', struct.pack('>i', 0)),
         _tag(3, 'z', struct.pack('>i', 0)), _tag(9, 'Items', bytes([10]) + struct.pack('>i', 0))]))
    regions = {}
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            secs = []
            for sy in range(sections[0], sections[1] + 1):
                sec = bytearray([fi]) * 4096
                if (y0 >> 4) <= sy <= (y1 >> 4):
                    for ly in range(16):
                        y = sy * 16 + ly
                        if not y0 <= y <= y1:
                            continue
                        for lz in range(16):
                            z = cz * 16 + lz
                            if not z0 <= z <= z1:
                                continue
                            a, b = max(x0, cx * 16), min(x1, cx * 16 + 15)
                            o = ((y - y0) * nz + z - z0) * nx + a - x0
                            s = (ly * 16 + lz) * 16 + a - cx * 16
                            sec[s:s + b - a + 1] = cells[o:o + b - a + 1]
                used = sorted(set(sec))
                lut = bytearray(256)
                for i, v in enumerate(used):
                    lut[v] = i
                pal = _tag(9, 'palette', bytes([10]) + struct.pack('>i', len(used)) + b''.join(_entry(names[v]) for v in used))
                items = [pal]
                if len(used) > 1:
                    longs = pack_section(bytes(sec).translate(bytes(lut)), len(used))
                    items.append(_tag(12, 'data', struct.pack('>i', len(longs)) + struct.pack('>%dq' % len(longs), *longs)))
                one = [_tag(1, 'Y', struct.pack('>b', sy)), _tag(10, 'block_states', _compound(items))]
                if baggage:
                    one += [biomes, light]
                secs.append(_compound(one))
            top = [_tag(3, 'DataVersion', struct.pack('>i', 3953)), _tag(3, 'xPos', struct.pack('>i', cx)),
                   _tag(3, 'zPos', struct.pack('>i', cz)), _tag(3, 'yPos', struct.pack('>i', sections[0])),
                   _tag(8, 'Status', _s('minecraft:full')), _tag(4, 'InhabitedTime', struct.pack('>q', 12345)),
                   _tag(9, 'sections', bytes([10]) + struct.pack('>i', len(secs)) + b''.join(secs))]
            if baggage:
                top += [hm, be]
            nbt = bytes([10]) + _s('') + _compound(top)
            regions.setdefault((cx >> 5, cz >> 5), {})[(cx & 31, cz & 31)] = zlib.compress(nbt, 6)
    os.makedirs(region_dir, exist_ok=True)
    out = []
    for (rx, rz), chunks in sorted(regions.items()):
        head = bytearray(SECTOR * 2)
        body = bytearray()
        for (lx, lz), comp in sorted(chunks.items()):
            blob = struct.pack('>I', len(comp) + 1) + b'\x02' + comp
            blob += bytes(-len(blob) % SECTOR)
            i = 4 * (lx + lz * 32)
            head[i:i + 3] = (2 + len(body) // SECTOR).to_bytes(3, 'big')
            head[i + 3] = min(255, len(blob) // SECTOR)
            body += blob
        p = os.path.join(region_dir, 'r.%d.%d.mca' % (rx, rz))
        with open(p, 'wb') as f:
            f.write(bytes(head) + bytes(body))
        out.append(p)
    return out
