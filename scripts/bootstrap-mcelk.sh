#!/usr/bin/env bash
# bootstrap-mcelk.sh -- provision the Elasticsearch + Kibana host from scratch.
#
# Idempotent: safe to re-run.
#
# Encodes docs/ops/services.md, including four packaging traps that each fail
# unhelpfully and cost a debugging cycle the first time.
#
#   sudo ELASTIC_PASSWORD_FOR_MIKE='...' ./bootstrap-mcelk.sh
#
# Environment:
#   KIBANA_USER=mike          human login created with superuser role
#   ELASTIC_PASSWORD_FOR_MIKE required, no default
#   ES_HEAP=4g                half of RAM; never above ~31g on any node
#   LAN_CIDR=10.0.0.0/24      who may reach Kibana/ES
#   WITH_LOGSTASH=false       Filebeat ships straight to ES; Logstash is a
#                             second JVM costing ~1GB for no current benefit

set -euo pipefail

KIBANA_USER="${KIBANA_USER:-mike}"
ES_HEAP="${ES_HEAP:-4g}"
LAN_CIDR="${LAN_CIDR:-10.0.0.0/24}"
WITH_LOGSTASH="${WITH_LOGSTASH:-false}"
ELK=/opt/docker-elk

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
[ -n "${ELASTIC_PASSWORD_FOR_MIKE:-}" ] || { echo "set ELASTIC_PASSWORD_FOR_MIKE"; exit 1; }

# ---------------------------------------------------------------- preflight --
say "Preflight"
ok "$(nproc) cores, $(free -g | awk '/^Mem:/{print $2}')GB RAM"

# Elasticsearch refuses to start below this and the error is not obvious.
CUR=$(cat /proc/sys/vm/max_map_count)
if [ "$CUR" -lt 262144 ]; then
  echo 'vm.max_map_count=262144' > /etc/sysctl.d/99-elasticsearch.conf
  sysctl -q --system
  ok "vm.max_map_count $CUR -> $(cat /proc/sys/vm/max_map_count)"
else
  ok "vm.max_map_count=$CUR (already sufficient)"
fi

# Stronger than the swappiness=1 used on the Minecraft host. A swapped ES heap
# on a single node does not error -- it presents as random multi-second hangs
# that look like a network fault.
if [ "$(swapon --show --noheadings | wc -l)" -gt 0 ]; then
  swapoff -a
  sed -i '/\sswap\s/s/^\([^#]\)/#\1/' /etc/fstab
  ok "swap disabled and commented out of fstab"
else
  ok "swap already off"
fi

# ------------------------------------------------------------------ docker --
say "Docker"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 git ufw curl jq pipx >/dev/null
systemctl enable --now docker >/dev/null 2>&1
ok "$(docker --version)"

# --------------------------------------------------------------- docker-elk --
say "docker-elk"
if [ -d "$ELK/.git" ]; then
  ok "already cloned"
else
  git clone -q --depth 1 https://github.com/deviantony/docker-elk.git "$ELK"
  ok "cloned $(grep -oP '(?<=^ELASTIC_VERSION=).*' "$ELK/.env")"
fi
cd "$ELK"

# Generate real passwords for every service account. These are machine-only;
# the human login is created separately below.
if ! grep -q '^ELASTIC_PASSWORD=changeme' .env 2>/dev/null && [ -f .env.provisioned ]; then
  ok "service passwords already generated"
else
  for K in ELASTIC_PASSWORD LOGSTASH_INTERNAL_PASSWORD KIBANA_SYSTEM_PASSWORD \
           METRICBEAT_INTERNAL_PASSWORD FILEBEAT_INTERNAL_PASSWORD \
           HEARTBEAT_INTERNAL_PASSWORD MONITORING_INTERNAL_PASSWORD BEATS_SYSTEM_PASSWORD; do
    V=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 28)
    sed -i "s|^${K}=.*|${K}=${V}|" .env 2>/dev/null || true
  done
  touch .env.provisioned
  ok "8 service-account passwords generated"
fi
chmod 600 .env

# docker-elk ships ES_JAVA_OPTS=-Xms512m, which is a demo value. An override
# file keeps upstream clean across git pull.
cat > docker-compose.override.yml <<YML
# Local overrides. Upstream files stay untouched.
services:
  elasticsearch:
    environment:
      # docker-elk ships 512m. Half this host's RAM; never above ~31g on any
      # node -- past that you lose compressed object pointers and usable
      # capacity goes DOWN.
      ES_JAVA_OPTS: -Xms${ES_HEAP} -Xmx${ES_HEAP}
      bootstrap.memory_lock: "true"
    ulimits:
      memlock: { soft: -1, hard: -1 }
      nofile:  { soft: 65536, hard: 65536 }
    restart: unless-stopped
  kibana:
    restart: unless-stopped
YML
ok "override: heap ${ES_HEAP}, memlock, restart policy"

say "Starting Elasticsearch"
docker compose up -d setup >/dev/null 2>&1
EP=$(grep -oP '(?<=^ELASTIC_PASSWORD=).*' .env)
for i in $(seq 1 60); do
  S=$(docker compose exec -T elasticsearch curl -s -u "elastic:$EP" \
      localhost:9200/_cluster/health 2>/dev/null | jq -r .status 2>/dev/null || true)
  [ -n "$S" ] && { ok "cluster $S after $((i*5))s"; break; }
  sleep 5
done
[ -n "${S:-}" ] || { echo "   elasticsearch did not come up; check: docker compose logs elasticsearch"; exit 1; }

if [ "$WITH_LOGSTASH" = "true" ]; then
  docker compose up -d elasticsearch kibana logstash >/dev/null 2>&1
  ok "started with logstash (size the host at 12GB+)"
else
  docker compose up -d elasticsearch kibana >/dev/null 2>&1
  ok "started elasticsearch + kibana (logstash omitted)"
fi

# ---------------------------------------------------------------- accounts --
say "Accounts"
q() { curl -s -u "elastic:$EP" "$@"; }
q -XPUT "http://localhost:9200/_security/user/$KIBANA_USER" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ELASTIC_PASSWORD_FOR_MIKE\",\"roles\":[\"superuser\"],\"full_name\":\"$KIBANA_USER\"}" >/dev/null
ok "human superuser '$KIBANA_USER' created"

# Write-only shipper. Filebeat gets exactly the privileges it needs on mcai-*
# and nothing else.
SHIP_PW=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 28)
q -XPUT "http://localhost:9200/_security/role/mcai_writer" -H 'Content-Type: application/json' -d '{
 "cluster":["monitor","read_ilm"],
 "indices":[{"names":["mcai-*"],"privileges":["create_doc","create_index","write","auto_configure","view_index_metadata"]}]}' >/dev/null
q -XPUT "http://localhost:9200/_security/user/mcai_ship" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$SHIP_PW\",\"roles\":[\"mcai_writer\"],\"full_name\":\"log shipper\"}" >/dev/null
echo "$SHIP_PW" > /root/.mcai_ship_password; chmod 600 /root/.mcai_ship_password
ok "mcai_ship (write-only) — password in /root/.mcai_ship_password"

# Read-only, for anything that should observe but never mutate.
RO_PW=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 28)
q -XPUT "http://localhost:9200/_security/role/mcai_reader" -H 'Content-Type: application/json' -d '{
 "cluster":["monitor"],
 "indices":[{"names":["mcai-*"],"privileges":["read","view_index_metadata"]}]}' >/dev/null
q -XPUT "http://localhost:9200/_security/user/mcai_ro" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$RO_PW\",\"roles\":[\"mcai_reader\"],\"full_name\":\"read-only telemetry\"}" >/dev/null
echo "$RO_PW" > /root/.mcai_ro_password; chmod 600 /root/.mcai_ro_password
ok "mcai_ro (read-only) — password in /root/.mcai_ro_password"

# ---------------------------------------------------------------- mappings --
say "Index templates and retention"
# ORDER MATTERS. These mappings are dynamic:strict, so anything not declared
# here is rejected outright -- with the only symptom being one "events were
# dropped" line in the Filebeat log. The template must exist before ingest.
q -XPUT "http://localhost:9200/_ilm/policy/mcai-logs" -H 'Content-Type: application/json' -d '{
 "policy":{"phases":{
  "hot":{"min_age":"0ms","actions":{"rollover":{"max_primary_shard_size":"10gb","max_age":"7d"},
                                    "set_priority":{"priority":100}}},
  "delete":{"min_age":"180d","actions":{"delete":{}}}}}}' >/dev/null
ok "ILM: rollover 10gb/7d, delete at 180d"

COMMON='"@timestamp":{"type":"date"},"run_id":{"type":"keyword"},"trigger":{"type":"keyword"},
 "code":{"properties":{"version":{"type":"keyword"},"config_hash":{"type":"keyword"}}},
 "perception":{"type":"flattened"},
 "bot":{"properties":{"name":{"type":"keyword"},"role":{"type":"keyword"},
        "health":{"type":"float"},"hunger":{"type":"float"},
        "pos":{"properties":{"x":{"type":"float"},"y":{"type":"float"},"z":{"type":"float"}}}}},
 "game":{"properties":{"tick":{"type":"long"},"dimension":{"type":"keyword"},
        "day":{"type":"long"},"biome":{"type":"keyword"}}}'
SETTINGS='"index.lifecycle.name":"mcai-logs","index.number_of_shards":1,
 "index.number_of_replicas":0,"index.codec":"best_compression",
 "index.mapping.total_fields.limit":250,"index.refresh_interval":"5s"'

q -XPUT "http://localhost:9200/_index_template/mcai-skill" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-skill-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"strict\",\"properties\":{$COMMON,
  \"skill\":{\"properties\":{\"name\":{\"type\":\"keyword\"},\"args\":{\"type\":\"flattened\"},
   \"status\":{\"type\":\"keyword\"},\"duration_ms\":{\"type\":\"long\"},\"detail\":{\"type\":\"text\"},
   \"fail_class\":{\"type\":\"keyword\"},\"distance_moved\":{\"type\":\"float\"},
   \"inventory_delta\":{\"type\":\"flattened\"}}}}}}}" >/dev/null
ok "mcai-skill-* template"

q -XPUT "http://localhost:9200/_index_template/mcai-llm" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-llm-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"strict\",\"properties\":{$COMMON,
  \"llm\":{\"properties\":{\"model\":{\"type\":\"keyword\"},\"endpoint\":{\"type\":\"keyword\"},
   \"prompt_tokens\":{\"type\":\"long\"},\"completion_tokens\":{\"type\":\"long\"},
   \"latency_ms\":{\"type\":\"long\"},\"total_duration_ns\":{\"type\":\"long\"},
   \"load_duration_ns\":{\"type\":\"long\"},\"prompt_eval_duration_ns\":{\"type\":\"long\"},
   \"eval_duration_ns\":{\"type\":\"long\"},\"schema_valid\":{\"type\":\"boolean\"},
   \"error\":{\"type\":\"keyword\"},\"retry_count\":{\"type\":\"short\"}}},
  \"prompt\":{\"properties\":{\"system_hash\":{\"type\":\"keyword\"},\"text\":{\"type\":\"text\"}}},
  \"response\":{\"properties\":{\"text\":{\"type\":\"text\"}}},
  \"messages\":{\"type\":\"flattened\"},\"tool_calls\":{\"type\":\"flattened\"},
  \"outcome\":{\"properties\":{\"status\":{\"type\":\"keyword\"},\"detail\":{\"type\":\"text\"}}}}}}}" >/dev/null
ok "mcai-llm-* template"

q -XPUT "http://localhost:9200/_index_template/mcai-mc" -H 'Content-Type: application/json' -d "{
 \"index_patterns\":[\"mcai-mc-*\"],\"data_stream\":{},\"priority\":500,
 \"template\":{\"settings\":{$SETTINGS},\"mappings\":{\"dynamic\":\"false\",\"properties\":{
  \"@timestamp\":{\"type\":\"date\"},\"message\":{\"type\":\"text\"},
  \"log\":{\"properties\":{\"level\":{\"type\":\"keyword\"},\"thread\":{\"type\":\"keyword\"}}},
  \"mc\":{\"properties\":{\"event\":{\"type\":\"keyword\"},\"player\":{\"type\":\"keyword\"},
   \"x\":{\"type\":\"float\"},\"y\":{\"type\":\"float\"},\"z\":{\"type\":\"float\"},
   \"reason\":{\"type\":\"text\"},\"chat\":{\"type\":\"text\"}}},
  \"host\":{\"properties\":{\"name\":{\"type\":\"keyword\"}}}}}}}" >/dev/null
ok "mcai-mc-* template"

# Paper thread names contain slashes, so the level must be matched greedily
# from the RIGHT -- dissect splits on the first slash and mangles every record.
q -XPUT "http://localhost:9200/_ingest/pipeline/mcai-paper" -H 'Content-Type: application/json' -d '{
 "description":"Parse Paper server logs.",
 "processors":[
  {"grok":{"field":"message","ignore_failure":true,
    "patterns":["\\[%{TIME:mc.time}\\] \\[%{GREEDYDATA:log.thread}/%{LOGLEVEL:log.level}\\]: %{GREEDYDATA:_msg}"]}},
  {"set":{"field":"message","copy_from":"_msg","ignore_empty_value":true}},
  {"remove":{"field":"_msg","ignore_missing":true}},
  {"drop":{"if":"ctx.log?.thread != null && ctx.log.thread.contains(\"RCON\")"}},
  {"grok":{"field":"message","ignore_failure":true,
    "patterns":["%{USERNAME:mc.player}\\[/%{IP}:%{NUMBER}\\] logged in with entity id %{NUMBER} at \\(\\[%{DATA}\\]%{NUMBER:mc.x:float}, %{NUMBER:mc.y:float}, %{NUMBER:mc.z:float}\\)"]}},
  {"set":{"field":"mc.event","value":"join","if":"ctx.message != null && ctx.message.contains(\"logged in with entity id\")"}},
  {"grok":{"field":"message","ignore_failure":true,
    "patterns":["%{USERNAME:mc.player} \\(/%{IP}:%{NUMBER}\\) lost connection: %{GREEDYDATA:mc.reason}",
                "%{USERNAME:mc.player} lost connection: %{GREEDYDATA:mc.reason}"]}},
  {"set":{"field":"mc.event","value":"disconnect","if":"ctx.message != null && ctx.message.contains(\"lost connection\")"}},
  {"grok":{"field":"message","ignore_failure":true,"patterns":["<%{USERNAME:mc.player}> %{GREEDYDATA:mc.chat}"]}},
  {"set":{"field":"mc.event","value":"chat","if":"ctx.mc?.chat != null"}},
  {"set":{"field":"mc.event","value":"warn","if":"ctx.log?.level == \"WARN\""}},
  {"set":{"field":"mc.event","value":"error","if":"ctx.log?.level == \"ERROR\""}},
  {"set":{"field":"mc.event","value":"other","override":false}}
 ],
 "on_failure":[{"set":{"field":"mc.event","value":"parse_failed"}}]}' >/dev/null
ok "mcai-paper ingest pipeline"

# ----------------------------------------------------------------- glances --
say "Glances"
# Ubuntu's glances package omits the web UI static assets, so `glances -w`
# dies on a missing directory. pipx with the [web] extra ships the real thing.
if command -v glances >/dev/null 2>&1 && glances --version 2>/dev/null | grep -q "4\."; then
  ok "glances present"
else
  PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install 'glances[web]' >/dev/null 2>&1 || true
fi
G=$(command -v glances || echo /usr/local/bin/glances)
cat > /etc/systemd/system/glances.service <<EOF
[Unit]
Description=Glances resource monitor (web + REST API)
After=network-online.target
[Service]
Type=simple
Environment=PIPX_HOME=/opt/pipx
ExecStart=$G -w --bind 0.0.0.0 --port 61208
Restart=on-failure
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now glances >/dev/null 2>&1
ok "glances on :61208 ($(systemctl is-active glances))"

# ---------------------------------------------------------------- firewall --
say "Firewall"
ufw allow 22/tcp comment 'ssh' >/dev/null
ufw allow from "$LAN_CIDR" to any port 5601  proto tcp comment 'kibana' >/dev/null
ufw allow from "$LAN_CIDR" to any port 9200  proto tcp comment 'elasticsearch' >/dev/null
ufw allow from "$LAN_CIDR" to any port 61208 proto tcp comment 'glances' >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | grep -c ALLOW) allow rules"

say "Done"
IP=$(hostname -I | awk '{print $1}')
cat <<EOF
   Kibana        http://$IP:5601        login: $KIBANA_USER
   Elasticsearch http://$IP:9200
   Glances       http://$IP:61208

   Shipper password for the Minecraft host's Filebeat:
     sudo cat /root/.mcai_ship_password

   Next: scripts/deploy-harness.sh on the Minecraft host, which wires
   Filebeat here using that password.
EOF
