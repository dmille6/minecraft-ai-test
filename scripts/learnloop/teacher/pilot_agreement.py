#!/usr/bin/env python3
"""How good are the LOCAL teacher's labels? Measured against the paid arms on the 1,000-item pilot (design s.2.4).

    python3 pilot_agreement.py --pilot ~/learnloop/teacher/pilot-1000.jsonl \
        --local labels-qwen3_8_27b-pilot.jsonl [--paid-dir ~/learnloop/teacher-paid] [--json out.json]

Runs on the Mac (the paid answers stay there, quarantined: this READS them to score a local teacher, it never writes
them anywhere a training set could pick them up). Per arm, on the BLIND condition only (informed answers saw the
logged outcome and are not comparable):
  answered / schema-valid  local: the fleet client's schemaValid; paid: JSON parses with the fleet's required keys,
                           a schema skill and the item's sentinel (the vendor's structured output did the grammar)
  hard                     bench/models/score.py check_action fires (same check as the replay and the label filter)
  rep_logged               on NON-transient items: re-chooses the logged failed/refused action (score.key_of)
  keep                     passes the stage-2 label filter (valid, not hard, not the logged action when non-transient)
Agreement, local vs each paid arm, on items both answered validly: same skill, same key (key_of), both kept;
and Cohen's kappa on skill. Paid vs paid where two paid arms exist. Denominators are printed with every share.
"""
import argparse, collections, glob, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (os.path.join(HERE, '..', '..', '..', 'bench', 'models'), os.path.join(HERE, '..', 'train', 'bench')):
    if os.path.exists(os.path.join(p, 'score.py')):
        sys.path.insert(0, p); break
import score as S  # noqa: E402
sys.path.insert(0, os.path.join(HERE, '..'))
import build_dataset as BD  # noqa: E402

REQ = ('reason', 'skill', 'args', 'saw_end')


def load(p):
    return [json.loads(l) for l in open(os.path.expanduser(p)) if l.strip()]


def transient(it):
    fc = it['logged']['failure_class']
    return any(x in fc for x in BD.TRANSIENT)


def pct(n, d):
    return None if not d else round(100.0 * n / d, 1)


def paid_answers(paid_dir, arm, items):
    cid = {'%s-blind-%s' % (arm, hashlib.sha1(i['id'].encode()).hexdigest()[:20]): i['id'] for i in items}
    out = {}
    for f in sorted(glob.glob(os.path.join(os.path.expanduser(paid_dir), arm, '*.jsonl'))):
        for r in load(f):
            if r['custom_id'] in cid:
                out[cid[r['custom_id']]] = r
    return out


def norm_local(rec):
    if rec is None or rec.get('transport_error'):
        return None
    p = rec.get('proposal') or {}
    return {'valid': bool(rec.get('schemaValid')), 'skill': p.get('skill'), 'args': p.get('args') or {}}


def norm_paid(rec, it):
    if rec is None or rec.get('type') != 'succeeded':
        return None
    d = rec.get('parsed')
    skills = set(it['schema']['properties']['skill']['enum'])
    ok = isinstance(d, dict) and all(k in d for k in REQ) and d.get('skill') in skills and d.get('saw_end') == it['sentinel'] \
        and isinstance(d.get('args'), dict)
    return {'valid': ok, 'skill': d.get('skill') if isinstance(d, dict) else None,
            'args': (d.get('args') if isinstance(d, dict) and isinstance(d.get('args'), dict) else {})}


def judge(it, a):
    """-> dict of flags for one answer (None = no answer)."""
    if a is None:
        return None
    hard = bool(S.check_action(a['skill'], a['args'], S.facts(it['user']))[0]) if a['valid'] else False
    nt = not transient(it)
    rep = a['valid'] and nt and S.key_of(a['skill'], a['args']) == S.key_of(it['logged']['skill'], it['logged']['args'])
    return {'valid': a['valid'], 'hard': hard, 'nt': nt, 'rep': rep, 'keep': a['valid'] and not hard and not rep,
            'skill': a['skill'], 'key': S.key_of(a['skill'], a['args']) if a['valid'] else None}


def arm_table(items, ans):
    c = collections.Counter()
    for it in items:
        j = ans.get(it['id'])
        c['n'] += 1
        if j is None:
            continue
        c['answered'] += 1; c['valid'] += j['valid']; c['hard'] += j['hard']; c['nt'] += j['nt']
        c['rep'] += j['rep']; c['keep'] += j['keep']
    sk = collections.Counter(ans[it['id']]['skill'] for it in items if ans.get(it['id']) and ans[it['id']]['valid'])
    nv = sum(sk.values())
    return {'items': c['n'], 'answered': c['answered'], 'schema_valid': pct(c['valid'], c['answered']),
            'surface_share': pct(sk.get('surface', 0), nv), 'skill_top5': {k: pct(v, nv) for k, v in sk.most_common(5)},
            'hard': pct(c['hard'], c['valid']), 'rep_logged_nontransient': pct(c['rep'], c['nt']),
            'keep': pct(c['keep'], c['answered']),
            'denominators': {'answered': c['answered'], 'valid': c['valid'], 'nontransient': c['nt']}}


def kappa(pairs):
    n = len(pairs)
    if not n:
        return None
    po = sum(a == b for a, b in pairs) / n
    ca, cb = collections.Counter(a for a, _ in pairs), collections.Counter(b for _, b in pairs)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    return None if pe == 1 else round((po - pe) / (1 - pe), 3)


def agree(items, A, B):
    both = [it for it in items if A.get(it['id']) and B.get(it['id']) and A[it['id']]['valid'] and B[it['id']]['valid']]
    sk = sum(A[i['id']]['skill'] == B[i['id']]['skill'] for i in both)
    ky = sum(A[i['id']]['key'] == B[i['id']]['key'] for i in both)
    kk = [i for i in both if A[i['id']]['keep'] and B[i['id']]['keep']]
    kk_key = sum(A[i['id']]['key'] == B[i['id']]['key'] for i in kk)
    keep_match = sum(A[i['id']]['keep'] == B[i['id']]['keep'] for i in both)
    by_fc = collections.defaultdict(lambda: [0, 0])
    for i in both:
        f = i['logged']['failure_class'].split(':')[0]
        by_fc[f][0] += 1; by_fc[f][1] += A[i['id']]['skill'] == B[i['id']]['skill']
    return {'both_valid': len(both), 'same_skill': pct(sk, len(both)), 'same_key': pct(ky, len(both)),
            'skill_kappa': kappa([(A[i['id']]['skill'], B[i['id']]['skill']) for i in both]),
            'same_keep_decision': pct(keep_match, len(both)), 'both_kept': len(kk),
            'same_key_when_both_kept': pct(kk_key, len(kk)),
            'same_skill_by_outcome': {k: {'n': v[0], 'same_skill': pct(v[1], v[0])} for k, v in sorted(by_fc.items())}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pilot', default='~/learnloop/teacher/pilot-1000.jsonl')
    ap.add_argument('--local', nargs='+', required=True, help='replay_client outputs of local teachers')
    ap.add_argument('--paid-dir', default='~/learnloop/teacher-paid')
    ap.add_argument('--arms', default='B,C')
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    items = load(a.pilot)
    arms = {}
    for p in a.local:
        recs = load(p)
        name = 'local:%s' % (recs[0]['model'] if recs else os.path.basename(p))
        by = {}
        for r in recs:                           # the last non-error answer per id (the client appends on resume)
            if not r.get('transport_error'):
                by[r['id']] = r
        arms[name] = {i['id']: judge(i, norm_local(by.get(i['id']))) for i in items}
    for arm in a.arms.split(','):
        pa = paid_answers(a.paid_dir, arm, items)
        if pa:
            model = next(iter(pa.values())).get('provenance', arm)
            arms['paid:%s' % model] = {i['id']: judge(i, norm_paid(pa.get(i['id']), i)) for i in items}
    names = list(arms)
    rep = {'items': len(items), 'arms': {n: arm_table(items, arms[n]) for n in names},
           'logged_actions': arm_table(items, {i['id']: judge(i, {'valid': True, 'skill': i['logged']['skill'],
                                                                     'args': i['logged']['args'] or {}})
                                               for i in items if i['logged']['skill']}),
           'agreement': {}}
    for x in range(len(names)):
        for y in range(x + 1, len(names)):
            rep['agreement']['%s vs %s' % (names[x], names[y])] = agree(items, arms[names[x]], arms[names[y]])
    print(json.dumps(rep, indent=1))
    if a.json:
        json.dump(rep, open(os.path.expanduser(a.json), 'w'), indent=1)


if __name__ == '__main__':
    main()
