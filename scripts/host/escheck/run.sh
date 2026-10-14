#!/usr/bin/env bash
# escheck/run.sh -- the whole Elasticsearch completeness check, read-only, on 10.0.0.31.
#
#   run.sh FIRST_DAY LAST_DAY [OUTDIR]       e.g. run.sh 2026-10-07 2026-10-14
#
# 1. files.py    one streaming walk of the JSONL files (nice 19, ionice idle; ~15 min for
#                8 days x 80 bots x 2 streams; single core). The cutoff is now-5min, rounded.
# 2. fbjournal.py filebeat's own dropped counters + the events-data rejection bodies (sudo -n).
# 3. esside.py   the same questions asked of ES, with the owner's read-only API key file.
# 4. reconcile.py gross loss + gross extras for EVERY bot-day (exact 4-field multisets).
# 5. compare.py  the join -> OUTDIR/summary.json.
# Nothing here writes to Elasticsearch, filebeat, or the log tree.
set -euo pipefail
FIRST=$1; LAST=$2
BIN=$(cd "$(dirname "$0")" && pwd)
OUT=${3:-$HOME/escheck/run-$(date -u +%Y%m%dT%H%MZ)}
CUTOFF=$(date -u -d '-5 min' +%Y-%m-%dT%H:%M:00Z)
mkdir -p "$OUT"
test -f "$HOME/.config/mcai/es-readonly.key" || { echo "no API key file yet"; exit 2; }
nice -n 19 ionice -c3 python3 "$BIN/files.py" --first "$FIRST" --last "$LAST" --cutoff "$CUTOFF" --out "$OUT" 2>"$OUT/files.log"
nice -n 10 python3 "$BIN/fbjournal.py" --since "$(date -u -d "$FIRST -1 day" +%Y-%m-%d)" --out "$OUT" >"$OUT/fbjournal.txt"
python3 "$BIN/esside.py" --run "$OUT" 2>"$OUT/esside.log" >/dev/null
nice -n 19 ionice -c3 python3 "$BIN/reconcile.py" --run "$OUT" 2>"$OUT/reconcile.log" >"$OUT/reconcile.txt"
python3 "$BIN/compare.py" --run "$OUT" | tee "$OUT/digest.txt"
