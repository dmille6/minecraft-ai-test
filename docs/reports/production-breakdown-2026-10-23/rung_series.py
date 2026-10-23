"""Daily decisions per rung (milestone), fleet-wide and by world-age group, from
out/milestone_yield.json. No ES access."""
import json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
Y = json.load(open(os.path.join(HERE, 'out', 'milestone_yield.json')))
GROUPS = {'orig(~47d on 10-09)': ['board-a', 'board-c', 'board-d', 'hive-a', 'hive-b', 'placebo-c'],
          'isolated(orig)': ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d'],
          'reseed 09-19': ['placebo-a', 'placebo-b'],
          'reseed 09-27': ['board-b', 'hive-c', 'hive-d', 'placebo-d']}
RUNGS = ['stockpile_wood', 'stockpile_stone', 'gather_iron_ore_3', 'craft_stone_pickaxe_1', 'gather_dirt_16',
         'gather_sand_8', 'patrol', 'return', 'idle', 'deposit_surplus']


def rung(m):
    return (m or '').replace('+prereq', '')


days = sorted(Y)
print('FLEET decisions per day by rung (+prereq folded in)')
print(f'{"day":10s} ' + ' '.join(f'{r[:11]:>11s}' for r in RUNGS) + '      total')
for d in days:
    c = defaultdict(float)
    tot = 0
    for w, ms in Y[d].items():
        for m, ks in ms.items():
            n = sum(sum(st.values()) for st in ks.values())
            c[rung(m)] += n
            tot += n
    print(f'{d:10s} ' + ' '.join(f'{c[r]:11.0f}' for r in RUNGS) + f' {tot:10.0f}')

print('\nSHARE of decisions on the production rungs (stockpile_wood+stockpile_stone+gather_iron_ore_3+craft_*+gather_oak/cobble) by group')
print(f'{"day":10s} ' + ' '.join(f'{g[:18]:>18s}' for g in GROUPS))
for d in days:
    vals = []
    for g, ws in GROUPS.items():
        prod = tot = 0
        for w in ws:
            for m, ks in Y[d].get(w, {}).items():
                n = sum(sum(st.values()) for st in ks.values())
                tot += n
                r = rung(m)
                if r in ('stockpile_wood', 'stockpile_stone', 'gather_iron_ore_3') or r.startswith('craft_') or \
                        r in ('gather_oak_log_12', 'gather_cobblestone_8') or r.startswith('smelt_'):
                    prod += n
        vals.append(f'{100 * prod / tot:17.1f}%' if tot else '   -')
    print(f'{d:10s} ' + ' '.join(vals))

print('\nSHARE of decisions on patrol+return+idle by group')
for d in days:
    vals = []
    for g, ws in GROUPS.items():
        lap = tot = 0
        for w in ws:
            for m, ks in Y[d].get(w, {}).items():
                n = sum(sum(st.values()) for st in ks.values())
                tot += n
                if rung(m) in ('patrol', 'return', 'idle'):
                    lap += n
        vals.append(f'{100 * lap / tot:17.1f}%' if tot else '   -')
    print(f'{d:10s} ' + ' '.join(vals))
