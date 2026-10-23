#!/bin/bash
# matset-rollout.sh --check | --go <sha> -- matset-01's OWNER-DIRECT fleet rollout (building tier §3.4; tier 1, constants
# only: light review, npm test, a tripwire read; NOT a canary). THE OWNER RUNS THIS on 10.0.0.31 as mike, from a checkout
# of the matset branch, in a lane gap (no canary declared). An agent never runs it.
#
#   --check        the preconditions only: this host, the fleet on the base build, no canary declared, the scheduler slot
#                  free (holdtoken claim + immediate release), the tripwire's selftest. Changes nothing.
#   --go <sha>     the same, then: hold the scheduler (holdtoken claim, 60 min), deploy <sha> fleet-wide with the deploy
#                  script copied out of the repo (CLAUDE.md), journal phase `owner-direct`, release the hold, install
#                  matsettrip.py into ~/mcai-analysis, and print the tripwire and rollback commands.
#
# The sha must descend from BASE (the fleet build matset-01 was made on). If the fleet has moved on, this refuses: the
# change needs a successor variant on the new build first.
set -u
BASE=6e1afb52465d8f50658effe26224203004d9e5ac
MODE=${1:-}; SHA=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
MAN=/srv/mcbots/trial-manifest.json
fail() { echo "!! STOPPED: $*"; exit 1; }
case "$MODE" in --check) ;; --go) [ -n "$SHA" ] || fail "usage: $0 --go <sha>";; *) echo "usage: $0 --check | --go <sha>"; exit 2;; esac
[ "$(hostname)" = block2-bots ] || fail "run on 10.0.0.31 (block2-bots), not $(hostname)"
DECL=$(python3 -c "import json; m=json.load(open('$MAN')); print(m.get('declared_code_version') or '')") || fail "cannot read $MAN"
POOL=$(python3 -c "import json; m=json.load(open('$MAN')); print(m.get('canary_pool') or '')")
[ "$DECL" = "$BASE" ] || fail "the fleet is declared on $DECL, not matset-01's base $BASE: a successor variant is needed"
[ -z "$POOL" ] || fail "a canary is declared on pool(s) '$POOL': not a lane gap"
echo "== fleet declared on the base ${BASE:0:8}; no canary declared"
if [ "$MODE" = --go ]; then
  git -C "$HERE/../.." cat-file -e "$SHA^{commit}" 2>/dev/null || fail "$SHA is not a commit in this checkout"
  git -C "$HERE/../.." merge-base --is-ancestor "$BASE" "$SHA" || fail "$SHA does not descend from the base $BASE"
fi
python3 -B "$HERE/matsettrip.py" --selftest > /tmp/matsettrip-selftest.$$ 2>&1 || { cat /tmp/matsettrip-selftest.$$; fail "the tripwire's selftest failed"; }
echo "== tripwire selftest: $(tail -1 /tmp/matsettrip-selftest.$$)"; rm -f /tmp/matsettrip-selftest.$$
TOKEN="matset-01-$$-$(date +%s%N)"
python3 "$HERE/holdtoken.py" claim "$TOKEN" 60 || fail "the scheduler slot is not free (holdtoken claim refused)"
if [ "$MODE" = --check ]; then
  python3 "$HERE/holdtoken.py" release "$TOKEN"
  echo "== CHECK PASSED: the slot was free (claimed and released). Nothing deployed."
  exit 0
fi
trap 'python3 "$HERE/holdtoken.py" release "$TOKEN"' EXIT
NOTES="matset-01 OWNER-DIRECT (tier 1, building tier 3.4): sand target 64; glass/glass_pane off the junk list; 46 building parts PROTECTED, untargeted, always banked; stone_bricks/smooth_stone off PATHFINDER_SCAFFOLD; BUILD_RESERVE declared 512 each (unread). Rollback = redeploy $BASE"
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh || fail "copy the deploy script"
sudo /root/d.sh "$SHA" matset-01-direct "$NOTES"; RC=$?
[ "$RC" = 0 ] || fail "deploy-fleet exited $RC (the hold is released on exit; read its output, and roll back with: sudo /root/d.sh $BASE matset-01-rollback \"matset-01 rollback\")"
python3 - "$T0" "$SHA" <<'EOF' || fail "journal append"
import json, sys
t0, sha = sys.argv[1], sys.argv[2]
row = {'ts': t0, 'run': 'matset-01', 'phase': 'owner-direct',
       'note': 'fleet-wide %s (base 6e1afb52); OWNER 10-23 "build now ... matset-01 (tier 1, an owner-direct rollout with a tripwire)"; '
               'tripwire matsettrip.py --since %s --version %s; rollback = redeploy 6e1afb52' % (sha[:8], t0, sha[:8])}
open('/home/mike/canary-journal.jsonl', 'a').write(json.dumps(row) + '\n')
EOF
mkdir -p "$HOME/mcai-analysis" && cp -p "$HERE/matsettrip.py" "$HOME/mcai-analysis/matsettrip.py"
echo "== DEPLOYED ${SHA:0:8} fleet-wide at $T0; journalled phase owner-direct."
echo "== TRIPWIRE (every 30-60 min; BREACH -> roll back):"
echo "   cd ~/mcai-analysis && nice -n 19 python3 matsettrip.py --since $T0 --version ${SHA:0:8}"
echo "== ROLLBACK: sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh && sudo /root/d.sh $BASE matset-01-rollback \"matset-01 rollback\""
