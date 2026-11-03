#!/bin/bash
# install-effectwatch.sh -- install effectwatch-01 (OWNER 11-03 items 1 + 6: post-promotion EFFECT reads + fleet busy time)
# on the canary host (10.0.0.31), as mike. Run ON 10.0.0.31 from a checkout of main:  bash scripts/host/install-effectwatch.sh
#   ~/effectwatch/app    effectcache.py + effectwatch.py + lib/{telemetry,busytime,effectmetrics,alarm}.py + config/effect-targets.json
#                        (its OWN telemetry.py copy: stream_rows is new; the fleet tree's copy is left alone)
#   ~/effectwatch/cache  one gzip JSON per finished hour (cells per bot, hour, build); ~1 MB/h; kept 21 days
#   ~/digest/effect*     verdicts (write-once), the header state files, effect-latest.md, the pending ledger rows
#   alarmhead.py         copied into the fleetstatus and W5 copies (refused if an installed copy is not a version from main)
#   cron                 :12 hourly effectcache (fills every missing final hour of the last 2 days; nice 19, ~1 min/h of
#                        rows, ~60 MB RSS), then effectwatch run; never touches the queue or the scheduler
set -euo pipefail
SRC=$(cd "$(dirname "$0")/../.." && pwd)
H=/home/mike/effectwatch
mkdir -p "$H/app/scripts/host" "$H/app/scripts/lib" "$H/app/config" "$H/cache" /home/mike/digest
python3 -B "$SRC/scripts/host/test_effectwatch.py"
TS=$(date -u +%Y%m%dT%H%MZ)
[ -d "$H/app/scripts" ] && tar -C "$H" -czf "$H/app.bak-$TS.tgz" app 2>/dev/null || true
cp "$SRC/scripts/host/effectcache.py" "$SRC/scripts/host/effectwatch.py" "$H/app/scripts/host/"
cp "$SRC/scripts/lib/telemetry.py" "$SRC/scripts/lib/busytime.py" "$SRC/scripts/lib/effectmetrics.py" "$SRC/scripts/lib/alarm.py" "$H/app/scripts/lib/"
cp "$SRC/config/effect-targets.json" "$H/app/config/"
touch "$H/app/scripts/lib/__init__.py"
# scoreboard's busy-time line loads lib/busytime.py beside its own scripts/ dir
for d in /home/mike/estel/scripts/lib; do [ -d "$d" ] && cp "$SRC/scripts/lib/busytime.py" "$d/busytime.py"; done
known=$(for c in $(git -C "$SRC" log --format=%H -- scripts/lib/alarmhead.py); do git -C "$SRC" show "$c:scripts/lib/alarmhead.py" | md5sum | cut -d' ' -f1; done)
for d in /home/mike/estel/scripts/lib /home/mike/w5alarms/scripts/lib; do
  [ -f "$d/alarmhead.py" ] || { echo "no $d/alarmhead.py -- skipped"; continue; }
  cur=$(md5sum < "$d/alarmhead.py" | cut -d' ' -f1)
  if ! grep -qx "$cur" <<< "$known"; then echo "REFUSED: $d/alarmhead.py is not a version from main (hand edit?) -- reconcile by hand"; exit 2; fi
  cp -p "$d/alarmhead.py" "$d/alarmhead.py.bak-effectwatch-$TS"
  cp "$SRC/scripts/lib/alarmhead.py" "$d/alarmhead.py"
done
LINE='12 * * * * cd /home/mike/effectwatch/app/scripts && /usr/bin/nice -n 19 /usr/bin/python3 -B host/effectcache.py build >> /home/mike/effectwatch/cron.log 2>&1 && /usr/bin/nice -n 19 /usr/bin/python3 -B host/effectwatch.py run >> /home/mike/effectwatch/cron.log 2>&1; find /home/mike/effectwatch/cache -name "*.json.gz" -mtime +21 -delete # effectwatch'
crontab -l > "$H/crontab.bak-$TS"
if ! crontab -l | grep -qF 'host/effectwatch.py run'; then (crontab -l; echo "$LINE") | crontab -; fi
crontab -l | grep -F 'host/effectwatch.py run'
echo "installed; first run: cd $H/app/scripts && python3 -B host/effectwatch.py run --print --no-push"
