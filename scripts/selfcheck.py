#!/usr/bin/env python3
"""
selfcheck.py -- close the loop that reflect.py leaves open.

reflect.py asks an LLM what it thinks and writes a report a human reads. That is
useful and it is not learning. Learning requires a claim that can be wrong and a
later check of whether it was.

    detect  ->  diagnose  ->  predict  ->  verify

  detect    Deterministic anomaly rules over telemetry. No LLM. Catches
            "this rate is pathological" and, critically, "this recovery has
            fired N times without the thing it fixes ever changing".
  diagnose  On anomaly only, assemble a fact pack and ask SEVERAL models
            independently. Agreement is signal; disagreement is a flag to a
            human, not something to average away.
  predict   Every proposal must carry a falsifiable prediction: a metric, a
            direction, a threshold, and a deadline.
  verify    Later, check the prediction against what actually happened, and
            record the verdict. A proposal whose prediction failed is evidence
            about the proposer, not just about the agent.

Why the detection layer is deterministic: the two worst bugs in this project so
far were a recovery that reported success while the bot stayed trapped, and a
recovery that fired 560 times in an hour without ever working. Both are trivially
visible as counting rules and neither needs a model. An LLM asked "is this
healthy?" will usually say something plausible; a counting rule will not.

Usage:
    ./selfcheck.py                       # detect only, exit 1 on anomaly
    ./selfcheck.py --diagnose            # on anomaly, ask the models
    ./selfcheck.py --diagnose --backends ollama,codex
    ./selfcheck.py --verify              # score past predictions
"""

import argparse, base64, json, os, subprocess, sys, urllib.request
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

ES_URL  = os.environ.get("MCAI_ES_URL",  "http://192.168.192.194:9200")
ES_USER = os.environ.get("MCAI_ES_USER", "mike")
ES_PASS = os.environ.get("MCAI_ES_PASS", "")
OLLAMA  = os.environ.get("OLLAMA_BASE_URL", "http://192.168.192.15:11434")
SIDE    = os.environ.get("MCAI_SIDE", "measure")   # which deployment this is

REPO = Path(__file__).resolve().parent.parent
LEDGER = REPO / "reports" / "predictions.jsonl"


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


# ─────────────────────────────────────────────────────────── detect ──
# Each rule returns (anomaly|None). Thresholds are deliberately blunt: they
# exist to catch pathology, not to tune behaviour.

def rule_recovery_ineffective(hours):
    """A recovery that fires and changes nothing is broken by definition.

    This is the rule that would have caught both of this project's worst bugs
    within minutes instead of an hour."""
    rng = {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}}
    RECOVERIES = ["_entombed", "_reflex_stuck", "_livelock_escape",
                  "_trapped_in_canopy", "_stagnation"]
    d = es("mcai-skill-agents/_search", {
        "size": 1000, "query": {"bool": {"filter": [rng]}},
        "_source": ["@timestamp", "skill.name", "bot.pos", "bot.name"],
        "sort": [{"@timestamp": "asc"}]})
    recs = [h["_source"] for h in d["hits"]["hits"]]
    out = []
    for kind in RECOVERIES:
        fired = [i for i, r in enumerate(recs) if r.get("skill", {}).get("name") == kind]
        if len(fired) < 5:
            continue
        moved = 0
        for i in fired:
            here = (recs[i].get("bot") or {}).get("pos") or {}
            nxt = next((r for r in recs[i + 1:] if (r.get("bot") or {}).get("pos")), None)
            if not (here and nxt):
                continue
            there = nxt["bot"]["pos"]
            dist = sum((there.get(k, 0) - here.get(k, 0)) ** 2 for k in "xyz") ** 0.5
            if dist >= 3:
                moved += 1
        rate = moved / len(fired)
        if rate < 0.25:
            out.append({
                "rule": "recovery_ineffective", "severity": "high",
                "what": f"{kind} fired {len(fired)}x and the bot moved afterwards only "
                        f"{moved}x ({rate*100:.0f}%)",
                "why": "A recovery that does not change the state it exists to fix is "
                       "worse than none: it burns cycles, floods telemetry, and hides "
                       "the real problem behind apparent activity.",
                "evidence": {"kind": kind, "fired": len(fired), "moved_after": moved},
            })
    return out


def rule_recovery_thrash(hours):
    """Generalises what we kept rediscovering one recovery at a time.

    Five separate reflexes have now shipped with the same defect: fire, fail to
    resolve, fire again on the next tick, forever. Entombment (565 in an hour),
    canopy (27, zero effect), stagnation, livelock, and suffocation. Each was
    found by hand, weeks apart in effort.

    ANY recovery firing faster than once a minute sustained is thrashing,
    regardless of which one it is or whether we have thought of it yet. This
    rule fires on recoveries that do not exist yet."""
    d = es("mcai-skill-agents/_search", {
        "size": 0, "query": {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}},
        "aggs": {"k": {"terms": {"field": "skill.name", "size": 40}}}})
    out = []
    for b in d["aggregations"]["k"]["buckets"]:
        name, n = b["key"], b["doc_count"]
        if not name.startswith("_") or name in ("_death",):
            continue
        per_min = n / (hours * 60)
        if per_min > 1.0 and n >= 20:
            out.append({
                "rule": "recovery_thrash", "severity": "high",
                "what": f"{name} fired {n}x in {hours}h ({per_min:.1f}/min)",
                "why": "A recovery firing more than once a minute sustained is not "
                       "recovering -- it is retrying. Five reflexes have now shipped "
                       "with this defect and each was found by hand. Any recovery "
                       "needs a rate limit, a give-up count, and a postcondition check.",
                "evidence": {"kind": name, "count": n, "per_min": round(per_min, 2)},
            })
    return out


def rule_event_storm(hours):
    """One event type dominating everything is pathology, not behaviour."""
    d = es("mcai-skill-agents/_search", {
        "size": 0, "query": {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}},
        "aggs": {"k": {"terms": {"field": "skill.name", "size": 30}}}})
    buckets = {b["key"]: b["doc_count"] for b in d["aggregations"]["k"]["buckets"]}
    total = sum(buckets.values()) or 1
    out = []
    for name, n in buckets.items():
        share = n / total
        per_hour = n / hours
        if name.startswith("_") and share > 0.5 and per_hour > 60:
            out.append({
                "rule": "event_storm", "severity": "high",
                "what": f"{name} is {share*100:.0f}% of all events ({per_hour:.0f}/hour)",
                "why": "A single hazard dominating the record means the agent is pinned "
                       "in one failure mode, and every rate computed from this window is "
                       "distorted by it.",
                "evidence": {"kind": name, "count": n, "share": round(share, 3),
                             "per_hour": round(per_hour)},
            })
    return out


def rule_success_collapse(hours):
    d = es("mcai-skill-agents/_search", {
        "size": 0, "query": {"bool": {"filter": [
            {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}}],
            "must_not": [{"prefix": {"skill.name": "_"}}]}},
        "aggs": {"st": {"terms": {"field": "skill.status"}}}})
    st = {b["key"]: b["doc_count"] for b in d["aggregations"]["st"]["buckets"]}
    total = sum(st.values())
    if total < 20:
        return []
    rate = st.get("success", 0) / total
    if rate < 0.25:
        return [{
            "rule": "success_collapse", "severity": "medium",
            "what": f"only {st.get('success',0)}/{total} skill attempts succeeded "
                    f"({rate*100:.0f}%)",
            "why": "Sustained low success means the agent is trying and failing rather "
                   "than idle -- usually the skill layer or the terrain, not the model.",
            "evidence": {"success": st.get("success", 0), "total": total,
                         "rate": round(rate, 3)},
        }]
    return []


def rule_agent_silent(minutes=20):
    d = es("mcai-skill-agents/_search", {
        "size": 1, "sort": [{"@timestamp": "desc"}], "_source": ["@timestamp"]})
    hits = d["hits"]["hits"]
    if not hits:
        return [{"rule": "no_telemetry", "severity": "high",
                 "what": "no telemetry at all", "why": "nothing is being recorded",
                 "evidence": {}}]
    last = datetime.fromisoformat(hits[0]["_source"]["@timestamp"].replace("Z", "+00:00"))
    gap = (datetime.now(timezone.utc) - last).total_seconds() / 60
    if gap > minutes:
        return [{
            "rule": "agent_silent", "severity": "high",
            "what": f"no telemetry for {gap:.0f} minutes",
            "why": "Services can report active while the agent's loop is dead. This has "
                   "happened here: a conditional re-schedule that skipped itself.",
            "evidence": {"minutes_silent": round(gap)},
        }]
    return []


def detect(hours):
    found = []
    for fn in (rule_agent_silent, ):
        found += fn()
    for fn in (rule_recovery_ineffective, rule_recovery_thrash,
               rule_event_storm, rule_success_collapse):
        try: found += fn(hours)
        except Exception as e: print(f"[selfcheck] rule {fn.__name__} failed: {e}", file=sys.stderr)
    return found


# ───────────────────────────────────────────────────────── diagnose ──

PROMPT = """You are reviewing an autonomous Minecraft agent that has tripped an
automated anomaly rule. The detection is already done and is not in question --
the numbers below are counted facts, not impressions.

## Architecture

Reflex layer (500ms, no LLM, may preempt) -> deterministic skills -> admission
gate (may veto the model's choice) -> milestone controller (owns the plan).
An LLM chooses ONE skill and its arguments per decision. Persistent lessons
(deterministic avoid-rules) carry across runs.

## Anomalies detected

{anomalies}

## Supporting telemetry

{facts}

## Known history of this codebase

Four bugs so far shared one shape: a capability added without its inverse (dig
down with no climb out; a veto with no fallback; a brake with no release; a
conditional re-schedule that could skip itself forever). Two recoveries were
worse than nothing: one reported success while the bot stayed trapped, one fired
560 times in an hour without ever working.

## What to produce

Be concrete and short. No preamble.

1. ROOT CAUSE — the single most likely cause, and the evidence for it. If the
   evidence does not distinguish between two causes, say so rather than picking.

2. FIX — what to change, where (file/function), and what the change is. If the
   fix belongs in the ANALYSIS TOOLING rather than the agent, say that: a rule
   that failed to catch this earlier is itself a defect.

3. PREDICTION — a falsifiable claim, in exactly this format, one per line:
       PREDICT: <metric> <direction> <threshold> within <hours>h
   where metric is one of:
       recovery_move_rate:<kind>   event_share:<kind>   events_per_hour:<kind>
       success_rate                silent_minutes
   direction is > or <. Example:
       PREDICT: events_per_hour:_entombed < 20 within 6h

   If you cannot state a falsifiable prediction, say why. A fix that cannot be
   measured is a guess.
"""


def gather_facts(hours):
    rng = {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}}
    out = {}
    d = es("mcai-skill-agents/_search", {
        "size": 0, "query": rng,
        "aggs": {"k": {"terms": {"field": "skill.name", "size": 20},
                       "aggs": {"st": {"terms": {"field": "skill.status"}},
                                "y": {"avg": {"field": "bot.pos.y"}}}},
                 "fail": {"terms": {"field": "skill.fail_class", "size": 10}},
                 "cfg": {"terms": {"field": "code.config_hash", "size": 3}},
                 "ver": {"terms": {"field": "code.version", "size": 3}}}})
    a = d["aggregations"]
    out["by_event"] = [{"name": b["key"], "n": b["doc_count"],
                        "avg_y": round(b["y"]["value"] or 0, 1),
                        "status": {x["key"]: x["doc_count"] for x in b["st"]["buckets"]}}
                       for b in a["k"]["buckets"]]
    out["fail_classes"] = {b["key"]: b["doc_count"] for b in a["fail"]["buckets"]}
    out["code_version"] = [b["key"] for b in a["ver"]["buckets"]]
    out["config_hash"] = [b["key"] for b in a["cfg"]["buckets"]]
    return out


def ask_ollama(prompt, model):
    body = {"model": model, "stream": False, "keep_alive": "30m",
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.2, "num_ctx": 16384}}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.load(r)["message"]["content"]


def ask_cli(prompt, cmd, timeout=1800):
    p = subprocess.run(cmd + [prompt], capture_output=True, text=True, timeout=timeout)
    return (p.stdout or "").strip() or f"(no output; stderr: {(p.stderr or '')[:300]})"


def parse_predictions(text):
    """PREDICT: <metric> <dir> <threshold> within <hours>h"""
    preds = []
    for line in text.splitlines():
        line = line.strip().lstrip("-*• ").strip()
        if not line.upper().startswith("PREDICT:"):
            continue
        body = line.split(":", 1)[1].strip()
        try:
            left, within = body.split("within")
            parts = left.split()
            metric, direction, threshold = parts[0], parts[1], float(parts[2])
            hours = float(within.strip().rstrip("h").strip())
            preds.append({"metric": metric, "direction": direction,
                          "threshold": threshold, "hours": hours, "raw": line})
        except Exception:
            continue
    return preds


# ─────────────────────────────────────────────────────────── verify ──

def measure(metric, hours):
    """Evaluate one prediction metric over the last `hours`."""
    try:
        if metric.startswith("events_per_hour:"):
            kind = metric.split(":", 1)[1]
            d = es("mcai-skill-agents/_count", {"query": {"bool": {"filter": [
                {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}},
                {"term": {"skill.name": kind}}]}}})
            return d["count"] / hours
        if metric.startswith("event_share:"):
            kind = metric.split(":", 1)[1]
            d = es("mcai-skill-agents/_search", {"size": 0,
                "query": {"range": {"@timestamp": {"gte": f"now-{int(round(hours*60))}m"}}},
                "aggs": {"k": {"terms": {"field": "skill.name", "size": 30}}}})
            b = {x["key"]: x["doc_count"] for x in d["aggregations"]["k"]["buckets"]}
            return b.get(kind, 0) / max(sum(b.values()), 1)
        if metric.startswith("recovery_move_rate:"):
            kind = metric.split(":", 1)[1]
            res = rule_recovery_ineffective(hours)
            hit = next((r for r in res if r["evidence"].get("kind") == kind), None)
            if not hit: return 1.0     # rule did not trip => effective enough
            e = hit["evidence"]
            return e["moved_after"] / max(e["fired"], 1)
        if metric == "success_rate":
            r = rule_success_collapse(hours)
            return r[0]["evidence"]["rate"] if r else 1.0
        if metric == "silent_minutes":
            r = rule_agent_silent(0)
            return r[0]["evidence"].get("minutes_silent", 0) if r else 0
    except Exception as e:
        print(f"[selfcheck] measure({metric}) failed: {e}", file=sys.stderr)
    return None


def verify():
    if not LEDGER.exists():
        print("no predictions recorded yet"); return 0
    rows = [json.loads(l) for l in LEDGER.read_text().splitlines() if l.strip()]
    now = datetime.now(timezone.utc)
    changed = False
    print(f"\n  {'made':<17}{'metric':<30}{'target':<14}{'actual':<10}verdict")
    print("  " + "-" * 82)
    for r in rows:
        if r.get("verdict"):
            print(f"  {r['made'][:16]:<17}{r['metric']:<30}"
                  f"{r['direction']}{r['threshold']:<13}{str(r.get('actual','-'))[:9]:<10}{r['verdict']}")
            continue
        due = datetime.fromisoformat(r["made"]) + timedelta(hours=r["hours"])
        if now < due:
            print(f"  {r['made'][:16]:<17}{r['metric']:<30}"
                  f"{r['direction']}{r['threshold']:<13}{'-':<10}pending ({(due-now).total_seconds()/3600:.1f}h)")
            continue
        actual = measure(r["metric"], r["hours"])
        if actual is None:
            r["verdict"] = "unmeasurable"
        else:
            ok = actual < r["threshold"] if r["direction"] == "<" else actual > r["threshold"]
            r["verdict"] = "HELD" if ok else "FAILED"
            r["actual"] = round(actual, 3)
        changed = True
        print(f"  {r['made'][:16]:<17}{r['metric']:<30}"
              f"{r['direction']}{r['threshold']:<13}{str(r.get('actual','-')):<10}{r['verdict']}")
    if changed:
        LEDGER.write_text("\n".join(json.dumps(x) for x in rows) + "\n")

    scored = [r for r in rows if r.get("verdict") in ("HELD", "FAILED")]
    if scored:
        held = sum(1 for r in scored if r["verdict"] == "HELD")
        print(f"\n  scored {len(scored)} prediction(s): {held} held, {len(scored)-held} failed")
        by = Counter(r.get("source", "?") for r in scored if r["verdict"] == "HELD")
        if by: print(f"  held by source: {dict(by)}")
        print("\n  A source whose predictions keep failing is telling you something about")
        print("  the source, not just about the agent.")
    return 0


# ───────────────────────────────────────────────────────────── main ──

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hours", type=float, default=2)
    ap.add_argument("--diagnose", action="store_true", help="on anomaly, ask the models")
    ap.add_argument("--backends", default="ollama", help="comma list: ollama,codex,claude")
    ap.add_argument("--model", default="qwen2.5:32b")
    ap.add_argument("--verify", action="store_true", help="score past predictions and exit")
    args = ap.parse_args()

    if not ES_PASS:
        sys.exit("set MCAI_ES_PASS")
    if args.verify:
        sys.exit(verify())

    anomalies = detect(args.hours)
    if not anomalies:
        print(f"[selfcheck] {args.hours}h window: no anomalies")
        return 0

    print(f"\n  ANOMALIES ({len(anomalies)}) over the last {args.hours}h\n" + "  " + "-" * 70)
    for a in anomalies:
        print(f"  [{a['severity']}] {a['rule']}: {a['what']}")
        print(f"      {a['why']}")
    print()

    if not args.diagnose:
        print("  run again with --diagnose to ask the models what to do")
        return 1

    facts = gather_facts(args.hours)
    prompt = PROMPT.format(
        anomalies=json.dumps(anomalies, indent=2)[:4000],
        facts=json.dumps(facts, indent=2)[:8000])

    results = {}
    for be in [b.strip() for b in args.backends.split(",") if b.strip()]:
        print(f"  asking {be} ...", file=sys.stderr)
        try:
            if be == "ollama":  results[f"ollama/{args.model}"] = ask_ollama(prompt, args.model)
            elif be == "codex": results["chatgpt"] = ask_cli(prompt, ["codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check"])
            elif be == "claude": results["claude"] = ask_cli(prompt, ["claude", "-p"])
        except Exception as e:
            results[be] = f"(backend failed: {e})"

    stamp = datetime.now(timezone.utc)
    outdir = REPO / "reports"; outdir.mkdir(exist_ok=True)
    path = outdir / f"selfcheck-{SIDE}-{stamp.strftime('%Y-%m-%d-%H%M')}.md"

    body = [f"# Self-check — {stamp:%Y-%m-%d %H:%M} UTC ({SIDE} side)\n",
            "> Anomalies were detected by counting rules, not by a model. The diagnoses",
            "> below are PROPOSALS. Each carries a falsifiable prediction, recorded in",
            "> `reports/predictions.jsonl` and scored later by `selfcheck.py --verify`.\n",
            "## Anomalies\n"]
    for a in anomalies:
        body.append(f"- **{a['rule']}** ({a['severity']}) — {a['what']}  \n  {a['why']}")
    body.append("\n## Diagnoses\n")

    LEDGER.parent.mkdir(exist_ok=True)
    with LEDGER.open("a") as led:
        for who, text in results.items():
            body.append(f"### {who}\n\n{text}\n")
            for p in parse_predictions(text):
                rec = {"made": stamp.isoformat(), "source": who, "side": SIDE,
                       "anomaly_rules": [a["rule"] for a in anomalies], **p, "verdict": None}
                led.write(json.dumps(rec) + "\n")
                print(f"  recorded prediction from {who}: {p['raw']}", file=sys.stderr)

    path.write_text("\n".join(body))
    print(f"\n  wrote {path.relative_to(REPO)}")
    print("  verify later with:  ./scripts/selfcheck.py --verify")
    return 1


if __name__ == "__main__":
    sys.exit(main())
