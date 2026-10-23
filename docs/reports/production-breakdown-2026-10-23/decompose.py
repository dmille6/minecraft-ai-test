"""THE DECOMPOSITION TABLES of the report: each metric's BASE -> END change split into rows that
add up exactly. No ES access; reads out/analyze.json (skill stream) and out/milestone_yield.json
(LLM decisions by rung x skill x outcome).

BASE = 10-08..10-10, END = 10-20..10-22 (3 whole days each; 80 bots; 1,920 bot-h/day).

Rows, in order (each is events/day):
  T  board-d trap excess  = board-d's change minus the mean change of the other 15 worlds.
     (3 of its 5 bots were held in a walled water pit 10-16 .. 10-23; float holds 66.6 of its 120 bot-h/day.)
  C  the common change    = 16 x the mean change of the other 15 worlds, split on THOSE 15 worlds' LLM
                            decisions (mix_shift's symmetric demand / yield split), scaled by 16/15:
     D1 demand, production rungs (stockpile_wood, stockpile_stone, gather_iron_ore_3, craft_*, smelt_*,
        gather_oak_log_12, gather_cobblestone_8, each with +prereq)       -> (a) deliberate (ladder satisfied)
     D2 demand, all other rungs (dirt, sand, patrol, return, idle, deposit_surplus, ...)
                                                                           -> (a) consequence: a shorter lap
     Y1 yield on the wood rungs (stockpile_wood, gather_oak_log_12)        -> (b) depletion, UPPER bound
     Y2 yield on all other rungs                                           -> unexplained / other
     R  successes not reached by an LLM decision (skill-stream total minus the LLM outcome total)
"""
import os, json
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
A = json.load(open(os.path.join(HERE, 'out', 'analyze.json')))
Y = json.load(open(os.path.join(HERE, 'out', 'milestone_yield.json')))
BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']
WORLDS = sorted(A[BASE[0]])
OTHER = [w for w in WORLDS if w != 'board-d']
PROD = ('stockpile_wood', 'stockpile_stone', 'gather_iron_ore_3', 'gather_oak_log_12', 'gather_cobblestone_8')
WOOD = ('stockpile_wood', 'gather_oak_log_12')


def rung(m):
    return (m or '').replace('+prereq', '')


def skill_total(days, ws, metric):
    f = {'gather': lambda x: x['gather_ok'], 'mine': lambda x: x['mine_ok'],
         'craft': lambda x: sum(c.get('success', 0) for c in x['craft_by'].values())}[metric]
    return sum(f(A[d][w]) for d in days for w in ws) / len(days)


def period(days, ws, K):
    out = defaultdict(lambda: [0.0, 0.0])          # rung -> [decisions, K-successes] per day
    for d in days:
        for w in ws:
            for m, ks in Y[d].get(w, {}).items():
                for k, st in ks.items():
                    out[m][0] += sum(st.values()) / len(days)
                    if k == K:
                        out[m][1] += st.get('success', 0) / len(days)
    return out


def split(ws, K):
    B, E = period(BASE, ws, K), period(END, ws, K)
    rows = defaultdict(float)
    for m in set(B) | set(E):
        Db, sb = B.get(m, [0, 0])
        De, se = E.get(m, [0, 0])
        yb = sb / Db if Db else None
        ye = se / De if De else None
        yb = ye if yb is None else yb
        ye = yb if ye is None else ye
        dem = (De - Db) * (yb + ye) / 2
        yld = (Db + De) / 2 * (ye - yb)
        r = rung(m)
        prod = r in PROD or r.startswith('craft_') or r.startswith('smelt_')
        rows['D1' if prod else 'D2'] += dem
        rows['Y1' if r in WOOD else 'Y2'] += yld
    llm_b = sum(v[1] for v in B.values())
    llm_e = sum(v[1] for v in E.values())
    return rows, llm_b, llm_e


for K in ('gather', 'mine', 'craft'):
    tb, te = skill_total(BASE, WORLDS, K), skill_total(END, WORLDS, K)
    bd = skill_total(END, ['board-d'], K) - skill_total(BASE, ['board-d'], K)
    ob, oe = skill_total(BASE, OTHER, K), skill_total(END, OTHER, K)
    mean15 = (oe - ob) / 15
    T = bd - mean15
    rows, lb, le = split(OTHER, K)
    s = 16 / 15
    R = ((oe - ob) - (le - lb)) * s
    print(f'\n=== {K} successes/day: {tb:,.0f} -> {te:,.0f} (delta {te - tb:+,.0f})')
    lines = [('T  board-d water-pit trap (excess over the other 15 worlds)', T, '(c) safety trap'),
             ('D1 demand: production rungs satisfied by the bag', rows['D1'] * s, '(a) deliberate'),
             ('D2 demand: other rungs (dirt, sand, lap, idle ...)', rows['D2'] * s, '(a) consequence'),
             ('Y1 yield on the wood rungs (depletion upper bound)', rows['Y1'] * s, '(b) depletion <='),
             ('Y2 yield on all other rungs', rows['Y2'] * s, 'unexplained / other'),
             ('R  successes outside LLM decisions', R, 'unexplained / other')]
    for name, v, cls in lines:
        print(f'  {name:58s} {v:+8.0f}   {cls}')
    tot = sum(v for _, v, _ in lines)
    print(f'  {"SUM":58s} {tot:+8.0f}   (check vs delta {te - tb:+.0f}: {tot - (te - tb):+.1f})')


# ---- the depletion part INSIDE D1: the iron rung is stepped over when no iron ore is within 32 m
# (ironInReach, milestones.mjs:505). Estimate: had iron-in-reach stayed at its BASE share, END iron-rung
# decisions would scale by base_share / end_share; price the extra decisions at END yield per iron decision.
S = json.load(open(os.path.join(HERE, 'out', 'sample_state.json')))


def share(days, key):
    n = sum(S[d][w]['n'] for d in days for w in OTHER)
    return sum(S[d][w][key] * S[d][w]['n'] for d in days for w in OTHER) / n


ib, ie = share(BASE, 'iron32'), share(END, 'iron32')
print(f'\niron ore within 32 m, 15 worlds (decision-weighted): {100 * ib:.1f}% -> {100 * ie:.1f}%')
for K in ('mine', 'gather'):
    E = period(END, OTHER, K)
    De = sum(v[0] for m, v in E.items() if rung(m) == 'gather_iron_ore_3')
    se = sum(v[1] for m, v in E.items() if rung(m) == 'gather_iron_ore_3')
    extra = De * (ib / ie - 1)
    print(f'  {K}: END iron-rung decisions {De:,.0f}/day, yield {se / De:.3f}; lost to iron-in-reach '
          f'{extra:,.0f} decisions -> {-extra * se / De * 16 / 15:+.0f} {K} successes/day (part of D1, class (b))')
