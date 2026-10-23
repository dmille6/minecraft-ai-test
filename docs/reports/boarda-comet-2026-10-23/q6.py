import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

ev = EsEvents.load('skill', since_minutes=24 * 60, until='2026-10-23T21:00:00Z', bots=['board-a-Comet'])
lat = ev.latest(require='bot.pos.x')
src = lat['board-a-Comet']
print(json.dumps({k: src.get(k) for k in ('@timestamp', 'bot', 'exp', 'code')}, default=str)[:4000])
want = ['_maroon_climb_refused', '_entombed', '_entombed_needs_blocks', '_entombed_ramp_cut', '_stranded', '_stranded_underground',
        '_stranded_unrecoverable', '_stranded_escape_try', '_stranded_escape_result', '_livelock_escape', '_marooned_needs_pickaxe',
        '_poolescape_mode', '_air_drowning_observed', '_air_pocket_refused', '_drowning_ceiling_no_air', '_drowning_route',
        '_oxygen_critical_state', '_flooded_pocket_rung', '_relocate_landed', '_goto_float_dig', '_exit_reserve_abort', 'surface', 'mine',
        '_mine_plan', '_water_no_air_route', '_water_no_air_route_ended', '_stagnation', '_dig_collision', '_veto_faces', 'goto']
seen = collections.Counter()
wd = collections.Counter()
for r in ev.rows(fields=['@timestamp', 'skill', 'bot.pos', 'bot.health', 'bot.food', 'bot.oxygen', 'bot.air']):
    s = r.get('skill', {}); k = s.get('name')
    if k == '_watchdog_rescue':
        wd[re.sub(r'attempt \S+', 'attempt X', s.get('detail') or '')[:200] + ' | ' + str(s.get('status'))] += 1
    if k in want and seen[k] < 3:
        seen[k] += 1
        print(r['@timestamp'], k, s.get('status'), '|', (s.get('detail') or '')[:600], '| pos', r.get('bot', {}).get('pos'))
print('WATCHDOG')
for t, c in wd.most_common(40):
    print(c, t)
