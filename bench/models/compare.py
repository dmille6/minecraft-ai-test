#!/usr/bin/env python3
"""PAIRED comparison of runs on the items they all share, with cluster-bootstrap CIs (clustered by bot).

    python3 compare.py --ref q25-7b out/*.jsonl [--set brain] [--json cmp.json]

For each run: the binary metrics on the COMMON item ids only (same denominators for everyone), and the
difference against --ref with a 95% cluster-bootstrap interval (resampling bots, 2,000 draws, seeded) and an
exact McNemar p-value on the discordant pairs. A difference whose interval spans 0 is not a difference.
"""
import argparse, collections, json, math, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score as S  # noqa: E402

METRICS = {   # name: (row field, which rows count)
    'bad': ('bad', lambda r: True),
    'invalid': ('invalid', lambda r: True),
    'infeasible': ('hard_any', lambda r: True),
    'rep_fail': ('rep_fail', lambda r: r['stratum'] in S.FAIL_STRATA or r['set'] == 'stuck'),
    'rep_exact': ('rep_exact', lambda r: r['stratum'] in S.FAIL_STRATA or r['set'] == 'stuck'),
    'loop_repeat': ('rep_fail', lambda r: r['stratum'] == 'repeat_loop'),
    'agree_skill': ('agree_skill', lambda r: r['stratum'] == 'success'),
    'ignores_lesson': ('lesson', lambda r: True),
}


def mcnemar_p(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('runs', nargs='+')
    ap.add_argument('--ref', default='q25-7b')
    ap.add_argument('--set', default='brain')
    ap.add_argument('--json')
    ap.add_argument('--min-n', type=int, default=20)
    a = ap.parse_args()
    items = [x for f in sorted(__import__('glob').glob(os.path.join(HERE, 'data', 'mbench-sample*.jsonl'))) for x in S.load_jsonl(f)]
    bot_of = {i['id']: i['bot'] for i in items}
    sysp = json.load(open(os.path.join(HERE, 'data', 'system_prompts.json')))
    rows = {}
    for p in a.runs:
        recs = {}
        for r in S.load_jsonl(p):
            if r.get('set') == a.set:
                recs[r['id']] = r
        if not recs:
            continue
        lab = next(iter(recs.values()))['label']
        rr = S.score_brain(items, recs, sysp)
        d = {}
        for r in rr:
            if r['set'] != a.set:
                continue
            r['invalid'] = not r['valid']
            r['hard_any'] = bool(r.get('hard'))
            d[r['id']] = r
        rows[lab] = d
    if a.ref not in rows:
        sys.exit('ref %s not among runs' % a.ref)
    common = set.intersection(*[set(v) for v in rows.values()])
    print('COMMON items: %d (set %s) across %d runs' % (len(common), a.set, len(rows)))
    if len(common) < a.min_n:
        # fall back to pairwise vs ref
        print('  (few common items: comparing each run with the ref on their own pairwise intersection)')
    rng = random.Random(2026)
    out = {}
    hdr = '%-20s %5s ' + ' '.join(['%22s'] * len(METRICS))
    print(hdr % (('label', 'n') + tuple(METRICS)))
    for lab, d in sorted(rows.items(), key=lambda kv: kv[0] != a.ref):
        ids = sorted(common) if len(common) >= a.min_n else sorted(set(d) & set(rows[a.ref]))
        res = {'n': len(ids)}
        cells = []
        for m, (fld, sel) in METRICS.items():
            sub = [i for i in ids if sel(d[i])]
            if not sub:
                cells.append('-'); continue
            x = [bool(d[i].get(fld)) for i in sub]
            y = [bool(rows[a.ref][i].get(fld)) for i in sub]
            rate = 100.0 * sum(x) / len(x)
            if lab == a.ref:
                res[m] = {'rate': round(rate, 1), 'n': len(sub)}
                cells.append('%5.1f%% (n=%d)' % (rate, len(sub))); continue
            diff = rate - 100.0 * sum(y) / len(y)
            # cluster bootstrap by bot
            byb = collections.defaultdict(list)
            for i, xi, yi in zip(sub, x, y):
                byb[bot_of.get(i, i)].append((xi, yi))
            bots = list(byb)
            ds = []
            for _ in range(2000):
                smp = [byb[rng.choice(bots)] for _ in bots]
                fl = [p for g in smp for p in g]
                ds.append(100.0 * (sum(p[0] for p in fl) - sum(p[1] for p in fl)) / len(fl))
            ds.sort()
            lo, hi = ds[50], ds[1949]
            b = sum(1 for xi, yi in zip(x, y) if xi and not yi); c = sum(1 for xi, yi in zip(x, y) if yi and not xi)
            pv = mcnemar_p(b, c)
            res[m] = {'rate': round(rate, 1), 'n': len(sub), 'diff': round(diff, 1), 'ci': [round(lo, 1), round(hi, 1)], 'p': round(pv, 4)}
            star = '*' if (lo > 0 or hi < 0) else ' '
            cells.append('%5.1f %+5.1f[%+.0f,%+.0f]%s' % (rate, diff, lo, hi, star))
        out[lab] = res
        print(hdr % ((lab[:20], len(ids)) + tuple(cells)))
    print('* = 95%% cluster-bootstrap interval excludes 0 (vs %s)' % a.ref)
    if a.json:
        json.dump(out, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
