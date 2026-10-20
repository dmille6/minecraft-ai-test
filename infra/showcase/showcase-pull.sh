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
SRC=/srv/world-backup/showcase-src
TLS=/srv/world-backup/showcase-timelapse
NAS="mike@10.0.0.5"; NASKEY=$HOME/.ssh/id_esbackup
log() { echo "$(date -u +%FT%TZ) $*"; }
# Wait (do not race) for the fleet backup's lock to be free; world-backup.sh then takes it itself.
flock -w 1800 /tmp/mcai-world-backup.lock true || { log "ALARM: fleet backup lock still held after 30 min"; exit 3; }

log "stage on the VM (save-off + flush, local copy, save-on)"
st=$(ssh $O -i ~/.ssh/id_showcase_stage $VM stage) || { log "ALARM: stage failed: $st"; exit 4; }
echo "$st" | grep -q '"ok": true' || { log "ALARM: stage not ok: $st"; exit 4; }
log "stage $st"

log "pull the static stage"
sudo -n mkdir -p "$SRC/showcase" && sudo -n chown mike:mike "$SRC" "$SRC/showcase"
rsync -a --delete -e "ssh $O -i $HOME/.ssh/id_showcase_backup" "$VM:showcase/" "$SRC/showcase/" \
  || { log "ALARM: pull failed rc=$?"; exit 5; }
[ -f "$SRC/showcase/world/level.dat" ] || { log "ALARM: pulled copy has no level.dat"; exit 5; }

log "archive to the NAS (world-backup.sh logic, one world)"
ROOT=$SRC STAGE=/srv/world-backup/showcase-staging EXPECT=1 PORT_LO=25565 PORT_HI=25565 UNIT_CHECK=0 \
  NAS_DIR=/volume1/homes/mike/world-backups-showcase "$HOME/bin/showcase-world-backup.sh" || { log "ALARM: archive failed rc=$?"; exit 6; }

log "timelapse -> NAS (only the newest 3 UTC days are pulled; frames live in frames/<view>/<YYYYmmdd>/)"
mkdir -p "$TLS/frames"
TLK="ssh $O -i $HOME/.ssh/id_showcase_tl"
pulled=0
for d in 0 1 2; do
  day=$(date -u -d "-$d day" +%Y%m%d)
  for v in angled topdown; do
    mkdir -p "$TLS/frames/$v/$day"
    rsync -a -e "$TLK" "$VM:frames/$v/$day/" "$TLS/frames/$v/$day/" 2>/dev/null && pulled=$((pulled+1))
  done
done
rsync -a --delete -e "$TLK" "$VM:video/" "$TLS/video/" 2>/dev/null || true
rsync -a -e "$TLK" "$VM:FRAME0.json" "$TLS/" 2>/dev/null || true
ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "mkdir -p /volume1/homes/mike/showcase-timelapse" || { log "ALARM: NAS unreachable"; exit 7; }
rsync -a -e "ssh -i $NASKEY -o BatchMode=yes" "$TLS/frames" "$TLS/video" "$NAS:/volume1/homes/mike/showcase-timelapse/" \
  || { log "ALARM: timelapse push failed"; exit 7; }
[ -f "$TLS/FRAME0.json" ] && rsync -a -e "ssh -i $NASKEY -o BatchMode=yes" "$TLS/FRAME0.json" "$NAS:/volume1/homes/mike/showcase-timelapse/"
y=$(date -u -d "-1 day" +%Y%m%d)
here=$(find "$TLS/frames" -path "*/$y/*.png" | wc -l)
there=$(ssh -i "$NASKEY" -o BatchMode=yes "$NAS" "find /volume1/homes/mike/showcase-timelapse/frames -path '*/$y/*.png' | wc -l")
[ "$here" -eq "$there" ] || { log "ALARM: yesterday ($y): NAS holds $there frames, staging $here"; exit 7; }
# .30's staging is bounded: day dirs older than 3 days go (the VM and the NAS keep every frame)
find "$TLS/frames" -mindepth 2 -maxdepth 2 -type d -mtime +3 -exec rm -rf {} + 2>/dev/null || true
log "OK: world archived; timelapse $pulled day-dirs pulled; yesterday ($y) $there frames on the NAS"
