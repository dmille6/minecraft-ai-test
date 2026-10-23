import sys, collections, re, json; sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
ev7 = EsEvents.load('skill', since='2026-10-16T21:00:00Z', until='2026-10-23T21:00:00Z')
print('7d _entombed_ramp_cut by status', dict(ev7.terms('skill.status', kind='_entombed_ramp_cut')))
tot = collections.Counter(); exc = collections.Counter(); bots = collections.Counter(); blocks = collections.Counter()
for r in ev7.rows('_entombed_ramp_cut', fields=['bot.name', 'skill.detail']):
    d = r['skill'].get('detail') or ''
    b = r['bot']['name']
    tot[b] += 1
    m = re.search(r'ceiling dig failed on (\w+): dig exceeded', d)
    if m:
        exc[b] += 1; blocks[m.group(1)] += 1
print('7d ramp rows', sum(tot.values()), 'bots', len(tot), '| ceiling dig exceeded rows', sum(exc.values()), 'bots', len(exc))
print(' top exceeded bots', exc.most_common(8))
print(' blocks', blocks.most_common(8))
# water_no_air_route held hours per bot, 7d
held = collections.Counter()
for r in ev7.rows('_water_no_air_route_ended', fields=['bot.name', 'skill.detail']):
    m = re.search(r'held (\d+(?:\.\d+)?)s', r['skill'].get('detail') or '')
    if m: held[r['bot']['name']] += float(m.group(1)) / 3600
print('7d no_air_route held bot-h, top', [(b, round(h, 1)) for b, h in held.most_common(6)], 'total', round(sum(held.values()), 1))
