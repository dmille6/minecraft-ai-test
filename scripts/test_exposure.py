import os, sys, datetime as dt
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from exposure import bot_hours, rate, NoExposure

def row(bot, mins, kind='gather'):
    t = dt.datetime(2026, 9, 23, 12, 0, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=mins)
    return {'@timestamp': t.isoformat().replace('+00:00', 'Z'), 'bot': {'name': bot},
            'skill': {'name': kind}}

ok = []
def check(name, got, want, why):
    good = got == want
    ok.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {name}: got {got}, want {want}")
    if not good: print(f"         {why}")

# 1. two bots, 60 and 30 minutes of observed span
rows = [row('a', 0), row('a', 60), row('b', 0), row('b', 30)]
h, n, per = bot_hours(rows)
check('summed per-bot spans', (round(h, 3), n), (1.5, 2), 'a=1.0h + b=0.5h over 2 bots')

# 2. THE DEFECT THIS FILE EXISTS FOR: a filtered numerator must not change the denominator.
deaths = [r for r in rows if r['skill']['name'] == '_death']
r1, h1, n1 = rate(len(deaths), rows)
rows2 = rows + [row('a', 45, '_death')]
deaths2 = [r for r in rows2 if r['skill']['name'] == '_death']
r2, h2, n2 = rate(len(deaths2), rows2)
check('denominator unmoved by the outcome', (round(h1, 3), round(h2, 3)), (1.5, 1.5),
      'adding a death inside the existing span must not change exposure -- the old '
      'freeze-verdict divided by bots that DIED, so the denominator moved with the outcome')

# 3. a bot that stopped early accrues only what it was there for
rows3 = [row('a', 0), row('a', 180), row('b', 0), row('b', 10)]
h3, n3, _ = bot_hours(rows3)
check('a bot that stopped stops accruing', (round(h3, 3), n3), (3.167, 2),
      'wall-clock x bot count would call this 6.0 bot-h and halve every rate')

# 4. zero must RAISE, not return 0
try:
    bot_hours([])
    check('zero raises', 'returned', 'NoExposure', 'a zero denominator is an instrument failure')
except NoExposure:
    check('zero raises', 'NoExposure', 'NoExposure', '')

# 5. and allow_zero is the documented escape hatch
try:
    h5, n5, _ = bot_hours([], allow_zero=True)
    check('allow_zero permits it', (h5, n5), (0.0, 0), '')
except NoExposure:
    check('allow_zero permits it', 'raised', '(0.0, 0)', '')

# 6. grouping
g = bot_hours(rows, key=lambda r: 'canary' if r['bot']['name'] == 'a' else 'control')
check('grouped', (round(g['canary'][0], 3), round(g['control'][0], 3)), (1.0, 0.5), '')

print(f"\n{sum(ok)}/{len(ok)} exposure tests pass")
sys.exit(0 if all(ok) else 1)
