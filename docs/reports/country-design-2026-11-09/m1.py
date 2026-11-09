#!/usr/bin/env python3
# READ-ONLY upkeep/countryside measure, showcase. usage: m1.py HOURS
import sys, re, datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/showcase/trip')
from lib.telemetry import Events
H = float(sys.argv[1]) if len(sys.argv) > 1 else 12
now = dt.datetime.now(dt.timezone.utc); T0 = now - dt.timedelta(hours=H)
ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=T0)
rows = ev.rows
kv = lambda s: dict(m.groups() for m in re.finditer(r'(\w+)=(\S+)', s or ''))
name = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('name') or r.get('name') or '').lstrip('_')
bot = lambda r: (r.get('bot') or {}).get('name') or '?'
bots = sorted({bot(r) for r in rows})
print('WINDOW %.1f h rows %d bots %d' % (H, len(rows), len(bots)))
K = Counter(name(r) for r in rows)
print('KINDS', K.most_common(60))
bv = [r for r in rows if name(r) == 'build_visit']
print('VISITS', len(bv), Counter(kv(r.get('detail')).get('project') for r in bv).most_common())
for p in sorted({kv(r.get('detail')).get('project') for r in bv}, key=str):
    v = [r for r in bv if kv(r.get('detail')).get('project') == p]
    print('  %-12s stops %s rep %s' % (p, dict(Counter(kv(r.get('detail')).get('stop') for r in v)), dict(Counter(kv(r.get('detail')).get('repair') for r in v))))
b = [r for r in rows if name(r) == 'build']
print('BUILD ops by project', {p: dict(Counter(kv(r.get('detail')).get('op') for r in b if kv(r.get('detail')).get('project') == p)) for p in sorted({kv(r.get('detail')).get('project') for r in b}, key=str)})
for k in ('keeper', 'land_plan', 'shop_skip', 'forest', 'gksweep', 'stations', 'decor', 'dress', 'cropfarm', 'workboard', 'shop_pick', 'idle_work', 'patrol'):
    rr = [r for r in rows if name(r) == k]
    if rr: print('ROW', k, len(rr), Counter(kv(r.get('detail')).get('op') or kv(r.get('detail')).get('why') for r in rr).most_common(12), '|', (rr[-1].get('detail') or '')[:220])
