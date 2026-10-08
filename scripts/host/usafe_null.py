#!/usr/bin/env python3
"""usafe_null.py <bins.pkl>  -- calibrate the UNDERGROUND-SAFETY death gate (gate v34, scripts/usaferule.py) on a null of
no-change draws, and measure its power against a fix that doubles (k=2) or triples (k=3) deaths.

DATA: usafe_bins.py's bins -- the LIVE gate's own rows, stored as end-credited pairs plus bin-crossing pairs, so that a
bin-aligned window's exposure here is EXACTLY usafegate's (a pair counts only when both rows are inside the window; round
2, Codex: crediting each gap to its start bin counted the last gap of every window, which the live scan never sees).
POSITIVE CONTROL 1 (asserted, exit 1 on failure): exposure and deaths from the bins equal usafegate.scan on the real logs
for 60 random bot-windows (lengths 1 bin .. 24 h), to 1e-6.
DRAW SCHEMES (a no-change canary as the loop would draw it; the draw's filter at the draw instant is approximated by
">= 1 drowning death in the prior 12 h" -- the registration also asks >= 3 oxygen-0 ceilings, and a drowning is nearly
always inside one):
  FIVE     every subset of 2..4 qualifying pools among hive-c, hive-d, placebo-a, placebo-b, placebo-d, equal weight;
  DRAWREC  closer to drawrec.sh: any pool but placebo-c/isolated-* that qualifies; size = min(4, qualifying) (drawrec
           takes the largest available up to four); up to 10 random subsets per window. NOT replicated: the +-25/40%
           productivity band, the 12-h per-pool exclusion and the trapped-bot preference (stated).
Windows start every hour; PRE is the 24 h before; polls every 5 min; control = every other bot.
GATES, each polled: XS (today's: canary POST vs control POST), MPC (canary vs the undrawn drowning pools of the five),
DID24 (v34), HYB (DID24 OR MPC at the same threshold: round 1, Claude asked whether the matched-pool control buys the
power DID24 lacks in the elevated stratum). Each at thresholds 1.25 .. 2.5.
UNCERTAINTY (round 1, Claude): windows start hourly and overlap, so the n below is not the effective sample size. For the
v34 gate at its threshold the false-trip rate also gets a DAY-BLOCK BOOTSTRAP (windows grouped by the UTC day they start;
days resampled with replacement, 2,000 reps, percentile 95% interval), and the number of non-overlapping windows the
data holds is printed beside it.
COVERAGE (round 1, Claude: the 25% bot-share rule was untested on the fleet): for every no-change window, the share of
polls (POST > 1 h) at which a roster bot (>= 25% of PRE) logged < 25% of the POST -- the live gate's UNREADABLE -- and the
share of windows UNREADABLE at their final poll. Deploy restarts are NOT in this data (no deploy happened in these
windows), so it is the floor of the UNREADABLE rate, not its level.
POWER: extra canary POST deaths injected per bin, Poisson with mean sum over the drawn pools of (k-1) x that POOL's own
5-day rate x the exposure that bin ADDS to the live POST window (expo(i0, i+1) - expo(i0, i); round 3, Codex) (round 2, Codex: the first version averaged the pool rates equally and
multiplied by the combined exposure, which is not a doubling of each pool's own deaths when exposure is unequal).
POSITIVE CONTROL 2 (asserted, exit 1 on failure): the fast trip test equals usaferule.did_gate AT EACH THRESHOLD on 2,000
random cases (round 1, Codex: the first version compared 2.0 with 1.25 and only printed the disagreement count).
"""
import sys, os, random, math, itertools, pickle, datetime as dt
from collections import Counter, defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..'), os.path.expanduser('~/mcai-analysis')):
    sys.path.insert(0, p)
from deathgate import _binom_sf, ratio_lower_bound
import usaferule as U
import usafegate as G

D = pickle.load(open(sys.argv[1], 'rb'))
assert D.get('format') == 'end+cross', 'bins.pkl is the old start-credited format: rebuild it with usafe_bins.py'
B = D['bins']; X = D['cross']; BIN = 300
FIVE = ['hive-c', 'hive-d', 'placebo-a', 'placebo-b', 'placebo-d']
pool_of = lambda b: '-'.join(b.split('-')[:2])
bots = sorted(b for b in B if B[b])
lo = min(min(v) for v in B.values() if v); hi = max(max(v) for v in B.values() if v)
N = hi - lo + 1
pools = sorted({pool_of(b) for b in bots})
DRAWABLE = [p for p in pools if p != 'placebo-c' and not p.startswith('isolated')]
THRS = [float(x) for x in os.environ.get('THRS', '1.25,1.5,2.0,2.5').split(',')]


def prefix(key):
    out = {}
    for p in pools:
        s = [0.0] * (N + 1)
        for i in range(N):
            s[i + 1] = s[i] + sum(B[b].get(i + lo, {}).get(key, 0) for b in bots if pool_of(b) == p)
        out[p] = s
    return out


PE, PD, PDR = prefix('end'), prefix('death'), prefix('drown')
BPE = {}
for _b in bots:
    _s = [0.0] * (N + 1)
    for _i in range(N):
        _s[_i + 1] = _s[_i] + B[_b].get(_i + lo, {}).get('end', 0)
    BPE[_b] = _s
win = lambda P, p, a, z: P[p][max(0, min(N, z))] - P[p][max(0, min(N, a))]
# crossing pairs: for each bin index a (relative), the pairs (E, v) with start bin < a <= end bin. A window [a, z)
# excludes exactly those with E < z (their start row is before the window; their end-credit sits inside it).
XB = defaultdict(lambda: defaultdict(list)); XP = defaultdict(lambda: defaultdict(list))
for _b in bots:
    for S_, E_, v in X.get(_b, []):
        for a_ in range(S_ - lo + 1, E_ - lo + 1):
            XB[_b][a_].append((E_ - lo, v)); XP[pool_of(_b)][a_].append((E_ - lo, v))


def expo(p, a, z):
    """Seconds of exposure of pool p on bins [a, z) -- usafegate's estimator, exactly."""
    a = max(0, min(N, a)); z = max(0, min(N, z))
    return PE[p][z] - PE[p][a] - sum(v for E_, v in XP[p].get(a, ()) if E_ < z) if z > a else 0.0


def expo_bot(b, a, z):
    a = max(0, min(N, a)); z = max(0, min(N, z))
    return BPE[b][z] - BPE[b][a] - sum(v for E_, v in XB[b].get(a, ()) if E_ < z) if z > a else 0.0


rate5d = {p: PD[p][N] / (expo(p, 0, N) / 3600) for p in pools if expo(p, 0, N)}

# POSITIVE CONTROL 1: the bins reproduce the live scan on real logs
_rng = random.Random(3); _bad = []
_ep = lambda i: dt.datetime.fromtimestamp((i + lo) * BIN, dt.timezone.utc)
for _ in range(60):
    _b = _rng.choice(bots); _L = _rng.choice([1, 2, 3, 12, 72, 288]); _a = _rng.randint(1, N - _L - 1)
    _h, _ds, _ = G.scan(D['root'], _b, _ep(_a), _ep(_a + _L))
    _e = expo_bot(_b, _a, _a + _L); _d = sum(B[_b].get(i + lo, {}).get('death', 0) for i in range(_a, _a + _L))
    if abs(_h * 3600 - _e) > 1e-6 or len(_ds) != _d:
        _bad.append((_b, _a, _L, _h * 3600, _e, len(_ds), _d))
print('POSITIVE CONTROL 1: bins vs usafegate.scan on real logs, 60 bot-windows: %d mismatches %s' % (len(_bad), _bad[:3]), flush=True)
if _bad:
    sys.exit('positive control 1 FAILED')


def lb_exceeds(a, ta, b, tb, c, alpha=0.05):
    """EXACTLY ratio_lower_bound(a, ta, b, tb) > c (one binomial tail)."""
    if a <= 0 or ta <= 0 or tb <= 0:
        return False
    n = a + b if b > 0 else a
    return _binom_sf(a, n, c * ta / (tb + c * ta)) < alpha


random.seed(7)
bad = 0
for _ in range(2000):
    a = random.randint(0, 20); b = random.randint(0, 40); ta = random.uniform(5, 300); tb = random.uniform(20, 600)
    c = random.randint(0, 60); tc = random.uniform(50, 1500); d = random.randint(0, 200); td = random.uniform(200, 4000)
    rk = U.control_ratio(c, tc, d, td)
    for t in THRS + [U.THRESHOLD]:
        g = U.did_gate(a, ta, b, tb, c, tc, d, td, ratio_lower_bound, threshold=t)[0]
        bad += bool(g) != (a >= 2 and lb_exceeds(a, ta, b, tb, t * rk))
print('POSITIVE CONTROL: fast test vs usaferule.did_gate at thresholds %s: %d disagreements in %d comparisons'
      % (THRS + [U.THRESHOLD], bad, 2000 * (len(THRS) + 1)), flush=True)
if bad:
    sys.exit('positive control FAILED')
tot = lambda P, ps: sum(P[p][N] for p in ps)
tex = lambda ps: sum(expo(p, 0, N) for p in ps)
rest = [p for p in pools if p not in FIVE]
print('bins: %d bots, %d unreadable files; live-estimator bot-h %.0f; five pools %.4f deaths/bh, the rest %.4f (%.2fx)' % (
    len(bots), D['errors'], tex(pools) / 3600, tot(PD, FIVE) / (tex(FIVE) / 3600), tot(PD, rest) / (tex(rest) / 3600),
    (tot(PD, FIVE) / tex(FIVE)) / (tot(PD, rest) / tex(rest))), flush=True)
# the injection's own check: unequal exposure must not change a pool's doubling (round 2, Codex)
_lam = lambda rates, secs, k: sum((k - 1) * r * s_ / 3600 for r, s_ in zip(rates, secs))
assert abs(_lam([0.10, 0.01], [3600, 36000], 2) - 0.20) < 1e-12, 'injection is not per-pool own-rate'



def pois(lam):
    L = math.exp(-lam); k = 0; p = 1.0
    while True:
        p *= random.random()
        if p <= L:
            return k
        k += 1


H12, H24 = 12 * 3600 // BIN, 24 * 3600 // BIN


def draws_at(i0, scheme):
    if scheme == 'FIVE':
        qual = [p for p in FIVE if win(PDR, p, i0 - H12, i0) >= 1]
        return [d for m in (2, 3, 4) for d in itertools.combinations(qual, m)]
    qual = [p for p in DRAWABLE if win(PDR, p, i0 - H12, i0) >= 1]
    if len(qual) < 2:
        return []
    m = min(4, len(qual))
    combos = list(itertools.combinations(qual, m))
    return random.Random(i0).sample(combos, min(10, len(combos)))   # the same draws for every k and stratum


def run(horizon_h, k, scheme, stratum, per_window=None, cov=None):
    L = int(horizon_h * 3600 / BIN); S = 3600 // BIN
    res = Counter(); n = 0
    for i0 in range(H24, N - L, S):
        for draw in draws_at(i0, scheme):
            if stratum == 'hive-d' and 'hive-d' not in draw:
                continue
            ctl = [p for p in pools if p not in draw]
            mpc = [p for p in FIVE if p not in draw]
            b = sum(win(PD, p, i0 - H24, i0) for p in draw); tb = sum(expo(p, i0 - H24, i0) for p in draw) / 3600
            d = sum(win(PD, p, i0 - H24, i0) for p in ctl); td = sum(expo(p, i0 - H24, i0) for p in ctl) / 3600
            if stratum == 'elevated' and not (tb and td and d and (b / tb) / (d / td) >= 2.0):
                continue
            n += 1
            tripped = set(); extra = 0
            if cov is not None:
                roster = [b for b in bots if pool_of(b) in draw and expo_bot(b, i0 - H24, i0) >= 0.25 * 24 * 3600]
                blind = 0; polls = 0; last = False
                for i in range(i0 + 12, i0 + L):
                    el = (i + 1 - i0) * BIN
                    last = any(expo_bot(b, i0, i + 1) < 0.25 * el for b in roster)
                    blind += last; polls += 1
                cov.append((blind / polls if polls else 0.0, last, len(roster)))
            for i in range(i0, i0 + L):
                if k > 1:
                    # the exposure this poll ADDS to the live POST window (round 3, Codex: not the raw end-bin credit,
                    # which includes a pair whose start row is before the window)
                    mu = _lam([rate5d.get(p, 0) for p in draw], [expo(p, i0, i + 1) - expo(p, i0, i) for p in draw], k)
                    if mu > 0:
                        extra += pois(mu)
                a = sum(win(PD, p, i0, i + 1) for p in draw) + extra
                if a < 2:
                    continue
                ta = sum(expo(p, i0, i + 1) for p in draw) / 3600
                c = sum(win(PD, p, i0, i + 1) for p in ctl); tc = sum(expo(p, i0, i + 1) for p in ctl) / 3600
                cm = sum(win(PD, p, i0, i + 1) for p in mpc); tm = sum(expo(p, i0, i + 1) for p in mpc) / 3600
                rk = U.control_ratio(c, tc, d, td)
                for t in THRS:
                    if ('XS', t) not in tripped and lb_exceeds(int(a), ta, int(c), tc, t):
                        tripped.add(('XS', t))
                    if ('MPC', t) not in tripped and tm > 0 and lb_exceeds(int(a), ta, int(cm), tm, t):
                        tripped.add(('MPC', t))
                    if ('DID24', t) not in tripped and tb > 0 and rk and lb_exceeds(int(a), ta, int(b), tb, t * rk):
                        tripped.add(('DID24', t))
                    if (('DID24', t) in tripped or ('MPC', t) in tripped):
                        tripped.add(('HYB', t))
            res.update(tripped)
            if per_window is not None:
                per_window.append((int((i0 + lo) * BIN // 86400), tripped))
    return n, {g: v / n for g, v in res.items()} if n else {}


gates = ['XS', 'MPC', 'DID24', 'HYB']


def boot(pw, key, reps=2000):
    days = sorted({d for d, _ in pw})
    by = {d: [key in tr for dd, tr in pw if dd == d] for d in days}
    rng = random.Random(11); est = []
    for _ in range(reps):
        xs = [x for d in (rng.choice(days) for _ in days) for x in by[d]]
        est.append(sum(xs) / len(xs))
    est.sort()
    return len(days), est[int(0.025 * reps)], est[int(0.975 * reps) - 1]


print('\nUNCERTAINTY of the false-trip rate (k=1), day-block bootstrap; and COVERAGE (the 25%% bot-share rule) on no-change windows')
for scheme in ('FIVE', 'DRAWREC'):
    for hz in (6, 26):
        pw = []; cov = []
        random.seed(1000 + 10 + hz + (0 if scheme == 'FIVE' else 7))
        n, r = run(hz, 1.0, scheme, 'all', per_window=pw, cov=cov)
        span_h = (N - H24) * BIN / 3600
        line = '  %-7s %2dh n=%4d (non-overlapping windows in the data: ~%.0f)' % (scheme, hz, n, span_h / hz)
        for key in (('DID24', U.THRESHOLD), ('MPC', U.THRESHOLD), ('HYB', U.THRESHOLD)):
            nd, l, h = boot(pw, key)
            line += '  %s@%s %.1f%% [%.1f, %.1f] (%d days)' % (key[0], key[1], 100 * r.get(key, 0), 100 * l, 100 * h, nd)
        print(line)
        print('            coverage: polls UNREADABLE (POST > 1 h) %.1f%% of all; windows UNREADABLE at the final poll %.1f%%; '
              'mean roster %.1f bots' % (100 * sum(c[0] for c in cov) / max(1, len(cov)), 100 * sum(c[1] for c in cov) / max(1, len(cov)),
                                         sum(c[2] for c in cov) / max(1, len(cov))), flush=True)

for scheme in ('FIVE', 'DRAWREC'):
    for stratum in ('all', 'elevated', 'hive-d'):
        print('\n%s draws, stratum %s (P(trip at any 5-min poll))' % (scheme, stratum))
        print('  hz  k    n   ' + '  '.join('%-5s@%-4s' % (g, t) for g in gates for t in THRS))
        for hz in (6, 26):
            for k in (1.0, 2.0, 3.0):
                random.seed(1000 + int(10 * k) + hz + (0 if scheme == 'FIVE' else 7))
                n, r = run(hz, k, scheme, stratum)
                print('  %2d %3.0f %5d  ' % (hz, k, n) + '  '.join('%9.1f%%' % (100 * r.get((g, t), 0)) for g in gates for t in THRS), flush=True)
