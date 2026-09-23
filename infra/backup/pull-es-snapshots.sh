#!/usr/bin/env bash
# Pull the Elasticsearch snapshot repository from the ELK host (.186) to this host.
#
# WHY PULL, NOT PUSH. The source is the live single-node cluster holding 42M documents and
# every day of this experiment's history. A push would mean the ES host blocks on the
# network; a hung destination would wedge the one machine we cannot afford to wedge. The
# destination pulls, so the worst case is a stale copy, never a stalled cluster.
#
# WHY A MID-SNAPSHOT GUARD. Elastic is explicit that copying repository contents by other
# means "may capture an inconsistent view of data and restoring may fail or silently lose
# data". Copying while a snapshot is being written is exactly that case, so this refuses.
#
# THIS IS A MIRROR, NOT AN ARCHIVE. --delete means anything SLM expires on .186 disappears
# here on the next run. Depth needs a separate periodic freeze; see the tar step at the end.
set -euo pipefail

SRC_HOST=${SRC_HOST:-10.0.0.186}
SRC_DIR=${SRC_DIR:-/srv/es-backup}
DST=${DST:-/srv/es-archive/186}
KEY=${KEY:-$HOME/.ssh/id_esbackup}
SSH="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

log() { echo "$(date -u +%FT%TZ) $*"; }

# GUARD 1: refuse while a snapshot is in flight.
inflight=$($SSH "mike@$SRC_HOST" 'cd /opt/docker-elk && EP=$(sudo -n grep -oP "(?<=^ELASTIC_PASSWORD=).*" .env) && curl -s -m 20 -u "elastic:$EP" localhost:9200/_snapshot/_status | python3 -c "import sys,json;print(len(json.load(sys.stdin).get(\"snapshots\",[])))"' 2>/dev/null || echo "ERR")
if [ "$inflight" = "ERR" ]; then
  log "ALARM: could not ask the source whether a snapshot is running -- refusing to copy"
  exit 3
fi
if [ "$inflight" != "0" ]; then
  log "snapshot in progress ($inflight); skipping this run rather than copying a torn repo"
  exit 0
fi

mkdir -p "$DST"; chmod 700 "$DST"
log "pulling $SRC_HOST:$SRC_DIR -> $DST"
rsync -a --delete --partial --info=stats2 \
      -e "$SSH" \
      "mike@$SRC_HOST:$SRC_DIR/" "$DST/"

# GUARD 2: a copy that produced nothing is not a backup.
n=$(find "$DST" -type f | wc -l)
b=$(du -sb "$DST" | awk '{print $1}')
log "mirror now holds $n files, $(numfmt --to=iec "$b" 2>/dev/null || echo "$b")B"
if [ "$n" -lt 10 ] || [ "$b" -lt 1000000000 ]; then
  log "ALARM: mirror looks empty or tiny -- treat as FAILED, do not trust it"
  exit 4
fi
# index-N is the repository root blob; without it the repo is unreadable.
if ! ls "$DST"/index-* >/dev/null 2>&1; then
  log "ALARM: no index-N root blob in the mirror -- the repository is not readable"
  exit 5
fi
date -u +%FT%TZ > "$DST/.last-pull"
log "OK"
