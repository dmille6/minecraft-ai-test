#!/usr/bin/env bash
# tlpolish-1106: the nightly Chunky golden-hour BEAUTY renders of the showcase, ON 10.0.0.30 (mike's crontab, 04:40Z).
# Replaces visuals-1105's ci2 job (chunky-render-nightly.sh: never produced a frame after its first manual run -- 11-05
# its mirror pull failed (the mirror is 0600, the restricted key's user cannot read it), 11-06 the suite lock was busy).
#   chunky-beauty-nightly.sh [--day YYYY-MM-DD] [--spp N] [--no-wait]
# 1. WAIT for tonight's showcase pull (showcase-pull.sh, 04:15Z: "good <today>" in its log) -- up to 90 min, else SKIP
#    (a stale copy is never rendered as tonight's). The world is that pull's copy (/srv/showcase-backup/src/showcase/
#    world): no new read path into the VM, no permission change on the mirror.
# 2. COPY it (region + level.dat) into a private snapshot, so the next pull never races a render.
# 3. The follow camera's last framing (the VM's timelapse logs/views.json, read with the existing read-only
#    id_showcase_tl key) -> scenes (chunky_beauty.py): the town hero + the active project, sun per camera, 320 spp.
# 4. RENDER each view: nice 19, ionice idle, 12 threads (of 32; the fleet worlds keep the rest), a 60-min cap per view.
# 5. best-of-day + the day's beauty video + each view's history video; PUBLISH to the VM's
#    video/stills/chunky/<day>/ (restricted write-only key, rrsync -wo, from 10.0.0.30 only).
# One run at a time (flock -n on its own lock). Every step logs one line to $H/render.log.
set -uo pipefail
H=/home/mike/chunky-beauty
K=$H/kit                                     # the Chunky install: lib/, home/, packs/ (copied from ci2 11-07)
LOG=$H/render.log
SPP=320; THREADS=12; WAIT=1; DAY=$(date -u +%F)
while [ $# -gt 0 ]; do case "$1" in --day) DAY=$2; shift;; --spp) SPP=$2; shift;; --no-wait) WAIT=0;; esac; shift; done
say() { echo "$(date -u +%FT%TZ) $*" | tee -a $LOG; }
mkdir -p $H
exec 9>>$H/.lock
flock -n 9 || { say "SKIP: another beauty run holds the lock"; exit 0; }
SRC=/srv/showcase-backup/src/showcase/world
PULL_LOG=/var/log/mcai-monitor/showcase-backup.log
if [ $WAIT = 1 ]; then
  for i in $(seq 1 18); do grep -q "good $DAY" $PULL_LOG && break; sleep 300; done
  grep -q "good $DAY" $PULL_LOG || { say "SKIP $DAY: no 'good $DAY' showcase pull after 90 min (stale copy not rendered)"; exit 0; }
fi
[ -f $SRC/level.dat ] || { say "FAIL $DAY: $SRC/level.dat missing"; exit 1; }
say "start $DAY spp=$SPP threads=$THREADS (world: tonight's pull)"
mkdir -p $H/world/region
rsync -a --delete $SRC/region/ $H/world/region/ && cp -p $SRC/level.dat $H/world/level.dat \
  || { say "FAIL $DAY: world copy"; exit 1; }
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -i /home/mike/.ssh/id_showcase_tl" \
  showbak@10.0.0.40:logs/views.json $H/views-tl.json 2>>$LOG || say "WARN: no views.json (the project view is skipped)"
rm -rf $H/scenes && mkdir -p $H/scenes
python3 -I $H/bin/chunky_beauty.py scenes $H/scenes $H/world --views-json $H/views-tl.json --spp $SPP >> $LOG 2>&1 \
  || { say "FAIL $DAY: scenes"; exit 1; }
OUT=$H/frames/$DAY; mkdir -p $OUT
cp $H/scenes/views.json $OUT/views.json
rc_all=0
for v in $(python3 -c "import json;print(' '.join(x['view'] for x in json.load(open('$H/scenes/views.json'))))"); do
  t0=$(date +%s)
  timeout 60m nice -n 19 ionice -c3 java -Xmx6G -Dchunky.home=$K/home -cp "$K/lib/*" se.llbit.chunky.main.Chunky \
      -scene-dir $H/scenes -texture $K/packs/faithful32x-1.21.8.zip -render $v -threads $THREADS -target $SPP -f \
      > $H/render-$v.log 2>&1
  rc=$?
  png=$(ls -t $H/scenes/$v/snapshots/*.png 2>/dev/null | head -1)
  if [ $rc -eq 0 ] && [ -n "$png" ]; then
    cp "$png" $OUT/$v.png
    say "ok $DAY $v $(( $(date +%s) - t0 )) s $(stat -c %s $OUT/$v.png) bytes"
  else
    say "FAIL $DAY $v rc=$rc after $(( $(date +%s) - t0 )) s (see render-$v.log)"; rc_all=1
  fi
done
ls $OUT/*.png >/dev/null 2>&1 || { say "FAIL $DAY: no frame rendered"; exit 1; }
python3 -I $H/bin/chunky_beauty.py best $OUT >> $LOG 2>&1 || { say "FAIL $DAY: best"; rc_all=1; }
python3 -I $H/bin/chunky_beauty.py video $H $DAY >> $LOG 2>&1 || { say "FAIL $DAY: video"; rc_all=1; }
mkdir -p $H/publish/$DAY
cp $OUT/*.png $OUT/*.json $H/publish/$DAY/ 2>/dev/null
cp $H/video/beauty-$DAY.mp4 $H/publish/$DAY/ 2>/dev/null
cp $H/video/beauty-history-*.mp4 $H/publish/$DAY/ 2>/dev/null
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -i /home/mike/.ssh/chunky_push -o IdentitiesOnly=yes" \
  $H/publish/$DAY mike@10.0.0.40:./ \
  && say "published $DAY -> showcase video/stills/chunky/$DAY/" || { say "FAIL $DAY: publish"; rc_all=1; }
rm -rf $H/publish/$DAY
find $H/scenes -name '*.dump' -delete
say "done $DAY rc=$rc_all"
exit $rc_all
