#!/bin/bash
# B1-physical series: waits for the Stage A queue's "pause fx" line (GPU held), runs the trap fixtures with each
# arm's model as the bot's brain (Studio Ollama via the mini's supervised tunnel), then releases the GPU.
cd "$(dirname "$0")"
FX=synthetic-entombed,synthetic-entombed-nopick,synthetic-island,synthetic-ledge,synthetic-tree-buried,hive-b-echo-sealed-pocket
until ssh -o BatchMode=yes mike@ai.ticrcorp.com 'cat ~/mbench/out/GPU_RESERVED 2>/dev/null' </dev/null | grep -q '^pause-fx'; do sleep 120; done
echo "$(date -u +%FT%TZ) GPU held; fixtures start"
for arm in "q25-7b qwen2.5:7b-instruct none" "gemma4-26b gemma4:26b false"; do
  set -- $arm
  until ssh -o BatchMode=yes mike@10.0.0.31 'curl -s -m 8 http://10.0.0.70:11502/api/version' </dev/null | grep -q version; do echo "endpoint down; waiting"; sleep 30; done
  python3 cl_fixture.py --arm "$1" --model "$2" --think "$3" --fixtures $FX --minutes 10 --repeats 1 --server sandbox4 --endpoint http://10.0.0.70:11502
done
ssh -o BatchMode=yes mike@ai.ticrcorp.com 'rm -f ~/mbench/out/GPU_RESERVED' </dev/null
echo "$(date -u +%FT%TZ) fixtures done"
