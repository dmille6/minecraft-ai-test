#!/usr/bin/env python3
"""lavamap_publish.py: behaviour tests and anchored source mutants. Run by bots/test/lavamap-publish.test.mjs (npm test).

Every mutant asserts its anchor is present and unique before it is applied; a mutant that does not apply raises
ANCHOR, never "killed".
"""
import json, os, shutil, sys, tempfile, time, types

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'lavamap_publish.py')
NOW = 1792843200.0   # 2026-10-24T12:00:00Z


def load(src=None):
    src = open(SRC).read() if src is None else src
    mod = types.ModuleType('lavamap_publish_under_test')
    exec(compile(src, SRC, 'exec'), mod.__dict__)
    return mod


def hz(kind, cells=(), deaths=(), total=0, exists=None):
    return {'kind': kind, 'sightings': {'cells': [list(c) for c in cells]}, 'deaths': {'total': total, 'cells': [list(c) for c in deaths]},
            'exists': {'by_world': exists or {}}}


def MAP(**o):
    m = {'schema': 'mcai.hazardmap', 'schema_version': 1, 'generated_at': '2026-10-24T08:56:43Z',
         'stale_after': '2026-10-25T20:56:43Z',
         'seeds': {'1239381899': {'worlds': {'board-a': {}, 'board-d': {}},
                                  'hazards': [hz('lava', [(396, 69, 109, 50), (397, 69, 109, 900)], [(395, 70, 108)], total=188),
                                              hz('lava', [(10, 60, 10, 5)], total=0, exists={'board-d': {'state': 'absent'}}),
                                              hz('drowning', [], [(356, 60, 178)], total=132)]},
                   '4534598234323719516': {'worlds': {'hive-d': {}}, 'hazards': [hz('lava', [(45, 61, 40, 3)], total=6)]}}}
    m.update(o)
    return m


CASES, FAILS = [], []


def case(fn):
    CASES.append(fn)
    return fn


def root_with(*worlds):
    d = tempfile.mkdtemp(prefix='lavamap-')
    for w in worlds:
        os.mkdir(os.path.join(d, '_pool-' + w))
    return d


@case
def per_world_view_filters_absent_and_ranks_sightings_first(L):
    seed, cells = L.world_view(MAP(), 'board-a')
    assert seed == '1239381899'
    assert cells == [[397, 69, 109], [396, 69, 109], [10, 60, 10], [395, 70, 108]], cells
    seed, cells = L.world_view(MAP(), 'board-d')
    assert [10, 60, 10] not in cells, 'absent in board-d: not delivered there'
    assert L.world_view(MAP(), 'nowhere') == (None, [])


@case
def only_lava_is_delivered(L):
    _, cells = L.world_view(MAP(), 'board-a')
    assert [356, 60, 178] not in cells, 'drowning is not delivered (design r2 2.2)'


@case
def the_cap_holds(L):
    many = [(i, 60, 0, 1) for i in range(L.MAX_CELLS + 50)]
    m = MAP(seeds={'1': {'worlds': {'w': {}}, 'hazards': [hz('lava', many, total=1)]}})
    assert len(L.world_view(m, 'w')[1]) == L.MAX_CELLS


@case
def a_stale_or_foreign_map_writes_nothing(L):
    root = root_with('board-a')
    p = os.path.join(root, 'map.json')
    for bad in (MAP(stale_after='2026-10-24T11:00:00Z'), MAP(schema='x'), MAP(schema_version=2), MAP(seeds={'abc': {}}), MAP(seeds={})):
        json.dump(bad, open(p, 'w'))
        try:
            L.publish(p, root, now=NOW, euid=1000)
            raise AssertionError('published from %r' % {k: bad[k] for k in ('schema', 'schema_version', 'stale_after')})
        except L.Refuse:
            pass
        assert not os.path.exists(os.path.join(root, '_pool-board-a', L.FILE))
    shutil.rmtree(root)


@case
def publishes_atomically_only_into_existing_dirs_and_is_idempotent(L):
    root = root_with('board-a', 'hive-d')
    p = os.path.join(root, 'map.json')
    json.dump(MAP(), open(p, 'w'))
    r = L.publish(p, root, now=NOW, euid=1000)
    assert r['status'] == 'ok' and sorted(r['written']) == ['board-a', 'hive-d'], r
    assert r['skipped'] == {'board-d': 'no pool dir'}, r['skipped']
    assert not os.path.exists(os.path.join(root, '_pool-board-d')), 'never creates a directory'
    f = json.load(open(os.path.join(root, '_pool-board-a', L.FILE)))
    assert f['schema'] == 'mcai.lavamap' and f['seed'] == '1239381899' and f['world'] == 'board-a'
    assert isinstance(f['seed'], str), 'seeds are strings (64-bit seeds exceed a JS number)'
    assert f['stale_after'] == '2026-10-25T20:56:43Z'
    r2 = L.publish(p, root, now=NOW + 3600, euid=1000)
    assert r2['written'] == [] and sorted(r2['same']) == ['board-a', 'hive-d'], 'a re-run of the same map is byte-identical'
    assert not [n for n in os.listdir(os.path.join(root, '_pool-board-a')) if n.endswith('.tmp')], 'no temp left behind'
    shutil.rmtree(root)


@case
def never_through_a_symlink_never_as_root(L):
    root = root_with('board-a')
    real = tempfile.mkdtemp(prefix='lavamap-real-')
    os.symlink(real, os.path.join(root, '_pool-hive-d'))
    p = os.path.join(root, 'map.json')
    json.dump(MAP(), open(p, 'w'))
    r = L.publish(p, root, now=NOW, euid=1000)
    assert r['skipped'].get('hive-d') == 'pool dir is a symlink', r
    assert os.listdir(real) == []
    try:
        L.publish(p, root, now=NOW, euid=0)
        raise AssertionError('ran as root')
    except L.Refuse:
        pass
    shutil.rmtree(root)
    shutil.rmtree(real)


@case
def waits_for_a_good_refresh_of_this_map(L):
    root = root_with('board-a')
    p, hbp = os.path.join(root, 'map.json'), os.path.join(root, 'hb.json')
    json.dump(MAP(), open(p, 'w'))
    for hb in ({'status': 'gate_failed', 'at': '2026-10-24T08:56:43Z'}, {'status': 'ok', 'at': '2026-10-23T08:56:43Z'}, None):
        if hb is None:
            if os.path.exists(hbp):
                os.unlink(hbp)
        else:
            json.dump(hb, open(hbp, 'w'))
        r = L.publish(p, root, hazard_heartbeat=hbp, now=NOW, euid=1000)
        assert r['status'] == 'waiting' and r['written'] == [], (hb, r)
    json.dump({'status': 'ok', 'at': '2026-10-24T08:56:43Z'}, open(hbp, 'w'))
    r = L.publish(p, root, hazard_heartbeat=hbp, now=NOW, euid=1000)
    assert r['status'] == 'ok' and r['written'] == ['board-a'], r
    shutil.rmtree(root)


@case
def check_alarms_on_absent_or_stale_and_skips_retired_dirs(L):
    root = root_with('board-a', 'hive-d', 'self-isolated-a-Alpha', 'placebo-a.pre-reseed-20260918T235209Z')
    p = os.path.join(root, 'map.json')
    json.dump(MAP(), open(p, 'w'))
    L.publish(p, root, now=NOW, euid=1000)
    ok, line = L.check(root, now=NOW)
    assert ok and line == 'lavamap OK: 2 pool files inside stale_after', line
    ok, line = L.check(root, now=L.parse_iso('2026-10-26T00:00:00Z'))
    assert not ok and 'board-a:stale' in line, line
    os.mkdir(os.path.join(root, '_pool-board-c'))
    ok, line = L.check(root, now=NOW)
    assert not ok and 'board-c:absent' in line, line
    shutil.rmtree(root)


MUTANTS = [
    ('the absent filter', "            if h.get('kind') != 'lava' or _state(h, world) == 'absent':",
     "            if h.get('kind') != 'lava':", per_world_view_filters_absent_and_ranks_sightings_first),
    ('sightings first', "        for _, _, x, y, z in sorted(sight) + sorted(death):",
     "        for _, _, x, y, z in sorted(death) + sorted(sight):", per_world_view_filters_absent_and_ranks_sightings_first),
    ('the stale refusal', "    if now > stale:\n        raise Refuse", "    if False:\n        raise Refuse", a_stale_or_foreign_map_writes_nothing),
    ('the root refusal', "    if (os.geteuid() if euid is None else euid) == 0:", "    if False:", never_through_a_symlink_never_as_root),
    ('the symlink refusal', "        if os.path.islink(d):\n            out.append((w, d, None, 'pool dir is a symlink'))",
     "        if False:\n            out.append((w, d, None, 'pool dir is a symlink'))", never_through_a_symlink_never_as_root),
    ('the dir must exist', "        if not os.path.isdir(d):\n            out.append((w, d, None, 'no pool dir'))",
     "        if not os.path.isdir(d):\n            os.makedirs(d)", publishes_atomically_only_into_existing_dirs_and_is_idempotent),
    ('the refresh trigger', "    if hb.get('status') != 'ok':", "    if False:", waits_for_a_good_refresh_of_this_map),
    ('this map, not another', "        if abs(parse_iso(hb['at']) - parse_iso(m['generated_at'])) > 120:", "        if False:",
     waits_for_a_good_refresh_of_this_map),
    ('the cap', "            if len(cells) >= MAX_CELLS:\n                break", "            if False:\n                break", the_cap_holds),
    ('seed as string', "    return {'schema': SCHEMA, 'schema_version': VERSION, 'world': world, 'seed': seed,",
     "    return {'schema': SCHEMA, 'schema_version': VERSION, 'world': world, 'seed': int(seed),",
     publishes_atomically_only_into_existing_dirs_and_is_idempotent),
    ('check staleness', "            if now > parse_iso(d['stale_after']):", "            if False:", check_alarms_on_absent_or_stale_and_skips_retired_dirs),
]


def main():
    L = load()
    passed = 0
    for fn in CASES:
        try:
            fn(L)
            passed += 1
            print('  PASS  %s' % fn.__name__)
        except Exception as e:
            FAILS.append(fn.__name__)
            print('  FAIL  %s: %r' % (fn.__name__, e))
    print('%d of %d passed' % (passed, len(CASES)))
    src = open(SRC).read()
    killed = 0
    for name, old, new, fn in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %s (%d)' % (name, src.count(old))
        M = load(src.replace(old, new, 1))
        try:
            fn(M)
            print('  SURVIVED  %s' % name)
        except Exception:
            killed += 1
            print('  killed    %s' % name)
    print('%d of %d mutants killed' % (killed, len(MUTANTS)))
    return 0 if not FAILS and killed == len(MUTANTS) else 1


if __name__ == '__main__':
    sys.exit(main())
