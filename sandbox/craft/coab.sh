#!/usr/bin/env bash
# composter A/B: rep-by-rep, alternating which arm goes first (cand ctrl / ctrl cand / cand ctrl). One fresh bot per trial.
# usage: CRAFT_REPO=<checkout> ./coab.sh <candRoot> <ctrlRoot> [reps] [server]
cd "$(dirname "$0")"
CAND="$1"; CTRL="$2"; N="${3:-3}"; SRV="${4:-sandbox}"
CS="build30,build34,build35,build36,compost36,compost36-stuck20,stand-blocked"   # candidate
KS="build30,build34,build35,build36,compost36"                                    # control: no composter skills; same bags
for ((i=0; i<N; i++)); do
  if (( i % 2 == 0 )); then node composter-ab.cjs cand "$CAND" 1 "$CS" "$SRV"; node composter-ab.cjs ctrl "$CTRL" 1 "$KS" "$SRV"
  else node composter-ab.cjs ctrl "$CTRL" 1 "$KS" "$SRV"; node composter-ab.cjs cand "$CAND" 1 "$CS" "$SRV"; fi
done
echo COAB-DONE
