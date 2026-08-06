#!/usr/bin/env bash
# Back up the agents' accumulated experience.
#
# This is the only irreplaceable data in the project. Worlds can be
# re-pregenerated, indices re-shipped, dashboards rebuilt; 285 accumulated
# judgements across 118 runs cannot.
#
# It was being backed up NOWHERE. The world backup on the Minecraft host archives
# /srv/minecraft/bots/state, which still exists but is the ABANDONED copy from
# before the fleet moved to this machine -- a recovery mechanism that outlived
# the world it was written for. The live state is here, and nothing protected it.
#
# LIMIT, stated plainly: this writes to the same machine it protects. It guards
# against corruption, a bad deploy and accidental deletion. It does NOT guard
# against losing this host. That needs an off-box target, which needs either
# host-to-host keys or NAS access -- neither exists yet.
set -uo pipefail

SRC=/srv/mcbots/state
DEST=/srv/mcbots/backups
KEEP=${KEEP:-30}
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$DEST/state-$TS.tar.gz"

mkdir -p "$DEST"
tar -C "$(dirname "$SRC")" -czf "$OUT" "$(basename "$SRC")" 2>/dev/null || {
  echo "state-backup: tar failed" >&2; exit 1; }

# VERIFY, do not assume. An unreadable archive that nobody opens is the same
# thing as no backup, and this project has spent a day learning what untested
# beliefs cost. Every lessons file must parse as JSON or the archive is rejected.
if ! tar -xzOf "$OUT" 2>/dev/null | python3 -c '
import sys
raw = sys.stdin.buffer.read()
' 2>/dev/null; then :; fi

TMP=$(mktemp -d)
tar -xzf "$OUT" -C "$TMP" 2>/dev/null
BAD=0; OK=0
for f in "$TMP"/state/*.json; do
  [ -f "$f" ] || continue
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null; then
    OK=$((OK+1))
  else
    echo "state-backup: CORRUPT in archive: $(basename "$f")" >&2; BAD=$((BAD+1))
  fi
done
rm -rf "$TMP"

if [ "$BAD" -gt 0 ] || [ "$OK" -eq 0 ]; then
  echo "state-backup: REJECTED $OUT ($OK ok, $BAD corrupt)" >&2
  rm -f "$OUT"
  exit 1
fi

echo "state-backup: $OUT ($(du -h "$OUT" | cut -f1), $OK files verified)"
find "$DEST" -name 'state-*.tar.gz' -mtime +"$KEEP" -delete 2>/dev/null
