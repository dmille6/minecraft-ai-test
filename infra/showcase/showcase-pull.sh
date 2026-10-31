#!/usr/bin/env bash
# ON 10.0.0.30 (block2-worlds), mike's crontab, 04:15Z: the showcase's nightly backup + timelapse to the NAS.
# Design: docs/reports/showcase-2026-10-20.md section 8. Three restricted keys into the showcase VM (user showbak):
#   ~/.ssh/id_showcase_stage   forced: sudo -n /srv/showcase/bin/backup_stage.py      (consistent local copy)
#   ~/.ssh/id_showcase_backup  forced: sudo -n /usr/bin/rrsync -ro /srv/showcase/backup-stage/
#   ~/.ssh/id_showcase_tl      forced: /usr/bin/rrsync -ro /srv/showcase/timelapse/
# then the branch's world-backup.sh (copied as ~/bin/showcase-world-backup.sh) archives the pulled copy to the NAS
# with .30's EXISTING NAS key, and the timelapse is rsynced to the NAS. No new key on the NAS.
set -uo pipefail
VM=showbak@10.0.0.40
O="-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes"
# NOT under /srv/world-backup: the fleet backup keeps that 0700 root, and this script runs as mike.
SRC=/srv/showcase-backup/src
TLS=/srv/showcase-backup/timelapse
NAS="mike@10.0.0.5"; NASKEY=$HOME/.ssh/id_esbackup
log() { echo "$(date -u +%FT%TZ) $*"; }
# Wait (do not race) for the fleet backup's lock to be free; world-backup.sh then takes it itself.
flock -w 1800 /tmp/mcai-world-backup.lock true || { log "ALARM: fleet backup lock still held after 30 min"; exit 3; }

log "stage on the VM (save-off + flush, local copy, save-on)"
st=$(ssh $O -i ~/.ssh/id_showcase_stage $VM stage) || { log "ALARM: stage failed: $st"; exit 4; }
echo "$st" | grep -q '"ok": true' || { log "ALARM: stage not ok: $st"; exit 4; }
log "stage $st"

log "pull the static stage"
sudo -n install -d -o mike -g mike /srv/showcase-backup "$SRC" "$SRC/showcase" "$TLS"
rsync -a --delete -e "ssh $O -i $HOME/.ssh/id_showcase_backup" "$VM:showcase/" "$SRC/showcase/" \
  || { log "ALARM: pull failed rc=$?"; exit 5; }
[ -f "$SRC/showcase/world/level.dat" ] || { log "ALARM: pulled copy has no level.dat"; exit 5; }

log "archive to the NAS (world-backup.sh logic, one world)"
ROOT=$SRC STAGE=/srv/world-backup/showcase-staging EXPECT=1 PORT_LO=25565 PORT_HI=25565 UNIT_CHECK=0 \
  NAS_DIR=/volume1/homes/mike/world-backups-showcase "$HOME/bin/showcase-world-backup.sh" || { log "ALARM: archive failed rc=$?"; exit 6; }

log "timelapse -> NAS: reconcile every day dir the VM holds against the NAS (frames live in frames/<view>/<YYYYmmdd>/)"
TLK="ssh $O -i $HOME/.ssh/id_showcase_tl"
NB=/volume1/homes/mike/showcase-timelapse
ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "mkdir -p $NB/frames" || { log "ALARM: NAS unreachable"; exit 7; }
# the VM's inventory: <view>/<day> <n files>. ONLY published frames, frames/<view>/<YYYYmmdd>/<stamp>.png: the capture's
# work area frames/.staging/ holds in-flight (and, after a killed capture, orphaned) pngs, and counting those as "day dirs"
# made every night from 10-28 to 10-31 alarm "3 day dirs still short" over three orphans of a 10-27 06:45Z capture.
rsync -r --list-only -e "$TLK" "$VM:frames/" 2>"$TLS/.list.err" | awk '$NF ~ /\.png$/ {n = split($NF, p, "/"); if (n == 3 && p[1] !~ /^\./ && p[2] ~ /^[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$/) c[p[1] "/" p[2]]++} END {for (k in c) print k, c[k]}' | sort > "$TLS/.vm.inv" \
  || { log "ALARM: cannot list the VM's frames: $(head -c 200 "$TLS/.list.err")"; exit 7; }
ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "cd $NB/frames 2>/dev/null && find . -name '*.png' | awk -F/ 'NF == 4 && \$2 !~ /^\\./ && \$3 ~ /^[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]\$/ {c[\$2 \"/\" \$3]++} END {for (k in c) print k, c[k]}'" | sort > "$TLS/.nas.inv"
need=$(join -a1 -e 0 -o 1.1,1.2,2.2 "$TLS/.vm.inv" "$TLS/.nas.inv" | awk '$2 > $3 {print $1}')
nd=0; bad=0
for vd in $need; do
  mkdir -p "$TLS/frames/$vd"
  if rsync -a -e "$TLK" "$VM:frames/$vd/" "$TLS/frames/$vd/" && \
     tar -C "$TLS" -cf - "frames/$vd" | ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "tar -C $NB -xf -"; then
    nd=$((nd+1))
  else
    log "ALARM: day dir $vd failed to reach the NAS"; bad=$((bad+1))
  fi
done
# The NAS (Synology) refuses rsync over ssh for this account; world-backup.sh streams with `cat`, this streams tar.
mkdir -p "$TLS/video"
rsync -a --delete -e "$TLK" "$VM:video/" "$TLS/video/" 2>/dev/null || log "WARN: no video dir on the VM yet"
rsync -a -e "$TLK" "$VM:FRAME0.json" "$TLS/" 2>/dev/null || true
tar -C "$TLS" -cf - video $( [ -f "$TLS/FRAME0.json" ] && echo FRAME0.json ) | ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "tar -C $NB -xf -" \
  || log "WARN: video / FRAME0 push incomplete"
# positive control + completeness: after the pushes the NAS must hold at least what the VM holds, per day dir
ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "cd $NB/frames && find . -name '*.png' | awk -F/ 'NF == 4 && \$2 !~ /^\\./ && \$3 ~ /^[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]\$/ {c[\$2 \"/\" \$3]++} END {for (k in c) print k, c[k]}'" | sort > "$TLS/.nas.inv"
short=$(join -a1 -e 0 -o 1.1,1.2,2.2 "$TLS/.vm.inv" "$TLS/.nas.inv" | awk '$2 > $3' | wc -l)
total=$(awk '{s += $2} END {print s + 0}' "$TLS/.vm.inv")
[ "$total" -gt 0 ] || log "WARN: the VM lists 0 frames (before frame 0, or the listing is wrong)"
[ "$short" -eq 0 ] && [ "$bad" -eq 0 ] || { log "ALARM: $short day dirs still short on the NAS ($bad failed pushes)"; exit 7; }
# .30's staging stays bounded: day dirs older than 3 days go (the VM and the NAS keep every frame)
find "$TLS/frames" -mindepth 2 -maxdepth 2 -type d -mtime +3 -exec rm -rf {} + 2>/dev/null || true
log "OK: world archived; timelapse $total frames on the VM, all on the NAS ($nd day dirs pushed tonight)"

