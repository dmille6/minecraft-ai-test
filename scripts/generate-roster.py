#!/usr/bin/env python3
"""generate-roster.py -- write the 20 bot env files for Block 2.

    ./generate-roster.py --town town-*.json --out ./env [--endpoints a,b,c]

Twenty bots: four arms of five. What varies between arms is MEMORY_SCOPE and
the world port. EVERYTHING ELSE IS HELD IDENTICAL BY CONSTRUCTION -- same model,
same cadence, same role, same timeouts, same endpoint pool -- because every
field that differs between arms is a rival explanation for the result, and the
only one this block is entitled to draw is about memory.

Two rules are enforced here rather than trusted to a human editing files:

  1. NO ARM IS PINNED TO A GPU. Every bot gets the WHOLE endpoint pool via
     OLLAMA_BASE_URLS, rotated by its index within the arm. Rotation, not
     random assignment: with five bots and a shuffle, one arm drew 4-1 while
     the others drew 3-2, which is an arm-to-hardware correlation arriving by
     luck. Rotating gives every arm the identical multiset of orderings, so the
     balance is a property of the construction rather than of the seed. Each
     bot also keeps the pool's health-tracked failover for free.
  2. THE POOL IS THE EXPERIMENTAL UNIT. Under `shared` and `board`, the five
     bots of an arm form one pool -- so that arm has n=1, not n=5, and the
     analysis must not pretend otherwise. Under `isolated` each bot is its own
     pool. The generator prints the true n per arm for the manifest.
"""
import argparse, glob, json, hashlib
from pathlib import Path

# arm -> MEMORY_SCOPE. `checkpoint` is the placebo: it makes the same walk to
# the same lectern on the same schedule and stores nothing, which is what
# separates "sharing beliefs helped" from "walking to town helped".
SCOPES = {"hive": "shared", "board": "board",
          "isolated": "isolated", "placebo": "checkpoint"}

NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]

# Held identical across all twenty bots. Anything added here lands on every arm
# or on none.
COMMON = {
    "BOT_ROLE": "gatherer",
    "EXP_INSTANCE": "instance-1",
    "EXP_BLOCK": "block2",
    "MINECRAFT_HOST": "127.0.0.1",
    "MINECRAFT_VERSION": "1.21.11",
    "MINECRAFT_AUTH": "offline",
    "WORLD_BORDER_RADIUS": "1950",
    "BOARD_RADIUS": "8",
    "REFLEX_TICK_MS": "500",
    "SKILL_TIMEOUT_MS": "180000",
    "MAX_CONSECUTIVE_FAILURES": "3",
    "EAT_BELOW_FOOD": "16",
    "FLEE_BELOW_HEALTH": "8",
    "STUCK_SECONDS": "35",
    # Defaults to FALSE. Omitting it would deploy twenty bots that never make
    # an LLM decision -- a fleet that runs, logs, and measures nothing.
    "LLM_ENABLED": "true",
    "OLLAMA_MODEL": "qwen2.5:7b-instruct",
    # Must equal what EVERY other client of these endpoints requests. Ollama
    # keys its loaded model on num_ctx, so one mismatched client silently loads
    # a second copy of the model and the whole fleet queues behind it.
    "OLLAMA_NUM_CTX": "4096",
    "LLM_MAX_TOKENS": "512",
    "LLM_TEMPERATURE": "0.7",
    "LLM_TIMEOUT_MS": "90000",
    "LLM_PROMPT_TOKEN_BUDGET": "3000",
    "LLM_DECISION_COOLDOWN_MS": "25000",
    "LOG_LEVEL": "info",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--town", nargs="+", required=True,
                    help="place-town.py JSON outputs, one per arm")
    ap.add_argument("--out", default="./env")
    ap.add_argument("--endpoints", default="http://10.0.0.190:11434",
                    help="comma-separated Ollama endpoints; shared by ALL arms")
    a = ap.parse_args()

    towns = {}
    for pattern in a.town:
        for f in glob.glob(pattern):
            d = json.loads(Path(f).read_text())
            towns[d["arm"]] = d
    missing = set(SCOPES) - set(towns)
    if missing:
        raise SystemExit(f"no town data for: {', '.join(sorted(missing))} -- "
                         f"run place-town.py for every arm first")

    endpoints = [e.strip() for e in a.endpoints.split(",") if e.strip()]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    units, pools = [], {}
    for arm in sorted(SCOPES):
        t = towns[arm]
        hx, hy, hz = t["home"]
        bx, by, bz = t["board"]
        port = t.get("port") or t.get("mc_port") or (25570 + sorted(SCOPES).index(arm))
        for i, nm in enumerate(NAMES):
            bot = f"{arm}-{nm}"
            scope = SCOPES[arm]
            # Under isolated, sharing has no boundary to draw, so each bot is
            # its own pool. Under the others the arm is the pool -- and that is
            # the unit the statistics get, however many bots are in it.
            pool = bot if scope == "isolated" else arm
            pools.setdefault(arm, set()).add(pool)
            env = {
                **COMMON,
                "BOT_NAME": bot,
                "MEMORY_SCOPE": scope,
                "MEMORY_POOL": pool,
                "EXP_ARM": arm,
                "MINECRAFT_PORT": str(port),
                "HOME_X": str(hx), "HOME_Y": str(hy), "HOME_Z": str(hz),
                "BOARD_X": str(bx), "BOARD_Y": str(by), "BOARD_Z": str(bz),
                # The whole pool, rotated by index -- identical orderings in
                # every arm, so no arm is correlated with any host.
                "OLLAMA_BASE_URLS": ",".join(endpoints[i % len(endpoints):] +
                                             endpoints[:i % len(endpoints)]),
                "RUN_ID": f"block2-{arm}-{nm.lower()}",
                "LOG_DIR": f"/var/log/mcai/{bot}",
                "STATE_DIR": f"/var/lib/mcai/{bot}",
            }
            body = "\n".join(f"{k}={v}" for k, v in env.items()) + "\n"
            (out / f"{bot}.env").write_text(body)
            units.append(bot)

    # The manifest is what makes the block auditable after the fact: it records
    # what was actually deployed, not what was intended.
    digest = hashlib.sha256(
        "".join(sorted((out / f"{b}.env").read_text() for b in units)).encode()
    ).hexdigest()[:16]
    manifest = {
        "block": "block2", "roster_sha": digest, "bots": len(units),
        "arms": {arm: {"bots": 5, "scope": SCOPES[arm],
                       "independent_units_n": len(pools[arm])}
                 for arm in sorted(SCOPES)},
        "endpoints": endpoints,
        "town": {arm: towns[arm] for arm in sorted(SCOPES)},
    }
    (out / "block2-manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"wrote {len(units)} env files to {out}/  (roster_sha {digest})")
    for arm in sorted(SCOPES):
        n = len(pools[arm])
        print(f"  {arm:9s} scope={SCOPES[arm]:10s} 5 bots, n={n} independent unit(s)")
    if any(len(p) == 1 for p in pools.values()):
        print("\n  NOTE FOR THE ANALYSIS: the arms with n=1 give one independent\n"
              "  observation each, not five. Five bots sharing one memory are five\n"
              "  correlated samples of a single pool; treating them as five\n"
              "  independent ones is how a null result acquires a p-value.")


if __name__ == "__main__":
    main()
