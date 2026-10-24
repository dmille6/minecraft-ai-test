import sys, json, re
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
# respawnfall-01 evidence: every row of a bot standing above y=110 in the week (any pool), with inventory, to see
# (a) how long a respawned bot stays up there, (b) what it does, (c) what it carries, (d) how it ends.
ev = EsEvents.load('skill', since='2026-10-17T13:00:00Z', until='2026-10-24T13:00:00Z')
print('window docs (control):', ev.total())
base = ev._query()
q = json.loads(json.dumps(base))
q.setdefault('bool', {}).setdefault('filter', []).append({'range': {'bot.pos.y': {'gte': 110}}})
out = []
body = {'size': 5000, 'query': q, '_source': ['@timestamp', 'bot.name', 'bot.pos', 'bot.inventory', 'bot.health', 'skill.name', 'skill.status', 'skill.detail', 'exp.pool'],
        'sort': [{'@timestamp': 'asc'}]}
after = None
while True:
    if after: body['search_after'] = after
    d = ev._search(body)
    hs = d['hits']['hits']
    if not hs: break
    for h in hs:
        s = h['_source']
        out.append({'t': s['@timestamp'], 'bot': s['bot']['name'], 'pos': s['bot'].get('pos'), 'inv': s['bot'].get('inventory'), 'hp': s['bot'].get('health'),
                    'k': (s.get('skill') or {}).get('name'), 'st': (s.get('skill') or {}).get('status'), 'd': ((s.get('skill') or {}).get('detail') or '')[:160], 'pool': (s.get('exp') or {}).get('pool')})
    after = hs[-1]['sort']
    if len(out) > 400000: break
print('rows >= y110:', len(out))
# deaths of the same bots in the window (the outcome) and spawns
q2 = json.loads(json.dumps(base))
q2.setdefault('bool', {}).setdefault('filter', []).append({'terms': {'skill.name': ['_death']}})
d2 = ev._search({'size': 1000, 'query': q2, '_source': ['@timestamp', 'bot.name', 'bot.pos', 'skill.detail'], 'sort': [{'@timestamp': 'asc'}]})
deaths = [{'t': h['_source']['@timestamp'], 'bot': h['_source']['bot']['name'], 'pos': h['_source']['bot'].get('pos'), 'd': (h['_source'].get('skill') or {}).get('detail', '')[:200]} for h in d2['hits']['hits']]
print('deaths (control):', len(deaths))
json.dump({'rows': out, 'deaths': deaths}, open('/tmp/rf_sky7d.json', 'w'))
