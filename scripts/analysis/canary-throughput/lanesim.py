"""lanesim.py -- decisions per day for 1 vs 2 canary lanes under the real draw rule's pool budget.

Model (every parameter measured or stated):
  * pools: 11 drawable (16 - isolated-a..d - placebo-c), or 15 if isolated were admitted.
  * a canary needs >= 2 ELIGIBLE pools and takes min(4, eligible) (drawrec.sh TARGET_K=4, MIN_K=2).
  * a free pool (not live, not inside its post-decision exclusion E) is eligible with probability q per draw attempt
    (the +-40% band and the registration's exposure filter; q is swept because it varies by registration).
  * canary duration: resampled from the 13 decided canaries 10-03..10-07 (h): 22.8 6.2 6.3 6.2 6.3 0.5 5.2 6.3 6.2 9.2
    6.2 11.0 3.1.  Draw attempts every 20 min (drawrec cadence).  Launch overhead 0.2 h.
  * the queue is never empty (the best case for lanes: it isolates the pool budget as the constraint).
  * 'independent': each lane relaunches as soon as it is free (ignores the promotion problem).
    'barrier': a KEEP (p=0.68, 15 of 22 decisions since 09-28) is promoted only when NO lane is live, and no lane may
    launch while a promotion is pending (a canary started on the old base would see its control change mid-read).
"""
import random, statistics, sys

DUR = [22.8, 6.2, 6.3, 6.2, 6.3, 0.5, 5.2, 6.3, 6.2, 9.2, 6.2, 11.0, 3.1]
STEP = 1 / 3.0  # 20 min


def sim(npools, lanes, E, q, mode, days=30, seed=0):
    rnd = random.Random(seed)
    free_at = [0.0] * npools          # time a pool leaves its exclusion
    live = [None] * lanes              # (end_time, pools, keep)
    t, decided, pending = 0.0, 0, False
    H = days * 24
    while t < H:
        # finish
        for i, c in enumerate(live):
            if c and c[0] <= t:
                for p in c[1]:
                    free_at[p] = t + E
                decided += 1
                if c[2] and mode == 'barrier':
                    pending = True
                live[i] = None
        if pending and all(c is None for c in live):
            pending = False            # promotion happens now (10 min, ignored)
        busy = {p for c in live if c for p in c[1]}
        for i in range(lanes):
            if live[i] is None and not (mode == 'barrier' and pending):
                elig = [p for p in range(npools) if p not in busy and free_at[p] <= t and rnd.random() < q]
                if len(elig) >= 2:
                    pick = rnd.sample(elig, min(4, len(elig)))
                    live[i] = (t + 0.2 + rnd.choice(DUR), pick, rnd.random() < 0.68)
                    busy |= set(pick)
        t += STEP
    return decided / days


def avg(*a, reps=60, **k):
    return statistics.mean(sim(*a, seed=s, **k) for s in range(reps))


if __name__ == '__main__':
    print('decisions/day (queue never empty; 60 x 30-day runs each)')
    print('%-16s %-4s %-5s %8s %8s %8s %8s' % ('pools', 'E', 'q', '1 lane', '2 indep', '2 barr', 'gain'))
    for npools in (11, 15):
        for E in (12, 6):
            for q in (0.5, 0.7, 0.9):
                one = avg(npools, 1, E, q, 'independent')
                two = avg(npools, 2, E, q, 'independent')
                bar = avg(npools, 2, E, q, 'barrier')
                print('%-16s %-4d %-5.1f %8.2f %8.2f %8.2f %+7.0f%%' % (
                    '%d%s' % (npools, ' (+isolated)' if npools == 15 else ''), E, q, one, two, bar, 100 * (bar / one - 1)))
