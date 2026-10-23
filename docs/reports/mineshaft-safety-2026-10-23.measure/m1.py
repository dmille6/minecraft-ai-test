"""mine calls (7 d): requested target y, end y, outcome by requested depth; exit-reserve refusals by depth and what they lacked."""
import json, collections, os, re
D = os.path.dirname(os.path.abspath(__file__)) + '/'
rows = json.load(open(D + 'mine7d.json'))
C = collections.Counter


def b16(y):
    if y is None:
        return 'none'
    y = float(y)
    return f'{int(y // 16 * 16)}..{int(y // 16 * 16) + 15}'


req = C(); endy = C(); fc_by_req = collections.defaultdict(C)
for r in rows:
    a = r['skill'].get('args') or {}
    ty = a.get('y')
    req[b16(ty)] += 1
    endy[b16(r['bot']['pos']['y'])] += 1
    fc_by_req[b16(ty)][r['skill'].get('fail_class') or r['skill']['status']] += 1
print('mine calls', len(rows))
print('requested target y:', sorted(req.items(), key=lambda kv: kv[0]))
print('END position y of mine rows:', sorted(endy.items()))
for k in sorted(fc_by_req):
    print('  req', k, fc_by_req[k].most_common(6))
# exit_capability_reserve details
ex = [r for r in rows if r['skill'].get('fail_class') == 'exit_capability_reserve']
print('\nexit_capability_reserve', len(ex), 'by end y:', sorted(C(b16(r['bot']['pos']['y']) for r in ex).items()))
kinds = C()
for r in ex:
    d = r['skill'].get('detail') or ''
    kinds[re.sub(r'\d+', 'N', d)[:110]] += 1
for k, v in kinds.most_common(12):
    print(f'  {v:5} {k}')
hz = [r for r in rows if r['skill'].get('fail_class') == 'hazard_interrupt']
hk = C()
for r in hz:
    d = r['skill'].get('detail') or ''
    hk[re.sub(r'-?\d+', 'N', d)[:100]] += 1
print('\nhazard_interrupt', len(hz), 'by end y:', sorted(C(b16(r['bot']['pos']['y']) for r in hz).items()))
for k, v in hk.most_common(12):
    print(f'  {v:5} {k}')
# inventory at refusal: cobble-class scaffold and pickaxe uses
sc = []
for r in ex:
    inv = r['bot'].get('inventory') or {}
    sc.append(sum(v for k, v in inv.items() if k in ('cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff')))
sc.sort()
if sc:
    print('scaffold-class blocks held at refusal p10/p50/p90:', sc[len(sc) // 10], sc[len(sc) // 2], sc[9 * len(sc) // 10])
