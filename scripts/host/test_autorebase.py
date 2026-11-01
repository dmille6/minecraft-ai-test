#!/usr/bin/env python3
"""test_autorebase.py [--mutants] -- behaviour tests for canary-sched.py's AUTOREBASE (v39), on test_canary_sched.py's
fixture tree plus: a bare `origin`, real commits with files (a source base SB, the reviewed change ST on it, a live fleet
base LB per scenario), the real scripts/lib/protected.py, and a STUB npm (ci / run lint / run lint:movement / test).
Each scenario seeds a queue whose head has a variant only for SB, declares the patch with `queue set-patch`, runs a real
`tick` (which starts the real background `autorebase-build`), waits for the job, then ticks again:

  clean       the pick applies, the diff is identical, tests pass  -> a variant for LB is queued, the next tick LAUNCHES it
  conflict    LB edits the changed line                           -> refused at the cherry-pick, the head BLOCKED, paged
  diffchange  LB edits a line inside the change's context         -> the pick is clean, the diff differs: refused
  failtest    a test the change breaks fails in full and alone    -> refused at npm test
  tier        LB lists the changed file as protected              -> refused: tier none -> 3
  baseflake   a test fails on the new tip AND on the base         -> accepted, named in the registration
and that a refused job is never retried by a later tick.

--mutants: each mutant edits ONE anchored line (asserted present and UNIQUE first), and must make a scenario fail.
"""
import os, sys, json, shutil, subprocess, time, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'canary-sched.py')
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
PROTECTED_PY = next(p for p in (os.path.join(REPO, 'scripts', 'lib', 'protected.py'), os.path.join(HERE, 'protected.py'))
                    if os.path.exists(p))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


TC = load(os.path.join(HERE, 'test_canary_sched.py'), 'tcs_for_autorebase')
NOW = TC.NOW


def sh(*a, cwd=None):
    return subprocess.run(list(a), cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def gc(cwd, *a):
    return sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a, cwd=cwd)


A_LINES = ['export const a%d = %d' % (i, i) for i in range(1, 21)]

NPM_STUB = r'''#!/bin/bash
# stub npm: ci | run lint | run lint:movement | test [-- file]. FIX_NPM_TEST=change: a.test.mjs fails where the change
# is present; =base: it fails everywhere (a host flake that the base has too).
changed() { grep -q 'CHANGED' src/a.mjs; }
case "$1" in
  ci) exit 0;;
  run) [ "$2" = lint ] && exit "${FIX_LINT:-0}"; echo "movement-writers: ok"; exit 0;;
  test)
    f="${3:-}"
    afail=0
    if [ "${FIX_NPM_TEST:-}" = change ] && changed; then afail=1; fi
    if [ "${FIX_NPM_TEST:-}" = base ]; then afail=1; fi
    if [ -n "$f" ]; then
      if [ "$f" = a.test.mjs ] && [ $afail = 1 ]; then echo "FAIL a.test.mjs  9ms  [1/1]"; echo "0/1 files passed"; exit 1; fi
      echo "ok   $f  1ms  [1/1]"; echo "1/1 files passed"; exit 0
    fi
    if [ $afail = 1 ]; then echo "FAIL a.test.mjs  9ms  [1/2]"; else echo "ok   a.test.mjs  9ms  [1/2]"; fi
    echo "ok   b.test.mjs  1ms  [2/2]"
    exit $afail;;
esac
exit 0
'''


class ArFix(TC.Fix):
    def __init__(self, scenario):
        super().__init__()
        d, g = self.d, self.git
        self.scenario = scenario
        self.origin = os.path.join(d, 'origin.git')
        sh('git', 'init', '-q', '--bare', self.origin)
        self.ar = os.path.join(d, 'ar')
        self.npm = os.path.join(d, 'npm')
        open(self.npm, 'w').write(NPM_STUB); os.chmod(self.npm, 0o755)
        # SB: a tree with bots/src/a.mjs, b.mjs, the real protected.py and an empty protected list
        gc(g, 'checkout', '-q', '--detach', self.base)
        for rel, body in (('bots/src/a.mjs', '\n'.join(A_LINES) + '\n'), ('bots/src/b.mjs', 'export const b = 1\n'),
                          ('config/protected-paths.txt', 'bots/src/zzz-not-in-the-change.mjs\n')):
            os.makedirs(os.path.join(g, os.path.dirname(rel)), exist_ok=True)
            open(os.path.join(g, rel), 'w').write(body)
        os.makedirs(os.path.join(g, 'scripts', 'lib'), exist_ok=True)
        shutil.copy(PROTECTED_PY, os.path.join(g, 'scripts', 'lib', 'protected.py'))
        gc(g, 'add', '-A'); gc(g, 'commit', '-q', '-m', 'SB')
        self.sb = sh('git', 'rev-parse', 'HEAD', cwd=g)
        # ST: the reviewed change -- line 5 of a.mjs
        self.edit_a({4: 'export const a5 = 55 // CHANGED'})
        gc(g, 'commit', '-q', '-am', 'ST: the change')
        self.st = sh('git', 'rev-parse', 'HEAD', cwd=g)
        # LB: the live fleet base, on SB
        gc(g, 'checkout', '-q', '--detach', self.sb)
        if scenario == 'conflict':
            self.edit_a({4: 'export const a5 = 5000'})
        elif scenario == 'diffchange':
            self.edit_a({6: 'export const a7 = 7000'})        # line 7: inside the change's 3-line context, not adjacent
        elif scenario == 'tier':
            open(os.path.join(g, 'config', 'protected-paths.txt'), 'w').write('bots/src/zzz-not-in-the-change.mjs\nbots/src/a.mjs\n')
        else:
            open(os.path.join(g, 'bots', 'src', 'b.mjs'), 'w').write('export const b = 2\n')
        gc(g, 'commit', '-q', '-am', 'LB: the fleet moved on (%s)' % scenario)
        self.lb = sh('git', 'rev-parse', 'HEAD', cwd=g)
        for name, sha in (('sb', self.sb), ('st', self.st), ('lb', self.lb)):
            gc(g, 'push', '-q', self.origin, '%s:refs/heads/%s' % (sha, name))
        gc(g, 'remote', 'add', 'origin', self.origin)
        # the fleet runs LB
        self.base = self.lb
        self.set_manifest()
        for b in TC.BOTS:
            self.log(b, NOW, self.lb[:7] + '+abc123')
        # the queued entry: one variant, on SB, canary ST
        self.write_reg({'sha': self.st, 'reads': ['fooread', 'immobiledid'], 'read_minutes': [180, 360], 'notes': 'fixture'})
        self.entry = {'run': 'foo-01', 'class': '', 'after': [], 'not_before': None, 'hold': None,
                      'variants': {self.sb: {'registration': self.reg,
                                             'approved': 'test fixture: Claude APPROVE + Codex APPROVE'}}}

    def edit_a(self, repl):
        p = os.path.join(self.git, 'bots', 'src', 'a.mjs')
        cur = open(p).read().splitlines()
        for i, v in repl.items():
            cur[i] = v
        open(p, 'w').write('\n'.join(cur) + '\n')

    def env(self, **extra):
        e = super().env()
        fix = {'SCHED_AR_HOME': self.ar, 'SCHED_AR_ORIGIN': self.origin, 'SCHED_AR_PUSH': 'direct',
               'SCHED_AR_SUDO': '0', 'SCHED_AR_NPM': self.npm}
        if self.scenario == 'failtest':
            fix['FIX_NPM_TEST'] = 'change'
        if self.scenario == 'baseflake':
            fix['FIX_NPM_TEST'] = 'base'
        e.update(fix)
        e.update(extra)
        return e

    def job(self):
        p = os.path.join(self.ar, 'jobs')
        js = [os.path.join(p, f) for f in sorted(os.listdir(p)) if f.endswith('.json')] if os.path.isdir(p) else []
        return [json.load(open(x)) for x in js]

    def wait_job(self, timeout=120):
        t = time.time() + timeout
        while time.time() < t:
            js = self.job()
            if js and js[-1].get('state') in ('done', 'refused'):
                return js[-1]
            time.sleep(0.2)
        raise AssertionError('autorebase job did not finish: %s; log: %s' % (self.job(), self.logtail()))

    def logtail(self):
        d = os.path.join(self.ar, 'logs')
        return ' | '.join(open(os.path.join(d, f)).read()[-800:] for f in sorted(os.listdir(d))) if os.path.isdir(d) else ''

    def pages(self):
        p = os.path.join(self.home, 'digest', 'page.jsonl')
        return [json.loads(l) for l in open(p)] if os.path.exists(p) else []

    def states(self):
        p = os.path.join(self.home, 'digest', 'sched-state.jsonl')
        return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def seed(CS, F):
    F.enqueue(CS)
    rc, out = TC.human(CS, F, 'queue', 'set-patch', 'foo-01', F.sb, 'foo-on-sb')
    assert rc == 0, out
    q = json.load(open(F.queue))
    assert q['entries'][0]['patch']['tip'] == F.st, q
    d, _ = TC.decision(CS, F)
    assert d[0] == 'wait' and any(c == 'H2' and 'will cherry-pick' in r for c, r in d[1]), d


def tick_and_wait(CS, F):
    rc, out = TC.human(CS, F, 'tick')
    assert rc == 0 and 'AUTOREBASE foo-01' in out, out
    return F.wait_job()


def assert_blocked_no_retry(CS, F, job, step_word, why_word):
    assert job['state'] == 'refused', job
    assert why_word in job['why'], (why_word, job['why'])
    assert any(s['step'] == step_word for s in job['steps']), (step_word, [s['step'] for s in job['steps']])
    q = json.load(open(F.queue))
    assert set(q['entries'][0]['variants']) == {F.sb}, 'a refused build must add no variant'
    d, _ = TC.decision(CS, F)
    assert d[0] == 'block' and any(c == 'H2' and 'REFUSED' in r and why_word in r for c, r in d[1]), d
    assert any('autorebase' in p.get('msg', '') and 'BLOCKED' in p.get('msg', '') for p in F.pages()), F.pages()
    n0 = len([s for s in F.states() if s.get('state') == 'autorebase' and s.get('step') == 'start'])
    rc, out = TC.human(CS, F, 'tick')                  # a later tick: blocked, pages, and does NOT start again
    assert rc == 0 and 'AUTOREBASE' not in out and 'BLOCK' in out, out
    n1 = len([s for s in F.states() if s.get('state') == 'autorebase' and s.get('step') == 'start'])
    assert n0 == n1 == 1, (n0, n1)
    assert len(F.job()) == 1


# ------------------------------------------------------------------------------------------------------- tests --
def t_clean_builds_and_launches(CS):
    F = ArFix('clean')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        assert any(x['step'] == 'tier' and 'tier none' in x['detail'] for x in job['steps']), job['steps']
        nt = job['variant']
        q = json.load(open(F.queue))
        v = q['entries'][0]['variants'].get(F.lb)
        assert v and v['canary_sha'] == nt, q
        assert 'AUTOREBASE' in v['approved'] and 'Claude' in v['approved']
        assert sh('git', 'ls-remote', F.origin, 'refs/heads/autorebase/foo-01-on-%s' % F.lb[:8]).split()[0] == nt
        assert sh('git', 'merge-base', '--is-ancestor', F.lb, nt, cwd=F.git) == ''
        reg = json.load(open(v['registration']))
        assert reg['sha'] == nt and reg['notes'].startswith('[AUTOREBASE]'), reg
        TC.expect(CS, F, 'launch')
        rc, out = TC.human(CS, F, 'tick')
        assert rc == 0 and 'LAUNCH foo-01' in out, out
        la = [s for s in F.states() if s.get('state') == 'launching']
        assert la and la[-1]['canary_sha'] == nt and la[-1]['base'] == F.lb, la
        assert any(s.get('step') == 'variant' and s.get('ok') for s in F.states() if s.get('state') == 'autorebase')
        assert not os.path.exists(os.path.join(F.ar, 'work', 'foo-01--%s' % F.lb[:8])), 'worktree left behind'
    finally:
        F.cleanup()


def t_conflict_pages_and_blocks(CS):
    F = ArFix('conflict')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert_blocked_no_retry(CS, F, job, 'worktree', 'does not apply cleanly')
        assert 'bots/src/a.mjs' in job['why'], job['why']
    finally:
        F.cleanup()


def t_diff_change_refuses(CS):
    F = ArFix('diffchange')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert any(s['step'] == 'cherry-pick' and s['ok'] for s in job['steps']), 'the pick must have been clean'
        assert_blocked_no_retry(CS, F, job, 'cherry-pick', 'NOT the reviewed diff')
    finally:
        F.cleanup()


def t_failing_test_refuses(CS):
    F = ArFix('failtest')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert_blocked_no_retry(CS, F, job, 'lint', 'npm test')
        assert 'a.test.mjs' in job['why'] and 'NOT on the base' in job['why'], job['why']
    finally:
        F.cleanup()


def t_tier_change_refuses(CS):
    F = ArFix('tier')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert_blocked_no_retry(CS, F, job, 'diff-identical', 'tier changed')
        assert 'none on the source base, 3 on' in job['why'], job['why']
    finally:
        F.cleanup()


def t_base_flake_accepted_and_named(CS):
    F = ArFix('baseflake')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', job
        assert 'BASE too' in job['tests'] and 'a.test.mjs' in job['tests'], job['tests']
        reg = json.load(open(job['registration']))
        assert 'BASE too' in reg['notes']
    finally:
        F.cleanup()


def t_no_patch_blocks_like_before(CS):
    F = ArFix('clean')
    try:
        F.enqueue(CS)
        d, _ = TC.decision(CS, F)
        assert d[0] == 'block' and any(c == 'H2' and 'no patch source' in r for c, r in d[1]), d
        rc, out = TC.human(CS, F, 'tick')
        assert 'AUTOREBASE' not in out and not F.job(), out
    finally:
        F.cleanup()


def t_set_patch_refuses_merge_range(CS):
    F = ArFix('clean')
    try:
        g = F.git
        gc(g, 'checkout', '-q', '--detach', F.st)
        open(os.path.join(g, 'bots', 'src', 'c.mjs'), 'w').write('x\n'); gc(g, 'add', '-A'); gc(g, 'commit', '-q', '-m', 'c')
        gc(g, 'merge', '-q', '--no-ff', '-m', 'm', F.lb)
        m = sh('git', 'rev-parse', 'HEAD', cwd=g)
        F.write_reg({'sha': m, 'reads': ['fooread', 'immobiledid'], 'read_minutes': [180, 360]})
        F.enqueue(CS)
        rc, out = TC.human(CS, F, 'queue', 'set-patch', 'foo-01', F.sb)
        assert rc == 2 and 'merge commits' in out, out
    finally:
        F.cleanup()


def t_pure_verdict_and_norm(CS):
    v = CS.test_verdict
    assert v(0, {'a.test.mjs': 'ok'}, {}, {}, [])[0] == ''
    assert v(1, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'ok'}, {}, [])[0] == ''                       # load flake
    assert 'NOT on the base' in v(1, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'ok'}, [])[0]
    assert v(1, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'FAIL'}, [])[0] == ''
    assert 'touches' in v(1, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'FAIL'}, {'a.test.mjs': 'FAIL'},
                          ['bots/test/a.test.mjs'])[0]
    assert v(1, {}, {}, {}, [])[0]                                                                   # no results: refuse
    assert v(1, {'a.test.mjs': 'ok'}, {}, {}, [])[0]                                                 # rc 1, none named
    many = {'f%d.test.mjs' % i: 'FAIL' for i in range(7)}
    assert 'more than' in v(1, many, {}, {}, [])[0]
    a = 'diff --git a/x b/x\nindex 111..222 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@ fn\n a\n-b\n+c\n d\n'
    b = 'diff --git a/x b/x\nindex 333..444 100644\n--- a/x\n+++ b/x\n@@ -9,3 +9,3 @@ other\n a\n-b\n+c\n d\n'
    assert CS.norm_diff(a) == CS.norm_diff(b)
    assert CS.norm_diff(a) != CS.norm_diff(a.replace(' d\n', ' e\n'))                                  # context counts
    assert CS.movement_fails('x\nFAIL: a\n  src/a.mjs\n  src/b.mjs\n\nmore') == {'src/a.mjs', 'src/b.mjs'}
    assert CS.tier_label(1, 'hits\ntier=tooling\n') == 'tooling' and CS.tier_label(0, '') == 'none'
    assert CS.tier_label(2, '') == 'undecidable'


TESTS = [t_pure_verdict_and_norm, t_no_patch_blocks_like_before, t_set_patch_refuses_merge_range,
         t_clean_builds_and_launches, t_conflict_pages_and_blocks, t_diff_change_refuses, t_failing_test_refuses,
         t_tier_change_refuses, t_base_flake_accepted_and_named]

MUTANTS = [
    ('never starts a build', "    return ar_view(e, st)[2]\n", "    return False\n"),
    ('a conflicting pick is not refused', "    if rc != 0:\n        _, unmerged, _ = gitx(W, 'diff'",
     "    if False:\n        _, unmerged, _ = gitx(W, 'diff'"),
    ('a changed diff is not refused', "    if h1 != h0:\n", "    if False:\n"),
    ('a failing suite is not refused', "    if why:\n        raise ArRefuse('npm test", "    if False:\n        raise ArRefuse('npm test"),
    ('a tier change is not refused', "    if t0 != t1:\n", "    if False:\n"),
    ('a base-passing failure counts as a base failure', "    new_only = [f for f in still if alone_base.get(f) != 'FAIL']\n",
     "    new_only = []\n"),
    ('a refused job is retried', "    if job is None:\n        return ('autorebase will cherry-pick",
     "    if job is None or job.get('state') == 'refused':\n        return ('autorebase will cherry-pick"),
    ('the variant is not added', "        rc = cmd_queue(P, ['add-variant', run, base, regp, approved])\n",
     "        rc = 0\n"),
]


def run_suite(CS, only=None):
    fails = []
    for t in TESTS:
        if only and t.__name__ not in only:
            continue
        try:
            t(CS)
            if not only:
                print('PASS  %s' % t.__name__)
        except Exception as x:
            fails.append(t.__name__)
            if not only:
                print('FAIL  %s: %s' % (t.__name__, str(x)[:600]))
    return fails


def main():
    CS = load(SRC, 'cs_ar_under_test')
    if '--mutants' in sys.argv:
        import tempfile
        src = open(SRC).read()
        survived = []
        for name, old, new in MUTANTS:
            assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %s' % name
            d = tempfile.mkdtemp(prefix='ar-mut-')
            p = os.path.join(d, 'canary-sched.py')
            open(p, 'w').write(src.replace(old, new))
            M = load(p, 'cs_ar_mut_%d' % abs(hash(name)))
            fails = run_suite(M, only={t.__name__ for t in TESTS if t is not t_pure_verdict_and_norm} | {'t_pure_verdict_and_norm'})
            shutil.rmtree(d, ignore_errors=True)
            print('%s  mutant: %s (failing: %s)' % ('KILLED ' if fails else 'SURVIVED', name, ', '.join(fails) or '-'))
            if not fails:
                survived.append(name)
        print('\n%d/%d mutants killed' % (len(MUTANTS) - len(survived), len(MUTANTS)))
        return 1 if survived else 0
    fails = run_suite(CS)
    print('\n%d/%d tests pass' % (len(TESTS) - len(fails), len(TESTS)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
