#!/usr/bin/env python3
"""Per drowning death (7 d): pool, head-under-ice, and how the bot got there (rows in the 10 min before:
ice dug by whom, watchdog relocation/home, the skill running). Fleet-wide drowning by pool."""
import sys, re, datetime as dt, collections
sys.path.insert(0, '.')
from lib.estelemetry import EsEvents
since, until = sys.argv[1], sys.argv[2]
ev = EsEvents.load('skill', since=since, until=until, gaps='clip')
deaths = [d for d in ev.rows('_death', fields=['@timestamp', 'bot.name', 'bot.pos', 'skill.detail', 'exp.pool', 'code.version'])
          if (d['skill'].get('detail') or '').startswith('drowned')]
def ts(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
print('drowning deaths', len(deaths), 'by pool', collections.Counter(d['exp']['pool'] for d in deaths).most_common())
hived = [d for d in deaths if d['exp']['pool'] == 'hive-d']
for d in sorted(hived, key=lambda r: r['@timestamp']):
    t = ts(d['@timestamp']); b = d['bot']['name']
    w = EsEvents.load('skill', since=t - dt.timedelta(minutes=10), until=t + dt.timedelta(seconds=1), bots=[b])
    rows = sorted(w.rows(None, fields=['@timestamp', 'skill.name', 'skill.status', 'trigger', 'skill.detail', 'bot.pos'], max_rows=20000),
                  key=lambda r: r['@timestamp'])
    heads = collections.Counter(); icedug = []; resc = []; skills = []
    for r in rows:
        s = r.get('skill', {}); n = s.get('name'); det = s.get('detail') or ''
        m = re.search(r'head(?: block)? ([a-z_]+)', det)
        if m and n in ('_air_drowning_observed', '_water_surface', '_water_no_air_route'): heads[m.group(1)] += 1
        if 'ice' in det and n in ('_dig_approach', '_goto_float_dig', '_goto_dig_retry', '_inventory_mutation', '_entombed', '_dig_town', '_digs'):
            icedug.append(f"{r['@timestamp'][11:19]} {n} {det[:90]}")
        if n in ('_watchdog_rescue', '_stagnation') or (r.get('trigger') or '').startswith('watchdog'):
            resc.append(f"{r['@timestamp'][11:19]} {n} {r.get('trigger')} {det[:70]}")
        if not n.startswith('_'): skills.append(f"{r['@timestamp'][11:19]} {n}/{s.get('status')}/{r.get('trigger')}")
    print(f"\n{d['@timestamp']} {b} pos={d['bot']['pos']} v={d['code']['version'][:8]} heads={dict(heads)}")
    print('   death:', d['skill']['detail'][:160])
    print('   skills:', skills[-8:])
    print('   ice:', icedug[-4:])
    print('   rescue:', resc[-4:])
