#!/usr/bin/env python3
"""
Behaviour tests for the canary preflight checks.

Each check exists because one specific trial was wasted, so each test names the
trial. The decisions are pure functions on purpose -- these assert what they DO,
never what the source says, which is the repo rule that produced
`overheadBreakRisk` and `stairLiquid`.

The last block mutates the module and asserts the mutant is caught. A guard that
has never been seen to fail is not a guard.
"""
import datetime, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import preflight as P                                              # noqa: E402
from preflight import (cutoff_is_sound, endpoint_agrees, pool_carries_population,
                       prediction_on_file, branch_from_deployed, preflight)   # noqa: E402

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 9, 7, 3, 0, tzinfo=UTC)
PAST = NOW - datetime.timedelta(hours=2)
FUTURE = NOW + datetime.timedelta(hours=2)
n = 0


def check(cond, label):
    global n
    n += 1
    assert cond, 'FAILED: ' + label


# --- cutoff: the three false zeros of 2026-09-06 ----------------------------
check(cutoff_is_sound(PAST, NOW) is None, 'a past cutoff read from the manifest passes')
check(cutoff_is_sound(FUTURE, NOW) is not None, 'a cutoff in the FUTURE must be refused')
check(cutoff_is_sound(NOW, NOW) is not None, 'a cutoff exactly now has an empty window')
check(cutoff_is_sound(None, NOW) is not None, 'a missing cutoff is not a pass')
check(cutoff_is_sound(PAST, NOW, source='typed') is not None,
      'a cutoff typed by hand is refused even when it is in the past')
# POSITIVE CONTROL: the passing case must actually pass, or every refusal above
# is satisfied by a function that refuses everything.
check(cutoff_is_sound(PAST, NOW) is None, 'positive control: the sound cutoff passes')

# --- endpoint agreement: board-d was picked on 9.58 when the truth was 0.93 --
check(endpoint_agrees(12.77, 12.63) is None, 'two computations within noise agree')
check(endpoint_agrees(9.58, 0.93) is not None, 'the board-d error (16x) must be caught')
check(endpoint_agrees(0.93, 9.58) is not None, 'and caught in either order')
check(endpoint_agrees(12.77, None) is not None, 'one computation is not two')
check(endpoint_agrees('12.77', 12.63) is None, 'a numeric string is still a number')
check(endpoint_agrees(0.0, 0.0) is None, 'two honest zeros agree')
# The tolerance is relative to the LARGER value, so the check is symmetric in
# its arguments -- an agreement test that depended on argument order would be a
# worse instrument than no test.
check(endpoint_agrees(1.0, 1.5) is not None, '33% of the larger is past the tolerance')
check(endpoint_agrees(1.5, 1.0) is not None, 'and the same either way round')
check(endpoint_agrees(1.0, 1.2) is None, '17% of the larger is sampling noise, not a bug')
check(endpoint_agrees(1.0, 1.5, tolerance=0.5) is None, 'a widened tolerance is honoured')

# --- pool population: a pool without the population shows nothing -----------
RANK = {'hive-d': 12.77, 'placebo-a': 6.1, 'isolated-c': 3.2, 'board-d': 0.93}
check(pool_carries_population('hive-d', RANK) is None, 'the argmax pool passes')
check(pool_carries_population('board-d', RANK) is not None, 'the fleet minimum is refused')
check(pool_carries_population('placebo-a', RANK) is not None, 'rank 2 is refused by default')
check(pool_carries_population('placebo-a', RANK, allow_rank=2) is None,
      'a deliberately typed rank is honoured')
check(pool_carries_population('nope', RANK) is not None, 'a pool not in the ranking is refused')
check(pool_carries_population('hive-d', {}) is not None, 'no ranking at all is refused')
check(pool_carries_population('x', {'x': 0.0}) is not None,
      'an argmax of zero still has nothing for the fix to act on')

# --- comparable pools: the isolated arm is 20 one-bot "pools" ---------------
# Real shape, measured 2026-09-07: 11 pools of 5 bots plus 20 singletons whose
# exp.pool is `self-isolated-<pool>-<Bot>`.
BOTS = dict({p: 5 for p in ('hive-d', 'placebo-a', 'board-d')},
            **{'self-isolated-a-Echo': 1, 'self-isolated-c-Delta': 1})
keep = P.comparable_pools(BOTS, 'hive-d')
check(keep == {'hive-d', 'placebo-a', 'board-d'}, 'one-bot pools are not comparable to a 5-bot pool')
check('self-isolated-a-Echo' not in keep, 'the singleton that topped the live ranking is dropped')
check(P.comparable_pools(BOTS, 'self-isolated-a-Echo') >= {'self-isolated-a-Echo'},
      'the canary pool is never dropped, even when it is the odd one')
check(P.comparable_pools({'a': 5, 'b': 3}, 'a') == {'a', 'b'}, '3 vs 5 is within the factor')
check(P.comparable_pools({'a': 5, 'b': 2}, 'a') == {'a'}, '2 vs 5 is not')
check(P.comparable_pools({}, 'a') is None, 'no bot counts means cannot tell, not all-clear')
check(P.comparable_pools({'b': 5}, 'a') is None, 'a pool absent from the counts is cannot-tell')
# POSITIVE CONTROL: it must be capable of keeping more than the canary pool.
check(len(P.comparable_pools({'a': 5, 'b': 5, 'c': 5}, 'a')) == 3,
      'positive control: comparable pools are kept')
# And the live regression it was written for: hive-d ranks 1 among real pools,
# 4 of 32 when singletons are admitted.
LIVE = {'hive-d': 10.72, 'placebo-a': 6.1, 'board-d': 0.93,
        'self-isolated-a-Echo': 15.71, 'self-isolated-c-Delta': 13.62}
check(pool_carries_population('hive-d', LIVE) is not None,
      'unfiltered, the singletons make the right pool look wrong')
check(pool_carries_population('hive-d', {k: v for k, v in LIVE.items() if k in keep}) is None,
      'filtered to comparable pools, hive-d is the argmax it actually is')

# --- prediction: the ledger has existed since August and never been used ----
GOOD = {'sha': 'ece1608', 'metric': 'drowning_aborts', 'direction': '<',
        'threshold': 8.0, 'falsifiers': ['deaths rise', 'ceiling_no_air rises']}
check(prediction_on_file('ece1608', [GOOD]) is None, 'a complete prediction passes')
check(prediction_on_file('ece1608', [dict(GOOD, sha='ece1608+640197')]) is None,
      'the build suffix must not defeat the match')
check(prediction_on_file('ece1608+aa', [GOOD]) is None, 'nor a suffix on the query side')
check(prediction_on_file('deadbee', [GOOD]) is not None,
      'a prediction about another sha does not cover this one')
check(prediction_on_file('ece1608', []) is not None, 'no prediction is refused')
check(prediction_on_file('ece1608', None) is not None, 'an unreadable ledger is refused')
check(prediction_on_file('ece1608', [dict(GOOD, falsifiers=[])]) is not None,
      'a prediction with nothing that would falsify it is a description')
for f in P.REQUIRED_PREDICTION_FIELDS:
    check(prediction_on_file('ece1608', [{k: v for k, v in GOOD.items() if k != f}]) is not None,
          'a prediction missing %s is incomplete' % f)
check(prediction_on_file('ece1608', [dict(GOOD, falsifiers=None), GOOD]) is None,
      'one complete prediction among several is enough')

# --- branch point: four commits sit on main right now -----------------------
DEP = '92fc7b1+640197'
check(branch_from_deployed('92fc7b1', DEP, branch_head='ece1608') is None,
      'a branch cut from the deployed sha passes')
check(branch_from_deployed('98f9a6d', DEP, branch_head='ece1608') is not None,
      'a branch cut from main carries uncontrolled co-variates')
check(branch_from_deployed('92fc7b1', DEP, branch_head='92fc7b1') is not None,
      'a branch identical to the baseline tests nothing')
check(branch_from_deployed(None, DEP) is not None, 'an unknown branch point is refused')
check(branch_from_deployed('92fc7b1', None) is not None, 'an unknown baseline is refused')

# --- the aggregate reports EVERY blocker, not the first ---------------------
CLEAN = {'open_loop': None, 'declared_at': PAST, 'now': NOW,
         'rate_mine': 12.77, 'rate_computed': 12.63, 'pool': 'hive-d',
         'ranking': RANK, 'sha': 'ece1608', 'predictions': [GOOD],
         'merge_base': '92fc7b1', 'deployed_sha': DEP, 'branch_head': 'ece1608'}
check(preflight(CLEAN) == [], 'the fully-clean case is clear to deploy')
check(len(preflight({})) == len(P.CHECKS) - 1,
      'an empty fact set fails every check that has one (open loop needs a manifest)')
bad = dict(CLEAN, declared_at=FUTURE, pool='board-d', predictions=[])
got = {name for name, _ in preflight(bad)}
check(got == {'cutoff', 'pool population', 'prediction'},
      'three independent faults are ALL reported, not just the first: got %s' % got)
check(len(preflight(dict(CLEAN, open_loop='placebo-b is unread'))) == 1,
      'an open loop alone blocks')

# --- MUTANT: the guard must be seen to fail ---------------------------------
# `endpoint_agrees` is the check that would have saved the board-d trial, so it
# is the one worth proving cannot be silently disabled.
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib', 'preflight.py')).read()
ANCHOR = "if abs(a - b) / scale > tolerance:"
check(src.count(ANCHOR) == 1, 'ANCHOR MISSING or not unique — the mutant would not apply')
mutated = src.replace(ANCHOR, "if False:", 1)
check(mutated != src, 'the mutant actually changed the source')
ns = {}
exec(compile(mutated, 'preflight_mutant', 'exec'), ns)
check(ns['endpoint_agrees'](9.58, 0.93) is None,
      'sanity: the mutant really does disable the comparison')
check(endpoint_agrees(9.58, 0.93) is not None,
      'and the REAL function still catches what the mutant misses')

print('preflight: %d checks passed' % n)
