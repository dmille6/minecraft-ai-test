#!/usr/bin/env python3
"""learning loop, candidate 2: the CLEANED training set (design s.2.1 + s.2.2; owner 10-30 "queue both").

Candidate 1 (boot-01: 40k fleet "good" decisions, Qwen3-8B) imitated the fleet's mistakes on the 600-item replay
(rep_fail 50.0 vs its untuned base 28.3). Its set had two holes this builder closes:
  (1) it taught only what the fleet already does -- almost no example of a DIFFERENT action after a failure or a veto;
  (2) "good" was decision success (L1), not output, and it kept decisions that repeated a just-failed/vetoed action.

    nice -n 19 python3 -B build_clean.py pool --v0 ~/learnloop/datasets/v0 --days-dir ~/learnloop/days --out DIR
    nice -n 19 python3 -B build_clean.py assemble --out DIR --labels DIR/labels-<teacher>.jsonl [--labels ...]

POOL (one pass over v0's TRAIN cell: v0's training worlds x its older days; held-out worlds and the 2 newest days
never enter, so the 600-item m3-eval set stays held out; the 1,000 pilot ids are excluded too -- they measure label
quality and must not be trained on):
  relabel-pool.jsonl   decisions for the LOCAL teacher to answer blind (the prompt the fleet model saw):
                       kind 'fail'      bad, NON-transient (build_dataset.is_transient), stratified by failure class x
                                        skill with a floor (build_dataset.stratified), --f-n of them
                       kind 'post_veto' the bot's next decision after a repeat_loop veto (its vetoed action recorded),
                                        --pv-n of them
  good.jsonl           stage-1 examples GOOD BY OUTPUT (never by decision success alone), --g-n of them:
                       v0 train-good (L1 good, deduped, filters of build_dataset) AND
                       G2 not a repeat of the bot's previous action when that one was bad or vetoed, AND
                       G3 output evidence: >= 1 item gathered in the 600 s window, or a milestone in 120 s, AND
                       G4 at or above the median 600-s gathered items of its skill's G2+G3 set (top half by output)
                       then sqrt-by-skill allocation (as the bootstrap set) and a seeded sample.
ASSEMBLE: teacher labels -> kept relabels by the design's filter (s.2.2): schema-valid through the fleet's own client;
  bench/models/score.py hard check passes; NOT the logged failed action (score.key_of); after a veto NOT the vetoed
  action; paid-vendor labels refused (build_dataset.paid_refusal: quarantine until an owner decision). Every target is
  re-serialised canonically ({"reason","skill","args","saw_end"}, compact, reason <= 60 chars) so fleet and teacher
  examples share one format. Writes <name> (shuffled, seeded) + <name>.MANIFEST.json (counts, every exclusion, sha256).
"""
import argparse, collections, datetime as dt, gzip, json, os, random, secrets, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_dataset as BD  # noqa: E402

for p in (os.path.join(HERE, '..', '..', 'bench', 'models'), os.path.join(HERE, 'train', 'bench')):
    if os.path.exists(os.path.join(p, 'score.py')):
        sys.path.insert(0, p)
        break
import score as S  # noqa: E402


def usable(t, sps):
    return bool(t['prompt_complete'] and t['nonce_ok'] and t['model'] == BD.FLEET_MODEL
                and '%s:%s' % (t['code_version'], t['system_hash']) in sps)


def output_ok(t):
    """G3: output evidence, not decision success."""
    w6, w2 = t['window'].get('600') or {}, t['window'].get('120') or {}
    return (w6.get('items') or 0) >= 1 or (w2.get('milestones') or 0) > 0


def repeats_bad_prev(t, pv):
    """G2: the same action the bot's previous decision took, when that one was refused or failed."""
    if pv is None:
        return False
    return BD.action_key(t) == BD.action_key(pv) and (pv['label'] == 'bad' or bool(pv['gate']['refused']))


def top_half(cands):
    """G4: per skill, keep candidates at or above the median 600-s items of that skill."""
    by = collections.defaultdict(list)
    for c in cands:
        by[c['skill']].append(c)
    out, med = [], {}
    for sk, L in by.items():
        m = statistics.median(c['items600'] for c in L)
        med[sk] = m
        out += [c for c in L if c['items600'] >= m]
    return out, med


def canonical(d, sentinel):
    r = (d.get('reason') or '')[:60]
    return json.dumps({'reason': r, 'skill': d['skill'], 'args': d.get('args') or {}, 'saw_end': sentinel},
                      separators=(',', ':'), ensure_ascii=False)


LOCAL_TEACHERS = ('qwen3.8:27b', 'gemma4:26b', 'gpt-oss:120b')    # local, free, licence-checked (Apache-2.0)


def logged_nontransient_failure(item):
    lg = item['logged']
    return lg.get('label') == 'bad' and not any(x in (lg.get('failure_class') or '') for x in BD.TRANSIENT)


def keep_label(item, rec):
    """The design's stage-2 filter (s.2.2). -> (keep: bool, why). The record must carry an explicit LOCAL provenance
    (Codex r1 blocker: a missing provenance is never defaulted -- an unknown source is refused)."""
    if rec is None or rec.get('transport_error'):
        return False, 'no answer'
    prov = rec.get('provenance') or ''
    if BD.paid_refusal(prov, None):
        return False, 'paid quarantine'
    if prov not in tuple('teacher-local:%s' % m for m in LOCAL_TEACHERS):
        return False, 'unknown source'
    if not rec.get('schemaValid'):
        return False, 'schema invalid'
    p = rec.get('proposal') or {}
    sk, args = p.get('skill'), p.get('args') or {}
    if not sk:
        return False, 'no skill'
    if S.check_action(sk, args, S.facts(item['user']))[0]:
        return False, 'hard check'
    # ANY item whose logged action failed for a non-transient reason -- a post-veto decision can itself have failed
    # (Codex r1 blocker): the teacher must not re-choose it
    if (item['kind'] == 'fail' or logged_nontransient_failure(item)) and \
            S.key_of(sk, args) == S.key_of(item['logged']['skill'], item['logged']['args']):
        return False, 'repeats the logged failed action'
    if item['kind'] == 'post_veto' and S.key_of(sk, args) == S.key_of(item['vetoed'][0], item['vetoed'][1]):
        return False, 'repeats the vetoed action'
    return True, 'kept'


def fast_id(line):
    return line[8:8 + 60].split('"', 1)[0] if line.startswith('{"id": "') else json.loads(line)['id']


def cmd_pool(a):
    v0 = os.path.expanduser(a.v0); ddir = os.path.expanduser(a.days_dir); out = os.path.expanduser(a.out)
    if os.path.exists(os.path.join(out, 'relabel-pool.jsonl')):
        raise SystemExit('REFUSED: %s already holds a pool (immutable)' % out)
    os.makedirs(out, exist_ok=True)
    man = json.load(open(os.path.join(v0, 'MANIFEST.json')))
    heldout, new_days = set(man['heldout']['worlds']), set(man['new_days'])
    days = [d for d in man['days'] if d not in new_days]
    sps = json.load(open(os.path.join(v0, 'sysprompts.json')))
    pilot_ids = {json.loads(l)['id'] for l in open(os.path.join(v0, 'pilot-1000.jsonl')) if l.strip()}
    eval_ids = {json.loads(l)['id'] for l in open(os.path.join(v0, 'm3-eval.jsonl')) if l.strip()}
    with gzip.open(os.path.join(v0, 'train-good.jsonl.gz'), 'rt') as fh:
        good_ids = {fast_id(l) for l in fh if l.strip()}
    seed = a.seed if a.seed is not None else secrets.randbits(63)
    rng = random.Random(seed)
    C = collections.Counter()
    fpool, pvpool, gcands = collections.defaultdict(list), [], []
    for d in days:
        shard = os.path.join(ddir, d, 'triples-%s.jsonl.gz' % d.replace('-', ''))
        prev = {}
        with gzip.open(shard, 'rt') as fh:
            for line in fh:
                t = json.loads(line)
                pv = prev.get(t['bot']); prev[t['bot']] = t
                if t['world'] in heldout:
                    continue
                C['train_rows'] += 1
                if t['id'] in pilot_ids or t['id'] in eval_ids:
                    C['skip_pilot_or_eval'] += 1; continue
                ok = usable(t, sps)
                if pv is not None and pv['gate']['refused'] and (pv['gate']['reason'] or '').startswith('repeat_loop'):
                    C['post_veto_seen'] += 1
                    if ok:
                        pvpool.append({'id': t['id'], 'day': d, 'vetoed': json.loads(BD.action_key(pv))})
                    continue
                if t['label'] == 'bad' and not BD.is_transient(t) and ok:
                    fpool[(BD.failure_class(t), t['action']['skill'])].append({'id': t['id'], 'day': d})
                if t['label'] == 'good' and t['id'] in good_ids:
                    C['g_candidates'] += 1
                    if repeats_bad_prev(t, pv):
                        C['g_drop_repeat_of_bad_prev'] += 1; continue
                    if not output_ok(t):
                        C['g_drop_no_output'] += 1; continue
                    gcands.append({'id': t['id'], 'day': d, 'skill': t['action']['skill'],
                                   'items600': (t['window'].get('600') or {}).get('items') or 0})
    C['f_pool'] = sum(len(v) for v in fpool.values()); C['pv_pool'] = len(pvpool); C['g_after_g2_g3'] = len(gcands)
    if not (C['f_pool'] and C['pv_pool'] and C['g_after_g2_g3']):
        raise SystemExit('REFUSED: an empty pool is a broken query, not a fact: %s' % dict(C))
    fsel, fquota = BD.stratified(fpool, min(a.f_n, C['f_pool']), rng, floor=10)
    pvsel = rng.sample(sorted(pvpool, key=lambda r: r['id']), min(a.pv_n, len(pvpool)))
    g4, med = top_half(gcands)
    C['g_after_g4'] = len(g4)
    by = collections.defaultdict(list)
    for c in g4:
        by[c['skill']].append(c)
    gq = BD.sqrt_allocate({k: len(v) for k, v in by.items()}, min(a.g_n, len(g4)))
    gsel = []
    for k in sorted(gq):
        gsel += rng.sample(sorted(by[k], key=lambda r: r['id']), gq[k])
    sel = {}
    for kind, L in (('fail', fsel), ('post_veto', pvsel), ('good', gsel)):
        for r in L:
            sel.setdefault(r['id'], (kind, r))
    outs = {'relabel': open(os.path.join(out, 'relabel-pool.jsonl'), 'w'), 'good': open(os.path.join(out, 'good.jsonl'), 'w')}
    got = collections.Counter()
    for d in sorted({r['day'] for _, r in sel.values()}):
        with gzip.open(os.path.join(ddir, d, 'triples-%s.jsonl.gz' % d.replace('-', '')), 'rt') as fh:
            for line in fh:
                i = line[8:8 + 60].split('"', 1)[0] if line.startswith('{"id": "') else None
                if i not in sel:
                    continue
                t = json.loads(line)
                kind, r = sel[t['id']]
                m = BD.materialise(t, sps)
                m['prompt_tokens'] = t.get('prompt_tokens'); m['kind'] = kind
                if kind == 'post_veto':
                    m['vetoed'] = r['vetoed']
                if kind == 'good':
                    m['items600'] = r['items600']
                    outs['good'].write(json.dumps(m) + '\n')
                else:
                    outs['relabel'].write(json.dumps(m) + '\n')
                got[kind] += 1
    for fh in outs.values():
        fh.close()
    want = collections.Counter(k for k, _ in sel.values())
    mf = {'made_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'source': 'v0 TRAIN cell',
          'days': days, 'heldout_worlds_excluded': sorted(heldout), 'new_days_excluded': sorted(new_days),
          'pilot_and_eval_ids_excluded': len(pilot_ids | eval_ids), 'seed': seed, 'counts': dict(C),
          'selected': dict(got), 'fail_strata': len(fquota), 'good_quota_by_skill': gq,
          'g4_median_items600_by_skill': med,
          'rules': {'G2': "drop a good decision whose action equals the bot's previous action when that was bad/refused",
                    'G3': '>= 1 item gathered in 600 s or a milestone in 120 s',
                    'G4': 'at or above its skill median of 600-s items'},
          'files': {n: {'sha256': BD.sha256_file(os.path.join(out, n)), 'lines': sum(1 for _ in open(os.path.join(out, n)))}
                    for n in ('relabel-pool.jsonl', 'good.jsonl')}}
    if got != want:
        raise SystemExit('REFUSED: materialised %s != selected %s' % (dict(got), dict(want)))
    json.dump(mf, open(os.path.join(out, 'POOL-MANIFEST.json'), 'w'), indent=1)
    print(json.dumps(mf, indent=1))


def cmd_assemble(a):
    out = os.path.expanduser(a.out)
    C = collections.Counter()
    items = {}
    for l in open(os.path.join(out, 'relabel-pool.jsonl')):
        if l.strip():
            r = json.loads(l); items[r['id']] = r
    # the pilot's NON-transient items may be trained on with LOCAL labels (TRAIN cell; only PAID labels are
    # quarantined). Transient ones (cooldown, busy, ...) are left out: there a retry can be right and the gate decides.
    for pp in a.pilot or []:
        for l in open(os.path.expanduser(pp)):
            if not l.strip():
                continue
            r = json.loads(l)
            if r['id'] in items:
                raise SystemExit('REFUSED: pilot id %s is also in the pool' % r['id'])
            if r['logged'].get('skill') and logged_nontransient_failure(r):
                r['kind'] = 'fail'; items[r['id']] = r
                C['pilot items admitted (non-transient)'] += 1
            else:
                C['pilot items left out (transient or no logged skill)'] += 1
    kept = {}
    for lp in a.labels:
        for l in open(os.path.expanduser(lp)):
            if not l.strip():
                continue
            rec = json.loads(l)
            it = items.get(rec['id'])
            if it is None:
                C['label for an unknown id'] += 1; continue
            if rec['id'] in kept:
                C['already kept from an earlier teacher'] += 1; continue
            # provenance is ASSIGNED here only for a replay record of an allow-listed local model named on the
            # command line; anything else keeps whatever it carries (none -> refused as an unknown source)
            if 'provenance' not in rec and rec.get('model') in a.local_model and rec.get('model') in LOCAL_TEACHERS:
                rec['provenance'] = 'teacher-local:%s' % rec['model']
            ok, why = keep_label(it, rec)
            C['%s:%s' % (it['kind'], why)] += 1
            if ok:
                ex = dict(it); ex['assistant'] = canonical(rec['proposal'], it['sentinel']); ex['provenance'] = rec['provenance']
                kept[rec['id']] = ex
    if not kept:
        raise SystemExit('REFUSED: no relabel kept: %s' % dict(C))
    good = [json.loads(l) for l in open(os.path.join(out, 'good.jsonl')) if l.strip()]
    for g in good:
        g['assistant'] = canonical(json.loads(g['assistant']), g['sentinel'])
    rows = list(kept.values()) + good
    rng = random.Random(a.seed)
    rows.sort(key=lambda r: r['id']); rng.shuffle(rows)
    p = os.path.join(out, a.name)
    with open(p, 'w') as fh:
        for r in rows:
            fh.write(json.dumps(r) + '\n')
    comp = collections.Counter(r['kind'] for r in rows)
    sk = collections.Counter('%s:%s' % (r['kind'], json.loads(r['assistant'])['skill']) for r in rows)
    prov = collections.Counter(r['provenance'] for r in rows)
    mf = {'file': a.name, 'sha256': BD.sha256_file(p), 'examples': len(rows), 'composition': dict(comp),
          'provenance': dict(prov), 'filter': dict(C), 'skill_by_kind': dict(sk.most_common()), 'seed': a.seed,
          'labels': [os.path.abspath(os.path.expanduser(x)) for x in a.labels],
          'lineage_note': 'teacher labels come from a different model than the base; fleet examples are qwen2.5 (not the base lineage)'}
    json.dump(mf, open(os.path.join(out, a.name + '.MANIFEST.json'), 'w'), indent=1)
    print(json.dumps(mf, indent=1))


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='verb', required=True)
    p = sub.add_parser('pool')
    p.add_argument('--v0', default='~/learnloop/datasets/v0'); p.add_argument('--days-dir', default='~/learnloop/days')
    p.add_argument('--out', required=True); p.add_argument('--seed', type=int, default=None)
    p.add_argument('--f-n', type=int, default=12000); p.add_argument('--pv-n', type=int, default=4000)
    p.add_argument('--g-n', type=int, default=9000)
    q = sub.add_parser('assemble')
    q.add_argument('--out', required=True); q.add_argument('--labels', nargs='+', required=True)
    q.add_argument('--name', default='train.jsonl'); q.add_argument('--seed', type=int, default=20261030)
    q.add_argument('--pilot', nargs='*', default=None, help='pilot-1000.jsonl: its non-transient items join the pool')
    q.add_argument('--local-model', nargs='+', required=True, help='the local teacher(s) whose replay records these are')
    a = ap.parse_args(argv)
    return cmd_pool(a) if a.verb == 'pool' else cmd_assemble(a)


if __name__ == '__main__':
    main()
