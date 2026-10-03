#!/usr/bin/env bash
# One fresh bot session per arm per round, ABBA order, so drift in the server lands on both arms.
# usage: CRAFT_REPO=<checkout with sandbox/run-bot.sh> ./abba.sh <candRoot> <ctrlRoot> [scenes] [server]
cd "$(dirname "$0")"
CAND="$1"; CTRL="$2"
S="${3:-full35,full36,full36-chain,race-early,race-late,race-stream,logs,wear,wear-open,nothing}"
SRV="${4:-sandbox}"
for arm in cand ctrl ctrl cand cand ctrl; do
  root=$CAND; [[ $arm == ctrl ]] && root=$CTRL
  node craftroom-ab.cjs "$arm" "$root" 1 "$S" "$SRV"
done
echo ABBA-DONE
