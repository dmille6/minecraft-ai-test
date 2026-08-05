#!/usr/bin/env bash
# deploy-harness.sh -- put the agent harness and telemetry shipper on the
# Minecraft host. Run on that host, after bootstrap-mcai.sh.
#
# Idempotent.
#
#   sudo ES_HOST=10.0.0.186 ES_SHIP_PW='...' OLLAMA=http://10.0.0.72:11434 \
#        ./deploy-harness.sh
#
# Environment:
#   ES_HOST        Elasticsearch host (required)
#   ES_SHIP_PW     mcai_ship password from the ELK host (required)
#   OLLAMA         Ollama base URL (required)
#   MODEL          default qwen2.5:14b-instruct  -- see ADR-0002 D5
#   BOT_NAME       default Scout01
#   REPO           default https://github.com/dmille6/minecraft-ai-test.git
#   PREGEN         set to a radius (e.g. 2000) to pregenerate and set a border

set -euo pipefail

ES_HOST="${ES_HOST:?set ES_HOST}"
ES_SHIP_PW="${ES_SHIP_PW:?set ES_SHIP_PW}"
OLLAMA="${OLLAMA:?set OLLAMA}"
MODEL="${MODEL:-qwen2.5:14b-instruct}"
BOT_NAME="${BOT_NAME:-Scout01}"
BOT_ROLE="${BOT_ROLE:-scout}"
REPO="${REPO:-https://github.com/dmille6/minecraft-ai-test.git}"
SRV=/srv/minecraft
H="$SRV/bots/harness"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

# -------------------------------------------------------------------- code --
say "Harness"
if [ -d /opt/minecraft-ai/.git ]; then
  git -C /opt/minecraft-ai pull -q
  ok "repo updated to $(git -C /opt/minecraft-ai rev-parse --short HEAD)"
else
  git clone -q "$REPO" /opt/minecraft-ai
  ok "repo cloned at $(git -C /opt/minecraft-ai rev-parse --short HEAD)"
fi
CODE_VERSION=$(git -C /opt/minecraft-ai rev-parse --short HEAD)

mkdir -p "$H/env" "$SRV/bots/logs"
cp -r /opt/minecraft-ai/bots/src "$H/"
cp /opt/minecraft-ai/bots/package.json "$H/"
chown -R mcbot:mcbot "$SRV/bots"

# prismarine-viewer needs node-canvas, which needs native build deps. Without
# them the viewer fails with a bare "Cannot find module 'canvas'".
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get install -y -qq build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev pkg-config >/dev/null 2>&1 || true
sudo -u mcbot bash -c "cd '$H' && npm install --no-audit --no-fund" >/dev/null 2>&1
ok "dependencies installed ($(sudo -u mcbot bash -c "cd '$H' && ls node_modules | wc -l") packages)"

# --------------------------------------------------------------------- env --
say "Agent configuration"
cat > "$H/env/${BOT_ROLE}.env" <<EOF
MINECRAFT_HOST=127.0.0.1
MINECRAFT_PORT=25565
# Pinned, not auto-detected. mineflayer's protocol layer stops at 1.21.11 and
# auto-detect fails confusingly after a server upgrade. See ADR-0001.
MINECRAFT_VERSION=1.21.11
MINECRAFT_AUTH=offline

BOT_NAME=$BOT_NAME
BOT_ROLE=$BOT_ROLE

WORLD_BORDER_RADIUS=1950
HOME_X=0
HOME_Y=70
HOME_Z=0

REFLEX_TICK_MS=500
EAT_BELOW_FOOD=16
FLEE_BELOW_HEALTH=8
# Must stay ABOVE the per-path cap inside skills (12s) and below the skill
# watchdog. Getting this order wrong makes skill-level recovery unreachable.
STUCK_SECONDS=20

SKILL_TIMEOUT_MS=180000
MAX_CONSECUTIVE_FAILURES=3

LOG_DIR=$SRV/bots/logs
LOG_LEVEL=info
CODE_VERSION=$CODE_VERSION

RECONNECT_DELAY_MS=8000
RECONNECT_MAX_DELAY_MS=120000

LLM_ENABLED=true
OLLAMA_BASE_URL=$OLLAMA
OLLAMA_MODEL=$MODEL
# Set EXPLICITLY. Ollama truncates at its default with no error, and a
# blindfolded model merely looks stupid.
OLLAMA_NUM_CTX=8192
LLM_TEMPERATURE=0.3
LLM_TIMEOUT_MS=90000
LLM_PROMPT_TOKEN_BUDGET=3000
LLM_DECISION_COOLDOWN_MS=20000

VIEWER_ENABLED=true
VIEWER_PORT=3007
VIEWER_FIRST_PERSON=false

ENABLE_AGENT_CODE_EXECUTION=false
EOF
chown mcbot:mcbot "$H/env/${BOT_ROLE}.env"; chmod 600 "$H/env/${BOT_ROLE}.env"
ok "env/${BOT_ROLE}.env — model $MODEL at $OLLAMA"

# ---------------------------------------------------------------- filebeat --
say "Filebeat"
if ! command -v filebeat >/dev/null 2>&1; then
  curl -sSL -o /tmp/filebeat.deb \
    https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-9.4.4-amd64.deb
  dpkg -i /tmp/filebeat.deb >/dev/null 2>&1 || apt-get -y -f install >/dev/null 2>&1
fi
ok "$(filebeat version 2>&1 | head -1 | cut -d, -f1)"

cat > /etc/filebeat/filebeat.yml <<YML
filebeat.inputs:
  - type: filestream
    id: paper-server-log
    enabled: true
    paths: ["$SRV/server/logs/latest.log"]
    parsers:
      - multiline: {type: pattern, pattern: '^\[', negate: true, match: after}
    processors:
      - add_fields: {target: "@metadata", fields: {route: paper}}

  - type: filestream
    id: agent-skill-jsonl
    enabled: true
    paths: ["$SRV/bots/logs/skill-*.jsonl"]
    parsers:
      - ndjson: {target: "", overwrite_keys: true, add_error_key: true}
    processors:
      - add_fields: {target: "@metadata", fields: {route: skill}}

  - type: filestream
    id: agent-llm-jsonl
    enabled: true
    paths: ["$SRV/bots/logs/llm-*.jsonl"]
    parsers:
      - ndjson: {target: "", overwrite_keys: true, add_error_key: true}
    processors:
      - add_fields: {target: "@metadata", fields: {route: llm}}

# GLOBAL chain. libbeat injects agent.*/ecs.*/host.* AFTER input-level
# processors run, so they can only be stripped here. ECS reserves agent.* for
# the SHIPPING agent, and our game agent is bot.* -- with dynamic:strict that
# collision silently rejects 100% of documents.
processors:
  - drop_fields:
      when.or:
        - equals: {"@metadata.route": "llm"}
        - equals: {"@metadata.route": "skill"}
      fields: ["agent", "ecs", "host", "input", "log"]
      ignore_missing: true
  - add_fields:
      when.equals: {"@metadata.route": "paper"}
      target: "host"
      fields: {name: "mcai"}

output.elasticsearch:
  hosts: ["http://$ES_HOST:9200"]
  username: "mcai_ship"
  password: "$ES_SHIP_PW"
  indices:
    - index: "mcai-llm-agents"
      when.equals: {"@metadata.route": "llm"}
    - index: "mcai-skill-agents"
      when.equals: {"@metadata.route": "skill"}
    - index: "mcai-mc-paper"
  pipelines:
    - pipeline: "mcai-paper"
      when.equals: {"@metadata.route": "paper"}

# Templates and ILM are managed by bootstrap-mcelk.sh, not by Filebeat.
setup.ilm.enabled: false
setup.template.enabled: false
logging.level: info
YML
chmod 600 /etc/filebeat/filebeat.yml
filebeat test config >/dev/null 2>&1 && ok "config valid" || { warn "config invalid"; filebeat test config; }
filebeat test output 2>&1 | grep -qi "talk to server\|OK" && ok "reaches $ES_HOST" || warn "cannot reach $ES_HOST:9200"
systemctl enable --now filebeat >/dev/null 2>&1
systemctl restart filebeat
ok "filebeat $(systemctl is-active filebeat)"

# ------------------------------------------------------------------- world --
if [ -n "${PREGEN:-}" ]; then
  say "World pregeneration (radius $PREGEN)"
  R="$SRV/shared/rcon.py"
  "$R" "whitelist add $BOT_NAME" >/dev/null 2>&1 || true
  # Border sits just inside the pregenerated area so an agent can reach it
  # without ever triggering live chunk generation.
  BORDER=$(( (PREGEN - 50) * 2 ))
  "$R" "worldborder set $BORDER" >/dev/null 2>&1 || true
  "$R" "chunky radius $PREGEN" >/dev/null 2>&1 || true
  "$R" "chunky start" >/dev/null 2>&1 || true
  ok "border $BORDER wide; pregen running in background (watch: rcon.py 'chunky progress')"
fi

# ------------------------------------------------------------------- start --
say "Agent"
"$SRV/shared/rcon.py" "whitelist add $BOT_NAME" >/dev/null 2>&1 || true
systemctl enable --now "mcbot@${BOT_ROLE}" >/dev/null 2>&1
sleep 8
ok "mcbot@${BOT_ROLE} $(systemctl is-active mcbot@${BOT_ROLE})"

say "Done"
IP=$(hostname -I | awk '{print $1}')
cat <<EOF
   Minecraft     $IP:25565      (whitelist: add yourself)
   Live map      http://$IP:8080
   3D bot view   http://$IP:3007
   Kibana        http://$ES_HOST:5601

   Watch the agent:  sudo journalctl -u mcbot@${BOT_ROLE} -f
   Whitelist you:    sudo $SRV/shared/rcon.py "whitelist add YourName"
EOF
