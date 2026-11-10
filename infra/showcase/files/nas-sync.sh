#!/bin/bash
# Copy the showcase timelapse to the NAS archive (never deletes on the NAS). Run as root (root cron 06:40Z).
# timelapse2-1110: + data/<day>/ (the hourly extracts), + a per-day CHECKSUM verify that writes
# frames/<view>/<day>/.nas-verified (= the day's .png count) locally; tl_video.thin removes only verified days.
set -u
SRC=/srv/showcase/timelapse; DST=/mnt/nas-tl/showcase; LOG=/srv/showcase/timelapse/logs/nas-sync.log
ls /mnt/nas-tl/README.md >/dev/null 2>&1 || { echo "$(date -u +%FT%TZ) NAS not mounted" >> $LOG; exit 1; }
R="nice -n 19 ionice -c3 rsync -rt --inplace --bwlimit=60000"
echo "$(date -u +%FT%TZ) start" >> $LOG
$R $SRC/frames/ $DST/frames/ && $R $SRC/frames-aside/ $DST/frames-aside/ && $R $SRC/video/ $DST/video/ && \
$R $SRC/logs/ $DST/logs/ && $R --include='tl.conf*' --include='FRAME0.json' --exclude='*' $SRC/ $DST/config/ && \
{ [ ! -d $SRC/data ] || $R $SRC/data/ $DST/data/; }
rc=$?; echo "$(date -u +%FT%TZ) done rc=$rc" >> $LOG
# THE MARKER the daily check reads from the NAS (/usr/local/sbin/nas-archive-read.sh): only after a complete copy (owner 11-10)
[ $rc -eq 0 ] && date -u +%FT%TZ > $DST/.last-good
$R /var/log/mcai/ $DST/data/botlogs/ >> $LOG 2>&1 || echo "$(date -u +%FT%TZ) botlogs copy failed" >> $LOG
if [ $rc -eq 0 ]; then
  # VERIFY by checksum, day by day (days already marked with an unchanged count are skipped)
  nv=0; nf=0
  for d in $SRC/frames/*/2???????; do
    [ -d "$d" ] || continue
    rel=${d#$SRC/frames/}; n=$(ls "$d" | grep -c '\.png$')
    [ -f "$d/.nas-verified" ] && [ "$(cut -d' ' -f1 "$d/.nas-verified")" = "$n" ] && continue
    diff=$(nice -n 19 ionice -c3 rsync -rnc --out-format='%n' --include='*.png' --include='*.json' --exclude='*' "$d/" "$DST/frames/$rel/" | grep -v '/$')
    if [ -z "$diff" ]; then echo "$n $(date -u +%FT%TZ)" > "$d/.nas-verified"; chown mike:mike "$d/.nas-verified"; nv=$((nv+1))
    else rm -f "$d/.nas-verified"; nf=$((nf+1)); echo "$(date -u +%FT%TZ) VERIFY FAIL $rel: $(echo "$diff" | head -3 | tr '\n' ' ')" >> $LOG; fi
  done
  echo "$(date -u +%FT%TZ) verify: $nv day dirs verified, $nf failed" >> $LOG
  # only verified days: keep 7 full days + the hourly representatives locally (the NAS has every frame)
  ( cd /srv/showcase/bin && nice -n 19 python3 -B -c "import tl_video as t; t.thin(apply=True, below_gb=100000, retain_days=7)" ) >> $LOG 2>&1
fi
exit $rc
