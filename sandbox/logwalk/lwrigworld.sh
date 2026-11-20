#!/usr/bin/env bash
# SANDBOX-ONLY (logwalk-01show rig), runs ON the worlds host 10.0.0.30 under the caller's sandbox2 lock (sandbox/sbxlock.sh).
#   lwrigworld.sh load <copy name> <tag>     stop sandbox2; set the current world aside as world.pre-<tag>-<ts>; load a COPY of the named
#                                          rig world (never a live world); start; wait for RCON
#   lwrigworld.sh snap <out dir>             save-all flush; copy the four region files round the town centre to <out dir>
#   lwrigworld.sh restore <tag>              stop; put world.pre-<tag>-* back as `world` (the rig's copy kept as world.<tag>-<ts>); start
set -euo pipefail
S=/srv/block2/sandbox2; U=block2-sandbox2
R() { python3 /home/mike/t11rcon.py sandbox2 "$@"; }
up() { for i in $(seq 1 90); do if R list >/dev/null 2>&1; then return 0; fi; sleep 2; done; echo "sandbox2 RCON not up" >&2; return 1; }
case "$1" in
  load)
    src="$S/world.$2"; [[ -d "$src" ]] || { echo "no $src" >&2; exit 2; }
    sudo systemctl stop $U
    ts=$(date -u +%Y%m%dT%H%MZ)
    sudo mv "$S/world" "$S/world.pre-$3-$ts"
    sudo cp -a "$src" "$S/world"
    sudo systemctl start $U; up; echo "loaded copy of $src; previous world at world.pre-$3-$ts" ;;
  snap)
    R "save-all flush" >/dev/null; sleep 3; mkdir -p "$2"
    for r in r.0.0 r.-1.0 r.0.-1 r.-1.-1; do sudo cat "$S/world/region/$r.mca" > "$2/$r.mca"; done; ls -la "$2" ;;
  restore)
    pre=$(ls -d "$S"/world.pre-"$2"-* | tail -1); [[ -d "$pre" ]] || { echo "no world.pre-$2-*" >&2; exit 2; }
    sudo systemctl stop $U
    sudo mv "$S/world" "$S/world.$2-$(date -u +%Y%m%dT%H%MZ)"
    sudo mv "$pre" "$S/world"
    sudo systemctl start $U; up; echo "restored $pre" ;;
  *) echo "usage: lwrigworld.sh load|snap|restore ..." >&2; exit 2 ;;
esac
