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

# --- pool population: a FLOOR, never a maximum ------------------------------
# The argmax rule was removed on 2026-09-07 because it guarantees the thing that
# killed that day's trial. See reversion_fit below.
RANK = {'hive-d': 12.77, 'placebo-a': 6.1, 'board-c': 5.65, 'board-a': 3.54,
        'isolated-c': 3.2, 'board-d': 0.93}
check(pool_carries_population('hive-d', RANK) is None, 'the maximum pool is allowed')
check(pool_carries_population('placebo-a', RANK) is None,
      'so is rank 2 -- picking the extreme is not required and is not desirable')
check(pool_carries_population('board-a', RANK) is None, 'and a mid pool with real population')
check(pool_carries_population('board-d', RANK) is not None,
      'the board-d error IS caught: 0.93 against a median of 4.60 is 20% of it')
check(pool_carries_population('nope', RANK) is not None, 'a pool not in the ranking is refused')
check(pool_carries_population('hive-d', {}) is not None, 'no ranking at all is refused')
check(pool_carries_population('x', {'x': 0.0, 'y': 5.0}) is not None,
      'a pool measuring zero has nothing for the fix to act on')
check(pool_carries_population('x', {'x': 3.0, 'y': 5.0}, min_share=0.9) is not None,
      'a stricter floor is honoured')

# --- the reversion line: the instrument that would have saved 2026-09-07 ----
# Real control-pool rates, two halves of that night's window.
PAIRS = [(3.54, 2.58), (5.37, 3.69), (5.65, 6.76), (0.91, 1.72), (1.93, 0.86),
         (2.01, 2.70), (7.28, 6.26), (4.05, 3.68), (2.53, 5.65), (2.72, 4.91)]
fit = P.reversion_fit(PAIRS)
check(fit is not None, 'ten control pools are enough to fit')
check(fit.slope < 0, 'high pools fall and low pools rise: the slope must be negative')
check(fit.n == 10, 'the fit reports its own denominator')
check(P.reversion_fit(PAIRS[:3]) is None, 'three pools is not a fit')
check(P.reversion_fit([(1.0, 2.0)] * 8) is None, 'no spread in x means no fit')
check(P.reversion_fit([]) is None, 'nothing is not a fit')
# POSITIVE CONTROL: on data with a KNOWN slope the fit must recover it.
known = [(x, x + (3.0 - 0.5 * x)) for x in (1.0, 2.0, 4.0, 6.0, 8.0, 10.0)]
kf = P.reversion_fit(known)
check(abs(kf.slope + 0.5) < 1e-6 and abs(kf.intercept - 3.0) < 1e-6,
      'positive control: an exact line is recovered exactly (got %+.3f %+.3f)'
      % (kf.intercept, kf.slope))
check(kf.sd < 1e-6, 'and an exact line has no residual scatter')

# An untreated pool at hive-d's baseline was going to fall on its own.
pred = P.expected_untreated_delta(12.86, fit)
check(pred < 0, 'a pool at 12.86 is predicted to FALL untreated, got %+.2f' % pred)
check(P.expected_untreated_delta(12.86, None) is None, 'no fit means no prediction')

# LEVERAGE: predicting outside the fitted range must be visibly less certain.
inside = P.prediction_sd(3.5, fit)
outside = P.prediction_sd(12.86, fit)
check(outside > inside, 'extrapolating to an extreme pool must widen the interval '
                        '(%.2f inside vs %.2f outside)' % (inside, outside))
check(outside > fit.sd, 'and must exceed the raw residual sd')
check(P.prediction_sd(3.5, None) is None, 'no fit means no interval')

# THE VERDICT THIS ENCODES: hive-d observed -5.12 and had to beat -8.37.
predicted, threshold = P.effect_must_exceed(12.86, fit)
check(threshold < -5.12, 'hive-d -5.12 does NOT clear the do-nothing bar of %+.2f' % threshold)
check(P.effect_must_exceed(12.86, fit, sds=0.0)[1] == predicted,
      'at zero sd the bar is just the prediction')
check(P.effect_must_exceed(3.5, None) is None, 'no fit means no bar')

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
# The harm the singletons actually do, now that the argmax rule is gone: a
# one-bot pool's rate is noisier, so admitting twenty of them STEEPENS the
# apparent reversion slope and moves the do-nothing bar. Two fits of the same
# night disagreed about hive-d for exactly this reason.
REAL = [(3.54, 2.58), (5.37, 3.69), (5.65, 6.76), (0.91, 1.72), (1.93, 0.86),
        (2.01, 2.70), (7.28, 6.26), (4.05, 3.68), (2.53, 5.65), (2.72, 4.91)]
NOISY = REAL + [(14.0, 4.0), (13.0, 3.0), (1.0, 9.0), (0.5, 8.0)]   # singleton-like
f_real, f_noisy = P.reversion_fit(REAL), P.reversion_fit(NOISY)
check(f_noisy.slope < f_real.slope,
      'admitting one-bot pools steepens the reversion slope (%.3f -> %.3f)'
      % (f_real.slope, f_noisy.slope))
bar_real = P.effect_must_exceed(12.86, f_real)[0]
bar_noisy = P.effect_must_exceed(12.86, f_noisy)[0]
check(bar_noisy < bar_real,
      'and so moves the do-nothing bar the canary must beat (%+.2f vs %+.2f) — '
      'which is how one fit said "effect" and the other said "less than nothing"'
      % (bar_real, bar_noisy))

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
