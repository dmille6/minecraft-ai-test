#!/bin/bash
# A4 runtime factor: the same screen items through LM Studio (MLX or GGUF engine) instead of Ollama.
#   lms_factor.sh <lms-model-key> <label> [parallel=4] [ctx=16384] [brain-think=none] [slow-think=none]
# Holds the GPU reservation (the Ollama queue waits), unloads the benchmark's Ollama model, starts the LM Studio
# server on 127.0.0.1:1234, loads the model with --parallel, runs brain(screen) + throughput + stuck/overseer
# (screen) + Stage B, then unloads, stops the server and releases the GPU. Thinking: LM Studio's own default for
# the model (recorded in the output); --think/--overseer-think strings are passed as reasoning_effort.
set -u
cd "$(dirname "$0")"
KEY=$1; LABEL=$2; PAR=${3:-4}; CTX=${4:-16384}; BT=${5:-none}; ST=${6:-none}; set --
LMS=~/.lmstudio/bin/lms
echo "lms-$LABEL" > out/GPU_RESERVED
while pgrep -f "run_bench.py|throughput.py|serving.py" >/dev/null; do sleep 30; done
echo "=== $(date -u +%FT%TZ) $LABEL (lmstudio $KEY) parallel=$PAR ctx=$CTX" | tee -a out/driver.log
for m in $(cat out/.loaded 2>/dev/null); do /Applications/Ollama.app/Contents/Resources/ollama stop "$m" 2>/dev/null; done
$LMS server start --port 1234 >> out/$LABEL.log 2>&1
$LMS unload --all >> out/$LABEL.log 2>&1
$LMS load "$KEY" -y --context-length "$CTX" --parallel "$PAR" --identifier bench >> out/$LABEL.log 2>&1
$LMS ps >> out/$LABEL.log 2>&1
R="--engine openai --url http://127.0.0.1:1234 --model bench --label $LABEL --concurrency 4"
python3 run_bench.py $R --sets brain --ids-file data/screen_ids.txt --think $BT >> out/$LABEL.log 2>&1
python3 throughput.py --engine openai --url http://127.0.0.1:1234 --model bench --label $LABEL --think $BT >> out/$LABEL.log 2>&1
python3 run_bench.py $R --sets stuck,overseer --ids-file data/screen_ids.txt --overseer-think $ST >> out/$LABEL.log 2>&1
python3 run_bench.py $R --sets b4 --think $BT >> out/$LABEL.log 2>&1
python3 run_bench.py $R --sets b2,b3 --overseer-think $ST >> out/$LABEL.log 2>&1
$LMS unload --all >> out/$LABEL.log 2>&1
$LMS server stop >> out/$LABEL.log 2>&1
rm -f out/GPU_RESERVED
echo "=== $(date -u +%FT%TZ) $LABEL done" | tee -a out/driver.log
