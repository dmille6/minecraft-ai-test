#!/usr/bin/env python3
"""Tests for groundplan.py: behaviour on small made-up columns for every rule, a control, then anchored mutants that a
test must kill.

    python3 scripts/host/test_groundplan.py
"""
import importlib.util
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'groundplan.py')
sys.path.insert(0, HERE)


def load(src_text=None):
    """groundplan as a module, from the file or from a (mutated) source text."""
    if src_text is None:
        spec = importlib.util.spec_from_file_location('groundplan_t', SRC)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    m = types.ModuleType('groundplan_mut')
    m.__file__ = SRC
    exec(compile(src_text, SRC, 'exec'), m.__dict__)
    return m


def ground(top=70, lo=50, name='stone', cap='grass_block', dirt=3):
    """A natural column: `name` from lo up, `dirt` layers of dirt, `cap` at top."""
    c = {y: name for y in range(lo, top - dirt)}
    c.update({y: 'dirt' for y in range(top - dirt, top)})
    c[top] = cap
    return c


def dig(col, *ys):
    c = dict(col)
    for y in ys:
        c.pop(y, None)
    return c


LO, HI = 50, 100
TESTS = []


def t(fn):
    TESTS.append(fn)
    return fn


def pc(P, base, live, owned=frozenset(), mine_depth=8):
    return P.plan_column(base, live, LO, HI, owned, mine_depth)


def world(n=4, **kw):
    return {(x, z): ground(**kw) for x in range(-n, n + 1) for z in range(-n, n + 1)}


def copy(w):
    return {k: dict(v) for k, v in w.items()}


def run(P, base, live, n=4, own=None, **kw):
    return P.plan(base, live, 0, 0, n, LO, HI, own, **kw)


@t
def an_undermined_column_gets_cobblestone_and_one_dirt_layer_under_the_surviving_surface(P):
    b = ground()
    for depth, want in ((1, [(69, 'dirt')]),
                        (2, [(68, 'cobblestone'), (69, 'dirt')]),
                        (3, [(67, 'cobblestone'), (68, 'cobblestone'), (69, 'dirt')])):
        c = pc(P, b, dig(b, *range(70 - depth, 70)))
        assert c['cls'] == 'undermined' and c['fills'] == want, (depth, c)
    # a hollow NOT directly under the surface (69 still there): all cobblestone, no dirt
    c = pc(P, b, dig(b, 66, 67))
    assert c['cls'] == 'undermined' and c['fills'] == [(66, 'cobblestone'), (67, 'cobblestone')], c


@t
def an_open_pit_is_cobblestone_to_one_under_the_surface_and_dirt_at_the_surface(P):
    b = ground()
    c = pc(P, b, dig(b, 67, 68, 69, 70))
    assert c['cls'] == 'pit', c
    assert c['fills'] == [(67, 'cobblestone'), (68, 'cobblestone'), (69, 'cobblestone'), (70, 'dirt')], c
    one = pc(P, b, dig(b, 70))                         # the grass block alone taken: dirt goes back at 70
    assert one['fills'] == [(70, 'dirt')], one


@t
def a_pit_whose_bottom_is_water_leaves_the_wet_cells_out(P):
    b = ground()
    live = dig(b, 67, 68, 69, 70)
    live[67] = 'water'; live[68] = 'water'
    c = pc(P, b, live)
    assert c['cls'] == 'pit' and c['wet'] == [67, 68], c
    assert c['fills'] == [(69, 'cobblestone'), (70, 'dirt')], c
    p = run(P, world(1), {**copy(world(1)), (0, 0): live}, n=1)
    s = p['summary']
    assert s['wet_cells'] == 2 and s['wet'] == {'water': 2} and s['fill_cells'] == 2, s
    assert s['fill_columns_whose_lowest_fill_has_water_or_lava_under_it'] == 1, s
    assert all(c[1] not in (67, 68) for j in p['jobs'] for c in j['cells']), p['jobs']


@t
def a_pillar_is_cut_top_down_and_a_raised_block_and_a_deck_are_cut_too(P):
    b = ground()
    live = dict(b); live.update({71: 'dirt', 72: 'cobblestone', 73: 'dirt'})
    c = pc(P, b, live)
    assert c['cls'] == 'pillar' and c['cuts'] == [(73, 'dirt'), (72, 'cobblestone'), (71, 'dirt')] and c['fills'] == [], c
    r = dict(b); r[71] = 'cobblestone'
    assert pc(P, b, r)['cuts'] == [(71, 'cobblestone')]
    deck = dict(b); deck[74] = 'dirt'                  # floating, three air under it
    c = pc(P, b, deck)
    assert c['cls'] == 'over_gap' and c['cuts'] == [(74, 'dirt')], c
    # in a job, two pillars in one tile: every top before anything under it
    base = world(1)
    live = copy(base)
    live[(0, 0)].update({71: 'dirt', 72: 'dirt', 73: 'dirt'})
    live[(1, 0)].update({71: 'cobblestone', 72: 'cobblestone'})
    p = run(P, base, live, n=1)
    cj = [j for j in p['jobs'] if j['kind'] == 'cut']
    assert len(cj) == 1 and cj[0]['of'] == 'pillar' and [c[1] for c in cj[0]['cells']] == [73, 72, 72, 71, 71], cj
    assert cj[0]['counts'] == {'dirt': 3, 'cobblestone': 2} and p['summary']['cut_by_class'] == {'pillar': 5}, p['summary']


@t
def an_owned_cell_is_never_planned(P):
    base = world(1)
    live = copy(base)
    live[(0, 0)] = dig(base[(0, 0)], 69, 70)           # a pit a record owns (a dug cell in its plan)
    live[(1, 0)] = dig(base[(1, 0)], 69, 70)           # the same pit, owned by no one: the positive control
    p = run(P, base, live, n=1, own={(0, 0): {69: 'cellar'}})
    planned = {(c[0], c[2]) for j in p['jobs'] for c in j['cells']}
    assert (0, 0) not in planned and (1, 0) in planned, planned
    assert p['summary']['columns'].get('build') == 1 and p['summary']['fill_cells'] == 2, p['summary']


@t
def a_build_column_is_untouched_whatever_else_is_in_it(P):
    b = ground()
    live = dig(b, 66, 67)                              # a hollow no one owns ...
    live.update({71: 'oak_planks', 72: 'oak_planks', 73: 'torch'})   # ... under a wall a record owns
    c = pc(P, b, live, owned=frozenset({71, 72, 73}))
    assert c['cls'] == 'build' and c['fills'] == [] and c['cuts'] == [] and c['things'] == [], c
    assert c['left']['in_build_columns'] == 4, c['left']


@t
def a_filled_column_is_left_alone(P):
    b = dig(ground(), 65)                              # a natural air pocket under the surface
    live = dict(b); live[65] = 'dirt'                  # a bot filled it
    c = pc(P, b, live)
    assert c['cls'] == 'filled' and c['fills'] == [] and c['cuts'] == [], c
    # with the grass block over it taken as well, the column is still `filled` (first match): left alone, counted apart
    c = pc(P, b, dig(live, 70))
    assert c['cls'] == 'filled' and c['fills'] == [] and c['left']['dug_in_filled'] == 1, c


@t
def a_chest_is_picked_up_flagged_to_be_emptied_and_a_table_is_not(P):
    base = world(1)
    live = copy(base)
    live[(0, 0)][71] = 'chest'
    live[(1, 1)][71] = 'crafting_table'
    live[(-1, 0)] = dig(base[(-1, 0)], 69, 70); live[(-1, 0)][69] = 'torch'   # a torch standing in a pit
    p = run(P, base, live, n=1)
    got = {tuple(t['at']): (t['block'], t['has_inventory'], t['in_fill_cell']) for t in p['pickups']}
    assert got == {(0, 71, 0): ('chest', True, False), (1, 71, 1): ('crafting_table', False, False),
                   (-1, 69, 0): ('torch', False, True)}, got
    assert p['summary']['pickup_with_inventory'] == 1 and p['summary']['jobs'].get('pickup') == 2, p['summary']   # two tiles: x -6..-1 and 0..5
    assert P.has_inventory('trapped_chest') and P.has_inventory('barrel') and not P.has_inventory('oak_sign')


@t
def deep_mining_is_not_repaired(P):
    b = ground()
    live = dig(b, 54, 55)                              # 15 under the surface
    c = pc(P, b, live)
    assert c['fills'] == [] and c['left']['mined_below'] == 2, c
    assert pc(P, b, live, mine_depth=20)['fills'] == [(54, 'cobblestone'), (55, 'cobblestone')]   # the caller's choice


@t
def a_job_holds_at_most_24_cells_lowest_first_and_bottom_up(P):
    base = world(2)                                    # one 6x6 tile holds x, z in 0..5; use the 3x3 at 0..2
    live = copy(base)
    for x in range(3):
        for z in range(3):
            live[(x, z)] = dig(base[(x, z)], 67, 68, 69, 70)       # 9 pits of 4: 36 cells in one tile
    p = run(P, base, live, n=2)
    fj = [j for j in p['jobs'] if j['kind'] == 'fill']
    assert [len(j['cells']) for j in fj] == [24, 12], [len(j['cells']) for j in fj]
    assert [j['part'] for j in fj] == [1, 2] and fj[0]['parts'] == 2 and fj[0]['tile'] == [0, 0, 5, 5], fj
    ys = [c[1] for j in fj for c in j['cells']]
    assert ys == sorted(ys), ys                        # the lower part first, bottom-up within each
    assert fj[0]['counts'] == {'cobblestone': 24} and fj[1]['counts'] == {'cobblestone': 3, 'dirt': 9}, fj
    assert P.order_ok(p['jobs'])
    # the checker itself: a cell before the one under it is refused
    bad = [{'kind': 'fill', 'cells': [[0, 70, 0, 'dirt'], [0, 69, 0, 'cobblestone']]}]
    assert not P.order_ok(bad)
    assert not P.order_ok([{'kind': 'cut', 'cells': [[0, 71, 0, 'dirt'], [0, 72, 0, 'dirt']]}])


@t
def jobs_are_ordered_pillar_cuts_then_other_cuts_then_pickups_then_fills_nearest_first(P):
    base = world(12)
    live = copy(base)
    live[(9, 9)].update({71: 'dirt', 72: 'dirt'})     # a far pillar
    live[(1, 1)][71] = 'dirt'                          # a near raised block
    live[(2, 2)][71] = 'crafting_table'
    live[(10, 10)] = dig(base[(10, 10)], 70)           # a far pit
    live[(0, 1)] = dig(base[(0, 1)], 70)               # a near pit
    live[(-7, 0)] = dig(base[(-7, 0)], 70)             # a middling pit
    p = run(P, base, live, n=12)
    order = [(j['kind'], j['of'], j['tile'][:2]) for j in p['jobs']]
    assert order == [('cut', 'pillar', [6, 6]), ('cut', None, [0, 0]), ('pickup', None, [0, 0]),
                     ('fill', None, [0, 0]), ('fill', None, [6, 6]), ('fill', None, [-12, 0])], order
    d = [j['distance'] for j in p['jobs'] if j['kind'] == 'fill']
    assert d == sorted(d), d
    assert p['summary']['jobs'] == {'cut': 2, 'pickup': 1, 'fill': 3, 'cut_pillar': 1, 'total': 6}, p['summary']['jobs']


@t
def the_control_an_untouched_world_gives_an_empty_plan(P):
    base = world(3)
    p = run(P, base, copy(base), n=3)
    assert P.is_empty(p) and p['summary']['columns'] == {'natural': 49, 'total': 49}, p['summary']
    # and the same check is not blind: one pit makes it non-empty
    live = copy(base); live[(0, 0)] = dig(base[(0, 0)], 70)
    p2 = run(P, base, live, n=3)
    assert not P.is_empty(p2) and p2['summary']['fill'] == {'dirt': 1}, p2['summary']


MUTANTS = [
    ("    return [(y, 'dirt' if y == cap else 'cobblestone') for y in sorted(dug)]",
     "    return [(y, 'cobblestone') for y in sorted(dug)]",
     an_undermined_column_gets_cobblestone_and_one_dirt_layer_under_the_surviving_surface),
    ("    cap = hb - 1 if surface_stays else hb", "    cap = hb - 1",
     an_open_pit_is_cobblestone_to_one_under_the_surface_and_dirt_at_the_surface),
    ("        wet = [y for y in c['dug'] if G.group(live.get(y)) == G.FLUID]", "        wet = []",
     a_pit_whose_bottom_is_water_leaves_the_wet_cells_out),
    ("            p = plan_column(b, l, y_lo, y_hi, frozenset(own.get((x, z), ())), mine_depth)",
     "            p = plan_column(b, l, y_lo, y_hi, frozenset(), mine_depth)",
     an_owned_cell_is_never_planned),
    ("            cells.sort(key=lambda c: (c[1], c[0], c[2]))", "            cells.sort(key=lambda c: (c[0], c[2], c[1]))",
     a_job_holds_at_most_24_cells_lowest_first_and_bottom_up),
    ("        parts = [cells[i:i + job_max] for i in range(0, len(cells), job_max)]", "        parts = [cells]",
     a_job_holds_at_most_24_cells_lowest_first_and_bottom_up),
    ("            cells.sort(key=lambda c: (-c[1], c[0], c[2]))", "            cells.sort(key=lambda c: (c[1], c[0], c[2]))",
     a_pillar_is_cut_top_down_and_a_raised_block_and_a_deck_are_cut_too),
    ("            out['cuts'] = [(y, live.get(y)) for y in sorted(above, reverse=True)]",
     "            out['cuts'] = [(y, live.get(y)) for y in sorted(above)]",
     a_pillar_is_cut_top_down_and_a_raised_block_and_a_deck_are_cut_too),
    ("FILL_CLASSES = frozenset(('undermined', 'pit'))", "FILL_CLASSES = frozenset(('undermined', 'pit', 'filled'))",
     a_filled_column_is_left_alone),
    ("    if cls == 'build':\n        left['in_build_columns']", "    if False:\n        left['in_build_columns']",
     a_build_column_is_untouched_whatever_else_is_in_it),
    ("    return bool(name and CONTAINER_RE.search(name))", "    return False",
     a_chest_is_picked_up_flagged_to_be_emptied_and_a_table_is_not),
    ("    c = G.classify_column(base, live, y_lo, y_hi, owned, mine_depth)", "    c = G.classify_column(base, live, y_lo, y_hi, owned, 10 ** 6)",
     deep_mining_is_not_repaired),
    ("KIND_RANK = {'cut_pillar': 0, 'cut': 1, 'pickup': 2, 'fill': 3}", "KIND_RANK = {'cut_pillar': 3, 'cut': 1, 'pickup': 2, 'fill': 0}",
     jobs_are_ordered_pillar_cuts_then_other_cuts_then_pickups_then_fills_nearest_first),
    ("    jobs.sort(key=lambda j: (j['_rank'], j['distance'], j['tile'][0], j['tile'][1], j['part']))",
     "    jobs.sort(key=lambda j: (j['_rank'], -j['distance'], j['tile'][0], j['tile'][1], j['part']))",
     jobs_are_ordered_pillar_cuts_then_other_cuts_then_pickups_then_fills_nearest_first),
    ("    return not p['jobs'] and not p['pickups'] and not p['summary']['wet_cells']", "    return True",
     the_control_an_untouched_world_gives_an_empty_plan),
]


def mutants_are_killed(_P):
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
    P = load()
    ok = 0
    for fn in TESTS + [mutants_are_killed]:
        try:
            fn(P); print('  PASS ', fn.__name__); ok += 1
        except Exception as e:                      # noqa: BLE001
            print('  FAIL ', fn.__name__, repr(e)[:400])
    n = len(TESTS) + 1
    print('%d passed, %d failed' % (ok, n - ok))
    return 0 if ok == n else 1


if __name__ == '__main__':
    sys.exit(main())
