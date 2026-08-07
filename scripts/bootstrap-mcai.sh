#!/usr/bin/env bash
# bootstrap-mcai.sh -- provision the Minecraft + agent host from scratch.
#
# Idempotent: safe to re-run. Every step checks before acting.
#
# This encodes what docs/ops/vm-provisioning.md and world-setup.md describe,
# including the things that cost a debugging cycle the first time round. Where
# a choice looks arbitrary it is not; the comment says why.
#
#   sudo ./bootstrap-mcai.sh
#
# Environment:
#   MC_EULA=true          you accept https://aka.ms/MinecraftEULA (required)
#   PAPER_VERSION=1.21.8  pinned; see ADR-0001 before changing
#   HEAP=6G               Paper heap, fixed (-Xms == -Xmx)
#   LAN_CIDR=192.168.193.0/24  who may reach the game port

set -euo pipefail

# 1.21.8, not 1.21.11: there is an open mineflayer issue reporting pathfinding
# and jumping failures specifically on 1.21.11, and movement is already this
# project's binding constraint -- goto succeeds 3% of the time. Running the new
# lab on the version with a known movement bug would confound the one thing we
# are trying to measure. ViaVersion still lets a current client join.
PAPER_VERSION="${PAPER_VERSION:-1.21.8}"
HEAP="${HEAP:-6G}"
LAN_CIDR="${LAN_CIDR:-192.168.193.0/24}"
DATA_LV_SIZE="${DATA_LV_SIZE:-120G}"
SRV=/srv/minecraft

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

# ---------------------------------------------------------------- preflight --
say "Preflight"
if grep -qm1 avx2 /proc/cpuinfo; then
  ok "AVX2 present"
else
  warn "NO AVX2 — the JVM loses vectorised paths and much of its JIT."
  warn "This is a HYPERVISOR setting, not fixable from inside the guest."
  warn "On Proxmox:  qm set <VMID> --cpu x86-64-v3   then a full stop/start."
  warn "Verify after with: java -XX:+PrintFlagsFinal -version | grep UseAVX"
  warn "Continuing — everything else works, it will just be slower."
fi
ok "$(nproc) cores, $(free -g | awk '/^Mem:/{print $2}')GB RAM"

# ------------------------------------------------------------------ kernel --
say "Kernel tuning"
cat > /etc/sysctl.d/99-minecraft.conf <<'EOF'
# A swapped JVM heap produces multi-second GC pauses. Default 60 is far too
# eager for a host whose whole job is holding a 6G heap resident.
vm.swappiness=1
vm.vfs_cache_pressure=50
EOF
sysctl -q --system
ok "swappiness=$(cat /proc/sys/vm/swappiness), vfs_cache_pressure=$(cat /proc/sys/vm/vfs_cache_pressure)"
systemctl enable --now fstrim.timer >/dev/null 2>&1 || true
ok "fstrim.timer enabled"

# ----------------------------------------------------------------- storage --
say "Storage"
# Ubuntu's installer allocates only ~100G of the volume group to root and
# leaves the rest unused. A separate data LV means world growth can never fill
# root and take the OS down with it.
if lvs ubuntu-vg/data >/dev/null 2>&1; then
  ok "data LV already exists"
else
  FREE=$(vgs --noheadings --units g -o vg_free ubuntu-vg 2>/dev/null | tr -d ' g' | cut -d. -f1 || echo 0)
  if [ "${FREE:-0}" -gt 20 ]; then
    lvcreate -y -L "$DATA_LV_SIZE" -n data ubuntu-vg >/dev/null
    mkfs.ext4 -q -L mcdata /dev/ubuntu-vg/data
    ok "created ${DATA_LV_SIZE} data LV"
  else
    warn "only ${FREE}G free in ubuntu-vg; using root filesystem instead"
  fi
fi
mkdir -p "$SRV"
if lvs ubuntu-vg/data >/dev/null 2>&1 && ! mountpoint -q "$SRV"; then
  UUID=$(blkid -s UUID -o value /dev/ubuntu-vg/data)
  grep -q "$UUID" /etc/fstab || echo "UUID=$UUID $SRV ext4 defaults,noatime 0 2" >> /etc/fstab
  mount -a
fi
ok "$(df -h "$SRV" | tail -1 | awk '{print $4" free at "$6}')"

# ---------------------------------------------------------------- accounts --
say "Service accounts"
# Two accounts, not one. The Paper server and the agent runtime are distinct
# trust domains (handoff doc S18) -- a compromised bot cannot write to the
# server directory.
id minecraft >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$SRV/server" minecraft
id mcbot     >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$SRV/bots"   mcbot
mkdir -p "$SRV"/{server,bots,backups,shared}
chown minecraft:minecraft "$SRV/server" "$SRV/backups"
chown mcbot:mcbot "$SRV/bots"
chmod 750 "$SRV/server" "$SRV/bots" "$SRV/backups"
for u in $(getent passwd | awk -F: '$3>=1000 && $3<65000 {print $1}'); do
  usermod -aG minecraft,mcbot "$u" 2>/dev/null || true
done
ok "minecraft + mcbot created (nologin, separate trust domains)"

# ----------------------------------------------------------------- runtime --
say "Runtime"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
apt-get update -qq
# Java 21, NOT 25. Paper 1.21.11 requires exactly 21; Java 25 is for Paper 26.x,
# which mineflayer cannot speak to at all (ADR-0001).
# JDK rather than JRE so jcmd/jstat/JFR exist for diagnosing tick-time problems.
apt-get install -y -qq openjdk-21-jdk-headless nodejs npm ufw curl jq >/dev/null
ok "java $(java -version 2>&1 | head -1 | grep -oE '"[^"]+"' | tr -d '"')"
# Ubuntu pairs node 22 with npm 9 (from 2022). npm@latest wants a node patch
# newer than Ubuntu ships and fails EBADENGINE, so pin the major.
npm install -g npm@11 >/dev/null 2>&1 || true
hash -r
ok "node $(node --version), npm $(npm --version)"

# ------------------------------------------------------------------- paper --
say "Paper $PAPER_VERSION"
mkdir -p "$SRV/server/plugins"
if [ ! -f "$SRV/server/paper.jar" ]; then
  BUILD_JSON=$(curl -sS -H 'User-Agent: mcai-bootstrap/1.0' \
    "https://fill.papermc.io/v3/projects/paper/versions/$PAPER_VERSION/builds")
  URL=$(echo "$BUILD_JSON" | jq -r '.[0].downloads["server:default"].url')
  SHA=$(echo "$BUILD_JSON" | jq -r '.[0].downloads["server:default"].checksums.sha256')
  curl -sS -o "$SRV/server/paper.jar" "$URL"
  echo "$SHA  $SRV/server/paper.jar" | sha256sum -c - >/dev/null
  ok "downloaded build $(echo "$BUILD_JSON" | jq -r '.[0].id'), sha256 verified"
else
  ok "paper.jar already present"
fi

say "Plugins"
# ViaVersion lets a CURRENT Minecraft client join this deliberately older
# server -- the other half of the ADR-0001 version pin.
fetch_modrinth() {  # $1=project  $2=dest
  [ -f "$2" ] && { ok "$(basename "$2") present"; return; }
  URL=$(curl -sS -H 'User-Agent: mcai-bootstrap/1.0' \
        "https://api.modrinth.com/v2/project/$1/version" \
        | jq -r --arg v "$PAPER_VERSION" \
          '[.[] | select(.game_versions|index($v)) | select(.loaders|any(.=="paper" or .=="bukkit"))]
           | (map(select(.version_type=="release")) + .)[0].files[0].url')
  [ -z "$URL" ] || [ "$URL" = "null" ] && { warn "no $1 build for $PAPER_VERSION"; return; }
  curl -sS -o "$2" "$URL" && ok "$(basename "$2") $(du -h "$2" | cut -f1)"
}
fetch_modrinth viaversion "$SRV/server/plugins/ViaVersion.jar"
fetch_modrinth chunky     "$SRV/server/plugins/Chunky.jar"
fetch_modrinth squaremap  "$SRV/server/plugins/squaremap.jar"
chown -R minecraft:minecraft "$SRV/server"

# ------------------------------------------------------------------ config --
say "Server configuration"
if [ ! -f "$SRV/server/.rcon.env" ]; then
  PW=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)
  echo "RCON_PASSWORD=$PW" > "$SRV/server/.rcon.env"
  chmod 640 "$SRV/server/.rcon.env"; chown minecraft:minecraft "$SRV/server/.rcon.env"
fi
RCONPW=$(grep -oP '(?<=RCON_PASSWORD=).*' "$SRV/server/.rcon.env")

if [ ! -f "$SRV/server/server.properties" ]; then
cat > "$SRV/server/server.properties" <<EOF
# managed by bootstrap-mcai.sh -- see docs/ops/world-setup.md
motd=AI agent testbed ($PAPER_VERSION)
server-port=25565
level-name=world
gamemode=survival
# peaceful during harness validation: an agent with no weapon, armour or combat
# skill dies ~22x/6h to mobs, which measures the world, not its judgement.
difficulty=peaceful
# bots have no Microsoft accounts, so offline auth -- which makes the whitelist
# the ONLY thing stopping anyone on the LAN joining as any username.
online-mode=false
white-list=true
enforce-whitelist=true
max-players=20
# below vanilla 10: chunk churn from exploring bots is the top MSPT cost
view-distance=8
simulation-distance=6
sync-chunk-writes=false
# default 16 silently blocks non-op building near spawn, which would break a
# builder agent's first task with no visible error
spawn-protection=0
pvp=false
allow-nether=true
enable-command-block=false
enable-rcon=true
rcon.port=25575
rcon.password=$RCONPW
broadcast-rcon-to-ops=false
EOF
  chown minecraft:minecraft "$SRV/server/server.properties"
  ok "server.properties written"
else
  ok "server.properties already present"
fi

cat > "$SRV/shared/rcon.py" <<'PY'
#!/usr/bin/env python3
"""Minimal Minecraft RCON client.  rcon.py "<command>" """
import socket, struct, sys, re
def _pkt(rid, typ, body):
    p = struct.pack('<ii', rid, typ) + body.encode('utf8') + b'\x00\x00'
    return struct.pack('<i', len(p)) + p
def _recv(s):
    ln = struct.unpack('<i', s.recv(4))[0]
    d = b''
    while len(d) < ln: d += s.recv(ln - len(d))
    rid, typ = struct.unpack('<ii', d[:8])
    return rid, typ, d[8:-2].decode('utf8', 'replace')
def run(cmd, host='127.0.0.1', port=25575):
    pw = re.search(r'RCON_PASSWORD=(.*)', open('/srv/minecraft/server/.rcon.env').read()).group(1).strip()
    s = socket.create_connection((host, port), timeout=15)
    s.sendall(_pkt(1, 3, pw))
    if _recv(s)[0] == -1: raise SystemExit('RCON auth failed')
    s.sendall(_pkt(2, 2, cmd))
    body = _recv(s)[2]; s.close(); return body
if __name__ == '__main__':
    print(run(' '.join(sys.argv[1:])))
PY
chmod 755 "$SRV/shared/rcon.py"
ok "rcon helper installed"

say "Paper tuning"
# Paper's chunk-system.worker-threads: -1 (auto) allocates only 2 threads on a
# 6-core box, and chunk generation runs ~5x slower than it needs to. Measured
# at work: 17 -> 85 chunks/sec with TPS untouched, because Chunky throttles
# against the tick budget so the extra threads become pure throughput.
CORES=$(nproc)
WORKERS=$(( CORES > 4 ? CORES - 2 : 2 ))
mkdir -p "$SRV/server/config"
if [ -f "$SRV/server/config/paper-global.yml" ]; then
  sed -i "s/^  worker-threads: .*/  worker-threads: $WORKERS/" "$SRV/server/config/paper-global.yml"
  ok "chunk-system.worker-threads = $WORKERS (of $CORES cores)"
else
  warn "paper-global.yml not present yet -- start the server once, then re-run"
  warn "or set chunk-system.worker-threads: $WORKERS by hand"
fi
# Chunky must be told to resume, or a mid-pregen restart silently abandons it.
if [ -f "$SRV/server/plugins/Chunky/config.yml" ]; then
  sed -i 's/^continue-on-restart: false/continue-on-restart: true/' "$SRV/server/plugins/Chunky/config.yml"
  ok "chunky continue-on-restart enabled"
fi
chown -R minecraft:minecraft "$SRV/server"

say "Glances"
# Leave an existing unit alone, and never bind 0.0.0.0. The lab installs glances
# separately, bound to each host's VLAN address; this section used to overwrite
# that with --bind 0.0.0.0, silently widening an unauthenticated service that
# exposes process lists, filesystem layout and network counters.
if [ -f /etc/systemd/system/glances.service ]; then
  ok "glances already managed ($(systemctl is-active glances)); left untouched"
else
  LAB_IP=$(ip -4 -o addr show | awk '/192\.168\.193\./{split($4,a,"/"); print a[1]; exit}')
  BIND="${LAB_IP:-127.0.0.1}"
  apt-get install -y -qq glances >/dev/null 2>&1 || true
  cat > /etc/systemd/system/glances.service <<GEOF
[Unit]
Description=Glances REST API
After=network-online.target
[Service]
ExecStart=/usr/bin/glances -w --disable-webui --bind $BIND --port 61208
Restart=on-failure
RestartSec=10
[Install]
WantedBy=multi-user.target
GEOF
  systemctl daemon-reload && systemctl enable --now glances >/dev/null 2>&1
  ok "glances on $BIND:61208 ($(systemctl is-active glances))"
fi

# ----------------------------------------------------------------- systemd --
say "systemd"
cat > /etc/systemd/system/minecraft.service <<EOF
[Unit]
Description=Paper Minecraft Server (AI agent testbed)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=minecraft
Group=minecraft
WorkingDirectory=$SRV/server
ExecStart=/usr/bin/java -Xms$HEAP -Xmx$HEAP \\
  -XX:+AlwaysPreTouch -XX:+DisableExplicitGC -XX:+ParallelRefProcEnabled \\
  -XX:+PerfDisableSharedMem -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC \\
  -XX:G1HeapRegionSize=8M -XX:G1HeapWastePercent=5 -XX:G1MaxNewSizePercent=40 \\
  -XX:G1MixedGCCountTarget=4 -XX:G1MixedGCLiveThresholdPercent=90 \\
  -XX:G1NewSizePercent=30 -XX:G1RSetUpdatingPauseTimePercent=5 \\
  -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15 \\
  -XX:MaxGCPauseMillis=200 -XX:MaxTenuringThreshold=1 -XX:SurvivorRatio=32 \\
  -jar paper.jar --nogui
Restart=on-failure
RestartSec=15
SuccessExitStatus=0 143
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$SRV

[Install]
WantedBy=multi-user.target
EOF

# Templated: additional agents are `systemctl enable mcbot@builder` once
# env/builder.env exists. No unit duplication.
cat > /etc/systemd/system/mcbot@.service <<EOF
[Unit]
Description=Minecraft AI agent (%i)
After=network-online.target minecraft.service
Wants=network-online.target

[Service]
Type=simple
User=mcbot
Group=mcbot
WorkingDirectory=$SRV/bots/harness
EnvironmentFile=$SRV/bots/harness/env/%i.env
ExecStart=/usr/bin/node src/index.mjs
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$SRV/bots

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
ok "minecraft.service + mcbot@.service installed"

# ---------------------------------------------------------------- firewall --
say "Firewall"
# SSH allowed BEFORE enabling, or you lock yourself out of a remote box.
ufw allow 22/tcp comment 'ssh' >/dev/null
ufw allow from "$LAN_CIDR" to any port 25565 proto tcp comment 'minecraft' >/dev/null
ufw allow from "$LAN_CIDR" to any port 8080  proto tcp comment 'squaremap' >/dev/null
ufw allow from "$LAN_CIDR" to any port 3007  proto tcp comment '3d viewer' >/dev/null
ufw allow from "$LAN_CIDR" to any port 61208 proto tcp comment 'glances' >/dev/null
# Paper binds RCON to server-ip, which is blank = all interfaces. Setting
# server-ip=127.0.0.1 would also confine the GAME port, so deny it here instead.
# ufw permits loopback by default, so local rcon still works.
ufw deny 25575/tcp comment 'rcon: loopback only' >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | grep -c ALLOW) allow rules, rcon denied externally"

# ----------------------------------------------------------------- backups --
say "Backups"
install -m 755 /dev/stdin "$SRV/shared/backup-world.sh" <<'EOF'
#!/usr/bin/env bash
# save-off + save-all flush is the load-bearing part: tarring a live world while
# Paper is mid-chunk-write yields an archive that restores to a corrupt region
# file, discovered months later. The trap guarantees saving is re-enabled even
# if tar fails -- a server left with saving off silently loses everything.
set -uo pipefail
R=/srv/minecraft/shared/rcon.py; SRV=/srv/minecraft/server; DEST=/srv/minecraft/backups
KEEP_DAYS=${KEEP_DAYS:-14}; TS=$(date +%Y%m%d-%H%M%S); OUT="$DEST/world-$TS.tar.gz"
restore(){ "$R" "save-on" >/dev/null 2>&1 || true; }
trap restore EXIT INT TERM
mkdir -p "$DEST"
"$R" "save-off" >/dev/null 2>&1 && { "$R" "save-all flush" >/dev/null 2>&1; sleep 5; }
tar -C "$SRV" -czf "$OUT" --warning=no-file-changed world world_nether world_the_end server.properties 2>/dev/null
RC=$?; restore; trap - EXIT INT TERM
[ $RC -gt 1 ] && { echo "backup: tar failed rc=$RC" >&2; rm -f "$OUT"; exit 1; }
echo "backup: $OUT ($(du -h "$OUT"|cut -f1)) pruned=$(find "$DEST" -name 'world-*.tar.gz' -mtime +"$KEEP_DAYS" -delete -print|wc -l)"
EOF
cat > /etc/systemd/system/mc-backup.service <<'EOF'
[Unit]
Description=Minecraft world backup
After=minecraft.service
[Service]
Type=oneshot
ExecStart=/srv/minecraft/shared/backup-world.sh
Nice=10
IOSchedulingClass=idle
EOF
cat > /etc/systemd/system/mc-backup.timer <<'EOF'
[Unit]
Description=Daily Minecraft world backup
[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now mc-backup.timer >/dev/null 2>&1
ok "daily backup at 04:00, 14-day retention"

say "Done"
cat <<EOF
   Next, in order:

   1. EULA — yours to accept, not mine:
        echo eula=true | sudo -u minecraft tee $SRV/server/eula.txt
        sudo systemctl enable --now minecraft

   2. Whitelist yourself (offline-mode UUIDs are derived from the exact
      name bytes, so case matters):
        sudo $SRV/shared/rcon.py "whitelist add YourName"
        sudo $SRV/shared/rcon.py "op YourName"

   3. Pregenerate + border, so agents never trigger live chunk generation:
        sudo $SRV/shared/rcon.py "chunky radius 2000"
        sudo $SRV/shared/rcon.py "chunky start"
        sudo $SRV/shared/rcon.py "worldborder set 3900"

   4. Deploy the agent harness (scripts/deploy-harness.sh)

   If the preflight warned about AVX2, fix that on the hypervisor first --
   it is the single largest performance factor and needs a stop/start.
EOF
