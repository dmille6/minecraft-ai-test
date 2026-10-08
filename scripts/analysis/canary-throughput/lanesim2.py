"""Reviewer variant of lanesim.py: same draw rule, plus
 (a) A3 control churn: for each canary, control = 16 pools - own - every pool the OTHER lane held at any time in
     [declared - 6h, end]; report median / p10 / min of drawable-pool controls (+placebo-c), and of all controls
     (+4 isolated).
 (b) double-KEEP staleness: a KEEP whose lane overlapped another lane's KEEP that got promoted first ships only with
     prob v (a registered variant on the first's sha); else it is re-queued (slot spent, no decision).
 (c) post-promotion variant latency: after each promotion, with prob pl the next launch waits L h (observed 3 of 9).
Counts SHIPPED decisions/day."""
import random, statistics, sys
DUR = [26.4, 6.2, 6.3, 6.2, 6.3, 0.5, 5.2, 6.3, 6.2, 9.2, 6.2, 11.0, 3.1]   # oretunnel unclipped
STEP = 1 / 3.0
NPOOL = 11


def sim(lanes, E, q, mode, v=0.5, pl=0.33, L=1.7, days=30, seed=0, dur=DUR):
    rnd = random.Random(seed)
    free_at = [0.0] * NPOOL
    live = [None] * lanes
    t = 0.0; decided = 0; pending = False; hold_until = 0.0; H = days * 24
    ctrl_nd, ctrl_all, hist = [], [], []
    while t < H:
        for i, c in enumerate(live):
            if c and c['end'] <= t:
                for p in c['pools']:
                    free_at[p] = t + E
                if lanes > 1:
                    touched = set()
                    for (ln, ps, a, b) in hist:
                        if ln != i and a < c['end'] and b > c['t0'] - 6:
                            touched |= set(ps)
                    for j, o in enumerate(live):
                        if j != i and o:
                            touched |= set(o['pools'])
                    nd = NPOOL - len(c['pools']) - len(touched - set(c['pools'])) + 1
                    ctrl_nd.append(nd); ctrl_all.append(nd + 4)
                hist.append((i, c['pools'], c['t0'], c['end']))
                ships = True
                if c['keep'] and mode == 'barrier' and c['stale']:
                    ships = rnd.random() < v
                if ships:
                    decided += 1
                if c['keep'] and ships:
                    if mode == 'barrier':
                        pending = True
                        for o in live:
                            if o and o is not c:
                                o['stale'] = True
                    elif rnd.random() < pl:
                        hold_until = max(hold_until, t + L)
                live[i] = None
        if pending and all(c is None for c in live):
            pending = False
            if rnd.random() < pl:
                hold_until = max(hold_until, t + L)
        busy = {p for c in live if c for p in c['pools']}
        for i in range(lanes):
            if live[i] is None and not (mode == 'barrier' and pending) and t >= hold_until:
                elig = [p for p in range(NPOOL) if p not in busy and free_at[p] <= t and rnd.random() < q]
                if len(elig) >= 2:
                    pick = rnd.sample(elig, min(4, len(elig)))
                    live[i] = dict(end=t + 0.2 + rnd.choice(dur), pools=pick, keep=rnd.random() < 0.68, t0=t, stale=False)
                    busy |= set(pick)
        t += STEP
    return decided / days, ctrl_nd, ctrl_all


def run(lanes, E, q, mode, reps=40, **k):
    ds, nd, al = [], [], []
    for s in range(reps):
        d, a, b = sim(lanes, E, q, mode, seed=s, **k); ds.append(d); nd += a; al += b
    nd.sort(); al.sort()
    pc = lambda s, p: s[int(p * (len(s) - 1))] if s else float('nan')
    return statistics.mean(ds), (pc(nd, .5), pc(nd, .1), pc(nd, 0)), (pc(al, .5), pc(al, .1))


if __name__ == '__main__':
    pl = float(sys.argv[1]) if len(sys.argv) > 1 else 0.33
    print('shipped decisions/day; oretunnel unclipped 26.4h; post-promotion variant latency p=%.2f L=1.7h' % pl)
    for E in (12, 6):
        for q in (0.5, 0.9):
            one = run(1, E, q, 'independent', pl=pl)[0]
            for v in (1.0, 0.5, 0.0):
                two, nd, al = run(2, E, q, 'barrier', v=v, pl=pl)
                print('E=%2d q=%.1f  1 lane %.2f | 2 lanes barrier v=%.1f %.2f (%+.0f%%) | ctrl drawable+placebo-c med %d p10 %d min %d | all ctrl med %d p10 %d'
                      % (E, q, one, v, two, 100 * (two / one - 1), nd[0], nd[1], nd[2], al[0], al[1]))
