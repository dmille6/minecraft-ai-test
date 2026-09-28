#!/usr/bin/env python3
"""The death tripper's version-rule adapter must be CALLABLE.

WHY THIS EXISTS. `_classify_versions` in infra/guard/death-tripper.py called
`in_canary_pool(...)` without importing it. `_split_rules()` above it imports both
`canary_split_ok` and `in_canary_pool`; this function imported only `classify`. So every run of
the version-rule path raised

    NameError: name 'in_canary_pool' is not defined

The two suites that cover this area -- test_version_split.py (12 cases) and
test_canary_split.py (32 cases) -- both PASS, and always did, because they exercise the PURE
functions in lib/version_split.py and never the adapter that wires them into the tripper. 44
green cases and the thing they protect could not start. That is the gap this file closes: the
adapter, not the rules.

It is also not swallowed. The `try/except` inside the function wraps only the IMPORT of
`classify`, and the enclosing `try` in `version_check` closes before the call site, so the
NameError propagates out rather than degrading to the honest "version rules are BLIND".

Found 2026-09-23 by an independent ChatGPT pass over the tripper, reproduced here.

Run: python3 scripts/test_death_tripper_adapter.py
"""
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
TRIPPER = os.path.join(HERE, '..', 'infra', 'guard', 'death-tripper.py')
sys.path.insert(0, os.path.join(HERE, 'lib'))

ok = []
def check(name, got, want, why=''):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if not good and why:
        print(f'         {why}')


def load(src):
    mod = types.ModuleType('dt')
    mod.__dict__['__name__'] = 'dt'
    try:
        exec(compile(src, 'death-tripper.py', 'exec'), mod.__dict__)
    except SystemExit:
        pass
    return mod


RAW = open(TRIPPER).read()

# A realistic fleet state with MORE THAN ONE VERSION observed, which is the only condition under
# which version_check reaches this path at all.
SEEN = {'hive-a-Alpha': 'canarysha', 'hive-a-Bravo': 'canarysha',
        'hive-a-Comet': 'basesha', 'hive-a-Delta': 'basesha', 'hive-a-Echo': 'basesha',
        'board-c-Alpha': 'basesha', 'board-c-Bravo': 'basesha'}
MAN = {'canary_pool': 'hive-a', 'canary_code_version': 'canarysha', 'code_version': 'basesha'}
DECL = ['canarysha', 'basesha']

print('\n1. the adapter can be called at all')
mod = load(RAW)
check('_classify_versions exists', hasattr(mod, '_classify_versions'), True)
try:
    out = mod._classify_versions(SEEN, MAN, DECL)
    raised = None
except Exception as e:
    out, raised = None, f'{type(e).__name__}: {e}'
check('it does not raise', raised, None,
      'the version-rule path of the death tripper cannot run')
check('it returns a list', isinstance(out, list), True)

print('\n2. THE MUTANT -- removing the import must bring the NameError back')
ANCHOR = 'from version_split import classify, in_canary_pool'
n = RAW.count(ANCHOR)
check('mutant anchor present and unique', n, 1,
      'ANCHOR MISSING OR NOT UNIQUE -- this mutant would prove nothing and must not be scored')
if n == 1:
    mutant = load(RAW.replace(ANCHOR, 'from version_split import classify', 1))
    try:
        mutant._classify_versions(SEEN, MAN, DECL)
        got = 'no error'
    except NameError as e:
        got = 'NameError'
        print(f'         reproduced: {e}')
    except Exception as e:
        got = type(e).__name__
    check('the mutant raises NameError', got, 'NameError',
          'if this passes without the import, the test is not load-bearing')

print('\n3. the pure suites pass either way -- which is why they missed it')
import subprocess
for suite in ('test_version_split.py', 'test_canary_split.py'):
    r = subprocess.run([sys.executable, os.path.join(HERE, suite)],
                       capture_output=True, text=True, timeout=120)
    check(f'{suite} passes', r.returncode, 0)
print('         44 green cases over lib/version_split.py, and the adapter that calls them')
print('         could not start. Pure-function coverage is not wiring coverage.')

print(f'\n{sum(ok)}/{len(ok)} adapter cases pass')
sys.exit(0 if all(ok) else 1)
