#!/usr/bin/env bash
# ON THE SHOWCASE VM, as root: install whole-map S0 (infra/showcase/wholemap.py; ledger wholemap-s0).
#   sudo bash install-wholemap.sh <dir holding wholemap.py>
#
# 1. wholemap.py -> /srv/showcase/bin; state dir /srv/showcase/wholemap (mike).
# 2. systemd: showcase-wholemap@.service (oneshot, User=mike, nice 19, idle IO, 1 CPU, 2 GB) and two timers:
#    showcase-wholemap-full.timer  daily 03:20Z  -> region scan + logs + trips + layer + shipped row (~75 s, ~120 MB)
#    showcase-wholemap-trips.timer hourly :12    -> trips + layer + shipped row, reusing the last scan
#    (the timelapse's showcase-tl.service is untouched: separate units, no shared lock, nice 19 both)
# 3. BlueMap: ONE line in maps/showcase.conf's marker-sets block, `include file("<layer>")`, backed up first, written
#    atomically, then PROVEN on a scratch copy of the config (scratch storage, a 16 x 16 render mask) with the installed
#    BlueMap CLI: the render must exit 0 and its markers.json must hold the wm-* sets. Any failure restores the backup.
#    No BlueMap restart: the timelapse's next 15-min render rewrites live/markers.json from the config.
set -euo pipefail
SRC=${1:?usage: install-wholemap.sh <dir holding wholemap.py>}
BM=/srv/showcase/bluemap
CONF=$BM/config/maps/showcase.conf
LAYER=/srv/showcase/wholemap/bluemap-markers.json
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BAK=/srv/showcase/wholemap/showcase.conf.bak-wholemap-$STAMP   # NOT in maps/: BlueMap reads that dir as map configs

install -m 755 "$SRC/wholemap.py" /srv/showcase/bin/wholemap.py
install -d -o mike -g mike /srv/showcase/wholemap
echo "   ok  /srv/showcase/bin/wholemap.py, state /srv/showcase/wholemap"

cat > /etc/systemd/system/showcase-wholemap@.service <<'EOF'
[Unit]
Description=SHOWCASE whole-map S0 (%i): coverage.json + BlueMap route layer + one heartbeat row (read-only on the world)

[Service]
Type=oneshot
User=mike
ExecStart=/usr/bin/python3 -B /srv/showcase/bin/wholemap.py %i
Nice=19
IOSchedulingClass=idle
CPUQuota=100%
MemoryMax=2G
TimeoutStartSec=30min
EOF
cat > /etc/systemd/system/showcase-wholemap-full.timer <<'EOF'
[Unit]
Description=SHOWCASE whole-map S0: full region scan, daily
[Timer]
OnCalendar=*-*-* 03:20:00
Unit=showcase-wholemap@full.service
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/showcase-wholemap-trips.timer <<'EOF'
[Unit]
Description=SHOWCASE whole-map S0: trips + route layer, hourly
[Timer]
OnCalendar=*:12:00
Unit=showcase-wholemap@trips.service
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now showcase-wholemap-full.timer showcase-wholemap-trips.timer >/dev/null
echo "   ok  timers enabled: $(systemctl is-enabled showcase-wholemap-full.timer) / $(systemctl is-enabled showcase-wholemap-trips.timer)"

# ---- BlueMap include (idempotent)
if grep -qF "include file(\"$LAYER\")" "$CONF"; then
  echo "   ok  $CONF already includes the layer"
  exit 0
fi
cp -p "$CONF" "$BAK"
python3 - "$CONF" "$LAYER" <<'PY'
import os, sys
p, layer = sys.argv[1], sys.argv[2]
s = open(p).read()
k = s.find('marker-sets: {')
assert k >= 0 and s.count('marker-sets: {') == 1, 'marker-sets block not found exactly once'
depth, i = 0, k + len('marker-sets: ')
for i in range(k + len('marker-sets: '), len(s)):
    if s[i] == '{':
        depth += 1
    elif s[i] == '}':
        depth -= 1
        if depth == 0:
            break
assert depth == 0, 'marker-sets block not closed'
line = ('  # wholemap.py route layer (whole-map S0): missing file = ignored; wholemap.py writes validated JSON only\n'
        f'  include file("{layer}")\n')
s2 = s[:i] + line + s[i:]
open(p + '.tmp', 'w').write(s2)
os.replace(p + '.tmp', p)
PY
chown mike:mike "$CONF"

# ---- prove it on a scratch copy before trusting it (needs the layer to exist: write it once now, as mike)
sudo -u mike python3 -B /srv/showcase/bin/wholemap.py trips --ship '' >/dev/null || true
T=$(mktemp -d /tmp/wholemap-bmproof.XXXX)
cp -r "$BM/config" "$T/config"
cp -r "$BM/data" "$T/data"
printf 'storage-type: file\nroot: "%s/web/maps"\ncompression: gzip\n' "$T" > "$T/config/storages/file.conf"
sed -i -E 's/\{ min-x: -?[0-9]+, max-x: -?[0-9]+, min-z: -?[0-9]+, max-z: -?[0-9]+,/{ min-x: 0, max-x: 15, min-z: 0, max-z: 15,/' "$T/config/maps/showcase.conf"
chown -R mike:mike "$T"
ok=0
if (cd "$T" && sudo -u mike nice -n 19 java -Xmx1G -jar "$BM/bluemap-cli.jar" -c "$T/config" -r -m showcase > "$T/proof.log" 2>&1); then
  M=$(find "$T/web" -name markers.json | head -1)
  if [ -n "$M" ] && python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'wm-zones' in d and 'town' in d, list(d); print('   ok  proof render: sets', sorted(d))" "$M"; then ok=1; fi
fi
if [ "$ok" != 1 ]; then
  cp -p "$BAK" "$CONF"
  echo "   FAILED: the scratch render did not load the layer; $CONF restored from backup. Log: $T/proof.log"
  tail -5 "$T/proof.log"
  exit 1
fi
rm -rf "$T"
echo "   ok  $CONF includes $LAYER (backup $BAK); live within the next timelapse render"
