#!/usr/bin/env python3
"""lib/cuped.py -- the estimator's algebra, its refusals, and four mutants that must kill it.

WHAT THIS CAN AND CANNOT PROVE. Every case here runs on SYNTHETIC panels with a known generating
process, because that is the only place ground truth exists. It proves the estimator computes what
it claims: beta recovers the correlation, the variance follows v(1-rho^2), the adjustment is wired
to the PRE term and not the post one, the leak guard fires, and the attenuation instrument can see
attenuation when there is some. It proves NOTHING about whether the fleet's rho is worth having --
that is mdereplay.py --cuped on real telemetry, and it is a different question.

THE CASES WITH EXACT ANSWERS, which are the ones worth having:

  rho = 0   beta* -> 0, so D_adj -> X_post and the sd ratio -> 1/sqrt(2) = 0.707. A DiD against an
            UNCORRELATED pre-period is strictly worse than not differencing at all: it adds a
            whole block of independent noise for nothing. This is the case that shows the plain
            estimator is not automatically the safe one.
  rho = 1   beta* -> 1 and CUPED reduces to the plain DiD exactly.

MUTANTS. CLAUDE.md: a source test that has never been seen to fail is not a test, and a mutant
that silently fails to apply reads as "killed". So each one asserts its anchor is PRESENT and
UNIQUE before substituting, and each is checked to break a NAMED assertion rather than just "some
test". They are written to a temp directory and imported from there -- never into scripts/lib,
because `mutants-must-not-write-into-src` records the runner SIGKILLing a test that did.
"""
import atexit
import importlib.util
import math
import os
import random
import shutil
import statistics as st
import sys
import tempfile
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
import cuped                                                          # noqa: E402
from cuped import (Block, DegenerateBlock, LeakyFit, StaleBeta, attenuation,  # noqa: E402
                   conditional_bias, contrasts_over, estimate, fit_beta, inject,
                   mde_from_sd_log, mde_z, null_summary, plain_fit, pool_offsets, rho_by_gap)

SRC = os.path.join(HERE, 'lib', 'cuped.py')
T0 = dt.datetime(2026, 9, 20, 0, 0, tzinfo=dt.timezone.utc)
WORLDS = [f'{p}-{s}' for p in ('board', 'hive', 'isolated', 'placebo') for s in 'abcd']
BOTS = [f'{w}-{n}' for w in WORLDS for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]

ok = []


def check(name, got, want, why=''):
    good = (got == want)
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}" + ('' if good else f'  got {got!r} want {want!r}'))
    if not good and why:
        print(f'         {why}')
    return good


def near(name, got, want, tol, why=''):
    good = (got == got) and abs(got - want) <= tol           # got==got rejects nan
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}: {got:+.4f} vs {want:+.4f} (tol {tol})")
    if not good and why:
        print(f'         {why}')
    return good


# ---------------------------------------------------------------------------------------------
# A synthetic fleet with a KNOWN amount of persistent structure.
# ---------------------------------------------------------------------------------------------
def panel(seed, n_blocks, persist, hours=3.0, noise=0.8, base=5.0):
    """Blocks of per-bot rates. `persist` in [0,1] sets how much of a bot's level carries over.

    rate(i, b) = base * exp(persist * a_i + sqrt(1 - persist^2) * e_ib), lognormal so rates are
    positive and right-skewed the way the real endpoint is. persist=1 is a pure fixed effect,
    persist=0 is independent noise every block.
    """
    rng = random.Random(seed)
    a = {b: rng.gauss(0, 1) for b in BOTS}
    out = []
    for k in range(n_blocks):
        start = T0 + dt.timedelta(hours=hours * k)
        rates = {}
        for b in BOTS:
            z = persist * a[b] + math.sqrt(max(0.0, 1 - persist ** 2)) * rng.gauss(0, 1)
            rates[b] = base * math.exp(noise * z)
        out.append(Block(f'b{k}', start, start + dt.timedelta(hours=hours), rates))
    return out


def pool_draws(seed, n, n_pools=2):
    """n pseudo-canaries of `n_pools` whole worlds -- today's design, 10 treated vs 70 control."""
    rng = random.Random(seed)
    by = {}
    for b in BOTS:
        by.setdefault(b.rsplit('-', 1)[0], []).append(b)
    out = []
    for _ in range(n):
        chosen = rng.sample(sorted(by), n_pools)
        t = [b for w in chosen for b in by[w]]
        ts = set(t)
        out.append((t, [b for b in BOTS if b not in ts]))
    return out


print(__doc__.split('\n')[0])
print(f'\nsynthetic fleet: {len(BOTS)} bots in {len(WORLDS)} worlds')

# ---------------------------------------------------------------------------------------------
print('\n1. the MDE convention, derived rather than typed')
near('z = z_0.975 + z_0.80 = 2.8016', mde_z(), 2.8016, 0.0001,
     'the constant in every report; a typed 2.8016 cannot be checked against its alpha and power')
near('sd_log 0.321 -> +146% gain-side', mde_from_sd_log(0.321), 1.458, 0.002)
near('sd_log 0.289 -> +125% gain-side', mde_from_sd_log(0.289), 1.247, 0.002)
near('sd_log 0.321 -> -59% harm-side', mde_from_sd_log(0.321, direction='harm'), 0.593, 0.002,
     'a gate that REVERTS is priced by this one, not by the gain-side number')
check('gain and harm are different numbers',
      round(mde_from_sd_log(0.321), 3) != round(mde_from_sd_log(0.321, direction='harm'), 3), True)
try:
    mde_from_sd_log(0.3, direction='sideways')
    check('an unknown direction raises', 'returned', 'ValueError')
except ValueError:
    check('an unknown direction raises', 'ValueError', 'ValueError')

# ---------------------------------------------------------------------------------------------
print('\n2. beta* recovers the correlation, and the variance follows the algebra')
for persist, label in ((0.95, 'strongly persistent'), (0.6, 'moderate'), (0.0, 'no persistence')):
    bl = panel(11, 2, persist)
    dr = pool_draws(3, 400)
    f = fit_beta(dr, bl[0], bl[1], n_treat=10, n_ctrl=70)
    # beta* = cov/var(X_pre) and rho = cov/sqrt(var*var), so they agree only when the two block
    # variances match. Report the ratio rather than assuming it.
    pred = f.rho * math.sqrt(f.var_post / f.var_pre)
    near(f'{label}: beta* == rho*sqrt(v_post/v_pre)', f.beta, pred, 0.02)
    # var(D)=v_post+v_pre-2c, var(D_adj)=v_post(1-rho^2). Both from the same moments.
    near(f'{label}: sd_adj == sqrt(v_post(1-rho^2))',
         f.sd_adj, math.sqrt(f.var_post * (1 - f.rho ** 2)), 0.004)
    near(f'{label}: sd_plain == sqrt(v_post+v_pre-2c)',
         f.sd_plain, math.sqrt(f.var_post + f.var_pre - 2 * f.rho * math.sqrt(f.var_pre * f.var_post)),
         0.004)
    print(f'         rho {f.rho:+.3f} beta {f.beta:+.3f} sd {f.sd_plain:.4f} -> {f.sd_adj:.4f} '
          f'(x{f.sd_ratio:.3f}) MDE {100*f.mde(adjusted=False):+.0f}% -> {100*f.mde():+.0f}%')

print('\n   the two exact cases -- averaged over 24 panels, because the effective sample size')
print('   is the number of WORLDS (16), not the number of draws: se(rho) ~ 1/sqrt(16) = 0.25, so')
print('   one panel cannot resolve beta* to better than ~0.25 no matter how many trials it runs.')


def mean_fit(persist, n_panels=24, trials=200):
    fs = [fit_beta(pool_draws(3, trials), *panel(100 + k, 2, persist)[:2], n_treat=10, n_ctrl=70)
          for k in range(n_panels)]
    return (st.mean([f.beta for f in fs]), st.mean([f.sd_ratio for f in fs]),
            st.pstdev([f.beta for f in fs]) / math.sqrt(n_panels))


b0, r0, se0 = mean_fit(0.0)
print(f'         rho=0 panels: mean beta {b0:+.4f} (se {se0:.4f}), mean sd ratio {r0:.4f}')
near('rho=0: beta* ~ 0', b0, 0.0, max(0.03, 3 * se0),
     'an uncorrelated pre-period should get no weight')
near('rho=0: sd ratio ~ 1/sqrt(2)', r0, 1 / math.sqrt(2), 0.03,
     'a DiD against an uncorrelated pre-period adds a whole block of noise for nothing')
b1, r1, se1 = mean_fit(1.0)
print(f'         rho=1 panels: mean beta {b1:+.4f} (se {se1:.4f}), mean sd ratio {r1:.4f}')
near('rho->1: beta* ~ 1', b1, 1.0, max(0.03, 3 * se1))
check('rho->1: CUPED is no better than plain DiD', r1 < 0.95, False,
      'when the pre-period predicts the post perfectly, differencing IS the optimal adjustment')

# ---------------------------------------------------------------------------------------------
print('\n3. attenuation -- and the positive controls that prove the instrument can see it')
bl = panel(11, 2, 0.7)
pre_b, post_b = bl[0], bl[1]
dr = pool_draws(5, 300)
fit = fit_beta(pool_draws(9, 400), *panel(77, 2, 0.7)[:2], n_treat=10, n_ctrl=70,
               provenance='fitted on a DISJOINT synthetic period')
fit = cuped.dataclasses.replace(fit, fit_start=T0 - dt.timedelta(days=5),
                               fit_end=T0 - dt.timedelta(days=4))
lam_mean, m, true, n, _ = attenuation(dr, pre_b, post_b, 0.30, fit)
near("stat='mean', uniform: lambda == 1 exactly", lam_mean, 1.0, 0.001,
     'multiplying every treated rate by (1+e) multiplies their arithmetic mean by exactly (1+e)')
print(f'         measured {m:+.4f} log vs true {true:+.4f} over {n} draws')

lam_trim, *_ = attenuation(dr, pre_b, post_b, 0.30, plain_fit(stat='trimmed'), stat='trimmed')
near("quantile trimming does NOT attenuate -- lambda == 1", lam_trim, 1.0, 0.002,
     'MEASURED, and it corrected my first positive control: quantile trimming is SCALE-'
     'EQUIVARIANT. A uniform lift moves every value, the same bots stay inside the trim, and '
     'the trimmed mean scales exactly. So this could never have been the control.')
p90 = sorted(post_b.rates.values())[int(0.90 * len(post_b.rates))]
lam_cap, *_ = attenuation(dr, pre_b, post_b, 0.30, plain_fit(stat=lambda v: st.mean([min(x, p90) for x in v])),
                          stat=lambda v: st.mean([min(x, p90) for x in v]))
check("POSITIVE CONTROL: winsorising at an ABSOLUTE p90 cap attenuates (lambda < 0.95)",
      lam_cap < 0.95, True,
      'THIS is what measured 0.63 on the fleet -- the cap does not move with the lift, so a '
      'capped statistic cannot register a change above the cap. If this does not come back '
      'below 1 the instrument cannot see attenuation and its lambda=1 for the mean means nothing')
print(f'         absolute-p90-cap lambda {lam_cap:.3f}  (fleet measurement was 0.63)')
lam_geom, *_ = attenuation(dr, pre_b, post_b, 0.30, plain_fit(stat='geom'), stat='geom')
check("POSITIVE CONTROL stat='geom' (mean-of-log1p) attenuates", lam_geom < 1.0, True,
      'mean-of-log1p is not scale-equivariant')
print(f'         geom lambda {lam_geom:.3f} at base rate 5 -- mild, because log1p is nearly log here')
# MEASURED, and it corrected a second guess of mine. I predicted log1p would "bite hardest at
# low rates, where the stuck bots are". It does not: log1p is equivariant in BOTH limits --
# log1p(r) -> r as r -> 0 (so the statistic becomes the arithmetic mean) and log1p(r) -> log(r)
# as r grows (so it becomes the geometric mean, which is also scale-equivariant). The
# attenuation is therefore worst in the MIDDLE, near r ~ 1, and it is mild everywhere. The
# lesson is not about log1p; it is that a plausible mechanism for attenuation has to be
# measured across the range before it is asserted, because both of my guesses about where it
# would bite were wrong.
scan = []
for base in (0.02, 0.3, 1.0, 5.0, 100.0):
    bl_s = panel(11, 2, 0.7, base=base)
    lam_s, *_ = attenuation(pool_draws(5, 150), bl_s[0], bl_s[1], 0.30,
                            plain_fit(stat='geom'), stat='geom')
    scan.append((base, lam_s))
print('         geom lambda by base rate: ' + '  '.join(f'{b}:{l:.3f}' for b, l in scan))
worst = min(scan, key=lambda x: x[1])
check('  geom attenuates at EVERY base rate (lambda < 1 throughout)',
      all(l < 0.999 for _, l in scan), True)
check(f'  and worst in the middle (at base {worst[0]}), not at the extremes',
      worst[0] not in (0.02, 100.0), True,
      'log1p -> arithmetic mean at r->0 and -> geometric mean at r->inf, both equivariant')

print('\n   pre-leakage: beta<1 attenuates LESS, which is an argument FOR CUPED')
E = 0.30
for phi in (0.0, 0.25, 0.5):
    lp, *_ = attenuation(dr, pre_b, post_b, E, plain_fit(), pre_leak=phi)
    lc, *_ = attenuation(dr, pre_b, post_b, E, fit, pre_leak=phi)
    # EXACT, not the 1-phi approximation I first wrote: the leak enters as log(1+e*phi), so
    # lambda = (log(1+e) - beta*log(1+e*phi)) / log(1+e). 1-beta*phi is its linearisation and is
    # off by 0.03 at phi=0.5, which is larger than the tolerance a test like this needs.
    lam = lambda b: (math.log1p(E) - b * math.log1p(E * phi)) / math.log1p(E)
    near(f'  phi={phi}: plain lambda == exact log form', lp, lam(1.0), 0.005)
    near(f'  phi={phi}: CUPED lambda == exact log form', lc, lam(fit.beta), 0.005)
    if phi:
        check(f'  phi={phi}: CUPED attenuates LESS than plain DiD', lc > lp, True,
              'pre-leakage is the one hazard where beta<1 is strictly better, and it is the '
              'opposite of the argument this module was first given')

print('\n   a concentrated fix keeps lambda ~1 but must cost POWER, not signal')
lam_low, *_ = attenuation(dr, pre_b, post_b, 0.30, fit, mode='lowest', frac=0.2)
near("mode='lowest': lambda still ~1", lam_low, 1.0, 0.05,
     'location is preserved; what a concentrated fix costs is per-draw variance, i.e. power')
t_any, c_any = dr[0]
up = inject(post_b, t_any, 0.30, 'uniform')
lo = inject(post_b, t_any, 0.30, 'lowest', pre=pre_b)
near('uniform and lowest deliver the SAME total item gain',
     sum(lo.rates[b] for b in t_any), sum(up.rates[b] for b in t_any), 1e-6)
try:
    inject(post_b, t_any, 0.3, 'lowest')
    check("mode='lowest' without a pre block raises", 'returned', 'ValueError')
except ValueError:
    check("mode='lowest' without a pre block raises", 'ValueError', 'ValueError',
          'ranking on post would let the injection pick beneficiaries after seeing the outcome')

# ---------------------------------------------------------------------------------------------
print('\n4. the leak guard, and the shape guard')
overlapping = cuped.dataclasses.replace(fit, fit_start=T0, fit_end=T0 + dt.timedelta(hours=6))
try:
    estimate(pre_b, post_b, t_any, c_any, overlapping)
    check('a beta fitted on THIS window raises LeakyFit', 'returned', 'LeakyFit',
          'this is the failure that manufactures its own significance')
except LeakyFit as e:
    check('a beta fitted on THIS window raises LeakyFit', 'LeakyFit', 'LeakyFit')
    print(f'         {str(e)[:110]}...')
e_ok = estimate(pre_b, post_b, t_any, c_any, fit)
check('a DISJOINT fit is accepted', isinstance(e_ok.adjusted, float), True)
check('beta=1 can never leak (no window to overlap)',
      isinstance(estimate(pre_b, post_b, t_any, c_any, plain_fit()).adjusted, float), True)
try:
    estimate(pre_b, post_b, t_any[:4], c_any, fit)
    check('applying a 10-v-70 beta to 4 treated raises', 'returned', 'LeakyFit',
          'beta is 0.61 at 10-v-70 and 0.28-0.32 at 32-v-48, so it belongs to the design')
except LeakyFit:
    check('applying a 10-v-70 beta to 4 treated raises', 'LeakyFit', 'LeakyFit')
check('the plain DiD is reported alongside, always',
      (isinstance(e_ok.plain, float), e_ok.beta == fit.beta), (True, True))
near('beta=1 makes adjusted identical to plain',
     estimate(pre_b, post_b, t_any, c_any, plain_fit()).adjusted,
     estimate(pre_b, post_b, t_any, c_any, plain_fit()).plain, 1e-12)

# ---------------------------------------------------------------------------------------------
print('\n5. the conditional-bias slope -- the argmax-pool trap, measured')
xs, ys, _ = contrasts_over(dr, pre_b, post_b)
star = fit_beta(dr, pre_b, post_b, n_treat=10, n_ctrl=70).beta      # this panel's OWN beta*
s_at_star, s_one, _ = conditional_bias(xs, ys, star)
near('the slope is exactly beta* - beta, so at beta=beta* it is ZERO', s_at_star, 0.0, 1e-9,
     'beta* is the unique coefficient whose answer does not depend on the drawn baseline')
near('and at beta=1 it is (beta* - 1), which is NOT zero', s_one, star - 1.0, 1e-9,
     'THE REVERSAL: with beta*<1 the PLAIN DiD over-differences -- it subtracts all of X_pre '
     'when only beta* of it predicts X_post -- so a high-baseline draw yields a negative plain '
     'DiD. That is argmax-pool-guarantees-reversion in its own words.')
check('so the PLAIN DiD is the one that carries the trap, not CUPED',
      abs(s_one) > abs(s_at_star), True)
print(f'         beta* {star:+.3f}: slope {s_at_star:+.4f} at beta* vs {s_one:+.4f} at beta=1')
fit_star = cuped.dataclasses.replace(fit, beta=star)
offs = pool_offsets(dr, pre_b, post_b, fit_star, lambda b: b.rsplit('-', 1)[0])
spread = max(v for v, _ in offs.values()) - min(v for v, _ in offs.values())
offs1 = pool_offsets(dr, pre_b, post_b, plain_fit(), lambda b: b.rsplit('-', 1)[0])
spread1 = max(v for v, _ in offs1.values()) - min(v for v, _ in offs1.values())
check(f'per-world offset spread is SMALLER at beta* ({spread:.4f}) than at beta=1 ({spread1:.4f})',
      spread < spread1, True,
      'this is the form the trap takes: E[verdict | which world was drawn]')

print('\n6. rho by gap -- flat means levels, decaying means it is autocorrelation')
def gap_trend(blocks_for, n_panels=10):
    """Mean rho per gap over several panels, and the slope of rho on gap.

    One panel cannot answer this: with 16 worlds, se(rho) ~ 0.25, so a single panel's spread
    across gaps is mostly sampling noise and reading decay off it would be the project's
    standing error -- believing a cheap negative. Average, then regress.
    """
    acc = {}
    for k in range(n_panels):
        for g, r, _ in rho_by_gap(blocks_for(k), lambda: pool_draws(3, 150)):
            acc.setdefault(round(g, 1), []).append(r)
    pts = sorted((g, st.mean(v)) for g, v in acc.items())
    mg = st.mean([g for g, _ in pts]); mr = st.mean([r for _, r in pts])
    vg = sum((g - mg) ** 2 for g, _ in pts)
    slope = sum((g - mg) * (r - mr) for g, r in pts) / vg if vg else float('nan')
    return pts, slope


flat_pts, flat_slope = gap_trend(lambda k: panel(200 + k, 5, 0.9))
print(f'         fixed-effect panel: rho by gap {[(g, round(r,3)) for g, r in flat_pts]}')
check('a fixed-effect panel has rho FLAT in the gap (|slope| < 0.01 per hour)',
      abs(flat_slope) < 0.01, True, f'slope {flat_slope:+.5f} rho per hour')
flat = rho_by_gap(panel(11, 5, 0.9), lambda: pool_draws(3, 200))
decay = panel(11, 5, 0.0)
# give the no-persistence panel an AR(1) component so rho DECAYS, and prove the diagnostic sees it
rng = random.Random(4)
carry = {b: rng.gauss(0, 1) for b in BOTS}
dblocks = []
for k, blk in enumerate(decay):
    rates = {}
    for b in BOTS:
        carry[b] = 0.55 * carry[b] + math.sqrt(1 - 0.55 ** 2) * rng.gauss(0, 1)
        rates[b] = 5.0 * math.exp(0.8 * carry[b])
    dblocks.append(cuped.dataclasses.replace(blk, rates=rates))
dec = rho_by_gap(dblocks, lambda: pool_draws(3, 200))
check('  a single panel CANNOT resolve it (the trap this averaging avoids)',
      max(r for _, r, _ in flat) - min(r for _, r, _ in flat) > 0.10, True,
      'one panel spreads 0.2+ across gaps from pure sampling noise, so reading decay off a '
      'single panel would manufacture a finding')
check('  and the diagnostic SEES a real decay when there is one', dec[0][1] - dec[-1][1] > 0.15, True,
      f'rho {dec[0][1]:+.3f} at gap {dec[0][0]:.0f}h -> {dec[-1][1]:+.3f} at {dec[-1][0]:.0f}h; '
      f'if the fleet looks like this, beta* from adjacent blocks is too large for a real read')

# ---------------------------------------------------------------------------------------------
print('\n7. refusals: a zero, a naive bound, a thin fit, a stale beta')
zero = Block('z', T0, T0 + dt.timedelta(hours=3), {b: 0.0 for b in BOTS})
try:
    cuped.contrast(zero, t_any, c_any)
    check('a group with no output raises DegenerateBlock', 'returned', 'DegenerateBlock',
          'log(0) has no value; skipping such draws silently biases the null toward the middle')
except DegenerateBlock:
    check('a group with no output raises DegenerateBlock', 'DegenerateBlock', 'DegenerateBlock')
try:
    Block('n', dt.datetime(2026, 9, 20), dt.datetime(2026, 9, 21), {})
    check('a naive datetime raises', 'returned', 'ValueError',
          'a naive bound makes the overlap check silently pass')
except ValueError:
    check('a naive datetime raises', 'ValueError', 'ValueError')
try:
    fit_beta(pool_draws(1, 5), pre_b, post_b)
    check('a fit from 5 draws raises', 'returned', 'ValueError')
except ValueError:
    check('a fit from 5 draws raises', 'ValueError', 'ValueError')
check('the registry ships EMPTY on purpose', cuped.MEASURED, {},
      'a beta without its co-fitted threshold is the Events.rate() default-of-40 defect')
try:
    cuped.from_registry()
    check('an empty registry raises KeyError rather than guessing', 'returned', 'KeyError')
except KeyError:
    check('an empty registry raises KeyError rather than guessing', 'KeyError', 'KeyError')
cuped.register('pool', 'mean', beta=0.61, rho=0.61, sd_plain=0.321, sd_adj=0.289,
               thr_plain=0.5, thr_adj=0.45, n_draws=400, block_hours=3.0, gap_hours=0.0,
               n_treat=10, n_ctrl=70, mean_pre=0.0, mean_post=0.0,
               measured_at='2026-09-01', window='test', note='test')
try:
    cuped.from_registry('pool', 'mean', asof=dt.datetime(2026, 9, 23, tzinfo=dt.timezone.utc))
    check('a 22-day-old beta raises StaleBeta', 'returned', 'StaleBeta')
except StaleBeta:
    check('a 22-day-old beta raises StaleBeta', 'StaleBeta', 'StaleBeta')
fresh = cuped.from_registry('pool', 'mean', asof=dt.datetime(2026, 9, 5, tzinfo=dt.timezone.utc))
check('a fresh one comes back WITH its threshold', (fresh.beta, fresh.thr_adj), (0.61, 0.45))
cuped.MEASURED.clear()

print('\n8. null_summary resolves a bias that median-vs-sd cannot')
biased = [0.9 + random.Random(k).gauss(0, 1) for k in range(4000)]
s = null_summary(biased)
check('median-vs-sd PASSES a 0.9-sd bias (the check being replaced)',
      abs(st.median(biased)) < st.pstdev(biased), True)
check('null_summary CATCHES it', s['centered'], False,
      'mean +- z*se resolves a bias of 0.1 sd given enough draws; abs(median)<sd does not')
near('and reports its size in sd', s['bias_in_sd'], 0.9, 0.05)
check('it reports the distinct-draw count', s['distinct'] > 0, True)

# ---------------------------------------------------------------------------------------------
print('\n9. MUTANTS -- four, each asserting its anchor is present and UNIQUE first')


def with_mutant(old, new, label):
    """Apply a one-line substitution to a COPY and import it. Never writes into scripts/lib."""
    src = open(SRC).read()
    n = src.count(old)
    if n != 1:
        print(f"  [FAIL] {label}: ANCHOR {'MISSING' if n == 0 else f'AMBIGUOUS x{n}'}: {old[:70]!r}")
        ok.append(False)
        return None
    d = tempfile.mkdtemp(prefix='cuped-mutant-')
    # Remove it on exit. A mutant copy left behind is litter, and a STALE one is worse: the next
    # run could import an old mutant and score it as this run's result.
    atexit.register(shutil.rmtree, d, True)
    p = os.path.join(d, 'cuped_mutant.py')
    with open(p, 'w') as fh:
        fh.write(src.replace(old, new, 1))
    spec = importlib.util.spec_from_file_location('cuped_mutant', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def killed(label, fn, why):
    """The mutant must make a NAMED assertion fail. An exception also counts as caught."""
    try:
        broke = fn()
    except Exception as e:
        broke, why = True, f'{why} (raised {type(e).__name__})'
    ok.append(bool(broke))
    print(f"  [{'PASS' if broke else 'FAIL'}] {label}: "
          + ('KILLED -- ' + why if broke else 'SURVIVED, so the assertion proves nothing'))


# M1: neuter the adjustment entirely -- beta stops being applied.
m = with_mutant('        adj = x_post - fit.beta * x_pre',
                '        adj = x_post - x_pre', 'M1 adjustment ignores beta')
if m:
    def f1():
        mf = m.dataclasses.replace(
            m.fit_beta(pool_draws(9, 400), *panel(77, 2, 0.7)[:2], n_treat=10, n_ctrl=70),
            fit_start=T0 - dt.timedelta(days=5), fit_end=T0 - dt.timedelta(days=4))
        e = m.estimate(m.Block(*[getattr(pre_b, k) for k in ('name', 'start', 'end', 'rates')]),
                       m.Block(*[getattr(post_b, k) for k in ('name', 'start', 'end', 'rates')]),
                       t_any, c_any, mf)
        # the real module's adjusted differs from its plain; the mutant's cannot
        return abs(e.adjusted - e.plain) < 1e-12 and abs(e_ok.adjusted - e_ok.plain) > 1e-6
    killed('M1 adjustment ignores beta', f1,
           'adjusted becomes identical to plain, so section 2 measures nothing')

# M2: the fit stops minimising -- beta forced to 1.
m = with_mutant('    beta = cxy / vx', '    beta = 1.0', 'M2 beta forced to 1')
if m:
    def f2():
        mf = m.fit_beta(pool_draws(3, 600), *[m.Block(b.name, b.start, b.end, b.rates)
                                              for b in panel(11, 2, 0.0)[:2]],
                        n_treat=10, n_ctrl=70)
        # the rho=0 case: real beta ~ 0 and sd ratio ~ 0.707; the mutant must miss both
        return abs(mf.beta - 0.0) > 0.08 or abs(mf.sd_ratio - 1 / math.sqrt(2)) > 0.04
    killed('M2 beta forced to 1', f2, "the rho=0 exact case (beta~0, sd ratio~0.707) fails")

# M3: wire the coefficient to the POST term instead -- the classic wrong way round.
m = with_mutant('        adj = x_post - fit.beta * x_pre',
                '        adj = fit.beta * x_post - x_pre', 'M3 beta on the POST term')
if m:
    def f3():
        mf = m.dataclasses.replace(
            m.fit_beta(pool_draws(9, 400), *[m.Block(b.name, b.start, b.end, b.rates)
                                             for b in panel(77, 2, 0.7)[:2]],
                       n_treat=10, n_ctrl=70),
            fit_start=T0 - dt.timedelta(days=5), fit_end=T0 - dt.timedelta(days=4))
        lam, *_ = m.attenuation(dr, m.Block(pre_b.name, pre_b.start, pre_b.end, pre_b.rates),
                                m.Block(post_b.name, post_b.start, post_b.end, post_b.rates),
                                0.30, mf)
        return abs(lam - 1.0) > 0.05           # real module: 1.000
    killed('M3 beta on the POST term', f3,
           'attenuation falls off 1, which is exactly what that test exists to catch')

# M4: delete the leak guard.
m = with_mutant('        fit.assert_usable_on(pre, post, n_treat=len(treat), n_ctrl=len(ctrl))',
                '        pass', 'M4 leak guard deleted')
if m:
    def f4():
        mo = m.dataclasses.replace(
            m.fit_beta(pool_draws(9, 400), *[m.Block(b.name, b.start, b.end, b.rates)
                                             for b in panel(77, 2, 0.7)[:2]],
                       n_treat=10, n_ctrl=70), fit_start=T0, fit_end=T0 + dt.timedelta(hours=6))
        m.estimate(m.Block(pre_b.name, pre_b.start, pre_b.end, pre_b.rates),
                   m.Block(post_b.name, post_b.start, post_b.end, post_b.rates),
                   t_any, c_any, mo)
        return True                            # no LeakyFit raised == the guard is gone
    killed('M4 leak guard deleted', f4, 'an overlapping fit is silently accepted')

print(f'\n{sum(ok)}/{len(ok)} cuped cases pass')
sys.exit(0 if all(ok) else 1)
