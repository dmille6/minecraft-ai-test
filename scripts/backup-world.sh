#!/usr/bin/env bash
# Consistent world backup.
#
# save-off + save-all flush is the load-bearing part: tarring a live world
# directory while Paper is mid-chunk-write produces an archive that restores
# to a corrupt region file, and you find out months later. The trap guarantees
# save-on is restored even if tar fails -- a server left with saving disabled
# silently loses everything since the last flush.
set -uo pipefail

R=/srv/minecraft/shared/rcon.py
SRV=/srv/minecraft/server
DEST=/srv/minecraft/backups
KEEP_DAYS=${KEEP_DAYS:-14}
TS=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/world-$TS.tar.gz"

restore_saving() { "$R" "save-on" >/dev/null 2>&1 || true; }
trap restore_saving EXIT INT TERM

mkdir -p "$DEST"

if ! "$R" "save-off" >/dev/null 2>&1; then
  echo "backup: server unreachable via rcon, backing up cold" >&2
else
  "$R" "save-all flush" >/dev/null 2>&1
  sleep 5
fi

# The state dir is the ONLY irreplaceable thing here. Worlds can be
# re-pregenerated, indices re-shipped, dashboards rebuilt -- accumulated agent
# experience cannot. It was missing from every backup taken until now.
STATE=/srv/minecraft/bots/state
[ -d "$STATE" ] && tar -C /srv/minecraft/bots -czf "$DEST/state-$TS.tar.gz" state 2>/dev/null \
  && echo "backup: state -> $DEST/state-$TS.tar.gz ($(du -h "$DEST/state-$TS.tar.gz" | cut -f1))"

tar -C "$SRV" -czf "$OUT" \
    --warning=no-file-changed \
    world world_nether world_the_end server.properties \
    $(cd "$SRV" && ls -d plugins/*/ 2>/dev/null | grep -v squaremap/web || true) 2>/dev/null
RC=$?

restore_saving
trap - EXIT INT TERM

# tar exit 1 == "file changed as we read it", benign here since saving is off.
if [ $RC -gt 1 ]; then
  echo "backup: tar failed rc=$RC" >&2
  rm -f "$OUT"
  exit 1
fi

# Off-box copy. A backup on the same volume as the thing it protects is a copy,
# not a backup -- if that LVM volume dies, both go together. The NAS is the
# better target and was unreachable when this was written; mcelk is a different
# VM with a different filesystem, which protects against everything except loss
# of the whole hypervisor.
OFFBOX="${OFFBOX:-mike@192.168.192.194:mcai-offbox/}"
if [ -n "$OFFBOX" ]; then
  for f in "$OUT" "$DEST/state-$TS.tar.gz"; do
    [ -f "$f" ] || continue
    if scp -q -i /root/.ssh/id_ed25519_backup -o BatchMode=yes \
           -o StrictHostKeyChecking=accept-new "$f" "$OFFBOX" 2>/dev/null; then
      echo "backup: off-box copy of $(basename "$f") -> $OFFBOX"
    else
      echo "backup: OFF-BOX COPY FAILED for $(basename "$f") -- local copy only" >&2
    fi
  done
fi

SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(find "$DEST" -name 'world-*.tar.gz' | wc -l)
DELETED=$(find "$DEST" -name 'world-*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete | wc -l)
# Keep state far longer than worlds. It is small (kilobytes) and unrecoverable.
find "$DEST" -name 'state-*.tar.gz' -mtime +90 -delete 2>/dev/null
echo "backup: $OUT ($SIZE) | kept=$COUNT pruned=$DELETED retention=${KEEP_DAYS}d"
