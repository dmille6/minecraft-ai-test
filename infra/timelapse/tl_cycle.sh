#!/usr/bin/env bash
# One timelapse cycle: snapshot every configured site, then render + frame the new snapshots.
# Cron (every 2 h at :07):  7 */2 * * * /home/mike/bluemap-tl/bin/tl_cycle.sh
# flock: a slow cycle is skipped, never stacked.
set -uo pipefail
TL=${TL_HOME:-$HOME/bluemap-tl}
LOG=/var/tmp/timelapse/logs/cycle.log
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
exec 9>"$TL/logs/cycle.lock"
if ! flock -n 9; then echo "$(date -u +%FT%TZ) cycle SKIP: previous cycle still running"; exit 0; fi
echo "$(date -u +%FT%TZ) cycle start"
python3 "$TL/bin/tl.py" snapshot
src=$?
if [ $src -eq 2 ]; then echo "$(date -u +%FT%TZ) cycle STOP: disk guard"; exit 2; fi
python3 "$TL/bin/tl.py" frame
frc=$?
echo "$(date -u +%FT%TZ) cycle end snapshot_rc=$src frame_rc=$frc"
