#!/usr/bin/env python3
"""attrib.py <snapshot> <scan.jsonl> <host mods> <patches> -- READ-ONLY. For every draw since 10-12 that waited or drew
fewer than four pools: at each attempt, which ledger exclusion kept out a pool that WOULD otherwise have been eligible
(inside the +-40% band, through the exposure filter and the run's draw_exposure). This is what design 1 could buy:
an exclusion that only ever holds pools that would fail the band anyway costs nothing."""
import collections, datetime as dt, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawsim, replay_settle as RS

ISO = drawsim.ISO


def main(snap, scan, hostmods, patches):
    sim = drawsim.Sim(snap, scan, hostmods, patches)
    D = RS.draws(sim, drawsim.T('2026-10-12T00:00:00Z'))
    tally = collections.Counter()
    for x in D:
        kt, mk = sim.k_target(x['run'])
        ats = RS.attempts(x)
        if len(ats) == 1 and len(x['pools']) >= min(4, kt):
            continue
        print('\n%s: draw %s -> drawn %s (%d pools), %d attempt(s)' % (x['run'], ISO(x['start']), ISO(x['drawn']),
                                                                      len(x['pools']), len(ats)))
        for t in ats:
            e, info, out = sim.attribute(t, x['run'])
            cost = {p: v for p, v in out.items() if v[2]}
            print('  %s eligible %-34s held-but-would-fit: %s' % (ISO(t), ','.join(e) or '-', '; '.join(
                '%s <- %s%s' % (p, ', '.join('%s [%s, %s]' % (c, r, ('closed %.0f min' % a) if a is not None else 'open')
                                             for c, r, a in v[0]), (' {%s}' % v[1][0][:120]) if v[1] else '')
                for p, v in sorted(cost.items())) or '-'))
            for p, v in cost.items():
                for c, _r, _a in v[0]:
                    tally[c.split(' <')[0].split(',')[0]] += 1
    print('\npool-attempts lost, by the exclusion that held a pool that would have fit:')
    for k, n in tally.most_common():
        print('  %4d  %s' % (n, k))


if __name__ == '__main__':
    main(*sys.argv[1:5])
