#!/usr/bin/env python3
"""wholemap.py -- whole-map expeditions stage S0 (instruments). ON THE SHOWCASE VM, as mike, nice 19. READ-ONLY on the world.

    wholemap.py full     # region scan + skill-log walk + trips -> coverage.json, BlueMap layer, one shipped row (daily)
    wholemap.py trips    # trips + BlueMap layer + one shipped row, reusing the last scan's coverage numbers (hourly)
    wholemap.py full --dry-run   # compute and print; write nothing

Design: docs/reports/wholemap-expeditions-design-2026-11-01.md sections 4 (S0) and 8 (the metric). Ledger row wholemap-s0.

What it measures, and over what (every run PRINTS each number with its denominator):

  seen%   chunks with InhabitedTime > 0 (a player kept the chunk loaded: the server's own counter, read from the region
          files) that are REACHABLE, over reachable chunks. Reachable = a chunk with >= 1 land or ice column that the walk
          flood fill from home reaches with the tiers in force for the metric (land + ice + swim <= 24, design s.8).
          Two denominators: the generated square (measured exactly) and the world border, where every UNGENERATED chunk
          counts at the generated area's measured share of chunks with a land or ice column (design: 15,199 / 17,176 =
          88.5%) until it is generated. The raw border area (626 x 626 = 391,876 chunks) is printed beside it.
  stood%  chunks a bot stood in: bot.pos of every row in the bots' skill logs (live + rotated, full walks), kept as a
          cumulative set in the state dir so log rotation cannot shrink it. Stricter than seen.
  reach   the walkable-surface flood fill over columns from home (0, 0): tiers land / +ice / +shallow (< 3 deep) /
          +swim24 (water within 12 of a shore: a crossing of <= 24) / +swim (any water). Lava is never walkable.
  tiles   a 9 x 9 grid of 1,111-block tiles over the 10,000-wide border centred 0,0 (the copper hall floor map).

UNKNOWN IS NEVER ZERO. A region file that cannot be read, a chunk that will not parse or has no heightmaps, a skill-log
walk that finds no rows: each is COUNTED and printed, and a run whose inputs are missing or suspicious raises
ZeroLooksWrong (exit 2) instead of writing a zero. The fleetstatus line reads the shipped row and says UNKNOWN when it is
missing or stale.

The BlueMap layer: one JSON file of BlueMap 5 marker sets (points for expedition markers, lines for walked trips, a shape
per village / protected zone / town-plan plot). BlueMap 5.16's map config includes it with
`include file("<layer>")` inside `marker-sets` (install-wholemap.sh adds that line once; a MISSING include file is
ignored by HOCON, a MALFORMED one fails the render, so this script only ever writes json.dumps output, re-parses and
validates it, and replaces the file atomically with a backup). The timelapse's 15-min render rewrites
web/maps/showcase/live/markers.json from the config, so the layer goes live within one capture: no restart, no plugin.
Stdlib only.
"""
import argparse
import datetime as dt
import glob
import gzip
import json
import math
import os
import re
import shutil
import struct
import sys
import zlib
from array import array

# ---------------------------------------------------------------------------------------------------------------- config
WORLD_REGION = '/srv/showcase/server/world/region'
POOL = '/var/lib/mcai/_pool-showcase'
LOGS = '/var/log/mcai/showcase-*/skill-showcase-*.jsonl*'
STATE = '/srv/showcase/wholemap'
LAYER = '/srv/showcase/wholemap/bluemap-markers.json'
SHIP = '/var/log/showcase/heartbeat.jsonl'
TOWN = 'expedition-0_70_0'
HOME = (0, 0)
BORDER_WIDTH = 10000          # `worldborder get` 11-01: "currently 10000 block(s) wide", centre 0 0 (design s.1.1)
BORDER_CENTER = (0, 0)
TILES = 9                     # 9 x 9 tiles of 10000/9 = 1,111 blocks
MIN_Y = -64                   # overworld bottom (heightmap values are relative to it)
SHALLOW_MAX = 2               # water < 3 deep is wading
SWIM_MAX = 24                 # design s.8: swim <= 24; a water column is within 12 of a shore
STAGE_RADII = (300, 1000)
S1_RING, S1_TRIPS, S1_WINDOW_H = 300, 3, 72
BOT_NAME = re.compile(r'^showcase-[A-Z][a-z]+$')    # excludes showcase-FIXTURE (a test bot, not a real walker)

# column classes
UNK, LAND, ICE, SHALLOW, DEEP, LAVA = 0, 1, 2, 3, 4, 5
CLASS_NAMES = {UNK: 'unknown', LAND: 'land', ICE: 'ice', SHALLOW: 'shallow', DEEP: 'deep', LAVA: 'lava'}
ICE_BLOCKS = {'minecraft:ice', 'minecraft:packed_ice', 'minecraft:blue_ice', 'minecraft:frosted_ice'}
WATER_TOPS = {'minecraft:water', 'minecraft:bubble_column', 'minecraft:kelp', 'minecraft:kelp_plant',
              'minecraft:seagrass', 'minecraft:tall_seagrass', 'minecraft:lily_pad'}
LAVA_TOPS = {'minecraft:lava'}
# tiers: name -> classes walkable (swim24 adds the near-shore water mask, see reach())
TIERS = ('land', 'ice', 'shallow', 'swim24', 'swim')
TIER_CLASSES = {'land': {LAND}, 'ice': {LAND, ICE}, 'shallow': {LAND, ICE, SHALLOW},
                'swim24': {LAND, ICE, SHALLOW}, 'swim': {LAND, ICE, SHALLOW, DEEP}}
METRIC_TIER = 'swim24'


class ZeroLooksWrong(LookupError):
    """A zero (or an empty input) that is probably a reading bug rather than a finding."""


# ------------------------------------------------------------------------------------------------------------------- NBT
class Raw:
    """A lazily decoded NBT array (byte / int / long array): the big-endian bytes and the element width."""
    __slots__ = ('b', 'w')

    def __init__(self, b, w):
        self.b, self.w = b, w

    def __len__(self):
        return len(self.b) // self.w

    def u64(self, i):
        return int.from_bytes(self.b[i * 8:i * 8 + 8], 'big')

    def values(self):
        a = array({1: 'b', 4: 'i', 8: 'q'}[self.w])
        a.frombytes(bytes(self.b))
        if sys.byteorder == 'little' and self.w > 1:
            a.byteswap()
        return list(a)


def parse_nbt(b):
    """Parse an uncompressed NBT blob -> the root compound as a dict. Arrays stay Raw (decoded on demand), so a chunk
    with big block_states parses in well under a millisecond per section. Pure. Raises ValueError on a bad tag."""
    mv = memoryview(b)
    pos = 0

    def payload(t):
        nonlocal pos
        if t == 1:
            v = struct.unpack_from('>b', mv, pos)[0]; pos += 1; return v
        if t == 2:
            v = struct.unpack_from('>h', mv, pos)[0]; pos += 2; return v
        if t == 3:
            v = struct.unpack_from('>i', mv, pos)[0]; pos += 4; return v
        if t == 4:
            v = struct.unpack_from('>q', mv, pos)[0]; pos += 8; return v
        if t == 5:
            v = struct.unpack_from('>f', mv, pos)[0]; pos += 4; return v
        if t == 6:
            v = struct.unpack_from('>d', mv, pos)[0]; pos += 8; return v
        if t in (7, 11, 12):
            n = struct.unpack_from('>i', mv, pos)[0]; pos += 4
            w = {7: 1, 11: 4, 12: 8}[t]
            if n < 0 or pos + n * w > len(mv):
                raise ValueError(f'array of {n} runs past the end')
            v = Raw(mv[pos:pos + n * w], w); pos += n * w; return v
        if t == 8:
            n = struct.unpack_from('>H', mv, pos)[0]; pos += 2
            v = bytes(mv[pos:pos + n]).decode('utf-8', 'replace'); pos += n; return v
        if t == 9:
            et = mv[pos]; pos += 1
            n = struct.unpack_from('>i', mv, pos)[0]; pos += 4
            if n > 0 and et == 0:
                raise ValueError('non-empty list of TAG_End')
            return [payload(et) for _ in range(max(n, 0))]
        if t == 10:
            d = {}
            while True:
                tt = mv[pos]; pos += 1
                if tt == 0:
                    return d
                n = struct.unpack_from('>H', mv, pos)[0]; pos += 2
                k = bytes(mv[pos:pos + n]).decode('utf-8', 'replace'); pos += n
                d[k] = payload(tt)
        raise ValueError(f'bad NBT tag {t} at {pos}')

    if not len(mv):
        raise ValueError('empty NBT')
    t = mv[0]; pos = 1
    if t != 10:
        raise ValueError(f'root tag {t} is not a compound')
    n = struct.unpack_from('>H', mv, pos)[0]; pos += 2 + n
    return payload(10)


def decompress_chunk(comp, data):
    """Region chunk payload -> NBT bytes. 1 gzip, 2 zlib, 3 none. Anything else (lz4 = 4, external .mcc = +128)
    raises ValueError so the chunk is counted UNREADABLE, never read as empty."""
    if comp == 2:
        return zlib.decompress(data)
    if comp == 1:
        return gzip.decompress(data)
    if comp == 3:
        return bytes(data)
    raise ValueError(f'compression {comp} not supported')


def region_chunks(path):
    """Yield (cx, cz, nbt_dict | Exception) for every chunk present in one .mca file. The file is read whole (Paper
    may be writing it; a torn chunk raises and is counted unreadable). Absent slots are skipped (= not generated)."""
    m = re.search(r'r\.(-?\d+)\.(-?\d+)\.mca$', path)
    if not m:
        raise ValueError(f'not a region file name: {path}')
    rx, rz = int(m.group(1)), int(m.group(2))
    data = open(path, 'rb').read()
    if len(data) < 8192:
        if len(data) == 0:
            return
        raise ValueError(f'{path}: {len(data)} bytes, shorter than the 8 KiB header')
    for i in range(1024):
        ent = data[i * 4:i * 4 + 4]
        off = int.from_bytes(ent[:3], 'big') * 4096
        if off == 0:
            continue
        cx, cz = rx * 32 + (i & 31), rz * 32 + (i >> 5)
        try:
            ln = int.from_bytes(data[off:off + 4], 'big')
            if ln < 1 or off + 4 + ln > len(data):
                raise ValueError(f'chunk length {ln} runs past the file')
            yield cx, cz, parse_nbt(decompress_chunk(data[off + 4], data[off + 5:off + 4 + ln]))
        except Exception as e:                     # noqa: BLE001 -- counted as unreadable by the caller
            yield cx, cz, e


# --------------------------------------------------------------------------------------------------- chunk classification
def packed_get(raw, bits, i):
    """Entry i of a 1.16+ packed long array (entries never span longs). Pure."""
    per = 64 // bits
    return (raw.u64(i // per) >> ((i % per) * bits)) & ((1 << bits) - 1)


def heightmap(raw, height=384):
    """256 values of a heightmap long array, or None when its length does not match the world height (unknown)."""
    bits = max(1, (height).bit_length())          # 384 -> 9 bits (values 0..384)
    per = 64 // bits
    if raw is None or len(raw) != -(-256 // per):
        return None
    return [packed_get(raw, bits, i) for i in range(256)]


def block_at(sections, y, x, z):
    """Block name at local x/z, absolute y, from a chunk's sections; None when the section is absent (unknown)."""
    sy = y >> 4
    sec = sections.get(sy)
    if sec is None:
        return None
    bs = sec.get('block_states') or {}
    pal = bs.get('palette') or []
    if not pal:
        return None
    if len(pal) == 1:
        return pal[0].get('Name')
    data = bs.get('data')
    if data is None:
        return None
    bits = max(4, (len(pal) - 1).bit_length())
    idx = packed_get(data, bits, ((y & 15) * 16 + z) * 16 + x)
    return pal[idx].get('Name') if idx < len(pal) else None


def classify_column(top, ws_y, of_y):
    """One column's surface class from its top block and heightmaps. ws_y: the top non-air block's y; of_y: the top
    motion-blocking non-fluid block's y (OCEAN_FLOOR - 1). Pure."""
    if top is None or ws_y is None:
        return UNK
    if top in ICE_BLOCKS:
        return ICE
    if top in LAVA_TOPS:
        return LAVA
    if top in WATER_TOPS:
        if of_y is None:
            return UNK
        return SHALLOW if ws_y - of_y <= SHALLOW_MAX else DEEP
    return LAND


def chunk_summary(nbt, min_y=MIN_Y):
    """-> {'status', 'inhabited', 'classes': bytes(256) (index z*16+x)} or raises ValueError when the chunk cannot be
    classified (not full, no heightmaps, bad lengths). Pure."""
    if not isinstance(nbt, dict):
        raise ValueError('chunk NBT is not a compound')
    status = str(nbt.get('Status', '')).replace('minecraft:', '')
    inhabited = nbt.get('InhabitedTime')
    if not isinstance(inhabited, int):
        raise ValueError('no InhabitedTime')
    out = {'status': status, 'inhabited': inhabited, 'classes': None}
    if status != 'full':
        return out
    hm = nbt.get('Heightmaps') or {}
    ws = heightmap(hm.get('WORLD_SURFACE'))
    of = heightmap(hm.get('OCEAN_FLOOR'))
    if ws is None or of is None:
        raise ValueError('full chunk without WORLD_SURFACE / OCEAN_FLOOR heightmaps')
    sections = {}
    for s in nbt.get('sections') or []:
        if isinstance(s, dict) and 'Y' in s:
            sections[int(s['Y'])] = s
    cls = bytearray(256)
    for z in range(16):
        for x in range(16):
            i = z * 16 + x
            if ws[i] == 0:
                cls[i] = UNK
                continue
            wy = min_y + ws[i] - 1
            oy = min_y + of[i] - 1
            cls[i] = classify_column(block_at(sections, wy, x, z), wy, oy)
    out['classes'] = bytes(cls)
    return out


# ------------------------------------------------------------------------------------------------------------ the grid
class Grid:
    """Columns of the generated area: one class byte per column, UNK where not generated or unreadable."""

    def __init__(self, cx0, cz0, cx1, cz1):
        self.cx0, self.cz0 = cx0, cz0
        self.w = (cx1 - cx0 + 1) * 16
        self.h = (cz1 - cz0 + 1) * 16
        self.x0, self.z0 = cx0 * 16, cz0 * 16
        self.c = bytearray(self.w * self.h)

    def put_chunk(self, cx, cz, classes):
        bx, bz = (cx - self.cx0) * 16, (cz - self.cz0) * 16
        for z in range(16):
            row = (bz + z) * self.w + bx
            self.c[row:row + 16] = classes[z * 16:z * 16 + 16]

    def idx(self, x, z):
        gx, gz = x - self.x0, z - self.z0
        if 0 <= gx < self.w and 0 <= gz < self.h:
            return gz * self.w + gx
        return None


def near_shore(grid, maxd):
    """Mask of water columns (SHALLOW or DEEP) within `maxd` steps, through water, of a land or ice column: the water a
    swim of <= 2*maxd can cross. Multi-source BFS. Pure over the grid."""
    w, h, c = grid.w, grid.h, grid.c
    dist = bytearray(b'\xff') * (w * h)
    q = array('i')
    for i, v in enumerate(c):
        if v == LAND or v == ICE:
            dist[i] = 0
            q.append(i)
    head = 0
    while head < len(q):
        i = q[head]; head += 1
        d = dist[i]
        if d >= maxd:
            continue
        x = i % w
        for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, i - w, i + w):
            if 0 <= j < w * h and dist[j] == 255 and (c[j] == SHALLOW or c[j] == DEEP):
                dist[j] = d + 1
                q.append(j)
    m = bytearray(w * h)
    for i, d in enumerate(dist):
        if 0 < d <= maxd:
            m[i] = 1
    return m


def flood(grid, start, passable):
    """4-connected flood fill over columns from `start` (a grid index) through columns where passable[i] is true.
    -> bytearray reached mask. Pure."""
    w, h = grid.w, grid.h
    seen = bytearray(w * h)
    if start is None or not passable[start]:
        return seen
    q = array('i', [start])
    seen[start] = 1
    head = 0
    while head < len(q):
        i = q[head]; head += 1
        x = i % w
        for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, i - w, i + w):
            if 0 <= j < w * h and not seen[j] and passable[j]:
                seen[j] = 1
                q.append(j)
    return seen


def passable_mask(grid, tier, shore=None):
    ok = TIER_CLASSES[tier]
    lut = bytes(1 if k in ok else 0 for k in range(256))
    m = bytearray(grid.c.translate(lut))
    if tier == 'swim24' and shore is not None:
        for i, v in enumerate(shore):
            if v:
                m[i] = 1
    return m


def find_start(grid, home, passable, radius=16):
    """The home column, or the nearest passable column within `radius` (home may be a building's water feature)."""
    best = None
    for dz in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            i = grid.idx(home[0] + dx, home[1] + dz)
            if i is not None and passable[i]:
                d = dx * dx + dz * dz
                if best is None or d < best[0]:
                    best = (d, i)
    return best[1] if best else None


def reach(grid, home=HOME):
    """Flood each tier from home. -> {tier: {'reached': mask, 'land_cols': n, 'cols': n}}, plus totals. Pure."""
    shore = near_shore(grid, SWIM_MAX // 2)
    land_total = sum(1 for v in grid.c if v == LAND)
    out = {'_land_cols': land_total, '_landice_cols': sum(1 for v in grid.c if v in (LAND, ICE))}
    for tier in TIERS:
        pm = passable_mask(grid, tier, shore)
        r = flood(grid, find_start(grid, home, pm), pm)
        land = sum(1 for i, v in enumerate(r) if v and grid.c[i] == LAND)
        landice = sum(1 for i, v in enumerate(r) if v and grid.c[i] in (LAND, ICE))
        out[tier] = {'reached': r, 'land_cols': land, 'landice_cols': landice, 'cols': sum(r)}
    return out


def reachable_chunks(grid, reached):
    """Chunks with >= 1 LAND or ICE column inside `reached`. -> set of (cx, cz). Pure."""
    out = set()
    w = grid.w
    for i, v in enumerate(reached):
        if v and grid.c[i] in (LAND, ICE):
            out.add((grid.cx0 + (i % w) // 16, grid.cz0 + (i // w) // 16))
    return out


# --------------------------------------------------------------------------------------------- border, denominators, tiles
def border_chunk_range(width=BORDER_WIDTH, center=BORDER_CENTER):
    """Inclusive chunk ranges inside the border: ((cx_lo, cx_hi), (cz_lo, cz_hi)). Width 10000 at 0,0 -> -313..312,
    626 chunks per axis (design s.1.1, r2). Pure."""
    half = width / 2
    xs = (math.floor((center[0] - half) / 16), math.floor((center[0] + half - 1e-9) / 16))
    zs = (math.floor((center[1] - half) / 16), math.floor((center[1] + half - 1e-9) / 16))
    return xs, zs


def in_border(cx, cz, rng):
    (x0, x1), (z0, z1) = rng
    return x0 <= cx <= x1 and z0 <= cz <= z1


def denominators(generated, landice, reachable, rng):
    """The metric's denominators. generated / landice / reachable: sets of (cx, cz) (full chunks; those with a land or
    ice column; the reachable ones). Ungenerated border chunks count at the measured land-or-ice share. Pure."""
    (x0, x1), (z0, z1) = rng
    border = (x1 - x0 + 1) * (z1 - z0 + 1)
    gen_in = sum(1 for c in generated if in_border(*c, rng))
    landice_in = sum(1 for c in landice if in_border(*c, rng))
    reach_in = sum(1 for c in reachable if in_border(*c, rng))
    if gen_in == 0:
        raise ZeroLooksWrong('no generated chunk inside the border: the region scan read nothing usable')
    share = landice_in / gen_in
    ungen = border - gen_in
    return {'border_chunks': border, 'generated': gen_in, 'generated_landice': landice_in,
            'generated_reachable': reach_in, 'landice_share': round(share, 4), 'ungenerated': ungen,
            'border_reachable_est': round(reach_in + share * ungen, 1)}


def pct(n, d):
    return None if not d else round(100.0 * n / d, 3)


def radius_stats(seen, reachable, generated, share, rng, r):
    """seen% inside radius r (chunk centre distance from home), over reachable generated + share x ungenerated. Pure."""
    (x0, x1), (z0, z1) = rng
    rc = r / 16.0
    lo_x, hi_x = max(x0, math.floor(-rc) - 1), min(x1, math.ceil(rc) + 1)
    lo_z, hi_z = max(z0, math.floor(-rc) - 1), min(z1, math.ceil(rc) + 1)
    n_reach = n_seen = n_ungen = 0
    for cx in range(lo_x, hi_x + 1):
        for cz in range(lo_z, hi_z + 1):
            if math.hypot(cx * 16 + 8 - HOME[0], cz * 16 + 8 - HOME[1]) > r:
                continue
            if (cx, cz) in reachable:
                n_reach += 1
                if (cx, cz) in seen:
                    n_seen += 1
            elif (cx, cz) not in generated:
                n_ungen += 1
    den = n_reach + share * n_ungen
    return {'radius': r, 'seen': n_seen, 'reachable_generated': n_reach, 'ungenerated': n_ungen,
            'denominator': round(den, 1), 'seen_pct': pct(n_seen, den)}


def tile_of(cx, cz, width=BORDER_WIDTH, center=BORDER_CENTER, n=TILES):
    """(i, j) of the 1,111-block tile holding chunk (cx, cz)'s centre, 0..n-1 west->east / north->south; None outside.
    Pure."""
    size = width / n
    lo_x, lo_z = center[0] - width / 2, center[1] - width / 2
    # a chunk straddling the border's east/south edge has its centre ON the edge: clamp it into the last tile
    x = min(cx * 16 + 8, lo_x + width - 0.5) if cx * 16 < lo_x + width else cx * 16 + 8
    z = min(cz * 16 + 8, lo_z + width - 0.5) if cz * 16 < lo_z + width else cz * 16 + 8
    i = math.floor((x - lo_x) / size)
    j = math.floor((z - lo_z) / size)
    return (i, j) if 0 <= i < n and 0 <= j < n else None


def tiles(generated, reachable, seen, stood, share, rng, n=TILES):
    """Per tile: chunks, generated, reachable, seen, stood, denominator (reachable + share x ungenerated), seen_pct.
    seen_pct is None (UNKNOWN, not 0) for a tile with no denominator. Pure."""
    t = {}
    (x0, x1), (z0, z1) = rng
    for cx in range(x0, x1 + 1):
        for cz in range(z0, z1 + 1):
            k = tile_of(cx, cz, n=n)
            if k is None:
                continue
            e = t.setdefault(k, {'chunks': 0, 'generated': 0, 'reachable': 0, 'seen': 0, 'stood': 0})
            e['chunks'] += 1
            c = (cx, cz)
            if c in generated:
                e['generated'] += 1
            if c in reachable:
                e['reachable'] += 1
                if c in seen:
                    e['seen'] += 1
            if c in stood:
                e['stood'] += 1
    out = []
    for (i, j), e in sorted(t.items()):
        den = e['reachable'] + share * (e['chunks'] - e['generated'])
        out.append(dict(e, i=i, j=j, denominator=round(den, 1), seen_pct=pct(e['seen'], den),
                        measured=e['generated'] == e['chunks']))
    return out


# --------------------------------------------------------------------------------------------------------- the skill logs
def open_log(p):
    return gzip.open(p, 'rt', errors='replace') if p.endswith('.gz') else open(p, errors='replace')


def log_positions(paths, since=None):
    """Walk every skill log (live + rotated, full walks; `grep -a` style: text with errors replaced, a bad line
    skipped). Yields (bot, t_ms, x, y, z). `since` (epoch s) skips rotated files whose mtime is older (a rotated file
    cannot hold a row newer than its mtime). Counts go in the returned stats dict via the generator's caller."""
    for p in sorted(paths):
        if since is not None:
            try:
                if os.path.getmtime(p) < since:
                    continue
            except OSError:
                continue
        try:
            fh = open_log(p)
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"pos"' not in line:
                    continue
                try:
                    d = json.loads(line)
                    b = d.get('bot') or {}
                    pos = b.get('pos') or {}
                    name = b.get('name') or ''
                    t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                    yield name, int(t.timestamp() * 1000), float(pos['x']), float(pos['y']), float(pos['z'])
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue


def stood_from_positions(rows):
    """-> (set of (cx, cz), stats). Rows from bots that are not real showcase bots (FIXTURE) are dropped and counted."""
    chunks, bots, n, skipped, t0, t1 = set(), set(), 0, 0, None, None
    for name, t, x, _y, z in rows:
        if not BOT_NAME.match(name):
            skipped += 1
            continue
        n += 1
        bots.add(name)
        chunks.add((math.floor(x) >> 4, math.floor(z) >> 4))
        t0 = t if t0 is None or t < t0 else t0
        t1 = t if t1 is None or t > t1 else t1
    return chunks, {'rows': n, 'bots': len(bots), 'skipped_rows': skipped, 'first_ms': t0, 'last_ms': t1}


# --------------------------------------------------------------------------------------------------------------- trips
def read_jsonl(path):
    out = []
    try:
        with open(path, errors='replace') as fh:
            for line in fh:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        return None
    return out


def trip_start_ms(trip_id):
    """A trip id is '<bot>-<base36 start ms>'. -> int ms or None. Pure."""
    try:
        return int(str(trip_id).rsplit('-', 1)[1], 36)
    except (IndexError, ValueError):
        return None


def trip_stats(trips, now_ms):
    """The scoreboard numbers from trips.jsonl rows. Pure. home% = trips that came home (returned true, in their own
    call or later) over trips closed in 24 h. S1 k = bearings with >= 3 trips reaching >= 300 blocks in 72 h."""
    day = [r for r in trips if isinstance(r.get('t'), (int, float)) and now_ms - 86_400_000 <= r['t'] <= now_ms]
    win = [r for r in trips if isinstance(r.get('t'), (int, float)) and now_ms - S1_WINDOW_H * 3_600_000 <= r['t'] <= now_ms]
    home = sum(1 for r in day if r.get('returned') is True)
    far = {}
    for r in win:
        if (r.get('dist') or 0) >= S1_RING and r.get('bearing') is not None:
            far[r['bearing']] = far.get(r['bearing'], 0) + 1
    newest = max((r['t'] for r in trips if isinstance(r.get('t'), (int, float))), default=None)
    return {'trips_total': len(trips), 'trips_24h': len(day), 'home_24h': home, 'home_pct_24h': pct(home, len(day)),
            'furthest_24h': max((r.get('dist') or 0 for r in day), default=None),
            'furthest_ever': max((r.get('dist') or 0 for r in trips), default=None),
            's1_bearings': sum(1 for v in far.values() if v >= S1_TRIPS),
            's1_trips_by_bearing': {str(k): v for k, v in sorted(far.items())},
            'newest_trip_ms': newest}


def trails(trips, positions_by_bot, max_points=200):
    """A walked line per trip: the bot's logged positions from the trip's start (its id) to its close (t). Trips with
    fewer than 2 positions get no line. -> {trip_id: [[x, y, z], ...]}. Pure."""
    out = {}
    for r in trips:
        tid, bot, t1 = r.get('id'), r.get('by'), r.get('t')
        t0 = trip_start_ms(tid)
        if not tid or not bot or t0 is None or not isinstance(t1, (int, float)):
            continue
        pts = [p for p in positions_by_bot.get(bot, ()) if t0 <= p[0] <= t1 + 5000]
        pts.sort()
        line = [[round(p[1], 1), round(p[2], 1), round(p[3], 1)] for p in pts]
        if len(line) > max_points:
            step = len(line) / max_points
            line = [line[int(k * step)] for k in range(max_points - 1)] + [line[-1]]
        if len(line) >= 2:
            out[tid] = line
    return out


# ----------------------------------------------------------------------------------------------------------- BlueMap layer
REASON_COLOR = {'reached': (60, 200, 80), 'zone': (230, 60, 60), 'water': (40, 120, 255), 'time': (240, 200, 40),
                'blocked': (160, 90, 40), 'interrupted': (150, 150, 150)}


def color(rgb, a=1.0):
    return {'r': rgb[0], 'g': rgb[1], 'b': rgb[2], 'a': a}


def box_shape(x0, z0, x1, z1):
    return [{'x': x0, 'z': z0}, {'x': x1 + 1, 'z': z0}, {'x': x1 + 1, 'z': z1 + 1}, {'x': x0, 'z': z1 + 1}]


def build_marker_sets(markers, trips, trail_lines, zones, plan):
    """BlueMap 5 marker sets (the map config's `marker-sets` keys). Pure. Keys are stable ids, so a marker keeps its
    place in the menu across runs."""
    pts = {}
    for k, m in enumerate(markers or []):
        at = m.get('at')
        if not (isinstance(at, list) and len(at) == 3):
            continue
        pts[f'm{k}'] = {'type': 'poi', 'position': {'x': at[0] + 0.5, 'y': at[1] + 1, 'z': at[2] + 0.5},
                        'label': f'marker b{m.get("bearing")} @{m.get("dist")} ({m.get("by", "?").replace("showcase-", "")})',
                        'detail': f'expedition marker, bearing {m.get("bearing")}, {m.get("dist")} blocks out, '
                                  f'trip {m.get("trip")}{", torch" if m.get("torch") else ""}',
                        'max-distance': 3000}
    lines = {}
    by_id = {r.get('id'): r for r in trips or []}
    for tid, line in sorted(trail_lines.items()):
        r = by_id.get(tid, {})
        reason = str(r.get('reason') or '?')
        lines['t-' + re.sub(r'[^A-Za-z0-9_-]', '_', tid)] = {
            'type': 'line', 'position': {'x': line[0][0], 'y': line[0][1], 'z': line[0][2]},
            'line': [{'x': p[0], 'y': p[1] + 0.2, 'z': p[2]} for p in line],
            'label': f'trip b{r.get("bearing")} {r.get("dist")} blocks: {reason}',
            'detail': f'{tid} by {r.get("by")}: bearing {r.get("bearing")}, {r.get("dist")} blocks, turned on {reason}, '
                      f'home {r.get("returned")} via {r.get("via")}',
            'line-width': 3, 'line-color': color(REASON_COLOR.get(reason, (255, 140, 0))), 'depth-test': False,
            'max-distance': 4000}
    zs = {}
    for z in zones or []:
        b = z.get('box')
        if not (isinstance(b, list) and len(b) == 6):
            continue
        x0, y0, z0, x1, y1, z1 = b
        under = y1 < 50
        zs[re.sub(r'[^A-Za-z0-9_-]', '_', str(z.get('id')))] = {
            'type': 'shape', 'position': {'x': (x0 + x1) / 2, 'y': 70, 'z': (z0 + z1) / 2},
            'shape': box_shape(x0, z0, x1, z1), 'shape-y': 72 if under else (z.get('floor_y') or 64) + 10,
            'label': f'{z.get("kind")}: {z.get("label") or z.get("id")}' + (f' (underground, y {y0}..{y1})' if under else ''),
            'detail': f'protected zone {z.get("id")} ({z.get("kind")}), box x {x0}..{x1} z {z0}..{z1} y {y0}..{y1}',
            'line-width': 2, 'line-color': color((230, 60, 60) if not under else (180, 80, 220)),
            'fill-color': color((230, 60, 60) if not under else (180, 80, 220), 0.15), 'depth-test': False,
            'max-distance': 6000}
    plots = {}
    for p in (plan or {}).get('plots') or []:
        b = p.get('box')
        if not (isinstance(b, list) and len(b) == 4):
            continue
        x0, z0, x1, z1 = b
        y = p.get('y') or 70
        plots['p-' + re.sub(r'[^A-Za-z0-9_-]', '_', str(p.get('id')))] = {
            'type': 'shape', 'position': {'x': (x0 + x1) / 2, 'y': y, 'z': (z0 + z1) / 2},
            'shape': box_shape(x0, z0, x1, z1), 'shape-y': y + 0.1,
            'label': f'plot {p.get("id")} ({p.get("kind")})', 'detail': f'town plan plot {p.get("id")}, {p.get("kind")}, '
                                                                        f'{p.get("state")}',
            'line-width': 1, 'line-color': color((255, 255, 255)), 'fill-color': color((255, 255, 255), 0.08),
            'depth-test': False, 'max-distance': 800}
    return {
        'wm-expeditions': {'label': 'Expeditions: markers', 'toggleable': True, 'default-hidden': False, 'sorting': 10,
                           'markers': pts},
        'wm-trails': {'label': 'Expeditions: walked trips', 'toggleable': True, 'default-hidden': False, 'sorting': 11,
                      'markers': lines},
        'wm-zones': {'label': 'Villages and protected zones', 'toggleable': True, 'default-hidden': False, 'sorting': 12,
                     'markers': zs},
        'wm-townplan': {'label': 'Town plan plots', 'toggleable': True, 'default-hidden': True, 'sorting': 13,
                        'markers': plots},
    }


def validate_marker_sets(ms):
    """Raise ValueError if the layer could break BlueMap's config load: a set without markers dict, a line with < 2
    points, a shape with < 3, a non-finite number, a key that is not a plain identifier. Pure."""
    def finite(v, where):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
            raise ValueError(f'{where}: {v!r} is not a finite number')
    if not isinstance(ms, dict) or not ms:
        raise ValueError('no marker sets')
    for sk, s in ms.items():
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', sk) or not isinstance(s.get('markers'), dict):
            raise ValueError(f'set {sk!r} malformed')
        for mk, m in s['markers'].items():
            w = f'{sk}.{mk}'
            if not re.fullmatch(r'[A-Za-z0-9_-]+', mk):
                raise ValueError(f'{w}: bad key')
            if m.get('type') not in ('poi', 'line', 'shape'):
                raise ValueError(f'{w}: type {m.get("type")!r}')
            for a in ('x', 'y', 'z'):
                finite((m.get('position') or {}).get(a), f'{w}.position.{a}')
            if m['type'] == 'line':
                if len(m.get('line') or []) < 2:
                    raise ValueError(f'{w}: a line needs >= 2 points')
                for p in m['line']:
                    for a in ('x', 'y', 'z'):
                        finite(p.get(a), f'{w}.line.{a}')
            if m['type'] == 'shape':
                if len(m.get('shape') or []) < 3:
                    raise ValueError(f'{w}: a shape needs >= 3 points')
                finite(m.get('shape-y'), f'{w}.shape-y')
                for p in m['shape']:
                    for a in ('x', 'z'):
                        finite(p.get(a), f'{w}.shape.{a}')
    return True


def write_layer(path, ms):
    """Atomic: validate, json.dumps, re-parse, keep the previous file as <path>.bak, rename into place. Never leaves
    a partial file where BlueMap's include reads. Returns the byte count."""
    validate_marker_sets(ms)
    txt = json.dumps(ms, indent=1, sort_keys=True, allow_nan=False)
    if json.loads(txt) != json.loads(json.dumps(ms, allow_nan=False)):
        raise ValueError('layer does not round-trip')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        f.write(txt)
        f.flush()
        os.fsync(f.fileno())
    if os.path.exists(path):
        shutil.copy2(path, path + '.bak')
    os.replace(tmp, path)
    return len(txt)


def write_json_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str, allow_nan=False)
    os.replace(tmp, path)


# -------------------------------------------------------------------------------------------------------------- the scan
def scan_regions(region_dir):
    """-> (grid, info, generated, landice, seen_raw) over every .mca in region_dir. Raises ZeroLooksWrong when there is
    nothing to read."""
    files = sorted(glob.glob(os.path.join(region_dir, 'r.*.*.mca')))
    if not files:
        raise ZeroLooksWrong(f'no region files in {region_dir}: wrong path or no read access, not an empty world')
    summ, bad_files, unreadable, not_full = {}, [], [], 0
    for p in files:
        try:
            for cx, cz, nbt in region_chunks(p):
                if isinstance(nbt, Exception):
                    unreadable.append((cx, cz, f'{type(nbt).__name__}: {str(nbt)[:80]}'))
                    continue
                try:
                    s = chunk_summary(nbt)
                except ValueError as e:
                    unreadable.append((cx, cz, str(e)[:80]))
                    continue
                if s['classes'] is None:
                    not_full += 1
                summ[(cx, cz)] = s
        except (OSError, ValueError) as e:
            bad_files.append(f'{os.path.basename(p)}: {e}')
    full = [c for c, s in summ.items() if s['classes'] is not None]
    if not full:
        raise ZeroLooksWrong(f'{len(files)} region files, {len(summ)} chunks parsed, 0 full chunks: refusing a zero')
    cx0 = min(c[0] for c in full); cx1 = max(c[0] for c in full)
    cz0 = min(c[1] for c in full); cz1 = max(c[1] for c in full)
    grid = Grid(cx0, cz0, cx1, cz1)
    generated, landice = set(), set()
    counts = [0] * 6
    for c in full:
        cl = summ[c]['classes']
        grid.put_chunk(c[0], c[1], cl)
        generated.add(c)
        if any(v in (LAND, ICE) for v in cl):
            landice.add(c)
        for v in cl:
            counts[v] += 1
    seen_raw = {c for c, s in summ.items() if s['inhabited'] > 0}
    info = {'region_files': len(files), 'bad_files': bad_files, 'chunks_parsed': len(summ), 'full_chunks': len(full),
            'not_full_chunks': not_full, 'unreadable_chunks': len(unreadable), 'unreadable_sample': unreadable[:5],
            'columns': {CLASS_NAMES[k]: counts[k] for k in range(6)},
            'bbox_chunks': [cx0, cz0, cx1, cz1]}
    return grid, info, generated, landice, seen_raw


def load_state(path, default):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return default


def now_ms():
    return int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if ms else None


def gather_trips(a):
    trips = read_jsonl(os.path.join(a.pool, f'{a.town}.trips.jsonl'))
    markers = read_jsonl(os.path.join(a.pool, f'{a.town}.markers.jsonl'))
    if trips is None:
        raise ZeroLooksWrong(f'{a.town}.trips.jsonl unreadable in {a.pool}: no trip numbers, not zero trips')
    return trips, markers or []


def update_trails(a, trips, cache):
    """Trails for trips not yet cached, from the skill logs (rotated files older than the oldest new trip skipped)."""
    todo = [r for r in trips if r.get('id') and r['id'] not in cache.get('trails', {}) and r['id'] not in cache.get('nolines', [])]
    if not todo:
        return cache, 0
    t0 = min((trip_start_ms(r['id']) or r.get('t') or 0) for r in todo) / 1000 - 3600
    bots = {r.get('by') for r in todo}
    pos = {}
    for name, t, x, y, z in log_positions(glob.glob(a.logs), since=t0):
        if name in bots:
            pos.setdefault(name, []).append((t, x, y, z))
    got = trails(todo, pos)
    cache.setdefault('trails', {}).update(got)
    stale = [r['id'] for r in todo if r['id'] not in got and now_ms() - (r.get('t') or 0) > 6 * 3_600_000]
    cache['nolines'] = sorted(set(cache.get('nolines', [])) | set(stale))[-2000:]
    return cache, len(got)


def run_full(a, out):
    grid, info, generated, landice, seen_raw = scan_regions(a.region)
    rng = border_chunk_range(a.border_width)
    R = reach(grid)
    reachable = reachable_chunks(grid, R[METRIC_TIER]['reached'])
    den = denominators(generated, landice, reachable, rng)
    seen = {c for c in seen_raw if c in reachable}
    if not seen_raw:
        raise ZeroLooksWrong(f'{info["full_chunks"]} full chunks but NONE with InhabitedTime > 0: bots have played here '
                             f'for weeks, so this is a reading bug (wrong tag / wrong world), not zero coverage')
    # stood: the cumulative set + this walk
    st_path = os.path.join(a.state, 'stood-chunks.json')
    st = load_state(st_path, {'chunks': []})
    walk, wstats = stood_from_positions(log_positions(glob.glob(a.logs)))
    if wstats['rows'] == 0:
        raise ZeroLooksWrong(f'skill-log walk over {a.logs} found 0 bot positions ({wstats["skipped_rows"]} rows from '
                             f'non-showcase bots): wrong glob or unreadable logs, not bots that never moved')
    stood = walk | {tuple(c) for c in st.get('chunks', [])}
    reach_out = {t: {'land_cols': R[t]['land_cols'], 'landice_cols': R[t]['landice_cols'], 'cols': R[t]['cols'],
                     'land_pct': pct(R[t]['land_cols'], R['_land_cols']),
                     'chunks_landice': len(reachable_chunks(grid, R[t]['reached']))} for t in TIERS}
    radii = [radius_stats(seen, reachable, generated, den['landice_share'], rng, r) for r in STAGE_RADII]
    cov = {
        'scan_at': iso(now_ms()), 'world_region': a.region, 'border': {'width': a.border_width, 'center': list(BORDER_CENTER),
                                                                     'chunk_range': [list(x) for x in rng]},
        'scan': info, 'denominators': den,
        'seen': {'chunks_raw': len(seen_raw), 'chunks_reachable': len(seen),
                 'pct_border_reachable': pct(len(seen), den['border_reachable_est']),
                 'pct_generated_reachable': pct(len(seen), den['generated_reachable']),
                 'pct_border_raw': pct(len(seen_raw), den['border_chunks']),
                 'by_radius': radii},
        'stood': {'chunks': len(stood), 'chunks_this_walk': len(walk), 'walk': wstats,
                  'pct_border_reachable': pct(len({c for c in stood if c in reachable}), den['border_reachable_est']),
                  'furthest_chunk_blocks': round(max((math.hypot(c[0] * 16 + 8, c[1] * 16 + 8) for c in stood), default=0))},
        'reach': {'metric_tier': METRIC_TIER, 'land_cols_total': R['_land_cols'], 'landice_cols_total': R['_landice_cols'],
                  'tiers': reach_out},
        'tiles': {'n': TILES, 'size_blocks': round(a.border_width / TILES, 1),
                  'grid': tiles(generated, reachable, seen, stood, den['landice_share'], rng)},
        'furthest_seen_blocks': round(max((math.hypot(c[0] * 16 + 8, c[1] * 16 + 8) for c in seen_raw), default=0)),
    }
    out['coverage'] = cov
    out['_stood_state'] = (st_path, {'chunks': sorted([list(c) for c in stood]), 'updated': iso(now_ms())})
    return cov


def summary_lines(cov, ts):
    """The printed report: every number with its denominator. Pure."""
    L = []
    if cov:
        d, s, st, sc = cov['denominators'], cov['seen'], cov['stood'], cov['scan']
        L.append(f'scan {cov["scan_at"]}: {sc["region_files"]} region files, {sc["full_chunks"]:,} full chunks '
                 f'({sc["not_full_chunks"]} not full, {sc["unreadable_chunks"]} UNREADABLE), columns {sc["columns"]}')
        L.append(f'seen (border, reachable): {s["chunks_reachable"]:,} / {d["border_reachable_est"]:,} = '
                 f'{s["pct_border_reachable"]}%   [denominator = {d["generated_reachable"]:,} reachable generated + '
                 f'{d["landice_share"]:.3f} x {d["ungenerated"]:,} ungenerated]')
        L.append(f'seen (generated reachable): {s["chunks_reachable"]:,} / {d["generated_reachable"]:,} = '
                 f'{s["pct_generated_reachable"]}%   (generated {d["generated"]:,}, with land/ice {d["generated_landice"]:,})')
        L.append(f'seen (raw border area): {s["chunks_raw"]:,} / {d["border_chunks"]:,} = {s["pct_border_raw"]}%')
        for r in s['by_radius']:
            L.append(f'seen within {r["radius"]}: {r["seen"]:,} / {r["denominator"]:,} = {r["seen_pct"]}%')
        L.append(f'stood: {st["chunks"]:,} chunks cumulative ({st["chunks_this_walk"]:,} in this walk of '
                 f'{st["walk"]["rows"]:,} rows, {st["walk"]["bots"]} bots, {iso(st["walk"]["first_ms"])}..'
                 f'{iso(st["walk"]["last_ms"])}); over the border denominator {st["pct_border_reachable"]}%; '
                 f'furthest {st["furthest_chunk_blocks"]} blocks')
        rr = cov['reach']
        L.append('reach (land columns of ' + f'{rr["land_cols_total"]:,}): ' + ', '.join(
            f'{t} {v["land_pct"]}% ({v["chunks_landice"]:,} chunks)' for t, v in rr['tiers'].items()))
    if ts:
        L.append(f'trips: {ts["trips_24h"]} in 24 h (of {ts["trips_total"]}), home {ts["home_24h"]}/{ts["trips_24h"]} = '
                 f'{ts["home_pct_24h"]}%, furthest {ts["furthest_24h"]} (ever {ts["furthest_ever"]}), S1 '
                 f'{ts["s1_bearings"]}/8 bearings with >= {S1_TRIPS} trips >= {S1_RING} in {S1_WINDOW_H} h')
    return L


def ship_row(cov, ts, layer_info, mode):
    """The row fleetstatus reads (kind showcase_wholemap in mcai-showcase-ops). Flat, small."""
    row = {'kind': 'showcase_wholemap', 't': iso(now_ms()), 'ok': True, 'mode': mode}
    if ts:
        row.update({k: ts[k] for k in ('trips_24h', 'home_24h', 'home_pct_24h', 'furthest_24h', 's1_bearings',
                                       'trips_total')})
    if cov:
        row.update(scan_at=cov['scan_at'], seen_chunks=cov['seen']['chunks_reachable'],
                   seen_pct=cov['seen']['pct_border_reachable'], seen_pct_generated=cov['seen']['pct_generated_reachable'],
                   seen_den=cov['denominators']['border_reachable_est'],
                   generated_reachable=cov['denominators']['generated_reachable'],
                   stood_chunks=cov['stood']['chunks'], unreadable_chunks=cov['scan']['unreadable_chunks'])
    row.update(layer_info or {})
    return row


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('mode', choices=('full', 'trips'))
    ap.add_argument('--region', default=WORLD_REGION)
    ap.add_argument('--pool', default=POOL)
    ap.add_argument('--town', default=TOWN)
    ap.add_argument('--logs', default=LOGS)
    ap.add_argument('--state', default=STATE)
    ap.add_argument('--layer', default=LAYER)
    ap.add_argument('--zones', default=None, help='protected-zones json (default <pool>/protected-zones.json)')
    ap.add_argument('--ship', default=SHIP, help="filebeat-shipped jsonl; '' to not ship")
    ap.add_argument('--border-width', type=int, default=BORDER_WIDTH)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(argv)
    try:
        os.nice(19)
    except OSError:
        pass
    out = {}
    cov_path = os.path.join(a.state, 'coverage.json')
    if not a.dry_run:
        # one run at a time: an hourly `trips` run that overlapped the daily `full` would write the OLD scan back
        import fcntl
        os.makedirs(a.state, exist_ok=True)
        lock = open(os.path.join(a.state, 'run.lock'), 'w')
        fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        trips, markers = gather_trips(a)
        ts = trip_stats(trips, now_ms())
        if a.mode == 'full':
            cov = run_full(a, out)
        else:
            prev = load_state(cov_path, None)
            cov = prev.get('coverage') if isinstance(prev, dict) else None
        cache = load_state(os.path.join(a.state, 'trails-cache.json'), {'trails': {}, 'nolines': []})
        cache, new_lines = update_trails(a, trips, cache)
        zones = (load_state(a.zones or os.path.join(a.pool, 'protected-zones.json'), {}) or {}).get('zones') or []
        plans = sorted(glob.glob(os.path.join(a.pool, 'townplan-0_70_0.g*.json')),
                       key=lambda p: int(re.search(r'\.g(\d+)\.json$', p).group(1)))
        plan = load_state(plans[-1], None) if plans else None
        keep = {r.get('id') for r in trips[-300:]}
        ms = build_marker_sets(markers, trips, {k: v for k, v in cache['trails'].items() if k in keep}, zones, plan)
        counts = {k: len(v['markers']) for k, v in ms.items()}
        layer_info = {'layer_markers': counts.get('wm-expeditions', 0), 'layer_trails': counts.get('wm-trails', 0),
                      'layer_zones': counts.get('wm-zones', 0)}
        for line in summary_lines(cov, ts):
            print(line)
        print(f'layer: {counts} ({new_lines} new trails) -> {a.layer}{" (dry run: not written)" if a.dry_run else ""}')
        if not zones:
            print('!! layer: NO protected zones read (UNKNOWN, not "no zones") -- check <pool>/protected-zones.json')
        if a.dry_run:
            return 0
        os.makedirs(a.state, exist_ok=True)
        write_json_atomic(os.path.join(a.state, 'trails-cache.json'), cache)
        n = write_layer(a.layer, ms)
        layer_info['layer_bytes'] = n
        if a.mode == 'full':
            write_json_atomic(out['_stood_state'][0], out['_stood_state'][1])
        doc = {'v': 1, 'written': iso(now_ms()), 'mode': a.mode, 'trips': ts, 'layer': dict(layer_info, path=a.layer),
               'coverage': cov}
        write_json_atomic(cov_path, doc)
        if a.ship:
            with open(a.ship, 'a') as f:
                f.write(json.dumps(ship_row(cov, ts, layer_info, a.mode), sort_keys=True, default=str) + '\n')
        print(f'wrote {cov_path}' + (f', shipped one row to {a.ship}' if a.ship else ''))
        return 0
    except ZeroLooksWrong as e:
        print(f'!! wholemap UNKNOWN: {e}', file=sys.stderr)
        if a.ship and not a.dry_run:
            try:
                with open(a.ship, 'a') as f:
                    f.write(json.dumps({'kind': 'showcase_wholemap', 't': iso(now_ms()), 'ok': False, 'mode': a.mode,
                                        'why': str(e)[:300]}) + '\n')
            except OSError:
                pass
        return 2


if __name__ == '__main__':
    sys.exit(main())
