#!/usr/bin/env python3
"""learning-loop: power of a 20-bot MODEL BENCH (10 candidate vs 10 current), from the fleet's own null (read-only).

    nice -n 19 python3 bench_power.py --days 7 [--cache cells.json]

No bench exists yet, so the null is built from the fleet as it is: every bot on the SAME model and the same code
family, so any "effect" a simulated split shows is noise. Per bot and per 6 h window (brainread's definitions):
model decisions, success share, refused share, items/bot-h (positive inventory_delta on all skill rows),
stagnation/bot-h, deaths. Then, many times: draw 4 worlds of 16 (a bench has 4), split their 20 bots 10 v 10 and
compute the arm difference three ways:
  A  parallel, within-world split (each world 2-3 bots per arm), DiD after-minus-before over T hours;
  B  parallel, whole-world split (2 worlds per arm), DiD over T hours;
  C  daily crossover (AB/BA by bot, swap each day; each bot is its own control), effect = mean within-bot
     difference of the two periods, sign by sequence.
SD of each over the draws -> MDE80 = 2.8 * SD, also as % of the fleet mean. Positive control printed first.
"""
import argparse, collections, glob, gzip, json, os, random, re, statistics as st
from datetime import datetime, timedelta, timezone
ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=7); ap.add_argument('--cache')
ap.add_argument('--draws', type=int, default=2000); a = ap.parse_args()
now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
start = now - timedelta(days=a.days); S0 = start.strftime('%Y-%m-%dT%H'); S1 = now.strftime('%Y-%m-%dT%H')
W = 6
win = lambda ts: ts[:10] + 'T%02d' % (int(ts[11:13]) // W * W)
ROT = re.compile(r'-(\d{8})(?:\.gz)?$')

if a.cache and os.path.exists(a.cache):
    cells = {tuple(k.split('|')): v for k, v in json.load(open(a.cache)).items()}
else:
    roster = {f[:-4] for f in os.listdir('/srv/mcbots/harness/env') if f.endswith('.env')}
    cells = {}
    for d in sorted(glob.glob('/var/log/mcai/*-*/')):
        b = os.path.basename(d.rstrip('/'))
        if b not in roster: continue
        c = collections.defaultdict(lambda: collections.Counter()); span = collections.defaultdict(list)
        for kind in ('llm', 'skill'):
            for f in glob.glob('%s/%s-%s.jsonl*' % (d, kind, b)):
                m = ROT.search(f)
                if m and m.group(1) < start.strftime('%Y%m%d'): continue
                op = gzip.open if f.endswith('.gz') else open
                with op(f, 'rt', errors='replace') as fh:
                    for line in fh:
                        if not line.startswith('{"@timestamp":"'): continue
                        ts = line[15:39]
                        if ts[:13] < S0 or ts[:13] >= S1: continue
                        if kind == 'skill' and 'inventory_delta' not in line and '_death' not in line and 'tagnat' not in line and 'STAGNANT' not in line:
                            continue
                        try: r = json.loads(line)
                        except ValueError: continue
                        k = win(ts); x = c[k]
                        if kind == 'llm':
                            span[k].append(ts)
                            l = r.get('llm') or {}
                            if (l.get('latency_ms') or 0) > 0:
                                o = (r.get('outcome') or {}).get('status'); x['model'] += 1
                                x['refused'] += (o == 'aborted' and l.get('admission') is None); x['success'] += (o == 'success')
                        else:
                            sk = r.get('skill') or {}; n = sk.get('name', '')
                            if n == '_death': x['deaths'] += 1
                            if n.startswith('_stagnation') or 'STAGNANT' in (sk.get('detail') or ''): x['stagnant'] += 1
                            x['items'] += sum(v for v in (sk.get('inventory_delta') or {}).values() if isinstance(v, (int, float)) and v > 0)
        for k, x in c.items():
            ts = sorted(span[k])
            if len(ts) < 2: continue
            h = (datetime.fromisoformat(ts[-1].replace('Z', '+00:00')) - datetime.fromisoformat(ts[0].replace('Z', '+00:00'))).total_seconds() / 3600
            cells[(b, k)] = dict(x, bot_h=h)
    if a.cache:
        json.dump({'|'.join(k): v for k, v in cells.items()}, open(a.cache, 'w'))

bots = sorted({b for b, _ in cells}); wins = sorted({w for _, w in cells})
world = lambda b: b.rsplit('-', 1)[0]
worlds = sorted({world(b) for b in bots})
print('positive control: bots %d, worlds %d, 6h windows %d (%s .. %s), model decisions %d, deaths %d, bot-h %.0f'
      % (len(bots), len(worlds), len(wins), wins[0], wins[-1], sum(v.get('model', 0) for v in cells.values()),
         sum(v.get('deaths', 0) for v in cells.values()), sum(v['bot_h'] for v in cells.values())))
full = [w for w in wins if sum(1 for b in bots if (b, w) in cells and cells[(b, w)]['bot_h'] > 3) >= 0.9 * len(bots)]
print('complete windows (>= 90%% of bots with > 3 bot-h): %d' % len(full))


def agg(bs, ws):
    t = collections.Counter()
    for b in bs:
        for w in ws:
            v = cells.get((b, w))
            if v:
                for k, x in v.items(): t[k] += x
    return t


METRICS = {
    'success_share': lambda t: t['success'] / t['model'] if t['model'] else None,
    'refused_share': lambda t: t['refused'] / t['model'] if t['model'] else None,
    'items_per_bot_h': lambda t: t['items'] / t['bot_h'] if t['bot_h'] else None,
    'stagnant_per_bot_h': lambda t: t['stagnant'] / t['bot_h'] if t['bot_h'] else None,
}
fleet = agg(bots, full)
rng = random.Random(1021)


def split_within(ws):
    A, B = [], []
    for i, w in enumerate(ws):
        bs = [b for b in bots if world(b) == w]; rng.shuffle(bs)
        k = 3 if i % 2 == 0 else 2                      # 3+2+3+2 = 10 per arm
        A += bs[:k]; B += bs[k:]
    return A, B


for T in (6, 24, 72):
    n = T // W
    if 2 * n > len(full): continue
    print('\n== window T = %d h after (and %d h before for DiD)' % (T, T))
    for m, f in METRICS.items():
        res = {'A_within': [], 'B_world': [], 'C_crossover': []}
        for _ in range(a.draws):
            i = rng.randrange(n, len(full) - n + 1); before, after = full[i - n:i], full[i:i + n]
            ws = rng.sample(worlds, 4)
            for name in ('A_within', 'B_world'):
                if name == 'A_within': A, B = split_within(ws)
                else: A = [b for b in bots if world(b) in ws[:2]]; B = [b for b in bots if world(b) in ws[2:]]
                v = [f(agg(A, after)), f(agg(A, before)), f(agg(B, after)), f(agg(B, before))]
                if None not in v: res[name].append((v[0] - v[1]) - (v[2] - v[3]))
            # crossover: two periods of T h; seq AB bots get A first. Effect estimate = mean over bots of
            # (period-A value - period-B value); under the null its SD is the noise.
            A, B = split_within(ws); diffs = []
            for b in A + B:
                p1, p2 = f(agg([b], before)), f(agg([b], after))
                if p1 is None or p2 is None: continue
                diffs.append((p1 - p2) if b in A else (p2 - p1))
            if len(diffs) >= 16: res['C_crossover'].append(st.mean(diffs))
        base = f(fleet)
        line = '%-19s fleet mean %8.3f |' % (m, base)
        for name, xs in res.items():
            sd = st.pstdev(xs) if len(xs) > 10 else float('nan')
            line += ' %s sd %.3f MDE80 %.3f (%.0f%%) |' % (name, sd, 2.8 * sd, 100 * 2.8 * sd / base if base else 0)
        print(line)
# deaths: the rate the death gate would see on 10 bots
dh = fleet['deaths'] / fleet['bot_h'] if fleet['bot_h'] else 0
print('\ndeaths: fleet %.4f/bot-h -> expected %.1f per 10-bot arm per 24 h; the two-death floor needs ~%.0f h at that rate'
      % (dh, dh * 240, 2 / (dh * 10) if dh else 0))
