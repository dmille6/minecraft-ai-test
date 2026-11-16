#!/usr/bin/env python3
"""tl_region.py -- read a box of blocks straight from region files (camunder-01, for tl_under.py `slot`). Stdlib only.

The showcase's tools are installed FLAT in /srv/showcase/bin with no access to scripts/host, so the reading logic of
scripts/host/townplan_blockdump.py lives here: `section_values` and `name_of` are that file's functions, verbatim
(test_tl_under.py compares the source text while both files are in the checkout, so the copy cannot drift unnoticed).
Its NBT reader is NOT copied: this one runs unattended every 15 minutes on files another process rewrites, so

  read_nbt_safe  returns what townplan_blockdump.read_nbt returns for a well-formed chunk (tested against it), and
                 raises BadChunk for anything else: a length that runs past the buffer (checked BEFORE anything is
                 allocated), a negative length, an unknown tag, nesting past MAX_NBT_DEPTH, more than MAX_NBT_ITEMS
                 values in all;
  chunk_at       the region header maths of townplan_blockdump.chunk, but it SEEKS to the one chunk instead of reading
                 the whole .mca, reads at most the chunk's own sectors (the format's limit: 255 sectors, under 1 MiB),
                 inflates with a hard cap (MAX_NBT_BYTES), and checks the chunk says it is the chunk asked for (xPos,
                 zPos). Whatever is wrong, the answer is None (the chunk is MISSING), never an exception;
  section_cells  a section's palette and its 4096 indices, or BadChunk: the data array must be exactly as long as the
                 palette's bit width needs and no index may point past the palette. Nothing is padded;
  section_bytes  the indices by whole-array integer arithmetic (16 big-integer shifts instead of 4096 Python steps);
                 the same values as section_values (tested for every bit width);
  read_box       a box of block names in the dump's own layout (x fastest, then z, then y), one palette, 8 bits.
                 A missing chunk and a bad section are '?' cells, and both are counted;
  write_regions  the inverse, for the tests and the bench ONLY: region files from a box (never used on a live world).

Read-only on the region files: they are opened 'rb' and nothing is written beside them.
"""
import collections, os, struct, zlib

SECTOR = 4096
MAX_NAMES = 256
MAX_SECTORS = 255                # a location entry counts a chunk's sectors in ONE byte: in the file it is under 1 MiB
MAX_NBT_BYTES = 16 << 20         # what one chunk may inflate to (a real one is 0.05-2 MB)
MAX_NBT_ITEMS = 1_000_000        # list elements, array elements and compound entries of one chunk, all told
MAX_NBT_DEPTH = 64               # nesting (a real chunk is under 12 deep)


class BadChunk(ValueError):
    """A chunk or a section that is not what the format says: it is MISSING, it is never guessed at."""


# ---------------------------------------------------------------- NBT, with every length checked
_FIXED = {1: ('>b', 1), 2: ('>h', 2), 3: ('>i', 4), 4: ('>q', 8), 5: ('>f', 4), 6: ('>d', 8)}
_MIN = {0: 0, 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8, 7: 4, 8: 2, 9: 5, 10: 1, 11: 4, 12: 4}     # the least bytes one value takes


def read_nbt_safe(b, max_items=MAX_NBT_ITEMS, max_depth=MAX_NBT_DEPTH, tick=None):
    """An uncompressed NBT document -> its root compound as a dict (byte arrays as bytes, int and long arrays as
    tuples, lists as lists: what townplan_blockdump.read_nbt gives). BadChunk when it is not well formed. tick():
    called every couple of thousand values, so a caller's deadline holds inside one large chunk."""
    size = len(b)
    i = 0
    items = 0

    def need(k):
        if k < 0 or i + k > size:
            raise BadChunk('NBT: a value runs past the end of the chunk')

    def count(k):
        nonlocal items
        before = items
        items += k
        if items > max_items:
            raise BadChunk(f'NBT: more than {max_items} values')
        if tick is not None and (items >> 11) != (before >> 11):
            tick()

    def payload(t, depth):
        nonlocal i
        if t in _FIXED:
            fmt, k = _FIXED[t]
            need(k)
            v = struct.unpack_from(fmt, b, i)[0]
            i += k
            return v
        if t == 7:
            need(4)
            n = struct.unpack_from('>i', b, i)[0]
            i += 4
            need(n)
            count(1)
            v = b[i:i + n]
            i += n
            return v
        if t == 8:
            need(2)
            n = struct.unpack_from('>H', b, i)[0]
            i += 2
            need(n)
            v = b[i:i + n].decode('utf-8', 'replace')
            i += n
            return v
        if t == 9:
            need(5)
            et = b[i]
            n = struct.unpack_from('>i', b, i + 1)[0]
            i += 5
            if et not in _MIN or n < 0 or depth >= max_depth:      # (elements of tag 0 are refused one level down)
                raise BadChunk('NBT: a list of %d of tag %d at depth %d' % (n, et, depth))
            need(n * _MIN[et])
            count(n)
            out = []
            for j in range(n):
                if tick is not None and j and not j & 2047:
                    tick()
                out.append(payload(et, depth + 1))
            return out
        if t == 10:
            if depth >= max_depth:
                raise BadChunk('NBT: nested deeper than %d' % max_depth)
            d = {}
            while True:
                need(1)
                tt = b[i]
                i += 1
                if tt == 0:
                    return d
                need(2)
                n = struct.unpack_from('>H', b, i)[0]
                i += 2
                need(n)
                k = b[i:i + n].decode('utf-8', 'replace')
                i += n
                count(1)
                d[k] = payload(tt, depth + 1)
        if t in (11, 12):
            w = 4 if t == 11 else 8
            need(4)
            n = struct.unpack_from('>i', b, i)[0]
            i += 4
            need(n * w)                                        # a negative length fails here too
            count(n)
            v = struct.unpack_from('>%d%s' % (n, 'i' if t == 11 else 'q'), b, i)
            i += n * w
            return v
        raise BadChunk('NBT: tag %d' % t)
    need(3)
    if b[0] != 10:
        raise BadChunk('NBT: the root is tag %d, not a compound' % b[0])
    n = struct.unpack_from('>H', b, 1)[0]
    i = 3
    need(n)
    i += n
    return payload(10, 0)


def inflate(data, wbits, cap=MAX_NBT_BYTES):
    """zlib / gzip data -> at most `cap` bytes; BadChunk when it would be more, or the stream is cut short."""
    d = zlib.decompressobj(wbits)
    out = d.decompress(data, cap + 1)
    if len(out) > cap or d.unconsumed_tail:
        raise BadChunk('a chunk that inflates past %d bytes' % cap)
    if not d.eof:
        raise BadChunk('a compressed chunk that ends early')
    return out


# ---------------------------------------------------------------- the copy (scripts/host/townplan_blockdump.py)
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
        self.dir, self.files, self.bytes_read, self.why = region_dir, {}, 0, collections.Counter()

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

    def chunk_at(self, cx, cz, tick=None):
        """The chunk's NBT as a dict, or None: no region file, no such chunk, or one that is not a well-formed chunk
        at these coordinates (a file being rewritten must cost a chunk, not the slot). self.why counts the reasons.
        Never more than the chunk's own sectors are read (255 at most), never more than MAX_NBT_BYTES inflated."""
        fh = self._open(cx >> 5, cz >> 5)
        if fh is None:
            self.why['no region file'] += 1
            return None
        f, head = fh
        idx = 4 * ((cx & 31) + (cz & 31) * 32)
        sector, count = int.from_bytes(head[idx:idx + 3], 'big'), head[idx + 3]
        if sector == 0 and count == 0:
            self.why['not generated'] += 1
            return None
        try:
            if sector < 2 or count == 0:                       # the first two sectors are the file's own tables
                raise BadChunk('a location inside the header')
            f.seek(sector * SECTOR)
            blob = f.read(min(count, MAX_SECTORS) * SECTOR)
            self.bytes_read += len(blob)
            if len(blob) < 5:
                raise BadChunk('the file ends before the chunk')
            ln = int.from_bytes(blob[0:4], 'big')
            comp = blob[4]
            if ln < 2 or ln + 4 > len(blob):                   # longer than its own sectors, or than the file
                raise BadChunk('a chunk length of %d in %d bytes of sectors' % (ln, len(blob)))
            raw = blob[5:4 + ln]
            if comp == 2:
                raw = inflate(raw, zlib.MAX_WBITS)
            elif comp == 1:
                raw = inflate(raw, 16 + zlib.MAX_WBITS)
            elif comp != 3:                                    # LZ4 (4), custom (127), external .mcc (0x80 | n)
                raise BadChunk('compression type %d' % comp)
            d = read_nbt_safe(raw, tick=tick)
            if d.get('xPos') != cx or d.get('zPos') != cz or isinstance(d.get('xPos'), bool):
                raise BadChunk('the chunk stored here says it is %r, %r' % (d.get('xPos'), d.get('zPos')))
            if not isinstance(d.get('sections'), list):
                raise BadChunk('no sections')
            return d
        except (BadChunk, OSError, zlib.error, struct.error, IndexError, ValueError, TypeError, UnicodeError, MemoryError,
                RecursionError, OverflowError) as e:
            self.why['corrupt: ' + (str(e)[:60] if isinstance(e, BadChunk) else type(e).__name__)] += 1
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
    a single integer. A data array too short for 4096 values is BadChunk: nothing is padded."""
    pal = bs.get('palette') or []
    dat = bs.get('data')
    if dat is None or len(pal) <= 1:
        return None
    bits = max(4, (len(pal) - 1).bit_length())
    per = 64 // bits
    n = len(dat)
    if n * per < 4096:
        raise BadChunk('a data array of %d words for %d-bit values' % (n, bits))
    if bits > 8:
        return section_values(bs)
    big = int.from_bytes(struct.pack('<%dq' % n, *dat), 'little')
    mask = int.from_bytes(bytes([(1 << bits) - 1, 0, 0, 0, 0, 0, 0, 0]) * n, 'little')
    out = bytearray(n * per)
    for k in range(per):
        out[k::per] = ((big >> (k * bits)) & mask).to_bytes(n * 8, 'little')[0::8]
    return bytes(out[:4096])


def section_cells(bs):
    """One section's block_states -> (its palette entries, its 4096 palette indices: bytes, a list past 256 names, or
    None when one block fills it). BadChunk unless it is exactly what the format says: a palette of compounds each
    with a Name; with more than one entry, a long array of exactly ceil(4096 / (64 // bits)) words; and no index past
    the palette. A wrong section must never be drawn as plausible blocks."""
    if not isinstance(bs, dict):
        raise BadChunk('block_states is not a compound')
    pal, dat = bs.get('palette'), bs.get('data')
    if not isinstance(pal, list) or not 1 <= len(pal) <= 4096:
        raise BadChunk('no palette')
    for p in pal:
        if not isinstance(p, dict) or not isinstance(p.get('Name'), str) or not isinstance(p.get('Properties', {}), dict):
            raise BadChunk('a palette entry without a Name')
    if len(pal) == 1:
        return pal, None
    bits = max(4, (len(pal) - 1).bit_length())
    want = -(-4096 // (64 // bits))
    if not isinstance(dat, tuple) or len(dat) != want or not all(isinstance(v, int) for v in dat[:4]):
        raise BadChunk('a palette of %d needs %d words of data, not %s' % (len(pal), want, len(dat) if isinstance(dat, tuple) else type(dat).__name__))
    vals = section_bytes(bs)
    if (vals.translate(None, bytes(range(len(pal)))) if isinstance(vals, bytes) else max(vals) >= len(pal)):
        raise BadChunk('an index past the palette')                # (bytes: whatever is left once every valid index is deleted)
    return pal, vals


def read_box(region_dir, x0, z0, x1, z1, y0, y1, fold=None, max_real=190, absent=None, tick=None):
    """Every block name in a box (inclusive), read from the region files. -> {box, y, palette, cells, bits: 8,
    missing: [[cx, cz], ...], missing_why: {reason: n}, bad_sections, chunks, folded, bytes_read}; cells is one
    palette index per cell, x fastest, then z, then y, exactly as townplan_blockdump writes a dump. A chunk that is
    absent, not fully generated, stored at other coordinates or not well formed is listed in `missing` and its cells
    are '?' (index 0); a section that is not well formed (section_cells) is '?' too and counted in `bad_sections`.
    A section a full chunk does not carry is '?' as in townplan_blockdump (its planner must never take unknown for
    air), unless `absent` names the block to read there (tl_under passes 'air': to the game a section that is not
    stored IS air, and a picture's sky must not be unknown). tick(): called before every chunk and inside a large
    one, so the caller's deadline can stop the read (whatever tick raises comes straight out).

    One byte per cell: past max_real names a new name is stored as fold(name) (tl_under folds it to '#<class>', which
    draws the same); with no fold it becomes '?'. `folded` counts the names that lost their spelling."""
    nx, nz, ny = x1 - x0 + 1, z1 - z0 + 1, y1 - y0 + 1
    palette, index = ['?'], {'?': 0}
    cells = bytearray(nx * nz * ny)
    missing, folded, nchunks, bad_sections = [], set(), 0, 0
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
                if tick is not None:
                    tick()
                ch = R.chunk_at(cx, cz, tick)
                if ch is not None and ch.get('Status', 'minecraft:full') not in ('minecraft:full', 'full'):
                    R.why['not fully generated'] += 1
                    ch = None
                if ch is None:
                    missing.append([cx, cz])
                    continue
                nchunks += 1
                lz0, lz1 = max(z0, cz * 16) - cz * 16, min(z1, cz * 16 + 15) - cz * 16
                secs = {}
                for s in ch['sections']:                         # a section that is not a compound with a Y is no section
                    if isinstance(s, dict) and isinstance(s.get('Y'), int) and not isinstance(s.get('Y'), bool):
                        secs[s['Y']] = s.get('block_states')
                    else:
                        bad_sections += 1
                for sy in range(y0 >> 4, (y1 >> 4) + 1):
                    if sy not in secs:
                        if absent is None:
                            continue
                        entries, sec = [{'Name': absent}], None
                    else:
                        try:
                            entries, sec = section_cells(secs[sy])
                        except BadChunk:
                            bad_sections += 1                    # its cells stay '?': unknown, never a guess
                            continue
                    pal = [idx(name_of(p)) for p in entries]
                    ly0, ly1 = max(y0, sy * 16) - sy * 16, min(y1, sy * 16 + 15) - sy * 16
                    if sec is None:                              # one block fills the section
                        row = bytes([pal[0]]) * w
                        for ly in range(ly0, ly1 + 1):
                            base = ((sy * 16 + ly - y0) * nz + cz * 16 - z0) * nx + dx
                            for lz in range(lz0, lz1 + 1):
                                o = base + lz * nx
                                cells[o:o + w] = row
                        continue
                    if isinstance(sec, list):
                        sec = bytes(pal[v] for v in sec)
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
            'missing': missing, 'missing_why': dict(R.why), 'bad_sections': bad_sections, 'chunks': nchunks,
            'folded': len(folded), 'bytes_read': R.bytes_read}


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
            nbt = chunk_nbt(cx, cz, secs, extra=[_tag(3, 'yPos', struct.pack('>i', sections[0])),
                                                 _tag(4, 'InhabitedTime', struct.pack('>q', 12345))] + ([hm, be] if baggage else []))
            regions.setdefault((cx >> 5, cz >> 5), {})[(cx & 31, cz & 31)] = zlib.compress(nbt, 6)
    os.makedirs(region_dir, exist_ok=True)
    out = []
    for (rx, rz), chunks in sorted(regions.items()):
        p = os.path.join(region_dir, 'r.%d.%d.mca' % (rx, rz))
        write_region_file(p, {k: b'\x02' + comp for k, comp in chunks.items()})
        out.append(p)
    return out


def chunk_nbt(cx, cz, sections, status='minecraft:full', extra=()):
    """An uncompressed chunk document from ready-made section payloads (tests build odd ones with this)."""
    top = [_tag(3, 'DataVersion', struct.pack('>i', 3953)), _tag(3, 'xPos', struct.pack('>i', cx)),
           _tag(3, 'zPos', struct.pack('>i', cz)), _tag(8, 'Status', _s(status)),
           _tag(9, 'sections', bytes([10]) + struct.pack('>i', len(sections)) + b''.join(sections))] + list(extra)
    return bytes([10]) + _s('') + _compound(top)


def write_region_file(path, chunks, lengths=None):
    """One region file from {(local x, local z): compression byte + stored bytes}. lengths: {(lx, lz): the length
    field to write instead of the true one} (tests of corrupt files). FOR TESTS."""
    head = bytearray(SECTOR * 2)
    body = bytearray()
    for (lx, lz), stored in sorted(chunks.items()):
        ln = (lengths or {}).get((lx, lz), len(stored))
        blob = struct.pack('>I', ln) + stored
        blob += bytes(-len(blob) % SECTOR)
        i = 4 * (lx + lz * 32)
        head[i:i + 3] = (2 + len(body) // SECTOR).to_bytes(3, 'big')
        head[i + 3] = min(255, len(blob) // SECTOR)
        body += blob
    with open(path, 'wb') as f:
        f.write(bytes(head) + bytes(body))
