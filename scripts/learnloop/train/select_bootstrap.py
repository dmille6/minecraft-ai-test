#!/usr/bin/env python3
"""learning loop M3: materialise the BOOTSTRAP SFT set from an immutable dataset version (design s.2.1, s.3.3).

    nice -n 19 ionice -c3 python3 -B select_bootstrap.py --dataset ~/learnloop/datasets/v0 --n 20000 \
        --out ~/learnloop/datasets/v0-boot-20000

Reads <dataset>/train-good.jsonl.gz (STAGE 1 candidates: label good, TRAIN cell only, deduplicated and near-dup capped
by build_dataset.py) and <dataset>/sysprompts.json, each checked against the dataset's MANIFEST sha256 first. The held-out
cells, the eval set and the split are the dataset's own and are NOT redrawn: the bootstrap set is a subset of TRAIN, so
m3-eval.jsonl (cell C) stays a clean held-out set for every candidate trained on it.

Selection = build_dataset.py's dry-round rule, scaled: a sqrt-by-skill quota (rare productive skills -- craft, smelt,
deposit -- are not drowned by gather/explore), uniform within a skill, seeded by a secrets-drawn seed that is recorded.
--exclude takes a materialised file whose ids are left out (e.g. the 2,000-example dry-round subset).

Writes <out>/ (refused if it exists): m3-train-<n>.jsonl (materialised: system + user + assistant, as the trainer
reads) and MANIFEST.json (source dataset + its MANIFEST sha256, seed, quota, sha256 of the output).
"""
import argparse, collections, gzip, hashlib, json, os, random, secrets, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from build_dataset import materialise, sqrt_allocate, sha256_file  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', required=True)
    ap.add_argument('--n', type=int, required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--exclude', default=None, help='materialised jsonl whose ids are not selected')
    ap.add_argument('--seed', type=int, default=None, help='default: secrets.randbits(63), recorded')
    a = ap.parse_args(argv)
    ds = os.path.expanduser(a.dataset); out = os.path.expanduser(a.out)
    if os.path.exists(out):
        raise SystemExit('REFUSED: %s exists -- outputs are immutable; pick a new --out' % out)
    man = json.load(open(os.path.join(ds, 'MANIFEST.json')))
    for n in ('train-good.jsonl.gz', 'sysprompts.json'):
        got = sha256_file(os.path.join(ds, n))
        if got != man['files'][n]['sha256']:
            raise SystemExit('REFUSED: %s sha256 %s differs from the dataset MANIFEST %s' % (n, got, man['files'][n]['sha256']))
    excl = set()
    if a.exclude:
        excl = {json.loads(l)['id'] for l in open(os.path.expanduser(a.exclude)) if l.strip()}
    src = os.path.join(ds, 'train-good.jsonl.gz')
    pool, seen, cells = collections.defaultdict(list), 0, collections.Counter()
    with gzip.open(src, 'rt') as fh:
        for line in fh:
            t = json.loads(line)
            seen += 1; cells[t['cell']] += 1
            if t['cell'] != 'TRAIN' or t['label'] != 'good':
                raise SystemExit('REFUSED: %s is %s/%s -- train-good must hold TRAIN-cell good decisions only' % (t['id'], t['cell'], t['label']))
            if t['id'] in excl:
                continue
            pool[t['action']['skill']].append(t['id'])
    if seen != man['train_good']['kept']:
        raise SystemExit('REFUSED: read %d train-good rows, the MANIFEST says %d' % (seen, man['train_good']['kept']))
    seed = a.seed if a.seed is not None else secrets.randbits(63)
    rng = random.Random(seed)
    q = sqrt_allocate({k: len(v) for k, v in pool.items()}, a.n)
    chosen = set()
    for k in sorted(q):
        chosen |= set(rng.sample(sorted(pool[k]), q[k]))
    sps = json.load(open(os.path.join(ds, 'sysprompts.json')))
    os.makedirs(out)
    fn = os.path.join(out, 'm3-train-%d.jsonl' % a.n)
    got = collections.Counter()
    with gzip.open(src, 'rt') as fh, open(fn, 'w') as w:
        for line in fh:
            t = json.loads(line)
            if t['id'] not in chosen:
                continue
            m = materialise(t, sps)
            w.write(json.dumps(m) + '\n'); got[t['action']['skill']] += 1
    if dict(got) != {k: v for k, v in q.items() if v}:
        raise SystemExit('REFUSED: materialised %s, quota %s' % (dict(got), q))
    res = {'source_dataset': ds, 'source_manifest_sha256': sha256_file(os.path.join(ds, 'MANIFEST.json')),
           'source_rows': seen, 'excluded_ids': len(excl), 'pool_by_skill': {k: len(v) for k, v in sorted(pool.items())},
           'n': sum(got.values()), 'quota': dict(sorted(q.items())), 'seed': seed, 'rule': 'sqrt-by-skill quota, uniform within skill',
           'heldout': man['heldout'], 'newest_code_version': man['newest_code_version'],
           'files': {os.path.basename(fn): {'sha256': sha256_file(fn), 'bytes': os.path.getsize(fn)}}}
    json.dump(res, open(os.path.join(out, 'MANIFEST.json'), 'w'), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    sys.exit(main())
