#!/usr/bin/env python3
"""learning-loop: power of a 20-bot MODEL BENCH (10 candidate vs 10 current), from the fleet's own null (read-only).

    nice -n 19 ionice -c3 python3 bench_power.py --days 13 --cache cells-13d-v3.json

No bench exists yet, so the null is built from the fleet: an arbitrary split of bots that all ran the SAME model and
the SAME build. Cells are per bot x 6 h window (brainread's metric definitions). Exclusions, all counted and printed:
  * a bot-window with ANY decision not served by qwen2.5 (brain-01's gemma4);
  * a bot-window with ANY row (llm or skill stream) on a MINORITY build: one seen on < 50% of the bots in that window
    (a canary or its restart-lag rows; a fleet-wide promotion is a common change and stays in);
  * the bot's NEXT window after such a cell (post-intervention: restarts and gate-state reset after a teardown).
PLANNING APPROXIMATION of the registered protocol (design s.4c; round 4). The registered read uses ELIGIBLE SCHEDULED hours
(scheduled minus recorded infrastructure intervals) and keeps inactive bots (ITT); that reader/simulator is an M6
prerequisite. Here, on the canary-gapped fleet, eligibility is approximated by ACTIVE hours. Schedule: period 1 of T h,
washout W h (excluded), period 2 of T h; usable bot =
>= 50% of each period's hours active (decision rows); a read is INCONCLUSIVE (counted) if either sequence has < 7
usable bots. Estimator for every crossover: the standard 2x2 one, tau = (mean_AB(d) - mean_BA(d)) / 2 with
d = period1 - period2 per bot -- it cancels a common period effect for ANY group sizes (Codex r2: the earlier
pooled signed mean did not when bots dropped out).

PART 1 (the registered TEST statistic, design C, under the planning exposure approximation): within-world 3/2 split; the test is a stratified re-randomization test that
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
ap.add_argument('--usable-frac', type=float, default=0.5, help='0.5 mirrors the registered 36 h coverage floor; a lower value is a PLANNING sensitivity '
               'for the fleet null only, where canary exclusions (absent on a bench) remove bot-time')
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
            ts = [datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp() for t in sorted(span[k])]
            # ACTIVE hours (Codex r3): inter-decision gaps capped at 10 min, so an outage between two decisions is not
            # counted as exposure. Decisions run ~every 40 s on a live bot.
            h = sum(min(b2 - b1, 600) for b1, b2 in zip(ts, ts[1:])) / 3600
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
# CANARY EXPOSURE FROM THE DEPLOYMENT JOURNAL (Codex r3): pool x [deployed, first torn-down/promoted after it + 6 h].
# This also catches env/config-only canaries on the same sha, which a build-based rule cannot see (Claude r3).
JOURNAL = os.path.expanduser('~/canary-journal.jsonl'); expo = []
if os.path.exists(JOURNAL):
    J = []
    for line in open(JOURNAL, errors='replace'):
        try: J.append(json.loads(line))
        except ValueError: pass
    for i, r in enumerate(J):
        if r.get('phase') != 'deployed': continue
        pools = (r.get('note') or '').split(' ')[0].split(',')
        t0 = datetime.fromisoformat(r['ts'].replace('Z', '+00:00'))
        end = next((datetime.fromisoformat(q['ts'].replace('Z', '+00:00')) for q in J[i + 1:]
                    if q.get('run') == r.get('run') and q.get('phase') in ('torn-down', 'promoted')), now)
        known = {x.rsplit('-', 1)[0] for x in os.listdir('/var/log/mcai') if '-' in x}
        assert pools and all(p in known for p in pools), 'journal note does not parse to pool names: %r' % r.get('note')
        expo.append((set(pools), t0, end + timedelta(hours=6), end == now))
wstart = lambda w: datetime.strptime(w, '%Y-%m-%dT%H').replace(tzinfo=timezone.utc)
def journal_exposed(b, w):
    a0 = wstart(w); a1 = a0 + timedelta(hours=W); pool = b.rsplit('-', 1)[0]
    return any(pool in ps and t0 < a1 and a0 < t1 for ps, t0, t1, _ in expo)
ex = collections.Counter(); cells = {}
for b in bots0:
    prev_off = False
    for w in wins:
        v = allc.get((b, w))
        if v is None: prev_off = False; continue
        off = any(ver not in fleetb[w] for ver in v['vers'])
        if v.get('nonqwen'): ex['bot-windows with a non-qwen decision'] += 1
        elif journal_exposed(b, w): ex['bot-windows inside a journal canary interval (+6 h)'] += 1
        elif off: ex['bot-windows with any row on a minority (canary) build'] += 1
        elif prev_off: ex['post-intervention bot-windows (the one after an off-build cell)'] += 1
        else: cells[(b, w)] = v
        prev_off = off or bool(v.get('nonqwen'))
bots = sorted({b for b, _ in cells})
world = lambda b: b.rsplit('-', 1)[0]
worlds = sorted({world(b) for b in bots0})
print('canary intervals read from the journal: %d (open-ended, end = now: %d)' % (len(expo), sum(1 for e in expo if e[3])))
print('NOTE: a HETEROGENEOUS PLANNING BASELINE, not a same-treatment null: fleet-wide promotions (common changes) stay in.')
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
    return agg([b], p)['bot_h'] >= a.usable_frac * a.period


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


print('\n== PART 1: the registered test statistic, planning exposure approximation (within-world 3/2 AB/BA, stratified re-randomization, two-sided 5%%), %d distinct time offsets; usable = >= %.0f%% of each period active' % (len(offs), 100 * a.usable_frac))
print('   effects: ADD = +delta x null mean on the treated period; MULT = treated-period value x (1 + delta). power = conditional on a')
print('   usable draw; "uncond" divides by all draws; "pos" counts only rejections with tau > 0 (what KEEP needs)')
GRID = (0.0, 0.10, 0.15, 0.20, 0.25, 0.30)


def excluded_any(b, ps):
    return any((b, w) not in cells and (b, w) in allc for w in ps)


for m in ('gathered_per_bot_h', 'stagnant_per_bot_h', 'success_share', 'refused_share'):
    f = METRICS[m]; base = f(fleet); rej = collections.Counter(); pos = collections.Counter(); valid = 0; inconclusive = 0; unbal = 0
    why = collections.Counter(); dropped_perms = 0; null_tau = []
    for _ in range(a.draws):
        i = rng.choice(offs); p1, p2 = periods(i); ws, counts = draw_worlds(); AB = assign(ws, counts)
        dv, x12 = {}, {}
        for w in ws:
            for b in [b for b in bots0 if world(b) == w]:
                if usable(b, p1) and usable(b, p2):
                    x1, x2 = f(agg([b], p1)), f(agg([b], p2))
                    if x1 is not None and x2 is not None: dv[b] = x1 - x2; x12[b] = (x1, x2)
                else:
                    why['bot unusable: has excluded (canary/off-build) cells' if excluded_any(b, p1 + p2) else 'bot unusable: < 36 active bot-h, no excluded cell'] += 1
        if tau(dv, AB) is None: inconclusive += 1; continue
        valid += 1; unbal += (sum(b in AB for b in dv) != sum(b not in AB for b in dv))
        perm = [assign(ws, counts) for _ in range(a.perms)]
        for kind in ('ADD', 'MULT'):
            for g in GRID:
                if kind == 'MULT' and g == 0.0: continue
                if kind == 'ADD':
                    eff = g * base; d2 = {b: (d + eff if b in AB else d - eff) for b, d in dv.items()}
                else:
                    d2 = {b: (d + g * x12[b][0] if b in AB else d - g * x12[b][1]) for b, d in dv.items()}
                t_obs = tau(d2, AB)
                ts = [tau(d2, P) for P in perm]; ok = [x for x in ts if x is not None]
                if kind == 'ADD' and g == 0.0: dropped_perms += len(ts) - len(ok); null_tau.append(t_obs)
                p = (1 + sum(1 for x in ok if abs(x) >= abs(t_obs))) / (1 + len(ok))
                rej[(kind, g)] += (p < 0.05); pos[(kind, g)] += (p < 0.05 and t_obs > 0)
    if not valid:
        print('%-19s no usable draw (every draw INCONCLUSIVE on coverage: %d)' % (m, inconclusive)); continue
    tot_d = valid + inconclusive
    print('%-19s null mean %.3f | draws %d: usable %d (unbalanced %d), INCONCLUSIVE %d; unusable-bot reasons %s; permutations dropped '
          'by the 7-per-sequence rule %d of %d; null SD of tau %.3f (%.1f%% of the mean)'
          % (m, base, tot_d, valid, unbal, inconclusive, dict(why), dropped_perms, valid * a.perms, st.pstdev(null_tau), 100 * st.pstdev(null_tau) / base))
    for kind in ('ADD', 'MULT'):
        row = []
        for g in GRID:
            if (kind, g) not in rej and not (kind == 'ADD' and g == 0.0): continue
            row.append('%d%%: %.2f (uncond %.2f, pos %.2f)' % (round(100 * g), rej[(kind, g)] / valid, rej[(kind, g)] / tot_d, pos[(kind, g)] / valid))
        mde = next((g for g in GRID[1:] if rej[(kind, g)] / valid >= 0.8), None)
        print('   %-4s %s | MDE80 (conditional) %s' % (kind, ' | '.join(row), ('%d%%' % round(100 * mde)) if mde else '> 30%'))

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
