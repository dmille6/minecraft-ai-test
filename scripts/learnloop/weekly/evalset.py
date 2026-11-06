#!/usr/bin/env python3
"""learning loop: VERSION the frozen 600-item gate set (m3-eval) under rule G5 (llpatrol-01, owner 11-06 ~06:05Z).

    nice -n 19 python3 -B evalset.py build --v0 ~/learnloop/datasets/v0 --old ~/learnloop/datasets/v0/m3-eval.jsonl \
        --out ~/learnloop/r3/m3-eval.v1.jsonl --seed 20261106

Owner: "rebuild the frozen gate set without the patrol-lap GOOD items: replace them with real-work items drawn by the same
method and rule G5, keep the old set and its historical scores (version the set, don't overwrite)". v0 = build_dataset.py's
m3-eval draw (cell C = held-out worlds x the 2 newest days; GOOD = usable, not the decision after a repeat_loop veto,
label good; stratified by skill, 200, floor 5). v1 = v0 with every GOOD item that fails G5 (build_clean.patrol_lap on its
archived row) removed, and the same number drawn from the SAME cell-C good pool after G5, so that each skill reaches the
quota the v0 method gives over the G5 pool (stratified(pool, 200, floor 5)): the deficit skills first, then
proportionally from what is left (fill_plan). The fail and post_veto items are untouched (byte-identical). Never
overwrites: refuses an existing --out. Writes <out> + <out>.MANIFEST.json (removed/added ids, quotas, seed, sha256 of old
and new). The promptcache layout file is made from <out> by prompt_transform.mjs (weekly.py ph_transform, eval_items_src).
"""
import argparse, collections, datetime as dt, gzip, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LL = os.path.dirname(HERE)
sys.path.insert(0, LL)
import build_dataset as BD  # noqa: E402
import build_clean as BC  # noqa: E402

VERSION = 'm3-eval.v1'
GOOD_N, FLOOR = 200, 5


def good_pool(rows, sps):
    """build_dataset's cell-C GOOD eval pool, in archive (bot) order: usable, label good, not after a repeat_loop veto.
    -> {id: row}"""
    prev, out = {}, {}
    for t in rows:
        usable = t['prompt_complete'] and t['nonce_ok'] and t['model'] == BD.FLEET_MODEL \
            and '%s:%s' % (t['code_version'], t['system_hash']) in sps
        pv = prev.get(t['bot']); prev[t['bot']] = t if t['model'] == BD.FLEET_MODEL else None
        if usable and pv is not None and pv['gate']['refused'] and (pv['gate']['reason'] or '').startswith('repeat_loop'):
            continue
        if usable and t['label'] == 'good':
            out[t['id']] = t
    return out


def fill_plan(target, kept, avail, n):
    """How many new items to draw per skill. target: the v0-method quota over the G5 pool; kept: v0 good items that
    stay, per skill; avail: undrawn G5 pool items per skill; n: how many to add. Deficit skills (kept < target) first,
    largest deficit first; the rest proportionally to what is left (largest remainder). Never more than avail."""
    plan = collections.Counter()
    for k in sorted(target, key=lambda k: (-(target[k] - kept.get(k, 0)), k)):
        if sum(plan.values()) >= n:
            break
        plan[k] = max(0, min(target[k] - kept.get(k, 0), avail.get(k, 0), n - sum(plan.values())))
    left = n - sum(plan.values())
    if left > 0:
        rest = {k: avail.get(k, 0) - plan[k] for k in avail if avail.get(k, 0) - plan[k] > 0}
        tot = sum(rest.values())
        if tot < left:
            raise SystemExit('REFUSED: only %d G5-clean good items left to draw, %d needed' % (sum(plan.values()) + tot, n))
        share = {k: left * v / tot for k, v in rest.items()}
        add = {k: int(share[k]) for k in rest}
        for k in sorted(rest, key=lambda k: (-(share[k] - add[k]), k))[:left - sum(add.values())]:
            add[k] += 1
        for k, v in add.items():
            plan[k] += v
    return {k: v for k, v in plan.items() if v}


def cmd_build(a):
    v0, out = os.path.expanduser(a.v0), os.path.expanduser(a.out)
    if os.path.exists(out):
        raise SystemExit('REFUSED: %s exists -- gate-set versions are immutable' % out)
    sps = json.load(open(os.path.join(v0, 'sysprompts.json')))
    with gzip.open(os.path.join(v0, 'heldout-C.jsonl.gz'), 'rt') as fh:
        rows = [json.loads(l) for l in fh if l.strip()]
    pool = good_pool(rows, sps)
    old = [json.loads(l) for l in open(os.path.expanduser(a.old)) if l.strip()]
    good = [it for it in old if it['eval_kind'] == 'good']
    missing = [it['id'] for it in good if it['id'] not in pool]
    if missing:
        raise SystemExit('REFUSED: %d v0 good items are not in the rebuilt cell-C good pool (method drift): %s' % (len(missing), missing[:3]))
    lap = {it['id'] for it in good if BC.patrol_lap(pool[it['id']])}
    if not lap:
        raise SystemExit('REFUSED: no v0 good item fails G5 -- a broken lookup, not a fact (77 of 200 sit on lap rungs)')
    clean = {i: t for i, t in pool.items() if not BC.patrol_lap(t)}
    by = collections.defaultdict(list)
    for i, t in clean.items():
        by[t['action']['skill']].append({'id': i})
    _, target = BD.stratified(by, GOOD_N, random.Random(0), floor=FLOOR)       # the quota only (the draw is below)
    used = {it['id'] for it in old}
    kept = collections.Counter(pool[it['id']]['action']['skill'] for it in good if it['id'] not in lap)
    avail = {k: sum(1 for r in v if r['id'] not in used) for k, v in by.items()}
    plan = fill_plan(target, kept, avail, len(lap))
    rng = random.Random(a.seed)
    add = []
    for k in sorted(plan):
        add += rng.sample(sorted(r['id'] for r in by[k] if r['id'] not in used), plan[k])
    new_items = []
    for i in sorted(add):
        m = BD.materialise(pool[i], sps); m['prompt_tokens'] = pool[i].get('prompt_tokens'); m['eval_kind'] = 'good'
        new_items.append(m)
    v1 = [it for it in old if it['id'] not in lap] + new_items
    assert len(v1) == len(old) and len({it['id'] for it in v1}) == len(v1)
    assert not any(BC.patrol_lap(pool[it['id']]) for it in v1 if it['eval_kind'] == 'good')
    with open(out, 'w') as fh:
        for it in v1:
            fh.write(json.dumps(it) + '\n')
    fam = collections.Counter('%s|%s' % (BD.milestone_family(pool[i]['milestone']), pool[i]['action']['skill']) for i in lap)
    mf = {'version': VERSION, 'made_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
          'rule': BC.G5_RULE, 'from': {'file': os.path.abspath(os.path.expanduser(a.old)), 'sha256': BD.sha256_file(os.path.expanduser(a.old))},
          'file': out, 'sha256': BD.sha256_file(out), 'items': len(v1),
          'composition': dict(collections.Counter(it['eval_kind'] for it in v1)),
          'cell_C_good_pool': len(pool), 'cell_C_good_pool_after_G5': len(clean),
          'removed': sorted(lap), 'removed_by_rung_skill': dict(fam.most_common()), 'added': sorted(add),
          'target_quota_G5': target, 'kept_by_skill': dict(kept), 'fill_plan': plan, 'seed': a.seed,
          'good_by_skill': dict(collections.Counter(it['logged']['skill'] for it in v1 if it['eval_kind'] == 'good').most_common()),
          'unchanged': 'every fail and post_veto item, and the %d G5-clean v0 good items, byte-identical' % (len(good) - len(lap))}
    json.dump(mf, open(out + '.MANIFEST.json', 'w'), indent=1)
    print(json.dumps({k: mf[k] for k in ('version', 'items', 'composition', 'removed_by_rung_skill', 'fill_plan', 'good_by_skill')}, indent=1))


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='verb', required=True)
    b = sub.add_parser('build')
    b.add_argument('--v0', default='~/learnloop/datasets/v0'); b.add_argument('--old', required=True)
    b.add_argument('--out', required=True); b.add_argument('--seed', type=int, default=20261106)
    a = ap.parse_args(argv)
    return cmd_build(a)


if __name__ == '__main__':
    sys.exit(main())
