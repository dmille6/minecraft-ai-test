import json, collections, re, os, sys, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
sys.path.insert(0, D)
from d1 import cls, run
X = json.load(open(D + 'deathctx.json'))
C = collections.Counter
WANT = sys.argv[1].split(',') if len(sys.argv) > 1 else ['lava', 'lava-fall', 'magma']
VERB = '-v' in sys.argv


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00'))


agg = collections.defaultdict(C)
for x in X:
    d = x['death']; c = cls(d)
    if c not in WANT:
        continue
    t = P(d['@timestamp'])
    rows = [r for r in x['ctx'] if r.get('skill', {}).get('name') != '_death']
    # last non-reflex skill row ending before death, and reflex kinds in last 60 s
    kinds60 = C(); last_skill = None; ys = []
    for r in rows:
        dtt = (t - P(r['@timestamp'])).total_seconds()
        nm = r.get('skill', {}).get('name')
        if r.get('bot', {}).get('pos'):
            ys.append((dtt, r['bot']['pos']['y']))
        if 0 <= dtt <= 60 and nm and nm.startswith('_'):
            kinds60[nm] += 1
        if nm and not nm.startswith('_') and dtt >= -1:
            last_skill = (nm, r['skill'].get('status'), round(dtt), (r['skill'].get('detail') or '')[:160], r.get('trigger'))
    for k in kinds60:
        agg['reflex60'][k] += 1
    agg['milestone'][x['milestone']] += 1
    agg['lastskill'][(last_skill[0], last_skill[1]) if last_skill else None] += 1
    ystart = max((y for dtt, y in ys if 50 <= dtt <= 70), default=None)
    agg['y_drop_60s'][None if ystart is None else ('fell>=4' if ystart - d['bot']['pos']['y'] >= 4 else 'level')] += 1
    if VERB:
        print('=' * 110)
        print(d['@timestamp'], d['bot']['name'], c, 'y=', d['bot']['pos']['y'], 'ms=', x['milestone'], '|', d['skill']['detail'][:230])
        NOISE = {'_affordance_scan', '_reach_probe', '_pickups', '_pickup_skipped', '_dig_town_sum', '_inventory_mutation',
                 '_chunks_evicted', '_scaffold_pick', '_path_reset', '_path_failure_shapes', '_rule_contradicted'}
        lines = []; prev = None
        for r in rows:
            dtt = (t - P(r['@timestamp'])).total_seconds()
            if dtt > float(os.environ.get('WIN', 45)):
                continue
            s = r.get('skill', {})
            if s.get('name') in NOISE:
                continue
            p = r.get('bot', {}).get('pos') or {}
            key = (s.get('name'), s.get('status'))
            if key == prev:
                lines[-1][1] += 1
                continue
            prev = key
            lines.append([f"  -{dtt:5.1f}s {r.get('trigger','')[:20]:20} {s.get('name',''):24} {str(s.get('status','')):8} y={p.get('y')} hp={r.get('bot',{}).get('health')} {(s.get('detail') or '')[:140]}", 1])
        for l, n in lines[-int(os.environ.get('N', 14)):]:
            print(l + (f'  (x{n})' if n > 1 else ''))
for k, v in agg.items():
    print(k, v.most_common(25))
