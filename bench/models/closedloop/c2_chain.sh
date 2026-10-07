#!/bin/bash
# C2: a short smoke (det, ov+esc; 25 min; block b91 by default) at the queue's "pause <smoke-tag>"; if the smoke gate
# passes, the pre-registered series (4 arms x 3 blocks, 90 min) at "pause <series-tag>". If it fails, release that
# pause (only if it is still that pause) so the long tail runs, and stop for a human.
# usage: c2_chain.sh [smoke-tag=c2smoke] [series-tag=c2] [smoke-block=91]   (the smoke gate reads the smoke block)
cd "$(dirname "$0")"
ST=${1:-c2smoke}; RT=${2:-c2}; SB=${3:-91}   # 90 holds the failed 10-07 smoke
# smoke blocks: a plain decimal >= 90 (no leading zero: cl_series writes -b<int>), so c2_analyze.py always excludes them
[[ "$SB" =~ ^[1-9][0-9]*$ ]] && (( SB >= 90 )) || { echo "refusing: smoke block $SB must be a decimal integer >= 90"; exit 3; }
python3 cl_series.py --arms arms-c2-smoke.json --starts 1 --bots 8 --minutes 25 --wait-pause --pause-tag "$ST" \
  --block-offset "$SB" --seed 1007 --ollama-endpoint http://10.0.0.70:11502
rc=$?
if [ $rc -ne 0 ]; then echo "$(date -u +%FT%TZ) smoke series exited $rc (reservation not released?); stopping for a human"; exit $rc; fi
if python3 c2_smoke_check.py results/runs.jsonl "$SB"; then
  echo "$(date -u +%FT%TZ) smoke PASS; series waits for pause $RT"
  python3 cl_series.py --arms arms-c2.json --starts 3 --bots 8 --minutes 90 --wait-pause --pause-tag "$RT" \
    --block-offset 0 --seed 1007 --ollama-endpoint http://10.0.0.70:11502
  rc=$?
  echo "$(date -u +%FT%TZ) C2 series done (exit $rc)"; exit $rc
else
  echo "$(date -u +%FT%TZ) smoke FAIL; releasing pause $RT when it arrives"
  until ssh -o BatchMode=yes mike@ai.ticrcorp.com 'cat ~/mbench/out/GPU_RESERVED 2>/dev/null' </dev/null | grep -qx "pause-$RT"; do sleep 120; done
  # one call, and only if it is STILL our pause
  until out=$(ssh -o BatchMode=yes -o ConnectTimeout=20 mike@ai.ticrcorp.com "f=~/mbench/out/GPU_RESERVED; c=\$(cat \$f 2>/dev/null); if [ \"\$c\" = pause-$RT ]; then rm -f \$f && echo RELEASED || echo RM-FAILED; else echo \"NOT-OURS \$c\"; fi" </dev/null) && [ -n "$out" ] && [ "$out" != RM-FAILED ]; do sleep 30; done
  echo "$(date -u +%FT%TZ) pause $RT: $out"; exit 1
fi
