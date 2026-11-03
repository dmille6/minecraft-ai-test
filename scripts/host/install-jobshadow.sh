#!/bin/bash
# install-jobshadow.sh -- install the job assigner's SHADOW (jobshadow-01, docs/reports/job-assigner-2026-11-03.md stage 1) on the
# canary host (10.0.0.31), as mike. Run ON 10.0.0.31 from a checkout of main:  bash scripts/host/install-jobshadow.sh
#   ~/jobshadow/app   jobshadow.py + jobfacts.mjs + lib/jobrules.py (the telemetry walk loads the LIVE fleet tree's
#                     /opt/minecraft-ai/scripts/lib/telemetry.py by path; jobfacts.mjs imports the fleet tree's bots/src modules)
#   ~/jobshadow/out   ticks-<day>.jsonl (tick + eval rows), state.json, latest.json, summary.json (the `summary` command)
#   ~/digest/jobshadow.log   one line a run (monitors.json `jobshadow`)
#   cron              every 10 min at :02, nice 19 (a 70-min walk: ~15 s, ~0.7 GB RSS measured 11-03 on this host)
# SHADOW ONLY: nothing is written into /var/lib/mcai and no bot reads anything this writes. Uninstall: remove the cron line.
set -euo pipefail
SRC=$(cd "$(dirname "$0")/../.." && pwd)
H=/home/mike/jobshadow
mkdir -p "$H/app/scripts/host" "$H/app/scripts/lib" "$H/out" /home/mike/digest
python3 -B "$SRC/scripts/host/test_jobshadow.py"
cp "$SRC/scripts/host/jobshadow.py" "$SRC/scripts/host/jobfacts.mjs" "$H/app/scripts/host/"
cp "$SRC/scripts/lib/jobrules.py" "$H/app/scripts/lib/jobrules.py"
git -C "$SRC" rev-parse HEAD > "$H/app/INSTALLED_FROM"
LINE='2-59/10 * * * * cd /home/mike/jobshadow/app/scripts && /usr/bin/flock -n /home/mike/jobshadow/run.lock /usr/bin/nice -n 19 /usr/bin/python3 -B host/jobshadow.py run >> /home/mike/jobshadow/out/cron.log 2>&1 # jobshadow'
crontab -l > "$H/crontab.bak-$(date -u +%Y%m%dT%H%MZ)"
if ! crontab -l | grep -qF 'host/jobshadow.py run'; then (crontab -l; echo "$LINE") | crontab -; fi
crontab -l | grep -F 'host/jobshadow.py run'
echo "installed from $(cat "$H/app/INSTALLED_FROM"); first run: cd $H/app/scripts && python3 -B host/jobshadow.py run --print"
