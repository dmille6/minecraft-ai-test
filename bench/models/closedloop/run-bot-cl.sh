#!/bin/bash
# Stage C bot runner, ON THE BOTS HOST (10.0.0.31), from the bench tree ~/mbench-cl/tree (branch bench-closedloop).
# Keeps every guard of sandbox/run-bot.sh except "loopback model only", which becomes "the Studio endpoint only"
# (the owner dedicated the Studio to this experiment, 2026-10-05). Never the fleet's units, logs or state.
set -euo pipefail
ENVF="${1:?env file}"
set -a; source "$ENVF"; set +a
[[ "${MINECRAFT_HOST:-}" == "10.0.0.30" && "${MINECRAFT_PORT:-}" =~ ^(25599|25600|25601|25602|25603|25604|25605|25606)$ ]] || { echo "refusing: not a sandbox server"; exit 3; }
# The Studio's Ollama, or the Studio's LM Studio through the bench translating proxy (ollama2openai.py on the
# Studio, forwarded by an ssh tunnel on the Mac mini at 10.0.0.70:11501), or the Studio's Ollama through the same
# kind of tunnel at 10.0.0.70:11502 (the WAN forward of :11434 disappeared 10-06 ~15:50Z). Nothing else.
EP="${OLLAMA_BASE_URL:-}"
# 127.0.0.1:11611 = mcai-studio-tunnel.service on this host (brain-01: the Studio's brain proxy; owner key 10-12).
studio_ep() { [[ "$1" == "http://ai.ticrcorp.com:11434" || "$1" == "http://10.0.0.70:11501" || "$1" == "http://10.0.0.70:11502" || "$1" == "http://127.0.0.1:11611" ]]; }
studio_ep "$EP" || { echo "refusing: model endpoint is not the Studio"; exit 3; }
# A POOL (brain-01 drills: `url|model|brain|ms,...`) is allowed only when EVERY entry's url is a Studio endpoint.
IFS=',' read -ra POOLE <<< "${OLLAMA_BASE_URLS:-$EP}"
for e in "${POOLE[@]}"; do studio_ep "${e%%|*}" || { echo "refusing: pool endpoint ${e%%|*} is not the Studio"; exit 3; }; done
[[ "${LOG_DIR:-}" == "$HOME/mbench-cl/runs/"* && "${STATE_DIR:-}" == "$HOME/mbench-cl/runs/"* ]] || { echo "refusing: logs/state must live under ~/mbench-cl/runs"; exit 3; }
[[ "${BOT_NAME:-}" == mbench* ]] || { echo "refusing: BOT_NAME must start with mbench"; exit 3; }
mkdir -p "$LOG_DIR" "$STATE_DIR"
# BOT_TREE: the bench tree to run (~/mbench-cl/tree = bench-closedloop; ~/mbench-c2/tree = bench-c2 with the directive
# hook). Never the fleet's /srv/mcbots or /opt/minecraft-ai.
TREE="${BOT_TREE:-$HOME/mbench-cl/tree}"
[[ "$TREE" == "$HOME/mbench-cl/tree" || "$TREE" == "$HOME/mbench-c2/tree" || "$TREE" == "$HOME/brain01/tree" ]] || { echo "refusing: BOT_TREE $TREE"; exit 3; }
cd "$TREE/bots" && exec nice -n 5 node --max-old-space-size=768 src/index.mjs
