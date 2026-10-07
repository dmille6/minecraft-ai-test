#!/bin/bash
# C2: a short smoke (det, ov+esc; 25 min; tag b90) at the queue's "pause c2smoke"; if the smoke gate passes, the
# pre-registered series (4 arms x 3 blocks, 90 min) at "pause c2". If it fails, release the c2 pause so the long
# tail runs, and stop for a human.
cd "$(dirname "$0")"
python3 cl_series.py --arms arms-c2-smoke.json --starts 1 --bots 8 --minutes 25 --wait-pause --pause-tag c2smoke \
  --block-offset 90 --seed 1007 --ollama-endpoint http://10.0.0.70:11502
if python3 c2_smoke_check.py results/runs.jsonl; then
  echo "$(date -u +%FT%TZ) smoke PASS; series waits for pause c2"
  python3 cl_series.py --arms arms-c2.json --starts 3 --bots 8 --minutes 90 --wait-pause --pause-tag c2 \
    --block-offset 0 --seed 1007 --ollama-endpoint http://10.0.0.70:11502
  echo "$(date -u +%FT%TZ) C2 series done"
else
  echo "$(date -u +%FT%TZ) smoke FAIL; releasing pause c2 when it arrives"
  until ssh -o BatchMode=yes mike@ai.ticrcorp.com 'cat ~/mbench/out/GPU_RESERVED 2>/dev/null' </dev/null | grep -q '^pause-c2$'; do sleep 120; done
  ssh -o BatchMode=yes mike@ai.ticrcorp.com 'rm -f ~/mbench/out/GPU_RESERVED' </dev/null
fi
