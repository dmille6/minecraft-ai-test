#!/usr/bin/env python3
"""summary3.py <census.json> <plan.json> [summary-out.json] -- the owner-facing numbers of a planned clear (read-only:
it reads two files). Per town: containers, full containers before/after, used slots before/after, items removed,
slots freed, items reduced. Removed by category; kept by category. Every number is computed from the census and the
plan; nothing is estimated."""
import json, sys
from collections import Counter, defaultdict

d = json.load(open(sys.argv[1])); plan = json.load(open(sys.argv[2]))
ZERO = {'dirt', 'sand', 'red_sand', 'gravel', 'deepslate', 'tuff', 'calcite', 'sandstone', 'red_sandstone'}
STATIONS = {'crafting_table', 'furnace', 'chest', 'bucket', 'torch', 'ladder'}
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')


def cat(a):
    i, why = a['id'], a['why']
    if why == 'junk': return 'junk (the well list: eggs, flint, clay, ink, scutes, decorations)'
    if why == 'spent_tool': return 'spent tools (10 uses or fewer left)'
    if why == 'surplus_tool': return 'usable stone/wooden tools above the per-town keep'
    if i in ('cobblestone', 'cobbled_deepslate'): return 'cobblestone + cobbled_deepslate above 256'
    if i == 'bamboo': return 'bamboo (cap 0)'
    if i in ZERO: return 'dirt, sand, gravel and other 0-cap blocks'
    if i == 'stone': return 'stone above 64'
    if i.endswith('_log'): return 'logs above 64 per type'
    if i.endswith('_planks'): return 'planks above 64 per type'
    if i == 'stick': return 'sticks above 64'
    if i.endswith('_sapling') or i == 'mangrove_propagule': return 'saplings above 64 per type'
    if i in STATIONS: return 'stations/torches/ladders/buckets above cap'
    return 'other capped: ' + i


def kept_cat(i):
    if i.startswith('raw_') or i.endswith('_ore'): return 'ores and raw metal'
    if i.endswith('_ingot') or i in ('iron_nugget', 'gold_nugget', 'copper_block', 'iron_block'): return 'ingots / metal'
    if i in ('coal', 'charcoal', 'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'quartz', 'amethyst_shard'): return 'coal, gems, lapis, redstone'
    if i.endswith(TOOLS):
        return 'iron/diamond tools' if i.split('_')[0] in ('iron', 'diamond', 'netherite') else 'stone/wooden tools (usable, within keep)'
    if i.endswith('_log') or i.endswith('_planks') or i == 'stick': return 'wood (logs, planks, sticks) within cap'
    if i.endswith('_sapling') or i == 'mangrove_propagule': return 'saplings within cap'
    if i in ('cobblestone', 'cobbled_deepslate', 'stone'): return 'stone/cobble within cap'
    if i in STATIONS: return 'stations/torches/ladders/buckets within cap'
    if i in ('book', 'enchanted_book', 'writable_book', 'written_book', 'paper'): return 'books / paper'
    return 'everything else uncapped (food, misc)'


towns = {}
for w, v in sorted(d['worlds'].items()):
    acts = [a for a in plan if a['world'] == w]
    freed = Counter(tuple(a['pos']) for a in acts if a['why'] != 'reduce')
    used = sum(len(c['items']) for c in v['containers'])
    full_b = sum(1 for c in v['containers'] if len(c['items']) >= 27)
    full_a = sum(1 for c in v['containers'] if len(c['items']) - freed[tuple(c['pos'])] >= 27)
    rem = sum(a['count'] for a in acts if a['why'] != 'reduce')
    red = sum(a['count'] - a['keep'] for a in acts if a['why'] == 'reduce')
    items = sum(i['count'] for c in v['containers'] for i in c['items'])
    towns[w] = {'containers': len(v['containers']), 'capacity_slots': 27 * len(v['containers']), 'full_before': full_b,
                'full_after': full_a, 'used_before': used, 'used_after': used - sum(freed.values()), 'items_before': items,
                'items_removed': rem, 'slots_freed': sum(freed.values()), 'items_reduced': red,
                'reduce_slots': sum(1 for a in acts if a['why'] == 'reduce'), 'items_after': items - rem - red}
tot = {k: sum(t[k] for t in towns.values()) for k in next(iter(towns.values()))}
bycat = defaultdict(lambda: [0, 0])
for a in plan:
    k = cat(a)
    if a['why'] == 'reduce':
        bycat[k][0] += a['count'] - a['keep']
    else:
        bycat[k][0] += a['count']; bycat[k][1] += 1
acted = {(a['world'], tuple(a['pos']), a['slot']): a for a in plan}
kept = Counter()
for w, v in d['worlds'].items():
    for c in v['containers']:
        for i in c['items']:
            a = acted.get((w, tuple(c['pos']), i['slot']))
            n = i['count'] if not a else (a['keep'] if a['why'] == 'reduce' else 0)
            if n: kept[kept_cat(i['id'])] += n
byname = Counter()
for a in plan: byname[a['id']] += a['count'] - a.get('keep', 0) if a['why'] == 'reduce' else a['count']
out = {'census_started_utc': d['started_utc'], 'towns': towns, 'total': tot,
       'removed_by_category': {k: {'items': v[0], 'slots_freed': v[1]} for k, v in sorted(bycat.items(), key=lambda kv: -kv[1][0])},
       'kept_by_category': dict(kept.most_common()), 'removed_by_name_top': byname.most_common(25)}
if len(sys.argv) > 3: json.dump(out, open(sys.argv[3], 'w'), indent=1)
print('| Town | Containers | Full before -> after | Used slots before -> after | Items before | Removed (slots freed) | Reduced | Items after |')
print('|---|---|---|---|---|---|---|---|')
for w, t in list(towns.items()) + [('**TOTAL**', tot)]:
    print('| %s | %d | %d -> %d | %d -> %d | %s | %s (%s) | %d | %s |' % (w, t['containers'], t['full_before'], t['full_after'],
          t['used_before'], t['used_after'], format(t['items_before'], ','), format(t['items_removed'], ','),
          format(t['slots_freed'], ','), t['items_reduced'], format(t['items_after'], ',')))
print('\nRemoved by category:')
for k, v in out['removed_by_category'].items(): print('  %-62s items %8s  slots %5d' % (k, format(v['items'], ','), v['slots_freed']))
print('\nKept by category:')
for k, v in out['kept_by_category'].items(): print('  %-45s %8s' % (k, format(v, ',')))
print('\nRemoved by name (top 25):', out['removed_by_name_top'])
