#!/usr/bin/env bash
# ONE BUILD, ONE LABEL, DERIVED — NEVER TYPED.
#
# 2026-08-26: two different builds ran simultaneously under the label
# `swim-not-tread` (+8954f5 and +1f9cfd). config.mjs already warns that
# CODE_VERSION "is a CLAIM about what is running", and the srcDigest half
# caught the divergence — the half a human types is the half that lied.
#
# So this script is the only sanctioned way to put code on the fleet, and it
# derives the label from git. A dirty tree refuses outright: a label that says
# d64d75c while the tree has uncommitted edits is the same lie in a subtler form.
set -euo pipefail
HOST="${HOST:-10.0.0.31}"
KEY="${KEY:-$HOME/.ssh/id_ed25519_aiservers}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/bots/src"

cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain -- bots/src)" ]; then
  echo "REFUSING: bots/src has uncommitted changes. The version label would be a lie." >&2
  git status --short -- bots/src >&2
  exit 1
fi
SHA=$(git rev-parse --short HEAD)
echo "deploying $SHA to the whole fleet"

( cd bots && node scripts/run-tests.mjs >/tmp/deploy-tests.log 2>&1 ) || {
  echo "REFUSING: tests failed. Tail of /tmp/deploy-tests.log:" >&2; tail -20 /tmp/deploy-tests.log >&2; exit 1; }
echo "tests pass"

ssh -i "$KEY" -o BatchMode=yes "mike@$HOST" "mkdir -p /tmp/deploy-$SHA"
scp -i "$KEY" -o BatchMode=yes "$SRC"/*.mjs "mike@$HOST:/tmp/deploy-$SHA/" >/dev/null
ssh -i "$KEY" -o BatchMode=yes "mike@$HOST" "sudo bash -s $SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"
tar czf "/var/lib/mcai-archive/src-pre-$SHA-$(date +%H%M%S).tgz" -C /srv/mcbots/harness src 2>/dev/null || true
install -o mcbot -g mcbot -m 644 /tmp/deploy-$SHA/*.mjs /srv/mcbots/harness/src/

# TEAR DOWN EVERY CANARY. Leaving a drop-in behind is how a pool silently
# stays on old code while the manifest claims the fleet is uniform.
rm -rf /etc/systemd/system/mcbot@*.service.d
rm -rf /srv/mcbots/harness-canary /srv/mcbots/harness-obs /srv/mcbots/harness-descent /srv/mcbots/harness-swim
rm -f /srv/mcbots/harness/env/_canary.env /srv/mcbots/harness/env/_obs.env \
      /srv/mcbots/harness/env/_descent.env /srv/mcbots/harness/env/_swim.env
sed -i "s/^CODE_VERSION=.*/CODE_VERSION=$SHA/" /srv/mcbots/harness/env/*.env
python3 - "$SHA" <<'PY'
import json, sys, datetime
sha = sys.argv[1]; p = '/srv/mcbots/trial-manifest.json'
m = json.load(open(p))
m['declared_code_version'] = sha
m['declared_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
m['canary_pool'] = ''; m['canary_code_version'] = ''
json.dump(m, open(p, 'w'), indent=2)
PY
systemctl daemon-reload
n=0
for u in $(systemctl list-units 'mcbot@*' --no-legend | awk '{print $1}'); do
  systemctl restart "$u"; n=$((n+1)); sleep 4
done
echo "restarted $n bots on $SHA"
REMOTE
