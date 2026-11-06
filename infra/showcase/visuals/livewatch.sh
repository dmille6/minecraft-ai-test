#!/usr/bin/env bash
# skinsfix-1106 live read (read-only): per-bot reconnects / parse errors / timeouts / kicks since $1 (journal), + Paper log.
SINCE="${1:?since e.g. 2026-11-06 22:40}"
sudo journalctl -u 'mcshow@*' --since "$SINCE" --no-pager -o json --output-fields=_SYSTEMD_UNIT,MESSAGE 2>/dev/null | python3 -c '
import json,sys,collections as C
k=C.defaultdict(C.Counter)
for l in sys.stdin:
    try: r=json.loads(l)
    except: continue
    u=(r.get("_SYSTEMD_UNIT") or "?").replace("mcshow@","").replace(".service",""); m=r.get("MESSAGE") or ""
    if not isinstance(m,str): continue
    k[u]["lines"]+=1
    if "will reconnect" in m: k[u]["reconnect"]+=1
    if "PartialReadError" in m: k[u]["partial"]+=1
    if "Deserializ" in m or "player_info" in m: k[u]["deser_or_pinfo"]+=1
    if "kicked" in m.lower(): k[u]["kicked"]+=1
    if "timed out" in m.lower() or "keepalive" in m.lower(): k[u]["timeout"]+=1
    if "skill " in m and " -> success" in m: k[u]["skill_ok"]+=1
    if "INFO  spawned" in m: k[u]["spawned"]+=1
for u in sorted(k): print(u, dict(k[u]))
'
echo "== paper log (SkinsRestorer / errors / kicks / lost connection)"
sudo grep -a -E "SkinsRestorer.*(WARN|ERROR)|\[Server thread/(WARN|ERROR)\]|lost connection|Kicked|kicked" /srv/showcase/server/logs/latest.log | awk -v s="$(date -u -d "$SINCE" +%H:%M:%S)" 'substr($1,2,8) >= s' | tail -20 | cut -c1-220
