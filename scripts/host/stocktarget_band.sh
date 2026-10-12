#!/bin/bash
# stocktarget_band.sh <workdir>  -- the 3-pool x 32-h primary edge for stocktarget-01 (gate v35), BETWEEN CANARIES ONLY
# (heavyread refuses a calibration job while a canary is declared, a loop runs or the loop lock is held). ~1.5-2 h.
#   1. POSITIVE CONTROL: bagnull.py at its defaults (the five original runs, 4 x 24) on two shipped cuts must reproduce
#      ~/bfnull/bagnull5.jsonl exactly -- the same control the 10-10 edges passed.
#   2. the 3 x 32 null for stocktarget-01 ALONE (BAGNULL_RUNS), under its own draw_exposure filter, then bagbands.py.
#   3. add_edges3.py prints (never writes) the edge for every stocktarget-01 registration; commit it from the repo.
# Inputs: ~/gate-v35/heavyread.sh (or the installed ~/mcai-analysis/heavyread.sh), bagnull.py, bagbands.py, bagread.py,
# add_edges3.py in <workdir>; registrations dir with the stocktarget-01 files: ~/mcai-analysis (its <run>.<sha>.json).
D=${1:-$HOME/tp-work}; HR=$HOME/mcai-analysis/heavyread.sh; [ -f "$HR" ] || HR=$HOME/gate-v35/heavyread.sh
REG=$D/st-regs; rm -rf "$REG"; mkdir -p "$REG"
cp $HOME/bfnull/regs2/*.json "$REG"/ && cp $HOME/mcai-analysis/stocktarget-01.*.json "$REG"/ || exit 1
rm -f "$REG"/*.queue-entry.json
cd "$D" || exit 1
rm -f stctl.jsonl st3x32.jsonl
CUTS=2026-10-05T12:00:00+00:00,2026-10-07T06:00:00+00:00
BAGNULL_CUTS=$CUTS bash "$HR" 7200 stctl.log -- python3 bagnull.py "$REG" stctl.jsonl 2 || { echo "control run failed: $(tail -2 stctl.log)"; exit 1; }
python3 - <<'PY' || exit 1
import json, sys
cuts = {'2026-10-05T12:00:00+00:00', '2026-10-07T06:00:00+00:00'}
key = lambda r: (r['cut'], r['scheme'], tuple(r['draw'] or ()))
old = {key(r): r for r in map(json.loads, open('/home/mike/bfnull/bagnull5.jsonl')) if r['cut'] in cuts}
new = {key(r): r for r in map(json.loads, open('stctl.jsonl'))}
F = ('slots_did', 'full_share_did', 'pick_slots_did', 'sword_slots_did', 'cobble_slots_did')
same = set(old) == set(new) and all(all(abs((old[k].get(f) or 0) - (new[k].get(f) or 0)) < 1e-9 for f in F) for k in old)
print('POSITIVE CONTROL %s: %d shipped records, %d re-run' % ('REPRODUCED' if same else 'MISMATCH', len(old), len(new)))
sys.exit(0 if same else 1)
PY
BAGNULL_RUNS=stocktarget-01 BAGNULL_K=3 BAGNULL_H=32 bash "$HR" 21600 st3x32.log -- python3 bagnull.py "$REG" st3x32.jsonl 3 \
  || { echo "3x32 run failed: $(tail -2 st3x32.log)"; exit 1; }
python3 bagbands.py st3x32.jsonl
python3 add_edges3.py st3x32.jsonl.bands.json "$REG" | grep stocktarget
echo "bands: $D/st3x32.jsonl.bands.json -- in the repo: copy it to docs/reports/, then add_edges3.py <it> docs/reports --write, commit, restage"
