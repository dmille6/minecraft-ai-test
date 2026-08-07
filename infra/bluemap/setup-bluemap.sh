#!/usr/bin/env bash
# BlueMap on evd01 -- a navigable 3D web map of the world, rendered OFF-HOST.
#
# WHY NOT ON mc01
#   mc01 has 4 vCPU and a tick loop that must not be disturbed. BlueMap's own
#   docs recommend a single render thread on hosts with <=4 cores, and a first
#   full render of a 3900x3900 world is hours of CPU and region IO. evd01 is
#   idle, has 4 cores and 238G free, and already pulls from mc01 on a timer --
#   so the world-sync plumbing exists.
#
# WHAT THIS GETS YOU, HONESTLY
#   Terrain is a rendered SNAPSHOT, stale by however long since the last sync
#   and render. Bots do not appear as animated players; live markers require the
#   BlueMap plugin on the server, which is a separate decision. This answers
#   "what does this world look like and what have the bots built", not "what is
#   a bot doing right now" -- prismarine-viewer answers that, live, per bot.
set -euo pipefail
MC_HOST="${MC_HOST:-192.168.193.100}"
BM=/srv/bluemap
say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){  printf '   \033[32m✓\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

say "Runtime"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1
# BlueMap 5.23 is compiled for Java 25 (class file version 69). Java 21 loads
# it and dies with UnsupportedClassVersionError -- which reads like a corrupt
# download rather than a version mismatch. Installed alongside 21 rather than
# replacing it: mc01 and the harness are pinned to 21 for their own reasons,
# and BlueMap runs here, not there.
apt-get update -qq
apt-get install -y -qq openjdk-25-jre-headless >/dev/null
JAVA=$(ls -d /usr/lib/jvm/java-25-openjdk-*/bin/java 2>/dev/null | head -1)
[ -x "$JAVA" ] || JAVA=$(command -v java)
ok "java for bluemap: $("$JAVA" -version 2>&1 | head -1 | grep -oE '"[^"]+"' | tr -d '"')"

say "BlueMap CLI"
mkdir -p "$BM"/{world,web,logs}
if [ ! -f "$BM/bluemap.jar" ]; then
  URL=$(curl -sSL https://api.github.com/repos/BlueMap-Minecraft/BlueMap/releases/latest \
        | grep -oE '"browser_download_url": *"[^"]*cli\.jar"' | head -1 | cut -d'"' -f4)
  [ -n "$URL" ] || { echo "could not resolve a BlueMap CLI release"; exit 1; }
  curl -sSL -o "$BM/bluemap.jar" "$URL"
  ok "downloaded $(basename "$URL") ($(du -h "$BM/bluemap.jar" | cut -f1))"
else
  ok "bluemap.jar present"
fi

say "World sync"
install -m 755 /dev/stdin "$BM/sync-world.sh" <<SYNC
#!/usr/bin/env bash
# Pull a SNAPSHOT of the world, throttled. Region files are coarse and mining
# churn turns continuous syncing into noisy IO on the host we are protecting.
set -uo pipefail
K=/root/.ssh/id_ed25519_evd
O="-i \\\$K -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
rsync -a --delete --bwlimit=20000 --timeout=300 -e "ssh \\\$O" \\
  --include='*/' --include='region/***' --include='level.dat' --exclude='*' \\
  mike@$MC_HOST:/world/ $BM/world/ 2>/dev/null
echo "synced \\\$(du -sh $BM/world 2>/dev/null | cut -f1)"
SYNC
ok "sync-world.sh (region files and level.dat only, bandwidth-limited)"

say "Render helper"
install -m 755 /dev/stdin "$BM/render.sh" <<REND
#!/usr/bin/env bash
# One render pass. Deliberately NOT on a timer by default: the first full render
# of this world is hours, and starting it unattended during a trial competes for
# IO with the evidence collector on the same host.
set -euo pipefail
cd $BM
./sync-world.sh
# -r render, -w start no webserver (Homepage/nginx serves the output)
JAVA_BIN -Xmx4G -jar bluemap.jar -r 2>&1 | tail -5
REND
sed -i "s|JAVA_BIN|$JAVA|" "$BM/render.sh"
ok "render.sh (sync then render, run manually)"

say "Done"
cat <<NOTE
   BlueMap needs its config generated and the EULA-equivalent accepted once:
     cd $BM && $JAVA -jar bluemap.jar
   then set the world path to $BM/world in core.conf / maps/*.conf,
   and run: $BM/render.sh

   The first render is HOURS. Start it when no trial is running.
NOTE
