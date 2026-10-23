#!/usr/bin/env python3
"""structcount.py -- the STRUCTURE COUNT (building tier, docs/reports/building-tier-2026-10-23.md section 2). READ-ONLY.

    structcount.py daily   [--out ~/structcount/out] [--attempts ~/structcount/attempts] [--staging /srv/world-backup/staging]
                           [--backup-log /var/log/mcai-monitor/world-backup.log] [--work ~/structcount/work] [--expect 16]
                           [--force: run although today is already published] [--fail-at STEP: the install demonstration only]
    structcount.py scan    <world> <region-dir> <hx,hy,hz> [--r 96] [--stamp] [--zones FILE] [--plinth FILE ...] [--json OUT]
    structcount.py negctl  <world> <region-dir> <hx,hy,hz> [--r 96] [--n 120] [--json OUT]
    structcount.py village <world> <region-dir> <x0,z0,x1,z1> [--json OUT]
    structcount.py selftest

It reads COPIES of Anvil region files and answers, from the WORLD rather than from any bot row:
  * BUILT cells: blocks of the placed-only palette (BUILT below) outside every world-generated structure piece (chunk NBT
    structures.References -> start chunk -> Children[].BB, padded 2 horizontally and 8 vertically), every dungeon (spawner
    +-5) and the operator's town stamp (place-town.py town_plan()). An ESTIMATE of what bots placed (design 2.2).
  * STRUCTURES: 26-connected components of BUILT cells of >= MIN_STRUCT cells; smaller ones are litter; a component more
    than 25% under the column's highest natural solid block is buried (reported, never scored).
  * ROOMS and BUILDINGS (OWNER B5): a room is >= 4 standing cells under structural building material, inside walls, with a
    doorway; a building is a LIT room (a lit light in the room, above it, or set into its wall ring). Counted per room.
`daily` is the cron entry on 10.0.0.30 (design 2.5-2.8): one run at a time (a non-blocking lock), the attempt recorded FIRST,
the controls before anything else, region files copied from the nightly backup's staging (sudo -n tar, read-only) only
after that night's backup logged `good <day>`, every world validated (coverage, stamp, negative control), then ONE manifest
rename publishes an immutable generation directory. Pure python (zlib + struct).
"""
import collections, datetime, fcntl, gzip, hashlib, json, os, re, shutil, struct, subprocess, sys, time, zlib

MIN_STRUCT = 12
ROOF_REACH = 5

# ------------------------------------------------------------------ NBT / Anvil (same reader as townmap.py / scripts/lib/anvil.py)
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
def chunk_nbt(rdir, cx, cz):
    p = os.path.join(rdir, 'r.%d.%d.mca' % (cx >> 5, cz >> 5))
    if p not in _regions:
        _regions[p] = open(p, 'rb').read() if os.path.exists(p) else b''
    data = _regions[p]
    if not data: return None, 'missing_region'
    idx = 4 * ((cx & 31) + (cz & 31) * 32)
    off = int.from_bytes(data[idx:idx + 3], 'big') * 4096
    if off == 0: return None, 'absent'
    ln = int.from_bytes(data[off:off + 4], 'big'); comp = data[off + 4]; raw = data[off + 5:off + 4 + ln]
    try:
        if comp == 2: raw = zlib.decompress(raw)
        elif comp == 1: raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
        elif comp != 3: return None, 'external'
        return read_nbt(raw), 'ok'
    except Exception:
        return None, 'error'

def section_values(bs):
    pal = bs.get('palette') or []
    dat = bs.get('data')
    if dat is None or len(pal) <= 1: return None
    bits = max(4, (len(pal) - 1).bit_length()); per = 64 // bits; mask = (1 << bits) - 1
    vals = []
    for lo in dat:
        lo &= (1 << 64) - 1
        for k in range(per):
            vals.append((lo >> (k * bits)) & mask)
            if len(vals) >= 4096: return vals
    return vals

# ------------------------------------------------------------------ the palettes
# BUILT: blocks world generation does not place OUTSIDE a generated structure's pieces, and that the bots can place.
# Deliberately NOT here: logs (trees), leaves, stone/andesite/diorite/granite/tuff/deepslate, dirt, sand, gravel,
# mossy cobblestone (forest rocks), terracotta (badlands), dirt_path (villages only, kept as its own PATH class),
# crops and saplings (planting is not building), snow, ice.
BUILT = re.compile(r'^minecraft:('
    r'cobblestone|cobblestone_(slab|stairs|wall)|cobbled_deepslate(_slab|_stairs|_wall)?|'
    r'stone_bricks|stone_brick_(slab|stairs|wall)|cracked_stone_bricks|chiseled_stone_bricks|'
    r'smooth_stone|smooth_stone_slab|stone_slab|stone_stairs|bricks|brick_(slab|stairs|wall)|'
    r'polished_(andesite|diorite|granite|deepslate|tuff)(_slab|_stairs|_wall)?|deepslate_(bricks|tiles)|'
    r'[a-z_]+_planks|[a-z_]+_wood_slab|(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_(slab|stairs|fence|fence_gate|door|trapdoor|sign|wall_sign|hanging_sign|wall_hanging_sign|pressure_plate|button)|'
    r'bamboo_mosaic(_slab|_stairs)?|'
    r'glass|[a-z_]+_stained_glass|glass_pane|[a-z_]+_glass_pane|tinted_glass|'
    r'(waxed_)?(exposed_|weathered_|oxidized_)?(copper_block|cut_copper|cut_copper_slab|cut_copper_stairs|copper_grate|copper_door|copper_trapdoor|copper_bulb|chiseled_copper)|'
    r'iron_block|gold_block|diamond_block|lapis_block|emerald_block|coal_block|redstone_block|iron_bars|iron_door|iron_trapdoor|chain|'
    r'lantern|soul_lantern|torch|wall_torch|soul_torch|soul_wall_torch|redstone_torch|redstone_wall_torch|glowstone|sea_lantern|'
    r'chest|trapped_chest|barrel|crafting_table|furnace|blast_furnace|smoker|stonecutter|composter|lectern|bookshelf|ladder|scaffolding|'
    r'[a-z_]+_bed|[a-z_]+_wool|(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_carpet|[a-z_]+_concrete|[a-z_]+_glazed_terracotta|hay_block|lightning_rod|anvil|cauldron|'
    r'smithing_table|cartography_table|fletching_table|loom|grindstone|bell|campfire|item_frame'
    r')$')
PATH = re.compile(r'^minecraft:dirt_path$')
SPAWNER = re.compile(r'^minecraft:spawner$')     # a dungeon (a FEATURE: no structure BB) -- its cobble and chests are masked
DUNGEON_R = 5
# A light is LIT (Codex r1 P1): always-on emitters by name; lamps, bulbs, campfires and candles only with lit=true.
LIGHT_ALWAYS = re.compile(r'^minecraft:(torch|wall_torch|soul_torch|soul_wall_torch|lantern|soul_lantern|glowstone|sea_lantern|'
                          r'shroomlight|jack_o_lantern|ochre_froglight|verdant_froglight|pearlescent_froglight|end_rod)$')
# redstone torches carry `lit` too (Codex r2 P1): they count only when lit=true
LIGHT_IF_LIT = re.compile(r'^minecraft:(campfire|soul_campfire|redstone_lamp|(waxed_)?(exposed_|weathered_|oxidized_)?copper_bulb|[a-z_]*candle|'
                          r'redstone_torch|redstone_wall_torch)$')
LIGHT = re.compile(LIGHT_ALWAYS.pattern[:-1] + '|' + LIGHT_IF_LIT.pattern[len('^minecraft:'):])
def lit_at(w, x, y, z):
    n = w.block(x, y, z) or ''
    if LIGHT_ALWAYS.match(n): return True
    return bool(LIGHT_IF_LIT.match(n)) and str(w.props(x, y, z).get('lit', 'false')) == 'true'
AIR = {'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:light', 'minecraft:structure_void'}
# passable for a body: what a room's standing cells and a doorway may hold
PASSABLE = re.compile(r'^minecraft:(air|cave_air|void_air|light|short_grass|tall_grass|grass|fern|large_fern|dead_bush|vine|glow_lichen|'
                      r'[a-z_]+_carpet|torch|wall_torch|soul_torch|soul_wall_torch|redstone_torch|redstone_wall_torch|'
                      r'[a-z_]+_sign|[a-z_]+_wall_sign|[a-z_]+_hanging_sign|[a-z_]+_wall_hanging_sign|[a-z_]+_door|ladder|'
                      r'[a-z_]+_pressure_plate|[a-z_]+_button|lever|rail|powered_rail|detector_rail|activator_rail|'
                      r'[a-z_]+_sapling|dandelion|poppy|blue_orchid|allium|azure_bluet|[a-z_]+_tulip|oxeye_daisy|cornflower|'
                      r'lily_of_the_valley|sunflower|lilac|rose_bush|peony|brown_mushroom|red_mushroom|snow|item_frame|'
                      r'pink_petals|leaf_litter|wildflowers|bush|firefly_bush|short_dry_grass|tall_dry_grass|cobweb|'
                      r'wheat|carrots|potatoes|beetroots|sweet_berry_bush|flower_pot|potted_[a-z_]+|lantern|soul_lantern|chain)$')
NOT_WALL = re.compile(r'(leaves|water|lava|bubble_column|seagrass|kelp)')
LOGLIKE = re.compile(r'^minecraft:(stripped_)?[a-z_]+_(log|wood|stem|hyphae)$')
def passable(n): return n is not None and bool(PASSABLE.match(n))
def wallish(n): return n is not None and not passable(n) and not NOT_WALL.search(n)
def material(n): return n is not None and (bool(BUILT.match(n)) or bool(LOGLIKE.match(n)))
# A ROOF cell is STRUCTURAL material (Codex r2 P1): building material that a body cannot pass -- never a torch, a sign, a
# ladder, a door, a carpet, a lantern or a chain, which are all BUILT palette but cannot roof anything
def roofing(n): return material(n) and wallish(n)
def natural_solid(n): return wallish(n) and not material(n)

# ------------------------------------------------------------------ world access
class World:
    def __init__(self, rdir):
        self.rdir = rdir; self.secs = {}; self.stats = collections.Counter(); self.inhabited = {}; self.refs = {}
        self.hm = {}; self.ntop = {}; self.chunkstat = {}; self.status = {}
    def natural_top(self, x, z):
        """The highest NATURAL solid block of the column (terrain, not a built block, a log or leaves). A cell below it is
        buried: underground fill, a tunnel lining, a mine stair -- never a building."""
        key = (x, z)
        if key in self.ntop: return self.ntop[key]
        self.chunk(x >> 4, z >> 4)
        hm = self.hm.get((x >> 4, z >> 4))
        y = (hm[(z & 15) * 16 + (x & 15)] - 64 - 1) if hm else 200
        while y > -64 and not natural_solid(self.block(x, y, z)): y -= 1
        self.ntop[key] = y
        return y
    def chunk(self, cx, cz):
        key = (cx, cz)
        if key in self.secs: return self.secs[key]
        ch, st = chunk_nbt(self.rdir, cx, cz)
        self.stats['chunk_' + st] += 1
        self.chunkstat[key] = st
        if ch is None: self.secs[key] = None; return None
        d = {}
        for s in ch.get('sections', []):
            bs = s.get('block_states') or {}
            pal = [p.get('Name', '?') for p in (bs.get('palette') or [])]
            if pal: d[s['Y']] = [pal, bs, None, [p.get('Properties') or {} for p in (bs.get('palette') or [])]]
        self.secs[key] = d
        self.inhabited[key] = ch.get('InhabitedTime', 0)
        self.status[key] = ch.get('Status', '?')
        hm = (ch.get('Heightmaps') or {}).get('MOTION_BLOCKING_NO_LEAVES')
        if hm:
            vals = []
            for lo in hm:
                lo &= (1 << 64) - 1
                for k in range(7):
                    vals.append((lo >> (k * 9)) & 511)
            self.hm[key] = vals[:256]
        refs = ((ch.get('structures') or {}).get('References') or {})
        self.refs[key] = {k: list(v) for k, v in refs.items()}
        return d
    def block(self, x, y, z):
        d = self.chunk(x >> 4, z >> 4)
        if d is None: return None
        s = d.get(y >> 4)
        if s is None: return 'minecraft:air'
        pal, bs, vals = s[:3]
        if len(pal) == 1: return pal[0]
        if vals is None: vals = s[2] = section_values(bs)
        if vals is None or len(vals) < 4096:
            self.stats['undecoded_hit_sections'] += 1                 # a blind read, counted (Claude r3 P3), never a guess
            return pal[0]
        v = vals[(y & 15) * 256 + (z & 15) * 16 + (x & 15)]
        if v >= len(pal):
            self.stats['undecoded_hit_sections'] += 1
            return None
        return pal[v]
    def props(self, x, y, z):
        """The block STATE's properties (lit, facing, half ...), {} when it has none."""
        d = self.chunk(x >> 4, z >> 4)
        if not d: return {}
        s = d.get(y >> 4)
        if s is None: return {}
        pal, bs, vals, props = s
        if len(pal) == 1: return props[0]
        if vals is None: vals = s[2] = section_values(bs)
        if vals is None or len(vals) < 4096:
            self.stats['undecoded_hit_sections'] += 1
            return props[0]
        v = vals[(y & 15) * 256 + (z & 15) * 16 + (x & 15)]
        if v >= len(props):
            self.stats['undecoded_hit_sections'] += 1
            return {}
        return props[v]
    def cells_matching(self, cx, cz, rx, ylo=-64, yhi=320):
        """(x, y, z, name) for every cell in chunk (cx,cz) whose name matches rx (palette-skipped sections are free)."""
        d = self.chunk(cx, cz)
        if d is None: return
        for Y, s in d.items():
            pal, bs, vals = s[:3]
            hit = {i for i, n in enumerate(pal) if rx.match(n)}
            if not hit or Y * 16 + 15 < ylo or Y * 16 > yhi: continue
            if len(pal) == 1:
                for ly in range(16):
                    for lz in range(16):
                        for lx in range(16): yield cx * 16 + lx, Y * 16 + ly, cz * 16 + lz, pal[0]
                continue
            if vals is None: vals = s[2] = section_values(bs)
            if vals is None or len(vals) < 4096 or max(vals) >= len(pal):     # short, or indices outside the palette (Codex r3)
                # A section whose palette HOLDS a match but whose cells cannot be decoded is a blind spot, never a skip
                # (Codex r2 P2): counted here, and validate() refuses any world where it happened.
                self.stats['undecoded_hit_sections'] += 1
                continue
            for k, v in enumerate(vals):
                if v in hit:
                    yield cx * 16 + (k & 15), Y * 16 + (k >> 8), cz * 16 + ((k >> 4) & 15), pal[v]

def structure_pieces(w, chunks):
    """Every generated structure piece BB referenced by the given chunks: [(start_id, piece_id, (x0,y0,z0,x1,y1,z1))]."""
    starts = set()
    for key in chunks:
        for sid, longs in (w.refs.get(key) or {}).items():
            for L in longs:
                L &= (1 << 64) - 1
                sx = L & 0xffffffff; sz = (L >> 32) & 0xffffffff
                if sx >= 1 << 31: sx -= 1 << 32
                if sz >= 1 << 31: sz -= 1 << 32
                starts.add((sx, sz))
    out = []
    for sx, sz in sorted(starts):
        ch, st = chunk_nbt(w.rdir, sx, sz)
        if ch is None: out.append(('?unreadable', '?', None)); continue
        for sid, s in ((ch.get('structures') or {}).get('starts') or {}).items():
            if s.get('id') == 'INVALID': continue
            for c in s.get('Children') or []:
                bb = c.get('BB')
                pe = c.get('pool_element') or {}
                loc = pe.get('location') if isinstance(pe, dict) else None
                if loc is None and isinstance(pe, dict):
                    el = pe.get('elements')
                    if isinstance(el, list) and el and isinstance(el[0], dict): loc = el[0].get('location')
                out.append((sid, loc or c.get('id'), tuple(bb) if bb else None))
    return out

PIECE_PAD_H, PIECE_PAD_V = 2, 8   # terrain_matching jigsaw pieces (village streets) put blocks at the surface, outside their nominal BB y
def padded(bb):
    return (bb[0] - PIECE_PAD_H, bb[1] - PIECE_PAD_V, bb[2] - PIECE_PAD_H, bb[3] + PIECE_PAD_H, bb[4] + PIECE_PAD_V, bb[5] + PIECE_PAD_H)

def in_box(p, bb):
    x, y, z = p
    return bb[0] <= x <= bb[3] and bb[1] <= y <= bb[4] and bb[2] <= z <= bb[5]

def stamp_cells(home):
    """place-town.py town_plan(x, y, z) with y = home.y - 1 (board = x+3, y, z): the operator's stamp, cell by cell."""
    hx, hy, hz = home; x, y, z = hx, hy - 1, hz
    c = {}
    for dx in range(-6, 7):
        for dz in range(-6, 7): c[(x + dx, y - 1, z + dz)] = 'stone_bricks'
    for p in ((x, y, z), (x + 1, y, z), (x - 1, y, z)): c[p] = 'chest'
    for i in range(5):
        c[(x - 4 + i * 2, y, z + 4)] = 'red_bed'; c[(x - 4 + i * 2, y, z + 3)] = 'red_bed'
    for d in range(-6, 7, 2):
        for cx, cz in ((x + d, z - 6), (x + d, z + 6), (x - 6, z + d), (x + 6, z + d)): c[(cx, y, cz)] = 'torch'
    c[(x + 3, y, z)] = 'lectern'
    return c

# ------------------------------------------------------------------ grouping and the building test
N26 = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]
H4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]

def components(cells):
    seen = set(); comps = []
    for p in cells:
        if p in seen: continue
        stack = [p]; seen.add(p); comp = []
        while stack:
            q = stack.pop(); comp.append(q)
            for dx, dy, dz in N26:
                r = (q[0] + dx, q[1] + dy, q[2] + dz)
                if r in cells and r not in seen: seen.add(r); stack.append(r)
        comps.append(comp)
    return comps

def rooms_of(w, comp, built):
    """The building test on one component. Returns a list of room dicts (empty: not a building)."""
    xs = [p[0] for p in comp]; ys = [p[1] for p in comp]; zs = [p[2] for p in comp]
    # the box is the component's, grown by 2: log walls and log roofs are building MATERIAL but never seed a component
    x0, x1, y0, y1, z0, z1 = min(xs) - 2, max(xs) + 2, min(ys) - 1, max(ys) + 2, min(zs) - 2, max(zs) + 2
    compset = set(comp)
    roofed = {}
    for x in range(x0, x1 + 1):
        for z in range(z0, z1 + 1):
            for y in range(y0, y1):
                n = w.block(x, y, z)
                if not passable(n): continue
                for k in range(1, ROOF_REACH + 1):
                    m = w.block(x, y + k, z)
                    if roofing(m): roofed[(x, y, z)] = (x, y + k, z); break
                    if not passable(m): break
    # INSIDE, not under the eaves: a horizontal ray hits a wall within 8 cells in at least 3 of the 4 directions
    def rays(q):
        hits = 0
        for dx, dz in H4:
            for k in range(1, 9):
                n = w.block(q[0] + dx * k, q[1], q[2] + dz * k)
                if passable(n): continue
                hits += wallish(n); break
        return hits
    roofed = {q: r for q, r in roofed.items() if rays(q) >= 3}
    if not roofed: return []
    seen = set(); rooms = []
    for p in roofed:
        if p in seen: continue
        stack = [p]; seen.add(p); room = []
        while stack:
            q = stack.pop(); room.append(q)
            for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                r = (q[0] + dx, q[1] + dy, q[2] + dz)
                if r in roofed and r not in seen: seen.add(r); stack.append(r)
        rs = set(room)
        floor = [q for q in room if (q[0], q[1] + 1, q[2]) in rs and wallish(w.block(q[0], q[1] - 1, q[2]))]
        if len(floor) < 4: continue
        # the component must take part: some roof cell of the room, or some ring cell, is one of its BUILT cells
        touches = any(roofed[q] in compset for q in room)
        buried = sum(1 for (x, y, z) in floor if w.natural_top(x, z) > y)
        if buried > 0.25 * len(floor): continue
        wall = gap = 0; doors = set(); lit = False; mat = 0
        for (x, y, z) in floor:
            for dy in (0, 1):
                for dx, dz in H4:
                    q = (x + dx, y + dy, z + dz)
                    if q in rs: continue
                    n = w.block(*q)
                    if wallish(n):
                        wall += 1
                        if material(n): mat += 1
                        if q in compset: touches = True
                    else:
                        gap += 1
                        if dy == 0 and passable(n) and passable(w.block(q[0], q[1] + 1, q[2])) and wallish(w.block(q[0], q[1] - 1, q[2])):
                            doors.add(q)
        # LIT INSIDE (Codex r1 P1): a lit light in a room cell, in a ring cell at the room's own levels, or in the cell
        # directly above a room cell (a ceiling lamp) -- never below the floor, never outside the ring
        for (x, y, z) in room:
            if lit_at(w, x, y, z) or lit_at(w, x, y + 1, z): lit = True; break
            # a RING light counts only when the ring cell is WALL (an embedded lamp, glowstone): a passable light outside the
            # room -- a torch beyond the doorway or a gap -- is outside (Claude r2 P3)
            if any((x + dx, y, z + dz) not in rs and wallish(w.block(x + dx, y, z + dz)) and lit_at(w, x + dx, y, z + dz)
                   for dx, dz in H4): lit = True; break
        encl = wall / max(1, wall + gap)
        matf = mat / max(1, wall)
        roofs = {roofed[q] for q in room}
        roof_built = sum(1 for c in roofs if BUILT.match(w.block(*c) or '')) / max(1, len(roofs))
        if encl >= 0.70 and doors and matf >= 0.60 and touches:
            fx = sum(q[0] for q in floor) / len(floor); fz = sum(q[2] for q in floor) / len(floor)
            rooms.append({'floor': len(floor), 'enclosure': round(encl, 2), 'wall_material': round(matf, 2), 'roof_built': round(roof_built, 2), 'doors': len(doors), 'lit': lit,
                          'centre': [round(fx, 1), floor[0][1], round(fz, 1)], 'key': list(min(room)) + [len(room)]})
    return rooms

def describe(w, comps, built, home, names):
    out = []
    for cid, comp in enumerate(comps):
        if len(comp) < MIN_STRUCT: continue
        kinds = collections.Counter(names[p] for p in comp)
        xs = [p[0] for p in comp]; zs = [p[2] for p in comp]; ys = [p[1] for p in comp]
        d = max(abs((min(xs) + max(xs)) / 2 - home[0]), abs((min(zs) + max(zs)) / 2 - home[2]))
        bur = sum(1 for p in comp if w.natural_top(p[0], p[2]) > p[1]) / len(comp)
        # every component is searched (Codex r1 P1): a house joined to a buried mine stair is still a house; each ROOM
        # carries its own buried test, and buildings are counted per distinct room, never per component
        rooms = rooms_of(w, comp, built)
        out.append({'cid': cid, 'n': len(comp), 'buried': round(bur, 2), 'surface': bur <= 0.25, 'bbox': [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)], 'cheb': round(d),
                    'kinds': dict(kinds.most_common(6)), 'room': bool(rooms), 'building': any(r['lit'] for r in rooms),
                    'rooms': rooms})
    return out

# ------------------------------------------------------------------ commands
def parse_home(s): return tuple(int(v) for v in s.split(','))

PLINTH_SEEN = ('minecraft:cobblestone', 'minecraft:cobbled_deepslate')
PLINTH_UNSEEN = ('minecraft:andesite', 'minecraft:diorite', 'minecraft:granite')

def plinth_check(w, cells, built, comps, structs, state):
    """The plinth control for ONE record, by COMPONENT IDENTITY (Codex r2 P2). A `complete` record passes when every planned
    cell holds a plinth block (seen, or a natural stone the palette cannot see), every seen cell lies in ONE component, and
    that component holds no room. A `plan` record (never built) passes when it finds 0. No planned cells: `no_cells`."""
    found = [c for c in cells if built.get(c) in PLINTH_SEEN]
    unseen = sum(1 for c in cells if (w.block(*c) or '') in PLINTH_UNSEEN)
    comp_of = {p: i for i, comp in enumerate(comps) for p in comp}
    ids = collections.Counter(comp_of.get(c) for c in found)
    cid, n1 = ids.most_common(1)[0] if ids else (None, 0)
    st = next((x for x in structs if x['cid'] == cid), None)
    room = bool(st and st['room'])
    if not cells: verdict = 'no_cells'
    elif state == 'complete': verdict = 'pass' if (len(found) + unseen == len(cells) and found and n1 == len(found) and not room) else 'FAIL'
    elif state == 'plan': verdict = 'pass' if not found else 'FAIL'
    else: verdict = 'unscored'
    kinds = collections.Counter((w.block(*c) or '?')[10:] for c in cells)
    return {'state': state, 'planned_place_cells': len(cells), 'found_built': len(found), 'natural_stone_unobservable': unseen,
            'other_at_cells': len(cells) - len(found) - unseen, 'world_kinds_at_cells': dict(kinds.most_common(4)),
            'in_one_component': n1, 'component_size': len(comps[cid]) if cid is not None else 0, 'component_room': room,
            'verdict': verdict}

def scan(world, rdir, home, r, stamp, zones, plinths):
    w = World(rdir)
    hx, hy, hz = home
    chunks = [(cx, cz) for cx in range((hx - r) >> 4, ((hx + r) >> 4) + 1) for cz in range((hz - r) >> 4, ((hz + r) >> 4) + 1)]
    raw = {}
    pathcells = []; spawners = []
    for cx, cz in chunks:
        for x, y, z, n in w.cells_matching(cx, cz, BUILT):
            if abs(x - hx) <= r and abs(z - hz) <= r: raw[(x, y, z)] = n
        for x, y, z, n in w.cells_matching(cx, cz, PATH, hy - 16, hy + 16):
            if abs(x - hx) <= r and abs(z - hz) <= r: pathcells.append((x, y, z))
        for x, y, z, n in w.cells_matching(cx, cz, SPAWNER):
            spawners.append((x, y, z))
    pieces = structure_pieces(w, chunks)
    bbs = [padded(bb) for _, _, bb in pieces if bb]
    bbs += [(x - DUNGEON_R, y - DUNGEON_R, z - DUNGEON_R, x + DUNGEON_R, y + DUNGEON_R, z + DUNGEON_R) for x, y, z in spawners]
    paths = sum(1 for p in pathcells if not any(in_box(p, bb) for bb in bbs))
    st = stamp_cells(home) if stamp else {}
    zl = []
    if zones and os.path.exists(zones):
        # bench `fixture` strips are DATA only (scripts/host/protectzone-fixture.py writes a zone file and places nothing), so
        # the blocks inside them are bots' and stay counted; scenery zones (the showcase's villages) are masked
        zl = [z['box'] for z in json.load(open(zones)).get('zones', []) if z.get('kind') != 'fixture']
    masked = collections.Counter(); built = {}
    rawbbs = [bb for _, _, bb in pieces if bb]
    padonly = collections.Counter()
    vil = [bb for sid, _, bb in pieces if bb and 'village' in (sid or '')]
    for p, n in raw.items():
        if p in st: masked['stamp'] += 1; continue
        if any(in_box(p, bb) for bb in bbs):
            masked['worldgen_piece'] += 1
            if not any(in_box(p, bb) for bb in rawbbs) and not any(in_box(p, b) for b in bbs[len([1 for _, _, bb in pieces if bb]):]):
                padonly[n[10:]] += 1       # masked ONLY by the padding (Claude r1 P2: the padding could hide bot cells)
            continue
        if any(in_box(p, b) for b in zl): masked['protected_zone'] += 1; continue
        built[p] = n
    stamp_present = sum(1 for p, k in st.items() if (raw.get(p) or '').endswith(k))
    FLUID = ('minecraft:water', 'minecraft:lava', 'minecraft:obsidian')
    fluid_adj = sum(1 for (x, y, z), n in built.items() if n == 'minecraft:cobblestone' and w.natural_top(x, z) <= y and
                    any((w.block(x + a, y + b, z + c) or '') in FLUID for a, b, c in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1))))
    comps = components(built)
    structs = describe(w, comps, built, home, built)
    litter = sum(len(c) for c in comps if len(c) < MIN_STRUCT)
    # positive control: plinth wells (the bots' own record) -- plinth_check, a pure function with its own fixtures
    pctl = []
    for pf in plinths or []:
        rec = json.load(open(pf)); plan = rec.get('plan') or {}
        cells = [tuple(st['c']) for st in plan.get('steps', []) if st.get('op') == 'place']
        res_p = plinth_check(w, cells, built, comps, structs, rec.get('state'))
        res_p['record'] = os.path.basename(pf)
        pctl.append(res_p)
    band = collections.Counter()
    for s in structs:
        b = 'core<=16' if s['cheb'] <= 16 else ('town<=44' if s['cheb'] <= 44 else 'out<=%d' % r)
        band[(b, 'building' if s['building'] else ('surface' if s['surface'] else 'buried'))] += 1
    box_ok = sum(1 for c in chunks if w.chunkstat.get(c) == 'ok')
    res = {'world': world, 'home': list(home), 'r': r, 'chunks': dict(w.stats), 'raw_palette_cells': len(raw),
           'box_chunks': len(chunks), 'box_chunks_ok': box_ok,
           'masked': dict(masked), 'stamp_cells': len(st), 'stamp_present': stamp_present, 'worldgen_pieces': len(pieces),
           'worldgen_starts_unreadable': sum(1 for p in pieces if p[0] == '?unreadable'), 'dungeons_masked': len(spawners),
           'masked_by_padding_only': dict(padonly.most_common(8)), 'surface_cobble_touching_fluid': fluid_adj,
           'chunk_status': dict(collections.Counter(w.status.values())) if hasattr(w, 'status') else {},
           'piece_kinds': dict(collections.Counter((sid or '?').replace('minecraft:', '') for sid, _, bb in pieces if bb).most_common(8)),
           'village_box': ([min(b[0] for b in vil), min(b[2] for b in vil), max(b[3] for b in vil), max(b[5] for b in vil)] if vil else None),
           'built_cells': len(built), 'built_kinds': dict(collections.Counter(built.values()).most_common(15)),
           'built_by_band': dict(collections.Counter(('core' if max(abs(p[0]-hx), abs(p[2]-hz)) <= 16 else
                                                     'town' if max(abs(p[0]-hx), abs(p[2]-hz)) <= 44 else 'out')
                                                    for p in built)),
           'components': len(comps), 'structures': len(structs), 'litter_cells': litter,
           'surface_structures': sum(1 for s in structs if s['surface']),
           'surface_structure_cells': sum(s['n'] for s in structs if s['surface']),
           'buried_structure_cells': sum(s['n'] for s in structs if not s['surface']),
           'buildings': len({tuple(rm['key']) for s in structs for rm in s['rooms'] if rm['lit']}),
           'unlit_rooms': len({tuple(rm['key']) for s in structs for rm in s['rooms'] if not rm['lit']}),
           'building_rooms': sorted({json.dumps(rm) for s in structs for rm in s['rooms']}),
           'by_band': {'%s/%s' % k: v for k, v in sorted(band.items())}, 'dirt_path_cells_near_home_y': paths,
           'plinth_control': pctl,
           'top_structures': sorted(structs, key=lambda s: -s['n'])[:6],
           'top_surface': sorted([s for s in structs if s['surface']], key=lambda s: -s['n'])[:10],
           'cells': sorted([list(p) + [n[10:]] for p, n in built.items()])}
    res['undecoded_hit_sections'] = w.stats['undecoded_hit_sections']
    return res

def village(world, rdir, box):
    """POSITIVE CONTROL for the building test: run it on a generated village's own blocks (worldgen palette INSIDE the
    village pieces) and score it against the piece list (a piece whose pool location names houses/ is a house)."""
    x0, z0, x1, z1 = box
    w = World(rdir)
    chunks = [(cx, cz) for cx in range(x0 >> 4, (x1 >> 4) + 1) for cz in range(z0 >> 4, (z1 >> 4) + 1)]
    for c in chunks: w.chunk(*c)
    pieces = [p for p in structure_pieces(w, chunks) if p[2] and 'village' in (p[0] or '')]
    cells = {}
    for cx, cz in chunks:
        for x, y, z, n in w.cells_matching(cx, cz, BUILT):
            if any(in_box((x, y, z), bb) for _, _, bb in pieces): cells[(x, y, z)] = n
    comps = components(cells)
    found = []
    for comp in comps:
        if len(comp) < MIN_STRUCT: continue
        for room in rooms_of(w, comp, cells):
            found.append(room)
    houses = [(loc, bb) for _, loc, bb in pieces if loc and '/houses/' in loc]
    nonhouse = [(loc, bb) for _, loc, bb in pieces if not (loc and '/houses/' in loc)]
    def piece_of(room, plist):
        cx, cy, cz = room['centre']
        return [(loc, bb) for loc, bb in plist if bb[0] <= cx <= bb[3] and bb[2] <= cz <= bb[5] and bb[1] - 1 <= cy <= bb[4]]
    hit_houses = set(); fp = []; lit_houses = set()
    for room in found:
        h = piece_of(room, houses)
        if h:
            hit_houses.update(h)
            if room['lit']: lit_houses.update(h)
        else: fp.append({'centre': room['centre'], 'in': [l for l, _ in piece_of(room, nonhouse)[:2]]})
    hl = collections.Counter(loc.split('/')[-1] for loc, _ in houses)
    missed = sorted(loc for loc, bb in houses if (loc, bb) not in hit_houses)
    lit = sum(1 for r in found if r['lit'])
    return {'world': world, 'box': box, 'chunks': dict(w.stats), 'village_pieces': len(pieces), 'house_pieces': len(houses),
            'house_kinds': dict(hl), 'palette_cells_in_pieces': len(cells), 'rooms_found': len(found), 'rooms_lit': lit,
            'nonhouse_pieces': len(nonhouse), 'nonhouse_kinds': dict(collections.Counter((l or '?').split('/')[-2] if l and '/' in l else str(l) for l, _ in nonhouse).most_common(8)),
            'houses_with_a_room': len(hit_houses), 'houses_with_a_lit_room (B5 buildings)': len(lit_houses),
            'houses_missed': [m.split('/')[-1] for m in missed],
            'rooms_outside_any_house': fp}

def negctl(world, rdir, home, r, n):
    """NEGATIVE CONTROL for the BUILT filter: chunks no player ever ticked (InhabitedTime == 0) in the copied regions,
    outside the scan box. Every BUILT cell found there outside a worldgen piece is a false positive of the palette."""
    w = World(rdir)
    hx, hy, hz = home
    rx0, rz0 = (hx - r) >> 9, (hz - r) >> 9
    cand = []
    for f in sorted(os.listdir(rdir)):
        m = re.match(r'r\.(-?\d+)\.(-?\d+)\.mca$', f)
        if not m: continue
        RX, RZ = int(m.group(1)), int(m.group(2))
        for lx in range(32):
            for lz in range(32):
                cx, cz = RX * 32 + lx, RZ * 32 + lz
                if abs(cx * 16 + 8 - hx) <= r + 16 and abs(cz * 16 + 8 - hz) <= r + 16: continue
                cand.append((cx, cz))
    cand.sort(key=lambda c: (hash((c[0] * 73856093) ^ (c[1] * 19349663)) & 0xffff, c))
    zero, used = [], 0
    for c in cand:
        if len(zero) >= n: break
        d = w.chunk(*c)
        if d is None: continue
        used += 1
        # FULLY GENERATED only (Claude r1 P2): an edge chunk whose features have not generated yet proves nothing
        if w.inhabited.get(c, 1) == 0 and str(w.status.get(c, '')).endswith('full'): zero.append(c)
    # OBSERVED (Codex r1 P2): a never-ticked chunk counts toward the control only if its blocks were really read -- at least
    # two sections holding a non-air block, and its lowest mixed section decoding to in-range palette indices of >= 2 kinds.
    # A blind decoder or empty sections give 0 false positives for free; this is the presence that rules that out.
    observed = 0
    for c in zero:
        d = w.chunk(*c) or {}
        nonair = [d[Y] for Y in sorted(d) if any(n not in AIR for n in d[Y][0])]
        mixed = [s for s in nonair if len(s[0]) > 1]
        if len(nonair) >= 2 and mixed:
            vals = section_values(mixed[0][1])
            if vals is not None and len(vals) == 4096 and max(vals) < len(mixed[0][0]) and len(set(vals)) >= 2:
                observed += 1
    pieces = structure_pieces(w, zero)
    bbs = [padded(bb) for _, _, bb in pieces if bb]
    for c in zero:
        for x, y, z, nm in w.cells_matching(*c, SPAWNER):
            bbs.append((x - DUNGEON_R, y - DUNGEON_R, z - DUNGEON_R, x + DUNGEON_R, y + DUNGEON_R, z + DUNGEON_R))
    fps = collections.Counter(); inpiece = 0; surface_fp = collections.Counter(); buried_fp = 0
    for c in zero:
        for x, y, z, nm in w.cells_matching(*c, BUILT):
            if any(in_box((x, y, z), bb) for bb in bbs): inpiece += 1; continue
            fps[nm[10:]] += 1
            if w.natural_top(x, z) > y: buried_fp += 1
            else: surface_fp[nm[10:]] += 1
    return {'world': world, 'chunks_read': used, 'chunk_status_read': dict(collections.Counter(w.status.values())),
            'uninhabited_full_chunks': len(zero), 'uninhabited_chunks': len(zero), 'observed_chunks': observed,
            'palette_cells_in_pieces': inpiece, 'undecoded_hit_sections': w.stats['undecoded_hit_sections'],
            'false_positive_cells': sum(fps.values()), 'fp_kinds': dict(fps.most_common(10)),
            'fp_cells_buried': buried_fp, 'fp_cells_surface': sum(surface_fp.values()), 'fp_kinds_surface': dict(surface_fp.most_common(10)),
            'worldgen_pieces': len(pieces), 'worldgen_starts_unreadable': sum(1 for p in pieces if p[0] == '?unreadable')}

def delta_cells(old, new, home, r):
    """Day over day: cells added and removed inside the box (`old`/`new`: lists of [x, y, z, name])."""
    hx, _, hz = home
    inr = lambda p: max(abs(p[0] - hx), abs(p[2] - hz)) <= r
    A = {tuple(c[:3]): c[3] for c in old if inr(c)}; B = {tuple(c[:3]): c[3] for c in new if inr(c)}
    added = {p: n for p, n in B.items() if A.get(p) != n}
    gone = {p: n for p, n in A.items() if B.get(p) != n}
    return {'added': len(added), 'removed': len(gone), 'added_kinds': dict(collections.Counter(added.values()).most_common(8)),
            'removed_kinds': dict(collections.Counter(gone.values()).most_common(8))}


# ------------------------------------------------------------------ selftest: synthetic fixtures with a known answer (Codex r1)
class FakeWorld:
    """Ground: stone below y 64, grass_block at 64. block()/props()/natural_top() as World's."""
    def __init__(self):
        self.b = {}; self.p = {}
    def set(self, x, y, z, n, props=None):
        self.b[(x, y, z)] = 'minecraft:' + n
        if props: self.p[(x, y, z)] = props
    def block(self, x, y, z):
        if (x, y, z) in self.b: return self.b[(x, y, z)]
        return 'minecraft:stone' if y < 64 else ('minecraft:grass_block' if y == 64 else 'minecraft:air')
    def props(self, x, y, z): return self.p.get((x, y, z), {})
    def natural_top(self, x, z):
        y = 120
        while y > -64 and not natural_solid(self.block(x, y, z)): y -= 1
        return y

def house(w, x0, z0, light='torch', door=True, roof=True, walls=True):
    for x in range(x0, x0 + 5):
        for z in range(z0, z0 + 5):
            w.set(x, 64, z, 'stone_bricks')
            if roof: w.set(x, 67, z, 'oak_planks')
            edge = x in (x0, x0 + 4) or z in (z0, z0 + 4)
            if edge and walls:
                for y in (65, 66):
                    if door and (x, z) == (x0 + 2, z0): continue
                    w.set(x, y, z, 'oak_planks')
    if light == 'torch': w.set(x0 + 2, 65, z0 + 2, 'torch')
    elif light == 'lamp_off': w.set(x0 + 2, 65, z0 + 2, 'redstone_lamp', {'lit': 'false'})
    elif light == 'lamp_on': w.set(x0 + 2, 65, z0 + 2, 'redstone_lamp', {'lit': 'true'})
    elif light == 'below': w.set(x0 + 2, 63, z0 + 2, 'glowstone')
    elif light == 'none': pass

def count(w):
    built = {k: v for k, v in w.b.items() if BUILT.match(v)}
    comps = components(built)
    structs = describe(w, comps, built, (0, 64, 0), built)
    rooms = {tuple(rm['key']): rm for s in structs for rm in s['rooms']}
    return sum(1 for r in rooms.values() if r['lit']), sum(1 for r in rooms.values() if not r['lit']), len([s for s in structs])

def selftest(quiet=False):
    cases = []
    w = FakeWorld(); house(w, 0, 0); cases.append(('one lit house', count(w)[:2], (1, 0)))
    w = FakeWorld(); house(w, 0, 0); house(w, 8, 0)
    for x in range(5, 8): w.set(x, 65, 2, 'cobblestone')          # the two houses joined by a cobble line: ONE component
    cases.append(('two houses joined by cobble', count(w)[:2], (2, 0)))
    w = FakeWorld(); house(w, 0, 0)
    for k in range(0, 40): w.set(5 + (k % 3), 63 - k, 2 + (k // 3) % 2, 'cobblestone')   # a buried mine stair touching it
    for k in range(0, 40): w.set(5 + (k % 3), 64 - k, 3, 'cobblestone')
    cases.append(('house joined to a buried stair', count(w)[:2], (1, 0)))
    w = FakeWorld(); house(w, 0, 0, light='lamp_off'); cases.append(('unlit lamp only', count(w)[:2], (0, 1)))
    w = FakeWorld(); house(w, 0, 0, light='lamp_on'); cases.append(('lit lamp', count(w)[:2], (1, 0)))
    w = FakeWorld(); house(w, 0, 0, light='below'); cases.append(('light below the floor only', count(w)[:2], (0, 1)))
    w = FakeWorld(); house(w, 0, 0, door=False); cases.append(('no doorway', count(w)[:2], (0, 0)))
    w = FakeWorld(); house(w, 0, 0, roof=False); cases.append(('no roof', count(w)[:2], (0, 0)))
    w = FakeWorld(); house(w, 0, 0, walls=False); cases.append(('no walls (open pavilion)', count(w)[:2], (0, 0)))
    w = FakeWorld(); house(w, 0, 0, light='none'); w.set(2, 65, -1, 'torch')     # a torch just outside the doorway only
    cases.append(('torch outside the doorway only', count(w)[:2], (0, 1)))
    w = FakeWorld(); house(w, 0, 0, light='none'); w.set(2, 65, 2, 'redstone_torch', {'lit': 'false'})
    cases.append(('unlit redstone torch only', count(w)[:2], (0, 1)))
    w = FakeWorld(); house(w, 0, 0, roof=False)
    for x in range(0, 5):
        for z in range(0, 5): w.set(x, 67, z, 'torch')                         # a "roof" of torches is no roof
    cases.append(('a roof of torches', count(w)[:2], (0, 0)))
    # the plinth control's own fixtures: correct, wrong block, disconnected, never built, empty
    def pl(blocks, state, cells):
        w = FakeWorld()
        for c, n in zip(cells, blocks): w.set(*c, n)
        built = {k: v for k, v in w.b.items() if BUILT.match(v)}
        comps = components(built); structs = describe(w, comps, built, (0, 64, 0), built)
        return plinth_check(w, cells, built, comps, structs, state)['verdict']
    line = [(x, 65, 0) for x in range(14)]
    cases.append(('plinth: correct', (pl(['cobblestone'] * 14, 'complete', line),), ('pass',)))
    cases.append(('plinth: wrong block', (pl(['oak_planks'] * 14, 'complete', line),), ('FAIL',)))
    split = [(x, 65, 0) for x in range(7)] + [(x + 20, 65, 0) for x in range(7)]
    cases.append(('plinth: disconnected cells', (pl(['cobblestone'] * 14, 'complete', split),), ('FAIL',)))
    cases.append(('plinth: never built (plan)', (pl([], 'plan', line),), ('pass',)))
    cases.append(('plinth: empty plan', (pl([], 'complete', []),), ('no_cells',)))
    bad = [c for c in cases if tuple(c[1]) != c[2]]
    lines = ['%-34s got %s want %s %s' % (c[0], c[1], c[2], 'ok' if tuple(c[1]) == c[2] else 'FAIL') for c in cases]
    if not quiet:
        for l in lines:
            print(l)
    return {'cases': len(cases), 'failed': len(bad), 'lines': lines}


# ------------------------------------------------------------------ validation: what a world's numbers must show before they are published
STAMP_CELLS = 207           # place-town.py town_plan(): 169 platform + 3 chests + 10 bed halves + 24 torches + 1 lectern
STAMP_FLOOR = 150           # an ABSOLUTE floor (10-23: 170-199 present in all 16 bench worlds): a blind read cannot pass it
STAMP_KEEP = 0.9            # and no more than 10% lost since the last good day
NEG_MIN_CHUNKS = 60         # the negative control must have SEEN fully generated, never-ticked chunks (10-23: 120 of 120)
PALETTE_FLOOR = 1000        # placed-palette cells in the box before masking (10-23: 8,681-41,643 per bench world)


def validate(scan_res, neg_res, last=None):
    """The problems that make a world's numbers UNPUBLISHABLE (an empty list = publishable). Every check is a POSITIVE
    control in the sense of CLAUDE.md: it must see a presence, so an instrument that reads nothing (a blind region, a broken
    decoder, an empty palette) fails here instead of publishing zeros."""
    bad = []
    if scan_res.get('box_chunks', 0) <= 0 or scan_res.get('box_chunks_ok') != scan_res.get('box_chunks'):
        bad.append('coverage %s of %s box chunks ok (%s)' % (scan_res.get('box_chunks_ok'), scan_res.get('box_chunks'), scan_res.get('chunks')))
    if scan_res.get('worldgen_starts_unreadable'):
        bad.append('%s unresolved structure starts' % scan_res['worldgen_starts_unreadable'])
    if scan_res.get('stamp_cells') != STAMP_CELLS:
        bad.append('stamp model %s cells, want %s' % (scan_res.get('stamp_cells'), STAMP_CELLS))
    sp = scan_res.get('stamp_present', 0)
    if sp < STAMP_FLOOR:
        bad.append('stamp control %s < floor %s' % (sp, STAMP_FLOOR))
    if last and last.get('stamp_present') and sp < STAMP_KEEP * last['stamp_present']:
        bad.append('stamp control %s < %d%% of the last good %s' % (sp, round(100 * STAMP_KEEP), last['stamp_present']))
    if scan_res.get('raw_palette_cells', 0) < PALETTE_FLOOR:
        bad.append('palette cells %s < floor %s' % (scan_res.get('raw_palette_cells'), PALETTE_FLOOR))
    if neg_res.get('uninhabited_full_chunks', 0) < NEG_MIN_CHUNKS:
        bad.append('negative control saw %s never-ticked full chunks < %s' % (neg_res.get('uninhabited_full_chunks'), NEG_MIN_CHUNKS))
    for what, r in (('scan', scan_res), ('negative control', neg_res)):
        if r.get('undecoded_hit_sections', 1) != 0:
            bad.append('%s undecoded: %s matching sections could not be decoded' % (what, r.get('undecoded_hit_sections')))
    if neg_res.get('observed_chunks', 0) < max(NEG_MIN_CHUNKS, neg_res.get('uninhabited_full_chunks', 0)):
        bad.append('negative control blind: observed %s of %s never-ticked chunks' % (neg_res.get('observed_chunks'), neg_res.get('uninhabited_full_chunks')))
    if neg_res.get('fp_cells_surface', 1) != 0:
        bad.append('negative control: %s surface false positives' % neg_res.get('fp_cells_surface'))
    return bad


# ------------------------------------------------------------------ daily: the cron entry (10.0.0.30, mike)
EXIT = {'ok': 0, 'not_yet': 0, 'already': 0, 'selftest': 3, 'invalid': 4, 'aggregate': 5, 'publish': 6, 'attempt': 7, 'busy': 8}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def atomic_json(path, obj):
    tmp = '%s.tmp.%d' % (path, os.getpid())
    with open(tmp, 'w') as f:
        json.dump(obj, f); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)


def load_json(path):
    try:
        return json.load(open(path))
    except Exception:
        return None


RESIDUAL_MAX = 20          # design 2.5: a world whose two-pass copy left more than 20 files changing is UNKNOWN for the day
OK_LINE = re.compile(r' ok ([A-Za-z0-9_.-]+): (?:.* )?residual=(\d+)(?=\s|$)')


def backup_record(log_path, day, expect=None):
    """world-backup.sh's record of <day>'s run -> (good, {world: residual}). `good` is the run's `good <day>:` line; the
    residuals are the per-world `ok <world>: ... residual=N` lines between that run's `start <day>:` and its `good`. A later
    run of the same day replaces an earlier one; a run whose `start` line names a world count other than `expect` (another
    host's copy of the script logging here) is ignored (Claude r2 P3-2). (False, {}) when the day has no good line yet."""
    good, cur, done = False, None, {}
    try:
        for line in open(log_path, errors='replace'):
            if (' start %s:' % day) in line:
                n = re.search(r' start %s: (\d+) ' % re.escape(day), line)
                if expect is not None and (not n or int(n.group(1)) != expect):
                    cur = None; continue                     # not the fleet's run
                cur, good, done = {}, False, {}            # a run in progress: its staging is not the earlier run's
            elif (' good %s:' % day) in line and cur is not None:   # only the good of a run we followed
                good, done = True, dict(cur or {})
                cur = None
            elif cur is not None:
                m = OK_LINE.search(line)
                if m:
                    cur[m.group(1)] = int(m.group(2))
    except OSError:
        return False, {}
    return good, done


def backup_done(log_path, day):
    """The night's backup logged `good <day>:` (world-backup.sh's line for a complete night): the staged worlds are that night's."""
    return backup_record(log_path, day)[0]


def last_good(out):
    """(generation dir, its day doc) of the manifest's last_good, VALIDATED by its sha256; (None, None) if there is none;
    ('INVALID', why) if the file is missing or altered."""
    m = load_json(os.path.join(out, 'manifest.json'))
    lg = (m or {}).get('last_good')
    if not lg:
        return None, None
    p = os.path.join(out, lg['generation'], 'structcount-day.json')
    if not os.path.exists(p) or sha256(p) != lg['sha']:
        return 'INVALID', 'the last_good baseline %s fails its hash' % lg['generation']
    return os.path.join(out, lg['generation']), load_json(p)


def publish(out, day, attempt, status, why, gen=None, extra=None):
    """ONE rename publishes: the manifest names the day, the attempt, the status, the generation, every file's sha256 and
    last_good (carried forward through UNKNOWN manifests, so the stamp control keeps its baseline)."""
    m = load_json(os.path.join(out, 'manifest.json')) or {}
    files = {f: sha256(os.path.join(out, gen, f)) for f in sorted(os.listdir(os.path.join(out, gen)))} if gen else {}
    lg = {'generation': gen, 'sha': files['structcount-day.json']} if status == 'OK' else m.get('last_good')
    man = {'schema': 'structcount-manifest/1', 'day': day, 'attempt': attempt, 'status': status, 'why': why,
           'generation': gen, 'files': files, 'last_good': lg}
    man.update(extra or {})
    atomic_json(os.path.join(out, 'manifest.json'), man)


def sudo(cmd, **kw):
    return subprocess.run(['sudo', '-n'] + cmd, capture_output=True, **kw)


def copy_world(staging, world, home, dest):
    """The 3x3 region files around home, from the STAGED backup copy (read-only: sudo -n tar -c; extracted as mike, mtimes kept)."""
    rx, rz = home[0] >> 9, home[2] >> 9
    want = ['region/r.%d.%d.mca' % (rx + a, rz + b) for a in (-1, 0, 1) for b in (-1, 0, 1)]
    src = os.path.join(staging, world, 'world')
    have = sudo(['ls', os.path.join(src, 'region')], text=True)
    if have.returncode != 0:
        return 'cannot list %s/region' % src
    names = set(have.stdout.split())
    want = [x for x in want if os.path.basename(x) in names]
    if not want:
        return 'no region files around home'
    os.makedirs(os.path.join(dest, 'region'), exist_ok=True)
    tar = subprocess.Popen(['sudo', '-n', 'tar', '-C', src, '-cf', '-'] + want, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    ex = subprocess.run(['tar', '-xf', '-', '-C', dest, '--no-same-owner'], stdin=tar.stdout, capture_output=True)
    tar.stdout.close(); tar.wait()
    if tar.returncode or ex.returncode:
        return 'copy failed (tar %s / extract %s)' % (tar.returncode, ex.returncode)
    return None


def world_list(staging):
    r = sudo(['sh', '-c', 'for d in %s/*/; do [ -f "$d/TOWN-PLACED.json" ] && basename "$d"; done' % staging], text=True)
    return sorted(r.stdout.split()) if r.returncode == 0 else []


def world_home(staging, world):
    r = sudo(['cat', os.path.join(staging, world, 'TOWN-PLACED.json')], text=True)
    if r.returncode:
        return None
    h = json.loads(r.stdout).get('home')
    return tuple(int(v) for v in h) if h and len(h) == 3 else None


def dt_now():
    return datetime.datetime.now(datetime.timezone.utc)


def daily(a, fail_at=None):
    """The cron entry. `fail_at` (tests and the install demonstration only) injects a failure at a named step."""
    out, att_dir, work = (os.path.expanduser(a[k]) for k in ('out', 'attempts', 'work'))
    for d in (out, att_dir):
        os.makedirs(d, exist_ok=True)
    lockf = open(os.path.join(att_dir, '.daily.lock'), 'w')
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)          # one run at a time; a second one exits at once
    except OSError:
        print('busy: another daily run holds the lock'); return EXIT['busy']
    now = dt_now()
    day = a.get('day') or now.strftime('%Y-%m-%d')
    m = load_json(os.path.join(out, 'manifest.json')) or {}
    newest = load_json(os.path.join(att_dir, 'attempt.json')) or {}
    if not a.get('force') and m.get('day') == day and m.get('status') == 'OK' and m.get('attempt') == newest.get('attempt'):
        print('already published for %s (%s)' % (day, m.get('generation'))); return EXIT['already']
    residual = None                                                  # None: --skip-backup-check (trials and tests only)
    if not a.get('skip_backup_check'):
        good, residual = backup_record(a['backup_log'], day, a.get('expect'))
        if not good:
            print('not yet: the backup has not logged good %s' % day); return EXIT['not_yet']
    attempt = now.strftime('%Y%m%dT%H%M%S') + '.%03dZ-%d' % (now.microsecond // 1000, os.getpid())
    try:                                                              # the ATTEMPT, first (design 2.6)
        if fail_at == 'attempt':
            raise OSError('injected')
        atomic_json(os.path.join(att_dir, 'attempt.json'), {'attempt': attempt, 'day': day, 'started': now.isoformat()})
    except OSError as e:
        print('cannot record the attempt (%s): nothing touched' % e); return EXIT['attempt']

    def ended(code):
        try:                                                          # the attempt's END (the reader: an ended attempt with no
            atomic_json(os.path.join(att_dir, 'attempt.json'),        # manifest of its own is UNKNOWN, never RUNNING)
                        {'attempt': attempt, 'day': day, 'started': now.isoformat(), 'ended': dt_now().isoformat(), 'exit': code})
        except OSError:
            pass
        return code

    def unknown(why, code):
        try:
            if fail_at == 'manifest':
                raise OSError('injected')
            publish(out, day, attempt, 'UNKNOWN', why)
        except OSError as e:
            print('manifest not writable (%s): the reader sees an attempt with no manifest = UNKNOWN' % e)
        print('UNKNOWN: %s' % why); return ended(code)

    try:
        return _daily_body(a, fail_at, out, att_dir, work, day, residual, attempt, ended, unknown)
    except Exception as e:                                            # noqa: BLE001 -- the alarm must carry the crash
        shutil.rmtree(work, ignore_errors=True)
        return unknown('crash: %s: %s' % (type(e).__name__, str(e)[:200]), EXIT['invalid'])


def _daily_body(a, fail_at, out, att_dir, work, day, residual, attempt, ended, unknown):
    st = selftest(quiet=True)
    if st['failed'] or fail_at == 'selftest':
        return unknown('selftest failed: ' + '; '.join(l for l in st['lines'] if l.endswith('FAIL')), EXIT['selftest'])
    here = os.path.dirname(os.path.abspath(__file__))
    gate = subprocess.run(a.get('gate_cmd') or [sys.executable, '-B', os.path.join(here, 'test_structcount.py'), '--daily-gate'],
                          capture_output=True, text=True)
    if gate.returncode:
        return unknown('test_structcount.py --daily-gate failed: ' + (gate.stdout + gate.stderr).strip()[-400:], EXIT['selftest'])
    base_dir, base = last_good(out)
    if base_dir == 'INVALID':
        return unknown(base, EXIT['invalid'])
    worlds = a.get('worlds_fn', world_list)(a['staging'])
    if len(worlds) != a['expect']:
        return unknown('staging holds %d worlds, want %d' % (len(worlds), a['expect']), EXIT['invalid'])
    shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
    days, cells, problems, old_cells = {}, {}, {}, {}
    if base_dir:
        try:
            with gzip.open(os.path.join(base_dir, 'cells.json.gz'), 'rt') as g:
                old_cells = json.load(g)
        except Exception:
            old_cells = {}
    for w in worlds:
        if residual is not None and w not in residual:
            problems[w] = ['no `ok %s: ... residual=` line in the backup log for %s' % (w, day)]; continue
        if residual is not None and residual[w] > RESIDUAL_MAX:
            problems[w] = ['backup residual %d > %d files' % (residual[w], RESIDUAL_MAX)]; continue
        if fail_at == 'crash':
            raise ValueError('injected')
        home = a.get('home_fn', world_home)(a['staging'], w)
        if not home:
            problems[w] = ['no home in TOWN-PLACED.json']; continue
        err = a.get('copy_fn', copy_world)(a['staging'], w, home, os.path.join(work, w))
        if err:
            problems[w] = [err]; continue
        rdir = os.path.join(work, w, 'region')
        _regions.clear()
        res = scan(w, rdir, home, a['r'], True, None, [])
        neg = negctl(w, rdir, home, a['r'], 120)
        _regions.clear()
        if a.get('stamp_override') is not None:
            res['stamp_present'] = a['stamp_override']
        bad = validate(res, neg, (base or {}).get(w))
        if bad or fail_at == 'scan':
            problems[w] = bad or ['injected']; continue
        cells[w] = res.pop('cells')
        res['negative_control'] = {k: neg[k] for k in ('uninhabited_full_chunks', 'observed_chunks', 'fp_cells_surface', 'fp_cells_buried')}
        if residual is not None:
            res['backup_residual'] = residual[w]
        if w in old_cells:
            res['since_last_good'] = delta_cells(old_cells[w], cells[w], home, a['r'])
        days[w] = res
    shutil.rmtree(work, ignore_errors=True)
    if problems:
        return unknown('invalid: ' + '; '.join('%s: %s' % (w, ', '.join(p)) for w, p in sorted(problems.items())), EXIT['invalid'])
    gen = 'gen-' + attempt
    tmpgen = os.path.join(out, '.' + gen)
    try:
        if fail_at == 'aggregate':
            raise OSError('injected')
        os.makedirs(tmpgen)
        json.dump(days, open(os.path.join(tmpgen, 'structcount-day.json'), 'w'))
        with gzip.open(os.path.join(tmpgen, 'cells.json.gz'), 'wt') as g:
            json.dump(cells, g)
        open(os.path.join(tmpgen, 'selftest.out'), 'w').write('\n'.join(st['lines']) + '\n' + gate.stdout)
    except OSError as e:
        return unknown('aggregation failed: %s' % e, EXIT['aggregate'])
    totals = {'buildings': sum(d['buildings'] for d in days.values()), 'unlit_rooms': sum(d['unlit_rooms'] for d in days.values()),
              'surface_structures': sum(d['surface_structures'] for d in days.values()), 'worlds': len(days)}
    try:
        if fail_at == 'gen_rename':
            raise OSError('injected')
        os.rename(tmpgen, os.path.join(out, gen))                      # the generation is complete before it is named
        if fail_at == 'manifest_ok':
            raise OSError('injected')
        publish(out, day, attempt, 'OK', 'controls passed', gen, {'totals': totals})
    except OSError as e:
        print('publication failed (%s): the reader sees an attempt with no manifest = UNKNOWN' % e); return ended(EXIT['publish'])
    print('published %s (%d worlds; buildings %d)' % (gen, len(days), totals['buildings']))
    try:                                                              # Claude r2 P3-3: housekeeping never un-publishes an OK
        prune(out, keep_days=a.get('keep_days', 60))
    except Exception as e:                                            # noqa: BLE001
        print('prune failed (the OK publication stands): %s' % e)
    return ended(EXIT['ok'])


def prune(out, keep_days=60):
    """Generations older than keep_days are removed, except the manifest's own generation and its last_good (the
    cell lists are ~1-3 MB a day). Only gen-* directories inside out/ are ever touched."""
    m = load_json(os.path.join(out, 'manifest.json')) or {}
    keep = {m.get('generation'), (m.get('last_good') or {}).get('generation')}
    cutoff = time.time() - keep_days * 86400
    for name in os.listdir(out):
        p = os.path.join(out, name)
        if (name.startswith('gen-') or name.startswith('.gen-')) and name not in keep and os.path.isdir(p) and os.path.getmtime(p) < cutoff:
            shutil.rmtree(p, ignore_errors=True)


def main():
    a = sys.argv[1:]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == 'daily':
        sys.exit(daily({'out': opt('--out', '~/structcount/out'), 'attempts': opt('--attempts', '~/structcount/attempts'),
                        'work': opt('--work', '~/structcount/work'), 'staging': opt('--staging', '/srv/world-backup/staging'),
                        'backup_log': opt('--backup-log', '/var/log/mcai-monitor/world-backup.log'),
                        'expect': int(opt('--expect', 16)), 'r': int(opt('--r', 96)), 'day': opt('--day'),
                        'skip_backup_check': '--skip-backup-check' in a, 'force': '--force' in a}, fail_at=opt('--fail-at')))
    if cmd == 'scan':
        plinths = [a[i + 1] for i, v in enumerate(a) if v == '--plinth']
        res = scan(a[1], a[2], parse_home(a[3]), int(opt('--r', 96)), '--stamp' in a, opt('--zones'), plinths)
    elif cmd == 'village':
        res = village(a[1], a[2], parse_home(a[3]))
    elif cmd == 'negctl':
        res = negctl(a[1], a[2], parse_home(a[3]), int(opt('--r', 96)), int(opt('--n', 120)))
    elif cmd == 'selftest':
        res = selftest()
        res.pop('lines', None)
        print(json.dumps(res))
        sys.exit(1 if res['failed'] else 0)
    else:
        sys.exit(__doc__)
    out = opt('--json')
    if out:
        json.dump(res, open(out, 'w'))
    print(json.dumps({k: v for k, v in res.items() if k != 'cells'})[:6000])


if __name__ == '__main__':
    main()
