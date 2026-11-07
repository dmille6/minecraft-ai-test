#!/bin/bash
# voyager-01 STAGE 4 (owner 11-07 ~16:00Z, design §16): a head-to-head of three local coders on the Blackwell, one at a time,
# each ~8 h on a fresh copy of the seed, in arm slot b, at Haiku's pace. Run as root on the worlds host (timers call it).
#
#   stage4.sh start <model> <label>   check /api/ps (never take a slot the other project needs), archive slot b's world,
#                                     point the proxy at <model>, start Paper + the bot. Refuses (exit 2) if the Blackwell
#                                     already holds 4 models, or if <model> is not pulled there.
#   stage4.sh stop  <model> <label>   final read for the window, stop the bot + Paper, unload <model> ONLY if resident.
set -u
BW=http://ai.ticrcorp.com:11438
R=/srv/voyager/reports; mkdir -p "$R"
LOG="$R/stage4.log"
say () { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
resident () { curl -s -m 10 "$BW/api/ps" | python3 -c "import sys,json; print(' '.join(m['name'] for m in json.load(sys.stdin)['models']))"; }
proxy_b () {   # proxy_b <json-patch>
  python3 - "$1" <<'EOF'
import json, sys
p = "/etc/voyager/proxy.json"; d = json.load(open(p))
d["arms"]["b"].update(json.loads(sys.argv[1]))
json.dump(d, open(p + ".new", "w"), indent=1)
EOF
  chown root:voyager-proxy /etc/voyager/proxy.json.new && chmod 0640 /etc/voyager/proxy.json.new && mv /etc/voyager/proxy.json.new /etc/voyager/proxy.json
}

case "$1" in
start)
  M="$2"; L="$3"
  RES="$(resident)"; N=$(echo "$RES" | wc -w)
  say "start $L ($M): resident [$RES] ($N of 4)"
  if echo " $RES " | grep -q " $M "; then say "  $M already resident"; elif [ "$N" -ge 4 ]; then say "  REFUSED: 4 models resident; loading ours would evict one of theirs"; exit 2; fi
  if ! curl -s -m 10 "$BW/api/tags" | python3 -c "import sys,json; sys.exit(0 if any(m['name']=='$M' for m in json.load(sys.stdin)['models']) else 1)"; then say "  REFUSED: $M is not pulled on the Blackwell"; exit 2; fi
  THINK=$(curl -s -m 20 "$BW/api/show" -d "{\"model\":\"$M\"}" | python3 -c "import sys,json; print('true' if 'thinking' in (json.load(sys.stdin).get('capabilities') or []) else 'false')")
  systemctl stop voyager-bot@b voyager-paper@b
  A=/srv/voyager/archive/stage4-before-$(echo "$L" | tr -c 'A-Za-z0-9.-' '_')
  sh -c "cd /srv/voyager && mkdir -p '$A' && for d in world world_nether world_the_end; do [ -e worlds/b/\$d ] && mv worlds/b/\$d '$A'/; done; [ -e worlds/b/plugins/VoyagerGuard ] && mv worlds/b/plugins/VoyagerGuard '$A'/plugins_VoyagerGuard; for d in voyager bot pool; do [ -e state/b/\$d ] && mv state/b/\$d '$A'/; done; [ -e logs/b ] && mv logs/b '$A'/logs; true"
  bash /root/voyager-setup.sh /home/mike/voyager-stage/stage > /dev/null
  sed -i "s/^VOYAGER_MODEL=.*/VOYAGER_MODEL=$M/; s/^OLLAMA_MODEL=.*/OLLAMA_MODEL=$M/" /etc/voyager/bot-b.env
  if [ "$THINK" = true ]; then TJ=', "think": false'; else TJ=''; fi
  proxy_b "{\"url\": \"$BW\", \"model\": \"$M\", \"numCtx\": 12288, \"keepAlive\": -1, \"maxTokens\": 4096, \"perHour\": 400, \"dutyFactor\": 0, \"paused\": false, \"label\": \"$L\"$TJ}"
  [ "$THINK" = true ] || python3 - <<'EOF'
import json
p = "/etc/voyager/proxy.json"; d = json.load(open(p)); d["arms"]["b"].pop("think", None)
json.dump(d, open(p + ".new", "w"), indent=1)
EOF
  [ -f /etc/voyager/proxy.json.new ] && chown root:voyager-proxy /etc/voyager/proxy.json.new && chmod 0640 /etc/voyager/proxy.json.new && mv /etc/voyager/proxy.json.new /etc/voyager/proxy.json
  systemctl restart voyager-proxy
  systemctl start voyager-paper@b; sleep 50
  date -u +%FT%TZ > /srv/voyager/RESTARTED-b; touch /srv/voyager/RUNNING-b; rm -f /srv/voyager/STOPPED-b
  systemctl start voyager-bot@b
  date -u +%FT%TZ > "$R/stage4-$L.start"
  say "  started $L (think field: $THINK); world archived to $A" ;;
stop)
  M="$2"; L="$3"
  S=$(cat "$R/stage4-$L.start" 2>/dev/null || date -u -d '-8 hours' +%FT%TZ)
  python3 /srv/voyager/code/voyager/watch/voyager_metrics.py --since "$S" --arms b > "$R/stage4-$L.txt" 2>&1
  python3 /srv/voyager/code/voyager/watch/voyager_metrics.py --since "$S" --arms b --json > "$R/stage4-$L.json" 2>&1
  rm -f /srv/voyager/RUNNING-b
  proxy_b '{"paused": true}'
  systemctl stop voyager-bot@b voyager-paper@b
  if echo " $(resident) " | grep -q " $M "; then curl -s -m 30 "$BW/api/generate" -d "{\"model\":\"$M\",\"keep_alive\":0}" > /dev/null; say "stop $L: unloaded $M"; else say "stop $L: $M not resident (nothing sent)"; fi
  say "  resident after: [$(resident)]" ;;
esac
