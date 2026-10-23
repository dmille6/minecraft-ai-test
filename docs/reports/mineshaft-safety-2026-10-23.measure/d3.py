"""Classify each lava death: was the lava SEEN before (and how long), did the bot fall, was it digging, explore-toward-known, milestone."""
import json, collections, re, os, sys, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
sys.path.insert(0, D)
from d1 import cls
X = json.load(open(D + 'deathctx.json'))
C = collections.Counter


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00'))


SEEN = ('_lava_corridor', '_explore_blind_step_refused', '_lava_adjacent_no_retreat')
tab = collections.defaultdict(C)
sites = C()
per = []
for x in X:
    d = x['death']; c = cls(d)
    if c not in ('lava', 'lava-fall', 'magma'):
        continue
    t = P(d['@timestamp'])
    first_seen = None; dig30 = False; etk = False; danger_lava = None; skills60 = []
    for r in x['ctx']:
        dtt = (t - P(r['@timestamp'])).total_seconds()
        if dtt < 0:
            continue
        s = r.get('skill', {}); nm = s.get('name') or ''; det = s.get('detail') or ''
        if (nm in SEEN and 'lava' in det) or (nm == '_reflex_danger_block' and det.startswith('lava')):
            if dtt > 3:   # seen more than 3 s before death (not the death itself)
                first_seen = max(first_seen or 0, dtt)
        if nm == '_explore_toward_known' and dtt <= 90:
            etk = True
        if not nm.startswith('_') and dtt <= 60:
            skills60.append(nm)
            # skill rows are stamped at START: a mine/gather row that started <= 60 s before death
            if nm in ('mine', 'gather') and dtt - (s.get('duration_ms') or 0) / 1000 <= 30:
                dig30 = True
        if nm in ('_mine_dig', '_dig_approach', '_mine_stair_step_failed') and dtt <= 30:
            dig30 = True
    fell = 'after falling' in d['skill']['detail']
    y = d['bot']['pos']['y']
    ms = re.sub(r'#\d+', '', x['milestone'] or '?')
    if first_seen is None:
        seen = 'not seen'
    elif first_seen >= 10:
        seen = 'seen >=10s before'
    else:
        seen = 'seen 3-10s before'
    tab['seen'][seen] += 1
    tab['fell'][fell] += 1
    tab['dig30'][dig30] += 1
    tab['etk90'][etk] += 1
    tab['milestone'][ms] += 1
    tab['surface/under'][('surface y>=60' if y >= 60 else 'cave 0..59' if y >= 0 else 'deep <0')] += 1
    tab['seen x depth'][(seen, 'surface y>=60' if y >= 60 else 'cave 0..59' if y >= 0 else 'deep <0')] += 1
    tab['pooltype'][('isolated' if 'isolated' in d['exp']['pool'] else 'shared')] += 1
    sites[(d['exp']['pool'].replace('self-', '')[:10], round(d['bot']['pos']['x'] / 8), round(d['bot']['pos']['y'] / 8), round(d['bot']['pos']['z'] / 8))] += 1
    per.append((d['@timestamp'], d['bot']['name'], c, y, seen, fell, dig30, etk, ms))
for k, v in tab.items():
    print(k, v.most_common())
# coordinate hot spots irrespective of pool (do worlds share a seed?)
xyz = C((round(p[3]),) for p in per)
hs = C()
for x in X:
    d = x['death']
    if cls(d) in ('lava', 'lava-fall', 'magma'):
        hs[(round(d['bot']['pos']['x'] / 12), round(d['bot']['pos']['y'] / 12), round(d['bot']['pos']['z'] / 12))] += 1
print('hotspots (12-block cells, all pools):', [(k[0] * 12, k[1] * 12, k[2] * 12, n) for k, n in hs.most_common(12)])
print('digging within 30s:', [p for p in per if p[6]])
