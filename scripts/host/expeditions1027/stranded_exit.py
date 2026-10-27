import sys;sys.path.insert(0,'/home/mike/estel/scripts/lib')
from estelemetry import EsEvents
ev=EsEvents.load(since='2026-10-26T12:00:00Z',until='2026-10-27T23:00:00Z',bots=['placebo-c-Bravo'])
seq=[r for r in ev.rows(fields=['@timestamp','bot.pos','skill.name','skill.status','skill.detail','trigger'],max_rows=400000) if (r.get('bot') or {}).get('pos')]
idx=max(i for i,r in enumerate(seq) if abs(r['bot']['pos']['x']-559.5)<6 and r['bot']['pos']['y']<40)
for r in seq[idx-3:idx+6]: print(r['@timestamp'],r['bot']['pos'],r['skill']['name'],r['skill'].get('status'),r.get('trigger'),(r['skill'].get('detail') or '')[:140])
