"""Daily server-side aggregations over the skill stream, 10-08 .. 10-23 (10-07 is refused by
estelemetry and is not asked for). Read-only (ES, read-only key).

Per UTC day, per pool (isolated self-pools folded into their world), per skill.name x skill.status:
  docs, sum(skill.duration_ms).
Also, per day: coverage() bot-hours (the denominator) and distinct bots.

Output: out/daily_skill_aggs.json
"""
import sys, json, os, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)

def world(pool):
    if pool.startswith('self-'):
        # self-isolated-c-Bravo -> isolated-c
        return '-'.join(pool.split('-')[1:3])
    return pool

def days(a, b):
    d = dt.date.fromisoformat(a)
    while d <= dt.date.fromisoformat(b):
        yield d
        d += dt.timedelta(days=1)

res = {}
start, end = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ('2026-10-08', '2026-10-23')
for d in days(start, end):
    s = f'{d}T00:00:00Z'
    u = f'{d + dt.timedelta(days=1)}T00:00:00Z'
    now = dt.datetime.now(dt.timezone.utc)
    if dt.datetime.fromisoformat(u.replace('Z', '+00:00')) > now:
        u = (now - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    ev = EsEvents.load('skill', since=s, until=u)
    body = {'size': 0, 'query': ev._query(), 'aggs': {
        'p': {'terms': {'field': 'exp.pool', 'size': 1000},
              'aggs': {'k': {'terms': {'field': 'skill.name', 'size': 1000},
                             'aggs': {'st': {'terms': {'field': 'skill.status', 'size': 50, 'missing': '<missing>'},
                                             'aggs': {'dur': {'sum': {'field': 'skill.duration_ms'}}}}}},
                       'bots': {'cardinality': {'field': 'bot.name'}}}}}}
    r = ev._search(body)
    p = ev._complete(r['aggregations']['p'], 'pool terms')
    day = {'window': [s, u], 'caveats': ev.caveats, 'total_docs': ev.total(), 'pools': {}}
    tot = 0
    for pb in p['buckets']:
        w = world(pb['key'])
        dp = day['pools'].setdefault(w, {'docs': 0, 'kinds': {}})
        dp['docs'] += pb['doc_count']
        tot += pb['doc_count']
        k = ev._complete(pb['k'], 'kind terms')
        for kb in k['buckets']:
            dk = dp['kinds'].setdefault(kb['key'], {})
            st = ev._complete(kb['st'], 'status terms')
            for sb in st['buckets']:
                x = dk.setdefault(sb['key'], [0, 0.0])
                x[0] += sb['doc_count']
                x[1] += sb['dur']['value'] or 0.0
    cov = ev.coverage()
    day['coverage_bot_hours'] = cov['bot_hours']
    day['empty_hours'] = cov['empty_hours']
    day['empty_10min'] = cov['empty_10min']
    day['bots'] = len(ev.bots_present())
    day['docs_with_pool'] = tot
    # bot-hours per world (coverage per pool)
    day['pool_bot_hours'] = {}
    for w in sorted(day['pools']):
        pools = [w] if not w.startswith('isolated') else [w] + [f'self-{w}-{b}' for b in
                                                                ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
        evp = EsEvents.load('skill', since=s, until=u, pools=pools)
        day['pool_bot_hours'][w] = evp.coverage()['bot_hours']
    res[str(d)] = day
    print(d, 'docs', day['total_docs'], 'with_pool', tot, 'bots', day['bots'], 'bot-h', day['coverage_bot_hours'],
          'empty10', len(day['empty_10min']), flush=True)

with open(os.path.join(OUT, f'daily_skill_aggs_{start}_{end}.json'), 'w') as f:
    json.dump(res, f, indent=1, sort_keys=True)
