"""r4 (Codex r3 P2-8): the explicit death-message tally with an unknown category, and danger episodes split at EVERY
death with right-censoring counted (episodes whose last row + 20 s runs past the window end)."""
import json, collections, os, re, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
deaths = json.load(open(D + 'deaths7d.json'))
DG = json.load(open(D + 'danger7d.json'))
C = collections.Counter
CATS = [('lava', r'tried to swim in lava(?! after)'), ('lava after a fall', r'tried to swim in lava after falling'),
        ('magma', r'discovered the floor was lava'), ('burned', r'burn|walked into fire|went up in flames|crisp'),
        ('drowned', r'^drowned'), ('fall', r'fell from a high place|hit the ground'), ('stalagmite', r'stalagmite'),
        ('stalactite', r'stalactite'), ('suffocated', r'suffocated'), ('doomed to fall', r'doomed to fall')]
tally = C()
for d in deaths:
    msg = d['skill']['detail'].split(';')[0].split('|')[0].strip()
    cat = next((n for n, rx in CATS if re.search(rx, msg)), 'UNKNOWN: ' + msg[:40])
    tally[(d['skill'].get('fail_class'), cat)] += 1
print('death-message tally (fail_class, category):')
for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
    print(f'  {v:4} {k}')


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()


END = dt.datetime(2026, 10, 23, 14, tzinfo=dt.timezone.utc).timestamp()
alld = collections.defaultdict(list); lava = collections.defaultdict(list)
for d in deaths:
    alld[d['bot']['name']].append(P(d['@timestamp']))
    if d['skill'].get('fail_class') == 'fire':
        lava[d['bot']['name']].append(P(d['@timestamp']))
eps = []; cur = None
for r in sorted(DG['_reflex_danger_block'], key=lambda r: (r['bot']['name'], r['@timestamp'])):
    b = r['bot']['name']; t = P(r['@timestamp'])
    if cur and cur['bot'] == b and t - cur['last'] <= 30 and not any(cur['last'] < ft <= t for ft in alld[b]):
        cur['last'] = t; continue
    cur = {'bot': b, 'first': t, 'last': t, 'd0': r['skill'].get('detail')}
    eps.append(cur)
t2 = C(); cens = 0
for e in eps:
    if e['last'] + 20 > END:
        cens += 1; continue
    k = ('feet in a DANGER block' if e['d0'] in ('lava', 'magma_block', 'fire', 'soul_fire', 'campfire') else
         'feet bubble_column' if e['d0'] == 'bubble_column' else
         'feet air/cave_air' if e['d0'] in ('air', 'cave_air') else 'UNRECOGNISED ' + str(e['d0']))
    t2[(k, any(e['first'] <= ft <= e['last'] + 20 for ft in lava[e['bot']]))] += 1
print('danger episodes split at every death; right-censored (last row + 20 s past the window end) dropped:', cens)
for k, v in sorted(t2.items()):
    print(f'  {v:4} {k}')
