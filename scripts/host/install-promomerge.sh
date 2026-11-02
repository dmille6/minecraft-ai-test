#!/bin/bash
# install-promomerge.sh -- the canary-host (10.0.0.31) half of promomerge.py, as mike. Run ON .31 from a checkout of main:
#   bash scripts/host/install-promomerge.sh
#   ~/promomerge/app    promomerge.py + lib/alarm.py: the Mac's tick runs `promomerge.py publish` here over ssh (the alarm
#                       channel /etc/mcai-alert.conf lives on this host), which writes ~/digest/promomerge-fleet.json
#   alarmhead.py        copied into the fleetstatus and W5 copies (as install-stallcheck.sh does) so the header prints the
#                       promotion-merge line; refused if an installed copy is not a version from main
# No cron line here: the Mac LaunchAgent com.mcai.promomerge drives it (scripts/mac/promomerge.sh --install).
set -euo pipefail
SRC=$(cd "$(dirname "$0")/../.." && pwd)
H=/home/mike/promomerge
mkdir -p "$H/app/scripts/host" "$H/app/scripts/lib" /home/mike/digest
python3 -B "$SRC/scripts/host/test_promomerge.py"
cp "$SRC/scripts/host/promomerge.py" "$H/app/scripts/host/promomerge.py"
cp "$SRC/scripts/lib/alarm.py" "$H/app/scripts/lib/alarm.py"
touch "$H/app/scripts/lib/__init__.py"
known=$(for c in $(git -C "$SRC" log --format=%H -- scripts/lib/alarmhead.py); do git -C "$SRC" show "$c:scripts/lib/alarmhead.py" | md5sum | cut -d' ' -f1; done)
for d in /home/mike/estel/scripts/lib /home/mike/w5alarms/scripts/lib; do
  [ -f "$d/alarmhead.py" ] || { echo "no $d/alarmhead.py -- skipped"; continue; }
  cur=$(md5sum < "$d/alarmhead.py" | cut -d' ' -f1)
  if ! grep -qx "$cur" <<< "$known"; then echo "REFUSED: $d/alarmhead.py is not a version from main (hand edit?) -- reconcile by hand"; exit 2; fi
  cp -p "$d/alarmhead.py" "$d/alarmhead.py.bak-promomerge-$(date -u +%Y%m%dT%H%MZ)"
  cp "$SRC/scripts/lib/alarmhead.py" "$d/alarmhead.py"
done
echo "installed $H/app; the Mac tick publishes to ~/digest/promomerge-fleet.json"
