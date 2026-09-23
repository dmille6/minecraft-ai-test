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
    a = ap.parse_args()

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
