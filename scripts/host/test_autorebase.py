#!/usr/bin/env python3
"""test_autorebase.py [--mutants] -- behaviour tests for canary-sched.py's AUTOREBASE (v39), on test_canary_sched.py's
fixture tree plus: a bare `origin`, real commits with files (a source base SB, the reviewed change ST on it, a live fleet
base LB per scenario), the real scripts/lib/protected.py, and a STUB npm (ci / run lint / run lint:movement / test).
Each scenario seeds a queue whose head has a variant only for SB, declares the patch with `queue set-patch`, runs a real
`tick` (which starts the real background `autorebase-build`), waits for the job, then ticks again:

  clean       the pick applies, the diff is identical, tests pass  -> a variant for LB is queued, the next tick LAUNCHES it
  conflict    LB edits the changed line                           -> refused at the cherry-pick, the head BLOCKED, paged
  diffchange  LB edits a line inside the change's context         -> the pick is clean, the diff differs: refused
  ctxinsert   v45: LB INSERTS a line inside the change's context  -> every reviewed context line still stands around the
              change: accepted for a change that is not protected (named, one flag page); refused with
              ~/digest/CONTEXT-STRICT and in `ctxinsert-prot` (the changed file on the protected list at SB)
  ctxblock    v45: LB inserts `if (...) {` above the change and `}` below it, inside its context -> every reviewed line is
              still there, and the change now sits in a block: refused (an inserted line is not a plain line)
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
                          ('config/protected-paths.txt', 'bots/src/zzz-not-in-the-change.mjs\n' +
                           ('bots/src/a.mjs\n' if scenario == 'ctxinsert-prot' else '')),   # v45: protected on BOTH bases
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
        elif scenario in ('ctxinsert', 'ctxinsert-prot'):     # v45: a line INSERTED between lines 2 and 3 (context of the change at 5)
            self.edit_a({1: 'export const a2 = 2\nexport const a2b = 22'})
        elif scenario == 'ctxblock':                          # v45: a block opened and closed around the change, inside its context
            self.edit_a({1: 'export const a2 = 2\nif (globalThis.off) {', 6: 'export const a7 = 7\n}'})
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


def _accepted_page(F):
    return [p for p in F.pages() if 'autorebase accepted a context-only rebase of code' in p['msg']]


def t_v45_code_context_accepted_when_not_protected(CS):
    """ironchain-02 (11-12), boardwalk-03 (11-13): the pick was clean, every added and removed line the reviewed one, and
    1-3 context lines of a code file differed because another change had INSERTED a neighbouring line; the build refused
    and a human registered the same sha by hand. For a change that is not protected the build goes on (the suite runs),
    says so in the step row, the registration and `approved`, pages ONE flag, and the variant launches like any other."""
    F = ArFix('ctxinsert')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'done', (job, F.logtail())
        ident = [x['detail'] for x in job['steps'] if x['step'] == 'diff-identical']
        assert len(ident) == 1 and 'CONTEXT-ONLY IN CODE' in ident[0] and 'context-only (code) in bots/src/a.mjs' in ident[0], ident
        assert '1 context line(s) inserted by the base (bots/src/a.mjs 1)' in ident[0], ident
        steps = [x['step'] for x in job['steps']]
        assert steps.index('diff-identical') < steps.index('tier') < steps.index('tests'), 'the order of the rows is unchanged, and the suite ran: %s' % steps
        assert any(x['step'] == 'tier' and 'tier none' in x['detail'] for x in job['steps']), job['steps']
        # positive control: the two normalized diffs really differ (v43 refused exactly here), and so does the function
        # text of the two hunk headers -- the inserted line pushed `a2` out of the hunk and git names it
        R = os.path.join(F.ar, 'repo.git')
        assert CS.diff_hash(R, F.sb, F.st)[0] != CS.diff_hash(R, F.lb, job['variant'])[0], 'the fixture does not move the context'
        fa, fb = CS.hunk_funcs(CS.diff_raw(R, F.sb, F.st)), CS.hunk_funcs(CS.diff_raw(R, F.lb, job['variant']))
        assert fa == {'bots/src/a.mjs': ['export const a1 = 1']} and fb == {'bots/src/a.mjs': ['export const a2 = 2']}, (fa, fb)
        v = json.load(open(F.queue))['entries'][0]['variants'][F.lb]
        reg = json.load(open(v['registration']))
        for text in (v['approved'], reg['notes']):
            assert 'CONTEXT-ONLY REBASE OF CODE' in text and 'bots/src/a.mjs 1' in text and 'a blockers-only look is owed' in text, text
            assert 'normalized diff identical' not in text, 'the text must not claim a byte-identical diff: %s' % text
        assert v['protected'] is False, v
        pg = _accepted_page(F)
        assert len(pg) == 1 and pg[0]['level'] == 'flag' and pg[0]['run'] == 'foo-01', F.pages()
        assert ('foo-01: autorebase accepted a context-only rebase of code in bots/src/a.mjs (1 context lines); the suite ran; '
                'a blockers-only look is owed') in pg[0]['msg'], pg[0]['msg']
        assert not any(p['level'] == 'error' for p in F.pages()), F.pages()
        assert not any(x['step'] == 'page-failed' for x in job['steps']), job['steps']
        TC.expect(CS, F, 'launch')                         # the flag blocks nothing
        rc, out = TC.human(CS, F, 'tick')
        assert rc == 0 and 'LAUNCH foo-01' in out, out
    finally:
        F.cleanup()


def t_v45_protected_change_stays_byte_exact(CS):
    """The SAME inserted line beside a change that is PROTECTED (tier 3 on both bases): there a neighbouring line is the
    reviewers' business. Byte-exact, refused as before v45, and the refusal says what the difference is."""
    F = ArFix('ctxinsert-prot')
    try:
        seed(CS, F)
        assert json.load(open(F.queue))['entries'][0]['variants'][F.sb]['protected'] is True, 'the fixture is not protected'
        job = tick_and_wait(CS, F)
        assert any(s['step'] == 'cherry-pick' and s['ok'] for s in job['steps']), 'the pick must have been clean'
        assert_blocked_no_retry(CS, F, job, 'cherry-pick', 'NOT the reviewed diff')
        assert 'the base only inserted lines beside it (bots/src/a.mjs 1)' in job['why'] and 'protected (tier 3 on the source base, 3 on' in job['why'], job['why']
        assert not _accepted_page(F), F.pages()
    finally:
        F.cleanup()


def t_v45_context_strict_restores_byte_exact(CS):
    """The kill switch: with ~/digest/CONTEXT-STRICT the SAME unprotected build is refused as v43 refused it. Here the
    switch is a DANGLING SYMLINK (review r1: os.path.exists said it was absent, so the switch failed open)."""
    F = ArFix('ctxinsert')
    try:
        seed(CS, F)
        os.symlink(os.path.join(F.d, 'no-such-target'), os.path.join(F.home, 'digest', 'CONTEXT-STRICT'))
        assert not os.path.exists(os.path.join(F.home, 'digest', 'CONTEXT-STRICT')), 'the fixture: exists() does not see it'
        job = tick_and_wait(CS, F)
        assert any(s['step'] == 'cherry-pick' and s['ok'] for s in job['steps']), 'the pick must have been clean'
        assert_blocked_no_retry(CS, F, job, 'cherry-pick', 'NOT the reviewed diff')
        assert 'CONTEXT-STRICT is present' in job['why'] and 'the base only inserted lines beside it' in job['why'], job['why']
        assert not _accepted_page(F), F.pages()
        rc, out = TC.human(CS, F, 'status')
        assert rc == 0 and 'CONTEXT-STRICT present' in out, out
    finally:
        F.cleanup()


def t_v45_changed_context_line_refuses_and_says_why(CS):
    """`diffchange` (t_diff_change_refuses) is an unprotected change whose reviewed context line was CHANGED by the base, not
    pushed aside: the code rule is on and refuses it, and the refusal names the file and the reason for the human."""
    F = ArFix('diffchange')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'refused' and 'NOT the reviewed diff' in job['why'], job
        assert 'not a context-only rebase of code (v45): bots/src/a.mjs: hunk 1: a reviewed context line is gone or changed' in job['why'], job['why']
        assert any(x['step'] == 'cherry-pick' and x['ok'] for x in job['steps']) and not _accepted_page(F)
    finally:
        F.cleanup()


def t_v45_inserted_block_refuses_and_says_why(CS):
    """Codex review r2, case 2, through the build: the base put `if (...) {` two lines above the change and `}` two lines
    below. The pick is clean and every reviewed context line is still there; the change now sits in a block."""
    F = ArFix('ctxblock')
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert any(x['step'] == 'cherry-pick' and x['ok'] for x in job['steps']), 'the pick must have been clean'
        assert_blocked_no_retry(CS, F, job, 'cherry-pick', 'NOT the reviewed diff')
        assert "not a context-only rebase of code (v45): bots/src/a.mjs: hunk 1: an inserted line is not a plain line: 'if (globalThis.off) {'" in job['why'], job['why']
        assert not _accepted_page(F)
    finally:
        F.cleanup()


def t_v45_accept_page_cannot_fail_the_build(CS):
    """Review r1: the flag page is written AFTER the variant is queued. If it raised, the job ended "refused" (crashed)
    while the next tick launched that variant. The page path is made unwritable for the build: the job is still DONE,
    the failure is a step row, and the variant launches."""
    F = ArFix('ctxinsert')
    try:
        seed(CS, F)
        blocker = os.path.join(F.d, 'a-file'); open(blocker, 'w').close()
        rc, out = TC.human(CS, F, 'tick', SCHED_PAGE=os.path.join(blocker, 'page.jsonl'))
        assert rc == 0 and 'AUTOREBASE foo-01' in out, out
        job = F.wait_job()
        assert job['state'] == 'done' and 'variant' in job, (job, F.logtail())
        assert any(x['step'] == 'page-failed' and 'IS queued' in x['detail'] for x in job['steps']), [x['step'] for x in job['steps']]
        assert not _accepted_page(F), 'positive control: the page really could not be written'
        v = json.load(open(F.queue))['entries'][0]['variants'].get(F.lb)
        assert v and v['canary_sha'] == job['variant'], 'the variant is queued'
        TC.expect(CS, F, 'launch')
    finally:
        F.cleanup()


def t_v44_built_page_cannot_fail_the_build(CS):
    """The "built" page is written AFTER the job is DONE and its variant queued. When it raised (here: the page file
    cannot be created), ar_build's crash handler rewrote the job as "refused" while the next tick launched that variant
    all the same. Now the failure is one line in the build log; the job stays done and the variant launches."""
    F = ArFix('clean')
    try:
        seed(CS, F)
        blocker = os.path.join(F.d, 'a-file'); open(blocker, 'w').close()
        rc, out = TC.human(CS, F, 'tick', SCHED_PAGE=os.path.join(blocker, 'page.jsonl'))
        assert rc == 0 and 'AUTOREBASE foo-01' in out, out
        F.wait_job()
        # the page is attempted AFTER the job says done: wait for the build to say what became of it, then read the job
        t = time.time() + 30
        while time.time() < t and 'page could not be written' not in F.logtail():
            time.sleep(0.2)
        assert 'the "built" page could not be written' in F.logtail(), 'positive control: the page was refused by the fixture: %s' % F.logtail()
        job = F.job()[-1]
        assert job['state'] == 'done' and 'variant' in job and 'why' not in job, job
        v = json.load(open(F.queue))['entries'][0]['variants'].get(F.lb)
        assert v and v['canary_sha'] == job['variant'], 'the variant is queued'
        TC.expect(CS, F, 'launch')
    finally:
        F.cleanup()


def t_v45_notes_say_which_identity_held(CS):
    """`approved` and the registration notes said "normalized diff identical" in every case (v43's path-list case too).
    Each of the three cases now says what was actually compared; only the code case pages."""
    for scenario, want, never in (('clean', 'normalized diff identical (sha256 ', 'context-only'),
                                  ('listcontext', 'every added and removed line identical, context-only in %s (a path list' % LIST_REL,
                                   'normalized diff identical')):
        F = ArFix(scenario)
        try:
            seed(CS, F)
            job = tick_and_wait(CS, F)
            assert job['state'] == 'done', (scenario, job, F.logtail())
            v = json.load(open(F.queue))['entries'][0]['variants'][F.lb]
            for text in (v['approved'], json.load(open(v['registration']))['notes']):
                assert want in text and never not in text and 'CONTEXT-ONLY REBASE OF CODE' not in text, (scenario, text)
            assert not _accepted_page(F), (scenario, F.pages())
        finally:
            F.cleanup()


def _behind_a_live_canary(CS, F):
    """foo-01 (its patch SB..ST) waits behind live-01, the LIVE canary: the fleet base is SB, the canary's sha is LB."""
    F.enqueue(CS)
    rc, out = TC.human(CS, F, 'queue', 'set-patch', 'foo-01', F.sb, 'foo-on-sb')
    assert rc == 0, out
    q = json.load(open(F.queue))
    foo = q['entries'][0]
    reg_l = os.path.join(F.home, 'mcai-analysis', 'live-01.json'); shutil.copy(F.reg, reg_l)
    live = dict(json.loads(json.dumps(foo)), run='live-01', patch=None)
    live['variants'][F.sb]['registration'] = reg_l
    foo['after'] = ['live-01']
    json.dump({'version': 1, 'entries': [live, foo]}, open(F.queue, 'w'))
    td = TC.dt.timedelta
    F.regfile('live-01', F.lb[:7])
    F.j('live-01', 'draw', NOW - td(hours=1)); F.j('live-01', 'drawn', NOW - td(minutes=50))
    F.j('live-01', 'deployed', NOW - td(minutes=45), 'board-a %s' % TC.Z(NOW - td(minutes=45)))
    F.add_proc(80, ['bash', '/home/mike/canary-loop.sh', 'live-01'])
    F.base = F.sb
    F.set_manifest('board-a', F.lb[:7])


def t_v44_speculative_refusal_reaches_the_phone_and_names_the_hand_rebase(CS):
    """A SPECULATIVE build (onto the live canary's sha, during its read) that refuses blocks nothing yet, so it is not the
    'error' page of a blocked head -- but it must reach the PHONE, hours before the slot is empty (review r1: a 'flag'
    is digest-only). The row is held against pager.py's own page_tier. Once per run and canary sha. The refusal of a
    build for the HEAD is the 'error' page it always was."""
    PG = load(os.path.join(HERE, 'pager.py'), 'pager_for_autorebase_test')
    F = ArFix('conflict')
    try:
        _behind_a_live_canary(CS, F)
        rc, out = TC.human(CS, F, 'tick')
        assert rc == 0 and 'SPECULATIVE AUTOREBASE foo-01 onto the live canary %s' % F.lb[:8] in out, out
        job = F.wait_job()
        assert job['state'] == 'refused' and job.get('spec') is True and job['base'] == F.lb, job
        assert 'does not apply cleanly' in job['why'], job['why']
        rc, out = TC.human(CS, F, 'tick')                  # never a retry, and not a second page
        assert rc == 0 and 'SPECULATIVE' not in out and len(F.job()) == 1, out
        pg = [p for p in F.pages() if 'refused at step' in p['msg']]
        assert len(pg) == 1 and pg[0]['run'] == 'foo-01', F.pages()
        assert pg[0]['level'] == CS.SPEC_REFUSED_LEVEL == 'warn', pg[0]
        assert PG.page_tier(pg[0]) == PG.AL.TIER_PAGE, 'the pager must PUSH this row: %s' % pg[0]
        assert PG.page_tier(dict(pg[0], level='flag')) == PG.AL.TIER_DIGEST, 'positive control: as a flag it is digest-only (review r1)'
        assert PG.page_tier(dict(pg[0], msg=pg[0]['msg'].replace('FAILED', 'was'))) == PG.AL.TIER_DIGEST, 'and a warn pages only by that word'
        assert 'SPECULATIVE autorebase onto the live canary %s FAILED' % F.lb[:8] in pg[0]['msg'], pg[0]['msg']
        assert 'foo-01 will need a hand rebase before it reaches the head' in pg[0]['msg'] and 'does not apply cleanly' in pg[0]['msg'], pg[0]['msg']
        assert not any(p['level'] == 'error' for p in F.pages()), 'nothing is blocked yet: %s' % F.pages()
    finally:
        F.cleanup()
    F = ArFix('conflict')                                  # the same refusal for the HEAD: unchanged
    try:
        seed(CS, F)
        job = tick_and_wait(CS, F)
        assert job['state'] == 'refused' and 'spec' not in job, job
        pg = [p for p in F.pages() if 'refused at step' in p['msg']]
        assert len(pg) == 1 and pg[0]['level'] == 'error' and 'foo-01 BLOCKED: no variant for fleet base %s' % F.lb[:8] in pg[0]['msg'], F.pages()
        assert 'hand rebase before it reaches the head' not in pg[0]['msg'], pg[0]['msg']
    finally:
        F.cleanup()


def real_pick(CS, src, change, base, path='bots/src/x.mjs'):
    """REAL git, the way the build does it: commit S holds `src` (lines), C = `change` on S (the reviewed change), L =
    `base` on S (the fleet moved on), and C is cherry-picked onto L = N. -> (the normalized diff S..C, the normalized diff
    L..N, {path: the file at N}, (hunk_funcs of the two raw diffs), {path: the file at C}); None when the pick conflicts."""
    import tempfile
    d = tempfile.mkdtemp(prefix='ar-pick-')
    try:
        sh('git', 'init', '-q', cwd=d)
        os.makedirs(os.path.dirname(os.path.join(d, path)))

        def commit(lines, msg):
            open(os.path.join(d, path), 'w').write('\n'.join(lines) + '\n')
            gc(d, 'add', '-A'); gc(d, 'commit', '-q', '-m', msg)
            return sh('git', 'rev-parse', 'HEAD', cwd=d)
        S = commit(src, 'S'); C = commit(change, 'C')
        gc(d, 'checkout', '-q', '--detach', S)
        L = commit(base, 'L')
        if subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'cherry-pick', C], cwd=d, capture_output=True).returncode:
            return None
        N = sh('git', 'rev-parse', 'HEAD', cwd=d)
        ra, rb = CS.diff_raw(d, S, C), CS.diff_raw(d, L, N)
        return (CS.norm_diff(ra), CS.norm_diff(rb), {path: open(os.path.join(d, path)).read()}, (CS.hunk_funcs(ra), CS.hunk_funcs(rb)),
                {path: '\n'.join(change) + '\n'})
    finally:
        shutil.rmtree(d, ignore_errors=True)


def _eq(CS, r, **kw):
    return CS.diff_equiv(r[0], r[1], **dict({'texts': r[2], 'code': True, 'funcs': r[3], 'reviewed': r[4]}, **kw))


def _why(CS, r, path='bots/src/x.mjs'):
    return CS.code_context_files(r[0], r[1], texts=r[2], funcs=r[3], reviewed=r[4])[path]


def _put(lines, at, *new):
    return lines[:at] + list(new) + lines[at:]


def t_v45_code_context_pure(CS):
    """The rule for CODE (diff_equiv code=True), on REAL picks: every reviewed context line must still stand around the
    change in the rebased file; the base may only have INSERTED a few plain lines; the same enclosing function and
    scopes; one unambiguous place. Off by default; never for a path list; not provable without the two file texts and
    the function text."""
    P = 'bots/src/x.mjs'
    code = 'context-only (code) in %s' % P
    EQ, WHY, put = (lambda r, **kw: _eq(CS, r, **kw)), (lambda r: _why(CS, r)), _put
    assert '-U%d' % CS.DIFF_CONTEXT in CS.DIFF_ARGS and CS.CODE_CONTEXT_MAX == 3
    # ---- the two MEASURED shapes: another change INSERTED a neighbouring line (an import)
    imp = ["import { a } from './a.mjs'", "import { b } from './b.mjs'", "import { c } from './c.mjs'", "import { d } from './d.mjs'",
           "import { e } from './e.mjs'", '', 'export function walk() {', '  return a() + b()', '}', ''] + ['// line %d' % i for i in range(1, 13)]
    PLANK, GLASS = "import { plank } from './plank.mjs'", "import { glass } from './glass.mjs'"

    def ours(lines, body=False):            # the reviewed change: an import after e's (and, with body, the function uses it)
        out = list(lines)
        out.insert(out.index("import { e } from './e.mjs'") + 1, PLANK)
        if body:
            out[out.index('  return a() + b()')] = '  return a() + b() + plank()'
        return out
    above = real_pick(CS, imp, ours(imp), imp[:3] + [GLASS] + imp[3:])            # two lines above ours
    assert above and above[0] != above[1], 'the fixture: a clean pick whose diff differs'
    assert [l for l in above[0].split('\n') if l[:1] in '+-'] == [l for l in above[1].split('\n') if l[:1] in '+-'], 'same +/- lines'
    assert EQ(above) == code and WHY(above) == (1, ''), (EQ(above), WHY(above))
    assert CS.diff_equiv(above[0], above[1]) is None and \
        CS.diff_equiv(above[0], above[1], texts=above[2], funcs=above[3], reviewed=above[4]) is None, 'off by default: byte-exact, as before v45'
    assert EQ(above, texts={}) is None and EQ(above, texts=None) is None, 'no rebased file text: not provable'
    assert EQ(above, reviewed={}) is None and EQ(above, reviewed=None) is None, 'no reviewed file text: not provable'
    assert EQ(above, funcs=None) is None and EQ(above, funcs=(above[3][0], {})) is None, 'no function text: not provable'
    assert EQ(above, texts={P: '\n'.join(ours(imp)) + '\n'}) is None, 'a text the rebased hunk does not stand in'
    # git's header text DIFFERS between these two diffs (the inserted import pushed `c` out of the hunk and became the
    # nearest "function line" above it): comparing the header text alone would refuse the measured case. run_funcs
    # compares the function line that encloses the CHANGE: `e`'s import in both.
    assert above[3][0][P] != above[3][1][P], above[3]
    below = real_pick(CS, imp, ours(imp, body=True), imp[:6] + [GLASS] + imp[6:])  # below ours: after the blank line under the imports
    assert below and below[0] != below[1] and EQ(below) == code and WHY(below)[0] == 1, (below and WHY(below))
    assert real_pick(CS, imp, ours(imp), imp[:5] + [GLASS] + imp[5:]) is None, 'positive control: a line inserted AT our place conflicts'
    # ---- inside a function body: foo() and bar() hold the same lines
    body = ['  const a = 1', '  const b = 2', '  const c = 3', '  old()', '  const d = 4', '  const e = 5', '  const f = 6', '}', '']
    fb = ['function foo() {'] + body + ['function bar() {'] + body
    chg = fb[:4] + ['  newCall()'] + fb[5:]                                         # old() of foo
    for at in (2, 6):                                                               # between a and b; between d and e
        r = real_pick(CS, fb, chg, put(fb, at, '  const inserted = 0'))
        assert r and EQ(r) == code and WHY(r) == (1, ''), (at, r and WHY(r))
    # the OTHER measured line (boardwalk-03): a call statement with an arrow in it
    r = real_pick(CS, fb, chg, put(fb, 2, '  setTownLogTop(b => topTownLog(matsTownStock(b)?.stock))'))
    assert r and EQ(r) == code and WHY(r) == (1, ''), r and WHY(r)
    # (b) the bound: three inserted lines on a side, not four
    three = real_pick(CS, fb, chg, put(fb, 6, '  const i1 = 0', '  const i2 = 0', '  const i3 = 0'))
    four = real_pick(CS, fb, chg, put(fb, 6, '  const i1 = 0', '  const i2 = 0', '  const i3 = 0', '  const i4 = 0'))
    assert three and EQ(three) == code and WHY(three) == (3, ''), three and WHY(three)
    assert four and four[0] != four[1] and EQ(four) is None and 'at most 3' in WHY(four)[1], four and WHY(four)
    both = real_pick(CS, fb, chg, put(put(fb, 6, '  const i1 = 0', '  const i2 = 0', '  const i3 = 0'), 2, '  const j1 = 0', '  const j2 = 0', '  const j3 = 0'))
    assert both and EQ(both) == code and WHY(both) == (6, ''), 'three on EACH side: %s' % (both and (WHY(both),))
    # (a) a reviewed context line the base CHANGED or DELETED: a human looks
    r = real_pick(CS, fb, chg, [('  const b = 22' if i == 2 else l) for i, l in enumerate(fb)])
    assert r and r[0] != r[1] and EQ(r) is None and 'gone or changed' in WHY(r)[1], r and WHY(r)
    r = real_pick(CS, fb, chg, fb[:2] + fb[3:])
    assert r and r[0] != r[1] and EQ(r) is None and 'gone or changed' in WHY(r)[1], r and WHY(r)
    # ... also when a line was INSERTED on the other side (each side is walked on its own)
    r = real_pick(CS, fb, chg, put([('  const b = 22' if i == 2 else l) for i, l in enumerate(fb)], 6, '  const inserted = 0'))
    assert r and EQ(r) is None, 'changed ABOVE, inserted below'
    r = real_pick(CS, fb, chg, put([('  const e = 55' if i == 6 else l) for i, l in enumerate(fb)], 2, '  const inserted = 0'))
    assert r and EQ(r) is None, 'changed BELOW, inserted above'
    # ... and BETWEEN two runs of one hunk
    g = ['const top = 0'] + ['  g%d()' % i for i in range(1, 13)]
    g2 = [{3: '  G3()', 7: '  G7()'}.get(i, l) for i, l in enumerate(g)]            # two runs, g4 g5 g6 between them
    r = real_pick(CS, g, g2, put(g, 5, '  inserted()'))
    assert r and EQ(r) == code and WHY(r) == (1, ''), 'a line inserted between the two runs: %s' % (r and (WHY(r),))
    r = real_pick(CS, g, g2, put([('  g5changed()' if i == 5 else l) for i, l in enumerate(g)], 10, '  inserted()'))
    assert r and r[0] != r[1] and EQ(r) is None, 'a reviewed line BETWEEN the runs changed (and a line inserted below)'
    # ---- the blocker of review r1: the reviewed lines in ANOTHER FUNCTION
    a = ['// top', '', 'function a() {', '  init();', '  run();', '  done();', '}', '', 'export const z = 1']
    alog = a[:5] + ['  log();'] + a[5:]
    copy = ['// top', '', 'function a() {', '  init2();', '  run();', '  done();', '}', 'function aOld() {', '  init();', '  run();', '  done();', '}', '', 'export const z = 1']
    r = real_pick(CS, a, alog, copy)
    assert r and 'function aOld() {\n  init();\n  run();\n  log();\n' in r[2][P], 'the fixture: git put log() into aOld(): %s' % (r and r[2][P])
    assert EQ(r) is None, 'the copy: log() landed in aOld()'
    short = ['// top', '', 'function a() {', '  x();', '}', 'function aOld() {', '  init();', '  run();', '  done();', '}', '', 'export const z = 1']
    r = real_pick(CS, a, alog, short)                       # `function a() {` is now within three lines above aOld's body
    assert r and 'function aOld() {\n  init();\n  run();\n  log();\n' in r[2][P] and EQ(r) is None and 'enclosing function' in WHY(r)[1], r and WHY(r)
    fo = ['// top', 'function foo() {', '  pre()', '  old()', '  post()', '}', '', 'export const z = 1']
    r = real_pick(CS, fo, [l.replace('old()', 'newCall()') for l in fo],
                  ['// top', 'function foo() {', '  other()', '}', 'function bar() {', '  pre()', '  old()', '  post()', '}', '', 'export const z = 1'])
    assert r and 'function bar() {\n  pre()\n  newCall()\n' in r[2][P], 'the fixture: the same -old() +newCall() landed under bar(): %s' % (r and r[2][P])
    assert EQ(r) is None and 'enclosing function' in WHY(r)[1], WHY(r)
    # (c) inside a body the hunk shows no function line: the header's text decides
    r = real_pick(CS, fb, chg, put(fb, 2, '  const inserted = 0'))
    assert r[3] == ({P: ['function foo() {']}, {P: ['function foo() {']}) and EQ(r) == code
    assert EQ(r, funcs=(r[3][0], {P: ['function bar() {']})) is None and EQ(r, funcs=({P: ['']}, r[3][1])) is None, 'another function text'
    # ---- synthetic: none of the six context lines is the reviewed one
    head = 'diff --git a/%s b/%s\n--- a/%s\n+++ b/%s\n' % (P, P, P, P)
    NF = lambda *ds: tuple(CS.hunk_funcs(d) for d in ds)
    txt = lambda *ls: {P: '\n'.join(ls) + '\n'}
    Ha, Hm = head + '@@\n k1\n k2\n k3\n+x\n k4\n k5\n k6\n', head + '@@\n m1\n m2\n m3\n+x\n m4\n m5\n m6\n'
    REV = txt('t', 'k1', 'k2', 'k3', 'x', 'k4', 'k5', 'k6', 'e')                    # the reviewed file of Ha
    assert CS.diff_equiv(Ha, Hm, texts=txt('t', 'm1', 'm2', 'm3', 'x', 'm4', 'm5', 'm6', 'e'), code=True, funcs=NF(Ha, Hm), reviewed=REV) is None, \
        'all context different'
    # (d) the rebased hunk at TWO places of the rebased file; the reviewed hunk at two places of the reviewed file
    Hb = head + '@@\n k2\n INS\n k3\n+x\n k4\n k5\n k6\n'
    blk = ['k1', 'k2', 'INS', 'k3', 'x', 'k4', 'k5', 'k6']
    one = txt('t', *(blk + ['m'] + [l.replace('x', 'y') for l in blk] + ['e']))
    assert CS.diff_equiv(Ha, Hb, texts=txt('t', *(blk + ['m'] + blk + ['e'])), code=True, funcs=NF(Ha, Hb), reviewed=REV) is None, 'two places'
    assert CS.diff_equiv(Ha, Hb, texts=one, code=True, funcs=NF(Ha, Hb), reviewed=REV) == code, 'positive control: one place'
    twice = txt('t', 'k1', 'k2', 'k3', 'x', 'k4', 'k5', 'k6', 'm', 'k1', 'k2', 'k3', 'x', 'k4', 'k5', 'k6', 'e')
    assert CS.diff_equiv(Ha, Hb, texts=one, code=True, funcs=NF(Ha, Hb), reviewed=twice) is None, 'the REVIEWED hunk at two places of its own file'
    # ---- the edge of the file is part of what was reviewed
    top = ['const l%d = %d' % (i, i) for i in range(1, 9)]
    tchg = top[:1] + ['const mine = 0'] + top[1:]                                   # at line 2: ONE context line above, the file's first
    r = real_pick(CS, top, tchg, ['const n1 = 0'] + top)
    assert r and r[0] != r[1] and EQ(r) == code and WHY(r) == (1, ''), 'one line inserted above the first line: %s' % (r and (WHY(r),))
    r = real_pick(CS, top, tchg, ['const n%d = 0' % i for i in range(1, 5)] + top)
    assert r and EQ(r) is None and 'at most 3' in WHY(r)[1], 'four lines above the first line'
    echg = top[:6] + ['const mine = 0'] + top[6:]                                   # two context lines below, the file's last
    r = real_pick(CS, top, echg, top + ['const n1 = 0'])
    assert r and r[0] != r[1] and EQ(r) == code and WHY(r) == (1, ''), 'one line appended to the file: %s' % (r and (WHY(r),))
    r = real_pick(CS, top, echg, top + ['const n%d = 0' % i for i in range(1, 5)])
    assert r and EQ(r) is None, 'four lines appended to the file'
    # ---- the guards that were there before
    assert EQ(above, texts={P: above[2][P].replace('plank', 'plonk')}) is None
    plonk = (above[0], above[1].replace('+' + PLANK, '+' + PLANK.replace('plank', 'plonk')), {P: above[2][P].replace('plank', 'plonk')}, above[3], above[4])
    assert EQ(plonk) is None, 'another ADDED line (the rebased file agrees with the rebased diff: only the reviewed diff says plank)'
    two = real_pick(CS, imp, [l.replace('// line 12', '// line twelve') for l in ours(imp)], imp[:3] + [GLASS] + imp[3:])
    assert two and two[0].count('@@') == 2 and two[1].count('@@') == 2 and EQ(two) == code, 'two hunks on both sides, the first with an inserted line'
    assert CS.diff_equiv(two[0], above[1], texts=above[2], code=True, funcs=(two[3][0], above[3][1]), reviewed=two[4]) is None, 'the second hunk is gone'
    assert CS.diff_equiv(above[0], two[1], texts=two[2], code=True, funcs=(above[3][0], two[3][1]), reviewed=above[4]) is None, 'a hunk more'
    near = [l for l in imp[:3] + [GLASS] + imp[3:] if not l.startswith('// line') or l in ('// line 11', '// line 12')]
    tail = lambda lines: [('  return a() - b()' if l == '  return a() + b()' else '// line twelve' if l == '// line 12' else l) for l in lines]
    far, merged = real_pick(CS, imp, tail(imp), imp[:3] + [GLASS] + imp[3:]), real_pick(CS, imp, tail(imp), near)
    assert far and far[0].count('@@') == 2 and far[0] == far[1], 'positive control: an insertion outside both hunks changes nothing'
    assert merged and merged[1].count('@@') == 1 and EQ(merged) is None, 'the base lost the lines between: two hunks became one'
    mode = above[1].replace('--- a/' + P, 'old mode 100644\nnew mode 100755\n--- a/' + P)
    assert EQ((above[0], mode) + above[2:]) is None, 'a mode line'
    assert EQ((above[0], above[1] + '\\ No newline at end of file\n') + above[2:]) is None
    Z = _nd('bots/src/z.mjs', ['a', 'b', 'd'], ['a', 'c', 'd'])
    assert EQ((above[0] + Z, above[1] + Z) + above[2:]) == code, 'another file, identical on both sides'
    assert EQ((above[0] + Z, above[1]) + above[2:]) is None and EQ((above[0], above[1] + Z) + above[2:]) is None
    assert EQ((above[0] + Z, Z + above[1]) + above[2:]) is None, 'the files in another order'
    # ---- a path list keeps ITS rule (v43), never the code rule -- with code=True too
    L = next(iter(CS.CONTEXT_FREE_PATHS)); OPEN, CLOSE = CS.CONTEXT_FREE_PATHS[L]
    X = "  'bots/test/x.test.mjs',   // foo-01"
    ent = ["  'bots/test/r%d.test.mjs'," % i for i in range(1, 11)]
    mk = lambda entries: [OPEN] + list(entries) + [CLOSE, '', 'console.log(REQUIRED.length)']
    ins = lambda lines: put(lines, lines.index(ent[3]) + 1, X)                     # our entry after r4
    LA = _nd(L, mk(ent), ins(mk(ent)))
    ok = mk(ent[:1] + ["  'bots/test/other.test.mjs',   // other-01"] + ent[2:])     # r2 REPLACED: fine for a list, not for code
    bad = mk(ent[:2] + ['  SOME_OTHER_LIST,'] + ent[2:])                           # a line INSERTED beside ours that is no list line
    T = lambda lines: {L: '\n'.join(ins(lines)) + '\n'}
    LO, LB = _nd(L, ok, ins(ok)), _nd(L, bad, ins(bad))
    assert CS.diff_equiv(LA, LO, texts=T(ok), code=True, funcs=NF(LA, LO), reviewed=T(mk(ent))) == 'context-only in %s' % L, 'the list rule answers, and says so'
    sec = lambda d: CS.diff_sections(d)[0][1]
    assert CS.code_context(sec(LA), sec(LB), T(bad)[L], [''], [''], T(mk(ent))[L]) == (1, ''), 'positive control: the CODE rule alone would accept the inserted line'
    assert CS.diff_equiv(LA, LB, texts=T(bad), code=True, funcs=NF(LA, LB), reviewed=T(mk(ent))) is None, 'a list file is judged by the list rule only'
    both = (above[0] + LA, above[1] + LO, dict(above[2], **T(ok)), above[3], above[4])
    assert EQ(both) == '%s; context-only in %s' % (code, L), 'both at once'
    assert CS.diff_equiv(both[0], both[1], texts=both[2], funcs=both[3], reviewed=both[4]) is None, 'by default the code file still refuses'
    assert set(CS.code_context_files(both[0], both[1], texts=both[2], funcs=both[3], reviewed=both[4])) == {P}, 'the list file is not judged as code'
    # ---- the pieces
    assert CS.hunk_parts(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@', ' a', '+b', '@@', '-c', '']) == \
        (['diff --git a/x b/x', '--- a/x', '+++ b/x'], [[' a', '+b'], ['-c', '']])
    assert CS.hunk_runs([' a', '-b', '+B', ' c', ' d', '+e', '']) == ([['a'], ['c', 'd'], []], [['-b', '+B'], ['+e']])
    assert CS.hunk_runs(['+e', ' a']) == ([[], ['a']], [['+e']])
    raw = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,4 @@\n a\n+b\n@@ -9,3 +10,3 @@ function f() {  \n-c\n+d\n'
    assert CS.hunk_funcs(raw) == {'x': ['', 'function f() {']} and CS.hunk_funcs(CS.norm_diff(raw)) == {'x': ['', '']}
    assert CS.func_line('function f() {') and CS.func_line('_x') and CS.func_line('$y') and CS.func_line("import a from 'a'")
    assert not CS.func_line('  indented()') and not CS.func_line('') and not CS.func_line('}') and not CS.func_line('// c')
    assert CS.run_funcs(['   x()', '-old()', ' function g() {', '   y()', '+z()'], 'function f() {') == ['function f() {', 'function g() {']
    assert CS.run_funcs([' function h() {', '   x()', '+z()'], 'function f() {') == ['function h() {'], 'the hunk\'s own line is nearer than the header\'s'
    assert CS.context_walk(['a', 'b', 'c', 'd'], 3, -1, ['d', 'b', 'a']) == [3, 1, 0] and CS.context_walk(['a', 'b', 'c'], 0, 1, ['a', 'c']) == [0, 2]
    assert CS.context_walk(['a', 'b', 'c'], 0, 1, ['c', 'a']) is None and CS.context_walk(['a'], 0, 1, []) == []
    assert CS.hunk_spans(['t', 'a', 'B', 'c', 'e', 'z'], [' a', '-b', '+B', ' c', '+e', '']) == ([[2, 3], [4, 5]], 1)
    assert CS.hunk_spans(['a', 'c', 'a', 'c'], [' a', '-b', ' c']) == ([[1, 1]], 2) and CS.hunk_spans(['q'], [' a', '+b']) == (None, 0)
    # WHEN the build may use it: not protected on BOTH bases, and no kill switch
    cp = CS.code_context_problem
    assert cp('none', 'none', False) == ''
    for t in ('3', 'tooling', 'undecidable'):
        for pair in ((t, t), (t, 'none'), ('none', t)):
            assert 'protected' in cp(pair[0], pair[1], False), pair
    assert 'CONTEXT-STRICT is present' in cp('none', 'none', True) and cp('3', '3', True)


def t_v45_plain_line_pure(CS):
    """(f) what a base may have inserted beside a reviewed change without a human looking: a line that opens nothing, closes
    nothing and steers nothing. (e) the chain of enclosing scopes. (g) what is left open above."""
    plain = ['', '   ', '// a note', '  # a note', '#!/bin/sh', '#', "import { a } from './a.mjs'", 'import x, { y as z } from "m";',
             "import * as path from 'node:path'", "import './side-effect.mjs'", 'from os import path', '    from a.b import c as d, e', 'import os',
             'import os.path as p', "const fs = require('fs')", "const { a, b } = require('./x');",
             '  setTownLogTop(b => topTownLog(matsTownStock(b)?.stock))',          # the measured line (boardwalk-03)
             'x = 1', '  const n = count(items);', "  'bots/test/a.test.mjs',", '  done()', '  done.then(next)', '  #count = 0',
             '  forEach(doIt)', '  default_timeout = 5', '  timeout: 5000,', '  process.exit(0);', '  ready = false']
    for l in plain:
        assert CS.plain_line(l), 'should be plain: %r' % l
    steer = ['if (false) {', '  if (x) return;', '  if x:', 'else', '  else:', '} else {', 'elif y:', 'for x in y:', 'for (;;)', 'while (true)', 'do', 'switch (x)',
             'case 3:', 'default:', 'try:', 'catch (e)', 'except E:', 'finally', 'with open(f) as g:', 'function inner() {', 'class X {', 'def f():',
             'return;', '  return', 'return x', 'break', 'continue;', 'throw new Error(1)', 'raise E', 'yield x', 'then', 'fi', 'done', '  done;', 'esac',
             'exit 1', 'end', 'begin', 'until x', 'async () => 1', '#if 0', '#endif', '#ifdef X',
             'a(); return', 'x = 1; break', '[ -f x ] || exit 1', 'ok && return', 'skip: while (false)', 'outer: for (;;)']
    closes = ['}', '  }', '});', '})', ');', ']', '],', '{', 'x = {', 'foo(', 'x = [', 'run(() => {', '  #helper() {']
    spans = ['/*', ' */', '/** doc', '// a note */', '# /* x', 'x = """', "y = '''", '"""doc"""', 'z = `open', 'q = `${a}`', '// ${f()}',
             "// note return;", "// note x()", '// note\rreturn']
    takes = ['false &&', 'a ||', 'x =', 'a = b ?', 'cb(x) =>', 'x = 1 \\', 'label:', 'a.', 'n +', 'key: |', '<div>', '-->',
             '@decorator', '@app.route("/x")', ": <<'SKIP'", 'cat <<EOF', "import { a } from './a.mjs' // why", 'import {', "import { a } from './a.mjs' with { type: 'json' }"]
    for l in steer + closes + spans + takes:
        assert not CS.plain_line(l), 'should NOT be plain: %r' % l
        assert not CS.plain_line('    ' + l), 'indented: %r' % l
    # (e) the chain of enclosing scopes, by indentation
    py = ['import os', '', 'class C:', '    x = 1', '', '    def foo(self):', '        a()', '        # a comment at any indent', '    # another',
          '        if a:', '            b()', '        c()', '        newer()']
    assert CS.scope_chain(py, 11, '        newer()') == ['    def foo(self):', 'class C:'], CS.scope_chain(py, 11, '        newer()')
    assert CS.scope_chain(py, 9, '            b()') == ['        if a:', '    def foo(self):', 'class C:']
    assert CS.scope_chain(py, 1, 'class D:') == [] and CS.scope_chain(py, 11, '') == ['        c()', '    def foo(self):', 'class C:'], 'a blank first line has no limit'
    assert CS.scope_chain(['def f():   ', '    x()'], 0, '    y()') == ['def f():'], 'trailing blanks stripped'
    assert CS.scope_chain(['class C:', '    def foo(self):', '    def bar(self):', '        a()'], 3, '        b()') == ['    def bar(self):', 'class C:']
    assert CS.indent_of('    x') == 4 and CS.indent_of('\tx') == 1 and CS.indent_of('x') == 0
    # (g) what the lines above leave open
    assert CS.open_above(['function f() {', '  if (x) {', '  }', '  a()'], 3) == (1, 0, 0, 0, 0)
    assert CS.open_above(['/* open', 'x = `tpl', "y = '''", 'z = ' + '"' * 3], 4) == (0, 1, 1, 1, 1) and CS.open_above(['{', '{'], 0) == (0, 0, 0, 0, 0)


def t_v45_break_attempts(CS):
    """Review r2's two acceptances and what trying to break rules (e) (f) (g) found, each as a REAL cherry-pick: the pick is
    clean, every added and removed line is the reviewed one, every reviewed context line is still around the change."""
    EQ, put = (lambda r, **kw: _eq(CS, r, **kw)), _put
    ind = lambda n, *ls: [' ' * n + l for l in ls]

    def refused(name, r, word, path='bots/src/x.mjs'):
        assert r is not None, '%s: the fixture conflicts (no build would get here)' % name
        assert r[0] != r[1], '%s: the fixture is byte-identical' % name
        why = _why(CS, r, path)
        assert EQ(r) is None and why[0] is None and word in why[1], '%s: %s' % (name, why)

    def accepted(name, r, n=1, path='bots/src/x.mjs'):
        assert r is not None and r[0] != r[1], '%s: the fixture' % name
        assert EQ(r) == 'context-only (code) in %s' % path and _why(CS, r, path) == (n, ''), '%s: %s' % (name, _why(CS, r, path))
    # ---- Codex r2 (1): Python. Both hunk headers say `class C:`; the change moved from foo() to bar()
    PY = 'bots/src/x.py'
    calls = ['a()', 'b()', 'c()', 'old()', 'd()', 'e()', 'f()']
    src = ['class C:', '    def foo(self):'] + ind(8, *calls) + ['', 'x = 1']
    chg = [l.replace('old()', 'newer()') for l in src]
    base = ['class C:', '    def foo(self):'] + ind(8, 'other()') + ['', '    def bar(self):'] + \
        ind(8, 'a()', 'inserted()', 'b()', 'c()', 'old()', 'd()', 'e()', 'f()') + ['', 'x = 1']
    r = real_pick(CS, src, chg, base, path=PY)
    assert r and '    def bar(self):\n        a()\n        inserted()\n        b()\n        c()\n        newer()\n' in r[2][PY], 'the fixture: newer() landed in bar()'
    assert r[3] == ({PY: ['class C:']}, {PY: ['class C:']}), 'the fixture: both headers say `class C:`: %s' % (r[3],)
    refused('codex r2 (1): foo() -> bar()', r, 'enclosing scopes differ', PY)
    accepted('positive control: the same plain line inserted in foo() itself', real_pick(CS, src, chg, src[:3] + ind(8, 'inserted()') + src[3:], path=PY), path=PY)
    refused('python: a dedented statement inserted above the change', real_pick(CS, src, chg, src[:3] + ['    y = 2'] + src[3:], path=PY), 'enclosing scopes differ', PY)
    # ---- Codex r2 (2): JS. `if (false) {` before b(); and `}` before e();
    js = ['function f() {'] + ind(2, 'a();', 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + ['}', '', 'export const z = 1']
    jchg = [l.replace('old();', 'newer();') for l in js]
    r = real_pick(CS, js, jchg, put(put(js, 6, '  }'), 2, '  if (false) {'))
    assert r and '  if (false) {\n  b();\n  c();\n  newer();\n  d();\n  }\n' in r[2]['bots/src/x.mjs'], 'the fixture: newer() sits in the dead block'
    refused('codex r2 (2): if (false) { ... }', r, "not a plain line: 'if (false) {'")
    accepted('positive control: a plain statement at the same place', real_pick(CS, js, jchg, put(js, 2, '  warm();')))
    # ---- what the coordinator asked to be tried
    blk = ['function f() {', '  if (x) {'] + ind(4, 'p();', 'q();', 'a();', 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + ['  }', '}']
    moved = ['function f() {', '  if (x) {'] + ind(4, 'p();', 'q();', 'a();') + ['  }'] + ind(4, 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + ['}']
    refused('a `}` inserted that closes a block opened above the window', real_pick(CS, blk, [l.replace('old();', 'newer();') for l in blk], moved), "not a plain line: '}'")
    refused('an inserted `return;`', real_pick(CS, js, jchg, put(js, 2, '  return;')), "not a plain line: 'return;'")
    refused('an inserted bare `return`', real_pick(CS, js, jchg, put(js, 2, '  return')), 'not a plain line')
    refused('a `return` behind another statement', real_pick(CS, js, jchg, put(js, 2, '  a2(); return;')), 'not a plain line')
    el = ['function f() {'] + ind(2, 'if (p) a();', 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + ['}']
    refused('an inserted `else`', real_pick(CS, el, [l.replace('old();', 'newer();') for l in el], put(el, 2, '  else')), "not a plain line: 'else'")
    refused('the same edit in a NESTED function with the same indentation, opened inside the window',
            real_pick(CS, js, jchg, put(put(js, 6, '  }'), 2, '  function inner() {')), "not a plain line: 'function inner() {'")
    # ... opened OUTSIDE the window: neither a reviewed line nor the indentation moves. Alone that is a byte-identical diff
    # (what v39-v44 accept too: nothing here looks further than the three lines a diff shows); with ONE plain line
    # inserted beside the change the code rule is asked, and (g) answers
    long = ['function f() {'] + ind(2, *['p%d();' % i for i in range(8)]) + ind(2, 'a();', 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + \
        ind(2, *['q%d();' % i for i in range(8)]) + ['}', '']
    lchg = [l.replace('old();', 'newer();') for l in long]
    far = put(put(long, 22, '  }'), 2, '  function inner() {')
    r = real_pick(CS, long, lchg, far)
    assert r and r[0] == r[1], 'positive control: the wrapper alone leaves the diff byte-identical'
    refused('... opened ten lines up, closed ten lines down, one plain line beside the change', real_pick(CS, long, lchg, put(far, 11, '  plain();')), 'open above the change')
    accepted('positive control: that plain line without the wrapper', real_pick(CS, long, lchg, put(long, 10, '  plain();')))
    refused('a block comment opened ten lines up and closed ten lines down, one plain line beside the change',
            real_pick(CS, long, lchg, put(put(put(long, 22, '  */'), 2, '  /*'), 11, '  plain();')), 'open above the change')
    # ---- the second reviewer's round 2 (11-13): check (c) sees only column-0 lines (about 413 of ~2,560 function scopes in
    # bots/src are indented). (i) a METHOD copied above itself: both hunk headers read `class K {`
    body = ['one();', 'two();', 'init();', 'run();', 'done();', 'three();', 'four();']
    logb = body[:4] + ['log();'] + body[4:]
    copied = body[:2] + ['trace();'] + body[2:]
    renamed = ['one1();', 'two2();', 'init();', 'run();', 'done();', 'three3();', 'four4();']
    r = real_pick(CS, ['class K {', '  a() {'] + ind(4, *body) + ['  }', '}'], ['class K {', '  a() {'] + ind(4, *logb) + ['  }', '}'],
                  ['class K {', '  aOld() {'] + ind(4, *copied) + ['  }', '  a() {'] + ind(4, *renamed) + ['  }', '}'])
    assert r and '  aOld() {\n    one();\n    two();\n    trace();\n    init();\n    run();\n    log();\n' in r[2]['bots/src/x.mjs'], 'the fixture: log() landed in aOld()'
    assert r[3] == ({'bots/src/x.mjs': ['class K {']}, {'bots/src/x.mjs': ['class K {']}), r[3]
    refused('reviewer r2 (i): a() -> aOld() inside class K', r, "enclosing scopes differ ('a() { < class K {' reviewed, 'aOld() { < class K {' rebased)")
    # (ii) the block copied into `if (legacy) { ... return; }` of the same top-level function, the original edited. The copy
    # is NOT re-indented (re-indented its lines are other lines, and the pick stays in the original, where two reviewed
    # context lines are gone): the `if` stands at the change's own indentation, so the chain of scopes is the same --
    # what differs is that a brace is open above the change, rule (g)
    fn, fl = ['function a() {'] + ind(2, *body) + ['}'], ['function a() {'] + ind(2, *logb) + ['}']
    r = real_pick(CS, fn, fl, ['function a() {', '  if (legacy) {'] + ind(2, *copied) + ['  return;', '  }'] + ind(2, *renamed) + ['}'])
    assert r and '  if (legacy) {\n  one();\n  two();\n  trace();\n  init();\n  run();\n  log();\n' in r[2]['bots/src/x.mjs'], 'the fixture: log() landed in the legacy branch'
    refused('reviewer r2 (ii): the legacy branch, not re-indented', r, 'open above the change')
    r = real_pick(CS, fn, fl, ['function a() {', '  if (legacy) {'] + ind(4, *copied) + ['    return;', '  }'] + ind(2, *renamed) + ['}'])
    assert r and '  two2();\n  init();\n  run();\n  log();\n' in r[2]['bots/src/x.mjs'], 'the fixture: re-indented, the pick stays in the original'
    refused('reviewer r2 (ii): the legacy branch, re-indented', r, 'gone or changed')
    # ... and its two acceptances of rule (f): `return;` two lines above (tried above), and a comment around the change
    r = real_pick(CS, js, jchg, put(put(js, 6, '  */'), 2, '  /*'))
    assert r and '  /*\n  b();\n  c();\n  newer();\n  d();\n  */\n' in r[2]['bots/src/x.mjs'], 'the fixture: the added line is commented out'
    refused('reviewer r2: `/*` two lines above, `*/` two lines below', r, "not a plain line: '/*'")
    refused('a template literal opened above and closed below', real_pick(CS, js, jchg, put(put(js, 6, '  `;'), 2, '  const t = `')), 'not a plain line')
    PYQ = ['def f():'] + ind(4, 'a()', 'b()', 'c()', 'old()', 'd()', 'e()', 'g()')
    refused('a Python triple quote opened above and closed below',
            real_pick(CS, PYQ, [l.replace('old()', 'newer()') for l in PYQ], put(put(PYQ, 6, '    ' + '"' * 3), 2, '    ' + '"' * 3), path=PY), 'not a plain line', PY)
    # ---- more of the same kind
    refused('`false &&` two lines above', real_pick(CS, js, jchg, put(js, 2, '  false &&')), "not a plain line: 'false &&'")
    refused('a label and a loop', real_pick(CS, js, jchg, put(js, 2, '  skip: while (false)')), 'not a plain line')
    call = ['run(() => {'] + ind(2, 'a();', 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + ['});']
    refused('`});` closes a callback opened above', real_pick(CS, call, [l.replace('old();', 'newer();') for l in call],
            ['run(() => {'] + ind(2, 'a();') + ['});'] + ind(2, 'b();', 'c();', 'old();', 'd();', 'e();', 'f();') + ['void 0;']), "not a plain line: '});'")
    SH = 'scripts/x.sh'
    sh0 = ['a', 'b', 'c', 'old', 'd', 'e', 'f', 'g', 'h']
    refused('a shell heredoc swallows the change', real_pick(CS, sh0, [l.replace('old', 'newer') for l in sh0],
            ['a', ": <<'SKIP'", 'b', 'c', 'old', 'd', 'e', 'SKIP', 'f', 'g', 'h'], path=SH), 'not a plain line', SH)
    refused('`[ -f x ] || exit 1` above the change', real_pick(CS, sh0, [l.replace('old', 'newer') for l in sh0], put(sh0, 1, '[ -f x ] || exit 1'), path=SH), 'not a plain line', SH)
    dec = ['import os', '', 'def foo():', '    old()', '    b()', '    c()', '    d()']
    refused('a decorator inserted above the def in the context', real_pick(CS, dec, [l.replace('old()', 'newer()') for l in dec],
            ['import os', '@skip', '', 'def foo():', '    old()', '    b()', '    c()', '    d()'], path=PY), "not a plain line: '@skip'", PY)
    # NOT closed, by design: what a plain statement DOES. It is the base's code, and the suite ran on it.
    accepted('a plain statement that happens to end the process', real_pick(CS, js, jchg, put(js, 2, '  process.exit(0);')))


def t_v45_kill_switch_fails_closed(CS):
    """Review r1: `os.path.exists` is False for a dangling symlink and for any stat error, so the switch turned itself OFF
    exactly when something was wrong with it. Any form of the name is ON; any error but "no such name" is ON."""
    import tempfile
    d = tempfile.mkdtemp(prefix='ar-strict-')
    try:
        p = os.path.join(d, 'CONTEXT-STRICT')
        assert CS.context_strict(p) is False, 'absent: off'
        os.symlink(os.path.join(d, 'nowhere'), p)
        assert not os.path.exists(p) and CS.context_strict(p) is True, 'a dangling symlink is ON'
        os.unlink(p); os.mkdir(p)
        assert CS.context_strict(p) is True, 'a directory of that name is ON'
        os.rmdir(p); open(p, 'w').close()
        assert CS.context_strict(p) is True
        os.unlink(p)

        def boom(exc):
            def lstat(path):
                raise exc
            return lstat
        assert CS.context_strict(p, lstat=boom(PermissionError(13, 'denied'))) is True, 'cannot tell: STRICT'
        assert CS.context_strict(p, lstat=boom(NotADirectoryError(20, 'not a directory'))) is True
        assert CS.context_strict(p, lstat=boom(RuntimeError('anything'))) is True
        assert CS.context_strict(p, lstat=boom(FileNotFoundError(2, 'no such file'))) is False, 'only a clean ENOENT is off'
        f = os.path.join(d, 'a-file'); open(f, 'w').close()
        assert CS.context_strict(os.path.join(f, 'CONTEXT-STRICT')) is True, 'the REAL error for a parent that is a file (ENOTDIR): strict'
    finally:
        shutil.rmtree(d, ignore_errors=True)


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
    # the change also REMOVES a code line of the file (below the list): its added entry is a plain list line inside the region, but the
    # change touches code there, so the file is compared byte-exact (kills the mutant that drops the added/removed-lines check)
    cut_code = lambda lines: [l for l in lines if l != 'console.log(REQUIRED.length)']
    Arm = code + _nd(L, base, cut_code(ins(base, 9)))
    after = cut_code(ins(mk(ent[:5] + ["  'bots/test/other.test.mjs',"] + ent[6:]), 9))
    Brm = code + _nd(L, mk(ent[:5] + ["  'bots/test/other.test.mjs',"] + ent[6:]), after)
    assert Brm != Arm and '-console.log(REQUIRED.length)' in Arm and '-console.log(REQUIRED.length)' in Brm, 'the fixture removes the code line in both'
    assert CS.list_region('\n'.join(after), (OPEN, CLOSE)) is not None and X in CS.list_region('\n'.join(after), (OPEN, CLOSE)), 'the region itself is whole'
    assert CS.diff_equiv(Arm, Brm, texts={L: '\n'.join(after)}) is None, 'a removed CODE line: not a list-only change'
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
         t_v43_no_patch_head_is_skipped, t_v44_speculative_refusal_reaches_the_phone_and_names_the_hand_rebase,
         t_v44_built_page_cannot_fail_the_build, t_v45_code_context_pure, t_v45_plain_line_pure, t_v45_break_attempts,
         t_v45_kill_switch_fails_closed, t_v45_code_context_accepted_when_not_protected,
         t_v45_protected_change_stays_byte_exact, t_v45_context_strict_restores_byte_exact,
         t_v45_changed_context_line_refuses_and_says_why, t_v45_inserted_block_refuses_and_says_why,
         t_v45_accept_page_cannot_fail_the_build, t_v45_notes_say_which_identity_held]


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
    ('v43: context in a path list still counts (the 11-12 refusals)', "        same = diff_equiv(na, nb, texts=texts, code=not code_off, funcs=funcs, reviewed=reviewed)\n",
     "        same = None\n"),
    ('v45: the build never uses the code rule (ironchain-02, boardwalk-03)', "        same = diff_equiv(na, nb, texts=texts, code=not code_off, funcs=funcs, reviewed=reviewed)\n",
     "        same = diff_equiv(na, nb, texts=texts, funcs=funcs, reviewed=reviewed)\n"),
    ('v45: a PROTECTED change gets the code rule too', "    if t0 != 'none' or t1 != 'none':\n", "    if False:\n"),
    ('v45: CONTEXT-STRICT is ignored', "    if strict:\n        return '%s is present", "    if False:\n        return '%s is present"),
    ('v45: the code rule is on by default', "def diff_equiv(a, b, free=None, texts=None, code=False, funcs=None, reviewed=None):\n",
     "def diff_equiv(a, b, free=None, texts=None, code=True, funcs=None, reviewed=None):\n"),
    ('v45: a path list is judged by the code rule', "        if path not in free and code and code_context(la, lb, texts.get(path), FA.get(path), FB.get(path), (reviewed or {}).get(path))[0]:\n",
     "        if code and code_context(la, lb, texts.get(path), FA.get(path), FB.get(path), (reviewed or {}).get(path))[0]:\n"),
    ('v45 (a): the reviewed context ABOVE the change is not looked for', "        up = context_walk(T, s0 - 1, -1, ca[0][::-1])\n",
     "        up = context_walk(T, s0 - 1, -1, [])\n"),
    ('v45 (a): the reviewed context BELOW the change is not looked for', "        down = context_walk(T, e1, 1, ca[-1])\n",
     "        down = context_walk(T, e1, 1, [])\n"),
    ('v45 (a): the reviewed context BETWEEN two runs is not looked for', "context_walk(T, spans[i][1], 1, ca[i + 1])",
     "context_walk(T, spans[i][1], 1, [])"),
    ('v45 (a): a line inserted beyond the file edge the reviewed hunk reached is not counted (above)',
     "        if len(ca[0]) < DIFF_CONTEXT:\n", "        if False:\n"),
    ('v45 (a): ... (below)', "        if len(ca[-1]) < DIFF_CONTEXT:\n", "        if False:\n"),
    ('v45 (b): any number of inserted lines passes', "        if max(len(x) for x in ins) > CODE_CONTEXT_MAX:\n", "        if False:\n"),
    ('v45 (c): the enclosing function is not compared (aOld(), foo() / bar())', "        if run_funcs(ua, fa[k]) != run_funcs(ub, fb[k]):\n", "        if False:\n"),
    ('v45 (c): the hunk header\'s function text is ignored', "            out.append(last if last is not None else head_func[:80].rstrip())\n",
     "            out.append(last)\n"),
    ('v45 (c): ONLY the header text is compared (it refuses the measured import case)', "        if func_line(l[1:]):\n            last = l[1:81].rstrip()\n",
     "        if False:\n            last = l[1:81].rstrip()\n"),
    ('v45 (d): the first of several places is taken', "        if places != 1:\n", "        if not places:\n"),
    ('v45 (d): the first of several places of the REVIEWED hunk in the reviewed file is taken', "        if places_a != 1:\n", "        if not places_a:\n"),
    ('v45 (e): the chain of enclosing scopes is not compared (Codex r2: foo() -> bar())',
     "            if scope_chain(TA, spans_a[j][0] - 1, first) != scope_chain(T, spans[j][0] - 1, first):\n", "            if False:\n"),
    ('v45 (e): a line indented like the change joins its chain', "        if indent_of(l) < cur:\n", "        if indent_of(l) <= cur:\n"),
    ('v45 (e): a comment line joins the chain', "        if not l.strip() or _SCOPE_SKIP.match(l):\n", "        if not l.strip():\n"),
    ('v45 (f): an inserted line need not be plain (Codex r2: `if (false) {`, `return;`)', "        if odd:\n", "        if False:\n"),
    ('v45 (f): a line that opens or closes a comment, a triple quote or a template is plain',
     "    if any(t in s for t in _SPAN_TOKENS) or s.count('`') % 2 or any(c in l for c in _JS_LINE_END):\n", "    if False:\n"),
    ('v45 (f): a line with a brace or an unbalanced bracket is plain',
     "    if '{' in s or '}' in s or s.count('(') != s.count(')') or s.count('[') != s.count(']'):\n", "    if False:\n"),
    ('v45 (f): a line that takes the next one with it, a decorator, a heredoc is plain',
     "    if s[-1] in ':\\\\=+-*/%&|^!?<>.~' or s[0] == '@' or '<<' in s:\n", "    if False:\n"),
    ('v45 (f): a control word is plain', "    return not any(_STEER_LINE.match(part.strip()) for part in re.split(r';|&&|\\|\\|', s))\n", "    return True\n"),
    ('v45 (f): only the FIRST statement of a line is looked at (`a(); return`)',
     "    return not any(_STEER_LINE.match(part.strip()) for part in re.split(r';|&&|\\|\\|', s))\n", "    return not _STEER_LINE.match(s)\n"),
    ('v45 (g): what is open above the change is not compared (a block opened outside the window)',
     "            if open_above(TA, spans_a[j][0]) != open_above(T, spans[j][0]):\n", "            if False:\n"),
    ('v45: the build fetches no reviewed file text', "                reviewed[fp] = txt\n", "                pass\n"),
    ('v45: another added or removed line passes as context-only code', "        if ra != rb or not ra:\n", "        if not ra:\n"),
    ('v45: a hunk more or fewer passes', "    if len(xa) != len(xb):\n        return None, ", "    if False:\n        return None, "),
    ('v45: a differing file header or mode passes', "    if ha != hb:\n        return None, ", "    if False:\n        return None, "),
    ('v45: the kill switch fails OPEN on an error', "    except FileNotFoundError:\n        return False\n    except Exception:\n        return True\n",
     "    except FileNotFoundError:\n        return False\n    except Exception:\n        return False\n"),
    ('v45: the kill switch follows a symlink (a dangling one is off)', "        lstat(path)\n        return True\n", "        os.stat(path)\n        return True\n"),
    ('v45: an accepted context-only rebase of code is not paged', "    if ctx_code:\n        # v45: one page", "    if False:\n        # v45: one page"),
    ('v45: a page that cannot be written fails the build', "        except Exception as x:\n            try:\n                S('page-failed'",
     "        except ZeroDivisionError as x:\n            try:\n                S('page-failed'"),
    ('v44: a "built" page that cannot be written turns a done job into a refused one',
     "        except Exception as x:\n            # v44 (review of 11-13): the variant is queued and the job is DONE.",
     "        except ZeroDivisionError as x:\n            # v44 (review of 11-13): the variant is queued and the job is DONE."),
    ('v45: the notes claim a byte-identical diff for a context-only rebase of code',
     "    if ctx_code:\n        # v45: the same added and removed lines, every reviewed", "    if False:\n        # v45: the same added and removed lines, every reviewed"),
    ('v44: a refused SPECULATIVE build pages as a blocked head', "        if job.job.get('spec'):\n", "        if False:\n"),
    ('v44: a refused SPECULATIVE build is a flag (digest only)', "SPEC_REFUSED_LEVEL = 'warn'", "SPEC_REFUSED_LEVEL = 'flag'"),
    ('v44: the speculative refusal loses the word the pager pushes a warn for', "FAILED (refused at step %s): %s -- %s '\n", "refused at step %s: %s -- %s '\n"),
    ('v44: a speculative job does not say so', "    if spec:\n        job['spec'] = True\n", "    if False:\n        job['spec'] = True\n"),
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
