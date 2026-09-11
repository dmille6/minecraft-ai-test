#!/usr/bin/env bash
# Mac-side orchestration: load a fixture into the sandbox (worlds host), run the local bot, collect the verdict.
# Usage: sandbox/run-scenario.sh <fixture.json> <env-file> [minutes]   -> appends to sandbox/results.jsonl
set -euo pipefail
FX="${1:?fixture}"; ENVF="${2:?env}"; MIN="${3:-15}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"; H=mike@10.0.0.30
BOT=$(grep '^BOT_NAME=' "$ROOT/$ENVF" | cut -d= -f2); BR_ROOT="${BOT_ROOT:-$ROOT}"; SHA=$(git -C "$BR_ROOT" rev-parse --short HEAD); BR=$(git -C "$BR_ROOT" branch --show-current || echo detached)
scp -q "$ROOT/$FX" "$ROOT/scripts/sandbox-scenario.py" "$H:/tmp/"
OUT="$ROOT/sandbox/log/scenario-$(date -u +%Y%m%dT%H%M%S).log"; mkdir -p "$ROOT/sandbox/log"
ssh "$H" "python3 /tmp/sandbox-scenario.py /tmp/$(basename "$FX") --bot $BOT --minutes $MIN --verify" > "$OUT" 2>&1 &
LOADER=$!
sleep 8   # let the loader forceload + setblock before the bot joins
BOT_ROOT="$BR_ROOT" "$ROOT/sandbox/run-bot.sh" "$ENVF" > "$ROOT/sandbox/log/bot-$BOT.out" 2>&1 &
BOTPID=$!
wait $LOADER || true
kill $BOTPID 2>/dev/null || true; sleep 2
V=$(grep -E '^\{"fixture"' "$OUT" | tail -1)
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"sha\":\"$SHA\",\"branch\":\"$BR\",\"fixture\":\"$FX\",\"env\":\"$ENVF\",\"verdict\":$V}" >> "$ROOT/sandbox/results.jsonl"
echo "$V"; echo "loader log: $OUT"
