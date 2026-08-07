#!/usr/bin/env python3
"""Render the per-bot crafted-items and travel table.

One column per item type actually produced, ordered by fleet total, so the table
shows its own story: the long stick column is the reward-shape artefact, and the
one bot with entries in the tool columns is the only one that crossed the tool
chain. Neither is visible in an aggregate success rate.
"""
import collections
import json
import os
import sys

raw = sys.stdin.read()
_, _, rest = raw.partition("===TRAVEL===")
trav_raw, _, craft_raw = rest.partition("===CRAFTS===")


def first_json(text):
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except Exception:
                continue
    return None


t = first_json(trav_raw)
c = first_json(craft_raw)
if not t or not c:
    print("  could not read telemetry from Elasticsearch")
    sys.exit(1)

travel, deaths = {}, {}
for b in t["aggregations"]["b"]["buckets"]:
    travel[b["key"]] = b["dist"]["value"] or 0
    deaths[b["key"]] = b.get("deaths", {}).get("doc_count", 0)

made = collections.defaultdict(collections.Counter)
events = skipped = 0
for h in c["hits"]["hits"]:
    s = h.get("_source") or {}
    bot = (s.get("bot") or {}).get("name")
    inv = (s.get("skill") or {}).get("inventory_delta") or {}
    if not bot or not inv:
        skipped += 1
        continue
    events += 1
    for k, v in inv.items():
        if isinstance(v, (int, float)) and v > 0:
            made[bot][k] += int(v)

items = sorted({i for cnt in made.values() for i in cnt},
               key=lambda i: -sum(cnt[i] for cnt in made.values()))
bots = sorted(travel, key=lambda b: -travel[b])
if not bots:
    print("  no bots in this window")
    sys.exit(0)


def w(i):
    return max(len(i), 5)


print("\n  window: " + os.environ.get("SINCE", "all time"))
hdr = f"  {'bot':10} " + " ".join(f"{i:>{w(i)}}" for i in items) + \
      f" {'travelled':>10} {'deaths':>7}"
print(hdr)
print("  " + "-" * (len(hdr) - 2))
for b in bots:
    cells = " ".join(f"{(made[b][i] or '-'):>{w(i)}}" for i in items)
    print(f"  {b:10} {cells} {round(travel[b]):>9}m {deaths.get(b, 0):>7}")
print("  " + "-" * (len(hdr) - 2))
tot = " ".join(f"{sum(made[x][i] for x in made):>{w(i)}}" for i in items)
print(f"  {'TOTAL':10} {tot} {round(sum(travel.values())):>9}m "
      f"{sum(deaths.values()):>7}")
print(f"\n  {events} successful craft/build events"
      + (f"; {skipped} carried no inventory delta" if skipped else ""))
print("  Counts come from measured inventory deltas and are comparable across")
print("  the whole period. Success RATES from the same period are not — they")
print("  span the pre- and post-ADR-0003 definitions of success.")
