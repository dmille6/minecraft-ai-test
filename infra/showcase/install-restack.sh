#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: install the showcase restack prep (restack_prep.py: after a fleet KEEP+promotion, prepare
# the showcase-on-fleet commit, test it, compare the records, alert) and its hourly timer. Prepares and alerts only.
#   sudo bash install-restack.sh <checkout dir holding infra/showcase and scripts/lib>
set -euo pipefail
T=${1:?checkout dir}
S=$T/infra/showcase
install -d /srv/showcase/bin /srv/showcase/restack
install -m 755 "$S/restack_prep.py" "$S/recordcompat.mjs" /srv/showcase/bin/
install -m 644 "$T/scripts/lib/alarm.py" /srv/showcase/bin/
cat > /etc/systemd/system/showcase-restack.service <<'UNIT'
[Unit]
Description=SHOWCASE restack prep: after a fleet KEEP+promotion, prepare + test the showcase-on-fleet commit, then alert (never activates)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -B /srv/showcase/bin/restack_prep.py run
Nice=15
IOSchedulingClass=idle
TimeoutStartSec=8h
UNIT
cat > /etc/systemd/system/showcase-restack.timer <<'UNIT'
[Unit]
Description=SHOWCASE restack prep, hourly at :25 (after the :05 follower refreshed the feed)
[Timer]
OnCalendar=*:25:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now showcase-restack.timer
echo "   ok  showcase-restack.timer enabled ($(git -C "$T" rev-parse --short HEAD 2>/dev/null || echo '?'))"
