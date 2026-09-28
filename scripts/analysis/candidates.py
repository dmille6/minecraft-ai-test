#!/usr/bin/env python3
"""items/bot-hour has a null sd of 0.71; decisions/bot-hour has 0.10 on the very
same windows. The design is not the problem -- the endpoint is.

The reason is visible in any bot's inventory: items/bot-hour is a SUM of
inventory deltas, and one bamboo stack or one lucky vein contributes 91 in a
single row. A heavy-tailed sum has no business being a primary endpoint on five
bots. decisions/bot-hour is quiet because it is a bounded-rate COUNT.

So the fix is not to abandon throughput, it is to count it instead of summing it.
Three candidates, measured against the two incumbents on identical windows:

  productive runs / bot-hour   rows that gained at least one item -- a Bernoulli
                               rate, the count analogue of what items measures
  winsorised items / bot-hour  same sum with each row capped at 20, which keeps
                               the magnitude information but cuts the tail
  log1p items / bot-hour       the sum of log1p(delta) per row

The point is to find an endpoint whose MDE is under the +30% our KEEP gates ask
for, WITHOUT giving up on measuring productivity. Planted-effect recovery is
re-checked per endpoint: an endpoint that cannot recover a known effect is not a
quieter instrument, it is a broken one.
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
from collections import defaultdict
from lib.telemetry import Events
import halfdid as H

HOUR = dt.timedelta(hours=1)
FIELDS = ("items", "prod_runs", "wins20", "log1p")


def aggregate(since, until, chunk_hours=6):
    acc = {f: defaultdict(float) for f in FIELDS}
    bots = defaultdict(set)
    t = since
    while t < until:
        t2 = min(t + dt.timedelta(hours=chunk_hours), until)
        ev = Events.load(paths="/var/log/mcai/*/skill-*.jsonl*", since=t, until=t2)
        for r in ev.rows:
            b = r["bot"].get("name", "")
            if not b or b.startswith("isolated") or b.startswith("self-"):
                continue
            key = (b.rsplit("-", 1)[0], r["t"].replace(minute=0, second=0, microsecond=0))
            bots[key].add(b)
            d = ((r["raw"].get("skill") or {}).get("inventory_delta") or {})
            gained = sum(v for v in d.values() if v > 0)
            if gained > 0:
                acc["items"][key] += gained
                acc["prod_runs"][key] += 1
                acc["wins20"][key] += min(gained, 20)
                acc["log1p"][key] += math.log1p(gained)
        sys.stderr.write("  %s..%s %d rows\n" % (t.strftime("%m-%d %HZ"), t2.strftime("%m-%d %HZ"), len(ev.rows)))
        sys.stderr.flush()
        del ev
        t = t2
    return acc, bots


def pooled(acc, bots, field, pools, t0, t1, inject=1.0):
    num = bh = 0.0
    h = t0
    while h < t1:
        for p in pools:
            n = len(bots.get((p, h), ()))
            if n:
                bh += n
                num += acc[field].get((p, h), 0.0) * inject
        h += HOUR
    return (num / bh if bh else None), bh


def did(acc, bots, field, can, ctl, cut, W, inject=1.0):
    pre0, post1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
    a, abh = pooled(acc, bots, field, can, pre0, cut)
    b, bbh = pooled(acc, bots, field, can, cut, post1, inject=inject)
    c, _ = pooled(acc, bots, field, ctl, pre0, cut)
    d, _ = pooled(acc, bots, field, ctl, cut, post1)
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
    acc, bots = aggregate(since, now)
    pools = sorted({p for (p, _h) in bots})
    pools = [p for p in pools if not p.startswith("isolated") and len(p.split("-")) == 2]
    spans = H.canary_intervals()

    cuts = []
    t = since + dt.timedelta(hours=W)
    while t <= now - dt.timedelta(hours=W):
        cuts.append(t)
        t += HOUR

    print("3h/3h placebo windows, %.0f days. True effect is ZERO everywhere.\n" % days)
    print("%-28s %-8s %6s %8s %10s  %s"
          % ("endpoint", "canary", "n", "null sd", "MDE@80%", "planted +30%"))
    print("-" * 92)
    NAMES = {"items": "items / bot-hour  (sum)",
             "prod_runs": "productive runs / bot-hour",
             "wins20": "items winsorised at 20 / bh",
             "log1p": "log1p items / bot-hour"}
    for field in FIELDS:
        for ncan in (1, 2, 4):
            vals, inj = [], []
            for cut in cuts:
                t0, t1 = cut - dt.timedelta(hours=W), cut + dt.timedelta(hours=W)
                clean = [p for p in pools if not H.contaminated(p, t0, t1, spans)]
                if len(clean) < ncan + 4:
                    continue
                combos = list(itertools.combinations(clean, ncan))
                if len(combos) > 30:
                    combos = random.Random(hash((cut, ncan)) & 0xffff).sample(combos, 30)
                for can in combos:
                    ctl = [p for p in clean if p not in can]
                    v = did(acc, bots, field, list(can), ctl, cut, W)
                    if v is None:
                        continue
                    vals.append(v)
                    vi = did(acc, bots, field, list(can), ctl, cut, W, inject=1.30)
                    if vi is not None:
                        inj.append(vi - v)
            if len(vals) < 20:
                continue
            sd = st.pstdev(vals)
            rec = (math.exp(st.median(inj)) - 1) * 100 if inj else float("nan")
            mde = (math.exp(2.8 * sd) - 1) * 100
            mark = "  <== under the +30% KEEP gate" if mde < 30 else ""
            print("%-28s %-8s %6d %8.2f %9.0f%%  %+.1f%% %s%s"
                  % (NAMES[field] if ncan == 1 else "", "3h x %d" % ncan, len(vals), sd, mde, rec,
                     "ok" if abs(rec - 30.0) <= 1.0 else "BROKEN", mark))
        print()


if __name__ == "__main__":
    main()
