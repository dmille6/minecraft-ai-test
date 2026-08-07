#!/usr/bin/env bash
# Deploy Homepage on ctl01. Run ON ctl01 with sudo.
#
# Bound to the lab address, never 0.0.0.0: ctl01 also holds the Anthropic and
# Codex credentials and SSH keys to every other guest, so it is the host where
# an extra listening service costs the most. Reached over the VPN, no forwards.
set -euo pipefail
IP=$(ip -4 -o addr show | awk '/192\.168\.193\./{split($4,a,"/"); print a[1]; exit}')
export DEBIAN_FRONTEND=noninteractive
command -v docker >/dev/null || { apt-get update -qq; apt-get install -y -qq docker.io; }
systemctl enable --now docker >/dev/null 2>&1

install -d -m 755 /opt/homepage/config
cp /tmp/homepage-config/*.yaml /opt/homepage/config/

# Any future secret goes in this env file, referenced from YAML as
# {{HOMEPAGE_VAR_NAME}}, so nothing secret is ever committed. There are none
# today: the Proxmox token was removed with the widget it existed for.
install -m 600 /dev/null /opt/homepage/.env
cat > /opt/homepage/.env <<ENV
HOMEPAGE_ALLOWED_HOSTS=${IP},ctl01,ctl01.ticr.lan,${IP}:80,ctl01:80,ctl01.ticr.lan:80
ENV

docker rm -f homepage >/dev/null 2>&1 || true

# Published on port 80 so the bare hostname is the dashboard: http://ctl01.
# Still bound to the lab address rather than 0.0.0.0 -- ctl01 holds the Anthropic
# and Codex credentials and SSH keys to every other guest, so it is the host
# where an extra listening socket costs the most.
docker run -d --name homepage --restart unless-stopped \
  -p "${IP}:80:3000" \
  --env-file /opt/homepage/.env \
  -v /opt/homepage/config:/app/config \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ghcr.io/gethomepage/homepage:latest >/dev/null

for _ in $(seq 1 20); do
  sleep 3
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://${IP}" 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { echo "  OK  Homepage at http://${IP}  (http://ctl01)"; exit 0; }
done
echo "  FAIL http ${code:-000}"; docker logs --tail 15 homepage 2>&1 | sed 's/^/    /'
