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

# Secrets are READ FROM THE HOST here rather than appended by hand afterwards.
# This file is rewritten from scratch on every deploy, so anything added to it
# out-of-band is silently destroyed on the next run -- which is exactly what
# happened to the Elasticsearch credential, and the only symptom was widgets
# showing "API Error Information" with nothing in the logs.
install -m 600 /dev/null /opt/homepage/.env
{
  echo "HOMEPAGE_ALLOWED_HOSTS=${IP},ctl01,ctl01.ticr.lan,${IP}:80,ctl01:80,ctl01.ticr.lan:80"
  # Read-only Elasticsearch account, for the live fleet-metric widgets.
  [ -r /root/.mcai_ro_password ] && echo "HOMEPAGE_VAR_ES_RO=$(cat /root/.mcai_ro_password)"
} > /opt/homepage/.env
chmod 600 /opt/homepage/.env

# RECREATE, never just restart. `docker restart` does not re-read --env-file:
# that is consumed at container CREATION only. A credential added to the env
# file after the fact stays empty inside a restarted container, and the symptom
# is a widget showing "API Error Information" with nothing in the logs, because
# the request is never made.
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
