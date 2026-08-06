#!/usr/bin/env bash
# sync-harness.sh -- pull the repo on the bot host, copy the agent source into
# the runtime directory, restamp CODE_VERSION, and restart the fleet.
#
# This exists because the manual version of it was wrong in a way nothing
# reported. The runtime lives at /srv/mcbots/harness but the git checkout is at
# /opt/minecraft-ai, so a deploy is "pull, then copy". CODE_VERSION, however, is
# baked into the per-instance env files by bootstrap-mcbots.sh and is never
# touched again -- so the code changed and the version stamp did not.
#
# Every telemetry document carries code.version. It read 6a53b52 for a full day
# while four different commits were actually running, which makes "did this
# deploy change behaviour?" unanswerable: the axis you would split on is a
# constant. A stale version stamp is worse than no version stamp, because a
# missing field looks missing and a wrong one looks like evidence.
#
#   ./scripts/sync-harness.sh
#
# Environment:
#   BOT_HOST   default 10.0.0.187
#   SSH_KEY    default ~/.ssh/id_ed25519_aiservers
#   NO_RESTART set to any value to sync without restarting the bots

set -euo pipefail

BOT_HOST="${BOT_HOST:-10.0.0.187}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_aiservers}"
INSTANCES="${INSTANCES:-scout scout2 miner gatherer gather2}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }

say "Syncing harness to $BOT_HOST"

# Instance names are the ROLE (scout, miner, gatherer), not the display name
# (Scout01, Miner01). `systemctl restart mcbot@Miner01` is a valid template
# instantiation for an env file that does not exist, so systemd cheerfully
# creates a brand new unit that fails in a restart loop while the real bot keeps
# running untouched -- a deploy that reports failure and changes nothing.
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "mike@$BOT_HOST" \
  "set -euo pipefail
   sudo git -C /opt/minecraft-ai pull -q
   VER=\$(sudo git -C /opt/minecraft-ai rev-parse --short HEAD)
   echo \"   repo at \$VER\"

   sudo cp -r /opt/minecraft-ai/bots/src/. /srv/mcbots/harness/src/
   sudo chown -R mcbot:mcbot /srv/mcbots/harness/src

   # Restamp every env file. Rewritten in place rather than appended, so a file
   # never ends up with two CODE_VERSION lines where the last one silently wins.
   for f in /srv/mcbots/harness/env/*.env; do
     case \"\$f\" in *.pre-*|*.bak) continue;; esac
     if sudo grep -q '^CODE_VERSION=' \"\$f\"; then
       sudo sed -i \"s|^CODE_VERSION=.*|CODE_VERSION=\$VER|\" \"\$f\"
     else
       echo \"CODE_VERSION=\$VER\" | sudo tee -a \"\$f\" >/dev/null
     fi
   done
   echo \"   env files now stamped: \$(sudo grep -h '^CODE_VERSION=' /srv/mcbots/harness/env/*.env | sort -u | tr '\n' ' ')\"

   if [ -z \"\${NO_RESTART:-}\" ]; then
     for i in $INSTANCES; do sudo systemctl restart \"mcbot@\$i\"; sleep 4; done
   fi"

ok "source copied and CODE_VERSION restamped"

if [ -z "${NO_RESTART:-}" ]; then
  sleep 20
  say "Fleet"
  ssh -i "$SSH_KEY" -o BatchMode=yes "mike@$BOT_HOST" \
    "for i in $INSTANCES; do printf '   %-9s %s\n' \"\$i\" \"\$(systemctl is-active mcbot@\$i)\"; done"
fi

# The version stamp is only trustworthy if something checks it, so check it.
say "Verifying the stamp matches the code"
ssh -i "$SSH_KEY" -o BatchMode=yes "mike@$BOT_HOST" \
  'RUNNING=$(sudo git -C /opt/minecraft-ai rev-parse --short HEAD)
   STAMPED=$(sudo grep -h "^CODE_VERSION=" /srv/mcbots/harness/env/*.env | sort -u | cut -d= -f2)
   if [ "$RUNNING" = "$STAMPED" ]; then echo "   ✓ both $RUNNING"
   else echo "   ✗ code is $RUNNING but telemetry will say $STAMPED"; exit 1; fi'
