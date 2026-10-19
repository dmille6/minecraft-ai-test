#!/usr/bin/env bash
# Nightly backup of the 16 Block 2 fleet worlds to the NAS (bronto, 10.0.0.5).
# Approved by the owner 2026-10-19 ~13:15Z. Runs on block2-worlds (10.0.0.30) from mike's crontab.
#
# METHOD: two-pass rsync of each LIVE world into a persistent local staging copy, then one
# tar.zst per world streamed to the NAS, then every archive is read BACK from the NAS and
# checked. No RCON, no save-off/save-all, no server restart, no world edit.
#
# WHY NOT A SNAPSHOT. The VM disk is a ZFS zvol on pve1 (vmdata/vm-201-disk-1), and a zfs
# snapshot would be the better point-in-time copy. But the guest root is plain ext4 (no
# LVM), so a snapshot has to be taken on pve1, and pve1 root has no route to the NAS or to
# this VM, and this VM has no key for pve1. Bridging that is an access-control change the
# owner has not approved. See docs/reports/world-backup-2026-10-19.md.
#
# WHAT THE SECOND PASS BUYS. Pass 1 (bandwidth-capped) can take a minute per world; Paper
# keeps saving chunks during it. Pass 2 runs immediately after and re-copies only what changed,
# so the skew inside one world's copy shrinks to pass 2's duration (seconds). A third,
# DRY-RUN pass then COUNTS the files that changed even during pass 2 and logs it as
# `residual=` -- the measured inconsistency, not an assumed zero. rsync writes each file to a
# temp name and renames it, so a staged file is never half-copied.
#
# EXCLUDED (reconstructable or not world data): libraries/ versions/ cache/ logs/
# crash-reports/ paper.jar *.jar.bak world.pre-reseed-*/ world*.pre-restore-*/ session.lock.
# The Paper build is recorded in each world's PAPER-BUILD.txt; the jar is /srv/block2/template.
set -euo pipefail

ROOT=${ROOT:-/srv/block2}
STAGE=${STAGE:-/srv/world-backup/staging}
EXPECT=${EXPECT:-16}
PORT_LO=25570; PORT_HI=25585          # fleet worlds. Sandboxes are 25599-25602 and are NEVER backed up.
BWLIMIT=${BWLIMIT:-40000}             # KB/s for pass 1. mq-deadline ignores ionice classes, so this is the real throttle.
NAS_HOST=${NAS_HOST:-10.0.0.5}
NAS_USER=${NAS_USER:-mike}
NAS_DIR=${NAS_DIR:-/volume1/homes/mike/world-backups}
KEY=${KEY:-$HOME/.ssh/id_esbackup}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
NAS="$NAS_USER@$NAS_HOST"
SSH="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=30"
NICE="nice -n 19 ionice -c 3"

log() { echo "$(date -u +%FT%TZ) $*"; }
die() { log "ALARM: $*"; exit "${2:-1}"; }

exec 9>/tmp/mcai-world-backup.lock
flock -n 9 || die "another world backup is still running -- not starting a second" 3

T0=$(date +%s)
DAY=${DAY:-$(date -u +%F)}
DDIR="$NAS_DIR/$DAY"
WORK=$(mktemp -d /tmp/world-backup.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

# ---- which worlds -------------------------------------------------------------------------
# Selected by server-port, not by name, and the count must be exactly EXPECT. A glob that
# silently found 15 (or picked up a sandbox) would otherwise produce a "successful" backup.
worlds=()
for p in "$ROOT"/*/server.properties; do
  d=$(basename "$(dirname "$p")")
  port=$(sudo -n grep -oP '^server-port=\K[0-9]+' "$p" || echo 0)
  if [ "$port" -ge "$PORT_LO" ] && [ "$port" -le "$PORT_HI" ]; then worlds+=("$d"); fi
done
[ "${#worlds[@]}" -eq "$EXPECT" ] || die "found ${#worlds[@]} fleet worlds by port, expected $EXPECT (${worlds[*]:-none})" 4
units=$(systemctl list-units --type=service --state=running --no-legend 'block2@*' | awk '{print $1}' | sed 's/^block2@//; s/\.service$//' | sort | tr '\n' ' ')
want=$(printf '%s\n' "${worlds[@]}" | sort | tr '\n' ' ')
[ "$units" = "$want" ] || log "WARN: running block2@ units ($units) differ from world dirs by port ($want)"
for w in "${worlds[@]}"; do
  sudo -n test -f "$ROOT/$w/world/level.dat" || die "$w has no world/level.dat -- refusing" 5
done
log "start $DAY: ${#worlds[@]} fleet worlds -> $NAS:$DDIR"

$SSH "$NAS" "mkdir -p '$DDIR'" || die "cannot reach the NAS at $NAS_HOST -- no backup written" 7
sudo -n mkdir -p "$STAGE"; sudo -n chmod 700 "$(dirname "$STAGE")" "$STAGE"

EXCL=(--exclude=/libraries/ --exclude=/versions/ --exclude=/cache/ --exclude=/logs/
      --exclude=/crash-reports/ --exclude=/paper.jar --exclude='/*.jar.bak'
      --exclude='/world.pre-reseed-*/' --exclude='/world*.pre-restore-*/' --exclude=session.lock)

printf 'world\tbytes_raw\tbytes_zst\tfiles\tregion_mca\tresidual\tsha256\n' > "$WORK/manifest.tsv"
: > "$WORK/SHA256SUMS"
total_raw=0; total_zst=0; failed=0

for w in "${worlds[@]}"; do
  tw=$(date +%s)
  src="$ROOT/$w/"; dst="$STAGE/$w/"
  # pass 1: bulk, throttled.   pass 2: immediately, the delta only.   pass 3: count what still moved.
  sudo -n $NICE rsync -a --delete --delete-excluded --bwlimit="$BWLIMIT" "${EXCL[@]}" "$src" "$dst" \
    || { log "FAIL $w: rsync pass 1 rc=$?"; failed=$((failed+1)); continue; }
  sudo -n $NICE rsync -a --delete --delete-excluded "${EXCL[@]}" "$src" "$dst" \
    || { log "FAIL $w: rsync pass 2 rc=$?"; failed=$((failed+1)); continue; }
  residual=$(sudo -n $NICE rsync -a --delete --delete-excluded --dry-run --itemize-changes "${EXCL[@]}" "$src" "$dst" \
             | grep -c '^>f' || true)

  raw=$(sudo -n du -sb "$dst" | cut -f1)
  sudo -n find "$dst" -type f -printf "$w/%P\n" | LC_ALL=C sort > "$WORK/$w.staged"
  nfiles=$(wc -l < "$WORK/$w.staged")
  nmca=$(grep -c "^$w/world/region/r\.-\?[0-9]*\.-\?[0-9]*\.mca$" "$WORK/$w.staged" || true)
  [ "$nmca" -gt 0 ] || { log "FAIL $w: staged copy has no region files"; failed=$((failed+1)); continue; }

  part="$DDIR/.$w.tar.zst.part"; final="$DDIR/$w.tar.zst"
  fifo="$WORK/$w.fifo"; mkfifo "$fifo"
  ( sha256sum < "$fifo" | cut -d' ' -f1 > "$WORK/$w.sent" ) &
  shapid=$!
  if ! sudo -n $NICE tar -C "$STAGE" --numeric-owner -cf - "$w" \
       | $NICE zstd -q -3 -T2 --check -c | tee "$fifo" | $SSH "$NAS" "cat > '$part'"; then
    wait "$shapid" 2>/dev/null || true
    log "FAIL $w: stream to NAS failed -- .part left for inspection, not promoted"; failed=$((failed+1)); continue
  fi
  wait "$shapid"; sent=$(cat "$WORK/$w.sent")

  # READ IT BACK. The bytes on the NAS are decompressed here (zstd verifies its own
  # per-frame XXH64 checksum), listed by tar, hashed, and compared to what was staged.
  fifo2="$WORK/$w.fifo2"; mkfifo "$fifo2"
  ( sha256sum < "$fifo2" | cut -d' ' -f1 > "$WORK/$w.got" ) &
  shapid=$!
  if ! $SSH "$NAS" "cat '$part'" | tee "$fifo2" | zstd -q -dc --check | tar -tvf - > "$WORK/$w.list" 2> "$WORK/$w.err"; then
    wait "$shapid" 2>/dev/null || true
    log "FAIL $w: read-back did not decompress/list cleanly: $(head -c 200 "$WORK/$w.err")"; failed=$((failed+1)); continue
  fi
  wait "$shapid"; got=$(cat "$WORK/$w.got")
  zst=$($SSH "$NAS" "du -sb '$part' | cut -f1")
  awk '$1 ~ /^-/ {print $NF}' "$WORK/$w.list" | LC_ALL=C sort > "$WORK/$w.listed"
  why=""
  [ "$sent" = "$got" ] || why="$why sha256 sent=$sent stored=$got;"
  grep -qx "$w/world/level.dat" "$WORK/$w.listed" || why="$why no level.dat;"
  lmca=$(grep -c "^$w/world/region/r\.-\?[0-9]*\.-\?[0-9]*\.mca$" "$WORK/$w.listed" || true)
  [ "$lmca" -eq "$nmca" ] || why="$why region files listed=$lmca staged=$nmca;"
  cmp -s "$WORK/$w.staged" "$WORK/$w.listed" || why="$why file list differs from staging ($(comm -3 "$WORK/$w.staged" "$WORK/$w.listed" | wc -l) names);"
  if [ -n "$why" ]; then log "FAIL $w:$why"; failed=$((failed+1)); continue; fi

  $SSH "$NAS" "mv -f '$part' '$final'"
  printf '%s  %s\n' "$sent" "$w.tar.zst" >> "$WORK/SHA256SUMS"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$w" "$raw" "$zst" "$nfiles" "$nmca" "$residual" "$sent" >> "$WORK/manifest.tsv"
  total_raw=$((total_raw+raw)); total_zst=$((total_zst+zst))
  log "ok $w: raw $(numfmt --to=iec "$raw")B zst $(numfmt --to=iec "$zst")B files=$nfiles mca=$nmca residual=$residual $(( $(date +%s)-tw ))s"
done

if [ "$failed" -ne 0 ]; then
  die "$failed of ${#worlds[@]} worlds FAILED -- $DAY is NOT marked good, retention NOT run" 8
fi

stamp=$(date -u +%FT%TZ)
$SSH "$NAS" "cat > '$DDIR/SHA256SUMS'" < "$WORK/SHA256SUMS"
$SSH "$NAS" "cat > '$DDIR/MANIFEST.tsv'" < "$WORK/manifest.tsv"
$SSH "$NAS" "echo '$stamp ${#worlds[@]} worlds' > '$DDIR/_OK' && echo '$stamp' > '$NAS_DIR/.last-good'"
log "good $DAY: ${#worlds[@]}/${#worlds[@]} worlds, raw $(numfmt --to=iec $total_raw)B -> zst $(numfmt --to=iec $total_zst)B, $(( $(date +%s)-T0 ))s"

# ---- retention: newest KEEP_DAILY good days + the newest good day of each of the KEEP_WEEKLY
# most recent ISO weeks OLDER than those dailies. Only runs after today succeeded. Only names that
# are exactly YYYY-MM-DD are ever considered, and today is never deleted.
$SSH "$NAS" "cd '$NAS_DIR' && for d in 20*; do [ -d \"\$d\" ] || continue; if [ -e \"\$d/_OK\" ]; then echo \"OK \$d\"; else echo \"NO \$d\"; fi; done" > "$WORK/listing"
doomed=$(python3 - "$DAY" "$KEEP_DAILY" "$KEEP_WEEKLY" "$WORK/listing" <<'PY'
import datetime as dt, re, sys
today, kd, kw, path = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
rows = [l.split() for l in open(path) if l.strip()]
names = [n for _, n in rows if re.fullmatch(r'\d{4}-\d{2}-\d{2}', n)]
good = sorted(n for s, n in rows if s == 'OK' and n in names)
daily = good[-kd:]
keep = set(daily)
iso = lambda n: dt.date.fromisoformat(n).isocalendar()[:2]
weeks = {}
for n in good:
    if daily and n < daily[0]:   # weeklies are OLDER than every daily, so they add depth
        weeks[iso(n)] = n        # ascending, so the newest good day of each ISO week wins
keep |= {weeks[w] for w in sorted(weeks)[-kw:]}
keep.add(today)
print(' '.join(sorted(n for n in names if n not in keep)))
PY
)
for d in $doomed; do
  [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  $SSH "$NAS" "rm -rf -- '$NAS_DIR/$d'" && log "retention: removed $d"
done
kept=$($SSH "$NAS" "ls -1d '$NAS_DIR'/20*/_OK 2>/dev/null | wc -l" || echo '?')
log "OK: $kept good days on the NAS (keeping $KEEP_DAILY daily + $KEEP_WEEKLY weekly)"
