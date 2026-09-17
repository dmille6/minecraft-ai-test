#!/usr/bin/env python3
"""Behavioural test for verdict.py's v19 change-row licensing decision.

Three canaries were ended by a change row that could not discriminate (-08c, -13, -13b).
The decision now lives in a pure function so it can be tested instead of trusted, and
these cases are the three that actually happened plus the one that must still fire.

    python3 test_license_change_rows.py           # against ~/verdict.py on the bots host
"""
import importlib.util, os, sys

path = os.environ.get('VERDICT_PY', os.path.expanduser('~/verdict.py'))
src = open(path).read()
# verdict.py runs on import (it is a script); take just the function.
import ast
tree = ast.parse(src)
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'license_change_rows')
ns = {}
exec(compile(ast.Module(body=[fn], type_ignores=[]), path, 'exec'), ns)
license_change_rows = ns['license_change_rows']

FAILED = []


def check(name, got, want):
    # A mutant must produce a clean FAIL line, not a traceback from the NEXT assertion:
    # a crash and a failure look different in a log, and only one of them gets read.
    if callable(got):
        try: got = got()
        except Exception as e: got = f'raised {type(e).__name__}: {e}'
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        print(f'        got  {got}\n        want {want}')
        FAILED.append(name)


# 1. The gate must still FIRE. A row the old code cannot write, seen on the canary away
#    from any death, and present in this death's window: that is the change acting.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['death_site_route_crossed'], 'drowned')],
    away={'death_site_route_crossed'}, ctrl_at_death=set())
check('a discriminating row licenses a REVERT', (len(lic), len(ref)), (1, 0))

# 2. recovery-ladder-13b: `flooded_pocket_rung` is fleet-wide on 1d6c97d, and a control
#    bot (isolated-a-Echo, 00:01:45) died carrying it. Baseline, not the change.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['flooded_pocket_rung'], 'drowned')],
    away={'flooded_pocket_rung'}, ctrl_at_death={'flooded_pocket_rung'})
check('a row control deaths carry is refused', (len(lic), len(ref)), (0, 1))
check('  and the reason names the baseline', lambda: 'baseline behaviour' in ref[0], True)

# 3. recovery-ladder-13: `death_site_recorded` is written BY the death handler, so it was
#    never seen away from a death. A consequence cannot be a cause.
lic, ref = license_change_rows(
    [('placebo-a-Delta', '23:20:15', ['death_site_recorded'], 'drowned')],
    away=set(), ctrl_at_death=set())
check('a row only ever seen at a death is refused', (len(lic), len(ref)), (0, 1))
check('  and the reason names the death handler', lambda: 'written by the death' in ref[0], True)

# 4. Mixed: one row licenses, one is refused -- the licensed one must still revert.
lic, ref = license_change_rows(
    [('hive-a-Bravo', '04:09:35', ['flooded_pocket_rung', 'death_site_route_crossed'], 'x')],
    away={'flooded_pocket_rung', 'death_site_route_crossed'},
    ctrl_at_death={'flooded_pocket_rung'})
check('a real row still fires alongside a refused one', (len(lic), len(ref)), (1, 1))

# 5. No deaths at all: nothing licensed, nothing refused (the quiet case must stay quiet).
check('no death windows -> no verdict either way',
      license_change_rows([], away={'x'}, ctrl_at_death=set()), ([], []))

print(f"\n{'ALL PASS' if not FAILED else str(len(FAILED)) + ' FAILED: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)
