#!/usr/bin/env python3
"""ugsafe2_gaterule.py <an.pkl>  -- false-revert and false-keep numbers for the proposed BAG-FIX death rule
(docs/reports/underground-safety-phase2-2026-10-07.md section 7).

A. EMPIRICAL NULL, SEQUENTIAL (the live gate polls every 5 min): random whole-pool canaries on identical code
   (only bots that ran the window's single majority build; pools with any other build drop out), the live gate
   (>= 2 canary deaths AND one-sided 95% lower bound of the per-bot-h rate ratio > 1.25, scripts/deathgate.py)
   evaluated at every 5-minute bin from deploy to the read. Shapes: 2 pools x 6 h (today's canary) and 4 pools x 24 h
   (the proposed bag-fix read). Also the 24 h ceiling (LB > 2.0 at the end) and the net-output DiD band at 24 h
   (items gained - items carried into deaths, per bot-h; 24 h PRE vs 24 h POST).
B. PARAMETRIC POWER (Poisson, no pool clustering -- so it is the OPTIMISTIC case for false reverts): fleet death rate
   r0 = all deaths / all bot-h in the 5 days; a change that multiplies the canary's rate by k. Probability that
   (i) today's gate trips at any 5-min poll in 6 h on 10 bots vs 70, (ii) the 24 h / 20-bot read's LB > 1.25 and
   LB > 2.0 at the end, (iii) the 24 h read's net-output DiD falls below the null 2.5th percentile, given the items a
   death costs.
"""
import sys, os, random, math
from collections import Counter
sys.argv = sys.argv[:2]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from deathgate import ratio_lower_bound, _binom_sf


def lb_exceeds(a, ta, b, tb, c, alpha=0.05):
    """EXACTLY `ratio_lower_bound(a, ta, b, tb, alpha) > c`, in one binomial tail instead of an 80-step bisection.
    The bound maps p_lower -> (p/(1-p)) * tb/ta, increasing in p, and p_lower is the smallest p with sf(a, n, p) >= alpha
    (sf increasing in p). So bound > c  <=>  p_lower > p* = c*ta/(tb + c*ta)  <=>  sf(a, n, p*) < alpha.
    Checked against ratio_lower_bound on random cases below (positive control: disagreements printed)."""
    if a <= 0 or ta <= 0 or tb <= 0:
        return False
    n = a + b if b > 0 else a
    return _binom_sf(a, n, c * ta / (tb + c * ta)) < alpha

A = R.A; BIN = R.BIN
bots = sorted(A['bins'])
pool_of = lambda b: '-'.join(b.split('-')[:2])
eligible = sorted({pool_of(b) for b in bots if not (pool_of(b) == 'placebo-c' or pool_of(b).startswith('isolated'))})
lo = min(min(v) for v in A['bins'].values() if v); hi = max(max(v) for v in A['bins'].values() if v)
N = hi - lo + 1
def arr(key):
    out = {}
    for b in bots:
        a = [0.0] * N
        for k, c in A['bins'][b].items(): a[k - lo] = c.get(key, 0)
        out[b] = a
    return out
SEC, DTH, GAIN, LOST = arr('sec'), arr('death'), arr('gained'), arr('lost_items')
def vers(b, i0, i1):
    v = Counter()
    for k in range(i0, i1):
        v.update(A['vers'].get(b, {}).get(k + lo, {}))
    return v
def outage(i0, i1):
    t0, t1 = (i0 + lo) * BIN, (i1 + lo) * BIN
    return any(not (y <= t0 or x >= t1) for x, y in R.OUT)

def sequential(npools, hours, slide_h, draws, need_pre=False, ceiling=False, strict=True):
    L = int(hours * 3600 / BIN); S = int(slide_h * 3600 / BIN)
    trips = n = ceil_trips = 0; net = []; wins = 0; dropped = 0
    start = L if need_pre else 0
    for i0 in range(start, N - L, S):
        i1 = i0 + L; p0 = i0 - L if need_pre else i0
        if outage(p0, i1): continue
        vv = {b: vers(b, p0, i1) for b in bots}
        tot = sum(vv.values(), Counter())
        if not tot: continue
        maj = tot.most_common(1)[0][0]
        same = {b for b in bots if vv[b] and (set(vv[b]) == {maj} or not strict)}
        elig = [p for p in eligible if all(b in same for b in bots if pool_of(b) == p)]
        if len(elig) < npools + 2: dropped += 1; continue
        wins += 1
        for _ in range(draws):
            pools = random.sample(elig, npools)
            cb = [b for b in bots if pool_of(b) in pools]; kb = [b for b in same if b not in cb]
            cs = ks = cd = kd = 0.0; tripped = False
            for i in range(i0, i1):
                cs += sum(SEC[b][i] for b in cb); ks += sum(SEC[b][i] for b in kb)
                cd += sum(DTH[b][i] for b in cb); kd += sum(DTH[b][i] for b in kb)
                if cd >= 2 and ks > 0 and cs > 0 and lb_exceeds(int(cd), cs / 3600, int(kd), ks / 3600, 1.25):
                    tripped = True
            n += 1; trips += tripped
            if ceiling and cd >= 2 and lb_exceeds(int(cd), cs / 3600, int(kd), ks / 3600, 2.0): ceil_trips += 1
            if need_pre:
                def rate(bs, a, z, key):
                    h = sum(SEC[b][i] for b in bs for i in range(a, z)) / 3600
                    return (sum(GAIN[b][i] for b in bs for i in range(a, z)) - sum(LOST[b][i] for b in bs for i in range(a, z))) / h if h else 0
                net.append((rate(cb, i0, i1, 0) - rate(cb, p0, i0, 0)) - (rate(kb, i0, i1, 0) - rate(kb, p0, i0, 0)))
    return {'windows': wins, 'dropped_windows': dropped, 'draws': n, 'trip_any_poll': trips / n if n else float('nan'),
            'ceiling_end': ceil_trips / n if n else float('nan'), 'net': sorted(net)}

random.seed(3)
bad = 0
for _ in range(3000):
    a = random.randint(0, 25); b = random.randint(0, 60); ta = random.uniform(5, 500); tb = random.uniform(5, 1500); c = random.choice((1.25, 2.0))
    bad += (ratio_lower_bound(a, ta, b, tb) > c) != lb_exceeds(a, ta, b, tb, c)
print(f'lb_exceeds vs ratio_lower_bound on 3000 random cases: {bad} disagreements', flush=True)
random.seed(11)
r6 = sequential(2, 6, 1, 6)
print(flush=True); print(f"A1 today's gate, 2 pools x 6 h, polled every 5 min: {r6['draws']} draws over {r6['windows']} windows "
      f"({r6['dropped_windows']} windows dropped: too few single-build pools) -> false trip at any poll {100*r6['trip_any_poll']:.1f}%")
r24 = sequential(4, 24, 2, 6, need_pre=True, ceiling=True)
print(f"A2 4 pools x 24 h (+24 h PRE), polled: {r24['draws']} draws over {r24['windows']} windows ({r24['dropped_windows']} dropped) -> "
      f"false trip at any poll {100*r24['trip_any_poll']:.1f}%, LB > 2.0 at the end {100*r24['ceiling_end']:.1f}%")
if not r24['draws']:
    # NO 48 h stretch had enough single-build pools (a canary ran almost all week): rerun WITHOUT the build filter.
    # These draws include real canaries on either side, so the band is WIDER than identical code would give.
    random.seed(12)
    r24 = sequential(4, 24, 2, 6, need_pre=True, ceiling=True, strict=False)
    print(f"A2' same, ANY build (real canaries included): {r24['draws']} draws over {r24['windows']} windows -> "
          f"false trip at any poll {100*r24['trip_any_poll']:.1f}%, LB > 2.0 at the end {100*r24['ceiling_end']:.1f}%")
q = lambda a, p: a[min(len(a) - 1, int(p * len(a)))] if a else float('nan')
if r24['net']:
    print(f"   null NET items/bot-h DiD at 24 h, 4 pools: p2.5 {q(r24['net'], .025):+.1f}  p50 {q(r24['net'], .5):+.1f}  p97.5 {q(r24['net'], .975):+.1f}  (n={len(r24['net'])}, heavily overlapping)")

# ---- B. parametric
tot_d = sum(len([d for d in R.dwin(w)]) for w in R.WIN)
tot_h = sum(R.agg(w)['sec'] for w in R.WIN) / 3600
r0 = tot_d / tot_h
lost_per_death = sum(d['bag']['items'] for w in R.WIN for d in R.dwin(w)) / tot_d
print(f'\nB  r0 = {tot_d} deaths / {tot_h:.0f} bot-h = {r0:.4f}/bot-h; items carried into a death = {lost_per_death:.0f}')
def pois(lam):
    L = math.exp(-lam); k = 0; p = 1.0
    while True:
        p *= random.random()
        if p <= L: return k
        k += 1
def sim(k, can_bots, ctl_bots, hours, poll=True, reps=4000):
    trip = lb125 = lb2 = 0
    steps = int(hours * 12)
    for _ in range(reps):
        cd = kd = 0; tripped = False
        for s in range(1, steps + 1):
            cd += pois(r0 * k * can_bots / 12); kd += pois(r0 * ctl_bots / 12)
            if poll and not tripped and cd >= 2 and lb_exceeds(cd, can_bots * s / 12, kd, ctl_bots * s / 12, 1.25): tripped = True
        trip += tripped
        lb125 += cd >= 2 and lb_exceeds(cd, can_bots * hours, kd, ctl_bots * hours, 1.25)
        lb2 += cd >= 2 and lb_exceeds(cd, can_bots * hours, kd, ctl_bots * hours, 2.0)
    return trip / reps, lb125 / reps, lb2 / reps
random.seed(5)
print('   k   today: trip at any poll (10 bots, 6 h)   24 h/20 bots: LB>1.25 at end   LB>2.0 at end   extra items lost/bot-h')
for k in (1.0, 1.5, 2.0, 3.0, 4.0):
    t6, _, _ = sim(k, 10, 70, 6, reps=3000)
    _, a, b = sim(k, 20, 60, 24, poll=False, reps=3000)
    print(f'  {k:3.1f}   {100*t6:5.1f}%                                 {100*a:5.1f}%                         {100*b:5.1f}%          {(k-1)*r0*lost_per_death:5.1f}')



# ---- B2. THE WHOLE RULE, simulated jointly, against BOTH fair baselines (reviews round 3).
# Three rules, each on its own shape, polled every 5 min (deaths arrive per 5-min step, Poisson):
#   TODAY-6h    10 canary bots vs 70, 6 h: REVERT iff the live gate (>= 2, LB > 1.25) trips at any poll.
#   TODAY-24h   20 canary bots vs 60, 24 h, the SAME live gate unchanged: REVERT iff it trips at any poll. This isolates
#               what the longer read alone buys.
#   PROPOSED    20 vs 60, 24 h:
#                 - every canary death is classified when it happens: LINKED if coincidentally linked
#                   (p_link = 1 - exp(-1.45 own rows/bot-h * 120/3600) = 4.7%, junkwell-01's row rate; the 16-block spatial
#                   half is NOT modelled) or if it is the SAME BOT's second death (each death lands on a random one of the
#                   20 canary bots);
#                 - REVERT at any poll if the live gate has tripped AND any linked death exists;
#                 - REVERT at any poll if the interim ceiling trips (>= 2 deaths and LB > 2.0);
#                 - at 24 h REVERT if the net-output DiD < the null 2.5th percentile, where
#                   net DiD = (a draw from the empirical 24 h null, A2') + g - items_per_death * (canary deaths/canary bot-h - r0)
#                   (the null draw already carries ordinary death-loss noise, so this double-counts some: conservative
#                   toward REVERT; the null is on RAW items, see the doc);
#                 - otherwise KEEP.
# A harmful fix's deaths are modelled as EXPOSURE deaths (never made linked on purpose): this is the bag-fix case.
# Reported per rule: P(REVERT), and the expected EXTRA canary deaths (above k=1) suffered before the decision.
def run_rule(rule, k, g, reps, p_link=1 - math.exp(-1.45 * 120 / 3600), same_bot=True, linked_test=False):
    netnull = r24['net']; thr = q(netnull, .025)
    nb, kb_, hours = (10, 70, 6) if rule == 'today6' else (20, 60, 24)
    rev = 0; extra = 0.0; why = Counter()
    for _ in range(reps):
        cd = kd = 0; linked = 0; seen = set(); tripped = False; done = False; steps = hours * 12
        for s in range(1, steps + 1):
            new = pois(r0 * k * nb / 12); cd += new; kd += pois(r0 * kb_ / 12)
            if rule == 'proposed':
                for _ in range(new):
                    b = random.randrange(nb)
                    if (same_bot and b in seen) or random.random() < p_link: linked += 1
                    seen.add(b)
            if cd >= 2:
                if not tripped and lb_exceeds(cd, nb * s / 12, kd, kb_ * s / 12, 1.25): tripped = True
                if rule in ('today6', 'today24') and tripped:
                    done = True; why['gate'] += 1
                elif rule == 'proposed' and tripped and linked and (not linked_test or _binom_sf(linked, cd, p_link) < 0.01):
                    done = True; why['linked'] += 1
                elif rule == 'proposed' and lb_exceeds(cd, nb * s / 12, kd, kb_ * s / 12, 2.0):
                    done = True; why['ceiling'] += 1
            if done:
                extra += (k - 1) * r0 * nb * s / 12; break
        if not done:
            extra += (k - 1) * r0 * nb * hours
            if rule == 'proposed':
                net = random.choice(netnull) + g - lost_per_death * (cd / (nb * hours) - r0)
                if net < thr: done = True; why['net'] += 1
        rev += done
    return rev / reps, extra / reps, {kk: v / reps for kk, v in why.items()}


random.seed(21)
REPS = 2000
ONLY_B4 = os.environ.get('ONLY_B4') == '1'
print(f"\nB2 whole rules, jointly (p_link {100*(1-math.exp(-1.45*120/3600)):.1f}% + same-bot second death; net threshold {q(r24['net'], .025):+.1f} items/bot-h; {REPS} reps each)")
print('   k    g  | TODAY-6h REVERT  extra deaths | TODAY-24h REVERT  extra deaths | PROPOSED REVERT  extra deaths  (linked / ceiling / net)')
for k, g in (() if ONLY_B4 else ((1.0, 0), (1.5, 0), (2.0, 0), (3.0, 0), (1.0, 20), (2.0, 20), (3.0, 20))):
    a = run_rule('today6', k, g, REPS); b = run_rule('today24', k, g, REPS); c = run_rule('proposed', k, g, REPS)
    w = c[2]
    print(f"  {k:3.1f}  {g:+3d} |   {100*a[0]:5.1f}%        {a[1]:5.1f}     |   {100*b[0]:5.1f}%          {b[1]:5.1f}      |  {100*c[0]:5.1f}%        {c[1]:5.1f}"
          f"        ({100*w.get('linked',0):.1f} / {100*w.get('ceiling',0):.1f} / {100*w.get('net',0):.1f})", flush=True)


# SAME-BOT LINKAGE COLLAPSES THE RULE (result of the table above): ~16 deaths over 20 bots in 24 h put two deaths on one
# bot by coincidence almost every time, so "same bot twice = linked" turns the proposed rule back into today's gate at
# 24 h (and raises its false revert). The rule is therefore re-run WITHOUT it: linked = the fix's own rows only.
random.seed(22)
print('\nB3 PROPOSED without same-bot linkage (linked = own rows within 120 s only)')
print('   k    g  | PROPOSED REVERT  extra deaths  (linked / ceiling / net)')
for k, g in (() if ONLY_B4 else ((1.0, 0), (1.5, 0), (2.0, 0), (3.0, 0), (1.0, 20), (2.0, 20), (3.0, 20))):
    c = run_rule('proposed', k, g, REPS, same_bot=False); w = c[2]
    print(f"  {k:3.1f}  {g:+3d} |  {100*c[0]:5.1f}%        {c[1]:5.1f}        ({100*w.get('linked',0):.1f} / {100*w.get('ceiling',0):.1f} / {100*w.get('net',0):.1f})", flush=True)


# ANY-LINKED ALSO COLLAPSES IT (B3): at k = 2 a 24 h read holds ~33 canary deaths, and with 4.7% coincidental linkage per
# death at least one "linked" death is ~80% likely. So the linked branch must test for linkage BEYOND coincidence:
# REVERT on linkage only when P(X >= linked | Binomial(deaths, p_link)) < 0.01.
random.seed(23)
print('\nB4 PROPOSED, linked = own rows within 120 s, REVERT on linkage only beyond coincidence (binomial p < 0.01)')
print('   k    g  | PROPOSED REVERT  extra deaths  (linked / ceiling / net)')
for k, g in ((1.0, 0), (1.5, 0), (2.0, 0), (3.0, 0), (1.0, 20), (2.0, 20), (3.0, 20)):
    c = run_rule('proposed', k, g, REPS, same_bot=False, linked_test=True); w = c[2]
    print(f"  {k:3.1f}  {g:+3d} |  {100*c[0]:5.1f}%        {c[1]:5.1f}        ({100*w.get('linked',0):.1f} / {100*w.get('ceiling',0):.1f} / {100*w.get('net',0):.1f})", flush=True)
