#!/usr/bin/env bash
# visuals-1105: nightly Chunky path-traced hero renders of the showcase town, on ci2.
#   render-nightly.sh [--wait] [--only town,hallwall,ziggurat] [--spp N]
# Takes ci2's suite lock for the whole run: flock -n (cron) = SKIP when a suite holds it; --wait = queue behind it (manual).
# Pulls the showcase's BlueMap mirror world read-only (restricted key: rrsync -ro), writes the scenes, renders each view
# under nice 19 with a wall-clock cap, publishes the PNGs to the showcase (restricted key: rrsync -wo into
# /srv/showcase/timelapse/video/stills/chunky/<date>/). Never touches the live world.
set -uo pipefail
H=/home/mike/chunky
LOG=$H/render.log
SPP=512; ONLY=town,hallwall,ziggurat; WAIT=0
while [ $# -gt 0 ]; do case "$1" in --wait) WAIT=1;; --only) ONLY=$2; shift;; --spp) SPP=$2; shift;; esac; shift; done
say() { echo "$(date -u +%FT%TZ) $*" | tee -a $LOG; }
exec 9>>/home/mike/suite.lock
if [ $WAIT = 1 ]; then flock 9; elif ! flock -n 9; then say "SKIP: suite lock busy"; exit 0; fi
say "start views=$ONLY spp=$SPP"
DAY=$(date -u +%Y-%m-%d)
rsync -a --delete -e "ssh -i $H/../.ssh/chunky_pull -o IdentitiesOnly=yes -o BatchMode=yes" mike@10.0.0.40:world/ $H/world/ \
  || { say "FAIL: mirror pull"; exit 1; }
python3 -I $H/bin/scenes.py $H/scenes $H/world --spp $SPP --only $ONLY >> $LOG 2>&1 || { say "FAIL: scenes"; exit 1; }
mkdir -p $H/out/$DAY
CP="$H/lib/*"
rc_all=0
for v in ${ONLY//,/ }; do
  rm -rf $H/scenes/$v/snapshots $H/scenes/$v/$v.octree2 $H/scenes/$v/$v.dump $H/scenes/$v/$v.emittergrid
  t0=$(date +%s)
  timeout 75m nice -n 19 java -Xmx8G -Dchunky.home=$H/home -cp "$CP" se.llbit.chunky.main.Chunky \
      -scene-dir $H/scenes -texture $H/packs/faithful32x-1.21.8.zip -render $v -threads 14 -target $SPP -f >> $H/render-$v.log 2>&1
  rc=$?
  png=$(ls -t $H/scenes/$v/snapshots/*.png 2>/dev/null | head -1)
  if [ $rc -eq 0 ] && [ -n "$png" ]; then
    cp "$png" $H/out/$DAY/$v.png
    say "ok $v $(( $(date +%s) - t0 )) s $(stat -c %s $H/out/$DAY/$v.png) bytes"
  else
    say "FAIL $v rc=$rc after $(( $(date +%s) - t0 )) s (see render-$v.log)"; rc_all=1
  fi
done
if ls $H/out/$DAY/*.png >/dev/null 2>&1; then
  rsync -a -e "ssh -i $H/../.ssh/chunky_push -o IdentitiesOnly=yes -o BatchMode=yes" $H/out/$DAY mike@10.0.0.40:./ \
    && say "published $DAY -> showcase stills/chunky/$DAY/" || { say "FAIL: publish"; rc_all=1; }
fi
find $H/out -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
exit $rc_all
