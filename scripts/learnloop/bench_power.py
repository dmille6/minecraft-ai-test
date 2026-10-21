#!/usr/bin/env python3
"""learning-loop: power of a 20-bot MODEL BENCH (10 candidate vs 10 current), from the fleet's own null (read-only).

    nice -n 19 ionice -c3 python3 bench_power.py --days 13 --cache cells-13d-v3.json

No bench exists yet, so the null is built from the fleet: an arbitrary split of bots that all ran the SAME model and
the SAME build. Cells are per bot x 6 h window (brainread's metric definitions). Exclusions, all counted and printed:
  * a bot-window with ANY decision not served by qwen2.5 (brain-01's gemma4);
  * a bot-window with ANY row (llm or skill stream) on a MINORITY build: one seen on < 50% of the bots in that window
    (a canary or its restart-lag rows; a fleet-wide promotion is a common change and stays in);
  * the bot's NEXT window after such a cell (post-intervention: restarts and gate-state reset after a teardown).
The protocol simulated is the registered one: period 1 of T h, washout W h (excluded), period 2 of T h; usable bot =
>= 50% of each period's hours active (decision rows); a read is INCONCLUSIVE (counted) if either sequence has < 7
usable bots. Estimator for every crossover: the standard 2x2 one, tau = (mean_AB(d) - mean_BA(d)) / 2 with
d = period1 - period2 per bot -- it cancels a common period effect for ANY group sizes (Codex r2: the earlier
pooled signed mean did not when bots dropped out).

PART 1 (the registered test, design C): within-world 3/2 split; the test is a stratified re-randomization test that
re-draws the AB/BA labels within each world keeping its 3/2 count (10^4 assignments; --perms sampled), two-sided.
Its rejection rate is SIMULATED under the null (should be ~5%) and under injected effects: an additive effect delta
(as a share of the metric's null mean) on the bot's treated period. Power = rejection share. MDE80 = the smallest
grid delta with power >= 0.80.
PART 2 (design comparison, a planning approximation): the four designs' null SDs on the same schedule, MDE ~ 2.8 SD.
Metrics: gathered/bot-h (GROSS: positive inventory_delta on every skill row except transfer and conversion skills --
the registered primary), items/bot-h (brainread), stagnation/bot-h, success share, refused share.
"""
import argparse, collections, glob, gzip, json, os, random, re, statistics as st
from datetime import datetime, timedelta, timezone
ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=13); ap.add_argument('--cache')
ap.add_argument('--draws', type=int, default=400); ap.add_argument('--perms', type=int, default=400)
ap.add_argument('--period', type=int, default=72); ap.add_argument('--washout', type=int, default=6)
a = ap.parse_args()
now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
start = now - timedelta(days=a.days); S0 = start.strftime('%Y-%m-%dT%H'); S1 = now.strftime('%Y-%m-%dT%H')
W = 6
win = lambda ts: ts[:10] + 'T%02d' % (int(ts[11:13]) // W * W)
ROT = re.compile(r'-(\d{8})(?:\.gz)?$')
VER = re.compile(r'"version":"([0-9a-f]{7,40})')   # builds before ~10-13 log a 7-char sha, later ones the full sha
# NOT PRODUCTION (Claude r2): moves items between bag and chest (transfers) or turns items into other items
# (conversions: 1 log -> +4 planks counts as a positive delta). On 10-20 these were 3.6% of all positive gains (3,367 of 92,826);
# gather 48.0%, mine 32.3%, goto 12.3%, surface 2.8% carry the rest. Underscore event rows carry no inventory_delta.
TRANSFER = {'withdraw', 'withdraw_pick', 'toolkit', 'smelt_town', 'furnace_drain', 'town_deposit', 'deposit',
            'craft', 'smelt', 'compost', 'wear_out', 'dispose_well', 'count_town'}

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
                        k = win(ts)
                        mv = VER.search(line)
                        if mv: vers[k][mv.group(1)[:7]] += 1        # EVERY row's build, both streams (7-char key)
                        if kind == 'skill' and 'inventory_delta' not in line and '_death' not in line and 'tagnat' not in line and 'STAGNANT' not in line:
                            continue
                        try: r = json.loads(line)
                        except ValueError: continue
                        x = c[k]
                        if kind == 'llm':
                            span[k].append(ts)
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
            h = (datetime.fromisoformat(ts[-1].replace('Z', '+00:00')) - datetime.fromisoformat(ts[0].replace('Z', '+00:00'))).total_seconds() / 3600 if len(ts) > 1 else 0.0
            raw['%s|%s' % (b, k)] = dict(x, bot_h=h, vers=dict(vers[k]))
    if a.cache: json.dump(raw, open(a.cache, 'w'))

# ---- the null population: same model, same build, post-intervention window dropped
allc = {tuple(k.split('|')): v for k, v in raw.items()}
wins = sorted({w for _, w in allc}); bots0 = sorted({b for b, _ in allc})
# A BUILD IS "FLEET" IN A WINDOW IF >= 50% OF THE BOTS SHOW A ROW ON IT. A fleet-wide promotion puts every bot on two
# builds in one window -- a common change, which a DiD/crossover cancels -- while a canary (or its restart-lag rows)
# puts a minority of bots on a build the rest never run. Only the latter contaminates a null.
seen = collections.defaultdict(collections.Counter); nb = collections.Counter()
for (b, w), v in allc.items():
    nb[w] += 1
    for ver in v['vers']: seen[w][ver] += 1
assert all(seen[w] for w in wins), 'a window with no build on any row: the version reader is blind'
fleetb = {w: {ver for ver, k in seen[w].items() if k >= 0.5 * nb[w]} for w in wins}
ex = collections.Counter(); cells = {}
for b in bots0:
    prev_off = False
    for w in wins:
        v = allc.get((b, w))
        if v is None: prev_off = False; continue
        off = any(ver not in fleetb[w] for ver in v['vers'])
        if v.get('nonqwen'): ex['bot-windows with a non-qwen decision'] += 1
        elif off: ex['bot-windows with any row on a minority (canary) build'] += 1
        elif prev_off: ex['post-intervention bot-windows (the one after an off-build cell)'] += 1
        else: cells[(b, w)] = v
        prev_off = off or bool(v.get('nonqwen'))
bots = sorted({b for b, _ in cells})
world = lambda b: b.rsplit('-', 1)[0]
worlds = sorted({world(b) for b in bots0})
print('positive control: bots %d, worlds %d, 6h windows %d (%s .. %s); bot-windows kept %d of %d; excluded %s; '
      'model decisions kept %d, deaths %d, bot-h %.0f; draws %d, perms %d; period %d h, washout %d h'
      % (len(bots0), len(worlds), len(wins), wins[0], wins[-1], len(cells), len(allc), dict(ex),
         sum(v.get('model', 0) for v in cells.values()), sum(v.get('deaths', 0) for v in cells.values()),
         sum(v['bot_h'] for v in cells.values()), a.draws, a.perms, a.period, a.washout))


def agg(bs, ws):
    t = collections.Counter()
    for b in bs:
        for w in ws:
            v = cells.get((b, w))
            if v:
                for k, x in v.items():
                    if isinstance(x, (int, float)): t[k] += x
    return t


METRICS = {
    'gathered_per_bot_h': lambda t: t['gathered'] / t['bot_h'] if t['bot_h'] else None,
    'items_per_bot_h': lambda t: t['items'] / t['bot_h'] if t['bot_h'] else None,
    'stagnant_per_bot_h': lambda t: t['stagnant'] / t['bot_h'] if t['bot_h'] else None,
    'success_share': lambda t: t['success'] / t['model'] if t['model'] else None,
    'refused_share': lambda t: t['refused'] / t['model'] if t['model'] else None,
}
fleet = agg(bots, wins)
rng = random.Random(1021)
n = a.period // W; wo = a.washout // W
offs = list(range(n, len(wins) - n - wo + 1))           # p1 = wins[i-n:i]; washout wins[i:i+wo]; p2 = wins[i+wo:i+wo+n]


def periods(i):
    return wins[i - n:i], wins[i + wo:i + wo + n]


def usable(b, p):
    return agg([b], p)['bot_h'] >= 0.5 * a.period


def draw_worlds():
    ws = rng.sample(worlds, 4); counts = {w: (3 if k % 2 == 0 else 2) for k, w in enumerate(ws)}
    return ws, counts


def assign(ws, counts):
    AB = set()
    for w in ws:
        bs = [b for b in bots0 if world(b) == w]; rng.shuffle(bs); AB |= set(bs[:counts[w]])
    return AB


def tau(dv, AB):
    xa = [d for b, d in dv.items() if b in AB]; xb = [d for b, d in dv.items() if b not in AB]
    if len(xa) < 7 or len(xb) < 7: return None
    return (st.mean(xa) - st.mean(xb)) / 2


print('\n== PART 1: the registered test (within-world 3/2 AB/BA, stratified re-randomization, two-sided 5%%), %d distinct time offsets' % len(offs))
GRID = (0.0, 0.10, 0.15, 0.20, 0.25, 0.30)
for m in ('gathered_per_bot_h', 'stagnant_per_bot_h', 'success_share', 'refused_share'):
    f = METRICS[m]; base = f(fleet); rej = collections.Counter(); valid = 0; inconclusive = 0; unbal = 0
    for _ in range(a.draws):
        i = rng.choice(offs); p1, p2 = periods(i); ws, counts = draw_worlds(); AB = assign(ws, counts)
        dv = {}
        for w in ws:
            for b in [b for b in bots0 if world(b) == w]:
                if usable(b, p1) and usable(b, p2):
                    x1, x2 = f(agg([b], p1)), f(agg([b], p2))
                    if x1 is not None and x2 is not None: dv[b] = x1 - x2
        if tau(dv, AB) is None: inconclusive += 1; continue
        valid += 1; unbal += (sum(b in AB for b in dv) != sum(b not in AB for b in dv))
        perm = [AB2 for AB2 in (assign(ws, counts) for _ in range(a.perms))]
        for g in GRID:
            eff = g * base
            d2 = {b: (d + eff if b in AB else d - eff) for b, d in dv.items()}   # treated period gets +eff
            t_obs = tau(d2, AB)
            ts = [tau(d2, P) for P in perm]; ts = [x for x in ts if x is not None]
            p = (1 + sum(1 for x in ts if abs(x) >= abs(t_obs))) / (1 + len(ts))
            rej[g] += (p < 0.05)
    if not valid:
        print('%-19s no usable draw (every draw INCONCLUSIVE on coverage: %d)' % (m, inconclusive)); continue
    pw = {g: rej[g] / valid for g in GRID}
    mde = next((g for g in GRID[1:] if pw.get(g, 0) >= 0.8), None)
    print('%-19s null mean %.3f | usable draws %d (of them unbalanced after the exposure rule %d), INCONCLUSIVE (coverage) %d | rejection at delta=0: %.3f | power: %s | MDE80 %s'
          % (m, base, valid, unbal, inconclusive, pw.get(0.0, float('nan')),
             ', '.join('%d%% %.2f' % (round(100 * g), pw[g]) for g in GRID[1:]), ('%d%% of the mean' % round(100 * mde)) if mde else '> 30%'))

print('\n== PART 2: design comparison on the same schedule (planning approximation: MDE ~ 2.8 x null SD, %% of the mean)')


def parallel(A, B, p1, p2, f):
    v = [f(agg(A, p2)), f(agg(A, p1)), f(agg(B, p2)), f(agg(B, p1))]
    return None if None in v else (v[0] - v[1]) - (v[2] - v[3])


def xo(A, B, p1, p2, f):
    dv = {}
    for b in A + B:
        if usable(b, p1) and usable(b, p2):
            x1, x2 = f(agg([b], p1)), f(agg([b], p2))
            if x1 is not None and x2 is not None: dv[b] = x1 - x2
    return tau(dv, set(A))


for m, f in METRICS.items():
    res = collections.defaultdict(list); base = f(fleet)
    for _ in range(a.draws * 2):
        i = rng.choice(offs); p1, p2 = periods(i); ws, counts = draw_worlds()
        AB = assign(ws, counts); Aw = [b for b in bots0 if world(b) in ws and b in AB]; Bw = [b for b in bots0 if world(b) in ws and b not in AB]
        Ag = [b for b in bots0 if world(b) in ws[:2]]; Bg = [b for b in bots0 if world(b) in ws[2:]]
        for name, fn, A, B in (('within_par', parallel, Aw, Bw), ('world_par', parallel, Ag, Bg),
                               ('within_xo', xo, Aw, Bw), ('world_xo', xo, Ag, Bg)):
            e = fn(A, B, p1, p2, f)
            if e is not None: res[name].append(e)
    print('%-19s mean %7.3f | ' % (m, base) + ' | '.join('%s %.0f%%' % (k, 100 * 2.8 * st.pstdev(v) / base) if len(v) > 50 else '%s n/a' % k
                                                       for k, v in ((k, res[k]) for k in ('within_par', 'world_par', 'within_xo', 'world_xo'))))
dh = fleet['deaths'] / fleet['bot_h'] if fleet['bot_h'] else 0
print('\ndeaths: %.4f/bot-h in the kept null population -> %.1f expected per 10-bot arm per 24 h' % (dh, dh * 240))
