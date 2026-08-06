#!/usr/bin/env python3
"""Render the model A/B read-out from two Elasticsearch aggregation responses."""
import json, os, sys

ARM = {
    "Gather01": "A 7b", "Scout01": "A 7b",
    "Gather02": "B 14b", "Scout02": "B 14b",
    "Miner01": "B 14b*",
}

raw = sys.stdin.read()
head, _, tail = raw.partition("---LLM---")
skills = json.loads(head.replace("---SKILLS---", "").strip())
llm = json.loads(tail.strip())

sb = {b["key"]: b for b in skills["aggregations"]["b"]["buckets"]}
lb = {b["key"]: b for b in llm["aggregations"]["b"]["buckets"]}
since = os.environ.get("SINCE", "?")

print()
print("window since " + since)
hdr = "{:10} {:7} {:22} {:>6} {:>6} {:>7} {:>6} {:>7}".format(
    "bot", "arm", "model", "decis", "veto%", "p50ms", "miles", "deaths")
print(hdr)
print("-" * len(hdr))

rows = []
for bot in sorted(set(sb) | set(lb)):
    s, l = sb.get(bot, {}), lb.get(bot, {})
    n = int((l.get("n") or {}).get("value") or 0)
    veto = (l.get("veto") or {}).get("doc_count", 0)
    p50 = ((l.get("lat") or {}).get("values") or {}).get("50.0") or 0
    models = ",".join(x["key"] for x in ((l.get("model") or {}).get("buckets") or []))
    miles = (s.get("ms") or {}).get("doc_count", 0)
    deaths = (s.get("deaths") or {}).get("doc_count", 0)
    pct = (100.0 * veto / n) if n else 0.0
    rows.append((bot, ARM.get(bot, "?"), models, n, pct, p50, miles, deaths))
    print("{:10} {:7} {:22} {:6d} {:5.0f}% {:7.0f} {:6d} {:7d}".format(
        bot, ARM.get(bot, "?"), models[:22], n, pct, p50, miles, deaths))

# Paired arms only. Miner01 has no counterpart and must not be averaged in.
for arm, label in (("A 7b", "A (7b)"), ("B 14b", "B (14b)")):
    rs = [r for r in rows if r[1] == arm]
    if not rs:
        continue
    n = sum(r[3] for r in rs)
    print("\n{}: {} decisions, {} milestones, {} deaths, mean veto {:.0f}%".format(
        label, n, sum(r[6] for r in rs), sum(r[7] for r in rs),
        sum(r[4] for r in rs) / len(rs)))

print("\n* Miner01 is the only miner, so it has no paired counterpart and is")
print("  excluded from the arm totals above.")
print("  Milestone counts require the _milestone_complete event, which only")
print("  exists from the start of this experiment onward.")
