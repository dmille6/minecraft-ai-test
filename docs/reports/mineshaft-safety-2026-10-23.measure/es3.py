"""Depth exposure (time-weighted), entombed rows by depth, interrupted skills, and the entombed row stream."""
import sys, json, datetime as dt, collections
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
UNTIL = dt.datetime(2026, 10, 23, 14, 0, tzinfo=dt.timezone.utc)
O = {}


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


# 1. time-weighted depth: per bot per 10-min bucket, the average and min y of rows carrying a position.
cells = collections.Counter(); cells_min = collections.Counter(); nb = 0
for day in range(7):
    lo = UNTIL - dt.timedelta(days=7 - day); hi = lo + dt.timedelta(days=1)
    ev = EsEvents.load('skill', since=iso(lo), until=iso(hi))
    q = ev._query()
    q['bool']['filter'].append({'exists': {'field': 'bot.pos.y'}})
    body = {'size': 0, 'query': q, 'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 200}, 'aggs': {
        'h': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '10m', 'min_doc_count': 1},
              'aggs': {'y': {'avg': {'field': 'bot.pos.y'}}, 'ymin': {'min': {'field': 'bot.pos.y'}}}}}}}}
    r = ev._search(body)
    for b in r['aggregations']['b']['buckets']:
        for h in b['h']['buckets']:
            y = h['y']['value']; ym = h['ymin']['value']
            if y is None:
                continue
            nb += 1
            cells[int((y // 8) * 8)] += 1
            cells_min[int((ym // 8) * 8)] += 1
O['depth_10min_buckets'] = nb
O['depth_avg_y_by8'] = dict(sorted(cells.items()))
O['depth_min_y_by8'] = dict(sorted(cells_min.items()))

ev = EsEvents.load('skill', since=iso(UNTIL - dt.timedelta(days=7)), until=iso(UNTIL))
# 2. latest position per bot now
lat = ev.latest(require='bot.pos.x', fields=['bot.pos', 'exp.pool', 'bot.inventory'])
O['latest_y'] = {b: s['bot']['pos']['y'] for b, s in lat.items()}
O['latest_inv_diamond'] = {b: (s['bot'].get('inventory') or {}).get('diamond', 0) for b, s in lat.items()}


# 3. entombed rows by y (histogram), and per pool
def yhist(kind, extra=None):
    q = ev._query(kind=kind)
    if extra:
        q['bool']['filter'].append(extra)
    r = ev._search({'size': 0, 'query': q, 'aggs': {'y': {'histogram': {'field': 'bot.pos.y', 'interval': 8}}}})
    return {int(b['key']): b['doc_count'] for b in r['aggregations']['y']['buckets'] if b['doc_count']}


O['entombed_by_y8'] = yhist('_entombed')
O['entombed_by_pool'] = dict(ev.by_pool('_entombed'))
O['entombed_by_bot'] = dict(ev.by_bot('_entombed'))
O['unrec_by_y8'] = yhist('_entombed_unrecoverable')
O['lava_corridor_by_y8'] = yhist('_lava_corridor')
O['allrows_by_y8'] = yhist(None)

# 4. skills interrupted by entombed
q = ev._query()
q['bool']['filter'].append({'term': {'trigger': 'interrupt:entombed'}})
r = ev._search({'size': 0, 'query': q, 'aggs': {'s': {'terms': {'field': 'skill.name', 'size': 100}, 'aggs': {
    'st': {'terms': {'field': 'skill.status', 'size': 20}}, 'dur': {'sum': {'field': 'skill.duration_ms'}},
    'y': {'histogram': {'field': 'bot.pos.y', 'interval': 16}}}}}})
O['interrupt_entombed'] = {b['key']: {'n': b['doc_count'], 'status': {x['key']: x['doc_count'] for x in b['st']['buckets']},
                                      'dur_h': round(b['dur']['value'] / 3.6e6, 1),
                                      'y16': {int(x['key']): x['doc_count'] for x in b['y']['buckets'] if x['doc_count']}}
                           for b in r['aggregations']['s']['buckets']}
q = ev._query()
q['bool']['filter'].append({'term': {'trigger': 'llm:entombed'}})
r = ev._search({'size': 0, 'query': q, 'aggs': {'s': {'terms': {'field': 'skill.name', 'size': 100}, 'aggs': {
    'st': {'terms': {'field': 'skill.status', 'size': 20}}, 'dur': {'sum': {'field': 'skill.duration_ms'}}}}}})
O['llm_entombed_skills'] = {b['key']: {'n': b['doc_count'], 'status': {x['key']: x['doc_count'] for x in b['st']['buckets']},
                                       'dur_h': round(b['dur']['value'] / 3.6e6, 1)} for b in r['aggregations']['s']['buckets']}
# all skills total duration for a denominator
q = ev._query()
q['bool']['filter'].append({'bool': {'must_not': [{'term': {'trigger': 'reflex'}}]}})
r = ev._search({'size': 0, 'query': q, 'aggs': {'dur': {'sum': {'field': 'skill.duration_ms'}}, 'n': {'value_count': {'field': 'skill.name'}}}})
O['nonreflex_skill_rows'] = r['aggregations']['n']['value']
O['nonreflex_skill_dur_h'] = round(r['aggregations']['dur']['value'] / 3.6e6, 1)
json.dump(O, open('/home/mike/mineshaft-1023/es3.json', 'w'), indent=1)
print(json.dumps(O, indent=1)[:12000])
