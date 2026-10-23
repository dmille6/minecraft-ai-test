import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

# onset on 09-28
ev = EsEvents.load('skill', since='2026-09-27T12:00:00Z', until='2026-09-29T00:00:00Z', bots=['board-a-Comet'])
q = ev._query(); q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
body = {'size': 0, 'query': q, 'aggs': {'d': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '30m', 'min_doc_count': 1},
        'aggs': {k: {'percentiles': {'field': 'bot.pos.' + k, 'percents': [0, 50, 100]}} for k in 'xyz'}}}}
r = ev._search(body)
for b in r['aggregations']['d']['buckets']:
    s = ' | '.join(k + ' ' + '/'.join(str(round(v, 1)) for v in b[k]['values'].values()) for k in 'xyz')
    print(b['key_as_string'][11:16], b['key_as_string'][:10], b['doc_count'], s)
