#!/usr/bin/env bash
# Glances in REST-API mode, for the Homepage dashboard's resource widgets.
#
# Three things here are not obvious and each cost a debugging cycle:
#
#   --disable-webui  Ubuntu's glances package ships WITHOUT the web UI static
#                    assets, so plain `glances -w` dies with
#                    "Directory .../static/public does not exist". Homepage only
#                    consumes the REST API, so dropping the UI is no loss.
#   --port 61208     Without an explicit port it does not fall back to the web
#                    default -- it comes up as an XML-RPC server on 127.0.0.1:61209
#                    instead, listening on the wrong port AND the wrong interface
#                    while systemd cheerfully reports the unit as active.
#   --bind <lab ip>  Not 0.0.0.0. Glances exposes process lists, filesystem
#                    layout and network counters with no authentication. On the
#                    lab VLAN behind the VPN that is acceptable; on every
#                    interface of a host that also holds credentials it is not.
set -euo pipefail
IP=$(ip -4 -o addr show | awk '/192\.168\.193\./{split($4,a,"/"); print a[1]; exit}')
[ -n "$IP" ] || { echo "  FAIL $(hostname): no 192.168.193.x address"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq glances >/dev/null 2>&1

cat > /etc/systemd/system/glances.service <<UNIT
[Unit]
Description=Glances REST API for the Homepage dashboard
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/glances -w --disable-webui --bind $IP --port 61208
Restart=on-failure
RestartSec=5
# Runs as root because a metrics agent that cannot read other users' processes
# reports a comfortable fiction. Confined instead: read-only filesystem, no
# home access, no privilege escalation.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable glances >/dev/null 2>&1
systemctl restart glances
for _ in $(seq 1 10); do
  sleep 2
  if curl -sf --max-time 4 "http://$IP:61208/api/4/cpu" >/dev/null 2>&1; then
    echo "  OK   $(hostname) -> http://$IP:61208/api/4"; exit 0
  fi
done
echo "  FAIL $(hostname) ($(systemctl is-active glances)): $(journalctl -u glances -n 2 --no-pager 2>/dev/null | tail -1)"
