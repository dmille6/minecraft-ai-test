#!/usr/bin/env python3
"""Behaviour tests for failmine.py and fmserve.py, then anchored source MUTANTS that each must turn a named test red.

No network, no credentials, no world: the ES path runs the REAL estelemetry library against test_estelemetry.py's
in-memory FakeES (extended here with min/max on any numeric field); region files are synthesised byte for byte.

    python3 test_failmine.py            all tests, then every mutant (exit 1 on any failure or any surviving mutant)
    python3 test_failmine.py --no-mutants

BLIND INPUT (the owner's "must fail loudly, never read 0"): a renamed death kind (near and far names), death rows
without a position, a renamed position field, positions for only some bots, frozen positions, a missing region file,
an absent chunk, a chunk that is not `full`, a missing section, a palette index out of range, a tampered scene -- every
one RAISES, and a mutant that removes each guard is shown to be caught.
"""
import contextlib, datetime as dt, importlib.util, io, json, math, os, struct, sys, tempfile, traceback, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
for d in (HERE, os.path.join(HERE, '..', '..')):
    if os.path.exists(os.path.join(d, 'test_estelemetry.py')):
        sys.path.insert(0, d)
        break
import test_estelemetry as TE  # noqa: E402  (FakeES; importing runs no tests)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


FM_PATH = os.path.join(HERE, 'failmine.py')
SV_PATH = os.path.join(HERE, 'fmserve.py')
NOW = '2026-10-14T20:00:00Z'
SINCE, UNTIL = '2026-10-14T00:00:00Z', '2026-10-14T06:00:00Z'


def raises(exc, fn, contains=None):
    try:
        fn()
    except exc as e:
        if contains and contains not in str(e):
            raise AssertionError(f'{exc.__name__} raised without {contains!r}: {e}')
        return e
    raise AssertionError(f'expected {exc.__name__}, nothing raised')


# ------------------------------------------------------------------ a fake ES with numeric min/max
class FakeES(TE.FakeES):
    def agg(self, spec, docs, nested=False):
        (k, v), = ((k, v) for k, v in spec.items() if k != 'aggs')
        if k in ('min', 'max') and v['field'] != '@timestamp':
            xs = [TE.get(d, v['field']) for d in docs]
            xs = [x for x in xs if isinstance(x, (int, float))]
            return {'value': (min if k == 'min' else max)(xs) if xs else None}
        return super().agg(spec, docs, nested)


def ts(minute, sec=0):
    return (dt.datetime(2026, 10, 14, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=minute, seconds=sec)).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def row(t, bot, name='_reflex_tick', pos=None, inv=None, detail=None, args=None, trigger=None, status='success', fail=None, tools=None):
    d = {'@timestamp': t, 'skill': {'name': name, 'status': status}, 'bot': {'name': bot}, 'exp': {'pool': bot.rsplit('-', 1)[0]},
         'code': {'version': 'test'}}
    if pos is not None:
        d['bot']['pos'] = {'x': pos[0], 'y': pos[1], 'z': pos[2]}
        d['bot']['inventory'] = inv if inv is not None else {'cobblestone': 3, 'wooden_pickaxe': 1}
        d['bot']['tools'] = tools if tools is not None else {'wooden_pickaxe': [{'used': 21, 'max': 59, 'slot': 0}]}
        d['bot']['health'] = 20; d['bot']['hunger'] = 20
    if detail is not None: d['skill']['detail'] = detail
    if args is not None: d['skill']['args'] = args
    if trigger is not None: d['trigger'] = trigger
    if fail: d['skill']['fail_class'] = fail
    return d


META = {'board-a': {'seed': 1239381899, 'home': [355, 73, 147], 'gamerules': {'keepInventory': 'true'}},
        'hive-a': {'seed': 1239381899, 'home': [355, 73, 147]}, 'placebo-a': {'seed': 77, 'home': [249, 75, -144]},
        'hive-b': {'seed': 1239381899, 'home': [355, 73, 147]}}


def fleet(death_kind='_death', pos_field='pos', drop_pos_bots=(), frozen=False, nopos_death=False):
    """6 h: board-a-Bravo trapped at (359.5, 40.2, 187.5) from 01:00 to the end; board-a-Alpha, hive-a-Comet, placebo-a-Delta
    and hive-b-Echo move; three lava deaths at one seed-1239381899 place in two worlds, one at the same place in seed 77."""
    docs = []
    walkers = {'board-a-Alpha': (300, 64, 100), 'hive-a-Comet': (320, 64, 120), 'placebo-a-Delta': (200, 64, 0), 'hive-b-Echo': (250, 70, 90)}
    for m in range(0, 360):
        for bot, (x, y, z) in walkers.items():
            p = (x, y, z) if frozen else (x + (m % 40) * 1.5, y, z + (m // 40) * 2.0)
            docs.append(row(ts(m), bot, pos=None if bot in drop_pos_bots else p))
        p = (359.5, 40.2, 187.5) if m >= 60 else (340 + m * 0.3, 60, 180)
        docs.append(row(ts(m), 'board-a-Bravo', pos=None if 'board-a-Bravo' in drop_pos_bots else p))
    for bot, m, p, det in (('board-a-Alpha', 120, (336.2, 37.0, 204.1), 'tried to swim in lava; idle at the moment of death | hp 12->0'),
                           ('hive-a-Comet', 180, (337.0, 38.0, 205.0), 'tried to swim in lava after falling 9 blocks; was running explore | x'),
                           ('board-a-Alpha', 300, (335.5, 37.0, 203.5), 'tried to swim in lava; was running gather | y'),
                           ('placebo-a-Delta', 240, (336.0, 37.0, 204.0), 'tried to swim in lava; idle at the moment of death')):
        docs.append(row(ts(m - 2), bot, name='explore', pos=(p[0] - 3, p[1] + 9, p[2]), args={'blocks': 40}, trigger='llm:idle', status='aborted'))
        docs.append(row(ts(m - 1, 50), bot, name='gather', pos=(p[0] - 1, p[1] + 9, p[2]), args={'block': 'dirt', 'count': 4}, trigger='interrupt:death', status='aborted'))
        docs.append(row(ts(m, 0), bot, name=death_kind, pos=None if nopos_death else p, detail=det, status='failed', fail='fire'))
        docs.append(row(ts(m, 1), bot, name='goto', pos=(355, 73, 147), args={'x': 1, 'y': 2, 'z': 3}, trigger='llm:death'))
    if pos_field != 'pos':
        for d in docs:
            if 'pos' in d['bot'] and d['skill']['name'] != death_kind:
                d['bot'][pos_field] = d['bot'].pop('pos')
    return docs


def source(F, docs):
    return F.EsSource(SINCE, UNTIL, client=FakeES(docs), now=NOW)


# ------------------------------------------------------------------ synthetic region files
def nbt(tag, name, v):
    def enc_name(n):
        b = n.encode(); return struct.pack('>H', len(b)) + b

    def pay(t, v):
        if t == 1: return struct.pack('>b', v)
        if t == 3: return struct.pack('>i', v)
        if t == 8: b = v.encode(); return struct.pack('>H', len(b)) + b
        if t == 12: return struct.pack('>i', len(v)) + b''.join(struct.pack('>q', x) for x in v)
        if t == 9:
            et, items = v
            return bytes([et]) + struct.pack('>i', len(items)) + b''.join(pay(et, x) for x in items)
        if t == 10:
            return b''.join(bytes([tt]) + enc_name(k) + pay(tt, vv) for k, (tt, vv) in v.items()) + b'\x00'
        raise ValueError(t)
    return bytes([tag]) + enc_name(name) + pay(tag, v)


def pack(vals, npal):
    bits = max(4, (npal - 1).bit_length()); per = 64 // bits
    longs = []
    for i in range(0, 4096, per):
        x = 0
        for k, v in enumerate(vals[i:i + per]):
            x |= v << (k * bits)
        longs.append(x - (1 << 64) if x >= 1 << 63 else x)
    return longs


def section(sy, cell_fn, cx, cz):
    """cell_fn(x, y, z) -> (name, props) in absolute coords for one 16^3 section."""
    pal, idx, vals = [], {}, []
    for ly in range(16):
        for lz in range(16):
            for lx in range(16):
                st = cell_fn(cx * 16 + lx, sy * 16 + ly, cz * 16 + lz)
                key = (st[0], tuple(sorted(st[1].items())))
                if key not in idx:
                    idx[key] = len(pal); pal.append(key)
                vals.append(idx[key])
    pc = [(10, {'Name': (8, 'minecraft:' + n), **({'Properties': (10, {k: (8, v) for k, v in pr})} if pr else {})}) for n, pr in pal]
    bs = {'palette': (9, (10, [c[1] for c in pc]))}
    if len(pal) > 1:
        bs['data'] = (12, pack(vals, len(pal)))
    return {'Y': (1, sy), 'block_states': (10, bs)}


def write_region(path, chunks):
    """chunks: {(cx, cz): {'status': 'minecraft:full', 'sections': [section dicts]}} -> an .mca file."""
    header = bytearray(8192); body = bytearray(); sector = 2
    for (cx, cz), c in chunks.items():
        root = {'Status': (8, c.get('status', 'minecraft:full')), 'DataVersion': (3, 4440),
                'sections': (9, (10, c['sections']))}
        raw = zlib.compress(nbt(10, '', root))
        blob = struct.pack('>I', len(raw) + 1) + b'\x02' + raw
        blob += b'\x00' * ((-len(blob)) % 4096)
        i = 4 * ((cx & 31) + (cz & 31) * 32)
        header[i:i + 3] = sector.to_bytes(3, 'big'); header[i + 3] = len(blob) // 4096
        header[4096 + i:4096 + i + 4] = struct.pack('>I', 1761270000)
        body += blob; sector += len(blob) // 4096
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(bytes(header) + bytes(body))


def comet_world(x, y, z):
    """board-a-Comet's column at (359, y, 187) (docs/reports/boarda-comet-trap-2026-10-23.md section 2), stone elsewhere."""
    if (x, z) == (359, 187):
        return {38: ('stone', {}), 39: ('water', {'level': '8'}), 40: ('water', {'level': '8'}), 41: ('water', {'level': '2'}),
                42: ('copper_ore', {}), 43: ('copper_ore', {})}.get(y, ('air', {}) if y > 43 else ('stone', {}))
    if (x, y, z) == (360, 40, 187): return ('dirt', {})
    if (x, y, z) == (360, 41, 187): return ('ladder', {'facing': 'south', 'waterlogged': 'false'})
    if x >= 361 and y in (40, 41) and 185 <= z <= 189: return ('air', {})
    if y > 60: return ('air', {})
    return ('stone', {})


def comet_region(root, status='minecraft:full', drop_section=None):
    chunks = {}
    for cx in (21, 22, 23):
        for cz in (10, 11, 12):
            secs = [section(sy, comet_world, cx, cz) for sy in range(0, 5) if sy != drop_section]
            chunks[(cx, cz)] = {'status': status, 'sections': secs}
    write_region(os.path.join(root, 'board-a', 'r.0.0.mca'), chunks)


# ------------------------------------------------------------------ tests (each takes the module under test)
def t_classify_every_cause(F):
    cases = {'tried to swim in lava': ('lava', 'lava'), 'tried to swim in lava after falling 9 blocks': ('lava after a fall', 'lava'),
             'discovered the floor was lava': ('magma', 'lava'), 'drowned': ('drowned', 'drowned'),
             'was impaled on a stalagmite after falling 21 blocks': ('stalagmite', 'fall'), 'fell from a high place': ('fall', 'fall'),
             'was doomed to fall': ('doomed to fall', 'fall'), 'was skewered by a falling stalactite': ('stalactite', 'stalactite'),
             'suffocated in a wall': ('suffocated', 'suffocated')}
    for msg, want in cases.items():
        assert F.classify_death(msg + '; idle at the moment of death | hp 3->0') == want, (msg, F.classify_death(msg))
    assert F.classify_death('was struck by lightning')[1] == 'unclassified'


def t_death_points_missing_position_raises(F):
    rows = [row(ts(1), 'board-a-Alpha', name='_death', pos=(1, 2, 3), detail='drowned'), row(ts(2), 'board-a-Bravo', name='_death', detail='drowned')]
    raises(F.BlindInput, lambda: F.death_points(rows, META), 'carry no bot.pos')


def t_death_points_empty_raises(F):
    raises(F.ZeroLooksWrong, lambda: F.death_points([], META))


def t_death_points_count_mismatch_raises(F):
    raises(F.BlindInput, lambda: F.death_points([row(ts(1), 'board-a-Alpha', name='_death', pos=(1, 2, 3), detail='drowned')], META, expected=2))


def t_death_points_unknown_world_raises(F):
    raises(F.BlindInput, lambda: F.death_points([row(ts(1), 'board-z-Alpha', name='_death', pos=(1, 2, 3), detail='drowned')], META), 'seeds file')


def t_death_points_format_change_raises(F):
    rows = [row(ts(i), 'board-a-Alpha', name='_death', pos=(1, 2, 3), detail=f'DEATH cause={i}') for i in range(4)]
    raises(F.BlindInput, lambda: F.death_points(rows, META), 'match no known cause')


def t_es_renamed_death_kind_near_raises(F):
    raises(F.ZeroLooksWrong, lambda: source(F, fleet(death_kind='_deaths')).deaths())


def t_es_renamed_death_kind_far_raises(F):
    raises(F.ZeroLooksWrong, lambda: source(F, fleet(death_kind='_bot_expired')).deaths())


def t_es_death_rows_without_position_raise(F):
    raises(F.BlindInput, lambda: F.mine(source(F, fleet(nopos_death=True)), META), 'carry no bot.pos')


def t_es_renamed_position_field_raises(F):
    # the death rows keep their position here, so the stream is THINNED, not empty: the coverage guard raises
    raises(F.BlindInput, lambda: F.mine(source(F, fleet(pos_field='position')), META), 'position buckets cover')
    # and with no positioned row at all, the zero guard
    docs = fleet(pos_field='position')
    for d in docs:
        d['bot'].pop('pos', None)
    raises(F.ZeroLooksWrong, lambda: F.check_boxes(source(F, docs).boxes(), ['board-a-Alpha']), '0 position buckets')


def t_es_positions_for_some_bots_raise(F):
    raises(F.BlindInput, lambda: F.mine(source(F, fleet(drop_pos_bots=('board-a-Alpha', 'hive-a-Comet'))), META), 'positions are missing from part')


def t_es_frozen_positions_raise(F):
    docs = [d for d in fleet(frozen=True)]
    for d in docs:
        if d['bot']['name'] == 'board-a-Bravo' and 'pos' in d['bot']:
            d['bot']['pos'] = {'x': 359.5, 'y': 40.2, 'z': 187.5}
    raises(F.BlindInput, lambda: F.mine(source(F, docs), META), 'frozen')


def t_es_mine_end_to_end(F):
    res = F.mine(source(F, fleet()), META, top_deaths=2, top_stuck=2, min_deaths=1, min_bot_h=1)
    d = res['denominators']
    assert d['deaths'] == 4, d
    # positive control: the same instrument sees the walkers MOVE (else a zero spell count would be blind)
    assert res['controls']['positions']['moving_buckets'] > 0 and res['controls']['positions']['still_share'] < 0.6
    top = res['death_clusters'][0]
    assert top['family'] == 'lava' and top['deaths'] == 3 and top['worlds'] == ['board-a', 'hive-a'], top
    assert top['seed'] == 1239381899
    other = [c for c in res['death_clusters'] if c['seed'] == 77]
    assert len(other) == 1 and other[0]['deaths'] == 1, 'a different seed at the same coordinates is a different place'
    sc = res['stuck_clusters']
    assert sc[0]['bots'] == ['board-a-Bravo'] and sc[0]['ongoing_bots'] == ['board-a-Bravo'], sc[0]
    assert 4.5 <= sc[0]['bot_h'] <= 5.0, sc[0]['bot_h']           # 01:00 .. 06:00, whole buckets
    kinds = [p['kind'] for p in res['picks']]
    assert kinds.count('death') == 2 and kinds.count('stuck') == 1, kinds
    dp = res['picks'][0]
    assert dp['death']['bot'] in ('board-a-Alpha', 'hive-a-Comet')
    # the cluster's other death in the SAME world rides along as an alternate start; the other world's does not
    assert dp['world'] == 'board-a' and [a['death']['bot'] for a in dp['alternates']] == ['board-a-Alpha'], dp['alternates']
    lo, hi = dp['box']['lo'], dp['box']['hi']
    for a in dp['alternates'] + [dp]:
        assert all(lo[i] <= math.floor(a['start']['pos'][i]) <= hi[i] for i in range(3)), 'an alternate start outside the box'
    sp = [p for p in res['picks'] if p['kind'] == 'stuck'][0]
    assert sp['bag']['stacks'] and sp['start']['pos'] == (359.5, 40.2, 187.5) or list(sp['start']['pos']) == [359.5, 40.2, 187.5]
    txt = F.render(res)
    assert 'of 4 deaths' in txt and 'DEATH CLUSTERS' in txt and 'STUCK CLUSTERS' in txt


def boxes_for(bot, t0, n, c, jitter=0.0):
    return [[bot, t0 + i * 600_000, 10, c[0] - jitter, c[0] + jitter, c[1], c[1], c[2] - jitter, c[2] + jitter] for i in range(n)]


def t_es_missing_axis_raises(F):
    # Codex r1 P1: positions with z gone. The query needs all three axes, so the stream thins and the coverage guard raises
    docs = fleet()
    for d in docs:
        if d['bot']['name'] in ('board-a-Alpha', 'hive-a-Comet', 'board-a-Bravo') and 'pos' in d['bot'] and d['skill']['name'] != '_death':
            d['bot']['pos'].pop('z')
    raises(F.BlindInput, lambda: F.mine(source(F, docs), META), 'positions are missing from part')
    # and a box with a null extreme handed to the detector directly is refused, never read as motion
    b = boxes_for('a-a-A', 0, 10, (0, 0, 0), 30)
    b[3][7] = None
    raises(F.BlindInput, lambda: F.check_boxes(b, ['a-a-A']), 'lack an axis')


def t_spells_ongoing_and_clipped(F):
    hi = 10 * 600_000 + 360_000                      # the window ends 6 min into the 11th bucket
    # still through the 10th bucket, whose end is within one bucket of the window's end -- then the partial 11th MOVES
    b = boxes_for('x-a-B', 0, 10, (10, 40, 10)) + boxes_for('x-a-B', 10 * 600_000, 1, (40, 40, 10), 20)
    s = F.find_spells(b, 0, hi)
    assert len(s) == 1 and not s[0]['ongoing'], 'a spell followed by a moving bucket is not ongoing'
    b = boxes_for('x-a-B', 0, 11, (10, 40, 10))
    s = F.find_spells(b, 120_000, hi)                # starts 2 min into the first bucket, ends 6 min into the last
    assert s[0]['ongoing'], s
    assert abs(s[0]['bot_h'] - (hi - 120_000) / 3_600_000) < 1e-3, ('edge buckets are clipped to the window', s[0]['bot_h'])


def t_region_missing_data_raises(F):
    def go(d):
        reg = F.Regions(d, 'board-a')
        c = reg.chunk(22, 11)
        sec = next(s_ for s_ in c['sections'] if s_['Y'] == 2)
        sec['block_states'].pop('data')
        raises(F.BlindInput, lambda: reg.block(359, 40, 187), 'no packed data')
    with_region(go)


def t_spells_one_row_bucket_is_not_still(F):
    b = boxes_for('x-a-B', 0, 4, (10, 40, 10))
    for r in b:
        r[2] = 1
    assert F.find_spells(b) == [], 'a bucket of one row cannot show stillness'


def t_classify_ladder_falls(F):
    for m in ('fell off a ladder', 'fell while climbing', 'fell out of the water', 'fell off some vines'):
        assert F.classify_death(m)[1] == 'fall', m


def t_es_ingest_lag_raises(F):
    raises(F.BlindInput, lambda: F.mine(F.EsSource(SINCE, '2026-10-14T07:00:00Z', client=FakeES(fleet()), now=NOW), META), 'ingest lag')


def t_same_staging(F):
    a = {'backup_day': '2026-10-24', 'backup_done': '2026-10-24T03:16:17Z'}
    assert F.same_staging(a, dict(a))
    raises(F.BlindInput, lambda: F.same_staging(a, dict(a, backup_done='2026-10-24T09:01:00Z')), 'changed')
    raises(F.BlindInput, lambda: F.same_staging({'backup_day': 'x'}, {'backup_day': 'x'}), 'changed')


def t_reproducing_starts_rule(F):
    P = lambda st, m, ok=False: {'role': 'base', 'start_index': st, 'matched_fleet': m, 'pass': ok}
    assert F.reproducing_starts([P(0, True), P(0, True), P(0, False)]) == [0]
    assert F.reproducing_starts([P(0, True), P(0, False), P(0, False)]) == [], 'one in three is a draw, not a reproduction'
    assert F.reproducing_starts([P(0, True), P(0, True), P(0, False, ok=True)]) == [], 'a base run that PASSED retires the start'
    assert F.reproducing_starts([P(1, True), P(1, True), P(0, None)]) == [1], 'a no-run proves nothing'
    raises(F.BlindInput, lambda: F.prove({'id': 'x', 'cells_sha256': 'y', 'proof': []}, [], ''), '7 hex')


def t_scene_goal_outside_cut(F):
    def go(d):
        pick = {'id': 'fall-1899-board-a-359_40_187', 'kind': 'death', 'family': 'fall', 'rank': 1, 'world': 'board-a', 'seed': 1239381899,
                'home': [355, 73, 147], 'start': {'rule': 'lead', 'pos': [359.3, 40.2, 187.4]},
                'death': {'pos': (359.5, 38.0, 187.5), 'cause': 'fall', 'fell': 3, 'bot': 'board-a-Comet', 't': 'x', 'detail': 'fell'},
                'bag': F.bag_of(row(ts(1), 'board-a-Comet', pos=(0, 0, 0))), 'script': {'skill': 'goto', 'args': {'x': 359, 'y': 41, 'z': 187}},
                'alternates': [{'start': {'rule': 'lead', 'pos': [361.5, 40.0, 187.5]}, 'script': {'skill': 'goto', 'args': {'x': 900, 'y': 40, 'z': 187}},
                                'bag': {'stacks': []}, 'running': None, 'death': {'bot': 'board-a-Bravo', 't': 'y', 'pos': (1, 2, 3)}},
                               {'start': {'rule': 'lead', 'pos': [361.5, 40.0, 187.5]}, 'script': None,
                                'bag': {'stacks': []}, 'running': None, 'death': {'bot': 'board-a-Delta', 't': 'z', 'pos': (1, 2, 3)}}],
                'box': F.stuck_box((359.3, 40.2, 187.4))}
        s = F.make_scene(pick, F.Regions(d, 'board-a'), 'now', 'day')
        assert len(s['alternates']) == 1 and s['alternates_dropped'] == [{'bot': 'board-a-Bravo', 't': 'y', 'why': 'start or goal outside the cut'}]
        pick['script'] = {'skill': 'goto', 'args': {'x': 900, 'y': 40, 'z': 187}}
        raises(F.BlindInput, lambda: F.make_scene(pick, F.Regions(d, 'board-a'), 'now', 'day'), 'outside the cut')
    with_region(go)


def t_spells_basic(F):
    b = boxes_for('board-a-Bravo', 0, 4, (10, 40, 10), 0.5) + boxes_for('board-a-Alpha', 0, 4, (0, 64, 0), 30)
    s = F.find_spells(b)
    assert len(s) == 1 and s[0]['bot'] == 'board-a-Bravo' and s[0]['buckets'] == 4


def t_spells_gap_and_drift_split(F):
    b = boxes_for('x-a-B', 0, 3, (10, 40, 10)) + boxes_for('x-a-B', 4 * 600_000, 3, (10, 40, 10))
    assert len(F.find_spells(b)) == 2, 'a missing bucket ends a spell'
    b = boxes_for('x-a-B', 0, 3, (10, 40, 10)) + boxes_for('x-a-B', 3 * 600_000, 3, (20, 40, 10))
    assert len(F.find_spells(b)) == 2, 'moving 10 blocks ends a spell'
    assert len(F.find_spells(boxes_for('x-a-B', 0, 2, (10, 40, 10)))) == 0, '20 min is not a spell'


def t_spells_straddling_buckets_merge(F):
    # REGRESSION 10-24: the day-by-day read returns a bucket that straddles midnight twice; unmerged, every spell was cut
    # at every day boundary (longest 24.2 h for bots stuck all week) and the boundary bucket counted twice
    b = boxes_for('x-a-B', 0, 6, (10, 40, 10))
    dup = list(b[3]); dup[2] = 4
    s = F.find_spells(b[:4] + [dup] + b[4:])
    assert len(s) == 1 and s[0]['buckets'] == 6, s


def t_check_boxes_guards(F):
    raises(F.ZeroLooksWrong, lambda: F.check_boxes([], ['a-a-A']))
    b = boxes_for('a-a-A', 0, 10, (0, 0, 0), 30)
    raises(F.BlindInput, lambda: F.check_boxes(b, ['a-a-A', 'a-a-B', 'a-a-C']), 'position buckets for')
    raises(F.BlindInput, lambda: F.check_boxes(boxes_for('a-a-A', 0, 10, (0, 0, 0)), ['a-a-A']), 'frozen')
    assert F.check_boxes(b, ['a-a-A'])['moving_buckets'] == 10


def t_link_seed_family_place(F):
    pts = [{'t': i, 'bot': f'board-a-{n}', 'world': 'board-a', 'seed': s, 'family': f, 'cause': f, 'pos': p, 'fell': None, 'detail': ''}
           for i, (n, s, f, p) in enumerate([('A', 1, 'lava', (0, 40, 0)), ('B', 1, 'lava', (5, 42, 3)), ('C', 1, 'lava', (10, 40, 6)),
                                              ('D', 2, 'lava', (0, 40, 0)), ('E', 1, 'fall', (0, 40, 0)), ('F', 1, 'lava', (0, 60, 0))])]
    cl = F.cluster_deaths(pts)
    sizes = sorted(c['deaths'] for c in cl)
    assert sizes == [1, 1, 1, 3], (sizes, [(c['seed'], c['family'], c['deaths']) for c in cl])
    assert cl[0]['deaths'] == 3 and cl[0]['rank'] == 1


def t_leadup_fall_ledge_and_running(F):
    t = F.ms_of(ts(100))
    rows = [row(ts(97), 'w-a-X', name='explore', pos=(0, 31, 0), args={'blocks': 40}, trigger='llm:idle'),
            row(ts(98, 30), 'w-a-X', name='gather', pos=(1, 31, 0), args={'block': 'dirt', 'count': 6}, trigger='interrupt:death', status='aborted'),
            row(ts(99, 50), 'w-a-X', name='_fall_path', pos=(1, 20, 0), detail='death (fall): fell 22; goal 375,26,149; running gather'),
            row(ts(100), 'w-a-X', name='_death', pos=(1, 8, 0), detail='was impaled on a stalagmite after falling 23 blocks; was running gather'),
            row(ts(100, 1), 'w-a-X', name='goto', pos=(355, 73, 147), args={'x': 1, 'y': 2, 'z': 3}, trigger='llm:death')]
    lu = F.leadup_start(rows, {'t': t, 'bot': 'w-a-X', 'pos': (1, 8, 0), 'fell': 23, 'family': 'fall', 'detail': rows[3]['skill']['detail']})
    assert lu['start']['rule'].startswith('pre-fall ledge') and lu['start']['pos'] == (1, 31, 0), lu['start']
    assert lu['running']['skill'] == 'gather' and lu['running']['args']['count'] == 6
    assert lu['path_goal'] == [375, 26, 149]
    assert F.script_of(lu['running']) == {'skill': 'gather', 'args': {'block': 'dirt', 'count': 6}}


def t_leadup_idle_takes_last_skill_before_death(F):
    t = F.ms_of(ts(100))
    rows = [row(ts(99), 'w-a-X', name='explore', pos=(0, 70, 0), args={'blocks': 80}, trigger='llm:idle', status='aborted'),
            row(ts(100), 'w-a-X', name='_death', pos=(5, 70, 0), detail='tried to swim in lava; idle at the moment of death'),
            row(ts(100, 1), 'w-a-X', name='goto', pos=(355, 73, 147), args={'x': 1, 'y': 2, 'z': 3}, trigger='llm:death'),
            # the next life's first decision need not say llm:death: the START stamp is what excludes it
            row(ts(100, 1), 'w-a-X', name='gather', pos=(355, 73, 147), args={'block': 'oak_log'}, trigger='llm:idle')]
    lu = F.leadup_start(rows, {'t': t, 'bot': 'w-a-X', 'pos': (5, 70, 0), 'fell': None, 'family': 'lava', 'detail': rows[1]['skill']['detail']})
    assert lu['running']['skill'] == 'explore', 'a skill begun after the death (the next life) was taken as the running one'
    assert lu['start']['pos'] == (0, 70, 0) and lu['start']['rule'] == 'lead 12 s'


def t_leadup_lava_contact(F):
    t = F.ms_of(ts(100))
    rows = [row(ts(99), 'w-a-X', name='explore', pos=(0, 71, 0), args={'blocks': 80}, trigger='llm:idle', status='aborted'),
            row(ts(99, 54), 'w-a-X', name='_reflex_danger_block', pos=(2, 71.5, 0), detail='cave_air'),
            row(ts(99, 57), 'w-a-X', name='_reflex_danger_block', pos=(3, 70, 0), detail='lava'),
            row(ts(99, 58), 'w-a-X', name='_reflex_danger_block', pos=(4, 70, 0), detail='lava'),
            row(ts(100), 'w-a-X', name='_death', pos=(5, 70, 0), detail='tried to swim in lava; idle at the moment of death')]
    rows[2]['bot']['health'] = 12
    lu = F.leadup_start(rows, {'t': t, 'bot': 'w-a-X', 'pos': (5, 70, 0), 'fell': None, 'family': 'lava', 'detail': rows[-1]['skill']['detail']})
    c = lu['contact']
    assert c and c['pos'] == (3, 70, 0) and c['health'] == 12 and c['rule'].startswith('lava contact'), c
    lu2 = F.leadup_start(rows[:2] + rows[-1:], {'t': t, 'bot': 'w-a-X', 'pos': (5, 70, 0), 'fell': None, 'family': 'lava', 'detail': ''})
    assert lu2['contact'] is None, 'cave_air at the feet is not a lava contact'


def t_leadup_no_positions_raises(F):
    raises(F.BlindInput, lambda: F.leadup_start([row(ts(1), 'w-a-X', name='explore')], {'t': F.ms_of(ts(2)), 'bot': 'w-a-X', 'pos': (0, 0, 0), 'fell': None, 'family': 'lava', 'detail': ''}))


def t_bag_tools_and_stacks(F):
    b = F.bag_of(row(ts(1), 'w-a-X', pos=(0, 0, 0), inv={'stone_pickaxe': 2, 'cobblestone': 130},
                     tools={'stone_pickaxe': [{'used': 5, 'max': 131}, {'used': 120, 'max': 131}]}))
    st = b['stacks']
    assert [s['count'] for s in st if s['id'] == 'cobblestone'] == [64, 64, 2]
    assert sorted(s['damage'] for s in st if s['id'] == 'stone_pickaxe') == [5, 120]
    raises(F.BlindInput, lambda: F.bag_of(row(ts(1), 'w-a-X')))


def with_region(fn, **kw):
    with tempfile.TemporaryDirectory() as d:
        comet_region(d, **kw)
        return fn(d)


def t_region_cut_roundtrip_and_comet_facts(F):
    def go(d):
        reg = F.Regions(d, 'board-a')
        sc = F.cut(reg, [347, 34, 175], [371, 50, 199])
        cells = F.decode(sc)
        assert len(cells) == 25 * 17 * 25
        assert cells[(359, 42, 187)] == 'copper_ore' and cells[(359, 41, 187)] == 'water[level=2]'
        assert cells[(360, 41, 187)] == 'ladder[facing=south,waterlogged=false]'
        f = F.site_facts(cells, (359, 40, 187))
        assert F.stuck_label(f) == 'stuck:wet-under-ceiling', f
        assert f['side_feet']['E'] == 'dirt' and f['ceiling_dy'] == 2
        assert reg.provenance['region_sha256'] and reg.provenance['chunk_saved']
    with_region(go)


def t_region_missing_file_raises(F):
    with tempfile.TemporaryDirectory() as d:
        raises(F.BlindInput, lambda: F.Regions(d, 'board-a').block(0, 0, 0), 'region copy missing')


def t_region_absent_chunk_raises(F):
    with_region(lambda d: raises(F.BlindInput, lambda: F.Regions(d, 'board-a').block(5, 40, 5), 'absent'))


def t_region_not_full_raises(F):
    with_region(lambda d: raises(F.BlindInput, lambda: F.Regions(d, 'board-a').block(359, 40, 187), 'not full'), status='minecraft:features')


def t_region_missing_section_raises(F):
    with_region(lambda d: raises(F.BlindInput, lambda: F.Regions(d, 'board-a').block(359, 40, 187), 'no section'), drop_section=2)


def t_region_palette_overflow_raises(F):
    def go(d):
        reg = F.Regions(d, 'board-a')
        c = reg.chunk(22, 11)
        sec = next(s for s in c['sections'] if s['Y'] == 2)
        sec['block_states']['palette'] = sec['block_states']['palette'][:2]   # indices now point past the palette
        raises(F.BlindInput, lambda: reg.block(359, 40, 187), 'palette')
    with_region(go)


def scene_for(F, d):
    pick = {'id': 'stuck-1899-board-a-359_40_187', 'kind': 'stuck', 'family': 'stuck', 'rank': 3, 'world': 'board-a', 'seed': 1239381899,
            'home': [355, 73, 147], 'gamerules': {'keepInventory': 'true'},
            'start': {'rule': 'newest positioned row of the spell', 'pos': [359.3, 40.2, 187.4]},
            'spell': {'bot': 'board-a-Comet', 'from': 'a', 'to': 'b', 'bot_h': 168.2, 'ongoing': True, 'anchor': [359.5, 40.1, 187.1]},
            'bag': F.bag_of(row(ts(1), 'board-a-Comet', pos=(0, 0, 0))), 'script': None, 'box': F.stuck_box((359.3, 40.2, 187.4))}
    return F.make_scene(pick, F.Regions(d, 'board-a'), 'now', '2026-10-24')


def t_scene_make_and_validate(F):
    def go(d):
        s = scene_for(F, d)
        assert s['label'] == 'stuck:wet-under-ceiling' and s['oracle']['type'] == 'escape'
        assert F.scene_valid(json.loads(json.dumps(s)))
        assert any(c['is'] == 'copper_ore' for c in s['checks'])
    with_region(go)


def t_scene_tampered_raises(F):
    def go(d):
        s = json.loads(json.dumps(scene_for(F, d)))
        s['cells']['rle'][0] = (s['cells']['rle'][0] + 1) % len(s['cells']['palette'])
        raises(F.BlindInput, lambda: F.scene_valid(s), 'cells_sha256')
        s = json.loads(json.dumps(scene_for(F, d)))
        s['bot']['pos'] = [0, 0, 0]
        raises(F.BlindInput, lambda: F.scene_valid(s), 'outside')
        s = json.loads(json.dumps(scene_for(F, d)))
        s['checks'][0]['is'] = 'diamond_block'
        raises(F.BlindInput, lambda: F.scene_valid(s), 'disagrees')
        # a PROPERTY is part of the state (Codex r1 P2): the head's level-2 water checked as level 0 must disagree
        s = json.loads(json.dumps(scene_for(F, d)))
        k = next(i for i, c in enumerate(s['checks']) if c['is'] == 'water[level=2]')
        s['checks'][k]['is'] = 'water[level=0]'
        raises(F.BlindInput, lambda: F.scene_valid(s), 'disagrees')
    with_region(go)


def t_labels(F):
    def cells(feet, head, above, sides_head, floor='stone', around='stone'):
        c = {}
        for x in range(-6, 7):
            for y in range(-3, 6):
                for z in range(-6, 7):
                    c[(x, y, z)] = around
        c[(0, -1, 0)] = floor; c[(0, 0, 0)] = feet; c[(0, 1, 0)] = head; c[(0, 2, 0)] = above
        for (dx, dz), s in zip(((0, -1), (0, 1), (1, 0), (-1, 0)), sides_head):
            c[(dx, 1, dz)] = s
        return c
    assert F.stuck_label(F.site_facts(cells('water[level=0]', 'air', 'air', ['stone'] * 4), (0, 0, 0))) == 'stuck:water-pit'
    assert F.stuck_label(F.site_facts(cells('air', 'air', 'stone', ['stone'] * 4), (0, 0, 0))) == 'stuck:enclosed-dry'
    open_c = cells('air', 'air', 'air', ['air'] * 4, around='air')
    for x in range(-6, 7):
        for z in range(-6, 7):
            open_c[(x, -1, z)] = 'stone'
    assert F.stuck_label(F.site_facts(open_c, (0, 0, 0))) == 'stuck:open'


def t_fetch_refuses_mixed_generations(F):
    res = {'picks': [{'id': 'x', 'world': 'board-a', 'box': {'lo': [0, 0, 0], 'hi': [1, 1, 1]}}]}
    with tempfile.TemporaryDirectory() as d:
        F.fetch(res, d, req=lambda r: b'\x00' * 9000, generation='2026-10-24T03:16:17Z')
        raises(F.BlindInput, lambda: F.fetch(res, d, req=lambda r: b'\x00' * 9000, generation='2026-10-25T03:16:10Z'), 'another night')
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, 'board-a')); open(os.path.join(d, 'board-a', 'r.0.0.mca'), 'wb').write(b'\x00' * 9000)
        raises(F.BlindInput, lambda: F.fetch(res, d, req=lambda r: b'\x00' * 9000, generation='2026-10-24T03:16:17Z'), 'no GENERATION')


def t_regions_for_box(F):
    assert F.regions_for({'lo': [500, 0, -20], 'hi': [520, 10, 10]}) == [(0, -1), (0, 0), (1, -1), (1, 0)]


def t_fetch_refuses_short(F):
    res = {'picks': [{'id': 'x', 'world': 'board-a', 'box': {'lo': [0, 0, 0], 'hi': [1, 1, 1]}}]}
    G = '2026-10-24T03:16:17Z'
    with tempfile.TemporaryDirectory() as d:
        raises(F.BlindInput, lambda: F.fetch(res, d, req=lambda r: b'\x00' * 9000), 'generation')
        raises(F.BlindInput, lambda: F.fetch(res, d, req=lambda r: b'tiny', generation=G))
        asked = []
        got = F.fetch(res, d, req=lambda r: asked.append(r) or b'\x00' * 9000, generation=G)
        assert got and os.path.getsize(got[0]) == 9000 and asked == [f'region board-a 0 0 {G}'], asked


# ------------------------------------------------------------------ fmserve
SV_TESTS = []


def sv(fn):
    SV_TESTS.append(fn)
    return fn


@sv
def t_serve_backup_state(S):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'log')
        open(p, 'w').write('2026-10-23T03:15:02Z start 2026-10-23: 16 fleet worlds -> x\n2026-10-23T03:16:16Z good 2026-10-23: 16/16\n'
                           '2026-10-24T03:15:01Z start 2026-10-24: 16 fleet worlds -> x\n2026-10-24T03:15:30Z ok board-a: raw\n'
                           '2026-10-24T03:15:31Z good 2026-10-23: (a stray echo of the previous night)\n')
        assert S.backup_state(p) is None, 'a run in progress must not serve the previous night'
        open(p, 'a').write('2026-10-24T03:16:17Z good 2026-10-24: 16/16 worlds\n')
        assert S.backup_state(p) == ('2026-10-24', '2026-10-24T03:16:17Z')
        # ANY later start voids it, whatever world count it names (Codex r2 P1: it may be rewriting the same staging)
        open(p, 'a').write('2026-10-24T09:00:00Z start 2026-10-24: 1 fleet worlds -> elsewhere\n')
        assert S.backup_state(p) is None


@sv
def t_serve_refuses_everything_else(S):
    ok = lambda: ('2026-10-24', 'x')
    G = '2026-10-24T03:16:17Z'
    for bad in ('cat /etc/passwd', 'meta; id', 'region board-a 0', 'region ../board-a 0 0 ' + G, 'region board-a 0 0 x', 'region board-e 0 0 ' + G,
                'region board-a 1e3 0 ' + G, 'region board-a 0 0;id ' + G, 'region board-a 0 0', 'region board-a 0 0 ' + G + ' x', '', 'census x'):
        out = io.BytesIO()
        assert S.serve(bad, out=out, state_fn=ok, worlds_fn=lambda: ['board-a'], cat=lambda p: b'X' * 9000) == 2, bad
        assert out.getvalue() == b'', bad
    # a well-formed world name that is not in the staging is refused too
    assert S.serve('region hive-c 0 0 x', out=io.BytesIO(), state_fn=ok, worlds_fn=lambda: ['board-a'], cat=lambda p: b'X' * 9000) == 2
    assert S.serve('region hive-c 0 0 2026-10-24T03:16:17Z', out=io.BytesIO(), state_fn=lambda: ('2026-10-24', '2026-10-24T03:16:17Z'),
                   worlds_fn=lambda: ['board-a'], cat=lambda p: b'X' * 9000) == 2


@sv
def t_serve_junk_world_never_reaches_sudo(S):
    calls = []
    for bad in ('region ../../etc 0 0 2026-10-24T03:16:17Z', 'region board-a/../x 0 0 2026-10-24T03:16:17Z', 'region * 0 0 2026-10-24T03:16:17Z'):
        assert S.serve(bad, out=io.BytesIO(), state_fn=lambda: calls.append('state') or ('d', 't'),
                       worlds_fn=lambda: calls.append('ls') or ['board-a'], cat=lambda p: calls.append(p) or b'X') == 2
    assert calls == [], f'a junk world name ran {calls}'


@sv
def t_serve_region_and_busy(S):
    G = '2026-10-24T03:16:17Z'
    st = lambda: ('2026-10-24', G)
    out = io.BytesIO()
    seen = []
    assert S.serve(f'region board-a 0 -1 {G}', out=out, state_fn=st, worlds_fn=lambda: ['board-a'],
                   cat=lambda p: seen.append(p) or b'R' * 9000) == 0
    assert seen == ['/srv/world-backup/staging/board-a/world/region/r.0.-1.mca'] and len(out.getvalue()) == 9000
    out = io.BytesIO()
    assert S.serve(f'region board-a 0 0 {G}', out=out, state_fn=lambda: None, worlds_fn=lambda: ['board-a'], cat=lambda p: b'R') == 4
    assert out.getvalue() == b''
    assert S.serve('meta', out=io.BytesIO(), state_fn=lambda: None) == 4


@sv
def t_serve_region_bound_to_its_night(S):
    # Codex r1 P1: a region of another night, or one read while a backup began, writes NOTHING
    G = '2026-10-24T03:16:17Z'
    out = io.BytesIO()
    assert S.serve('region board-a 0 0 2026-10-23T03:16:16Z', out=out, state_fn=lambda: ('2026-10-24', G),
                   worlds_fn=lambda: ['board-a'], cat=lambda p: b'R' * 9000) == 4 and out.getvalue() == b''
    states = iter([('2026-10-24', G), None])          # good before the read, a new `start` after it
    out = io.BytesIO()
    assert S.serve(f'region board-a 0 0 {G}', out=out, state_fn=lambda: next(states),
                   worlds_fn=lambda: ['board-a'], cat=lambda p: b'R' * 9000) == 4 and out.getvalue() == b''


# ------------------------------------------------------------------ the runner and the mutants
FM_TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f) and f not in SV_TESTS]


def run(tests, mod, quiet=False):
    bad = []
    for n, f in tests:
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                f(mod)
            if not quiet:
                print(f'  PASS  {n[2:]}')
        except Exception as e:
            bad.append(n)
            if not quiet:
                print(f'  FAIL  {n[2:]}: {type(e).__name__}: {e}')
                traceback.print_exc(limit=3)
    return bad


# (file, anchor, replacement, the test that must turn red). Every anchor must be present EXACTLY ONCE (CLAUDE.md).
MUTANTS = [
    ('failmine.py', "    if not rows:\n        raise ZeroLooksWrong('0 death rows", "    if False:\n        raise ZeroLooksWrong('0 death rows", 't_death_points_empty_raises'),
    ('failmine.py', '    if nopos:\n', '    if False:\n', 't_death_points_missing_position_raises'),
    ('failmine.py', "        if n == 0:\n            raise ZeroLooksWrong('_death: 0", "        if False:\n            raise ZeroLooksWrong('_death: 0", 't_es_renamed_death_kind_far_raises'),
    ('failmine.py', "    if not boxes:\n        raise ZeroLooksWrong('0 position buckets", "    if False:\n        raise ZeroLooksWrong('0 position buckets", 't_es_renamed_position_field_raises'),
    ('failmine.py', '    if still > MAX_STILL_SHARE * len(boxes):', '    if False:', 't_es_frozen_positions_raise'),
    ('failmine.py', '    if active is not None and len(boxes) < MIN_POSITIONED_BOT_SHARE * active:', '    if False:', 't_es_positions_for_some_bots_raise'),
    ('failmine.py', '    if bots_present and len(seen & set(bots_present)) < MIN_POSITIONED_BOT_SHARE', '    if False and len(seen & set(bots_present)) < MIN_POSITIONED_BOT_SHARE', 't_check_boxes_guards'),
    ('failmine.py', '    for b in merge_boxes(boxes):\n        by[b[0]].append(b)', '    for b in boxes:\n        by[b[0]].append(b)', 't_spells_straddling_buckets_merge'),
    ('failmine.py', "        groups[(p['seed'], p['family'])].append(p)", "        groups[(0, p['family'])].append(p)", 't_link_seed_family_place'),
    ('failmine.py', "            raise BlindInput(f'{self.world} chunk ({cx},{cz}) has no section", "            return (['air'], None)\n            raise BlindInput(f'{self.world} chunk ({cx},{cz}) has no section", 't_region_missing_section_raises'),
    ('failmine.py', "        if status != 'full':", "        if False:", 't_region_not_full_raises'),
    ('failmine.py', "            if len(vals) < 4096 or max(vals) >= len(pal):", "            if len(vals) < 4096:", 't_region_palette_overflow_raises'),
    ('failmine.py', "and ms_of(r['@timestamp']) < t\n", "and ms_of(r['@timestamp']) <= t + 2000\n", 't_leadup_idle_takes_last_skill_before_death'),
    ('failmine.py', "    if s['cells_sha256'] != cells_sha(s['cells']):", "    if False:", 't_scene_tampered_raises'),
    ('failmine.py', "        if cells.get(tuple(c['at'])) != c['is']:", "        if bname(cells.get(tuple(c['at']))) != bname(c['is']):", 't_scene_tampered_raises'),
    ('failmine.py', "    if incomplete:\n", "    if False:\n", 't_es_missing_axis_raises'),
    ('failmine.py', "        if dat is None and len(pal) > 1:", "        if False:", 't_region_missing_data_raises'),
    ('failmine.py', "and s['t1'] == last_seen[s['bot']] and", "and", 't_spells_ongoing_and_clipped'),
    ('fmserve.py', "        if st[1] != parts[4]:", "        if False:", 't_serve_region_bound_to_its_night'),
    ('fmserve.py', "        if m:     # ANY start", "        if m and ' 16 ' in ln:     # ANY start", 't_serve_backup_state'),
    ('failmine.py', "    if expected is not None and len(rows) != expected:", "    if False:", 't_death_points_count_mismatch_raises'),
    ('failmine.py', "        if off == 0:\n", "        if False:\n", 't_region_absent_chunk_raises'),
    ('failmine.py', "            if not os.path.exists(p):\n                raise BlindInput(f'region copy missing", "            if False:\n                raise BlindInput(f'region copy missing", 't_region_missing_file_raises'),
    ('failmine.py', "    if not m1.get('backup_done') or k(m1) != k(m2):", "    if False:", 't_same_staging'),
    ('failmine.py', "        if m >= ADMIT_MIN_MATCHED and m / len(ps) >= ADMIT_MIN_RATE and not any(p.get('pass') for p in ps):", "        if m >= 1:", 't_reproducing_starts_rule'),
    ('failmine.py', "    if n < 2:", "    if False:", 't_spells_one_row_bucket_is_not_still'),
    ('failmine.py', "    if newest is not None and ms_of(src.until) - newest > INGEST_SLACK_MS:", "    if False:", 't_es_ingest_lag_raises'),
    ('failmine.py', "    if not inside(goal_of(pick.get('script'))):", "    if False:", 't_scene_goal_outside_cut'),
    ('failmine.py', "    if have and have != generation:", "    if False:", 't_fetch_refuses_mixed_generations'),
    ('fmserve.py', "        if state_fn() != st:\n            return 4                      # a backup began", "        if False:\n            return 4                      # a backup began", 't_serve_region_bound_to_its_night'),
    ('failmine.py', "    return (x1 - x0) <= STILL_BOX and (y1 - y0) <= STILL_BOX and (z1 - z0) <= STILL_BOX", "    return (x1 - x0) <= STILL_BOX or (y1 - y0) <= STILL_BOX", 't_spells_basic'),
    ('failmine.py', "    if sum(unk.values()) > MAX_UNCLASSIFIED_DEATH_SHARE * len(pts):", "    if False:", 't_death_points_format_change_raises'),
    ('fmserve.py', "        if m and m.group(2) == start[1]:", "        if m:", 't_serve_backup_state'),
    ('fmserve.py', "and WORLD_RE.match(parts[1]) and INT_RE.match(parts[2])", "and INT_RE.match(parts[2])", 't_serve_junk_world_never_reaches_sudo'),
    ('fmserve.py', "        if parts[1] not in (worlds_fn or worlds)():\n            return 2", "        pass", 't_serve_refuses_everything_else'),
]


def mutants():
    survived = []
    for fname, old, new, test in MUTANTS:
        src = open(os.path.join(HERE, fname)).read()
        n = src.count(old)
        assert n == 1, f'MUTANT ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE (%d)" % n} in {fname}: {old[:70]!r}'
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, fname)
            open(p, 'w').write(src.replace(old, new, 1))
            mod = load(p, 'mut_' + fname[:-3])
            tests = [(n_, f) for n_, f in (FM_TESTS if fname == 'failmine.py' else [(f.__name__, f) for f in SV_TESTS]) if n_ == test]
            assert tests, f'no test named {test}'
            red = run(tests, mod, quiet=True)
            print(f'  {"KILLED  " if red else "SURVIVED"} {fname}: {old.strip()[:60]!r} -> {test}')
            if not red:
                survived.append((fname, old, test))
    return survived


def main():
    F = load(FM_PATH, 'failmine_under_test')
    S = load(SV_PATH, 'fmserve_under_test')
    print('failmine.py')
    bad = run(FM_TESTS, F)
    print('fmserve.py')
    bad += run([(f.__name__, f) for f in SV_TESTS], S)
    total = len(FM_TESTS) + len(SV_TESTS)
    print(f'{total - len(bad)} of {total} passed')
    if bad:
        return 1
    if '--no-mutants' in sys.argv:
        return 0
    print('mutants')
    surv = mutants()
    print(f'{len(MUTANTS) - len(surv)} of {len(MUTANTS)} mutants killed')
    return 1 if surv else 0


if __name__ == '__main__':
    sys.exit(main())
