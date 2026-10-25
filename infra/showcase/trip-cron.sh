#!/usr/bin/env bash
# ON THE SHOWCASE VM, root cron (hourly :35): the showcase tripwire read; on VERDICT TRIP it stops the bots.
# docs/reports/showcase-progress-lane-2026-10-25.md section 4 step 5. Stopping is always safe (the world, the plan files and
# the logs stay); the operator reads /srv/showcase/ops/trip.log and decides what comes back.
#   35 * * * * /srv/showcase/trip/trip-cron.sh
#   0 5 * * *  /srv/showcase/trip/trip-cron.sh --far      (every zone against the 04:15Z nightly stage)
set -uo pipefail
T=/srv/showcase/trip
LOG=/srv/showcase/ops/trip.log
# Skip only when NO bot unit is ENABLED (intentional downtime: stop-bots.sh disables them). Ten crash-looping units are enabled
# but not active, and must still be read (re-review 10-25, Claude P3).
enabled=0
for n in Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno; do
  systemctl is-enabled --quiet "mcshow@showcase-$n" 2>/dev/null && enabled=$((enabled + 1))
done
if [ "$enabled" -eq 0 ]; then
  echo "$(date -u +%FT%TZ) no showcase bot enabled: no read" >> "$LOG"; exit 0
fi
if [ "${1:-}" = "--far" ]; then
  out=$(nice -n 19 python3 $T/showcase_trip.py zones-compare --regions /srv/showcase/backup-stage/showcase/world/region \
        --baseline $T/zones-baseline.json 2>&1); rc=$?
  why="far zones BREACH"
else
  out=$(nice -n 19 python3 $T/showcase_trip.py read --minutes 180 --json /srv/showcase/ops/trip-last.json 2>&1); rc=$?
  why=$(printf '%s\n' "$out" | grep '^VERDICT' | head -1 | cut -c1-300)
fi
{ echo "===== $(date -u +%FT%TZ) rc=$rc"; printf '%s\n' "$out"; } >> "$LOG"
# read: rc 2 AND its VERDICT TRIP line (argparse also exits 2); zones-compare: 3 = BREACH, 4 = blind or stale (WATCH, logged). Anything else (a crash) is logged, never a stop on its own.
if { [ "${1:-}" != "--far" ] && [ $rc -eq 2 ] && printf '%s\n' "$out" | grep -q '^VERDICT *TRIP'; } || { [ "${1:-}" = "--far" ] && [ $rc -eq 3 ]; }; then
  /srv/showcase/bin/stop-bots.sh "tripwire: $why" >> "$LOG" 2>&1
fi
