#!/bin/bash
# voyager-01: THE BLACKWELL GUARD. Runs on the Mac controller for as long as arms use the Blackwell (it is another
# project's box: owner 10-31 "testing only"). Once a minute blackwell_probe.py times a tiny request to one of THEIR pinned
# models; when their latency stays over the limit the arms are paused at the proxy for 15 minutes, then resumed, and the
# watch goes on. Owner 11-10 ("yes thats okay"): up to 1.5 x the 73 ms baseline is acceptable; 3 minutes in a row over it
# trips. This is the script that ran for the stage 3b qwen arms from 11-10 18:15Z (it lived only in a session scratchpad).
#
#   bw-guard.sh <state-dir> <arm,arm,...> [baseline-p95-ms]
#
# <state-dir> holds bw-guard.out (probe rows), bw-guard.trips (PAUSED / RESUMED lines) and bw-guard.stop: create that file
# to end the guard. A guard that dies while the arms are paused leaves them paused: check bw-guard.trips ends in RESUMED.
set -u
S="${1:?state dir}"; ARMS="${2:?arms, comma separated}"; BASE="${3:-73}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$S"
case "$ARMS" in *[!a-z0-9,]*) echo "arms must be names separated by commas" >&2; exit 2 ;; esac
setp () {  # True|False
  ssh -o BatchMode=yes mike@10.0.0.30 "sudo python3 -c \"
import json
p='/etc/voyager/proxy.json'; d=json.load(open(p)); [d['arms'][a].update(paused=$1) for a in '$ARMS'.split(',') if a in d['arms']]; json.dump(d, open(p+'.new','w'), indent=1)\" && sudo chown root:voyager-proxy /etc/voyager/proxy.json.new && sudo chmod 0640 /etc/voyager/proxy.json.new && sudo mv /etc/voyager/proxy.json.new /etc/voyager/proxy.json"
}
while [ ! -f "$S/bw-guard.stop" ]; do
  python3 "$HERE/blackwell_probe.py" during --minutes 6000 --baseline-p95 "$BASE" --factor 1.5 --consecutive 3 >> "$S/bw-guard.out" 2>&1
  rc=$?
  [ -f "$S/bw-guard.stop" ] && break
  if [ $rc -eq 3 ]; then
    setp True; echo "$(date -u +%FT%TZ) PAUSED $ARMS: $(tail -1 "$S/bw-guard.out")" >> "$S/bw-guard.trips"
    sleep 900; setp False; echo "$(date -u +%FT%TZ) RESUMED $ARMS" >> "$S/bw-guard.trips"
  else sleep 60; fi
done
