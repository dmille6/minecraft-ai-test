#!/usr/bin/env python3
"""ugsafe2_jw.py <an.pkl> <rowsdir>  -- the EXPOSURE-NORMALISED death reading, grounded on junkwell-01 and calibrated on
a null.

junkwell-01: 911d792 on placebo-a + board-b (10 bots) 10-05 10:05:00Z -> 15:13:00Z (reverted by the death gate:
6 canary deaths / 51.1 bot-h vs 11 / 358.2). PRE = the 5 h 08 min before (04:57 -> 10:05Z; the fleet was 1918bb5 from
~00:07Z, no restart inside). CONTROL = every other bot that ran only 1918bb5 in both periods.

Per group x period: bot-h, underground bot-h (y < 56), mine rows, deaths (all / underground / by cause), deaths per 100
underground bot-h and per 1,000 mine rows, items gained per bot-h (bagcost.py's definition), items and iron pickaxes
carried at death, net items per bot-h = (gained - carried at death) / bot-h. MECHANISM-LINKED deaths: a row of the
change's own kinds (`*well*`) by the same bot in the 120 s before the death.

NULL: the same statistics for 2 whole pools drawn at random (never placebo-c/isolated, as drawrec.sh) against the rest,
over every 5 h 08 min post window (with its own 5 h 08 min pre) sliding by 1 h through P1+MID+POST, skipping windows
that touch an outage or junkwell's own window. Reports how often each candidate rule would REVERT identical code.
"""
import sys, os, glob, pickle, random, math
from collections import Counter, defaultdict
sys.argv, ARGS = sys.argv[:2], sys.argv[2:]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R
from ugsafe2_extract import F_T, F_KIND, F_VER
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from deathgate import ratio_lower_bound   # the LIVE gate's bound (scripts/deathgate.py)

A = R.A; BIN = R.BIN; E = R.E
D0, D1 = E('2026-10-05T10:05:00'), E('2026-10-05T15:13:00')
L = D1 - D0
P0 = D0 - L
CAN_POOLS = ('placebo-a', 'board-b')
pool_of = lambda b: '-'.join(b.split('-')[:2])


def group_stats(bots, t0, t1):
    c = Counter()
    for b in bots:
        for k, cnt in A['bins'].get(b, {}).items():
            if t0 <= k * BIN < t1: c.update(cnt)
    ds = [d for d in A['deaths'] if d['bot'] in bots and t0 <= d['t'] < t1]
    return c, ds


def summary(c, ds, linked=()):
    h, ug = c['sec'] / 3600, c['ug'] / 3600
    n = len(ds); nug = sum(1 for d in ds if d['y'] is not None and d['y'] < 56)
    lost = sum(d['bag']['items'] for d in ds); iron = sum(d['bag']['iron_pick'] for d in ds)
    return {'bot_h': h, 'ug_h': ug, 'ug_share': ug / h if h else 0, 'mine': c['mine'], 'mine_ug': c['mine_ug'],
            'mine_per_bot_h': c['mine'] / h if h else 0, 'deaths': n, 'deaths_ug': nug,
            'causes': dict(Counter(d['cause'] for d in ds)),
            'd_per_bot_h': n / h if h else 0, 'd_per_100ug': 100 * n / ug if ug else float('nan'),
            'd_per_1000mine': 1000 * n / c['mine'] if c['mine'] else float('nan'),
            'gained_per_bot_h': c['gained'] / h if h else 0, 'lost_items': lost, 'lost_ironpick': iron,
            'net_per_bot_h': (c['gained'] - lost) / h if h else 0, 'linked': len(linked)}


# ---- control = bots on 1918bb5 only in both periods
def versions(b, t0, t1):
    v = Counter()
    for k, cnt in A['vers'].get(b, {}).items():
        if t0 <= k * BIN < t1: v.update(cnt)
    return v


bots = sorted(A['bins'])
can = [b for b in bots if pool_of(b) in CAN_POOLS]
ctl = [b for b in bots if b not in can and set(versions(b, P0, D1)) <= {'1918bb5'} and versions(b, P0, D1)]
print(f'junkwell-01: canary {len(can)} bots, control {len(ctl)} bots (on 1918bb5 only, {len([b for b in bots if b not in can]) - len(ctl)} excluded)')
print('canary versions post:', dict(sum((versions(b, D0, D1) for b in can), Counter())))
# linked deaths
link = {}
for d in A['deaths']:
    if d['bot'] in can and D0 <= d['t'] < D1:
        rows = pickle.load(open(os.path.join(ARGS[0], d['bot'] + '.pkl'), 'rb'))['rows']
        near = [r for r in rows if d['t'] - 120 <= r[F_T] <= d['t'] and 'well' in r[F_KIND]]
        link[(d['bot'], d['t'])] = len(near) > 0
S = {}
for g, gb in (('canary', can), ('control', ctl)):
    for p, (t0, t1) in (('pre', (P0, D0)), ('post', (D0, D1))):
        c, ds = group_stats(set(gb), t0, t1)
        S[(g, p)] = summary(c, ds, [k for k, v in link.items() if v and t0 <= k[1] < t1 and g == 'canary'])
        s = S[(g, p)]
        print(f"  {g:7s} {p:4s} bot-h {s['bot_h']:6.1f} ug-h {s['ug_h']:6.1f} ({100*s['ug_share']:4.1f}%) mine {s['mine']:5d} ({s['mine_per_bot_h']:.2f}/bot-h, per bot {s['mine']/len(gb):.1f})"
              f" deaths {s['deaths']} ug {s['deaths_ug']} {s['causes']} | per bot-h {s['d_per_bot_h']:.4f} per 100 ug-h {s['d_per_100ug']:.2f} per 1000 mine {s['d_per_1000mine']:.2f}"
              f" | gained/bot-h {s['gained_per_bot_h']:.1f} lost at death {s['lost_items']} iron picks lost {s['lost_ironpick']} NET/bot-h {s['net_per_bot_h']:.1f} linked {s['linked']}")
cp, cq, kp, kq = S[('canary', 'pre')], S[('canary', 'post')], S[('control', 'pre')], S[('control', 'post')]
print('\nDiD (canary post-pre minus control post-pre):')
for key in ('mine_per_bot_h', 'ug_share', 'd_per_bot_h', 'd_per_100ug', 'd_per_1000mine', 'gained_per_bot_h', 'net_per_bot_h'):
    a, b, c, d = cq[key], cp[key], kq[key], kp[key]
    print(f'  {key:18s} canary {b:8.3f} -> {a:8.3f}   control {d:8.3f} -> {c:8.3f}   DiD {(a-b)-(c-d):+9.3f}')
print('rate ratios post (canary/control): per bot-h %.2f  per 100 ug-h %.2f  per 1000 mine %.2f' % (
    cq['d_per_bot_h'] / kq['d_per_bot_h'], cq['d_per_100ug'] / kq['d_per_100ug'], cq['d_per_1000mine'] / kq['d_per_1000mine']))
wellrows = 0
for b in can:
    wellrows += sum(1 for r in pickle.load(open(os.path.join(ARGS[0], b + '.pkl'), 'rb'))['rows'] if D0 <= r[F_T] < D1 and 'well' in r[F_KIND])
print('mechanism-linked canary deaths (a *well* row by the same bot in the 120 s before):', sum(link.values()), 'of', len(link),
      '| POSITIVE CONTROL: canary *well* rows in POST', wellrows)
# expected canary deaths at the control's exposure-normalised rate
exp_ug = cq['ug_h'] * kq['deaths'] / kq['ug_h']
exp_bh = cq['bot_h'] * kq['deaths'] / kq['bot_h']
exp_mine = cq['mine'] * kq['deaths'] / kq['mine']
def ppois_ge(k, lam):
    return 1 - sum(math.exp(-lam) * lam ** i / math.factorial(i) for i in range(k))
print(f"expected canary deaths at the control rate: per bot-h {exp_bh:.2f}, per ug bot-h {exp_ug:.2f}, per mine row {exp_mine:.2f}; observed {cq['deaths']}")
print(f"  P(>= {cq['deaths']} | Poisson) : bot-h {ppois_ge(cq['deaths'], exp_bh):.4f}  ug-h {ppois_ge(cq['deaths'], exp_ug):.4f}  mine {ppois_ge(cq['deaths'], exp_mine):.4f}")


# ---- NULL: identical code, random 2-pool canaries over sliding windows
def rule_eval(cq, kq, cp, kp):
    """The live gate (>= 2 deaths AND one-sided 95% lower bound of the rate ratio > 1.25) on three exposures."""
    n = cq['deaths']
    lb_bh = ratio_lower_bound(n, cq['bot_h'], kq['deaths'], kq['bot_h'])
    lb_ug = ratio_lower_bound(n, cq['ug_h'], kq['deaths'], kq['ug_h'])
    lb_mine = ratio_lower_bound(n, cq['mine'], kq['deaths'], kq['mine']) if cq['mine'] and kq['mine'] else 0.0
    return {'G0 LIVE gate: >=2 & LB(per bot-h) > 1.25': n >= 2 and lb_bh > 1.25,
            'G1 >=2 & LB(per underground bot-h) > 1.25': n >= 2 and lb_ug > 1.25,
            'G2 >=2 & LB(per mine row) > 1.25': n >= 2 and lb_mine > 1.25,
            'P  point ratio per bot-h > 1.25 & >=2 (old)': n >= 2 and kq['d_per_bot_h'] > 0 and cq['d_per_bot_h'] / kq['d_per_bot_h'] > 1.25,
            '_lb': (lb_bh, lb_ug, lb_mine)}


je = rule_eval(cq, kq, cp, kp)
print('\njunkwell-01 lower bounds (per bot-h, per ug bot-h, per mine row): %.2f %.2f %.2f' % je['_lb'])
print('junkwell-01 under each rule:', {k: ('REVERT' if v else 'keep') for k, v in je.items() if k != '_lb'})
random.seed(7)
eligible = sorted({pool_of(b) for b in bots if not (pool_of(b) == 'placebo-c' or pool_of(b).startswith('isolated'))})
starts = []
t = R.WIN['P1'][0] + L
while t + L <= R.WIN['POST'][1]:
    a0, a1 = t - L, t + L
    bad = any(not (y <= a0 or x >= a1) for x, y in R.OUT) or not (a1 <= P0 or a0 >= D1 + 3600)
    if not bad: starts.append(t)
    t += 3600
trips = Counter(); n = 0; mine_did = []; gain_did = []; net_did = []; ugs_did = []; dropped = Counter()
for t in starts:
    # IDENTICAL CODE: keep only bots that ran nothing but the window's majority version in PRE and POST, and draw
    # only from pools all of whose bots remain (a live canary's pools drop out of that window's null entirely).
    vv = {b: versions(b, t - L, t + L) for b in bots}
    maj = sum(vv.values(), Counter()).most_common(1)[0][0]
    same = {b for b in bots if vv[b] and set(vv[b]) == {maj}}
    elig_w = [p for p in eligible if all(b in same for b in bots if pool_of(b) == p)]
    dropped[len(bots) - len(same)] += 1
    if len(elig_w) < 4: continue
    for _ in range(6):
        pools = random.sample(elig_w, 2)
        cb = {b for b in bots if pool_of(b) in pools}; kb = {b for b in same if b not in cb}
        res = {}
        for g, gb in (('c', cb), ('k', kb)):
            for p, (t0, t1) in (('pre', (t - L, t)), ('post', (t, t + L))):
                c, ds = group_stats(gb, t0, t1); res[(g, p)] = summary(c, ds)
        if res[('c', 'post')]['bot_h'] < 20 or res[('k', 'post')]['deaths'] == 0: continue
        n += 1
        for k, v in rule_eval(res[('c', 'post')], res[('k', 'post')], res[('c', 'pre')], res[('k', 'pre')]).items():
            if k != '_lb': trips[k] += v
        did = lambda key: (res[('c', 'post')][key] - res[('c', 'pre')][key]) - (res[('k', 'post')][key] - res[('k', 'pre')][key])
        gain_did.append(did('gained_per_bot_h')); net_did.append(did('net_per_bot_h')); ugs_did.append(did('ug_share'))
        mine_did.append((res[('c', 'post')]['mine_per_bot_h'] - res[('c', 'pre')]['mine_per_bot_h']) - (res[('k', 'post')]['mine_per_bot_h'] - res[('k', 'pre')]['mine_per_bot_h']))
print(f'\nNULL: {n} random 2-pool draws over {len(starts)} windows of {L/3600:.2f} h (single-version bots only; bots dropped per window: {dict(sorted(dropped.items()))}). Share that each rule would act on (ONE evaluation at the end; the live gate polls every 5 min):')
for k, v in trips.items():
    print(f'  {k:45s} {100*v/n:5.1f}%')
jdid = lambda key: (cq[key] - cp[key]) - (kq[key] - kp[key])
for name, arr, key in (('mine rows/bot-h', mine_did, 'mine_per_bot_h'), ('underground share', ugs_did, 'ug_share'),
                       ('items gained/bot-h', gain_did, 'gained_per_bot_h'), ('NET items/bot-h', net_did, 'net_per_bot_h')):
    arr.sort(); q = lambda p: arr[min(len(arr) - 1, int(p * len(arr)))]
    j = jdid(key); rank = sum(1 for v in arr if v <= j) / len(arr)
    print(f'  null {name:20s} DiD: p2.5 {q(.025):+8.2f}  p50 {q(.5):+8.2f}  p97.5 {q(.975):+8.2f}   junkwell {j:+8.2f} (null percentile {100*rank:.0f})')
