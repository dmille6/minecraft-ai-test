#!/usr/bin/env python3
"""Behaviour tests for infra/showcase/wholemap.py (whole-map expeditions S0). No network, no hosts, no real world.

    python3 infra/showcase/test_wholemap.py      # exit 1 on any failure; last line "mutants killed k/n"

Synthetic region files are built here with a minimal NBT writer, so the reader is tested on bytes it did not make.
Each test takes the module under test (W), so the mutants at the bottom re-run the SAME tests on a mutated copy and
must see them fail. Every mutant asserts its anchor is present and unique.
"""
import gzip
import importlib.util
import io
import json
import os
import struct
import sys
import tempfile
import time
import zlib
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'wholemap.py')


def load(src_text=None, name='wholemap_ut'):
    if src_text is None:
        src_text = open(SRC).read()
    d = tempfile.mkdtemp()
    p = os.path.join(d, name + '.py')
    open(p, 'w').write(src_text)
    spec = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ------------------------------------------------------------------------------------------------ a minimal NBT writer
class L(list):
    """A TAG_Long_Array."""


class Long(int):
    """A TAG_Long."""


def _name(k):
    b = k.encode()
    return struct.pack('>H', len(b)) + b


def _tag(v):
    if isinstance(v, bool):
        return 1, struct.pack('>b', int(v))
    if isinstance(v, Long):
        return 4, struct.pack('>q', v)
    if isinstance(v, int):
        return 3, struct.pack('>i', v)
    if isinstance(v, float):
        return 6, struct.pack('>d', v)
    if isinstance(v, str):
        b = v.encode()
        return 8, struct.pack('>H', len(b)) + b
    if isinstance(v, L):
        return 12, struct.pack('>i', len(v)) + b''.join(struct.pack('>q', x) for x in v)
    if isinstance(v, list):
        if not v:
            return 9, bytes([0]) + struct.pack('>i', 0)
        ts = [_tag(x) for x in v]
        return 9, bytes([ts[0][0]]) + struct.pack('>i', len(v)) + b''.join(p for _, p in ts)
    if isinstance(v, dict):
        out = b''
        for k, x in v.items():
            t, p = _tag(x)
            out += bytes([t]) + _name(k) + p
        return 10, out + b'\x00'
    raise TypeError(type(v))


def nbt(root):
    t, p = _tag(root)
    return bytes([t]) + _name('') + p


def pack(values, bits):
    """1.16+ packing: entries never span longs. -> signed longs."""
    per = 64 // bits
    out = []
    for k in range(0, len(values), per):
        v = 0
        for j, x in enumerate(values[k:k + per]):
            v |= x << (j * bits)
        out.append(v - (1 << 64) if v >= 1 << 63 else v)
    return L(out)


def make_chunk(cx, cz, cols, inhabited=0, status='minecraft:full', top_y=64):
    """cols: dict (x, z) -> 'land' | 'ice' | 'shallow' | 'deep' | 'lava'; missing = land. The surface top block is at
    top_y; water depth 2 (shallow) or 5 (deep)."""
    names = ['minecraft:air', 'minecraft:stone', 'minecraft:grass_block', 'minecraft:ice', 'minecraft:water',
             'minecraft:lava']
    ws, of = [], []
    sec_y = top_y >> 4
    states = [0] * 4096
    for z in range(16):
        for x in range(16):
            k = cols.get((x, z), 'land')
            top = {'land': 2, 'ice': 3, 'shallow': 4, 'deep': 4, 'lava': 5}[k]
            states[((top_y & 15) * 16 + z) * 16 + x] = top
            ws.append(top_y + 1 - (-64))
            floor = top_y - (2 if k == 'shallow' else 5 if k == 'deep' else 0)
            of.append(floor + 1 - (-64))
    pal = [{'Name': n} for n in names]
    bits = max(4, (len(pal) - 1).bit_length())
    return {'DataVersion': 4000, 'xPos': cx, 'zPos': cz, 'Status': status, 'InhabitedTime': Long(inhabited),
            'Heightmaps': {'WORLD_SURFACE': pack(ws, 9), 'OCEAN_FLOOR': pack(of, 9)},
            'sections': [{'Y': sec_y, 'block_states': {'palette': pal, 'data': pack(states, bits)}},
                         {'Y': sec_y + 1, 'block_states': {'palette': [{'Name': 'minecraft:air'}]}}]}


def write_region(path, chunks, comp=2, torn=()):
    """chunks: {(cx, cz): nbt dict} all in one region (cx, cz local index from & 31)."""
    header = bytearray(8192)
    body = bytearray()
    sector = 2
    for (cx, cz), c in chunks.items():
        raw = nbt(c)
        data = zlib.compress(raw) if comp == 2 else gzip.compress(raw) if comp == 1 else raw
        blob = struct.pack('>I', len(data) + 1) + bytes([comp]) + data
        if (cx, cz) in torn:
            blob = struct.pack('>I', len(data) + 1) + bytes([comp]) + data[:len(data) // 2] + b'\x00' * (len(data) - len(data) // 2)
        n = -(-len(blob) // 4096)
        blob += b'\x00' * (n * 4096 - len(blob))
        i = (cx & 31) + (cz & 31) * 32
        header[i * 4:i * 4 + 4] = (sector << 8 | n).to_bytes(4, 'big')
        body += blob
        sector += n
    open(path, 'wb').write(bytes(header) + bytes(body))


# ------------------------------------------------------------------------------------------------------------- the tests
def t_nbt_roundtrip(W):
    b = nbt({'a': 5, 'b': Long(-7), 's': 'hi', 'l': [{'x': 1}, {'x': 2}], 'arr': L([1, -1]), 'e': []})
    d = W.parse_nbt(b)
    assert d['a'] == 5 and d['b'] == -7 and d['s'] == 'hi' and [x['x'] for x in d['l']] == [1, 2] and d['e'] == []
    assert d['arr'].values() == [1, -1], d['arr'].values()
    for bad in (b'', b'\x08\x00\x00', b'\x0a\x00\x00\x63'):
        try:
            W.parse_nbt(bad)
        except (ValueError, IndexError, struct.error):
            continue
        raise AssertionError(f'{bad!r} parsed')


def t_heightmap_and_block_at(W):
    c = make_chunk(0, 0, {(3, 4): 'ice', (5, 5): 'deep', (6, 6): 'shallow'}, top_y=70)
    d = W.parse_nbt(nbt(c))
    hm = W.heightmap(d['Heightmaps']['WORLD_SURFACE'])
    assert len(hm) == 256 and set(hm) == {70 + 1 + 64}, set(hm)
    secs = {s['Y']: s for s in d['sections']}
    assert W.block_at(secs, 70, 3, 4) == 'minecraft:ice'
    assert W.block_at(secs, 70, 0, 0) == 'minecraft:grass_block'
    assert W.block_at(secs, 81, 0, 0) == 'minecraft:air'           # single-palette section
    assert W.block_at(secs, 200, 0, 0) is None                     # absent section is UNKNOWN, not air
    assert W.heightmap(W.Raw(b'\x00' * 8 * 10, 8)) is None         # wrong length is unknown


def t_classify(W):
    assert W.classify_column('minecraft:water', 62, 61) == W.SHALLOW
    assert W.classify_column('minecraft:water', 62, 60) == W.SHALLOW
    assert W.classify_column('minecraft:water', 62, 59) == W.DEEP          # 3 deep is open water
    assert W.classify_column('minecraft:kelp_plant', 62, 50) == W.DEEP
    assert W.classify_column('minecraft:packed_ice', 62, 50) == W.ICE
    assert W.classify_column('minecraft:lava', 12, 11) == W.LAVA
    assert W.classify_column('minecraft:snow', 70, 70) == W.LAND
    assert W.classify_column(None, 62, 50) == W.UNK


def t_chunk_summary(W):
    c = make_chunk(0, 0, {(0, 0): 'ice', (1, 0): 'shallow', (2, 0): 'deep', (3, 0): 'lava'}, inhabited=77)
    s = W.chunk_summary(W.parse_nbt(nbt(c)))
    assert s['inhabited'] == 77 and s['status'] == 'full'
    assert list(s['classes'][:5]) == [W.ICE, W.SHALLOW, W.DEEP, W.LAVA, W.LAND], list(s['classes'][:5])
    p = W.chunk_summary(W.parse_nbt(nbt(make_chunk(0, 0, {}, status='minecraft:features'))))
    assert p['classes'] is None
    bad = make_chunk(0, 0, {})
    del bad['Heightmaps']
    try:
        W.chunk_summary(W.parse_nbt(nbt(bad)))
        raise AssertionError('a full chunk without heightmaps classified')
    except ValueError:
        pass


def _strip_world(W, gaps):
    """Three 1-chunk-wide land columns of chunks along z, separated by water strips of the given widths in x.
    Layout in blocks x: land [0,16), water gaps[0], land 16, water gaps[1], land 16. Returns the grid."""
    xs, cur = [], 0
    for k, g in enumerate([0] + list(gaps)):
        xs += ['deep'] * g
        xs += ['land'] * 16
    width = -(-len(xs) // 16) * 16
    xs += ['deep'] * (width - len(xs))
    nch = width // 16
    grid = W.Grid(0, 0, nch - 1, 0)
    for ci in range(nch):
        cl = bytearray(256)
        for z in range(16):
            for x in range(16):
                cl[z * 16 + x] = {'land': W.LAND, 'deep': W.DEEP}[xs[ci * 16 + x]]
        grid.put_chunk(ci, 0, bytes(cl))
    return grid, xs


def t_flood_tiers(W):
    grid, xs = _strip_world(W, [20, 30])
    R = W.reach(grid, home=(2, 2))
    land_total = R['_land_cols']
    assert land_total == 48 * 16, land_total
    assert R['land']['land_cols'] == 16 * 16                       # the home strip only
    assert R['swim24']['land_cols'] == 32 * 16, R['swim24']['land_cols']   # 20-wide crossing yes, 30-wide no
    assert R['swim']['land_cols'] == 48 * 16


def t_near_shore(W):
    grid, xs = _strip_world(W, [30])
    m = W.near_shore(grid, 12)
    row = [m[x] for x in range(len(xs))]
    water = [i for i, k in enumerate(xs) if k == 'deep' and i < 46]
    assert [row[i] for i in water[:12]] == [1] * 12 and row[water[12]] == 0 and row[water[-13]] == 0, row[16:46]


def t_border_and_denominators(W):
    rng = W.border_chunk_range(10000)
    assert rng == ((-313, 312), (-313, 312)), rng
    assert (rng[0][1] - rng[0][0] + 1) ** 2 == 391876
    gen = {(x, z) for x in range(10) for z in range(10)}
    li = {c for c in gen if c[0] < 8}                              # 80 of 100 have land/ice
    reach = {c for c in li if c[1] < 5}                            # 40 reachable
    d = W.denominators(gen, li, reach, rng)
    assert d['generated'] == 100 and d['landice_share'] == 0.8 and d['ungenerated'] == 391776
    assert abs(d['border_reachable_est'] - (40 + 0.8 * 391776)) < 0.2, d
    try:
        W.denominators(set(), set(), set(), rng)
        raise AssertionError('empty generated area gave a denominator')
    except W.ZeroLooksWrong:
        pass


def t_tiles(W):
    assert W.tile_of(-313, -313) == (0, 0) and W.tile_of(312, 312) == (8, 8) and W.tile_of(0, 0) == (4, 4)
    assert W.tile_of(400, 0) is None
    rng = W.border_chunk_range(10000)
    gen = {(x, z) for x in range(-2, 2) for z in range(-2, 2)}
    t = W.tiles(gen, gen, {(0, 0)}, {(0, 0), (1, 1)}, 0.5, rng)
    assert len(t) == 81 and sum(e['chunks'] for e in t) == 391876
    mid = next(e for e in t if (e['i'], e['j']) == (4, 4))
    assert mid['seen'] == 1 and mid['stood'] == 2 and mid['generated'] == 16 and not mid['measured']
    assert abs(mid['denominator'] - (16 + 0.5 * (mid['chunks'] - 16))) < 0.2
    # a tile with no denominator is UNKNOWN (None), never 0%
    t0 = W.tiles(gen, gen, set(), set(), 0.0, rng)
    corner = next(e for e in t0 if (e['i'], e['j']) == (0, 0))
    assert corner['seen_pct'] is None, corner


def t_radius(W):
    rng = W.border_chunk_range(10000)
    gen = {(x, z) for x in range(-30, 30) for z in range(-30, 30)}
    r = W.radius_stats({(0, 0), (25, 0)}, gen, gen, 0.9, rng, 300)
    assert r['seen'] == 1 and r['ungenerated'] == 0 and r['reachable_generated'] > 1000, r


def t_trip_stats(W):
    now = 1_800_000_000_000
    H = 3_600_000
    trips = [{'t': now - 1 * H, 'bearing': 3, 'dist': 310, 'returned': True},
             {'t': now - 2 * H, 'bearing': 3, 'dist': 320, 'returned': True},
             {'t': now - 30 * H, 'bearing': 3, 'dist': 305, 'returned': False},
             {'t': now - 5 * H, 'bearing': 4, 'dist': 400, 'returned': True},
             {'t': now - 5 * H, 'bearing': 4, 'dist': 299, 'returned': True},
             {'t': now - 80 * H, 'bearing': 4, 'dist': 500, 'returned': True}]
    s = W.trip_stats(trips, now)
    assert s['trips_24h'] == 4 and s['home_24h'] == 4 and s['home_pct_24h'] == 100.0 and s['furthest_24h'] == 400
    assert s['s1_bearings'] == 1 and s['s1_trips_by_bearing'] == {'3': 3, '4': 1}, s
    assert s['furthest_ever'] == 500


def t_trails(W):
    assert W.trip_start_ms('showcase-Juno-mvydjy8s') == int('mvydjy8s', 36)
    assert W.trip_start_ms('nope') is None
    t0 = int('mvydjy8s', 36)
    trips = [{'id': 'showcase-Juno-mvydjy8s', 'by': 'showcase-Juno', 't': t0 + 60_000}]
    pos = {'showcase-Juno': [(t0 - 10, 0, 0, 0), (t0 + 1, 1, 70, 1), (t0 + 30_000, 5, 70, 9), (t0 + 999_999, 9, 9, 9)]}
    tr = W.trails(trips, pos)
    assert tr == {'showcase-Juno-mvydjy8s': [[1.0, 70.0, 1.0], [5.0, 70.0, 9.0]]}, tr
    assert W.trails(trips, {'showcase-Juno': [(t0 + 1, 1, 70, 1)]}) == {}       # one point is not a line


def t_stood(W):
    rows = [('showcase-Alpha', 1, 0.5, 64, 0.5), ('showcase-Alpha', 2, -0.5, 64, 15.9), ('showcase-FIXTURE', 3, 999, 0, 999),
            ('showcase-Bravo', 4, 31.9, 64, -16.0)]
    ch, st = W.stood_from_positions(rows)
    assert ch == {(0, 0), (-1, 0), (1, -1)} and st['rows'] == 3 and st['bots'] == 2 and st['skipped_rows'] == 1, (ch, st)


def _layer(W):
    markers = [{'at': [10, 63, 20], 'bearing': 3, 'trip': 'x', 'by': 'showcase-Gale', 'dist': 254, 'torch': True}]
    trips = [{'id': 'showcase-Gale-abc', 'by': 'showcase-Gale', 'bearing': 3, 'dist': 50, 'reason': 'zone',
              'returned': True, 'via': 'crumbs'}]
    zones = [{'id': 'village-taiga-6_1', 'kind': 'village', 'label': 'v', 'box': [49, -64, -59, 157, 90, 45], 'floor_y': 54},
             {'id': 'trial-chambers-home-se', 'kind': 'trial_chambers', 'box': [-20, -64, 65, 88, 31, 164]}]
    plan = {'plots': [{'id': 'core', 'kind': 'plaza', 'box': [-6, -6, 6, 6], 'y': 70}]}
    return W.build_marker_sets(markers, trips, {'showcase-Gale-abc': [[0, 70, 0], [5, 70, 50]]}, zones, plan)


def t_marker_sets(W):
    ms = _layer(W)
    assert W.validate_marker_sets(ms)
    assert len(ms['wm-expeditions']['markers']) == 1 and len(ms['wm-trails']['markers']) == 1
    z = ms['wm-zones']['markers']
    assert set(z) == {'village-taiga-6_1', 'trial-chambers-home-se'}
    assert 'underground' in z['trial-chambers-home-se']['label'] and len(z['village-taiga-6_1']['shape']) == 4
    ln = ms['wm-trails']['markers']['t-showcase-Gale-abc']
    assert ln['type'] == 'line' and len(ln['line']) == 2 and ln['position'] == {'x': 0, 'y': 70, 'z': 0}


def t_validate_rejects(W):
    for mut in (lambda m: m['wm-trails']['markers']['t-showcase-Gale-abc'].update(line=[{'x': 0, 'y': 0, 'z': 0}]),
                lambda m: m['wm-zones']['markers']['village-taiga-6_1'].update(shape=[{'x': 0, 'z': 0}] * 2),
                lambda m: m['wm-expeditions']['markers']['m0']['position'].update(x=float('nan')),
                lambda m: m['wm-zones']['markers'].update({'bad key': {'type': 'poi'}}),
                lambda m: m.update({'9set': {'markers': {}}})):
        ms = _layer(W)
        mut(ms)
        try:
            W.validate_marker_sets(ms)
            raise AssertionError('accepted a broken layer')
        except ValueError:
            pass


def t_write_layer_atomic(W):
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'm.json')
    W.write_layer(p, _layer(W))
    first = open(p).read()
    json.loads(first)
    bad = _layer(W)
    bad['wm-trails']['markers']['t-showcase-Gale-abc']['line'] = []
    try:
        W.write_layer(p, bad)
        raise AssertionError('wrote a broken layer')
    except ValueError:
        pass
    assert open(p).read() == first and not os.path.exists(p + '.tmp')        # untouched
    W.write_layer(p, _layer(W))
    assert os.path.exists(p + '.bak') and open(p + '.bak').read() == first


def _fixture(W, inhabited=((0, 0, 50),), log_rows=True):
    root = tempfile.mkdtemp()
    reg = os.path.join(root, 'region'); os.makedirs(reg)
    chunks = {}
    for cx in range(-2, 2):
        for cz in range(-2, 2):
            cols = {(x, z): 'deep' for x in range(16) for z in range(16)} if (cx, cz) == (1, 1) else {}
            chunks[(cx, cz)] = make_chunk(cx, cz, cols)
    for cx, cz, v in inhabited:
        chunks[(cx, cz)]['InhabitedTime'] = Long(v)
    # region files by region coordinate
    by = {}
    for (cx, cz), c in chunks.items():
        by.setdefault((cx >> 5, cz >> 5), {})[(cx, cz)] = c
    for (rx, rz), cs in by.items():
        write_region(os.path.join(reg, f'r.{rx}.{rz}.mca'), cs, torn={(-2, -2)} if (rx, rz) == (-1, -1) else ())
    pool = os.path.join(root, 'pool'); os.makedirs(pool)
    now = int(time.time() * 1000)
    def b36(n):
        s = ''
        while n:
            n, r = divmod(n, 36)
            s = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + s
        return s
    tid = 'showcase-Alpha-' + b36(now - 60_000)
    open(os.path.join(pool, 'expedition-0_70_0.trips.jsonl'), 'w').write(json.dumps(
        {'t': now - 1000, 'id': tid, 'by': 'showcase-Alpha', 'bearing': 3, 'dist': 40, 'reason': 'reached',
         'returned': True, 'via': 'crumbs'}) + '\n')
    open(os.path.join(pool, 'expedition-0_70_0.markers.jsonl'), 'w').write(json.dumps(
        {'at': [5, 64, 5], 'bearing': 3, 'trip': tid, 'by': 'showcase-Alpha', 'dist': 30}) + '\n')
    json.dump({'zones': [{'id': 'z1', 'kind': 'village', 'box': [1, -64, 1, 9, 90, 9]}]},
              open(os.path.join(pool, 'protected-zones.json'), 'w'))
    logs = os.path.join(root, 'logs', 'showcase-Alpha'); os.makedirs(logs)
    if log_rows:
        with open(os.path.join(logs, 'skill-showcase-Alpha.jsonl'), 'w') as f:
            for k, (x, z) in enumerate([(1, 1), (8, 8), (20, 3)]):
                ts = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime((now - 50_000 + k * 10_000) / 1000)) + '.000Z'
                f.write(json.dumps({'@timestamp': ts, 'bot': {'name': 'showcase-Alpha', 'pos': {'x': x, 'y': 64, 'z': z}},
                                    'skill': {'name': 'gather'}}) + '\n')
            f.write('\x00\x01 binary junk "pos" not json\n')
    ship = os.path.join(root, 'ship.jsonl')
    args = ['--region', reg, '--pool', pool, '--logs', os.path.join(root, 'logs', '*', 'skill-*.jsonl*'),
            '--state', os.path.join(root, 'state'), '--layer', os.path.join(root, 'bm', 'markers.json'), '--ship', ship]
    return root, args, ship


def t_end_to_end_full(W):
    root, args, ship = _fixture(W)
    with contextlib.redirect_stdout(io.StringIO()) as out:
        rc = W.main(['full'] + args)
    text = out.getvalue()
    assert rc == 0, text
    cov = json.load(open(os.path.join(root, 'state', 'coverage.json')))['coverage']
    assert cov['scan']['unreadable_chunks'] == 1, cov['scan']          # the torn chunk is COUNTED, not dropped
    assert cov['denominators']['generated'] == 15 and cov['denominators']['generated_landice'] == 14
    assert cov['seen']['chunks_raw'] == 1 and cov['seen']['chunks_reachable'] == 1
    assert cov['stood']['chunks'] == 2 and cov['stood']['walk']['rows'] == 3, cov['stood']
    assert 'seen (border, reachable): 1 / ' in text and 'ungenerated' in text and '/ 391,876' in text, text
    row = json.loads(open(ship).read().splitlines()[-1])
    assert row['kind'] == 'showcase_wholemap' and row['ok'] and row['seen_chunks'] == 1 and row['trips_24h'] == 1, row
    ms = json.load(open(os.path.join(root, 'bm', 'markers.json')))
    assert len(ms['wm-trails']['markers']) == 1 and len(ms['wm-zones']['markers']) == 1
    # trips mode reuses the scan and still ships the coverage numbers
    with contextlib.redirect_stdout(io.StringIO()):
        assert W.main(['trips'] + args) == 0
    row2 = json.loads(open(ship).read().splitlines()[-1])
    assert row2['mode'] == 'trips' and row2['seen_chunks'] == 1 and row2['scan_at'] == row['scan_at'], row2


def t_unknown_is_never_zero(W):
    # no InhabitedTime anywhere -> UNKNOWN (exit 2, a not-ok row), never "seen 0"
    root, args, ship = _fixture(W, inhabited=())
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
        rc = W.main(['full'] + args)
    assert rc == 2 and 'UNKNOWN' in err.getvalue(), err.getvalue()
    row = json.loads(open(ship).read().splitlines()[-1])
    assert row['ok'] is False and 'seen_chunks' not in row, row
    assert not os.path.exists(os.path.join(root, 'state', 'coverage.json'))
    # no bot positions in the logs -> UNKNOWN
    root, args, ship = _fixture(W, log_rows=False)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        assert W.main(['full'] + args) == 2
    # no region files -> UNKNOWN
    root, args, ship = _fixture(W)
    args[1] = os.path.join(root, 'nowhere')
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        assert W.main(['full'] + args) == 2


def t_stood_is_cumulative(W):
    root, args, ship = _fixture(W)
    with contextlib.redirect_stdout(io.StringIO()):
        assert W.main(['full'] + args) == 0
    # rotation drops the old log; the stood set must not shrink
    lp = os.path.join(root, 'logs', 'showcase-Alpha', 'skill-showcase-Alpha.jsonl')
    lines = open(lp).read().splitlines()
    open(lp, 'w').write(lines[0] + '\n')
    with contextlib.redirect_stdout(io.StringIO()):
        assert W.main(['full'] + args) == 0
    cov = json.load(open(os.path.join(root, 'state', 'coverage.json')))['coverage']
    assert cov['stood']['chunks'] == 2 and cov['stood']['chunks_this_walk'] == 1, cov['stood']


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]


def run_all(W, quiet=False):
    failed = []
    for n, f in TESTS:
        try:
            f(W)
            if not quiet:
                print(f'  PASS  {n[2:]}')
        except Exception as e:                     # noqa: BLE001
            failed.append(n)
            if not quiet:
                print(f'  FAIL  {n[2:]}: {type(e).__name__}: {e}')
    return failed


# (name, old, new, the test that must fail)
MUTANTS = [
    ('swim24 crosses 48 blocks', "shore = near_shore(grid, SWIM_MAX // 2)", "shore = near_shore(grid, SWIM_MAX)",
     't_flood_tiers'),
    ('3-deep water counts as wading', 'SHALLOW if ws_y - of_y <= SHALLOW_MAX else DEEP',
     'SHALLOW if ws_y - of_y <= SHALLOW_MAX + 1 else DEEP', 't_classify'),
    ('InhabitedTime 0 counts as seen', "seen_raw = {c for c, s in summ.items() if s['inhabited'] > 0}",
     "seen_raw = {c for c, s in summ.items() if s['inhabited'] >= 0}", 't_end_to_end_full'),
    ('empty seen is reported as a zero', "    if not seen_raw:\n        raise ZeroLooksWrong(",
     "    if False:\n        raise ZeroLooksWrong(", 't_unknown_is_never_zero'),
    ('empty log walk is reported as a zero', "    if wstats['rows'] == 0:\n", "    if False:\n",
     't_unknown_is_never_zero'),
    ('a 1-point line passes validation', "if len(m.get('line') or []) < 2:", "if len(m.get('line') or []) < 1:",
     't_validate_rejects'),
    ('torn chunk silently dropped', "                    unreadable.append((cx, cz, f'{type(nbt).__name__}: {str(nbt)[:80]}'))\n",
     "                    pass\n", 't_end_to_end_full'),
    ('stood forgets the cumulative set', "stood = walk | {tuple(c) for c in st.get('chunks', [])}", 'stood = walk',
     't_stood_is_cumulative'),
    ('border off by one', "math.floor((center[0] + half - 1e-9) / 16)", "math.floor((center[0] + half - 1e-9) / 16) - 1",
     't_border_and_denominators'),
    ('unknown tile reads 0%', "def pct(n, d):\n    return None if not d else", "def pct(n, d):\n    return 0.0 if not d else",
     't_tiles'),
    ('FIXTURE bot counted as stood', "BOT_NAME = re.compile(r'^showcase-[A-Z][a-z]+$')",
     "BOT_NAME = re.compile(r'^showcase-')", 't_stood'),
]


def run_mutants():
    src = open(SRC).read()
    killed = 0
    for k, (name, old, new, test) in enumerate(MUTANTS):
        assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {name}'
        M = load(src.replace(old, new), name=f'wholemap_mut{k}')
        fn = dict(TESTS)[test]
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                fn(M)
            print(f'  SURVIVED  mutant {name!r} ({test} still passes)')
        except Exception:                          # noqa: BLE001 -- the intended failure
            killed += 1
            print(f'  killed    mutant {name!r} by {test}')
    return killed


if __name__ == '__main__':
    W = load()
    failed = run_all(W)
    print(f'{len(TESTS) - len(failed)} passed, {len(failed)} failed')
    killed = run_mutants()
    print(f'mutants killed {killed}/{len(MUTANTS)}')
    sys.exit(1 if failed or killed != len(MUTANTS) else 0)
