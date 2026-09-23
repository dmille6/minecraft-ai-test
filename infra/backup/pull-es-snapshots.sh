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

NAS_HOST=${NAS_HOST:-10.0.0.5}
NAS_USER=${NAS_USER:-mike}
NAS_DIR=${NAS_DIR:-/volume1/homes/mike/es-archive}
NAS_KEEP=${NAS_KEEP:-8}
NAS="$NAS_USER@$NAS_HOST"

# DEEP_ONLY=1 verifies an archive ALREADY on the NAS against the .md5 written beside it at
# upload time, then exits. It runs here, BEFORE the pull, on purpose: a verification that
# first drags 19GB across the network is not a verification anyone will run. Two uses --
# proving the corruption alarm actually fires (a check never seen to fail is not a check),
# and verifying an archive on demand before a restore depends on it.
#   DEEP_ONLY=1 STAMP=2026-09-23 ~/bin/pull-es-snapshots.sh
if [ "${DEEP_ONLY:-0}" = "1" ]; then
  stamp=${STAMP:-$(date -u +%F)}
  final="$NAS_DIR/frozen/es-repo-$stamp.tar"
  sent_md5=$($SSH "$NAS" "cut -d' ' -f1 '$final.md5' 2>/dev/null" || echo MISSING)
  if [ "${#sent_md5}" -ne 32 ]; then
    log "ALARM: no recorded checksum at $final.md5 -- this archive cannot be verified"
    exit 12
  fi
  log "verify-only: $final vs recorded $sent_md5"
  got_md5=$($SSH "$NAS" "md5sum '$final' 2>/dev/null | cut -d' ' -f1" || echo FAILED)
  if [ "$got_md5" != "$sent_md5" ]; then
    log "ALARM: $final does NOT match its recorded checksum (disk $got_md5, recorded $sent_md5)"
    exit 10
  fi
  log "verify-only PASSED: $final matches its recorded checksum"
  exit 0
fi

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

# ---- THIRD COPY: the NAS archive -----------------------------------------------------
# .186 is the source, .30 is the mirror, bronto (the Synology) is the ARCHIVE. Three copies
# on three machines, and the archive is the one that keeps depth.
#
# WHY THE ARCHIVE IS NOT ANOTHER --delete MIRROR. The .30 mirror tracks .186 exactly, so
# anything SLM expires after 7 days vanishes from it on the next pass. That protects against
# hardware loss and nothing else. The archive keeps dated, self-contained tarballs, so a
# mistake noticed in three weeks is still recoverable.
#
# WHY tar-OVER-SSH AND NOT rsync. MEASURED 2026-09-23, not assumed: plain ssh with the key
# works to the NAS, but rsync does not, and the reason is not authentication --
#   $ /usr/bin/rsync --server ...
#   rsync error: rsync service is no running (code 43)
# DSM ships a setuid-root patched rsync (-rwsr-xr-x, 3.1.2) that refuses --server mode
# unless the DSM rsync service is switched on in Control Panel. The visible symptom is a
# misleading "Permission denied, please try again." from the sender. The sftp subsystem is
# off too ("Connection closed"). tar streamed over ssh needs nothing enabled on the NAS,
# and it is what an archive wants: one self-contained file that restores on its own without
# depending on an index-N blob a later mirror pass may have replaced.
#
# WHY THE WHOLE REPOSITORY EVERY TIME. An ES snapshot repository is incremental: segment
# blobs are shared between snapshots. Elastic is explicit that a partial filesystem copy
# "may capture an inconsistent view of data and restoring may fail or silently lose data".
# There is no such thing as archiving just the newest snapshot. 19GB over the LAN is ~80s.
#
# Synology warns at login that data belongs in shared folders or it may be removed on
# update. /volume1/homes/mike IS a shared folder (123T, 35T free), hence the path.
if [ "${SKIP_NAS:-0}" != "1" ]; then
  if ! $SSH "$NAS" "mkdir -p '$NAS_DIR/frozen'" 2>/dev/null; then
    log "ALARM: cannot reach the NAS at $NAS_HOST -- the mirror on this host is current, the archive is NOT"
    exit 7
  fi
  stamp=${STAMP:-$(date -u +%F)}
  part="$NAS_DIR/frozen/.es-repo-$stamp.tar.part"
  final="$NAS_DIR/frozen/es-repo-$stamp.tar"

  log "streaming archive -> $NAS:$final"

  # THE SENT-SIDE CHECKSUM IS COMPUTED IN THIS SAME PASS, through a FIFO, so the 19GB is
  # read from local disk exactly once. Process substitution was the obvious way to write
  # this and it is wrong: the substituted process is not waited on, so the checksum file
  # can be read before it is written. A named pipe with an explicit wait has no such race.
  fifo=$(mktemp -u /tmp/es-archive-md5.XXXXXX)
  mkfifo "$fifo"
  ( md5sum < "$fifo" | cut -d' ' -f1 > "$fifo.sent" ) &
  md5pid=$!

  # pipefail is already set, so a failure at EITHER end fails the script rather than
  # leaving a truncated .part renamed into place.
  if ! tar -C "$DST" -cf - . | tee "$fifo" | $SSH "$NAS" "cat > '$part'"; then
    wait "$md5pid" 2>/dev/null || true; rm -f "$fifo" "$fifo.sent"
    log "ALARM: archive stream failed -- leaving the .part for inspection, NOT promoting it"
    exit 8
  fi
  wait "$md5pid"
  sent_md5=$(cat "$fifo.sent" 2>/dev/null || echo MISSING)
  rm -f "$fifo" "$fifo.sent"
  if [ "$sent_md5" = "MISSING" ] || [ ${#sent_md5} -ne 32 ]; then
    log "ALARM: could not checksum the stream we sent ($sent_md5) -- NOT promoting"
    exit 11
  fi

  tb=$($SSH "$NAS" "du -sb '$part' 2>/dev/null | cut -f1" || echo 0)

  # GUARD 3: the tarball must be at least as large as the tree it contains, and not
  # absurdly larger. tar adds a 512-byte header per member, so 2400-odd files means a few
  # MB of overhead -- a 2% band is generous and still catches a truncated or empty stream.
  # A byte count is the cheap daily check; the deep check is the weekly tar -tf below.
  lo=$b
  hi=$(( b + b/50 + 10485760 ))
  if [ "${tb:-0}" -lt "$lo" ] || [ "${tb:-0}" -gt "$hi" ]; then
    log "ALARM: archive is $tb bytes, expected $lo..$hi (mirror is $b) -- NOT promoting"
    exit 9
  fi
  $SSH "$NAS" "mv -f '$part' '$final'; printf '%s  %s\n' '$sent_md5' 'es-repo-$stamp.tar' > '$final.md5'"
  log "archive OK: $(numfmt --to=iec "$tb" 2>/dev/null || echo "$tb")B at $final (md5 $sent_md5)"

  # DEEP CHECK, Sundays -- and it is a CONTENT check, not a structural one.
  #
  # WHAT I GOT WRONG FIRST, recorded because the wrong version looked convincing: the deep
  # check was `tar -tf | wc -l`, and it returned 2532 of 2532 entries on a 19GB archive in
  # THREE SECONDS. That is 6.4 GB/s, which no disk here can do -- because tar -t reads only
  # the 512-byte headers and lseek()s over the file data. It therefore proves the header
  # chain is intact and the file is not truncated, and proves NOTHING about the 19GB of
  # content between the headers. A structural check that cannot see corruption was exactly
  # the "cheap negative" this project keeps believing.
  #
  # So the check is now: md5 of the stream we sent (computed above, free) vs md5 of the
  # bytes actually on NAS disk. That reads 19GB on the NAS, which is why it is weekly. It
  # compares what is STORED against what was SENT, so it catches a short write, a silently
  # dropped block, and bit-rot on the array.
  if [ "${FORCE_DEEP:-0}" = "1" ] || [ "$(date -u +%u)" = "7" ]; then
    log "deep check: md5 of the stored archive vs the $sent_md5 we sent"
    got_md5=$($SSH "$NAS" "md5sum '$final' 2>/dev/null | cut -d' ' -f1" || echo FAILED)
    if [ "$got_md5" != "$sent_md5" ]; then
      log "ALARM: the stored archive does NOT match what we sent (disk $got_md5, sent $sent_md5)"
      log "       the third copy is corrupt or incomplete -- do not trust it for a restore"
      exit 10
    fi
    log "deep check PASSED: stored bytes match the sent stream ($got_md5)"
  fi

  # Retention. ls -1t on the NAS, keep the newest NAS_KEEP, and never touch a .part.
  $SSH "$NAS" "ls -1t '$NAS_DIR'/frozen/es-repo-*.tar 2>/dev/null | tail -n +$((NAS_KEEP+1)) | while read -r f; do rm -f \"\$f\" \"\$f.md5\"; done"
  $SSH "$NAS" "date -u +%FT%TZ > '$NAS_DIR/.last-archive'"
  kept=$($SSH "$NAS" "ls -1 '$NAS_DIR'/frozen/es-repo-*.tar 2>/dev/null | wc -l" || echo '?')
  log "archive holds $kept frozen copies (keeping $NAS_KEEP)"
fi
log "OK"
