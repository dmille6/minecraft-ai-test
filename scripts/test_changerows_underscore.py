#!/usr/bin/env python3
"""test_changerows_underscore.py -- verdict.py links a death to a change row spelled '_x' (2026-10-20).

THE DEFECT. Every comparison in verdict.py strips the row kind (`q[1].lstrip('_') in C_ROWS`), because
logEvent kind 'x' lands in skill.name as '_x'. The registered names were kept AS WRITTEN
(`C_ROWS = set(reg.get('change_rows', []))`), so a registration that spells its rows the way the logs do
-- cobblekeep-01 `_lid_clear` `_well_dispose`, bagbudget-01 `_bagbudget` `_town_deposit`, lidclear-01
`_lid_clear` -- never linked a death to its own rows, `away` stayed empty, and the control emission rate
for those rows read 0. The death gate's RATE path still ran; the LINKED path was dead, silently.
`linkage_extra` had the same mismatch against M_LIST.

WHAT THIS DRIVES. The real verdict.py as a subprocess (the acceptance suite's `Case` fixtures: a
manifest, a registration, evidence objects and per-bot skill logs in a temp dir), plus the pure
normaliser `registered_row_names` extracted by AST. Then each mutant is applied to a COPY of verdict.py
(anchor asserted present and unique) and the named cases must FAIL under it -- so every case here has
been seen to fail for the reason it exists.

    python3 scripts/test_changerows_underscore.py              # cases + mutants
    python3 scripts/test_changerows_underscore.py --cases      # cases only (CASE lines; used by the mutants)

Off the bots host the repo's lib/version_split.py lacks `in_canary_pool` (it exists only in
~/mcai-analysis/lib on the host), so a local run needs VERDICT_MODULE_DIR pointing at a directory holding
the host's version_split.py. On the host nothing is needed.
"""
import ast, json, os, shutil, subprocess, sys, tempfile, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
VERDICT = os.environ.get('ACCEPTANCE_VERDICT_PY') or os.path.join(HERE, 'verdict.py')
os.environ['ACCEPTANCE_VERDICT_PY'] = VERDICT          # Case (test_verdict_acceptance) reads it at import
sys.path.insert(0, HERE)
from test_verdict_acceptance import Case, immobiledid  # noqa: E402

RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok)))
    print(f"CASE\t{name}\t{'PASS' if ok else 'FAIL'}")
    if not ok and detail:
        print('        ' + str(detail)[-700:].replace('\n', '\n        '))


def stamp(t, sec):
    return (t + dt.timedelta(seconds=sec)).isoformat().replace('+00:00', 'Z')


def two_linked_deaths(c, t, kind='_lid_clear'):
    """Two canary deaths, each with `kind` 30 s before it; `kind` also fires AWAY from any death (so it is
    not a consequence row); a control bot that never emits it (so its control rate is MEASURED at 0)."""
    c.log('board-b-Bravo', [(stamp(t, 0), kind, 'lid cleared'), (stamp(t, 300), 'gather', 'ok'),
                            (stamp(t, 600), kind, 'lid cleared'), (stamp(t, 630), '_death', 'drowned; idle')])
    c.log('hive-a-Comet', [(stamp(t, 870), 'gather', 'ok'), (stamp(t, 900), kind, 'lid cleared'),
                           (stamp(t, 930), '_death', 'drowned; idle'), (stamp(t, 1200), 'gather', 'ok')])
    c.log('isolated-a-Alpha', [(stamp(t, s), 'gather', 'ok') for s in range(0, 1800, 120)])
    return c


def held_gate():
    # 2 canary deaths in 30 bot-h vs 14 in 210: ratio 1.0x, so the RATE path holds and only linkage can revert
    return immobiledid(canary_deaths=2, canary_bh=30.0, control_deaths=14, control_bh=210.0)


def pure_function():
    src = open(VERDICT).read()
    fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == 'registered_row_names')
    ns = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), VERDICT, 'exec'), ns)
    return ns['registered_row_names']


def cases():
    tmp = tempfile.mkdtemp(prefix='changerows-underscore-')
    t = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=60)

    # 0. POSITIVE CONTROL: the fixture reaches a verdict at all (a harness that always crashes passes "not REVERT")
    c = Case(tmp); c.evidence('immobiledid', immobiledid())
    got, out = c.run()
    check('0 positive control: a clean canary reaches KEEP', got == 'KEEP', out)

    # 1. THE DEFECT. '_lid_clear' registered, two canary deaths each preceded by `_lid_clear`: the change row links,
    #    and with two deaths (the owner's floor) v23 licenses the REVERT. Before 10-20 this read as no link at all.
    c = two_linked_deaths(Case(tmp, reg_extra={'change_rows': ['_lid_clear']}), t)
    c.evidence('immobiledid', held_gate())
    got, out = c.run()
    check("1 '_x' registered + two deaths after an '_x' row -> LINKS and REVERTS",
          got == 'REVERT' and 'change row inside a death window' in out and 'lid_clear' in out, out)
    check("1b  ...and the control rate is MEASURED for it (lid_clear=0.000/bh), not missing",
          'lid_clear=0.000/bh' in (c.raw_out or ''), c.raw_out)

    # 2. UNCHANGED: the same world registered WITHOUT the underscore links exactly as it always did
    c = two_linked_deaths(Case(tmp, reg_extra={'change_rows': ['lid_clear']}), t)
    c.evidence('immobiledid', held_gate())
    got, out = c.run()
    check("2 'x' registered (no underscore) -> unchanged: LINKS and REVERTS",
          got == 'REVERT' and 'change row inside a death window' in out, out)

    # 2b. UNCHANGED, NEGATIVE: an unrelated registered row never links (the fix must not link everything)
    c = two_linked_deaths(Case(tmp, reg_extra={'change_rows': ['_well_dispose']}), t)
    c.evidence('immobiledid', held_gate())
    got, out = c.run()
    check("2b '_y' registered, deaths after '_x' rows only -> no link, no REVERT",
          got not in ('REVERT', 'CRASH', 'NO_OUTPUT') and 'change row inside a death window' not in out, out)

    # 3. THE CONTROL-RATE PATH IS ALIVE: control emits `_lid_clear` constantly, so a link is coincidence and the
    #    row is REFUSED on its control rate. Before 10-20 the row was never in a window, so this test never ran.
    c = two_linked_deaths(Case(tmp, reg_extra={'change_rows': ['_lid_clear']}), t)
    c.log('isolated-b-Delta', [(stamp(t, s), '_lid_clear', 'lid cleared') for s in range(0, 1800, 30)])
    c.evidence('immobiledid', held_gate())
    got, out = c.run()
    check("3 '_x' registered, control emits x constantly -> REFUSED on its control rate, no REVERT",
          got not in ('REVERT', 'CRASH', 'NO_OUTPUT') and 'lid_clear: control emits it at' in out, out)

    # 4. THE DEATH POLL sees it too (one death: below the floor, so POLL_OK, but counted as a change-row death)
    c = Case(tmp, reg_extra={'change_rows': ['_lid_clear']})
    c.log('board-b-Bravo', [(stamp(t, 0), '_lid_clear', 'lid cleared'), (stamp(t, 300), 'gather', 'ok'),
                            (stamp(t, 600), '_lid_clear', 'lid cleared'), (stamp(t, 630), '_death', 'drowned; idle')])
    c.evidence('immobiledid', immobiledid(canary_deaths=1, canary_bh=15.0, control_deaths=1, control_bh=150.0), M=30)
    got, out = c.run(M=0, poll=True)
    check("4 death poll: one death after an '_x' row is counted '1 with a change row'",
          got == 'POLL_OK' and '1 with a change row' in out, out)

    # 5. linkage_extra has the same mismatch against M_LIST: '_x' there must rung-link a death after an '_x' row
    c = Case(tmp, reg_extra={'linkage_extra': ['_lid_clear']})
    c.log('board-b-Bravo', [(stamp(t, 0), 'gather', 'ok'), (stamp(t, 600), '_lid_clear', 'lid cleared'),
                            (stamp(t, 630), '_death', 'drowned; idle')])
    c.evidence('immobiledid', immobiledid(canary_deaths=1, canary_bh=15.0, control_deaths=1, control_bh=150.0))
    got, out = c.run()
    check("5 linkage_extra '_x' -> a death after an '_x' row is rung-linked (reported)",
          got not in ('CRASH', 'NO_OUTPUT') and 'rung-linked death on a non-ladder change' in out and 'lid_clear' in out, out)

    # 6. the pure normaliser
    f = pure_function()
    check("6 registered_row_names strips one or more underscores and leaves plain names alone",
          f(['_a', 'b', '__c']) == {'a', 'b', 'c'}, f(['_a', 'b', '__c']))
    check("6b a name that is EMPTY once stripped is dropped (it would match every nameless row)",
          f(['_', '__', 'k']) == {'k'}, f(['_', '__', 'k']))
    # round 1 (Codex): the exact boundary of "unchanged". '' is DROPPED (old: kept, and it matched every nameless row);
    # a hashable non-string such as None passes through as set() kept it (it can never equal a row kind string)
    check("6d '' is dropped, None passes through as set() kept it, a plain name is untouched",
          f(['', None, 'x']) == {None, 'x'}, f(['', None, 'x']))
    try:
        f([{'x': 1}]); r = 'no error'
    except TypeError:
        r = 'TypeError'
    check("6c a dict still raises TypeError, exactly as set() did (launch preflights refuse it)", r == 'TypeError', r)
    shutil.rmtree(tmp, ignore_errors=True)


# (label, anchor in verdict.py, replacement, cases that must FAIL under it)
MUTANTS = [
    ('C_ROWS kept as written (the 10-20 defect)',
     "C_ROWS = registered_row_names(reg.get('change_rows', []))", "C_ROWS = set(reg.get('change_rows', []))",
     ["1 '_x' registered + two deaths after an '_x' row -> LINKS and REVERTS",
      "3 '_x' registered, control emits x constantly -> REFUSED on its control rate, no REVERT",
      "4 death poll: one death after an '_x' row is counted '1 with a change row'"]),
    ('linkage_extra kept as written',
     "| registered_row_names(reg.get('linkage_extra', []))", "| set(reg.get('linkage_extra', []))",
     ["5 linkage_extra '_x' -> a death after an '_x' row is rung-linked (reported)"]),
    ('the normaliser does not strip',
     "return {n.lstrip('_') if isinstance(n, str) else n for n in names", "return {n for n in names",
     ["1 '_x' registered + two deaths after an '_x' row -> LINKS and REVERTS",
      "6 registered_row_names strips one or more underscores and leaves plain names alone"]),
    ('the normaliser keeps a name that strips to empty',
     "            if not (isinstance(n, str) and not n.lstrip('_'))}", "            if True}",
     ["6b a name that is EMPTY once stripped is dropped (it would match every nameless row)"]),
]


def run_cases(verdict_path):
    env = dict(os.environ, ACCEPTANCE_VERDICT_PY=verdict_path)
    r = subprocess.run([sys.executable, os.path.abspath(__file__), '--cases'], capture_output=True, text=True,
                       env=env, timeout=900)
    got = {}
    for line in r.stdout.splitlines():
        if line.startswith('CASE\t'):
            _, name, res = line.split('\t')
            got[name] = res
    return got, r


def mutants():
    base, _r = run_cases(VERDICT)
    if not base or not all(v == 'PASS' for v in base.values()):
        print('REFUSING to score mutants: the unmutated cases do not all pass: %s' % base)
        return False
    ok_all = True
    for label, anchor, repl, must_fail in MUTANTS:
        d = tempfile.mkdtemp(prefix='changerows-mutant-')
        for f in os.listdir(HERE):
            if f.endswith('.py'):
                shutil.copy(os.path.join(HERE, f), d)            # a COPY, never the source
        if os.path.isdir(os.path.join(HERE, 'lib')):
            shutil.copytree(os.path.join(HERE, 'lib'), os.path.join(d, 'lib'),
                            ignore=shutil.ignore_patterns('__pycache__'))
        target = os.path.join(d, 'verdict.py')
        src = open(target).read()
        n = src.count(anchor)
        if n != 1:
            print(f'FAIL  mutant {label}: ANCHOR MISSING OR NOT UNIQUE ({n}) -- proves nothing')
            ok_all = False; continue
        open(target, 'w').write(src.replace(anchor, repl, 1))
        assert open(target).read() != src, 'mutant did not change the file'
        got, r = run_cases(target)
        missing = [c for c in must_fail if c not in got]
        survived = [c for c in must_fail if got.get(c) != 'FAIL']
        others = [c for c, v in got.items() if v == 'FAIL' and c not in must_fail]
        killed = not missing and not survived
        ok_all &= killed
        print(f"{'PASS' if killed else 'FAIL'}  mutant killed: {label}"
              + (f"\n        survived: {survived}" if survived else '')
              + (f"\n        cases absent (crash?): {missing}  stderr: {(r.stderr or '')[-300:]}" if missing else '')
              + (f"\n        also failed: {others}" if others else ''))
        shutil.rmtree(d, ignore_errors=True)
    return ok_all


if __name__ == '__main__':
    cases()
    n_ok = sum(ok for _n, ok in RESULTS)
    print(f'{n_ok}/{len(RESULTS)} cases pass')
    if '--cases' in sys.argv:
        sys.exit(0 if n_ok == len(RESULTS) else 1)
    print('\nmutants (each must FAIL exactly the cases it targets):')
    m_ok = mutants()
    print('ALL PASS' if (n_ok == len(RESULTS) and m_ok) else 'FAILED')
    sys.exit(0 if (n_ok == len(RESULTS) and m_ok) else 1)
