#!/bin/bash
# chain-next.sh <prev_run> <fleet_prefix> <next_run> <registration.json> -- generalised chain-ore.sh (10-02).
# After <prev_run> ENDS promoted with the fleet declared at <fleet_prefix>*, register <next_run> from the given file and
# launch the canary loop. ANY other ending (torn-down, refused-*, error, a different fleet sha, a canary still declared,
# a registration already present, a missing read) -> STOP and say why. Never guesses. Exit 0 only after a launch.
set -u
PREV=${1:?prev run}; WANT=${2:?fleet sha prefix}; RUN=${3:?next run}; SRC=${4:?registration file}
H=/home/mike; J=$H/canary-journal.jsonl; OUT=$H/chain-$RUN.out
say () { echo "$(date -u +%FT%TZ) $*" >> $OUT; }
say "waiting for $PREV to end (want fleet $WANT*, then $RUN from $SRC)"
until grep "\"run\":\"$PREV\"" $J | grep -qE '"phase":"(promoted|torn-down|keep-unpromoted|end|error|refused[^"]*|preflight-refused)"'; do sleep 120; done
LAST=$(grep "\"run\":\"$PREV\"" $J | tail -1)
say "$PREV ended: $(echo "$LAST" | cut -c1-240)"
echo "$LAST" | grep -q '"phase":"promoted"' || { say "STOP: $PREV did not end promoted; not launching $RUN"; exit 2; }
until flock -n /tmp/mcai-canary.lock true; do sleep 30; done
sleep 60
FLEET=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or '')")
CANARY=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('canary_pool') or '')")
say "fleet declared_code_version=$FLEET canary_pool='$CANARY'"
[ -z "$CANARY" ] || { say "STOP: a canary pool is still declared ($CANARY)"; exit 2; }
case "$FLEET" in "$WANT"*) ;; *) say "STOP: unexpected fleet sha '$FLEET' (want $WANT)"; exit 2 ;; esac
[ -e $H/mcai-analysis/registrations/$RUN.json ] && { say "STOP: $RUN already registered"; exit 2; }
for s in $(python3 -c "import json; print(' '.join(json.load(open('$SRC'))['reads']))"); do
  [ -f /tmp/$s.py ] || { say "STOP: read /tmp/$s.py missing"; exit 2; }
done
cp $SRC $H/mcai-analysis/registrations/$RUN.json
say "registered $RUN from $(basename $SRC) sha=$(python3 -c "import json; print(json.load(open('$SRC'))['sha'])")"
cd $H && setsid bash $H/canary-loop.sh $RUN </dev/null > $H/canary-loop-$RUN.out 2>&1 &
sleep 20
pgrep -af "canary-loop.sh $RUN" | grep -v pgrep >> $OUT
say "launched $RUN"
