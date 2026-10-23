#!/bin/bash
# run_all.sh SNAP SCAN OUTDIR -- every design-1/design-2 replay in order, read-only. The host is only read (hostbaseline
# runs the gate's own baseline code there through ssh stdin and writes nothing). ~30-40 min.
set -eu
SNAP=$1; SCAN=$2; OUT=$3; HERE=$(cd "$(dirname "$0")" && pwd); P=$HERE/patches; M=$SNAP/mcai-analysis
mkdir -p "$OUT"
python3 "$HERE/lanetime.py" "$SNAP" 2026-10-19T00:00:00Z 2026-10-23T12:17:00Z > "$OUT/lanetime.out"
python3 "$HERE/attrib.py" "$SNAP" "$SCAN" "$M" "$P" > "$OUT/attrib.out"
python3 "$HERE/replay_settle.py" "$SNAP" "$SCAN" "$M" "$P" --json "$OUT/settle.jsonl" > "$OUT/settle.out"
python3 "$HERE/flips.py" "$SNAP" "$SCAN" "$M" "$P" "$OUT/settle.jsonl" --emit-queries "$OUT/r1-queries.json" > "$OUT/flips-approx.out"
python3 "$HERE/hostbaseline.py" "$OUT/r1-queries.json" | ssh 10.0.0.31 'nice -n 19 python3 -B -' > "$OUT/r1-host.json"
python3 "$HERE/flips.py" "$SNAP" "$SCAN" "$M" "$P" "$OUT/settle.jsonl" --host-r1 "$OUT/r1-host.json" > "$OUT/flips.out"
python3 "$HERE/replay_lookahead.py" "$SNAP" "$SCAN" "$M" "$P" "$SNAP/queues" > "$OUT/lookahead.out"
python3 "$HERE/replay_lookahead.py" "$SNAP" "$SCAN" "$M" "$P" "$SNAP/queues" --after-ordering > "$OUT/lookahead-after-ordering.out"
echo DONE
