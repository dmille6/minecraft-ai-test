"""Demand-vs-yield decomposition of each production metric, from out/milestone_yield.json
(LLM decisions by milestone x chosen skill x outcome). No ES access.

For metric M (successes of skill K per day) and milestone m:
    M = sum_m  D_m * y_m      D_m = decisions on rung m,  y_m = K-successes per decision on m
    dM = sum_m dD_m * ybar_m  (DEMAND: how many decisions the ladder put on each rung)
       + sum_m Dbar_m * dy_m  (YIELD: how productive a decision on that rung was)
with bars = the mean of the two periods (the symmetric / Shapley split, so the two terms add
up exactly to dM with no interaction residue).

Periods: BASE = 10-08..10-10, END = 10-20..10-22 (3 whole days each, 80 bots, 1,920 bot-h/day).
"""
import json, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
Y = json.load(open(os.path.join(HERE, 'out', 'milestone_yield.json')))
BASE = sys.argv[1].split(',') if len(sys.argv) > 1 else ['2026-10-08', '2026-10-09', '2026-10-10']
END = sys.argv[2].split(',') if len(sys.argv) > 2 else ['2026-10-20', '2026-10-21', '2026-10-22']
WORLDS = sys.argv[3].split(',') if len(sys.argv) > 3 else None


def period(days):
    """{milestone: [decisions, {skill: successes}]} per day (mean over the days)."""
    out = defaultdict(lambda: [0.0, defaultdict(float)])
    for d in days:
        for w, ms in Y[d].items():
            if WORLDS and w not in WORLDS:
                continue
            for m, ks in ms.items():
                for k, st in ks.items():
                    n = sum(st.values())
                    out[m][0] += n / len(days)
                    out[m][1][k] += st.get('success', 0) / len(days)
    return out


B, E = period(BASE), period(END)
ms = sorted(set(B) | set(E), key=lambda m: -(B.get(m, [0])[0] + E.get(m, [0])[0]))
print(f'BASE {BASE}  END {END}  worlds {WORLDS or "all"}')
print('\nDecisions per day by milestone (the ladder\'s demand):')
print(f'{"milestone":28s} {"base":>8s} {"end":>8s} {"delta":>8s}')
for m in ms[:22]:
    b, e = B.get(m, [0])[0], E.get(m, [0])[0]
    print(f'{m:28s} {b:8.0f} {e:8.0f} {e - b:+8.0f}')
tb, te = sum(v[0] for v in B.values()), sum(v[0] for v in E.values())
print(f'{"TOTAL":28s} {tb:8.0f} {te:8.0f} {te - tb:+8.0f}')

for K in ('gather', 'mine', 'craft', 'town_deposit', 'deposit', 'explore', 'goto', 'toolkit'):
    Mb = sum(v[1].get(K, 0) for v in B.values())
    Me = sum(v[1].get(K, 0) for v in E.values())
    dem = yld = 0.0
    rows = []
    for m in ms:
        Db, De = B.get(m, [0, {}])[0], E.get(m, [0, {}])[0]
        sb = B.get(m, [0, {}])[1].get(K, 0) if m in B else 0
        se = E.get(m, [0, {}])[1].get(K, 0) if m in E else 0
        yb = sb / Db if Db else 0.0
        ye = se / De if De else 0.0
        # a rung absent in one period: its yield there is undefined; use the other period's
        if not Db:
            yb = ye
        if not De:
            ye = yb
        d_dem = (De - Db) * (yb + ye) / 2
        d_yld = (Db + De) / 2 * (ye - yb)
        dem += d_dem
        yld += d_yld
        rows.append((m, sb, se, d_dem, d_yld))
    print(f'\n== {K} successes/day: base {Mb:.0f}  end {Me:.0f}  delta {Me - Mb:+.0f}  = demand {dem:+.0f} + yield {yld:+.0f}'
          f'  (check {dem + yld - (Me - Mb):+.1f})')
    for m, sb, se, a, b in sorted(rows, key=lambda r: -abs(r[3]) - abs(r[4]))[:8]:
        print(f'   {m:28s} succ {sb:7.0f} -> {se:7.0f}   demand {a:+7.0f}  yield {b:+7.0f}')
