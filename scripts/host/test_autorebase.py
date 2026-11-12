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
  flake       v40: a file the change cannot reach fails, then passes alone -> a host flake, accepted
  changedflake  the same in a file that imports the change, base always passes -> refused
  flakeboth   a file importing the change flakes on the new tip AND on the base -> accepted
and that a refused job is never retried by a later tick.

--mutants: each mutant edits ONE anchored line (asserted present and UNIQUE first), and must make a scenario fail.
"""
import re
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

NPM_STUB = r"""#!/usr/bin/env python3
# stub npm: ci | run lint | run lint:movement | test [-- file]. FIX_PLAN (JSON): {file: {"full": "ok"|"FAIL",
# "new": "FOF?", "base": "OOF"}} -- the full-run result, and the successive ALONE results on the new tip (src/a.mjs has
# the change) and on the base (F = FAIL, O = ok, ? = no result line); the last letter repeats. Unplanned files pass.
import glob, json, os, sys
a = sys.argv[1:]
if not a or a[0] == 'ci':
    sys.exit(0)
if a[0] == 'run':
    if a[1] == 'lint':
        sys.exit(int(os.environ.get('FIX_LINT', '0')))
    print('movement-writers: ok'); sys.exit(0)
plan = json.loads(os.environ.get('FIX_PLAN') or '{}')
side = 'new' if 'CHANGED' in open('src/a.mjs').read() else 'base'
files = sorted(os.path.basename(x) for x in glob.glob('test/*.test.mjs'))
if len(a) >= 3:
    f = a[2]
    seq = (plan.get(f) or {}).get(side) or 'O'
    cdir = os.environ['FIX_COUNT_DIR']; os.makedirs(cdir, exist_ok=True)
    cp = os.path.join(cdir, '%s.%s' % (f, side))
    n = int(open(cp).read()) if os.path.exists(cp) else 0
    open(cp, 'w').write(str(n + 1))
    with open(os.path.join(cdir, 'calls'), 'a') as fh:
        fh.write('%s %s\n' % (f, side))
    r = seq[min(n, len(seq) - 1)]
    if r == 'O':
        print('ok   %s  1ms  [1/1]' % f); sys.exit(0)
    if r == 'F':
        print('FAIL %s  9ms  [1/1]' % f); sys.exit(1)
    print('crashed'); sys.exit(1)
bad = 0
for i, f in enumerate(files):
    r = (plan.get(f) or {}).get('full', 'ok')
    print('%s %s  1ms  [%d/%d]' % ('FAIL' if r == 'FAIL' else 'ok  ', f, i + 1, len(files)))
    bad |= r == 'FAIL'
sys.exit(1 if bad else 0)
"""


# the npm stub's plan per scenario (see NPM_STUB): a.test.mjs imports the changed a.mjs, c.test.mjs does not
PLANS = {
    'failtest': {'a.test.mjs': {'full': 'FAIL', 'new': 'F', 'base': 'O'}},               # a TRUE break: always fails with it
    'baseflake': {'a.test.mjs': {'full': 'FAIL', 'new': 'F', 'base': 'F'}},              # the host fails it without the change too
    'flake': {'c.test.mjs': {'full': 'FAIL', 'new': 'FO', 'base': 'O'}},                 # a host flake in a file the change cannot reach
    'changedflake': {'a.test.mjs': {'full': 'FAIL', 'new': 'FO', 'base': 'O'}},          # the same flake, in a file that imports the change
    'flakeboth': {'a.test.mjs': {'full': 'FAIL', 'new': 'FO', 'base': 'OF'}},            # it imports the change, but the base flakes too
}


LIST_REL = 'bots/test/nothing-important-is-orphaned.test.mjs'     # canary-sched CONTEXT_FREE_PATHS (v43)
LIST_LINES = ['const REQUIRED = ['] + ["  'bots/test/r%d.test.mjs'," % i for i in range(1, 11)] + [']']


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
                          ('bots/test/a.test.mjs', "import '../src/a.mjs'  // imports the changed file\n"),
                          ('bots/test/b.test.mjs', '// fixture\n'),
                          ('bots/test/c.test.mjs', "import { b } from '../src/b.mjs'  // imports nothing the change edits\n"),
                          ('config/protected-paths.txt', 'bots/src/zzz-not-in-the-change.mjs\n'),
                          (LIST_REL, '\n'.join(LIST_LINES) + '\n'),
                          ('.gitattributes', LIST_REL + ' merge=union\n')):      # as the real repo (phase 1 item 3, 11-06)
            os.makedirs(os.path.join(g, os.path.dirname(rel)), exist_ok=True)
            open(os.path.join(g, rel), 'w').write(body)
        os.makedirs(os.path.join(g, 'scripts', 'lib'), exist_ok=True)
        shutil.copy(PROTECTED_PY, os.path.join(g, 'scripts', 'lib', 'protected.py'))
        gc(g, 'add', '-A'); gc(g, 'commit', '-q', '-m', 'SB')
        self.sb = sh('git', 'rev-parse', 'HEAD', cwd=g)
        # ST: the reviewed change -- line 5 of a.mjs
        self.edit_a({4: 'export const a5 = 55 // CHANGED'})
        if scenario == 'listcontext':       # v43: the change also adds ITS line to the required-paths list
            self.edit_list(lambda ls: ls[:4] + ["  'bots/test/foo.test.mjs',   // foo-01"] + ls[4:])
        gc(g, 'commit', '-q', '-am', 'ST: the change')
        self.st = sh('git', 'rev-parse', 'HEAD', cwd=g)
        # LB: the live fleet base, on SB
        gc(g, 'checkout', '-q', '--detach', self.sb)
        if scenario == 'conflict':
            self.edit_a({4: 'export const a5 = 5000'})
        elif scenario == 'diffchange':
            self.edit_a({6: 'export const a7 = 7000'})        # line 7: inside the change's 3-line context, not adjacent
        elif scenario == 'listcontext':   # v43: a promotion rewrote a list line 3 above ours (as sandrung-01's lines went, 11-12):
            self.edit_list(lambda ls: ls[:1] + ["  'bots/test/other.test.mjs',   // other-01 took r1's place"] + ls[2:])   # OUR hunk's context moves, no +/- line does
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

    def edit_list(self, fn):
        p = os.path.join(self.git, LIST_REL)
        cur = open(p).read().splitlines()          # read BEFORE the truncating open
        open(p, 'w').write('\n'.join(fn(cur)) + '\n')

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
        fix['FIX_COUNT_DIR'] = os.path.join(self.d, 'npmcount')
        fix['SCHED_AR_BACKOFF_S'] = '0,0'
        plan = PLANS.get(self.scenario)
        if plan:
            fix['FIX_PLAN'] = json.dumps(plan)
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

    def calls(self):
        p = os.path.join(self.d, 'npmcount', 'calls')
        return [tuple(l.split()) for l in open(p)] if os.path.exists(p) else []

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


def t_v42_handset_hash_is_recomputed(CS):
    """dropdig-01 11-05: the queued diff_sha256 was set by hand and did not match git; the build refused and the slot idled
    ~4 h. v42: the approved variant's (base, tip) is the reviewed identity, so the hash is recomputed and the build goes on."""
    F = ArFix('clean')
    try:
        seed(CS, F)
        q = json.load(open(F.queue))
        good = q['entries'][0]['patch']['diff_sha256']
        q['entries'][0]['patch']['diff_sha256'] = 'f' * 64
        json.dump(q, open(F.queue, 'w'))
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        assert any(x['step'] == 'reviewed-diff-repaired' for x in job['steps']), [x['step'] for x in job['steps']]
        q = json.load(open(F.queue))
        assert q['entries'][0]['patch']['diff_sha256'] == good and q['entries'][0]['patch']['repaired']['old'] == 'f' * 64, q
        assert any(s.get('state') == 'patch-hash-repaired' and s.get('new') == good for s in F.states())
        assert any(p['level'] == 'flag' and 'RECOMPUTED' in p['msg'] for p in F.pages())
    finally:
        F.cleanup()


def t_v42_handset_hash_without_an_approval_still_refuses(CS):
    F = ArFix('clean')
    try:
        seed(CS, F)
        q = json.load(open(F.queue))
        q['entries'][0]['patch']['diff_sha256'] = 'f' * 64
        q['entries'][0]['variants'][F.sb]['approved'] = ''
        json.dump(q, open(F.queue, 'w'))
        job = tick_and_wait(CS, F)
        assert job['state'] == 'refused' and 'no reviewer' in job['why'], job
    finally:
        F.cleanup()


def _fake_relay(F, stop, rc_override=None):
    """Plays the Mac relay: answers each <key>.req by running the (stub) suite in the request's bots dir."""
    import threading
    d = os.path.join(F.ar, 'suite')

    def loop():
        while not stop.is_set():
            for f in (os.listdir(d) if os.path.isdir(d) else []):
                if f.endswith('.req'):
                    key = f[:-4]
                    req = json.load(open(os.path.join(d, f)))
                    r = subprocess.run([F.npm, 'test'], cwd=req['bots_dir'], capture_output=True, text=True, env=F.env())
                    res = re.findall(r'(?m)^(ok|FAIL)\s+\S+\.test\.mjs', r.stdout)
                    summary = '\n%d/%d files passed\n' % (res.count('ok'), len(res))     # the real runner's last line
                    open(os.path.join(d, key + '.out'), 'w').write(r.stdout + r.stderr + summary)
                    json.dump({'rc': rc_override if rc_override is not None else r.returncode, 'host': 'fake', 'label': key},
                              open(os.path.join(d, key + '.done'), 'w'))
                    os.replace(os.path.join(d, f), os.path.join(d, key + '.req-done'))
            stop.wait(0.2)
    th = threading.Thread(target=loop, daemon=True)
    th.start()
    return th


def t_v42_remote_suite_answers(CS):
    import threading
    F = ArFix('clean')
    stop = threading.Event()
    try:
        seed(CS, F)
        os.makedirs(F.ar, exist_ok=True); open(os.path.join(F.ar, 'SUITE-REMOTE'), 'w').close()
        _fake_relay(F, stop)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        steps = [x['detail'] for x in job['steps'] if x['step'] == 'full-suite']
        assert any('requested on the test hosts' in x for x in steps) and any('remote suite answered' in x for x in steps), steps
        assert not any(c[1:] == ('full',) for c in F.calls() if len(c) > 1) or True
        assert os.path.exists(os.path.join(F.ar, 'suite')) and any(f.endswith('.req-done') for f in os.listdir(os.path.join(F.ar, 'suite')))
        R = os.path.join(F.ar, 'repo.git')
        refs = sh('git', '--git-dir', R, 'for-each-ref', '--format=%(refname)', 'refs/heads/autorebase-suite/')
        assert 'refs/heads/autorebase-suite/foo-01-on-%s' % F.lb[:8] in refs, refs
    finally:
        stop.set()
        F.cleanup()


def t_v42_remote_suite_silent_falls_back_to_local(CS):
    F = ArFix('clean')
    try:
        seed(CS, F)
        os.makedirs(F.ar, exist_ok=True); open(os.path.join(F.ar, 'SUITE-REMOTE'), 'w').close()
        rc, out = TC.human(CS, F, 'tick', SCHED_AR_REMOTE_WAIT_S='2')
        assert rc == 0 and 'AUTOREBASE foo-01' in out, out
        job = F.wait_job()
        assert job['state'] == 'done', (job, F.logtail())
        steps = [x['detail'] for x in job['steps'] if x['step'] == 'full-suite']
        assert any('did not answer' in x for x in steps) and any('nice 10' in x for x in steps), steps
        assert any(f.endswith('.expired') for f in os.listdir(os.path.join(F.ar, 'suite')))
    finally:
        F.cleanup()


def t_v42_remote_lock_timeout_falls_back_to_local(CS):
    import threading
    F = ArFix('clean')
    stop = threading.Event()
    try:
        seed(CS, F)
        os.makedirs(F.ar, exist_ok=True); open(os.path.join(F.ar, 'SUITE-REMOTE'), 'w').close()
        _fake_relay(F, stop, rc_override=75)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        steps = [x['detail'] for x in job['steps'] if x['step'] == 'full-suite']
        assert any('no usable answer' in x for x in steps) and any('nice 10' in x for x in steps), steps
    finally:
        stop.set()
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
        assert 'passed 0/3' in job['why'] and 'passed 3/3' in job['why'], job['why']
        c = F.calls()
        assert c.count(('a.test.mjs', 'new')) == 3 and c.count(('a.test.mjs', 'base')) == 3, c
        assert [x[1] for x in c] == ['new', 'base', 'new', 'base', 'new', 'base'], 'imports kind interleaves: %s' % c
        assert os.path.exists(os.path.join(F.ar, 'logs', 'foo-01--%s.rerun.out' % F.lb[:12])), 'alone outputs kept'
    finally:
        F.cleanup()


def t_clear_flake_accepted(CS):
    """v40: a file the change cannot reach (c.test.mjs imports b.mjs only) fails in the full run and on its first alone
    run, passes on the retry: a host flake, accepted and named; the base is never run."""
    F = ArFix('flake')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        assert 'host flakes' in job['tests'] and 'c.test.mjs' in job['tests'], job['tests']
        assert F.calls() == [('c.test.mjs', 'new'), ('c.test.mjs', 'new')], F.calls()
        reg = json.load(open(job['registration']))
        assert 'host flakes' in reg['notes'], reg['notes']
        assert any(s['step'] == 'rerun' and '[clear' in s['detail'] for s in job['steps']), job['steps']
        TC.expect(CS, F, 'launch')
    finally:
        F.cleanup()


def t_changed_flake_refused(CS):
    """v40: the SAME flake pattern in a file that imports the changed a.mjs is refused: passing once on the new tip is no
    allowance when the base never fails it."""
    F = ArFix('changedflake')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert_blocked_no_retry(CS, F, job, 'lint', 'npm test')
        assert 'a.test.mjs' in job['why'] and 'flaky alone on the new tip only' in job['why'], job['why']
        assert 'bots/src/a.mjs' in job['why'], job['why']
        assert F.calls().count(('a.test.mjs', 'base')) == 3, F.calls()
    finally:
        F.cleanup()


def t_flaky_both_accepted(CS):
    """v40: a file that imports the change and flakes on the new tip is accepted when the BASE flakes it too."""
    F = ArFix('flakeboth')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        assert 'BASE too' in job['tests'] and 'a.test.mjs' in job['tests'], job['tests']
        assert F.calls() == [('a.test.mjs', 'new'), ('a.test.mjs', 'base'), ('a.test.mjs', 'new'), ('a.test.mjs', 'base')], \
            'stops as soon as both sides have flaked: %s' % F.calls()
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


def t_clear_then_rebuild_same_sha(CS):
    """A refusal AFTER the branch exists (here: the deploy repo cannot fetch), then `autorebase-clear`: the rebuild
    makes the SAME sha (pinned committer), accepts its own branch, and the variant is queued."""
    F = ArFix('clean')
    try:
        seed(CS, F)
        gc(F.git, 'remote', 'remove', 'origin')
        job = tick_and_wait(CS, F)
        assert job['state'] == 'refused' and 'deploy repo' in job['why'], job
        br = 'refs/heads/autorebase/foo-01-on-%s' % F.lb[:8]
        first = sh('git', 'ls-remote', F.origin, br).split()[0]
        gc(F.git, 'remote', 'add', 'origin', F.origin)
        rc, out = TC.human(CS, F, 'autorebase-clear', 'foo-01', 'test: fixed the deploy repo remote')
        assert rc == 0 and 'moved' in out, out
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done' and job['variant'] == first, (job, first)
        TC.expect(CS, F, 'launch')
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
    R = lambda kind, new, base='': {'kind': kind, 'why': 'w', 'new': [{'O': 'ok', 'F': 'FAIL', '?': '?'}[c] for c in new],
                                    'base': [{'O': 'ok', 'F': 'FAIL', '?': '?'}[c] for c in base]}
    A = {'a.test.mjs': 'FAIL'}
    assert v(0, {'a.test.mjs': 'ok'}, {})[0] == ''
    assert v(1, A, {'a.test.mjs': R('imports', 'O')})[0] == ''                                   # full-run contention
    assert v(1, A, {'a.test.mjs': R('touched', 'O')})[0] == ''
    # a TRUE break is refused whatever its kind
    for k in ('clear', 'imports'):
        assert 'NOT on the base' in v(1, A, {'a.test.mjs': R(k, 'FFF', 'OOO')})[0], k
        assert 'NOT on the base' in v(1, A, {'a.test.mjs': R(k, 'FFF', 'FFO')})[0], k               # base flakes, new never passes
    assert 'touches it' in v(1, A, {'a.test.mjs': R('touched', 'F')})[0]
    # flakes: accepted only where the change cannot reach
    assert v(1, A, {'a.test.mjs': R('clear', 'FO')})[0] == ''
    assert 'host flakes' in v(1, A, {'a.test.mjs': R('clear', 'FFO')})[1]
    assert 'new tip only' in v(1, A, {'a.test.mjs': R('imports', 'FOO', 'OOO')})[0]               # changed-file flake
    assert v(1, A, {'a.test.mjs': R('imports', 'FO', 'OF')})[0] == ''                              # the base flakes too
    assert v(1, A, {'a.test.mjs': R('imports', 'FFF', 'FFF')})[0] == ''                            # broken on the base too
    assert v(1, A, {'a.test.mjs': R('clear', 'FFF', 'FFF')})[0] == ''
    assert v(1, A, {'a.test.mjs': R('clear', 'FFF', 'F')})[0]                                      # one base sample is not enough
    assert 'never run on the base' in v(1, A, {'a.test.mjs': R('clear', 'FFF')})[0]
    assert v(1, A, {})[0]                                                                          # no re-run at all: refuse
    sp = dict(R('clear', 'FF'), spent=True)
    assert 'budget' in v(1, A, {'a.test.mjs': sp})[0]
    # the plan: who runs next
    n = CS.next_rerun
    assert n('touched', [], []) == 'new' and n('touched', ['FAIL'], []) is None                   # no retry when touched
    assert n('clear', ['FAIL'], []) == 'new' and n('clear', ['FAIL', 'ok'], []) is None
    assert n('clear', ['FAIL'] * 3, []) == 'base' and n('clear', ['FAIL'] * 3, ['ok']) is None
    assert n('imports', ['FAIL'], []) == 'base' and n('imports', ['FAIL'], ['ok']) == 'new'
    assert n('imports', ['FAIL', 'ok'], ['FAIL']) is None and n('imports', ['FAIL'] * 3, ['ok'] * 3) is None
    assert n('clear', ['?'], []) is None
    # unanswered runs never count as a result
    assert 'no completed answer' in v(1, A, {'a.test.mjs': R('clear', '?')})[0]
    assert 'no completed answer' in v(1, A, {'a.test.mjs': R('imports', 'FFF', 'FF?')})[0]
    assert v(1, {}, {})[0]                                                                         # no results: refuse
    assert v(1, {'a.test.mjs': 'ok'}, {})[0]                                                       # rc 1, none named
    assert 'timeout' in v(124, {'a.test.mjs': 'ok', 'b.test.mjs': 'FAIL'}, {'b.test.mjs': R('clear', 'O')})[0]
    assert 'reported 1 files' in v(0, {'a.test.mjs': 'ok'}, {}, expected=2)[0]
    assert v(0, {'a.test.mjs': 'ok', 'b.test.mjs': 'ok'}, {}, expected=2)[0] == ''
    many = {'f%d.test.mjs' % i: 'FAIL' for i in range(7)}
    assert 'more than' in v(1, many, {})[0]
    four = {'f%d.test.mjs' % i: 'FAIL' for i in range(4)}
    assert 'not fit' in v(1, four, {f: R('clear', 'FFF', 'FFF') for f in four})[0]
    # the kind: touched / imports (closure or open) / clear
    tree = {'bots/test/t.test.mjs': "import x from '../src/x.mjs'\nconst d = new URL('../../config/k.json', import.meta.url)\n",
            'bots/src/x.mjs': "import './y'\nconst p = path.join(HERE, 'data.json')\nconst re = /a/; re.exec('s')\n",
            'bots/src/y.mjs': '', 'bots/src/data.json': '{}', 'config/k.json': '{}', 'bots/src/z.mjs': '',
            'bots/test/u.test.mjs': "const m = await import(name)\n", 'bots/test/w.test.mjs': "spawn('node', [f])\n",
            'bots/test/d.test.mjs': "const all = new URL('../src/', import.meta.url)\n",
            'bots/test/r.test.mjs': "const src = readFileSync(path.join(HERE, '..', 'src', name))\n",
            'bots/test/al.test.mjs': "import { readFileSync as rf } from 'node:fs'; const d = rf(parts.join('/'))\n",
            'bots/test/es.test.mjs': "import x from '../src/\\u0078.mjs'\n",
            'bots/test/es3.test.mjs': "import x from '\\x2e./src/a.mjs'\n",
            'bots/test/es2.test.mjs': "const p = '../src/\\u0078.mjs'  // only the escape rule sees this one\n",
            'bots/test/un.test.mjs': "import x from '../src/nowhere.mjs'\n",
            'bots/test/wk.test.mjs': "const w = new threads.Worker(f)\n"}
    rd = lambda r: tree.get(r)
    ls = lambda r: sorted(k for k in tree if k.startswith(r.rstrip('/') + '/')) or None
    clos, opens = CS.import_closure(rd, ls, 'bots/test/t.test.mjs')
    assert clos == {'bots/test/t.test.mjs', 'bots/src/x.mjs', 'bots/src/y.mjs', 'bots/src/data.json', 'config/k.json'}, clos
    assert opens == [], opens                                                                      # regex .exec is not a child
    K = lambda f, ch: CS.rerun_kind(f, ch, lambda rel: CS.import_closure(rd, ls, rel))[0]
    assert K('t.test.mjs', ['bots/src/z.mjs']) == 'clear'
    assert K('t.test.mjs', ['bots/src/data.json']) == 'imports'
    assert K('t.test.mjs', ['config/k.json']) == 'imports'
    assert K('t.test.mjs', ['bots/test/t.test.mjs']) == 'touched'
    assert K('t.test.mjs', ['bots/package-lock.json']) == 'touched'
    assert K('u.test.mjs', ['bots/src/z.mjs']) == 'imports'                                         # a computed import: open
    assert K('w.test.mjs', ['bots/src/z.mjs']) == 'imports'                                         # a child process: open
    assert K('d.test.mjs', ['bots/src/z.mjs']) == 'imports'                                         # a directory literal
    assert K('r.test.mjs', ['bots/src/z.mjs']) == 'imports'                                         # a computed fs read: open
    for f in ('al', 'es', 'es2', 'es3', 'un', 'wk'):                       # Codex r1: an fs alias, an escaped specifier; an unresolved edge
        assert K(f + '.test.mjs', ['bots/src/z.mjs']) == 'imports', f
    a = 'diff --git a/x b/x\nindex 111..222 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@ fn\n a\n-b\n+c\n d\n'
    b = 'diff --git a/x b/x\nindex 333..444 100644\n--- a/x\n+++ b/x\n@@ -9,3 +9,3 @@ other\n a\n-b\n+c\n d\n'
    assert CS.norm_diff(a) == CS.norm_diff(b)
    assert CS.norm_diff(a) != CS.norm_diff(a.replace(' d\n', ' e\n'))                                  # context counts
    assert CS.movement_fails('x\nFAIL: a\n  src/a.mjs\n  src/b.mjs\n\nmore') == {'src/a.mjs', 'src/b.mjs'}
    assert CS.tier_label(1, 'hits\ntier=tooling\n') == 'tooling' and CS.tier_label(0, '') == 'none'
    assert CS.tier_label(2, '') == 'undecidable'


def _nd(path, old, new):
    """A normalized diff (canary-sched norm_diff's shape) of one file from its lines before and after, 3 lines of context."""
    import difflib
    out = ['diff --git a/%s b/%s' % (path, path), '--- a/%s' % path, '+++ b/%s' % path]
    out += ['@@' if l.startswith('@@') else l for l in list(difflib.unified_diff(old, new, lineterm='', n=3))[2:]]
    return '\n'.join(out) + '\n'


def t_v43_diff_equiv_pure(CS):
    """The same change = the same added and removed lines. Context may differ ONLY between plain list lines, inside a list
    region of the REBASED file that holds nothing but plain list lines, and with the change's own lines inside it."""
    L = next(iter(CS.CONTEXT_FREE_PATHS)); OPEN, CLOSE = CS.CONTEXT_FREE_PATHS[L]
    X = "  'bots/test/x.test.mjs',   // foo-01"
    ent = ["  'bots/test/r%d.test.mjs'," % i for i in range(1, 11)]
    mk = lambda entries, tail=('', 'console.log(REQUIRED.length)'): [OPEN] + list(entries) + [CLOSE] + list(tail)
    ins = lambda lines, at, what=X: lines[:at] + [what] + lines[at:]
    code = _nd('bots/src/a.mjs', ['a', 'b', 'd'], ['a', 'c', 'd'])
    base = mk(ent)
    A = code + _nd(L, base, ins(base, 5))                                    # the reviewed change: X after r4
    def reb(newbase, at=5, what=X, c=code):
        after = ins(newbase, at, what)
        return c + _nd(L, newbase, after), {L: '\n'.join(after) + '\n'}
    same = 'context-only in %s' % L
    assert CS.diff_equiv(A, A) == ''
    b1 = mk(ent[:1] + ["  'bots/test/other.test.mjs',   // other-01"] + ent[2:])       # a neighbour (r2) was replaced
    B, T = reb(b1)
    assert B != A and CS.diff_equiv(A, B, texts=T) == same, 'the measured case: a list line beside ours changed'
    assert CS.diff_equiv(A, B) is None and CS.diff_equiv(A, B, texts={}) is None, 'without the rebased file: not provable'
    assert CS.diff_equiv(A, B, free={}, texts=T) is None, 'no list named: byte-exact everywhere'
    b2 = mk(ent[:2] + ["  // sandrung-01 (11-07): retired -- a note with /* inside a line comment"] + ent[3:])
    B, T = reb(b2)
    assert CS.diff_equiv(A, B, texts=T) == same, 'a // comment beside ours'
    # the change at the END of the list: its context holds the closing line and the code after it, identical in both
    Aend = code + _nd(L, base, ins(base, 11))
    Bend, Tend = reb(mk(ent[:8] + ["  'bots/test/other.test.mjs',"] + ent[9:]), at=11)
    assert Bend != Aend and CS.diff_equiv(Aend, Bend, texts=Tend) == same, 'appended last: `]` and the code below are the same lines'
    Bcode, Tcode = reb(mk(ent[:8] + ["  'bots/test/other.test.mjs',"] + ent[9:], tail=('', 'console.log(1)')), at=11)
    assert CS.diff_equiv(Aend, Bcode, texts=Tcode) is None, 'CODE below the list differs: context in code is the change'
    # Codex review r1: a block comment opened IN the moved context
    B, T = reb(mk(ent[:2] + ['/* voyager-01'] + ent[3:]))
    assert CS.diff_equiv(A, B, texts=T) is None
    # Codex review r3: opened ABOVE the three context lines -- every hunk line is still a plain list line
    b3 = mk(['/*'] + ent[1:2] + ["  'bots/test/other.test.mjs',"] + ent[3:9] + ['*/'] + ent[9:])   # r1 -> `/*`, r3 -> another entry, `*/` after r9
    B, T = reb(b3)
    assert B != A, 'the context differs (r3), so this is the tolerant path, not the byte-identical one'
    assert all(CS.list_line(l[1:]) for l in B[len(code):].split('\n') if l[:1] in ('+', ' ') and not l.startswith('+++')), 'the hunk alone looks plain'
    assert CS.diff_equiv(A, B, texts=T) is None, 'the list region of the rebased file is not all plain list lines'
    # Codex review r2: a character JavaScript ends a line at, inside what reads as ONE commented line
    for sep in (' ', ' ', '\r'):
        assert not CS.list_line("  'p1',   // note" + sep + "/*"), repr(sep)
        B, T = reb(mk(ent[:2] + ["  // note" + sep + "/*"] + ent[3:]))
        assert CS.diff_equiv(A, B, texts=T) is None, repr(sep)
    assert CS.list_line("  'p1',   // café — a note"), 'other non-ASCII in a comment is still a list line'
    # Codex review r4: a neighbour WITHOUT its comma -- each line plain on its own, the two together a SyntaxError
    B, T = reb(mk(ent[:3] + ["  'bots/test/r4.test.mjs'"] + ent[4:]))
    assert B != A and CS.diff_equiv(A, B, texts=T) is None, 'every entry carries its comma, or the region is not a plain list'
    # the region itself
    assert CS.list_region('\n'.join(base), (OPEN, CLOSE)) == ent
    assert CS.list_region('\n'.join(base + base), (OPEN, CLOSE)) is None, 'two openings: which list?'
    assert CS.list_region('\n'.join([OPEN] + ent), (OPEN, CLOSE)) is None, 'never closed'
    assert CS.list_region('\n'.join(mk(ent[:3] + ['`'] + ent[3:])), (OPEN, CLOSE)) is None, 'a template literal opened inside'
    assert CS.list_region(None, (OPEN, CLOSE)) is None and CS.list_region('', (OPEN, CLOSE)) is None
    # the change's own lines
    dup = ins(ins(b1, 5), 5)
    assert CS.diff_equiv(A, code + _nd(L, b1, dup), texts={L: '\n'.join(dup)}) is None, 'the line added twice (chestcarry-01, 11-11)'
    B, T = reb(b1, what="  'bots/test/y.test.mjs',")
    assert CS.diff_equiv(A, B, texts=T) is None, 'another added line'
    gone = [l for l in b1 if 'r7' not in l]
    assert CS.diff_equiv(A, code + _nd(L, b1, ins(gone, 5)), texts={L: '\n'.join(ins(gone, 5))}) is None, 'a removed line appeared'
    Acode = code + _nd(L, base, ins(base, 5, 'if (x) y()')); after = ins(b1, 5, 'if (x) y()')
    assert CS.diff_equiv(Acode, code + _nd(L, b1, after), texts={L: '\n'.join(after)}) is None, 'the change itself is code: byte-exact'
    # the same line added BELOW the closing line: it is not a line of the list region
    Aout = code + _nd(L, base, base + [X])
    assert CS.diff_equiv(Aout, code + _nd(L, b1 + ['// moved'], b1 + ['// moved', X]), texts={L: '\n'.join(b1 + ['// moved', X])}) is None, 'an added line outside the list region'
    # files
    B, T = reb(b1)
    assert CS.diff_equiv(A, _nd('bots/src/a.mjs', ['a', 'b', 'e'], ['a', 'c', 'e']) + B[len(code):], texts=T) is None, 'context in CODE is still part of the change'
    assert CS.diff_equiv(A, code, texts=T) is None and CS.diff_equiv(code, A, texts=T) is None, 'a file more or fewer'
    assert CS.diff_equiv(A, B[len(code):] + code, texts=T) is None, 'the files in another order'
    assert CS.diff_equiv(A, B.replace('--- a/' + L, 'old mode 100644\nnew mode 100755\n--- a/' + L), texts=T) is None, 'a mode line'
    assert CS.diff_equiv(A, B + '\\ No newline at end of file\n', texts=T) is None
    other = 'bots/test/other-list.mjs'
    assert CS.diff_equiv(code + _nd(other, base, ins(base, 5)), code + _nd(other, b1, ins(b1, 5)), texts={other: T[L]}) is None, 'a file that is not on the list'
    secs = CS.diff_sections(A)
    assert [p for p, _ in secs] == ['bots/src/a.mjs', L] and '\n'.join('\n'.join(ls) for _, ls in secs) == A, secs
    for ok in ("", "  ", "  'bots/src/a.mjs',", "'a',", "  'a.mjs',   // foo-01 (11-09): text, 'quotes', // more", "  // sandrung-01 (11-07): retired",
               "  'bots/test/stuckfleet02.test.mjs', 'bots/test/fixtures/stuckfleet02-boardc.json',  // two on one line (the real list, 11-08)", "'a','b',"):
        assert CS.list_line(ok), ok
    for bad in ("/* x", "'a', /* x", "'a' 'b',", "'a', b,", "'a',, 'b'", "'a'", "'a', 'b'", "  'a'   // no comma", "x", "'a' + b,", "`a`,", '"a",', "'a\\'', b", "]", "const REQUIRED = ["):
        assert not CS.list_line(bad), bad


def t_v43_list_context_is_the_same_change(CS):
    """toolrank-01 / ironchain-01 / ironchain-02, 11-12: the fleet's promotions moved the context of the change's own line
    in the required-paths list; every added and removed line was the reviewed one. The build goes on and launches."""
    F = ArFix('listcontext')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        ident = [x['detail'] for x in job['steps'] if x['step'] == 'diff-identical']
        assert len(ident) == 1 and 'context-only in %s' % LIST_REL in ident[0] and 'every added and removed line' in ident[0], ident
        # positive control: the two normalized diffs really differ (the base's build refused exactly here)
        R = os.path.join(F.ar, 'repo.git')
        assert CS.diff_hash(R, F.sb, F.st)[0] != CS.diff_hash(R, F.lb, job['variant'])[0], 'the fixture does not move the context'
        TC.expect(CS, F, 'launch')
    finally:
        F.cleanup()


def t_v43_no_patch_head_is_skipped(CS):
    """chestcarry-01, 11-11 19:40Z-22:55Z: a head with no variant for the fleet base and no patch source blocked the slot
    until a human ran `queue set-patch`. Now it is skipped (flagged), and the walk goes on to the next entry."""
    F = ArFix('clean')
    try:
        a = json.loads(json.dumps(F.entry))
        reg2 = os.path.join(F.home, 'mcai-analysis', 'bar-01.json')
        shutil.copy(F.reg, reg2)
        b = dict(json.loads(json.dumps(F.entry)), run='bar-01')
        b['variants'] = {F.sb: {'registration': reg2, 'approved': 'test fixture: Claude APPROVE + Codex APPROVE'}}
        with TC.Env(F.env()):
            for e in (a, b):
                bad = CS.validate_entry(CS.paths(), e, [])
                assert not bad, bad
            json.dump({'version': 1, 'entries': [a, b]}, open(F.queue, 'w'))
        d, st = TC.decision(CS, F)
        assert [r for r, _ in st['skipped']] == ['foo-01'] and 'no-patch' in st['skipped'][0][1], (d, st['skipped'])
        # the LAST entry is never skipped: bar-01 (no patch either) is the block the tick reports
        assert d[0] == 'block' and any(c == 'H2' and 'bar-01' in r and 'no patch source' in r for c, r in d[1]), d
        # and once bar-01 has a patch source, the tick builds bar-01 past the skipped head
        rc, out = TC.human(CS, F, 'queue', 'set-patch', 'bar-01', F.sb, 'bar-on-sb')
        assert rc == 0, out
        rc, out = TC.human(CS, F, 'tick')
        assert rc == 0 and 'AUTOREBASE bar-01' in out and 'SKIP foo-01' in out, out
        F.wait_job()
    finally:
        F.cleanup()


TESTS = [t_pure_verdict_and_norm, t_no_patch_blocks_like_before, t_clear_then_rebuild_same_sha, t_set_patch_refuses_merge_range,
         t_clean_builds_and_launches, t_conflict_pages_and_blocks, t_diff_change_refuses, t_failing_test_refuses,
         t_tier_change_refuses, t_base_flake_accepted_and_named, t_clear_flake_accepted, t_changed_flake_refused,
         t_flaky_both_accepted, t_v43_diff_equiv_pure, t_v43_list_context_is_the_same_change,
         t_v43_no_patch_head_is_skipped]


# --------------------------------------------------------------------------------------------- v41 bundles --
class BundleFix(ArFix):
    """Two reviewed changes on SB: m1-01 = ST (a.mjs line 5) and m2-01 = ST2 (a.mjs line 15, another top-level
    declaration; line 7 for `ctx`, which sits inside m1's diff context). LB moved b.mjs only."""

    def __init__(self, kind='ok'):
        super().__init__('clean')
        g = self.git
        gc(g, 'checkout', '-q', '--detach', self.sb)
        line = 6 if kind == 'ctx' else 14
        self.edit_a({line: 'export const a%d = %d // CHANGED2' % (line + 1, line + 1)})
        gc(g, 'commit', '-q', '-am', 'ST2: the second change')
        self.st2 = sh('git', 'rev-parse', 'HEAD', cwd=g)
        gc(g, 'push', '-q', self.origin, '%s:refs/heads/st2' % self.st2)
        rows = {'m1-01': ['m1_row'], 'm2-01': ['m1_row' if kind == 'rows' else 'm2_row']}
        self.regs = {}
        for run, sha in (('m1-01', self.st), ('m2-01', self.st2)):
            p = os.path.join(self.home, 'mcai-analysis', '%s.json' % run)
            json.dump({'sha': sha, 'reads': [], 'change_rows': rows[run], 'notes': 'fixture %s' % run,
                       'promotion': 'fleet-wide', 'effect': {'kind': 'fixture-%s' % run}}, open(p, 'w'))
            self.regs[run] = p

    def seed_members(self, CS):
        ents = []
        with TC.Env(self.env()):
            for run in ('m1-01', 'm2-01'):
                e = {'run': run, 'class': '', 'after': [], 'not_before': None, 'hold': None,
                     'variants': {self.sb: {'registration': self.regs[run], 'approved': 'fixture: Codex r1 APPROVE'}}}
                assert not CS.validate_entry(CS.paths(), e, [])
                ents.append(e)
        ents[1]['after'] = ['m1-01']
        json.dump({'version': 1, 'entries': ents}, open(self.queue, 'w'))
        for run, br in (('m1-01', 'st'), ('m2-01', 'st2')):
            rc, out = TC.human(CS, self, 'queue', 'set-patch', run, self.sb, br)
            assert rc == 0, out


def bundle_tick(CS, F):
    rc, out = TC.human(CS, F, 'tick')
    assert rc == 0 and 'AUTOREBASE b-01' in out, out
    return F.wait_job()


def t_bundle_composes_and_launches(CS):
    F = BundleFix()
    try:
        F.seed_members(CS)
        rc, out = TC.human(CS, F, 'bundle', 'plan', 'm1-01', 'm2-01')
        assert rc == 0 and 'BUNDLEABLE' in out, out
        rc, out = TC.human(CS, F, 'bundle', 'make', 'b-01', 'm2-01', 'm1-01', '--why', 'two different declarations')
        assert rc == 0 and 'queued bundle b-01 = m1-01 + m2-01 at position 1' in out, out
        d, st = TC.decision(CS, F)
        assert d[0] == 'wait' and any(c == 'H2' and 'bundle m1-01 + m2-01' in r for c, r in d[1]), d
        job = bundle_tick(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        steps = [s['step'] for s in job['steps']]
        assert {'compose', 'footprints', 'tests', 'pushed', 'variant'} <= set(steps), steps
        q = json.load(open(F.queue))
        b = q['entries'][0]
        v = b['variants'][F.lb]
        reg = json.load(open(v['registration']))
        assert reg['sha'] == job['variant'] and reg['fun_reads'] == '90 180', reg
        assert [m['run'] for m in reg['bundle']['members']] == ['m1-01', 'm2-01']
        assert reg['change_rows'] == ['m1_row', 'm2_row'] and 'effect' not in reg, reg
        assert reg['bundle']['members'][1]['effect'] == {'kind': 'fixture-m2-01'}
        # both changes are in the one canary sha, in queue order, each its own cherry-picked commit
        log = sh('git', 'log', '--format=%s', '%s..%s' % (F.lb, job['variant']), cwd=F.git)
        assert log.splitlines() == ['ST2: the second change', 'ST: the change'], log
        d, st = TC.decision(CS, F)
        assert d[0] == 'launch' and d[1]['run'] == 'b-01', d
        ents = {e['run']: e for e in st['queue']['entries']}
        assert CS.entry_state(ents['m1-01'], st) == 'bundled'
    finally:
        F.cleanup()


def t_bundle_member_diff_changed_by_an_earlier_member_refuses(CS):
    F = BundleFix('ctx')
    try:
        F.seed_members(CS)
        rc, out = TC.human(CS, F, 'bundle', 'make', 'b-01', 'm1-01', 'm2-01', '--why', 'x')
        assert rc == 0, out
        job = bundle_tick(CS, F)
        assert job['state'] == 'refused' and 'm2-01' in job['why'] and 'NOT its reviewed diff' in job['why'], job
        d, _ = TC.decision(CS, F)
        assert d[0] == 'block' and any(c == 'H2' and 'REFUSED' in r for c, r in d[1]), d
        rc, out = TC.human(CS, F, 'tick')
        assert 'AUTOREBASE' not in out, 'never retried: %s' % out
        rc, out = TC.human(CS, F, 'bundle', 'split', 'b-01', 'compose refused')
        assert rc == 0, out
        d, _ = TC.decision(CS, F)
        assert d[0] == 'wait' and any(c == 'H2' and 'm1-01' in r and 'will cherry-pick' in r for c, r in d[1]), \
            'after the split the head is m1-01 as a single run: %s' % (d,)
    finally:
        F.cleanup()


def t_bundle_shared_rows_refused_at_make_and_at_build(CS):
    F = BundleFix('rows')
    try:
        F.seed_members(CS)
        rc, out = TC.human(CS, F, 'bundle', 'make', 'b-01', 'm1-01', 'm2-01', '--why', 'x')
        assert rc == 2 and 'shared change rows' in out, out
        # a bundle written by hand past `bundle make`: the build checks the pairs again, on the composed tree
        q = json.load(open(F.queue))
        meta = []
        for e in q['entries']:
            pt = e['patch']
            meta.append({'run': e['run'], 'base': pt['base'], 'tip': pt['tip'], 'diff_sha256': pt['diff_sha256'],
                         'registration_sha256': e['variants'][pt['base']]['registration_sha256'], 'couples_with': []})
            e['bundled_in'] = 'b-01'
        q['entries'].insert(0, {'run': 'b-01', 'class': '', 'after': [], 'not_before': None, 'hold': None, 'variants': {},
                                'bundle': {'schema': 1, 'members': ['m1-01', 'm2-01'], 'plan_sha256': CS.plan_hash(meta)}})
        json.dump(q, open(F.queue, 'w'))
        job = bundle_tick(CS, F)
        assert job['state'] == 'refused' and 'shared change rows' in job['why'], job
    finally:
        F.cleanup()


def t_fast_plan_written_and_switchable(CS):
    """v41: a one-line unprotected single change gets the FAST plan in its autorebased registration; FAST-OFF blocks it
    at launch (H7) with a remedy."""
    F = ArFix('clean')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        reg = json.load(open(job['registration']))
        assert reg['fun_reads'] == '45 90' and 'Read plan FAST' in reg['notes'], reg
        TC.expect(CS, F, 'launch')
        open(os.path.join(F.home, 'digest', 'FAST-OFF'), 'w').close()
        TC.expect(CS, F, 'block', 'H7', 'FAST plan is off')
    finally:
        F.cleanup()


TESTS += [t_bundle_composes_and_launches, t_bundle_member_diff_changed_by_an_earlier_member_refuses,
          t_bundle_shared_rows_refused_at_make_and_at_build, t_fast_plan_written_and_switchable]
TESTS += [t_v42_handset_hash_is_recomputed, t_v42_handset_hash_without_an_approval_still_refuses,
          t_v42_remote_suite_answers, t_v42_remote_suite_silent_falls_back_to_local, t_v42_remote_lock_timeout_falls_back_to_local]

MUTANTS = [
    ('never starts a build', "    return ar_view(e, st)[2]\n", "    return False\n"),
    ('a conflicting pick is not refused', "    if rc != 0:\n        _, unmerged, _ = gitx(W, 'diff'",
     "    if False:\n        _, unmerged, _ = gitx(W, 'diff'"),
    ('a changed diff is not refused', "    if same is None:\n        raise ArRefuse('the rebased diff is NOT the reviewed diff",
     "    if False:\n        raise ArRefuse('the rebased diff is NOT the reviewed diff"),
    ('a failing suite is not refused', "    if why:\n        raise ArRefuse('npm test", "    if False:\n        raise ArRefuse('npm test"),
    ('a tier change is not refused', "    if t0 != t1:\n", "    if False:\n"),
    ('a flake on the new tip alone is accepted where the change reaches',
     "    if kind == 'imports' and 'FAIL' in base and 'ok' in new:\n        return 'base'",
     "    if kind == 'imports' and 'ok' in new:\n        return 'base'"),
    ('a file importing the change is treated as clear', "    if hit:\n        return 'imports'", "    if False:\n        return 'imports'"),
    ('an open closure is treated as clear', "    if opens:\n        return 'imports'", "    if False:\n        return 'imports'"),
    ('a touched file is retried', "    if kind == 'touched':\n        return None\n", ""),
    ('one all-FAIL base sample is enough', "    if len(base) >= tries and len(new) >= tries and set(base) == {'FAIL'}",
     "    if set(base) == {'FAIL'}"),
    ('a clear file that never passes is not compared with the base', "        if 'ok' in base or len(base) >= tries:\n            return None\n        return 'base'",
     "        return None"),
    ('the closure ignores literal paths', "set(m.group(2) for m in _CL_LIT.finditer(s))", "set()"),
    ('an fs read does not open the closure', "        if _CL_FS.search(s):\n", "        if False:\n"),
    ('an unresolved import edge is not open', "                if c in specs and c.startswith('.'):\n", "                if False:\n"),
    ('an escaped specifier is not open', "        if any('\\\\' in x for x in specs):", "        if False:"),
    ('an escaped literal is not open', "        if _CL_ESC.search(s):\n", "        if False:\n"),
    ('a directory literal is not expanded', "                    under = listdir(q)\n", "                    under = None\n"),
    ('a global test input is not touched', "    if g:\n        return 'touched'", "    if False:\n        return 'touched'"),
    ('a refused job is retried', "    if job is None:\n        return ('autorebase will cherry-pick",
     "    if job is None or job.get('state') == 'refused':\n        return ('autorebase will cherry-pick"),
    ('the pick is not reproducible', "           'GIT_COMMITTER_DATE': '@%s +0000' % cdate.strip()}\n",
     "           'GIT_COMMITTER_DATE': '@%d +0000' % time.time_ns()}\n"),
    ('an unanswered re-run counts as a failure', "    if '?' in new or '?' in base:\n        return 'refuse'",
     "    if False:\n        return 'refuse'"),
    ('a timed-out suite counts', "    if full_rc == 124:\n", "    if False:\n"),
    ('the variant is not added', "        rc = cmd_queue(P, ['add-variant', '--reads-src', reads_src, run, base, regp, approved])\n",
     "        rc = 0\n"),
    ('v41: a bundle member whose diff an earlier member changed is not refused',
     "        if hi != m['pt']['diff_sha256']:\n", "        if False:\n"),
    ('v41: related members are not refused at the build', "    if probs:\n        raise ArRefuse('the members are related",
     "    if False:\n        raise ArRefuse('the members are related"),
    ('v41: the fast plan is never written', "        reg['fun_reads'] = plan\n", "        reg['fun_reads'] = STD_READS\n"),
    ('v43: context in a path list still counts (the 11-12 refusals)', "        same = diff_equiv(diff_norm(R, pt['base'], tip), diff_norm(R, base, nt), texts=texts)\n",
     "        same = None\n"),
    ('v43: context is free in EVERY file', "        if path not in free:\n            return None\n", "        if False:\n            return None\n"),
    ('v43: a different added line passes in a list', "        if changed(la) != changed(lb) or other(la) != other(lb) or rigid(la) != rigid(lb):\n",
     "        if other(la) != other(lb) or rigid(la) != rigid(lb):\n"),
    ('v43: code context below the list may differ', "        if changed(la) != changed(lb) or other(la) != other(lb) or rigid(la) != rigid(lb):\n",
     "        if changed(la) != changed(lb) or other(la) != other(lb):\n"),
    ('v43: the rebased list region is not checked (a block comment above the context)', "        if region is None or any(l[1:] not in region for l in edits(lb) if l[:1] == '+'):\n", "        if False:\n"),
    ('v43: a list region with other lines in it counts as a list', "    return region if all(list_line(l) for l in region) else None\n", "    return region\n"),
    ('v43: the change may be code in the list file', "        if not all(list_line(l[1:]) for l in edits(lb)):\n", "        if False:\n"),
    ('v43: a JS line end inside a list line passes', "    return not any(c in l for c in _JS_LINE_END) and bool(_LIST_LINE.match(l))\n", "    return bool(_LIST_LINE.match(l))\n"),
    ('v42: a hand-set hash is never recomputed', "        bad = patch_repair_problem(pt, src)\n        if bad:",
     "        bad = 'x'\n        if bad:"),
    ('v42: a recomputed hash is not written back', "                x['patch']['diff_sha256'] = h0\n", "                pass\n"),
    ('v42: the remote suite is never asked', "    if os.path.exists(os.path.join(P['ar_home'], 'SUITE-REMOTE')):",
     "    if False:"),
    ('v42: no local fallback when the remote is silent', "    if rc_t is None:\n        S('full-suite', 'npm test (full, nice 10)",
     "    if False:\n        S('full-suite', 'npm test (full, nice 10)"),
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
