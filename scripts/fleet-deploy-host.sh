#!/bin/bash
# fleet-deploy (HOST copy, on .31) -- same contract as the Mac wrapper: <sha> <run_id> "<notes>" [--pool P,Q]; refuses a
# --pool sha that does not descend from the manifest's declared_code_version (BASE_OK=1 overrides); runs the deploy
# script from a copy outside the repo; refuses to report success unless the verifier prints the success line.
set -u
SHA=${1:?usage: fleet-deploy <sha> <run_id> "<notes>" [--pool P]}; RUN=${2:?run_id}; NOTES=${3:?notes}; shift 3
LOG=/tmp/deploy-$SHA-$RUN.log; MAN=/srv/mcbots/trial-manifest.json
sudo git -C /opt/minecraft-ai fetch -q --all 2>/dev/null
if printf '%s ' "$@" | grep -q -- '--pool' && [ -z "${BASE_OK:-}" ]; then
  BASE=$(python3 -c "import json;print(json.load(open('$MAN')).get('declared_code_version',''))")
  [ -n "$BASE" ] || { echo "baseline check: no declared_code_version; refusing"; exit 2; }
  sudo git -C /opt/minecraft-ai merge-base --is-ancestor "$BASE" "$SHA" 2>/dev/null || { echo "REFUSED: $SHA is not a descendant of the deployed baseline $BASE (BASE_OK=1 for a deliberate reverse canary)"; exit 2; }
  echo "baseline check: $SHA descends from $BASE"
fi
sudo git -C /opt/minecraft-ai checkout -q --detach "$SHA" || { echo "checkout of $SHA failed"; exit 2; }
sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh
nohup sudo /root/d.sh "$SHA" "$RUN" "$NOTES" "$@" > "$LOG" 2>&1 &
echo "deploy launched; polling $LOG"
for i in $(seq 1 120); do
  sleep 10
  if grep -q "canary split confirmed\|all live bots on $SHA" "$LOG" 2>/dev/null; then
    if printf '%s ' "$@" | grep -q -- '--pool'; then echo "VERIFIED: canary $SHA is split from the baseline"; else echo "VERIFIED: fleet is on $SHA"; fi
    exit 0
  fi
  if grep -q "MIXED CODE\|FAILED\|refusing\|halt" "$LOG" 2>/dev/null; then echo "FAILED: $(grep -m1 'MIXED CODE\|FAILED\|refusing\|halt' "$LOG")"; exit 1; fi
done
echo "timed out waiting for the verifier; last lines:"; tail -5 "$LOG"; exit 1
