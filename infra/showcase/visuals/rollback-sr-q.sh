#!/usr/bin/env bash
# skinsfix-1106 ROLLBACK (quarantine-safe copy of visuals-1105/rollback-sr.sh): disable SkinsRestorer with one planned restart,
# restarting ONLY the bots running now (start-bots.sh would start the quarantined Nova+Gale). Run as root.
set -uo pipefail
J=/srv/showcase/ops/deploy.jsonl; P=/srv/showcase/server/plugins
log() { python3 -c 'import json,sys,datetime as d; r=json.loads(sys.argv[1]); r={"t": d.datetime.now(d.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **r}; print(json.dumps(r))' "$1" >> $J; }
exec 9>>/srv/showcase/ops.lock; flock 9
exec 8>>/srv/showcase/timelapse/logs/renderer.lock; flock -w 900 8 || { echo "renderer busy"; exit 1; }
RUNNING=$(systemctl list-units --state=active 'mcshow@*' --no-legend | awk '{print $1}' | sed 's/mcshow@//;s/.service//' | tr '\n' ' ')
log '{"event": "server-restart-begin", "ledger": "skinsfix-1106", "why": "ROLLBACK skinsfix-1106: disable SkinsRestorer", "running": "'"$RUNNING"'"}'
for n in $RUNNING; do systemctl stop "mcshow@$n" && echo "   stopped $n"; sleep 12; done
mkdir -p $P/../plugins-disabled; [ -f $P/SkinsRestorer.jar ] && mv $P/SkinsRestorer.jar $P/../plugins-disabled/SkinsRestorer.jar.disabled-$(date -u +%Y%m%dT%H%MZ)
T0=$(date +%s); systemctl restart showcase-paper; ok=0
for i in $(seq 1 60); do sleep 5; /srv/showcase/bin/rcon.py list >/dev/null 2>&1 && grep -q "Done (" <(journalctl -u showcase-paper --since "@$T0" --no-pager 2>/dev/null; cat /srv/showcase/server/logs/latest.log) && { ok=1; break; }; done
echo "paper up=$ok; plugins: $(/srv/showcase/bin/rcon.py plugins | sed 's/§.//g' | tr '\n' ' ')"
log '{"event": "server-restart-done", "ledger": "skinsfix-1106", "paper_up": '"$ok"', "why": "SkinsRestorer disabled (rollback)"}'
flock -u 8; flock -u 9; exec 8>&- 9>&-
[ $ok = 1 ] || { echo "PAPER NOT UP"; exit 1; }
rc=0; for n in $RUNNING; do systemctl start "mcshow@$n" && echo "   started $n" || rc=1; sleep 12; done
log '{"event": "start-bots-after-restart", "ledger": "skinsfix-1106", "rc": '"$rc"', "bots": "'"$RUNNING"'"}'; exit $rc
