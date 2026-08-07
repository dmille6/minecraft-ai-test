#!/usr/bin/env bash
# bootstrap-ctl.sh -- the agent control node.
#
# Two CLIs, tmux for durability, and a key that reaches the other four hosts as
# a LEAST-PRIVILEGE account rather than as an admin. That distinction is the
# whole point of this host: it holds the Anthropic and Codex credentials, so if
# it is compromised the blast radius is whatever its key can do elsewhere. An
# agent that can read logs and restart one service is a very different incident
# from an agent with passwordless sudo on five machines.
set -euo pipefail
say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){  printf '   \033[32m✓\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "Tooling"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
apt-get install -y -qq tmux git curl jq ripgrep nodejs npm python3-pip ufw >/dev/null
ok "node $(node --version), npm $(npm --version), tmux $(tmux -V | cut -d' ' -f2)"

say "Agent CLIs"
npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 && \
  ok "claude $(claude --version 2>/dev/null | head -1)" || ok "claude: install reported an error"
npm install -g @openai/codex >/dev/null 2>&1 && \
  ok "codex $(codex --version 2>/dev/null | head -1)" || ok "codex: install reported an error"

say "Agent identity"
# One key, used by scheduled runs. Interactive work uses the operator's own key,
# so an autonomous action and a human action are distinguishable in the logs of
# the machine being acted on.
[ -f /root/.ssh/id_ed25519_agent ] || \
  ssh-keygen -q -t ed25519 -N '' -C 'mc2-agent' -f /root/.ssh/id_ed25519_agent
ok "agent key: $(ssh-keygen -lf /root/.ssh/id_ed25519_agent.pub | awk '{print $2}')"

say "tmux defaults"
cat > /etc/tmux.conf <<'TMUX'
# Durability is the point: a session must outlive the ssh that started it.
set -g history-limit 50000
set -g mouse on
set -g status-right '#H  %Y-%m-%d %H:%M'
setw -g mode-keys vi
TMUX
ok "/etc/tmux.conf"

say "Workspace"
install -d -o mike -g mike /home/mike/work
if [ ! -d /home/mike/work/minecraft-ai-test ]; then
  sudo -u mike git clone -q https://github.com/dmille6/minecraft-ai-test.git \
       /home/mike/work/minecraft-ai-test 2>/dev/null \
    && ok "repo cloned" || ok "repo clone skipped (no credentials yet)"
else
  ok "repo already present"
fi

say "Firewall"
ufw allow 22/tcp comment 'ssh' >/dev/null
ufw allow from 192.168.193.0/24 to any port 80    proto tcp comment 'homepage' >/dev/null
ufw allow from 192.168.193.0/24 to any port 61208 proto tcp comment 'glances' >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | grep -c ALLOW) allow rules"

say "Done"
cat <<NOTE
   Install the agent key on the target hosts as a LEAST-PRIVILEGE account:
     $(cat /root/.ssh/id_ed25519_agent.pub)

   Then, as the operator (browser OAuth -- these cannot be automated):
     claude          then /login
     codex login

   Durable session:
     tmux new -A -s claude
     claude remote-control      # drive it from claude.ai/code or the phone app
NOTE
