#!/bin/bash
# chain-start.sh <prev_run> <next_run> <sha>=<reg.json> ... -- records the chain in ~/chains.d so resume-chains.sh can
# relaunch it after a reboot, then starts chain-after.sh exactly as before. Use this instead of calling chain-after.sh.
set -u; NEXT=${2:?next_run}
printf "%q " "$@" > /home/mike/chains.d/$NEXT.args
cd /home/mike && setsid nohup bash /home/mike/chain-after.sh "$@" </dev/null >/dev/null 2>&1 &
echo "chain recorded and started: $*"
