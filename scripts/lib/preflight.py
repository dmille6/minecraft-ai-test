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


def pool_carries_population(pool, ranking, allow_rank=1):
    """
    `ranking` maps pool -> endpoint rate. The canary pool must be the argmax
    unless a worse rank was asked for deliberately.
    """
    if not isinstance(ranking, dict) or not ranking:
        return ('no per-pool ranking for the endpoint -- cannot show this pool '
                'contains the population the fix targets')
    if pool not in ranking:
        return ('pool %r does not appear in the endpoint ranking (%d pools '
                'measured). Either the pool is wrong or the endpoint is'
                % (pool, len(ranking)))
    order = sorted(ranking.items(), key=lambda kv: -kv[1])
    rank = [p for p, _ in order].index(pool) + 1
    if rank > max(1, int(allow_rank)):
        best, best_rate = order[0]
        return ('pool %s ranks %d of %d on this endpoint (%.2f vs %s at %.2f). '
                'A canary pool must contain the population the fix targets or it '
                'shows nothing; pass --allow-rank %d to override deliberately'
                % (pool, rank, len(order), ranking[pool], best, best_rate, rank))
    if ranking[pool] <= 0:
        return ('pool %s measures %.2f on this endpoint -- the fix has nothing '
                'to act on here' % (pool, ranking[pool]))
    return None


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
