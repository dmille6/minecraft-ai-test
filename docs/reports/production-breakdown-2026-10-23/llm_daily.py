"""Daily LLM decision stream aggregates (server-side), 10-08 .. 10-23. Read-only (ES).

Per UTC day: decisions, decisions per bot-hour, latency p50/p90/p99 and summed latency hours,
split by endpoint and model; outcome.status mix; llm.error mix; trigger mix.
Output: out/llm_daily.json and a printed table.
"""
import sys, os, json, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
res = {}
d = dt.date(2026, 10, 8)
while d <= dt.date(2026, 10, 23):
    s, u = f'{d}T00:00:00Z', f'{d + dt.timedelta(days=1)}T00:00:00Z'
    now = dt.datetime.now(dt.timezone.utc)
    if dt.datetime.fromisoformat(u.replace('Z', '+00:00')) > now:
        u = (now - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    ev = EsEvents.load('llm', since=s, until=u)
    body = {'size': 0, 'query': ev._query(), 'aggs': {
        'lat': {'percentiles': {'field': 'llm.latency_ms', 'percents': [50, 90, 99]}},
        'latsum': {'sum': {'field': 'llm.latency_ms'}},
        'ep': {'terms': {'field': 'llm.endpoint', 'size': 50, 'missing': '<missing>'},
               'aggs': {'lat': {'percentiles': {'field': 'llm.latency_ms', 'percents': [50, 90]}},
                        'latsum': {'sum': {'field': 'llm.latency_ms'}}}},
        'model': {'terms': {'field': 'llm.model', 'size': 50, 'missing': '<missing>'}},
        'st': {'terms': {'field': 'outcome.status', 'size': 50, 'missing': '<missing>'}},
        'err': {'terms': {'field': 'llm.error', 'size': 2000, 'missing': '<none>'}},
        'tr': {'terms': {'field': 'trigger', 'size': 2000, 'missing': '<missing>'}},
    }}
    r = ev._search(body)['aggregations']
    for k in ('ep', 'model', 'st', 'err', 'tr'):
        ev._complete(r[k], k)
    cov = ev.coverage()
    day = {'window': [s, u], 'caveats': ev.caveats, 'decisions': ev.total(), 'bot_hours': cov['bot_hours'],
           'empty_10min': cov['empty_10min'],
           'lat_p': r['lat']['values'], 'lat_hours': (r['latsum']['value'] or 0) / 3.6e6,
           'endpoints': {b['key']: {'n': b['doc_count'], 'p': b['lat']['values'], 'hours': b['latsum']['value'] / 3.6e6}
                         for b in r['ep']['buckets']},
           'models': {b['key']: b['doc_count'] for b in r['model']['buckets']},
           'status': {b['key']: b['doc_count'] for b in r['st']['buckets']},
           'errors': {b['key']: b['doc_count'] for b in r['err']['buckets']},
           'triggers': {b['key']: b['doc_count'] for b in r['tr']['buckets']}}
    res[str(d)] = day
    p = day['lat_p']
    print(f"{d} decisions {day['decisions']:7d} per bot-h {day['decisions'] / day['bot_hours']:6.1f} "
          f"lat p50 {p['50.0']:6.0f} p90 {p['90.0']:6.0f} p99 {p['99.0']:7.0f} ms; llm-hours {day['lat_hours']:6.1f} "
          f"({100 * day['lat_hours'] / day['bot_hours']:4.1f}% of bot-h)  eps "
          + ', '.join(f"{k.split('//')[-1].split(':')[0]}={v['n']}" for k, v in day['endpoints'].items()), flush=True)
    d += dt.timedelta(days=1)
json.dump(res, open(os.path.join(OUT, 'llm_daily.json'), 'w'), indent=1, sort_keys=True)
