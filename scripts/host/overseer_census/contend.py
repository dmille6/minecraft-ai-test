"""Contention between bots of one shared town: gather failures by class, _dig_collision, and the 7-day kind census
for multi-bot project rows (the positive control is the single-bot structure rows the same census sees)."""
import sys, re, collections
sys.path.insert(0, "/home/mike/estel/scripts")
from lib.estelemetry import EsEvents
ev = EsEvents.load("skill", since_minutes=24 * 60)
F = ["@timestamp", "skill", "exp.pool", "bot.name"]
g = list(ev.rows("gather", fields=F, max_rows=100000))
bad = [r for r in g if r["skill"].get("status") in ("failed", "aborted", "unknown")]
cls = collections.Counter()
for r in bad:
    d = (r["skill"].get("detail") or "")
    cls[(r["skill"].get("fail_class"), re.sub(r"[-0-9.,]+", "#", d)[:75])] += 1
print(f"gather {len(g)}; not-success {len(bad)}; top classes:")
for (fc, c), n in cls.most_common(18):
    print(f"  {n:5d} {fc} | {c}")
other = [r for r in bad if re.search(r"another bot|other bot|taken|claimed|occupied|someone", r["skill"].get("detail") or "", re.I)]
print(f"gather failures naming another bot / a claim: {len(other)} of {len(bad)}")
dc = list(ev.rows("_dig_collision", fields=F, max_rows=100000))
print(f"_dig_collision {len(dc)}; sample:")
for r in dc[:: max(1, len(dc)//5)][:5]:
    print("  ", r["bot"]["name"], (r["skill"].get("detail") or "")[:220])
try:
    ev7 = EsEvents.load("skill", since_minutes=6 * 24 * 60)
    names = ev7.names()
    hits = {k: v for k, v in names.items() if re.search(r"project|zigg|monument|shaft|yard|storehouse|hall|build|plinth|well_built|structure|treefarm|farm", k)}
    print("6-day kinds matching project/structure words:", dict(sorted(hits.items(), key=lambda kv: -kv[1])))
    print("6-day total docs", ev7.total())
except Exception as e:
    print("6-day census:", type(e).__name__, str(e)[:300])
