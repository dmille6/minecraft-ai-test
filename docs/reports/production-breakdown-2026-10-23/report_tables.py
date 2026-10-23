"""The report's per-world, depletion, reflex-time and other tables, from the out/*.json files.
No ES access. BASE = 10-08..10-10, END = 10-20..10-22 (3 whole days each)."""
import os, sys, json
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
O = lambda n: json.load(open(os.path.join(HERE, 'out', n)))
A = O('analyze.json')
S = O('sample_state.json')
Y = O('milestone_yield.json')
L = O('llm_daily.json')
BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']
WORLDS = sorted(A[BASE[0]])
GROUPS = {'orig': ['board-a', 'board-c', 'board-d', 'hive-a', 'hive-b', 'placebo-c'],
          'isolated': ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d'],
          'rs0919': ['placebo-a', 'placebo-b'], 'rs0927': ['board-b', 'hive-c', 'hive-d', 'placebo-d']}
BH = 120.0   # bot-hours per world-day: coverage() read 120.0 for every world on every whole day (daily_skill_aggs)


def mean(days, w, f):
    vals = [f(A[d][w]) for d in days if w in A[d]]
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def g(x, k, sub=None):
    v = x.get(k, {})
    return v.get(sub, 0) if sub is not None else v


def section(t):
    print('\n' + '=' * 100 + '\n' + t + '\n' + '=' * 100)


# ---------------------------------------------------------------- per-world production
section('1. PER WORLD: production per bot-hour, BASE (10-08..10) -> END (10-20..22); 120 bot-h per world-day')
M = [('gather ok', lambda x: x['gather_ok'] / BH), ('  log ok', lambda x: g(x, 'gather_ok_by', 'log') / BH),
     ('  stone ok', lambda x: g(x, 'gather_ok_by', 'stone') / BH), ('  dirt ok', lambda x: g(x, 'gather_ok_by', 'dirt') / BH),
     ('mine ok', lambda x: x['mine_ok'] / BH), ('craft ok', lambda x: sum(c.get('success', 0) for c in x['craft_by'].values()) / BH),
     ('td ok', lambda x: x['td_ok'] / BH), ('td n', lambda x: x['td_n'] / BH),
     ('ore items', lambda x: (g(x, 'gather_items_by', 'ore') + g(x, 'mine_items_by', 'ore')) / BH),
     ('log items', lambda x: (g(x, 'gather_items_by', 'log') + g(x, 'mine_items_by', 'log')) / BH)]
print(f'{"world":11s} ' + ' '.join(f'{n:>17s}' for n, _ in M))
tot = defaultdict(lambda: [0.0, 0.0])
for w in WORLDS:
    cells = []
    for n, f in M:
        b, e = mean(BASE, w, f), mean(END, w, f)
        tot[n][0] += b
        tot[n][1] += e
        cells.append(f'{b:6.2f}->{e:6.2f}{"*" if e < b else " "}  ')
    print(f'{w:11s} ' + ' '.join(cells))
print(f'{"FLEET/day":11s} ' + ' '.join(f'{tot[n][0] * BH:7.0f}->{tot[n][1] * BH:7.0f} ' for n, _ in M))

section('1b. Each world\'s share of the fleet change (events/day, END - BASE); sums to the fleet delta')
for n, f in M[:1] + M[4:7]:
    rows = []
    for w in WORLDS:
        rows.append((w, (mean(END, w, f) - mean(BASE, w, f)) * BH))
    s = sum(v for _, v in rows)
    print(f'-- {n}: fleet {s:+.0f}/day; ' + ', '.join(f'{w} {v:+.0f}' for w, v in sorted(rows, key=lambda r: r[1])))
    med = sorted(v for _, v in rows)[len(rows) // 2]
    print(f'   median world {med:+.0f}/day x 16 = {16 * med:+.0f}; worlds declining {sum(v < 0 for _, v in rows)}/16')

# ---------------------------------------------------------------- age groups
section('2. WORLD-AGE GROUPS (age on 10-09: orig ~47 d of server ticks, reseed 09-19 ~20 d, reseed 09-27 ~12 d)')
for gname, ws in GROUPS.items():
    line = []
    for n, f in M[:1] + M[4:6]:
        b = sum(mean(BASE, w, f) for w in ws) / len(ws)
        e = sum(mean(END, w, f) for w in ws) / len(ws)
        line.append(f'{n} {b:5.2f}->{e:5.2f} ({100 * (e - b) / b:+4.0f}%)')
    ticks = [A['2026-10-09'][w]['tick_med'] for w in ws]
    print(f'{gname:9s} n={len(ws)}  ' + ' | '.join(line) + f' | ticks(10-09) {min(ticks) / 1.728e6:.1f}-{max(ticks) / 1.728e6:.1f} d')

# ---------------------------------------------------------------- depletion
section('3. DEPLETION, measured directly')
print('3a. What the bot can see at decision time (LLM sample, 4 h/day): share of decisions, BASE -> END')
K = ['log16', 'log32', 'iron32', 'sand32', 'dirt8', 'far100', 'deep8']
for key in ['fleet'] + ['g:' + x for x in GROUPS]:
    b = {k: sum(S[d][key][k] for d in BASE) / 3 for k in K}
    e = {k: sum(S[d][key][k] for d in END) / 3 for k in K}
    nb = sum(S[d][key]['n'] for d in BASE)
    ne = sum(S[d][key]['n'] for d in END)
    print(f'  {key:11s} n {nb:6d}/{ne:6d}  ' + '  '.join(f'{k} {100 * b[k]:4.1f}->{100 * e[k]:4.1f}' for k in K))
print('3a-world. log16 by world, BASE -> END')
print('  ' + ', '.join(f'{w} {100 * sum(S[d][w]["log16"] for d in BASE) / 3:.0f}->{100 * sum(S[d][w]["log16"] for d in END) / 3:.0f}'
                     for w in WORLDS))

print('\n3b. Distance from home of SUCCESSFUL gathers (median / p75 / p90, blocks; n per day), by item class')
for c in ('all', 'log', 'dirt', 'stone', 'ore'):
    def q(days, i):
        vals = [A[d][w]['gok_dist_q'].get(c, [None] * 4)[i] for d in days for w in WORLDS if A[d][w]['gok_dist_q'].get(c)]
        vals = [v for v in vals if v is not None]
        return sorted(vals)[len(vals) // 2] if vals else None
    nb = sum(A[d][w]['gok_dist_q'].get(c, [0, 0, 0, 0])[3] for d in BASE for w in WORLDS) / 3
    ne = sum(A[d][w]['gok_dist_q'].get(c, [0, 0, 0, 0])[3] for d in END for w in WORLDS) / 3
    print(f'  {c:6s} median-of-world-medians {q(BASE, 0)} -> {q(END, 0)}; p75 {q(BASE, 1)} -> {q(END, 1)}; '
          f'p90 {q(BASE, 2)} -> {q(END, 2)};  n/day {nb:.0f} -> {ne:.0f}')
print('3b-world. median distance of successful LOG gathers, per world (BASE days -> END days)')
for w in WORLDS:
    b = [A[d][w]['gok_dist_q'].get('log', [None])[0] for d in BASE]
    e = [A[d][w]['gok_dist_q'].get('log', [None])[0] for d in END]
    nb = [A[d][w]['gok_dist_q'].get('log', [0, 0, 0, 0])[3] for d in BASE]
    ne = [A[d][w]['gok_dist_q'].get('log', [0, 0, 0, 0])[3] for d in END]
    print(f'  {w:11s} {b} (n {nb}) -> {e} (n {ne})')

print('\n3c. Gather outcome shares by item class (all attempts of that class, BASE -> END)')
for c in ('log', 'stone', 'dirt', 'sand', 'ore'):
    def sh(days):
        cnt = defaultdict(float)
        for d in days:
            for w in WORLDS:
                for o, n in A[d][w]['gather_out_by'].get(c, {}).items():
                    cnt[o] += n
        t = sum(cnt.values())
        return cnt, t
    b, tb = sh(BASE)
    e, te = sh(END)
    print(f'  {c:6s} attempts/day {tb / 3:6.0f} -> {te / 3:6.0f}  ' + '  '.join(
        f'{o} {100 * b[o] / tb:4.1f}->{100 * e[o] / te:4.1f}' for o in
        ('ok', 'nothing_found', 'no_safe_target', 'canopy', 'no_path', 'unreachable', 'interrupted')))

print('\n3d. Travel per success: (explore h + LLM goto h) per 100 production successes (gather+mine), and per hour of gather')
for key, ws in [('fleet', WORLDS)] + list(GROUPS.items()):
    def tr(days):
        ex = sum(A[d][w]['explore_h'] + A[d][w]['goto_h_trig'].get('llm', 0) + A[d][w]['goto_h_trig'].get('interrupt:entombed', 0) * 0
                 for d in days for w in ws)
        su = sum(A[d][w]['gather_ok'] + A[d][w]['mine_ok'] for d in days for w in ws)
        return ex, su
    eb, sb = tr(BASE)
    ee, se = tr(END)
    print(f'  {key:9s} travel h/day {eb / 3:6.1f} -> {ee / 3:6.1f};  per 100 successes {100 * eb / sb:5.2f} -> {100 * ee / se:5.2f} h')

print('\n3e. Yield per gather-hour (successes per hour spent inside gather), by class')
for c in ('log', 'stone', 'dirt', 'ore', 'sand'):
    def y(days):
        ok = sum(g(A[d][w], 'gather_ok_by', c) for d in days for w in WORLDS)
        h = sum(g(A[d][w], 'gather_h_by', c) for d in days for w in WORLDS)
        it = sum(g(A[d][w], 'gather_items_by', c) for d in days for w in WORLDS)
        return ok, h, it
    ob, hb, ib = y(BASE)
    oe, he, ie = y(END)
    print(f'  {c:6s} ok/gather-h {ob / hb if hb else 0:6.1f} -> {oe / he if he else 0:6.1f};  gather-h/day {hb / 3:6.1f} -> {he / 3:6.1f}')

# ---------------------------------------------------------------- reflex / safety time
section('4. BOT-TIME (hours per day, fleet of 1,920 bot-h), ranked by END hours')
def bt(days):
    out = defaultdict(float)
    for d in days:
        for w in WORLDS:
            x = A[d][w]
            for k, h in x['skill_h'].items():
                out['skill:' + k] += h / 3
            for t, h in x['goto_h_trig'].items():
                out['goto by ' + t] += h / 3
            for t, h in x['home_h_trig'].items():
                out['home by ' + t] += h / 3
            for t, h in x['surface_h_trig'].items():
                out['surface by ' + t] += h / 3
            for t, h in x['explore_h_trig'].items():
                out['explore by ' + t] += h / 3
            out['water float held'] += x['float_s'] / 3600 / 3
            out['water surface held'] += x['surface_float_s'] / 3600 / 3
            out['water no-air-route held'] += x['noair_s'] / 3600 / 3
    return out
b, e = bt(BASE), bt(END)
REFLEX = [k for k in set(b) | set(e) if any(s in k for s in ('livelock', 'watchdog', 'interrupt:', 'water ', 'stranded'))
          and not k.startswith('skill:')]
print('  safety / reflex-driven time (skills launched by a reflex or watchdog, or after an interrupt, plus water holds):')
rb = re = 0
for k in sorted(REFLEX, key=lambda k: -e.get(k, 0)):
    if e.get(k, 0) > 0.3 or b.get(k, 0) > 0.3:
        print(f'    {k:40s} {b.get(k, 0):6.1f} -> {e.get(k, 0):6.1f}')
    rb += b.get(k, 0)
    re += e.get(k, 0)
print(f'    {"TOTAL reflex/safety":40s} {rb:6.1f} -> {re:6.1f}  ({100 * rb / 1920:.1f}% -> {100 * re / 1920:.1f}% of bot-time)')
print('  all skill time:')
for k in sorted([k for k in set(b) | set(e) if k.startswith('skill:')], key=lambda k: -e.get(k, 0))[:14]:
    print(f'    {k:40s} {b.get(k, 0):6.1f} -> {e.get(k, 0):6.1f}')
sb_ = sum(v for k, v in b.items() if k.startswith('skill:'))
se_ = sum(v for k, v in e.items() if k.startswith('skill:'))
print(f'    {"TOTAL in skills":40s} {sb_:6.1f} -> {se_:6.1f}')
print('  reflex EVENT counts per day (count, not time):')
for k in ('_entombed', '_marooned', '_stagnation', '_livelock_escape', '_loop_restart', '_watchdog_rescue', '_keepout',
          '_protect_zone', '_stranded_escape_try', '_death'):
    cb = sum(A[d][w]['reflex_n'].get(k, 0) for d in BASE for w in WORLDS) / 3
    ce = sum(A[d][w]['reflex_n'].get(k, 0) for d in END for w in WORLDS) / 3
    print(f'    {k:26s} {cb:8.0f} -> {ce:8.0f}')

# ---------------------------------------------------------------- other
section('5. OTHER: the decision engine')
for d in BASE + END:
    x = L[d]
    print(f'  {d} decisions/bot-h {x["decisions"] / x["bot_hours"]:5.1f}  latency p50 {x["lat_p"]["50.0"]:5.0f} ms p90 '
          f'{x["lat_p"]["90.0"]:5.0f}  llm share of bot-time {100 * x["lat_hours"] / x["bot_hours"]:4.1f}%  '
          f'startup triggers {x["triggers"].get("startup", 0)}  liveness_restart {x["triggers"].get("liveness_restart", 0)}')
