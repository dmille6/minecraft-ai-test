#!/usr/bin/env python3
"""Does the gate's false-positive rate actually improve? Measured head to head, on real data.

THE DEFECT. A canary gate that compares a difference-in-differences to a TYPED threshold is
comparing it to a number calibrated on some other window. Measured 2026-09-23 on the exact
randomization distribution of all 120 two-pool assignments, that gives a false-positive rate of
13.3% against a nominal 5% -- the gate reverts roughly three times more often than it claims.

THE FIX. Take the threshold from the read's OWN window by randomization. Under the sharp null the
assignment labels are exchangeable, so the estimator's distribution over every assignment the draw
could have produced IS its null, whatever that day's scale and tail happen to be.

THIS FILE IS THE TEST OF THE FIX, not an argument for it. It runs both rules over real
single-build telemetry -- where there is NO treatment effect by construction, so every rejection is
a false positive -- and reports the two rates side by side. If the randomization rule does not land
near nominal, the fix is wrong and should be abandoned rather than explained.

Four blocks of equal length: A_pre, A_post calibrate the transferred threshold; B_pre, B_post are
the read. That is exactly the situation the gate is in -- a number from earlier, applied now.

Run on the bots host:  python3 gatefpr.py --hours 6 --trials 120
"""
import argparse
import collections
import datetime as dt
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from telemetry import Events          # noqa: E402
from exposure import Spans            # noqa: E402
from arms import pool_of              # noqa: E402
import cuped                          # noqa: E402
from cuped import Block, contrast, in_window_p   # noqa: E402


def blocks(hours):
    """Four consecutive equal blocks of per-bot items/bot-hour, newest last."""
    now = dt.datetime.now(dt.timezone.utc)
    edges = [now - dt.timedelta(hours=hours * (4 - i) / 4) for i in range(5)]
    ev = Events.load(since_minutes=int(hours * 60) + 5)
    items = [collections.Counter() for _ in range(4)]
    spans = [Spans() for _ in range(4)]
    for r in ev.rows:
        b = (r['bot'] or {}).get('name')
        if not b or b.startswith('self-'):
            continue
        for k in range(4):
            if edges[k] <= r['t'] < edges[k + 1]:
                spans[k].add(b, b, r['t'])
                d = (r['raw'].get('skill') or {}).get('inventory_delta') or {}
                g = sum(v for v in d.values() if v > 0)
                if g:
                    items[k][b] += g
                break
    out = []
    for k in range(4):
        rates = {}
        for b in spans[k].groups():
            h = spans[k].hours(b, allow_zero=True)
            if h > 0.05:
                rates[b] = items[k].get(b, 0) / h
        out.append(Block(f'blk{k}', edges[k], edges[k + 1], rates))
    return out, len(ev.rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=float, default=6.0)
    ap.add_argument('--trials', type=int, default=120)
    ap.add_argument('--alpha', type=float, default=0.05)
    ap.add_argument('--pools', type=int, default=2)
    ap.add_argument('--reverse', action='store_true',
                    help='calibrate on the LATER window and evaluate on the earlier '
                         'one -- the transferred threshold is direction-dependent')
    ap.add_argument('--seed', type=int, default=5)
    a = ap.parse_args()

    (b0, b1, b2, b3), nrows = blocks(a.hours)
    # --reverse swaps which pair calibrates and which is read.
    (a_pre, a_post, b_pre, b_post) = (b2, b3, b0, b1) if a.reverse else (b0, b1, b2, b3)
    common = sorted(set(a_pre.rates) & set(a_post.rates) & set(b_pre.rates) & set(b_post.rates))
    worlds = sorted({pool_of(b) for b in common})
    print(f'{nrows:,} rows over {a.hours}h in four {a.hours/4:.1f}h blocks')
    print(f'positive control: {len(common)} bots present in ALL FOUR blocks across {len(worlds)} worlds')
    if len(common) < 40 or len(worlds) < 8:
        raise SystemExit(f'NotAnInstrument: {len(common)} bots / {len(worlds)} worlds. An 80-bot '
                         f'fleet in 16 worlds does not look like this.')

    rng = random.Random(a.seed)
    wmap = collections.defaultdict(list)
    for b in common:
        wmap[pool_of(b)].append(b)

    def draw():
        chosen = rng.sample(worlds, a.pools)
        t = sorted(b for w in chosen for b in wmap[w])
        return t, sorted(b for b in common if b not in set(t))

    # --- the transferred threshold, calibrated on window A ------------------------------------
    nullA = []
    for _ in range(400):
        t, c = draw()
        try:
            nullA.append(contrast(a_post, t, c) - contrast(a_pre, t, c))
        except Exception:
            pass
    nullA.sort(key=abs)
    thr = abs(nullA[min(len(nullA) - 1, int((1 - a.alpha) * len(nullA)))])
    print(f'\ntransferred threshold from window A: |DiD| > {thr:.4f} (log units), '
          f'{len(nullA)} null draws')

    # --- both rules on window B, where there is STILL no effect -------------------------------
    typed_hits = rand_hits = usable = 0
    ps = []
    for _ in range(a.trials):
        t, c = draw()
        try:
            did = contrast(b_post, t, c) - contrast(b_pre, t, c)
            p, n, _r = in_window_p(b_pre, b_post, t, c, pool_of)
        except Exception:
            continue
        usable += 1
        ps.append(p)
        if abs(did) > thr:
            typed_hits += 1
        if p <= a.alpha:
            rand_hits += 1

    print(f'\n{usable} usable reads on window B, each with NO treatment effect '
          f'(single build, arms drawn at random)')
    print(f'  nominal false-positive rate                : {100*a.alpha:.0f}%')
    print(f'  TRANSFERRED threshold (today\'s gate)       : {100*typed_hits/usable:5.1f}%  '
          f'({typed_hits}/{usable})')
    print(f'  IN-WINDOW randomization (the fix)          : {100*rand_hits/usable:5.1f}%  '
          f'({rand_hits}/{usable})')
    if ps:
        ps.sort()
        print(f'  p-value distribution: min {ps[0]:.3f}  median {ps[len(ps)//2]:.3f}  '
              f'max {ps[-1]:.3f}   (uniform under the null)')
    # A PROPER TEST, because my first version passed itself on an arbitrary +/-4pp tolerance.
    # At n=120, 10 hits is 8.3% with a 95% binomial interval of roughly 4%-15% -- consistent with
    # nominal 5% but equally consistent with 15%, so it could not have failed anything. An exact
    # binomial two-sided p against alpha says whether the observed rate is distinguishable from
    # nominal at all, and the interval says how much resolution the trial count bought.
    lo, hi = _wilson(rand_hits, usable)
    pbin = _binom_two_sided(rand_hits, usable, a.alpha)
    print(f'\n  randomization rate {100*rand_hits/usable:.1f}%  95% CI '
          f'[{100*lo:.1f}%, {100*hi:.1f}%]  exact binomial p vs nominal = {pbin:.3f}')
    tlo, thi = _wilson(typed_hits, usable)
    print(f'  transferred  rate {100*typed_hits/usable:.1f}%  95% CI '
          f'[{100*tlo:.1f}%, {100*thi:.1f}%]')

    ok_rand = pbin > 0.05
    print()
    if ok_rand:
        print(f'  RANDOMIZATION: not distinguishable from nominal (p={pbin:.3f}). Its p-values are'
              f' also\n                 roughly uniform, median {ps[len(ps)//2]:.2f}, which is the'
              f' signature that matters.')
    else:
        print(f'  RANDOMIZATION: DISTINGUISHABLE from nominal (p={pbin:.3f}) -- do not adopt it.')
    if not (tlo <= a.alpha <= thi):
        side = 'ANTI-conservative' if typed_hits / usable > a.alpha else 'OVER-conservative'
        print(f'  TRANSFERRED  : {side} in this window -- its CI excludes nominal. That is the')
        print(f'                 instability, and it is direction-dependent: 13.3% was measured')
        print(f'                 one way and 1.7% reversed. A gate cannot be calibrated by it.')
    else:
        print(f'  TRANSFERRED  : happens to contain nominal in THIS window, which is not the same')
        print(f'                 as being calibrated -- run --reverse to see the other direction.')
    return 0 if ok_rand else 1


def _wilson(k, n, z=1.96):
    if not n:
        return 0.0, 0.0
    ph = k / n
    d = 1 + z * z / n
    c = ph + z * z / (2 * n)
    h = z * ((ph * (1 - ph) / n + z * z / (4 * n * n)) ** 0.5)
    return max(0.0, (c - h) / d), min(1.0, (c + h) / d)


def _binom_two_sided(k, n, p0):
    from math import comb
    def pmf(i):
        return comb(n, i) * (p0 ** i) * ((1 - p0) ** (n - i))
    obs = pmf(k)
    return min(1.0, sum(pmf(i) for i in range(n + 1) if pmf(i) <= obs * (1 + 1e-12)))


if __name__ == '__main__':
    sys.exit(main())
