#!/bin/bash
# readcost1920.sh [minutes] -- each registered bag-fix read, ONE AT A TIME, as a dry run (CANARY_DRYRUN: never emits)
# at window W = minutes (default 1920: a three-pool extension's final read), on three pools declared W minutes ago.
# Wall time and peak RSS per read, capped at 25 GB, as the +1440 table in docs/reports/bagfix-registrations-2026-10-08.md.
# Read-only. Run only with no other heavy read running (two heavy reads at once OOM'd the host on 10-08).
W=${1:-1920}
DECL=$(date -u -d "-$W min" +%Y-%m-%dT%H:%M:%SZ)
POOLS=board-b,hive-c,placebo-d
SHA=4970c91
cd /opt/minecraft-ai/scripts || exit 1
for r in immobiledid toolhygieneread peacefulkitread wellread gridfixread stonecapread bagread; do
  O=$(mktemp)
  # HOME points at an empty dir: immobiledid does not honour CANARY_DRYRUN for its evidence and emits into ~/digest/reads
  # through ~/readjson.py (10-10: it wrote <manifest run_id>-immobiledid-1920.json, removed); without readjson it only prints
  ( ulimit -v 26214400; CANARY_DRYRUN="$POOLS:$SHA:$DECL" HOME=$(mktemp -d) /usr/bin/time -v timeout 1800 python3 /tmp/$r.py $W > $O.out 2> $O )
  RC=$?
  WALL=$(grep -a "Elapsed (wall clock)" $O | awk '{print $NF}')
  RSS=$(grep -a "Maximum resident set size" $O | awk '{printf "%.1f GB", $NF/1048576}')
  echo "$r W=$W rc=$RC wall=$WALL peak=$RSS last: $(tail -1 $O.out | cut -c1-120) $(grep -a -m1 -E 'Error|Killed|MemoryError' $O | cut -c1-120)"
  rm -f $O $O.out
done
