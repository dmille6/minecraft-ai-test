"""r2 (Codex r1 P2-13): episodes split at deaths; the random-point base rate (fleet and PER BOT, so a bot's own
entombment frequency is the control); the suffocation association against each dead bot's own base rate; and
whether a climb (y rise >= 3 within the 10 min) preceded each suffocation."""
import json, gzip, collections, os, math, random, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)) + '/'
X = json.load(gzip.open(D + 'entomb7d.json.gz', 'rt'))   # es5.py writes entomb7d.json; gzip -k it on the host
deaths = json.load(open(D + 'deaths7d.json'))
C = collections.Counter


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()


DE = collections.defaultdict(list)
for d in deaths:
    DE[d['bot']['name']].append(P(d['@timestamp']))
by = collections.defaultdict(list)
for r in X['_entombed']:
    by[r['bot']['name']].append((P(r['@timestamp']), r['bot']['pos']))
eps = collections.defaultdict(list)
for b, rs in by.items():
    rs.sort(key=lambda x: x[0]); cur = None
    for t, p in rs:
        died_between = cur and any(cur['last'] < dt_ <= t for dt_ in DE[b])
        if cur and not died_between and t - cur['last'] <= 600 and math.dist((p['x'], p['y'], p['z']), cur['p']) <= 4:
            cur['last'] = t; cur['n'] += 1; continue
        cur = {'first': t, 'last': t, 'n': 1, 'p': (p['x'], p['y'], p['z'])}
        eps[b].append(cur)
n = sum(len(v) for v in eps.values())
single = sum(1 for v in eps.values() for e in v if e['n'] == 1)
print(f'episodes split at deaths: {n}, single firing {single} ({100*single/n:.1f}%)')
T1 = dt.datetime(2026, 10, 23, 14, tzinfo=dt.timezone.utc).timestamp(); T0 = T1 - 7 * 86400


def covered(b, t):
    return any(e['first'] <= t <= e['last'] + 600 for e in eps[b])


random.seed(1)
bots = sorted(by)
fleet = sum(covered(random.choice(bots), random.uniform(T0 + 600, T1)) for _ in range(20000)) / 20000
print(f'fleet base rate (random bot-time points with an episode in the prior 10 min): {100*fleet:.1f}%')
per_bot = {}
for b in bots:
    per_bot[b] = sum(covered(b, random.uniform(T0 + 600, T1)) for _ in range(2000)) / 2000
# each death class: observed share with an episode in the prior 10 min vs the expected share from each dead bot's OWN rate
for cls in ('suffocation', 'drowning', 'fire', 'fall', 'other'):
    ds = [(d['bot']['name'], P(d['@timestamp'])) for d in deaths if d['skill']['fail_class'] == cls]
    obs = sum(covered(b, t) for b, t in ds)
    exp_ = sum(per_bot.get(b, 0) for b, t in ds)
    # P(all observed) under independence with per-bot rates, for the all-covered case
    pall = math.prod(per_bot.get(b, 0) for b, t in ds) if obs == len(ds) else None
    print(f'{cls:12} n={len(ds):3} with episode <=10 min before: {obs:3}  expected from own bots {exp_:6.1f}' + (f'  P(all) {pall:.2g}' if pall is not None else ''))
# climb before suffocation: max y of entombed/marooned rows in the 10 min before vs the first such row
mar = collections.defaultdict(list)
for r in X['_marooned'] + X['_entombed']:
    mar[r['bot']['name']].append((P(r['@timestamp']), r['bot']['pos']['y']))
rise = C()
for d in deaths:
    if d['skill']['fail_class'] != 'suffocation':
        continue
    b = d['bot']['name']; t = P(d['@timestamp'])
    ys = sorted((tt, y) for tt, y in mar[b] if t - 600 <= tt <= t)
    r_ = (max(y for _, y in ys) - ys[0][1]) if ys else None
    last = (t - ys[-1][0]) if ys else None
    rise['rose >= 3 across the rows' if r_ is not None and r_ >= 3 else ('no rise' if r_ is not None else 'no rows')] += 1
    print(f'  {d["@timestamp"][:19]} {b:18} rows={len(ys):2} rise={r_} last_row_before_death={last and round(last)}s death_y={d["bot"]["pos"]["y"]}')
print(rise)
