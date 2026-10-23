"""The entombment stream for 7 d: every _entombed* row and every skill row interrupted by / triggered by entombed."""
import sys, json
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
UNTIL = '2026-10-23T14:00:00Z'
ev = EsEvents.load('skill', since_minutes=7 * 24 * 60, until=UNTIL)
F = ['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'bot.health', 'skill.name', 'skill.detail', 'skill.status',
     'skill.duration_ms', 'skill.args', 'trigger', 'bot.held']
out = {}
for k in ('_entombed', '_entombed_unrecoverable', '_entombed_ramp_cut', '_entombed_needs_blocks', '_entombed_needs_pickaxe',
          '_climb_flood_refused', '_watchdog_rescue', '_livelock_escape', '_marooned'):
    out[k] = list(ev.rows(k, fields=F, allow_zero=True, max_rows=300000))
    print(k, len(out[k]), flush=True)
for trig in ('interrupt:entombed', 'llm:entombed'):
    out[trig] = list(ev.rows(fields=F, allow_zero=True, max_rows=300000, match={'trigger': trig}))
    print(trig, len(out[trig]), flush=True)
json.dump(out, open('/home/mike/mineshaft-1023/entomb7d.json', 'w'))
