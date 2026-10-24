#!/bin/bash
# lavamap-cron.sh -- lavasight-01's publisher on 10.0.0.31 (mike's crontab, hourly at :40). Docs: lavamap_publish.py and
# docs/reports/lavasight-01-design-2026-10-24.md 2.1.
#   As mcbot (the bots' user; never root). mcbot cannot read /home/mike, so mike's shell sends it everything on stdin, as
#   the frontier publisher does: a byte count, the program text, then (read by the program) a byte count, the hazard map,
#   then the hazardmap heartbeat. BOOT (a one-liner, so sudo logs a short command line) compiles the program and runs it.
#   The program writes ONLY lava-map.json inside existing /var/lib/mcai/_pool-<world> dirs, and only when the heartbeat
#   says the refresh of THIS map finished `ok`. Its one JSON line goes to $D/out/publish.log.
# One run at a time (flock). Installed from a stable copy in $D (never run from /opt/minecraft-ai).
D="${LM_DIR:-/home/mike/lavasight}"              # LM_DIR: a trial copy only; cron never sets it
H="${LM_HAZARD:-/home/mike/hazardmap/out}"
R="${LM_ROOT:-/var/lib/mcai}"                    # LM_ROOT / LM_SELF=1: the rehearsal only (a trial root, as mike)
RUNAS="/usr/bin/sudo -n -u mcbot"; [ "${LM_SELF:-}" = 1 ] && RUNAS=""
BOOT='import sys;b=sys.stdin.buffer;n=int(b.readline());exec(compile(b.read(n),"lavamap_publish.py","exec"),{"__name__":"__main__"})'
cd "$D" || exit 9
mkdir -p "$D/out" || exit 9
exec 9> "$D/out/.cron.lock" || exit 9
/usr/bin/flock -n 9 || exit 0
S="$D/app/lavamap_publish.py"
[ -f "$S" ] && [ -f "$H/hazardmap.json" ] || { echo "{\"status\": \"missing\", \"at\": \"$(date -u +%FT%TZ)\"}" >> "$D/out/publish.log"; exit 0; }
SNAP=$(mktemp "$D/out/.publisher.XXXXXX") || exit 8   # one snapshot each: the counts and the bytes sent are the same files
MAP=$(mktemp "$D/out/.map.XXXXXX") || exit 8
trap 'rm -f "$SNAP" "$MAP"' EXIT
cat "$S" > "$SNAP" && cat "$H/hazardmap.json" > "$MAP" || exit 8
cd / || exit 9
{ wc -c < "$SNAP"; cat "$SNAP"; wc -c < "$MAP"; cat "$MAP"; cat "$H/heartbeat.json" 2>/dev/null; } \
  | $RUNAS /usr/bin/nice -n 19 /usr/bin/python3 -I -B -c "$BOOT" publish-stdin --root "$R" \
  >> "$D/out/publish.log" 2>&1
