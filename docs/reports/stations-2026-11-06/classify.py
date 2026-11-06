import json, collections
T = json.load(open('towns.json'))
tot = collections.Counter()
print('pool chunks/miss | tables(<=32,<=72,<=136) furnaces(..) | in-record | workshop | lit/holding | strays<=72 strays<=136')
for line in open('scan-out.txt'):
    p, js = line.split(' ', 1); d = json.loads(js); t = T[p]; h = t['home']
    ws = {s[2] for s in t['stations']}
    rec = t['records']
    def inbox(at, b):
        x, y, z = at
        if len(b) == 4: return b[0] <= x <= b[2] and b[1] <= z <= b[3]
        if len(b) == 6: return b[0] <= x <= b[3] and b[1] <= y <= b[4] and b[2] <= z <= b[5]
        return False
    band = lambda a: 0 if max(abs(a[0]-h['x']), abs(a[2]-h['z'])) <= 32 else 1 if max(abs(a[0]-h['x']), abs(a[2]-h['z'])) <= 72 else 2
    c = {n: [0, 0, 0] for n in ('crafting_table', 'furnace')}
    inrec = wsn = busy = zone = 0; stray = [0, 0, 0]; deep = 0
    for f in d['found']:
        k = '%d,%d,%d' % tuple(f['at']); b = band(f['at']); c[f['name']][b] += 1
        if k in ws: wsn += 1; continue
        if k in rec: inrec += 1; continue
        if any(inbox(f['at'], z[2]) for z in t['zones'] if z[2]): zone += 1; continue
        if f['name'] == 'furnace' and (f['lit'] or (f['items'] or 0) > 0): busy += 1; continue
        if f['at'][1] < h['y'] - 20: deep += 1; continue
        stray[b] += 1
    print(p, d['chunks'], d['missing'], '|', c['crafting_table'], c['furnace'], '| rec', inrec, '| ws', wsn, '| zone', zone, '| busy', busy, '| deep', deep, '| strays', stray)
    tot['tables'] += sum(c['crafting_table']); tot['furn'] += sum(c['furnace']); tot['stray'] += sum(stray); tot['stray72'] += stray[0] + stray[1]; tot['busy'] += busy; tot['rec'] += inrec; tot['ws'] += wsn; tot['deep'] += deep; tot['zone'] += zone
print(dict(tot))
