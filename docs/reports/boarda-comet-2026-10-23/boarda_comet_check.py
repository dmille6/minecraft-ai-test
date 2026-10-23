#!/usr/bin/env python3
"""Spot-check of the board-a trap investigation (docs/reports/boarda-comet-trap-2026-10-23.md). Read-only ES.
Per bot in board-a: _water_no_air_route rows 10-08..10-23, and board-a-Comet's position range per day."""
import sys
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

ev = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z', pools=['board-a'])
print('_water_no_air_route rows by bot (board-a):', dict(ev.by_bot('_water_no_air_route')))
print('positive control, all board-a docs by bot:', dict(ev.by_bot()))
for d in range(8, 24):
    s = f'2026-10-{d:02d}T00:00:00Z'
    u = f'2026-10-{d + 1:02d}T00:00:00Z' if d < 23 else '2026-10-23T21:00:00Z'
    e = EsEvents.load('skill', since=s, until=u, bots=['board-a-Comet'])
    q = e._query()
    q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
    r = e._search({'size': 0, 'query': q, 'aggs': {a: {'stats': {'field': f'bot.pos.{a}'}} for a in 'xyz'}})['aggregations']
    print(f'10-{d:02d} rows {r["x"]["count"]:6d}  x {r["x"]["min"]:.1f}..{r["x"]["max"]:.1f}  y {r["y"]["min"]:.1f}..{r["y"]["max"]:.1f}'
          f'  z {r["z"]["min"]:.1f}..{r["z"]["max"]:.1f}')
