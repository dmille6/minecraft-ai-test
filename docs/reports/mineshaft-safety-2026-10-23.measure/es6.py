"""What keeps bots shallow: mine calls (requested y, start y, outcome, fail class), exit-reserve refusals, llm proposals of mine."""
import sys, json, collections
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
UNTIL = '2026-10-23T14:00:00Z'
ev = EsEvents.load('skill', since_minutes=7 * 24 * 60, until=UNTIL)
F = ['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'skill.name', 'skill.detail', 'skill.status', 'skill.fail_class',
     'skill.duration_ms', 'skill.args', 'trigger', 'bot.inventory', 'bot.tools']
rows = list(ev.rows('mine', fields=F, max_rows=300000))
print('mine rows', len(rows))
json.dump(rows, open('/home/mike/mineshaft-1023/mine7d.json', 'w'))
out = {'mine_status': dict(ev.terms('skill.status', kind='mine')),
       'mine_failclass': dict(ev.terms('skill.fail_class', kind='mine')),
       'gather_iron_status': dict(ev.terms('skill.status', kind='gather', match={'skill.args.block': 'iron_ore'}, allow_zero=True))}
# admission refusals of mine on the llm stream
evl = EsEvents.load('llm', since_minutes=7 * 24 * 60, until=UNTIL)
q = evl._query()
q['bool']['filter'].append({'term': {'tool_calls.skill': 'mine'}})
r = evl._search({'size': 0, 'query': q, 'aggs': {'st': {'terms': {'field': 'outcome.status', 'size': 50}},
                                                 'err': {'terms': {'field': 'llm.error', 'size': 50}}}})
out['llm_mine_proposals'] = r['hits']['total']
out['llm_mine_outcome'] = {b['key']: b['doc_count'] for b in r['aggregations']['st']['buckets']}
out['llm_mine_error'] = {b['key']: b['doc_count'] for b in r['aggregations']['err']['buckets']}
q = evl._query()
r = evl._search({'size': 0, 'query': q, 'track_total_hits': True, 'aggs': {'sk': {'terms': {'field': 'tool_calls.skill', 'size': 60}}}})
out['llm_total'] = r['hits']['total']
out['llm_skill_terms'] = {b['key']: b['doc_count'] for b in r['aggregations']['sk']['buckets']}
json.dump(out, open('/home/mike/mineshaft-1023/es6.json', 'w'), indent=1)
print(json.dumps(out, indent=1))
