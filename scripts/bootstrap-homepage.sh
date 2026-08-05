#!/usr/bin/env bash
# bootstrap-homepage.sh -- single entry point linking everything, on port 80.
# Run on the Minecraft host.
#
# Idempotent.
#
#   sudo MCAI=10.0.0.185 MCELK=10.0.0.186 OLLAMA_A=10.0.0.70 OLLAMA_B=10.0.0.72 \
#        ./bootstrap-homepage.sh

set -euo pipefail

MCAI="${MCAI:?set MCAI}"
MCELK="${MCELK:?set MCELK}"
OLLAMA_A="${OLLAMA_A:-}"
OLLAMA_B="${OLLAMA_B:-}"
LAN_CIDR="${LAN_CIDR:-10.0.0.0/24}"
HP=/srv/homepage

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "Docker"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get install -y -qq docker.io docker-compose-v2 >/dev/null 2>&1
systemctl enable --now docker >/dev/null 2>&1
ok "$(docker --version)"

say "Configuration"
mkdir -p "$HP/config"
cat > "$HP/docker-compose.yml" <<YML
services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: homepage
    ports: ["80:3000"]
    volumes: ["$HP/config:/app/config"]
    environment:
      # Required since v0.9. Without it homepage serves a BLANK PAGE with no
      # useful error, which is a genuinely confusing first-run experience.
      HOMEPAGE_ALLOWED_HOSTS: "$MCAI,mcai,localhost,$MCAI:80"
    restart: unless-stopped
YML

cat > "$HP/config/settings.yaml" <<'YML'
title: Minecraft AI Testbed
description: Agent experiments — server, telemetry, inference
theme: dark
color: slate
headerStyle: boxed
layout:
  Minecraft:     {style: row, columns: 3}
  Observability: {style: row, columns: 3}
  Agents:        {style: row, columns: 2}
  Inference:     {style: row, columns: 2}
  Hosts:         {style: row, columns: 2}
YML

{
cat <<YML
- Minecraft:
    - Paper Server:
        icon: mdi-minecraft
        description: 1.21.11 · offline-mode · border 1950
        widget:
          type: minecraft
          url: udp://$MCAI:25565
    - Live World Map:
        icon: mdi-map-search
        href: http://$MCAI:8080
        description: squaremap · live agent + player markers
        siteMonitor: http://$MCAI:8080
    - 3D Bot View:
        icon: mdi-video-3d
        href: http://$MCAI:3007
        description: prismarine-viewer · over the shoulder
        siteMonitor: http://$MCAI:3007

- Observability:
    - Kibana:
        icon: kibana
        href: http://$MCELK:5601
        description: Overview + Agent Behaviour dashboards
        siteMonitor: http://$MCELK:5601/api/status
    - Elasticsearch:
        icon: elasticsearch
        href: http://$MCELK:9200
        description: mcai-skill · mcai-llm · mcai-mc · 180d retention
    - Agent Behaviour:
        icon: mdi-chart-timeline-variant
        href: http://$MCELK:5601/app/dashboards
        description: hazards, interventions, skill outcomes by run

- Agents:
    - Hermes Agent:
        icon: mdi-brain
        href: http://$MCELK:9119
        description: web dashboard · reads telemetry read-only
        siteMonitor: http://$MCELK:9119
YML

echo "
- Inference:"
[ -n "$OLLAMA_A" ] && cat <<YML
    - Ollama — $OLLAMA_A:
        icon: ollama
        href: http://$OLLAMA_A:11434
        description: agent routine loop (dedicated)
        siteMonitor: http://$OLLAMA_A:11434/api/version
YML
[ -n "$OLLAMA_B" ] && cat <<YML
    - Ollama — $OLLAMA_B:
        icon: ollama
        href: http://$OLLAMA_B:11434
        description: shared · embeddings and overflow
        siteMonitor: http://$OLLAMA_B:11434/api/version
YML

cat <<YML

- Hosts:
    - mcai (Minecraft + agents):
        icon: mdi-server
        href: http://$MCAI:61208
        description: $MCAI
        widget: {type: glances, url: "http://$MCAI:61208", metric: info, version: 4}
    - mcelk (ELK + Hermes):
        icon: mdi-server
        href: http://$MCELK:61208
        description: $MCELK
        widget: {type: glances, url: "http://$MCELK:61208", metric: info, version: 4}
YML
} > "$HP/config/services.yaml"

cat > "$HP/config/widgets.yaml" <<'YML'
- resources: {label: mcai, cpu: true, memory: true, disk: /srv/minecraft}
- datetime: {text_size: xl, format: {dateStyle: short, timeStyle: short, hourCycle: h23}}
YML

cat > "$HP/config/bookmarks.yaml" <<'YML'
- Project:
    - GitHub Repo: [{abbr: GH, href: "https://github.com/dmille6/minecraft-ai-test"}]
- Reference:
    - Mineflayer API: [{abbr: MF, href: "https://prismarinejs.github.io/mineflayer/"}]
    - PaperMC Docs:   [{abbr: PA, href: "https://docs.papermc.io/"}]
    - Hermes Agent:   [{abbr: HA, href: "https://github.com/NousResearch/hermes-agent"}]
YML
: > "$HP/config/docker.yaml"
ok "config written ($(ls "$HP/config" | wc -l) files)"

say "Start"
cd "$HP" && docker compose up -d >/dev/null 2>&1
sleep 15
ufw allow from "$LAN_CIDR" to any port 80 proto tcp comment 'homepage' >/dev/null 2>&1 || true
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $MCAI" http://127.0.0.1/ 2>/dev/null)
ok "homepage $(docker ps --filter name=homepage --format '{{.Status}}') — HTTP $CODE"
echo
echo "   http://$MCAI"
