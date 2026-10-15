#!/usr/bin/env bash
# Lay out ~/bluemap-tl on the world host (10.0.0.30), separate from the live ~/bluemap.
# Idempotent. Does not install packages (see docs/reports/ziggurat-timelapse.md for the
# apt + Puppeteer steps) and never writes outside ~/bluemap-tl and /var/tmp/timelapse.
#   scp -r infra/timelapse mike@10.0.0.30:/tmp/tl-src && ssh mike@10.0.0.30 bash /tmp/tl-src/setup.sh
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
TL=${TL_HOME:-$HOME/bluemap-tl}
LIVE=$HOME/bluemap
mkdir -p "$TL"/{bin,config/maps,config/storages,data,web,logs,capture} /var/tmp/timelapse

install -m 755 "$SRC/tl.py" "$SRC/tl_cycle.sh" "$SRC/tl_assemble.sh" "$TL/bin/"
install -m 644 "$SRC/capture.mjs" "$TL/capture/"
[ -f "$TL/sites.json" ] || install -m 644 "$SRC/sites.json" "$TL/sites.json"

# Pin our own copy of the CLI and the client jar so a live upgrade cannot change a series mid-way.
[ -f "$TL/bluemap-cli.jar" ] || cp "$LIVE/bluemap-cli.jar" "$TL/bluemap-cli.jar"
for f in "$LIVE"/data/minecraft-client-*.jar "$LIVE/data/resourceExtensions.zip"; do
  [ -f "$TL/data/$(basename "$f")" ] || cp "$f" "$TL/data/"
done

cat > "$TL/config/core.conf" <<EOF
accept-download: true
data: "$TL/data"
render-thread-count: 6
scan-for-mod-resources: false
metrics: false
log: { file: "$TL/logs/bluemap-debug.log", append: false }
EOF
cat > "$TL/config/webapp.conf" <<EOF
enabled: true
webroot: "$TL/web"
update-settings-file: true
use-cookies: false
default-to-flat-view: false
min-zoom-distance: 5
max-zoom-distance: 100000
resolution-default: 1
hires-slider-max: 1000
hires-slider-default: 1000
hires-slider-min: 0
lowres-slider-max: 7000
lowres-slider-default: 7000
lowres-slider-min: 500
scripts: []
styles: []
EOF
cat > "$TL/config/webserver.conf" <<EOF
enabled: true
webroot: "$TL/web"
ip: "127.0.0.1"
port: 8101
EOF
cat > "$TL/config/storages/file.conf" <<EOF
storage-type: file
root: "$TL/web/maps"
compression: gzip
EOF
[ -f "$TL/capture/node_modules/puppeteer/package.json" ] || \
  echo "NOTE: Puppeteer not installed in $TL/capture yet (see the README install step)"
echo "laid out $TL"
