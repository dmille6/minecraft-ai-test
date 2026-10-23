"""Print the skill/detail of sample reflex rows and one llm row. Read-only (ES)."""
import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

ev = EsEvents.load('skill', since='2026-10-22T12:00:00Z', until='2026-10-22T12:20:00Z')
for k in sys.argv[1:]:
    rs = list(ev.rows(k, max_rows=20000, fields=['@timestamp', 'bot.name', 'skill', 'trigger'], allow_zero=True))
    print('==', k, len(rs))
    for r in rs[:3]:
        print(json.dumps(r, default=str)[:700])
el = EsEvents.load('llm', since='2026-10-22T12:00:00Z', until='2026-10-22T12:01:00Z')
rs = list(el.rows(max_rows=5000))
print('== llm', len(rs))
print(json.dumps(rs[0], default=str)[:2500])
