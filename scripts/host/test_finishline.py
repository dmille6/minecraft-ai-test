#!/usr/bin/env python3
"""Tests for finishline.py's pure parts: python3 -B scripts/host/test_finishline.py

Each MUTANT (one changed line of finishline.py, its anchor asserted present and unique) re-runs the check it should break
against the mutated module and must FAIL there."""
import datetime as dt
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'finishline.py')
UTC = dt.timezone.utc
FAILS = []


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


F = load(SRC, 'finishline_under_test')


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok:
        FAILS.append(name)


FULL = {'wall', 'house1', 'house2', 'cottage1', 'hall', 'storehub', 'cropfarm', 'paths', 'shaft'}


def ck_status(M):
    p, u, x = M.crit('a', '1', True), M.crit('b', '', False, 'no source'), M.crit('c', '0', False)
    return (M.milestone_status([p, p]) == 'pass' and M.milestone_status([p, u]) == 'partial (1 unread)'
            and M.milestone_status([u, u]) == 'not yet (2 unread)' and M.milestone_status([x, p]) == 'partial'
            and M.milestone_status([x]) == 'not yet' and u['measured'].startswith('unread ('))


def ck_town_m2(M):
    ok = M.town_m2('t', FULL, 0, 0.6, 0)
    three = M.town_m2('t', FULL - {'hall'}, 0, 0.6, 0)
    stuck = M.town_m2('t', FULL, 7.0, 0.6, 0)
    half = M.town_m2('t', FULL, 0, 0.5, 0)
    noadm = M.town_m2('t', FULL, 0, 0.6, None)
    nowork = M.town_m2('t', FULL, 0, None, 0)
    return (ok['status'] == 'pass' and three['status'] == 'partial' and stuck['status'] == 'partial'
            and half['status'] == 'partial' and noadm['status'] == 'partial (1 unread)'
            and nowork['status'] == 'partial (1 unread)')


def ck_m2_world(M):
    a, b = M.town_m2('a', FULL, 0, 0.6, 0), M.town_m2('b', {'wall'}, 0, 0.1, 0)
    w = M.m2_world([a, b])
    return w['pass_towns'] == 1 and w['towns'] == 2 and w['status'] == 'partial' and w['by_crit']['walls'][0] == 2 \
        and M.m2_world([])['status'] == 'unread'


def ck_stuck_bots(M):
    still = ('b1', 'h', 20, (1.0, 2.5), (64, 64), (5, 6))
    few = ('b2', 'h', 19, (1.0, 1.0), (64, 64), (5, 5))
    moved = ('b3', 'h', 400, (1.0, 4.0), (64, 64), (5, 5))
    return M.stuck_bots([still, few, moved]) == {'b1': 1}


def ck_employed(M):
    d = ['villager none L1 at 1,2,3 trades=no', 'villager nitwit L1 at 1', 'villager armorer L2 at 4,5,6 trades=yes', 'junk']
    return M.employed(d) == 1


def ck_diamond(M):
    s = {'a': {'bot': {'tools': {'diamond_pickaxe': [{}]}}}, 'b': {'bot': {'tools': {'iron_pickaxe': [{}]}}},
         'c': {'bot': {'inventory': {'netherite_sword': 1}}}, 'd': {'bot': {}}}
    return M.diamond_share(s) == (2, 4)


def ck_admin(M):
    since = dt.datetime(2026, 11, 2, tzinfo=UTC)
    short_with = [{'t': '2026-11-08T00:00:00Z', 'event': 'rollout'}, {'t': '2026-11-09T02:49:50Z', 'event': 'owner-repair'}]
    short_none = [{'t': '2026-11-08T00:00:00Z', 'event': 'rollout'}]
    covered = [{'t': '2026-11-01T00:00:00Z', 'event': 'rollout'}, {'t': '2026-11-03T00:00:00Z', 'event': 'activated'}]
    return (M.admin_count(short_with, since) == (1, None) and M.admin_count(short_none, since)[0] is None
            and M.admin_count(covered, since) == (0, None))


def ck_render(M):
    t = M.town_m2('showcase', FULL, 0, 0.6, 0)
    fl = {'fleet': {'M1': {'status': 'pass', 'criteria': [M.crit('x', '1', True)]}},
          'showcase': {'M2': dict(M.m2_world([t]), town_rows=[t]),
                       'M5': {'status': 'owner review pending', 'criteria': [M.crit('owner judgement', 'link', False)]}}}
    L = M.render(fl)
    md = '\n'.join(L)
    return ('current worlds (not a fresh-world run)' in L[0] and '| M1 Survives anywhere | fleet | **pass** | x: 1 |' in md
            and '| M3 Town economy | fleet | **unread** |' in md and '**owner review pending**' in md
            and '4+ roofed houses: 4' in md)


CHECKS = [ck_status, ck_town_m2, ck_m2_world, ck_stuck_bots, ck_employed, ck_diamond, ck_admin, ck_render]

MUTANTS = [
    ('an unread criterion counts as a pass', "    s = 'pass' if n == len(cs) else", "    s = 'pass' if n >= len(cs) - un else",
     ck_status),
    ('one house is enough', "len(k['houses']) >= M2_HOUSES", "len(k['houses']) >= 1", ck_town_m2),
    ('working share of exactly 50% passes', "working is not None and working > M2_WORKING",
     "working is not None and working >= M2_WORKING", ck_town_m2),
    ('a barely-logging bot judged stuck', "if rows >= STUCK_MIN_ROWS and", "if rows >= 0 and", ck_stuck_bots),
    ('unemployed villagers counted', "if m and m.group(1) not in NOT_EMPLOYED:", "if m:", ck_employed),
    ('a short release log reads as no admin edits', "    if n or (ts_ and min(ts_) <= since):", "    if True:", ck_admin),
]


def run_mutants():
    src = open(SRC).read()
    with tempfile.TemporaryDirectory() as d:
        for i, (name, old, new, ck) in enumerate(MUTANTS):
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {name}'
            p = os.path.join(d, f'mut{i}.py')
            with open(p, 'w') as fh:
                fh.write(src.replace(old, new))
            M = load(p, f'finishline_mut{i}')
            try:
                survived = bool(ck(M))
            except Exception:
                survived = False
            check(f'mutant killed: {name} (by {ck.__name__})', not survived)


if __name__ == '__main__':
    for ck in CHECKS:
        try:
            ok = bool(ck(F))
        except Exception as e:  # noqa: BLE001
            print(f'      {ck.__name__}: {type(e).__name__}: {e}')
            ok = False
        check(ck.__name__, ok)
    run_mutants()
    print(f'\n{len(CHECKS)} checks, {len(MUTANTS)} mutants: ' + ('ALL PASS' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}'))
    sys.exit(1 if FAILS else 0)
