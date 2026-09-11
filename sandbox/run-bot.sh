#!/usr/bin/env bash
# Run one sandbox bot from THIS checkout against the SANDBOX server only.
# FAIL-CLOSED: refuses anything that is not 10.0.0.30:25599 with the model off and logs under ./sandbox.
set -euo pipefail
ENVF="${1:?env file}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/$ENVF"; set +a
[[ "${MINECRAFT_HOST:-}" == "10.0.0.30" && "${MINECRAFT_PORT:-}" == "25599" ]] || { echo "refusing: not the sandbox server ($MINECRAFT_HOST:$MINECRAFT_PORT)"; exit 3; }
[[ "${LLM_ENABLED:-}" == "false" ]] || { echo "refusing: the sandbox bot runs with the model OFF"; exit 3; }
[[ "${LOG_DIR:-}" == ./sandbox/* && "${STATE_DIR:-}" == ./sandbox/* ]] || { echo "refusing: logs/state must live under ./sandbox"; exit 3; }
[[ "${BOT_NAME:-}" == sandbox-* ]] || { echo "refusing: BOT_NAME must start with sandbox-"; exit 3; }
export LOG_DIR="$ROOT/${LOG_DIR#./}" STATE_DIR="$ROOT/${STATE_DIR#./}"; mkdir -p "$LOG_DIR" "$STATE_DIR"
cd "${BOT_ROOT:-$ROOT}/bots" && exec node --max-old-space-size=768 src/index.mjs   # BOT_ROOT: a worktree at the revision under test
