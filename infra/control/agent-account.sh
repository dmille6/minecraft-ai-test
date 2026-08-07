#!/usr/bin/env bash
# A dedicated account for AUTONOMOUS runs, distinct from the operator's own.
#
# Two reasons it is separate rather than reusing `mike`:
#   1. mike has passwordless sudo. An agent key that lands on mike is root on
#      five machines, and the control node holding that key also holds the
#      Anthropic and Codex credentials.
#   2. Attribution. When something restarts at 3am, `agent` in the auth log
#      distinguishes it from a human at a keyboard. A shared account makes that
#      question unanswerable after the fact.
set -euo pipefail
id agent >/dev/null 2>&1 || useradd -m -s /bin/bash -c "autonomous agent runs" agent
usermod -aG adm agent            # read journald and /var/log, nothing more
install -d -m 700 -o agent -g agent /home/agent/.ssh
touch /home/agent/.ssh/authorized_keys
chmod 600 /home/agent/.ssh/authorized_keys; chown agent:agent /home/agent/.ssh/authorized_keys
grep -q 'mc2-agent' /home/agent/.ssh/authorized_keys || cat /tmp/agent.pub >> /home/agent/.ssh/authorized_keys

# An ALLOWLIST, not a role. Anything not named here fails, including anything
# added to these directories later -- which is why the service names are
# spelled out rather than globbed with a wildcard path.
cat > /etc/sudoers.d/agent <<'SUDO'
# Autonomous agent: restart the lab's own services, read their state. Nothing else.
agent ALL=(root) NOPASSWD: /usr/bin/systemctl restart mcbot@scout, \
                           /usr/bin/systemctl restart mcbot@scout2, \
                           /usr/bin/systemctl restart mcbot@miner, \
                           /usr/bin/systemctl restart mcbot@gatherer, \
                           /usr/bin/systemctl restart mcbot@gather2, \
                           /usr/bin/systemctl restart minecraft, \
                           /usr/bin/systemctl status *, \
                           /usr/bin/systemctl is-active *, \
                           /usr/bin/journalctl *
SUDO
chmod 440 /etc/sudoers.d/agent
visudo -cf /etc/sudoers.d/agent >/dev/null && echo "  agent account ready on $(hostname) (sudoers valid)"
