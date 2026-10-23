"""Every _reflex_danger_block, _lava_adjacent_*, _lava_corridor row (7 d) with position + health, to judge the
escape() sprint: of the firings with feet=air (lava BELOW), how many end in a death within 10 s?"""
import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
UNTIL = '2026-10-23T14:00:00Z'
ev = EsEvents.load('skill', since_minutes=7 * 24 * 60, until=UNTIL)
F = ['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'bot.health', 'skill.name', 'skill.detail', 'skill.status', 'trigger']
out = {}
for k in ('_reflex_danger_block', '_lava_adjacent_stand_off', '_lava_adjacent_no_retreat', '_reflex_low_health', '_death_site_recorded'):
    out[k] = list(ev.rows(k, fields=F, allow_zero=True, max_rows=300000))
    print(k, len(out[k]), flush=True)
json.dump(out, open('/home/mike/mineshaft-1023/danger7d.json', 'w'))
