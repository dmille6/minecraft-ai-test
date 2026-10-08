#!/usr/bin/env python3
"""usafe_exposure.py <an.pkl>  -- is airpocket-01's read exposure powered on the pools it will be drawn on?

The read needs >= 2 MATURE canary attempts (airpocketread exposure_ready). An attempt needs a sealed drowning episode
(the trigger fires at once on a sealed scan) whose geometry and health admit the dig. Measured inputs:
  - sealed episodes per pool (ugsafe2_analyse.py water episodes, `sealed`), on the SAME null draws as usafe_null.py
    (the five pools, the draw's 12-h drowning filter, 2..4 pools);
  - admission share p: 43/170 = 25% of drowning sites qualify on today's save without ice (phase 2 section 2.1);
    60/170 = 35% with the ice branch. Non-fatal sealed episodes are assumed to qualify at the same share (stated:
    their geometry was not screened).
SEALED IS ALREADY CRITICAL (round 1, Codex asked for sealed AND crit): in an.pkl every one of the 544 sealed episodes is
also `crit` (2,375 episodes: 374 crit+sealed, 170 crit+sealed+fatal, 0 sealed without crit), so the count is unchanged.
THIS IS A CONDITIONAL ESTIMATE of ATTEMPTS, not a measurement: it assumes every sealed episode reaches the trigger and
that non-fatal ones are admitted at the fatal sites' share. The read itself (exposure_ready) is what decides.
Reports, per horizon, the expected sealed episodes and P(>= 2 attempts) = E[1 - Bin(n, p) <= 1], and the minute by which
half / 80% of draws reach 2 attempts in expectation -- the extension the registration needs.
"""
import sys, os, math, itertools
from collections import Counter
sys.argv = sys.argv[:2]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R
A = R.A; BIN = R.BIN
FIVE = ['hive-c', 'hive-d', 'placebo-a', 'placebo-b', 'placebo-d']
pool_of = lambda b: '-'.join(b.split('-')[:2])
lo = min(min(v) for v in A['bins'].values() if v); hi = max(max(v) for v in A['bins'].values() if v)
N = hi - lo + 1
H12, H24 = 12 * 3600 // BIN, 24 * 3600 // BIN
drown = Counter(); seal = Counter()
for b, bins in A['bins'].items():
    for k, c in bins.items():
        if c.get('death_drowning'):
            drown[(pool_of(b), k - lo)] += c['death_drowning']
for e in A['episodes']:
    if e.get('sealed'):
        seal[(pool_of(e['bot']), int(e['start'] // BIN) - lo)] += 1


def cnt(C, p, a, z):
    return sum(C[(p, i)] for i in range(max(0, a), min(N, z)))


def p_ge2(n, p):
    return 1 - (1 - p) ** n - n * p * (1 - p) ** max(0, n - 1)


print('sealed episodes, five pools, 5 days: %d; drowning deaths %d' % (sum(v for (p, _), v in seal.items() if p in FIVE),
                                                                         sum(v for (p, _), v in drown.items() if p in FIVE)))
for sizes, label in (((2, 3, 4), '2-4 pools (drawrec up to four)'), ((2,), '2 pools (10 bots)'), ((4,), '4 pools (20 bots)')):
    print('\n' + label)
    print('  horizon  draws  mean sealed eps   P(>=2 attempts) at p=0.25   p=0.35')
    for hz in (3, 6, 9, 12, 18, 26):
        L = hz * 3600 // BIN
        ns = []
        for i0 in range(H24, N - 26 * 3600 // BIN, 3600 // BIN):    # the same start set for every horizon
            qual = [p for p in FIVE if cnt(drown, p, i0 - H12, i0) >= 1]
            for m in sizes:
                for draw in itertools.combinations(qual, m):
                    ns.append(sum(cnt(seal, p, i0, i0 + L) for p in draw))
        if not ns:
            continue
        print('  %4d h  %5d    %6.2f            %6.1f%%                    %6.1f%%' % (
            hz, len(ns), sum(ns) / len(ns), 100 * sum(p_ge2(n, .25) for n in ns) / len(ns), 100 * sum(p_ge2(n, .35) for n in ns) / len(ns)))
