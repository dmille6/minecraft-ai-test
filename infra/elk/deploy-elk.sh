#!/usr/bin/env bash
# Stand up the ELK stack on elk01 using the docker-elk project.
#
# docker-elk deliberately, not a hand-rolled compose file: it is what the
# proof-of-concept runs, so the operator already knows its layout and the
# index templates, ILM policies and ingest pipelines port across unchanged.
set -euo pipefail
IP=$(ip -4 -o addr show | awk '/192\.168\.193\./{split($4,a,"/"); print a[1]; exit}')
[ -n "$IP" ] || { echo "no lab address"; exit 1; }
DIR=/opt/docker-elk

export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null; then
  apt-get update -qq >/dev/null
  apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1

[ -d "$DIR" ] || git clone -q --depth 1 https://github.com/deviantony/docker-elk.git "$DIR"
cd "$DIR"

# Passwords are generated ON THE HOST and never leave it. They go into .env at
# mode 600; nothing is echoed, so they do not end up in a terminal scrollback,
# a transcript, or this repository.
if ! grep -q '^ELASTIC_PASSWORD=.\{16,\}' .env 2>/dev/null; then
  # Alphanumeric only, and written UNQUOTED. docker-elk's own .env is unquoted
  # and every script in this repo parses it with
  #   grep -oP '(?<=^ELASTIC_PASSWORD=).*'
  # which would capture the surrounding quotes as part of the password and fail
  # to authenticate -- while docker compose, which strips them, works fine. A
  # credential that works for one reader and silently not another is worse than
  # one that is simply wrong.
  gen(){ openssl rand -base64 24 | tr -d '/+=' | head -c 24; }
  sed -i "s|^ELASTIC_PASSWORD=.*|ELASTIC_PASSWORD=$(gen)|" .env
  sed -i "s|^LOGSTASH_INTERNAL_PASSWORD=.*|LOGSTASH_INTERNAL_PASSWORD=$(gen)|" .env
  sed -i "s|^KIBANA_SYSTEM_PASSWORD=.*|KIBANA_SYSTEM_PASSWORD=$(gen)|" .env
  sed -i "s|^METRICBEAT_INTERNAL_PASSWORD=.*|METRICBEAT_INTERNAL_PASSWORD=$(gen)|" .env 2>/dev/null || true
  sed -i "s|^FILEBEAT_INTERNAL_PASSWORD=.*|FILEBEAT_INTERNAL_PASSWORD=$(gen)|" .env 2>/dev/null || true
  sed -i "s|^HEARTBEAT_INTERNAL_PASSWORD=.*|HEARTBEAT_INTERNAL_PASSWORD=$(gen)|" .env 2>/dev/null || true
  sed -i "s|^MONITORING_INTERNAL_PASSWORD=.*|MONITORING_INTERNAL_PASSWORD=$(gen)|" .env 2>/dev/null || true
  chmod 600 .env
fi

# An override rather than edits to the upstream compose file, so `git pull`
# never conflicts and what we changed stays legible in one place.
# An override rather than edits to the upstream compose file, so `git pull`
# never conflicts and what we changed stays legible in one place.
#
# Both a lab binding and a localhost one: every script in this repo talks to
# localhost:9200, so dropping it would break the existing tooling, while the lab
# binding is what makes Kibana reachable from a browser. Neither is 0.0.0.0.
#
# `!override` on each ports list is load-bearing. Compose MERGES list fields
# across files, so without it the base file's "9200:9200" (every interface) is
# kept AND our lab-only binding is appended -- both bind, the second fails with
# "address already in use", and the stack never starts. `!override` replaces the
# list. That distinction is the whole reason these services end up reachable
# only on the lab VLAN instead of on 0.0.0.0.
cat > docker-compose.override.yml <<YML
services:
  elasticsearch:
    ports: !override
      - "$IP:9200:9200"
      - "127.0.0.1:9200:9200"
      - "127.0.0.1:9300:9300"
    environment:
      ES_JAVA_OPTS: -Xms8g -Xmx8g
    restart: unless-stopped
  logstash:
    ports: !override
      - "$IP:5044:5044"
      - "$IP:50000:50000/tcp"
      - "$IP:9600:9600"
    environment:
      LS_JAVA_OPTS: -Xms512m -Xmx512m
    restart: unless-stopped
  kibana:
    ports: !override
      - "$IP:5601:5601"
      - "127.0.0.1:5601:5601"
    restart: unless-stopped
YML

docker compose up setup 2>&1 | tail -3
docker compose up -d 2>&1 | tail -4
echo "  waiting for elasticsearch..."
EP=$(grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
for _ in $(seq 1 40); do
  sleep 6
  s=$(curl -s -u "elastic:$EP" --max-time 5 "http://$IP:9200/_cluster/health" 2>/dev/null \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' 2>/dev/null || true)
  [ -n "$s" ] && { echo "  elasticsearch: $s"; break; }
done
for _ in $(seq 1 30); do
  sleep 6
  k=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$IP:5601/api/status" 2>/dev/null || echo 000)
  [ "$k" = "200" ] && { echo "  kibana: up"; break; }
done
echo "  ES:     http://$IP:9200"
echo "  Kibana: http://$IP:5601"
echo "  credentials: $DIR/.env (mode 600, root only)"
