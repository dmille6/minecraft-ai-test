import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
ev = EsEvents.load('skill', since='2026-09-28T02:30:00Z', until='2026-09-28T04:10:00Z', bots=['board-a-Comet'])
skip = {'_path_noPath', '_affordance_scan', '_path_reset', '_path_failure_shapes', '_reach_probe', '_chunks_evicted', '_dig_town_sum', '_veto_faces', '_path_timeout'}
last = None
for r in ev.rows(fields=['@timestamp', 'skill.name', 'skill.status', 'skill.detail', 'bot.pos']):
    s = r.get('skill', {})
    if s.get('name') in skip: continue
    p = r.get('bot', {}).get('pos')
    print(r['@timestamp'][11:19], s.get('name'), s.get('status'), '|', (s.get('detail') or '')[:230], '|', p)
print('=========== 14:55-16:45')
ev = EsEvents.load('skill', since='2026-09-28T15:00:00Z', until='2026-09-28T16:45:00Z', bots=['board-a-Comet'])
n = 0
for r in ev.rows(fields=['@timestamp', 'skill.name', 'skill.status', 'skill.detail', 'bot.pos']):
    s = r.get('skill', {})
    if s.get('name') in skip: continue
    p = r.get('bot', {}).get('pos')
    n += 1
    if n > 160: break
    print(r['@timestamp'][11:19], s.get('name'), s.get('status'), '|', (s.get('detail') or '')[:200], '|', p)
