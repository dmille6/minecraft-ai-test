"""Do townmates compete for the same targets? gather rows carry no competitor field (0 of 15,791 failures name one,
so that instrument is blind), so test it spatially: a gather START is 'contested' when a townmate (same shared pool)
had a gather of the SAME block type end within R blocks in the previous W seconds. Compare outcomes of contested vs
uncontested gathers. Positive control: the same machinery must find co-location at all (count printed)."""
import sys, re, math, bisect, collections, datetime as dt
sys.path.insert(0, "/home/mike/estel/scripts")
from lib.estelemetry import EsEvents
ev = EsEvents.load("skill", since_minutes=24 * 60)
rows = list(ev.rows("gather", fields=["@timestamp", "skill.status", "skill.args", "skill.duration_ms", "skill.fail_class",
                                      "exp.pool", "bot.name", "bot.pos"], max_rows=100000))


def ts(r):
    return dt.datetime.fromisoformat(r["@timestamp"].replace("Z", "+00:00")).timestamp()


by = collections.defaultdict(list)
n_shared = 0
for r in rows:
    p = r["exp"]["pool"]
    if p.startswith("self-"):
        continue
    pos = (r.get("bot") or {}).get("pos") or {}
    if "x" not in pos:
        continue
    blk = ((r.get("skill") or {}).get("args") or {}).get("block")
    end = ts(r)
    start = end - (((r.get("skill") or {}).get("duration_ms") or 0) / 1000.0)
    by[(p, blk)].append((end, start, r["bot"]["name"], pos["x"], pos["z"], r["skill"].get("status")))
    n_shared += 1
print(f"gather rows {len(rows)}; shared-town rows with a position {n_shared}")
for R, W in ((8, 60), (16, 120), (32, 300)):
    tab = collections.Counter()
    for k, lst in by.items():
        lst.sort()
        ends = [e for e, *_ in lst]
        for (end, start, b, x, z, st) in lst:
            i = bisect.bisect_left(ends, start - W)
            hit = False
            for (e2, s2, b2, x2, z2, st2) in lst[i:]:
                if e2 >= start:
                    break
                if b2 != b and math.hypot(x - x2, z - z2) <= R:
                    hit = True
                    break
            tab[(hit, st == "success")] += 1
    c, cs = tab[(True, True)] + tab[(True, False)], tab[(True, True)]
    u, us = tab[(False, True)] + tab[(False, False)], tab[(False, True)]
    print(f"R={R:2d} W={W:3d}s: contested {c} ({100*c/max(1,c+u):.1f}%), success {100*cs/max(1,c):.1f}%; "
          f"uncontested {u}, success {100*us/max(1,u):.1f}%")
blk = collections.Counter(((r.get("skill") or {}).get("args") or {}).get("block") for r in rows)
print("gather by block:", blk.most_common(12))
