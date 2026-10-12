#!/usr/bin/env python3
"""C2 readout from the pre-registered metrics (c2_analyze.py's per-run rows, 70-min horizon): block-paired
contrasts with paired-t 95% intervals (3 blocks -> df=2, t=4.303; the run is the unit), per-block ratios, the
directive funnel BY STATUS and ORIGIN from the bots' own rows, and escalation episodes (intent-to-treat).
    python3 c2_analyze.py results/runs.jsonl > results/c2-readout-raw.txt && python3 c2_readout.py results/c2-readout-raw.txt
"""
import collections, json, math, statistics as st, sys
T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571}
rows = [json.loads(l) for l in open(sys.argv[1]) if l.startswith('{')]
by = {(r['arm'], r['block']): r for r in rows}
blocks = sorted({r['block'] for r in rows})
arms = ['none', 'det', 'ov', 'esc']
METRICS = [('output', 'team output at 70 min (PRIMARY)'), ('stuck_min', 'stuck min per bot'),
           ('stone', 'bots with a stone pickaxe'), ('iron', 'bots with an iron ingot'), ('deaths', 'deaths'),
           ('lat_p50', 'decision latency p50 (s)')]
CONTRASTS = [('det', 'none', 'pre-registered: an allocator + actuator at all'), ('ov', 'det', 'pre-registered: the LLM allocation'),
             ('esc', 'none', 'pre-registered: rescue'), ('ov', 'none', 'descriptive only')]
out = {'per_arm': {}, 'contrasts': {}, 'funnel': {}, 'episodes': {}}
print('| metric | ' + ' | '.join(arms) + ' |\n|---|' + '---|' * len(arms))
for m, label in METRICS:
    cells = []
    for a in arms:
        v = [by[(a, b)][m] for b in blocks if (a, b) in by]
        out['per_arm'].setdefault(a, {})[m] = v
        cells.append('%.1f (%s)' % (st.mean(v), ', '.join('%g' % round(x, 1) for x in v)))
    print('| %s | %s |' % (label, ' | '.join(cells)))
print()
for a, b, why in CONTRASTS:
    print('**%s vs %s** (%s)' % (a, b, why))
    for m, label in METRICS[:4]:
        d = [by[(a, k)][m] - by[(b, k)][m] for k in blocks]
        n = len(d); md = st.mean(d); sd = st.stdev(d) if n > 1 else float('nan')
        half = T975[n - 1] * sd / math.sqrt(n)
        ratios = [by[(a, k)][m] / by[(b, k)][m] if by[(b, k)][m] else float('nan') for k in blocks] if m == 'output' else None
        same = sum(1 for x in d if x < 0), sum(1 for x in d if x > 0)
        out['contrasts']['%s-%s:%s' % (a, b, m)] = {'diffs': d, 'mean': md, 'ci95': [md - half, md + half], 'ratios': ratios}
        print('- %s: per block %s; mean %+.1f, 95%% CI [%+.1f, %+.1f]%s; %d of %d blocks lower' % (
            label, ', '.join('%+.1f' % x for x in d), md, md - half, md + half,
            ('; ratios ' + ', '.join('%.2f' % r for r in ratios) + ' (geo-mean %.2f)' % math.exp(st.mean(math.log(r) for r in ratios))) if ratios else '',
            same[0], n))
    print()
# funnel from the bots' own rows (status by origin), re-read from the saved per-run row files
import glob, os
for a in arms:
    c = collections.Counter()
    for f in glob.glob(os.path.join(os.path.dirname(sys.argv[1]), 'c2', 'cl-c2-%s-*-b[0-9].directive-rows.jsonl' % a)):
        for l in open(f):
            if l.startswith('{'):
                p = json.loads(l)['skill']['detail'].split()
                c[(p[3], p[0])] += 1
    out['funnel'][a] = {'%s:%s' % k: v for k, v in sorted(c.items())}
    if c:
        for o in sorted({k[0] for k in c}):
            g = lambda s: c[(o, s)]
            print('funnel %-4s %-10s requested %d, dispatched %d, step_done %d, completed %d, released %d, refused %d, waiting %d, superseded %d, orphan %d' % (
                a, o, g('requested'), g('dispatched'), g('step_done'), g('completed'), g('released'), g('refused'), g('waiting'), g('superseded'), g('orphan_outcome')))
print()
for a in arms:
    e = sum(by[(a, b)]['episodes'] for b in blocks); x = sum(by[(a, b)]['ended_10min'] for b in blocks)
    calls = sum(by[(a, b)]['esc_calls'] for b in blocks)
    out['episodes'][a] = {'episodes': e, 'ended_10min': x, 'esc_calls': calls}
    print('episodes %-4s %d triggered, %d ended within 10 min (%.0f%%), %d escalation calls' % (a, e, x, 100 * x / e if e else 0, calls))
json.dump(out, open(os.path.join(os.path.dirname(sys.argv[1]), 'c2-readout.json'), 'w'), indent=1)
