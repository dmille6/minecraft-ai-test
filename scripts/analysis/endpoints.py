#!/usr/bin/env python3
"""Is the noise floor a property of the DESIGN, or of the ENDPOINT?

The sweep says a 4-pool 3h read of items/bot-hour has a null sd of 0.42 -- an MDE
of ~225%. No canary this season could have detected the +30% its KEEP gate asks
for. Two readings of that are possible and they lead opposite ways:

  (a) canary reads are hopeless at this fleet size, or
  (b) items/bot-hour is a terrible endpoint and the mechanism endpoints the
      successful reads actually used are far quieter.

(b) is testable with the harness already built: run the same placebo DiD on
DECISIONS per bot-hour, which is a high-count, low-dispersion endpoint, and
compare its null against items. Same windows, same cuts, same estimator, so the
only thing that changes is what is being counted.

Positive control: the planted-effect recovery is re-run per endpoint. An endpoint
whose estimator cannot recover +30% is not being compared, it is being broken.
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
import sys, math, itertools, random, datetime as dt, statistics as st
sys.path.insert(0, "/home/mike/mcai-analysis")
sys.path.insert(0, "/opt/minecraft-ai/scripts")
import halfdid as H

HOUR = dt.timedelta(hours=1)


def pooled(agg, field, pools, t0, t1, inject=1.0):
    """count/bot-hour over [t0,t1) for `field`, one of items|dec|deaths."""
    num = bh = 0.0
    h = t0
    while h < t1:
        for p in pools:
            n = len(agg["bots"].get((p, h), ()))
            if n:
                bh += n
                num += agg[field].get((p, h), 0) * inject
        h += HOUR
    return (num / bh if bh else None), bh, num


def did(agg, field, can, ctl, cut, W, inject=1.0):
    pre0, post1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
    a, abh, _ = pooled(agg, field, can, pre0, cut)
    b, bbh, _ = pooled(agg, field, can, cut, post1, inject=inject)
    c, _, _ = pooled(agg, field, ctl, pre0, cut)
    d, _, _ = pooled(agg, field, ctl, cut, post1)
    if not all(x for x in (a, b, c, d)):
        return None
    if min(abh, bbh) < W * 3 * len(can):
        return None
    return math.log((b / a) / (d / c))


def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    since = now - dt.timedelta(days=days)
    agg = H.aggregate(since, now, version=None, chunk_hours=6)
    pools = sorted({p for (p, _h) in agg["bots"]})
    pools = [p for p in pools if not p.startswith("isolated") and len(p.split("-")) == 2]
    spans = H.canary_intervals()

    print("%-22s %-8s %6s %7s %10s  %s"
          % ("endpoint", "canary", "n", "null sd", "MDE@80%", "recovery of a planted +30%"))
    print("-" * 100)
    INJECT = 1.30
    for field, label in (("items", "items / bot-hour"), ("dec", "decisions / bot-hour")):
        for W in (3, 6):
            for ncan in (1, 2, 4):
                vals, inj = [], []
                t = since + dt.timedelta(hours=W)
                cuts = []
                while t <= now - dt.timedelta(hours=W):
                    cuts.append(t)
                    t += HOUR
                for cut in cuts:
                    t0, t1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
                    clean = [p for p in pools if not H.contaminated(p, t0, t1, spans)]
                    if len(clean) < ncan + 4:
                        continue
                    combos = list(itertools.combinations(clean, ncan))
                    if len(combos) > 30:
                        combos = random.Random(hash((cut, W, ncan)) & 0xffff).sample(combos, 30)
                    for can in combos:
                        ctl = [p for p in clean if p not in can]
                        v = did(agg, field, list(can), ctl, cut, W)
                        if v is None:
                            continue
                        vals.append(v)
                        vi = did(agg, field, list(can), ctl, cut, W, inject=INJECT)
                        if vi is not None:
                            inj.append(vi - v)
                if len(vals) < 20:
                    continue
                sd = st.pstdev(vals)
                rec = (math.exp(st.median(inj)) - 1) * 100 if inj else float("nan")
                flag = "ok (%+.1f%%)" % rec if abs(rec - 30.0) <= 1.0 else "BROKEN (%+.1f%%)" % rec
                print("%-22s %-8s %6d %7.2f %9.0f%%  %s"
                      % (label if (W == 3 and ncan == 1) else "", "%dh x %d" % (W, ncan),
                         len(vals), sd, (math.exp(2.8 * sd) - 1) * 100, flag))
        print()


if __name__ == "__main__":
    main()
