#!/usr/bin/env python3
"""keep180_deaths.py <bins2.pkl>  -- the DEATH-gate half of the KEEP-at-+180 calibration (10-08). A bag fix KEEPs only if
the all-cause death gate (deathgate: >= 2 canary deaths AND lower bound of canary/control POST rate ratio > 1.25,
polled every 5 min) has NOT tripped by the KEEP read. False KEEP = a change that kills at k x the base rate and has not
tripped by then. Design A: 4 random drawable pools, KEEP read at +180; design B (today): 2 pools at +360. Same bins and
estimator as usafe_null.py (usafe_bins.py: the live gate's own rows; end+cross exposure), the same per-pool own-rate
Poisson injection. Windows start hourly over the bins; draws: up to 10 random subsets per window per design (seeded)."""
import sys, os, random, math, itertools, pickle
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.expanduser('~/mcai-analysis')):
    sys.path.insert(0, p)
from deathgate import _binom_sf
D = pickle.load(open(sys.argv[1], 'rb'))
assert D.get('format') == 'end+cross'
B = D['bins']; X = D['cross']; BIN = 300
pool_of = lambda b: '-'.join(b.split('-')[:2])
bots = sorted(b for b in B if B[b])
lo = min(min(v) for v in B.values() if v); hi = max(max(v) for v in B.values() if v); N = hi - lo + 1
pools = sorted({pool_of(b) for b in bots})
DRAWABLE = [p for p in pools if p != 'placebo-c' and not p.startswith('isolated')]


def prefix(key):
    out = {}
    for p in pools:
        s = [0.0] * (N + 1)
        for i in range(N):
            s[i + 1] = s[i] + sum(B[b].get(i + lo, {}).get(key, 0) for b in bots if pool_of(b) == p)
        out[p] = s
    return out


PE, PD = prefix('end'), prefix('death')
XP = defaultdict(lambda: defaultdict(list))
for b in bots:
    for S_, E_, v in X.get(b, []):
        for a_ in range(S_ - lo + 1, E_ - lo + 1):
            XP[pool_of(b)][a_].append((E_ - lo, v))
win = lambda P, p, a, z: P[p][max(0, min(N, z))] - P[p][max(0, min(N, a))]


def expo(p, a, z):
    a = max(0, min(N, a)); z = max(0, min(N, z))
    return PE[p][z] - PE[p][a] - sum(v for E_, v in XP[p].get(a, ()) if E_ < z) if z > a else 0.0


rate = {p: PD[p][N] / (expo(p, 0, N) / 3600) for p in pools if expo(p, 0, N)}


def lb_exceeds(a, ta, c, tc, thr=1.25, alpha=0.05):
    if a <= 0 or ta <= 0 or tc <= 0:
        return False
    n = a + c if c > 0 else a
    return _binom_sf(a, n, thr * ta / (tc + thr * ta)) < alpha


def pois(lam):
    L = math.exp(-lam); k = 0; q = 1.0
    while True:
        q *= random.random()
        if q <= L:
            return k
        k += 1


DESIGNS = {'A (4 pools, +180)': (4, 180, None), 'B (2 pools, +360, today)': (2, 360, None), 'C (4 pools, +360)': (4, 360, None),
           "A' (4 pools; +180 only if canary death rate <= control's, else +360)": (4, 360, 1.0)}
print('bins: %d bots, %.0f bot-h' % (len(bots), sum(expo(p, 0, N) for p in pools) / 3600))
for d, (k, W, screen) in DESIGNS.items():
    L = W * 60 // BIN; L180 = 180 * 60 // BIN
    for mult in (1.0, 2.0, 3.0, 5.0):
        random.seed(17 + k + int(mult * 10)); trips = 0; n = 0; early = 0
        for i0 in range(0, N - L, 3600 // BIN):
            combos = list(itertools.combinations(DRAWABLE, k))
            for draw in random.Random(i0 * 10 + k).sample(combos, min(10, len(combos))):
                ctl = [p for p in pools if p not in draw]
                extra = 0; tripped = False; kept_early = False
                for i in range(i0, i0 + L):
                    if mult > 1:
                        mu = sum((mult - 1) * rate.get(p, 0) * (expo(p, i0, i + 1) - expo(p, i0, i)) / 3600 for p in draw)
                        extra += pois(mu) if mu > 0 else 0
                    a = sum(win(PD, p, i0, i + 1) for p in draw) + extra
                    ta = sum(expo(p, i0, i + 1) for p in draw) / 3600
                    c = sum(win(PD, p, i0, i + 1) for p in ctl); tc = sum(expo(p, i0, i + 1) for p in ctl) / 3600
                    if a >= 2 and lb_exceeds(int(a), ta, int(c), tc):
                        tripped = True
                        break
                    if screen is not None and i == i0 + L180 - 1 and tc > 0 and ta > 0 and (a / ta) <= screen * (c / tc):
                        kept_early = True
                        break
                n += 1; trips += tripped; early += kept_early
        tag = 'false trip (no change)' if mult == 1 else 'k=%g: false KEEP (no trip by the KEEP read)' % mult
        print('%-70s %-44s %5.1f%%   (n=%d%s)' % (d, tag, 100 * ((trips / n) if mult == 1 else (1 - trips / n)), n,
                                               (', kept at +180: %.0f%%' % (100 * early / n)) if screen is not None else ''), flush=True)
