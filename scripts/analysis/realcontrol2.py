#!/usr/bin/env python3
"""Denominator control, second attempt. The first one was the SAME TAUTOLOGY in a
new place.

v1 dropped a bot by scaling the pool's items by the surviving fraction:
    items += pool_items * (len(keep) / len(present))
so items and bot-hours both fell by 4/5 and the rate could not move. It printed
"honest denominator centred on zero: PASS" with sd exactly 0.0000 -- the same
shape of mistake as the multiplicative injection it was written to replace, made
twice in one session, both times by constructing the comparison out of the
quantity being tested instead of measuring it.

v2 aggregates items PER BOT PER HOUR, so dropping a bot removes the items that
bot actually gathered. The honest arm must now SCATTER (a dropped bot's rate
differs from its poolmates) while staying centred near zero; a result of exactly
zero would mean the tautology is still there.

Mutant unchanged: assume a fixed pool size of 5 and it must be caught at
log(4/5) = -0.2231.
"""
import sys, math, datetime as dt, statistics as st
sys.path.insert(0, "/home/mike/mcai-analysis")
sys.path.insert(0, "/opt/minecraft-ai/scripts")
from collections import defaultdict
from lib.telemetry import Events
import halfdid as H

HOUR = dt.timedelta(hours=1)


def aggregate_per_bot(since, until, chunk_hours=6):
    items = defaultdict(int)          # (bot, hour) -> items
    present = defaultdict(set)        # (pool, hour) -> bots
    t = since
    while t < until:
        t2 = min(t + dt.timedelta(hours=chunk_hours), until)
        ev = Events.load(paths="/var/log/mcai/*/skill-*.jsonl*", since=t, until=t2)
        for r in ev.rows:
            b = r["bot"].get("name", "")
            if not b or b.startswith("isolated") or b.startswith("self-"):
                continue
            h = r["t"].replace(minute=0, second=0, microsecond=0)
            present[(b.rsplit("-", 1)[0], h)].add(b)
            for _i, v in ((r["raw"].get("skill") or {}).get("inventory_delta") or {}).items():
                if v > 0:
                    items[(b, h)] += v
        del ev
        t = t2
    return items, present


def rate(items, present, pool, t0, t1, drop=frozenset(), fixed=None):
    num = bh = 0.0
    h = t0
    while h < t1:
        keep = [b for b in present.get((pool, h), ()) if b not in drop]
        if keep:
            bh += fixed if fixed else len(keep)
            num += sum(items.get((b, h), 0) for b in keep)   # REAL per-bot items
        h += HOUR
    return (num / bh if bh else None), bh


def did(items, present, can, ctl, cut, W, drop=frozenset(), fixed=None):
    pre0, post1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
    a, abh = rate(items, present, can, pre0, cut)
    b, bbh = rate(items, present, can, cut, post1, drop=drop, fixed=fixed)
    def pool_ctl(t0, t1):
        n = d = 0.0
        for p in ctl:
            r, h1 = rate(items, present, p, t0, t1)
            if r:
                n += r * h1
                d += h1
        return n / d if d else None
    kpre, kpost = pool_ctl(pre0, cut), pool_ctl(cut, post1)
    if not all(x for x in (a, b, kpre, kpost)) or min(abh, bbh) < W * 2:
        return None
    return math.log((b / a) / (kpost / kpre))


def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    W = 3
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    since = now - dt.timedelta(days=days)
    items, present = aggregate_per_bot(since, now)
    pools = sorted({p for (p, _h) in present})
    pools = [p for p in pools if not p.startswith("isolated") and len(p.split("-")) == 2]
    spans = H.canary_intervals()
    cuts = []
    t = since + dt.timedelta(hours=W)
    while t <= now - dt.timedelta(hours=W):
        cuts.append(t)
        t += HOUR

    honest, mutant = [], []
    for cut in cuts:
        t0, t1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
        clean = [p for p in pools if not H.contaminated(p, t0, t1, spans)]
        if len(clean) < 6:
            continue
        for can in clean:
            ctl = [p for p in clean if p != can]
            members = sorted({b for (p, h), bs in present.items() if p == can for b in bs})
            if len(members) < 5:
                continue
            base = did(items, present, can, ctl, cut, W)
            if base is None:
                continue
            for m in members:                     # every bot, not just the first
                d = frozenset([m])
                h_ = did(items, present, can, ctl, cut, W, drop=d)
                m_ = did(items, present, can, ctl, cut, W, drop=d, fixed=5)
                if h_ is not None:
                    honest.append(h_ - base)
                if m_ is not None:
                    mutant.append(m_ - h_ if h_ is not None else None)
    mutant = [x for x in mutant if x is not None]

    pct = lambda v: (math.exp(v) - 1) * 100
    print("CONTROL v2: drop one canary bot (its REAL items and its bot-hours).")
    print("%d honest fits, %d mutant fits\n" % (len(honest), len(mutant)))
    print("  %-40s %9s %9s %9s" % ("", "median", "sd", "as %"))
    print("  %-40s %9.4f %9.4f %+8.1f%%"
          % ("presence-counted bot-hours", st.median(honest), st.pstdev(honest), pct(st.median(honest))))
    print("  %-40s %9.4f %9.4f %+8.1f%%"
          % ("MUTANT: assumed pool size 5", st.median(mutant), st.pstdev(mutant), pct(st.median(mutant))))
    print("\n  mutant must be caught at log(4/5) = %.4f" % math.log(0.8))
    centred = abs(st.median(honest)) < 0.05
    scatters = st.pstdev(honest) > 1e-6
    caught = abs(st.median(mutant) - math.log(0.8)) < 0.05
    print("\n  honest arm centred near zero : %s (median %+.4f)" % ("PASS" if centred else "FAIL", st.median(honest)))
    print("  honest arm actually SCATTERS : %s (sd %.4f)%s"
          % ("PASS" if scatters else "FAIL", st.pstdev(honest),
             "" if scatters else "   <-- STILL A TAUTOLOGY"))
    print("  mutant detected              : %s" % ("PASS" if caught else "FAIL"))
    ok = centred and scatters and caught
    print("\n  -> %s" % ("control is real: it can fail, and it passes"
                         if ok else "NOT TRUSTWORTHY"))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
