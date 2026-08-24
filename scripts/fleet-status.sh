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
BOTS=${BOT_HOST:-10.0.0.187}
ES=${ES_HOST:-10.0.0.186}
STALE_SEC=${STALE_SEC:-240}

# ASK THE BOTS WHICH SERVER THEY ARE ON. A hardcoded default here spent an
# entire session reporting "TPS 20.0 - online: nobody" from 10.0.0.185, the
# PREVIOUS Minecraft server, which is still running and permanently empty. The
# fleet had moved to a rebuilt 1.21.8 world on another host; the dashboard had
# not. Both numbers were true and neither was about this experiment.
#
# The bots cannot be wrong about where they are connected, so derive it from
# their environment and let MC_HOST override only when someone means to.
MC=${MC_HOST:-$($SSH "mike@$BOTS" \
      'sudo grep -hoP "(?<=^MINECRAFT_HOST=)[^ ]+" /srv/mcbots/harness/env/*.env 2>/dev/null | sort -u | head -1' \
      2>/dev/null)}
MC=${MC:-10.0.0.188}

printf '\n\033[1;36m== fleet %s\033[0m\n' "$(date -u +%H:%M:%SZ)"

# --- server ------------------------------------------------------------------
TPS=$($SSH "mike@$MC" 'sudo /srv/minecraft/shared/rcon.py "tps" 2>/dev/null' 2>/dev/null \
      | sed 's/§[0-9a-fklmnor]//g' | grep -oE '[0-9]+\.[0-9]+' | head -1)
ONLINE=$($SSH "mike@$MC" 'sudo /srv/minecraft/shared/rcon.py "list" 2>/dev/null' 2>/dev/null \
      | sed 's/§[0-9a-fklmnor]//g' | grep -oE '[A-Za-z0-9_]+[0-9]{2}' | tr '\n' ' ')
printf '   server  %s · TPS %s · online: %s\n' "$MC" "${TPS:-?}" "${ONLINE:-nobody}"

# --- per bot -----------------------------------------------------------------
printf '\n   %-10s %-8s %-11s %-9s %s\n' BOT STATE "LAST DECISION" MOVED NOTE
printf '   %s\n' "-------------------------------------------------------------------"

( $SSH "mike@$BOTS" 'bash -s' <<'REMOTE' 2>/dev/null
now=$(date +%s)
for U in $(systemctl list-units 'mcbot@*' --no-legend --plain 2>/dev/null | awk '{print $1}'); do
  INST=$(echo "$U" | sed 's/mcbot@//; s/\.service//')
  NAME=$(sudo grep -oP '(?<=^BOT_NAME=).*' /srv/mcbots/harness/env/$INST.env 2>/dev/null)
  # AND WHICH DIRECTORY, for exactly the same reason. The comment above says
  # "mirror the source of truth rather than guessing a name" and then guessed
  # the DIRECTORY: /srv/mcbots/state and /srv/mcbots/logs are instance #1's
  # layout and neither exists on the Block 2 host, which uses STATE_DIR and
  # LOG_DIR from the env file. So run/avoid/worked printed blank and MOVED
  # printed "?" for all forty bots for the whole of Block 2 -- and because the
  # WEDGED branch below is gated on MOVED being a number, a bot that had not
  # moved a single block in an hour reported "ok". Read both from the env.
  SDIR=$(sudo grep -oP '(?<=^STATE_DIR=).*' /srv/mcbots/harness/env/$INST.env 2>/dev/null)
  LDIR=$(sudo grep -oP '(?<=^LOG_DIR=).*' /srv/mcbots/harness/env/$INST.env 2>/dev/null)
  SDIR=${SDIR:-/var/lib/mcai/$NAME}
  LDIR=${LDIR:-/var/log/mcai/$NAME}
  ACT=$(systemctl is-active "$U")
  # LIVENESS COMES FROM THE FILE THE BOT WRITES, NOT FROM JOURNALD.
  #
  # This was three `journalctl --since` scans per bot -- 120 sequential scans of
  # a large journal for forty bots -- and under that load some of them returned
  # EMPTY, which the next line turned into AGE=-1 and the table printed as
  # "SILENT / never". A different random handful read as stalled on every run
  # while the llm-*.jsonl on disk showed 28-34 decisions each for the same
  # window. A liveness detector that answers wrongly under load is worse than
  # none: it sends you to restart working bots and it hides the ones that
  # actually stopped.
  #
  # Deciding and ACHIEVING anything are still different states -- conflating
  # them once hid a total outage where every bot reported "ok" for ten minutes
  # while every LLM request died with "This operation was aborted". A rejected
  # decision proves the loop is alive; only an admitted one proves the bot can
  # act. Both come from `llm.admission`, which is the gate's own record of which
  # door the decision came through, and is null when nothing was admitted.
  read -r LAST ADM REJ <<<"$(sudo tail -q -c 2000000 $LDIR/llm-$NAME.jsonl 2>/dev/null | python3 -c '
import sys, json, calendar, time
now = time.time()
newest, adm, rej = 0, 0, 0
for line in sys.stdin:
    try: d = json.loads(line)
    except Exception: continue
    ts = d.get("@timestamp","")
    try: t = calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception: continue
    if t > newest: newest = t
    if t < now - 600: continue
    if ((d.get("llm") or {}).get("admission")) is not None: adm += 1
    else: rej += 1
print(newest or "", adm, rej)
' 2>/dev/null)"
  AGE=$([ -n "$LAST" ] && echo $(( now - LAST )) || echo -1)
  # WHICH LESSONS FILE THIS BOT ACTUALLY USES.
  #
  # openLessons() sends MEMORY_SCOPE=shared to a single lessons-hive.json and
  # everyone else to lessons-<name>.json. This read only ever knew the second
  # form, so all three hive bots showed blank run/avoid/worked -- a dashboard
  # reporting nothing for the arm under study, indistinguishable from a bot that
  # had learned nothing. Mirror the source of truth rather than guessing a name.
  SCOPE=$(sudo grep -oP '(?<=^MEMORY_SCOPE=).*' /srv/mcbots/harness/env/$INST.env 2>/dev/null)
  # The POOL names the file since exp-001 (lessons-hive-a.json etc). Reading a
  # hardcoded 'hive' here blanked every shared bot's stats the day pools landed.
  POOL=$(sudo grep -oP '(?<=^MEMORY_POOL=).*' /srv/mcbots/harness/env/$INST.env 2>/dev/null)
  LF=$SDIR/lessons-$NAME.json
  [ "$SCOPE" = "shared" ] && LF=$SDIR/lessons-${POOL:-hive}.json
  RUN=$(sudo jq -r '.runs // "?"' "$LF" 2>/dev/null)
  AV=$(sudo jq -r '.avoid | length' "$LF" 2>/dev/null)
  WK=$(sudo jq -r '.worked | length' "$LF" 2>/dev/null)
  # DID IT ACTUALLY GO ANYWHERE, and did anything land in its pockets.
  #
  # The MOVED column was printed as an empty string from the day it was added,
  # and the WEDGED state this script's own header documents had no branch. So
  # the one dashboard for "are the bots doing anything" could not answer the
  # question in its own title, and a bot standing still for ten minutes read
  # as "ok" so long as it kept deciding.
  #
  # Displacement is measured exactly as the stagnation watchdog measures it --
  # the larger of the x and z ranges -- so the operator sees the same quantity
  # the guard acts on. Inventory change is included for the same reason it is
  # in the watchdog: a bot mining a vein legitimately holds still.
  MV=$(sudo tail -q -n 400 $LDIR/skill-$NAME.jsonl 2>/dev/null | python3 -c '
import sys, json, time
cut = time.time() - 600
xs, ys, zs, inv = [], [], [], []
for line in sys.stdin:
    try: d = json.loads(line)
    except Exception: continue
    p = ((d.get("bot") or {}).get("pos")) or {}
    ts = d.get("@timestamp","")
    if not p or not ts: continue
    try:
        t = time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception: continue
    if t < cut: continue
    xs.append(p.get("x",0)); zs.append(p.get("z",0)); ys.append(p.get("y",0))
    inv.append(sum(((d.get("bot") or {}).get("inventory") or {}).values()))
if len(xs) < 2: print("?|?")
# 3D. A control bot in Block 1 moved 6 blocks vertically and 0.00 horizontally
# while climbing a shaft, and a horizontal-only measure called it stuck.
else: print(f"{max(max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)):.0f}|{inv[-1]-inv[0]:+d}")
' 2>/dev/null)
  echo "$NAME|$ACT|$AGE|$RUN|$AV|$WK|$ADM|$REJ|${MV:-?|?}"
done
REMOTE
) 2>/dev/null | while IFS='|' read -r NAME ACT AGE RUN AV WK ADM REJ MOV GAIN; do
  [ -z "$NAME" ] && continue
  if [ "$ACT" != "active" ]; then STATE="DEAD"; NOTE="unit $ACT"
  elif [ "$AGE" -lt 0 ]; then STATE="SILENT"; NOTE="no decision in 20m — loop stalled?"
  elif [ "$AGE" -gt "$STALE_SEC" ]; then STATE="SLOW"; NOTE="${AGE}s since last decision"
  elif [ "${ADM:-0}" -eq 0 ] && [ "${REJ:-0}" -gt 0 ]; then
    # The loop is alive but nothing it proposes is being executed. This is what
    # a saturated inference endpoint looks like, and it used to read as "ok".
    STATE="VETOED"; NOTE="$REJ decisions, 0 admitted in 10m — endpoint or admission gate"
  elif [ "${MOV:-?}" != "?" ] && [ "${MOV:-9}" -lt 8 ] && [ "${GAIN:-+1}" = "+0" ]; then
    # Deciding, admitted, and achieving nothing for ten minutes. The watchdog
    # will get here on its own timescale; the operator should not have to wait
    # for it to find out.
    STATE="WEDGED"; NOTE="moved ${MOV}b, no inventory change in 10m"
  else STATE="ok"; NOTE="run=$RUN avoid=$AV worked=$WK · ${ADM:-?}ok/${REJ:-?}rej"
  fi
  AGES=$([ "$AGE" -lt 0 ] && echo "never" || echo "${AGE}s ago")
  MVS=$([ "${MOV:-?}" = "?" ] && echo "?" || echo "${MOV}b ${GAIN}")
  printf '   %-10s %-8s %-11s %-9s %s\n' "$NAME" "$STATE" "$AGES" "$MVS" "$NOTE"
done

# --- interventions since the last check --------------------------------------
# tr: the remote grep -c can emit multiple lines, which breaks the integer test
RESC=$($SSH "mike@$MC" 'sudo journalctl -u mcai-watchdog --since "-10 min" -o cat 2>/dev/null | grep -c wedged' 2>/dev/null | awk '{n+=$1} END{print n+0}')
[ "${RESC:-0}" -gt 0 ] && printf '\n   \033[33m! %s watchdog rescue(s) in the last 10m\033[0m\n' "$RESC"

# --- is telemetry still arriving ---------------------------------------------
DOCS=$($SSH "mike@$ES" 'cd /opt/docker-elk && EP=$(sudo grep -oP "(?<=^ELASTIC_PASSWORD=).*" .env) && curl -s -u "elastic:$EP" "http://localhost:9200/mcai-skill-agents/_count?q=@timestamp:%5Bnow-10m%20TO%20now%5D" 2>/dev/null' 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('count','?'))" 2>/dev/null)
printf '\n   telemetry: %s skill docs in the last 10m\n\n' "${DOCS:-unreachable}"
