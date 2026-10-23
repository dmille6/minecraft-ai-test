#!/bin/bash
# lavastep-01 PAPER, paired runs on ONE sandbox server (2026-10-23, with driver r7).
#   sandbox/lavastep/paired.sh <server> <outdir> <baseSlot 0|1> <baseRoot> <candRoot> <scene:bag:yaw:trials> ...
# For each job the BASE build and the CANDIDATE build run SIDE BY SIDE on the same server (base in <baseSlot>, candidate in
# the other; the caller counterbalances slots across servers), then the next job.
# r5 (driver review r4, Codex P2s): this script no longer touches the server. The join safeguard (adventure default,
# confirmed before each launch, restored by the last driver out in a section fenced on the worlds host) is the DRIVER's, so a
# standalone driver is as safe as a paired one. This script only pairs and waits for EACH driver by pid. When a driver
# exits non-zero (a failed cleanup is exit 3), the CURRENT pair is allowed to finish (its sibling is not killed: it is
# mid-trial and cleans up itself), and then the queue stops; the exit status is the base driver's if it failed, else the
# candidate's. The lock is re-checked (a bounded SSH probe) before every job.
set -u
server=$1; out=$2; bslot=$3; broot=$4; croot=$5; shift 5
case "$server" in sandbox|sandbox2|sandbox3|sandbox5|sandbox6|sandbox7|sandbox8) ;; *) echo "sandbox servers only (not sandbox4)"; exit 2 ;; esac
case "$bslot" in 0|1) ;; *) echo "baseSlot: 0 or 1"; exit 2 ;; esac
cslot=$((1 - bslot))
here=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$out"
node -e "require('$here/sandbox/lib/sbxlock.cjs').requireSandboxLock('$server','lavastep')" || exit 2
pids=()
# (bash 3.2 under set -u: an empty array must be expanded with the ${a[@]+...} form)
trap 'kill -TERM ${pids[@]+"${pids[@]}"} 2>/dev/null; for p in ${pids[@]+"${pids[@]}"}; do wait "$p" 2>/dev/null; done; exit 1' TERM INT HUP
cd "$here" || exit 2
for job in "$@"; do
  IFS=: read -r scene bag yawm trials <<< "$job"
  node -e "require('$here/sandbox/lib/sbxlock.cjs').requireSandboxLock('$server','lavastep')" || exit 2
  sfx=""; [ "$bag" = none ] && sfx="n"; [ "$yawm" = cycle ] && sfx="${sfx}c"
  echo "=== $(date -u +%FT%TZ) $server $scene $bag $yawm $trials (base slot $bslot)"
  LS_OUT="$out" LS_BAG="$bag" LS_YAW="$yawm" LS_SLOT="$bslot" node sandbox/lavastep/lavastep-e2e.mjs "$broot" "base$sfx" "$scene" "$server" "$trials" 20 > "$out/q-$server-base$sfx-$scene.log" 2>&1 &
  pb=$!
  LS_OUT="$out" LS_BAG="$bag" LS_YAW="$yawm" LS_SLOT="$cslot" node sandbox/lavastep/lavastep-e2e.mjs "$croot" "cand$sfx" "$scene" "$server" "$trials" 20 > "$out/q-$server-cand$sfx-$scene.log" 2>&1 &
  pc=$!
  pids=("$pb" "$pc")
  wait "$pb"; rb=$?
  wait "$pc"; rcand=$?
  pids=()
  grep -h -E "SUMMARY|FATAL|cleanup (FAILED|INCOMPLETE)|STOP|SSH master" "$out/q-$server-base$sfx-$scene.log" "$out/q-$server-cand$sfx-$scene.log" | cut -c1-400
  if [ "$rb" -ne 0 ] || [ "$rcand" -ne 0 ]; then
    echo "=== $(date -u +%FT%TZ) $server STOPPED: base driver exit $rb, candidate driver exit $rcand"
    [ "$rb" -ne 0 ] && exit "$rb"
    exit "$rcand"
  fi
done
echo "=== $(date -u +%FT%TZ) $server DONE"
