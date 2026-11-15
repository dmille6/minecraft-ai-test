#!/usr/bin/env python3
"""groundplan.py -- the exact cells to change so damaged ground is put back, cut into jobs a bot can finish in one visit
(READ ONLY; the offline half of step N3 in docs/reports/land-eval-2026-11-14/RECOMMENDATION.md).

    python3 groundplan.py --base <untouched>/region --live <now>/region --center 0 0 --radius 48 --ground-y 70 \
        [--pool <dir of project-*.json records>] [--json plan.json] [--self-check]

Every column is classed by groundledger.py (imported, not copied). Then the owner's rules (2026-11-15,
docs/decisions/consolidation-2026-11-14.md) turn the classes into cells:

  FILL  (undermined, pit)   every dug cell is filled with cobblestone, with ONE layer of dirt directly under the surface
                            block (grass spreads only onto dirt). The surface block still there (undermined): the dug cell
                            right under it gets dirt. The surface block gone (an open pit): dirt AT the frame-zero surface
                            height, cobblestone under it. A dug cell that now holds water or lava is left out (`wet`).
  CUT   (pillar, raised, over_gap)   placed blocks standing above the frame-zero surface, top first.
  PICK UP                   the ledger's loose things (a table, chest, torch, sign no record owns); a container is flagged
                            has_inventory: it is emptied first, not just broken.
  never                     a column of class `build` (a project record owns a changed cell in it), a `filled` column
                            (a placed block at or under the frame-zero surface), dug cells deeper than --mine-depth under
                            the frame-zero surface (mining is wanted), replaced blocks (stone -> cobblestone).

Jobs: the cells of one --tile x --tile block of columns (default 6x6), at most --job-max cells (24) a job; a bigger tile
is split by depth, lowest first for fills and highest first for cuts. Within a fill job the order is bottom-up, so a
cell is never listed before the cell under it when that cell is in the plan too. Order of jobs: pillar cuts, other cuts,
pick-ups, then fills, each nearest the centre first (a pick-up can stand in a fill cell, so it goes before the fills).

Nothing is written but the --json file. A box with a missing chunk in either save is refused. With base == live the plan
is empty: that is the control, and --self-check runs it."""
import argparse
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import groundledger as G  # noqa: E402

FILL_CLASSES = frozenset(('undermined', 'pit'))
CUT_CLASSES = frozenset(('pillar', 'raised', 'over_gap'))
# a thing with an inventory: broken as it is, its contents fall on the ground
CONTAINER_RE = re.compile(r'(^|_)(chest|barrel|furnace|smoker|hopper|shulker_box|brewing_stand|dispenser|dropper|crafter)$')
KIND_RANK = {'cut_pillar': 0, 'cut': 1, 'pickup': 2, 'fill': 3}
PACE_FILLS, PACE_HOURS = 1000, 30          # about 1,000 tidy fills placed in the 30-hour log window (RECOMMENDATION.md)


def fill_blocks(dug, hb, surface_stays):
    """The block for each dug cell to fill, bottom-up -> [(y, block)]. The dirt cap: one layer of dirt directly under
    the surface block when it still stands, else at the frame-zero surface height; cobblestone everywhere else. Pure."""
    cap = hb - 1 if surface_stays else hb
    return [(y, 'dirt' if y == cap else 'cobblestone') for y in sorted(dug)]


def has_inventory(name):
    return bool(name and CONTAINER_RE.search(name))


def plan_column(base, live, y_lo, y_hi, owned=frozenset(), mine_depth=8):
    """One column ({y: name} each) -> {cls, hb, fills [(y, block)], cuts [(y, name)] top first, wet [y], things
    [(y, name, in_fill)], left Counter (cells no rule repairs, by why)}. Pure. Ownership comes from the ledger's
    classification: a column with any owned changed cell is `build` and gets nothing."""
    c = G.classify_column(base, live, y_lo, y_hi, owned, mine_depth)
    cls, hb = c['cls'], c['hb']
    out = {'cls': cls, 'hb': hb, 'fills': [], 'cuts': [], 'wet': [], 'things': [], 'left': collections.Counter()}
    left = out['left']
    left['mined_below'] += c['mined']
    if c['replaced']:
        left['replaced'] += len(c['replaced'])
    if cls == 'build':
        left['in_build_columns'] += len(c['placed']) + len(c['dug'])
        left['things_in_build_columns'] += len(c['things'])
        return out
    above = [y for y in c['placed'] if hb is None or y > hb]
    if cls in FILL_CLASSES:
        wet = [y for y in c['dug'] if G.group(live.get(y)) == G.FLUID]
        dry = [y for y in c['dug'] if y not in wet]
        out['wet'] = wet
        out['fills'] = fill_blocks(dry, hb, G.group(live.get(hb)) == G.SOLID)
        if above:
            left['placed_above_surface_in_' + cls] += len(above)
        if len(c['placed']) > len(above):
            left['placed_under_surface_in_' + cls] += len(c['placed']) - len(above)
    else:
        if c['dug']:
            left['dug_in_' + cls] += len(c['dug'])
        if cls in CUT_CLASSES:
            out['cuts'] = [(y, live.get(y)) for y in sorted(above, reverse=True)]
            if len(c['placed']) > len(above):
                left['placed_under_surface_in_' + cls] += len(c['placed']) - len(above)
        elif c['placed']:
            left['placed_in_' + cls] += len(c['placed'])
    things = [(y, live.get(y), False) for y in c['things']]
    # a thing standing in a cell to be filled (a torch in a pit): the ledger calls the cell dug, it is picked up first
    things += [(y, live.get(y), True) for y, _ in out['fills'] if G.group(live.get(y)) == G.THING]
    out['things'] = sorted(things, reverse=True)
    return out


def tile_of(x, z, tile):
    return (x // tile) * tile, (z // tile) * tile


def tile_distance(x0, z0, tile, cx, cz):
    """Blocks from the centre to the middle of a tile, measured like the ledger's rings (the larger of the two axes). Pure."""
    h = (tile - 1) / 2.0
    return round(max(abs(x0 + h - cx), abs(z0 + h - cz)), 1)


def make_jobs(fills, cuts, pickups, cx, cz, tile=6, job_max=24):
    """fills [(x, y, z, block)], cuts [(x, y, z, name, column class)], pickups [(x, y, z, name)] -> ordered jobs. Pure."""
    groups = collections.defaultdict(list)
    for x, y, z, b in fills:
        groups[('fill',) + tile_of(x, z, tile)].append([x, y, z, b])
    for x, y, z, b, cls in cuts:
        groups[('cut_pillar' if cls == 'pillar' else 'cut',) + tile_of(x, z, tile)].append([x, y, z, b])
    for x, y, z, b in pickups:
        groups[('pickup',) + tile_of(x, z, tile)].append([x, y, z, b])
    jobs = []
    for (kind, x0, z0), cells in groups.items():
        if kind == 'fill':
            cells.sort(key=lambda c: (c[1], c[0], c[2]))            # bottom-up: every cell after the one under it
        else:
            cells.sort(key=lambda c: (-c[1], c[0], c[2]))           # top-down
        parts = [cells[i:i + job_max] for i in range(0, len(cells), job_max)]
        for n, part in enumerate(parts):
            jobs.append({'id': '%s:%d:%d:%d' % (kind.replace('_', '-'), x0, z0, n + 1),
                         'kind': 'cut' if kind.startswith('cut') else kind,
                         'of': 'pillar' if kind == 'cut_pillar' else None,
                         'tile': [x0, z0, x0 + tile - 1, z0 + tile - 1], 'part': n + 1, 'parts': len(parts),
                         'cells': part, 'counts': dict(collections.Counter(c[3] for c in part)),
                         'distance': tile_distance(x0, z0, tile, cx, cz), '_rank': KIND_RANK[kind]})
    jobs.sort(key=lambda j: (j['_rank'], j['distance'], j['tile'][0], j['tile'][1], j['part']))
    for j in jobs:
        del j['_rank']
    return jobs


def order_ok(jobs):
    """True when no fill cell is listed before the cell under it that is also in the plan, and every cut job is top-down.
    Pure; the planner's own check of its output."""
    fill_cells = {(c[0], c[1], c[2]) for j in jobs if j['kind'] == 'fill' for c in j['cells']}
    seen = set()
    for j in jobs:
        if j['kind'] == 'cut' and [c[1] for c in j['cells']] != sorted((c[1] for c in j['cells']), reverse=True):
            return False
        if j['kind'] != 'fill':
            continue
        for x, y, z, _ in j['cells']:
            if (x, y - 1, z) in fill_cells and (x, y - 1, z) not in seen:
                return False
            seen.add((x, y, z))
    return True


def plan(base_cols, live_cols, cx, cz, radius, y_lo, y_hi, own=None, mine_depth=8, tile=6, job_max=24):
    """Every column within `radius` (a square) of the centre -> {summary, jobs, pickups}."""
    own = own or {}
    classes = collections.Counter()
    fills, cuts, pickups, wet = [], [], [], collections.Counter()
    left = collections.Counter()
    cut_by_class = collections.Counter()
    fill_cols = cap_not_soil = bottom_open = bottom_wet = 0
    for x in range(cx - radius, cx + radius + 1):
        for z in range(cz - radius, cz + radius + 1):
            b, l = base_cols.get((x, z), {}), live_cols.get((x, z), {})
            p = plan_column(b, l, y_lo, y_hi, frozenset(own.get((x, z), ())), mine_depth)
            classes[p['cls']] += 1
            left.update(p['left'])
            for y in p['wet']:
                wet[l.get(y)] += 1
            if p['fills']:
                fill_cols += 1
                ys = {y for y, _ in p['fills']}
                lo = min(ys)
                if G.group(l.get(lo - 1)) == G.FLUID:
                    bottom_wet += 1
                elif G.group(l.get(lo - 1)) != G.SOLID:
                    bottom_open += 1
                for y, blk in p['fills']:
                    fills.append((x, y, z, blk))
                    if blk == 'dirt' and b.get(y) not in G.SOIL:
                        cap_not_soil += 1
            for y, name in p['cuts']:
                cuts.append((x, y, z, name, p['cls']))
                cut_by_class[p['cls']] += 1
            for y, name, in_fill in p['things']:
                pickups.append({'at': [x, y, z], 'block': name, 'has_inventory': has_inventory(name), 'in_fill_cell': in_fill})
    jobs = make_jobs(fills, cuts, [(t['at'][0], t['at'][1], t['at'][2], t['block']) for t in pickups], cx, cz, tile, job_max)
    if not order_ok(jobs):
        raise AssertionError('the plan lists a fill before the cell under it, or a cut bottom-up')
    jobs_by = collections.Counter(j['kind'] for j in jobs)
    summary = {'center': [cx, cz], 'radius': radius, 'y': [y_lo, y_hi], 'mine_depth': mine_depth, 'tile': tile, 'job_max': job_max,
               'columns': dict(classes, total=(2 * radius + 1) ** 2),
               'fill': dict(collections.Counter(f[3] for f in fills)), 'fill_cells': len(fills), 'fill_columns': fill_cols,
               'cut': dict(collections.Counter(c[3] for c in cuts).most_common()), 'cut_cells': len(cuts),
               'cut_by_class': dict(cut_by_class),
               'pickup': dict(collections.Counter(t['block'] for t in pickups).most_common()), 'pickup_count': len(pickups),
               'pickup_with_inventory': sum(t['has_inventory'] for t in pickups),
               'pickup_in_fill_cells': sum(t['in_fill_cell'] for t in pickups),
               'jobs': dict(jobs_by, cut_pillar=sum(1 for j in jobs if j['of'] == 'pillar'), total=len(jobs)),
               'wet': dict(wet), 'wet_cells': sum(wet.values()),
               'left': dict(left),
               'dirt_cap_where_frame_zero_was_not_soil': cap_not_soil,
               'fill_columns_whose_lowest_fill_has_air_under_it': bottom_open,
               'fill_columns_whose_lowest_fill_has_water_or_lava_under_it': bottom_wet,
               'pace_hours': round(len(fills) * PACE_HOURS / PACE_FILLS, 1)}
    return {'summary': summary, 'jobs': jobs, 'pickups': pickups}


def is_empty(p):
    return not p['jobs'] and not p['pickups'] and not p['summary']['wet_cells']


def render(s, base_meta, live_meta):
    cols = s['columns']
    out = ['GROUND PLAN  centre %s  radius %d  y %s  mine depth %d  tile %dx%d, at most %d cells a job' % (
               s['center'], s['radius'], s['y'], s['mine_depth'], s['tile'], s['tile'], s['job_max']),
           'CONTROL base saved %s..%s chunks read %s missing %s | live saved %s..%s chunks read %s missing %s' % (
               base_meta.get('saved'), base_meta.get('saved_newest'), base_meta.get('chunks'), base_meta.get('missing_chunks'),
               live_meta.get('saved'), live_meta.get('saved_newest'), live_meta.get('chunks'), live_meta.get('missing_chunks')),
           '',
           'columns by class, of %d within %d (a square): %s' % (cols['total'], s['radius'], '  '.join(
               '%s %d' % (k, cols.get(k, 0)) for k in G.CLASSES)),
           'fill: %d cells in %d columns: cobblestone %d, dirt %d' % (s['fill_cells'], s['fill_columns'], s['fill'].get('cobblestone', 0), s['fill'].get('dirt', 0)),
           'cut: %d cells, by block %s; by column class %s' % (s['cut_cells'], s['cut'], s['cut_by_class']),
           'pick up: %d things %s; with an inventory (empty it first) %d; standing in a fill cell %d' % (
               s['pickup_count'], s['pickup'], s['pickup_with_inventory'], s['pickup_in_fill_cells']),
           'jobs: %d in all: cut %d (of pillars %d), pickup %d, fill %d' % (
               s['jobs']['total'], s['jobs'].get('cut', 0), s['jobs']['cut_pillar'], s['jobs'].get('pickup', 0), s['jobs'].get('fill', 0)),
           'left out, wet (dug cells now holding water or lava): %d %s' % (s['wet_cells'], s['wet']),
           'left out, by why (cells): %s' % dict(sorted(s['left'].items())),
           'dirt-cap cells where the frame-zero block was not soil: %d of %d dirt cells' % (s['dirt_cap_where_frame_zero_was_not_soil'], s['fill'].get('dirt', 0)),
           'fill columns whose lowest fill has air under it: %d, water or lava under it: %d (of %d fill columns)' % (
               s['fill_columns_whose_lowest_fill_has_air_under_it'], s['fill_columns_whose_lowest_fill_has_water_or_lava_under_it'], s['fill_columns']),
           'pace (arithmetic, not a measurement): at about %d placed fills per %d hours, %d fill cells is about %.0f hours (%.1f days)' % (
               PACE_FILLS, PACE_HOURS, s['fill_cells'], s['pace_hours'], s['pace_hours'] / 24)]
    return '\n'.join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--base', required=True, help='region directory of the untouched world')
    ap.add_argument('--live', help='region directory of the world now')
    ap.add_argument('--center', nargs=2, type=int, required=True, metavar=('X', 'Z'))
    ap.add_argument('--radius', type=int, default=48)
    ap.add_argument('--ground-y', type=int, required=True, help='about where the ground is (the town home y)')
    ap.add_argument('--below', type=int, default=24)
    ap.add_argument('--above', type=int, default=40)
    ap.add_argument('--mine-depth', type=int, default=8)
    ap.add_argument('--pool', help='directory of project-*.g*.json records')
    ap.add_argument('--tile', type=int, default=6)
    ap.add_argument('--job-max', type=int, default=24)
    ap.add_argument('--json')
    ap.add_argument('--self-check', action='store_true', help='plan the base against itself: the plan must be empty')
    a = ap.parse_args(argv)
    if not a.self_check and not a.live:
        raise SystemExit('--live is required unless --self-check')
    import regiondump as RD
    cx, cz = a.center
    y_lo, y_hi = a.ground_y - a.below, a.ground_y + a.above
    box = (cx - a.radius, cx + a.radius, cz - a.radius, cz + a.radius, y_lo, y_hi)
    bd = RD.dump(a.base, *box)
    ld = bd if a.self_check else RD.dump(a.live, *box)
    for nm, d in (('base', bd), ('live', ld)):
        if d['missing_chunks'] or not d['chunks']:
            raise SystemExit('REFUSED: the %s save has %d missing chunk(s) under the box (%d read): a missing chunk is not empty ground'
                             % (nm, d['missing_chunks'], d['chunks']))
        if d.get('unfinished_chunks'):
            raise SystemExit('REFUSED: the %s save has %d chunk(s) under the box that never finished generating: their missing ground is not a pit'
                             % (nm, d['unfinished_chunks']))
    p = plan(G.columns_of(bd), G.columns_of(ld), cx, cz, a.radius, y_lo, y_hi,
             G.owned_cells(a.pool) if a.pool else None, a.mine_depth, a.tile, a.job_max)
    print(render(p['summary'], bd, ld))
    if a.json:
        meta = lambda d: {k: d[k] for k in ('saved', 'saved_newest', 'chunks', 'missing_chunks')}
        p['summary']['base'], p['summary']['live'] = meta(bd), meta(ld)
        p['summary']['cell_fields'] = ['x', 'y', 'z', 'block to place (fill) or to remove (cut, pickup)']
        with open(a.json, 'w') as fh:
            json.dump(p, fh)
    if a.self_check:
        print('SELF-CHECK: %s' % ('ok, the plan is empty' if is_empty(p) else 'FAILED, the plan is not empty'))
        return 0 if is_empty(p) else 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
