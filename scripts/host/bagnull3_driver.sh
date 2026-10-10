#!/bin/bash
# bagnull3_driver.sh <workdir> <regdir>  -- the three-pool primary edges (10-10, round 3 Claude 2a), after any running
# readcost1920.sh (two heavy jobs at once distort timings and risk memory).
#   1. POSITIVE CONTROL: bagnull.py at its defaults (4 pools x 24 h) on two shipped cuts must reproduce
#      ~/bfnull/bagnull5.jsonl's records for those cuts EXACTLY (same seed per cut, same draws, same fields).
#   2. the null at 3 pools x 32 h, every cut, then bagbands.py on it.
D=${1:-$HOME/tp-work}; REG=${2:-$HOME/bfnull/regs2}
while pgrep -f "^bash $HOME/tp-work/readcost1920.sh" >/dev/null; do sleep 30; done
cd $D || exit 1
rm -f ctl.jsonl n3x32.jsonl
CUTS=2026-10-05T12:00:00+00:00,2026-10-07T06:00:00+00:00
BAGNULL_CUTS=$CUTS python3 bagnull.py $REG ctl.jsonl 2 > ctl.log 2>&1
python3 - <<'PY' > ctl.result
import json
cuts = {'2026-10-05T12:00:00+00:00', '2026-10-07T06:00:00+00:00'}
key = lambda r: (r['cut'], r['scheme'], tuple(r['draw'] or ()))
old = {key(r): r for r in map(json.loads, open('/home/mike/bfnull/bagnull5.jsonl')) if r['cut'] in cuts}
new = {key(r): r for r in map(json.loads, open('ctl.jsonl'))}
F = ('slots_did', 'full_share_did', 'pick_slots_did', 'sword_slots_did', 'cobble_slots_did')
same = set(old) == set(new) and all(all(abs((old[k].get(f) or 0) - (new[k].get(f) or 0)) < 1e-9 for f in F) for k in old)
print('POSITIVE CONTROL %s: %d shipped records, %d re-run, %s' % ('REPRODUCED' if same else 'MISMATCH', len(old), len(new),
      'identical keys and fields' if same else 'differs'))
PY
cat ctl.result
grep -q REPRODUCED ctl.result || exit 1
BAGNULL_K=3 BAGNULL_H=32 python3 bagnull.py $REG n3x32.jsonl 3 > n3x32.log 2>&1
python3 bagbands.py n3x32.jsonl > n3x32.bands.txt 2>&1
cat n3x32.bands.txt
