"""THE ACCOUNTING IDENTITY of the report (r2): each metric's BASE -> END change split into rows that add up
exactly, with no demand/yield split (Claude r1 P1-1: that split is order-dependent when decisions and yields fall
together, and its offsetting terms make 'net shares' meaningless). No ES access; reads out/analyze.json (skill
stream) and out/milestone_yield.json (LLM decisions by rung x skill x outcome; lap numbers '#N' are stripped
ANYWHERE in the string, so 'stockpile_wood#2356+prereq' folds into stockpile_wood).

BASE = 10-08..10-10, END = 10-20..10-22 (3 whole days each; 80 bots; 1,920 bot-h/day).

Rows (events/day):
  T     board-d excess = board-d's change minus the mean change of the other 15 worlds (a conditional DiD:
        it assumes board-d would otherwise have moved like their mean; pre-trend in board_d_window.py)
  rung  for the other 15 worlds, the change in successes of the skill made under each rung GROUP (gross, by the
        rung the decision served), scaled by 16/15 so the rows plus T sum to the fleet change
  R     successes not reached by an LLM decision (skill-stream change minus LLM-outcome change, 15 worlds, x 16/15)
It identifies WHERE (under which rung) successes were lost or gained, not WHY. The report argues the why.
Also printed per group: decisions/day and successes per decision, BASE -> END, for context.
"""
import os, re, json
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
A = json.load(open(os.path.join(HERE, 'out', 'analyze.json')))
Y = json.load(open(os.path.join(HERE, 'out', 'milestone_yield.json')))
BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']
WORLDS = sorted(A[BASE[0]])
OTHER = [w for w in WORLDS if w != 'board-d']
GROUPS = [('wood rungs (stockpile_wood, gather_oak_log_12)', lambda r: r in ('stockpile_wood', 'gather_oak_log_12')),
          ('stone rungs (stockpile_stone, gather_cobblestone_8)', lambda r: r in ('stockpile_stone', 'gather_cobblestone_8')),
          ('iron rung (gather_iron_ore_3)', lambda r: r == 'gather_iron_ore_3'),
          ('tool/station rungs (craft_*)', lambda r: r.startswith('craft_')),
          ('smelt rungs (smelt_*)', lambda r: r.startswith('smelt_')),
          ('dirt rung (gather_dirt_16)', lambda r: r == 'gather_dirt_16'),
          ('sand rung (gather_sand_8)', lambda r: r == 'gather_sand_8'),
          ('lap rungs (patrol, return, idle)', lambda r: r in ('patrol', 'return', 'idle')),
          ('deposit_surplus', lambda r: r == 'deposit_surplus'),
          ('anything else', lambda r: True)]


def rung(m):
    return re.sub(r'#\d+', '', m or '').replace('+prereq', '')


def group(m):
    r = rung(m)
    for name, f in GROUPS:
        if f(r):
            return name


def skill_total(days, ws, metric):
    f = {'gather': lambda x: x['gather_ok'], 'mine': lambda x: x['mine_ok'],
         'craft': lambda x: sum(c.get('success', 0) for c in x['craft_by'].values())}[metric]
    return sum(f(A[d][w]) for d in days for w in ws) / len(days)


def by_group(days, ws, K):
    out = defaultdict(lambda: [0.0, 0.0])          # group -> [decisions, K-successes] per day
    for d in days:
        for w in ws:
            for m, ks in Y[d].get(w, {}).items():
                g = group(m)
                for k, st in ks.items():
                    out[g][0] += sum(st.values()) / len(days)
                    if k == K:
                        out[g][1] += st.get('success', 0) / len(days)
    return out


s = 16 / 15
for K in ('gather', 'mine', 'craft'):
    tb, te = skill_total(BASE, WORLDS, K), skill_total(END, WORLDS, K)
    bd = skill_total(END, ['board-d'], K) - skill_total(BASE, ['board-d'], K)
    ob, oe = skill_total(BASE, OTHER, K), skill_total(END, OTHER, K)
    T = bd - (oe - ob) / 15
    B, E = by_group(BASE, OTHER, K), by_group(END, OTHER, K)
    lb, le = sum(v[1] for v in B.values()), sum(v[1] for v in E.values())
    R = ((oe - ob) - (le - lb)) * s
    print(f'\n=== {K} successes/day: {tb:,.0f} -> {te:,.0f} (delta {te - tb:+,.0f})')
    print(f'  {"row":52s} {"succ/day (x16/15)":>20s} {"change":>8s}   decisions/day (15 worlds)   succ per decision')
    tot = T + R
    print(f'  {"T  board-d excess over the other 15 worlds":52s} {"":>20s} {T:+8.0f}')
    for name, _ in GROUPS:
        b, e = B.get(name, [0, 0]), E.get(name, [0, 0])
        d = (e[1] - b[1]) * s
        tot += d
        print(f'  {name:52s} {b[1] * s:9.0f} -> {e[1] * s:7.0f} {d:+8.0f}   {b[0]:8.0f} -> {e[0]:8.0f}        '
              f'{(b[1] / b[0] if b[0] else 0):.3f} -> {(e[1] / e[0] if e[0] else 0):.3f}')
    print(f'  {"R  successes not reached by an LLM decision":52s} {"":>20s} {R:+8.0f}')
    print(f'  {"SUM":52s} {"":>20s} {tot:+8.0f}   (check vs delta {te - tb:+.0f}: {tot - (te - tb):+.2f})')


# ---------------------------------------------------------------- the ALLOCATION of the report (section 0.3), r3
# An ILLUSTRATIVE allocation under a stated convention, not a causal identification (Codex r2 P1-1).
# Per row r (15 worlds, x16/15):  demand_r = (D_end - D_base) * y_base     yield_r = D_end * (y_end - y_base)
# (demand priced at BASE yield, yield at END decisions; the two sum exactly to the row's change; the opposite
# convention is printed for sensitivity). Classes:
#   (c)  T, board-d's excess
#   (b)  the two depletion SCENARIOS from rung_state.py (out/scenarios.json): gather = the log-sight scenario priced at
#        END wood-rung volume (it lives inside the wood rows' yield); mine = the iron-sight scenario (inside the iron
#        row's demand). Both conditional on their assumptions.
#   (a)  ladder demand = sum of demand_r, less the mine scenario: decisions that moved between rungs, at BASE yields
#   Yw   yield change on the wood rows beyond (b): selection (chronic bots), depletion of reachable trees, or other
#   Yo   yield change on every other row: unexplained
#   R    successes not reached by an LLM decision
SC = json.load(open(os.path.join(HERE, 'out', 'scenarios.json')))
WOOD = 'wood rungs (stockpile_wood, gather_oak_log_12)'
print('\nALLOCATION (events/day; convention: demand at BASE yield, yield at END decisions)')
for K in ('gather', 'mine', 'craft'):
    tb, te = skill_total(BASE, WORLDS, K), skill_total(END, WORLDS, K)
    bd = skill_total(END, ['board-d'], K) - skill_total(BASE, ['board-d'], K)
    ob, oe = skill_total(BASE, OTHER, K), skill_total(END, OTHER, K)
    T = bd - (oe - ob) / 15
    B, E = by_group(BASE, OTHER, K), by_group(END, OTHER, K)
    lb, le = sum(v[1] for v in B.values()), sum(v[1] for v in E.values())
    R = ((oe - ob) - (le - lb)) * s
    dem, yld, dem_alt = {}, {}, 0.0
    for name, _ in GROUPS:
        (Db, sb), (De, se) = B.get(name, [0, 0]), E.get(name, [0, 0])
        yb = sb / Db if Db else 0.0
        ye = se / De if De else yb
        dem[name] = (De - Db) * yb * s
        yld[name] = De * (ye - yb) * s
        dem_alt += (De - Db) * ye * s
    bg = SC['A_gather_end_volume'] if K == 'gather' else 0.0
    bm = SC['B_mine'] if K == 'mine' else 0.0
    a = sum(dem.values()) - bm
    yw = yld[WOOD] - bg
    yo = sum(v for k, v in yld.items() if k != WOOD)
    chk = a + bg + bm + T + yw + yo + R - (te - tb)
    print(f'  {K:6s} change {te - tb:+7.0f} = (a) {a:+7.0f}  (b) {bg + bm:+6.0f}  (c) {T:+6.0f}  Yw {yw:+6.0f}  '
          f'Yo {yo:+6.0f}  R {R:+4.0f}   [check {chk:+.2f}; (a) under the opposite convention {dem_alt - bm:+7.0f}]')

print('\nFLEET (16 worlds) LLM decisions per day by rung group, BASE -> END (+prereq and lap numbers folded)')
B, E = by_group(BASE, WORLDS, 'gather'), by_group(END, WORLDS, 'gather')
for name, _ in GROUPS:
    b, e = B.get(name, [0, 0])[0], E.get(name, [0, 0])[0]
    print(f'  {name:52s} {b:8.0f} -> {e:8.0f} {e - b:+8.0f}')
print(f'  {"TOTAL":52s} {sum(v[0] for v in B.values()):8.0f} -> {sum(v[0] for v in E.values()):8.0f}')
