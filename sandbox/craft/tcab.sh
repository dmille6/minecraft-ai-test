#!/usr/bin/env bash
# spent-tool A/B: rep by rep, alternating which arm goes first. One fresh bot per trial.
cd "$(dirname "$0")"
CAND="$1"; CTRL="$2"; N="${3:-3}"
S="axe5,shovel4,axes90-3,picks1x3-50,pick1-only,travel-shovel1-filler,travel-shovel1"
for ((i=0; i<N; i++)); do
  if (( i % 2 == 0 )); then node tools-ab.cjs cand "$CAND" 1 "$S"; node tools-ab.cjs ctrl "$CTRL" 1 "$S"
  else node tools-ab.cjs ctrl "$CTRL" 1 "$S"; node tools-ab.cjs cand "$CAND" 1 "$S"; fi
done
echo TCAB-DONE
