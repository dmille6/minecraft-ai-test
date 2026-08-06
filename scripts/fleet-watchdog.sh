#!/usr/bin/env bash
# fleet-watchdog.sh -- last-resort rescue for bots that cannot free themselves.
#
# Runs on the MINECRAFT host from a systemd timer. Deliberately EXTERNAL to the
# agent processes.
#
# Why external: a bot with no legal move cannot move itself. Every in-process
# recovery -- the stuck reflex, unstick, the runner pause, the stagnation
# watchdog's relocation and return-home -- routes through the same pathfinder
# that has no move to make. Observed live: Scout01 held the same coordinates to
# fourteen decimal places for ten minutes while all five fired in sequence.
#
# Why not give the bot op so it can teleport itself: that hands a
# model-driven process the ability to issue arbitrary server commands. The
# privilege stays out here, in deterministic code the model cannot reach.
#
# Every rescue is LOGGED AS AN INTERVENTION (_external_rescue) so analysis can
# see the bot did not free itself. A rescue that looked like self-recovery
# would quietly corrupt every conclusion drawn from the run.

set -uo pipefail

SRV=/srv/minecraft
RCON="$SRV/shared/rcon.py"
STATE=/var/lib/mcai-watchdog
LOGDIR="${LOG_DIR:-$SRV/bots/logs}"
STALL_MIN="${STALL_MIN:-12}"        # no movement for this long => wedged
MIN_MOVE="${MIN_MOVE:-6}"           # blocks; below this counts as not moving
# WHERE a rescued bot lands decides whether the rescue helps or just relocates
# the problem. 0,80,0 dropped bots above the world spawn, which sits over a cave
# system: they fell into voids at y=71-75 and ended up in cramped pockets with
# one legal move or none, where unstick failed 16 times out of 16 and a bot could
# only jump on the spot. Three deaths tonight came from that column.
#
# UPDATED 06:25Z to 28,79,0 -- the forward base. The spawn area is a crater the
# bots mined themselves into: voids at y=69-75, no wood within 16 blocks, and
# `gather` aborting stuck 23 times in 45 minutes. 24 blocks east the ground is
# INTACT (zero voids beneath the surface) and there are oak logs at 29,79,0.
# Rescuing a bot back into the crater was returning it to the problem.
#
# The previous point, 5,77,0, was a built landing pad next to the old base: solid floor at y=76 (filled
# air-only, nothing destroyed), clear headroom, 6 of 8 neighbours walkable, and
# 3 blocks from the crafting table with the chests just beyond. Landing height is
# the standing height, so there is no fall damage either.
#
# Verified before use rather than assumed -- the previous point was picked the
# same way and was wrong.
RESCUE_X="${RESCUE_X:-28}"
RESCUE_Y="${RESCUE_Y:-79}"
RESCUE_Z="${RESCUE_Z:-0}"

mkdir -p "$STATE"

now=$(date +%s)
online=$("$RCON" "list" 2>/dev/null | sed 's/§[0-9a-fklmnor]//g')
[ -z "$online" ] && { echo "watchdog: server unreachable"; exit 0; }

# Only consider our agents, not human players.
for BOT in $(echo "$online" | grep -oE '[A-Za-z0-9_]+' | grep -E '^(Scout|Miner|Gather|Builder)[0-9]+$'); do
  POS=$("$RCON" "data get entity $BOT Pos" 2>/dev/null | grep -oE '\[.*\]')
  [ -z "$POS" ] && continue
  X=$(echo "$POS" | sed 's/[][d]//g' | cut -d, -f1 | xargs printf '%.0f' 2>/dev/null || echo 0)
  Y=$(echo "$POS" | sed 's/[][d]//g' | cut -d, -f2 | xargs printf '%.0f' 2>/dev/null || echo 0)
  Z=$(echo "$POS" | sed 's/[][d]//g' | cut -d, -f3 | xargs printf '%.0f' 2>/dev/null || echo 0)

  F="$STATE/$BOT"
  if [ -f "$F" ]; then
    read -r px py pz psince prescues < "$F" 2>/dev/null || { px=$X; py=$Y; pz=$Z; psince=$now; prescues=0; }
  else
    px=$X; py=$Y; pz=$Z; psince=$now; prescues=0
  fi

  DIST=$(awk -v a="$X" -v b="$px" -v c="$Z" -v d="$pz" 'BEGIN{print int(sqrt((a-b)^2+(c-d)^2))}')
  if [ "$DIST" -ge "$MIN_MOVE" ]; then
    # It is moving. Reset the clock and the anchor.
    echo "$X $Y $Z $now $prescues" > "$F"
    continue
  fi

  STALL=$(( (now - psince) / 60 ))
  if [ "$STALL" -lt "$STALL_MIN" ]; then
    # Not moving, but not long enough yet. Keep the ORIGINAL anchor and clock.
    echo "$px $py $pz $psince $prescues" > "$F"
    continue
  fi

  # --- wedged ---------------------------------------------------------------
  prescues=$((prescues + 1))
  echo "watchdog: $BOT wedged at $X,$Y,$Z for ${STALL}m (rescue #$prescues)"
  "$RCON" "tp $BOT $RESCUE_X $RESCUE_Y $RESCUE_Z" >/dev/null 2>&1

  # Record it as an intervention in the same strict-mapped index the agents
  # write to, so it appears in analysis as something DONE TO the bot.
  python3 - "$LOGDIR" "$BOT" "$X" "$Y" "$Z" "$STALL" "$prescues" <<'PY' 2>/dev/null
import json, sys, os, datetime
logdir, bot, x, y, z, stall, n = sys.argv[1:8]
rec = {
    "@timestamp": datetime.datetime.now(datetime.timezone.utc)
                    .isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "run_id": os.environ.get("RUN_ID", "team-001"),
    "trigger": "reflex",
    "code": {"version": "watchdog", "config_hash": "external"},
    "bot": {"name": bot, "role": "unknown",
            "pos": {"x": float(x), "y": float(y), "z": float(z)}},
    "game": {},
    "skill": {
        "name": "_external_rescue", "args": {}, "status": "failed",
        "duration_ms": int(stall) * 60000,
        "detail": f"wedged {stall}m at {x},{y},{z}; teleported by external watchdog (rescue #{n})",
        "fail_class": "wedged",
    },
}
with open(os.path.join(logdir, f"skill-{bot}.jsonl"), "a") as f:
    f.write(json.dumps(rec) + "\n")
PY

  # A bot rescued repeatedly is not merely stuck -- its process is likely in a
  # bad state. This USED to restart the unit locally, which was correct when the
  # agents ran on this host and became actively destructive once they moved to
  # the dedicated bot host.
  #
  # What it did after the migration: `systemctl restart mcbot@miner` here started
  # a SECOND Miner01 alongside the real one on the bot host. Two clients sharing
  # a username kick each other forever, the kicked bot reconnects and kicks back,
  # and the resulting churn wedges bots -- which triggers more rescues, which on
  # the third one starts another duplicate. A self-sustaining loop, in the very
  # script meant to rescue the fleet.
  #
  # Measured: 6 such restarts in 4 hours, three separate outbreaks of duplicate
  # bots, and it was the true cause of behaviour I spent hours attributing to the
  # agents themselves.
  #
  # This script runs on the Minecraft host and has no authority over processes on
  # the bot host. It should not pretend otherwise. Escalation is now REPORTED --
  # the bot host's own systemd and the cognitive liveness check own process
  # recovery, and a human or the fleet-status check can act on the signal.
  if [ "$prescues" -ge 3 ]; then
    echo "watchdog: $BOT rescued $prescues times and is not recovering -- process restart needed on the BOT HOST (not here)"
    prescues=0
  fi

  echo "$RESCUE_X $RESCUE_Y $RESCUE_Z $now $prescues" > "$F"
done
