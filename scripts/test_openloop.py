#!/usr/bin/env python3
"""
Behaviour tests for the open-loop guard. The decision is a pure function on
purpose, so these assert what it DOES rather than what the source says -- the
repo rule that produced `overheadBreakRisk` and `stairLiquid`.

The last block mutates the module and asserts the mutant is caught, because a
guard that has never been seen to fail is not a guard.
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from openloop import open_loop, assert_closed, OpenLoop, VERDICTS   # noqa: E402

SHA = '15d2a87+68a083'
OPEN_M = {'canary_pool': 'placebo-b', 'canary_sha': SHA}
n = 0


def check(cond, label):
    global n
    n += 1
    assert cond, 'FAILED: ' + label


# --- the two states that must be distinguished ------------------------------
check(open_loop({}, []) is None, 'no canary declared is not an open loop')
check(open_loop({'canary_pool': ''}, []) is None, 'empty pool is not an open loop')
check(open_loop(OPEN_M, []) is not None, 'deployed canary with no decision IS open')

# POSITIVE CONTROL: the closed case must actually close, or every assertion
# above passes for the trivial reason that nothing ever closes.
closed = [{'canary_sha': SHA, 'decision': 'KEEP'}]
check(open_loop(OPEN_M, closed) is None, 'a recorded KEEP closes the loop')

# --- every verdict closes, including the honest one -------------------------
for v in VERDICTS:
    check(open_loop(OPEN_M, [{'canary_sha': SHA, 'decision': v}]) is None,
          '%s must close the loop' % v)
check('INCONCLUSIVE' in VERDICTS, 'INCONCLUSIVE must be a legitimate close')

# --- a decision only closes the trial it names ------------------------------
check(open_loop(OPEN_M, [{'canary_sha': 'deadbee+000000', 'decision': 'KEEP'}]) is not None,
      'a decision about another sha must not close this one')
check(open_loop(OPEN_M, [{'canary_sha': SHA, 'decision': 'probably fine'}]) is not None,
      'an unrecognised verdict is not a decision')
check(open_loop(OPEN_M, [{'canary_sha': SHA}]) is not None,
      'a row with no verdict is not a decision')
check(open_loop(OPEN_M, ['not a dict', None]) is not None,
      'junk rows must not close the loop')

# --- FAIL CLOSED: the deliberate inversion of the drowning predicate --------
check(open_loop(OPEN_M, None) is not None,
      'an unreadable ledger is an OPEN loop, never an absent one')
check(open_loop(None, closed) is not None,
      'an unreadable manifest cannot prove no canary is deployed')

# --- a pool with no sha can never be closed by anything ---------------------
check(open_loop({'canary_pool': 'placebo-b'}, closed) is not None,
      'canary_pool with no canary_sha is unclosable and must say so')

# --- canary_pool is a scalar in the shell and a set in the classifier -------
check(open_loop({'canary_pool': ['placebo-b'], 'canary_sha': SHA}, []) is not None,
      'a list pool must be read the same as a scalar one')
check(open_loop({'canary_pool': ['placebo-b'], 'canary_sha': SHA}, closed) is None,
      'a list pool must close the same as a scalar one')

# --- the raising wrapper ----------------------------------------------------
try:
    assert_closed(OPEN_M, [])
    check(False, 'assert_closed must raise on an open loop')
except OpenLoop as e:
    check('15d2a87' in str(e), 'the raise must name the sha it is waiting on')
assert_closed(OPEN_M, closed)          # must not raise
n += 1

# --- MUTANT: the guard must be seen to fail ---------------------------------
# The anchor is asserted present and unique before it is replaced, because a
# mutant that silently fails to apply reads as "killed".
import io
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib', 'openloop.py')
src = io.open(path, encoding='utf8').read()
anchor = "    if decisions is None:"
check(src.count(anchor) == 1, 'MUTANT ANCHOR MISSING OR NOT UNIQUE')

mutated = src.replace(anchor, "    if False:", 1)
check(mutated != src, 'mutant did not apply')
ns = {}
exec(compile(mutated, '<mutant>', 'exec'), ns)      # noqa: S102 - deliberate
# Without the guard the function either returns a wrong "closed" or blows up
# iterating None. Both prove the line is load-bearing; neither is the correct
# answer, which is the only thing being asserted.
try:
    got = ns['open_loop'](OPEN_M, None)
    check(got is None, 'mutant returned a value, and it must be the wrong one')
except TypeError:
    pass                                # the guard was the only thing stopping this
check(open_loop(OPEN_M, None) is not None,
      'and the real module must still fail closed')
n += 2

print('ok  %d assertions' % n)
