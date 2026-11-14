#!/bin/bash
# worldrec.sh -- a READ-ONLY copy of the rehearsal world's block files every 15 minutes, so its building can be
# rendered as a timelapse later. Owner 2026-11-14 ("do what you recommend"): docs/reports/camera-design-2026-11-14.md
# section 4 and docs/decisions/consolidation-2026-11-14.md. Installed by the consolidation control session.
#
# It reads /srv/rehearsal/server/<level>/{region,level.dat} and writes ONLY under ~/worldrec. It sends no command to the
# server and takes no save hold, so a copy taken mid-save can hold a half-written chunk (one missing chunk in one frame).
# Unchanged files are hard links to the previous copy. It stops itself after END, or when the disk gets short.
set -u
SRC=/srv/rehearsal/server/fw-s12
DST=$HOME/worldrec/snaps
LOG=$HOME/worldrec/worldrec.log
END=2026-11-16T15:00:00Z          # rehearsal-0 ends 2026-11-16T14:46:09Z
MIN_FREE_GB=25

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"; }
mkdir -p "$DST"
if [[ "$now" > "$END" ]]; then log "past END $END: nothing copied (remove the crontab line)"; exit 0; fi
free=$(df --output=avail -BG "$DST" | tail -1 | tr -dc 0-9)
if [ "$free" -lt "$MIN_FREE_GB" ]; then log "STOPPED: only ${free} GB free (< ${MIN_FREE_GB})"; exit 0; fi

T=$(date -u +%Y%m%dT%H%M%SZ)
last=$(ls -1d "$DST"/2* 2>/dev/null | tail -1)
tmp="$DST/.tmp-$T"
t0=$(date +%s)
if sudo -n nice -n 19 ionice -c3 rsync -a ${last:+--link-dest="$last"} \
     --include='/region/' --include='/region/*.mca' --include='/level.dat' --exclude='*' "$SRC"/ "$tmp"/; then
  sudo -n mv "$tmp" "$DST/$T"
  n=$(sudo -n find "$DST/$T/region" -name '*.mca' | wc -l)
  new=$(sudo -n find "$DST/$T/region" -name '*.mca' -links 1 | wc -l)
  log "ok $T files=$n copied_new=$new secs=$(( $(date +%s) - t0 )) free_gb=$free"
else
  rc=$?
  sudo -n rm -rf "$tmp"
  log "FAILED $T rsync rc=$rc"
  exit 1
fi
