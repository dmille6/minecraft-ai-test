#!/bin/bash
# servea-check.sh <alias> <rate_per_min> <n> <offset> -- the servea waiter's preflight load check, on the canary host.
# The bots' own client through the oai+ path (batchload.mjs api=native) against the 5080 llama-server, promptcache-layout
# live prompts (~/servea/live-pc.jsonl), open loop. Beside it the LIVE-FLEET GUARD (modelrollout.live_guard, the owner's
# stop: the 5080-served fleet's p95 > 5 s for 2 min, or the guard blind twice) kills the load by ITS pid.
# Prints the guard's verdict line, then stats.py's line. Changes nothing but its own output files.
set -u
A=${1:?alias}; RATE=${2:?rate}; N=${3:?n}; OFF=${4:-0}
cd "$HOME/servea" || exit 2
echo "$A" | grep -Eq '^[A-Za-z0-9._-]+$' || { echo "bad alias"; exit 2; }
node batchload.mjs "$HOME/servea/bots" "$HOME/servea/live-pc.jsonl" out/waiter-check.jsonl http://10.0.0.72:18080 "$A" open "$RATE" "$N" "$OFF" native > out/waiter-check.log 2>&1 &
BL=$!
python3 - "$BL" <<'PY'
import os, sys, time
sys.path.insert(0, os.path.expanduser('~/servea-rollout'))
import modelrollout as R
pid, st = int(sys.argv[1]), {}
while True:
    time.sleep(R.GUARD_EVERY_S)
    try:
        os.kill(pid, 0)
    except OSError:
        print('GUARD OK'); break
    st, why = R.live_guard(st, R.live_fleet('10.0.0.72'))
    if why:
        os.kill(pid, 15); print('GUARD STOP ' + why); break
PY
wait "$BL"
python3 stats.py out/waiter-check.jsonl
