#!/bin/bash
# Stage C bot runner, ON THE BOTS HOST (10.0.0.31), from the bench tree ~/mbench-cl/tree (branch bench-closedloop).
# Keeps every guard of sandbox/run-bot.sh except "loopback model only", which becomes "the Studio endpoint only"
# (the owner dedicated the Studio to this experiment, 2026-10-05). Never the fleet's units, logs or state.
set -euo pipefail
ENVF="${1:?env file}"
set -a; source "$ENVF"; set +a
[[ "${MINECRAFT_HOST:-}" == "10.0.0.30" && "${MINECRAFT_PORT:-}" =~ ^(25599|25600|25601|25602)$ ]] || { echo "refusing: not a sandbox server"; exit 3; }
STUDIO=http://ai.ticrcorp.com:11434
[[ "${OLLAMA_BASE_URL:-}" == "$STUDIO" && "${OLLAMA_BASE_URLS:-$STUDIO}" == "$STUDIO" ]] || { echo "refusing: model endpoint is not the Studio"; exit 3; }
[[ "${LOG_DIR:-}" == "$HOME/mbench-cl/runs/"* && "${STATE_DIR:-}" == "$HOME/mbench-cl/runs/"* ]] || { echo "refusing: logs/state must live under ~/mbench-cl/runs"; exit 3; }
[[ "${BOT_NAME:-}" == mbench* ]] || { echo "refusing: BOT_NAME must start with mbench"; exit 3; }
mkdir -p "$LOG_DIR" "$STATE_DIR"
cd "$HOME/mbench-cl/tree/bots" && exec nice -n 5 node --max-old-space-size=768 src/index.mjs
