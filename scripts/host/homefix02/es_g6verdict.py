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
grp = lambda pool: 'canarypools' if pool in CAN else 'control'
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
# pickaxes at the ice deaths (hive-d, y 61.2-61.4): the last row with bot.tools in the 120 s before
for d in deaths:
    p = d['bot'].get('pos') or {}
    if d['exp']['pool'] != 'hive-d' or not (61.0 <= (p.get('y') or 0) <= 61.5): continue
    t = ts(d['@timestamp'])
    w = EsEvents.load('skill', since=t - dt.timedelta(seconds=180), until=t, bots=[d['bot']['name']])
    rows = sorted(w.rows(None, fields=['@timestamp', 'bot.tools', 'bot.inventory', 'bot.health'], max_rows=5000), key=lambda r: r['@timestamp'])
    last = next((r for r in reversed(rows) if (r.get('bot') or {}).get('inventory')), None)
    inv = (last or {}).get('bot', {}).get('inventory') or {}
    picks = {k: v for k, v in inv.items() if k.endswith('_pickaxe')}
    tools = (last or {}).get('bot', {}).get('tools') or {}
    worst = {k: [(x.get('max', 0) - x.get('used', 0)) for x in v] for k, v in tools.items() if k.endswith('_pickaxe')} if isinstance(tools, dict) else tools
    print('ICE?', d['@timestamp'], d['bot']['name'], p, 'pickaxes', picks, 'uses left', worst)
