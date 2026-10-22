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
SHA=$(git rev-parse HEAD); [ -z "$(git status --porcelain scripts/learnloop scripts/lib scripts/host/drop16.sh bench/models/score.py)" ] || { echo "REFUSED: uncommitted changes under scripts/learnloop or scripts/lib"; exit 2; }
B=10.0.0.31; W=10.0.0.30
CRON='50 1 * * * cd /home/mike/learnloop/app/scripts/learnloop && PATH=/usr/bin:/bin /usr/bin/nice -n 19 /usr/bin/ionice -c3 /usr/bin/python3 -B nightly.py --tick >> /home/mike/learnloop/cron.log 2>&1'
run() { if [ -n "$DRY" ]; then echo "  (dry) $*"; else "$@"; fi; }
echo "== tests here (the relay and drop16 tests need GNU tools: they run on $B below)"
python3 scripts/learnloop/test_learnloop.py > /tmp/ll-test.out 2>&1 || { tail -5 /tmp/ll-test.out; echo "REFUSED: tests fail"; exit 2; }
tail -1 /tmp/ll-test.out
echo "== 0. node on $B is the one cron's PATH (/usr/bin:/bin) finds (sysprompts.py runs it)"
NODE=$(ssh "$B" 'env -i PATH=/usr/bin:/bin sh -c "command -v node"')
case "$NODE" in /usr/bin/node|/bin/node) echo "  $NODE";; *) echo "REFUSED: cron cannot find node on $B (got '$NODE')"; exit 2;; esac
echo "== 1. app on $B at $SHA"
run ssh "$B" 'mkdir -p ~/learnloop/app/scripts/learnloop ~/learnloop/app/scripts/lib'
run scp -q scripts/learnloop/extract_triples.py scripts/learnloop/nightly.py scripts/learnloop/sysprompts.py scripts/learnloop/sysprompt.mjs \
    scripts/learnloop/build_dataset.py scripts/learnloop/nas-relay.sh scripts/learnloop/test_learnloop.py \
    scripts/learnloop/test_learnloop_mutants.py "$B:learnloop/app/scripts/learnloop/"
run scp -q scripts/lib/estelemetry.py scripts/lib/telemetry.py "$B:learnloop/app/scripts/lib/"
# the M3 evaluation runs from here on .31 (node + the deploy checkout, read with git archive only), never from
# /opt/minecraft-ai's working tree; score.py is the bench's own scorer
run ssh "$B" 'mkdir -p ~/learnloop/app/scripts/learnloop/train/bench'
run scp -q scripts/learnloop/train/replay_client.mjs scripts/learnloop/train/eval_offline.py scripts/learnloop/train/eval.sh \
    scripts/learnloop/train/test_eval.py "$B:learnloop/app/scripts/learnloop/train/"
run scp -q bench/models/score.py "$B:learnloop/app/scripts/learnloop/train/bench/"
# M2b: the reviewed drop16.sh is (re)staged as ~/drop16.sh with its sha256 printed, so the owner never runs an old copy
# NEVER over a running copy (Claude r5 P2; CLAUDE.md "bash re-reads a running script by byte offset"): refuse while
# a drop16 run holds the install-hold, and replace by RENAME (a new inode) rather than in place.
if [ -z "$DRY" ]; then
  # a mutating drop16 run always holds an install-hold named drop16:* (the canary lock is NOT checked: a canary loop
  # holds it for days, and the rename below already protects any running copy)
  busy=$(ssh "$B" 'o=$(python3 ~/gate-v36/holdtoken.py owner 2>/dev/null); case "$o" in drop16:*) echo "hold $o";; esac')
  [ -z "$busy" ] || { echo "REFUSED: not re-staging ~/drop16.sh while it may be running ($busy)"; exit 2; }
fi
run scp -q scripts/host/drop16.sh "$B:drop16.sh.new"
run ssh "$B" 'mv -f ~/drop16.sh.new ~/drop16.sh'
if [ -z "$DRY" ]; then
  WANT=$(shasum -a 256 scripts/host/drop16.sh | cut -c1-64); GOT=$(ssh "$B" 'sha256sum ~/drop16.sh' | cut -c1-64)
  [ "$WANT" = "$GOT" ] || { echo "REFUSED: ~/drop16.sh on $B is $GOT, the branch file is $WANT"; exit 2; }
  echo "  ~/drop16.sh sha256 $GOT = the branch file"
fi
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
