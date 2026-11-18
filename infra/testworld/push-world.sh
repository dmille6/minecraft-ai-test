#!/usr/bin/env bash
# FROM THE CONTROLLER: copy the showcase's nightly copy (pulled to block2-worlds at 04:15Z by showcase-pull.sh) to
# block2-bots, as incoming/<stamp>/showcase, for `testworld.py setup-world`. The two hosts hold no key to each other, so
# the stream passes through here (about 0.75 GB, two minutes). Reads block2-worlds; writes only /srv/testworld/incoming.
# Nothing is asked of the showcase VM. Runbook: docs/runbooks/testworld.md.
set -euo pipefail
SRC=${TESTWORLD_SRC_SSH:-mike@10.0.0.30}
DST=$("$(dirname "$0")/install.sh" --host)
O=(-o BatchMode=yes -o ConnectTimeout=15)
D=/srv/showcase-backup/src
hm=$(date -u +%H%M)
if [ "$hm" -ge 0410 ] && [ "$hm" -lt 0430 ]; then echo "REFUSED: the nightly pull runs 04:15Z; try after 04:30Z"; exit 2; fi
[ "$(ssh "${O[@]}" "$DST" hostname)" = block2-bots ] || { echo "REFUSED: $DST is not block2-bots"; exit 2; }
TS=$(ssh "${O[@]}" "$SRC" "date -u -r $D/showcase/world/level.dat +%Y%m%dT%H%MZ")
[ -n "$TS" ] || { echo "no level.dat in the nightly copy"; exit 3; }
if ssh "${O[@]}" "$DST" "test -e /srv/testworld/incoming/$TS"; then echo "already there: /srv/testworld/incoming/$TS/showcase"; exit 0; fi
sig() { ssh "${O[@]}" "$1" "cd $2 && find world world_the_end -type f -printf '%P %s\n' | sort | sha256sum | cut -c1-16"; }
before=$(sig "$SRC" "$D/showcase")
ssh "${O[@]}" "$DST" "mkdir -p /srv/testworld/incoming/$TS.part"
ssh "${O[@]}" "$SRC" "tar -C $D -cf - showcase" | ssh "${O[@]}" "$DST" "tar -C /srv/testworld/incoming/$TS.part -xf -"
after=$(sig "$SRC" "$D/showcase")
got=$(sig "$DST" "/srv/testworld/incoming/$TS.part/showcase")
if [ "$before" != "$after" ] || [ "$before" != "$got" ]; then
  echo "REFUSED: the copy changed while it was read, or arrived different (source $before / $after, copy $got); left at incoming/$TS.part"; exit 4
fi
ssh "${O[@]}" "$DST" "mv /srv/testworld/incoming/$TS.part /srv/testworld/incoming/$TS && du -sh /srv/testworld/incoming/$TS | cut -f1"
echo "copied the nightly copy saved $TS (world files match, signature $got): /srv/testworld/incoming/$TS/showcase"
