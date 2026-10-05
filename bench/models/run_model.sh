#!/bin/bash
# One model, end to end, on the Studio: quality replay (brain, stuck, overseer) then the concurrency
# sweep. Unloads the previous benchmark model first. Never touches the co-tenant models it did not load.
#   run_model.sh <engine> <model> <label> <brain-think> <slow-think> [extra run_bench args...]
#   e.g. run_model.sh ollama qwen3.6:35b-a3b q36-35b false true
set -u
cd "$(dirname "$0")"
ENGINE=$1; MODEL=$2; LABEL=$3; BT=$4; ST=$5; shift 5
OLLAMA=/Applications/Ollama.app/Contents/Resources/ollama
echo "=== $(date -u +%FT%TZ) $LABEL ($ENGINE $MODEL) brain-think=$BT slow-think=$ST" | tee -a out/driver.log
if [ "$ENGINE" = ollama ]; then
  for m in $(cat out/.loaded 2>/dev/null); do [ "$m" != "$MODEL" ] && $OLLAMA stop "$m" 2>/dev/null; done
  echo "$MODEL" > out/.loaded
  $OLLAMA show "$MODEL" 2>/dev/null | sed -n '1,25p' > out/info-$LABEL.txt
fi
# "screen" as the first extra arg = the A1 SCREEN: the fixed 168-item subset, no throughput sweep.
SCREEN=0; if [ "${1:-}" = screen ]; then SCREEN=1; shift; set -- --ids-file data/screen_ids.txt "$@"; fi
python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets brain --think "$BT" --concurrency 4 "$@" >> out/$LABEL.log 2>&1
[ "$SCREEN" = 1 ] || python3 throughput.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --think "$BT" >> out/$LABEL.log 2>&1
python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets stuck,overseer --overseer-think "$ST" --concurrency 4 "$@" >> out/$LABEL.log 2>&1
# Stage B suites (all items, also in screen mode: they are small): b4 = brain role, b2/b3 = slow role.
python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets b4 --think "$BT" --concurrency 4 >> out/$LABEL.log 2>&1
python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets b2,b3 --overseer-think "$ST" --concurrency 4 >> out/$LABEL.log 2>&1
[ "$ENGINE" = ollama ] && $OLLAMA ps >> out/$LABEL.log
echo "=== $(date -u +%FT%TZ) $LABEL done" | tee -a out/driver.log
