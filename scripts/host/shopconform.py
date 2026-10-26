#!/usr/bin/env python3
"""shopconform.py -- the workshop RECORD CONFORMANCE survey (shop-01: the source shopread.py's exposure needs). READ-ONLY.

    shopconform.py survey <world_dir> --records <dir> --pool <pool> [--blueprint workshop@1.json] [--out survey.json]
    shopconform.py selftest

THE QUESTION (design docs/reports/building-tier-2026-10-23.md 6.1 row 3; Codex read r3): does the WORLD hold the town's workshop as
its record says -- every record cell, by the block its role asks for? It answers from COPIES of the world's region files (cp of the
files covering the record's cell extent into a temp dir; the live files are never opened in place), decoded by the town plan's own
reader (townplan_blockdump.py, beside this file), and judged by the BUILDER'S OWN RULE (bots/src/buildrun.mjs cellDone +
blockFamily): a role's palette names by family (a torch on a side face is a wall_torch; cut copper weathers and may be waxed),
'$planks' any planks species, '$role' that role's names, and a `fill` cell any solid block.

THE SCORE over the record's cells: TP = the cell reads its role's block; FN = a record cell that does not (air, or a wrong block);
FP = a record cell holding a block that is neither air nor its role's (a wrong name: a swap counts as FN AND FP).
F1 = 2TP / (2TP + FP + FN). Missing 7 of 167 cells -> F1 = 0.979; 4 swapped -> 0.976; the shopread gate is F1 >= 0.98.
UNKNOWN: a record cell in a chunk absent from the files, a non-full chunk or a section the files do not hold -> unknown > 0, and the
survey is INVALID (shopread never counts it: unknown is never "fine").

THE RECORD: every `project-<home>.shop.g<N>.json` in --records, walked as bots/src/buildproj.mjs recordHead walks it (the lowest
gen with prev null, then each gen whose prev is the head and prevSha the head's bytes' sha256). Its sha256 and gen are in the survey,
so a survey of an older generation is never matched to a newer record.

OUTPUT { v: 1, pool, key, record_gen, record_sha, at (now, UTC), region_mtime (the newest copied file's mtime: the world state the
survey saw -- the server writes chunks at its autosave), cells, tp, fp, fn, unknown, f1, valid, bad: [first 12 "x,y,z:role:found"] }.
Stdlib only.
"""
import argparse, datetime as dt, hashlib, importlib.util, json, os, re, shutil, sys, tempfile

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('townplan_blockdump', os.path.join(_here, 'townplan_blockdump.py'))
TB = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(TB)

F1_MIN = 0.98
REC_RE = re.compile(r'^(project-(-?\d+)_(-?\d+)_(-?\d+)\.shop)\.g(\d+)\.json$')
NOT_SOLID = re.compile(r'^(\?|air|cave_air|void_air|water|lava|bubble_column|short_grass|tall_grass|fern|large_fern|dead_bush|vine|'
                       r'snow\[.*|.*_sapling|.*_carpet|.*_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|'
                       r'cornflower|lily_of_the_valley|torch|wall_torch|.*_button|.*_pressure_plate|ladder|rail|.*_rail|.*_sign|.*_banner)$')


def record_head(files):
    """[(gen, bytes)] -> (gen, sha, rec) | None -- buildproj.mjs recordHead, exactly."""
    head = None
    for gen, buf in sorted(files):
        try:
            rec = json.loads(buf.decode('utf-8'))
        except Exception:
            continue
        if not isinstance(rec, dict) or rec.get('gen') != gen:
            continue
        sha = hashlib.sha256(buf).hexdigest()
        if head is None:
            if rec.get('prev') is None:
                head = (gen, sha, rec)
            continue
        if rec.get('prev') == head[0] and rec.get('prevSha') == head[1]:
            head = (gen, sha, rec)
    return head


def family(n):
    """buildrun.mjs blockFamily: a wall torch is a torch; cut copper weathering and waxing are cut copper."""
    s = re.sub(r'\[.*\]$', '', str(n or ''))
    if s == 'wall_torch':
        return 'torch'
    if s == 'soul_wall_torch':
        return 'soul_torch'
    if 'copper' in s:
        return re.sub(r'^(exposed|weathered|oxidized)_', '', re.sub(r'^waxed_', '', s))
    return s


def role_ok(palette, role):
    """The role's acceptable names (families) -> (set, any_planks). '$planks' any planks; '$role' that role's names, once each."""
    ok, planks, seen = set(), [False], set([role])

    def add(lst):
        for c in lst or []:
            if c == '$planks':
                planks[0] = True
            elif c.startswith('$'):
                r = c[1:]
                if r not in seen:
                    seen.add(r); add(palette.get(r))
            else:
                ok.add(family(c))
    add(palette.get(role))
    return ok, planks[0]


def cell_done(name, palette, role):
    """buildrun.mjs cellDone over a decoded name."""
    n = re.sub(r'\[.*\]$', '', str(name or ''))
    if not n or n in ('air', 'cave_air', 'void_air', '?'):
        return False
    if role == 'fill':
        return not NOT_SOLID.match(n)
    ok, planks = role_ok(palette, role)
    return family(n) in ok or (planks and n.endswith('_planks'))


def judge(rec, palette, read):
    """The record against a reader read(x, y, z) -> name | '?' -> the score (pure)."""
    tp = fp = fn = unknown = 0
    bad = []
    for c in rec.get('cells') or []:
        x, y, z = c['at']
        n = read(x, y, z)
        if n is None or n == '?':
            unknown += 1; bad.append('%d,%d,%d:%s:unknown' % (x, y, z, c.get('role'))); continue
        if cell_done(n, palette, c.get('role')):
            tp += 1
            continue
        fn += 1
        base = re.sub(r'\[.*\]$', '', n)
        if base not in ('air', 'cave_air', 'void_air'):
            fp += 1
        bad.append('%d,%d,%d:%s:%s' % (x, y, z, c.get('role'), n))
    cells = len(rec.get('cells') or [])
    f1 = (2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) else 0.0
    return {'cells': cells, 'tp': tp, 'fp': fp, 'fn': fn, 'unknown': unknown, 'f1': round(f1, 4), 'valid': unknown == 0 and cells > 0, 'bad': bad[:12]}


def extent(rec):
    cs = [c['at'] for c in rec.get('cells') or []]
    return min(c[0] for c in cs), min(c[1] for c in cs), min(c[2] for c in cs), max(c[0] for c in cs), max(c[1] for c in cs), max(c[2] for c in cs)


def reader_from_regions(rdir, ext):
    """A reader over the region files in rdir for the extent (townplan_blockdump's decoding) -> read(x, y, z) -> name | '?'."""
    x0, y0, z0, x1, y1, z1 = ext
    grid = {}
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            ch = TB.chunk(rdir, cx, cz)
            if ch is None or ch.get('Status', 'minecraft:full') not in ('minecraft:full', 'full'):
                continue
            secs = {s.get('Y'): s.get('block_states') or {} for s in ch.get('sections', [])}
            for sy in range(y0 >> 4, (y1 >> 4) + 1):
                bs = secs.get(sy)
                if bs is None:
                    continue
                pal = [TB.name_of(p) for p in (bs.get('palette') or [])]
                vals = TB.section_values(bs)
                for ly in range(16):
                    y = sy * 16 + ly
                    if y < y0 or y > y1:
                        continue
                    for lz in range(16):
                        z = cz * 16 + lz
                        if z < z0 or z > z1:
                            continue
                        for lx in range(16):
                            x = cx * 16 + lx
                            if x < x0 or x > x1:
                                continue
                            grid[(x, y, z)] = pal[vals[(ly * 16 + lz) * 16 + lx]] if vals is not None else (pal[0] if pal else 'air')
    return lambda x, y, z: grid.get((x, y, z), '?')


def survey(world_dir, records_dir, pool, blueprint):
    files = []
    for f in os.listdir(records_dir):
        m = REC_RE.match(f)
        if m:
            files.append((int(m.group(5)), open(os.path.join(records_dir, f), 'rb').read(), m.group(1)))
    keys = sorted({k for _, _, k in files})
    if len(keys) != 1:
        return {'v': 1, 'pool': pool, 'valid': False, 'why': 'records: %d keys %s' % (len(keys), keys[:3])}
    head = record_head([(g, b) for g, b, _ in files])
    if head is None:
        return {'v': 1, 'pool': pool, 'key': keys[0], 'valid': False, 'why': 'no record head'}
    gen, sha, rec = head
    palette = json.load(open(blueprint)).get('palette') or {}
    ext = extent(rec)
    src = os.path.join(world_dir, 'region')
    tmp = tempfile.mkdtemp(prefix='shopconform-')
    try:
        mt = []
        for rx in range(ext[0] >> 9, (ext[3] >> 9) + 1):
            for rz in range(ext[2] >> 9, (ext[5] >> 9) + 1):
                p = os.path.join(src, 'r.%d.%d.mca' % (rx, rz))
                if os.path.exists(p):
                    mt.append(os.stat(p).st_mtime)
                    shutil.copyfile(p, os.path.join(tmp, os.path.basename(p)))
        score = judge(rec, palette, reader_from_regions(tmp, ext))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    iso = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'v': 1, 'pool': pool, 'key': keys[0], 'record_gen': gen, 'record_sha': sha, 'complete_in_record': bool(rec.get('structure_complete')),
            'at': iso(dt.datetime.now(dt.timezone.utc).timestamp()), 'region_mtime': iso(max(mt)) if mt else None, 'f1_min': F1_MIN, **score,
            'valid': score['valid'] and bool(mt)}


def selftest():
    pal = {'base': ['stone_bricks'], 'wall': ['$planks'], 'window': ['glass_pane', '$wall'], 'trim': ['cut_copper', '$planks'],
           'light': ['torch'], 'furnace': ['furnace'], 'table': ['crafting_table']}
    roles = ['base'] * 89 + ['wall'] * 49 + ['window'] * 4 + ['trim'] * 20 + ['light'] * 2 + ['furnace'] * 2 + ['table'] * 1
    rec = {'cells': [{'at': [i, 70, 0], 'role': r} for i, r in enumerate(roles)]}
    good = {'base': 'stone_bricks', 'wall': 'spruce_planks', 'window': 'glass_pane', 'trim': 'exposed_cut_copper', 'light': 'wall_torch', 'furnace': 'furnace', 'table': 'crafting_table'}
    world = {(i, 70, 0): good[r] for i, r in enumerate(roles)}
    rd = lambda w: (lambda x, y, z: w.get((x, y, z), '?'))
    s = judge(rec, pal, rd(world))
    assert s['cells'] == 167 and s['tp'] == 167 and s['f1'] == 1.0 and s['valid'], s
    # 7 removed (both furnaces, the table, all four windows): F1 0.979 < 0.98 (Codex read r3's case)
    w7 = dict(world)
    for i, r in enumerate(roles):
        if r in ('furnace', 'table', 'window'):
            w7[(i, 70, 0)] = 'air'
    s7 = judge(rec, pal, rd(w7))
    assert s7['fn'] == 7 and s7['fp'] == 0 and s7['f1'] < F1_MIN, s7
    # 4 swapped (stone bricks -> cobblestone): FN and FP each, F1 0.976
    w4 = dict(world)
    for i in range(4):
        w4[(i, 70, 0)] = 'cobblestone'
    s4 = judge(rec, pal, rd(w4))
    assert s4['fn'] == 4 and s4['fp'] == 4 and s4['f1'] < F1_MIN, s4
    # 3 wrong cells still pass the design's threshold (named, not hidden): F1 0.982
    w3 = dict(world)
    for i in range(3):
        w3[(i, 70, 0)] = 'air'
    assert judge(rec, pal, rd(w3))['f1'] >= F1_MIN
    # unknown makes the survey invalid
    wu = dict(world); del wu[(5, 70, 0)]
    su = judge(rec, pal, rd(wu))
    assert su['unknown'] == 1 and not su['valid'], su
    # families and roles: planks any species for $planks; the window's $wall fallback; copper weathering; a fill cell any solid
    assert cell_done('birch_planks', pal, 'window') and cell_done('waxed_oxidized_cut_copper', pal, 'trim') and cell_done('oak_planks', pal, 'trim')
    assert not cell_done('copper_block', pal, 'trim') and not cell_done('air', pal, 'base') and not cell_done('cobblestone', pal, 'base')
    assert cell_done('dirt', pal, 'fill') and not cell_done('water', pal, 'fill') and not cell_done('short_grass', pal, 'fill')
    assert cell_done('glass_pane[waterlogged]', pal, 'window')
    # the record head walk (buildproj.mjs recordHead): a broken link is not the head
    import hashlib as h
    b1 = json.dumps({'gen': 1, 'prev': None}).encode()
    b2 = json.dumps({'gen': 2, 'prev': 1, 'prevSha': h.sha256(b1).hexdigest()}).encode()
    b3 = json.dumps({'gen': 3, 'prev': 2, 'prevSha': 'f' * 64}).encode()
    assert record_head([(1, b1), (2, b2), (3, b3)])[0] == 2
    print('shopconform selftest: ok')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('survey')
    s.add_argument('world_dir'); s.add_argument('--records', required=True); s.add_argument('--pool', required=True)
    s.add_argument('--blueprint', default=os.path.join(_here, 'workshop@1.json')); s.add_argument('--out')
    sub.add_parser('selftest')
    a = ap.parse_args()
    if a.cmd == 'selftest':
        selftest(); return 0
    out = survey(a.world_dir, a.records, a.pool, a.blueprint)
    txt = json.dumps(out)
    if a.out:
        open(a.out, 'w').write(txt)
    else:
        print(txt)
    return 0 if out.get('valid') else 1


if __name__ == '__main__':
    sys.exit(main())
