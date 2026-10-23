"""Hourly LLM decisions per world by rung group (server-side, llm stream). Read-only (ES).
Groups are prefix matches on messages.milestone (the '#N' lap suffix and '+prereq' both match).
Output: out/rung_hourly.json  {hour_iso: {world: {group: n, '_all': n}}}
"""
import sys, os, json, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
GROUPS = {'wood': ['stockpile_wood'], 'stone': ['stockpile_stone'], 'iron': ['gather_iron_ore_3'],
          'craft': ['craft_'], 'smelt': ['smelt_'], 'lap': ['patrol', 'return', 'idle'], 'dirt': ['gather_dirt_16'],
          'sand': ['gather_sand_8'], 'deposit': ['deposit_surplus'], 'g_log': ['gather_oak_log'],
          'g_cobble': ['gather_cobblestone']}


def world(pool):
    if pool and pool.startswith('self-'):
        return '-'.join(pool.split('-')[1:3])
    return pool


filters = {g: {'bool': {'should': [{'prefix': {'messages.milestone': p}} for p in ps], 'minimum_should_match': 1}}
           for g, ps in GROUPS.items()}
res = {}
d = dt.date(2026, 10, 8)
while d <= dt.date(2026, 10, 23):
    s, u = f'{d}T00:00:00Z', f'{d + dt.timedelta(days=1)}T00:00:00Z'
    now = dt.datetime.now(dt.timezone.utc)
    if dt.datetime.fromisoformat(u.replace('Z', '+00:00')) > now:
        u = (now - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    ev = EsEvents.load('llm', since=s, until=u)
    body = {'size': 0, 'query': ev._query(), 'aggs': {'h': {
        'date_histogram': {'field': '@timestamp', 'fixed_interval': '1h', 'min_doc_count': 1},
        'aggs': {'p': {'terms': {'field': 'exp.pool', 'size': 200, 'missing': '<missing>'},
                       'aggs': {'g': {'filters': {'filters': filters}}}}}}}}
    r = ev._search(body)['aggregations']['h']['buckets']
    n_all = 0
    for hb in r:
        H = res.setdefault(hb['key_as_string'][:13], {})
        ev._complete(hb['p'], 'pool')
        for pb in hb['p']['buckets']:
            w = world(pb['key'])
            X = H.setdefault(w, {'_all': 0})
            X['_all'] += pb['doc_count']
            n_all += pb['doc_count']
            for g, gb in pb['g']['buckets'].items():
                X[g] = X.get(g, 0) + gb['doc_count']
    print(d, 'decisions', ev.total(), 'binned', n_all, flush=True)
    d += dt.timedelta(days=1)
json.dump(res, open(os.path.join(OUT, 'rung_hourly.json'), 'w'), sort_keys=True)
