#!/usr/bin/env python3
"""Tests for groundledger.py: behaviour on small made-up columns, then mutants that each test must kill.

    python3 scripts/host/test_groundledger.py
"""
import importlib.util
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'groundledger.py')


def load(src_text=None):
    """groundledger as a module, from the file or from a (mutated) source text."""
    if src_text is None:
        spec = importlib.util.spec_from_file_location('groundledger_t', SRC)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    m = types.ModuleType('groundledger_mut')
    m.__file__ = SRC
    exec(compile(src_text, SRC, 'exec'), m.__dict__)
    return m


def ground(top=70, lo=50, name='stone', cap='grass_block'):
    """A natural column: `name` from lo to top-1, `cap` at top."""
    c = {y: name for y in range(lo, top)}
    c[top] = cap
    return c


LO, HI = 50, 100
TESTS = []


def t(fn):
    TESTS.append(fn)
    return fn


def cls(G, base, live, owned=frozenset(), mine_depth=8):
    return G.classify_column(base, live, LO, HI, owned, mine_depth)


@t
def an_untouched_column_is_natural(G):
    b = ground()
    assert cls(G, b, dict(b))['cls'] == 'natural'
    # grass turning to dirt or to a path, a flower growing, a tree felled: none of it is a change to the ground
    live = dict(b); live[70] = 'dirt_path'; live[71] = 'poppy'
    c = cls(G, b, live)
    assert c['cls'] == 'natural' and not c['placed'] and not c['dug'], c
    tree = dict(b); tree.update({71: 'oak_log', 72: 'oak_log', 73: 'oak_leaves'})
    assert cls(G, tree, dict(b))['cls'] == 'natural'


@t
def ownership_is_not_read_from_the_material(G):
    # dirt that was always there is natural; the SAME dirt placed on top is the bots', whatever it is made of
    b = ground(cap='dirt')
    assert cls(G, b, dict(b))['cls'] == 'natural'
    live = dict(b); live[71] = 'dirt'
    c = cls(G, b, live)
    assert c['cls'] == 'raised' and c['placed'] == [71], c
    live2 = dict(b); live2[71] = 'stone'               # natural-looking stone, placed all the same
    assert cls(G, b, live2)['cls'] == 'raised'


@t
def a_pillar_is_two_or_more_placed_blocks_standing_on_the_ground(G):
    b = ground()
    live = dict(b); live.update({71: 'dirt', 72: 'dirt', 73: 'cobblestone'})
    c = cls(G, b, live)
    assert c['cls'] == 'pillar' and c['placed'] == [71, 72, 73] and c['gap'] == 0, c
    one = dict(b); one[71] = 'cobblestone'
    assert cls(G, b, one)['cls'] == 'raised'


@t
def a_pit_is_dug_from_the_top_and_open_to_the_sky(G):
    b = ground()
    live = dict(b); del live[70]; del live[69]
    c = cls(G, b, live)
    assert c['cls'] == 'pit' and c['dug'] == [69, 70] and c['hb'] == 70 and c['hl'] == 68, c


@t
def a_deck_over_a_gap_is_seen_though_its_top_looks_like_ground(G):
    # the showcase lawn: natural ground at 65, air at 66-67, a grass block at 68. The old code read 68 as level ground.
    b = ground(top=65)
    live = dict(b); live[68] = 'grass_block'
    c = cls(G, b, live)
    assert c['cls'] == 'over_gap' and c['gap'] == 2 and c['hl'] == 68 and c['hb'] == 65, c


@t
def ground_dug_out_under_a_roof_is_undermined(G):
    b = ground()
    live = dict(b); del live[68]; del live[67]         # the top two blocks stay, a hollow under them
    c = cls(G, b, live)
    assert c['cls'] == 'undermined' and c['dug'] == [67, 68], c
    # the same hollow with the roof gone as well is a pit, not undermined
    live2 = dict(live); del live2[70]; del live2[69]
    assert cls(G, b, live2)['cls'] == 'pit'


@t
def mining_far_under_the_surface_is_not_a_hole_in_the_lawn(G):
    b = ground()
    live = dict(b); del live[55]; del live[54]         # 15 under the surface
    c = cls(G, b, live)
    assert c['cls'] == 'natural' and c['mined'] == 2 and c['dug'] == [], c
    assert cls(G, b, live, mine_depth=20)['cls'] == 'undermined'      # the depth is the caller's choice


@t
def a_build_record_owns_its_cells(G):
    b = ground()
    live = dict(b); live.update({71: 'cobblestone', 72: 'cobblestone'})
    assert cls(G, b, live)['cls'] == 'pillar'
    assert cls(G, b, live, owned=frozenset({71}))['cls'] == 'build'


@t
def a_torch_or_a_table_is_a_thing_not_ground(G):
    b = ground()
    live = dict(b); live[71] = 'torch'
    c = cls(G, b, live)
    assert c['cls'] == 'natural' and c['things'] == [71] and c['hl'] == 70, c
    live2 = dict(b); live2[71] = 'crafting_table'
    c2 = cls(G, b, live2)
    assert c2['cls'] == 'natural' and c2['things'] == [71]
    assert cls(G, b, live2, owned=frozenset({71}))['things'] == []     # a table a record owns is not loose


@t
def a_natural_hollow_filled_in_is_filled(G):
    b = ground(); del b[66]                             # a natural air pocket under the surface
    live = dict(b); live[66] = 'dirt'
    c = cls(G, b, live)
    assert c['cls'] == 'filled' and c['placed'] == [66], c


@t
def a_stone_for_cobblestone_swap_is_changed(G):
    b = ground()
    live = dict(b); live[69] = 'cobblestone'
    assert cls(G, b, live)['cls'] == 'changed'


@t
def the_ledger_counts_columns_by_ring_and_the_control_is_all_natural(G):
    base = {(x, z): ground() for x in range(-4, 5) for z in range(-4, 5)}
    s, rows = G.ledger(base, {k: dict(v) for k, v in base.items()}, 0, 0, 4, LO, HI, rings=(2,))
    assert rows == [] and s['columns']['4'] == {'natural': 81, 'total': 81} and s['columns']['2']['natural'] == 25, s['columns']
    live = {k: dict(v) for k, v in base.items()}
    live[(0, 0)].update({71: 'dirt', 72: 'dirt'})       # a pillar at the centre
    del live[(4, 4)][70]                                # a pit at the corner, outside the inner ring
    live[(1, 0)][73] = 'dirt'                           # a floating block
    s, rows = G.ledger(base, live, 0, 0, 4, LO, HI, rings=(2,))
    assert s['columns']['2'].get('pillar') == 1 and s['columns']['2'].get('pit') is None and s['columns']['4'].get('pit') == 1, s['columns']
    assert s['columns']['2'].get('over_gap') == 1 and s['cells']['gap_air'] == 2 and s['cells']['placed'] == 3, s
    assert sorted(r[2] for r in rows) == ['over_gap', 'pillar', 'pit'], rows
    assert dict(s['placed_names']) == {'dirt': 3} and dict(s['dug_names']) == {'grass_block': 1}, s


@t
def the_whole_map_skips_chunks_never_saved_again_and_bands_by_distance(G):
    assert [G.band_of(d) for d in (0, 64, 65, 128, 300, 1000)] == [64, 64, 128, 128, 512, 1024]
    assert G.band_of(10 ** 7) == 10 ** 9

    class RD:                                           # two saves of three chunks; only chunk (1, 0) was saved again
        calls = []

        @staticmethod
        def dump(d, x0, x1, z0, z1, y0, y1):
            RD.calls.append((d, x0 >> 4, z0 >> 4))
            names = ['stone', 'grass_block', 'dirt']
            cells = [[x, y, z, 0 if y < 70 else 1] for x in range(x0, x1 + 1) for z in range(z0, z1 + 1) for y in range(60, 71)]
            if d == 'live' and (x0 >> 4, z0 >> 4) == (1, 0):
                cells += [[x0, 71, z0, 2], [x0, 72, z0, 2]]              # a dirt pillar at the chunk's corner
            return {'palette': [{'name': n} for n in names], 'cells': cells, 'missing_chunks': 0, 'chunks': 1}
    stamps = {'base': {(0, 0): 5, (1, 0): 5, (9, 9): 5}, 'live': {(0, 0): 5, (1, 0): 6, (9, 9): 5}}
    real = G.chunk_stamps
    G.chunk_stamps = lambda d: stamps[d]
    try:
        s, rows = G.whole_map(RD, 'base', 'live', 0, 0, y_lo=60, y_hi=80)
        assert s['chunks_shared'] == 3 and s['chunks_saved_again'] == 1 and s['chunks_read'] == 1, s
        assert {c[1:] for c in RD.calls} == {(1, 0)}, RD.calls          # the untouched chunks were never read
        assert s['columns_by_band']['64'] == {'pillar': 1, 'natural': 255} and rows == [[1, 0, 24, {'pillar': 1}]], (s, rows)
        RD.calls.clear()
        s2, _ = G.whole_map(RD, 'base', 'live', 0, 0, y_lo=60, y_hi=80, same_copy=False)   # a regenerated base: every chunk is read
        assert s2['chunks_read'] == 3 and s2['chunks_saved_again'] is None, s2
    finally:
        G.chunk_stamps = real


MUTANTS = [
    ("    if base == live:\n        return None", "    if False:\n        return None", an_untouched_column_is_natural),
    ("        return 'soil' if base in SOIL and live in SOIL else 'replaced'", "        return 'replaced'", an_untouched_column_is_natural),
    ("    if gl == SOLID:\n        return 'placed'", "    if gl == SOLID and live not in SOIL:\n        return 'placed'", ownership_is_not_read_from_the_material),
    ("            out['cls'] = 'pillar' if len(above) >= 2 else 'raised' if above else 'filled'", "            out['cls'] = 'raised' if above else 'filled'", a_pillar_is_two_or_more_placed_blocks_standing_on_the_ground),
    ("        unsupported = [y for y in placed if y > y_lo and not solid_live(y - 1)]", "        unsupported = []", a_deck_over_a_gap_is_seen_though_its_top_looks_like_ground),
    ("            while y0 - 1 - g >= y_lo and not solid_live(y0 - 1 - g):\n                g += 1", "            g = 1", a_deck_over_a_gap_is_seen_though_its_top_looks_like_ground),
    ("    elif any(not solid_live(y) and any(solid_live(u) for u in range(y + 1, y_hi + 1)) for y in dug):", "    elif False:", ground_dug_out_under_a_roof_is_undermined),
    ("            if y >= floor:\n                dug.append(y)", "            if True:\n                dug.append(y)", mining_far_under_the_surface_is_not_a_hole_in_the_lawn),
    ("    elif any(y in owned for y in placed + dug + replaced):", "    elif False:", a_build_record_owns_its_cells),
    ("    if THING_RE.search(name):\n        return THING", "    if False:\n        return THING", a_torch_or_a_table_is_a_thing_not_ground),
    ("                if d <= r:", "                if True:", the_ledger_counts_columns_by_ring_and_the_control_is_all_natural),
    ("    todo = [c for c in shared if not same_copy or bs[c] != ls[c]]", "    todo = list(shared)", the_whole_map_skips_chunks_never_saved_again_and_bands_by_distance),
]


def mutants_are_killed(_G):
    src = open(SRC).read()
    alive = []
    for old, new, test in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r' % old[:70]
        M = load(src.replace(old, new))
        try:
            test(M)
            alive.append(old[:70])
        except AssertionError:
            pass
    assert not alive, 'mutants survived: %s' % alive


def main():
    G = load()
    ok = 0
    for fn in TESTS + [mutants_are_killed]:
        try:
            fn(G); print('  PASS ', fn.__name__); ok += 1
        except Exception as e:                      # noqa: BLE001
            print('  FAIL ', fn.__name__, repr(e)[:400])
    n = len(TESTS) + 1
    print('%d passed, %d failed' % (ok, n - ok))
    return 0 if ok == n else 1


if __name__ == '__main__':
    sys.exit(main())
