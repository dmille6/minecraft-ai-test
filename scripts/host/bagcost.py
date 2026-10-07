import glob, json, math, os, datetime as dt
from collections import Counter, defaultdict
stack = json.load(open(os.path.expanduser('~/stack.json')))
def slots(inv): return sum(math.ceil(c / stack.get(i, 64)) for i, c in inv.items() if c > 0)
def total(inv): return sum(c for c in inv.values() if c > 0)
T0 = '2026-10-07T13:00'
dur = defaultdict(list); multi = Counter(); nb = 0
acc = defaultdict(lambda: [0.0, 0])   # bucket -> [hours, items gained]
fullrows = Counter()
for f in glob.glob('/var/log/mcai/*/skill-*.jsonl'):
    prev = None; last = None
    for line in open(f, errors='ignore'):
        if '"inventory"' not in line: continue
        try: r = json.loads(line)
        except Exception: continue
        t = r.get('@timestamp', '')
        if t < T0: continue
        b = r.get('bot') or {}; inv = b.get('inventory')
        if not isinstance(inv, dict): continue
        sk = (r.get('skill') or {}); d = (sk.get('detail') or '').lower()
        if 'inventory full' in d or 'bag is full' in d or 'no room' in d: fullrows[sk.get('name')] += 1
        tt = dt.datetime.fromisoformat(t.replace('Z', '+00:00'))
        if prev:
            gap = min((tt - prev[0]).total_seconds(), 120)
            s = slots(prev[1]); bk = '<=30' if s <= 30 else ('31-33' if s <= 33 else '34-36')
            acc[bk][0] += gap / 3600; acc[bk][1] += max(0, total(inv) - total(prev[1]))
        prev = (tt, inv); last = b
    if last:
        nb += 1
        for tool, lst in (last.get('tools') or {}).items():
            for x in lst:
                dur[tool].append(1 - x['used'] / x['max'])
        inv = last['inventory']
        for it in ('crafting_table', 'furnace', 'chest', 'stone_pickaxe', 'wooden_pickaxe', 'bucket', 'stone_sword', 'wooden_sword', 'ladder'):
            if inv.get(it, 0) > 1 or (it == 'stone_pickaxe' and inv.get(it, 0) > 2): multi[it] += 1
print('bots', nb)
for tool in ('stone_pickaxe', 'wooden_pickaxe', 'iron_pickaxe', 'stone_sword', 'wooden_sword', 'stone_axe', 'stone_shovel', 'shears'):
    v = sorted(dur.get(tool, []))
    if v: print('%-15s n=%3d  <=10%% left %3d  usable(>10%%) %3d  median left %.0f%%' % (tool, len(v), sum(x <= .10 for x in v), sum(x > .10 for x in v), 100 * v[len(v)//2]))
print('bots holding duplicates (>1; stone_pickaxe >2):', dict(multi))
print('items gained per bot-hour by bag fullness (time-weighted, gaps capped 120 s, since 13:00Z):')
for bk in ('<=30', '31-33', '34-36'):
    h, g = acc[bk]; print('  %-6s bot-h %6.1f  items/bot-h %6.1f' % (bk, h, g / h if h else float('nan')))
print('rows naming a full bag:', fullrows.most_common(8))
