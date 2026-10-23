import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
U = '2026-10-23T14:00:00Z'
evl = EsEvents.load('llm', since_minutes=7 * 24 * 60, until=U)
q = evl._query()
r = evl._search({'size': 0, 'query': q, 'aggs': {'m': {'terms': {'field': 'messages.milestone', 'size': 3000}}}})
ms = {}
import re
for b in r['aggregations']['m']['buckets']:
    k = re.sub(r'#\d+', '', b['key']); ms[k] = ms.get(k, 0) + b['doc_count']
print('decisions by milestone (7 d):', sorted(ms.items(), key=lambda kv: -kv[1])[:15], 'total', sum(ms.values()))
ev = EsEvents.load('skill', since_minutes=7 * 24 * 60, until=U)
print('explore rows', int(ev.count('explore')), '_explore_toward_known', int(ev.count('_explore_toward_known')))
etk = ev.terms('exp.pool', kind='_explore_toward_known')
print('etk targets sample:')
rows = ev.rows('_explore_toward_known', fields=['skill.detail'], max_rows=200000)
c = {}
for x in rows:
    m = re.search(r'heading for (\w+)', x['skill']['detail'] or '')
    k = m.group(1) if m else '?'; c[k] = c.get(k, 0) + 1
print(sorted(c.items(), key=lambda kv: -kv[1])[:10])
