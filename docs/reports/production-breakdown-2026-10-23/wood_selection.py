"""Selection or depletion? On the wood rungs (stockpile_wood + gather_oak_log_12), per world: the per-decision gather
success and the share of decisions with a log (oak/birch/spruce) within 16 m, BASE vs END (LLM sample).
DESCRIPTIVE ONLY: the world comparison below does not separate selection from depletion (the groups differ in
baseline success and in chronic bots; Codex/Claude r2). The chronic-bot and non-chronic rows are the usable output.
No ES access."""
import os, sys, gzip, json, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402
from sample_state import LOGS  # noqa: E402

BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']


PERBOT = {}


def tally(days):
    T = defaultdict(lambda: [0, 0, 0])      # n, success, visible
    PB = defaultdict(lambda: [0, 0, 0])     # bot -> n, success, visible (15 worlds)
    PERBOT[days[0]] = PB
    for d in days:
        with gzip.open(os.path.join(HERE, 'out', 'llm_sample', f'{d}.jsonl.gz'), 'rt') as f:
            for l in f:
                r = json.loads(l)
                w = world(r['p'])
                if w not in HOMES or re.sub(r'#\d+', '', r['m'] or '').replace('+prereq', '') not in ('stockpile_wood', 'gather_oak_log_12'):
                    continue
                per = r['per'] or {}
                t = T[w]
                t[0] += 1
                t[1] += r['sk'] == 'gather' and r['st'] == 'success'
                t[2] += any(isinstance(per.get(x), (int, float)) and per[x] <= 16 for x in LOGS)
                if w != 'board-d':       # chronic counts on the same 15 worlds as the identity's wood row
                    pb = PB[r['b']]
                    pb[0] += 1
                    pb[1] += r['sk'] == 'gather' and r['st'] == 'success'
                    pb[2] += any(isinstance(per.get(x), (int, float)) and per[x] <= 16 for x in LOGS)
    return T


B, E = tally(BASE), tally(END)
rows = []
print(f'{"world":11s} {"n":>11s} {"success/decision":>18s} {"log within 16 m":>18s}')
for w in sorted(HOMES):
    b, e = B[w], E[w]
    if not b[0] or not e[0]:
        continue
    sb, se = b[1] / b[0], e[1] / e[0]
    vb, ve = b[2] / b[0], e[2] / e[0]
    rows.append((w, ve - vb, se - sb, b[0], e[0]))
    print(f'{w:11s} {b[0]:5d}/{e[0]:5d}   {100 * sb:6.1f}->{100 * se:5.1f}%   {100 * vb:6.1f}->{100 * ve:5.1f}%')
# worlds whose sight of logs did not fall (>= -2 pp) vs fell > 15 pp; only worlds with >= 50 END wood-rung
# decisions in the sample (smaller cells are noise), board-d left out (its bots sat in the pit); weighted by END n
ok = [r for r in rows if r[4] >= 50 and r[0] != 'board-d']
held = [r for r in ok if r[1] >= -0.02]
fell = [r for r in ok if r[1] < -0.15]
wavg = lambda rs, i: sum(r[i] * r[4] for r in rs) / sum(r[4] for r in rs) if rs else float('nan')
print(f'\n(>= 50 END decisions, board-d out, weighted by END decisions)')
print(f'worlds where log sight HELD (>= -2 pp; {[r[0] for r in held]}): success per decision '
      f'{100 * wavg(held, 2):+.1f} pp, sight {100 * wavg(held, 1):+.1f} pp')
print(f'worlds where log sight FELL > 15 pp ({[r[0] for r in fell]}): success per decision '
      f'{100 * wavg(fell, 2):+.1f} pp, sight {100 * wavg(fell, 1):+.1f} pp')
print('DESCRIPTIVE ONLY (Codex/Claude r2): the groups differ in baseline success and in chronic bots, so this ordering does'
      ' not separate selection from depletion; see the non-chronic rows below')


print('\nchronic bots (15 worlds, board-d out): sampled wood-rung decisions from bots with >= 50 of them and ZERO gather successes')
for lab, days in (('BASE', BASE), ('END', END)):
    PB = PERBOT[days[0]]
    tot = sum(v[0] for v in PB.values())
    z = {b: v for b, v in PB.items() if v[0] >= 50 and v[1] == 0}
    rest_n = tot - sum(v[0] for v in z.values())
    rest_s = sum(v[1] for b, v in PB.items() if b not in z)
    print(f'   {lab}: {sum(v[0] for v in z.values())} of {tot} decisions ({100 * sum(v[0] for v in z.values()) / tot:.1f}%) '
          f'from {len(z)} bots {sorted(z)}; success per decision without them {rest_s / max(1, rest_n):.3f} (n {rest_n})')


print('\nNON-CHRONIC wood-rung decisions (15 worlds; chronic = >= 50 decisions and 0 successes IN THAT PERIOD):')
res = {}
for lab, days in (('BASE', BASE), ('END', END)):
    PB = PERBOT[days[0]]
    keep = {b: v for b, v in PB.items() if not (v[0] >= 50 and v[1] == 0)}
    n = sum(v[0] for v in keep.values()); ok = sum(v[1] for v in keep.values()); vis = sum(v[2] for v in keep.values())
    res[lab] = (n, ok, vis)
    print(f'   {lab}: n {n}, success per decision {ok / n:.3f}, a log within 16 m on {100 * vis / n:.1f}%')
