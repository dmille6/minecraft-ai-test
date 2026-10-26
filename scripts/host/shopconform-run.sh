#!/bin/bash
# shopconform-run.sh <world> <records> <pool> <out.json>  -- one RECORD CONFORMANCE survey, run from the CONTROLLER (the Mac).
#   <world>    the world's directory name under /srv/block2 on 10.0.0.30 (board-a, sandbox8, ...)
#   <records>  where the town's project-*.shop.g*.json live: a local directory, or 31:<dir> (on 10.0.0.31, e.g.
#              31:/var/lib/mcai/_pool-board-a)
#   <pool>     the pool name written into the survey (the read matches surveys to towns by it)
#   <out.json> where the survey lands (local path, or 31:<path> -- shopread.py reads ~/shopconform/surveys/*.json on 10.0.0.31)
# READ-ONLY on every host: the records are copied out by tar, the world's region files are copied (cp) by shopconform.py into
# its own temp dir on 10.0.0.30, and this script's own scratch there (/tmp/shopconform-run.*) is removed on every exit.
# NOT INSTALLED anywhere: the coordinator decides who runs it, and when (two surveys >= 1 h apart after a completion).
set -u
W=$1 REC=$2 POOL=$3 OUT=$4
case "$W" in *[!A-Za-z0-9_-]*|'') echo "bad world name"; exit 2;; esac
case "$POOL" in *[!A-Za-z0-9_-]*|'') echo "bad pool name"; exit 2;; esac
HERE=$(cd "$(dirname "$0")" && pwd)
BP="$HERE/../../bots/src/blueprints/workshop@1.json"
T=$(ssh -o BatchMode=yes 10.0.0.30 'mktemp -d /tmp/shopconform-run.XXXXXX') || exit 3
trap 'ssh -o BatchMode=yes 10.0.0.30 "rm -rf $T"' EXIT
scp -q "$HERE/shopconform.py" "$HERE/townplan_blockdump.py" 10.0.0.30:"$T/" || exit 3
scp -q "$BP" 10.0.0.30:"$T/workshop@1.json" || exit 3
ssh -o BatchMode=yes 10.0.0.30 "mkdir -p $T/records" || exit 3
case "$REC" in
  31:*) ssh -o BatchMode=yes 10.0.0.31 "cd '${REC#31:}' && tar -cf - project-*.shop.g*.json" | ssh -o BatchMode=yes 10.0.0.30 "tar -C $T/records -xf -" || exit 3 ;;
  *)    (cd "$REC" && COPYFILE_DISABLE=1 tar -cf - project-*.shop.g*.json) |ssh -o BatchMode=yes 10.0.0.30 "tar -C $T/records -xf -" || exit 3 ;;
esac
J=$(ssh -o BatchMode=yes 10.0.0.30 "nice -n 19 python3 -I $T/shopconform.py survey /srv/block2/$W/world --records $T/records --pool $POOL --blueprint $T/workshop@1.json")
RC=$?
case "$OUT" in
  31:*) printf '%s\n' "$J" | ssh -o BatchMode=yes 10.0.0.31 "mkdir -p \$(dirname '${OUT#31:}') && cat > '${OUT#31:}'" ;;
  *)    printf '%s\n' "$J" > "$OUT" ;;
esac
printf '%s\n' "$J" | python3 -c "import json,sys; d=json.load(sys.stdin); print({k: d.get(k) for k in ('pool','record_gen','region_mtime','cells','tp','fp','fn','unknown','f1','valid','why')}); print('bad', d.get('bad'))"
exit $RC
