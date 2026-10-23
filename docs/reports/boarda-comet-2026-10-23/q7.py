import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

ev7 = EsEvents.load('skill', since='2026-10-16T21:00:00Z', until='2026-10-23T21:00:00Z')
nst = ev7.by_bot('gather', fail_class='no_safe_target')
tot = sum(nst.values())
top = sorted(nst.items(), key=lambda x: -x[1])[:6]
print('7d gather no_safe_target total', tot, 'top', top, 'Comet per day', round(nst.get('board-a-Comet', 0) / 7, 1))
print('7d gather fail_class terms (positive control)', dict(list(ev7.terms('skill.fail_class', kind='gather').items())[:8]))
# daily Comet no_safe_target
evc = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('Comet nst per day', dict(evc.histogram('gather', interval='1d', fail_class='no_safe_target')))
# poolescape fleetwide since deploy
evp = EsEvents.load('skill', since='2026-10-23T01:40:00Z', until='2026-10-23T21:00:00Z')
print('fleet _poolescape_start by bot', dict(evp.by_bot('_poolescape_start', allow_zero=True)), ' _poolescape_mode bots', len(evp.by_bot('_poolescape_mode')))
print('fleet _poolescape by bot', dict(evp.by_bot('_poolescape', allow_zero=True)))
evcp = EsEvents.load('skill', since='2026-10-23T01:40:00Z', until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('Comet _poolescape_start', evcp.count('_poolescape_start', allow_zero=True), ' Comet _poolescape_mode', evcp.count('_poolescape_mode'))
# marooned: fleet 24h vs Comet
ev24 = EsEvents.load('skill', since='2026-10-22T21:00:00Z', until='2026-10-23T21:00:00Z')
print('fleet 24h _marooned', ev24.count('_marooned'), 'bots', len(ev24.by_bot('_marooned')))
evc24 = EsEvents.load('skill', since='2026-10-22T21:00:00Z', until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('Comet 24h _marooned', evc24.count('_marooned', allow_zero=True), '_entombed', evc24.count('_entombed'), '_climb_flood_refused', evc24.count('_climb_flood_refused', allow_zero=True), '_water_float', evc24.count('_water_float', allow_zero=True))
print('Comet 15d _marooned', evc.count('_marooned', allow_zero=True), '_marooned_needs_pickaxe', evc.count('_marooned_needs_pickaxe', allow_zero=True), '_escape_lattice', evc.count('_escape_lattice', allow_zero=True))
# other board-a bots: are they mobile? (denominator)
eva = EsEvents.load('skill', since='2026-10-22T21:00:00Z', until='2026-10-23T21:00:00Z', pools=['board-a'])
q = eva._query(); q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
r = eva._search({'size': 0, 'query': q, 'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 20}, 'aggs': {k: {'percentiles': {'field': 'bot.pos.' + k, 'percents': [5, 95]}} for k in 'xyz'}}}})
for b in r['aggregations']['b']['buckets']:
    print(' ', b['key'], b['doc_count'], ' '.join(k + ' ' + '/'.join(str(round(v)) for v in b[k]['values'].values()) for k in 'xyz'))
# home-arrival / town deposits by Comet ever since 09-28
ev0 = EsEvents.load('skill', since='2026-09-28T04:00:00Z', until='2026-10-07T00:00:00Z', bots=['board-a-Comet'])
q = ev0._query(); q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
q['bool']['must_not'] = [{'range': {'bot.pos.x': {'gte': 358, 'lte': 361}}}]
print('Comet rows 09-28 04Z..10-07 with x outside 358..361:', ev0._search({'size': 3, 'query': q, 'sort': [{'@timestamp': 'asc'}], '_source': ['@timestamp', 'bot.pos', 'skill.name']})['hits'])
