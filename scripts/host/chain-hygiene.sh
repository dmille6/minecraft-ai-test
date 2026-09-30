#!/bin/bash
# chain-hygiene.sh -- owner 09-30: hygiene-01 runs right after lastswing-01, before the fixes bundle. Waits for
# lastswing-01 to END (promoted or torn-down); launches hygiene-01 ONLY on the promoted last-swing sha (8ed9450).
# Anything unexpected: stop and say so; never guess a sha.
set -u
H=/home/mike; J=$H/canary-journal.jsonl; OUT=$H/chain-hygiene.out
say () { echo "$(date -u +%FT%TZ) $*" >> $OUT; }
say "waiting for lastswing-01 to end"
until grep '"run":"lastswing-01"' $J | grep -qE '"phase":"(promoted|torn-down|end|error|refused)"'; do sleep 120; done
LAST=$(grep '"run":"lastswing-01"' $J | tail -1)
say "lastswing-01 ended: $(echo "$LAST" | cut -c1-200)"
echo "$LAST" | grep -qE '"phase":"(promoted|torn-down)"' || { say "STOP: lastswing-01 ended abnormally; not launching"; exit 2; }
# the loop may still be finishing (teardown restarts, verification): wait for its lock
until flock -n /tmp/mcai-canary.lock true; do sleep 30; done
sleep 60
FLEET=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version') or '')")
CANARY=$(python3 -c "import json; print(json.load(open('/srv/mcbots/trial-manifest.json')).get('canary_pool') or '')")
say "fleet declared_code_version=$FLEET canary_pool='$CANARY'"
[ -z "$CANARY" ] || { say "STOP: a canary pool is still declared ($CANARY)"; exit 2; }
# HYGIENE IS BUILT ON LAST-SWING: it may only follow a PROMOTED last-swing. On any other fleet sha, stop (it would carry
# last-swing back in) and let the operator rebuild it.
case "$FLEET" in
  8ed9450*) SRC=$H/mcai-analysis/hygiene-01.8ed9450.json ;;
  *) say "STOP: fleet is '$FLEET', not the promoted last-swing 8ed9450 -- hygiene (built on last-swing) needs a rebuild"; exit 2 ;;
esac
[ -e $H/mcai-analysis/registrations/hygiene-01.json ] && { say "STOP: hygiene-01 already registered"; exit 2; }
# THE REGISTRATION'S MANUAL STEP, AUTOMATED: only pools with >= 2 bots at >= 34 slots may be drawn (temporary, tagged
# exclusions for the rest). A failed positive control stops the chain rather than drawing blind.
python3 $H/hygiene-pool-check.py --apply >> $OUT 2>&1 || { say "STOP: the slot-pressure pool check failed"; exit 2; }
cp $SRC $H/mcai-analysis/registrations/hygiene-01.json
say "registered hygiene-01 from $(basename $SRC) sha=$(python3 -c "import json; print(json.load(open('$SRC'))['sha'])")"
cd $H && setsid bash $H/canary-loop.sh hygiene-01 </dev/null > $H/canary-loop-hygiene-01.out 2>&1 &
sleep 20
pgrep -af "canary-loop.sh hygiene-01" | grep -v pgrep >> $OUT
say "launched"
