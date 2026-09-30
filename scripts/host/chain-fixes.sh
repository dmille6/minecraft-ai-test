#!/bin/bash
# chain-fixes.sh -- owner 09-29: "run last-swing next, and bundle the small fixes". Waits for lastswing-01 to END
# (promoted or torn-down), picks the fixes-01 registration for the sha the fleet is then on, and launches the loop.
# 1d107ed -> fixes-bundle ecf33b6 (no prereq-usable); 8ed9450 -> fixes-bundle-on-8ed9450 25a8397 (+ prereq-usable).
# Anything unexpected: stop and say so; never guess a sha. Written 2026-09-30 by the daily session.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; OUT=$H/chain-fixes.out
say () { echo "$(date -u +%FT%TZ) $*" >> $OUT; }
say "waiting for lastswing-01 to end"
until grep '"run":"lastswing-01"' $J | grep -qE '"phase":"(promoted|torn-down|end|error|refused)"'; do sleep 120; done
LAST=$(grep '"run":"lastswing-01"' $J | tail -1)
say "lastswing-01 ended: $(echo "$LAST" | cut -c1-200)"
echo "$LAST" | grep -qE '"phase":"(promoted|torn-down)"' || { say "STOP: lastswing-01 ended abnormally; not launching"; exit 2; }
until flock -n /tmp/mcai-canary.lock true; do sleep 30; done
sleep 60
FLEET=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or '')")
CANARY=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('canary_pool') or '')")
say "fleet declared_code_version=$FLEET canary_pool='$CANARY'"
[ -z "$CANARY" ] || { say "STOP: a canary pool is still declared ($CANARY)"; exit 2; }
case "$FLEET" in
  1d107ed*) SRC=$H/mcai-analysis/fixes-01.1d107ed.json ;;
  8ed9450*) SRC=$H/mcai-analysis/fixes-01.8ed9450.json ;;
  *) say "STOP: unexpected fleet sha '$FLEET'"; exit 2 ;;
esac
[ -e $H/mcai-analysis/registrations/fixes-01.json ] && { say "STOP: fixes-01 already registered"; exit 2; }
for s in $(python3 -c "import json; print(' '.join(json.load(open('$SRC'))['reads']))"); do
  [ -f /tmp/$s.py ] || { say "STOP: read /tmp/$s.py missing"; exit 2; }
done
cp $SRC $H/mcai-analysis/registrations/fixes-01.json
say "registered fixes-01 from $(basename $SRC) sha=$(python3 -c "import json; print(json.load(open('$SRC'))['sha'])")"
cd $H && setsid bash $H/canary-loop.sh fixes-01 </dev/null > $H/canary-loop-fixes-01.out 2>&1 &
sleep 20
pgrep -af "canary-loop.sh fixes-01" | grep -v pgrep >> $OUT
say "launched"
