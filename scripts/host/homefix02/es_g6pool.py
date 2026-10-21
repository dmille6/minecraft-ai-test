#!/usr/bin/env python3
"""G6 calibration on the old code (7 d, ES): drowning deaths within 180 s AFTER a `_stagnation` verdict row (both builds
write it, with a position) and within 16 blocks of the verdict's position; per pool group. Also: pickaxes at the ice deaths."""
import sys, datetime as dt, collections, math
sys.path.insert(0, '.')
from eslib.estelemetry import EsEvents
since, until = sys.argv[1], sys.argv[2]
CAN = set(sys.argv[3].split(','))
excl = 'a52d075e'
ev = EsEvents.load('skill', since=since, until=until, gaps='clip')
def ts(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
ver = lambda r: ((r.get('code') or {}).get('version') or '')[:8]
grp = lambda pool: ('isolated' if pool.startswith(('self-isolated', 'isolated')) else pool)
verd = collections.defaultdict(list); nverd = collections.Counter()
for r in ev.rows('_stagnation', fields=['@timestamp', 'bot.name', 'bot.pos', 'exp.pool', 'code.version'], max_rows=200000):
    if ver(r) == excl: continue
    verd[r['bot']['name']].append((ts(r['@timestamp']), r['bot'].get('pos') or {}))
    nverd[grp(r['exp']['pool'])] += 1
deaths = [d for d in ev.rows('_death', fields=['@timestamp', 'bot.name', 'bot.pos', 'skill.detail', 'exp.pool', 'code.version'])
          if ver(d) != excl and (d['skill'].get('detail') or '').startswith('drowned')]
hit = collections.Counter(); tot = collections.Counter(); ex = []
for d in deaths:
    g = grp(d['exp']['pool']); tot[g] += 1
    t = ts(d['@timestamp']); p = d['bot'].get('pos') or {}
    for tv, pv in verd.get(d['bot']['name'], []):
        if 0 <= (t - tv).total_seconds() <= 180 and pv and p and math.dist([p['x'], p['y'], p['z']], [pv.get('x', 0), pv.get('y', 0), pv.get('z', 0)]) <= 16:
            hit[g] += 1; ex.append((d['@timestamp'], d['bot']['name'], g, round((t - tv).total_seconds()))); break
print('old-code _stagnation verdicts by group', dict(nverd))
print('old-code drownings by group', dict(tot), '| within 180 s / 16 b after a verdict', dict(hit))
for g in nverd:
    print('  %s: %.2f per 1000 verdicts' % (g, 1000 * hit[g] / nverd[g] if nverd[g] else float('nan')))
for e in ex: print('   ', e)
import json
print('PERPOOL', json.dumps({g: {'verdicts': nverd[g], 'adjacent_drownings': hit[g]} for g in sorted(nverd)}))
