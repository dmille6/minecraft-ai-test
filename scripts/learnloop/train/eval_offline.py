#!/usr/bin/env python3
"""learning loop M3 offline evaluation, step 2: score replays against the design's ladder rung (a) (s.4a).

    python3 eval_offline.py --items m3-eval.jsonl --runs out/qwen25.jsonl out/qwen3-8b.jsonl out/cand.jsonl \
        [--json scores.json]

Every metric is computed for each replayed model AND for the FLEET'S OWN logged action on the same items (the
positive control: the checks must fire on the logged actions of the failure items far more than on the good items,
or the instrument is blind). Denominators are printed with every share.

  schema_valid   the real client's schemaValid (grammar + JSON + saw_end sentinel; after its one repair retry)
  retry          share of decisions that needed the client's repair retry
  hard           a hard check fires on the proposed action (bench/models/score.py check_action: craft not craftable,
                 smelt not smeltable, mine above the ceiling, goto > 40 up, a LESSONS-says-failed repeat)
  bad            not schema-valid OR hard -- the headline floor
  rep_fail       on non-transient FAILURE items: the proposal repeats the logged failed action (score.py key_of)
  post_veto      on the decision right after a repeat_loop veto: the proposal repeats the vetoed action
                 (positive control: the fleet's own logged rate on these items; the sandbox measured 29-59%)
  agree          on GOOD items: same skill / same skill + key argument as the action that worked (reported only)
GATES vs the fleet model (s.4a, a candidate must pass all three): schema_valid >= fleet - 0.5 pp; hard <= fleet;
rep_fail <= fleet. Here "fleet" is the replayed base qwen2.5:7b (same client, same items), with the logged action shown
beside it as the instrument check.
"""
import argparse, collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, '..', '..', '..', 'bench', 'models'), os.path.join(HERE, 'bench')):
    if os.path.exists(os.path.join(p, 'score.py')):
        sys.path.insert(0, p)
import score as S  # noqa: E402  (bench/models/score.py: facts, check_action, key_of)


def load(p):
    return [json.loads(l) for l in open(p) if l.strip()]


def pct(n, d):
    return None if not d else round(100.0 * n / d, 1)


def score_one(items, recs=None):
    """recs None = the fleet's logged actions. -> {metric: (n, d)}"""
    by = {r['id']: r for r in (recs or [])}
    c = collections.Counter()
    for it in items:
        f = S.facts(it['user'])
        if recs is None:
            sk, args, valid, retry = it['logged']['skill'], it['logged']['args'], bool(it['logged']['skill']), False
        else:
            r = by.get(it['id'])
            if r is None or r.get('transport_error'):
                c['missing'] += 1; continue
            p = r.get('proposal') or {}
            sk, args, valid, retry = p.get('skill'), p.get('args') or {}, bool(r.get('schemaValid')), (r.get('retryCount') or 0) > 0
        c['n'] += 1; c['valid'] += valid; c['retry'] += retry
        hard = S.check_action(sk, args, f)[0] if valid else []
        c['hard'] += bool(hard); c['bad'] += (not valid) or bool(hard)
        k = it['eval_kind']; c['n_' + k] += 1
        if k == 'fail':
            c['rep_fail'] += valid and S.key_of(sk, args) == S.key_of(it['logged']['skill'], it['logged']['args'])
            c['hard_fail_items'] += bool(hard)
        elif k == 'post_veto':
            v = it['vetoed']
            c['post_veto_repeat'] += valid and S.key_of(sk, args) == S.key_of(v[0], v[1])
        elif k == 'good':
            c['agree_skill'] += valid and sk == it['logged']['skill']
            c['agree_key'] += valid and S.key_of(sk, args) == S.key_of(it['logged']['skill'], it['logged']['args'])
            c['hard_good_items'] += bool(hard)
    return c


def table(c):
    n = c['n']
    return {'n': n, 'missing': c['missing'], 'schema_valid': pct(c['valid'], n), 'retry': pct(c['retry'], n),
            'hard': pct(c['hard'], n), 'bad': pct(c['bad'], n),
            'rep_fail': pct(c['rep_fail'], c['n_fail']), 'post_veto_repeat': pct(c['post_veto_repeat'], c['n_post_veto']),
            'agree_skill': pct(c['agree_skill'], c['n_good']), 'agree_key': pct(c['agree_key'], c['n_good']),
            'hard_on_fail_items': pct(c['hard_fail_items'], c['n_fail']), 'hard_on_good_items': pct(c['hard_good_items'], c['n_good']),
            'denominators': {'all': n, 'fail': c['n_fail'], 'post_veto': c['n_post_veto'], 'good': c['n_good']}}


def gates(cand, ref, instrument_ok=True):
    """COVERAGE FIRST (Codex r1 P1): a run that did not answer every item gets no verdict -- missing items and
    transport errors would otherwise shrink the denominator in the candidate's favour. The instrument check must pass."""
    g = {'complete coverage (candidate and reference answered every item)': cand['missing'] == 0 and ref['missing'] == 0
         and cand['n'] == ref['n'] and cand['n'] > 0,
         'instrument check passed': bool(instrument_ok),
         'schema_valid >= ref - 0.5 pp': cand['schema_valid'] is not None and ref['schema_valid'] is not None
         and cand['schema_valid'] >= ref['schema_valid'] - 0.5,
         'hard <= ref': cand['hard'] is not None and ref['hard'] is not None and cand['hard'] <= ref['hard'],
         'rep_fail <= ref': cand['rep_fail'] is not None and ref['rep_fail'] is not None and cand['rep_fail'] <= ref['rep_fail']}
    return {'gates': g, 'pass': all(g.values())}


def export_check(q4_recs, ref_recs, item_ids=None):
    """s.3.2: the Q4_K_M GGUF must choose the same skill as the 16-bit model >= 97% of the time (items both answered
    schema-valid), and its schema-valid share must not fall. COVERAGE FIRST (Codex r2 P2): both runs must answer every
    expected item, or there is no verdict."""
    q = {r['id']: r for r in q4_recs if not r.get('transport_error')}
    f = {r['id']: r for r in ref_recs if not r.get('transport_error')}
    ids = set(item_ids) if item_ids is not None else set(q) | set(f)
    covered = bool(ids) and ids <= set(q) and ids <= set(f)
    q = {i: r for i, r in q.items() if i in ids}; f = {i: r for i, r in f.items() if i in ids}
    both = [i for i in q if i in f and q[i].get('schemaValid') and f[i].get('schemaValid')]
    same = sum(1 for i in both if (q[i].get('proposal') or {}).get('skill') == (f[i].get('proposal') or {}).get('skill'))
    vq = sum(1 for r in q.values() if r.get('schemaValid')); vf = sum(1 for r in f.values() if r.get('schemaValid'))
    res = {'expected_items': len(ids), 'answered_q4': len(q), 'answered_16bit': len(f), 'complete_coverage': covered,
           'items_both_valid': len(both), 'same_skill': same, 'same_skill_pct': pct(same, len(both)),
           'schema_valid_q4': pct(vq, len(q)), 'schema_valid_16bit': pct(vf, len(f))}
    res['pass'] = covered and bool(both) and same >= 0.97 * len(both) and (res['schema_valid_q4'] or 0) >= (res['schema_valid_16bit'] or 0)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--runs', nargs='+', required=True)
    ap.add_argument('--ref', default=None, help='the run that plays "fleet" for the gates (default: the first run)')
    ap.add_argument('--json', default=None)
    ap.add_argument('--export-check', nargs=2, metavar=('Q4_RUN', 'BF16_RUN'), default=None)
    a = ap.parse_args()
    items = load(a.items)
    rep = {'items': len(items), 'kinds': dict(collections.Counter(i['eval_kind'] for i in items)),
           'logged (fleet, instrument check)': table(score_one(items))}
    runs = {}
    for p in a.runs:
        recs = load(p)
        name = (recs[0].get('model') if recs else os.path.basename(p))
        runs[name] = table(score_one(items, recs))
    rep['runs'] = runs
    # the fleet model is the reference whenever it was replayed (Codex r4: a glob can put a candidate first)
    ref = a.ref or ('qwen2.5:7b-instruct' if 'qwen2.5:7b-instruct' in runs else next(iter(runs), None))
    if ref is not None and ref not in runs:
        raise SystemExit('REFUSED: --ref %s is not among the runs %s' % (ref, sorted(runs)))
    lg = rep['logged (fleet, instrument check)']
    ic = (lg['hard_on_fail_items'] or 0) > (lg['hard_on_good_items'] or 0)
    rep['instrument_check'] = {'hard fires more on failure items than on good items (logged)': ic,
                               'logged post-veto repeat rate': lg['post_veto_repeat'], 'ok': ic}
    rep['gates_vs'] = ref
    rep['gates'] = {m: gates(t, runs[ref], ic) for m, t in runs.items() if m != ref} if ref else {}
    if a.export_check:
        rep['export_check'] = export_check(load(a.export_check[0]), load(a.export_check[1]), [i['id'] for i in items])
    print(json.dumps(rep, indent=1))
    if a.json:
        json.dump(rep, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
