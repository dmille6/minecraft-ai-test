#!/bin/bash
# drawsteady_replay.sh <dir holding drawsteady.py + bagread.py>  -- READ-ONLY replay of the 6-h release on the two past
# KEEP+promoted canaries whose 12-h windows are fully logged (towndeposit-02 and airpocket-01, 10-08), at +5.5 h (must
# hold: rule 1), +6.5 h, +8 h and +11 h. The manifest is synthesised as it was after each promotion (fleet version and
# declared_at); the ledger, journal and logs are the live files. docs/reports/threepool-2026-10-10.md.
D=${1:-$HOME/tp-work}
M=$(mktemp -d)
rp() {   # run sha declared_at decided_at hours...
  local run=$1 sha=$2 decl=$3 dec=$4; shift 4
  printf '{"declared_code_version": "%s", "declared_at": "%s", "canary_pool": "", "canary_code_version": ""}\n' "$sha" "$decl" > $M/$run.json
  for h in "$@"; do
    NOW=$(python3 -c "import datetime as d; print((d.datetime.fromisoformat('$dec') + d.timedelta(hours=$h)).isoformat())")
    echo "== $run at +$h h ($NOW)"
    STEADY_NOW=$NOW STEADY_MANIFEST=$M/$run.json python3 $D/drawsteady.py | grep -v '^STEADY REPLAY'
  done
}
rp towndeposit-02 92bc84f 2026-10-08T06:21:35+00:00 2026-10-08T06:21:28+00:00 5.5 6.5 8 11
rp airpocket-01 dbb4d78 2026-10-08T19:42:50+00:00 2026-10-08T19:42:42+00:00 5.5 6.5 8 11
rm -rf $M
