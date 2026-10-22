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


def gates(cand, ref):
    g = {'schema_valid >= ref - 0.5 pp': cand['schema_valid'] is not None and ref['schema_valid'] is not None
         and cand['schema_valid'] >= ref['schema_valid'] - 0.5,
         'hard <= ref': cand['hard'] is not None and ref['hard'] is not None and cand['hard'] <= ref['hard'],
         'rep_fail <= ref': cand['rep_fail'] is not None and ref['rep_fail'] is not None and cand['rep_fail'] <= ref['rep_fail']}
    return {'gates': g, 'pass': all(g.values())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--runs', nargs='+', required=True)
    ap.add_argument('--ref', default=None, help='the run that plays "fleet" for the gates (default: the first run)')
    ap.add_argument('--json', default=None)
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
    ref = a.ref or (next(iter(runs)) if runs else None)
    rep['gates_vs'] = ref
    rep['gates'] = {m: gates(t, runs[ref]) for m, t in runs.items() if m != ref} if ref else {}
    lg = rep['logged (fleet, instrument check)']
    rep['instrument_check'] = {'hard fires more on failure items than on good items (logged)':
                               (lg['hard_on_fail_items'] or 0) > (lg['hard_on_good_items'] or 0),
                               'logged post-veto repeat rate': lg['post_veto_repeat']}
    print(json.dumps(rep, indent=1))
    if a.json:
        json.dump(rep, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
