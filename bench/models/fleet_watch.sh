#!/bin/bash
# Controller-side hard stops for the Clef run (the Studio cannot reach 10.0.0.31): every 5 min read fleetstatus and
# stop the Studio job unless the showcase shows 10 of 10 bots, 0 deaths and 0 brain fallback. Two failed reads in a
# row also stop it (fail safe). Exits when the Studio's RUN.state leaves "running".
STUDIO=mike@ai.ticrcorp.com; LOG=${1:-fleet_watch.log}; fails=0
stop() { echo "$(date -u +%FT%TZ) STOP: $1" >> "$LOG"
  ssh $STUDIO 'cd ~/clef1029; for f in engine.pid shim.pid; do p=$(cat $f); ps -o command= -p $p | grep -qE "systemone_engine|clef_shim" && kill $p; done; echo killed > RUN.state'; exit 2; }
while :; do
  st=$(ssh -o ConnectTimeout=20 $STUDIO 'cat ~/clef1029/RUN.state' 2>/dev/null)
  [ "$st" = running ] || { echo "$(date -u +%FT%TZ) end: RUN.state=$st" >> "$LOG"; exit 0; }
  out=$(ssh -o ConnectTimeout=20 10.0.0.31 'cd /opt/minecraft-ai/scripts && timeout 200 python3 host/fleetstatus.py 2>&1' | grep -E 'showcase OK|SHOWCASE bots|SHOWCASE BRAIN')
  ok=$(echo "$out" | grep -c 'showcase OK: 10 of 10 bots')
  bots=$(echo "$out" | grep -E 'SHOWCASE bots: 10 present .*deaths 0,' | wc -l)
  brain=$(echo "$out" | grep -E 'SHOWCASE BRAIN: .*fallback/other 0 .*unserved 0 ' | wc -l)
  echo "$(date -u +%FT%TZ) ok=$ok bots=$bots brain=$brain | $(echo "$out" | tr '\n' '|' | cut -c1-400)" >> "$LOG"
  if [ -z "$out" ]; then fails=$((fails+1)); [ $fails -ge 2 ] && stop "fleetstatus unreadable twice"
  else fails=0
    [ "$ok" -ge 1 ] || stop "showcase not 10 of 10"
    [ "$bots" -ge 1 ] || stop "showcase bots/deaths line not 10 present, deaths 0"
    [ "$brain" -ge 1 ] || stop "showcase brain fallback/unserved not 0"
  fi
  sleep 300
done
