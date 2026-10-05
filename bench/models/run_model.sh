#!/bin/bash
# One model, end to end, on the Studio. Unloads the previous benchmark model first; never touches co-tenants.
#   run_model.sh <engine> <model> <label> <brain-think> <slow-think> [mode] [extra run_bench args...]
# mode: (none) full = A2 brain + throughput + stuck/overseer + Stage B
#       screen      = the fixed A1 subset (data/screen_ids.txt), no throughput, + Stage B
#       slowonly    = only the slow roles (screen stuck/overseer + B2/B3) at <slow-think>: the thinking factor
set -u
cd "$(dirname "$0")"
ENGINE=$1; MODEL=$2; LABEL=$3; BT=$4; ST=$5; shift 5
MODE=full; case "${1:-}" in screen|slowonly) MODE=$1; shift;; esac
OLLAMA=/Applications/Ollama.app/Contents/Resources/ollama
echo "=== $(date -u +%FT%TZ) $LABEL ($ENGINE $MODEL) mode=$MODE brain-think=$BT slow-think=$ST" | tee -a out/driver.log
if [ "$ENGINE" = ollama ]; then
  for m in $(cat out/.loaded 2>/dev/null); do [ "$m" != "$MODEL" ] && $OLLAMA stop "$m" 2>/dev/null; done
  echo "$MODEL" > out/.loaded
  $OLLAMA show "$MODEL" 2>/dev/null | sed -n '1,25p' > out/info-$LABEL.txt
fi
IDS=(); [ "$MODE" != full ] && IDS=(--ids-file data/screen_ids.txt)
if [ "$MODE" != slowonly ]; then
  python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets brain --think "$BT" --concurrency 4 ${IDS[@]+"${IDS[@]}"} "$@" >> out/$LABEL.log 2>&1
  [ "$MODE" = full ] && python3 throughput.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --think "$BT" >> out/$LABEL.log 2>&1
fi
python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets stuck,overseer --overseer-think "$ST" --concurrency 4 ${IDS[@]+"${IDS[@]}"} "$@" >> out/$LABEL.log 2>&1
# Stage B suites (all their items in every mode: they are small): b4 = brain role, b2/b3 = slow role.
[ "$MODE" != slowonly ] && python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets b4 --think "$BT" --concurrency 4 "$@" >> out/$LABEL.log 2>&1
python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets b2,b3 --overseer-think "$ST" --concurrency 4 "$@" >> out/$LABEL.log 2>&1
[ "$ENGINE" = ollama ] && $OLLAMA ps >> out/$LABEL.log
echo "=== $(date -u +%FT%TZ) $LABEL done" | tee -a out/driver.log
