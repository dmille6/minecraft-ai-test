#!/bin/bash
# fleet-deploy <sha> <run_id> "<notes>" [--pool P]
#
# Wraps the deploy so it CANNOT report a false success. Two failures on
# 2026-09-10 motivated every line:
#   1. The deploy ran over SSH from a laptop that changed networks. The link
#      died after ONE bot restarted and the command still exited 0 -- that was
#      the local ssh client exiting, not the remote script. So: run detached on
#      the fleet host, poll the log, never trust the ssh exit status.
#   2. Five changes shipped inert in one day. So: refuse to report success
#      unless the verifier prints "all live bots on <sha>".
set -u
SHA=${1:?usage: fleet-deploy <sha> <run_id> "<notes>" [--pool P]}
RUN=${2:?run_id required}
NOTES=${3:?notes required}
shift 3
HOST=mike@10.0.0.31
LOG=/tmp/deploy-$SHA-$RUN.log   # per run: a reused per-sha log let a stale "canary split confirmed" line verify a later deploy (2026-09-14)

# EVERY ARGUMENT REACHES THE DEPLOY SCRIPT. The first version of this line
# passed only "$SHA $RUN": the notes never reached the manifest, and on
# 2026-09-11 00:15 UTC `--pool board-c` was silently dropped, so a canary went
# out FLEET-WIDE to all 80 bots and had to be rolled back. printf %q keeps the
# quoting intact across the ssh boundary.
# A CANARY BRANCHES FROM THE DEPLOYED BASELINE. 2026-09-16 08:20: a --pool deploy of a branch built on the PREVIOUS
# baseline removed two promoted changes from its ten bots for four minutes (torn down, recorded INCONCLUSIVE). So a
# --pool sha must be a descendant of the manifest's declared_code_version; BASE_OK=1 overrides for a deliberate
# reverse canary (rule v13) and is recorded in the notes by whoever sets it.
if printf '%s ' "$@" | grep -q -- '--pool' && [ -z "${BASE_OK:-}" ]; then
  BASE=$(ssh -o ConnectTimeout=15 $HOST 'python3 -c "import json;print(json.load(open(\"/srv/mcbots/trial-manifest.json\")).get(\"declared_code_version\",\"\"))"' 2>/dev/null)
  if [ -n "$BASE" ]; then
    REPO=$(git -C "$HOME/Documents/code-minecraft-ai" rev-parse --show-toplevel 2>/dev/null)
    git -C "$REPO" fetch -q origin 2>/dev/null
    if ! git -C "$REPO" merge-base --is-ancestor "$BASE" "$SHA" 2>/dev/null; then
      echo "REFUSED: canary $SHA is not a descendant of the deployed baseline $BASE (a canary branches from the DEPLOYED baseline; BASE_OK=1 for a deliberate reverse canary)"; exit 2
    fi
    echo "baseline check: $SHA descends from $BASE"
  else
    echo "baseline check: could not read declared_code_version; refusing a --pool deploy without it"; exit 2
  fi
fi
REMOTE_ARGS=$(printf '%q ' "$SHA" "$RUN" "$NOTES" "$@")
ssh -o ConnectTimeout=20 -o ServerAliveInterval=15 $HOST "
  set -e
  sudo git -C /opt/minecraft-ai fetch -q --all
  sudo git -C /opt/minecraft-ai checkout -q --detach $SHA   # the deploy script and the tripper come from the DEPLOYED tree (two-pool support, 2026-09-13)
  sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh
  nohup sudo /root/d.sh $REMOTE_ARGS > $LOG 2>&1 &
" || { echo "FAILED to launch the deploy"; exit 1; }
echo "remote args: $REMOTE_ARGS"
echo "deploy launched detached; polling $LOG"

for i in $(seq 1 120); do
  OUT=$(ssh -o ConnectTimeout=15 $HOST "tail -40 $LOG 2>/dev/null" 2>/dev/null)
  # CANARY MODE HAS ITS OWN SUCCESS LINE. deploy-fleet.sh prints "canary split
  # confirmed: <canary digest> <baseline digest>" and never "all live bots on
  # <sha>" for a --pool deploy, so the first version of this wait timed out on
  # a canary that had verified fine (2026-09-11 03:43, cooldown-20s-01).
  if grep -q "canary split confirmed" <<<"$OUT"; then
    echo "$OUT" | tail -6
    # The two digests come in arbitrary order (baseline first on 2026-09-11 04:52).
    grep -E "canary split confirmed:.*\b$SHA" <<<"$OUT" >/dev/null \
      && { echo "VERIFIED: canary $SHA is split from the baseline"; exit 0; } \
      || { echo "MISMATCH: the split names a different canary sha than $SHA"; exit 2; }
  fi
  if grep -q "all live bots on" <<<"$OUT"; then
    echo "$OUT" | tail -8
    grep -q "all live bots on $SHA" <<<"$OUT" \
      && { echo "VERIFIED: fleet is on $SHA"; exit 0; } \
      || { echo "MISMATCH: verifier named a different sha than $SHA"; exit 2; }
  fi
  # The verifier prints "no threshold tripped" on a CLEAN deploy, and the first
  # version of this grep matched it (2026-09-11 00:45, a good canary reported as
  # a problem). Match a tripped threshold only when it is not negated.
  grep -qiE "(^|[^o] )threshold tripped|ERROR|Traceback" <<<"$OUT" && { echo "$OUT" | tail -15; echo "DEPLOY REPORTED A PROBLEM"; exit 3; }
  sleep 15
done
echo "TIMED OUT after 30min without a verification line -- deploy state UNKNOWN, do not claim success"
exit 4
