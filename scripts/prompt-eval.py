#!/usr/bin/env python3
"""Score prompt variants against REAL logged decisions, without touching Minecraft.

    python3 prompt-eval.py --variant current --n 60
    python3 prompt-eval.py --variant enumerated --n 60 --compare current

WHY THIS EXISTS

Testing a prompt by deploying it costs an hour of fleet time and confounds the
trial. But every decision the fleet has ever made is in Elasticsearch WITH the
bot state that produced it -- inventory, position, what was nearby, the
reachable y range. That is enough to replay a decision offline and ask a
question that needs no simulator:

    given the state this bot was actually in, was the action it proposed
    POSSIBLE?

34 times the model proposed y=-176 while the prompt said "REACHABLE Y RANGE:
42 to 102". 36 times it proposed descending with no pickaxe. 9 times it invented
an argument (`player=default`) that no skill accepts. None of that needs a world
to detect -- it is a function of the proposed action and the logged state.

WHAT THIS CANNOT DO, AND WHY THE A/B STILL MATTERS

It measures LEGALITY and COST, not quality. "Would this action have worked
better than the one the fleet actually took" is a counterfactual, and no replay
answers it -- the world moved on. So this is a cheap filter that kills obviously
broken variants before they cost fleet time. A variant that wins here has earned
an in-world A/B, not a deployment.
"""
import argparse, json, os, re, subprocess, sys, time
from collections import Counter

ES    = os.environ.get("ES_URL", "http://localhost:9200")
ES_USER = os.environ.get("ES_USER", "mcai_ro")
OLLAMA  = os.environ.get("OLLAMA_URL", "http://192.168.192.15:11434")
MODEL   = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b-instruct")
WORLD_MIN_Y, WORLD_MAX_Y = -64, 320

SKILL_ARGS = {                    # the real contracts; anything else is invented
    "gather":  {"block", "count"},
    "craft":   {"item"},
    "goto":    {"x", "y", "z"},
    "mine":    {"y"},
    "explore": set(),
    "home":    set(),
    "eat":     set(),
}
PICKAXES = ("wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe")
# home() succeeded 0/55 times in the corpus; median distance when proposed was
# 184 blocks. The pathfinder cannot plan that far within its budget, so beyond
# this radius `home` is not a legal choice -- it is a guaranteed failure.
HOME_MAX_BLOCKS = 150


def es(path, body=None, password=""):
    cmd = ["curl", "-s", "-u", f"{ES_USER}:{password}", f"{ES}{path}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout)


def fetch(n, password):
    r = es("/mcai-llm-agents/_search", {
        "size": n,
        "_source": ["prompt.text", "response.text", "outcome.status", "outcome.detail",
                    "bot.name", "bot.pos", "bot.inventory", "perception.blocks",
                    "llm.prompt_tokens", "llm.completion_tokens"],
        "sort": [{"@timestamp": "desc"}],
    }, password)
    return [h["_source"] for h in r.get("hits", {}).get("hits", [])]


# --------------------------------------------------------------- the validator

def legality(action, state):
    """Why this action was impossible in that state, or None if it was fine.

    Every rule here is checkable from the logged document alone. No simulator,
    no world, no guessing -- which is exactly why the result is trustworthy even
    though it is cheap.
    """
    if not isinstance(action, dict):
        return "unparseable"
    skill = action.get("skill")
    if skill not in SKILL_ARGS:
        return f"unknown skill {skill!r}"
    args = action.get("args") or {}
    if not isinstance(args, dict):
        return "args not an object"

    extra = set(args) - SKILL_ARGS[skill]
    if extra:
        return f"invented arg(s) {sorted(extra)}"

    inv = state.get("inventory") or {}
    pos = state.get("pos") or {}

    if skill == "goto":
        for k in ("x", "y", "z"):
            if k not in args:
                return f"goto missing {k}"
            if not isinstance(args[k], (int, float)):
                return f"goto {k} not numeric"
        if not (WORLD_MIN_Y <= args["y"] <= WORLD_MAX_Y):
            return f"goto y={args['y']} outside the world ({WORLD_MIN_Y}..{WORLD_MAX_Y})"
        if pos.get("y") is not None and abs(args["y"] - pos["y"]) > 120:
            return f"goto y={args['y']} is {abs(args['y']-pos['y']):.0f} blocks from y={pos['y']}"

    if skill == "mine":
        if "y" not in args:
            return "mine missing y"
        if not any(inv.get(p) for p in PICKAXES):
            return "mine without a pickaxe"
        if not (WORLD_MIN_Y <= args["y"] <= WORLD_MAX_Y):
            return f"mine y={args['y']} outside the world"

    if skill == "gather":
        if "block" not in args:
            return "gather missing block"
        if "count" in args and (not isinstance(args["count"], int) or args["count"] <= 0):
            return f"gather count={args['count']!r} not a positive integer"

    if skill == "home":
        d = (pos.get("x", 0) ** 2 + pos.get("z", 0) ** 2) ** 0.5
        if d > HOME_MAX_BLOCKS:
            return f"home from {d:.0f} blocks out (never succeeds beyond ~{HOME_MAX_BLOCKS})"

    return None


def parse(text):
    try:
        return json.loads(text[text.index("{"):text.rindex("}") + 1])
    except Exception:
        return None


# ------------------------------------------------------------------- variants

def candidates(state):
    """The enumerated ALLOWED_ACTIONS list, derived from state.

    Deliberately built by the same legality rules used to score, so the list can
    never contain an action the validator would reject. That is the whole point
    of the enumerated approach: illegal actions are absent, not forbidden.
    """
    inv = state.get("inventory") or {}
    near = state.get("blocks") or {}
    out = []
    for blk in sorted(near, key=lambda b: -near[b])[:4]:
        out.append({"skill": "gather", "args": {"block": blk, "count": 1}})
    for item in ("oak_planks", "stick", "crafting_table", "wooden_pickaxe", "stone_pickaxe"):
        out.append({"skill": "craft", "args": {"item": item}})
    if any(inv.get(p) for p in PICKAXES):
        y = int((state.get("pos") or {}).get("y", 64))
        out.append({"skill": "mine", "args": {"y": max(WORLD_MIN_Y + 8, y - 12)}})
    out.append({"skill": "explore", "args": {}})
    pos = state.get("pos") or {}
    if (pos.get("x", 0) ** 2 + pos.get("z", 0) ** 2) ** 0.5 <= HOME_MAX_BLOCKS:
        out.append({"skill": "home", "args": {}})
    return [a for a in out if legality(a, state) is None][:12]


def build_prompt(variant, rec, state):
    original = (rec.get("prompt") or {}).get("text") or ""
    if variant == "current":
        return original, None
    if variant == "enumerated":
        cands = candidates(state)
        listing = "\n".join(f"{chr(65+i)} {json.dumps(a)}" for i, a in enumerate(cands))
        # Keep the ORIGINAL situational text so the only variable is how the
        # action is chosen. Changing two things at once measures nothing.
        head = original.split("LESSONS FROM PAST RUNS")[0].rstrip()
        return (f"{head}\n\nChoose exactly one action from ALLOWED_ACTIONS.\n"
                f"Reply with only: {{\"action_id\":\"<letter>\"}}\n"
                f"Do not invent skills, arguments or coordinates.\n\n"
                f"ALLOWED_ACTIONS\n{listing}\n"), cands
    raise SystemExit(f"unknown variant {variant}")


def ask(prompt, schema=None):
    body = {"model": MODEL, "prompt": prompt, "stream": False,
            "options": {"num_ctx": 8192, "num_predict": 120}}
    if schema:
        body["format"] = schema          # Ollama constrained decoding
    r = subprocess.run(["curl", "-s", "--max-time", "180", f"{OLLAMA}/api/generate",
                        "-H", "Content-Type: application/json", "-d", json.dumps(body)],
                       capture_output=True, text=True, timeout=200)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {}


ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "skill": {"type": "string", "enum": sorted(SKILL_ARGS)},
        "args":  {"type": "object"},
    },
    "required": ["skill", "args"],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="current",
                    choices=["current", "enumerated", "current+schema"])
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--password", default=os.environ.get("ES_PASSWORD", ""))
    a = ap.parse_args()

    recs = fetch(a.n, a.password)
    if not recs:
        print("no records from Elasticsearch"); return 1
    print(f"replaying {len(recs)} real decisions | variant={a.variant} | model={MODEL}\n")

    bad, ptok, ctok, lat, ok = Counter(), [], [], [], 0
    for i, rec in enumerate(recs, 1):
        state = {"inventory": (rec.get("bot") or {}).get("inventory") or {},
                 "pos": (rec.get("bot") or {}).get("pos") or {},
                 "blocks": (rec.get("perception") or {}).get("blocks") or {}}
        prompt, cands = build_prompt(a.variant, rec, state)
        if not prompt.strip():
            continue
        t0 = time.time()
        resp = ask(prompt, ACTION_SCHEMA if a.variant == "current+schema" else None)
        lat.append(time.time() - t0)
        text = resp.get("response", "")
        ptok.append(resp.get("prompt_eval_count") or 0)
        ctok.append(resp.get("eval_count") or 0)

        d = parse(text)
        if a.variant == "enumerated" and d and "action_id" in d:
            idx = str(d["action_id"]).strip().upper()[:1]
            d = cands[ord(idx) - 65] if cands and "A" <= idx < chr(65 + len(cands)) else None
            if d is None:
                bad["action_id not in list"] += 1
                print(f"  {i:>3} INVALID  action_id out of range: {text[:60]!r}"); continue
        why = legality(d, state) if d else "unparseable"
        if why:
            bad[re.sub(r"-?\d+(\.\d+)?", "N", why)] += 1
            print(f"  {i:>3} ILLEGAL  {why}")
        else:
            ok += 1

    n = len(lat) or 1
    print(f"\n  ---- variant={a.variant} ----")
    print(f"  legal actions      {ok}/{n}  ({100*ok/n:.0f}%)")
    print(f"  prompt tokens avg  {sum(ptok)/n:.0f}")
    print(f"  output tokens avg  {sum(ctok)/n:.0f}")
    print(f"  latency avg        {sum(lat)/n:.2f}s")
    if bad:
        print("  illegal breakdown:")
        for k, v in bad.most_common(10):
            print(f"    {v:>4}  {k}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
