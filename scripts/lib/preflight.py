"""
THE CHECKS A CANARY MUST PASS BEFORE IT IS DEPLOYED.

Every rule here is one specific way a trial was wasted, and the rule exists
because the human check failed at exactly that point. CLAUDE.md says a rule that
could be mechanical instead SHOULD be, and that this file should shrink as those
mechanisms land. This is four of them.

  cutoff_is_sound             A cutoff typed by hand was in the FUTURE three
                              times in one day. Each time the query returned a
                              confident zero and the zero was believed. Read the
                              cutoff from the manifest, and assert it is past.

  endpoint_agrees             board-d was selected on a baseline of 9.58
                              drowning-aborts/bot-h. The true value was 0.93 --
                              16x, and the SECOND-LOWEST pool on the fleet. The
                              trial was torn down before it produced data. Two
                              computations of the number that picks the pool, or
                              the number does not get to pick the pool.

  pool_carries_population     A canary pool must contain the population the fix
                              targets or it shows nothing. board-d again: the
                              fix was for drowning aborts and the pool barely
                              had any. Argmax, or an override you have to type.

  prediction_on_file          A prediction written after the read is not a
                              prediction. `reports/predictions.jsonl` has
                              existed since August and no canary has ever used
                              it.

  branch_from_deployed        A single-variable canary must branch from the
                              DEPLOYED baseline, not from main -- otherwise it
                              carries every unshipped commit on main as
                              uncontrolled co-variates. Four such commits are
                              sitting on main right now. The pre-push hook's
                              complaint about this is the false positive; THIS
                              is the real check.

Every function returns None when the check passes and a one-line reason when it
does not, so `preflight()` can report EVERY blocker at once. Reporting the first
one only is how a five-minute check becomes five round trips.
"""

#: Two computations of the same rate may differ by sampling and rounding. They
#: may not differ by an order of magnitude. 25% is deliberately generous: this
#: is a guard against a WRONG QUERY, not a precision instrument.
RATE_TOLERANCE = 0.25


def cutoff_is_sound(declared_at, now, source='manifest'):
    """The window boundary must be read from somewhere, and must be in the past."""
    if declared_at is None:
        return ('no cutoff: the canary window has no declared_at. A window typed '
                'by hand returned a confident zero three times in one day')
    if source == 'typed':
        return ('cutoff was TYPED (%s). Read it from the manifest\'s declared_at '
                'instead -- that is the field the deploy actually wrote' % declared_at)
    if now is None:
        return 'cannot check the cutoff without the current time'
    if declared_at >= now:
        return ('cutoff %s is NOT IN THE PAST (now %s). Every query against this '
                'window returns zero, and the zero is not a finding'
                % (declared_at, now))
    return None


def endpoint_agrees(mine, theirs, tolerance=RATE_TOLERANCE,
                    mine_label='your computation', theirs_label='telemetry lib'):
    """
    Two independent computations of the number that selects the pool.

    This is an honesty mechanism, not a proof: it catches a query that is WRONG,
    which is what happened, and cannot catch two queries wrong the same way.
    """
    try:
        a, b = float(mine), float(theirs)
    except (TypeError, ValueError):
        return ('the endpoint was not computed twice (got %r and %r). The number '
                'that picks the pool is the number most worth getting wrong'
                % (mine, theirs))
    if a < 0 or b < 0:
        return 'a rate cannot be negative (%s=%s, %s=%s)' % (mine_label, a, theirs_label, b)
    # Both near zero is agreement, not a division problem -- but it is also a
    # pool with none of the population, which pool_carries_population catches.
    if a == 0 and b == 0:
        return None
    scale = max(abs(a), abs(b))
    if abs(a - b) / scale > tolerance:
        ratio = scale / max(min(abs(a), abs(b)), 1e-9)
        return ('the endpoint disagrees with itself: %s=%s vs %s=%s (%.1fx apart). '
                'board-d was selected on exactly this error and produced no data'
                % (mine_label, a, theirs_label, b, ratio))
    return None


def comparable_pools(bots, pool, factor=2.0):
    """
    Drop pools whose bot count is not comparable to the canary pool's.

    Found 2026-09-07 by this tool's first live run: the `isolated` arm writes
    `exp.pool` as `self-isolated-<pool>-<Bot>`, so each of its 20 bots is its own
    pool. Ranking then compares a 5-bot pool against 20 one-bot pools, and a
    single bot's rate tops the list on noise alone -- hive-d read as "rank 4 of
    32" when among real pools it is rank 1.

    That is the denominator error this project keeps making, wearing a new hat:
    the number was right and the population it was compared against was not.

    `bots` maps pool -> number of distinct bots seen. Returns the pool names that
    may honestly be ranked together, and never drops the canary pool itself.
    """
    if not isinstance(bots, dict) or pool not in bots:
        return None                      # cannot tell: the caller must fail closed
    want = max(bots[pool], 1)
    lo, hi = want / factor, want * factor
    return {p for p, n in bots.items() if lo <= n <= hi or p == pool}


import collections

#: The reversion line plus what is needed to say how well it is pinned down.
#: `mean_x` and `sxx` carry the leverage term, which is the part that matters
#: when the canary pool sits outside the range the line was fitted on.
_Fit = collections.namedtuple('_Fit', 'intercept slope sd n mean_x sxx')

#: A pool below this fraction of the median has too little of the population for
#: the fix to act on. board-d was 0.26 of the median and produced nothing.
MIN_SHARE_OF_MEDIAN = 0.5


def pool_carries_population(pool, ranking, min_share=MIN_SHARE_OF_MEDIAN):
    """
    `ranking` maps pool -> endpoint rate. The pool must have enough of the
    population for the fix to act on.

    THIS CHECK NO LONGER DEMANDS THE ARGMAX, and the reason is the whole story
    of 2026-09-07. It did demand it, for six hours, because board-d had been
    chosen at 0.26 of the fleet median and showed nothing. But "pick the maximum"
    is a rule that GUARANTEES regression to the mean: the extreme pool is extreme
    partly because of noise, and noise does not persist. hive-d was picked as the
    fleet maximum at 12.83 drowning-aborts/bot-h and fell 4.84 -- while a fit of
    delta-on-baseline across the untreated pools predicted a fall of 5.68 for an
    UNTREATED pool at that baseline. The trial's headline effect was smaller than
    doing nothing, and the guard I had just written would have insisted on that
    pool again.

    So the requirement is a FLOOR, not a maximum: enough of the population to
    measure, and `reversion_fit` prices what the pool would have done untreated.
    """
    if not isinstance(ranking, dict) or not ranking:
        return ('no per-pool ranking for the endpoint -- cannot show this pool '
                'contains the population the fix targets')
    if pool not in ranking:
        return ('pool %r does not appear in the endpoint ranking (%d pools '
                'measured). Either the pool is wrong or the endpoint is'
                % (pool, len(ranking)))
    if ranking[pool] <= 0:
        return ('pool %s measures %.2f on this endpoint -- the fix has nothing '
                'to act on here' % (pool, ranking[pool]))
    vals = sorted(ranking.values())
    median = vals[len(vals) // 2] if len(vals) % 2 else (vals[len(vals)//2 - 1] + vals[len(vals)//2]) / 2.0
    if median > 0 and ranking[pool] < min_share * median:
        return ('pool %s measures %.2f against a fleet median of %.2f (%.0f%% of '
                'it) -- too little of the population for the fix to act on. This '
                'is the board-d error: the trial cannot produce a result'
                % (pool, ranking[pool], median, 100 * ranking[pool] / median))
    return None


def reversion_fit(pairs):
    """
    Least-squares fit of (post - pre) on pre, across UNTREATED pools.

    This is the instrument that would have saved 2026-09-07. Split a quiet
    baseline window in half, take each pool's rate in each half, and fit how much
    a pool at a given level moves on its own. The slope is reliably negative --
    high pools fall, low pools rise -- because pool rates contain noise and noise
    does not persist.

    `pairs` is [(pre, post), ...]. Returns (intercept, slope, residual_sd), or
    None when there are too few pools to fit. Four is already thin; the caller
    should say the denominator.
    """
    pts = [(float(a), float(b) - float(a)) for a, b in pairs
           if a is not None and b is not None]
    n = len(pts)
    if n < 4:
        return None
    mx = sum(x for x, _ in pts) / n
    my = sum(y for _, y in pts) / n
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    if sxx <= 0:
        return None                      # every pool at the same level: no fit
    slope = sum((x - mx) * (y - my) for x, y in pts) / sxx
    intercept = my - slope * mx
    resid = [y - (intercept + slope * x) for x, y in pts]
    # n-2 degrees of freedom: two were spent on the fit.
    dof = max(n - 2, 1)
    sd = (sum(r * r for r in resid) / dof) ** 0.5
    return _Fit(intercept, slope, sd, n, mx, sxx)


def expected_untreated_delta(pre_rate, fit):
    """What a pool at this baseline does with NO treatment at all."""
    if fit is None or pre_rate is None:
        return None
    return fit.intercept + fit.slope * float(pre_rate)


def prediction_sd(pre_rate, fit):
    """
    How well the reversion line is pinned down AT THIS POOL'S BASELINE.

    Two different fits of tonight's data disagreed about hive-d: slope -0.318
    predicted it would fall 2.66 untreated, slope -0.627 predicted 5.68. hive-d
    fell 5.12, so one fit says a real effect and the other says less than nothing.
    The fits differed only in which pools they included.

    That is not a tie to be broken -- it is the answer. hive-d's baseline (12.86)
    sits far outside the range the line was fitted on (0.9 to 7.3), so the
    prediction there is an extrapolation, and the leverage term below blows up
    exactly as it should. A pool you cannot predict the untreated behaviour of
    is a pool whose trial cannot be read.
    """
    if fit is None or pre_rate is None:
        return None
    x = float(pre_rate)
    lev = 1.0 + 1.0 / fit.n + ((x - fit.mean_x) ** 2) / fit.sxx
    return fit.sd * (lev ** 0.5)


def effect_must_exceed(pre_rate, fit, sds=2.0):
    """
    The delta a real change has to beat to be distinguishable from doing nothing.

    Returns (predicted_untreated_delta, threshold). A canary whose observed delta
    does not clear the threshold has not been shown to do anything, however large
    the raw number looks -- hive-d's -4.84 against a predicted -5.68 is the case
    in point.
    """
    if fit is None:
        return None
    pred = expected_untreated_delta(pre_rate, fit)
    psd = prediction_sd(pre_rate, fit)
    if pred is None or psd is None:
        return None
    return pred, pred - sds * psd


#: A prediction with no way to be wrong is a description.
REQUIRED_PREDICTION_FIELDS = ('metric', 'direction', 'threshold', 'falsifiers')


def prediction_on_file(sha, predictions):
    """A pre-registered, falsifiable prediction naming THIS sha."""
    if predictions is None:
        return 'the prediction ledger could not be read -- treat as absent'
    rows = [p for p in predictions
            if isinstance(p, dict) and (p.get('sha') or '').split('+')[0] == (sha or '').split('+')[0]]
    if not rows:
        return ('no prediction on file for %s. Write the prediction and its '
                'falsifiers BEFORE the read, or the read cannot disconfirm '
                'anything' % (sha or '(no sha)'))
    for r in rows:
        missing = [f for f in REQUIRED_PREDICTION_FIELDS if not r.get(f)]
        if missing:
            continue
        if not isinstance(r.get('falsifiers'), (list, tuple)) or not r['falsifiers']:
            continue
        return None
    return ('a prediction exists for %s but none is complete -- needs %s, and '
            'falsifiers must be a non-empty list of things that would make you '
            'revert' % (sha, ', '.join(REQUIRED_PREDICTION_FIELDS)))


def branch_from_deployed(merge_base, deployed_sha, branch_head=None):
    """
    The canary branch must sit on top of the sha the FLEET is running.

    Branching from main instead silently adds every unshipped commit on main as
    an uncontrolled co-variate, which turns a single-variable trial into a
    bundle. There are four such commits on main today.
    """
    if not deployed_sha:
        return 'the deployed sha is unknown -- cannot prove this is one variable'
    if not merge_base:
        return 'cannot determine the branch point -- treat as not cut from the baseline'
    short = lambda s: (s or '').split('+')[0][:12]
    if not short(merge_base).startswith(short(deployed_sha)[:7]) and \
       not short(deployed_sha).startswith(short(merge_base)[:7]):
        return ('branch point %s is not the deployed baseline %s -- everything '
                'between them rides along as an uncontrolled co-variate'
                % (short(merge_base), short(deployed_sha)))
    if branch_head and short(branch_head) == short(deployed_sha):
        return 'the branch is identical to the deployed sha -- there is no change to test'
    return None


#: Names in the order they are reported, so the output reads the same every run.
CHECKS = ('open loop', 'cutoff', 'endpoint agreement', 'pool population',
          'prediction', 'branch point')


def preflight(facts):
    """
    Run every check and return a list of (name, reason) for those that FAILED.

    An empty list means clear to deploy. `facts` is a dict; a check whose inputs
    are absent FAILS, because absence of evidence is the failure mode this
    project repeats -- see the fail-closed note in lib/openloop.py.
    """
    out = []
    if facts.get('open_loop'):
        out.append(('open loop', facts['open_loop']))
    for name, fn, args in (
        ('cutoff', cutoff_is_sound,
         (facts.get('declared_at'), facts.get('now'), facts.get('cutoff_source', 'manifest'))),
        ('endpoint agreement', endpoint_agrees,
         (facts.get('rate_mine'), facts.get('rate_computed'), facts.get('tolerance', RATE_TOLERANCE))),
        ('pool population', pool_carries_population,
         (facts.get('pool'), facts.get('ranking'), facts.get('allow_rank', 1))),
        ('prediction', prediction_on_file,
         (facts.get('sha'), facts.get('predictions'))),
        ('branch point', branch_from_deployed,
         (facts.get('merge_base'), facts.get('deployed_sha'), facts.get('branch_head'))),
    ):
        reason = fn(*args)
        if reason:
            out.append((name, reason))
    return out
