#!/usr/bin/env python3
"""Fleet health with the per-bot craft + travel table, not just health metrics.

Travel is computed from bot.pos across consecutive rows per bot, ignoring jumps
over 64 blocks (a respawn or a dimension change is not travel). Immobile is the
longest stretch with no position change.
"""
import sys, math, datetime as dt
sys.path.insert(0, "/opt/minecraft-ai/scripts")
from lib.telemetry import Events
from collections import defaultdict, Counter

MIN = int(sys.argv[1]) if len(sys.argv) > 1 else 180
ev = Events.load(paths="/var/log/mcai/*/skill-*.jsonl", since_minutes=MIN)
print("window %d min | %d rows | %d kinds" % (MIN, len(ev.rows), len(ev.names())))

vers = Counter()
items = Counter(); crafts = Counter(); deaths = Counter()
dist = Counter(); lastpos = {}; still = defaultdict(float); laststill = {}
seen = defaultdict(lambda: [None, None])
for r in sorted(ev.rows, key=lambda r: r["t"]):
    b = r["bot"].get("name", "")
    if not b:
        continue
    vers[(r["raw"].get("code") or {}).get("version", "?")] += 1
    s = seen[b]
    s[0] = r["t"] if s[0] is None else s[0]
    s[1] = r["t"]
    sk = r["raw"].get("skill") or {}
    for _i, v in (sk.get("inventory_delta") or {}).items():
        if v > 0:
            items[b] += v
    nm = r["name"].lstrip("_")
    if nm == "craft":
        crafts[b] += 1
    if r["name"] == "_death":
        deaths[b] += 1
    p = r["bot"].get("pos") or {}
    if p.get("x") is not None:
        cur = (p["x"], p.get("y", 0), p["z"])
        if b in lastpos:
            pv, pt = lastpos[b]
            d = math.dist((pv[0], pv[2]), (cur[0], cur[2]))
            if d < 64:
                dist[b] += d
            if d < 1.0:
                still[b] = max(still[b], (r["t"] - laststill.get(b, pt)).total_seconds() / 60)
            else:
                laststill[b] = r["t"]
        else:
            laststill[b] = r["t"]
        lastpos[b] = (cur, r["t"])

print("versions live:", dict(vers.most_common(4)))
bots = sorted(seen)
print("bots reporting: %d" % len(bots))
print()
pools = defaultdict(list)
for b in bots:
    pools[b.rsplit("-", 1)[0]].append(b)

print("%-12s %5s %9s %8s %8s %7s %8s" % ("pool", "bots", "items/bh", "crafts", "travel", "deaths", "max idle"))
print("-" * 68)
tot = [0, 0.0, 0, 0, 0.0]
for p in sorted(pools):
    bs = pools[p]
    bh = sum((seen[b][1] - seen[b][0]).total_seconds() / 3600 for b in bs)
    it = sum(items[b] for b in bs); cr = sum(crafts[b] for b in bs)
    dd = sum(deaths[b] for b in bs); tv = sum(dist[b] for b in bs)
    mi = max((still[b] for b in bs), default=0)
    print("%-12s %5d %9.1f %8d %8.0f %7d %7.0fm"
          % (p, len(bs), it / bh if bh else 0, cr, tv, dd, mi))
    tot[0] += len(bs); tot[1] += bh; tot[2] += it; tot[3] += cr; tot[4] += tv
print("-" * 68)
print("%-12s %5d %9.1f %8d %8.0f %7d" % ("FLEET", tot[0], tot[2] / tot[1] if tot[1] else 0,
                                          tot[3], tot[4], sum(deaths.values())))
print()
idle = [(still[b], b) for b in bots if still[b] >= 30]
print("bots idle >=30 min: %d %s" % (len(idle), sorted([b for _s, b in idle])[:12]))
zero = [b for b in bots if items[b] == 0]
print("bots with ZERO items in the window: %d %s" % (len(zero), sorted(zero)[:12]))
print()
print("POSITIVE CONTROL for the zero/idle counts above: the same walk found")
print("  %d rows, %d bots, %d kinds, %d total items, %d crafts, %d deaths"
      % (len(ev.rows), len(bots), len(ev.names()), sum(items.values()),
         sum(crafts.values()), sum(deaths.values())))
