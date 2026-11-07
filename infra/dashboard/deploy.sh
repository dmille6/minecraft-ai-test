#!/usr/bin/env bash
# Deploy the MCAI dashboard from this Mac. Idempotent; re-run after any change.
#   infra/dashboard/deploy.sh            # everything
#   infra/dashboard/deploy.sh stack      # Grafana/Prometheus/nginx config + dashboards only
#   infra/dashboard/deploy.sh agents     # node_exporter + mcai-dash-agent on the lab hosts
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DASH=mike@10.0.0.186
WHAT="${1:-all}"
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

stack() {
  say "dashboards + alert rules"
  python3 "$HERE/build_dashboards.py"

  say "stack -> $DASH:/opt/mcai-dash"
  ssh "$DASH" 'D=/opt/mcai-dash; sudo mkdir -p $D && sudo chown mike:mike $D'
  rsync -a --delete --exclude secrets/ \
    "$HERE/stack/" "$DASH:/opt/mcai-dash/"

  say "secrets (created once; never printed, never in git)"
  # Owned by the Grafana container's uid (472, gid 0), mode 400; the directory is traverse-only.
  S=/opt/mcai-dash/secrets
  ssh "$DASH" "sudo install -d -m 711 -o root -g root $S
    if ! sudo test -s $S/admin.pw; then
      openssl rand -base64 18 | tr -d '\n' | sudo tee $S/admin.pw >/dev/null
      sudo chown 472:0 $S/admin.pw; sudo chmod 400 $S/admin.pw; echo '   admin password created'; fi"
  if ! ssh "$DASH" "sudo test -s $S/es.key"; then
    # The analysis read-only key (read + view_index_metadata on mcai-*), host to host through this Mac.
    ssh mike@10.0.0.31 'tr -d "\n" < ~/.config/mcai/es-readonly.key' |
      ssh "$DASH" "sudo tee $S/es.key >/dev/null && sudo chown 472:0 $S/es.key && sudo chmod 400 $S/es.key"
    echo "   es.key copied from 10.0.0.31"
  fi

  say "docker compose up"
  ssh "$DASH" 'cd /opt/mcai-dash && sudo docker compose up -d --remove-orphans 2>&1 | tail -5
    sudo docker compose restart grafana web >/dev/null   # re-read provisioning (datasources, alert rules) and nginx.conf
    curl -s -X POST localhost:9090/-/reload || true
    for i in $(seq 1 60); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 2; done
    curl -s localhost:3000/api/health; echo'
}

agents() {
  for spec in 10.0.0.31:fleet 10.0.0.30:worlds 10.0.0.40:showcase 10.0.0.34:--node-only 10.0.0.186:--node-only; do
    host=${spec%%:*}; role=${spec#*:}
    say "$host ($role)"
    ssh "mike@$host" 'mkdir -p /tmp/mcai-dash-agent'
    scp -q "$HERE/agent/mcai-dash-agent.py" "$HERE/agent/install-agent.sh" "mike@$host:/tmp/mcai-dash-agent/"
    ssh "mike@$host" "sudo bash /tmp/mcai-dash-agent/install-agent.sh $role"
  done
}

case "$WHAT" in
  all) stack; agents ;;
  stack|agents) "$WHAT" ;;
  *) echo "usage: $0 [all|stack|agents]"; exit 1 ;;
esac
say "done -> http://10.0.0.186/"
