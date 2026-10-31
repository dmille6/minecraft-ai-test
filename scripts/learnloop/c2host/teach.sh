#!/bin/bash
# candidate 2 local teacher: qwen3.8:27b on the 3090 (moved off the Blackwell 23:37Z: the qwen35-01 load test), think:false via proxy.py (as blackwell-base-01), T=0,
# through the fleet client (replay_client.mjs, bots-d014ec2cbd8b). Pilot-1000 first (agreement vs Claude), then the
# 16,000-item relabel pool. Resumable (replay_client skips ids already answered). STOP file pauses before the next phase.
set -u
C=$HOME/learnloop/c2; H=$C/app/scripts/learnloop/train; B=$HOME/learnloop/replay/bots-d014ec2cbd8b/bots
M=${M:-qwen3.8:27b}; T=$(echo $M | tr ":/." "___"); CONC=${CONC:-2}
python3 $C/proxy.py 18440 & PX=$!; sleep 1; trap "kill $PX" EXIT
for set in pilot:$HOME/learnloop/datasets/v0/pilot-1000.jsonl pool:$C/data/v1/relabel-pool.shuf.jsonl; do
  n=${set%%:*}; f=${set#*:}
  [ -e $C/STOP ] && { echo "$(date -u +%FT%TZ) STOP file: paused before $n"; exit 0; }
  echo "$(date -u +%FT%TZ) == $M $n ($f) conc $CONC"
  LLM_TEMPERATURE=0 nice -n 19 node $H/replay_client.mjs $B $f $C/labels-$T-$n.jsonl http://127.0.0.1:18440 $M $CONC 2>&1 | grep -E "replayed|ABORT|items|000/"
done
echo "$(date -u +%FT%TZ) ALL-DONE"
