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

SEED="${1:?usage: provision-block2.sh <seed> [base_port] [repetition]}"
# WHICH REPETITION THIS IS, and it exists so the CPU layout can actually change
# between them. The stratified assignment below is seeded, which makes it
# reproducible -- and seeded on $SEED ALONE it is also CONSTANT, so re-running
# the provisioner for repetition 2 would reproduce repetition 1's layout exactly
# and the "re-randomise between repetitions" requirement of preregistration
# amendment 7 could never have happened. A seeded shuffle nobody varies is a
# fixed assignment with extra steps, which is the confound it was meant to fix.
#
# The WORLD seed must not change between repetitions -- identical terrain is the
# entire point -- so the repetition index is mixed into the CPU seed only.
REP="${3:-1}"
BASE_PORT="${2:-25570}"
ROOT=/srv/block2
# EIGHT WORLDS: two independent pools per arm. Five bots sharing one memory are
# five correlated samples of ONE unit, so hive/board/placebo had n=1 each. A
# second pool makes n=2 -- the difference between having a number per arm and
# being able to see whether two pools in the same arm agree with each other.
# They need separate worlds: two pools in one world would compete for the same
# ore and cross each other's terrain, adding correlation rather than replication.
# SIXTEEN WORLDS: FOUR independent pools per arm.
#
# Two pools per arm was enough to see whether pools in one arm agree. It is not
# enough to CLAIM anything. Two pools under the SAME treatment were measured
# 1.8-2.0x apart on the primary endpoint, and against that spread a 1.5x arm
# effect needs roughly twenty pools per arm for 80% power -- a number no amount
# of hardware here reaches. At n=4 per arm per repetition (12 across three
# repetitions) the resolvable effect is about 2x, which is a claim this fleet
# can actually support. See docs/block2-preregistration.md, amendment 7.
#
# The capacity was there the whole time and was hidden by a heap setting: each
# world was allotted 4 CPUs and used 0.21, and held 3.5GB of RSS because -Xms3G
# pre-commits the heap whether or not the world needs it.
# THE FIRST EIGHT KEEP THEIR POSITIONS, and that is not cosmetic. Ports are
# derived from the index (BASE_PORT + i), the existing worlds are skipped by the
# already-provisioned check so their server.properties is never rewritten, and
# place-town.py maps arm -> index -> rcon port independently. Group the new
# pools with their families and board-a moves from index 2 to 4, so every tool
# that recomputes a port from an index would start talking to the wrong world
# while every file on disk still looked correct. Append; never reorder.
ARMS=(hive-a hive-b board-a board-b isolated-a isolated-b placebo-a placebo-b
      hive-c hive-d board-c board-d isolated-c isolated-d placebo-c placebo-d)

# WHICH CPUS AN ARM GETS MUST NOT BE DECIDED BY WHICH ARM IT IS.
#
# The previous layout handed slots out in arm order: hive-a always on cores 0-3,
# placebo-b always on 28-31. Every difference between those cores -- NUMA
# distance, hyperthread siblings, whatever else the host is doing to them -- was
# therefore a permanent property of the ARM, and would have arrived in the
# results as a memory-regime effect. Nothing in the analysis could have told
# them apart.
#
# So the slot is drawn from a seeded assignment instead, reproducible from the
# world seed and different for a differently-seeded block.
#
# STRATIFIED, NOT MERELY SHUFFLED, and the difference is not pedantic. A plain
# shuffle of sixteen slots handed `isolated` the slots {0,1,3,9} and `placebo`
# {4,10,13,15} -- means of 3.25 against 10.5. Random is not balanced at n=16,
# and a draw like that leaves arm correlated with CPU position exactly as the
# old fixed layout did, only now by accident and harder to notice.
#
# So the CPU range is cut into four strata and every arm takes exactly one slot
# from each. Whatever varies across the range -- NUMA distance, hyperthread
# siblings, whatever else the host is doing -- now varies identically within
# every arm, while the assignment inside a stratum stays random.
mapfile -t SLOT < <(python3 - "${ARMS[*]}" "$SEED-rep$REP" <<'PYSLOT'
import random, sys
arms = sys.argv[1].split()
r = random.Random('cpu-slots-' + sys.argv[2])
families, order = {}, []
for a in arms:
    fam = a.rsplit('-', 1)[0]
    families.setdefault(fam, []).append(a)
    if fam not in order:
        order.append(fam)
n_strata = max(len(v) for v in families.values())
per = len(arms) // n_strata
assign = {}
for s in range(n_strata):
    fams = list(order)
    r.shuffle(fams)
    for j, fam in enumerate(fams):
        members = families[fam]
        if s < len(members):
            assign[members[s]] = s * per + j
for a in arms:
    print(assign[a])
PYSLOT
)

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
  # OWNERSHIP BEFORE MODE. chmod 600 alone left this file root-owned and
  # unreadable by the service user, so Paper silently fell back to its DEFAULTS:
  # every world bound the default port 25565 and seven of eight crash-looped on
  # "Address already in use", while the one that won the race ran on default
  # difficulty with the declared settings sitting unread on disk beside it.
  #
  # A config the server cannot read is not a config, and Paper does not say so --
  # it just quietly becomes a different experiment.
  chown -R minecraft:minecraft "$DIR"
  chmod 600 "$DIR/server.properties"
  ok "$ARM -> $DIR  port $PORT  rcon $RCON  seed $SEED"
done

say "Verify the service user can actually READ what we just wrote"
# This check exists because its absence cost a full provisioning cycle. The
# config was correct on disk and unreadable to the process that needed it, so
# Paper fell back to defaults -- same port for all eight worlds, default
# difficulty -- and reported nothing wrong. Seven crash-looped; the eighth ran
# the wrong experiment quietly.
FAILED=0
for ARM in "${ARMS[@]}"; do
  F="$ROOT/$ARM/server.properties"
  if sudo -u minecraft test -r "$F"; then
    ok "$ARM config readable by the service user"
  else
    echo "   !! $ARM: $F is NOT readable by 'minecraft' -- Paper would silently"
    echo "      use its defaults instead. Refusing to continue."
    FAILED=1
  fi
done
[ "$FAILED" -eq 0 ] || exit 1

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
  # 2, not 4: measured usage is 0.21-0.43 of ONE core per world at 20.0 TPS with
  # 8-11ms tick times against a 50ms budget. Four was never used; it merely
  # capped the fleet at eight worlds on a 32-core host.
  CPUS_PER_WORLD=2
  CPU_LO=$(( ${SLOT[$i]} * CPUS_PER_WORLD ))
  CPU_HI=$((CPU_LO + CPUS_PER_WORLD - 1))
  cat > "/etc/systemd/system/block2@$ARM.service" <<EOF
[Unit]
Description=Block 2 Paper server ($ARM)
After=network-online.target

[Service]
Type=simple
User=minecraft
WorkingDirectory=$ROOT/$ARM
# -Xms1G, NOT -Xms3G. The old setting pre-committed three gigabytes per world
# whether the world used them or not, which is the entire reason this host
# looked full at eight worlds. Measured side by side for eight minutes with five
# bots online: RSS 1.49GB against 3.50GB, TPS 20.0 on both, average tick times
# 8.4ms against 11.0ms, and the same ~58ms one-minute maximum on BOTH -- so that
# spike is something else and not GC pressure from the smaller heap.
ExecStart=/usr/bin/java -Xms1G -Xmx2G -jar paper.jar nogui
Restart=always
RestartSec=15

# --- the envelope. IDENTICAL for every arm; change it for one and you have
# --- built a confound.
AllowedCPUs=$CPU_LO-$CPU_HI
CPUQuota=$((CPUS_PER_WORLD * 100))%
CPUWeight=100
MemoryHigh=3G
MemoryMax=4G
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
