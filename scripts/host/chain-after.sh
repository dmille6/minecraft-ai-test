#!/bin/bash
# chain-after.sh <prev_run> <next_run> <sha_prefix>=<registration.json> [<sha_prefix>=<registration.json> ...]
# After <prev_run> reaches ANY terminal phase (promoted, torn-down, keep-unpromoted, end, error, refused*), wait for
# the canary lock, then launch <next_run> from the registration whose sha prefix matches the fleet's declared sha.
# The owner asked for <next_run> after <prev_run> whatever its verdict (10-02: "run explore-toward after the ore
# tunnel"). STOPs (with a reason in ~/chain-<next_run>.out) on: a canary still declared, no matching variant,
# an existing registration, a missing read, or a loop that dies before its first phase.
set -u
PREV=${1:?prev}; RUN=${2:?next}; shift 2
H=/home/mike; J=$H/canary-journal.jsonl; OUT=$H/chain-$RUN.out
say () { echo "$(date -u +%FT%TZ) $*" >> $OUT; }
say "waiting for $PREV to reach any terminal phase; variants: $*"
until grep "\"run\":\"$PREV\"" $J | grep -qE '"phase":"(promoted|torn-down|keep-unpromoted|end|error|refused[^"]*|preflight-refused)"'; do sleep 120; done
say "$PREV ended: $(grep "\"run\":\"$PREV\"" $J | tail -1 | cut -c1-240)"
until flock -n /tmp/mcai-canary.lock true; do sleep 30; done
sleep 60
FLEET=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or '')")
CANARY=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('canary_pool') or '')")
say "fleet declared_code_version=$FLEET canary_pool='$CANARY'"
[ -z "$CANARY" ] || { say "STOP: a canary pool is still declared ($CANARY)"; exit 2; }
SRC=""
for v in "$@"; do case "$FLEET" in "${v%%=*}"*) SRC="${v#*=}";; esac; done
[ -n "$SRC" ] || { say "STOP: no variant for fleet '$FLEET'"; exit 2; }
[ -e $H/mcai-analysis/registrations/$RUN.json ] && { say "STOP: $RUN already registered"; exit 2; }
for s in $(python3 -c "import json; print(' '.join(json.load(open('$SRC'))['reads']))"); do
  [ -f /tmp/$s.py ] || { say "STOP: read /tmp/$s.py missing"; exit 2; }
done
cp $SRC $H/mcai-analysis/registrations/$RUN.json
say "registered $RUN from $(basename $SRC) sha=$(python3 -c "import json; print(json.load(open('$SRC'))['sha'])")"
cd $H && setsid bash $H/canary-loop.sh $RUN </dev/null > $H/canary-loop-$RUN.out 2>&1 &
sleep 30
grep -q "\"run\":\"$RUN\"" $J && say "launched $RUN: $(grep "\"run\":\"$RUN\"" $J | tail -1 | cut -c1-160)" || say "WARNING: $RUN wrote no journal line in 30 s; see canary-loop-$RUN.out"
