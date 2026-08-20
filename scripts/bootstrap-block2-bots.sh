#!/usr/bin/env bash
# Stand up the 40-bot runtime on block2-bots, matching the live fleet's layout.
set -euo pipefail
H=/srv/mcbots/harness
id -u mcbot >/dev/null 2>&1 || useradd -r -m -d /srv/mcbots -s /bin/bash mcbot
mkdir -p "$H/env" /var/log/mcai /var/lib/mcai
# the harness itself
rsync -a --delete --exclude env /opt/minecraft-ai/bots/ "$H/"
chown -R mcbot:mcbot /srv/mcbots /var/log/mcai /var/lib/mcai

cat > /etc/systemd/system/mcbot@.service <<UNIT
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
# 768MB heap and a hard 1G cgroup ceiling. The live fleet runs 3072 for TEN
# bots; forty of those on a 46GB VM would be 120GB of permitted heap, and this
# codebase has already lost a fleet to 48 OOM kills from unbounded waits. The
# ceiling is identical for every bot, which is what the experiment requires --
# it is not generous, it is EQUAL.
ExecStart=/usr/bin/node --max-old-space-size=768 --heapsnapshot-near-heap-limit=1 src/index.mjs
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=10
MemoryMax=1G
MemoryHigh=850M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/srv/mcbots /var/log/mcai /var/lib/mcai

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
echo "  mcbot@.service written"
echo "  harness: $(ls $H/src | wc -l) source files, $(ls $H/node_modules | wc -l) packages"
