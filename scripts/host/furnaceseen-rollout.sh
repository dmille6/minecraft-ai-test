#!/bin/bash
# furnaceseen-rollout.sh --check | --go <sha> -- furnaceseen-01's OWNER-DIRECT fleet rollout (cooperation tier B3; OWNER 10-23:
# "ships as an owner-direct TIER-1 rollout after ledger-01 is KEPT and promoted, with the read's replay check as the tripwire, not
# as a canary"). THE OWNER RUNS THIS on 10.0.0.31 as mike, from a checkout of this branch, in a lane gap (no canary declared). An
# agent never runs it. Pattern: matset-rollout.sh (branch matset-on-6e1afb5).
#
#   --check        the preconditions only: this host, the fleet declared on BASE (ledger-01's promoted canary sha), no canary
#                  declared, the scheduler slot free (holdtoken claim + immediate release), the tripwire's and the replay's
#                  selftests (with the golden table). Changes nothing.
#   --go <sha>     the same, then: hold the scheduler (holdtoken claim, 60 min), deploy <sha> fleet-wide with the deploy script
#                  copied out of the repo (CLAUDE.md), journal phase `owner-direct`, release the hold, install furnaceseentrip.py
#                  and furnaceseenread.py into ~/mcai-analysis, and print the tripwire and rollback commands.
#
# The sha must descend from BASE. If the fleet is not on BASE (ledger-01 not yet promoted, or promoted on its other variant, or the
# fleet moved on), this refuses: re-stack furnaceseen-01 on the new build first (the 69b3f6fe variant is its own branch).
set -u
BASE=69b3f6fe03307089c5f046220f03b9e85095c065      # ledger-01's chatgate VARIANT canary sha (ledger-on-3cc5f14)
MODE=${1:-}; SHA=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
MAN=/srv/mcbots/trial-manifest.json
fail() { echo "!! STOPPED: $*"; exit 1; }
case "$MODE" in --check) ;; --go) [ -n "$SHA" ] || fail "usage: $0 --go <sha>";; *) echo "usage: $0 --check | --go <sha>"; exit 2;; esac
[ "$(hostname)" = block2-bots ] || fail "run on 10.0.0.31 (block2-bots), not $(hostname)"
case "$REPO" in /opt/minecraft-ai*) fail "run from a checkout outside /opt/minecraft-ai (a deploy resets that tree)";; esac
DECL=$(python3 -c "import json; m=json.load(open('$MAN')); print(m.get('declared_code_version') or '')") || fail "cannot read $MAN"
POOL=$(python3 -c "import json; m=json.load(open('$MAN')); print(m.get('canary_pool') or '')")
[ "$DECL" = "$BASE" ] || fail "the fleet is declared on $DECL, not ledger-01's promoted build $BASE: ledger-01 must be KEPT and promoted on this variant first (or re-stack furnaceseen-01 on $DECL)"
[ -z "$POOL" ] || fail "a canary is declared on pool(s) '$POOL': not a lane gap"
echo "== fleet declared on ${BASE:0:8} (ledger-01 promoted); no canary declared"
if [ "$MODE" = --go ]; then
  git -C "$REPO" cat-file -e "$SHA^{commit}" 2>/dev/null || fail "$SHA is not a commit in this checkout"
  git -C "$REPO" merge-base --is-ancestor "$BASE" "$SHA" || fail "$SHA does not descend from the base $BASE"
fi
python3 -B "$HERE/furnaceseentrip.py" --selftest > /tmp/fseentrip-selftest.$$ 2>&1 || { cat /tmp/fseentrip-selftest.$$; fail "the tripwire's selftest failed"; }
echo "== tripwire selftest: $(tail -1 /tmp/fseentrip-selftest.$$)"; rm -f /tmp/fseentrip-selftest.$$
python3 -B "$HERE/furnaceseenread.py" --selftest --golden "$REPO/bots/test/fixtures/seenskip-golden.json" > /tmp/fseenread-selftest.$$ 2>&1 \
  || { cat /tmp/fseenread-selftest.$$; fail "the replay's selftest (the golden table) failed"; }
echo "== replay selftest: $(tail -1 /tmp/fseenread-selftest.$$)"; rm -f /tmp/fseenread-selftest.$$
TOKEN="furnaceseen-01-$$-$(date +%s%N)"
release() {   # the hold is OURS only (holdtoken releases nothing else); a failed release is loud and fails the run
  python3 "$HERE/holdtoken.py" release "$TOKEN" || { echo "!! the scheduler hold $TOKEN could NOT be released: run  python3 $HERE/holdtoken.py release $TOKEN"; exit 1; }
}
trap release EXIT          # registered BEFORE the claim, for --check and --go alike (Codex light r1 P2-3)
python3 "$HERE/holdtoken.py" claim "$TOKEN" 60 || fail "the scheduler slot is not free (holdtoken claim refused)"
if [ "$MODE" = --check ]; then
  echo "== CHECK PASSED: the slot was free (claimed; released on exit). Nothing deployed."
  exit 0
fi
NOTES="furnaceseen-01 OWNER-DIRECT (tier 1, cooperation tier B3; OWNER 10-23): the furnace drain skips the walk to a furnace a TOWNMATE found empty < 60 min ago (the town ledger, ledger-01) unless newer contrary evidence; order and skill share one pick; FURNACE_SEEN=off = the base. Tripwire furnaceseentrip.py (the replay check). Rollback = redeploy $BASE"
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh || fail "copy the deploy script"
sudo /root/d.sh "$SHA" furnaceseen-01-direct "$NOTES"; RC=$?
[ "$RC" = 0 ] || fail "deploy-fleet exited $RC (the hold is released on exit; read its output, and roll back with: sudo /root/d.sh $BASE furnaceseen-01-rollback \"furnaceseen-01 rollback\")"
python3 - "$T0" "$SHA" "$BASE" <<'EOF' || fail "journal append"
import json, sys
t0, sha, base = sys.argv[1], sys.argv[2], sys.argv[3]
row = {'ts': t0, 'run': 'furnaceseen-01', 'phase': 'owner-direct',
       'note': 'fleet-wide %s (base %s, ledger-01 promoted); OWNER 10-23 "ships as an owner-direct TIER-1 rollout ... with the read\'s '
               'replay check as the tripwire, not as a canary"; tripwire furnaceseentrip.py --since %s --version %s; rollback = redeploy %s'
               % (sha[:8], base[:8], t0, sha[:8], base[:8])}
open('/home/mike/canary-journal.jsonl', 'a').write(json.dumps(row) + '\n')
EOF
echo "== DEPLOYED ${SHA:0:8} fleet-wide at $T0; journalled phase owner-direct."
if ! { mkdir -p "$HOME/mcai-analysis" && cp -p "$HERE/furnaceseentrip.py" "$HERE/furnaceseenread.py" "$HOME/mcai-analysis/" \
       && cmp -s "$HERE/furnaceseentrip.py" "$HOME/mcai-analysis/furnaceseentrip.py" && cmp -s "$HERE/furnaceseenread.py" "$HOME/mcai-analysis/furnaceseenread.py"; }; then
  echo "!! THE TRIPWIRE WAS NOT INSTALLED (the deploy DID happen): copy it by hand --"
  echo "   mkdir -p ~/mcai-analysis && cp -p $HERE/furnaceseentrip.py $HERE/furnaceseenread.py ~/mcai-analysis/"
  echo "   or roll back: sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh && sudo /root/d.sh $BASE furnaceseen-01-rollback \"furnaceseen-01 rollback\""
  exit 1
fi
echo "== TRIPWIRE (every 30-60 min; BREACH -> roll back):"
echo "   cd ~/mcai-analysis && nice -n 19 python3 furnaceseentrip.py --since $T0 --version ${SHA:0:8}"
echo "== ROLLBACK: FIRST confirm no canary is declared (canary_pool empty in $MAN; tear any down in THREE steps), and that"
echo "   ${BASE:0:8} is still the build to return to (a later promotion makes it stale); then"
echo "   sudo cp /opt/minecraft-ai/scripts/deploy-fleet.sh /root/d.sh && sudo /root/d.sh $BASE furnaceseen-01-rollback \"furnaceseen-01 rollback\""
echo "   (the one-setting alternative without a redeploy of code: FURNACE_SEEN=off in the fleet env)"
