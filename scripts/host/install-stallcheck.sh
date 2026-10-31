#!/bin/bash
# install-stallcheck.sh -- install the hourly owner-commitments stall check on the canary host (10.0.0.31), as mike.
# Run ON 10.0.0.31 from a checkout of main:  bash scripts/host/install-stallcheck.sh
#   ~/stallcheck/repo   a private https clone; stallcheck.py fetches it every run and reads the ledger + monitor registry
#                       from origin/main there (a row added on main is seen within the hour, no reinstall)
#   ~/stallcheck/app    the installed code (stallcheck.py + lib/alarm.py); reinstall to change the code
#   alarmhead.py        copied into the fleetstatus and W5 copies (~/estel/scripts/lib, ~/w5alarms/scripts/lib) so the
#                       fleetstatus header prints '!! STALLED ...'; refused if an installed copy is not a version from main
#   cron                one line, hourly at :35 (after goalwatch's :30 and the sched tick); it reads canary-sched.py
#                       through import only and is never wrapped in a lock around the scheduler
set -euo pipefail
SRC=$(cd "$(dirname "$0")/../.." && pwd)
H=/home/mike/stallcheck
mkdir -p "$H/app/scripts/host" "$H/app/scripts/lib" /home/mike/digest
[ -d "$H/repo/.git" ] || git clone -q https://github.com/dmille6/minecraft-ai-test.git "$H/repo"
git -C "$H/repo" fetch -q --prune origin
python3 -B "$SRC/scripts/host/test_stallcheck.py"
cp "$SRC/scripts/host/stallcheck.py" "$H/app/scripts/host/stallcheck.py"
cp "$SRC/scripts/lib/alarm.py" "$H/app/scripts/lib/alarm.py"
touch "$H/app/scripts/lib/__init__.py"
known=$(for c in $(git -C "$SRC" log --format=%H -- scripts/lib/alarmhead.py); do git -C "$SRC" show "$c:scripts/lib/alarmhead.py" | md5sum | cut -d' ' -f1; done)
for d in /home/mike/estel/scripts/lib /home/mike/w5alarms/scripts/lib; do
  [ -f "$d/alarmhead.py" ] || { echo "no $d/alarmhead.py -- skipped"; continue; }
  cur=$(md5sum < "$d/alarmhead.py" | cut -d' ' -f1)
  if ! grep -qx "$cur" <<< "$known"; then echo "REFUSED: $d/alarmhead.py is not a version from main (hand edit?) -- reconcile by hand"; exit 2; fi
  cp -p "$d/alarmhead.py" "$d/alarmhead.py.bak-stallcheck-$(date -u +%Y%m%dT%H%MZ)"
  cp "$SRC/scripts/lib/alarmhead.py" "$d/alarmhead.py"
done
LINE='35 * * * * cd /home/mike/stallcheck/app/scripts && /usr/bin/nice -n 10 /usr/bin/python3 -B host/stallcheck.py run >> /home/mike/digest/stallcheck.log 2>&1 # stallcheck'
crontab -l > "$H/crontab.bak-$(date -u +%Y%m%dT%H%MZ)"
if ! crontab -l | grep -qF 'host/stallcheck.py run'; then (crontab -l; echo "$LINE") | crontab -; fi
crontab -l | grep -F 'host/stallcheck.py run'
echo "installed; first run: cd $H/app/scripts && python3 -B host/stallcheck.py run --no-push --print"
