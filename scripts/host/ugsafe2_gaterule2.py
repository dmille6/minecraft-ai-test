#!/usr/bin/env python3
"""ugsafe2_gaterule2.py <an.pkl> <val.pkl>  -- section 7's table RE-RUN on the VALUE-WEIGHTED output measure, plus the
rule the owner actually approved on 10-07 (the ADAPTIVE bag-fix rule). docs/reports/bagfix-death-rule-2026-10-07.md.

Inputs: an.pkl (ugsafe2_analyse.py: bot-seconds and deaths per 5-min bin) and val.pkl (ugsafe2_value.py: value and
iron gained / carried into deaths, same bins). The raw item measure is recomputed in val.pkl and must reproduce an.pkl
(positive control, printed first).

A. EMPIRICAL 24-h NULL BANDS (4 pools x 24 h POST vs 24 h PRE, any build -- no 48 h stretch had enough single-build
   pools, exactly as A2' in ugsafe2_gaterule.py, same seed): value net DiD (log-eq/bot-h) and iron net DiD
   (ingot-eq/bot-h), each the 2.5th percentile used by rule (c). Raw items alongside, to show what moved.
B. JOINT SIMULATION, Poisson deaths polled every 5 min (r0 = all deaths / all bot-h), k multiplies the canary rate,
   g is the fix's value gain (log-eq/bot-h). Rules:
     TODAY-6h/10    10 vs 70 bots, 6 h, the live gate (>= 2 deaths, LB > 1.25) at any poll -> REVERT
     TODAY-6h/20    20 vs 60 bots, the same (drawrec.sh already targets 4 pools when the band allows)
     SEC7           section 7 as written: 20 bots, 24 h for every bag fix; (a) beyond chance, (b) LB > 2.0 any poll,
                    (c) at 24 h on the VALUE measure (and iron)
     ADAPTIVE/20    THE OWNER'S 10-07 RULE as implemented: 20 bots from the start. 6 h of the live gate; at a trip,
                    any linked death -> REVERT, (b) at the trip -> REVERT, else EXTEND to 24 h under (a)/(b) at any poll
                    and (c) at 24 h. No trip in 6 h -> not reverted by deaths (today's outcome).
     ADAPTIVE/10->20  the owner's literal shape, IDEALISED: 10 bots until the trip, 20 after (fresh pools join at the
                    trip; the widening hazards the report lists are NOT modelled -- this is its best case).
   A harmful fix's deaths are EXPOSURE deaths: each is linked only by coincidence (p_link), the bag-fix case.
   (c)'s net draw = an empirical null draw + g - value_per_death * (canary deaths/canary bot-h - r0); the iron draw from
   the SAME null window - iron_per_death * (...). This double-counts some death noise: conservative toward REVERT.
"""
import sys, os, random, math
from collections import Counter
import pickle
VAL = pickle.load(open(sys.argv[2], 'rb'))
sys.argv = sys.argv[:2]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from deathgate import _binom_sf

A = R.A; BIN = R.BIN


def lb_exceeds(a, ta, b, tb, c, alpha=0.05):
    """EXACTLY ratio_lower_bound(a, ta, b, tb) > c (ugsafe2_gaterule.py, checked there on 3,000 cases)."""
    if a <= 0 or ta <= 0 or tb <= 0:
        return False
    n = a + b if b > 0 else a
    return _binom_sf(a, n, c * ta / (tb + c * ta)) < alpha


bots = sorted(A['bins'])
pool_of = lambda b: '-'.join(b.split('-')[:2])
eligible = sorted({pool_of(b) for b in bots if not (pool_of(b) == 'placebo-c' or pool_of(b).startswith('isolated'))})
lo = min(min(v) for v in A['bins'].values() if v); hi = max(max(v) for v in A['bins'].values() if v)
N = hi - lo + 1


def arr_an(key):
    out = {}
    for b in bots:
        a = [0.0] * N
        for k, c in A['bins'][b].items(): a[k - lo] = c.get(key, 0)
        out[b] = a
    return out


def arr_val(key):
    out = {}
    for b in bots:
        a = [0.0] * N
        for k, c in (VAL.get(b) or {}).items():
            if lo <= k <= hi: a[k - lo] = c.get(key, 0)
        out[b] = a
    return out


SEC, DTH = arr_an('sec'), arr_an('death')
GAIN, LOST = arr_an('gained'), arr_an('lost_items')
VG, VL, IG, IL = arr_val('vgain'), arr_val('vlost'), arr_val('igain'), arr_val('ilost')
RG, RL = arr_val('gained'), arr_val('lost_items')
VSEC = arr_val('vsec')     # bot-seconds from bagfixrule.accumulate: the value rates use the LIVE read's estimator

# ---- positive control: the value walk re-derives the raw measure an.pkl carries
g_an, g_v = sum(map(sum, GAIN.values())), sum(map(sum, RG.values()))
l_an, l_v = sum(map(sum, LOST.values())), sum(map(sum, RL.values()))
d_an = sum(map(sum, DTH.values())); d_v = sum(sum(c.get('death', 0) for c in v.values()) for v in VAL.values())
print(f'POSITIVE CONTROL raw gained an.pkl {g_an:.0f} vs value walk {g_v:.0f} ({100*(g_v-g_an)/g_an:+.2f}%); '
      f'items carried into deaths {l_an:.0f} vs {l_v:.0f} ({100*(l_v-l_an)/max(1,l_an):+.2f}%); deaths {d_an:.0f} vs {d_v:.0f} with an inventory', flush=True)
s_an, s_v = sum(map(sum, SEC.values())), sum(map(sum, VSEC.values()))
print(f'POSITIVE CONTROL bot-h an.pkl {s_an/3600:.0f} vs accumulate() {s_v/3600:.0f} ({100*(s_v-s_an)/s_an:+.2f}%)', flush=True)
print(f'totals: value net change {sum(map(sum, VG.values())):.0f} log-eq (net of transfers and deaths), carried into deaths {sum(map(sum, VL.values())):.0f}; '
      f'iron net change {sum(map(sum, IG.values())):.1f} ingot-eq, into deaths {sum(map(sum, IL.values())):.1f}', flush=True)


def vers(b, i0, i1):
    v = Counter()
    for k in range(i0, i1):
        v.update(A['vers'].get(b, {}).get(k + lo, {}))
    return v


def outage(i0, i1):
    t0, t1 = (i0 + lo) * BIN, (i1 + lo) * BIN
    return any(not (y <= t0 or x >= t1) for x, y in R.OUT)


def null24(npools=4, hours=24, slide_h=2, draws=6):
    L = int(hours * 3600 / BIN); S = int(slide_h * 3600 / BIN)
    out = []
    for i0 in range(L, N - L, S):
        i1 = i0 + L; p0 = i0 - L
        if outage(p0, i1): continue
        vv = {b: vers(b, p0, i1) for b in bots}
        same = {b for b in bots if vv[b]}
        elig = [p for p in eligible if all(b in same for b in bots if pool_of(b) == p)]
        if len(elig) < npools + 2: continue
        for _ in range(draws):
            pools = random.sample(elig, npools)
            cb = [b for b in bots if pool_of(b) in pools]; kb = [b for b in same if b not in cb]

            def rate(bs, a, z, G, Lx):
                S_ = SEC if G is GAIN else VSEC
                h = sum(S_[b][i] for b in bs for i in range(a, z)) / 3600
                return (sum(G[b][i] for b in bs for i in range(a, z)) - sum(Lx[b][i] for b in bs for i in range(a, z))) / h if h else 0

            def did(G, Lx):
                return (rate(cb, i0, i1, G, Lx) - rate(cb, p0, i0, G, Lx)) - (rate(kb, i0, i1, G, Lx) - rate(kb, p0, i0, G, Lx))
            out.append((did(VG, VL), did(IG, IL), did(GAIN, LOST)))
    return out


q = lambda a, p: sorted(a)[min(len(a) - 1, int(p * len(a)))] if a else float('nan')
random.seed(12)
NULL = null24()
nv = [x[0] for x in NULL]; ni = [x[1] for x in NULL]; nr = [x[2] for x in NULL]
VTHR, ITHR = q(nv, .025), q(ni, .025)
print(f'\nA  24-h null, 4 pools, any build: n={len(NULL)} draws (heavily overlapping windows)')
print(f'   VALUE net DiD log-eq/bot-h: p2.5 {VTHR:+.2f}  p50 {q(nv,.5):+.2f}  p97.5 {q(nv,.975):+.2f}')
print(f'   IRON  net DiD ingot/bot-h:  p2.5 {ITHR:+.3f}  p50 {q(ni,.5):+.3f}  p97.5 {q(ni,.975):+.3f}')
print(f'   RAW   net DiD items/bot-h:  p2.5 {q(nr,.025):+.1f}  p50 {q(nr,.5):+.1f}  p97.5 {q(nr,.975):+.1f}  (section 7 printed -14.3/+4.4/+24.1)')

tot_d = sum(len(R.dwin(w)) for w in R.WIN)
tot_h = sum(R.agg(w)['sec'] for w in R.WIN) / 3600
r0 = tot_d / tot_h
VPD = sum(map(sum, VL.values())) / max(1, d_v)
IPD = sum(map(sum, IL.values())) / max(1, d_v)
P_LINK = 1 - math.exp(-1.45 * 120 / 3600)
print(f'\nB  r0 = {tot_d} deaths / {tot_h:.0f} bot-h = {r0:.4f}/bot-h; value carried into a death = {VPD:.1f} log-eq, iron {IPD:.2f} ingot-eq; p_link {100*P_LINK:.1f}%')
print(f'   a doubling of deaths costs {r0*VPD:.2f} log-eq/bot-h and {r0*IPD:.3f} ingot/bot-h')


def pois(lam):
    L = math.exp(-lam); k = 0; p = 1.0
    while True:
        p *= random.random()
        if p <= L: return k
        k += 1


def run(rule, k, g, reps):
    rev = ext = 0; extra = 0.0; why = Counter()
    for _ in range(reps):
        cd = kd = 0; linked = 0; cbh = kbh = 0.0; done = False; extended = False; tripped = False
        if rule == 'today6_10': nb0, nb1, hours = 10, 10, 6
        elif rule == 'today6_20': nb0, nb1, hours = 20, 20, 6
        elif rule == 'sec7': nb0, nb1, hours = 20, 20, 24
        elif rule == 'adapt20': nb0, nb1, hours = 20, 20, 24
        else: nb0, nb1, hours = 10, 20, 24          # adapt10w
        nb = nb0
        for s in range(1, hours * 12 + 1):
            if rule.startswith('adapt') and not extended and s > 72:
                break                                  # no trip in 6 h: today's outcome, not reverted by deaths
            new = pois(r0 * k * nb / 12); cd += new; kd += pois(r0 * (80 - nb) / 12)
            cbh += nb / 12; kbh += (80 - nb) / 12
            for _ in range(new):
                if random.random() < P_LINK: linked += 1
            if rule.startswith('today'):
                if cd >= 2 and lb_exceeds(cd, cbh, kd, kbh, 1.25):
                    done = True; why['gate'] += 1
            elif rule == 'sec7':
                if cd >= 2 and not tripped and lb_exceeds(cd, cbh, kd, kbh, 1.25): tripped = True
                if tripped and linked and _binom_sf(linked, cd, P_LINK) < 0.01:
                    done = True; why['a'] += 1
                elif cd >= 2 and lb_exceeds(cd, cbh, kd, kbh, 2.0):
                    done = True; why['b'] += 1
            else:
                if not extended:
                    if cd >= 2 and lb_exceeds(cd, cbh, kd, kbh, 1.25):
                        if linked:
                            done = True; why['linked@trip'] += 1
                        elif lb_exceeds(cd, cbh, kd, kbh, 2.0):
                            done = True; why['b@trip'] += 1
                        else:
                            extended = True; ext += 1; nb = nb1
                else:
                    if _binom_sf(linked, cd, P_LINK) < 0.01 and linked:
                        done = True; why['a'] += 1
                    elif cd >= 2 and lb_exceeds(cd, cbh, kd, kbh, 2.0):
                        done = True; why['b'] += 1
            if done:
                extra += (k - 1) * r0 * cbh; break
        if not done:
            extra += (k - 1) * r0 * cbh
            if rule == 'sec7' or (rule.startswith('adapt') and extended):
                j = random.randrange(len(NULL))
                exc = cd / cbh - r0
                net = NULL[j][0] + g - VPD * exc
                iron = NULL[j][1] - IPD * exc
                if net < VTHR: done = True; why['c'] += 1
                elif iron < ITHR: done = True; why['c-iron'] += 1
        rev += done
    return rev / reps, ext / reps, extra / reps, {kk: 100 * v / reps for kk, v in why.items()}


G = round(1.2 * r0 * VPD, 1)
REPS = int(os.environ.get('REPS', '2000'))
random.seed(31)
print(f'\nB2 P(REVERT) [extra canary deaths before the decision], {REPS} reps; g in log-eq/bot-h (+{G} = 1.2x what a doubling costs)')
cols = ('today6_10', 'today6_20', 'sec7', 'adapt20', 'adapt10w')
print('   k     g  | ' + ' | '.join(f'{c:>16s}' for c in cols) + ' | P(EXTEND) adapt20 | adapt20 reverts by')
for k, g in ((1.0, 0), (1.5, 0), (2.0, 0), (3.0, 0), (1.0, G), (2.0, G), (3.0, G)):
    res = {c: run(c, k, g, REPS) for c in cols}
    cells = ' | '.join(f'{100*res[c][0]:6.1f}% [{res[c][2]:4.1f}]' for c in cols)
    w = res['adapt20'][3]
    print(f'  {k:3.1f}  {g:+5.1f} | {cells} | {100*res["adapt20"][1]:6.1f}%          | '
          + ' '.join(f'{kk} {v:.1f}' for kk, v in sorted(w.items())), flush=True)
