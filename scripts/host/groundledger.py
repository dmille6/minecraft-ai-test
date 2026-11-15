#!/usr/bin/env python3
"""groundledger.py -- what has been done to a world's ground since it was untouched, column by column (READ ONLY).

Owner 2026-11-14: the cleanup code is restructured around a core that knows what the ground SHOULD be
(docs/reports/land-eval-2026-11-14/RECOMMENDATION.md, step N1). The old code took the highest solid block as "the ground",
so a deck over a gap looked level, and it guessed ownership from material. This tool compares two saves of the same
ground instead: the untouched world (frame zero, or a copy regenerated from the seed) and the world now.

    python3 groundledger.py --base <untouched>/region --live <now>/region --center 366 -34 --radius 64 \
        --ground-y 72 [--pool <dir of project-*.json records>] [--json out.json]

Every cell that differs gets a KIND, and every column a CLASS:

  cell kinds   placed   nothing solid at frame zero, a solid GROUND block now (a torch, chest, slab or fence is a `thing`:
                        counted apart, never ground)
               dug      a solid block at frame zero, nothing solid now
               replaced one solid block for another (stone -> cobblestone), soil for soil not counted
               soil     dirt, grass, path, farmland changing among themselves: weather and feet, not counted as a change
               felled / grown   tree blocks gone or new          plants, fluid   reported, never a column's class

  column classes, first match wins
               build         a changed cell is owned by a town project record (--pool): meant to be there
               undermined    ground was dug out UNDER blocks that are still there: a roofed hollow that did not exist
               over_gap      a placed block with nothing solid under it: a deck, a beam, a floating leftover
               pillar        placed blocks standing on the ground, two or more high
               raised        one placed block on the ground
               filled        placed blocks only at or under the frame-zero surface: a natural hole or cave filled in
               pit           dug from the top down, open to the sky
               changed       only replaced blocks at the surface
               natural       nothing but soil, plants, trees and fluid moved
  A column whose only digging is deeper than --mine-depth under the frame-zero surface is `natural` with mined_below
  counted apart: mining is wanted, a hole in the lawn is not.

Nothing is written but the --json file. The two saves must cover the box (a missing chunk is refused, never read as empty
ground). With base == live every column is natural: that is the control, and `--self-check` runs it."""
import argparse
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

AIR, PLANT, TREE, FLUID, THING, SOLID = 'air', 'plant', 'tree', 'fluid', 'thing', 'solid'
AIRS = frozenset(('air', 'cave_air', 'void_air'))
FLUIDS = frozenset(('water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'))
SOIL = frozenset(('dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'dirt_path', 'farmland', 'mud'))
TREE_RE = re.compile(r'(_leaves|_log|_wood|_stem|_hyphae)$|^(mangrove_roots|bee_nest)$')
PLANT_RE = re.compile(
    r'(_sapling|_bush|_tulip|_orchid|_mushroom|_fungus|_roots|_sprouts|_vines?(_plant)?|_petals|_carpet|_blossom|_fern|_grass)$'
    r'|^(short_grass|tall_grass|grass|fern|large_fern|dandelion|poppy|allium|azure_bluet|oxeye_daisy|cornflower'
    r'|lily_of_the_valley|sunflower|lilac|rose_bush|peony|vine|snow|dead_bush|sugar_cane|bamboo|bamboo_sapling|cactus'
    r'|lily_pad|sweet_berry_bush|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|cocoa|torchflower|pitcher_plant'
    r'|moss_carpet|glow_lichen|hanging_roots|spore_blossom|big_dripleaf|small_dripleaf|firefly_bush|leaf_litter|wildflowers)$')
# placed things that are not ground: a torch on the lawn is not a raised column, and a stray crafting table is junk of its own kind
THING_RE = re.compile(
    r'(torch|lantern|ladder|chest|barrel|_table|furnace|smoker|_bed|_door|_trapdoor|_fence|_fence_gate|_wall|_slab|_stairs'
    r'|_sign|glass|_pane|campfire|composter|anvil|bell|_button|_pressure_plate|rail|scaffolding|flower_pot|cauldron|hopper'
    r'|_banner|lectern|loom|grindstone|stonecutter|brewing_stand|_candle|chain|iron_bars|lightning_rod|_shulker_box)$'
    r'|^(torch|ladder|chest|barrel|furnace|smoker|composter|bell|rail|scaffolding|glass|chain|iron_bars)$')
CLASSES = ('build', 'undermined', 'over_gap', 'pillar', 'raised', 'filled', 'pit', 'changed', 'natural')


def group(name):
    """The broad kind of a block name (no `minecraft:` prefix; None = nothing there). Pure."""
    if name is None or name in AIRS:
        return AIR
    if name in FLUIDS:
        return FLUID
    if TREE_RE.search(name):
        return TREE
    if PLANT_RE.search(name):
        return PLANT
    if THING_RE.search(name):
        return THING
    return SOLID


def cell_kind(base, live):
    """What happened to one cell between frame zero and now -> None | placed | dug | replaced | soil | felled | grown |
    plants | fluid | thing | thing_gone. Pure. Ownership is never read from the material: dirt placed is `placed`, dirt always there is None."""
    if base == live:
        return None
    gb, gl = group(base), group(live)
    if THING in (gb, gl) and SOLID not in (gb, gl):
        return 'thing' if gl == THING else 'thing_gone'
    if gb == SOLID and gl == SOLID:
        return 'soil' if base in SOIL and live in SOIL else 'replaced'
    if gl == SOLID:
        return 'placed'
    if gb == SOLID:
        return 'dug'
    if gb == TREE and gl != TREE:
        return 'felled'
    if gl == TREE and gb != TREE:
        return 'grown'
    if FLUID in (gb, gl):
        return 'fluid'
    return 'plants'


def top_solid(col, y_hi, y_lo):
    """The highest y in [y_lo, y_hi] holding a SOLID block in a column {y: name}, else None. Pure."""
    for y in range(y_hi, y_lo - 1, -1):
        if group(col.get(y)) == SOLID:
            return y
    return None


def classify_column(base, live, y_lo, y_hi, owned=frozenset(), mine_depth=8):
    """One column, base and live as {y: name} (a missing y is air) -> a dict: cls, hb, hl, placed [y], dug [y] (the dug
    cells no deeper than mine_depth under the frame-zero surface), mined (count of deeper dug cells), replaced [y],
    gap (air cells under the lowest unsupported placed block). `owned`: the ys a project record owns. Pure."""
    hb, hl = top_solid(base, y_hi, y_lo), top_solid(live, y_hi, y_lo)
    placed, dug, replaced, mined = [], [], [], 0
    floor = (hb if hb is not None else y_hi) - mine_depth
    for y in range(y_lo, y_hi + 1):
        k = cell_kind(base.get(y), live.get(y))
        if k == 'placed':
            placed.append(y)
        elif k == 'replaced':
            replaced.append(y)
        elif k == 'dug':
            if y >= floor:
                dug.append(y)
            else:
                mined += 1
    things = [y for y in range(y_lo, y_hi + 1) if cell_kind(base.get(y), live.get(y)) == 'thing' and y not in owned]
    out = {'hb': hb, 'hl': hl, 'placed': placed, 'dug': dug, 'replaced': replaced, 'mined': mined, 'gap': 0, 'things': things}
    solid_live = lambda y: group(live.get(y)) == SOLID
    if not placed and not dug and not replaced:
        out['cls'] = 'natural'
    elif any(y in owned for y in placed + dug + replaced):
        out['cls'] = 'build'
    elif any(not solid_live(y) and any(solid_live(u) for u in range(y + 1, y_hi + 1)) for y in dug):
        out['cls'] = 'undermined'                # dug, and still roofed by something
    else:
        unsupported = [y for y in placed if y > y_lo and not solid_live(y - 1)]
        if unsupported:
            y0 = min(unsupported)
            g = 0
            while y0 - 1 - g >= y_lo and not solid_live(y0 - 1 - g):
                g += 1
            out['gap'] = g
            out['cls'] = 'over_gap'
        elif placed:
            above = [y for y in placed if hb is None or y > hb]
            out['cls'] = 'pillar' if len(above) >= 2 else 'raised' if above else 'filled'
        elif dug:
            out['cls'] = 'pit'
        else:
            out['cls'] = 'changed'
    return out


def columns_of(dump):
    """A regiondump result -> {(x, z): {y: name}}."""
    names = [p['name'] for p in dump['palette']]
    cols = collections.defaultdict(dict)
    for x, y, z, i in dump['cells']:
        cols[(x, z)][y] = names[i]
    return cols


def owned_cells(pool_dir):
    """{(x, z): {y: plot}} from the newest record of every town project in a pool directory (the tidy record is the
    cleanup's own plan, not a build, and is left out)."""
    best = {}
    for f in glob.glob(os.path.join(pool_dir, 'project-*.g*.json')):
        m = re.match(r'project-[^.]+\.([A-Za-z0-9_]+)\.g(\d+)\.json$', os.path.basename(f))
        if m and int(m.group(2)) >= best.get(m.group(1), (-1, ''))[0]:
            best[m.group(1)] = (int(m.group(2)), f)
    own = collections.defaultdict(dict)
    for plot, (_, f) in best.items():
        if plot == 'tidy':
            continue
        try:
            rec = json.load(open(f))
        except (OSError, ValueError):
            continue
        for c in rec.get('cells') or []:
            a = c.get('at') if isinstance(c, dict) else None
            if isinstance(a, list) and len(a) == 3:
                own[(a[0], a[2])].setdefault(a[1], plot)
    return own


def ledger(base_cols, live_cols, cx, cz, radius, y_lo, y_hi, own=None, mine_depth=8, rings=(32, 48, 64, 96, 128)):
    """Every column within `radius` (a square) of the centre -> (summary dict, rows). rows: one per column that is not
    natural: [x, z, cls, hb, hl, n placed, n dug, gap]."""
    own = own or {}
    rings = [r for r in rings if r < radius] + [radius]
    by_ring = {r: collections.Counter() for r in rings}
    placed_names, dug_names = collections.Counter(), collections.Counter()
    cells = collections.Counter()
    thing_names = collections.Counter()
    rows = []
    for x in range(cx - radius, cx + radius + 1):
        for z in range(cz - radius, cz + radius + 1):
            b, l = base_cols.get((x, z), {}), live_cols.get((x, z), {})
            c = classify_column(b, l, y_lo, y_hi, frozenset(own.get((x, z), ())), mine_depth)
            d = max(abs(x - cx), abs(z - cz))
            for r in rings:
                if d <= r:
                    by_ring[r][c['cls']] += 1
            cells['placed'] += len(c['placed'])
            cells['dug_surface'] += len(c['dug'])
            cells['mined_below'] += c['mined']
            cells['replaced'] += len(c['replaced'])
            cells['gap_air'] += c['gap']
            for y in c['things']:
                thing_names[l.get(y)] += 1
            if c['cls'] != 'natural':
                for y in c['placed']:
                    placed_names[l.get(y)] += 1
                for y in c['dug']:
                    dug_names[b.get(y)] += 1
                rows.append([x, z, c['cls'], c['hb'], c['hl'], len(c['placed']), len(c['dug']), c['gap']])
    summary = {'center': [cx, cz], 'radius': radius, 'y': [y_lo, y_hi], 'mine_depth': mine_depth,
               'columns': {str(r): dict(by_ring[r], total=(2 * r + 1) ** 2) for r in rings},
               'cells': dict(cells), 'placed_names': placed_names.most_common(15), 'dug_names': dug_names.most_common(15),
               'loose_things': thing_names.most_common(15)}
    return summary, rows


BANDS = (64, 128, 256, 512, 1024, 10 ** 9)


def band_of(d, bands=BANDS):
    """The first band edge a distance falls within. Pure."""
    for b in bands:
        if d <= b:
            return b
    return bands[-1]


def chunk_stamps(region_dir):
    """{(cx, cz): the chunk's save stamp} for every chunk present in a region directory (the 4-byte stamps in each file's
    header; 0 offsets are absent chunks)."""
    import struct
    out = {}
    for f in os.listdir(region_dir):
        m = re.match(r'r\.(-?\d+)\.(-?\d+)\.mca$', f)
        if not m:
            continue
        with open(os.path.join(region_dir, f), 'rb') as fh:
            head = fh.read(8192)
        if len(head) < 8192:
            continue
        rx, rz = int(m.group(1)), int(m.group(2))
        for i in range(1024):
            if struct.unpack_from('>I', head, 4 * i)[0]:
                out[(rx * 32 + (i & 31), rz * 32 + (i >> 5))] = struct.unpack_from('>I', head, 4096 + 4 * i)[0]
    return out


def whole_map(RD, base_dir, live_dir, cx, cz, own=None, mine_depth=8, y_lo=-64, y_hi=255, same_copy=True, progress=None):
    """Every chunk the two saves share -> (summary, per-chunk rows). With same_copy (the base is a COPY of the same world,
    not a regeneration) a chunk whose save stamp is unchanged was never saved again and is skipped as untouched: that is
    what makes a whole map affordable. rows: [chunk x, chunk z, distance of its centre from home, {class: columns}]."""
    own = own or {}
    bs, ls = chunk_stamps(base_dir), chunk_stamps(live_dir)
    shared = sorted(set(bs) & set(ls))
    todo = [c for c in shared if not same_copy or bs[c] != ls[c]]
    by_band = {b: collections.Counter() for b in BANDS}
    cells, rows, unread = collections.Counter(), [], 0
    for n, (kx, kz) in enumerate(todo):
        box = (kx * 16, kx * 16 + 15, kz * 16, kz * 16 + 15, y_lo, y_hi)
        try:
            bd, ld = RD.dump(base_dir, *box), RD.dump(live_dir, *box)
        except Exception:                                   # noqa: BLE001 -- an unreadable chunk is counted, never guessed
            unread += 1
            continue
        if bd['missing_chunks'] or ld['missing_chunks']:
            unread += 1
            continue
        bc, lc = columns_of(bd), columns_of(ld)
        cc = collections.Counter()
        for x in range(box[0], box[1] + 1):
            for z in range(box[2], box[3] + 1):
                c = classify_column(bc.get((x, z), {}), lc.get((x, z), {}), y_lo, y_hi, frozenset(own.get((x, z), ())), mine_depth)
                cc[c['cls']] += 1
                by_band[band_of(max(abs(x - cx), abs(z - cz)))][c['cls']] += 1
                cells['placed'] += len(c['placed']); cells['dug_surface'] += len(c['dug']); cells['mined_below'] += c['mined']
                cells['loose_things'] += len(c['things'])
        if set(cc) - {'natural'}:
            rows.append([kx, kz, max(abs(kx * 16 + 8 - cx), abs(kz * 16 + 8 - cz)), {k: v for k, v in cc.items() if k != 'natural'}])
        if progress and n % 200 == 0:
            progress(n, len(todo))
    summary = {'center': [cx, cz], 'chunks_shared': len(shared), 'chunks_saved_again': len(todo) if same_copy else None,
               'chunks_read': len(todo) - unread, 'chunks_unread': unread, 'columns_by_band': {str(b): dict(c) for b, c in by_band.items()},
               'cells': dict(cells)}
    return summary, rows


def render_whole(summary, rows):
    out = ['GROUND LEDGER, WHOLE MAP  centre %s' % summary['center'],
           'CONTROL chunks in both saves %s | saved again since the untouched copy %s | read %s | unreadable %s' % (
               summary['chunks_shared'], summary['chunks_saved_again'], summary['chunks_read'], summary['chunks_unread']),
           '', 'columns by class, by distance from the centre (bands; only chunks that were read):',
           '  %8s %9s %s' % ('up to', 'columns', '  '.join('%10s' % c for c in CLASSES))]
    for b, c in summary['columns_by_band'].items():
        tot = sum(c.values())
        if tot:
            out.append('  %8s %9d %s' % ('beyond' if int(b) >= 10 ** 9 else b, tot, '  '.join('%10d' % c.get(k, 0) for k in CLASSES)))
    out += ['', 'cells: %s' % summary['cells'], 'chunks with anything not natural: %d' % len(rows), 'the 12 most changed chunks (chunk x, z, blocks from home, classes):']
    for r in sorted(rows, key=lambda r: -sum(r[3].values()))[:12]:
        out.append('   %5d %5d  %5d  %s' % (r[0], r[1], r[2], r[3]))
    return '\n'.join(out)


def render(summary, base_meta, live_meta):
    out = ['GROUND LEDGER  centre %s  radius %d  y %s' % (summary['center'], summary['radius'], summary['y']),
           'CONTROL base saved %s..%s chunks %s missing %s | live saved %s..%s chunks %s missing %s' % (
               base_meta.get('saved'), base_meta.get('saved_newest'), base_meta.get('chunks'), base_meta.get('missing_chunks'),
               live_meta.get('saved'), live_meta.get('saved_newest'), live_meta.get('chunks'), live_meta.get('missing_chunks')),
           '', 'columns by class, within N blocks of the centre (a square):',
           '  %6s %8s %s' % ('within', 'columns', '  '.join('%10s' % c for c in CLASSES))]
    for r, c in summary['columns'].items():
        out.append('  %6s %8d %s' % (r, c['total'], '  '.join('%10d' % c.get(k, 0) for k in CLASSES)))
        made = c['total'] - c.get('natural', 0)
        out.append('  %6s %8s not natural: %d (%.1f%%)' % ('', '', made, 100.0 * made / c['total']))
    out += ['', 'cells: %s' % summary['cells'],
            'placed, by block: %s' % summary['placed_names'], 'dug at the surface, by the block that was there: %s' % summary['dug_names'],
            'things placed that no build record owns: %s' % summary['loose_things']]
    return '\n'.join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--base', required=True, help='region directory of the untouched world')
    ap.add_argument('--live', help='region directory of the world now')
    ap.add_argument('--center', nargs=2, type=int, required=True, metavar=('X', 'Z'))
    ap.add_argument('--radius', type=int, default=64)
    ap.add_argument('--ground-y', type=int, default=None, help='about where the ground is (the town home y); not used by --whole-map')
    ap.add_argument('--below', type=int, default=24)
    ap.add_argument('--above', type=int, default=40)
    ap.add_argument('--mine-depth', type=int, default=8)
    ap.add_argument('--pool', help='directory of project-*.g*.json records')
    ap.add_argument('--json')
    ap.add_argument('--self-check', action='store_true', help='compare the base with itself: every column must be natural')
    ap.add_argument('--whole-map', action='store_true', help='every chunk both saves hold, by distance from the centre')
    ap.add_argument('--regenerated-base', action='store_true', help='--whole-map: the base is a regeneration, not a copy, so no chunk can be skipped by its save stamp')
    a = ap.parse_args(argv)
    import regiondump as RD
    cx, cz = a.center
    if a.whole_map:
        summary, rows = whole_map(RD, a.base, a.live, cx, cz, owned_cells(a.pool) if a.pool else None, a.mine_depth, same_copy=not a.regenerated_base,
                                  progress=lambda n, t: print('  ... chunk %d of %d' % (n, t), file=sys.stderr, flush=True))
        print(render_whole(summary, rows))
        if a.json:
            json.dump({'summary': summary, 'row_fields': ['chunk_x', 'chunk_z', 'blocks_from_home', 'classes'], 'rows': rows}, open(a.json, 'w'))
        return 0
    if a.ground_y is None:
        raise SystemExit('--ground-y is required unless --whole-map')
    y_lo, y_hi = a.ground_y - a.below, a.ground_y + a.above
    box = (cx - a.radius, cx + a.radius, cz - a.radius, cz + a.radius, y_lo, y_hi)
    bd = RD.dump(a.base, *box)
    ld = bd if a.self_check else RD.dump(a.live, *box)
    for nm, d in (('base', bd), ('live', ld)):
        if d['missing_chunks'] or not d['chunks']:
            raise SystemExit('REFUSED: the %s save has %d missing chunk(s) under the box (%d read): a missing chunk is not empty ground'
                             % (nm, d['missing_chunks'], d['chunks']))
    summary, rows = ledger(columns_of(bd), columns_of(ld), cx, cz, a.radius, y_lo, y_hi,
                           owned_cells(a.pool) if a.pool else None, a.mine_depth)
    print(render(summary, bd, ld))
    if a.self_check:
        bad = [r for r in rows]
        print('SELF-CHECK: %s' % ('ok, every column natural' if not bad else 'FAILED, %d columns not natural' % len(bad)))
        return 0 if not bad else 1
    if a.json:
        json.dump({'summary': summary, 'base': {k: bd[k] for k in ('saved', 'saved_newest', 'chunks', 'missing_chunks')},
                   'live': {k: ld[k] for k in ('saved', 'saved_newest', 'chunks', 'missing_chunks')},
                   'row_fields': ['x', 'z', 'cls', 'hb', 'hl', 'placed', 'dug', 'gap'], 'rows': rows}, open(a.json, 'w'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
