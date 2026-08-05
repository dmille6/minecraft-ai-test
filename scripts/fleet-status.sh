#!/usr/bin/env bash
# fleet-status.sh -- one-shot answer to "are the bots actually doing anything?"
#
# Run from the operator's machine. Designed to be cheap enough for a
# five-minute check and specific enough to act on without a second look.
#
# Three distinct failure modes it separates, because they need different fixes:
#   DEAD     process gone            -> systemd should have restarted it
#   SILENT   alive, no decisions     -> cognitive loop stalled
#
# "Decision" counts REJECTED decisions too. Only accepted ones log "LLM ->",
# so a bot whose every choice is vetoed by admission has a perfectly healthy
# loop and used to read as SILENT. Observed live: Scout01 deciding every 55s,
# reported as 647s stale. Those are different bugs and must not share a label.
#   WEDGED   deciding, not moving    -> terrain; watchdog will teleport

set -uo pipefail
SSH="ssh -i $HOME/.ssh/id_ed25519_aiservers -o BatchMode=yes -o ConnectTimeout=8"
MC=${MC_HOST:-10.0.0.185}
BOTS=${BOT_HOST:-10.0.0.187}
ES=${ES_HOST:-10.0.0.186}
STALE_SEC=${STALE_SEC:-240}

printf '\n\033[1;36m== fleet %s\033[0m\n' "$(date -u +%H:%M:%SZ)"

# --- server ------------------------------------------------------------------
TPS=$($SSH "mike@$MC" 'sudo /srv/minecraft/shared/rcon.py "tps" 2>/dev/null' 2>/dev/null \
      | sed 's/§[0-9a-fklmnor]//g' | grep -oE '[0-9]+\.[0-9]+' | head -1)
ONLINE=$($SSH "mike@$MC" 'sudo /srv/minecraft/shared/rcon.py "list" 2>/dev/null' 2>/dev/null \
      | sed 's/§[0-9a-fklmnor]//g' | grep -oE '[A-Za-z0-9_]+[0-9]{2}' | tr '\n' ' ')
printf '   server  TPS %s · online: %s\n' "${TPS:-?}" "${ONLINE:-nobody}"

# --- per bot -----------------------------------------------------------------
printf '\n   %-10s %-8s %-11s %-9s %s\n' BOT STATE "LAST DECISION" MOVED NOTE
printf '   %s\n' "-------------------------------------------------------------------"

( $SSH "mike@$BOTS" 'bash -s' <<'REMOTE' 2>/dev/null
now=$(date +%s)
for U in $(systemctl list-units 'mcbot@*' --no-legend --plain 2>/dev/null | awk '{print $1}'); do
  INST=$(echo "$U" | sed 's/mcbot@//; s/\.service//')
  NAME=$(sudo grep -oP '(?<=^BOT_NAME=).*' /srv/mcbots/harness/env/$INST.env 2>/dev/null)
  ACT=$(systemctl is-active "$U")
  LAST=$(sudo journalctl -u "$U" --since "-20 min" -o short-unix 2>/dev/null \
         | grep -E 'LLM ->|decision rejected' | tail -1 | cut -d. -f1)
  AGE=$([ -n "$LAST" ] && echo $(( now - LAST )) || echo -1)
  RUN=$(sudo jq -r '.runs // "?"' /srv/mcbots/state/lessons-$NAME.json 2>/dev/null)
  AV=$(sudo jq -r '.avoid | length' /srv/mcbots/state/lessons-$NAME.json 2>/dev/null)
  WK=$(sudo jq -r '.worked | length' /srv/mcbots/state/lessons-$NAME.json 2>/dev/null)
  echo "$NAME|$ACT|$AGE|$RUN|$AV|$WK"
done
REMOTE
) 2>/dev/null | while IFS='|' read -r NAME ACT AGE RUN AV WK; do
  [ -z "$NAME" ] && continue
  if [ "$ACT" != "active" ]; then STATE="DEAD"; NOTE="unit $ACT"
  elif [ "$AGE" -lt 0 ]; then STATE="SILENT"; NOTE="no decision in 20m — loop stalled?"
  elif [ "$AGE" -gt "$STALE_SEC" ]; then STATE="SLOW"; NOTE="${AGE}s since last decision"
  else STATE="ok"; NOTE="run=$RUN avoid=$AV worked=$WK"
  fi
  AGES=$([ "$AGE" -lt 0 ] && echo "never" || echo "${AGE}s ago")
  printf '   %-10s %-8s %-11s %-9s %s\n' "$NAME" "$STATE" "$AGES" "" "$NOTE"
done

# --- interventions since the last check --------------------------------------
# tr: the remote grep -c can emit multiple lines, which breaks the integer test
RESC=$($SSH "mike@$MC" 'sudo journalctl -u mcai-watchdog --since "-10 min" -o cat 2>/dev/null | grep -c wedged' 2>/dev/null | awk '{n+=$1} END{print n+0}')
[ "${RESC:-0}" -gt 0 ] && printf '\n   \033[33m! %s watchdog rescue(s) in the last 10m\033[0m\n' "$RESC"

# --- is telemetry still arriving ---------------------------------------------
DOCS=$($SSH "mike@$ES" 'cd /opt/docker-elk && EP=$(sudo grep -oP "(?<=^ELASTIC_PASSWORD=).*" .env) && curl -s -u "elastic:$EP" "http://localhost:9200/mcai-skill-agents/_count?q=@timestamp:%5Bnow-10m%20TO%20now%5D" 2>/dev/null' 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('count','?'))" 2>/dev/null)
printf '\n   telemetry: %s skill docs in the last 10m\n\n' "${DOCS:-unreachable}"
