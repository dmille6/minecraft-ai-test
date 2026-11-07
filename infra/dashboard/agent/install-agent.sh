#!/usr/bin/env bash
# Install node_exporter and (unless --node-only) mcai-dash-agent on THIS host. Run with sudo.
#   sudo bash install-agent.sh fleet|worlds|showcase   # agent + node_exporter
#   sudo bash install-agent.sh --node-only             # node_exporter only (ci2, the ELK box)
# Idempotent. Reads nothing it did not already read; opens 9100/9188 only to the dashboard host.
set -euo pipefail
ROLE="${1:?role: fleet | worlds | showcase | --node-only}"
DASH=10.0.0.186
SRC="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
say() { printf '== %s\n' "$*"; }

say "node_exporter"
if ! dpkg -s prometheus-node-exporter >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -qq prometheus-node-exporter >/dev/null
fi
systemctl enable --now prometheus-node-exporter >/dev/null 2>&1
# grep -c, not -q: under pipefail, -q exits early, curl takes SIGPIPE and the check fails on a healthy host
curl -sf localhost:9100/metrics | grep -c '^node_load5' >/dev/null && echo "   node_exporter OK on :9100"

if [ "$ROLE" != "--node-only" ]; then
  say "mcai-dash-agent ($ROLE)"
  install -d -m 755 /opt/mcai-dash-agent
  install -m 755 "$SRC/mcai-dash-agent.py" /opt/mcai-dash-agent/mcai-dash-agent.py
  case "$ROLE" in
    # As mike: the same user that runs canary-sched.py, owns ~/digest and reads the journal. No
    # PrivateTmp: `canary-sched.py status` inspects /tmp/mcai-canary.lock and must see the real /tmp.
    fleet)    RUN_AS=mike; EXTRA="ProtectSystem=full" ;;
    showcase) RUN_AS=mike; EXTRA="ProtectSystem=full" ;;
    # As root, but capped: each world's server.properties (RCON) is 600 to its own user (minecraft,
    # sandbox), and its JVM's /proc cwd/status is readable only with ptrace rights. Read-only filesystem.
    worlds)   RUN_AS=root; EXTRA="ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
CapabilityBoundingSet=CAP_DAC_READ_SEARCH CAP_SYS_PTRACE
AmbientCapabilities=" ;;
    *) echo "unknown role $ROLE"; exit 1 ;;
  esac
  cat > /etc/systemd/system/mcai-dash-agent.service <<UNIT
[Unit]
Description=MCAI dashboard agent ($ROLE) -- read-only status for Grafana on $DASH (infra/dashboard)
After=network-online.target

[Service]
User=$RUN_AS
ExecStart=/usr/bin/python3 -B /opt/mcai-dash-agent/mcai-dash-agent.py --role $ROLE
Restart=always
RestartSec=10
Nice=10
NoNewPrivileges=yes
$EXTRA

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable mcai-dash-agent >/dev/null 2>&1
  systemctl restart mcai-dash-agent
  for _ in $(seq 1 30); do
    curl -sf localhost:9188/metrics | grep -c mcai_agent_last_cycle >/dev/null && break
    sleep 2
  done
  curl -sf localhost:9188/health | python3 -c 'import json,sys; d=json.load(sys.stdin); bad={k:v["error"] for k,v in d["collectors"].items() if not v["ok"]}; print("   collectors:", ", ".join(sorted(d["collectors"])), "| FAILING:", bad or "none")'
fi

if ufw status 2>/dev/null | grep -c 'Status: active' >/dev/null; then
  say "ufw: allow $DASH -> 9100,9188"
  ufw allow proto tcp from "$DASH" to any port 9100,9188 comment 'mcai dashboard scrape' >/dev/null
fi
