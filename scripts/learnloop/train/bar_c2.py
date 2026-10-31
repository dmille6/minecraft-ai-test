#!/usr/bin/env python3
"""Candidate 2 against the OWNER'S BAR (10-30): beat qwen3.5:9b on rep_fail AND post_veto, no worse hard, schema-valid
>= 99%, latency within the gates (latency is read separately: the load test), on the same 600-item replay.

    python3 bar_c2.py --items m3-eval.jsonl --dir replay-c2-01 --cand cand-qwen35-9b-c2-q8 \
        --vs qwen3.5:9b qwen3.5:9b-q8_0 [--bf16 cand-qwen35-9b-c2-bf16] [--rep <cand q8 rerun>] [--peft-probe peft_probe.jsonl]

Uses eval_offline.py's own metrics (score_one/table) -- no second scorer. Adds, per comparison, the PAIRED picture on
the items both answered: on fail items, how many the candidate repeats and the base does not (and the reverse), the
same on post-veto items, and an exact two-sided sign test on those discordant pairs (descriptive: the bar is the
point estimates, as the owner wrote it). Export check (owner A1): candidate q8_0 vs its bf16, same skill >= 97% of
items both valid, with the q8_0 rerun as the determinism ceiling. PEFT probe: the trained model's own greedy answers
(before merge/convert) vs the bf16 GGUF's, same skill -- a bad merge or conversion shows here.
"""
import argparse, glob, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import eval_offline as E  # noqa: E402
S = E.S


def runfile(d, model, suffix=''):
    return os.path.join(d, model.replace(':', '_').replace('/', '_') + '-t0%s.jsonl' % suffix)


def last_by_id(p):
    out = {}
    for r in E.load(p):
        out[r['id']] = r
    return out


def sign_test(a, b):
    n = a + b
    if n == 0:
        return None
    k = min(a, b)
    p = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return round(min(1.0, 2 * p), 4)


def paired(items, cand, base):
    out = {}
    for kind, target in (('fail', lambda it: (it['logged']['skill'], it['logged']['args'])), ('post_veto', lambda it: tuple(it['vetoed']))):
        cb = bc = both = n = 0
        for it in items:
            if it['eval_kind'] != kind:
                continue
            x, y = cand.get(it['id']), base.get(it['id'])
            if not x or not y or x.get('transport_error') or y.get('transport_error'):
                continue
            n += 1
            t = S.key_of(*target(it))
            rx = bool(x.get('schemaValid')) and S.key_of((x.get('proposal') or {}).get('skill'), (x.get('proposal') or {}).get('args') or {}) == t
            ry = bool(y.get('schemaValid')) and S.key_of((y.get('proposal') or {}).get('skill'), (y.get('proposal') or {}).get('args') or {}) == t
            cb += rx and not ry; bc += ry and not rx; both += rx and ry
        out[kind] = {'items': n, 'cand_repeats_base_not': cb, 'base_repeats_cand_not': bc, 'both_repeat': both,
                     'sign_test_p': sign_test(cb, bc)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True); ap.add_argument('--dir', required=True)
    ap.add_argument('--cand', required=True); ap.add_argument('--vs', nargs='+', required=True)
    ap.add_argument('--bf16', default=None); ap.add_argument('--rep', default=None); ap.add_argument('--peft-probe', default=None)
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    items = E.load(a.items)
    def score(m):
        p = runfile(a.dir, m)
        return E.table(E.score_one(items, E.load(p))), last_by_id(p)
    ct, cr = score(a.cand)
    lg = E.table(E.score_one(items))
    ic = (lg['hard_on_fail_items'] or 0) > (lg['hard_on_good_items'] or 0)     # eval_offline's instrument check (Codex r3)
    rep = {'candidate': a.cand, 'candidate_scores': ct, 'instrument_check_ok': ic, 'bar': {}}
    for b in a.vs:
        bt, br = score(b)
        g = {'instrument check passed': ic,
             'complete coverage': ct['missing'] == 0 and bt['missing'] == 0 and ct['n'] == bt['n'] == len(items),
             'rep_fail < base': ct['rep_fail'] < bt['rep_fail'],
             'post_veto < base': ct['post_veto_repeat'] < bt['post_veto_repeat'],
             'hard <= base': ct['hard'] <= bt['hard'],
             'schema_valid >= 99': ct['schema_valid'] >= 99.0}
        rep['bar'][b] = {'base_scores': {k: bt[k] for k in ('schema_valid', 'hard', 'rep_fail', 'post_veto_repeat', 'agree_skill', 'agree_key')},
                         'gates': g, 'pass_offline': all(g.values()), 'paired': paired(items, cr, br)}
    # DEGENERATE-POLICY CHECK (not part of the owner's bar; reported beside it): the skill mix per item kind. A
    # candidate that "beats" rep_fail/post_veto by always answering one action (the teacher over-chose `surface`)
    # shows here as a collapsed mix and a falling good-item agreement.
    import collections
    def mix(recs):
        out = {}
        for kind in ('good', 'fail', 'post_veto'):
            c = collections.Counter((recs.get(i['id'], {}).get('proposal') or {}).get('skill') for i in items if i['eval_kind'] == kind)
            n = sum(c.values()) or 1
            out[kind] = {k: round(100.0 * v / n, 1) for k, v in c.most_common(6)}
        return out
    rep['skill_mix'] = {a.cand: mix(cr)}
    for b in a.vs:
        rep['skill_mix'][b] = mix(last_by_id(runfile(a.dir, b)))
    if a.bf16:
        ids = [i['id'] for i in items]
        q, f = E.load(runfile(a.dir, a.cand)), E.load(runfile(a.dir, a.bf16))
        rep['export_check'] = E.export_check(q, f, ids)
        if a.rep:
            rep['export_check']['determinism_ceiling'] = E.export_check(q, E.load(a.rep), ids)
    if a.peft_probe and a.bf16:
        pp = E.load(a.peft_probe); f = last_by_id(runfile(a.dir, a.bf16))
        same = n = 0
        for r in pp:
            try:
                sk = json.loads(r['text']).get('skill')
            except Exception:
                sk = None
            g = f.get(r['id'])
            if g and g.get('schemaValid'):
                n += 1; same += sk == (g.get('proposal') or {}).get('skill')
        rep['peft_vs_bf16_gguf'] = {'items': n, 'same_skill': same, 'pct': E.pct(same, n)}
    print(json.dumps(rep, indent=1))
    if a.json:
        json.dump(rep, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
