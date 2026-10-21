#!/usr/bin/env python3
"""G5 null on the old code (7 d, ES): drowning deaths with a watchdog rescue skill row (trigger watchdog_*) that ENDED
within 180 s before the death (or was still running at the death), and the death within 16 blocks of the rescue's end.
Also: the same for ANY death cause, and the rescue-row denominators."""
import sys, datetime as dt, collections, math
sys.path.insert(0, '.')
from eslib.estelemetry import EsEvents
since, until = sys.argv[1], sys.argv[2]
excl_version = sys.argv[3] if len(sys.argv) > 3 else 'a52d075e'
ev = EsEvents.load('skill', since=since, until=until, gaps='clip')
def ts(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
deaths = [d for d in ev.rows('_death', fields=['@timestamp', 'bot.name', 'bot.pos', 'skill.detail', 'exp.pool', 'code.version'])]
resc = collections.defaultdict(list); nres = collections.Counter()
for trig in ('watchdog_relocate', 'watchdog_home'):
    for r in ev.rows(None, fields=['@timestamp', 'bot.name', 'bot.pos', 'skill.name', 'skill.duration_ms', 'code.version', 'trigger'],
                     match={'trigger': trig}, max_rows=200000):
        v = (r.get('code') or {}).get('version', '')[:8]
        if v == excl_version: continue
        t0 = ts(r['@timestamp']); te = t0 + dt.timedelta(milliseconds=(r.get('skill') or {}).get('duration_ms') or 0)
        resc[r['bot']['name']].append((t0, te, r['bot'].get('pos') or {}, trig))
        nres[trig] += 1
print('window', ev.since, ev.until, 'rescue rows on the old code', dict(nres))
out = collections.Counter(); ex = []
for d in deaths:
    v = (d.get('code') or {}).get('version', '')[:8]
    if v == excl_version: continue
    drown = (d['skill'].get('detail') or '').startswith('drowned')
    t = ts(d['@timestamp']); p = d['bot'].get('pos') or {}
    out['deaths'] += 1; out['drown'] += drown
    hit = None
    for t0, te, rp, trig in resc.get(d['bot']['name'], []):
        if t0 <= t and (t - te).total_seconds() <= 180:
            dist = math.dist([p.get('x', 0), p.get('y', 0), p.get('z', 0)], [rp.get('x', 0), rp.get('y', 0), rp.get('z', 0)]) if rp and p else 999
            if dist <= 16: hit = (trig, round((t - te).total_seconds()), round(dist, 1))
    if hit:
        out['adjacent_any'] += 1; out['adjacent_drown'] += drown
        ex.append((d['@timestamp'], d['bot']['name'], v, d['skill']['detail'][:60], hit))
print(dict(out))
for e in ex: print('  ', e)
