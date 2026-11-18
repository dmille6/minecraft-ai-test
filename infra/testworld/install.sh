#!/usr/bin/env bash
# FROM THE CONTROLLER (a worktree of this repo): install the test world's scripts and units on block2-bots.
# Idempotent. Starts no bot and no server; it enables the two timers (memory sample every 5 min, lease prune hourly),
# which write only under /srv/testworld. Runbook: docs/runbooks/testworld.md.
#   infra/testworld/install.sh
set -euo pipefail
H=${TESTWORLD_SSH:-mike@10.0.0.31}
[ "${1:-}" = --host ] && { echo "$H"; exit 0; }     # the runbook's commands take the ssh target from here
O=(-o BatchMode=yes -o ConnectTimeout=15)
TOP=$(git rev-parse --show-toplevel)
cd "$TOP"
[ "$(ssh "${O[@]}" "$H" hostname)" = block2-bots ] || { echo "REFUSED: $H is not block2-bots"; exit 2; }
T=$(ssh "${O[@]}" "$H" 'mktemp -d /tmp/tw-install.XXXXXX')
COPYFILE_DISABLE=1 tar --no-xattrs -cf - scripts/host/testworld.py scripts/host/soakread.py infra/showcase/make_env.py infra/showcase/rcon.py \
    scripts/lib/telemetry.py scripts/lib/estelemetry.py infra/testworld | ssh "${O[@]}" "$H" "tar -C $T -xf -"
ssh "${O[@]}" "$H" "set -e
sudo -n install -d -m 755 /srv/testworld/bin /srv/testworld/lib /srv/testworld/secrets
sudo -n chmod 700 /srv/testworld/secrets
sudo -n install -m 755 $T/scripts/host/testworld.py $T/scripts/host/soakread.py /srv/testworld/bin/
sudo -n install -m 644 $T/infra/showcase/make_env.py $T/infra/showcase/rcon.py $T/infra/testworld/leaseprune4h.py /srv/testworld/bin/
sudo -n install -m 644 $T/scripts/lib/telemetry.py $T/scripts/lib/estelemetry.py /srv/testworld/lib/
for u in testworld.slice testworld-paper.service 'mctest@.service' testworld-sample.service testworld-sample.timer testworld-leaseprune.service testworld-leaseprune.timer; do
  sudo -n install -m 644 \"$T/infra/testworld/\$u\" /etc/systemd/system/
done
if [ ! -e /srv/testworld/BRAIN.json ]; then
  printf '%s\n' '{\"url\": \"http://10.0.0.72:11434\", \"model\": \"qwen2.5:7b-instruct\", \"kind\": \"ollama\", \"owner\": \"owner 2026-11-16 perm choice: the showcase model; shared by the test world while the fleet is stopped (control session 2026-11-18)\"}' | sudo -n tee /srv/testworld/BRAIN.json >/dev/null
fi
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now testworld-sample.timer testworld-leaseprune.timer >/dev/null 2>&1
rm -rf $T
systemctl is-enabled testworld-sample.timer testworld-leaseprune.timer | tr '\n' ' '; ls /srv/testworld/bin | tr '\n' ' '"
echo; echo "installed from $(git rev-parse --short HEAD)$([ -z "$(git status --porcelain)" ] || echo ' + uncommitted edits')"
