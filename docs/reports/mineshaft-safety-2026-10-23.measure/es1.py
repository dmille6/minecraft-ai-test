import sys, json, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
UNTIL = '2026-10-23T14:00:00Z'
ev = EsEvents.load('skill', since_minutes=7*24*60, until=UNTIL)
out = {}
out['caveats'] = ev.caveats
out['total_docs'] = ev.total()
out['bots_present'] = len(ev.bots_present())
out['coverage'] = ev.coverage()
out['deaths'] = int(ev.count('_death'))
out['deaths_by_class'] = dict(ev.terms('skill.fail_class', kind='_death'))
out['entombed'] = int(ev.count('_entombed'))
out['entombed_unrec'] = int(ev.count('_entombed_unrecoverable'))
out['lava_corridor'] = int(ev.count('_lava_corridor', allow_zero=True))
out['trigger_terms_top'] = dict(sorted(dict(ev.terms('trigger')).items(), key=lambda kv: -kv[1])[:60])
ev24 = EsEvents.load('skill', since_minutes=24*60, until=UNTIL)
out['deaths24_by_class'] = dict(ev24.terms('skill.fail_class', kind='_death'))
out['entombed24'] = int(ev24.count('_entombed'))
out['bots24'] = len(ev24.bots_present())
json.dump(out, open('/home/mike/mineshaft-1023/es1.json', 'w'), indent=1, default=str)
rows = list(ev.rows('_death', fields=['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'skill.detail', 'skill.fail_class',
                                      'bot.inventory', 'bot.tools', 'bot.held', 'code.version', 'run_id', 'game.dimension']))
json.dump(rows, open('/home/mike/mineshaft-1023/deaths7d.json', 'w'))
print(json.dumps(out, indent=1, default=str)[:6000])
print('death rows', len(rows))
