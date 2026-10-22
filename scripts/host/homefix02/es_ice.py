#!/usr/bin/env python3
"""7-day fleet: drowning deaths, and which ones had the head under ICE (or another solid) in the 180 s before.
Head-block evidence comes from the reflex rows that print it: `_air_drowning_observed` / `_reflex_*`
("head block X") and `_water_surface` / `_water_no_air_route` ("(head X, health").
"""
import sys, re, json, datetime as dt, collections
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
from eslib.estelemetry import EsEvents

since = sys.argv[2] if len(sys.argv) > 2 else None
until = sys.argv[3] if len(sys.argv) > 3 else None
ev = EsEvents.load('skill', since=since, until=until, gaps='clip')
print('window', ev.since, ev.until, 'caveats:', len(ev.caveats))
print('total docs', ev.total(), 'bots', ev.bots_present())
deaths = list(ev.rows('_death', fields=['@timestamp', 'bot.name', 'bot.pos', 'skill.detail', 'exp.pool', 'code.version']))
print('deaths (all causes)', len(deaths))
drown = [d for d in deaths if (d.get('skill', {}).get('detail') or '').startswith('drowned')]
print('drowning deaths', len(drown))

def ts(r):
    return dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))

HEAD_RE = re.compile(r'head(?: block)? ([a-z_]+)')
ev_rows = collections.defaultdict(list)
for kind in ('_air_drowning_observed', '_water_surface', '_water_no_air_route', '_reflex_drowning', '_drowning_route',
             '_drowning_rescue_yielded', '_drowning_ceiling_no_air'):
    try:
        rs = list(ev.rows(kind, fields=['@timestamp', 'bot.name', 'skill.detail'], max_rows=400000))
    except Exception as e:
        print('rows', kind, 'ERR', type(e).__name__, str(e)[:200]); continue
    print('rows', kind, len(rs))
    for r in rs:
        ev_rows[r['bot']['name']].append((ts(r), kind, r['skill'].get('detail') or ''))
for b in ev_rows: ev_rows[b].sort()

heads_all = collections.Counter()
for b, L in ev_rows.items():
    for t, k, d in L:
        if k in ('_air_drowning_observed', '_water_surface', '_water_no_air_route', '_reflex_drowning'):
            m = HEAD_RE.search(d)
            if m: heads_all[(k, m.group(1))] += 1
print('head-block readings, all rows (kind, head):', heads_all.most_common(30))

out = collections.Counter(); examples = collections.defaultdict(list)
for d in drown:
    b = d['bot']['name']; t = ts(d)
    pre = [x for x in ev_rows.get(b, []) if t - dt.timedelta(seconds=180) <= x[0] <= t]
    heads = collections.Counter()
    yielded = any(k == '_drowning_rescue_yielded' for _, k, _ in pre)
    ceil = sum(1 for _, k, _ in pre if k == '_drowning_ceiling_no_air')
    routes = collections.Counter((re.match(r'(\w+) dist=(-?\d+)', dd) or [None, '?', '?'])[1] for _, k, dd in pre if k == '_drowning_route')
    for _, k, dd in pre:
        m = HEAD_RE.search(dd)
        if m and k != '_drowning_route': heads[m.group(1)] += 1
    solid = [h for h in heads if h not in ('water', 'air', 'unknown', 'bubble_column', 'seagrass', 'kelp', 'kelp_plant', 'tall_seagrass', 'cave_air')]
    cls = 'head_under_' + '+'.join(sorted(solid)) if solid else ('head_water_only' if heads else 'no_head_rows')
    out[cls] += 1
    out['yielded_any'] += yielded
    out['route_up_any'] += bool(routes.get('up'))
    if solid and len(examples[cls]) < 6:
        examples[cls].append((d['@timestamp'], b, d.get('bot', {}).get('pos'), dict(heads), dict(routes), ceil))
print('drowning deaths by head evidence in the 180 s before:', dict(out))
for k, v in examples.items():
    print(k)
    for e in v: print('   ', e)
