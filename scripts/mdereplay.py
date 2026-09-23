#!/usr/bin/env python3
"""What effect can this fleet's canary ACTUALLY detect? Measured by replay, not by arithmetic.

WHY THIS EXISTS. The number everyone quotes -- "the canary cannot see an items change smaller
than 217%" -- is not a minimum detectable effect. banktruthnull.py:122 prints `MDE at 2 sd`,
which is a noise band: it says how wide the null is, not what effect size would be caught at a
stated false-positive rate and power. The older preregistration uses 1.96+0.84. So the figure
that has shaped a month of decisions was never a power calculation, and no design can be judged
better or worse than it until the thing is defined.

WHAT THIS DOES. It replays REAL telemetry from a period with ONE build live, so there is no
treatment effect in the data by construction. Then:

  NULL      draw a pseudo-canary, compute the estimator, repeat -- this is the false-positive
            distribution of the actual estimator on the actual fleet.
  INJECT    draw again, multiply the pseudo-treated bots' POST period by (1+e), recompute --
            this is the power curve.

The answer is the smallest injected e that is caught at the chosen power, with the threshold set
from the null at the chosen false-positive rate. That is an MDE. It can be compared between
designs, and it cannot be argued with.

WHY REPLAY AND NOT A FORMULA. The null standard deviation RISES with window length here (3h
0.42, 6h 0.53, 12h 0.60), which means the process drifts and the iid assumption behind a closed
-form MDE does not hold. Pools were measured moving -45% to +77% in six hours with no code
change. A formula would give a confident wrong answer; a replay inherits whatever the fleet
actually does, including the drift.

DESIGNS COMPARED. `pool` is today's: whole pools treated, so every contrast carries the full
between-world difference -- one pool is one Minecraft world. `world` treats N of the 5 bots in
EVERY world, making each world its own matched comparison. Both use lib/arms.py, which is the
same assignment the reads use.

HONEST LIMIT, stated because it is the one that matters: this measures SENSITIVITY only. It
cannot see treatment spillover, and for shared-resource changes there is plenty -- town chests
are shared and learned rules merge between peers, so a treated bot that frees chest space or
learns something helps its own controls. Within-world assignment will therefore look good here
and still estimate the wrong quantity for a banking change. Sensitivity and validity are
different questions and this file answers one of them.

CORRECTED THE SAME DAY, by a properly calibrated replay on a fixed centre set. Two conclusions
this file produced were WRONG, and the reasons are worth keeping because they are both traps this
harness can fall into:

  1. "Within-world assignment does not help." It DOES: +146% -> +121% at 3h and +92% -> +50% at
     24h. My run compared against a 2-pool draw and used an additive DiD with no attenuation
     calibration, on a 10-point effect grid with 150 trials -- so a real ~20-45% improvement sat
     inside one grid step of noise.
  2. "12h is worse than 6h." It is not; longer is monotone better (3h 0.325 -> 24h 0.233 in log
     sd). I varied the total data window, which changes the bot set, the exposure and the mean
     together. The right test holds the CENTRE SET fixed and varies only the window.

Use a fine effect grid, enough trials to separate adjacent steps, and a fixed centre set before
believing any comparison out of this file.

THE MEASURED PICTURE, 140 hours x 80 bots = 11,200 balanced bot-hour cells:
  86.7% of items/bot-hour variance is bot x hour -- within a bot, hour to hour. World level is
  4.0%, bot level 3.4%, world drift 5.2%. So ASSIGNMENT CAN REACH AT MOST ~9% OF THE VARIANCE.
  The binding constraint is temporal persistence of per-bot output, not assignment and not fleet
  size. Lag-1 autocorrelation of the residual is +0.31 (variance inflation 2.70), so 8x the data
  buys a 28% sd cut and halving the MDE costs 12x the wall clock.

  Best honest design (within-world 2-of-5 + CUPED): +90% at 3h, +65% at 6h, +41% at 24h/arm.
  Today's design: +146% at 3h. The committed deposit endpoint: +1873% at 3h, 80.8% of bot-hours
  deposit nothing at all.

  Trimming is refuted properly rather than empirically: a capped statistic cannot register a
  change above the cap, and the measured attenuation at p90 is 0.63 -- a 26% sd cut for a 37%
  signal loss. The tail carries the signal as well as the variance.

  And a load-bearing belief is corrected: "pools moved -45% to +77% in six hours with no code
  change" is mostly FIVE-BOT SAMPLING NOISE, not world drift. 75% of a world's hourly variance is
  sigma^2_e/5. Pool hourly series are mutually uncorrelated (r = +0.04), so pool-level DiD has
  almost nothing shared to remove -- its value is removing persistent LEVELS.

Usage, on the bots host:
    python3 mdereplay.py --hours 6 --design pool  --trials 400
    python3 mdereplay.py --hours 6 --design world --per-world 2 --trials 400
"""
import argparse
import collections
import os
import random
import statistics as st
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from telemetry import Events          # noqa: E402
from exposure import Spans            # noqa: E402
from arms import pool_of              # noqa: E402
import cuped                          # noqa: E402
from cuped import Block               # noqa: E402


METRIC = 'gross'


def load(hours, split_at):
    """Per-bot items and measured bot-hours, in a PRE and a POST half.

    Items are the summed POSITIVE inventory deltas -- the fleet's own endpoint. Exposure is
    lib/exposure.py's per-bot observed span, fed every in-window row before any filter, because
    an exposure derived from the filtered rows moves with the thing being measured.
    """
    ev = Events.load(since_minutes=int(hours * 60))
    pre_i, post_i = collections.Counter(), collections.Counter()
    spans = {'pre': Spans(), 'post': Spans()}
    n = 0
    for r in ev.rows:
        b = (r['bot'] or {}).get('name')
        if not b or b.startswith('self-'):
            continue
        era = 'pre' if r['t'] < split_at else 'post'
        spans[era].add(b, b, r['t'])
        n += 1
        sk = r['raw'].get('skill') or {}
        d = sk.get('inventory_delta') or {}
        if METRIC == 'gross':
            v = sum(x for x in d.values() if x > 0)
        else:
            # items that LEFT the inventory on a successful deposit -- i.e. reached a chest
            v = (-sum(x for x in d.values() if x < 0)
                 if (sk.get('name') == 'deposit' and sk.get('status') == 'success') else 0)
        if v:
            (pre_i if era == 'pre' else post_i)[b] += v
    return pre_i, post_i, spans, n, len(ev.rows)


def rates(items, spans, bots):
    out = {}
    for b in bots:
        try:
            h = spans.hours(b, allow_zero=True)
        except Exception:
            h = 0.0
        if h > 0.05:
            out[b] = items.get(b, 0) / h
    return out


def summary(vals, stat):
    """The group statistic. WHY MORE THAN ONE.

    MEASURED 2026-09-23: the within-world design treats 32 bots against the pool design's 10 and
    its null standard deviation is slightly WORSE (6.616 vs 6.225), giving the same +100% MDE.
    Three times the treated bots buying nothing means the variance is not between worlds, and it
    is not averaging down the way independent noise would. That is the signature of a heavy tail:
    if a few bot-hours carry most of the output, a mean over 32 is barely steadier than over 10.

    So a robust statistic is the live hypothesis, and this makes it measurable rather than
    argued. A caution that must travel with any result: a trimmed or log endpoint CHANGES WHAT
    IMPROVEMENT MEANS. It cannot quietly become evidence about arithmetic fleet output -- a
    geometric-mean gain is a different claim from "the fleet gathered 20% more".
    """
    import math
    if not vals:
        return None
    if stat == 'mean':
        return st.mean(vals)
    if stat == 'log1p':
        return st.mean([math.log1p(v) for v in vals])
    if stat == 'median':
        return st.median(vals)
    if stat == 'trimmed':
        v = sorted(vals)
        k = int(0.2 * len(v))                  # 20% from each end
        v = v[k:len(v) - k] or v
        return st.mean(v)
    raise ValueError(stat)


def did(treat, ctrl, pre, post, stat='mean'):
    """Additive difference-in-differences on items/bot-hour.

    ADDITIVE, not a ratio of ratios. A ratio divides by each bot's pre-period rate, and a bot
    with a near-zero baseline then produces an unbounded number -- this project has a registered
    endpoint that printed `nan` from exactly that, and a recorded -132% p5 on a deposit ratio.
    The additive form has no such denominator.
    """
    def mean(g, d):
        return summary([d[b] for b in g if b in d], stat)
    a, b_, c, d_ = mean(treat, post), mean(treat, pre), mean(ctrl, post), mean(ctrl, pre)
    if None in (a, b_, c, d_):
        return None
    return (a - b_) - (c - d_)


def draw(design, bots, rng, per_world, n_pools):
    worlds = collections.defaultdict(list)
    for b in bots:
        worlds[pool_of(b)].append(b)
    if design == 'pool':
        chosen = rng.sample(sorted(worlds), min(n_pools, len(worlds)))
        treat = [b for w in chosen for b in worlds[w]]
    else:
        treat = []
        for w in sorted(worlds):
            if len(worlds[w]) >= per_world:
                treat += rng.sample(sorted(worlds[w]), per_world)
    ts = set(treat)
    return treat, [b for b in bots if b not in ts]


# =============================================================================================
# CUPED mode. Added 2026-09-23. Extends this file rather than starting a third replay, because
# CLAUDE.md's one-blessed-instrument rule applies to a power harness as much as to a telemetry
# query -- the draw, the exposure and the arm assignment must be the SAME ones the MDE numbers
# above came from, or the two halves of this report are not comparable.
#
# The battery runs in the order that can KILL the idea first:
#   0  positive control, and the single-build windows it will use
#   1  rho by GAP            -- if rho decays with the gap, a beta* fitted on adjacent blocks is
#                               mis-tuned for a real read, and nothing after this matters
#   2  beta fitted on one single-build window, evaluated on another
#   3  the null: where it is CENTRED, and the held-out false-positive rate
#   4  conditional bias on the drawn baseline, per world
#   5  attenuation, with an absolute-cap positive control
#   6  MDE with and without, per window length, on a fixed centre set
#   7  power at the REALISTIC alternative (a concentrated fix), not the uniform one
# =============================================================================================
MIN_HOURS = 0.05


def single_build_windows(ev, bucket_min=2, min_hours=1.0):
    """Maximal intervals in which exactly ONE code version is observed. Never a typed cutoff.

    `never-type-a-cutoff` is a recorded failure here: a hand-typed boundary is a number that was
    true when it was typed. A deploy or a canary teardown moves the boundary, so it is DERIVED
    from the rows -- bucket the walk by time, record the version set per bucket, and return the
    maximal runs whose union is a single version.

    This is what makes the null null. Measured 2026-09-23: over a 13h walk the minority build
    9a6aa13+4fa233 covered 20 bots between 12:10 and 18:22 -- a real canary, i.e. a real
    treatment effect. A "null" replay across that interval would fit beta partly to a genuine
    effect and call the result a false-positive rate.
    """
    import datetime as dtm
    buckets = {}
    for r in ev.rows:
        t = r['t']
        k = int(t.timestamp() // (bucket_min * 60))
        v = ((r['raw'].get('code') or {}).get('version') or '?')
        buckets.setdefault(k, set()).add(v)
    out, run = [], []
    for k in sorted(buckets):
        vs = buckets[k]
        if len(vs) == 1 and (not run or (buckets[run[-1]] == vs and k == run[-1] + 1)):
            run.append(k)
        else:
            if run:
                out.append(run)
            run = [k] if len(vs) == 1 else []
    if run:
        out.append(run)
    res = []
    for run in out:
        s = dtm.datetime.fromtimestamp(run[0] * bucket_min * 60, dtm.timezone.utc)
        e = dtm.datetime.fromtimestamp((run[-1] + 1) * bucket_min * 60, dtm.timezone.utc)
        if (e - s).total_seconds() / 3600.0 >= min_hours:
            res.append((s, e, next(iter(buckets[run[0]])), len(run)))
    return res


def block_panel(ev, edges, version=None):
    """Per-bot ITEMS and HOURS for each interval in `edges`, kept SEPARATE so blocks can merge.

    Items and hours are not pre-divided, so adjacent blocks can be combined into a longer window
    by summing both -- which is what makes "hold the centre set fixed and vary only the window"
    possible. mdereplay's docstring records getting the opposite wrong: varying the total data
    window changed the bot set, the exposure and the mean together, and produced the false
    conclusion that 12h was worse than 6h.

    Exposure is lib/exposure.py's per-bot span, fed EVERY row in the interval before any event
    filter, because an exposure derived from filtered rows moves with the thing being measured.
    """
    n = len(edges) - 1
    items = [collections.Counter() for _ in range(n)]
    spans = [Spans() for _ in range(n)]
    used = 0
    for r in ev.rows:
        b = (r['bot'] or {}).get('name')
        if not b or b.startswith('self-'):
            continue
        if version and ((r['raw'].get('code') or {}).get('version') or '?') != version:
            continue
        t = r['t']
        k = -1
        for i in range(n):
            if edges[i] <= t < edges[i + 1]:
                k = i
                break
        if k < 0:
            continue
        spans[k].add(b, b, t)
        used += 1
        d = ((r['raw'].get('skill') or {}).get('inventory_delta')) or {}
        v = sum(x for x in d.values() if x > 0)
        if v:
            items[k][b] += v
    hrs = []
    for k in range(n):
        per = {}
        for b in spans[k].groups():
            try:
                per[b] = spans[k].hours(b, allow_zero=True)
            except Exception:
                per[b] = 0.0
        hrs.append(per)
    return items, hrs, used


def merge(items, hrs, edges, lo, hi, name):
    """Blocks [lo,hi) as one Block: items summed, hours summed, THEN divided."""
    it, hh = collections.Counter(), collections.Counter()
    for k in range(lo, hi):
        it.update(items[k])
        for b, v in hrs[k].items():
            hh[b] += v
    return Block(name, edges[lo], edges[hi],
                 {b: it.get(b, 0) / h for b, h in hh.items() if h > MIN_HOURS})


def make_draws(design, bots, seed, per_world, n_pools, n):
    rng = random.Random(seed)
    return [draw(design, bots, rng, per_world, n_pools) for _ in range(n)]


def split_edges(s, e, n):
    return [s + (e - s) * k / n for k in range(n + 1)]


def cuped_battery(a):
    import datetime as dtm
    print(f'=== CUPED battery  design={a.design} stat={a.stat} trials={a.trials} ===\n')
    ev = Events.load(since_minutes=int(a.walk * 60))
    wins = single_build_windows(ev, min_hours=a.min_window)

    print('0. POSITIVE CONTROL -- show the instrument finding a presence before it reports any '
          'absence')
    print(f'   walked {len(ev.rows):,} rows over {a.walk}h; versions present: '
          f'{ {k: v for k, v in sorted(ev.versions().items(), key=lambda x: -x[1])} }')
    print(f'   SINGLE-BUILD windows found (derived from the rows, never typed):')
    for s, e, v, nb_ in wins:
        print(f'     {s:%m-%d %H:%M}Z..{e:%H:%M}Z  {(e-s).total_seconds()/3600:5.2f}h  {v}')
    if len(wins) < 2:
        raise SystemExit(f'NotAnInstrument: {len(wins)} single-build window(s) of >= {a.min_window}h. '
                         f'CUPED needs one to FIT on and a DISJOINT one to evaluate on, and a '
                         f'window that straddles a deploy contains a real treatment effect, so '
                         f'its "null" is not null. Widen --walk or lower --min-window.')
    wins.sort(key=lambda w: w[0])
    fit_w, ev_w = wins[-2], wins[-1]
    print(f'   -> FIT on {fit_w[0]:%H:%M}Z..{fit_w[1]:%H:%M}Z, EVALUATE on '
          f'{ev_w[0]:%H:%M}Z..{ev_w[1]:%H:%M}Z  (gap '
          f'{(ev_w[0]-fit_w[1]).total_seconds()/3600:.2f}h, disjoint by construction)')

    nsub = a.sub
    fe = split_edges(fit_w[0], fit_w[1], nsub)
    ee = split_edges(ev_w[0], ev_w[1], nsub)
    fi, fh, fu = block_panel(ev, fe, fit_w[2])
    ei, eh, eu = block_panel(ev, ee, ev_w[2])
    fblocks = [merge(fi, fh, fe, k, k + 1, f'f{k}') for k in range(nsub)]
    eblocks = [merge(ei, eh, ee, k, k + 1, f'e{k}') for k in range(nsub)]
    common = sorted(set.intersection(*[set(b.rates) for b in fblocks + eblocks]))
    worlds = {pool_of(b) for b in common}
    print(f'   {fu:,} rows in the fit window, {eu:,} in the eval window')
    print(f'   {len(common)} bots present in ALL {2*nsub} sub-blocks, across {len(worlds)} worlds')
    for lbl, bl in (('fit ', fblocks), ('eval', eblocks)):
        for k, b in enumerate(bl):
            vals = [b.rates[x] for x in common]
            print(f'   {lbl} block {k} {b.start:%H:%M}..{b.end:%H:%M}Z  '
                  f'{(b.end-b.start).total_seconds()/3600:.2f}h  mean {st.mean(vals):6.2f} '
                  f'median {st.median(vals):5.2f} items/bot-h  zeros {sum(1 for v in vals if v==0):3d}'
                  f'/{len(vals)}')
    if len(common) < 20 or len(worlds) < 8:
        raise SystemExit(f'NotAnInstrument: {len(common)} bots / {len(worlds)} worlds. An 80-bot '
                         f'fleet in 16 worlds does not look like this -- fix the window first.')
    nt = len(make_draws(a.design, common, 1, a.per_world, a.pools, 1)[0][0])
    nc = len(common) - nt
    print(f'   the draw treats {nt} of {len(common)} bots, {nc} control '
          f'(1/n_T - 1/n_C = {1/nt - 1/nc:+.4f}, which sets the log-of-mean Jensen term)')

    # ---- 1. rho by GAP -----------------------------------------------------------------------
    print('\n1. rho BY GAP -- the measurement that can kill the estimator.')
    print('   FLAT in the gap => persistent levels, and beta* transfers to a real read.')
    print('   DECAYING => it is the residual autocorrelation (+0.31 at lag 1), which is not a')
    print('   level, and a beta* fitted on adjacent blocks is then too large for the gap a read')
    print('   has. This also reconciles the arithmetic: sd x0.90 is a 19% VARIANCE cut, but the')
    print('   persistent components of this endpoint measured 12.6% in total.')
    allb = fblocks + eblocks
    gaps = cuped.rho_by_gap(allb, lambda: make_draws(a.design, common, 21, a.per_world,
                                                     a.pools, a.trials), a.stat)
    by = {}
    for g, r, n in gaps:
        by.setdefault(round(g, 1), []).append(r)
    pts = sorted((g, st.mean(v), len(v)) for g, v in by.items())
    for g, r, n in pts:
        print(f'   gap {g:6.2f}h  rho {r:+.3f}  ({n} block pair{"s" if n > 1 else ""})')
    if len(pts) >= 3:
        mg, mr = st.mean([g for g, _, _ in pts]), st.mean([r for _, r, _ in pts])
        vg = sum((g - mg) ** 2 for g, _, _ in pts)
        slope = sum((g - mg) * (r - mr) for g, r, _ in pts) / vg if vg else float('nan')
        near_, far_ = pts[0][1], pts[-1][1]
        print(f'   slope {slope:+.5f} rho/hour; rho {near_:+.3f} at {pts[0][0]:.2f}h -> '
              f'{far_:+.3f} at {pts[-1][0]:.2f}h')
        print(f'   -> {"DECAYS: beta* does NOT transfer across a real gap" if slope < -0.004 else "FLAT: consistent with persistent levels that transfer"}')

    # ---- 2. fit, and stability --------------------------------------------------------------
    h = nsub // 2
    fit_pre = merge(fi, fh, fe, 0, h, 'fit_pre')
    fit_post = merge(fi, fh, fe, h, nsub, 'fit_post')
    ev_pre = merge(ei, eh, ee, 0, h, 'eval_pre')
    ev_post = merge(ei, eh, ee, h, nsub, 'eval_post')
    blk_h = (fit_pre.end - fit_pre.start).total_seconds() / 3600.0
    print(f'\n2. beta FITTED on the earlier single-build window, blocks of {blk_h:.2f}h')
    dr_fit = make_draws(a.design, common, 31, a.per_world, a.pools, a.trials)
    dr_ev = make_draws(a.design, common, 32, a.per_world, a.pools, a.trials)
    fit = cuped.fit_beta(dr_fit, fit_pre, fit_post, design=a.design, stat=a.stat, alpha=a.alpha,
                         n_treat=nt, n_ctrl=nc,
                         provenance=f'single-build window ending {fit_post.end:%m-%d %H:%M}Z')
    print(f'   {fit.describe()}')
    print(f'   var(X_pre) {fit.var_pre:.5f}  var(X_post) {fit.var_post:.5f}   ratio '
          f'{fit.var_post/fit.var_pre:.3f}  <- the v_pre=v_post premise behind the x0.897 '
          f'prediction is only as good as this')
    fit_ev = cuped.fit_beta(dr_ev, ev_pre, ev_post, design=a.design, stat=a.stat, alpha=a.alpha,
                            n_treat=nt, n_ctrl=nc, provenance='eval window, in-sample')
    print(f'   STABILITY: fit window beta* {fit.beta:+.3f} (rho {fit.rho:+.3f})  vs  eval '
          f'window\'s own beta* {fit_ev.beta:+.3f} (rho {fit_ev.rho:+.3f})')
    print(f'   -> {abs(fit.beta-fit_ev.beta):.3f} apart across two disjoint single-build windows')
    try:
        cuped.estimate(fit_pre, fit_post, *dr_fit[0], fit, a.stat)
        print('   !! THE LEAK GUARD DID NOT FIRE on its own fit window -- that is a bug')
    except cuped.LeakyFit:
        print('   leak guard: applying this fit to its OWN window raises LeakyFit, as it must')

    # ---- 3. the null ------------------------------------------------------------------------
    print('\n3. THE NULL on the HELD-OUT window. This is the deployment configuration: beta AND')
    print('   its threshold both come from the fit window and are applied to data neither saw.')
    xs, ys, degen = cuped.contrasts_over(dr_ev, ev_pre, ev_post, a.stat)
    d_plain = [y - x for x, y in zip(xs, ys)]
    d_adj = [y - fit.beta * x for x, y in zip(xs, ys)]
    d_ctr = [(y - fit.mean_post) - fit.beta * (x - fit.mean_pre) for x, y in zip(xs, ys)]
    print(f'   {len(xs)} usable draws, {degen} degenerate (COUNTED, not skipped -- dropping the '
          f'empty tail biases the null toward the middle)')
    for nm, v in (('plain DiD   ', d_plain), ('CUPED       ', d_adj), ('CUPED+centre', d_ctr)):
        s = cuped.null_summary(v, a.alpha)
        print(f'   {nm} mean {s["mean"]:+.4f} +-{1.96*s["se"]:.4f}  sd {s["sd"]:.4f}  '
              f'bias {s["bias_in_sd"]:+.3f}sd  centred={str(s["centered"]):5s} '
              f'distinct {s["distinct"]}/{len(v)}')
    import math as _m
    npool = len(worlds)
    poss = _m.comb(npool, a.pools) if a.design == 'pool' else None
    if poss:
        print(f'   NOTE: {npool} worlds and a {a.pools}-pool draw give only C({npool},{a.pools})'
              f' = {poss} possible assignments, so')
        print(f'   trials beyond {poss} resample rather than inform. A {100*a.alpha:.0f}% tail of '
              f'{poss} values is {max(1,int(a.alpha*poss))} order statistics.')
    print(f'\n   FALSE-POSITIVE RATE at nominal alpha={a.alpha} (two-sided), threshold from the '
          f'FIT window:')
    for nm, v, thr in (('plain DiD', d_plain, fit.thr_plain), ('CUPED    ', d_adj, fit.thr_adj)):
        fp = sum(1 for z in v if abs(z) > abs(thr)) / len(v)
        own = cuped._quantile([abs(z) for z in v], 1 - a.alpha)
        print(f'   {nm}  threshold |{abs(thr):.4f}| -> FPR {100*fp:5.1f}%   '
              f'(this window\'s OWN {100*(1-a.alpha):.0f}th pct of |D| is {own:.4f})')
    print('   An FPR above nominal means the fit window\'s threshold is too narrow for this '
          'window. That is the\n   stale-beta failure, and it arrives through the THRESHOLD, not '
          'through bias.')

    # ---- 4. conditional bias ----------------------------------------------------------------
    print('\n4. CONDITIONAL BIAS: regress the estimator on X_pre over null draws. slope = beta* - beta,')
    print('   so 0 at beta* and (beta*-1) at beta=1. A non-zero slope means the verdict depends on')
    print('   WHICH pools were drawn -- argmax-pool-guarantees-reversion, measured rather than argued.')
    s_adj, s_one, r2 = cuped.conditional_bias(xs, ys, fit.beta)
    print(f'   slope at beta={fit.beta:+.3f} (CUPED): {s_adj:+.4f}      slope at beta=1 (plain '
          f'DiD): {s_one:+.4f}')
    print(f'   -> the {"CUPED" if abs(s_adj) < abs(s_one) else "PLAIN"} estimator carries less '
          f'dependence on the drawn baseline')
    for nm, f_ in (('plain DiD      ', cuped.plain_fit(a.design, a.stat)),
                   (f'CUPED b={fit.beta:+.2f}', fit)):
        offs = cuped.pool_offsets(dr_ev, ev_pre, ev_post, f_, pool_of, a.stat)
        vals = [v for v, _ in offs.values()]
        worst = max(offs.items(), key=lambda kv: abs(kv[1][0]))
        print(f'   {nm}: per-world offset spread {max(vals)-min(vals):.4f} log, worst world '
              f'{worst[0]} {worst[1][0]:+.4f} over {worst[1][1]} draws')

    # ---- 5. attenuation ---------------------------------------------------------------------
    print('\n5. ATTENUATION lambda = E[measured]/true, on the log scale. Must be ~1.')
    for lbl, kw in (('uniform lift        ', {}),
                    ('concentrated (lowest)', {'mode': 'lowest', 'frac': 0.2}),
                    ('pre-leak phi=0.25   ', {'pre_leak': 0.25})):
        lam, m, tr, n, dg = cuped.attenuation(dr_ev, ev_pre, ev_post, a.effect, fit, a.stat, **kw)
        print(f'   CUPED  {lbl}  lambda {lam:.4f}   ({m:+.4f} vs true {tr:+.4f} log, {n} draws)')
    lamp, *_ = cuped.attenuation(dr_ev, ev_pre, ev_post, a.effect,
                                 cuped.plain_fit(a.design, a.stat), a.stat, pre_leak=0.25)
    print(f'   plain  pre-leak phi=0.25    lambda {lamp:.4f}   <- beta<1 attenuates LESS under '
          f'leakage, which is an argument FOR CUPED')
    allv = [v for b in (ev_pre, ev_post) for v in b.rates.values()]
    cap = sorted(allv)[int(0.90 * len(allv))]

    def capstat(v):
        return st.mean([min(x, cap) for x in v])
    lamc, *_ = cuped.attenuation(dr_ev, ev_pre, ev_post, a.effect,
                                 cuped.plain_fit(a.design, 'cap'), capstat)
    print(f'   POSITIVE CONTROL: winsorised at an ABSOLUTE p90 cap of {cap:.2f} items/bot-h -> '
          f'lambda {lamc:.4f}')
    print(f'   -> the instrument {"CAN" if lamc < 0.95 else "CANNOT"} see attenuation, so '
          f'lambda~1 above {"means something" if lamc < 0.95 else "MEANS NOTHING"}')
    print('   (quantile trimming is scale-equivariant and returns 1.000; it cannot serve as this '
          'control.\n    The fleet figure that made the MDE worse, 0.63, was an ABSOLUTE p90 cap.)')

    # ---- 6. MDE by window, fixed centre set -------------------------------------------------
    print('\n6. MDE with and without CUPED, per window length, on a FIXED CENTRE SET.')
    print(f'   Convention exp(2.8016*sd_log)-1 at two-sided alpha=0.05, 80% power. The HARM side')
    print(f'   -(1-exp(-2.8016*sd_log)) is what a gate that REVERTS is actually priced by, and it')
    print(f'   is a very different number from the gain side.')
    print(f'\n   {"win/arm":>8s} {"sd plain":>9s} {"sd CUPED":>9s} {"ratio":>6s} {"MDE+ plain":>11s}'
          f' {"MDE+ CUPED":>11s} {"MDE- plain":>11s} {"MDE- CUPED":>11s} {"beta*":>7s}')
    w = 1
    while 2 * w <= nsub:
        fp = merge(fi, fh, fe, nsub - 2 * w, nsub - w, 'fp')
        fq = merge(fi, fh, fe, nsub - w, nsub, 'fq')
        ep = merge(ei, eh, ee, nsub - 2 * w, nsub - w, 'ep')
        eq = merge(ei, eh, ee, nsub - w, nsub, 'eq')
        f2 = cuped.fit_beta(dr_fit, fp, fq, design=a.design, stat=a.stat, alpha=a.alpha,
                            n_treat=nt, n_ctrl=nc)
        x2, y2, _ = cuped.contrasts_over(dr_ev, ep, eq, a.stat)
        sp = st.pstdev([y - x for x, y in zip(x2, y2)])
        sa = st.pstdev([y - f2.beta * x for x, y in zip(x2, y2)])
        M = cuped.mde_from_sd_log
        print(f'   {blk_h*w/(nsub//2):7.2f}h {sp:9.4f} {sa:9.4f} {sa/sp:6.3f} '
              f'{100*M(sp):+10.0f}% {100*M(sa):+10.0f}% '
              f'{-100*M(sp,direction="harm"):+10.0f}% {-100*M(sa,direction="harm"):+10.0f}% '
              f'{f2.beta:+7.3f}')
        w *= 2
    print('   Every row uses the same trailing blocks and the SAME centre set, so only the window')
    print('   varies. mdereplay\'s docstring records the false "12h is worse than 6h" that came')
    print('   from varying the bot set and the exposure at the same time.')

    # ---- 7. power at the realistic alternative ----------------------------------------------
    print('\n7. POWER, empirically. A uniform proportional lift on every treated bot is the BEST')
    print('   case an estimator can be given -- a pure location shift with no interaction with')
    print('   the tail. Real fixes here are concentrated on the bots that were stuck (entrapment,')
    print('   frozen bots, pillar bots), which delivers the same total items with far more')
    print('   per-draw variance. The concentrated row is the one a read should quote.')
    for mode in ('uniform', 'lowest'):
        thr_p, thr_a = abs(fit.thr_plain), abs(fit.thr_adj)
        row = []
        for eff in (0.25, 0.50, 1.00, 1.50, 2.50):
            hp = ha = n = 0
            for treat, ctrl in dr_ev:
                bo = cuped.inject(ev_post, treat, eff, mode, pre=ev_pre, frac=0.2)
                try:
                    e = cuped.estimate(ev_pre, bo, treat, ctrl, fit, a.stat)
                except cuped.DegenerateBlock:
                    continue
                n += 1
                hp += abs(e.plain) > thr_p
                ha += abs(e.adjusted) > thr_a
            row.append((eff, hp / n if n else 0, ha / n if n else 0))
        print(f'   {mode:>8s}: ' + '   '.join(f'+{100*e:.0f}%: {p:.2f}/{q:.2f}' for e, p, q in row))
    print('   (power plain/CUPED at each injected effect)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=float, default=6.0)
    ap.add_argument('--design', choices=['pool', 'world'], default='pool')
    ap.add_argument('--per-world', type=int, default=2)
    ap.add_argument('--pools', type=int, default=2, help="drawrec.sh takes TWO pools, not four")
    ap.add_argument('--trials', type=int, default=400)
    ap.add_argument('--alpha', type=float, default=0.05)
    ap.add_argument('--power', type=float, default=0.80)
    ap.add_argument('--metric', choices=['gross', 'banked'], default='gross')
    ap.add_argument('--stat', choices=['mean', 'trimmed', 'median', 'log1p'], default='mean')
    ap.add_argument('--seed', type=int, default=11)
    # ---- CUPED mode (2026-09-23). See cuped_battery() and lib/cuped.py. ----
    ap.add_argument('--cuped', action='store_true',
                    help='run the CUPED validation battery instead of the plain MDE replay')
    ap.add_argument('--walk', type=float, default=13.0,
                    help='hours of telemetry to walk when looking for single-build windows')
    ap.add_argument('--min-window', type=float, default=1.0,
                    help='shortest single-build window to accept as a fit or eval period')
    ap.add_argument('--sub', type=int, default=4,
                    help='sub-blocks per single-build window; must be even (pre/post) and >=2')
    ap.add_argument('--effect', type=float, default=0.30,
                    help='injected effect for the attenuation check')
    ap.add_argument('--version-filter', default=None,
                    help='restrict to ONE code version, for a window longer than any '
                         'single-build interval. States the trade explicitly: the bots that ran '
                         'the other build lose exposure in the blocks that overlap it and drop '
                         'out of the centre set, so report the drop count.')
    a = ap.parse_args()
    if a.cuped:
        if a.sub < 2 or a.sub % 2:
            raise SystemExit('--sub must be even and >= 2: each window splits into pre and post')
        return cuped_battery(a)

    global METRIC
    METRIC = a.metric
    import datetime as dt
    now = dt.datetime.now(dt.timezone.utc)
    split = now - dt.timedelta(hours=a.hours / 2)
    pre_i, post_i, spans, kept, total = load(a.hours, split)
    bots = sorted(set(spans['pre'].groups()) & set(spans['post'].groups()))

    pre = rates(pre_i, spans['pre'], bots)
    post = rates(post_i, spans['post'], bots)
    common = sorted(set(pre) & set(post))
    worlds = len({pool_of(b) for b in common})
    print(f'replay over {a.hours}h split at {split:%H:%M}Z metric={a.metric} | {total:,} rows, {kept:,} usable')
    print(f'positive control: {len(common)} bots with exposure in BOTH halves across {worlds} worlds; '
          f'mean items/bot-h pre {st.mean([pre[b] for b in common]):.2f} post '
          f'{st.mean([post[b] for b in common]):.2f}')
    if len(common) < 20 or worlds < 8:
        raise SystemExit(f'NotAnInstrument: only {len(common)} bots across {worlds} worlds. An '
                         f'80-bot fleet in 16 worlds does not look like this -- fix the window '
                         f'or the loader before reading a power curve off it.')

    rng = random.Random(a.seed)
    null = []
    for _ in range(a.trials):
        t, c = draw(a.design, common, rng, a.per_world, a.pools)
        v = did(t, c, pre, post, a.stat)
        if v is not None:
            null.append(v)
    null.sort()
    # One-sided upper threshold at alpha: the value an effect must exceed to be called real.
    thr = null[min(len(null) - 1, int((1 - a.alpha) * len(null)))]
    base = st.mean([post[b] for b in common])
    print(f'\nNULL over {len(null)} draws (stat={a.stat}, {a.design}'
          + (f', {a.per_world} of 5 per world' if a.design == 'world' else f', {a.pools} pools')
          + f'): median {st.median(null):+.3f}  sd {st.pstdev(null):.3f}  '
          f'{100*(1-a.alpha):.0f}th pct {thr:+.3f} items/bot-h')
    print(f'  the null is centred near zero: {abs(st.median(null)) < st.pstdev(null)}  '
          f'(a biased estimator would show a median far from 0)')
    print(f'  fleet mean {base:.2f} items/bot-h, so that threshold is {100*thr/base:.0f}% of output')

    print(f'\nPOWER at alpha={a.alpha}, target power={a.power}:')
    print(f"  {'injected':>9s} {'detected':>9s}  {'power':>6s}")
    mde = None
    for eff in (0.05, 0.10, 0.20, 0.35, 0.50, 0.75, 1.00, 1.50, 2.00, 3.00):
        hits = 0
        rng2 = random.Random(a.seed + 1)
        for _ in range(a.trials):
            t, c = draw(a.design, common, rng2, a.per_world, a.pools)
            boosted = dict(post)
            for b in t:
                boosted[b] = post[b] * (1 + eff)
            v = did(t, c, pre, boosted, a.stat)
            if v is not None and v > thr:
                hits += 1
        p = hits / a.trials
        print(f'  {100*eff:>8.0f}% {hits:>9d}  {p:>6.2f}' + ('   <== MDE' if mde is None and p >= a.power else ''))
        if mde is None and p >= a.power:
            mde = eff
    print(f'\nMDE (smallest injected items effect caught {100*a.power:.0f}% of the time at a '
          f'{100*a.alpha:.0f}% false-positive rate): '
          + (f'+{100*mde:.0f}%' if mde else f'NOT REACHED even at +300%'))
    print('This measures SENSITIVITY only. It cannot see treatment spillover, and for a '
          'shared-resource change\nthere is plenty -- chests and learned rules are shared, so a '
          'within-world design can look good here\nand still estimate the wrong quantity.')


if __name__ == '__main__':
    sys.exit(main())
