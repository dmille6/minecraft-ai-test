import json, collections, os, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
X = json.load(open(D + 'danger7d.json'))
deaths = json.load(open(D + 'deaths7d.json'))
C = collections.Counter


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00'))


fire = collections.defaultdict(list)
for d in deaths:
    fire[d['bot']['name']].append((P(d['@timestamp']), d['skill'].get('fail_class'), d['skill']['detail'][:60]))
# episodes of danger_block per bot (gap > 30 s starts a new one)
eps = []
rows = sorted(X['_reflex_danger_block'], key=lambda r: (r['bot']['name'], r['@timestamp']))
cur = None
for r in rows:
    b = r['bot']['name']; t = P(r['@timestamp'])
    if cur and cur['bot'] == b and (t - cur['last']).total_seconds() <= 30:
        cur['last'] = t; cur['n'] += 1; cur['details'].append(r['skill'].get('detail')); continue
    cur = {'bot': b, 'first': t, 'last': t, 'n': 1, 'details': [r['skill'].get('detail')], 'hp0': r['bot'].get('health'), 'y': r['bot']['pos']['y']}
    eps.append(cur)
tab = C()
for e in eps:
    first = e['details'][0]
    kind = 'feet in hazard (' + first + ')' if first in ('lava', 'magma_block', 'fire', 'soul_fire', 'campfire', 'flowing_lava') else 'feet clear, hazard BELOW (' + str(first) + ')'
    kind = kind if 'BELOW' in kind else 'feet in hazard'
    died = [d for d in fire[e['bot']] if 0 <= (d[0] - e['first']).total_seconds() <= 20]
    out = ('died ' + died[0][1]) if died else 'survived'
    tab[(kind, out)] += 1
    e['kind'] = kind; e['out'] = out
print('danger_block episodes:', len(eps))
for k, v in sorted(tab.items()):
    print(f'  {v:4} {k}')
hp = C((e['kind'], e['out'], 'hp0>=16' if (e['hp0'] or 0) >= 16 else 'hp0<16') for e in eps)
for k, v in sorted(hp.items()):
    print(f'  {v:4} {k}')
# stand-off: does the guard ever fire, and does a death follow?
so = X['_lava_adjacent_stand_off']; nr = X['_lava_adjacent_no_retreat']
def died_after(rows, s=20):
    n = 0
    for r in rows:
        t = P(r['@timestamp'])
        if any(0 <= (d[0] - t).total_seconds() <= s and d[1] == 'fire' for d in fire[r['bot']['name']]):
            n += 1
    return n
print('stand_off rows', len(so), 'fire death within 20s', died_after(so))
print('no_retreat rows', len(nr), 'fire death within 20s', died_after(nr))
lh = X['_reflex_low_health']
print('low_health rows', len(lh), 'any death within 20s', sum(1 for r in lh if any(0 <= (d[0] - P(r['@timestamp'])).total_seconds() <= 20 for d in fire[r['bot']['name']])))
