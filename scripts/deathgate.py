#!/usr/bin/env python3
"""The death gate, as a pure function, with the small-n problem priced in.

WHY THIS EXISTS. The owner's gate (2026-09-11) is: TWO canary deaths AND a
canary rate > 1.25x control. It is evaluated on every 5-minute poll for up to
nine hours -- about 108 looks -- at an event that happens ~0.02 times per
bot-hour. A 10-bot canary accrues ~24 bot-hours in its first two hours, so the
null expectation is half a death; two is an ordinary Poisson blip, and the point
ratio then clears 1.25 by a mile because the denominator is tiny too.

Measured 2026-09-13: the rule falsely reverts 46% of harmless 5-bot canaries.
Measured 2026-09-18: it reverted falls-01, a REPORT-ONLY instrument that adds a
log row at falls and nothing else, on two idle deaths (one drowning, one
unknown, no falls) while the three CONTROL deaths in the same window were idle
drownings -- the same background mechanism the fleet has had for weeks.

WHAT CHANGES. The floor of two deaths stays; the owner set it. The 1.25x test
moves from the POINT ratio to the one-sided lower confidence bound of the ratio.
With 2 deaths against 3 the bound is far below 1.25 and the gate holds its fire;
with a real tripling observed over enough deaths the bound clears it and the
gate reverts as before.

WHY NOT 'SAME CAUSE CLASS, SO IGNORE IT'. That was the first idea and it is
wrong: swim_to -- this project's canonical real harm -- TRIPLED drowning deaths
while the control fleet was also drowning. Matching on cause class would have
excused it. The defect is the arithmetic of small numbers, so the fix belongs in
the arithmetic.
"""
import math


def _binom_sf(k, n, p):
    """P(X >= k) for X ~ Binomial(n, p). Exact; n here is a handful of deaths."""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def ratio_lower_bound(a, ta, b, tb, alpha=0.05):
    """One-sided lower confidence bound on (a/ta) / (b/tb), two Poisson rates.

    Conditional on the total a+b, a is Binomial(a+b, p) with
    p = (la*ta) / (la*ta + lb*tb). Bound p from below (Clopper-Pearson, by
    bisection on the exact binomial tail), then map it back to the ratio. Exact
    for the single-digit death counts a canary produces -- no normal
    approximation, which is what fails at n=2.

    Returns 0.0 when there is no control exposure to compare against, so a
    caller can never read 'no denominator' as 'infinitely worse'.
    """
    if a <= 0 or ta <= 0 or tb <= 0:
        return 0.0
    n = a + b
    if b <= 0:
        # No control deaths at all: the bound still exists, with b = 0 the
        # binomial has p bounded below by the same tail test at n = a.
        n = a
    lo, hi = 0.0, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        # The largest p we can reject from below: P(X >= a | n, p) >= alpha
        if _binom_sf(a, n, mid) >= alpha:
            hi = mid
        else:
            lo = mid
    p = hi
    if p >= 1.0:
        return float('inf')
    return (p / (1 - p)) * (tb / ta)


class TooFewAssignments(ValueError):
    """The design cannot attain the required p, so the p cannot be a condition."""


def randomization_p(units, treat, size=None):
    """The in-window randomization p of the canary death RATE. Pure. (owner 2026-09-24)

    `units` maps unit -> (deaths, bot_hours) for every unit in the window, treated and
    control alike -- a unit is a pool, or a bot for a within-world split. `treat` is the
    treated units. Returns (p, n_assignments).

    p = the share of same-shape assignments whose CANARY DEATH RATE is >= the realised
    one, the realised assignment included in the enumeration. Total deaths and total
    exposure are fixed across reassignments, so a higher canary rate is exactly a lower
    control rate; ranking the canary rate therefore ranks the difference too, without a
    division by zero when a reassignment happens to put every death on one side.

    WHY A RANKED STATISTIC AND NOT THE GATE'S OWN TRIP CONDITION. The first design counted
    the share of reassignments for which the gate WOULD FIRE. A Codex pass killed it:
    a binary condition is not a ranked statistic, so that share does not fall as the
    observation gets more extreme. With the deaths concentrated in the two treated pools,
    every assignment containing either of them also fires -- C(16,2)-C(14,2) = 29 of 120 --
    so the p would sit near 0.24 and could never clear 0.05. The gate would go PERMANENTLY
    SILENT exactly as harm got worse. A ranked statistic is monotone in the observation by
    construction, which is the property the whole idea depends on.
    """
    import itertools
    us = sorted(units)
    k = size if size is not None else len(treat)
    if k <= 0 or k >= len(us):
        raise TooFewAssignments('%d treated of %d units leaves no contrast' % (k, len(us)))

    def rate(sel):
        d = sum(units[u][0] for u in sel)
        h = sum(units[u][1] for u in sel)
        return (d / h) if h > 0 else None

    obs = rate(treat)
    if obs is None:
        raise TooFewAssignments('the treated units have no measured exposure')
    ge = n = 0
    for combo in itertools.combinations(us, k):
        r = rate(combo)
        if r is None:
            continue
        n += 1
        if r >= obs - 1e-12:
            ge += 1
    if n == 0:
        raise TooFewAssignments('no assignment of this shape has measured exposure')
    return ge / n, n


def death_gate(canary_deaths, canary_bot_h, control_deaths, control_bot_h,
               floor=2, threshold=1.25, alpha=0.05, units=None, treat=None,
               max_p=0.05, p_vetoes=False):
    """(reverts, why). The owner's floor, with the ratio test on the bound.

    `reverts` is True only when the canary is BOTH at or above the owner's
    two-death floor AND worse than 1.25x control with 95% one-sided confidence.
    The `why` always names the denominator, because a rate without one is how
    this project has been wrong before.
    """
    cr = canary_deaths / canary_bot_h if canary_bot_h else 0.0
    kr = control_deaths / control_bot_h if control_bot_h else None
    base = ('%d canary deaths in %.1f bot-h (%.3f/bh) vs %d control deaths in %.1f bot-h (%s/bh)'
            % (canary_deaths, canary_bot_h, cr, control_deaths, control_bot_h,
               '%.3f' % kr if kr is not None else 'n/a'))
    if canary_deaths < floor:
        return False, 'below the owner\'s %d-death floor: %s' % (floor, base)
    if kr is None or control_bot_h <= 0:
        return False, 'no control exposure to compare against: %s' % base
    lb = ratio_lower_bound(canary_deaths, canary_bot_h, control_deaths, control_bot_h, alpha)
    point = cr / kr if kr else float('inf')
    if lb > threshold:
        head = ('death gate: %s; rate ratio %.2fx, lower %d%% bound %.2fx > %.2fx'
                % (base, point, round((1 - alpha) * 100), lb, threshold))
        # OWNER DECISION 2026-09-24: the lower bound is a PARAMETRIC Poisson bound, and
        # deaths are not Poisson across worlds -- bots in a world share terrain, a seed and
        # a server, so a single hazard puts several deaths in one pool. Permuting WHOLE
        # POOLS preserves that clustering, which is exactly what the parametric bound
        # cannot. So the trip now also needs an in-window randomization p.
        if units and treat:
            try:
                p, n = randomization_p(units, treat)
            except TooFewAssignments as e:
                return True, (head + '; randomization p NOT COMPUTED (%s) -- the owner\'s '
                              'rule stands alone, which is the safe direction for deaths'
                              % e)
            if 1.0 / n > max_p:
                return True, (head + '; randomization p unattainable at this shape (%d '
                              'assignments, smallest attainable p = %.4f > %.2f) -- the '
                              'owner\'s rule stands alone. Run >= 2 pools for anything '
                              'that can kill.' % (n, 1.0 / n, max_p))
            note = ('; randomization p = %.4f over %d same-shape assignments (ceiling %.2f)'
                    % (p, n, max_p))
            # REPORT-ONLY BY DEFAULT. Backtested 2026-09-24 against all 15 reverts where
            # deaths entered the decision: as an AND-condition the p flips 4 of the 5 trips
            # of the OLD point-ratio gate, and one of those four is `3810457` (rl-08b) -- a
            # revert whose harm is causally established and which CLAUDE.md carries as a
            # standing lesson (a corridor refusal failed the explore leg and the blind
            # fallback walked into the pool the guard had named one second earlier).
            #
            # It fails there for a MECHANICAL reason, not bad luck: both canary deaths were
            # THE SAME BOT. A pool carrying two deaths is reachable by 29 of the other 120
            # pool-pairs, so a pool-level null cannot tell "the change killed one bot twice"
            # from "that pool had a bad bot". Harm concentrated BELOW the unit of
            # randomization is invisible to a test at that unit -- and concentrated harm is
            # exactly what a code defect produces. That is a property of the design, not a
            # tuning problem, so no ceiling fixes it.
            #
            # On the gate that is actually LIVE (the lower bound above) the p is inert: it
            # changes 0 of those 15 decisions, because the bound already holds fire
            # everywhere the point ratio did not. So as a veto it buys nothing where it
            # works and costs a correct revert where it bites. It is reported on every death
            # verdict, and `p_vetoes=True` is required to let it change one.
            if p > max_p:
                if not p_vetoes:
                    return True, (head + note + ' -- REPORT ONLY, above the ceiling but not '
                                  'vetoing (a pool-level p cannot see harm concentrated in '
                                  'one bot; rl-08b 3810457 was a correct revert at p=0.2417)')
                return False, ('death gate HELD by the in-window randomization p: %s%s > %.2f '
                               '-- this many canary deaths is ordinary for this window under '
                               'a null reassignment' % (head, note, max_p))
            return True, head + note + ' <= ceiling'
        return True, (head + '; randomization p NOT SUPPLIED (no unit-level deaths passed) '
                      '-- the owner\'s rule stands alone')
    return False, ('death gate HELD (reported, not a verdict): %s; rate ratio %.2fx but lower '
                   '%d%% bound %.2fx does not clear %.2fx -- too few deaths to tell it from noise'
                   % (base, point, round((1 - alpha) * 100), lb, threshold))
