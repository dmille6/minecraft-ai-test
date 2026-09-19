#!/usr/bin/env python3
"""The draw offered board-d + placebo-d: a canary that is 100% 3090 against a
control that is 90% 5080. halfdid tested a SINGLE 3090 pool against a mixed
control; this is the two-pool, fully-segregated case, and extrapolating from one
to the other is exactly the move this project keeps getting burned by.

So measure it. Same placebo windows, same estimator, same planted-effect control.
Three configurations, all with 2-pool canaries so only the half mix changes:

    both canary pools 3090   (what the draw just offered)
    both canary pools 5080   (what the old rule always produced)
    one of each              (the mixed case)

If the fully-segregated null is no wider than the others, the draw is safe to
use as offered. If it is wider, the half has to come back as a constraint rather
than a covariate, and the right fix is to require a mixed pair.
"""

# ---------------------------------------------------------------------------
# RETRACTED CONTROL, 2026-09-19. Any "planted +30% -> +30.0% ok" this file
# prints is an ARITHMETIC IDENTITY, not evidence. Multiplying the canary post
# window by f and reporting the log difference returns log(f) whatever the data
# says: measured across f in {1.05, 1.30, 1.77, 3.50, 0.40}, the spread over 162
# fits was 7e-16 every time. It could never fail.
# The real denominator control is realcontrol2.py, which drops a bot's ACTUAL
# per-bot items, must SCATTER (sd 0.30), and carries a mutant caught at
# log(4/5) = -0.2231. Note that its own first version repeated the same mistake
# by scaling the dropped bot's items by the surviving pool fraction.
# ---------------------------------------------------------------------------
import sys, math, itertools, datetime as dt, statistics as st
sys.path.insert(0, "/home/mike/mcai-analysis")
sys.path.insert(0, "/opt/minecraft-ai/scripts")
import halfdid as H

HOUR = dt.timedelta(hours=1)


def pooled(agg, pools, t0, t1, inject=1.0):
    num = bh = 0.0
    h = t0
    while h < t1:
        for p in pools:
            n = len(agg["bots"].get((p, h), ()))
            if n:
                bh += n
                num += agg["items"].get((p, h), 0) * inject
        h += HOUR
    return (num / bh if bh else None), bh


def did(agg, can, ctl, cut, W, inject=1.0):
    pre0, post1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
    a, abh = pooled(agg, can, pre0, cut)
    b, bbh = pooled(agg, can, cut, post1, inject=inject)
    c, _ = pooled(agg, ctl, pre0, cut)
    d, _ = pooled(agg, ctl, cut, post1)
    if not all(x for x in (a, b, c, d)):
        return None
    if min(abh, bbh) < W * 3 * len(can):
        return None
    return math.log((b / a) / (d / c))


def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0
    W = 3
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    since = now - dt.timedelta(days=days)
    agg = H.aggregate(since, now, version=None, chunk_hours=6)
    pools = sorted({p for (p, _h) in agg["bots"]})
    pools = [p for p in pools if not p.startswith("isolated") and len(p.split("-")) == 2]
    spans = H.canary_intervals()

    buckets = {"both 3090": [], "both 5080": [], "one of each": []}
    inj = {k: [] for k in buckets}
    INJECT = 1.30
    t = since + dt.timedelta(hours=W)
    cuts = []
    while t <= now - dt.timedelta(hours=W):
        cuts.append(t)
        t += HOUR
    for cut in cuts:
        t0, t1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
        clean = [p for p in pools if not H.contaminated(p, t0, t1, spans)]
        if len(clean) < 6:
            continue
        for can in itertools.combinations(clean, 2):
            hs = {H.half_of(p) for p in can}
            key = ("both 3090" if hs == {"3090"} else
                   "both 5080" if hs == {"5080"} else "one of each")
            ctl = [p for p in clean if p not in can]
            v = did(agg, list(can), ctl, cut, W)
            if v is None:
                continue
            buckets[key].append(v)
            vi = did(agg, list(can), ctl, cut, W, inject=INJECT)
            if vi is not None:
                inj[key].append(vi - v)

    print("2-pool canary, 3h/3h, %.0f days of placebo windows" % days)
    print("true effect is ZERO in every row below\n")
    print("%-14s %6s %8s %11s %12s   %s" % ("canary halves", "n", "null sd", "null median", "MDE@80%", "planted +30% recovers as"))
    print("-" * 92)
    for k in ("both 5080", "one of each", "both 3090"):
        v = buckets[k]
        if len(v) < 20:
            print("%-14s %6d   too few fits" % (k, len(v)))
            continue
        sd = st.pstdev(v)
        rec = (math.exp(st.median(inj[k])) - 1) * 100 if inj[k] else float("nan")
        print("%-14s %6d %8.2f %10.1f%% %11.0f%%   %+.1f%% %s"
              % (k, len(v), sd, (math.exp(st.median(v)) - 1) * 100,
                 (math.exp(2.8 * sd) - 1) * 100, rec,
                 "ok" if abs(rec - 30.0) <= 1.0 else "<-- BROKEN"))


if __name__ == "__main__":
    main()
