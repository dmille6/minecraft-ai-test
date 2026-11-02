#!/usr/bin/env python3
"""Behaviour tests for promomerge.py (audit 11-01 flag 4: promotions are merged into main mechanically, or page).

Pure decisions FIRE on a seeded case and stay QUIET on a clean one; an end-to-end part builds a real bare origin + scratch
clone and merges, conflicts, pushes and re-merges after main moved; the wiring (the Mac wrapper, the installer, the header
file alarmhead reads, stallcheck's backstop page) is asserted on executable text. Bottom: MUTANTS, each asserting its anchor
is present exactly once.

    python3 -B scripts/host/test_promomerge.py     (exit 1 on any failure; bots/test/promomerge.test.mjs runs it in npm test)
"""
import datetime as dt
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC_PATH = os.path.join(HERE, 'promomerge.py')
sys.path.insert(0, os.path.join(HERE, '..'))
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 2, 15, 0, tzinfo=UTC)
FAILS = []


def H(h):
    return NOW - dt.timedelta(hours=h)


def check(name, cond, got=None):
    if not cond:
        FAILS.append(f'{name}' + (f' -- got {got!r}'[:400] if got is not None else ''))


def load(src=None):
    spec = importlib.util.spec_from_file_location('promomerge_t', SRC_PATH)
    m = importlib.util.module_from_spec(spec)
    if src is None:
        spec.loader.exec_module(m)
    else:
        exec(compile(src, SRC_PATH, 'exec'), m.__dict__)
    return m


def code(path):
    return '\n'.join(l for l in open(path).read().splitlines() if not l.lstrip().startswith('#'))


def jl(*rows):
    return '\n'.join(json.dumps(r) for r in rows) + '\nnot json\n'


# --------------------------------------------------------------------------------------------------------------- unit --
def t_promotions(S):
    txt = jl({'ts': '2026-11-01T23:47:06Z', 'run': 'fleetbuild-01', 'phase': 'promoted', 'note': 'c' * 40 + ' fleet-wide'},
             {'ts': '2026-11-01T20:15:19Z', 'run': 'apseal-01', 'phase': 'promoted', 'note': 'a' * 40 + ' fleet-wide'},
             {'ts': '2026-11-01T20:05:00Z', 'run': 'apseal-01', 'phase': 'recorded', 'note': 'KEEP'},
             {'ts': '2026-10-01T00:00:00Z', 'run': 'old-01', 'phase': 'promoted', 'note': 'b' * 40},
             {'ts': '2026-11-01T10:00:00Z', 'run': 'odd', 'phase': 'promoted', 'note': 'not-a-sha'})
    p = S.promotions(txt, NOW)
    check('promotions: the two recent promoted rows, oldest first', [x[0] for x in p] == ['apseal-01', 'fleetbuild-01'], p)
    check('promotions: the sha is the note\'s first token', p and p[-1][1] == 'c' * 40, p)
    check('pick_target: the newest', S.pick_target(p)[0] == 'fleetbuild-01' and S.pick_target([]) is None)


def t_should_attempt(S):
    M1, M2 = '1' * 40, '2' * 40
    check('attempt: never tried', S.should_attempt(None, M1, NOW))
    for st in ('conflict', 'syntax', 'testfail'):
        check(f'no retry: {st} on the same main', not S.should_attempt({'status': st, 'main': M1, 'at': S.iso(H(5))}, M1, NOW))
        check(f'no retry yet: {st}, main moved minutes ago', not S.should_attempt({'status': st, 'main': M1, 'at': S.iso(H(0.2))}, M2, NOW))
        check(f'retry: {st}, main moved, an hour later', S.should_attempt({'status': st, 'main': M1, 'at': S.iso(H(2))}, M2, NOW))
    for st in ('ci-error', 'ci-busy', 'stale-main'):
        check(f'retry: {st}', S.should_attempt({'status': st, 'main': M1, 'at': S.iso(H(0.1))}, M1, NOW))


def t_parse_and_triage(S):
    out = 'x\nFAILED (2): a.test.mjs b.test.mjs\n396/398 files passed\n'
    check('parse_suite: completed, two failed', S.parse_suite(out) == (True, ['a.test.mjs', 'b.test.mjs']), S.parse_suite(out))
    check('parse_suite: green', S.parse_suite('398/398 files passed\n') == (True, []))
    check('parse_suite: no summary line = not completed', S.parse_suite('FAILED (1): a.test.mjs\n')[0] is False)
    tr = S.triage(['f.mjs', 'p.mjs', 'q.mjs', 'h.mjs', 'n.mjs', 'e.mjs'],
                  {'f.mjs': ['fail', 'pass'], 'p.mjs': ['fail', 'fail'], 'q.mjs': ['fail', 'fail'], 'h.mjs': ['fail', 'fail'],
                   'n.mjs': ['fail', 'fail'], 'e.mjs': ['fail', 'fail']},
                  {'p.mjs': ['fail'], 'q.mjs': ['pass'], 'h.mjs': ['pass'], 'n.mjs': ['absent'], 'e.mjs': ['error']},
                  {'p.mjs': ['pass'], 'q.mjs': ['fail'], 'h.mjs': ['pass'], 'n.mjs': ['pass'], 'e.mjs': ['error']})
    check('triage: flake / pre-existing on main / on the fleet / hard / new test absent on main / broken base runs',
          tr == {'flake': ['f.mjs'], 'preexisting': ['p.mjs', 'q.mjs'], 'hard': ['h.mjs', 'n.mjs', 'e.mjs']}, tr)
    check('triage: no base runs recorded = not proof of pre-existing', S.triage(['z'], {'z': ['fail']}, {}, {})['hard'] == ['z'])
    fail_out = ('FAILING DETAIL\n\n--- a.test.mjs (exit 1) ---\n  FAIL x\n\nslowest files:\n  1ms a.test.mjs\n'
                'FAILED (1): a.test.mjs\n0/1 files passed\n')
    tout = ('FAILING DETAIL\n\n--- a.test.mjs (exit signal SIGKILL) ---\n  PASS y\n[killed: timeout]\n\nslowest files:\n'
            'FAILED (1): a.test.mjs\n0/1 files passed\n')
    check('alone_result: a completed failure is a confirmed fail', S.alone_result(fail_out, 'a.test.mjs') == 'fail')
    check('alone_result: a runner timeout is an error (Codex r2)', S.alone_result(tout, 'a.test.mjs') == 'error')
    check('alone_result: pass / absent / no summary',
          S.alone_result('1/1 files passed\n', 'a.test.mjs') == 'pass' and S.alone_result('', 'a.test.mjs', False) == 'absent'
          and S.alone_result('FAILED (1): a.test.mjs\n', 'a.test.mjs') == 'error')
    check('alone_result: a failure with no detail block is not confirmed',
          S.alone_result('FAILED (1): a.test.mjs\n0/1 files passed\n', 'a.test.mjs') == 'error')
    check('push_safe_without_retest: Markdown under docs/ added or modified',
          S.push_safe_without_retest([('M', 'docs/reports/STATE.md'), ('A', 'docs/reports/x-2026-11-02.md')]))
    check('push_safe_without_retest: scripts/ or config/ re-tests (the suite runs them)',
          not S.push_safe_without_retest([('M', 'docs/a.md'), ('M', 'scripts/host/stallcheck.py')])
          and not S.push_safe_without_retest([('M', 'config/monitors.json')]))
    check('push_safe_without_retest: a deleted doc or a bots/ path re-tests',
          not S.push_safe_without_retest([('D', 'docs/reports/a.md')]) and not S.push_safe_without_retest([('M', 'bots/src/skills.mjs')]))
    check('push_safe_without_retest: nothing listed is not a licence', not S.push_safe_without_retest([]))


def t_alarms(S):
    pend = [('a-01', 'a' * 40, H(1)), ('b-01', 'b' * 40, H(1)), ('c-01', 'c' * 40, H(1)), ('d-01', 'd' * 40, H(5)), ('e-01', 'e' * 40, H(1))]
    st = {'attempts': {'a' * 40: {'status': 'conflict', 'files': ['bots/src/skills.mjs']},
                       'b' * 40: {'status': 'testfail', 'hard': ['x.test.mjs']}, 'c' * 40: {'status': 'syntax', 'files': ['p.mjs']},
                       'd' * 40: {'status': 'ci-busy', 'at': S.iso(H(1))}, 'e' * 40: {'status': 'ci-busy'}}}
    al = S.alarms_for(st, pend, [('m-01', 'f' * 40, H(2)), ('n-01', '9' * 40, H(0.2))], NOW)
    check('alarms: conflict, testfail, syntax, pending > 3 h, missing > 1 h', sorted(al) == sorted(
        ['conflict:aaaaaaaa', 'testfail:bbbbbbbb', 'syntax:cccccccc', 'pending:dddddddd', 'missing:ffffffff']), sorted(al))
    check('alarms: the conflict line names its files', 'bots/src/skills.mjs' in al.get('conflict:aaaaaaaa', ''), al)
    check('alarms: quiet when main carries everything', S.alarms_for(st, [], [], NOW) == {})
    check('summary: all carried', 'main carries all 3' in S.summary_line({}, [], 3))


def t_carried(S):
    d3 = ('a\n<<<<<<< main\nimport tidy\nimport store\n||||||| base\n=======\nimport tidy\n>>>>>>> fleet\nb\n'
          '<<<<<<< main\nx = [tidy, store]\n||||||| base\nx = []\n=======\nx = [tidy]\n>>>>>>> fleet\n')
    ok, res = S.hunks_carried(d3)
    check('hunks_carried: a fleet side made of main lines is carried; main side kept', ok and res == 'a\nimport tidy\nimport store\nb\nx = [tidy, store]\n', (ok, res))
    d3b = d3 + '<<<<<<< main\nimport store\n||||||| base\n=======\nimport tidy\n>>>>>>> fleet\n'
    check('hunks_carried: one fleet line main lacks -> not carried', S.hunks_carried(d3b)[0] is False)
    d3c = '<<<<<<< main\nB\nA\n||||||| base\n=======\nA\nB\n>>>>>>> fleet\n'
    check('hunks_carried: order matters (a subsequence, not a set)', S.hunks_carried(d3c)[0] is False)
    d3d = '<<<<<<< main\nif (!x) y()\n||||||| base\nif (!x)\n=======\nif (x)\n>>>>>>> fleet\n'
    check('hunks_carried: a fleet DELETION main still has is not carried', S.hunks_carried(d3d)[0] is False)
    d3e = '<<<<<<< main\nif (x) y()\n||||||| base\nif (!x)\n=======\nif (x)\n>>>>>>> fleet\n'
    check('hunks_carried: a deletion main made too is carried', S.hunks_carried(d3e)[0] is True)
    d3f = '<<<<<<< main\n// enableSafety();\n||||||| base\n=======\nenableSafety();\n>>>>>>> fleet\n'
    check('hunks_carried: main\'s COMMENT does not carry the fleet\'s call (Codex r1)', S.hunks_carried(d3f)[0] is False)
    d3g = '<<<<<<< main\nlog("enableSafety();")\n||||||| base\n=======\nenableSafety();\n>>>>>>> fleet\n'
    check('hunks_carried: a string spelling it does not carry it', S.hunks_carried(d3g)[0] is False)
    d3h = '<<<<<<< main\n# enable_safety()\n||||||| base\n=======\nenable_safety()\n>>>>>>> fleet\n'
    check('hunks_carried: a Python comment does not carry a call', S.hunks_carried(d3h, hash_comments=True)[0] is False)
    check('code_tokens: a // inside a string stays in the string', S.code_tokens('u = "http://x" // c') == ['u', '=', '"http://x"'])
    check('hunks_carried: no conflict = carried, text unchanged', S.hunks_carried('a\nb\n') == (True, 'a\nb\n'))
    anc = {('p1', 's'), ('p1', 'm'), ('p0', 's'), ('p0', 'm'), ('p2', 's')}
    promos = [('r0', 'p0', 1), ('r1', 'p1', 2), ('r2', 'p2', 3), ('rs', 's', 4)]
    check('pick_prev: the newest earlier promotion main also carries', S.pick_prev(promos, 's', lambda a, b: (a, b) in anc, 'm') == 'p1')
    check('pick_prev: none', S.pick_prev(promos, 's', lambda a, b: False, 'm') is None)


TESTS = [t_promotions, t_should_attempt, t_parse_and_triage, t_alarms, t_carried]


# ------------------------------------------------------------------------------------------------------- end to end --
def sh(cwd, *a):
    p = subprocess.run(list(a), cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f'{a} -> {p.stderr}')
    return p.stdout.strip()


def commit(repo, path, text, msg):
    os.makedirs(os.path.dirname(os.path.join(repo, path)), exist_ok=True)
    open(os.path.join(repo, path), 'w').write(text)
    sh(repo, 'git', 'add', path)
    sh(repo, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
    return sh(repo, 'git', 'rev-parse', 'HEAD')


def t_end_to_end():
    S = load()
    d = tempfile.mkdtemp()
    try:
        env_keep = {k: os.environ.get(k) for k in ('GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL')}
        os.environ.update(GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
        origin, work, scratch = (os.path.join(d, x) for x in ('origin.git', 'work', 'scratch'))
        sh(d, 'git', 'init', '-q', '--bare', '-b', 'main', origin)
        sh(d, 'git', 'clone', '-q', origin, work)
        sh(work, 'git', 'checkout', '-q', '-b', 'main')
        base = commit(work, 'bots/src/a.mjs', 'export const a = 1\n', 'base')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        sh(work, 'git', 'checkout', '-q', '-b', 'fleet')
        fleet = commit(work, 'bots/src/b.mjs', 'export const b = 2\n', 'fleet: b')
        sh(work, 'git', 'push', '-q', 'origin', 'fleet')
        sh(work, 'git', 'checkout', '-q', 'main')
        m1 = commit(work, 'docs/x.md', 'x\n', 'main: docs')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        sh(d, 'git', 'clone', '-q', origin, scratch)
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        ok, files = S.merge_onto(scratch, m1, 'fleet-01', fleet)
        check('e2e: a clean merge', ok and files == [], files)
        merge = sh(scratch, 'git', 'rev-parse', 'HEAD')
        check('e2e: the merge has main first, the promotion second',
              sh(scratch, 'git', 'rev-list', '--parents', '-n', '1', merge).split()[1:] == [m1, fleet])
        check('e2e: node --check passes on clean code', S.syntax_errors(scratch, m1, fleet) == [])
        # main moves with a docs-only commit while "the suite ran": the push is refused, re-merged, pushed untested
        sh(work, 'git', 'checkout', '-q', 'main')
        m2 = commit(work, 'docs/y.md', 'y\n', 'main: more docs')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        st = {}
        r = S._push(scratch, 'fleet-01', fleet, m1, merge, st, NOW)
        on = sh(work, 'git', 'ls-remote', origin, 'refs/heads/main').split()[0]
        check('e2e: pushed after a docs-only main move', r.get('status') == 'pushed' and st.get('last_pushed'), r)
        check('e2e: origin/main now carries the promotion and the docs move',
              subprocess.run(['git', '-C', scratch, 'merge-base', '--is-ancestor', fleet, on]).returncode == 0
              and subprocess.run(['git', '-C', scratch, 'merge-base', '--is-ancestor', m2, on]).returncode == 0, (on, r))
        # a second promotion; main moves under bots/ meanwhile: no untested push
        sh(work, 'git', 'fetch', '-q', 'origin')
        sh(work, 'git', 'checkout', '-q', 'fleet')
        fleet2 = commit(work, 'bots/src/c.mjs', 'export const c = 3\n', 'fleet: c')
        sh(work, 'git', 'push', '-q', 'origin', 'fleet')
        sh(work, 'git', 'checkout', '-q', 'main')
        sh(work, 'git', 'reset', '-q', '--hard', 'origin/main')
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        m3 = sh(scratch, 'git', 'rev-parse', 'origin/main')
        ok, _ = S.merge_onto(scratch, m3, 'fleet-02', fleet2)
        commit(work, 'bots/src/a.mjs', 'export const a = 10\n', 'main: bots change')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        r = S._push(scratch, 'fleet-02', fleet2, m3, sh(scratch, 'git', 'rev-parse', 'HEAD'), {}, NOW)
        check('e2e: main moved under bots/ -> stale-main, nothing pushed', ok and r.get('status') == 'stale-main', r)
        commit(work, 'scripts/host/x.py', 'x = 1\n', 'main: scripts change')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        m3b = sh(scratch, 'git', 'rev-parse', 'origin/main')
        ok, _ = S.merge_onto(scratch, m3b, 'fleet-02', fleet2)
        commit(work, 'scripts/host/y.py', 'y = 1\n', 'main: another scripts change')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        r = S._push(scratch, 'fleet-02', fleet2, m3b, sh(scratch, 'git', 'rev-parse', 'HEAD'), {}, NOW)
        check('e2e: main moved under scripts/ -> stale-main too (Codex r1)', ok and r.get('status') == 'stale-main', r)
        # a conflict: the fleet and main edit the same line
        sh(work, 'git', 'checkout', '-q', 'fleet')
        fleet3 = commit(work, 'bots/src/a.mjs', 'export const a = 99\n', 'fleet: a')
        sh(work, 'git', 'push', '-q', 'origin', 'fleet')
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        m4 = sh(scratch, 'git', 'rev-parse', 'origin/main')
        ok, files = S.merge_onto(scratch, m4, 'fleet-03', fleet3)
        check('e2e: a conflict is reported with its files', not ok and files == ['bots/src/a.mjs'], (ok, files))
        check('e2e: the conflicted merge was aborted (clean tree)', sh(scratch, 'git', 'status', '--porcelain') == '')
        # a syntax error in a clean merge
        sh(work, 'git', 'checkout', '-q', 'fleet')
        sh(work, 'git', 'reset', '-q', '--hard', fleet2)
        fleet4 = commit(work, 'bots/src/d.mjs', 'export const d = (\n', 'fleet: broken')
        sh(work, 'git', 'push', '-q', '-f', 'origin', 'fleet')
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        ok, _ = S.merge_onto(scratch, m4, 'fleet-04', fleet4)
        check('e2e: node --check catches a broken file in the merge', ok and S.syntax_errors(scratch, m4, fleet4) == ['bots/src/d.mjs'])
        check('positive control: base sha resolves', len(base) == 40)
        # MAIN-FIRST: a feature lands on main (with main's own extra line), then its fleet variant is promoted on top of the last
        # promotion main carries -> conflict, carried_by_main, an ancestry-only merge pushed with main's tree unchanged
        sh(work, 'git', 'fetch', '-q', 'origin')
        sh(work, 'git', 'checkout', '-q', 'main'); sh(work, 'git', 'reset', '-q', '--hard', 'origin/main')
        sh(work, 'git', 'merge', '-q', '--no-ff', '-m', 'carry fleet2', fleet2); sh(work, 'git', 'push', '-q', 'origin', 'main')
        commit(work, 'bots/src/list.mjs', 'export const L = [\n  "tidy",\n  "store",\n]\n', 'main: tidy + store (main first)')
        sh(work, 'git', 'push', '-q', 'origin', 'main')
        sh(work, 'git', 'checkout', '-q', '-B', 'fleetv', fleet2)
        fv = commit(work, 'bots/src/list.mjs', 'export const L = [\n  "tidy",\n]\n', 'fleet variant: tidy')
        sh(work, 'git', 'push', '-q', 'origin', 'fleetv')
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        m5 = sh(scratch, 'git', 'rev-parse', 'origin/main')
        ok, files = S.merge_onto(scratch, m5, 'tidy-01', fv)
        check('e2e main-first: the plain merge conflicts', not ok and files == ['bots/src/list.mjs'], (ok, files))
        check('e2e main-first: main carries the variant (base = the previous promotion)', S.carried_by_main(scratch, m5, fv, fleet2) == (True, ''))
        check('e2e main-first: a variant line main lacks is NOT carried', S.carried_by_main(scratch, m5, fleet3, fleet2)[0] is False)
        sh(work, 'git', 'checkout', '-q', '-B', 'fleetx', fv)
        os.chmod(os.path.join(work, 'bots/src/list.mjs'), 0o755)
        sh(work, 'git', 'add', 'bots/src/list.mjs')
        sh(work, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fleet: +x')
        fx = sh(work, 'git', 'rev-parse', 'HEAD'); sh(work, 'git', 'push', '-q', 'origin', 'fleetx')
        sh(work, 'git', 'checkout', '-q', '-B', 'fleets', fleet2)
        fs_ = commit(work, 'bots/src/new feature.mjs', 'export const n = 1\n', 'fleet: a path with a space')
        sh(work, 'git', 'push', '-q', 'origin', 'fleets')
        sh(scratch, 'git', 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
        check('e2e: a mode change main lacks is NOT carried (Codex r1)', S.carried_by_main(scratch, m5, fx, fleet2)[0] is False)
        check('e2e: a new file whose path has a space is NOT carried (Codex r1)', S.carried_by_main(scratch, m5, fs_, fleet2) == (False, 'bots/src/new feature.mjs'))
        ok, _ = S.merge_ours(scratch, m5, 'tidy-01', fv)
        r = S._push(scratch, 'tidy-01', fv, m5, sh(scratch, 'git', 'rev-parse', 'HEAD'), {}, NOW, tree_is_main=True)
        on = sh(work, 'git', 'ls-remote', origin, 'refs/heads/main').split()[0]
        check('e2e main-first: pushed; main now has the promotion as an ancestor and its own tree',
              ok and r.get('status') == 'pushed' and subprocess.run(['git', '-C', scratch, 'merge-base', '--is-ancestor', fv, on]).returncode == 0
              and sh(scratch, 'git', 'diff', m5, on) == '', r)
        for k, v in env_keep.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    finally:
        shutil.rmtree(d, ignore_errors=True)


def t_wiring():
    pm = code(SRC_PATH)
    check('publish raises through lib/alarm.py with its own dedup state',
          re.search(r"AL\.raise_alarms\('promomerge', active, now, '~/digest/promomerge-alarm-state\.json'", pm) is not None)
    check('publish writes the header file', "'~/digest/promomerge-fleet.json'" in pm)
    check('the push is never forced', re.search(r"'push', '-q', 'origin', 'HEAD:refs/heads/main'", pm) is not None
          and not re.search(r"push[^\n]*(--force|'-f')", pm))
    check('the suite runs niced on the test host', re.search(r"\['nice', '-n', '19', 'node', 'scripts/run-tests\.mjs'\]", pm) is not None)
    from lib import alarmhead
    check('alarmhead prints promomerge-fleet.json in the fleetstatus header',
          any(f[0] == 'promomerge-fleet.json' for f in alarmhead.FILES), alarmhead.FILES)
    mac = code(os.path.join(ROOT, 'scripts/mac/promomerge.sh'))
    check('the Mac wrapper runs `promomerge.py tick`', re.search(r'promomerge\.py" tick', mac) is not None)
    check('the Mac wrapper installs a 15-min LaunchAgent', 'com.mcai.promomerge' in mac and '<integer>900</integer>' in mac)
    inst = code(os.path.join(ROOT, 'scripts/host/install-promomerge.sh'))
    check('the .31 installer copies promomerge.py and lib/alarm.py', 'promomerge.py' in inst and 'lib/alarm.py' in inst)
    check('the .31 installer never touches canary-sched or flock', 'canary-sched' not in inst and 'flock' not in inst)
    reg = json.load(open(os.path.join(ROOT, 'config/monitors.json')))['monitors']
    row = [r for r in reg if r.get('id') == 'promomerge']
    check('monitors.json registers promomerge with a consumer', row and (row[0].get('consumer') or '').strip(), row)


# ------------------------------------------------------------------------------------------------------------ mutants --
MUTANTS = [
    ('no retry on the same main', "return entry.get('main') != main and (t is None or hours(now, t) >= retry_h)", "return True"),
    ('the newest target', "return pending[-1] if pending else None", "return pending[0] if pending else None"),
    ('triage flake', "if 'pass' in (alone_merge.get(f) or []):", "if False:"),
    ('triage pre-existing', "elif 'fail' in (alone_main.get(f) or []) or 'fail' in (alone_fleet.get(f) or []):", "elif False:"),
    ('triage confirmed fail only', "elif 'fail' in (alone_main.get(f) or []) or 'fail' in (alone_fleet.get(f) or []):",
     "elif set(alone_main.get(f) or []) - {'pass'} or set(alone_fleet.get(f) or []) - {'pass'}:"),
    ('untested push allowlist', "all(st[:1] in ('A', 'M') and p.startswith('docs/') and p.endswith('.md') for st, p in changes)",
     "all(not p.startswith('bots/') for st, p in changes)"),
    ('conflict alarm', "if st == 'conflict':", "if False:"),
    ('pending alarm threshold', "elif hours(now, t) > PENDING_ALARM_H:", "elif False:"),
    ('missing alarm', "if hours(now, t) > MISSING_GRACE_H:", "if False:"),
    ('timeout is not a confirmed fail', "if not m or m.group(1).startswith('signal') or '[killed: timeout]' in m.group(2):",
     "if not m:"),
    ('carried needs a subsequence', "        if not all(any(x == y for y in it) for x in tt):", "        if False:"),
    ('comments are not code', "if not m.group('c')]", "]"),
    ('carried needs the deletions', "        if any(cm[k] > ct[k] for k, n in Counter(tb).items() if n > ct[k]):", "        if False:"),
    ('suite completion', "return bool(PASSED_LINE.search(text)), failed", "return True, failed"),
]


def run_unit(S):
    global FAILS
    saved, FAILS = FAILS, []
    for t in TESTS:
        try:
            t(S)
        except Exception as e:      # noqa: BLE001
            FAILS.append(f'{t.__name__} raised {type(e).__name__}: {e}')
    got, FAILS = FAILS, saved
    return got


def main():
    S = load()
    FAILS.extend(run_unit(S))
    for t in (t_end_to_end, t_wiring):
        try:
            t()
        except Exception as e:      # noqa: BLE001
            FAILS.append(f'{t.__name__} raised {type(e).__name__}: {e}')
    src = open(SRC_PATH).read()
    killed = 0
    for name, old, new in MUTANTS:
        assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {name}'
        if run_unit(load(src.replace(old, new))):
            killed += 1
        else:
            FAILS.append(f'MUTANT SURVIVED: {name}')
    for f in FAILS:
        print('FAIL', f)
    print(f'promomerge tests: {len(TESTS)} unit groups + e2e + wiring; mutants killed {killed}/{len(MUTANTS)}; '
          f'{"FAIL" if FAILS else "PASS"} ({len(FAILS)} failure(s))')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
