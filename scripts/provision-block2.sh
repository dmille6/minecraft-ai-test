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
#   hive-a/b   MEMORY_SCOPE=shared      one pool per world, 5 bots each
#   board-a/b  MEMORY_SCOPE=board       private memory + the town lectern
#   isolated-a/b MEMORY_SCOPE=isolated  per-bot memory, no sharing at all
#   placebo-a/b MEMORY_SCOPE=checkpoint same walk to the totem, shares nothing
set -euo pipefail

SEED="${1:?usage: provision-block2.sh <seed> [base_port]}"
BASE_PORT="${2:-25570}"
ROOT=/srv/block2
# EIGHT WORLDS: two independent pools per arm. Five bots sharing one memory are
# five correlated samples of ONE unit, so hive/board/placebo had n=1 each. A
# second pool makes n=2 -- the difference between having a number per arm and
# being able to see whether two pools in the same arm agree with each other.
# They need separate worlds: two pools in one world would compete for the same
# ore and cross each other's terrain, adding correlation rather than replication.
ARMS=(hive-a hive-b board-a board-b isolated-a isolated-b placebo-a placebo-b)

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
# DECLARED IN THE PRE-REGISTRATION (amendment 2026-08-19). This file said
# `normal` while the document said `peaceful`, which is the exact mismatch that
# invalidated the mindcraft head-to-head: an entire comparison was credited to
# the reflex layer when the truth was that one server had no hostile mobs in it.
# A config that disagrees with the declaration is not a typo, it is a different
# experiment.
difficulty=peaceful
gamemode=survival
pvp=false
spawn-protection=0
view-distance=8
simulation-distance=6
max-players=20
# Pinned rather than defaulted. Anything left to a default is a thing that can
# change under you between one arm's world creation and the next.
level-type=minecraft:normal
generate-structures=true
allow-nether=false
allow-flight=false
spawn-monsters=false
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
  # EQUAL ENVELOPES, ENFORCED BY THE KERNEL.
  #
  # Same host is a design requirement -- if arms ran on different machines, every
  # difference between those machines would become an arm effect. But same host
  # does NOT mean shared scheduler roulette. Eight Paper servers in one scheduling
  # domain can starve each other during GC, chunk generation or a disk stall, and
  # a world that loses ticks produces fewer opportunities for its bots. That is an
  # arm effect arriving through the CPU scheduler instead of through memory, and
  # it would be invisible in the analysis.
  #
  # So every world gets an IDENTICAL, dedicated slice: its own CPUs, its own
  # quota, its own memory ceiling. Identical is what matters -- not generous.
  CPUS_PER_WORLD=4
  CPU_LO=$((i * CPUS_PER_WORLD))
  CPU_HI=$((CPU_LO + CPUS_PER_WORLD - 1))
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

# --- the envelope. IDENTICAL for every arm; change it for one and you have
# --- built a confound.
AllowedCPUs=$CPU_LO-$CPU_HI
CPUQuota=$((CPUS_PER_WORLD * 100))%
CPUWeight=100
MemoryHigh=5G
MemoryMax=6G
IOWeight=100
# Paper is latency-critical in a way the bots are not: a lost tick is lost world
# time for every bot in that arm, while a bot waiting 200ms longer to think is
# not measurable in the endpoint.
Nice=-5

[Install]
WantedBy=multi-user.target
EOF
done
systemctl daemon-reload
# ENABLED, not just started. A reboot silently stopping one arm mid-block would
# void the repetition -- and that has already happened once to instance #2.
for ARM in "${ARMS[@]}"; do systemctl enable "block2@$ARM" >/dev/null; done
ok "${#ARMS[@]} units written and enabled for boot"

say "Next"
cat <<EOT
   1. systemctl start block2@{$(IFS=,; echo "${ARMS[*]}")}
   2. wait for world generation, then for EVERY arm:
        ./scripts/place-town.py <arm>
      Identical furniture in all ${#ARMS[@]} worlds, lectern included. The hive and
      isolated bots simply never walk to it. Placing the lectern in only some
      worlds would make the WORLDS differ between arms, which is exactly the
      confound the shared seed exists to prevent.
   3. PREGENERATE the operating radius in every world, identically, BEFORE any
      bot connects. Chunk generation during play costs tick time, and an arm
      that explores into fresh chunks under load loses ticks an arm that does
      not explore never pays. That is an arm effect made of terrain caching.
   4. gamerules, identically, in every world (see set-gamerules in this repo)
   5. generate the 40 bot env files, CODE_VERSION frozen, endpoints declared:
        ./scripts/generate-roster.py --town /srv/block2/town-*.json \\
            --endpoints http://10.0.0.16:11434
   6. 2-4h smoke on all 40 bots. NOT the shakedown -- an early abort checkpoint,
      so a failure at scale costs hours instead of two days.
   7. 1-2 shakedown days, EXCLUDED from analysis
   8. ./scripts/shakedown-gate.py --block block2 --hours 24
      Both gates must pass: mobility (arms comparable) AND operational
      readiness (the apparatus is measuring something). Exit 0 or do not start.
EOT
