#!/bin/bash
# chain-ore.sh -- after fixes-02 ENDS: fleet f5609af (bundle promoted) -> oretunnel-01. Anything else: STOP, never guess.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; OUT=$H/chain-ore.out
say () { echo "$(date -u +%FT%TZ) $*" >> $OUT; }
say "waiting for fixes-02 to end"
until grep '"run":"fixes-02"' $J | grep -qE '"phase":"(promoted|torn-down|end|error|refused[^"]*)"'; do sleep 120; done
LAST=$(grep '"run":"fixes-02"' $J | tail -1)
say "fixes-02 ended: $(echo "$LAST" | cut -c1-200)"
echo "$LAST" | grep -qE '"phase":"(promoted|torn-down)"' || { say "STOP: fixes-02 ended abnormally; not launching"; exit 2; }
until flock -n /tmp/mcai-canary.lock true; do sleep 30; done
sleep 60
FLEET=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or '')")
CANARY=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('canary_pool') or '')")
say "fleet declared_code_version=$FLEET canary_pool='$CANARY'"
[ -z "$CANARY" ] || { say "STOP: a canary pool is still declared ($CANARY)"; exit 2; }
case "$FLEET" in
  f5609af*) RUN=oretunnel-01; SRC=$H/mcai-analysis/oretunnel-01.f5609af.json ;;
  *) say "STOP: unexpected fleet sha '$FLEET'"; exit 2 ;;
esac
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
