#!/usr/bin/env bash
# bamboo -> sticks A/B: rep by rep, alternating which arm goes first. One fresh bot per trial.
cd "$(dirname "$0")"
CAND="$1"; CTRL="$2"; N="${3:-3}"
S="${4:-A,B,C,D,E,F,G,A20}"
for ((i=0; i<N; i++)); do
  if (( i % 2 == 0 )); then node bamboo-ab.cjs cand "$CAND" 1 "$S"; node bamboo-ab.cjs ctrl "$CTRL" 1 "$S"
  else node bamboo-ab.cjs ctrl "$CTRL" 1 "$S"; node bamboo-ab.cjs cand "$CAND" 1 "$S"; fi
done
echo BBAB-DONE
