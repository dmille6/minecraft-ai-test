import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

def posagg(ev, interval):
    q = ev._query()
    q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
    body = {'size': 0, 'query': q, 'aggs': {'d': {'date_histogram': {'field': '@timestamp', 'fixed_interval': interval, 'min_doc_count': 1},
            'aggs': {k: {'percentiles': {'field': 'bot.pos.' + k, 'percents': [0, 5, 50, 95, 100]}} for k in 'xyz'}}}}
    r = ev._search(body)
    for b in r['aggregations']['d']['buckets']:
        s = ' | '.join(k + ' ' + '/'.join(str(round(v, 1)) for v in b[k]['values'].values()) for k in 'xyz')
        print(b['key_as_string'][:13], b['doc_count'], s)

ev = EsEvents.load('skill', since='2026-10-08T00:00:00Z', until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
print('pos 12h buckets: p0/p5/p50/p95/p100')
posagg(ev, '12h')
ev0 = EsEvents.load('skill', since='2026-09-01T00:00:00Z', until='2026-10-07T00:00:00Z', bots=['board-a-Comet'])
print('pre docs', ev0.total())
try:
    print('pre wnar', dict(ev0.histogram('_water_no_air_route_ended', interval='1d', allow_zero=True)))
except Exception as e:
    print('ERR', e)
posagg(ev0, '1d')
