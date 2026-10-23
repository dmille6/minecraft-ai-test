"""Last numbers for the report. No ES access.
(1) Depletion estimate for logs: success of LLM 'gather <log>' decisions split by whether a log
    was visible within 16 m (LLM sample), BASE vs END; depletion share = change in visibility x
    the visible/not-visible success gap, at BASE gaps (an oaxaca-style split).
(2) World-age permutation test: per-world % change (END vs BASE) in gather ok and mine ok per bot-h,
    young (reseeded 09-19 and 09-27, 6 worlds) vs original (10 worlds); board-d (trap) shown with
    and without. 20,000 relabelings.
(3) Reflex/safety bot-time excluding board-d. (4) town_deposit outcome classes, BASE vs END.
"""
import os, sys, gzip, json, glob, random
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402
from sample_state import feats, LOGS  # noqa: E402

BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']
A = json.load(open(os.path.join(HERE, 'out', 'analyze.json')))

print('(1) LLM "gather <log>" decisions in the sample: success by log-within-16 m')
cell = {}
for lab, days in (('BASE', BASE), ('END', END)):
    c = defaultdict(lambda: [0, 0])
    for d in days:
        with gzip.open(os.path.join(HERE, 'out', 'llm_sample', f'{d}.jsonl.gz'), 'rt') as f:
            for l in f:
                r = json.loads(l)
                if world(r['p']) not in HOMES or r['sk'] != 'gather' or (r['blk'] or '') not in LOGS:
                    continue
                F, _ = feats(r)
                k = 'vis' if F['log16'] else 'not'
                c[k][0] += 1
                c[k][1] += r['st'] == 'success'
    cell[lab] = c
    n = c['vis'][0] + c['not'][0]
    print(f'  {lab}: n {n}; log visible <=16 m in {100 * c["vis"][0] / n:.1f}%; success visible '
          f'{100 * c["vis"][1] / max(1, c["vis"][0]):.1f}% (n {c["vis"][0]}), not visible {100 * c["not"][1] / max(1, c["not"][0]):.1f}% (n {c["not"][0]})')
b, e = cell['BASE'], cell['END']
pb = b['vis'][0] / (b['vis'][0] + b['not'][0])
pe = e['vis'][0] / (e['vis'][0] + e['not'][0])
sv, sn = b['vis'][1] / b['vis'][0], b['not'][1] / max(1, b['not'][0])
sve, sne = e['vis'][1] / max(1, e['vis'][0]), e['not'][1] / max(1, e['not'][0])
tot_b = pb * sv + (1 - pb) * sn
tot_e = pe * sve + (1 - pe) * sne
vis_part = (pe - pb) * (sv - sn)
print(f'  success per log decision {100 * tot_b:.1f}% -> {100 * tot_e:.1f}% ({100 * (tot_e - tot_b):+.1f} pp): visibility '
      f'(depletion where the bots stand) {100 * vis_part:+.1f} pp, success given visibility {100 * (tot_e - tot_b - vis_part):+.1f} pp')

print('\n(2) world-age permutation test (per-world % change END vs BASE)')
YOUNG = ['placebo-a', 'placebo-b', 'board-b', 'hive-c', 'hive-d', 'placebo-d']
for metric in ('gather_ok', 'mine_ok'):
    pct = {}
    for w in A[BASE[0]]:
        bb = sum(A[d][w][metric] for d in BASE) / 3
        ee = sum(A[d][w][metric] for d in END) / 3
        pct[w] = 100 * (ee - bb) / bb
    for excl in ([], ['board-d']):
        ws = [w for w in pct if w not in excl]
        y = [pct[w] for w in ws if w in YOUNG]
        o = [pct[w] for w in ws if w not in YOUNG]
        obs = sum(y) / len(y) - sum(o) / len(o)
        random.seed(1)
        vals = [pct[w] for w in ws]
        cnt = 0
        for _ in range(20000):
            random.shuffle(vals)
            yy, oo = vals[:len(y)], vals[len(y):]
            if abs(sum(yy) / len(yy) - sum(oo) / len(oo)) >= abs(obs):
                cnt += 1
        print(f'  {metric:9s} excl {excl or "-"}: young mean {sum(y) / len(y):+.1f}% (n {len(y)}), original {sum(o) / len(o):+.1f}% '
              f'(n {len(o)}); difference {obs:+.1f} pp, two-sided permutation p = {cnt / 20000:.3f}')
    print('    per world: ' + ', '.join(f'{w} {pct[w]:+.0f}%' for w in sorted(pct, key=pct.get)))

print('\n(3) safety/reflex hours per day, all worlds vs excluding board-d, in two kinds:')
print('    EXCLUSIVE = skill time (skills never overlap each other) of goto/home/surface/explore launched by a reflex or')
print('                watchdog trigger, or chosen right after a reflex interrupt (trigger interrupt:*)')
print('    EXPOSURE  = water-hold seconds (the float/surface/no-air reflexes run WHILE a skill runs: not exclusive)')
for excl in ([], ['board-d']):
    def tot(days):
        ex = wat = 0.0
        for d in days:
            for w, x in A[d].items():
                if w in excl:
                    continue
                wat += x['float_s'] / 3600 + x['surface_float_s'] / 3600 + x['noair_s'] / 3600
                for dct in (x['goto_h_trig'], x['home_h_trig'], x['surface_h_trig'], x['explore_h_trig']):
                    ex += sum(h for k, h in dct.items() if k != 'llm' and k != '?')
        return ex / len(days), wat / len(days)
    nb = 1920 - 120 * len(excl)
    (eb, wb), (ee, we) = tot(BASE), tot(END)
    print(f'  excl {excl or "-"} ({nb} bot-h/day): EXCLUSIVE {eb:.1f} -> {ee:.1f} h/day ({100 * eb / nb:.1f}% -> '
          f'{100 * ee / nb:.1f}%);  EXPOSURE {wb:.1f} -> {we:.1f} h/day')

print('\n(4) town_deposit outcome classes per day (BASE mean -> END mean)')
cls = defaultdict(lambda: [0.0, 0.0])
for i, days in enumerate((BASE, END)):
    for d in days:
        for w, x in A[d].items():
            for k, n in x['td_cls'].items():
                cls[k][i] += n / 3
for k, (bb, ee) in sorted(cls.items(), key=lambda kv: -kv[1][0]):
    print(f'  {k:18s} {bb:6.0f} -> {ee:6.0f}')

print('\n(5) LOG gathers ending no_safe_target: absolute per day, and the share from the top 5 bots (Claude r1 P2-3)')
LOGB = ('oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log')
for lab, days in (('BASE', BASE), ('END', END)):
    per = defaultdict(int)
    tot = 0
    for d in days:
        with gzip.open(os.path.join(HERE, 'out', 'rows', f'{d}.jsonl.gz'), 'rt') as f:
            for l in f:
                r = json.loads(l)
                if r['k'] == 'gather' and r['fc'] == 'no_safe_target' and r['a'].get('block') in LOGB:
                    per[r['b']] += 1
                    tot += 1
    top = sorted(per.items(), key=lambda x: -x[1])[:5]
    print(f'  {lab}: {tot / 3:.0f}/day from {len(per)} bots; top 5 = {100 * sum(v for _, v in top) / tot:.0f}%: '
          + ', '.join(f'{b} {v / 3:.0f}/day' for b, v in top))
