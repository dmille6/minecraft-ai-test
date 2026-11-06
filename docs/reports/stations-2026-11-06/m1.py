import sys, json, math, collections, re
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events
T = json.load(open('/tmp/st-towns.json'))
ev = Events.load(since_minutes=int(sys.argv[1]) if len(sys.argv) > 1 else 360)
print('rows', len(ev.rows), 'span_h %.2f' % ev.span, 'bots', len({(r['bot'] or {}).get('name') for r in ev.rows}))
ST = ('crafting_table', 'furnace')
def pool(r): return ((r['raw'].get('exp') or {}).get('pool'))
top = [r for r in ev.rows if not r['name'].startswith('_') and isinstance((r['bot'] or {}).get('inventory'), dict)]
top.sort(key=lambda r: ((r['bot'] or {}).get('name'), r['t']))
prev = {}
left = collections.Counter(); leftk = collections.Counter(); crafted = collections.Counter(); redundant = collections.Counter()
placed_ct = collections.Counter(); near_ws_left = collections.Counter(); intown_left = collections.Counter()
for r in top:
    b = r['bot']; nm = b.get('name'); inv = b['inventory']
    d = (r['raw'].get('skill') or {}).get('inventory_delta')
    if not isinstance(d, dict):
        p = prev.get(nm)
        d = None if p is None else {k: (inv.get(k, 0) or 0) - (p.get(k, 0) or 0) for k in set(inv) | set(p)}
    prev[nm] = inv
    if d is None: continue
    pl = pool(r); t = T.get(pl); pos = b.get('pos') or {}
    if not t or 'x' not in pos: continue
    h = t['home']; dh = max(abs(pos['x'] - h['x']), abs(pos['z'] - h['z']))
    zone = 'town' if dh <= t['s'] else 'ring' if dh <= t['s'] + 64 else 'away'
    deep = pos['y'] < h['y'] - 20
    ws = [list(map(int, s[2].split(','))) for s in t['stations']]
    dws = min((math.dist([pos['x'], pos['y'], pos['z']], w) for w in ws), default=1e9)
    args = (r['raw'].get('skill') or {}).get('args') or {}
    for k in ST:
        v = d.get(k, 0) or 0
        if v < 0:
            key = (r['name'], k, zone + ('-deep' if deep else ''))
            left[key] += -v; leftk[(k, zone + ('-deep' if deep else ''))] += -v
            if zone != 'away' and not deep and dws <= 64: near_ws_left[(k, r['name'])] += -v
    if r['name'] == 'craft' and r['status'] == 'success' and args.get('item') in ST:
        it = args['item']; crafted[(it, zone)] += 1
        held_before = (inv.get(it, 0) or 0) - (d.get(it, 0) or 0)
        if held_before >= 1: redundant[(it, 'held_one')] += 1
        elif zone != 'away' and not deep: redundant[(it, 'in_town_no_held')] += 1
        else: redundant[(it, 'away_no_held')] += 1
    det = r['detail']
    if r['name'] in ('craft', 'make_material') and ('placed a crafting_table' in det or 'placed the carried table' in det):
        placed_ct[('table', zone + ('-deep' if deep else ''), 'ws<=64' if dws <= 64 else 'ws>64', 'back' if 'took the table back' in det else 'NOT_back')] += 1
    if r['name'] in ('smelt', 'smelt_town', 'make_material') and 'placed the furnace' in det:
        placed_ct[('furnace', zone + ('-deep' if deep else ''), 'ws<=64' if dws <= 64 else 'ws>64', 'NOT_back')] += 1
    if r['name'] in ('craft', 'smelt', 'smelt_town', 'make_material'): placed_ct[('rows', r['name'], zone + ('-deep' if deep else ''))] += 1
print('LEFT by (skill, station, zone):'); [print('  ', k, v) for k, v in left.most_common(30)]
print('LEFT by station/zone:', dict(leftk))
print('LEFT in town/ring surface with workshop <=64:', dict(near_ws_left))
print('CRAFTED (top-level success):', dict(crafted))
print('CRAFT redundancy:', dict(redundant))
print('placements:'); [print('  ', k, v) for k, v in sorted(placed_ct.items())]
