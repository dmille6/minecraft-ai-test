#!/bin/bash
# brain-01, ON THE STUDIO, every minute (com.mcai.brain01.keeper.plist, StartInterval 60).
# Two separate duties (10-12: another session's cleanup ran `lms unload --all; lms server stop` twice and nothing put
# gemma back -- the proxy then answered 502 for hours and every "gemma4" decision fell back to local, silently):
#   KEEP LOADED   while ~/brain01/KEEP_LOADED exists and ~/brain01/PAUSE does not: if the LM Studio server is down, start
#                 it; if the identifier `brain` is not loaded, load gemma4 MLX 8-bit as `brain` (--parallel 12, 16k).
#                 ~/brain01/PAUSE is how an operator frees the memory (e.g. for another job's fine-tune): touch PAUSE,
#                 `lms unload brain`; remove PAUSE and the keeper reloads within a minute. Never touches other models.
#   RESERVE       while ~/brain01/LIVE exists: own `brain01-live` in ~/mbench/out/GPU_RESERVED (the bench queue waits);
#                 never overwrite another holder (logs it, writes KEEPER-BLOCKED); release it when LIVE is gone.
# Every action and failure is one line in ~/brain01/keeper.log.
L=~/.lmstudio/bin/lms; LOG=~/brain01/keeper.log; R=~/mbench/out/GPU_RESERVED; ME=brain01-live
log() { echo "$(date -u +%FT%TZ) $*" >> $LOG; }
# --- RESERVE ---
cur=$(cat $R 2>/dev/null)
if [ -f ~/brain01/LIVE ]; then
  if [ -n "$cur" ] && [ "$cur" != "$ME" ]; then
    log "BLOCKED: reservation held by '$cur'; not overwriting"; echo "$(date -u +%FT%TZ) held by $cur" > ~/brain01/KEEPER-BLOCKED
  else
    [ "$cur" = "$ME" ] || { echo $ME > $R && log "acquired $ME" || log "ACQUIRE FAILED"; }
    rm -f ~/brain01/KEEPER-BLOCKED
  fi
else
  if [ "$cur" = "$ME" ]; then rm -f $R && log "released $ME" || log "RELEASE FAILED"; fi
  rm -f ~/brain01/KEEPER-BLOCKED
fi
# --- KEEP LOADED ---
[ -f ~/brain01/KEEP_LOADED ] || exit 0
[ -f ~/brain01/PAUSE ] && exit 0
if ! curl -s -m 5 http://127.0.0.1:1234/v1/models >/dev/null 2>&1; then
  log "LM Studio server down; starting"
  $L server start --port 1234 >> $LOG 2>&1 || { log "SERVER START FAILED"; exit 1; }
fi
if ! curl -s -m 5 http://127.0.0.1:1234/v1/models | grep -q '"id": *"brain"'; then
  log "model 'brain' not loaded; loading gemma-4-26b-a4b-it@8bit"
  $L load gemma-4-26b-a4b-it@8bit -y --context-length 16384 --parallel 12 --identifier brain >> $LOG 2>&1 || { log "LOAD FAILED"; exit 1; }
  log "loaded"
fi
