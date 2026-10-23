"""Death rate per bot-hour by depth band: exposure = 10-min (bot, bucket) cells by their average y (ES es3.json)."""
import json, collections, os, sys
D = os.path.dirname(os.path.abspath(__file__)) + '/'
sys.path.insert(0, D)
from d1 import cls
E = json.load(open(D + 'es3.json'))
deaths = json.load(open(D + 'deaths7d.json'))
bands = [('>=64', 64, 999), ('48..63', 48, 63.99), ('32..47', 32, 47.99), ('16..31', 16, 31.99), ('0..15', 0, 15.99),
         ('-32..-1', -32, -0.01), ('-64..-33', -99, -32.01)]
exp = collections.Counter()
for k, n in E['depth_avg_y_by8'].items():
    y = int(k) + 4
    for name, lo, hi in bands:
        if lo <= y <= hi:
            exp[name] += n / 6
dc = collections.defaultdict(collections.Counter)
for d in deaths:
    y = d['bot']['pos']['y']
    for name, lo, hi in bands:
        if lo <= y <= hi:
            c = cls(d); g = 'lava' if c in ('lava', 'lava-fall', 'magma') else c
            dc[name][g] += 1; dc[name]['ALL'] += 1
tot = sum(exp.values())
print(f'exposure total {tot:.0f} bot-h (ES coverage 13440)')
cols = ['ALL', 'lava', 'drowning', 'fall', 'dripstone', 'suffocation']
print('band'.ljust(10), 'bot-h'.rjust(8), 'share'.rjust(7), *[c.rjust(10) for c in cols], ' all/100bh  lava/100bh')
for name, lo, hi in bands:
    h = exp[name]
    print(name.ljust(10), f'{h:8.0f}', f'{100*h/tot:6.1f}%', *[str(dc[name][c]).rjust(10) for c in cols],
          f'  {100*dc[name]["ALL"]/h:8.2f}  {100*dc[name]["lava"]/h:8.2f}')
