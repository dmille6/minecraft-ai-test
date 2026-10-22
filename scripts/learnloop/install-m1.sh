#!/bin/bash
# install-m1.sh -- install (or update) the learning-loop M1 nightly archive. Run FROM THE MAC in a checkout of the commit
# being installed:   bash scripts/learnloop/install-m1.sh [--dry-run]
#
#   10.0.0.31 (block2-bots)   ~/learnloop/app/scripts/{learnloop,lib}/  the pipeline (copied, with VERSION = the commit)
#                             ~/.ssh/id_learnloop_relay                 created once; its public half goes to .30
#                             crontab: 50 1 * * * nightly.py --tick     (nice 19, ionice -c3; log ~/learnloop/cron.log)
#   10.0.0.30 (block2-worlds) ~/bin/learnloop-relay.sh                  the forced command (nas-relay.sh)
#                             ~/.ssh/authorized_keys += restrict,from="10.0.0.31",command=".../learnloop-relay.sh" <key>
#   NAS (10.0.0.5)            /volume1/homes/mike/learnloop/daily/<day>/ written ONLY by the relay, with .30's
#                             existing id_esbackup key. No new key on the NAS, no NAS access from .31.
# Idempotent: re-running updates the files, keeps the key, never duplicates the authorized_keys or cron line.
# fleetstatus.py's header line is NOT installed here (the owner installs that file; see the report).
set -euo pipefail
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY=1
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse HEAD); [ -z "$(git status --porcelain scripts/learnloop scripts/lib)" ] || { echo "REFUSED: uncommitted changes under scripts/learnloop or scripts/lib"; exit 2; }
B=10.0.0.31; W=10.0.0.30
CRON='50 1 * * * cd /home/mike/learnloop/app/scripts/learnloop && PATH=/usr/bin:/bin /usr/bin/nice -n 19 /usr/bin/ionice -c3 /usr/bin/python3 -B nightly.py --tick >> /home/mike/learnloop/cron.log 2>&1'
run() { if [ -n "$DRY" ]; then echo "  (dry) $*"; else "$@"; fi; }
echo "== tests here (the relay and drop16 tests need GNU tools: they run on $B below)"
python3 scripts/learnloop/test_learnloop.py > /tmp/ll-test.out 2>&1 || { tail -5 /tmp/ll-test.out; echo "REFUSED: tests fail"; exit 2; }
tail -1 /tmp/ll-test.out
echo "== 1. app on $B at $SHA"
run ssh "$B" 'mkdir -p ~/learnloop/app/scripts/learnloop ~/learnloop/app/scripts/lib'
run scp -q scripts/learnloop/extract_triples.py scripts/learnloop/nightly.py scripts/learnloop/sysprompts.py scripts/learnloop/sysprompt.mjs \
    scripts/learnloop/build_dataset.py scripts/learnloop/nas-relay.sh scripts/learnloop/test_learnloop.py \
    scripts/learnloop/test_learnloop_mutants.py "$B:learnloop/app/scripts/learnloop/"
run scp -q scripts/lib/estelemetry.py scripts/lib/telemetry.py "$B:learnloop/app/scripts/lib/"
# THE REMOTE TESTS GATE THE INSTALL: the exit status is the test's, not tail's (Claude r1 P2-5)
run ssh "$B" "echo $SHA > ~/learnloop/app/scripts/learnloop/VERSION && cd ~/learnloop/app/scripts/learnloop && python3 -B test_learnloop.py > /tmp/ll-test.out 2>&1; rc=\$?; tail -1 /tmp/ll-test.out; grep -q ' 0 skipped' /tmp/ll-test.out || rc=9; exit \$rc" \
  || { echo "REFUSED: the tests failed (or skipped) on $B -- nothing else installed"; exit 2; }
echo "== 2. relay key on $B, forced command on $W"
run ssh "$B" '[ -f ~/.ssh/id_learnloop_relay ] || ssh-keygen -q -t ed25519 -N "" -C learnloop-relay-from-31 -f ~/.ssh/id_learnloop_relay'
run scp -q scripts/learnloop/nas-relay.sh "$W:bin/learnloop-relay.sh"
if [ -z "$DRY" ]; then
  PUB=$(ssh "$B" 'cat ~/.ssh/id_learnloop_relay.pub')
  echo "$PUB" | grep -qE '^ssh-ed25519 [A-Za-z0-9+/=]+ learnloop-relay-from-31$' || { echo "REFUSED: unexpected public key"; exit 2; }
  # grouped (Claude r1 P3): a failing chmod or syntax check stops here and never appends the key
  ssh "$W" "chmod 755 ~/bin/learnloop-relay.sh && bash -n ~/bin/learnloop-relay.sh" || { echo "REFUSED: relay script not installable on $W"; exit 2; }
  ssh "$W" "grep -q learnloop-relay-from-31 ~/.ssh/authorized_keys || { cp -p ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak-learnloop-\$(date -u +%Y%m%dT%H%M%SZ) && echo 'restrict,from=\"10.0.0.31\",command=\"/home/mike/bin/learnloop-relay.sh\" $PUB' >> ~/.ssh/authorized_keys; }"
  ssh "$B" 'ssh -i ~/.ssh/id_learnloop_relay -o BatchMode=yes -o StrictHostKeyChecking=accept-new mike@10.0.0.30 status'
fi
echo "== 3. cron on $B"
if [ -z "$DRY" ]; then
  ssh "$B" "crontab -l > ~/learnloop/crontab.bak-\$(date -u +%Y%m%dT%H%M%SZ); crontab -l | grep -q 'learnloop/app/scripts/learnloop && ' || (crontab -l; echo '$CRON') | crontab -; crontab -l | grep learnloop"
else
  echo "  (dry) add: $CRON"
fi
echo "INSTALLED $SHA"
