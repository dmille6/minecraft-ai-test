"""Daily fleet table from out/daily_skill_aggs_*.json: reproduces the owner's decline table
(positive control) and prints per-world daily series for the four production metrics, plus
skill bot-time shares. No ES access; reads the aggregation file only."""
import json, sys, glob, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
f = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'daily_skill_aggs_2026-10-08_2026-10-23.json')
D = json.load(open(f))
days = sorted(D)


def get(day, kind, status=None, pools=None):
    n = ms = 0
    for w, p in D[day]['pools'].items():
        if pools and w not in pools:
            continue
        for st, (c, dur) in p['kinds'].get(kind, {}).items():
            if status is None or st == status:
                n += c
                ms += dur
    return n, ms


print('day         bot-h   gather_ok/bh  mine_ok   craft_ok  town_dep ok/all   deposit ok/all  explore_ok  goto_ok')
for d in days:
    bh = D[d]['coverage_bot_hours']
    g = get(d, 'gather', 'success')[0]
    m = get(d, 'mine', 'success')[0]
    c = get(d, 'craft', 'success')[0]
    td, tda = get(d, 'town_deposit', 'success')[0], get(d, 'town_deposit')[0]
    dp, dpa = get(d, 'deposit', 'success')[0], get(d, 'deposit')[0]
    e = get(d, 'explore', 'success')[0]
    go = get(d, 'goto', 'success')[0]
    print(f'{d}  {bh:7.1f}  {g / bh:6.2f} ({g:6d})  {m:7d}  {c:7d}   {td:5d}/{tda:5d}     {dp:5d}/{dpa:5d}   {e:7d}  {go:7d}')

print('\nskill bot-time (hours/day, all statuses), top kinds')
kinds = defaultdict(float)
for d in days:
    for w, p in D[d]['pools'].items():
        for k, sts in p['kinds'].items():
            kinds[k] += sum(v[1] for v in sts.values())
top = [k for k, _ in sorted(kinds.items(), key=lambda x: -x[1])[:16]]
print('day        ' + ' '.join(f'{k[:9]:>9s}' for k in top) + '   sum   bot-h')
for d in days:
    row = [get(d, k)[1] / 3.6e6 for k in top]
    tot = sum(sum(v[1] for v in sts.values()) for p in D[d]['pools'].values() for sts in p['kinds'].values()) / 3.6e6
    print(d + ' ' + ' '.join(f'{x:9.1f}' for x in row) + f' {tot:6.0f} {D[d]["coverage_bot_hours"]:6.0f}')

print('\nper world: gather ok per bot-h by day')
worlds = sorted({w for d in days for w in D[d]['pools']})
print('world       ' + ' '.join(d[5:] for d in days))
for metric, kind in (('gather_ok/bh', 'gather'), ('mine_ok/bh', 'mine'), ('craft_ok/bh', 'craft')):
    print('--', metric)
    for w in worlds:
        vals = []
        for d in days:
            bh = D[d]['pool_bot_hours'].get(w) or 0
            n = get(d, kind, 'success', [w])[0]
            vals.append(f'{n / bh:5.2f}' if bh else '  -  ')
        print(f'{w:11s} ' + ' '.join(vals))
