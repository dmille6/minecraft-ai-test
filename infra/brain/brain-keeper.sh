#!/bin/bash
# brain-01, ON THE STUDIO, every minute (launchd StartInterval 60): keep LM Studio serving gemma4 as `brain`, and hold
# the Studio for it. STAGED 2026-10-12, NOT INSTALLED.
# - writes ~/mbench/out/GPU_RESERVED=brain01-live while the canary or subset is live, so the bench queue (which unloads
#   models) waits; the operator removes ~/brain01/LIVE to release it
# - if the model is not loaded, starts the server and loads it (--parallel 12, 16k context); logs every action
L=~/.lmstudio/bin/lms; LOG=~/brain01/keeper.log
[ -f ~/brain01/LIVE ] || exit 0
echo brain01-live > ~/mbench/out/GPU_RESERVED
if ! curl -s -m 5 http://127.0.0.1:1234/v1/models | grep -q '"id": *"brain"'; then
  echo "$(date -u +%FT%TZ) model not loaded; loading" >> $LOG
  $L server start --port 1234 >> $LOG 2>&1
  $L load gemma-4-26b-a4b-it@8bit -y --context-length 16384 --parallel 12 --identifier brain >> $LOG 2>&1
fi
