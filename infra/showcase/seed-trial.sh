#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: generate each candidate seed's world and score its sites for the town plan's
# 128 x 128 footprint (site_search.py). Results: /srv/showcase/ops/site-<seed>.json + .log, summary in
# /srv/showcase/ops/seed-trial.txt. Each world is wiped by the next world-init; the chosen seed is re-created after.
#   sudo setsid nohup bash seed-trial.sh 20261020 1020202620 7243910 314159265 > /srv/showcase/ops/seed-trial.out 2>&1 < /dev/null &
set -uo pipefail
T=/srv/showcase/tools/infra/showcase
OUT=/srv/showcase/ops
: > $OUT/seed-trial.txt
for seed in "$@"; do
  echo "== $(date -u +%FT%TZ) seed $seed"
  bash $T/world-init.sh "$seed" || { echo "seed $seed: world-init failed" | tee -a $OUT/seed-trial.txt; continue; }
  ( cd /srv/showcase/tools && python3 $T/site_search.py --server /srv/showcase/server --rings 3 --step 96 \
      --out $OUT/site-$seed.json > $OUT/site-$seed.log 2>&1 )
  python3 - "$OUT/site-$seed.json" "$seed" >> $OUT/seed-trial.txt <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f'seed {sys.argv[2]}: no result ({e})'); sys.exit(0)
b = d.get('best')
print(f"seed {sys.argv[2]}: {d['n_ok']} of {len(d['candidates'])} candidates pass; best "
      + (f"{b['x']},{b['z']} score {b['score']} core_relief {b['core_relief']} area_relief {b['area_relief']} "
         f"wet {b['area_wet']} canopy {b['area_canopy']} wood {b['wood_hits']} water@{b['nearest_water']} "
         f"base_y {b['base_y']}" if b else 'none'))
PY
  tail -1 $OUT/seed-trial.txt
done
echo "== $(date -u +%FT%TZ) done"
