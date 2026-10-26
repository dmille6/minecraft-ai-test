#!/bin/bash
# dump-world.sh <world> <hx> <hy> <hz> <out.json>  -- READ-ONLY terrain dump of a fleet world around its home, for a sandbox
# terrain fixture: cp the region files covering home +-64 into a temp dir on 10.0.0.30, townplan_blockdump.py over the COPIES
# (home +-50, y home-16 .. home+32), the dump fetched here, the temp dir removed.
set -u
W=$1 HX=$2 HY=$3 HZ=$4 OUT=$5
HERE=$(cd "$(dirname "$0")" && pwd)
TB=${TB:?set TB to scripts/host/townplan_blockdump.py from a checkout that has it (shop-on-7049da1)}
T=$(ssh -o BatchMode=yes 10.0.0.30 'mktemp -d /tmp/terrain-dump.XXXXXX') || exit 3
trap 'ssh -o BatchMode=yes 10.0.0.30 "rm -rf $T"' EXIT
scp -q "$TB" 10.0.0.30:"$T/" || exit 3
ssh -o BatchMode=yes 10.0.0.30 "mkdir -p $T/region && for x in \$(( ($HX - 64) >> 9 )) \$(( ($HX + 64) >> 9 )); do for z in \$(( ($HZ - 64) >> 9 )) \$(( ($HZ + 64) >> 9 )); do f=/srv/block2/$W/world/region/r.\$x.\$z.mca; [ -f \$f ] && cp \$f $T/region/; done; done; nice -n 19 python3 -I $T/townplan_blockdump.py $T/region --box $((HX - 50)) $((HZ - 50)) $((HX + 50)) $((HZ + 50)) --y $((HY - 16)) $((HY + 32)) --out $T/dump.json" || exit 4
scp -q 10.0.0.30:"$T/dump.json" "$OUT" || exit 5
python3 -c "import json,sys; d=json.load(open('$OUT')); print('$W', d['box'], d['y'], 'palette', len(d['palette']), 'missing', d['missing'])"
