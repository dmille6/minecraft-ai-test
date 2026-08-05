#!/usr/bin/env python3
"""
reflect.py -- turn agent telemetry into concrete improvements.

Reads what Scout actually did from Elasticsearch, computes a failure taxonomy
DETERMINISTICALLY, and asks an LLM to interpret only that -- never the raw logs.

Two design rules, both load-bearing:

  1. Aggregation happens in code, interpretation happens in the model.
     Dumping thousands of raw log lines at an LLM produces confident,
     unfalsifiable narratives. Handing it exact counts and a handful of
     representative traces produces claims you can check.

  2. It PROPOSES; it does not APPLY. Auto-editing a running agent from model
     suggestions is precisely what the handoff doc S18 warns against. Output is
     a reviewable report, and changes stay a human decision.

Usage:
    ./reflect.py                        # local model on the Studio
    ./reflect.py --backend codex        # ChatGPT via codex CLI
    ./reflect.py --backend claude       # Claude Code CLI
    ./reflect.py --hours 24 --backend ollama --model qwen2.5:32b
"""

import argparse, base64, json, os, subprocess, sys, urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ES_URL  = os.environ.get("MCAI_ES_URL",  "http://mcelk.lan:9200")
ES_USER = os.environ.get("MCAI_ES_USER", "mike")
ES_PASS = os.environ.get("MCAI_ES_PASS", "")
OLLAMA  = os.environ.get("OLLAMA_BASE_URL", "http://studio.lan:11434")

REPO = Path(__file__).resolve().parent.parent


# ----------------------------------------------------------------- elastic --
def es(path, body=None):
    req = urllib.request.Request(
        f"{ES_URL}/{path}",
        data=json.dumps(body).encode() if body else None,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Basic " + base64.b64encode(f"{ES_USER}:{ES_PASS}".encode()).decode(),
        },
        method="POST" if body else "GET",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def gather_facts(hours):
    """Deterministic aggregation. Everything the model is allowed to reason about."""
    rng = {"range": {"@timestamp": {"gte": f"now-{hours}h"}}}
    facts = {"window_hours": hours}

    # --- skills: what was attempted and how it went ------------------------
    sk = es("mcai-skill-agents/_search", {
        "size": 0, "query": rng,
        "aggs": {
            "by_skill": {"terms": {"field": "skill.name", "size": 20},
                         "aggs": {"by_status": {"terms": {"field": "skill.status"}},
                                  "dur": {"avg": {"field": "skill.duration_ms"}}}},
            "by_trigger": {"terms": {"field": "trigger", "size": 20}},
        }})
    facts["skills"] = [{
        "skill": b["key"], "attempts": b["doc_count"],
        "avg_ms": round(b["dur"]["value"] or 0),
        "outcomes": {x["key"]: x["doc_count"] for x in b["by_status"]["buckets"]},
    } for b in sk["aggregations"]["by_skill"]["buckets"]]
    facts["triggers"] = {b["key"]: b["doc_count"] for b in sk["aggregations"]["by_trigger"]["buckets"]}

    # --- the actual failure reasons, counted -------------------------------
    fails = es("mcai-skill-agents/_search", {
        "size": 300, "query": {"bool": {"filter": [rng], "must_not": [
            {"term": {"skill.status": "success"}}]}},
        "_source": ["skill.name", "skill.status", "skill.detail", "bot.pos"],
        "sort": [{"@timestamp": "desc"}]})
    reasons = Counter()
    for h in fails["hits"]["hits"]:
        s = h["_source"].get("skill", {})
        d = (s.get("detail") or "unknown")[:60]
        reasons[f'{s.get("name")}: {d}'] += 1
    facts["failure_reasons"] = reasons.most_common(15)

    # --- llm decisions -----------------------------------------------------
    try:
        llm = es("mcai-llm-agents/_search", {
            "size": 0, "query": rng,
            "aggs": {
                "valid": {"terms": {"field": "llm.schema_valid"}},
                "errors": {"terms": {"field": "llm.error", "size": 15}},
                "by_model": {"terms": {"field": "llm.model", "size": 5},
                             "aggs": {"lat": {"percentiles": {"field": "llm.latency_ms",
                                                              "percents": [50, 95]}}}},
                "outcome": {"terms": {"field": "outcome.status", "size": 10}},
                "reloads": {"filter": {"range": {"llm.load_duration_ns": {"gt": 1_000_000_000}}}},
            }})
        a = llm["aggregations"]
        facts["llm"] = {
            "schema_valid": {b["key_as_string"]: b["doc_count"] for b in a["valid"]["buckets"]},
            "rejection_reasons": {b["key"]: b["doc_count"] for b in a["errors"]["buckets"]},
            "outcomes": {b["key"]: b["doc_count"] for b in a["outcome"]["buckets"]},
            "model_reloads": a["reloads"]["doc_count"],
            "models": [{"model": b["key"], "decisions": b["doc_count"],
                        "p50_ms": round(b["lat"]["values"]["50.0"] or 0),
                        "p95_ms": round(b["lat"]["values"]["95.0"] or 0)}
                       for b in a["by_model"]["buckets"]],
        }
        # A few full traces so the model can see WHAT was chosen and why.
        ex = es("mcai-llm-agents/_search", {
            "size": 8, "query": {"bool": {"filter": [rng], "must_not": [
                {"term": {"outcome.status": "success"}}]}},
            "_source": ["@timestamp", "trigger", "tool_calls", "outcome",
                        "llm.error", "bot.pos", "bot.health"],
            "sort": [{"@timestamp": "desc"}]})
        facts["failing_decisions"] = [h["_source"] for h in ex["hits"]["hits"]]
    except Exception as e:
        facts["llm"] = {"error": f"no llm data: {e}"}

    return facts


# ------------------------------------------------------------------ prompt --
BRIEF = """You are reviewing telemetry from an autonomous Minecraft agent to
make it measurably better. Everything below is aggregated fact, not raw logs.

## How the agent is built

Four layers. A reflex layer (no LLM) handles survival and can PREEMPT anything.
A deterministic skill layer does the work -- goto, gather, come, follow, home,
deposit, status -- each cancellable with a watchdog. A milestone controller in
plain code owns the plan and decides what "done" means. An LLM chooses ONE
skill and its arguments per decision; an admission layer may veto that before
it executes.

There is deliberately NO craft/place/eat/mine/sleep skill yet.

Timeouts nest and the ordering is load-bearing:
  pathfinding attempt (12s) < stuck reflex (20s) < skill watchdog (180s)

## Telemetry for the last {hours} hours

{facts}

## What I want from you

Diagnose what is actually limiting this agent, using the numbers. Then give me
CONCRETE changes, each one specific enough to implement without guessing:

1. The single biggest cause of wasted time or failure, with the evidence.
2. Up to five specific changes, each labelled SKILL / PROMPT / CONFIG / NEW-SKILL,
   with the exact behaviour you want and why the data supports it.
3. Anything the telemetry does NOT capture that you would need to go further.

Be concrete and short. No preamble, no restating the setup back to me. If the
data is too thin to support a conclusion, say so rather than inventing one.
"""


def build_prompt(facts, hours):
    return BRIEF.format(hours=hours, facts=json.dumps(facts, indent=2)[:14000])


# ---------------------------------------------------------------- backends --
def ask_ollama(prompt, model):
    body = {"model": model, "stream": False, "keep_alive": "30m",
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.2, "num_ctx": 16384}}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.load(r)["message"]["content"]


def ask_cli(prompt, cmd):
    """codex / claude CLIs, both read a prompt argument and print to stdout."""
    p = subprocess.run(cmd + [prompt], capture_output=True, text=True, timeout=1800)
    out = (p.stdout or "").strip()
    return out or f"(backend produced nothing; stderr: {(p.stderr or '')[:400]})"


# -------------------------------------------------------------------- main --
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hours", type=int, default=6)
    ap.add_argument("--backend", choices=["ollama", "codex", "claude"], default="ollama")
    ap.add_argument("--model", default="qwen2.5:32b", help="ollama backend only")
    ap.add_argument("--facts-only", action="store_true", help="print the aggregation and stop")
    args = ap.parse_args()

    if not ES_PASS:
        sys.exit("set MCAI_ES_PASS (and optionally MCAI_ES_USER) first")

    print(f"[reflect] pulling {args.hours}h of telemetry from {ES_URL} ...", file=sys.stderr)
    facts = gather_facts(args.hours)

    total = sum(s["attempts"] for s in facts.get("skills", []))
    print(f"[reflect] {total} skill attempts, "
          f"{sum(facts.get('llm', {}).get('schema_valid', {}).values() or [0])} decisions",
          file=sys.stderr)

    if args.facts_only:
        print(json.dumps(facts, indent=2)); return

    if total == 0:
        sys.exit("[reflect] no activity in this window -- widen --hours")

    prompt = build_prompt(facts, args.hours)
    print(f"[reflect] asking {args.backend} ({args.model if args.backend=='ollama' else ''}) ...",
          file=sys.stderr)

    if args.backend == "ollama":
        analysis = ask_ollama(prompt, args.model)
        who = f"ollama/{args.model}"
    elif args.backend == "codex":
        analysis = ask_cli(prompt, ["codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check"])
        who = "chatgpt/codex"
    else:
        analysis = ask_cli(prompt, ["claude", "-p"])
        who = "claude"

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    outdir = REPO / "reports"; outdir.mkdir(exist_ok=True)
    path = outdir / f"reflect-{stamp}.md"
    path.write_text(
        f"# Agent reflection — {stamp} UTC\n\n"
        f"Window: last {args.hours}h · Reviewer: {who} · {total} skill attempts\n\n"
        f"> Generated by `scripts/reflect.py`. These are PROPOSALS. Nothing is applied\n"
        f"> automatically — review before changing a running agent.\n\n"
        f"## Analysis\n\n{analysis}\n\n"
        f"## Facts it was given\n\n```json\n{json.dumps(facts, indent=2)}\n```\n")
    print(f"[reflect] wrote {path}", file=sys.stderr)
    print(analysis)


if __name__ == "__main__":
    main()
