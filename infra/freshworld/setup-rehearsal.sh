#!/usr/bin/env bash
# ON THE REHEARSAL VM (vm-minecraft-ai-v2, vmid 118), as root: the base system and the WORLD for one fresh-world
# rehearsal. Idempotent up to the world: it REFUSES to touch a level that already has a day-0 snapshot or a bot's data.
# The model is infra/showcase/provision-vm.sh + world-init.sh; what differs is in infra/freshworld/rehearsal-0.json.
#
#   sudo bash setup-rehearsal.sh <stage-dir> <seed> <level-name>
#
# <stage-dir> holds what is COPIED from the project's own hosts (never fetched by hand): nodesource.gpg and
# nodesource.sources from the showcase VM, server.properties.base and the two unit files from this repository.
# Paper comes from the VM's own retired testbed server (/srv/minecraft/server), checked against the fleet's jar digest.
# The old testbed world there is never touched.
set -euo pipefail
STAGE=${1:?usage: setup-rehearsal.sh <stage-dir> <seed> <level-name>}; SEED=${2:?seed}; LEVEL=${3:?level name}
R=/srv/rehearsal; S=$R/server; OLD=/srv/minecraft/server
say(){ printf '\n== %s\n' "$*"; }; ok(){ printf '   ok  %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ "$(hostname)" = vm-minecraft-ai-v2 ] || { echo "refusing: this is $(hostname), not the rehearsal VM"; exit 1; }
[[ "$LEVEL" =~ ^fw-[a-z0-9]+$ ]] || { echo "refusing: level name $LEVEL is not fw-<id>"; exit 1; }
case "$LEVEL" in fw-t10|fw-s10) echo "refusing: $LEVEL is a finish-line world (owner 11-10); a rehearsal never uses it"; exit 1;; esac
[ ! -e $R/snapshots/day0.json ] || { echo "refusing: a day-0 snapshot exists -- this world is a run's start"; exit 1; }
if ls /var/lib/mcai/rh0-* >/dev/null 2>&1; then echo "refusing: bot state exists under /var/lib/mcai"; exit 1; fi

say "packages (node 22.23.2 from the project's nodesource source, the showcase's library list)"
install -m 644 "$STAGE/nodesource.gpg" /usr/share/keyrings/nodesource.gpg
install -m 644 "$STAGE/nodesource.sources" /etc/apt/sources.list.d/nodesource.sources
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
apt-get install -y -qq --allow-downgrades nodejs=22.23.2-1nodesource1 openjdk-21-jre-headless \
  rsync acl ufw zstd git python3 jq \
  libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 >/dev/null
apt-mark hold nodejs >/dev/null
ok "node $(node --version), $(java -version 2>&1 | head -1)"

say "users and layout"
id minecraft >/dev/null 2>&1 || useradd --system --home $S --shell /usr/sbin/nologin minecraft
id mcbot >/dev/null 2>&1 || useradd --system --home $R/harness --shell /usr/sbin/nologin mcbot
getent group rhops >/dev/null || groupadd rhops
usermod -aG rhops mike
install -d -o root -g root -m 755 $R $R/bin $R/releases $R/tools
install -d -o minecraft -g minecraft -m 750 $S
install -d -o root -g rhops -m 750 $R/secrets
install -d -o root -g rhops -m 775 $R/ops $R/snapshots
install -d -o mcbot -g mcbot -m 755 /var/log/mcai /var/lib/mcai
ok "$R/{server,bin,releases,tools,secrets,ops,snapshots}; /var/log/mcai, /var/lib/mcai"

say "Paper: this VM's testbed jar, checked against the fleet's"
want=8de7c52c3b02403503d16fac58003f1efef7dd7a0256786843927fa92ee57f1e
got=$(sha256sum $OLD/paper.jar | cut -d' ' -f1)
[ "$got" = "$want" ] || { echo "paper.jar sha256 $got != fleet $want"; exit 1; }
if [ ! -f $S/paper.jar ]; then
  install -o minecraft -g minecraft -m 644 $OLD/paper.jar $OLD/eula.txt $S/
  for d in cache libraries versions; do cp -a $OLD/$d $S/; done
  chown -R minecraft:minecraft $S
fi
ok "paper.jar $got"

say "units (bots installed, NOT enabled)"
install -m 644 "$STAGE/rehearsal-paper.service" /etc/systemd/system/rehearsal-paper.service
install -m 644 "$STAGE/rhbot@.service" /etc/systemd/system/rhbot@.service
systemctl daemon-reload
ok "rehearsal-paper.service, rhbot@.service"

say "firewall (the showcase's rules: ssh and the game port from the lab network only; RCON stays local)"
ufw allow from 10.0.0.0/24 to any port 22 proto tcp >/dev/null
ufw allow from 10.0.0.0/24 to any port 25565 proto tcp >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | sed -n 1p)"

say "world $LEVEL"
SEC=$R/secrets/rcon.json
if [ ! -s $SEC ]; then
  PW=$(head -c 30 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  ( umask 027; printf '{"host": "127.0.0.1", "port": 25575, "password": "%s"}\n' "$PW" > $SEC )
  chgrp rhops $SEC; chmod 640 $SEC; unset PW
fi
PW=$(python3 -c 'import json; print(json.load(open("/srv/rehearsal/secrets/rcon.json"))["password"])')
systemctl stop rehearsal-paper.service 2>/dev/null || true
rm -f $S/logs/latest.log
umask 027
# The showcase's LIVE server.properties (read 11-14) = the repo base with allow-flight=true, plus this world's own keys.
{ grep -v -E '^(allow-flight|level-name)=' "$STAGE/server.properties.base"
  printf 'allow-flight=true\nlevel-name=%s\nlevel-seed=%s\nserver-port=25565\nquery.port=25565\nrcon.port=25575\nrcon.password=%s\nmotd=rehearsal\n' "$LEVEL" "$SEED" "$PW"
} > $S/server.properties
unset PW
python3 - > $S/whitelist.json <<'PY'
import hashlib, json, uuid
names = ['rh0-' + n for n in ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno', 'Kite', 'Lumen']]
def off(n):
    h = bytearray(hashlib.md5(('OfflinePlayer:' + n).encode()).digest())
    h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80
    return str(uuid.UUID(bytes=bytes(h)))
print(json.dumps([{'uuid': off(n), 'name': n} for n in names], indent=2))
PY
chown -R minecraft:minecraft $S
chmod 640 $S/server.properties
systemctl enable --now rehearsal-paper.service >/dev/null 2>&1
for i in $(seq 1 180); do
  grep -q 'Done (' $S/logs/latest.log 2>/dev/null && ss -ltn | grep -q ':25575 ' && break; sleep 2
done
grep -q 'Done (' $S/logs/latest.log || { echo "Paper did not finish starting"; tail -20 $S/logs/latest.log; exit 1; }
[ -d $S/$LEVEL ] || { echo "level directory $S/$LEVEL was not created"; exit 1; }
[ -d $OLD/world ] || { echo "the old testbed world is missing -- it must never be touched"; exit 1; }
echo "world $LEVEL for seed $SEED up: $(grep -m1 'Done (' $S/logs/latest.log | sed 's/.*Done/Done/')"
