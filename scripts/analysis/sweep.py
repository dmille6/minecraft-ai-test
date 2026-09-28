#!/usr/bin/env python3
"""How much does the READ's noise floor move with window length and pool count?

The placebo study found the null sd of a 3h/3h single-pool ratio-DiD is ~0.83 in
logs -- exp(0.83) = 2.3x, which independently reproduces the 2.36x between-pool
noise band this project already knew about. A canary whose KEEP threshold is +30%
is being read inside a +-130% noise band.

If that is the binding constraint, then draw THROUGHPUT is the wrong lever
entirely: more canaries per day at this noise level produce more INCONCLUSIVEs,
not more knowledge. So measure what actually buys power -- window length, and how
many pools the canary gets -- on the same placebo windows, with the same
estimator, and the same two positive controls.
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
from collections import defaultdict
import halfdid as H

HOUR = dt.timedelta(hours=1)


def pooled_rate(agg, pools, t0, t1, inject=1.0):
    it = bh = 0.0
    for p in pools:
        _r, b, i = H.rate(agg, p, t0, t1, inject=inject)
        it += i
        bh += b
    return (it / bh if bh else None), bh


def did_multi(agg, canaries, controls, cut, W, inject=1.0):
    pre0, post1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
    cpre, cpre_bh = pooled_rate(agg, canaries, pre0, cut)
    cpost, cpost_bh = pooled_rate(agg, canaries, cut, post1, inject=inject)
    kpre, _ = pooled_rate(agg, controls, pre0, cut)
    kpost, _ = pooled_rate(agg, controls, cut, post1)
    if not all(x for x in (cpre, cpost, kpre, kpost)):
        return None
    if min(cpre_bh, cpost_bh) < W * 3 * len(canaries):
        return None
    return math.log((cpost / cpre) / (kpost / kpre))


def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 7.0
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    since = now - dt.timedelta(days=days)
    sys.stderr.write("walking %.1f days\n" % days)
    agg = H.aggregate(since, now, version=None, chunk_hours=6)
    pools = sorted({p for (p, _h) in agg["bots"]})
    pools = [p for p in pools if not p.startswith("isolated") and len(p.split("-")) == 2]
    spans = H.canary_intervals()

    print("pools: %d (%d on 3090)" % (len(pools), sum(1 for p in pools if H.half_of(p) == "3090")))
    print()
    print("%-5s %-8s %6s %7s %9s   %s" % ("win", "canary", "n", "sd", "MDE@80%", "what a read could actually detect"))
    print("-" * 96)

    INJECT = 1.30
    for W in (3, 6, 12, 24):
        for ncan in (1, 2, 4):
            vals = []
            inj = []
            cuts = []
            t = since + dt.timedelta(hours=W)
            while t <= now - dt.timedelta(hours=W):
                cuts.append(t)
                t += HOUR
            for cut in cuts:
                t0, t1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
                clean = [p for p in pools if not H.contaminated(p, t0, t1, spans)]
                if len(clean) < ncan + 4:
                    continue
                combos = list(itertools.combinations(clean, ncan))
                if len(combos) > 40:
                    import random
                    combos = random.Random(hash((cut, W, ncan)) & 0xffff).sample(combos, 40)
                for can in combos:
                    ctl = [p for p in clean if p not in can]
                    d = did_multi(agg, list(can), ctl, cut, W)
                    if d is None:
                        continue
                    vals.append(d)
                    di = did_multi(agg, list(can), ctl, cut, W, inject=INJECT)
                    if di is not None:
                        inj.append(di - d)
            if len(vals) < 20:
                print("%-5s %-8s %6d %7s %9s   too few placebo fits" % ("%dh" % W, "%d pool" % ncan, len(vals), "-", "-"))
                continue
            sd = st.pstdev(vals)
            rec = (math.exp(st.median(inj)) - 1) * 100 if inj else float("nan")
            ok = "ok" if abs(rec - 30.0) <= 1.0 else "RECOVERY %+.1f%%" % rec
            # two-sided 5%, 80% power on a single DiD estimate
            mde = (math.exp(2.8 * sd) - 1) * 100
            print("%-5s %-8s %6d %7.2f %8.0f%%   %s"
                  % ("%dh" % W, "%d pool" % ncan, len(vals), sd, mde, ok))


if __name__ == "__main__":
    main()
