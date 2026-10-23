"""What an entombed escape spends (inventory mutation rows), and diamonds / lapis / iron in bags and town chests."""
import sys, json, re, collections
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents
UNTIL = '2026-10-23T14:00:00Z'
ev = EsEvents.load('skill', since_minutes=7 * 24 * 60, until=UNTIL)
n_all = ev.count('_inventory_mutation')
rows = list(ev.rows('_inventory_mutation', fields=['@timestamp', 'bot.name', 'skill.detail', 'bot.pos'], detail_contains='entombed_escape', max_rows=300000))
print('inventory_mutation rows', int(n_all), 'of which entombed_escape', len(rows))
net = collections.Counter(); nrows_place = 0
for r in rows:
    d = r['skill']['detail']
    placed = False
    for item, sign, n in re.findall(r'([a-z_]+) ([+-])(\d+)', d):
        net[item] += int(n) * (1 if sign == '+' else -1)
        if sign == '-' and item in ('cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'netherrack'):
            placed = True
    nrows_place += placed
print('escape rows that spent scaffold blocks:', nrows_place)
print('net inventory change summed over escapes (top):', net.most_common(8), 'most negative:', sorted(net.items(), key=lambda kv: kv[1])[:8])
print('sample:', [r['skill']['detail'][:160] for r in rows[:5]])
# townindex rows: what kinds exist
names = ev.names()
print('index-ish kinds:', [n for n in names if 'index' in n or 'town_count' in n or 'count_town' in n][:20])
lat = ev.latest(require='bot.pos.x', fields=['bot.inventory'])
tot = collections.Counter()
for b, s in lat.items():
    for k in ('diamond', 'lapis_lazuli', 'iron_ingot', 'raw_iron', 'iron_pickaxe', 'diamond_ore', 'deepslate_diamond_ore', 'redstone', 'water_bucket', 'bucket', 'torch', 'coal'):
        tot[k] += (s['bot'].get('inventory') or {}).get(k, 0)
print('80 bags now:', dict(tot), 'bots', len(lat))
