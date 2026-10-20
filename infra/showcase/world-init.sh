#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: (re)create the showcase WORLD for one seed. Used for the seed trial and once for the
# chosen seed. REFUSES once the town is placed or frame 0 exists (the world is then the showcase's history).
#   sudo bash world-init.sh <seed>
# server.properties = provision-block2.sh's bench values + the showcase's port/motd. RCON password: generated once,
# kept in /srv/showcase/secrets/rcon.json (root:showops 0640), never printed.
set -euo pipefail
SEED=${1:?usage: world-init.sh <seed>}
S=/srv/showcase/server
[ "$(hostname)" = showcase ] || { echo "refusing: not the showcase VM"; exit 1; }
[ ! -e /srv/showcase/timelapse/FRAME0.json ] || { echo "refusing: frame 0 exists -- this world is the showcase's history"; exit 1; }
[ ! -e $S/TOWN-PLACED.json ] || { echo "refusing: the town is placed"; exit 1; }
SEC=/srv/showcase/secrets/rcon.json
if [ ! -s $SEC ]; then
  PW=$(head -c 30 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  ( umask 027; printf '{"host": "127.0.0.1", "port": 25575, "password": "%s"}\n' "$PW" > $SEC )
  chgrp showops $SEC; chmod 640 $SEC; unset PW
fi
PW=$(python3 -c 'import json; print(json.load(open("/srv/showcase/secrets/rcon.json"))["password"])')
systemctl stop showcase-paper.service 2>/dev/null || true
rm -rf $S/world $S/world_nether $S/world_the_end
umask 027
# The bench's full server.properties (board-a, 10-15, minus its secrets/seed/ports/motd), then the showcase's own
# keys. The full file matters: Paper's default pause-when-empty-seconds=60 STOPS TICKING with no player online, so a
# world with no bot yet would never generate a forceloaded chunk (found in the seed trial, 10-20 13:40Z).
{ cat /srv/showcase/tools/infra/showcase/files/server.properties.base
  printf 'level-seed=%s\nserver-port=25565\nquery.port=25565\nrcon.port=25575\nrcon.password=%s\nmotd=showcase\n' "$SEED" "$PW"
} > $S/server.properties
unset PW
# bots pre-whitelisted with their OFFLINE uuids (online-mode=false: uuid = v3 md5("OfflinePlayer:" + name))
python3 - > $S/whitelist.json <<'PY'
import hashlib, json, uuid
names = ['showcase-' + n for n in ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost', 'Gale', 'Haven', 'Iris', 'Juno']]
def off(n):
    h = bytearray(hashlib.md5(('OfflinePlayer:' + n).encode()).digest())
    h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80
    return str(uuid.UUID(bytes=bytes(h)))
print(json.dumps([{'uuid': off(n), 'name': n} for n in names], indent=2))
PY
chown -R minecraft:minecraft $S
chmod 640 $S/server.properties
sudo -u minecraft test -r $S/server.properties || { echo "server.properties not readable by minecraft"; exit 1; }
systemctl enable --now showcase-paper.service >/dev/null 2>&1
for i in $(seq 1 120); do
  grep -q 'Done (' $S/logs/latest.log 2>/dev/null && break; sleep 2
done
grep -q 'Done (' $S/logs/latest.log || { echo "Paper did not finish starting"; tail -20 $S/logs/latest.log; exit 1; }
echo "world for seed $SEED up: $(grep -m1 'Done (' $S/logs/latest.log | sed 's/.*Done/Done/')"
