#!/usr/bin/env bash
# ON THE SHOWCASE VM, root cron (hourly :35): the showcase tripwire read; on VERDICT TRIP it stops the bots.
# docs/reports/showcase-progress-lane-2026-10-25.md section 4 step 5. Stopping is always safe (the world, the plan files and
# the logs stay); the operator reads /srv/showcase/ops/trip.log and decides what comes back.
#   35 * * * * /srv/showcase/trip/trip-cron.sh
#   0 5 * * *  /srv/showcase/trip/trip-cron.sh --far      (every zone against the 04:15Z nightly stage)
set -uo pipefail
T=/srv/showcase/trip
LOG=/srv/showcase/ops/trip.log
running=$(systemctl list-units 'mcshow@*' --state=active --no-legend --plain | wc -l)
if [ "$running" -eq 0 ]; then
  echo "$(date -u +%FT%TZ) no showcase bot running: no read" >> "$LOG"; exit 0
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
# read: rc 2 AND its VERDICT TRIP line (argparse also exits 2); zones-compare: 3 = BREACH. Anything else (a crash) is logged, never a stop on its own.
if { [ "${1:-}" != "--far" ] && [ $rc -eq 2 ] && printf '%s\n' "$out" | grep -q '^VERDICT *TRIP'; } || { [ "${1:-}" = "--far" ] && [ $rc -eq 3 ]; }; then
  /srv/showcase/bin/stop-bots.sh "tripwire: $why" >> "$LOG" 2>&1
fi
