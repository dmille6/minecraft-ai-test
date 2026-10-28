#!/usr/bin/env python3
"""Decision-model comparison on the learning loop's replay set (m3-eval, 600 items).

    python3 systemone_report.py --items m3-eval.jsonl --eval-offline <dir holding eval_offline.py> \
        --runs qwen25.jsonl qwen35.jsonl d1.jsonl [--json out.json]

Headline metrics are eval_offline.py's own (score_one/table: hard, rep_fail, post_veto_repeat, with denominators),
so the numbers line up with the Qwen reference table. Added here:
  rep_fail_mk / post_veto_mk  the same repeat rates on items whose logged (or vetoed) action is NOT keyed on a
                 coordinate. For goto x,y,z and mine y a System One run's coordinates come from code
                 (systemone_map.py), so a repeat there is code's, not the model's.
  p50 / p95      per-decision latency (latencyMs; System One = both question rounds).
  confidence     System One runs only: mean skill confidence per item kind, and AUROC of LOW confidence for
                 (a) a failure/post-veto item vs a good item, (b) a repeat vs not, among failure+post-veto items.
                 0.5 = no signal. A run with transport errors is reported with its coverage and gets no table row.
"""
import argparse, json, os, sys

import systemone_map as SM


def load(p):
    return [json.loads(l) for l in open(p) if l.strip()]


def pctl(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def auroc(pos, neg):
    """P(score of a positive > score of a negative), ties 1/2. None without both classes."""
    if not pos or not neg:
        return None
    gt = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return gt / (len(pos) * len(neg))


def repeat_of(S, it, rec):
    p = rec.get('proposal') or {}
    if not rec.get('schemaValid'):
        return False
    if it['eval_kind'] == 'fail':
        ref = (it['logged']['skill'], it['logged']['args'])
    elif it['eval_kind'] == 'post_veto':
        ref = tuple(it['vetoed'])
    else:
        return None
    return S.key_of(p.get('skill'), p.get('args') or {}) == S.key_of(ref[0], ref[1])


def extra(S, items, recs):
    by = {r['id']: r for r in recs if not r.get('transport_error')}
    out = {'answered': len(by), 'transport_errors': sum(1 for r in recs if r.get('transport_error'))}
    lat = [r['latencyMs'] / 1000.0 for r in by.values() if r.get('latencyMs') is not None]
    out['p50_s'], out['p95_s'] = pctl(lat, 0.5), pctl(lat, 0.95)
    for kind, name in (('fail', 'rep_fail_mk'), ('post_veto', 'post_veto_mk')):
        n = d = 0
        for it in items:
            if it['eval_kind'] != kind or it['id'] not in by:
                continue
            ref = (it['logged']['skill'], it['logged']['args']) if kind == 'fail' else tuple(it['vetoed'])
            if SM.coordinate_key(ref[0], ref[1]):
                continue
            d += 1
            n += bool(repeat_of(S, it, by[it['id']]))
        out[name] = (round(100.0 * n / d, 1) if d else None, d)
    conf = [(it, by[it['id']]['confidence']) for it in items if it['id'] in by and by[it['id']].get('confidence') is not None]
    if conf:
        mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
        out['conf_mean'] = {k: mean([c for it, c in conf if it['eval_kind'] == k]) for k in ('good', 'fail', 'post_veto')}
        bad = [1 - c for it, c in conf if it['eval_kind'] != 'good']
        good = [1 - c for it, c in conf if it['eval_kind'] == 'good']
        out['auroc_lowconf_failitem'] = auroc(bad, good)
        rp, rn = [], []
        for it, c in conf:
            if it['eval_kind'] == 'good':
                continue
            (rp if repeat_of(S, it, by[it['id']]) else rn).append(1 - c)
        out['auroc_lowconf_repeat'] = auroc(rp, rn)
        out['n_repeat'], out['n_norepeat'] = len(rp), len(rn)
        miss = [r.get('missing_options') or 0 for r in by.values()]
        out['items_with_option_outside_top20'] = sum(1 for m in miss if m)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--eval-offline', required=True, help='directory holding eval_offline.py (learnloop/train)')
    ap.add_argument('--runs', nargs='+', required=True)
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    sys.path.insert(0, a.eval_offline)
    import eval_offline as E
    S = E.S
    items = load(a.items)
    rep = {'items': len(items), 'kinds': {k: sum(1 for i in items if i['eval_kind'] == k) for k in ('good', 'fail', 'post_veto')},
           'logged': E.table(E.score_one(items)), 'runs': {}}
    rep['logged'].update(extra(S, items, [{'id': i['id'], 'schemaValid': True, 'proposal': i['logged']} for i in items]))
    for p in a.runs:
        recs = load(p)
        name = recs[0].get('model') if recs else os.path.basename(p)
        t = E.table(E.score_one(items, recs))
        t.update(extra(S, items, recs))
        t['file'] = p
        rep['runs'][name] = t
    print(json.dumps(rep, indent=1))
    hdr = '%-34s %5s %6s %6s %9s %10s %12s %6s %6s'
    print(hdr % ('model', 'n', 'hard', 'rep_f', 'post_veto', 'rep_f(mk)', 'post_veto(mk)', 'p50', 'p95'), file=sys.stderr)
    for name, t in [('logged (fleet)', rep['logged'])] + list(rep['runs'].items()):
        f = lambda v: '-' if v is None else ('%.1f' % v)
        print(hdr % (name[:34], t['n'], f(t['hard']), f(t['rep_fail']), f(t['post_veto_repeat']),
                     '%s/%d' % (f(t['rep_fail_mk'][0]), t['rep_fail_mk'][1]), '%s/%d' % (f(t['post_veto_mk'][0]), t['post_veto_mk'][1]),
                     f(t.get('p50_s')), f(t.get('p95_s'))), file=sys.stderr)
    if a.json:
        json.dump(rep, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
