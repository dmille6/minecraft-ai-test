#!/bin/bash
# Stage C world control, run ON THE WORLDS HOST (10.0.0.30) for ONE sandbox server only.
#   cl_world.sh <sandbox|sandbox2|sandbox3|sandbox4> init|reset|restore|status
# init    : save server.properties, switch level-name to mbench-world (the sandbox's own `world` is never
#           touched), max-players 12, generate the world from the fleet seed, set the fleet's gamerules and
#           world spawn at the fleet's home (355,73,147) over RCON, then snapshot it as the pristine start.
# reset   : stop, replace mbench-world* with the pristine snapshot, start, wait for "Done".
# restore : stop, put the original server.properties back (level-name=world), start.
set -euo pipefail
S=${1:?server}; CMD=${2:?cmd}
case "$S" in sandbox|sandbox2|sandbox3|sandbox4) ;; *) echo "refusing: $S is not a sandbox"; exit 3;; esac
D=/srv/block2/$S; U=block2-$S; P=/srv/block2/mbench-pristine-$S.tgz; LN=mbench-world
rcon() { sudo python3 - "$D" "$@" <<'PY'
import socket, struct, sys
d = sys.argv[1]; cmds = sys.argv[2:]
props = dict(l.strip().split('=', 1) for l in open(d + '/server.properties') if '=' in l and not l.startswith('#'))
s = socket.create_connection(('127.0.0.1', int(props['rcon.port'])), timeout=20)
def send(t, body):
    p = struct.pack('<ii', 0, t) + body.encode() + b'\0\0'; s.sendall(struct.pack('<i', len(p)) + p)
    ln = struct.unpack('<i', s.recv(4))[0]; b = b''
    while len(b) < ln: b += s.recv(ln - len(b))
    return b[8:-2].decode(errors='replace')
send(3, props['rcon.password'])
for c in cmds:
    print(c, '->', send(2, c)[:120])
PY
}
waitdone() { local n0; n0=$(sudo stat -c %Y $D/logs/latest.log 2>/dev/null || echo 0)
  for i in $(seq 1 150); do sleep 2; sudo grep -q 'Done (' $D/logs/latest.log 2>/dev/null && [ "$(sudo stat -c %Y $D/logs/latest.log)" -ge "$n0" ] && return 0; done; echo "server did not come up"; return 1; }
stopit() { sudo systemctl stop $U; sleep 2; }
case "$CMD" in
  init)
    sudo test -e $D/server.properties.mbench-orig || sudo cp -p $D/server.properties $D/server.properties.mbench-orig
    stopit
    sudo sed -i "s/^level-name=.*/level-name=$LN/; s/^max-players=.*/max-players=12/" $D/server.properties
    sudo rm -rf $D/$LN $D/${LN}_nether $D/${LN}_the_end
    sudo truncate -s0 $D/logs/latest.log || true
    sudo systemctl start $U; waitdone
    rcon "gamerule keepInventory true" "gamerule doImmediateRespawn true" "gamerule mobGriefing false" \
         "gamerule doFireTick false" "gamerule doWeatherCycle false" "gamerule doInsomnia false" \
         "gamerule announceAdvancements false" "gamerule sendCommandFeedback false" "gamerule logAdminCommands false" \
         "setworldspawn 355 73 147" "difficulty peaceful" "time set 1000" "save-all flush"
    sleep 5; stopit
    sudo tar -czf $P -C $D $LN ${LN}_nether ${LN}_the_end
    sudo truncate -s0 $D/logs/latest.log || true
    sudo systemctl start $U; waitdone; echo "pristine: $(sudo du -h $P | cut -f1)";;
  reset)
    sudo test -e $P || { echo "no pristine snapshot; run init"; exit 4; }
    stopit
    if ! sudo grep -q "^level-name=$LN" $D/server.properties; then   # switched back by `restore`: switch again
      sudo test -e $D/server.properties.mbench-orig || sudo cp -p $D/server.properties $D/server.properties.mbench-orig
      sudo sed -i "s/^level-name=.*/level-name=$LN/; s/^max-players=.*/max-players=12/" $D/server.properties
    fi
    sudo rm -rf $D/$LN $D/${LN}_nether $D/${LN}_the_end
    sudo tar -xzf $P -C $D; sudo chown -R sandbox:sandbox $D/$LN $D/${LN}_nether $D/${LN}_the_end
    sudo truncate -s0 $D/logs/latest.log || true
    sudo systemctl start $U; waitdone; rcon "time set 1000" "list";;
  restore)
    stopit; sudo cp -p $D/server.properties.mbench-orig $D/server.properties; sudo truncate -s0 $D/logs/latest.log || true
    sudo systemctl start $U; waitdone
    sudo grep -E "^(level-name|max-players)" $D/server.properties;;
  census)    # terminal ground truth: each named player's inventory as the SERVER holds it (not the bot's log)
    shift 2; for b in "$@"; do rcon "data get entity $b Inventory"; done;;
  status)
    systemctl is-active $U; sudo grep -E "^(level-name|max-players|difficulty)" $D/server.properties; rcon "list";;
  *) echo "unknown $CMD"; exit 2;;
esac
