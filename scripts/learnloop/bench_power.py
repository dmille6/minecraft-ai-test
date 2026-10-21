#!/usr/bin/env python3
"""learning-loop: power of a 20-bot MODEL BENCH (10 candidate vs 10 current), from the fleet's own null (read-only).

    nice -n 19 ionice -c3 python3 bench_power.py --days 13 --cache cells-13d.json --draws 2000

No bench exists yet, so the null is built from the fleet: an arbitrary split of bots that all ran the SAME model and
the SAME build. Any "effect" a simulated split shows is noise. Cells are per bot x 6 h window (brainread's metric
definitions). Two exclusions make the null a null, both counted and printed:
  * decisions not served by qwen2.5 (brain-01's gemma4 rows) -- the whole bot-window is dropped;
  * bot-windows whose build is not the window's majority build (a canary pool on its canary sha).
The protocol simulated is the one the design registers: period 1 of T h, a 6 h washout (excluded), period 2 of T h.
Four designs, same periods, same exclusion, same per-bot weighting where it applies:
  A  within-world parallel: each world 3/2 by bot (10 v 10), DiD period2 - period1 between the arms
  B  whole-world parallel: 2 worlds per arm
  C  within-world crossover (AB/BA): each world 3/2, sequences swap at the washout; estimate = mean over bots of the
     sequence-signed (period1 - period2) difference; a common period effect cancels because sequences are 10/10
  D  whole-world crossover: 2 worlds per sequence
Power is read from the simulated null itself, not only from a normal approximation: c = the 95th percentile of
|estimate| (a two-sided 5% test), MDE80 = the smallest shift d with P(|null + d| > c) >= 0.8. 2.8 x SD is printed
beside it. Uncertainty of the SD: a bootstrap over the distinct time offsets (the time dimension is the scarce one).
Metrics: success share, refused share, items/bot-h (brainread: positive inventory_delta on every skill row),
gathered/bot-h (the same without transfer skills: withdraws and town draws move items, they do not make them),
stagnation/bot-h.
"""
import argparse, collections, glob, gzip, json, os, random, re, statistics as st
from datetime import datetime, timedelta, timezone
ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=13); ap.add_argument('--cache')
ap.add_argument('--draws', type=int, default=2000); a = ap.parse_args()
now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
start = now - timedelta(days=a.days); S0 = start.strftime('%Y-%m-%dT%H'); S1 = now.strftime('%Y-%m-%dT%H')
W = 6
win = lambda ts: ts[:10] + 'T%02d' % (int(ts[11:13]) // W * W)
ROT = re.compile(r'-(\d{8})(?:\.gz)?$')
TRANSFER = {'withdraw', 'withdraw_pick', 'toolkit', 'smelt_town', 'furnace_drain', 'town_deposit', 'deposit',
            '_withdraw_pick', '_toolkit', '_smelt_town', '_furnace_drain', '_town_deposit'}

if a.cache and os.path.exists(a.cache):
    raw = json.load(open(a.cache))
else:
    roster = {f[:-4] for f in os.listdir('/srv/mcbots/harness/env') if f.endswith('.env') and not f.startswith('.')}
    raw = {}
    for d in sorted(glob.glob('/var/log/mcai/*-*/')):
        b = os.path.basename(d.rstrip('/'))
        if b not in roster: continue
        c = collections.defaultdict(collections.Counter); span = collections.defaultdict(list); vers = collections.defaultdict(collections.Counter)
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
                            span[k].append(ts); vers[k][((r.get('code') or {}).get('version') or '').split('+')[0][:8]] += 1
                            l = r.get('llm') or {}
                            if (l.get('latency_ms') or 0) > 0:
                                if not str(l.get('model', '')).startswith('qwen2.5'): x['nonqwen'] += 1
                                o = (r.get('outcome') or {}).get('status'); x['model'] += 1
                                x['refused'] += (o == 'aborted' and l.get('admission') is None); x['success'] += (o == 'success')
                        else:
                            sk = r.get('skill') or {}; n = sk.get('name', '')
                            if n == '_death': x['deaths'] += 1
                            if n.startswith('_stagnation') or 'STAGNANT' in (sk.get('detail') or ''): x['stagnant'] += 1
                            g = sum(v for v in (sk.get('inventory_delta') or {}).values() if isinstance(v, (int, float)) and v > 0)
                            x['items'] += g
                            if n not in TRANSFER: x['gathered'] += g
        for k, x in c.items():
            ts = sorted(span[k])
            if len(ts) < 2: continue
            h = (datetime.fromisoformat(ts[-1].replace('Z', '+00:00')) - datetime.fromisoformat(ts[0].replace('Z', '+00:00'))).total_seconds() / 3600
            raw['%s|%s' % (b, k)] = dict(x, bot_h=h, version=vers[k].most_common(1)[0][0])
    if a.cache: json.dump(raw, open(a.cache, 'w'))

# ---- the null population: same model, same build
allc = {tuple(k.split('|')): v for k, v in raw.items()}
maj = {}
for w in {w for _, w in allc}:
    vv = collections.Counter(v['version'] for (b, ww), v in allc.items() if ww == w); maj[w] = vv.most_common(1)[0][0]
ex = collections.Counter(); cells = {}
for (b, w), v in allc.items():
    if v.get('nonqwen'): ex['non-qwen bot-windows'] += 1; continue
    if v['version'] != maj[w]: ex['off-majority-build bot-windows'] += 1; continue
    cells[(b, w)] = v
bots = sorted({b for b, _ in cells}); wins = sorted({w for _, w in allc})
world = lambda b: b.rsplit('-', 1)[0]
worlds = sorted({world(b) for b in bots})
print('positive control: bots %d, worlds %d, 6h windows %d (%s .. %s); bot-windows %d kept of %d; excluded %s; '
      'model decisions kept %d, deaths %d, bot-h %.0f; draws %d'
      % (len(bots), len(worlds), len(wins), wins[0], wins[-1], len(cells), len(allc), dict(ex),
         sum(v.get('model', 0) for v in cells.values()), sum(v.get('deaths', 0) for v in cells.values()),
         sum(v['bot_h'] for v in cells.values()), a.draws))


def agg(bs, ws):
    t = collections.Counter()
    for b in bs:
        for w in ws:
            v = cells.get((b, w))
            if v and v['bot_h'] > 0.5:
                for k, x in v.items():
                    if isinstance(x, (int, float)): t[k] += x
    return t


METRICS = {
    'success_share': lambda t: t['success'] / t['model'] if t['model'] else None,
    'refused_share': lambda t: t['refused'] / t['model'] if t['model'] else None,
    'items_per_bot_h': lambda t: t['items'] / t['bot_h'] if t['bot_h'] else None,
    'gathered_per_bot_h': lambda t: t['gathered'] / t['bot_h'] if t['bot_h'] else None,
    'stagnant_per_bot_h': lambda t: t['stagnant'] / t['bot_h'] if t['bot_h'] else None,
}
fleet = agg(bots, wins)
rng = random.Random(1021)


def split_within(ws):
    A, B = [], []
    for i, w in enumerate(ws):
        bs = [b for b in bots if world(b) == w]; rng.shuffle(bs)
        k = 3 if i % 2 == 0 else 2
        A += bs[:k]; B += bs[k:]
    return A, B


def crossover(A, B, p1, p2, f):
    diffs = []
    for b in A + B:
        x1, x2 = f(agg([b], p1)), f(agg([b], p2))
        if x1 is None or x2 is None: continue
        diffs.append((x1 - x2) if b in A else (x2 - x1))
    return st.mean(diffs) if len(diffs) >= 14 else None


def parallel(A, B, p1, p2, f):
    v = [f(agg(A, p2)), f(agg(A, p1)), f(agg(B, p2)), f(agg(B, p1))]
    return None if None in v else (v[0] - v[1]) - (v[2] - v[3])


def mde80(null):
    s = sorted(abs(x) for x in null); c = s[int(0.95 * (len(s) - 1))]
    for k in range(0, 4000):
        d = c * k / 1000
        if sum(1 for x in null if abs(x + d) > c) >= 0.8 * len(null): return d
    return float('nan')


for T in (24, 72):
    n = T // W
    offs = list(range(n, len(wins) - n))                 # period1 = wins[i-n:i], washout = wins[i], period2 = wins[i+1:i+1+n]
    if not offs: continue
    print('\n== periods of %d h, 6 h washout, %d distinct time offsets' % (T, len(offs)))
    for m, f in METRICS.items():
        res = collections.defaultdict(list)
        for _ in range(a.draws):
            i = rng.choice(offs); p1, p2 = wins[i - n:i], wins[i + 1:i + 1 + n]
            ws = rng.sample(worlds, 4)
            Aw, Bw = split_within(ws)
            Ag = [b for b in bots if world(b) in ws[:2]]; Bg = [b for b in bots if world(b) in ws[2:]]
            for name, fn, A, B in (('A_within_par', parallel, Aw, Bw), ('B_world_par', parallel, Ag, Bg),
                                   ('C_within_xo', crossover, Aw, Bw), ('D_world_xo', crossover, Ag, Bg)):
                e = fn(A, B, p1, p2, f)
                if e is not None: res[name].append((i, e))
        base = f(fleet); line = '%-19s mean %7.3f |' % (m, base)
        for name in ('A_within_par', 'B_world_par', 'C_within_xo', 'D_world_xo'):
            xs = [e for _, e in res[name]]
            if len(xs) < 50: line += ' %s n/a |' % name; continue
            sd = st.pstdev(xs); md = mde80(xs)
            byoff = collections.defaultdict(list)
            for i, e in res[name]: byoff[i].append(e)
            keys = list(byoff); bsd = []
            for _ in range(200):
                pick = [rng.choice(keys) for _ in keys]; vals = [e for k in pick for e in byoff[k]]
                bsd.append(st.pstdev(vals))
            bsd.sort()
            line += ' %s MDE80 %.3f (%.0f%%) [2.8sd %.3f, sd 95%% %.3f-%.3f] |' % (name, md, 100 * md / base if base else 0, 2.8 * sd, bsd[5], bsd[194])
        print(line)
dh = fleet['deaths'] / fleet['bot_h'] if fleet['bot_h'] else 0
print('\ndeaths: %.4f/bot-h in the kept null population -> %.1f expected per 10-bot arm per 24 h' % (dh, dh * 240))
