#!/usr/bin/env python3
"""changerowcheck.py (v19 preflight): a row counts against a change only if the BASELINE wrote it.

THE LIVE CASE (2026-10-07 19:46Z): towndeposit-02 was REFUSED because 40 `town_deposit` rows sat
in the 6 h window -- all from the previous canary (towndeposit-01 on 92bc84f, board-b + placebo-a,
13:06-16:15Z), none from the baseline c6e91a8. The guard's claim is "the OLD code emits it", so a
row from another build is a note, not a refusal.

Behaviour is driven end to end: fixture logs in a temp MCAI tree, a fixture manifest and
registration, main() run as the loop runs it. Then each mutant is applied to a COPY of the source
(anchor asserted present and unique) and the same end-to-end case must FAIL under it.
"""
import os, sys, json, tempfile, datetime as dt, importlib.util, io, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'changerowcheck.py')
T = []


def t(name, ok, detail=''):
    T.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"\n        -> {detail}" if detail else ''))


def load(path, name='crc'):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def row(ts, bot, kind, ver):
    r = {'@timestamp': ts, 'bot': {'name': bot}, 'skill': {'name': kind}}
    if ver is not None:
        r['code'] = {'version': ver + '+abc123'}
    return json.dumps(r)


def fixture(root, kind_rows):
    """80 bots x 25 filler kinds on the baseline (the positive control), plus `kind_rows`:
    a list of (bot, kind, version-or-None)."""
    now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)
    ts = now.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    pools = ['board-a', 'board-b', 'hive-a', 'hive-b', 'placebo-a', 'placebo-b', 'hive-c', 'board-c',
             'hive-d', 'board-d', 'placebo-c', 'placebo-d', 'isolated-a', 'isolated-b', 'isolated-c', 'isolated-d']
    names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
    lines = {}
    for p in pools:
        for n in names:
            b = f'{p}-{n}'
            lines[b] = [row(ts, b, f'_filler_{i}', 'c6e91a8') for i in range(25)]
    for b, k, v in kind_rows:
        lines[b].append(row(ts, b, k, v))
    for b, ls in lines.items():
        os.makedirs(os.path.join(root, b), exist_ok=True)
        open(os.path.join(root, b, f'skill-{b}.jsonl'), 'w').write('\n'.join(ls) + '\n')


def run(mod, kind_rows, declared='c6e91a8', change_rows=('town_deposit',)):
    with tempfile.TemporaryDirectory() as d:
        logs = os.path.join(d, 'logs'); regs = os.path.join(d, 'regs'); os.makedirs(regs)
        fixture(logs, kind_rows)
        json.dump({'run_id': 'x', 'change_rows': list(change_rows)}, open(os.path.join(regs, 'x.json'), 'w'))
        man = os.path.join(d, 'man.json')
        json.dump({'declared_code_version': declared}, open(man, 'w'))
        mod.MCAI = logs
        argv = sys.argv
        sys.argv = ['changerowcheck.py', 'x', '--hours', '6', '--registrations', regs, '--manifest', man]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                rc = mod.main()
        finally:
            sys.argv = argv
        return rc, buf.getvalue()


def cases(mod, quiet=False):
    """-> list of (name, ok). The cases a mutant must break."""
    out = []
    prev_canary = [(f'{p}-{n}', '_town_deposit', '92bc84f') for p in ('board-b', 'placebo-a')
                   for n in ('Alpha', 'Bravo', 'Delta', 'Echo')] * 5      # 40 rows, none baseline
    rc, txt = run(mod, prev_canary)
    out.append(('towndeposit-02 shape: 40 rows from the PREVIOUS canary build, 0 from the baseline -> PASS (exit 0)',
                rc == 0, txt))
    out.append(('  ...and the other-build rows are REPORTED as a note naming the build',
                'note: town_deposit: 40 row(s) from build 92bc84f' in txt, txt))
    rc, txt = run(mod, prev_canary + [('hive-a-Alpha', '_town_deposit', 'c6e91a8')])
    out.append(('one row from the BASELINE build still refuses (exit 2)', rc == 2 and 'REFUSED' in txt, txt))
    rc, txt = run(mod, [('hive-a-Alpha', '_town_deposit', None)])
    out.append(('a declared row seen only with NO version is REFUSED, and says why',
                rc == 2 and 'carry no version' in txt, txt))
    rc, txt = run(mod, [], declared='deadbee')
    out.append(('a baseline with no rows of its own is an instrument failure, however many other-build bots there are',
                rc == 2 and 'too little to prove anything' in txt, txt))
    rc, txt = run(mod, [], declared='')
    out.append(('no declared_code_version in the manifest -> REFUSED with that reason',
                rc == 2 and 'declares no declared_code_version' in txt, txt))
    rc, txt = run(mod, [])
    out.append(('clean baseline -> exit 0 (positive control passes on baseline rows)', rc == 0, txt))
    base, other, unknown, bots, rows = mod.tally(
        [json.loads(row('2026-10-07T14:00:00Z', 'b-a-A', '_k', 'c6e91a8')),
         json.loads(row('2026-10-07T14:00:00Z', 'b-b-B', '_k', '92bc84f')),
         json.loads(row('2026-10-07T14:00:00Z', 'b-c-C', 'k', None))], 'c6e91a8+deadbe')
    out.append(('tally(): baseline on the 7-char sha (suffix ignored); other build and no-version kept apart; '
                'only baseline bots vouch', base['k'] == 1 and other[('k', '92bc84f')] == 1 and unknown['k'] == 1
                and bots == {'b-a-A'}, f'{base} {other} {unknown} {bots}'))
    return out


def mutate(old, new):
    src = open(SRC).read()
    assert old in src, 'ANCHOR MISSING: %r' % old
    assert src.count(old) == 1, 'ANCHOR NOT UNIQUE (%d): %r' % (src.count(old), old)
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'changerowcheck_mut.py')
    open(p, 'w').write(src.replace(old, new, 1))
    return p


if __name__ == '__main__':
    mod = load(SRC)
    for name, ok, detail in cases(mod):
        t(name, ok, '' if ok else detail[-600:])
    MUTANTS = [
        ('count every build again (the 10-07 defect)', '        elif v == want:\n', '        elif True:\n'),
        ('unversioned rows treated as another build', '        if not v:\n            unknown[k] += 1', '        if False:\n            unknown[k] += 1'),
        ('every bot vouches for the baseline', "        rows += 1\n",
         "        rows += 1\n        base_bots.add((r.get('bot') or {}).get('name', ''))\n"),
        ('positive control dropped', '    if base_rows == 0 or len(bots) < 40 or len(kinds) < 20:', '    if False:'),
        ('the other-build note is dropped', "            if k == row:\n", "            if False:\n"),
        ('manifest baseline ignored (empty string)', "baseline = str(json.load(open(a.manifest)).get('declared_code_version') or '')",
         "baseline = 'zzzzzzz'"),
    ]
    print('\nmutants (each must FAIL at least one case):')
    for name, old, new in MUTANTS:
        mp = mutate(old, new)
        m = load(mp, 'crc_mut')
        try:
            res = cases(m)
            killed = not all(ok for _n, ok, _d in res)
        except Exception as e:
            killed = True
        t(f'mutant killed: {name}', killed)
    n = len(T); bad = n - sum(T)
    print(f'\n{n - bad}/{n} pass')
    sys.exit(1 if bad else 0)
