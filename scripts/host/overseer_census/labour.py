"""Where does the free labour go? Body time by (skill, target) and by trigger, 24 h; plus time outside any skill."""
import sys, collections
sys.path.insert(0, "/home/mike/estel/scripts")
from lib.estelemetry import EsEvents
ev = EsEvents.load("skill", since_minutes=24 * 60)
BH = len(ev.bots_present()) * ev.span_hours()
for kind, argk in (("gather", "block"), ("explore", None), ("goto", None), ("mine", None), ("craft", "item")):
    rs = list(ev.rows(kind, fields=["skill.args", "skill.duration_ms", "skill.status", "trigger", "exp.pool"], max_rows=100000))
    h = collections.Counter()
    n = collections.Counter()
    trig = collections.Counter()
    for r in rs:
        s = r.get("skill") or {}
        a = ((s.get("args") or {}).get(argk) if argk else None)
        ms = s.get("duration_ms") or 0
        h[a] += ms / 3.6e6
        n[a] += 1
        t = (r.get("trigger") or "?")
        t = t.split(":")[0] + ":" + (t.split(":")[1] if ":" in t else "")
        trig[t] += ms / 3.6e6
    tot = sum(h.values())
    print(f"{kind}: n={len(rs)} body {tot:.1f} bot-h ({100*tot/BH:.1f}% of {BH:.0f})")
    if argk:
        print("   by target (bot-h, n):", [(k, round(v, 1), n[k]) for k, v in h.most_common(8)])
    print("   by trigger (bot-h):", [(k, round(v, 1)) for k, v in trig.most_common(6)])
llm = EsEvents.load("llm", since_minutes=24 * 60)
print("llm docs 24 h:", llm.total(), "bots", len(llm.bots_present()))
tr = llm.terms("trigger")
print("llm by trigger:", sorted(tr.items(), key=lambda kv: -kv[1])[:10])
