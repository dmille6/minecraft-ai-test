#!/usr/bin/env bash
# bootstrap-hermes.sh -- Hermes Agent with read-only access to the testbed.
# Run on the ELK host.
#
# Idempotent.
#
#   sudo OLLAMA=http://10.0.0.70:11434 MODEL=qwen2.5:14b-instruct \
#        ES_HOST=10.0.0.186 ES_RO_PW='...' DASH_PASSWORD='...' ./bootstrap-hermes.sh
#
# SECURITY POSTURE -- deliberate, per handoff doc S18.
#
# Hermes executes code. It therefore runs as a dedicated account with NO sudo,
# NO SSH keys, and NOT in the docker group (which is root-equivalent). It reads
# Minecraft and agent state through a READ-ONLY Elasticsearch user rather than
# via RCON or SSH -- least privilege, and it works because the game logs and
# agent telemetry are already indexed.

set -euo pipefail

OLLAMA="${OLLAMA:?set OLLAMA}"
MODEL="${MODEL:-qwen2.5:14b-instruct}"
ES_HOST="${ES_HOST:?set ES_HOST}"
ES_RO_PW="${ES_RO_PW:?set ES_RO_PW}"
DASH_PASSWORD="${DASH_PASSWORD:?set DASH_PASSWORD}"
DASH_USER="${DASH_USER:-mike}"
LAN_CIDR="${LAN_CIDR:-10.0.0.0/24}"
MCAI_IP="${MCAI_IP:-$ES_HOST}"
REPO="${REPO:-https://github.com/dmille6/minecraft-ai-test.git}"
HH=/home/hermes

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "Isolated account"
id hermes >/dev/null 2>&1 || useradd -m -d "$HH" -s /bin/bash hermes
ok "groups: $(id -nG hermes)"
sudo -u hermes bash -c 'sudo -n true 2>/dev/null' && warn "hermes HAS sudo — that is wrong" || ok "no sudo"
[ "$(ls "$HH/.ssh" 2>/dev/null | wc -l)" -eq 0 ] && ok "no ssh keys" || warn "ssh keys present under hermes"
id -nG hermes | grep -qw docker && warn "hermes is in the docker group (root-equivalent)" || ok "not in docker group"

say "Install"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get install -y -qq ripgrep git curl >/dev/null 2>&1 || true
if [ -x "$HH/.local/bin/hermes" ]; then
  ok "already installed"
else
  # The installer inherits the CALLER's cwd, so running it via sudo -u from
  # another user's home makes uv fail on that home's .venv. cd first.
  cd /tmp && sudo -u hermes -H bash -lc \
    "cd $HH && curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup" \
    >/tmp/hermes-install.log 2>&1 || { warn "install failed, see /tmp/hermes-install.log"; tail -5 /tmp/hermes-install.log; exit 1; }
  ok "installed"
fi
HB="$HH/.local/bin/hermes"   # NOT ~/.hermes/bin/hermes
ok "$(cd /tmp && sudo -u hermes -H bash -lc "$HB --version" 2>&1 | head -1)"

say "Model backend"
# Ollama is reachable through the "ollama" provider alias, which maps to a
# custom OpenAI-compatible endpoint.
python3 - "$HH/.hermes/config.yaml" "$MODEL" "$OLLAMA" <<'PY'
import sys, re, pathlib
p, model, base = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3].rstrip('/')
lines = p.read_text().split('\n')
for i, l in enumerate(lines):
    if re.match(r'^\s*default:\s*"', l):   lines[i] = f'  default: "{model}"'
    elif re.match(r'^\s*provider:\s*"', l): lines[i] = '  provider: "ollama"'
    elif re.match(r'^\s*base_url:\s*"', l): lines[i] = f'  base_url: "{base}/v1"'
p.write_text('\n'.join(lines))
print("   config.yaml patched")
PY
chown hermes:hermes "$HH/.hermes/config.yaml"
# Ollama ignores the key but the OpenAI client requires one to exist.
sudo -u hermes bash -c "grep -q '^OPENAI_API_KEY=' $HH/.hermes/.env || echo 'OPENAI_API_KEY=ollama-local-no-auth' >> $HH/.hermes/.env"
ok "model $MODEL at $OLLAMA"

say "Project access (read-only)"
sudo -u hermes git clone -q "$REPO" "$HH/project" 2>/dev/null || sudo -u hermes git -C "$HH/project" pull -q
ok "repo at $HH/project ($(sudo -u hermes git -C "$HH/project" rev-parse --short HEAD 2>/dev/null || echo cloned))"

sudo -u hermes mkdir -p "$HH/bin"
sudo -u hermes bash -c "grep -q 'MCAI_ES_' $HH/.hermes/.env || printf 'MCAI_ES_URL=http://$ES_HOST:9200\nMCAI_ES_USER=mcai_ro\nMCAI_ES_PASS=$ES_RO_PW\n' >> $HH/.hermes/.env"

cat > "$HH/bin/mcai-es" <<'EOF'
#!/usr/bin/env bash
# Query the project's Elasticsearch. READ-ONLY account; writes are rejected by
# Elasticsearch itself, not merely by convention.
set -euo pipefail
. <(grep -E '^MCAI_ES_' "$HOME/.hermes/.env")
P="${1:-_cat/indices/mcai-*?v}"; shift || true
curl -s -u "$MCAI_ES_USER:$MCAI_ES_PASS" "$MCAI_ES_URL/$P" "$@"
EOF

cat > "$HH/bin/mcai-status" <<EOF
#!/usr/bin/env bash
# One-shot health of the whole testbed, from read-only endpoints.
set -uo pipefail
echo "## Minecraft"
curl -s --max-time 5 "http://$MCAI_IP:8080/tiles/players.json" 2>/dev/null \\
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('  online:',[p['name'] for p in d.get('players',[])] or 'nobody')" 2>/dev/null \\
  || echo "  (map API unreachable)"
echo "## Hosts"
for h in $MCAI_IP:mcai $ES_HOST:mcelk; do
  IP="\${h%%:*}"; N="\${h##*:}"
  curl -s --max-time 5 "http://\$IP:61208/api/4/quicklook" 2>/dev/null \\
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f\"  \$N cpu={d.get('cpu',0):.0f}% mem={d.get('mem',0):.0f}%\")" 2>/dev/null || echo "  \$N unreachable"
done
echo "## Agent telemetry (24h)"
"\$HOME/bin/mcai-es" "mcai-skill-agents/_search?size=0" -H 'Content-Type: application/json' -d '{
 "query":{"range":{"@timestamp":{"gte":"now-24h"}}},
 "aggs":{"s":{"terms":{"field":"skill.name","size":10},"aggs":{"st":{"terms":{"field":"skill.status"}}}}}}' 2>/dev/null \\
 | python3 -c "
import sys,json
a=json.load(sys.stdin).get('aggregations',{}).get('s',{}).get('buckets',[])
for b in a: print(f\"  {b['key']}: {{x['key']:x['doc_count'] for x in b['st']['buckets']}}\")
if not a: print('  no activity')" 2>/dev/null || echo "  (es unreachable)"
EOF
sed -i "s|\$MCAI_IP|${MCAI_IP:-$ES_HOST}|g" "$HH/bin/mcai-status"
chmod +x "$HH/bin/mcai-es" "$HH/bin/mcai-status"
chown -R hermes:hermes "$HH/bin"
sudo -u hermes bash -c "grep -q 'HOME/bin' $HH/.bashrc || echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> $HH/.bashrc"
ok "mcai-es + mcai-status on PATH"

say "Standing context"
# Written as root then chowned: the .hermes directory is mode 700 and
# `sudo -u hermes tee` into it is unreliable.
cat > "$HH/.hermes/MEMORY.md" <<EOF
# Project: minecraft-ai-test

You are embedded in a private Minecraft AI research testbed. This is standing
context — you do not need to ask the operator for any of it.

## You already have access. Do not ask for SSH credentials.

You have **no SSH access and no Minecraft RCON access, deliberately**. You
execute code, so the design treats you as untrusted automation and gives you
purpose-built read-only tools instead of shell access to the game server. See
\`~/project/docs/ops/services.md\`. Asking for SSH keys or passwords is the
wrong move — use the tools below.

## Your tools (installed, on your PATH)

    mcai-status     health of the whole testbed: who is online, host CPU/memory,
                    and a 24h summary of agent skill outcomes. Run this first
                    when asked "how are things?"

    mcai-es <path>  query Elasticsearch with a READ-ONLY account, e.g.
                      mcai-es "_cat/indices/mcai-*?v"
                      mcai-es "mcai-skill-agents/_search?size=5&sort=@timestamp:desc"
                    Writes are rejected by Elasticsearch, not by convention.

    ~/project       full clone of the project repo. Every architecture decision
                    and runbook lives here. Read it before speculating —
                    especially docs/decisions/ADR-0001 and ADR-0002.
                    Refresh with: git -C ~/project pull

## Data available (read-only)

| Index | Contents |
|---|---|
| \`mcai-skill-agents\` | every skill attempt AND every reflex firing, entrapment, livelock escape, death |
| \`mcai-llm-agents\` | LLM decisions: prompt, response, latency breakdown, what was chosen, what happened |
| \`mcai-mc-paper\` | parsed server logs: joins with coordinates, deaths with cause, chat |

Retention 180 days. **Field gotcha: the game agent is \`bot.*\`, not \`agent.*\`** —
ECS reserves \`agent.*\` for the log shipper.

Useful fields: \`code.version\` (which commit produced a run), \`perception\`
(what the bot could see when deciding), \`skill.fail_class\`,
\`skill.inventory_delta\`, \`llm.schema_valid\`, \`llm.load_duration_ns\`.

## How to be useful here

Prefer measurement over speculation — the telemetry exists precisely so
questions get answered with data. Asked about agent behaviour, query
\`mcai-skill-agents\`. Asked about design, read the ADRs rather than inventing
rationale.

**The agent does not learn between runs.** Its memory dies at restart and no
lesson persists. When hazard rates fall, that is a human having changed code,
not self-improvement. Do not describe it as the agent learning.
EOF
chown hermes:hermes "$HH/.hermes/MEMORY.md"; chmod 600 "$HH/.hermes/MEMORY.md"
ok "MEMORY.md written ($(wc -l < "$HH/.hermes/MEMORY.md") lines)"

say "Dashboard"
cat > /etc/systemd/system/hermes-dashboard.service <<EOF
[Unit]
Description=Hermes Agent web dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hermes
Group=hermes
WorkingDirectory=$HH
Environment=HOME=$HH
# A non-loopback bind requires an auth provider since the June 2026 hardening;
# --insecure is a no-op now.
Environment=HERMES_DASHBOARD_BASIC_AUTH_USERNAME=$DASH_USER
Environment=HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=$DASH_PASSWORD
ExecStart=$HB dashboard --host 0.0.0.0 --port 9119 --no-open
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=false
ReadWritePaths=$HH

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now hermes-dashboard >/dev/null 2>&1
ufw allow from "$LAN_CIDR" to any port 9119 proto tcp comment 'hermes dashboard' >/dev/null 2>&1 || true
for i in $(seq 1 40); do ss -lnt 2>/dev/null | grep -q 9119 && break; sleep 5; done
ok "dashboard $(systemctl is-active hermes-dashboard) on :9119"

say "Done"
echo "   Hermes dashboard  http://$(hostname -I | awk '{print $1}'):9119   login: $DASH_USER"
echo "   Ask it something: sudo -u hermes -H bash -lc 'cd $HH && hermes -z \"run mcai-status\"'"
