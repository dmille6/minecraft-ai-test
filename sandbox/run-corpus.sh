#!/usr/bin/env bash
# run-corpus.sh <candidate-root> [control-root] -- the trap corpus, control vs candidate, four sandbox servers in parallel.
# Each line of sandbox/corpus.tsv: <fixture path>\t<env>\t<script>\t<minutes>\t<label>. Every fixture runs on BOTH roots
# (control first on sandbox/sandbox2, candidate on sandbox3/sandbox4 -- two at a time per root). Scores per run: died,
# loader-escaped, rose>=4 dry, moved>=8, pickaxes lost (inventory before vs after). Appends to sandbox/corpus-results.tsv
# and prints a table. A change is fleet-eligible only when its candidate column is at least as good as control on every
# fixture and better on the ones it targets (the replay gate, reliability program step 1).
# CORPUS=path runs another fixture list (e.g. sandbox/corpus-lava.tsv); REPEATS=n repeats each fixture.
set -u; CAND="${1:?candidate root}"; CTRL="${2:-$HOME/Documents/mcai-base}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="${CORPUS:-$ROOT/sandbox/corpus.tsv}"; OUT="$ROOT/sandbox/corpus-results.tsv"; RUN=$(date -u +%Y%m%dT%H%M)
score() { (cd "$ROOT" && python3 sandbox/score-run.py "$@"); }
# NO ORPHANS. A killed run leaves its bot processes connected under the same names, and the next run's bots then
# ping-pong with them on duplicate logins (every reconnect resets the runner and its arbiter: corpus run 4,
# 2026-09-13, was scored on that). Every sandbox bot on this machine is ours to kill.
pkill -f "max-old-space-size=768 src/index.mjs" 2>/dev/null && sleep 3; pkill -f "sandbox/sandbox-brain.mjs" 2>/dev/null; true
one() {  # one <server> <root> <arm> <fixture> <env> <script> <minutes> <label>
  local SERVER=$1 ROOTB=$2 ARM=$3 FX=$4 ENV=$5 SCRIPT=$6 MIN=$7 LABEL=$8
  local T0=$(date -u +%FT%TZ); local BOT=$(grep '^BOT_NAME=' "$ROOT/$ENV" | cut -d= -f2); [[ "$SERVER" != sandbox ]] && BOT="$BOT-${SERVER#sandbox}"
  local EXTRA=""; [[ "$ARM" == candidate ]] && EXTRA="${CANDIDATE_ENV_EXTRA:-}"; [[ "$ARM" == control ]] && EXTRA="${CONTROL_ENV_EXTRA:-}"
  local V=$(cd "$ROOT" && SERVER=$SERVER BOT_ROOT=$ROOTB SCRIPT="$SCRIPT" ENV_EXTRA="$EXTRA" sandbox/run-scenario.sh "$FX" "$ENV" "$MIN" 2>&1 | grep -E '^\{"fixture"' | tail -1)
  local T1=$(date -u +%FT%TZ)
  score "$BOT" "$T0" "$T1" "$LABEL" "$ARM" "$ROOTB" "$ROOT/$FX" "${V:-{}}" | tee -a "$OUT.tmp"
}
: > "$OUT.tmp"; i=0
# REPEATS=n runs every fixture n times per arm (single 4-5 min runs differ by chance more than most changes do:
# corpus runs 5-7 vs the probe, 2026-09-13). The table then carries one row per run; sum the columns per label.
while IFS=$'\t' read -r FX ENV SCRIPT MIN LABEL; do
  [[ -z "$FX" || "$FX" == \#* ]] && continue
  for ((rep = 1; rep <= ${REPEATS:-1}; rep++)); do
    one sandbox  "$CTRL" control   "$FX" "$ENV" "$SCRIPT" "$MIN" "$LABEL" &
    one sandbox3 "$CAND" candidate "$FX" "$ENV" "$SCRIPT" "$MIN" "$LABEL" &
    wait
  done
done < "$CORPUS"
echo "=== corpus $RUN candidate=$(git -C "$CAND" rev-parse --short HEAD) control=$(git -C "$CTRL" rev-parse --short HEAD)"; column -t "$OUT.tmp"; sed "s/^/$RUN\t/" "$OUT.tmp" >> "$OUT"; rm -f "$OUT.tmp"
