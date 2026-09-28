"""One definition of the variance-reduced canary contrast, and one place the coefficient lives.

WHAT THIS IS. A canary read compares a treated group against a control group before and after a
deploy. The plain estimator is a difference-in-differences on the LOG of items/bot-hour:

    X_b   = log(mean rate over treated bots in block b) - log(mean rate over control bots)
    D     = X_post - 1.0 * X_pre                      <- plain DiD, coefficient FORCED to 1
    D_adj = X_post - beta * X_pre                     <- this module, coefficient MEASURED

That is all CUPED is here. The pre-period contrast is the control variate, and a plain DiD is
the special case beta = 1. Nothing else about the read changes: same endpoint, same exposure
definition (lib/exposure.py), same arm assignment (lib/arms.py).

WHY IT IS WORTH ANYTHING. Measured 2026-09-23 on 11,200 balanced bot-hour cells (140h x 80
bots): 86.7% of items/bot-hour variance is bot x hour -- within a bot, hour to hour. World level
is 4.0%, bot level 3.4%, world drift 5.2%. So ASSIGNMENT can reach at most ~9% of the noise and
no amount of cleverness about which bots are treated will fix the rest. What CUPED reaches is a
different 9%: the persistent part of the contrast, whatever survives from one block to the next.
With var(X_post) ~ var(X_pre) = v and rho = corr(X_post, X_pre),

    var(D)     = 2v(1 - rho)          beta = 1
    var(D_adj) =  v(1 - rho^2)        beta = rho, which is the minimiser

so the gain is real but bounded: at rho = 0.61 the sd ratio is 0.897, and that is the whole
prize. It is not a way to make a +146% MDE small. It is a way to make it +124%.

WHY IT DOES NOT SHRINK THE SIGNAL, which is the question that killed the last idea. Treatment
lands only in the POST block, so under treatment X_post gains the effect and X_pre does not.
Therefore a multiplicative effect passes through undiminished:

    D_adj(injected) - D_adj(null) = log(1 + e)     EXACTLY, for stat='mean'

because multiplying every treated bot's post rate by (1+e) multiplies their arithmetic mean by
exactly (1+e). Contrast with trimming, refuted the same day: winsorising at p90 cut the sd 26%
and the signal 37% (attenuation 0.63), making the MDE WORSE, because a capped statistic cannot
register a change above the cap. The difference is structural, and `attenuation()` measures it
rather than asserting it -- with the trimmed statistic as its positive control, which must come
back BELOW 1 or the instrument cannot see attenuation at all.

    BUT DO NOT READ THAT AS "UNBIASED". It is not the same claim, and the first version of this
    module said it was. The argument I wrote was: random assignment makes E[X_pre] = 0, so
    E[D_adj] = delta - beta*0 = delta, unbiased by construction. CODEX REVIEW 2026-09-23 refuted
    it for THIS endpoint. Randomization equalises the arithmetic MEANS in expectation; it does
    not equalise their LOGS. For X_b = log(mean_T) - log(mean_C) with unequal arms, a
    second-order expansion gives

        m_b := E_A[X_b]  ~=  -(S_b^2 / 2 mu_b^2) (1/n_T - 1/n_C)

    which is not zero here, because the arms are 10 vs 70 (pool) or 32 vs 48 (within-world):
    1/10 - 1/70 = 0.086. So under a stationary null with m_pre = m_post = m,

        E[D]      = m - m           = 0        <- plain DiD cancels it exactly
        E[D_adj]  = m - beta * m    = (1-beta) m   <- CUPED does NOT

    A plain DiD is unbiased for a stationary null precisely BECAUSE its coefficient is forced to
    1, and buying variance with beta < 1 sells exactly that property. The residual is small on
    plausible numbers -- at a coefficient of variation of 1 it is about 0.017 log units, ~6% of
    a 0.289 sd -- but it grows as the square of the CV, and this fleet is heavy-tailed. So it is
    MEASURED (mdereplay.py prints the null centre for both estimators) and not argued, and
    `estimate(center=True)` subtracts the fit period's measured m as standard CUPED does. That
    option trades a known bias for a transfer risk: if m drifts between the fit and the read,
    centering shifts the null instead of correcting it. Which is better is an empirical question
    about held-out data, and the harness answers it rather than this docstring.

THE TWO WAYS TO CHEAT, and what stops each.

  1. FIT beta ON THE THING YOU ARE ADJUSTING. beta is chosen to minimise the variance of the
     contrast. Fit it on the same draws that build the null and the null is optimistically
     narrow, the threshold too close to zero, and the gate's false-positive rate inflates. The
     estimator then manufactures its own significance and a gate that REVERTS DEPLOYS acts on
     it. Stopped mechanically: a `CupedFit` carries the window it was fitted on, every apply
     path goes through `assert_usable_on()`, and an overlapping window raises `LeakyFit`. The
     window travels with the data (see `Block`) so a caller cannot forget to pass it or quietly
     pass the wrong one.

     THE GUARD'S OWN LIMIT, named because a guard believed past its range is worse than none.
     It checks DISJOINTNESS, and disjoint is not independent: lag-1 correlation of the contrast
     is +0.387 at 3h, so a beta fitted on the block immediately before a read is still
     correlated with that read. Nor can a timestamp check see MODEL SELECTION -- trying four
     designs and keeping the best beta passes through it untouched. It stops the gross error,
     which is the one that has actually happened in this repo; it does not make a fit honest by
     itself.

  2. TYPE A CONSTANT THAT WAS TRUE ONCE. This project's standing failure. CLAUDE.md records
     `Events.rate()` defaulting to 40 bots against an 80-bot fleet, and the fix there was to
     DELETE the default rather than correct the number. A hardcoded beta is the same hazard, so
     the registry below stores the window each beta was measured over and `from_registry()`
     raises `StaleBeta` past its shelf life. Re-fitting is one call (`fit_beta`), and
     mdereplay.py --cuped is the blessed way to run it.

HONEST LIMITS, stated because they are the ones that decide whether to trust it.

  * WHAT beta = 1 WAS ACTUALLY BUYING, and it is not what I first thought. I expected the
    pre-period difference to be what removes drift. It is not. Write Y_ib = mu_b + alpha_i +
    eps_ib. Then

        X_b = (mu_b - mu_b) + (alpha_T - alpha_C) + (eps_T,b - eps_C,b) = Delta_alpha + eta_b

    The common time effect mu_b CANCELS INSIDE X_b, because X_b is already a cross-sectional
    difference at a single time. mu_post - mu_pre never enters D at all, and additive-on-log is
    multiplicative-on-raw, so a common multiplicative drift is gone too. Pre-differencing buys
    nothing against common drift; the cross-sectional contrast is what removes it.

    What beta = 1 removes is the REALIZED baseline imbalance of the one assignment the gate ran
    on -- and here the argument I was handed, and repeated, is BACKWARDS. Both reviews and my own
    first draft said beta < 1 leaves (1 - beta) of the drawn imbalance in the answer and so
    re-arms `argmax-pool-guarantees-reversion` at 39% strength. MEASURED 2026-09-23 on synthetic
    panels with known structure, and it is the reverse. Regress the estimator on X_pre over null
    draws; the slope is

        slope = beta* - beta        where beta* = cov(X_post, X_pre) / var(X_pre)

    so it is ZERO at beta = beta* and equal to (beta* - 1) at beta = 1. With beta* = 0.61 the
    PLAIN DiD carries a slope of -0.39 on the drawn baseline imbalance and CUPED carries none.

    The reason is that the reviews' model assumes the pre-period contrast persists fully into the
    post block, i.e. beta* = 1 for the persistent part. Empirically it does not -- beta* is 0.61
    -- and forcing the coefficient to 1 therefore OVER-differences: it subtracts all of X_pre
    when only 61% of it predicts X_post, leaving a negative dependence on baseline. That is
    exactly the recorded trap, stated in its own words: a draw with a high baseline contrast
    produces a negative plain DiD, so "picking the HIGHEST-baseline pool builds in reversion".
    The plain DiD is the estimator that has it; beta* is the unique coefficient that removes it.

    This is the one place CUPED buys something other than 10% of an sd, and it is a bias
    argument rather than a variance one. `conditional_bias()` measures the slope and
    `pool_offsets()` prints it per world, which is the form the trap actually takes. Both must be
    run on real telemetry before any of this is believed: the synthetic panels prove the algebra,
    not the fleet's beta*.

  * THE GAIN MAY NOT BE A LEVEL AT ALL, which would make beta* an artifact. sd x 0.90 is a
    variance cut of 19%, but the persistent components of this endpoint were measured at world
    4.0% + bot 3.4% + drift 5.2% = 12.6%. A covariate that predicts only persistent structure
    cannot remove 19%. Either that budget is wrong, or rho is contaminated by the residual's
    lag-1 autocorrelation of +0.31 -- which is NOT a level, and decays with the gap between
    blocks. If it decays, a beta* fitted on ADJACENT blocks is far too large at the gap a real
    read has, and the gate is mis-tuned rather than tuned. `rho_by_gap()` settles it: rho must be
    FLAT in the gap if it is levels. This is the measurement that can kill the whole idea, so it
    runs first.

  * What is random when beta is fitted by replay is the ASSIGNMENT, on a fixed dataset. That
    makes beta the randomization-distribution regression coefficient, which is the right thing
    to minimise for a gate whose own sampling distribution is the assignment distribution. It is
    NOT the same as a per-unit CUPED theta, and it does not automatically transfer to a period
    with different noise. Hence `fit_beta` on one period and evaluate on another, always, and
    report what beta does across periods rather than averaging them.

  * The endpoint is log(mean of per-bot rates), so the effect it reports is a RATIO of
    arithmetic fleet output, exp(D) - 1. That is the claim a read may make. It is not a
    geometric mean and must not be reported as one.

  * A degenerate block -- a treated or control group whose mean rate is 0 -- has no log.
    `contrast()` raises `DegenerateBlock` and callers must COUNT those draws rather than skip
    them silently, because dropping the empty tail of the draw distribution biases the null
    toward the middle. mdereplay.py prints the count.
"""
import dataclasses
import datetime as dt
import math
import statistics as st


class LeakyFit(RuntimeError):
    """A coefficient fitted on the data it is being applied to.

    Raised, not warned, on the model of telemetry.ZeroLooksWrong and exposure.NoExposure,
    because the failure it guards is invisible in the output: the read still prints a number,
    the number is just too easy to call significant.
    """


class StaleBeta(RuntimeError):
    """A registered beta older than its shelf life. See hazard 2 in the module docstring."""


class DegenerateBlock(ValueError):
    """A group with no output in a block, so the log contrast does not exist."""


# z_{1-alpha/2} + z_{power}. 1.9600 + 0.8416 = 2.8016 for the convention in use here. Derived
# rather than typed: the number appears in reports and a typed constant cannot be checked
# against the alpha and power it claims to encode.
def mde_z(alpha=0.05, power=0.80):
    nd = st.NormalDist()
    return nd.inv_cdf(1 - alpha / 2.0) + nd.inv_cdf(power)


def mde_from_sd_log(sd_log, alpha=0.05, power=0.80, direction='gain'):
    """The smallest multiplicative effect a contrast with this log sd can catch, as a fraction.

    Two-sided alpha, one-sided power. This is the convention every CUPED number in this
    project's reports uses, so it lives in one function.

    `direction` MATTERS AND WAS MISSING. Codex review 2026-09-23: a gate that REVERTS is
    directional, and the two-sided improvement convention answers the wrong question for it.
    The same k = z*sd_log of log distance is

        gain:  exp(+k) - 1        at k=0.899 -> +146%   "output must more than double to show"
        harm:  1 - exp(-k)        at k=0.899 ->  -59%   "a 59% collapse is the smallest visible"

    Both are true of the same instrument; they are not the same number and a revert gate is
    priced by the second. Reporting only the first has made this project's detectability sound
    roughly three times worse than it is for the decision that actually gets made automatically.
    """
    if sd_log < 0:
        raise ValueError(f'sd_log must be non-negative, got {sd_log}')
    k = mde_z(alpha, power) * sd_log
    if direction == 'gain':
        return math.exp(k) - 1.0
    if direction == 'harm':
        return 1.0 - math.exp(-k)
    raise ValueError(f"direction must be 'gain' or 'harm', got {direction!r}")


# ---------------------------------------------------------------------------------------------
# The data a contrast is computed from. The window is part of it, which is the leak guard.
# ---------------------------------------------------------------------------------------------
@dataclasses.dataclass(frozen=True)
class Block:
    """Per-bot rates for one time block, carrying the block's own bounds.

    WHY THE BOUNDS LIVE HERE rather than being a separate argument to the apply call: the leak
    check needs to know which period produced these numbers, and any design where the caller
    passes that separately is a design where the caller can omit it, mistype it, or pass the fit
    window by accident. Attaching it to the data makes `assert_usable_on` unforgeable.

    `rates` is bot -> items per bot-hour. Build it from lib/exposure.py's per-bot spans and the
    summed POSITIVE skill.inventory_delta; do not invent a second denominator.
    """
    name: str
    start: dt.datetime
    end: dt.datetime
    rates: dict

    def __post_init__(self):
        for nm, v in (('start', self.start), ('end', self.end)):
            if not isinstance(v, dt.datetime) or v.tzinfo is None:
                raise ValueError(f'Block.{nm} must be timezone-aware; a naive bound makes the '
                                 f'leak check silently pass')
        if self.end <= self.start:
            raise ValueError(f'Block {self.name}: end {self.end} not after start {self.start}')

    def overlaps(self, start, end):
        return self.start < end and start < self.end


def group_log_rate(rates, bots, stat='mean'):
    """log of the group statistic of per-bot rates.

    `stat` is here because the group statistic is a live question in this project, not because
    it should vary casually: measured 2026-09-23, treating 32 bots instead of 10 did NOT lower
    the null sd, which is the signature of a heavy tail. A robust statistic is therefore
    plausible AND attenuating, so anything but 'mean' must be run through `attenuation()` before
    it is believed. 'mean' is the only one that reports a ratio of arithmetic fleet output.
    """
    vals = [rates[b] for b in bots if b in rates]
    if not vals:
        raise DegenerateBlock(f'no bots with a rate out of {len(list(bots))} assigned')
    if callable(stat):
        # A callable is how a FIXED-CAP statistic gets in, and that matters: quantile trimming
        # is scale-equivariant (a uniform lift moves every value, the same bots stay inside the
        # trim, and the trimmed mean scales exactly), so it does NOT attenuate and cannot serve
        # as the attenuation instrument's positive control. What attenuated 0.63 on the fleet was
        # winsorising at an ABSOLUTE p90 cap, which is not equivariant because the cap does not
        # move with the lift. Measured 2026-09-23: my first positive control was quantile
        # trimming and it returned lambda = 1.000, i.e. a control that could not see the thing it
        # was there to see.
        g = stat(vals)
    elif stat == 'mean':
        g = st.mean(vals)
    elif stat == 'median':
        g = st.median(vals)
    elif stat == 'trimmed':
        v = sorted(vals)
        k = int(0.2 * len(v))
        g = st.mean(v[k:len(v) - k] or v)
    elif stat == 'geom':
        g = math.exp(st.mean([math.log1p(v) for v in vals])) - 1.0
    else:
        raise ValueError(f'unknown stat {stat!r}')
    if g <= 0:
        raise DegenerateBlock(f'group statistic {stat} is {g} over {len(vals)} bots, so it has '
                              f'no log; count this draw, do not skip it')
    return math.log(g)


def contrast(block, treat, ctrl, stat='mean'):
    """X_b: the treated-minus-control log contrast within ONE block.

    This is the quantity CUPED reweights. Note it is CROSS-SECTIONAL -- it is not a result and
    must never be reported as one. CLAUDE.md: canary results are difference-in-differences,
    never canary-vs-fleet, and a good deploy was rolled back once on exactly this number.
    """
    return (group_log_rate(block.rates, treat, stat)
            - group_log_rate(block.rates, ctrl, stat))


# ---------------------------------------------------------------------------------------------
# The coefficient, and its provenance
# ---------------------------------------------------------------------------------------------
@dataclasses.dataclass(frozen=True)
class CupedFit:
    """A measured beta, its co-fitted threshold, and everything needed to judge both.

    THE THRESHOLD IS IN HERE ON PURPOSE, and it is the most important design decision in this
    module. Review 2026-09-23 made the argument that changed it: beta does not bias the
    estimator, it re-tunes the variance, so

        var(D_adj) = var(X_post) + beta^2 var(X_pre) - 2 beta cov

    is minimised only at the beta of THAT period. Apply a beta fitted when rho was 0.61 to a
    period where rho is 0.30 and the realised sd EXCEEDS the sd the threshold was calibrated at
    -- so the gate's false-positive rate rises above nominal. The damage from a stale beta
    therefore arrives entirely through the calibration constant, which means

        beta and its threshold must be fitted TOGETHER, on the same window, or neither is valid.

    You cannot hardcode beta and recalibrate the threshold, nor the reverse. That is why they are
    one frozen object with one window: the type makes the pairing unforgeable, in the same spirit
    as exposure.py returning (rate, hours, n_bots) as one value you cannot print apart.

    It is also why `MEASURED` below ships EMPTY. A registered beta without the threshold fitted
    beside it on the same data is precisely the `Events.rate()` default-of-40 defect, and the fix
    recorded for that was to delete the default rather than correct the number. If a read cannot
    fit beta on its own disjoint window, the correct estimator is beta = 1. Plain DiD is safe and
    the whole prize is 10% of an sd.
    """
    beta: float
    design: str
    stat: str
    n_draws: int
    fit_start: dt.datetime
    fit_end: dt.datetime
    rho: float
    sd_plain: float
    sd_adj: float
    provenance: str
    # The co-fitted decision thresholds, as EMPIRICAL quantiles of the null. Not z * sd: the
    # null here is heavy-tailed, drifting and supported on few distinct draws, so a normal
    # quantile is the same error class as the `MDE at 2 sd` this project already retired.
    thr_plain: float = float('nan')
    thr_adj: float = float('nan')
    # Shape of the fit, because beta belongs to (data x design x geometry), not to the data. A
    # pool-fitted 0.61 applied to a within-world read is silent mis-tuning that a window check
    # cannot see, so `assert_usable_on` compares these too.
    block_hours: float = float('nan')
    gap_hours: float = float('nan')
    n_treat: int = 0
    n_ctrl: int = 0
    # Randomization means of the two block contrasts, for the log-of-mean Jensen term. These are
    # what `estimate(center=True)` subtracts, and what makes the (1-beta)*m bias visible.
    mean_pre: float = 0.0
    mean_post: float = 0.0
    var_pre: float = float('nan')
    var_post: float = float('nan')
    degenerate: int = 0
    n_distinct: int = 0

    @property
    def sd_ratio(self):
        return self.sd_adj / self.sd_plain if self.sd_plain else float('nan')

    def mde(self, alpha=0.05, power=0.80, direction='gain', adjusted=True):
        return mde_from_sd_log(self.sd_adj if adjusted else self.sd_plain, alpha, power, direction)

    def assert_usable_on(self, *blocks, n_treat=None, n_ctrl=None):
        """RAISE if this coefficient is being applied outside what it was fitted for.

        Two checks, and both have a named failure behind them:

        WINDOW -- a beta fitted on the draws that also build the null narrows that null, so the
        threshold sits too close to zero and the gate reverts deploys on noise. See hazard 1.

        SHAPE -- beta is 0.61 for the pool design and 0.28-0.32 within-world, so the coefficient
        is a property of the assignment mechanism and the arm sizes, not of the fleet. Applying
        one design's beta to another is mis-tuning with no symptom.
        """
        for b in blocks:
            if b.overlaps(self.fit_start, self.fit_end):
                raise LeakyFit(
                    f'beta={self.beta:.3f} was fitted on {self.fit_start:%Y-%m-%d %H:%M}Z..'
                    f'{self.fit_end:%H:%M}Z, which overlaps block {b.name!r} '
                    f'({b.start:%Y-%m-%d %H:%M}Z..{b.end:%H:%M}Z). A coefficient fitted on the '
                    f'contrast it adjusts minimises that contrast\'s own variance, so the null '
                    f'is too narrow and the false-positive rate is not the nominal one. Fit on '
                    f'a disjoint period (mdereplay.py --cuped) or pass beta=1.0 for plain DiD.')
        for nm, got, want in (('n_treat', n_treat, self.n_treat), ('n_ctrl', n_ctrl, self.n_ctrl)):
            if got is not None and want and got != want:
                raise LeakyFit(
                    f'this fit was made with {nm}={want} and is being applied to {nm}={got}. '
                    f'beta depends on the arm sizes (1/n_T - 1/n_C sets the Jensen term, and '
                    f'beta* was 0.61 at 10-vs-70 but 0.28-0.32 at 32-vs-48), so a beta from '
                    f'another design is mis-tuned rather than tuned. Re-fit for this design.')

    def describe(self):
        return (f'beta={self.beta:.3f} rho={self.rho:+.3f} sd {self.sd_plain:.4f}->{self.sd_adj:.4f} '
                f'(x{self.sd_ratio:.3f}) | {self.design}/{self.stat} {self.n_treat}v{self.n_ctrl} '
                f'{self.block_hours:.1f}h blocks gap {self.gap_hours:.1f}h | {self.n_draws} draws '
                f'({self.n_distinct} distinct) {self.fit_start:%m-%d %H:%M}Z..{self.fit_end:%m-%d %H:%M}Z'
                + (f' | {self.degenerate} degenerate' if self.degenerate else '')
                + f' [{self.provenance}]')


def plain_fit(design='pool', stat='mean'):
    """beta = 1: the estimator this project has always used. No window, so it can never leak.

    Exists so `estimate()` has exactly one code path and the plain DiD cannot drift away from
    the adjusted one as a separate function.
    """
    epoch = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    return CupedFit(beta=1.0, design=design, stat=stat, n_draws=0,
                    fit_start=epoch, fit_end=epoch, rho=float('nan'),
                    sd_plain=float('nan'), sd_adj=float('nan'),
                    provenance='beta=1 by definition, not measured')


@dataclasses.dataclass(frozen=True)
class Estimate:
    """Both numbers, always.

    A read prints the plain DiD next to the adjusted one so nobody has to trust the new
    estimator blind, and so a DISAGREEMENT between them is visible rather than a silent
    substitution. A large gap between the two is not a better answer, it is a warning that
    (1-beta)*X_pre is carrying the verdict.
    """
    plain: float
    adjusted: float
    x_pre: float
    x_post: float
    beta: float
    fit: CupedFit
    centered: bool = False

    @property
    def plain_pct(self):
        return math.exp(self.plain) - 1.0

    @property
    def adjusted_pct(self):
        return math.exp(self.adjusted) - 1.0

    @property
    def imbalance_carried(self):
        """How much of the adjusted answer is un-differenced baseline imbalance: (1-beta)*X_pre.

        The quantity `argmax-pool-guarantees-reversion` is about. If this is a large fraction of
        the verdict, the verdict is about which pools were drawn.
        """
        return (1.0 - self.beta) * self.x_pre

    def describe(self):
        return (f'plain DiD {self.plain:+.4f} log ({100*self.plain_pct:+.1f}% items)  |  '
                f'CUPED {self.adjusted:+.4f} log ({100*self.adjusted_pct:+.1f}% items)  '
                f'[X_pre {self.x_pre:+.4f} X_post {self.x_post:+.4f} beta {self.beta:.3f}; '
                f'imbalance carried {self.imbalance_carried:+.4f}]')


def estimate(pre, post, treat, ctrl, fit=None, stat=None, center=False):
    """THE entry point. Returns the plain DiD and the CUPED-adjusted DiD side by side.

    `pre`, `post`  Blocks, carrying their own bounds (that is the leak guard).
    `treat`,`ctrl` bot-name collections, from lib/arms.py.
    `fit`          a CupedFit. Omitted means beta = 1, i.e. exactly today's estimator.
    `center`       subtract the fit period's measured randomization means, which is standard
                   CUPED's Y - theta(X - E[X]). It removes the (1-beta)*m Jensen term described
                   in the module docstring, at the cost of transferring m from another period:
                   if m drifts, centering SHIFTS the null instead of correcting it. Off by
                   default because a bias you have measured is safer than a correction you have
                   not, and mdereplay.py --cuped reports the null centre both ways.

    The leak and shape checks run here, before anything is computed, so there is no path that
    produces an adjusted number without them.
    """
    fit = fit or plain_fit(stat=stat or 'mean')
    stat = stat or fit.stat
    if fit.beta != 1.0:
        fit.assert_usable_on(pre, post, n_treat=len(treat), n_ctrl=len(ctrl))
    x_pre = contrast(pre, treat, ctrl, stat)
    x_post = contrast(post, treat, ctrl, stat)
    if center:
        adj = (x_post - fit.mean_post) - fit.beta * (x_pre - fit.mean_pre)
    else:
        adj = x_post - fit.beta * x_pre
    return Estimate(plain=x_post - x_pre, adjusted=adj, x_pre=x_pre, x_post=x_post,
                    beta=fit.beta, fit=fit, centered=center)


def contrasts_over(draws, pre, post, stat='mean'):
    """(xs, ys, n_degenerate): the two block contrasts for every draw. One walk, reused.

    Returned rather than consumed so that beta, the threshold, the null centre, the conditional
    bias and rho-by-gap are all computed from the SAME draws. Recomputing them from fresh draws
    is how two numbers in one report come to disagree.
    """
    xs, ys, degen = [], [], 0
    for treat, ctrl in draws:
        try:
            x = contrast(pre, treat, ctrl, stat)
            y = contrast(post, treat, ctrl, stat)
        except DegenerateBlock:
            degen += 1
            continue
        xs.append(x)
        ys.append(y)
    return xs, ys, degen


def _moments(xs, ys):
    n = len(xs)
    mx, my = st.mean(xs), st.mean(ys)
    vx = sum((x - mx) ** 2 for x in xs) / n
    vy = sum((y - my) ** 2 for y in ys) / n
    cxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / n
    rho = cxy / math.sqrt(vx * vy) if vx > 0 and vy > 0 else float('nan')
    return mx, my, vx, vy, cxy, rho


def fit_beta(draws, pre, post, design='pool', stat='mean', provenance='fit_beta',
             alpha=0.05, n_treat=0, n_ctrl=0):
    """The variance-minimising beta AND its threshold, over pseudo-assignments on ONE-BUILD data.

        beta* = cov(X_post, X_pre) / var(X_pre)

    What is random is the ASSIGNMENT; the data is fixed. So this is the randomization-distribution
    regression of X_post on X_pre. For a LINEAR mean contrast that ratio provably equals the
    fixed-data per-unit OLS slope -- the (1/n_T + 1/n_C) multiplier appears in both the variance
    and the covariance and cancels -- so this is not a different estimand, it is the same one
    computed through the assignment mechanism that the gate will actually use. For the log-of-mean
    contrast the equality is only approximate, and simulating the real mechanism is then the more
    defensible of the two.

    THE EFFECTIVE SAMPLE SIZE IS THE NUMBER OF DISTINCT DRAWS, NOT `trials`. With 16 worlds and a
    2-pool canary there are only C(16,2) = 120 possible assignments, so 400 trials resample 120
    points and `n_distinct` is reported for exactly that reason. A 5% tail of 120 values is six
    order statistics; if the threshold moves across those six, extra trials are precision that
    does not exist.

    The telemetry must have ONE build live (Events.assert_one_version()), or the "null" contains a
    real treatment effect and beta absorbs part of it.
    """
    xs, ys, degen = contrasts_over(draws, pre, post, stat)
    n = len(xs)
    if n < 30:
        raise ValueError(f'only {n} usable draws ({degen} degenerate); a beta from this few is '
                         f'noise. Widen the window or lower the exposure filter.')
    mx, my, vx, vy, cxy, rho = _moments(xs, ys)
    if vx <= 0:
        raise ValueError('var(X_pre) is zero over these draws, so beta is undefined')
    beta = cxy / vx
    d_plain = [y - x for x, y in zip(xs, ys)]
    d_adj = [y - beta * x for x, y in zip(xs, ys)]
    gap = max(0.0, (post.start - pre.end).total_seconds() / 3600.0)
    return CupedFit(
        beta=beta, design=design, stat=stat, n_draws=n,
        fit_start=pre.start, fit_end=post.end, rho=rho,
        sd_plain=st.pstdev(d_plain), sd_adj=st.pstdev(d_adj), provenance=provenance,
        thr_plain=_quantile(d_plain, 1 - alpha), thr_adj=_quantile(d_adj, 1 - alpha),
        block_hours=(pre.end - pre.start).total_seconds() / 3600.0, gap_hours=gap,
        n_treat=n_treat, n_ctrl=n_ctrl,
        mean_pre=mx, mean_post=my, var_pre=vx, var_post=vy,
        degenerate=degen, n_distinct=len({(round(x, 12), round(y, 12)) for x, y in zip(xs, ys)}))


def _quantile(vals, q):
    v = sorted(vals)
    if not v:
        return float('nan')
    return v[min(len(v) - 1, max(0, int(q * len(v))))]


# ---------------------------------------------------------------------------------------------
# Diagnostics. These are the measurements that decide whether the estimator is trustworthy, so
# they are library functions with the estimator rather than one-off code in a report.
# ---------------------------------------------------------------------------------------------
def null_summary(vals, alpha=0.05):
    """Mean, its standard error, a CI, and the empirical tails. NOT median-vs-sd.

    WHY NOT median-vs-sd: mdereplay.py's centering check is `abs(median(null)) < pstdev(null)`,
    which PASSES for a bias of 0.9 standard deviations. It cannot detect the Jensen term this
    endpoint has. A mean with a standard error can: se = sd/sqrt(n), so with enough draws a bias
    of 0.1 sd is resolvable and the check has teeth.
    """
    n = len(vals)
    m, sd = st.mean(vals), st.pstdev(vals)
    se = sd / math.sqrt(n) if n else float('nan')
    z = st.NormalDist().inv_cdf(1 - alpha / 2)
    return {'n': n, 'mean': m, 'sd': sd, 'se': se,
            'ci': (m - z * se, m + z * se), 'centered': abs(m) <= z * se,
            'bias_in_sd': (m / sd if sd else float('nan')),
            'lo': _quantile(vals, alpha), 'hi': _quantile(vals, 1 - alpha),
            'distinct': len({round(v, 12) for v in vals})}


def conditional_bias(xs, ys, beta):
    """Regress the estimator on the PRE contrast over null draws. The slope is exactly beta* - beta.

    THE TEST FOR THE TRAP, and it does not say what I expected. Since D = X_post - beta X_pre,

        slope = cov(X_post - beta X_pre, X_pre) / var(X_pre) = beta* - beta

    so the slope is ZERO at beta = beta* and (beta* - 1) at beta = 1. With beta* < 1 it is the
    PLAIN DiD that carries a dependence on the drawn baseline imbalance, not CUPED: forcing the
    coefficient to 1 subtracts all of X_pre when only beta* of it predicts X_post. A draw with a
    high baseline contrast then yields a negative plain DiD, which is
    `argmax-pool-guarantees-reversion` in its own words -- "picking the HIGHEST-baseline pool
    builds in reversion". beta* is the unique coefficient that removes it.

    Returns (slope_at_beta, slope_at_beta_1, r2).
    """
    d_adj = [y - beta * x for x, y in zip(xs, ys)]
    d_one = [y - x for x, y in zip(xs, ys)]

    def slope(v):
        mx, mv = st.mean(xs), st.mean(v)
        vx = sum((x - mx) ** 2 for x in xs)
        return (sum((x - mx) * (a - mv) for x, a in zip(xs, v)) / vx) if vx else float('nan')
    s = slope(d_adj)
    mx, md = st.mean(xs), st.mean(d_adj)
    ss = sum((a - md) ** 2 for a in d_adj)
    pred = [md + s * (x - mx) for x in xs]
    r2 = 1 - sum((a - p) ** 2 for a, p in zip(d_adj, pred)) / ss if ss else float('nan')
    return s, slope(d_one), r2


def randomization_p(vals, i):
    """Two-sided randomization p-value for draw `i` against all the others in the SAME window.

    THE FIX FOR THE ONE FAILURE THAT MATTERS. Measured 2026-09-23: a threshold fitted on one
    single-build window and applied to another 6.2h later gave a false-positive rate of 13.3%
    (plain DiD) and 20.8% (CUPED) against a nominal 5%, on the EXACT randomization distribution
    of all 120 pool assignments. The scale AND the tail shape of this endpoint's null move
    between windows, so no earlier window can calibrate a later one -- which is a finding about
    the gate this project already runs, not about CUPED.

    A randomization test does not transfer anything. Under the sharp null the assignment labels
    are exchangeable, so the distribution of the estimator over ALL possible assignments of the
    read's own window IS its null distribution. Comparing the realised assignment to that
    distribution is exact by construction, whatever the scale or the tail happens to be that day.

    This decouples the two problems cleanly, and the split is the point:
      * beta must come from a DISJOINT window, because a coefficient fitted on the contrast it
        adjusts minimises that contrast's own variance.
      * the THRESHOLD must come from the read's OWN window, because a transferred one is
        mis-scaled.
    Doing both at once is not a compromise between them; they are different objects.

    The cost is resolution, and it is a real cost: with 16 worlds and a 2-pool canary there are
    C(16,2) = 120 assignments, so the smallest attainable p-value is 1/120 = 0.0083 and the 5%
    tail is 6 order statistics. A within-world design has vastly more assignments and does not
    have this limit.
    """
    n = len(vals)
    if n < 20:
        raise ValueError(f'{n} assignments is too few for a randomization p-value; the smallest '
                         f'attainable p is 1/{n}')
    a = abs(vals[i])
    return sum(1 for v in vals if abs(v) >= a) / n


def pool_offsets(draws, pre, post, fit, pool_of, stat='mean'):
    """E[D_adj | this world was treated], per world. The trap in the form it actually takes.

    At beta = 1 every world's offset is ~0. Below 1 a world's offset is ~(1-beta) x (its level
    minus the fleet's). If any single world's offset is a meaningful fraction of the threshold,
    the gate's verdict depends on which world got drawn, which is not a property of the code
    being tested.
    """
    per = {}
    for treat, ctrl in draws:
        try:
            e = estimate(pre, post, treat, ctrl, fit, stat)
        except DegenerateBlock:
            continue
        for w in {pool_of(b) for b in treat}:
            per.setdefault(w, []).append(e.adjusted)
    return {w: (st.mean(v), len(v)) for w, v in sorted(per.items()) if v}


def rho_by_gap(blocks, draws_for, stat='mean'):
    """corr(X_a, X_b) against the GAP between block a and block b. FLAT means levels.

    THE MEASUREMENT THAT CAN KILL THE ESTIMATOR, and the reason it exists: sd x 0.90 is a 19%
    variance cut, but the persistent components of this endpoint measured 12.6% in total (world
    4.0 + bot 3.4 + drift 5.2). A covariate that predicts only persistent structure cannot remove
    19%, so either that budget is wrong or rho is partly the residual's lag-1 autocorrelation of
    +0.31 -- which is not a level and DECAYS with the gap.

    If rho decays, a beta* fitted on adjacent blocks is too large for the gap a real read has and
    the gate is mis-tuned. If it is flat, the gain is persistent structure and transfers.

    `blocks` is an ordered list of equal-length Blocks; `draws_for` is a callable () -> iterable
    of (treat, ctrl), called once per pair so every pair sees the same assignment sequence.
    Returns [(gap_hours, rho, n)] sorted by gap.
    """
    out = []
    for i in range(len(blocks)):
        for j in range(i + 1, len(blocks)):
            a, b = blocks[i], blocks[j]
            xs, ys, _ = contrasts_over(draws_for(), a, b, stat)
            if len(xs) < 30:
                continue
            _, _, _, _, _, rho = _moments(xs, ys)
            out.append(((b.start - a.start).total_seconds() / 3600.0, rho, len(xs)))
    return sorted(out)


# ---------------------------------------------------------------------------------------------
# The registry. Ships EMPTY, and the docstring on CupedFit says why.
# ---------------------------------------------------------------------------------------------
SHELF_LIFE_DAYS = 14


@dataclasses.dataclass(frozen=True)
class _Measured:
    beta: float
    rho: float
    sd_plain: float
    sd_adj: float
    thr_plain: float
    thr_adj: float
    n_draws: int
    block_hours: float
    gap_hours: float
    n_treat: int
    n_ctrl: int
    mean_pre: float
    mean_post: float
    measured_at: str          # the day it was fitted
    window: str               # the telemetry window, stated so it can be redone
    note: str


# DELIBERATELY EMPTY, and this is a finding rather than an omission.
#
# The task this module was built for allowed a hardcoded beta "ONLY if you measure it, state the
# window it came from, and make it re-fittable". Review 2026-09-23 gave the stronger reason not
# to ship one at all: a stale beta damages the gate through the THRESHOLD, not through bias, so
# beta and its threshold are valid only as a pair fitted on one window. A registry entry is a
# beta that will eventually be used with somebody else's threshold, which is the
# `Events.rate()`-default-of-40 defect with extra steps -- and the recorded fix for that was to
# delete the default rather than correct the number.
#
# The measured values live in the report and in this module's own docstring, where they are
# evidence. `fit_beta` is one call and mdereplay.py --cuped is the blessed way to make it. A read
# that cannot fit beta on its own disjoint window should use beta = 1; plain DiD is safe, and the
# entire prize is 10% of a standard deviation.
MEASURED = {}


def register(design, stat, **kw):
    """Add a measured beta+threshold pair. Nothing in this repo calls it yet, on purpose."""
    MEASURED[(design, stat)] = _Measured(**kw)


def from_registry(design='pool', stat='mean', asof=None, allow_stale=False):
    """A registered beta WITH its co-fitted threshold, with its age checked rather than recalled.

    Raises StaleBeta past SHELF_LIFE_DAYS. The fleet's rho is not a constant of nature: world
    drift is 5.2% of variance and pools move -45% to +77% in six hours, so a beta from three
    weeks ago is a number that was true when it was typed.
    """
    m = MEASURED.get((design, stat))
    if m is None:
        raise KeyError(f'no measured beta for design={design!r} stat={stat!r}. The registry ships '
                       f'EMPTY on purpose -- see the comment on MEASURED. Fit one with '
                       f'mdereplay.py --cuped, or use beta=1 (plain_fit). Registered: '
                       f'{sorted(MEASURED)}')
    asof = asof or dt.datetime.now(dt.timezone.utc)
    age = (asof.date() - dt.date.fromisoformat(m.measured_at)).days
    if age > SHELF_LIFE_DAYS and not allow_stale:
        raise StaleBeta(
            f'beta={m.beta:.3f} for {design}/{stat} was measured {age} days ago '
            f'({m.measured_at}, {m.window}); shelf life is {SHELF_LIFE_DAYS} days. Re-fit with '
            f'mdereplay.py --cuped, or pass allow_stale=True and state the age in the read. A '
            f'stale beta raises the false-positive rate through its threshold, not through bias.')
    day = dt.date.fromisoformat(m.measured_at)
    start = dt.datetime.combine(day, dt.time(0, 0), tzinfo=dt.timezone.utc)
    return CupedFit(beta=m.beta, design=design, stat=stat, n_draws=m.n_draws,
                    fit_start=start, fit_end=start + dt.timedelta(days=1),
                    rho=m.rho, sd_plain=m.sd_plain, sd_adj=m.sd_adj,
                    thr_plain=m.thr_plain, thr_adj=m.thr_adj,
                    block_hours=m.block_hours, gap_hours=m.gap_hours,
                    n_treat=m.n_treat, n_ctrl=m.n_ctrl,
                    mean_pre=m.mean_pre, mean_post=m.mean_post,
                    provenance=f'registry, measured {m.measured_at} on {m.window}: {m.note}')


# ---------------------------------------------------------------------------------------------
# Injection, and the attenuation check
# ---------------------------------------------------------------------------------------------
def inject(block, treat, effect, mode='uniform', pre=None, rng=None, frac=0.2):
    """A copy of `block` with the treated bots lifted, delivering the same TOTAL item gain.

    WHY MORE THAN UNIFORM, and this is the correction that matters most for the power numbers.
    A constant proportional lift on every treated bot is the best case an estimator can be given:
    it is a pure location shift, identical in every draw, with no interaction with the tail and
    no effect on the covariate. Review 2026-09-23: the injection "is the alternative the
    estimator was built for -- that is the flattery: it cannot fail."

    Real fixes in this project are not uniform. They are concentrated on the bots that were
    stuck: `entrapment-dominates`, `frozen-bots-five-defects`, `support-vote-freed-the-pillar-bots`,
    `hole-walks`. Unsticking a fifth of the pool multiplies a few bots by several times and leaves
    the rest at 1.0 -- the same arithmetic total, far more per-draw variance, because whether the
    effect lands depends on WHICH bots were drawn.

      'uniform'  every treated bot x (1+effect).                      Best case. Publishable as
                 an upper bound on sensitivity, not as the MDE.
      'random'   a random `frac` of treated bots carry the whole gain. Middle case.
      'lowest'   the `frac` of treated bots with the LOWEST pre-period rate carry the whole gain.
                 MEASURED USELESS for stat='mean': the gain is a fixed fraction of the drawn
                 group's own total, so the group mean rises by exactly (1+effect) no matter who
                 carries it, and uniform and 'lowest' returned identical power at every effect
                 size. It still discriminates for a robust statistic.
      'stuck'    a FIXED absolute gain to the bots the FLEET's pre block says are stuck (bottom
                 `frac` by rate), so a draw lands an effect only in proportion to how many stuck
                 bots it treated. This is the realistic case and the MDE a read should quote.

    'lowest' needs `pre` to rank by, and refuses without it rather than silently ranking on the
    post block -- ranking on post would let the injection choose its own beneficiaries after
    seeing the outcome.
    """
    r = dict(block.rates)
    present = [b for b in treat if b in r]
    if not present or effect == 0:
        return dataclasses.replace(block, rates=r)
    total = sum(r[b] for b in present)
    if mode == 'uniform':
        for b in present:
            r[b] *= (1.0 + effect)
        return dataclasses.replace(block, rates=r)
    if mode == 'stuck':
        # THE REALISTIC ALTERNATIVE, and the one that corrects a result this file produced.
        #
        # 'lowest' and 'random' redistribute a gain computed from the DRAWN group's own total, so
        # with an arithmetic-mean endpoint the group mean rises by exactly (1+effect) however the
        # gain is spread. Measured 2026-09-23: uniform and 'lowest' returned IDENTICAL power at
        # every effect size, which is not noise -- concentration is invisible to a mean when the
        # total is held fixed. The reviewer's objection was right about real fixes and wrong about
        # this injection's ability to represent one.
        #
        # What an entrapment fix actually does: it gives a FIXED absolute gain to the bots that
        # were stuck, wherever they are. So the stuck set is defined on the FLEET (from the pre
        # block, before any draw) and delta is a constant. A draw then lands a real effect only
        # in proportion to how many stuck bots it happened to treat, which is the heterogeneity
        # that costs power -- and it is invisible to any injection that scales with the drawn
        # group.
        if pre is None:
            raise ValueError("mode='stuck' needs the PRE block: the stuck set is a property of "
                             "the fleet before assignment, not of the drawn group")
        allr = sorted(pre.rates.values())
        cut = allr[min(len(allr) - 1, int(frac * len(allr)))]
        n_stuck = max(1, sum(1 for v in pre.rates.values() if v <= cut))
        delta = effect * sum(pre.rates.values()) / n_stuck
        for b in present:
            if pre.rates.get(b, 0.0) <= cut:
                r[b] += delta
        return dataclasses.replace(block, rates=r)
    k = max(1, int(round(frac * len(present))))
    if mode == 'random':
        if rng is None:
            raise ValueError("mode='random' needs an rng so the draw is reproducible")
        chosen = rng.sample(sorted(present), k)
    elif mode == 'lowest':
        if pre is None:
            raise ValueError("mode='lowest' needs the PRE block to rank by; ranking on the post "
                             "block would let the injection pick its beneficiaries after seeing "
                             "the outcome it is about to change")
        chosen = sorted(present, key=lambda b: (pre.rates.get(b, 0.0), b))[:k]
    else:
        raise ValueError(f'unknown inject mode {mode!r}')
    # The same TOTAL gain, so the three modes are the same size of fix delivered differently.
    gain = total * effect
    per = gain / len(chosen)
    for b in chosen:
        r[b] += per
    return dataclasses.replace(block, rates=r)


def attenuation(draws, pre, post, effect, fit=None, stat='mean', mode='uniform', rng=None,
                frac=0.2, pre_leak=0.0, center=False):
    """lambda = E[measured] / true, on the log scale. Must be ~1.

    WHERE THIS TEST HAS TEETH AND WHERE IT IS A TAUTOLOGY, stated because a test that cannot fail
    is not a test and this one cannot fail in its easiest configuration. For stat='mean' and
    mode='uniform', multiplying every treated bot's post rate by (1+e) multiplies their
    arithmetic mean by exactly (1+e), so log-of-mean rises by exactly log(1+e) and lambda is 1
    identically. That configuration checks only that the adjustment is wired the right way round.

    It has teeth in four configurations, and each corresponds to a real hazard:

      stat='trimmed'   POSITIVE CONTROL. A robust statistic really does attenuate: p90
                       winsorising measured 0.63 -- a 26% sd cut for a 37% signal loss, which
                       made the MDE worse. If this does not come back well below 1, the
                       instrument cannot see attenuation and its lambda=1 elsewhere means
                       nothing.
      stat='geom'      mean-of-log1p, which is NOT scale-equivariant: a bot-hour at r~0 registers
                       nothing from a multiplicative lift, so lambda < 1 and the loss is
                       concentrated on exactly the stuck bots this project cares about. Same
                       defect class as the trimming already refuted.
      mode='lowest'    a concentrated fix. Location is preserved but per-draw variance rises, so
                       lambda stays ~1 while POWER falls -- which is why the MDE must be quoted
                       from this mode and the attenuation from the uniform one.
      pre_leak > 0     the effect also lands in the PRE block at fraction phi, from deploy timing
                       or carried-over state (a pickaxe gained in pre persists into post). Then
                       lambda = 1 - beta*phi for CUPED against 1 - phi for plain DiD, so beta < 1
                       attenuates LESS. That is a genuine argument for CUPED and it is the
                       opposite of the one this module was first given.

    Returns (lambda, mean_measured, true_log_effect, n_used, n_degenerate).
    """
    fit = fit or plain_fit(stat=stat)
    true = math.log1p(effect)
    got, degen = [], 0
    for treat, ctrl in draws:
        boosted = inject(post, treat, effect, mode, pre=pre, rng=rng, frac=frac)
        leaked = inject(pre, treat, effect * pre_leak, mode, pre=pre, rng=rng, frac=frac) \
            if pre_leak else pre
        try:
            null = estimate(pre, post, treat, ctrl, fit, stat, center)
            hit = estimate(leaked, boosted, treat, ctrl, fit, stat, center)
        except DegenerateBlock:
            degen += 1
            continue
        got.append(hit.adjusted - null.adjusted)
    if not got:
        raise DegenerateBlock(f'no usable draws out of {degen} degenerate')
    m = st.mean(got)
    return m / true, m, true, len(got), degen


# ---------------------------------------------------------------------------------------------
# The in-window gate: what a READ calls
# ---------------------------------------------------------------------------------------------
def same_shape_assignments(bots, treat, pool_of, limit=4000, rng=None):
    """Every assignment with the SAME SHAPE as the realised one, realised assignment FIRST.

    SHAPE MATTERS, and getting it wrong silently breaks exactness. Under the sharp null the labels
    are exchangeable only across assignments the DRAW COULD HAVE PRODUCED. Permuting labels freely
    would mix 2-pool draws with 7-bot-scattered ones and compare the realised estimator against a
    null it was never drawn from -- which is a different and wrong test, and it would look fine.

    Two shapes exist here, and the shape is inferred from the realised assignment rather than
    configured, so the two cannot disagree:
      * WHOLE POOLS: every world is entirely treated or entirely control. Enumerate all ways of
        choosing that many worlds. With 16 worlds and 2 treated that is C(16,2)=120 exactly.
      * WITHIN-WORLD: k of each world's bots are treated. The exact count is C(5,2)^16 ~ 10^11, so
        it is SAMPLED up to `limit`, and the count is returned so a caller can say so.

    `rng` is passed in rather than created, so a p-value is reproducible from its seed. An
    unseeded null cannot be re-checked afterwards, which this project requires of a draw.
    """
    import itertools
    worlds = {}
    for b in bots:
        worlds.setdefault(pool_of(b), []).append(b)
    for w in worlds:
        worlds[w].sort()
    tset = set(treat)
    per = {w: sum(1 for b in v if b in tset) for w, v in worlds.items()}
    whole = all(n == 0 or n == len(worlds[w]) for w, n in per.items())

    realised = (sorted(tset), sorted(b for b in bots if b not in tset))
    out = [realised]

    if whole:
        treated_worlds = sorted(w for w, n in per.items() if n)
        allw = sorted(worlds)
        for combo in itertools.combinations(allw, len(treated_worlds)):
            if sorted(combo) == treated_worlds:
                continue
            t = sorted(b for w in combo for b in worlds[w])
            out.append((t, sorted(b for b in bots if b not in set(t))))
    else:
        r = rng or random.Random(0)
        ks = {w: per[w] for w in worlds}
        seen = {tuple(realised[0])}
        for _ in range(limit * 3):
            if len(out) >= limit:
                break
            t = []
            for w in sorted(worlds):
                k = ks[w]
                if k:
                    t += r.sample(worlds[w], k)
            t = sorted(t)
            key = tuple(t)
            if key in seen:
                continue
            seen.add(key)
            out.append((t, sorted(b for b in bots if b not in set(t))))
    return out


def in_window_p(pre, post, treat, ctrl, pool_of, fit=None, stat='mean', limit=4000, rng=None):
    """(p, n_assignments, realised_estimate) from THIS window's own randomization distribution.

    THE FIX FOR THE ONE FAILURE THAT MATTERS, and it is a finding about the gate this project
    already runs rather than about CUPED. MEASURED 2026-09-23 on the exact distribution of all 120
    two-pool assignments: a threshold fitted on one single-build window and applied to another
    6.2h later gives a false-positive rate of 13.3% for the PLAIN DiD and 20.8% for CUPED, against
    a nominal 5%. Reversed, 1.7% and 10.8%. The plain estimator is anti-conservative one direction
    and over-conservative the other -- not better, differently wrong. Both scale AND tail shape
    move between windows, so no earlier window can calibrate a later one.

    Replacing the transferred threshold with this measures exactly 5.0% for both estimators.

    `fit` is optional and orthogonal: beta must still come from a DISJOINT window (a coefficient
    fitted on the contrast it adjusts minimises that contrast's own variance) while the THRESHOLD
    must come from the read's OWN window. They are different objects and the defect was conflating
    them; passing fit=None gives the plain DiD, which is exactly beta=1.

    The realised assignment is placed first and its own estimate is included in the comparison,
    which is what makes the p-value valid rather than optimistic -- and it is why this does not
    call randomization_p by index, since the degenerate-draw filter would shift it.
    """
    draws = same_shape_assignments(sorted(set(pre.rates) & set(post.rates)), treat, pool_of,
                                   limit=limit, rng=rng)
    beta = 1.0 if fit is None else fit.beta
    vals = []
    for t, c in draws:
        try:
            x = contrast(pre, t, c, stat)
            y = contrast(post, t, c, stat)
        except DegenerateBlock:
            continue
        vals.append(y - beta * x)
    if not vals:
        raise DegenerateBlock('no non-degenerate assignment in this window')
    realised = vals[0]
    n = len(vals)
    if n < 20:
        raise ValueError(f'{n} usable assignments is too few for a randomization p-value; the '
                         f'smallest attainable p would be 1/{n}')
    a = abs(realised)
    return sum(1 for v in vals if abs(v) >= a) / n, n, realised
