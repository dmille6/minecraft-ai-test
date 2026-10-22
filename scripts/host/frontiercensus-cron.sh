#!/bin/bash
# frontiercensus-cron.sh -- E0's cron entry on 10.0.0.31 (mike's crontab, every 5 min). Docs: frontiercensus.py.
#   1. the TICK, as mike, nice 19: reads ES (read-only key) and /var/lib/mcai (read), writes ONLY under $D/out,
#      including out/publish/bundle.json (the towns eligible NOW, or none, with why). It invalidates the bundle before
#      anything that can fail, so a tick that dies leaves nothing publishable.
#   2. the PUBLISHER, as mcbot (the bots' user; never root), only after a tick that finished (exit 0, or 4 =
#      instrument, whose entries the publisher refuses and reports). mcbot cannot read /home/mike, so mike's shell
#      sends it everything on stdin: a byte count, the program text, then the bundle; BOOT (a one-liner, so sudo logs
#      a short command line) compiles the program and runs it, and the program reads the bundle from the rest of
#      stdin. It writes ONLY frontier-<home>.g<N>.json inside existing /var/lib/mcai/_pool-<pool> dirs it owns, and
#      only once the bundle says the 48 h warm-up is complete; before that it rehearses (read-only) and says which
#      pool dirs it could not write. Its one JSON line goes to $D/out/publish.log; the next tick carries it into the
#      heartbeat.
# One sequence at a time (flock). Installed from a stable copy in $D (never run from /opt/minecraft-ai).
D="${FC_DIR:-/home/mike/frontiercensus}"        # FC_DIR: a trial copy only; cron never sets it
BOOT='import sys;b=sys.stdin.buffer;n=int(b.readline());exec(compile(b.read(n),"frontierpublish.py","exec"),{"__name__":"__main__"})'
cd "$D" || exit 9
mkdir -p "$D/out" || exit 9
exec 9> "$D/out/.cron.lock" || exit 9
/usr/bin/flock -n 9 || exit 0
/usr/bin/nice -n 19 /usr/bin/python3 -B scripts/host/frontiercensus.py --tick --out-dir "$D/out" >> "$D/out/tick.log" 2>&1
RC=$?
[ "$RC" = 0 ] || [ "$RC" = 4 ] || exit 0
B="$D/out/publish/bundle.json"
S="$D/scripts/host/frontierpublish.py"
[ -f "$B" ] && [ -f "$S" ] || exit 0
SNAP=$(mktemp "$D/out/.publisher.XXXXXX") || exit 8         # one snapshot: the count and the bytes sent are the same
trap 'rm -f "$SNAP"' EXIT                                   # file, even if $S is re-copied meanwhile (Claude r4 P3-1)
cat "$S" > "$SNAP" || exit 8
cd / || exit 9
{ wc -c < "$SNAP"; cat "$SNAP" "$B"; } | /usr/bin/sudo -n -u mcbot /usr/bin/nice -n 19 /usr/bin/python3 -I -B -c "$BOOT" \
    --state-dir /var/lib/mcai >> "$D/out/publish.log" 2>&1
