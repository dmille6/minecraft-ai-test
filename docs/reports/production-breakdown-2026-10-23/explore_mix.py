"""Exploratory mix tables for two days (default 10-09 and 10-22) from out/rows. No ES access."""
import sys, os, gzip, json, re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
days = sys.argv[1:] or ['2026-10-09', '2026-10-22']


def load(day):
    with gzip.open(os.path.join(HERE, 'out', 'rows', f'{day}.jsonl.gz'), 'rt') as f:
        for l in f:
            yield json.loads(l)


def norm(d):
    d = re.sub(r'-?\d+(\.\d+)?', 'N', d or '')
    return d[:90]


for day in days:
    rows = list(load(day))
    print('=' * 30, day, len(rows))
    by = defaultdict(list)
    for r in rows:
        by[r['k']].append(r)
    g = by['gather']
    print('-- gather by block (top 25): attempts, ok, items+')
    c = defaultdict(lambda: [0, 0, 0, 0.0])
    for r in g:
        b = r['a'].get('block', '?')
        c[b][0] += 1
        if r['s'] == 'success':
            c[b][1] += 1
        c[b][2] += sum(v for v in (r['inv'] or {}).values() if v > 0)
        c[b][3] += (r['ms'] or 0) / 3.6e6
    for b, v in sorted(c.items(), key=lambda x: -x[1][0])[:25]:
        print(f'   {b:24s} {v[0]:6d} {v[1]:6d} {v[2]:7d} {v[3]:6.1f}h')
    print('-- gather fail_class / status')
    print('  ', Counter((r['s'], r['fc']) for r in g).most_common(20))
    print('-- gather failed detail (top 20)')
    for k, n in Counter(norm(r['d']) for r in g if r['s'] != 'success').most_common(20):
        print(f'   {n:6d} {k}')
    print('-- gather triggers', Counter(r['tr'] for r in g).most_common(12))
    m = by['mine']
    print('-- mine status', Counter((r['s'], r['fc']) for r in m).most_common(10))
    print('-- mine detail (top 15)')
    for k, n in Counter(norm(r['d']) for r in m).most_common(15):
        print(f'   {n:6d} {k}')
    inv = Counter()
    for r in m:
        for k, v in (r['inv'] or {}).items():
            if v > 0:
                inv[k] += v
    print('-- mine items+', inv.most_common(15))
    print('-- mine args y hist', Counter((r['a'].get('y', 999) // 16) * 16 for r in m if isinstance(r['a'].get('y'), (int, float))).most_common(12))
    cr = by['craft']
    c = defaultdict(Counter)
    for r in cr:
        c[r['a'].get('item', '?')][r['s']] += 1
    print('-- craft by item (top 25)')
    for it, v in sorted(c.items(), key=lambda x: -sum(x[1].values()))[:25]:
        print(f'   {it:24s} {dict(v)}')
    print('-- craft fail detail (top 12)')
    for k, n in Counter(norm(r['d']) for r in cr if r['s'] != 'success').most_common(12):
        print(f'   {n:6d} {k}')
    print('-- _redundant_craft', len(by['_redundant_craft']))
    td = by['town_deposit']
    print('-- town_deposit detail (top 12)')
    for k, n in Counter((r['s'], norm(r['d'])[:70]) for r in td).most_common(12):
        print(f'   {n:6d} {k}')
    print('-- town_deposit triggers', Counter(r['tr'] for r in td).most_common(8))
    for k in ('explore', 'goto', 'home', 'surface'):
        rs = by[k]
        tr = defaultdict(lambda: [0, 0.0])
        for r in rs:
            t = r['tr'] or '?'
            t = t if not t.startswith('llm:') else 'llm:*'
            tr[t][0] += 1
            tr[t][1] += (r['ms'] or 0) / 3.6e6
        print(f'-- {k} by trigger', sorted(((t, v[0], round(v[1], 1)) for t, v in tr.items()), key=lambda x: -x[2])[:10])
    print('-- explore detail (top 10)')
    for k, n in Counter((r['s'], norm(r['d'])[:70]) for r in by['explore']).most_common(10):
        print(f'   {n:6d} {k}')
    print('-- explore args', Counter(json.dumps(r['a'], sort_keys=True)[:60] for r in by['explore']).most_common(6))
