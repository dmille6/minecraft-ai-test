#!/usr/bin/env python3
"""ceilescape-01 population (read-only ES): which bots' escape ramps stop on an unaffordable ceiling dig, and where.

    nice -n 19 python3 ceilescape_population.py [days]        default 7

Per bot: `_entombed_ramp_cut` and `_marooned_ramp_cut` failures whose detail says "ceiling dig failed ... dig exceeded"
(the timeout signature), the other ramp stops, the bot's position range (bot.pos stats), the newest snapshot's pickaxes,
and how many 10-minute bins it was stationary (x/z range < 1 block). Positive control: all ramp rows by status.
"""
import sys, re, collections, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

days = float(sys.argv[1]) if len(sys.argv) > 1 else 7
ev = EsEvents.load('skill', since_minutes=days * 1440 - 10)
print('window', ev.since, '->', ev.until, '| ramp rows by status:')
for k in ('entombed_ramp_cut', '_entombed_ramp_cut', 'marooned_ramp_cut', '_marooned_ramp_cut'):
    if ev.names().get(k):
        print('  ', k, dict(ev.terms('skill.status', kind=k)))
kinds = [k for k in ('_entombed_ramp_cut', '_marooned_ramp_cut', 'entombed_ramp_cut', 'marooned_ramp_cut') if ev.names().get(k)]
per = collections.defaultdict(collections.Counter)
for k in kinds:
    for r in ev.rows(k, fields=['bot.name', 'skill.detail', 'skill.status'], max_rows=300_000):
        d = (r.get('skill') or {}).get('detail') or ''
        m = re.search(r'stopped because (.*)$', d)
        why = m.group(1) if m else d
        why = re.sub(r'\d+', 'N', why)[:70]
        per[(r.get('bot') or {}).get('name')][('CEILING-TIMEOUT ' if 'ceiling dig failed' in why and 'exceeded' in why else '') + f'[{k}] ' + why] += 1
tops = sorted(per, key=lambda b: -sum(n for w, n in per[b].items() if w.startswith('CEILING-TIMEOUT')))
for b in tops[:8]:
    ct = sum(n for w, n in per[b].items() if w.startswith('CEILING-TIMEOUT'))
    if not ct:
        break
    e = EsEvents.load('skill', since_minutes=days * 1440 - 10, bots=[b])
    q = e._query(); q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
    st = e._search({'size': 0, 'query': q, 'aggs': {a: {'stats': {'field': f'bot.pos.{a}'}} for a in 'xyz'}})['aggregations']
    snap = e.latest(require='bot.pos.x', fields=['bot.tools', 'bot.pos', 'exp.pool'])
    s = snap.get(b) or {}
    picks = {k: [t.get('max', 0) - t.get('used', 0) for t in v] for k, v in ((s.get('bot') or {}).get('tools') or {}).items() if k.endswith('pickaxe')}
    print(f'\n{b}: ceiling timeouts {ct} of {sum(per[b].values())} ramp stops; pos x {st["x"]["min"]:.1f}..{st["x"]["max"]:.1f} '
          f'y {st["y"]["min"]:.1f}..{st["y"]["max"]:.1f} z {st["z"]["min"]:.1f}..{st["z"]["max"]:.1f}; newest pos '
          f'{(s.get("bot") or {}).get("pos")}; pickaxe uses left {picks}')
    for w, n in per[b].most_common(6):
        print(f'     {n:5d}  {w}')
