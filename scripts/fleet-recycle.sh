#!/usr/bin/env bash
# Restart every bot on a fixed schedule, staggered, ALL ARMS ALIKE.
#
# WHY A SCHEDULED RECYCLE BEATS LETTING OOM DECIDE.
#
# Bot memory grows with runtime -- measured at 2.3h: hive 401MB, isolated 367MB,
# placebo 360MB, board 349MB against a 1GB cgroup ceiling. The growth is NOT the
# chunk world model (held columns stay flat at 329 while arrayBuffers climb from
# 20MB to 219MB), so it is not yet fixed at source.
#
# MemoryMax + Restart=always already contains it. But if bots are left to hit the
# ceiling on their own, the arm with the most memory content reaches it FIRST and
# gets restarted MORE OFTEN -- and a treatment arm being perturbed more than the
# others is precisely the confound this design exists to prevent. hive is
# consistently the highest.
#
# A fixed schedule converts an arm-asymmetric random failure into a uniform,
# declared, logged intervention that every arm receives identically. The
# pre-registration already provides for interventions at parity across arms.
#
# What a restart costs: WorkingMemory (in-process, deliberately not persisted).
# What it keeps: the lessons store in STATE_DIR -- which IS the memory under
# study. So the treatment survives the recycle; only the scratchpad does not.
set -u
STAGGER="${STAGGER:-6}"
ENVDIR=/srv/mcbots/harness/env

# A RECYCLE DESTROYS A CANARY, SILENTLY, AND DID.
#
# 2026-08-25: a canary put pool hive-a on 34892cc while 75 bots stayed on
# 78ab136. This timer fired at 13:18, restarted all eighty, and every one of
# them came back on whatever was in $H/src -- the canary build. The env labels
# did not move, so the fleet reported
#
#     75 x 78ab136+ab359c        <- old label, NEW code
#      5 x 34892cc+ab359c
#
# All eighty running identical code, and a canary report comparing hive-a
# against "control" was comparing the build against itself. It read 34% versus
# 28% and meant nothing.
#
# The restart itself is correct and stays: memory grows with runtime and an
# unscheduled OOM restart is arm-asymmetric, which is a worse confound. What was
# missing is that the recycle had no idea a canary existed.
#
# So: if the manifest declares one, refuse. A skipped recycle costs some memory
# headroom for a few hours; a silently dissolved canary costs the experiment.
MANIFEST=/srv/mcbots/trial-manifest.json
if [ -f "$MANIFEST" ] && grep -q '"canary_pool": *"[^"]\+"' "$MANIFEST" 2>/dev/null; then
  POOL=$(grep -o '"canary_pool": *"[^"]*"' "$MANIFEST" | sed 's/.*: *"//;s/"//')
  echo "$(date -Is) fleet recycle SKIPPED: a canary is declared on pool '$POOL'."
  echo "  Restarting now would put every bot on the canary source while leaving"
  echo "  the control labels untouched, which dissolves the split without saying so."
  echo "  Clear canary_pool in $MANIFEST (a fleet-wide deploy does this) to re-enable."
  exit 0
fi

echo "$(date -Is) fleet recycle starting"
for f in "$ENVDIR"/*.env; do
  B=$(basename "$f" .env)
  RSS=$(awk '/VmRSS/{print $2}' "/proc/$(systemctl show "mcbot@$B" -p MainPID --value)/status" 2>/dev/null)
  systemctl restart "mcbot@$B"
  echo "  $B restarted (was ${RSS:-?} kB)"
  sleep "$STAGGER"
done
echo "$(date -Is) fleet recycle complete"
