#!/bin/bash
# frontiercensus-cron.sh -- E0's cron entry on 10.0.0.31 (mike's crontab, every 5 min). Docs: frontiercensus.py.
#   1. the TICK, as mike, nice 19: reads ES (read-only key) and /var/lib/mcai (read), writes ONLY under $D/out,
#      including out/publish/bundle.json (the towns eligible NOW, or none, with why).
#   2. the PUBLISHER, as mcbot (the bots' user; never root): the program text and the bundle are both passed from
#      mike's side (mcbot cannot read /home/mike). It writes ONLY frontier-<home>.g<N>.json inside existing
#      /var/lib/mcai/_pool-<pool> dirs, and only once the bundle says the 48 h warm-up is complete. Its one JSON line
#      goes to $D/out/publish.log (this shell's redirect); the next tick carries it into the heartbeat.
# Installed from a stable copy in $D (never run from /opt/minecraft-ai, which deploys reset).
D=/home/mike/frontiercensus
cd "$D" || exit 9
/usr/bin/nice -n 19 /usr/bin/python3 -B scripts/host/frontiercensus.py --tick --out-dir "$D/out" >> "$D/out/tick.log" 2>&1
B="$D/out/publish/bundle.json"
[ -f "$B" ] || exit 0
PROG="$(cat "$D/scripts/host/frontierpublish.py")" || exit 8
cd / && /usr/bin/sudo -n -u mcbot /usr/bin/nice -n 19 /usr/bin/python3 -B -c "$PROG" --state-dir /var/lib/mcai \
    < "$B" >> "$D/out/publish.log" 2>&1
