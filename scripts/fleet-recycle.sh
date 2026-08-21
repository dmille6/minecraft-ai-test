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

echo "$(date -Is) fleet recycle starting"
for f in "$ENVDIR"/*.env; do
  B=$(basename "$f" .env)
  RSS=$(awk '/VmRSS/{print $2}' "/proc/$(systemctl show "mcbot@$B" -p MainPID --value)/status" 2>/dev/null)
  systemctl restart "mcbot@$B"
  echo "  $B restarted (was ${RSS:-?} kB)"
  sleep "$STAGGER"
done
echo "$(date -Is) fleet recycle complete"
