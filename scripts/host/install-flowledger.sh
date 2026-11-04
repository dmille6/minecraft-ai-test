#!/bin/bash
# install-flowledger.sh -- install the hourly flow ledger (flowledger-01, resource-model-1102 s.9) on the canary host
# (10.0.0.31), as mike. Run ON 10.0.0.31 from a checkout of main:  bash scripts/host/install-flowledger.sh
#   ~/flowledger/app   flowledger.py + flowstock.mjs + lib/alarm.py + lib/telemetry.py (main's copy; the walk no longer
#                      loads the live fleet tree's, which every deploy resets; the journal fold still uses its
#                      bots/src/cobblecap.mjs)
#   ~/flowledger/out   latest.json, history.jsonl (72 h), alarm-state.json
#   ~/digest/flowledger.log   one line a run: the fleetstatus header prints the newest (alarmhead MONITOR_LOGS)
#   alarmhead.py       copied into the fleetstatus and W5 copies (~/estel/scripts/lib, ~/w5alarms/scripts/lib) so the header
#                      prints 'flow ledger: ...'; refused if an installed copy is not a version from main
#   cron               hourly at :05, nice 19 (a 6 h walk: ~45 s, ~3.3 GB RSS measured 11-02 on this host)
set -euo pipefail
SRC=$(cd "$(dirname "$0")/../.." && pwd)
H=/home/mike/flowledger
mkdir -p "$H/app/scripts/host" "$H/app/scripts/lib" "$H/out" /home/mike/digest
python3 -B "$SRC/scripts/host/test_flowledger.py"
python3 -B "$SRC/scripts/test_telemetry_walk_cap.py"
cp "$SRC/scripts/host/flowledger.py" "$SRC/scripts/host/flowstock.mjs" "$H/app/scripts/host/"
cp "$SRC/scripts/lib/alarm.py" "$H/app/scripts/lib/alarm.py"
cp "$SRC/scripts/lib/telemetry.py" "$H/app/scripts/lib/telemetry.py"
touch "$H/app/scripts/lib/__init__.py"
known=$(for c in $(git -C "$SRC" log --format=%H -- scripts/lib/alarmhead.py); do git -C "$SRC" show "$c:scripts/lib/alarmhead.py" | md5sum | cut -d' ' -f1; done)
for d in /home/mike/estel/scripts/lib /home/mike/w5alarms/scripts/lib; do
  [ -f "$d/alarmhead.py" ] || { echo "no $d/alarmhead.py -- skipped"; continue; }
  cur=$(md5sum < "$d/alarmhead.py" | cut -d' ' -f1)
  if ! grep -qx "$cur" <<< "$known"; then echo "REFUSED: $d/alarmhead.py is not a version from main (hand edit?) -- reconcile by hand"; exit 2; fi
  cp -p "$d/alarmhead.py" "$d/alarmhead.py.bak-flowledger-$(date -u +%Y%m%dT%H%MZ)"
  cp "$SRC/scripts/lib/alarmhead.py" "$d/alarmhead.py"
done
LINE='5 * * * * cd /home/mike/flowledger/app/scripts && /usr/bin/nice -n 19 /usr/bin/python3 -B host/flowledger.py run >> /home/mike/flowledger/out/cron.log 2>&1 # flowledger'
crontab -l > "$H/crontab.bak-$(date -u +%Y%m%dT%H%MZ)"
if ! crontab -l | grep -qF 'host/flowledger.py run'; then (crontab -l; echo "$LINE") | crontab -; fi
crontab -l | grep -F 'host/flowledger.py run'
echo "installed; first run: cd $H/app/scripts && python3 -B host/flowledger.py run --print"
