#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: install the showcase tools from a checkout of branch showcase-1020 (/srv/showcase/tools)
# into /srv/showcase/bin, plus the follow timer and the backup user's forced-command keys + sudoers.
#   sudo bash install-bin.sh [/srv/showcase/tools]
set -euo pipefail
T=${1:-/srv/showcase/tools}
S=$T/infra/showcase
install -d /srv/showcase/bin
for f in followrule.py make_env.py showcase_ops.py tl_showcase.py tl_video.py rcon.py backup_stage.py showcase-feed.py \
         tl_setup.py site_search.py world-init.sh start-bots.sh stop-bots.sh replay-prompts.sh replay-prompts.mjs \
         stamp_town.py pregen.py; do
  install -m 755 "$S/$f" /srv/showcase/bin/
done
install -m 644 "$T/scripts/lib/showcasestatus.py" /srv/showcase/bin/
install -m 644 "$T/scripts/lib/protected.py" /srv/showcase/bin/    # the one protected-path decider (W1); showcase_ops imports it
echo "   ok  tools in /srv/showcase/bin ($(git -C "$T" rev-parse --short HEAD))"

cat > /etc/systemd/system/showcase-follow.service <<'EOF'
[Unit]
Description=SHOWCASE follower: observe the bench (read-only feed), decide, act only if /srv/showcase/AUTO_FOLLOW
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /srv/showcase/bin/showcase_ops.py follow
Nice=10
TimeoutStartSec=50min
EOF
cat > /etc/systemd/system/showcase-follow.timer <<'EOF'
[Unit]
Description=SHOWCASE follower, hourly
[Timer]
OnCalendar=*:05:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
echo "   ok  showcase-follow.timer installed (enable separately)"

# The backup user: three keys from 10.0.0.30, each with ONE forced command (authorized_keys.showbak is filled by the
# operator with the .30 public keys; see docs/reports/showcase-2026-10-20.md section 8).
cat > /etc/sudoers.d/showcase-backup <<'EOF'
# showcase backups (from 10.0.0.30 only, via forced-command keys): exactly these two commands.
Defaults!/usr/bin/rrsync env_keep += "SSH_ORIGINAL_COMMAND"
showbak ALL=(root) NOPASSWD: /usr/bin/python3 /srv/showcase/bin/backup_stage.py, /usr/bin/rrsync -ro /srv/showcase/backup-stage/
EOF
chmod 440 /etc/sudoers.d/showcase-backup
visudo -cf /etc/sudoers.d/showcase-backup >/dev/null && echo "   ok  sudoers for showbak"
