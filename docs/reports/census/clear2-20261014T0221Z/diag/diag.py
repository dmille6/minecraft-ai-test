# READ-ONLY diagnosis: what did the bots of four towns do since the 02:22:44Z restart? (Events normalised rows; raw = the log row)
import sys, math, collections
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events
ev = Events.load(since_minutes=145)
rows = [r for r in ev.rows if (r['raw'].get('@timestamp') or '') >= '2026-10-14T02:22:44Z']
print('rows since restart', len(rows), 'of', len(ev.rows), 'bots', len({r['raw']['bot']['name'] for r in rows}))
HOME = {'hive-a': (355, 73, 147), 'hive-c': (-68, 68, -68), 'placebo-a': (249, 75, -144), 'placebo-b': (282, 65, -388), 'board-c': (355, 73, 147)}
DEP = ('deposit', 'withdraw', 'bank', 'chest', 'store', 'stock')
for w, h in HOME.items():
    rs = [r for r in rows if r['raw']['bot']['name'].startswith(w + '-')]
    kinds = collections.Counter(r['name'] for r in rs)
    dep = [r for r in rs if any(k in (r['name'] or '') for k in DEP)]
    out = collections.Counter((r['name'], r['status']) for r in dep)
    near = collections.Counter(); last = {}
    for r in rs:
        p = r['raw']['bot'].get('pos') or {}
        if 'x' in p:
            d = math.hypot(p['x'] - h[0], p['z'] - h[2]); near['<=48' if d <= 48 else '>48'] += 1
            last[r['raw']['bot']['name']] = round(d)
    print('\n==', w, 'rows', len(rs), 'bots', len({r['raw']['bot']['name'] for r in rs}), 'pos rows near home', dict(near), 'last dist', last)
    print('  top kinds', kinds.most_common(10))
    print('  deposit-ish', dict(out))
    for r in dep[-5:]:
        print('   ', r['raw']['@timestamp'][11:19], r['raw']['bot']['name'], r['name'], r['status'], (r['detail'] or '')[:170])
