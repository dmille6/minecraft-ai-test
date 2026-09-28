# The per-bot crafted-items + travel table, from measured inventory deltas on SUCCESSFUL
# craft/build events, plus summed skill.distance_moved and deaths. JSONL, not ES.
import sys, os, collections
sys.path.insert(0, "/srv/mcb-analysis-lib")
from lib.telemetry import Events
MINS = int(os.environ.get("MINS", "1440"))
ev = Events.load(since_minutes=MINS)
ITEMS = ("stick", "crafting_table", "wooden_pickaxe", "stone_pickaxe", "furnace",
         "torch", "oak_planks", "stone_axe", "wooden_axe", "iron_pickaxe")
made = collections.defaultdict(collections.Counter)
dist = collections.Counter(); deaths = collections.Counter(); spans = {}
gath = collections.Counter(); gitems = collections.Counter()
for r in ev.rows:
    raw = r.get("raw") or {}; sk = raw.get("skill") or {}
    b = (raw.get("bot") or {}).get("name"); t = r.get("t")
    if not b: continue
    if t:
        lo, hi = spans.get(b, (t, t)); spans[b] = (min(lo, t), max(hi, t))
    if r.get("name") == "_death": deaths[b] += 1
    n = sk.get("name")
    if not n or n.startswith("_"): continue
    d = sk.get("distance_moved")
    if isinstance(d, (int, float)): dist[b] += d
    if sk.get("status") != "success": continue
    inv = sk.get("inventory_delta") or {}
    if n in ("craft", "build", "smelt"):
        for k, v in inv.items():
            if isinstance(v, (int, float)) and v > 0: made[b][k] += v
    if n == "gather":
        gath[b] += 1
        gitems[b] += sum(v for v in inv.values() if isinstance(v, (int, float)) and v > 0)
bh = {b: (hi - lo).total_seconds() / 3600 for b, (lo, hi) in spans.items()}
tot = collections.Counter()
for b in made:
    for k, v in made[b].items(): tot[k] += v
print("FLEET CRAFT TABLE, last %d min | %d bots | %.0f bot-h" % (MINS, len(spans), sum(bh.values())))
print()
hdr = "  bot                 " + "".join("%8s" % i[:7] for i in ITEMS) + "   travel  gath_items  deaths"
print(hdr)
# bots with any crafted output first, then the rest summarised
withmake = sorted([b for b in bh if sum(made[b].values()) > 0], key=lambda b: -sum(made[b].values()))
for b in withmake[:20]:
    print("  %-18s" % b[:18] + "".join("%8d" % made[b].get(i, 0) for i in ITEMS)
          + "%9d %11d %7d" % (dist[b], gitems[b], deaths[b]))
print()
print("  bots with ANY crafted/smelted output: %d of %d" % (len(withmake), len(bh)))
print("  FLEET TOTALS       " + "".join("%8d" % tot.get(i, 0) for i in ITEMS)
      + "%9d %11d %7d" % (sum(dist.values()), sum(gitems.values()), sum(deaths.values())))
print()
print("  other items made (not in the columns above):")
for k, v in sorted(tot.items(), key=lambda kv: -kv[1]):
    if k not in ITEMS: print("    %-22s %6d" % (k, v))
print()
print("  per bot-hour: travel %.0f blocks | gathered items %.2f | deaths %.3f | craft-outputs %.2f"
      % (sum(dist.values())/sum(bh.values()), sum(gitems.values())/sum(bh.values()),
         sum(deaths.values())/sum(bh.values()), sum(tot.values())/sum(bh.values())))
