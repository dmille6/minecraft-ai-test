#!/usr/bin/env bash
# bootstrap-mcbots.sh -- dedicated agent host. Runs the bots ONLY; Minecraft and
# Elasticsearch live elsewhere.
#
# Splitting bots off is the first scaling step your handoff doc S15 recommends,
# and it is the cheap one: Paper stops competing with A* pathfinding for cores
# on both ends.
#
# Idempotent.
#
#   sudo MC_HOST=10.0.0.185 ES_HOST=10.0.0.186 ES_SHIP_PW='...' \
#        OLLAMA=http://10.0.0.70:11434 ./bootstrap-mcbots.sh
#
# Environment:
#   MC_HOST      Minecraft server (required)
#   ES_HOST      Elasticsearch host (required)
#   ES_SHIP_PW   mcai_ship password from the ELK host (required)
#   OLLAMA       Ollama base URL (required)
#   MODEL        default qwen2.5:14b-instruct
#   BOTS         default "scout:Scout01 miner:Miner01 gatherer:Gather01"
#   COOLDOWN_MS  default 60000 -- see the capacity note at the bottom
#   NUM_CTX      default 4096  -- see the sizing note beside OLLAMA_NUM_CTX

set -euo pipefail

MC_HOST="${MC_HOST:?set MC_HOST}"
ES_HOST="${ES_HOST:?set ES_HOST}"
ES_SHIP_PW="${ES_SHIP_PW:?set ES_SHIP_PW}"
OLLAMA="${OLLAMA:?set OLLAMA}"
MODEL="${MODEL:-qwen2.5:14b-instruct}"
BOTS="${BOTS:-scout:Scout01 miner:Miner01 gatherer:Gather01}"
COOLDOWN_MS="${COOLDOWN_MS:-60000}"
NUM_CTX="${NUM_CTX:-4096}"
RUN_ID="${RUN_ID:-team-002}"
REPO="${REPO:-https://github.com/dmille6/minecraft-ai-test.git}"
SRV=/srv/mcbots
H="$SRV/harness"
STATE="$SRV/state"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "Preflight"
ok "$(nproc) cores, $(free -g | awk '/^Mem:/{print $2}')GB RAM"
NBOTS=$(echo "$BOTS" | wc -w)
# ~0.5 core and ~350MB per bot, measured on a running 3-bot team.
NEEDC=$(( (NBOTS + 1) / 2 + 1 )); NEEDM=$(( NBOTS * 350 / 1024 + 2 ))
[ "$(nproc)" -ge "$NEEDC" ] || warn "$NBOTS bots want ~${NEEDC} cores, host has $(nproc)"
[ "$(free -g | awk '/^Mem:/{print $2}')" -ge "$NEEDM" ] || warn "$NBOTS bots want ~${NEEDM}GB, host has $(free -g | awk '/^Mem:/{print $2}')GB"
grep -qm1 avx2 /proc/cpuinfo && ok "AVX2 present" || warn "no AVX2 — set cpu type x86-64-v3 on the hypervisor"

say "Kernel + account"
printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-mcbots.conf
sysctl -q --system
id mcbot >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$SRV" mcbot
mkdir -p "$H/env" "$SRV/logs" "$STATE"
chown -R mcbot:mcbot "$SRV"
ok "mcbot account, $SRV"

say "Runtime"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
apt-get install -y -qq nodejs npm git curl ufw jq \
  build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
  librsvg2-dev pkg-config >/dev/null
npm install -g npm@11 >/dev/null 2>&1 || true
hash -r
ok "node $(node --version), npm $(npm --version)"

say "Harness"
if [ -d /opt/minecraft-ai/.git ]; then git -C /opt/minecraft-ai pull -q
else git clone -q "$REPO" /opt/minecraft-ai; fi
CODE_VERSION=$(git -C /opt/minecraft-ai rev-parse --short HEAD)
cp -r /opt/minecraft-ai/bots/src "$H/"
cp /opt/minecraft-ai/bots/package.json "$H/"
# Stamp the version where the CODE lives, not only in the per-role env files.
#
# src/ is SHARED by every role but env/ is written per role, so a deploy that
# touches one role leaves the others stamped with a version they are no longer
# running. On 2026-08-05 that produced gatherer/miner=884d053, scout=f63abfb,
# all three executing the same newer src -- and it hid a fleet running 18
# commits behind, missing both entombment fixes, until _entombed had fired
# 2,695 times. This file is the single authority for what is deployed.
printf '%s\n' "$CODE_VERSION" > "$H/VERSION"
chown -R mcbot:mcbot "$SRV"
sudo -u mcbot bash -c "cd '$H' && npm install --no-audit --no-fund" >/dev/null 2>&1
# canvas is an OPTIONAL peer of prismarine-viewer; npm install skips it.
sudo -u mcbot bash -c "cd '$H' && npm install canvas --no-audit --no-fund" >/dev/null 2>&1 || \
  warn "canvas failed — 3D viewer unavailable"
ok "harness at $CODE_VERSION"

say "Bots"
VPORT=3007
for spec in $BOTS; do
  ROLE="${spec%%:*}"; NAME="${spec##*:}"
  # Only the first bot gets a viewer: it costs ~15-20% CPU and ~200MB, and one
  # window into the world is enough to see what is happening.
  if [ "$VPORT" -eq 3007 ]; then VIEW=true; else VIEW=false; fi
  cat > "$H/env/${ROLE}.env" <<ENVEOF
MINECRAFT_HOST=$MC_HOST
MINECRAFT_PORT=25565
MINECRAFT_VERSION=1.21.11
MINECRAFT_AUTH=offline

BOT_NAME=$NAME
BOT_ROLE=$ROLE

WORLD_BORDER_RADIUS=1950
HOME_X=0
HOME_Y=70
HOME_Z=0

REFLEX_TICK_MS=500
EAT_BELOW_FOOD=16
FLEE_BELOW_HEALTH=8
STUCK_SECONDS=20
SKILL_TIMEOUT_MS=180000
MAX_CONSECUTIVE_FAILURES=3

LOG_DIR=$SRV/logs
# Separate from LOG_DIR on purpose: lessons-*.json is STATE, not logs, and it
# is the only artifact here that cannot be regenerated. Anything that tidies
# LOG_DIR must not be able to reach it.
STATE_DIR=$STATE
LOG_LEVEL=info
CODE_VERSION=$CODE_VERSION
RUN_ID=$RUN_ID

RECONNECT_DELAY_MS=8000
RECONNECT_MAX_DELAY_MS=120000

LLM_ENABLED=true
OLLAMA_BASE_URL=$OLLAMA
OLLAMA_MODEL=$MODEL
# 4096, not 8192. Ollama allocates KV for num_ctx * OLLAMA_NUM_PARALLEL up
# front, so an oversized window is paid for on every slot whether or not the
# prompt uses it: at 8192 the 9.0GB model sat resident at 15.2GB, ~6.2GB of it
# KV for context we never touched.
#
# Sized from measurement, not taste. Over 24h: prompt p50=1014, p99=2390,
# MAX=2542; completion MAX=219 -- worst case 2761. 2048 would have TRUNCATED
# the tail (and LLM_PROMPT_TOKEN_BUDGET=3000 below would guarantee it). 4096
# clears the worst case with ~1300 to spare and still halves the KV.
OLLAMA_NUM_CTX=${NUM_CTX:-4096}
LLM_TEMPERATURE=0.3
LLM_TIMEOUT_MS=90000
LLM_PROMPT_TOKEN_BUDGET=3000
# One inference host ceilings at ~7.5 decisions/min (8s of GPU work each).
# N bots need cadence >= N * 8s. Ten bots therefore need >= 80s.
LLM_DECISION_COOLDOWN_MS=$COOLDOWN_MS

VIEWER_ENABLED=$VIEW
VIEWER_PORT=$VPORT
VIEWER_FIRST_PERSON=false

ENABLE_AGENT_CODE_EXECUTION=false
ENVEOF
  chown mcbot:mcbot "$H/env/${ROLE}.env"; chmod 600 "$H/env/${ROLE}.env"
  ok "$NAME ($ROLE)$([ "$VIEW" = true ] && echo " — viewer :$VPORT")"
  VPORT=$((VPORT + 1))
done

say "systemd"
cat > /etc/systemd/system/mcbot@.service <<EOF
[Unit]
Description=Minecraft AI agent (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mcbot
Group=mcbot
WorkingDirectory=$H
EnvironmentFile=$H/env/%i.env
ExecStart=/usr/bin/node src/index.mjs
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$SRV

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
ok "mcbot@.service (templated)"

say "Filebeat"
command -v filebeat >/dev/null 2>&1 || {
  curl -sSL -o /tmp/filebeat.deb \
    https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-9.4.4-amd64.deb
  dpkg -i /tmp/filebeat.deb >/dev/null 2>&1 || apt-get -y -f install >/dev/null 2>&1
}
cat > /etc/filebeat/filebeat.yml <<YML
filebeat.inputs:
  - type: filestream
    id: agent-skill-jsonl
    enabled: true
    paths: ["$SRV/logs/skill-*.jsonl"]
    parsers:
      - ndjson: {target: "", overwrite_keys: true, add_error_key: true}
    processors:
      - add_fields: {target: "@metadata", fields: {route: skill}}

  - type: filestream
    id: agent-llm-jsonl
    enabled: true
    paths: ["$SRV/logs/llm-*.jsonl"]
    parsers:
      - ndjson: {target: "", overwrite_keys: true, add_error_key: true}
    processors:
      - add_fields: {target: "@metadata", fields: {route: llm}}

# libbeat injects agent.*/ecs.*/host.* AFTER input processors, so they can only
# be stripped here. ECS reserves agent.* for the SHIPPING agent while our game
# agent is bot.* -- with dynamic:strict that collision rejects every document.
processors:
  - drop_fields:
      fields: ["agent", "ecs", "host", "input", "log"]
      ignore_missing: true

output.elasticsearch:
  hosts: ["http://$ES_HOST:9200"]
  username: "mcai_ship"
  password: "$ES_SHIP_PW"
  indices:
    - index: "mcai-llm-agents"
      when.equals: {"@metadata.route": "llm"}
    - index: "mcai-skill-agents"

setup.ilm.enabled: false
setup.template.enabled: false
logging.level: info
YML
chmod 600 /etc/filebeat/filebeat.yml
filebeat test config >/dev/null 2>&1 && ok "config valid" || warn "config invalid"
systemctl enable --now filebeat >/dev/null 2>&1 && systemctl restart filebeat
ok "filebeat $(systemctl is-active filebeat)"

say "Log rotation"
# Filebeat holds these open and tracks by inode, so copytruncate is REQUIRED --
# a normal rotate leaves it reading a renamed file and silently stops shipping.
cat > /etc/logrotate.d/mcai-bots <<LR
$SRV/logs/*.jsonl {
    daily
    rotate 14
    maxsize 200M
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su mcbot mcbot
}
LR
ok "14 days, 200M cap, copytruncate"

say "State backup"
cat > /etc/cron.daily/mcai-lessons-backup <<'BK'
#!/bin/sh
# lessons-*.json is the only unregenerable artifact in this project. Worlds,
# indices and dashboards can all be rebuilt; deleted experience is simply gone.
D=/srv/mcbots/state/backups
mkdir -p "$D"
tar -C /srv/mcbots -czf "$D/lessons-$(date +%%Y%%m%%d).tar.gz" state --exclude=backups 2>/dev/null
find "$D" -name 'lessons-*.tar.gz' -mtime +30 -delete
BK
chmod +x /etc/cron.daily/mcai-lessons-backup
ok "daily lessons backup, 30-day retention"

say "Firewall"
ufw allow 22/tcp comment 'ssh' >/dev/null
ufw allow from "${LAN_CIDR:-10.0.0.0/24}" to any port 3007:3016 proto tcp comment 'bot viewers' >/dev/null
ufw allow from "${LAN_CIDR:-10.0.0.0/24}" to any port 61208 proto tcp comment 'glances' >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | grep -c ALLOW) allow rules"

say "Done"
cat <<EOF
   Bots are configured but NOT started, deliberately.

   BEFORE STARTING: if you are migrating existing bots, copy their learned
   experience across or it is lost and every bot begins from zero again:

     scp <old-host>:/srv/minecraft/bots/state/lessons-*.json $SRV/state/
     chown mcbot:mcbot $SRV/state/lessons-*.json

   Verify BEFORE concluding the migration worked -- a bot that starts at run=1
   has silently lost its history, and it presents as the learning system not
   working rather than as a missed step:

     sudo journalctl -u mcbot@scout | grep 'lessons loaded'

   Then, on the OLD host, stop the bots so they do not run twice:
     sudo systemctl disable --now mcbot@scout mcbot@miner mcbot@gatherer

   Whitelist each name on the Minecraft server, then:
     sudo systemctl enable --now mcbot@scout mcbot@miner mcbot@gatherer

   CAPACITY: one Ollama host does ~7.5 decisions/min (8s of GPU work each).
   N bots need a cadence of at least N x 8s. This build uses ${COOLDOWN_MS}ms.
EOF
