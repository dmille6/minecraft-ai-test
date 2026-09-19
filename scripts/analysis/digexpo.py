#!/usr/bin/env python3
"""Exposure interlock for digwatch-02: do the DRAWN pools actually abort digs?

digwatch-02 records who cancels an in-flight dig. If board-d and placebo-d are
not aborting digs, the canary is unmeasurable by construction -- which is exactly
how the 17 Sep bundle was drawn onto two pools with zero exposure and reached
+360 minutes saying nothing.

Positive control: the same query is run across ALL pools. If it finds aborts
elsewhere and not here, that is exposure information. If it finds none anywhere,
the query is broken and no pool should be drawn.
"""
import sys, datetime as dt
sys.path.insert(0, "/opt/minecraft-ai/scripts")
from lib.telemetry import Events
from collections import defaultdict

DRAWN = {"board-d", "placebo-d"}
ev = Events.load(paths="/var/log/mcai/*/skill-*.jsonl", since_minutes=180)
aborts = defaultdict(int)
digs = defaultdict(int)
bots = defaultdict(set)
for r in ev.rows:
    b = r["bot"].get("name", "")
    if not b or b.startswith("isolated"):
        continue
    p = b.rsplit("-", 1)[0]
    bots[p].add(b)
    det = str((r["raw"].get("skill") or {}).get("detail") or "")
    if "Digging aborted" in det:
        aborts[p] += 1
    if "dig" in r["name"] or "dig" in det.lower():
        digs[p] += 1

print("last 180 min, %d rows, %d bots" % (len(ev.rows), sum(len(v) for v in bots.values())))
print()
print("%-12s %6s %14s %12s   %s" % ("pool", "bots", "dig-ish rows", "aborts", ""))
print("-" * 62)
tot_a = 0
for p in sorted(bots):
    tot_a += aborts[p]
    print("%-12s %6d %14d %12d   %s"
          % (p, len(bots[p]), digs[p], aborts[p], "<== DRAWN" if p in DRAWN else ""))
print()
print("POSITIVE CONTROL: 'Digging aborted' found %d times fleet-wide across %d pools"
      % (tot_a, sum(1 for p in aborts if aborts[p])))
if tot_a == 0:
    print("  -> the query finds NOTHING anywhere. It is broken, or aborts stopped. Do not draw on this.")
    raise SystemExit(2)
drawn_a = sum(aborts[p] for p in DRAWN)
drawn_b = sum(len(bots[p]) for p in DRAWN)
print("DRAWN POOLS: %d aborts over %d bots in 3 h = %.2f per bot-hour"
      % (drawn_a, drawn_b, drawn_a / (drawn_b * 3) if drawn_b else 0))
if drawn_a == 0:
    print("  -> ZERO exposure on the drawn pools while the fleet has some. DO NOT DEPLOY HERE.")
    raise SystemExit(3)
print("  -> exposure present; the canary can see its own payload.")
