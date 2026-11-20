#!/usr/bin/env bash
# SANDBOX-ONLY (stepwell-03show rig) on the worlds host, under the caller's sandbox3 lock (sandbox/sbxlock.sh). The crrigworld.sh
# recipe for sandbox3: load a COPY of a rig world (never a live one), snap the step well region, restore the world that was there.
#   swrigworld.sh load <src world dir> <tag> | snap <out dir> | restore <tag>
set -euo pipefail
S=/srv/block2/sandbox3; U=block2-sandbox3
R() { python3 /home/mike/t11rcon.py sandbox3 "$@"; }
up() { for i in $(seq 1 90); do if R list >/dev/null 2>&1; then return 0; fi; sleep 2; done; echo "sandbox3 RCON not up" >&2; return 1; }
case "$1" in
  load)
    src="$2"; [[ -d "$src" ]] || { echo "no $src" >&2; exit 2; }
    sudo systemctl stop $U
    ts=$(date -u +%Y%m%dT%H%MZ)
    sudo mv "$S/world" "$S/world.pre-$3-$ts"
    sudo cp -a "$src" "$S/world"; sudo chown -R sandbox:sandbox "$S/world"
    sudo systemctl start $U; up; echo "loaded copy of $src; previous world at world.pre-$3-$ts" ;;
  snap)
    R "save-all flush" >/dev/null; sleep 3; mkdir -p "$2"
    sudo cat "$S/world/region/r.-1.-1.mca" > "$2/r.-1.-1.mca"; ls -la "$2" ;;
  restore)
    pre=$(ls -d "$S"/world.pre-"$2"-* | tail -1); [[ -d "$pre" ]] || { echo "no world.pre-$2-*" >&2; exit 2; }
    sudo systemctl stop $U
    sudo mv "$S/world" "$S/world.$2-$(date -u +%Y%m%dT%H%MZ)"
    sudo mv "$pre" "$S/world"
    sudo systemctl start $U; up; echo "restored $pre" ;;
  *) echo "usage: swrigworld.sh load|snap|restore ..." >&2; exit 2 ;;
esac
