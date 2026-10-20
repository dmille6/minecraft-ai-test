#!/usr/bin/env bash
# ON THE SHOWCASE VM (10.0.0.40), as root: base system for the showcase. Idempotent; refuses on a host that is not
# the showcase. Design: docs/reports/showcase-2026-10-20.md section 1.
#
#   sudo bash provision-vm.sh <stage-dir> <repo-dir>
#
# <stage-dir> holds what is COPIED from the bench (never downloaded): nodesource.gpg, elastic.gpg, the two apt source
# files from 10.0.0.31; paper.jar, eula.txt, PAPER-BUILD.txt and paper-runtime.tar (cache/ libraries/ versions/) from
# 10.0.0.30's template / a bench world; bluemap-cli.jar from 10.0.0.30 ~/bluemap. <repo-dir> is a checkout of this
# repository (infra/showcase/files/*).
set -euo pipefail
STAGE=${1:?usage: provision-vm.sh <stage-dir> <repo-dir>}; REPO=${2:?repo dir}
F=$REPO/infra/showcase/files
say(){ printf '\n== %s\n' "$*"; }; ok(){ printf '   ok  %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ "$(hostname)" = showcase ] || { echo "refusing: this is $(hostname), not the showcase VM"; exit 1; }
ip -4 addr show | grep -q 'inet 10.0.0.40/' || { echo "refusing: 10.0.0.40 is not on this host"; exit 1; }

say "apt sources (nodesource 22, elastic 9) copied from 10.0.0.31"
install -m 644 "$STAGE/nodesource.gpg" /usr/share/keyrings/nodesource.gpg
install -m 644 "$STAGE/elastic.gpg" /usr/share/keyrings/elastic.gpg
install -m 644 "$STAGE/nodesource.sources" /etc/apt/sources.list.d/nodesource.sources
install -m 644 "$STAGE/elastic-9.x.list" /etc/apt/sources.list.d/elastic-9.x.list
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
# The fleet's exact versions: node 22.23.2 (10.0.0.31), filebeat 9.5.1, Java 21 (10.0.0.30).
apt-get install -y -qq --allow-downgrades nodejs=22.23.2-1nodesource1 filebeat=9.5.1 openjdk-21-jre-headless \
  rsync acl ufw ffmpeg fonts-dejavu-core zstd git python3 jq \
  libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 >/dev/null
apt-mark hold nodejs filebeat >/dev/null
ok "node $(node --version), filebeat $(filebeat version | awk '{print $3}'), $(java -version 2>&1 | head -1)"

say "users and groups"
id minecraft >/dev/null 2>&1 || useradd --system --home /srv/showcase/server --shell /usr/sbin/nologin minecraft
id mcbot >/dev/null 2>&1 || useradd --system --home /srv/showcase/harness --shell /usr/sbin/nologin mcbot
id showbak >/dev/null 2>&1 || useradd --create-home --shell /bin/bash showbak
getent group showops >/dev/null || groupadd showops
usermod -aG showops mike
ok "minecraft, mcbot, showbak; mike in showops"

say "layout"
install -d -o root -g root -m 755 /srv/showcase /srv/showcase/bin /srv/showcase/releases /srv/showcase/artifacts
install -d -o minecraft -g minecraft -m 750 /srv/showcase/server
install -d -o root -g showops -m 750 /srv/showcase/secrets
install -d -o mike -g mike -m 755 /srv/showcase/timelapse /srv/showcase/bluemap /var/log/showcase
install -d -o root -g root -m 755 /srv/showcase/backup-stage
install -d -o mcbot -g mcbot -m 755 /var/log/mcai /var/lib/mcai
touch /srv/showcase/save.lock && chgrp showops /srv/showcase/save.lock && chmod 664 /srv/showcase/save.lock
install -d -o root -g showops -m 775 /srv/showcase/ops
# the timelapse runs as mike and must READ the world Paper writes (minecraft, 0750): an ACL, inherited by every file
# Paper creates later (a default ACL), read-only
setfacl -R -m u:mike:rX /srv/showcase/server
setfacl -R -d -m u:mike:rX /srv/showcase/server
ok "/srv/showcase/{server,bin,releases,artifacts,secrets,timelapse,bluemap,backup-stage}; mike reads the world (ACL)"

say "Paper: the fleet's jar, checked"
want=8de7c52c3b02403503d16fac58003f1efef7dd7a0256786843927fa92ee57f1e
got=$(sha256sum "$STAGE/paper.jar" | cut -d' ' -f1)
[ "$got" = "$want" ] || { echo "paper.jar sha256 $got != fleet $want"; exit 1; }
if [ ! -f /srv/showcase/server/paper.jar ]; then
  install -o minecraft -g minecraft -m 644 "$STAGE/paper.jar" "$STAGE/eula.txt" "$STAGE/PAPER-BUILD.txt" /srv/showcase/server/
  tar -C /srv/showcase/server -xf "$STAGE/paper-runtime.tar"
  chown -R minecraft:minecraft /srv/showcase/server
fi
ok "$(cat /srv/showcase/server/PAPER-BUILD.txt)"

say "units (bots installed, NOT enabled)"
for u in showcase-paper.service mcshow@.service showcase-studio-tunnel.service showcase-bluemap-web.service \
         showcase-tl.service showcase-tl.timer showcase-video@.service; do
  install -m 644 "$F/$u" "/etc/systemd/system/$u"
done
grep -v '^#' "$F/timers.txt" | while read -r name cal rest; do
  [ -n "$name" ] || continue
  cat > "/etc/systemd/system/showcase-video-$name.timer" <<EOF
[Unit]
Description=SHOWCASE timelapse video: $name
[Timer]
OnCalendar=$cal${rest:+ $rest}
Unit=showcase-video@$name.service
Persistent=true
[Install]
WantedBy=timers.target
EOF
done
systemctl daemon-reload
ok "$(ls /etc/systemd/system | grep -c -E '^(showcase|mcshow)') unit files"

say "logrotate (the fleet's: copytruncate -- the bots never reopen their log)"
cat > /etc/logrotate.d/mcai <<'EOF'
/var/log/mcai/*/skill-*.jsonl
/var/log/mcai/*/llm-*.jsonl
/var/log/showcase/heartbeat.jsonl
{
    daily
    rotate 14
    copytruncate
    compress
    missingok
    notifempty
    dateext
}
EOF
ok "/etc/logrotate.d/mcai"

say "firewall: LAN only; RCON loopback only"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
for p in 22 25565 8100; do ufw allow from 10.0.0.0/24 to any port $p proto tcp >/dev/null; done
ufw allow from 10.0.0.0/24 to any port 3200:3209 proto tcp >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | grep -c ALLOW) allow rules; 25575 (RCON) not among them"
