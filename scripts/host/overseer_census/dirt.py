import sys, collections
sys.path.insert(0, "/home/mike/estel/scripts")
from lib.estelemetry import EsEvents
ev = EsEvents.load("skill", since_minutes=24 * 60)
rs = list(ev.rows("gather", fields=["skill.args", "skill.duration_ms", "skill.status", "trigger", "bot.inventory"], max_rows=100000))
h = collections.Counter(); n = collections.Counter(); ok = collections.Counter(); held = []
for r in rs:
    s = r.get("skill") or {}
    if (s.get("args") or {}).get("block") != "dirt":
        continue
    t = r.get("trigger") or "?"
    h[t] += (s.get("duration_ms") or 0) / 3.6e6; n[t] += 1; ok[t] += s.get("status") == "success"
    held.append(((r.get("bot") or {}).get("inventory") or {}).get("dirt", 0))
print("dirt gather by trigger (bot-h, n, success):", [(k, round(v, 1), n[k], ok[k]) for k, v in h.most_common(8)])
held.sort()
print("dirt held at the end of a dirt gather: median", held[len(held)//2], "p90", held[int(len(held)*.9)], "n", len(held))
