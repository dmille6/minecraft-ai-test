#!/usr/bin/env python3
"""Slow roles (overseer / stuck / allocation / planning) on the fixed 54-item slow subset (data/slow_ids.txt), so
thinking ON and OFF of the same model, and different models, are compared on IDENTICAL items.

    python3 slow_compare.py out/*.jsonl
"""
import contextlib, glob, io, json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score as S, stage_b_allocation as B2, stage_b_planning as B3, stage_b_stuck as B1  # noqa: E402


def main():
    ids = {l.strip() for l in open(os.path.join(HERE, 'data', 'slow_ids.txt')) if l.strip()}
    items = S.load_jsonl(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))
    b2 = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(HERE, 'data', 'stage-b2.jsonl'))}
    b3 = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(HERE, 'data', 'stage-b3.jsonl'))}
    A, Bl = B1.load_labels('claude'), B1.load_labels('codex')
    rows = []
    for p in sorted(sys.argv[1:]):
        recs = {}
        for r in S.load_jsonl(p):
            if r['id'] in ids:
                recs[r['id']] = r
        if not recs:
            continue
        lab = next(iter(recs.values()))['label']
        need = [i for i in ids]
        have = sum(1 for i in need if i in recs and not recs[i].get('error'))
        osum, _ = S.score_overseer(items, recs)
        st = [i for i in ids if i.startswith('s-')]
        good = bad = 0
        for i in st:
            r = recs.get(i)
            a = S.parse_answer(r.get('content')) if r and not r.get('error') else None
            va, vb = B1.verdict(a, A.get(i)), B1.verdict(a, Bl.get(i))
            good += va == 'good' or vb == 'good'
            bad += (va == 'bad' or vb == 'bad') or not isinstance(a, dict)
        ex = viol = 0
        for i in [i for i in ids if i.startswith('b2-')]:
            r = recs.get(i)
            a = S.parse_answer(r.get('content')) if r and not r.get('error') else None
            tot, v = B2.evaluate(b2[i], a if isinstance(a, dict) else {})
            ex += abs(tot - b2[i]['optimum']) < 1e-6 and not v and a is not None
            viol += bool(v) or a is None
        reach = 0
        for i in [i for i in ids if i.startswith('b3-')]:
            r = recs.get(i)
            a = S.parse_answer(r.get('content')) if r and not r.get('error') else None
            reach += B3.simulate(b3[i], a.get('plan') if isinstance(a, dict) else None)['reached']
        walls = [r['wall_s'] for r in recs.values() if not r.get('error')]
        think = [r.get('thinking_chars') or 0 for r in recs.values() if not r.get('error')]
        rows.append((lab, have, (osum or {}).get('valid'), good, bad, ex, viol, reach,
                     round(statistics.median(walls), 1) if walls else None, int(statistics.median(think)) if think else 0,
                     (next(iter(recs.values())).get('think'))))
    print('| config | answered (54) | overseer valid % (12) | stuck GOOD (12) | stuck BAD (12) | allocation exact (15) | allocation violations (15) | plan reached (15) | median s per answer (c=4) | median reasoning chars | think |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for r in sorted(rows, key=lambda r: -(r[5] + r[7] + r[3])):
        print('| %s |' % ' | '.join('-' if x is None else str(x) for x in r))


if __name__ == '__main__':
    main()
