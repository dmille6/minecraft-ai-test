#!/usr/bin/env bash
# visuals-1105: install SkinsRestorer 15.12.6 into the showcase Paper server with ONE planned restart.
# Holds the ops lock (no stage/activate/follow meanwhile) and the renderer lock (no capture snapshot mid-restart).
# Run as root: sudo ~mike/visuals-1105/restart-sr.sh
set -uo pipefail
J=/srv/showcase/ops/deploy.jsonl
JAR=/srv/showcase/bluemap/downloads/skinsrestorer-15.12.6/SkinsRestorer.jar
SHA=a85b4a370f988741c9a38f4d0498262edacbf3220314790ac1c127461996359c
P=/srv/showcase/server/plugins
log() { python3 -c 'import json,sys,datetime as d; r=json.loads(sys.argv[1]); r={"t": d.datetime.now(d.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **r}; print(json.dumps(r))' "$1" >> $J; }
echo "$SHA  $JAR" | sha256sum -c - || { echo "jar checksum FAIL"; exit 1; }
exec 9>>/srv/showcase/ops.lock; flock 9; echo "ops lock held"
exec 8>>/srv/showcase/timelapse/logs/renderer.lock; flock -w 900 8 || { echo "renderer busy 900 s"; exit 1; }; echo "renderer lock held"
RUNNING=$(systemctl list-units --state=active 'mcshow@*' --no-legend | wc -l)
echo "mspt before: $(/srv/showcase/bin/rcon.py mspt | sed -n 2p | sed 's/§.//g')"
log '{"event": "server-restart-begin", "ledger": "visuals-1105", "why": "install SkinsRestorer 15.12.6 (GPL-3.0, sha256 a85b4a37 verified vs GitHub release digest + Modrinth sha1); planned restart, bots stopped first", "running_bots": '"$RUNNING"'}'
SHOWCASE_LOCK_HELD=1 /srv/showcase/bin/stop-bots.sh "visuals-1105: planned Paper restart to install SkinsRestorer 15.12.6"
install -o minecraft -g minecraft -m 0640 "$JAR" $P/SkinsRestorer.jar
T0=$(date +%s)
systemctl restart showcase-paper
ok=0
for i in $(seq 1 60); do
  sleep 5
  if journalctl -u showcase-paper --since "@$T0" --no-pager 2>/dev/null | grep -q 'Done (' || \
     grep -q 'Done (' <(awk -v t="$(date -u -d @$T0 +%H:%M:%S)" 'substr($1,2,8) >= t' /srv/showcase/server/logs/latest.log); then
    /srv/showcase/bin/rcon.py list >/dev/null 2>&1 && { ok=1; break; }
  fi
done
echo "paper up=$ok after $(( $(date +%s) - T0 )) s"
PL=$(/srv/showcase/bin/rcon.py plugins | sed 's/§.//g' | tr '\n' ' ')
echo "plugins: $PL"
SR=$(/srv/showcase/bin/rcon.py "sr status" | sed 's/§.//g' | tr '\n' ' ' | cut -c1-400)
echo "sr status: $SR"
log '{"event": "server-restart-done", "ledger": "visuals-1105", "paper_up": '"$ok"', "plugins": '"$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1][:300]))' "$PL")"', "sr_status": '"$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1][:300]))' "$SR")"'}'
flock -u 8; flock -u 9; exec 8>&- 9>&-
[ $ok = 1 ] || { echo "PAPER NOT UP: bots NOT restarted; rollback: rm $P/SkinsRestorer.jar && systemctl restart showcase-paper"; exit 1; }
/srv/showcase/bin/start-bots.sh
rc=$?
log '{"event": "start-bots-after-restart", "ledger": "visuals-1105", "rc": '"$rc"'}'
exit $rc
