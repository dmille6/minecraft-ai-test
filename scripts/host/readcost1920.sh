#!/bin/bash
# readcost1920.sh [minutes] [heavyread.sh] -- each registered bag-fix read, ONE AT A TIME, as a dry run (CANARY_DRYRUN:
# never emits) at window W = minutes (default 1920: a three-pool extension's final read), on three pools declared W
# minutes ago. Wall time and peak RSS per read, as the +1440 table in docs/reports/bagfix-registrations-2026-10-08.md.
# Read-only. Each read runs through heavyread.sh (the shared heavy-read lock: never beside the loop's read or another
# calibration job) with a MEASURING cap of 40G (HEAVYREAD_MAX; on the 96-GB host, so a read is measured, not killed).
W=${1:-1920}; HR=${2:-$HOME/mcai-analysis/heavyread.sh}
[ -f "$HR" ] || { echo "heavyread.sh not found at $HR"; exit 2; }
DECL=$(date -u -d "-$W min" +%Y-%m-%dT%H:%M:%SZ)
POOLS=board-b,hive-c,placebo-d
SHA=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or 'x')")
cd /opt/minecraft-ai/scripts || exit 1
for r in immobiledid toolhygieneread peacefulkitread wellread gridfixread stonecapread bagread; do
  O=$(mktemp)
  # HOME points at an empty dir: immobiledid does not honour CANARY_DRYRUN for its evidence and emits into ~/digest/reads
  # through ~/readjson.py (10-10: it wrote <manifest run_id>-immobiledid-1920.json, removed); without readjson it only prints
  HOME=$(mktemp -d) CANARY_DRYRUN="$POOLS:$SHA:$DECL" HEAVYREAD_MAX=${HEAVYREAD_MAX:-40G} \
    bash "$HR" 1800 "$O" -- /usr/bin/time -v python3 /tmp/$r.py $W
  RC=$?
  WALL=$(grep -a "Elapsed (wall clock)" $O | awk '{print $NF}')
  RSS=$(grep -a "Maximum resident set size" $O | awk '{printf "%.1f GB", $NF/1048576}')
  echo "$r W=$W rc=$RC wall=$WALL peak=$RSS last: $(grep -av '^\s' $O | grep -av '^heavyread' | tail -1 | cut -c1-120) $(grep -a '^heavyread' $O | tail -1 | cut -c1-120)"
  rm -f $O
done
