#!/usr/bin/env python3
"""Behaviour tests for select_bootstrap.py (no fleet data).  python3 scripts/learnloop/train/test_select_bootstrap.py"""
import gzip, json, os, shutil, sys, tempfile, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..'))
import select_bootstrap as S  # noqa: E402
from build_dataset import sha256_file  # noqa: E402

PASS = FAIL = 0
SKILLS = {'gather': 400, 'explore': 300, 'craft': 20, 'smelt': 4}


def check(n, f):
    global PASS, FAIL
    try:
        f(); PASS += 1; print('  PASS  ' + n)
    except Exception:
        FAIL += 1; print('  FAIL  ' + n); traceback.print_exc()


def triple(i, skill, cell='TRAIN', label='good'):
    return {'id': 'd%05d' % i, 'ts': '2026-10-12T00:00:%02dZ' % (i % 60), 'bot': 'hive-b-Alpha', 'world': 'hive-b',
            'code_version': 'v1', 'system_hash': 'h1', 'model': 'qwen2.5:7b-instruct', 'prompt': 'P%d saw_end: END-AB12' % i,
            'response': '{"skill":"%s"}' % skill, 'action': {'skill': skill, 'args': {}, 'reason': ''}, 'label': label,
            'gate': {'refused': False, 'reason': None}, 'outcome': {'status': 'success', 'detail': ''}, 'cell': cell}


def make_ds(rows, kept=None, corrupt=False):
    d = tempfile.mkdtemp()
    with gzip.open(os.path.join(d, 'train-good.jsonl.gz'), 'wt') as fh:
        for r in rows:
            fh.write(json.dumps(r) + '\n')
    json.dump({'v1:h1': {'template': 'You are <BOT>, a <ROLE>.', 'schema': {'type': 'object'}}}, open(os.path.join(d, 'sysprompts.json'), 'w'))
    files = {n: {'sha256': sha256_file(os.path.join(d, n))} for n in ('train-good.jsonl.gz', 'sysprompts.json')}
    if corrupt:
        files['sysprompts.json']['sha256'] = '0' * 64
    json.dump({'files': files, 'train_good': {'kept': len(rows) if kept is None else kept}, 'heldout': {'worlds': ['board-a']},
               'newest_code_version': 'v1'}, open(os.path.join(d, 'MANIFEST.json'), 'w'))
    return d


def rows_default():
    out, i = [], 0
    for sk, n in SKILLS.items():
        for _ in range(n):
            out.append(triple(i, sk)); i += 1
    return out


def run(ds, n, **kw):
    out = os.path.join(tempfile.mkdtemp(), 'o')
    argv = ['--dataset', ds, '--n', str(n), '--out', out] + sum((['--' + k, str(v)] for k, v in kw.items()), [])
    S.main(argv)
    return out, [json.loads(l) for l in open(os.path.join(out, 'm3-train-%d.jsonl' % n))], json.load(open(os.path.join(out, 'MANIFEST.json')))


def refuses(f, what):
    try:
        f()
    except SystemExit as e:
        assert what in str(e), e
        return
    raise AssertionError('did not refuse (%s)' % what)


def t_quota_total_balance_and_materialised_system():
    ds = make_ds(rows_default())
    _, rows, man = run(ds, 100, seed=1)
    assert len(rows) == 100 == man['n'] and len({r['id'] for r in rows}) == 100
    by = {}
    for r in rows:
        by[r['logged']['skill']] = by.get(r['logged']['skill'], 0) + 1
    assert by == man['quota'], (by, man['quota'])
    assert by['smelt'] == 4 and by['gather'] < 0.6 * 100, by       # sqrt: rare skills kept, the big one damped
    assert rows[0]['system'] == 'You are hive-b-Alpha, a gatherer.' and rows[0]['sentinel'] == 'END-AB12'
    assert man['files']['m3-train-100.jsonl']['sha256'] == sha256_file(os.path.join(_, 'm3-train-100.jsonl'))


def t_seed_is_deterministic_and_recorded():
    ds = make_ds(rows_default())
    _, a, ma = run(ds, 50, seed=7)
    _, b, _ = run(ds, 50, seed=7)
    _, c, mc = run(ds, 50)
    assert [r['id'] for r in a] == [r['id'] for r in b] and ma['seed'] == 7 and isinstance(mc['seed'], int)


def t_exclude_leaves_ids_out():
    ds = make_ds(rows_default())
    _, a, _ = run(ds, 60, seed=3)
    ex = os.path.join(tempfile.mkdtemp(), 'ex.jsonl')
    open(ex, 'w').write(''.join(json.dumps({'id': r['id']}) + '\n' for r in a))
    _, b, mb = run(ds, 60, seed=3, exclude=ex)
    assert not ({r['id'] for r in a} & {r['id'] for r in b}) and mb['excluded_ids'] == 60


def t_refusals():
    refuses(lambda: run(make_ds(rows_default(), corrupt=True), 10), 'differs from the dataset MANIFEST')
    refuses(lambda: run(make_ds(rows_default() + [triple(9999, 'gather', cell='C')]), 10), 'TRAIN-cell good decisions only')
    refuses(lambda: run(make_ds(rows_default() + [triple(9998, 'gather', label='bad')]), 10), 'TRAIN-cell good decisions only')
    refuses(lambda: run(make_ds(rows_default(), kept=5), 10), 'the MANIFEST says 5')
    ds = make_ds(rows_default()); out, _, _ = run(ds, 10, seed=1)
    refuses(lambda: S.main(['--dataset', ds, '--n', '10', '--out', out]), 'exists')


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
