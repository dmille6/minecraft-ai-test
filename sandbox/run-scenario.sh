#!/usr/bin/env bash
# Mac-side orchestration: load a fixture into the sandbox (worlds host), run the local bot, collect the verdict.
# Usage: sandbox/run-scenario.sh <fixture.json> <env-file> [minutes]   -> appends to sandbox/results.jsonl
set -euo pipefail
FX="${1:?fixture}"; ENVF="${2:?env}"; MIN="${3:-15}"; GIVE="${GIVE:-}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"; H=mike@10.0.0.30
# WHICH SANDBOX: SERVER=sandbox|sandbox2|sandbox3|sandbox4 (ports 25599..25602). The env file is rewritten to that
# port through a temp copy so four scenarios can run at once on four worlds (2026-09-13).
SERVER="${SERVER:-sandbox}"; case "$SERVER" in sandbox) PORT=25599;; sandbox2) PORT=25600;; sandbox3) PORT=25601;; sandbox4) PORT=25602;; *) echo "unknown SERVER $SERVER"; exit 2;; esac
BRAIN_PORT="${BRAIN_PORT:-$((11499 + PORT - 25599))}"
SUFFIX=""; [[ "$SERVER" != sandbox ]] && SUFFIX="-${SERVER#sandbox}"   # sandbox2 -> "-2": distinct bot name, log and state dirs per server
TMPENV="$(mktemp "$ROOT/sandbox/.env.XXXXXX")"; sed "s/^MINECRAFT_PORT=.*/MINECRAFT_PORT=$PORT/; s#^OLLAMA_BASE_URL=.*#OLLAMA_BASE_URL=http://127.0.0.1:$BRAIN_PORT#; s#^OLLAMA_BASE_URLS=.*#OLLAMA_BASE_URLS=http://127.0.0.1:$BRAIN_PORT#; s#^BOT_NAME=\(.*\)#BOT_NAME=\1$SUFFIX#; s#^LOG_DIR=\(.*\)#LOG_DIR=\1$SUFFIX#; s#^STATE_DIR=\(.*\)#STATE_DIR=\1$SUFFIX#" "$ROOT/$ENVF" > "$TMPENV"; trap 'rm -f "$TMPENV"' EXIT
[[ -n "${ENV_EXTRA:-}" ]] && printf "%s\n" "$ENV_EXTRA" | tr ";" "\n" >> "$TMPENV"   # e.g. ENV_EXTRA="ARBITER=1" (semicolon-separated)
ENVREL="${TMPENV#$ROOT/}"
BOT="$(grep '^BOT_NAME=' "$ROOT/$ENVF" | cut -d= -f2)${SUFFIX}"; BR_ROOT="${BOT_ROOT:-$ROOT}"; SHA=$(git -C "$BR_ROOT" rev-parse --short HEAD); BR=$(git -C "$BR_ROOT" branch --show-current || echo detached)
scp -q "$ROOT/$FX" "$ROOT/sandbox/sandbox-scenario.py" "$H:/tmp/"
OUT="$ROOT/sandbox/log/scenario-$(date -u +%Y%m%dT%H%M%S).log"; mkdir -p "$ROOT/sandbox/log"
ssh "$H" "timeout $((MIN*60+240)) python3 /tmp/sandbox-scenario.py /tmp/$(basename "$FX") --bot $BOT --server $SERVER --minutes $MIN --verify ${GIVE:+--give $GIVE} ${AT:+--at $AT}" > "$OUT" 2>&1 &   # hard cap: the loader has hung after its watch twice (2026-09-13)
LOADER=$!
BRAINPID=""
if [[ -n "${SCRIPT:-}" ]]; then   # scripted decisions through the bots' own model interface, loopback only
  pkill -f "sandbox-brain.mjs $BRAIN_PORT" 2>/dev/null || true; sleep 1   # a stale brain on THIS port would answer with the OLD script
  (SANDBOX_SCRIPT="$SCRIPT" SANDBOX_DELAY_MS="${SCRIPT_DELAY_MS:-30000}" node "$ROOT/sandbox/sandbox-brain.mjs" $BRAIN_PORT) > "${OUT%.log}-brain.log" 2>&1 &
  BRAINPID=$!
fi
sleep 8   # let the loader forceload + setblock before the bot joins
BOT_ROOT="$BR_ROOT" "$ROOT/sandbox/run-bot.sh" "$ENVREL" > "$ROOT/sandbox/log/bot-$BOT.out" 2>&1 &
BOTPID=$!
if [[ -n "${SAY:-}" ]]; then
  # give the loader time to place the bot (join ~10 s + tp), then hand it a deterministic command
  sleep "${SAY_DELAY:-30}"; (cd "$ROOT/bots" && node scripts/sandbox-say.mjs "$SAY") > "${OUT%.log}-op.log" 2>&1 || true
fi
wait $LOADER || true
kill $BOTPID 2>/dev/null || true; [[ -n "$BRAINPID" ]] && kill $BRAINPID 2>/dev/null || true; sleep 2
V=$(grep -E '^\{"fixture"' "$OUT" | tail -1)
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"sha\":\"$SHA\",\"branch\":\"$BR\",\"fixture\":\"$FX\",\"env\":\"$ENVF\",\"say\":\"${SAY:-}\",\"script\":\"${SCRIPT:-}\",\"at\":\"${AT:-}\",\"give\":\"${GIVE:-}\",\"verdict\":$V}" >> "$ROOT/sandbox/results.jsonl"
echo "$V"; echo "loader log: $OUT"
