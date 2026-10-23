#!/usr/bin/env python3
"""Evidence for valuescore.py's weights and intake kinds (read-only ES). Run once on 10.0.0.31; output pasted into
docs/reports/valuescore-2026-10-23.md.

    nice -n 19 python3 scripts/host/valuescore_evidence.py [since] [until]     default 2026-10-08 .. 2026-10-11

(1) Which row kinds carry an inventory_delta, and how much each one GAINS by item. A gain is world intake only for
    kinds that take from the world (gather, mine, explore and walking pickups). Transfer kinds (withdraw, toolkit,
    smelt, craft and so on) move or transform items that are already counted.
(2) Bot-time effort per item: for intake rows of gather and mine, the summed duration of rows that gained the item,
    divided by the units gained. A row that gains several items counts toward each (an upper bound per item).
"""
import sys, os, json
from collections import defaultdict, Counter
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

s = sys.argv[1] if len(sys.argv) > 1 else '2026-10-08'
u = sys.argv[2] if len(sys.argv) > 2 else '2026-10-11'
ev = EsEvents.load('skill', since=f'{s}T00:00:00Z', until=f'{u}T00:00:00Z')
q = ev._query()
q['bool']['filter'].append({'exists': {'field': 'skill.inventory_delta'}})
r = ev._search({'size': 0, 'query': q, 'aggs': {'k': {'terms': {'field': 'skill.name', 'size': 500}}}})
kinds = {b['key']: b['doc_count'] for b in ev._complete(r['aggregations']['k'], 'kinds')['buckets']}
days = (EsEvents.load('skill', since=f'{s}T00:00:00Z', until=f'{u}T00:00:00Z').until -
        EsEvents.load('skill', since=f'{s}T00:00:00Z', until=f'{u}T00:00:00Z').since).days
print(f'window {s} .. {u} ({days} days); docs with inventory_delta by kind: {sum(kinds.values()):,}')
gain = defaultdict(Counter)
effort = defaultdict(float)
units = Counter()
for k, n in sorted(kinds.items(), key=lambda x: -x[1]):
    if n < 50:
        continue
    for row in ev.rows(k, fields=['skill.inventory_delta', 'skill.duration_ms', 'skill.status'], max_rows=600_000):
        sk = row.get('skill') or {}
        inv = sk.get('inventory_delta') or {}
        for it, v in inv.items():
            if isinstance(v, (int, float)) and v > 0:
                gain[k][it] += v
                if k in ('gather', 'mine'):
                    effort[it] += (sk.get('duration_ms') or 0) / 60000
                    units[it] += v
for k in sorted(gain, key=lambda k: -sum(gain[k].values())):
    tot = sum(gain[k].values())
    print(f'  {k:18s} rows {kinds[k]:8,d}  items gained/day {tot / days:9.0f}  top: ' +
          ', '.join(f'{i} {v / days:.0f}' for i, v in gain[k].most_common(8)))
print('\nbot-minutes per unit (gather + mine rows that gained it; upper bound when a row gains several items):')
for it, n in sorted(units.items(), key=lambda x: -x[1])[:45]:
    print(f'  {it:24s} units/day {n / days:9.0f}  bot-min/unit {effort[it] / n:7.3f}')
