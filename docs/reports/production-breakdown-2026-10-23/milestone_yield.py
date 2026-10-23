"""Per UTC day: LLM decisions by milestone x chosen skill x outcome.status, and by world.
Server-side terms (llm stream). Read-only (ES).

This is the demand side of production: which rung of the milestone ladder the bot was on when
it chose an action, and what the action returned. The "#N" lap suffix is stripped.
Positive control printed per day: the summed buckets equal the day's decision count, and the
(gather, success) cell is compared with the skill stream's llm-triggered gather successes in
the report.
Output: out/milestone_yield.json  {day: {world: {milestone: {skill: {status: n}}}}}
"""
import sys, os, re, json, datetime as dt
from collections import defaultdict
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')


def world(pool):
    if pool and pool.startswith('self-'):
        return '-'.join(pool.split('-')[1:3])
    return pool


res = {}
d = dt.date(2026, 10, 8)
while d <= dt.date(2026, 10, 23):
    s, u = f'{d}T00:00:00Z', f'{d + dt.timedelta(days=1)}T00:00:00Z'
    now = dt.datetime.now(dt.timezone.utc)
    if dt.datetime.fromisoformat(u.replace('Z', '+00:00')) > now:
        u = (now - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    ev = EsEvents.load('llm', since=s, until=u)
    body = {'size': 0, 'query': ev._query(), 'aggs': {
        'p': {'terms': {'field': 'exp.pool', 'size': 200, 'missing': '<missing>'}, 'aggs': {
            'm': {'terms': {'field': 'messages.milestone', 'size': 20000, 'missing': '<missing>'}, 'aggs': {
                'k': {'terms': {'field': 'tool_calls.skill', 'size': 200, 'missing': '<none>'}, 'aggs': {
                    's': {'terms': {'field': 'outcome.status', 'size': 50, 'missing': '<missing>'}}}}}}}}}}
    r = ev._search(body)['aggregations']['p']
    ev._complete(r, 'pool')
    D = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int))))
    tot = 0
    for pb in r['buckets']:
        w = world(pb['key'])
        ev._complete(pb['m'], 'milestone')
        for mb in pb['m']['buckets']:
            m = re.sub(r'#\d+$', '', mb['key'])
            ev._complete(mb['k'], 'skill')
            ks = 0
            for kb in mb['k']['buckets']:
                ev._complete(kb['s'], 'status')
                for sb in kb['s']['buckets']:
                    D[w][m][kb['key']][sb['key']] += sb['doc_count']
                    ks += sb['doc_count']
            tot += mb['doc_count']
    res[str(d)] = json.loads(json.dumps(D))
    print(d, 'decisions', ev.total(), 'milestone buckets', tot, flush=True)
    d += dt.timedelta(days=1)
json.dump(res, open(os.path.join(OUT, 'milestone_yield.json'), 'w'), sort_keys=True)
