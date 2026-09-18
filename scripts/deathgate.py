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


def death_gate(canary_deaths, canary_bot_h, control_deaths, control_bot_h,
               floor=2, threshold=1.25, alpha=0.05):
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
        return True, ('death gate: %s; rate ratio %.2fx, lower %d%% bound %.2fx > %.2fx'
                      % (base, point, round((1 - alpha) * 100), lb, threshold))
    return False, ('death gate HELD (reported, not a verdict): %s; rate ratio %.2fx but lower '
                   '%d%% bound %.2fx does not clear %.2fx -- too few deaths to tell it from noise'
                   % (base, point, round((1 - alpha) * 100), lb, threshold))
