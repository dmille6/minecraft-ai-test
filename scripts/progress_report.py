#!/usr/bin/env python3
"""
progress_report.py -- did the agent actually get better?

Compares hazard and success rates across runs, normalised per hour so runs of
different lengths are comparable.

READ THIS BEFORE BELIEVING THE OUTPUT:

The agent does not currently learn. Nothing converts experience into changed
behaviour -- the LLM's memory is a rolling window that dies at restart, weights
never change, and no lesson persists across runs. So when a hazard rate drops,
that is the SYSTEM improving because a human changed code, not the agent
learning.

This script deliberately says "stopped happening" rather than "learned to
avoid", because the second claim is one the data cannot support. When genuine
learning exists -- persistent memory, or reflect.py output fed back into the
prompt -- that wording can change, and the distinction will matter a great deal
at that point.

Usage:
    ./progress_report.py                  # compare all runs
    ./progress_report.py --runs soak-001 soak-002
"""

import argparse, base64, json, os, sys, urllib.request
from datetime import datetime, timezone

ES_URL  = os.environ.get("MCAI_ES_URL",  "http://mcelk.lan:9200")
ES_USER = os.environ.get("MCAI_ES_USER", "mike")
ES_PASS = os.environ.get("MCAI_ES_PASS", "")

# Hazards worth tracking. The label is what actually happened; no claim about
# why it stopped.
HAZARDS = {
    "_reflex_drowning":     "Drowning (reflex had to surface it)",
    "_reflex_danger_block": "Standing in lava/fire",
    "_reflex_low_health":   "Health critical",
    "_reflex_stuck":        "Stuck — no movement during a task",
    "_trapped_in_canopy":   "Trapped in tree canopy",
    "_livelock_escape":     "Fixated — chose the same action repeatedly",
    "_death":               "Died",
}


def es(path, body=None):
    req = urllib.request.Request(
        f"{ES_URL}/{path}",
        data=json.dumps(body).encode() if body else None,
        headers={"Content-Type": "application/json",
                 "Authorization": "Basic " + base64.b64encode(
                     f"{ES_USER}:{ES_PASS}".encode()).decode()},
        method="POST" if body else "GET")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def run_stats(run_id):
    q = {"term": {"run_id": run_id}}
    d = es("mcai-skill-agents/_search", {
        "size": 0, "query": q,
        "aggs": {
            "span": {"stats": {"field": "@timestamp"}},
            "by_skill": {"terms": {"field": "skill.name", "size": 40},
                         "aggs": {"st": {"terms": {"field": "skill.status"}}}},
        }})
    a = d["aggregations"]
    if not a["span"]["count"]:
        return None
    hours = max((a["span"]["max"] - a["span"]["min"]) / 3_600_000.0, 0.02)

    hazards, skills = {}, {}
    for b in a["by_skill"]["buckets"]:
        name = b["key"]
        if name.startswith("_"):
            hazards[name] = b["doc_count"]
        else:
            st = {x["key"]: x["doc_count"] for x in b["st"]["buckets"]}
            skills[name] = {"attempts": b["doc_count"],
                            "success": st.get("success", 0),
                            "rate": st.get("success", 0) / b["doc_count"]}
    return {"run_id": run_id, "hours": hours, "hazards": hazards, "skills": skills,
            "start": datetime.fromtimestamp(a["span"]["min"] / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="*", help="run_ids, oldest first; default = auto")
    ap.add_argument("--min-events", type=int, default=15,
                    help="ignore runs smaller than this (debug restarts)")
    ap.add_argument("--last", type=int, default=5, help="how many runs to compare")
    args = ap.parse_args()
    if not ES_PASS:
        sys.exit("set MCAI_ES_PASS first")

    runs = args.runs
    if not runs:
        d = es("mcai-skill-agents/_search",
               {"size": 0, "aggs": {"r": {"terms": {"field": "run_id", "size": 50,
                                                    "order": {"first": "asc"}},
                                          "aggs": {"first": {"min": {"field": "@timestamp"}}}}}})
        runs = [b["key"] for b in d["aggregations"]["r"]["buckets"]]

    stats = [s for s in (run_stats(r) for r in runs) if s]
    if not args.runs:
        # Development restarts produce dozens of two-event runs that are pure
        # noise in a trend comparison. Keep substantive runs and named ones.
        stats = [s for s in stats
                 if sum(s["hazards"].values()) + sum(v["attempts"] for v in s["skills"].values())
                    >= args.min_events
                 or not s["run_id"].startswith("run-")]
        stats = stats[-args.last:]
    if not stats:
        sys.exit(f"no runs with >= {args.min_events} events -- lower --min-events")

    print("\n" + "=" * 74)
    print("  AGENT PROGRESS REPORT")
    print("=" * 74)
    print("\n  NOTE: the agent does not learn between runs. Changes below reflect")
    print("  code and configuration changes made by a human, not self-improvement.\n")

    def short(r):
        return r if not r.startswith("run-") else "dev-" + r[-6:]
    print(f"  {'run':<16}{'started':<18}{'hours':>7}{'events':>9}")
    print("  " + "-" * 62)
    for s in stats:
        tot = sum(s['hazards'].values()) + sum(v['attempts'] for v in s['skills'].values())
        print(f"  {short(s['run_id']):<16}{s['start']:<18}{s['hours']:>7.1f}{tot:>9}")

    print("\n\n  HAZARDS  (per hour — lower is better)")
    print("  " + "-" * 62)
    hdr = "  " + f"{'':<38}" + "".join(f"{short(s['run_id']):>13}" for s in stats)
    print(hdr)
    for key, label in HAZARDS.items():
        rates = [s["hazards"].get(key, 0) / s["hours"] for s in stats]
        if not any(rates):
            continue
        row = "  " + f"{label:<38}" + "".join(f"{r:>13.1f}" for r in rates)
        if len(rates) > 1:
            first, last = rates[0], rates[-1]
            if first > 0 and last < first * 0.5:  row += "   ↓ stopped happening"
            elif first > 0 and last > first * 1.5: row += "   ↑ worse"
        print(row)

    print("\n\n  SKILL SUCCESS RATE")
    print("  " + "-" * 62)
    print(hdr)
    names = sorted({n for s in stats for n in s["skills"]})
    for n in names:
        cells = []
        for s in stats:
            v = s["skills"].get(n)
            cells.append(f"{v['rate']*100:>12.0f}%" if v else f"{'-':>13}")
        row = "  " + f"{n:<38}" + "".join(cells)
        a, b = stats[0]["skills"].get(n), stats[-1]["skills"].get(n)
        if len(stats) > 1 and a and b:
            if b["rate"] > a["rate"] + 0.15: row += "   ↑ improved"
            elif b["rate"] < a["rate"] - 0.15: row += "   ↓ regressed"
        print(row)

    print("\n" + "=" * 74)
    print("  To make these numbers reflect the AGENT improving rather than the")
    print("  system, it needs persistent memory across runs and a path from")
    print("  reflect.py's findings back into its prompt. Neither exists yet.")
    print("=" * 74 + "\n")


if __name__ == "__main__":
    main()
