#!/usr/bin/env python3
"""keep180_power.py <bins.pkl> [check]  -- the owner's KEEP-at-+180 calibration (10-08): does KEEPing a four-pool bag fix at
+180 let more HARMFUL changes through than today's two-pool KEEP at +360?

A KEEP needs every harm guard silent. A harmful change is "falsely KEPT" when its harm does not trip any guard by the KEEP
read. For each design -- A: 4 random drawable pools read at +180; B: 2 random drawable pools read at +360 -- every
6-h cut (keep180_bins.py) gives up to 20 no-change draws, scored with immobiledid's guard rules (score() below):
  v15c  breaches: blocks moved/bh < -30%, working share < -20%, items gathered/bh < -50%, immobile share > +10 pp with
        >= 2 newly immobile canary bots; REVERT on >= 2 breaches or one severe (-50/-40/-70/+20 pp & 3)
  v11   climb firings/bh > +100%, livelock rows/bh > +100%, ladders p90 > 32
HARM is injected into the canary POST of each null draw as a multiplicative effect on one guard's numerator (a harm that
cuts movement, work or gathering by f, or multiplies climbs/livelock by h), the rest left as measured, and the draw is
re-scored: false KEEP = no REVERT from the guards. (The DEATH gate is computed separately on the death bins with the
same draws: keep180_deaths in usafe_null's machinery.) Reported per harm: P(false KEEP | A) vs P(false KEEP | B).
`check` mode: asserts score() equals the live immobiledid evidence objects on disk for real canaries (positive control)."""
import os, sys, json, glob, pickle, random, itertools, datetime as dt
D = pickle.load(open(sys.argv[1], 'rb'))['cuts'] if __name__ == '__main__' else {}
pool_of = lambda b: '-'.join(b.split('-')[:2])


def score(stats, canary_pools, post_key, harm=None):
    """immobiledid's guard fields for one draw. stats: {bot: {'pre': {...}, post_key: {...}}}. harm: (metric, factor)
    applied to the canary POST numerator."""
    A = {(a, e): {'mins': 0, 'imm': 0, 'mv': 0.0, 'wk': 0, 'it': 0.0, 'cl': 0, 'll': 0, 'deaths': 0} for a in ('canary', 'control') for e in ('pre', 'post')}
    newly = 0; spent = []
    for b, s in stats.items():
        arm = 'canary' if pool_of(b) in canary_pools else 'control'
        for era, key in (('pre', 'pre'), ('post', post_key)):
            x = s.get(key) or {}
            for f in A[(arm, era)]:
                A[(arm, era)][f] += x.get(f, 0)
        if arm == 'canary':
            if (s.get(post_key) or {}).get('run30') and not (s.get('pre') or {}).get('run30'):
                newly += 1
            spent += (s.get(post_key) or {}).get('spent', [])
    if harm:
        f, k = harm
        A[('canary', 'post')][f] *= k
    R = {}
    for k, a in A.items():
        h = a['mins'] / 60
        R[k] = {'imm': a['imm'] / a['mins'] if a['mins'] else float('nan'), 'mv': a['mv'] / h if h else float('nan'),
                'wk': a['wk'] / a['mins'] if a['mins'] else float('nan'), 'it': a['it'] / h if h else float('nan'),
                'cl': a['cl'] / h if h else float('nan'), 'llbh': a['ll'] / h if h else float('nan')}

    def rdid(f):
        try:
            return (R[('canary', 'post')][f] / R[('canary', 'pre')][f]) / (R[('control', 'post')][f] / R[('control', 'pre')][f]) - 1
        except ZeroDivisionError:
            return float('nan')
    ci, ki = R[('canary', 'pre')]['imm'], R[('canary', 'post')]['imm']; cc, kc = R[('control', 'pre')]['imm'], R[('control', 'post')]['imm']
    imm_pp = ((ki - ci) - (kc - cc)) * 100
    v15 = [('moved', rdid('mv'), -0.30), ('work', rdid('wk'), -0.20), ('items', rdid('it'), -0.50)]
    breach = [nm for nm, v, lim in v15 if v == v and v < lim] + (['immobile'] if imm_pp > 10 and newly >= 2 else [])
    severe = [nm for nm, v, lim in zip(['moved', 'work', 'items'], [v for _n, v, _l in v15], [-0.50, -0.40, -0.70]) if v == v and v < lim] + (['immobile'] if imm_pp > 20 and newly >= 3 else [])
    undef = [nm for nm, v, lim in v15 if v != v]
    v15_rev = len(undef) < len(v15) and (len(breach) >= 2 or bool(severe))
    v15_unread = len(undef) == len(v15)
    cl, llb = rdid('cl'), rdid('llbh')
    p90 = sorted(spent)[int(len(spent) * 0.9)] if spent else 0
    v11_rev = (cl == cl and cl > 1.0) or (llb == llb and llb > 1.0) or p90 > 32
    return {'moved': rdid('mv'), 'work': rdid('wk'), 'items': rdid('it'), 'imm_pp': imm_pp / 100, 'newly': newly, 'climbs': cl,
            'livelock': llb, 'p90': p90, 'v15c_revert': v15_rev, 'v15c_unreadable': v15_unread, 'v11_revert': v11_rev,
            'any_revert': v15_rev or v11_rev, 'breach': breach, 'severe': severe,
            'canary_bot_h': A[('canary', 'post')]['mins'] / 60, 'canary_deaths': A[('canary', 'post')]['deaths']}


DESIGNS = {'A (4 pools, KEEP at +180)': (4, 'post180'), 'B (2 pools, KEEP at +360, today)': (2, 'post360'),
           'C (4 pools, KEEP at +360)': (4, 'post360')}
HARMS = [('none (null: false REVERT rate)', None), ('movement -40%', ('mv', 0.6)), ('movement -60%', ('mv', 0.4)),
         ('work -30%', ('wk', 0.7)), ('work -50%', ('wk', 0.5)), ('gathering -60%', ('it', 0.4)), ('gathering -80%', ('it', 0.2)),
         ('climbs x2.5', ('cl', 2.5)), ('climbs x4', ('cl', 4.0)), ('livelock x2.5', ('ll', 2.5)), ('livelock x4', ('ll', 4.0))]

if __name__ == '__main__' and len(sys.argv) > 2 and sys.argv[2] == 'check':
    # POSITIVE CONTROL: score() on bins built for real canaries' windows vs their immobiledid evidence on disk
    sys.exit('use keep180_check.py')

if __name__ == '__main__':
    pools = sorted({pool_of(b) for c in D.values() for b in c})
    drawable = [p for p in pools if p != 'placebo-c' and not p.startswith('isolated')]
    res = {d: {h: [] for h, _ in HARMS} for d in DESIGNS}
    n = {d: 0 for d in DESIGNS}
    for iso, stats in sorted(D.items()):
        cut = dt.datetime.fromisoformat(iso)
        for d, (k, key) in DESIGNS.items():
            combos = list(itertools.combinations(drawable, k))
            for draw in random.Random(int(cut.timestamp()) + k).sample(combos, min(20, len(combos))):
                base = score(stats, set(draw), key)
                if base['v15c_unreadable'] or base['canary_bot_h'] < 15:
                    continue        # immobiledid would not be readable: no KEEP either way
                n[d] += 1
                for h, hv in HARMS:
                    s = score(stats, set(draw), key, hv) if hv else base
                    res[d][h].append(s['any_revert'])
    days = len({iso[:10] for iso in D})
    print('draws scored: %s over %d cuts / %d days (no-change, any build)' % (n, len(D), days))
    print(('%-22s' + ' %30s' * len(DESIGNS)) % ('harm injected', *[d[:30] for d in DESIGNS]))
    for h, _ in HARMS:
        row = []
        for d in DESIGNS:
            xs = res[d][h]
            caught = sum(xs) / len(xs) if xs else float('nan')
            row.append(('false REVERT %5.1f%%' % (100 * caught)) if h.startswith('none') else ('false KEEP %5.1f%%' % (100 * (1 - caught))))
        print(('%-22s' + ' %30s' * len(DESIGNS)) % (h, *row))
