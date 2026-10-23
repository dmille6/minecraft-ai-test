import sys, collections, re; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
ev = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('Comet docs', ev.total())
print('kinds', sorted(ev.terms('skill.name').items(), key=lambda x:-x[1])[:60])
# held seconds per day
held = collections.Counter(); n=collections.Counter(); samples={}
first=last=None
for r in ev.rows('_water_no_air_route_ended', fields=['@timestamp','skill.detail','bot.pos']):
    d=r['skill'].get('detail','') ; day=r['@timestamp'][:10]
    m=re.search(r'held (\d+(?:\.\d+)?)s', d)
    if m: held[day]+=float(m.group(1))
    n[day]+=1
    samples.setdefault(day, d)
    first = first or r['@timestamp']; last=r['@timestamp']
for day in sorted(n): print(day, n[day], round(held[day]/3600,2), 'h |', samples[day][:250])
print('first', first, 'last', last)
