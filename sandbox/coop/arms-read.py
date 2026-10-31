"""THE B5 READ: the Paper arms' results (sandbox/log/arms-e2e/results.jsonl) against the design's go-live rules (s.6.2).

    python3 sandbox/coop/arms-read.py [results.jsonl] [--sha <prefix>]

PRIMARY: witnessed placements per hour over the window (`_build op=place` rows; `standing` = those cells still non-air at the
end, by RCON). Also minutes to the workshop's `_structure_complete` (a run that never completes it counts as the window).
Pairs are matched by seed (the same arrival schedule for every arm). Paired differences use an exact sign-flip permutation
test (all 2^n flips for n <= 16).
RULES (pre-registered in the design, applied here as written):
  instrument  starved < rotation (the metric can see staffing)
  headroom    oracle > rotation, paired p < 0.05 (otherwise: INCONCLUSIVE, headroom not demonstrated; nothing goes live)
  frontier    goes live if its paired mean >= greedy's - margin (margin = rotation SD / 2) AND it beats random (p < 0.05)
  greedy      if the frontier misses and greedy beats rotation: greedy live (no API spend); a frontier TIE -> greedy live,
              frontier in shadow (OWNER 10-23)
With fewer than 6 complete pairs the read says so and decides nothing.
"""
import itertools
import json
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
F = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(HERE, '..', 'log', 'arms-e2e', 'results.jsonl')
SHA = sys.argv[sys.argv.index('--sha') + 1] if '--sha' in sys.argv else None


def perm_p(diffs):
    """one-sided exact sign-flip p for mean(diffs) > 0"""
    n = len(diffs)
    if n == 0:
        return None
    obs = sum(diffs)
    flips = list(itertools.product((1, -1), repeat=n)) if n <= 16 else None
    hits = sum(1 for f in flips if sum(a * b for a, b in zip(f, diffs)) >= obs - 1e-9)
    return hits / len(flips)


def main():
    rows = [json.loads(l) for l in open(F) if l.strip()]
    if SHA:
        rows = [r for r in rows if r.get('sha', '').startswith(SHA)]
    rows = [r for r in rows if r.get('window_min', 0) >= 50]          # full windows only (pilots are shorter)
    by = {}
    for r in rows:
        by.setdefault(r['arm'], {})[r['seed']] = r
    arms = sorted(by)
    print('runs: %d full-window runs, arms %s' % (len(rows), ', '.join('%s=%d' % (a, len(by[a])) for a in arms)))
    m = lambda r: r['cells_per_h']
    t_ws = lambda r: next((c['rel_min'] for c in r['completes'] if 'workshop' in c['detail']), r['window_min'])
    print('\n%-30s %6s %8s %8s %9s %7s %6s %6s' % ('arm', 'pairs', 'cells/h', 'sd', 'ws_min', 'visits', 'deaths', 'usd'))
    for a in arms:
        xs = [m(r) for r in by[a].values()]
        print('%-30s %6d %8.1f %8.1f %9.1f %7.1f %6d %6.3f' % (a, len(xs), st.mean(xs), st.pstdev(xs) if len(xs) > 1 else 0,
              st.mean(t_ws(r) for r in by[a].values()), st.mean(r['build_visits'] for r in by[a].values()),
              sum(r['deaths'] for r in by[a].values()), sum(r.get('usd', 0) for r in by[a].values())))
    rot = by.get('rotation', {})
    if len(rot) < 2:
        print('\nno decision: fewer than 2 rotation runs'); return
    sd = st.stdev([m(r) for r in rot.values()])
    margin = sd / 2

    def paired(a, b):
        s = sorted(set(by.get(a, {})) & set(by.get(b, {})))
        d = [m(by[a][k]) - m(by[b][k]) for k in s]
        return s, d, (st.mean(d) if d else None), perm_p(d)
    print('\nrotation run-to-run SD %.1f cells/h -> margin %.1f' % (sd, margin))
    for a, b in [('starved', 'rotation'), ('oracle', 'rotation'), ('greedy', 'rotation'), ('random', 'rotation')] + \
            [(f, x) for f in arms if f.startswith('frontier:') for x in ('greedy', 'random', 'rotation')]:
        s, d, mean, p = paired(a, b)
        if s:
            print('  %-28s - %-9s n=%d mean %+7.1f  p(one-sided >0)=%s' % (a, b, len(s), mean, '%.3f' % p if p is not None else '-'))
    n_pairs = min((len(by.get(a, {})) for a in ('rotation', 'oracle', 'greedy', 'random')), default=0)
    print('\nDECISION (%d complete pairs of the deterministic arms):' % n_pairs)
    if n_pairs < 6:
        print('  NOT YET: the design needs >= 6 pairs; nothing is decided'); return
    s, d, mean, p = paired('oracle', 'rotation')
    if not (mean and mean > 0 and p < 0.05):
        print('  INCONCLUSIVE: headroom not demonstrated (oracle - rotation %+.1f, p=%.3f); B7 does not launch' % (mean or 0, p or 1)); return
    print('  headroom: oracle beats rotation (%+.1f cells/h, p=%.3f)' % (mean, p))
    gs, gd, gmean, gp = paired('greedy', 'rotation')
    for f in [a for a in arms if a.startswith('frontier:')]:
        s1, d1, fm, _ = paired(f, 'greedy')
        s2, d2, rm, rp = paired(f, 'random')
        ok = fm is not None and fm >= -margin and rm is not None and rm > 0 and rp < 0.05
        tie = fm is not None and abs(fm) <= margin
        print('  %s: vs greedy %+.1f (margin %.1f), vs random %+.1f p=%.3f -> %s' % (f, fm or 0, margin, rm or 0, rp or 1,
              ('TIE with greedy: greedy goes live, frontier stays in shadow' if tie else 'frontier >= greedy: may go live') if ok else 'misses'))
    print('  greedy vs rotation %+.1f p=%.3f' % (gmean or 0, gp or 1))


if __name__ == '__main__':
    main()
