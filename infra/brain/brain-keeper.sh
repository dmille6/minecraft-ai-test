#!/bin/bash
# brain-01, ON THE STUDIO, every minute (com.mcai.brain01.keeper.plist, StartInterval 60). STAGED, NOT INSTALLED.
# Owns ONE reservation value, `brain01-live`, in ~/mbench/out/GPU_RESERVED (the bench queue waits while the file exists).
#   ~/brain01/LIVE present  -> ACQUIRE: write brain01-live only if the file is absent or already ours; if another holder
#                              has it (a bench pause or run), log and page-file it and do NOT overwrite -- the operator
#                              must not go live while the Studio is in someone else's hands. Then keep the model
#                              loaded as `brain` (--parallel 12, 16k context).
#   ~/brain01/LIVE absent   -> RELEASE: remove the reservation only if it is ours.
# Every action and every failure is one line in ~/brain01/keeper.log; a refused acquire also writes ~/brain01/KEEPER-BLOCKED.
L=~/.lmstudio/bin/lms; LOG=~/brain01/keeper.log; R=~/mbench/out/GPU_RESERVED; ME=brain01-live
log() { echo "$(date -u +%FT%TZ) $*" >> $LOG; }
cur=$(cat $R 2>/dev/null)
if [ ! -f ~/brain01/LIVE ]; then
  if [ "$cur" = "$ME" ]; then rm -f $R && log "released $ME" || log "RELEASE FAILED"; fi
  rm -f ~/brain01/KEEPER-BLOCKED; exit 0
fi
if [ -n "$cur" ] && [ "$cur" != "$ME" ]; then
  log "BLOCKED: reservation held by '$cur'; not overwriting"; echo "$(date -u +%FT%TZ) held by $cur" > ~/brain01/KEEPER-BLOCKED; exit 1
fi
[ "$cur" = "$ME" ] || { echo $ME > $R && log "acquired $ME" || { log "ACQUIRE FAILED"; exit 1; }; }
rm -f ~/brain01/KEEPER-BLOCKED
if ! curl -s -m 5 http://127.0.0.1:1234/v1/models | grep -q '"id": *"brain"'; then
  log "model not loaded; loading"
  $L server start --port 1234 >> $LOG 2>&1 || log "server start FAILED"
  $L load gemma-4-26b-a4b-it@8bit -y --context-length 16384 --parallel 12 --identifier brain >> $LOG 2>&1 || log "LOAD FAILED"
fi
