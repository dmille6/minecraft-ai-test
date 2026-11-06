#!/usr/bin/env bash
# skinsfix-1106: RE-ENABLE SkinsRestorer 15.12.6 on the showcase with ONE planned restart (bots stopped first).
# 11-05's rollback blamed SR for a reconnect loop; the journal shows that loop ran 22:10Z 11-04 -> 03:47Z 11-05 (before SR was
# installed, and after it was removed) and ended at the lease prune. Sandbox8 soak 11-06: skinned bots 0 reconnects / 60 min.
# Holds the ops lock (waits for any stage/activate) + the renderer lock. Run as root: sudo ~mike/visuals-1105/enable-sr.sh
# Rollback: sudo ~mike/visuals-1105/rollback-sr.sh  (WARNING: that script calls start-bots.sh, which starts Nova+Gale;
#   use ~mike/visuals-1105/rollback-sr-q.sh instead, the quarantine-safe copy)
set -uo pipefail
J=/srv/showcase/ops/deploy.jsonl; P=/srv/showcase/server/plugins
SRC=/srv/showcase/server/plugins-disabled/SkinsRestorer.jar.disabled-20261105
SHA=a85b4a370f988741c9a38f4d0498262edacbf3220314790ac1c127461996359c
log() { python3 -c 'import json,sys,datetime as d; r=json.loads(sys.argv[1]); r={"t": d.datetime.now(d.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **r}; print(json.dumps(r))' "$1" >> $J; }
echo "$SHA  $SRC" | sha256sum -c - || { echo "jar checksum FAIL"; exit 1; }
exec 9>>/srv/showcase/ops.lock; flock 9; echo "ops lock held"
exec 8>>/srv/showcase/timelapse/logs/renderer.lock; flock -w 900 8 || { echo "renderer busy 900 s"; exit 1; }; echo "renderer lock held"
RUNNING=$(systemctl list-units --state=active 'mcshow@*' --no-legend | awk '{print $1}' | sed 's/mcshow@//;s/.service//' | tr '\n' ' ')
log '{"event": "server-restart-begin", "ledger": "skinsfix-1106", "why": "re-enable SkinsRestorer 15.12.6 (owner 11-06: skins fix, sandbox first); 11-05 reconnect loop was the lease-file stall, not SR (sandbox8 soak 0 reconnects/60 min)", "running": "'"$RUNNING"'"}'
# NOT stop-bots.sh/start-bots.sh: start-bots enables all 15 and would end the Nova+Gale quarantine (11-06 17:17Z). Stop and
# start exactly the units running now (enabled state untouched), 12 s apart.
[ -n "$RUNNING" ] || { echo "no bots running: refusing (nothing to restart round)"; exit 1; }
for n in $RUNNING; do systemctl stop "mcshow@$n" && echo "   stopped $n"; sleep 12; done
log '{"event": "bots-stopped-for-restart", "ledger": "skinsfix-1106", "why": "skinsfix-1106 planned Paper restart (running units only; quarantine untouched)", "bots": "'"$RUNNING"'"}'
install -o minecraft -g minecraft -m 0640 "$SRC" $P/SkinsRestorer.jar
T0=$(date +%s); systemctl restart showcase-paper; ok=0
for i in $(seq 1 60); do sleep 5; /srv/showcase/bin/rcon.py list >/dev/null 2>&1 && grep -q "Done (" <(journalctl -u showcase-paper --since "@$T0" --no-pager 2>/dev/null; cat /srv/showcase/server/logs/latest.log) && { ok=1; break; }; done
PL=$(/srv/showcase/bin/rcon.py plugins | sed 's/§.//g' | tr '\n' ' ')
echo "paper up=$ok after $(( $(date +%s) - T0 )) s; plugins: $PL"
log '{"event": "server-restart-done", "ledger": "skinsfix-1106", "paper_up": '"$ok"', "plugins": '"$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1][:300]))' "$PL")"'}'
flock -u 8; flock -u 9; exec 8>&- 9>&-
[ $ok = 1 ] || { echo "PAPER NOT UP: bots NOT restarted; rollback: rm $P/SkinsRestorer.jar && systemctl restart showcase-paper"; exit 1; }
rc=0; for n in $RUNNING; do systemctl start "mcshow@$n" && echo "   started $n" || rc=1; sleep 12; done
for q in showcase-Nova showcase-Gale; do systemctl is-active --quiet "mcshow@$q" && { echo "QUARANTINE BROKEN: $q active"; rc=2; }; done
log '{"event": "start-bots-after-restart", "ledger": "skinsfix-1106", "rc": '"$rc"'}'; exit $rc
