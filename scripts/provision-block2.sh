#!/usr/bin/env bash
# provision-block2.sh -- stand up the four-arm world for Block 2.
#
#   sudo ./provision-block2.sh <seed> [base_port]
#
# FOUR WORLDS ON ONE HOST, ONE SEED, FOUR PORTS. That is a design requirement,
# not a convenience. If hive runs on one machine and board on another, every
# difference between those machines -- CPU speed, disk latency, a noisy
# neighbour -- becomes an arm effect that no analysis can separate from the
# memory regime. Same host, same seed, same jar, same properties; the ONLY
# thing that differs between arms is what the bots are allowed to remember.
#
# The same rule governs inference: all four arms draw from one endpoint pool.
# Never pin an arm to a GPU.
#
# Arms and their memory scopes (see docs/block2-preregistration.md):
#   hive       MEMORY_SCOPE=shared      pool shared by the arm's 5 bots
#   board      MEMORY_SCOPE=board       private memory + the town lectern
#   isolated   MEMORY_SCOPE=isolated    per-bot memory, no sharing at all
#   placebo    MEMORY_SCOPE=checkpoint  same walk to the totem, shares nothing
set -euo pipefail

SEED="${1:?usage: provision-block2.sh <seed> [base_port]}"
BASE_PORT="${2:-25570}"
ROOT=/srv/block2
ARMS=(hive board isolated placebo)

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m*\033[0m %s\n' "$*"; }

say "Worlds"
# A template server must already exist with the Paper jar and an accepted EULA.
[ -d "$ROOT/template" ] || { echo "missing $ROOT/template (paper jar + eula.txt)"; exit 1; }

for i in "${!ARMS[@]}"; do
  ARM="${ARMS[$i]}"
  PORT=$((BASE_PORT + i))
  RCON=$((BASE_PORT + 100 + i))
  DIR="$ROOT/$ARM"
  if [ -d "$DIR/world" ]; then
    ok "$ARM already provisioned on :$PORT (leaving its world alone)"
    continue
  fi
  mkdir -p "$DIR"
  cp -a "$ROOT/template/." "$DIR/"
  # IDENTICAL PROPERTIES EXCEPT PORTS. Anything else that differs here is a
  # confound wearing a config file.
  RCONPW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  cat > "$DIR/server.properties" <<EOF
level-seed=$SEED
server-port=$PORT
enable-rcon=true
rcon.port=$RCON
rcon.password=$RCONPW
online-mode=false
white-list=true
enforce-whitelist=true
difficulty=normal
gamemode=survival
spawn-protection=0
view-distance=8
simulation-distance=6
max-players=20
motd=block2-$ARM
EOF
  # online-mode=false is required (mineflayer bots have no Microsoft accounts),
  # and the whitelist is the ONLY thing then stopping anyone on the LAN from
  # joining as any username -- including as a bot, mid-block. Seed it with this
  # arm's five bots so the server is never briefly open while it fills.
  : > "$DIR/whitelist.json.pending"
  chmod 600 "$DIR/server.properties"
  ok "$ARM -> $DIR  port $PORT  rcon $RCON  seed $SEED"
done

say "Systemd units"
for i in "${!ARMS[@]}"; do
  ARM="${ARMS[$i]}"
  cat > "/etc/systemd/system/block2@$ARM.service" <<EOF
[Unit]
Description=Block 2 Paper server ($ARM)
After=network-online.target

[Service]
Type=simple
User=minecraft
WorkingDirectory=$ROOT/$ARM
ExecStart=/usr/bin/java -Xms3G -Xmx3G -jar paper.jar nogui
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
# ENABLED, not just started. A reboot silently stopping one arm mid-block would
# void the repetition -- and that has already happened once to instance #2.
for ARM in "${ARMS[@]}"; do systemctl enable "block2@$ARM" >/dev/null; done
ok "four units written and enabled for boot"

say "Next"
cat <<'EOT'
   1. systemctl start block2@{hive,board,isolated,placebo}
   2. wait for world generation, then: ./scripts/place-town.sh <arm>
      Identical furniture in ALL FOUR worlds, lectern included. The hive and
      isolated bots simply never walk to it. Placing the lectern in only two
      worlds would make the WORLDS differ between arms, which is exactly the
      confound the shared seed exists to prevent.
   3. generate the 20 bot env files (5 per arm), CODE_VERSION frozen
   4. 1-2 shakedown days, EXCLUDED from analysis
   5. THE MOBILITY GATE, from the pre-registration: Block 2 does not start
      until no arm's immobile fraction exceeds another's by more than 2x
      across a full shakedown day. Entrapment dominated Block 1's result and
      would do it again.
EOT
