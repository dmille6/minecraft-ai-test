#!/usr/bin/env bash
# SANDBOX-ONLY (pit-01show rig), runs ON the worlds host 10.0.0.30 under the caller's sandbox2 lock (sandbox/sbxlock.sh).
#   pitworld.sh load <base world copy> <regions dir>   stop sandbox2; set the current world aside as world.pre-pit-<ts>; build the rig
#                                                       world from a COPY of <base> (level.dat, playerdata) with <regions dir>'s region
#                                                       files (ci2 ~/world18full/region: the 11-18 showcase copy holding P1); start
#   pitworld.sh snap <out dir>                          save-all flush; copy the region file holding P1 (r.-1.-1.mca) to <out dir>
#   pitworld.sh restore                                 stop; put world.pre-pit-* back as `world` (the rig's kept as world.pitrig-<ts>)
set -euo pipefail
S=/srv/block2/sandbox2; U=block2-sandbox2
R() { python3 /tmp/pit-rcon.py sandbox2 "$@"; }
up() { for i in $(seq 1 90); do if R list >/dev/null 2>&1; then return 0; fi; sleep 2; done; echo "sandbox2 RCON not up" >&2; return 1; }
case "$1" in
  load)
    base="$S/world.$2"; [[ -d "$base" && -d "$3" ]] || { echo "no $base or $3" >&2; exit 2; }
    sudo systemctl stop $U
    ts=$(date -u +%Y%m%dT%H%MZ)
    sudo mv "$S/world" "$S/world.pre-pit-$ts"
    sudo cp -a "$base" "$S/world"
    sudo rm -rf "$S/world/region" "$S/world/entities" "$S/world/poi"
    sudo cp -a "$3" "$S/world/region"
    sudo chown -R sandbox:sandbox "$S/world"
    sudo systemctl start $U; up; R "gamerule keepInventory true"; echo "loaded $base + $3; previous world at world.pre-pit-$ts" ;;
  snap)
    R "save-all flush" >/dev/null; sleep 3; mkdir -p "$2"
    sudo cat "$S/world/region/r.-1.-1.mca" > "$2/r.-1.-1.mca"; ls -la "$2" ;;
  restore)
    pre=$(ls -d "$S"/world.pre-pit-* | tail -1); [[ -d "$pre" ]] || { echo "no world.pre-pit-*" >&2; exit 2; }
    sudo systemctl stop $U
    sudo mv "$S/world" "$S/world.pitrig-$(date -u +%Y%m%dT%H%MZ)"
    sudo mv "$pre" "$S/world"
    sudo systemctl start $U; up; R "gamerule keepInventory false"; echo "restored $pre" ;;
  *) echo "usage: pitworld.sh load|snap|restore ..." >&2; exit 2 ;;
esac
