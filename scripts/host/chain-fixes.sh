#!/bin/bash
# chain-fixes.sh -- owner 09-29 "bundle the small fixes"; owner 09-30 "run hygiene before the bundle". Waits for
# hygiene-01 to END (promoted or torn-down), picks the fixes-01 registration for the sha the fleet is then on, and launches
# the loop. 8ed9450 -> fixes2-on-8ed9450 df5611f; adc7658 -> fixes2-on-adc7658 c29568f (both: digsync + stale-stop +
# craft-advice + hive-progress + prereq-usable + tool-safe). Anything unexpected: stop and say so; never guess a sha.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; OUT=$H/chain-fixes.out
say () { echo "$(date -u +%FT%TZ) $*" >> $OUT; }
say "waiting for hygiene-01 to end"
until grep '"run":"hygiene-01"' $J | grep -qE '"phase":"(promoted|torn-down|end|error|refused)"'; do sleep 120; done
LAST=$(grep '"run":"hygiene-01"' $J | tail -1)
say "hygiene-01 ended: $(echo "$LAST" | cut -c1-200)"
echo "$LAST" | grep -qE '"phase":"(promoted|torn-down)"' || { say "STOP: hygiene-01 ended abnormally; not launching"; exit 2; }
until flock -n /tmp/mcai-canary.lock true; do sleep 30; done
sleep 60
FLEET=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or '')")
CANARY=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('canary_pool') or '')")
say "fleet declared_code_version=$FLEET canary_pool='$CANARY'"
[ -z "$CANARY" ] || { say "STOP: a canary pool is still declared ($CANARY)"; exit 2; }
case "$FLEET" in
  8ed9450*) SRC=$H/mcai-analysis/fixes-01.8ed9450.json ;;   # hygiene not promoted: the bundle on last-swing (df5611f)
  adc7658*) SRC=$H/mcai-analysis/fixes-01.adc7658.json ;;   # hygiene promoted: the bundle + hygiene (c29568f)
  *) say "STOP: unexpected fleet sha '$FLEET'"; exit 2 ;;
esac
[ -e $H/mcai-analysis/registrations/fixes-01.json ] && { say "STOP: fixes-01 already registered"; exit 2; }
for s in $(python3 -c "import json; print(' '.join(json.load(open('$SRC'))['reads']))"); do
  [ -f /tmp/$s.py ] || { say "STOP: read /tmp/$s.py missing"; exit 2; }
done
# HYGIENE'S DRAW FILTER IS NOT THE BUNDLE'S: drop the temporary slot-pressure exclusions it wrote (tagged), keep all others.
sed -i '/ hygiene-slot-pressure$/d' $H/mcai-analysis/draw-exclude.txt && say "cleared hygiene-slot-pressure draw exclusions"
cp $SRC $H/mcai-analysis/registrations/fixes-01.json
say "registered fixes-01 from $(basename $SRC) sha=$(python3 -c "import json; print(json.load(open('$SRC'))['sha'])")"
cd $H && setsid bash $H/canary-loop.sh fixes-01 </dev/null > $H/canary-loop-fixes-01.out 2>&1 &
sleep 20
pgrep -af "canary-loop.sh fixes-01" | grep -v pgrep >> $OUT
say "launched"
