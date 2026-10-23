#!/bin/bash
# lavastep-01 PAPER, paired runs on ONE sandbox server (2026-10-23, with driver r4).
#   sandbox/lavastep/paired.sh <server> <outdir> <baseSlot 0|1> <baseRoot> <candRoot> <scene:bag:yaw:trials> ...
# For each job the BASE build and the CANDIDATE build run SIDE BY SIDE on the same server (base in <baseSlot>, candidate in
# the other; the caller counterbalances slots across servers), then the next job.
# This script OWNS the server's default game mode for the run: `defaultgamemode adventure` is set while none of the
# driver's bots is online (so every new trial bot joins unable to break or place anything until the driver has it inside
# its barrier box -- the driver reads that mode back and refuses a trial otherwise), and `defaultgamemode survival` is
# restored after each pair has exited, and on any exit of this script. The lock check is the driver's
# (sbx.requireSandboxLock(SERVER,'lavastep')), and it is repeated here before the first change.
set -u
server=$1; out=$2; bslot=$3; broot=$4; croot=$5; shift 5
case "$server" in sandbox|sandbox2|sandbox3|sandbox5|sandbox6|sandbox7|sandbox8) ;; *) echo "sandbox servers only (not sandbox4)"; exit 2 ;; esac
case "$bslot" in 0|1) ;; *) echo "baseSlot: 0 or 1"; exit 2 ;; esac
cslot=$((1 - bslot))
here=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$out"
node -e "require('$here/sandbox/lib/sbxlock.cjs').requireSandboxLock('$server','lavastep')" || exit 2
rc() { printf '%s\n' "$@" | ssh -o BatchMode=yes mike@10.0.0.30 "python3 /tmp/sbx-rcon.py $server -"; }
mode() {   # mode adventure|survival : set the default and check the reply
  local want=$1 cap; cap="$(tr '[:lower:]' '[:upper:]' <<< "${want:0:1}")${want:1}"
  rc "defaultgamemode $want" | grep -q "The default game mode is now $cap Mode" || { echo "defaultgamemode $want: not confirmed"; return 1; }
}
nobots() { ! rc list | grep -Eq '(: |, )ls'; }
restore() { for t in 1 2 3; do mode survival && return 0; sleep 2; done; echo "RESTORE FAILED: defaultgamemode survival on $server"; return 1; }
trap 'restore' EXIT
trap 'kill $(jobs -p) 2>/dev/null; wait; exit 1' TERM INT HUP
cd "$here" || exit 2
for job in "$@"; do
  IFS=: read -r scene bag yawm trials <<< "$job"
  sfx=""; [ "$bag" = none ] && sfx="n"; [ "$yawm" = cycle ] && sfx="${sfx}c"
  for w in $(seq 1 30); do nobots && break; sleep 2; done
  nobots || { echo "bots still online on $server; stopping"; exit 3; }
  mode adventure || exit 3
  echo "=== $(date -u +%FT%TZ) $server $scene $bag $yawm $trials (base slot $bslot)"
  LS_OUT="$out" LS_BAG="$bag" LS_YAW="$yawm" LS_SLOT="$bslot" node sandbox/lavastep/lavastep-e2e.mjs "$broot" "base$sfx" "$scene" "$server" "$trials" 20 > "$out/q-$server-base$sfx-$scene.log" 2>&1 &
  LS_OUT="$out" LS_BAG="$bag" LS_YAW="$yawm" LS_SLOT="$cslot" node sandbox/lavastep/lavastep-e2e.mjs "$croot" "cand$sfx" "$scene" "$server" "$trials" 20 > "$out/q-$server-cand$sfx-$scene.log" 2>&1 &
  wait
  restore || exit 3
  grep -h -E "SUMMARY|FATAL|cleanup (FAILED|INCOMPLETE)|STOP|SSH master" "$out/q-$server-base$sfx-$scene.log" "$out/q-$server-cand$sfx-$scene.log" | cut -c1-400
done
echo "=== $(date -u +%FT%TZ) $server DONE"
