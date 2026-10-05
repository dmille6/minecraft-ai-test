#!/bin/bash
# One model, end to end, on the Studio. Unloads the previous benchmark model first; never touches co-tenants.
#   run_model.sh <engine> <model> <label> <brain-think> <slow-think> [mode] [extra run_bench args...]
# mode: (none) full = A2 brain + throughput + stuck/overseer + Stage B
#       screen      = the fixed A1 subset (data/screen_ids.txt), no throughput, + Stage B
#       slowonly    = only the slow roles (54-item slow subset) at <slow-think>: the thinking factor
#       brainonly   = only the brain screen + B4 (e.g. the format factor: --format-mode tools)
set -u
cd "$(dirname "$0")"
# LM Studio lines: "lmstudio <model-key> <label> <bt> <st> [parallel] [ctx]" -> the A4 runtime factor script
if [ "${1:-}" = lmstudio ]; then exec ./lms_factor.sh "$2" "$3" "${6:-4}" "${7:-16384}" "$4" "$5"; fi
# A5 serving lines: "serve <worker-model> <label> <worker-think> <overseer-think> [overseer-model] [bots] [minutes]"
if [ "${1:-}" = serve ]; then
  while [ -e out/GPU_RESERVED ]; do sleep 30; done
  echo "=== $(date -u +%FT%TZ) $3 (serve $2 + ${6:-none}) bots=${7:-8}" | tee -a out/driver.log
  for m in $(cat out/.loaded 2>/dev/null); do /Applications/Ollama.app/Contents/Resources/ollama stop "$m" 2>/dev/null; done
  echo "$2 ${6:-}" > out/.loaded
  OV=(); [ -n "${6:-}" ] && [ "${6:-}" != none ] && OV=(--overseer "$6" --overseer-think "$5" --escalate-every 180)
  python3 serving.py --worker "$2" --worker-think "$4" --bots "${7:-8}" --minutes "${8:-15}" --label "$3" ${OV[@]+"${OV[@]}"} >> out/$3.log 2>&1
  echo "=== $(date -u +%FT%TZ) $3 done" | tee -a out/driver.log
  exit 0
fi
ENGINE=$1; MODEL=$2; LABEL=$3; BT=$4; ST=$5; shift 5
MODE=full; case "${1:-}" in screen|slowonly|brainonly) MODE=$1; shift;; esac
OLLAMA=/Applications/Ollama.app/Contents/Resources/ollama
# A Stage C closed-loop run holds the GPU: wait for its reservation to clear before starting a model.
while [ -e out/GPU_RESERVED ]; do sleep 30; done
echo "=== $(date -u +%FT%TZ) $LABEL ($ENGINE $MODEL) mode=$MODE brain-think=$BT slow-think=$ST" | tee -a out/driver.log
if [ "$ENGINE" = ollama ]; then
  for m in $(cat out/.loaded 2>/dev/null); do [ "$m" != "$MODEL" ] && $OLLAMA stop "$m" 2>/dev/null; done
  echo "$MODEL" > out/.loaded
  $OLLAMA show "$MODEL" 2>/dev/null | sed -n '1,25p' > out/info-$LABEL.txt
fi
# Unload the model before each phase. Measured 10-05 (twice): a request with a different num_ctx for a model
# that is already loaded wedged Ollama 0.33.3's scheduler -- every request hung until the server was restarted.
unload() { [ "$ENGINE" = ollama ] && $OLLAMA stop "$MODEL" >/dev/null 2>&1; sleep 3; return 0; }
IDS=(); [ "$MODE" != full ] && IDS=(--ids-file data/screen_ids.txt)
# the thinking factor is expensive (minutes per answer): a fixed 54-item slow subset (data/slow_ids.txt)
[ "$MODE" = slowonly ] && IDS=(--ids-file data/slow_ids.txt)
if [ "$MODE" != slowonly ]; then
  python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets brain --think "$BT" --concurrency 4 ${IDS[@]+"${IDS[@]}"} "$@" >> out/$LABEL.log 2>&1
  [ "$MODE" = full ] && python3 throughput.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --think "$BT" >> out/$LABEL.log 2>&1
fi
[ "$MODE" != brainonly ] && unload && python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets stuck,overseer --overseer-think "$ST" --concurrency 4 ${IDS[@]+"${IDS[@]}"} "$@" >> out/$LABEL.log 2>&1
# Stage B suites (all their items in every mode: they are small): b4 = brain role, b2/b3 = slow role.
[ "$MODE" != slowonly ] && unload && python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets b4 --think "$BT" --concurrency 4 "$@" >> out/$LABEL.log 2>&1
BIDS=(); [ "$MODE" = slowonly ] && BIDS=(--ids-file data/slow_ids.txt)
[ "$MODE" != brainonly ] && unload && python3 run_bench.py --engine "$ENGINE" --model "$MODEL" --label "$LABEL" --sets b2,b3 --overseer-think "$ST" --concurrency 4 ${BIDS[@]+"${BIDS[@]}"} "$@" >> out/$LABEL.log 2>&1
[ "$ENGINE" = ollama ] && $OLLAMA ps >> out/$LABEL.log
echo "=== $(date -u +%FT%TZ) $LABEL done" | tee -a out/driver.log
