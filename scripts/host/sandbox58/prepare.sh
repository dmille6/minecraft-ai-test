#!/bin/bash
# ONE-TIME preparation of sandbox5..8 on the worlds host 10.0.0.30 (owner approved 2026-10-20 ~12:45Z).
# Creates the server dirs and unit files ONLY: no daemon-reload, no enable, no start. enable.sh does those after the
# RAM upgrade. Refuses if any target dir or unit already exists, so it can never overwrite a live sandbox.
#   sudo bash prepare.sh
set -euo pipefail
SRC=/srv/block2/sandbox2          # the cleanest of 1-4: no CoreProtect (sandbox), no mbench world (sandbox4)
U4=/etc/systemd/system/block2-sandbox4.service
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
for n in 5 6 7 8; do
  [ ! -e /srv/block2/sandbox$n ] || { echo "refusing: /srv/block2/sandbox$n exists"; exit 1; }
  [ ! -e /etc/systemd/system/block2-sandbox$n.service ] || { echo "refusing: unit block2-sandbox$n exists"; exit 1; }
done
for n in 5 6 7 8; do
  D=/srv/block2/sandbox$n; GP=$((25598 + n)); RP=$((25698 + n))
  mkdir "$D"
  # The server layer only: jar, libraries, mojang cache, configs, empty op/ban/whitelist files.
  # Never a world, a log, the usercache, the bStats server id or sandbox's CoreProtect.
  rsync -a --exclude='/world' --exclude='/world_nether' --exclude='/world_the_end' --exclude='/mbench-*' \
        --exclude='/logs' --exclude='/crash-reports' --exclude='/usercache.json' --exclude='/server.properties*' \
        --exclude='/plugins/bStats' --exclude='/plugins/.paper-remapped' --exclude='/plugins/spark/tmp-client' \
        --exclude='/.cache' --exclude='/plugins/CoreProtect*' "$SRC"/ "$D"/
  # server.properties is sandbox2's with the two ports changed: same seed, peaceful, motd, max-players, RCON password.
  sed -e "s/^server-port=.*/server-port=$GP/" -e "s/^rcon.port=.*/rcon.port=$RP/" "$SRC/server.properties" > "$D/server.properties"
  grep -q "^server-port=$GP$" "$D/server.properties" && grep -q "^rcon.port=$RP$" "$D/server.properties" \
    || { echo "port rewrite failed for $D"; exit 1; }
  echo "sandbox$n prepared 2026-10-20 from sandbox2's server layer; the world generates from level-seed on first start" \
    > "$D/SANDBOX58-README.txt"
  chown -R sandbox:sandbox "$D"; chmod 640 "$D/server.properties"
  # The unit is sandbox4's, byte for byte, except its description and working directory.
  sed -e "s#^Description=.*#Description=SANDBOX Paper server $n (test rig, not a fleet world)#" \
      -e "s#^WorkingDirectory=.*#WorkingDirectory=$D#" "$U4" > /etc/systemd/system/block2-sandbox$n.service
  chmod 644 /etc/systemd/system/block2-sandbox$n.service
  echo "sandbox$n: dir $D game $GP rcon $RP unit block2-sandbox$n.service (on disk; not loaded, not enabled)"
done
