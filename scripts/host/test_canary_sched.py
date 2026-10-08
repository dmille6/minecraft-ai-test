#!/usr/bin/env python3
"""test_canary_sched.py [--mutants] -- behaviour tests for canary-sched.py, against a FIXTURE TREE (a temp dir holding a
manifest, journal, ledger, registrations, reads, unit dir, unit list, fake /proc, /proc/locks, skill logs, a real
throwaway git repo and STUB loop/drawexposure scripts). Nothing live is read or written; every path comes from the
SCHED_* variables, and the stub loop only appends journal lines. Runs on the Mac and on the host (needs git, bash).

--mutants: each mutant edits ONE anchored line of canary-sched.py (the anchor is asserted present and UNIQUE first,
because a mutant that silently fails to apply reads as "killed"), loads the mutated copy, reruns the suite, and must make
at least one test fail. A surviving mutant fails the run.
"""
import os, sys, json, shutil, subprocess, tempfile, time, importlib.util, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'canary-sched.py')
LIB = next(d for d in (os.path.normpath(os.path.join(HERE, '..', 'lib')), os.path.join(HERE, 'lib'),
                       os.path.expanduser('~/mcai-analysis/lib')) if os.path.exists(os.path.join(d, 'openloop.py')))
NOW = dt.datetime(2026, 10, 8, 12, 0, 0, tzinfo=dt.timezone.utc)
POOLS = ['board-a', 'hive-a']
BOTS = ['%s-%s' % (p, n) for p in POOLS for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
Z = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')


def load(path):
    spec = importlib.util.spec_from_file_location('canary_sched_under_test_%d' % abs(hash(path)), path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def sh(*a, cwd=None):
    return subprocess.run(list(a), cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Fix:
    """A fresh fixture tree per test."""

    def __init__(self):
        self.d = d = tempfile.mkdtemp(prefix='sched-fix-')
        self.home = os.path.join(d, 'home')
        for sub in ('digest/reads', 'mcai-analysis/registrations', 'mcai-analysis/lib'):
            os.makedirs(os.path.join(self.home, sub))
        self.tmp = os.path.join(d, 'tmpreads'); os.makedirs(self.tmp)
        self.unit = os.path.join(d, 'units'); os.makedirs(os.path.join(self.unit, 'multi-user.target.wants'))
        open(os.path.join(self.unit, 'mcbot@.service'), 'w').write('[Service]\n')
        self.proc = os.path.join(d, 'proc'); os.makedirs(self.proc)
        self.logs = os.path.join(d, 'logs')
        # git: base -> canary
        self.git = os.path.join(d, 'repo'); os.makedirs(self.git)
        sh('git', 'init', '-q', cwd=self.git)
        sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base', cwd=self.git)
        self.base = sh('git', 'rev-parse', 'HEAD', cwd=self.git)
        sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'canary', cwd=self.git)
        self.canary = sh('git', 'rev-parse', 'HEAD', cwd=self.git)
        sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'other', cwd=self.git)
        self.other = sh('git', 'rev-parse', 'HEAD', cwd=self.git)
        self.manifest = os.path.join(d, 'manifest.json')
        self.set_manifest()
        self.journal = os.path.join(self.home, 'canary-journal.jsonl'); open(self.journal, 'w').close()
        self.ledger = os.path.join(d, 'ledger.jsonl'); open(self.ledger, 'w').close()
        self.units_file = os.path.join(d, 'units.txt')
        self.enter_file = os.path.join(d, 'enter.json'); json.dump({}, open(self.enter_file, 'w'))
        self.locks = os.path.join(d, 'locks'); open(self.locks, 'w').close()
        self.lock = os.path.join(d, 'mcai-canary.lock'); open(self.lock, 'w').close()
        self.set_units({b: ('active', 'running') for b in BOTS})
        for b in BOTS:
            open(os.path.join(self.unit, 'multi-user.target.wants', 'mcbot@%s.service' % b), 'w').close()
            self.log(b, NOW - dt.timedelta(minutes=1), self.base[:7] + '+abc123')
        for i, b in enumerate(BOTS):
            self.add_proc(2000 + i, ['/usr/bin/node', '--max-old-space-size=768', 'src/index.mjs'])
        # reads + registration + queue
        for r in ('fooread', 'immobiledid'):
            open(os.path.join(self.home, 'mcai-analysis', '%s.py' % r), 'w').write('# %s v1\n' % r)
        self.reg = os.path.join(self.home, 'mcai-analysis', 'foo-01.json')
        self.write_reg({'sha': self.canary[:7], 'reads': ['fooread', 'immobiledid'], 'read_minutes': [180, 360]})
        open(os.path.join(self.home, 'mcai-analysis', 'drawrec.sh'), 'w').write('x\nTARGET_K = 4\nMIN_K = 2\n')
        shutil.copy(os.path.join(LIB, 'openloop.py'), os.path.join(self.home, 'mcai-analysis', 'lib', 'openloop.py'))
        self.loop = os.path.join(d, 'loop.sh')
        open(self.loop, 'w').write(
            '#!/bin/bash\n# stub loop: FIX_LOOP=ok|refuse|none|drawn\n'
            'case "${FIX_LOOP:-ok}" in\n'
            '  none) exit 3;;\n'
            '  refuse) printf \'{"ts":"%sZ","run":"%s","phase":"preflight-refused","note":"stub refusal"}\\n\' "${SCHED_FAKE_NOW:0:19}" "$1" >> "$SCHED_JOURNAL";;\n'
            '  *) printf \'{"ts":"%sZ","run":"%s","phase":"preflight-ok","note":"stub"}\\n\' "${SCHED_FAKE_NOW:0:19}" "$1" >> "$SCHED_JOURNAL";;\n'
            'esac\n')
        self.de = os.path.join(d, 'drawexposure.py')
        open(self.de, 'w').write(
            'import os, sys\nm = os.environ.get("FIX_DE", "undeclared")\n'
            'if m == "undeclared": print(sys.argv[1] + " declares no draw_exposure block"); sys.exit(0)\n'
            'if m == "ok": print("eligible on exposure: [\'board-a\', \'hive-a\']"); sys.exit(0)\n'
            'if m == "few": print("eligible on exposure: [\'board-a\']"); sys.exit(2)\n'
            'if m == "little": print("REFUSED: the exposure read found too little to prove anything"); sys.exit(2)\n'
            'raise SystemExit("Traceback: crash")\n')
        self.queue = os.path.join(self.home, 'canary-queue.json')
        self.entry = {'run': 'foo-01', 'class': '', 'after': [], 'not_before': None, 'hold': None,
                      'variants': {self.base: {'registration': self.reg, 'approved': 'test fixture'}}}

    # -- builders
    def env(self, **extra):
        e = {'SCHED_HOME': self.home, 'SCHED_MANIFEST': self.manifest, 'SCHED_JOURNAL': self.journal,
             'SCHED_LEDGER': self.ledger, 'SCHED_READ_DIR': self.tmp, 'SCHED_UNIT_DIR': self.unit,
             'SCHED_UNITS_FILE': self.units_file, 'SCHED_UNIT_ENTER_FILE': self.enter_file,
             'SCHED_LOG_GLOB': os.path.join(self.logs, '*', 'skill-*.jsonl'), 'SCHED_LOOP_LOCK': self.lock,
             'SCHED_PROC_LOCKS': self.locks, 'SCHED_GIT_DIR': self.git, 'SCHED_LOOP': self.loop,
             'SCHED_DRAWEXPOSURE': self.de, 'SCHED_PROC': self.proc, 'SCHED_FAKE_NOW': Z(NOW), 'SCHED_MIN_FRESH': '8',
             'SCHED_CANARY_TREE': '/srv/mcbots/harness-canary/'}
        e.update(extra)
        return e

    def set_manifest(self, pool=None, csha=None, raw=None):
        if raw is not None:
            open(self.manifest, 'w').write(raw); return
        json.dump({'run_id': 'x', 'declared_code_version': self.base[:7], 'declared_at': Z(NOW - dt.timedelta(days=1)),
                   'canary_pool': pool, 'canary_code_version': csha}, open(self.manifest, 'w'))

    def set_units(self, states):
        open(self.units_file, 'w').write(''.join('mcbot@%s.service loaded %s %s Minecraft\n' % (b, a, s)
                                                 for b, (a, s) in sorted(states.items())))

    def log(self, bot, t, version):
        os.makedirs(os.path.join(self.logs, bot), exist_ok=True)
        with open(os.path.join(self.logs, bot, 'skill-%s.jsonl' % bot), 'a') as f:
            f.write(json.dumps({'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'code': {'version': version},
                                'bot': {'name': bot}, 'skill': {'name': 'x'}}) + '\n')

    def add_proc(self, pid, argv, start='777'):
        p = os.path.join(self.proc, str(pid)); os.makedirs(p, exist_ok=True)
        open(os.path.join(p, 'cmdline'), 'wb').write(('\0'.join(argv) + '\0').encode())
        open(os.path.join(p, 'stat'), 'w').write('%d (x) S ' % pid + ' '.join(['0'] * 18) + ' %s 0 0\n' % start)

    def write_reg(self, r):
        json.dump(r, open(self.reg, 'w'))

    def j(self, run, phase, t, note=''):
        with open(self.journal, 'a') as f:
            f.write(json.dumps({'ts': Z(t), 'run': run, 'phase': phase, 'note': note}) + '\n')

    def led(self, sha, pools, decision, t, note='x'):
        with open(self.ledger, 'a') as f:
            f.write(json.dumps({'canary_sha': sha, 'canary_pool': pools, 'decision': decision, 'note': note,
                                'ts': t.isoformat()}) + '\n')

    def regfile(self, run, sha):
        json.dump({'sha': sha, 'reads': ['immobiledid']}, open(os.path.join(self.home, 'mcai-analysis', 'registrations',
                                                                            '%s.json' % run), 'w'))

    def closed_run(self, run='prev-01', t=NOW - dt.timedelta(hours=2), decision='KEEP', note='x', recorded=True,
                   ledger=True, pools='board-a,hive-a'):
        """A run that deployed, decided, recorded and was torn down `t` ago (its sha registered as the canary's)."""
        self.regfile(run, self.other[:7])
        self.j(run, 'drawn', t - dt.timedelta(hours=6))
        self.j(run, 'deployed', t - dt.timedelta(hours=6), '%s %s' % (pools, Z(t - dt.timedelta(hours=6))))
        if recorded:
            self.j(run, 'recorded', t - dt.timedelta(minutes=5), decision)
        if ledger:
            self.led(self.other[:7], pools, decision, t - dt.timedelta(minutes=5), note)
        self.j(run, 'torn-down', t)

    def state(self, row):
        p = os.path.join(self.home, 'digest', 'sched-state.jsonl')
        with open(p, 'a') as f:
            f.write(json.dumps(row) + '\n')

    def enqueue(self, CS, entry=None):
        with Env(self.env()):
            e = json.loads(json.dumps(entry or self.entry))
            bad = CS.validate_entry(CS.paths(), e, [])
            assert not bad, bad
            json.dump({'version': 1, 'entries': [e]}, open(self.queue, 'w'))
            return e

    def cleanup(self):
        shutil.rmtree(self.d, ignore_errors=True)


class Env:
    def __init__(self, e):
        self.e = e

    def __enter__(self):
        self.old = {k: os.environ.get(k) for k in self.e}
        os.environ.update(self.e)

    def __exit__(self, *a):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def decision(CS, F, **extra):
    with Env(F.env(**extra)):
        st = CS.gather(CS.paths())
        return CS.decide(st), st


def expect(CS, F, kind, code=None, contains=None, **extra):
    d, st = decision(CS, F, **extra)
    reasons = d[1] if d[0] != 'launch' else []
    ok = d[0] == kind and (code is None or any(c == code for c, _ in reasons)) and \
        (contains is None or any(contains in r for _, r in reasons))
    assert ok, 'expected %s %s %r, got %s %s' % (kind, code, contains, d[0], reasons if d[0] != 'launch' else d[1]['run'])
    return d, st


def human(CS, F, *argv, **extra):
    with Env(F.env(**extra)):
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = CS.main(list(argv))
        return rc, buf.getvalue()


# ------------------------------------------------------------------------------------------------------- tests --
def t_clean_launches(CS, F):
    F.enqueue(CS); expect(CS, F, 'launch')


def t_empty_queue_idle(CS, F):
    expect(CS, F, 'idle', 'Q')


def t_s1_canary_declared(CS, F):
    F.enqueue(CS); F.set_manifest('board-c', 'abc1234'); expect(CS, F, 'busy', 'S1')


def t_s6_open_loop_without_canary_blocks(CS, F):
    F.enqueue(CS)
    expect(CS, F, 'launch')
    with Env(F.env()):
        st = CS.gather(CS.paths())
    st['openloop'] = 'manifest is missing or unreadable'
    d = CS.decide(st)
    assert d[0] == 'block' and any(c == 'S6' for c, _ in d[1]), d


def t_s1_manifest_unreadable(CS, F):
    F.enqueue(CS); F.set_manifest(raw='{not json'); expect(CS, F, 'block', 'S1')


def t_s2_loop_absolute(CS, F):
    F.enqueue(CS); F.add_proc(50, ['bash', '/home/mike/canary-loop.sh', 'x']); expect(CS, F, 'busy', 'S2')


def t_s2_loop_relative(CS, F):
    F.enqueue(CS); F.add_proc(50, ['bash', 'canary-loop.sh', 'x']); expect(CS, F, 'busy', 'S2')


def t_s2_chain_install_deploy(CS, F):
    F.enqueue(CS)
    for i, argv in enumerate((['bash', '/home/mike/chain-after.sh', 'a', 'b'], ['bash', '/home/mike/gate-v34/install-gate-v34.sh'],
                              ['sudo', 'CANARY_ENV=', '/root/d.sh', 'sha'], ['/bin/bash', '/home/mike/bin/fleet-deploy', 's'])):
        p = os.path.join(F.proc, str(60 + i))
        F.add_proc(60 + i, argv)
        expect(CS, F, 'busy', 'S2')
        shutil.rmtree(p)


def t_s3_lock_held(CS, F):
    F.enqueue(CS)
    ino = os.stat(F.lock).st_ino
    open(F.locks, 'w').write('1: FLOCK  ADVISORY  WRITE 4242 08:01:%d 0 EOF\n' % ino)
    expect(CS, F, 'busy', 'S3', 'pid 4242')


def t_s3_lock_unreadable(CS, F):
    F.enqueue(CS); os.remove(F.locks); expect(CS, F, 'block', 'S3')


def t_s3_never_acquires(CS, F):
    """The probe must not take the lock: hold it ourselves (as a loop would) and the tick must still see 'busy', and
    our flock must still be held afterwards."""
    import fcntl
    F.enqueue(CS)
    fd = os.open(F.lock, os.O_RDWR)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    ino = os.stat(F.lock).st_ino
    open(F.locks, 'w').write('1: FLOCK  ADVISORY  WRITE %d 08:01:%d 0 EOF\n' % (os.getpid(), ino))
    try:
        expect(CS, F, 'busy', 'S3')
        fd2 = os.open(F.lock, os.O_RDWR)
        try:
            fcntl.flock(fd2, fcntl.LOCK_EX | fcntl.LOCK_NB)
            raise AssertionError('our lock was released by the probe')
        except OSError:
            pass
        finally:
            os.close(fd2)
    finally:
        os.close(fd)


def t_s4_dropin(CS, F):
    F.enqueue(CS)
    d = os.path.join(F.unit, 'mcbot@board-a-Alpha.service.d'); os.makedirs(d)
    open(os.path.join(d, '10-canary.conf'), 'w').write('x')
    expect(CS, F, 'busy', 'S4')


def t_s4_unitdir_unreadable(CS, F):
    F.enqueue(CS); os.remove(os.path.join(F.unit, 'mcbot@.service')); expect(CS, F, 'block', 'S4')


def t_s5_silent_bot_no_canary_anywhere_passes(CS, F):
    """Agreed rule (Claude r5 item 2): a silent active unit outside the last closed run's pools passes when it has no
    drop-in and NO process runs from the canary tree -- it cannot be running canary code."""
    F.enqueue(CS)
    os.remove(os.path.join(F.logs, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl'))
    F.log('board-a-Alpha', NOW - dt.timedelta(hours=1), F.base[:7] + '+abc123')
    expect(CS, F, 'launch')
    F.add_proc(71, ['/usr/bin/node', '/srv/mcbots/harness-canary/src/index.mjs'])
    expect(CS, F, 'block', 'S5', 'board-a-Alpha')


def t_s5_two_builds(CS, F):
    F.enqueue(CS); F.log('hive-a-Echo', NOW, F.canary[:7] + '+fff111'); expect(CS, F, 'block', 'S5', 'builds')


def t_s5_wrong_build(CS, F):
    F.enqueue(CS)
    for b in BOTS:
        F.log(b, NOW, F.other[:7] + '+abc123')
    expect(CS, F, 'block', 'S5', 'not the declared')


def t_s5_transitional(CS, F):
    F.enqueue(CS)
    st = {b: ('active', 'running') for b in BOTS}; st['hive-a-Echo'] = ('deactivating', 'stop-sigterm')
    F.set_units(st)
    expect(CS, F, 'block', 'S5', 'transition')


def t_s5_stopped_with_dropin(CS, F):
    F.enqueue(CS)
    st = {b: ('active', 'running') for b in BOTS}; st['board-a-Charlie'] = ('failed', 'failed')
    F.set_units(st)
    d = os.path.join(F.unit, 'mcbot@board-a-Charlie.service.d'); os.makedirs(d)
    open(os.path.join(d, '10-canary.conf'), 'w').write('x')
    expect(CS, F, 'busy', 'S4')                         # the drop-in itself is S4 -- and S5 names the stopped unit too
    d2, _ = decision(CS, F)
    assert any('stopped unit' in r for _, r in d2[1]), d2


def t_s5_stopped_without_dropin_passes(CS, F):
    F.enqueue(CS)
    st = {b: ('active', 'running') for b in BOTS}; st['board-a-Charlie'] = ('failed', 'failed')
    F.set_units(st)
    expect(CS, F, 'launch')


def t_s5_canary_process(CS, F):
    F.enqueue(CS)
    F.add_proc(70, ['/usr/bin/node', '/srv/mcbots/harness-canary/src/index.mjs'])
    expect(CS, F, 'block', 'S5', 'canary tree')


def t_s5_proc_unreadable(CS, F):
    """Positive control: a /proc that shows no bot process at all cannot prove that no canary process survives."""
    F.enqueue(CS)
    for i in range(len(BOTS)):
        shutil.rmtree(os.path.join(F.proc, str(2000 + i)))
    expect(CS, F, 'block', 'S5', 'process scan')


def t_s5_silent_started_after_recorded_passes(CS, F):
    F.enqueue(CS)
    F.closed_run(t=NOW - dt.timedelta(hours=2))
    os.remove(os.path.join(F.logs, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl'))
    F.log('board-a-Alpha', NOW - dt.timedelta(hours=1, minutes=59), F.base[:7] + '+abc123')  # silent since
    json.dump({'board-a-Alpha': Z(NOW - dt.timedelta(hours=2, minutes=2))}, open(F.enter_file, 'w'))  # after recorded
    expect(CS, F, 'launch')


def t_s5_silent_started_before_recorded_blocks(CS, F):
    F.enqueue(CS)
    F.closed_run(t=NOW - dt.timedelta(hours=2))
    os.remove(os.path.join(F.logs, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl'))
    F.log('board-a-Alpha', NOW - dt.timedelta(hours=1, minutes=59), F.base[:7] + '+abc123')
    json.dump({'board-a-Alpha': Z(NOW - dt.timedelta(hours=9))}, open(F.enter_file, 'w'))     # before recorded
    expect(CS, F, 'block', 'S5', 'board-a-Alpha')


def t_s5_settling_is_busy(CS, F):
    F.enqueue(CS)
    F.closed_run(t=NOW - dt.timedelta(minutes=10))
    os.remove(os.path.join(F.logs, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl'))
    F.log('board-a-Alpha', NOW - dt.timedelta(minutes=12), F.base[:7] + '+abc123')
    json.dump({'board-a-Alpha': Z(NOW - dt.timedelta(hours=9))}, open(F.enter_file, 'w'))
    expect(CS, F, 'busy', 'S5')


def t_s7_drawn_not_deployed_blocks(CS, F):
    F.enqueue(CS); F.regfile('zz-01', F.other[:7])
    F.j('zz-01', 'draw', NOW - dt.timedelta(hours=1)); F.j('zz-01', 'drawn', NOW - dt.timedelta(minutes=50))
    expect(CS, F, 'block', 'S7', 'zz-01')


def t_s7_record_failed_teardown_blocks(CS, F):
    """Claude r2 item A: record-failed -> torn-down leaves no ledger row; the slot must NOT free."""
    F.enqueue(CS)
    F.closed_run('rf-01', recorded=False, ledger=False)
    expect(CS, F, 'block', 'S7', 'rf-01')


def t_s7_ledger_without_recorded_phase_blocks(CS, F):
    F.enqueue(CS); F.closed_run('rf-02', recorded=False, ledger=True); expect(CS, F, 'block', 'S7', 'rf-02')


def t_s7_ledger_wrong_pools_blocks(CS, F):
    F.enqueue(CS); F.closed_run('rf-03', ledger=False)
    F.led(F.other[:7], 'board-c,placebo-d', 'KEEP', NOW - dt.timedelta(hours=2, minutes=5))
    expect(CS, F, 'block', 'S7', 'rf-03')


def t_s7_closed_run_launches(CS, F):
    F.enqueue(CS); F.closed_run('ok-01'); expect(CS, F, 'launch')


def t_s7_late_line_does_not_reopen(CS, F):
    """Claude r3 item 3: a refused-redeploy journalled after a run's closure does not reopen it."""
    F.enqueue(CS); F.closed_run('ok-02'); F.j('ok-02', 'refused-redeploy', NOW - dt.timedelta(minutes=30))
    expect(CS, F, 'launch')


def t_s7_predeploy_refusal_elsewhere_frees(CS, F):
    F.enqueue(CS); F.regfile('pre-01', F.other[:7])
    F.j('pre-01', 'preflight-refused', NOW - dt.timedelta(hours=1))
    expect(CS, F, 'launch')


def t_s7_operator_note_ignored(CS, F):
    F.enqueue(CS); F.j('note-01', 'operator-note', NOW - dt.timedelta(hours=1)); expect(CS, F, 'launch')


def t_s7_live_loop_is_busy(CS, F):
    F.enqueue(CS); F.regfile('live-01', F.other[:7])
    F.j('live-01', 'draw', NOW - dt.timedelta(hours=1)); F.j('live-01', 'drawn', NOW - dt.timedelta(minutes=50))
    F.add_proc(80, ['bash', '/home/mike/canary-loop.sh', 'live-01'])
    expect(CS, F, 'busy', 'S7')


def t_s8_pause(CS, F):
    F.enqueue(CS); open(os.path.join(F.home, 'digest', 'SCHED-PAUSE'), 'w').close(); expect(CS, F, 'block', 'S8')


def t_s8_install_hold_and_stale(CS, F):
    F.enqueue(CS)
    p = os.path.join(F.home, 'digest', 'INSTALL-HOLD')
    json.dump({'owner': 'gate', 'until': Z(NOW + dt.timedelta(minutes=30))}, open(p, 'w'))
    expect(CS, F, 'busy', 'S8')
    json.dump({'owner': 'gate', 'until': Z(NOW - dt.timedelta(minutes=1))}, open(p, 'w'))
    expect(CS, F, 'block', 'S8', 'STALE')


def t_r11_death_revert_holds_until_continue(CS, F):
    F.enqueue(CS)
    F.closed_run('dg-01', decision='REVERT', note='dg-01: VERDICT REVERT (+0) :: rung-linked death on a non-ladder change')
    # an artifact WITHOUT by=death_gate: only the note's /death/ can hold it (junkwell-01's shape)
    json.dump({'verdict': 'REVERT', 'extra': {}}, open(os.path.join(F.home, 'digest', 'reads', 'dg-01-verdict-0.json'), 'w'))
    expect(CS, F, 'block', 'R11', 'decided by a death')
    rc, out = human(CS, F, 'continue', 'dg-01', 'owner says go')
    assert rc == 0, out
    expect(CS, F, 'launch')


def t_r11_artifact_by_death_gate(CS, F):
    F.enqueue(CS)
    F.closed_run('dg-02', decision='REVERT', note='dg-02: VERDICT REVERT (+180) :: v15c guard')
    json.dump({'verdict': 'REVERT', 'extra': {'by': 'death_gate'}},
              open(os.path.join(F.home, 'digest', 'reads', 'dg-02-verdict-0.json'), 'w'))
    expect(CS, F, 'block', 'R11', 'death_gate')


def t_r11_non_death_revert_with_artifact_passes(CS, F):
    F.enqueue(CS)
    F.closed_run('nd-01', decision='REVERT', note='nd-01: VERDICT REVERT (+180) :: v11 climbs +239%')
    json.dump({'verdict': 'REVERT', 'extra': {}}, open(os.path.join(F.home, 'digest', 'reads', 'nd-01-verdict-180.json'), 'w'))
    expect(CS, F, 'launch')


def t_r11_revert_without_artifact_holds(CS, F):
    F.enqueue(CS)
    F.closed_run('na-01', decision='REVERT', note='na-01: VERDICT REVERT (+180) :: v11 climbs')
    expect(CS, F, 'block', 'R11', 'fail toward')


def t_h1_hold(CS, F):
    e = dict(F.entry); e['hold'] = 'owner wants a pause'; F.enqueue(CS, e); expect(CS, F, 'block', 'H1', 'held')


def t_h1_not_before_waits(CS, F):
    e = dict(F.entry); e['not_before'] = Z(NOW + dt.timedelta(hours=1)); F.enqueue(CS, e); expect(CS, F, 'wait', 'H1')
    e['not_before'] = Z(NOW - dt.timedelta(hours=1)); F.enqueue(CS, e); expect(CS, F, 'launch')


def t_h1_after_running_waits_and_closed_launches(CS, F):
    e = dict(F.entry); e['after'] = ['dep-01']; F.enqueue(CS, e)
    expect(CS, F, 'wait', 'H1', 'dep-01')
    F.closed_run('dep-01')
    expect(CS, F, 'launch')


def t_h1_after_cancelled_blocks(CS, F):
    e = dict(F.entry); e['after'] = ['dep-02']
    F.enqueue(CS, e)
    F.state({'state': 'human', 'run': 'dep-02', 'how': 'cancel', 'at': Z(NOW - dt.timedelta(hours=1))})
    expect(CS, F, 'block', 'H1', 'not a completion')


def t_h1_after_abandoned_blocks(CS, F):
    e = dict(F.entry); e['after'] = ['dep-03']; F.enqueue(CS, e); F.regfile('dep-03', F.other[:7])
    F.j('dep-03', 'drawn', NOW - dt.timedelta(hours=2))
    F.state({'state': 'human', 'run': 'dep-03', 'how': 'abandon', 'at': Z(NOW - dt.timedelta(hours=1))})
    expect(CS, F, 'block', 'H1', 'not a completion')


def t_h2_no_variant(CS, F):
    e = dict(F.entry); e['variants'] = {F.other: {'registration': F.reg, 'approved': 'x'}}
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid']})
    with Env(F.env()):
        json.dump({'version': 1, 'entries': [e]}, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H2')


def t_h3_registration_changed(CS, F):
    F.enqueue(CS); F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'x': 1})
    expect(CS, F, 'block', 'H3', 'changed')


def t_h3_class_mismatch(CS, F):
    F.enqueue(CS)
    q = json.load(open(F.queue)); q['entries'][0]['class'] = 'bag-fix'; json.dump(q, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H3', 'class')


def t_h3_staged_copy_differs(CS, F):
    F.enqueue(CS)
    open(os.path.join(F.home, 'mcai-analysis', 'registrations', 'foo-01.json'), 'w').write('{"sha":"other"}')
    expect(CS, F, 'block', 'H3', 'other content')


def t_h3_run_deployed_before(CS, F):
    F.enqueue(CS); F.closed_run('foo-01')
    # closed + same run id: it is DONE, so the head moves on -> nothing left
    expect(CS, F, 'idle')


def t_h4_tmp_read_differs_never_overwritten(CS, F):
    F.enqueue(CS); open(os.path.join(F.tmp, 'fooread.py'), 'w').write('# newer fix\n')
    expect(CS, F, 'block', 'H4', 'never overwritten')
    assert open(os.path.join(F.tmp, 'fooread.py')).read() == '# newer fix\n'


def t_h4_absent_read_is_staged_at_launch(CS, F):
    F.enqueue(CS)
    with Env(F.env(FIX_LOOP='ok')):
        rc = CS.tick(CS.paths())
    assert rc == 0
    assert open(os.path.join(F.tmp, 'fooread.py')).read() == '# fooread v1\n', 'absent read not staged'
    assert os.path.exists(os.path.join(F.home, 'mcai-analysis', 'registrations', 'foo-01.json')), 'registration not staged'


def t_h5_next_slot(CS, F):
    F.enqueue(CS); open(os.path.join(F.home, 'digest', 'NEXT-SLOT.json'), 'w').write('{}'); expect(CS, F, 'block', 'H5')


def t_h6_bagfix_needs_k4(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'class': 'bag-fix'})
    e = dict(F.entry); e['class'] = 'bag-fix'; F.enqueue(CS, e)
    expect(CS, F, 'launch')
    open(os.path.join(F.home, 'mcai-analysis', 'drawrec.sh'), 'w').write('TARGET_K = 2\n')
    expect(CS, F, 'block', 'H6')


def t_r10_crash_blocks(CS, F):
    F.enqueue(CS); expect(CS, F, 'block', 'R10', FIX_DE='crash')


def t_r10_declared_needs_eligible_line(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'draw_exposure': {'require': []}})
    F.enqueue(CS)
    expect(CS, F, 'launch', FIX_DE='ok')
    expect(CS, F, 'block', 'R10', FIX_DE='undeclared')       # a declared registration answered as undeclared
    expect(CS, F, 'block', 'R10', FIX_DE='little')
    expect(CS, F, 'wait', 'R10', 'board-a', FIX_DE='few')


def t_r10_undeclared_must_say_so(CS, F):
    F.enqueue(CS); expect(CS, F, 'block', 'R10', FIX_DE='ok')


def _launch(CS, F, mode):
    with Env(F.env(FIX_LOOP=mode)):
        assert CS.tick(CS.paths()) == 0
    for _ in range(50):                                   # the stub is quick; wait for it to finish
        time.sleep(0.1)
        if mode == 'none' or open(F.journal).read().strip():
            break
    time.sleep(0.3)


def t_l_launch_then_refusal_blocks_and_pages(CS, F):
    F.enqueue(CS); _launch(CS, F, 'refuse')
    with Env(F.env()):
        CS.tick(CS.paths())
        st = CS.gather(CS.paths())
        assert CS.entry_state(st['queue']['entries'][0], st) == 'blocked'
    pages = open(os.path.join(F.home, 'digest', 'page.jsonl')).read()
    assert 'BLOCKED' in pages and 'refused at launch' in pages, pages
    expect(CS, F, 'block', 'H3', 'rearm')


def t_l_exit3_no_journal_blocks(CS, F):
    F.enqueue(CS); _launch(CS, F, 'none')
    with Env(F.env()):
        CS.tick(CS.paths())
    pages = open(os.path.join(F.home, 'digest', 'page.jsonl')).read()
    assert 'no journal line' in pages, pages
    expect(CS, F, 'block', 'H3')


def t_l_same_second_line_counts(CS, F):
    """t0 is whole seconds like the journal (`date +%FT%TZ`): a first line in the same second, written while the clock
    reads .600, belongs to this attempt."""
    F.enqueue(CS)
    with Env(F.env(FIX_LOOP='ok', SCHED_FAKE_NOW='2026-10-08T12:00:00.600000+00:00')):
        assert CS.tick(CS.paths()) == 0
    time.sleep(1.0)
    with Env(F.env(SCHED_FAKE_NOW='2026-10-08T12:00:00.600000+00:00')):
        st = CS.gather(CS.paths())
        a = CS.attempts(st, 'foo-01')[-1]
        assert CS.attempt_rows(st, 'foo-01', a), 'same-second first line not counted'


def t_l_old_attempt_line_does_not_count(CS, F):
    F.enqueue(CS)
    F.j('foo-01', 'preflight-ok', NOW - dt.timedelta(hours=3))
    F.state({'state': 'human', 'run': 'foo-01', 'how': 'rearm', 'at': Z(NOW - dt.timedelta(hours=2))})
    F.state({'state': 'launching', 'run': 'foo-01', 't0': Z(NOW - dt.timedelta(minutes=1)), 'at': Z(NOW - dt.timedelta(minutes=1))})
    F.state({'state': 'launched-pid', 'run': 'foo-01', 'pid': 9999, 'start': '555', 'at': Z(NOW - dt.timedelta(minutes=1))})
    F.add_proc(9999, ['bash', '/x/other'], start='555')
    with Env(F.env()):
        st = CS.gather(CS.paths())
        assert CS.entry_state(st['queue']['entries'][0], st) == 'launching'
        assert not CS.attempt_rows(st, 'foo-01', CS.attempts(st, 'foo-01')[-1])


def t_l_journalled_but_not_live_is_blocked(CS, F):
    """An attempt that journalled (a refusal) whose pid is alive but is not this run's loop: blocked, not launching."""
    F.enqueue(CS)
    F.state({'state': 'launching', 'run': 'foo-01', 't0': Z(NOW - dt.timedelta(minutes=1)), 'at': Z(NOW - dt.timedelta(minutes=1))})
    F.state({'state': 'launched-pid', 'run': 'foo-01', 'pid': 9997, 'start': '555', 'at': Z(NOW - dt.timedelta(minutes=1))})
    F.add_proc(9997, ['bash', '/x/other'], start='555')
    F.j('foo-01', 'preflight-refused', NOW - dt.timedelta(seconds=30))
    with Env(F.env()):
        st = CS.gather(CS.paths())
        assert CS.entry_state(st['queue']['entries'][0], st) == 'blocked'


def t_r11_header_deaths_do_not_hold(CS, F):
    """Every verdict line opens 'deaths N (...)': a v11 REVERT must not be read as death-driven (towndeposit-01)."""
    F.enqueue(CS)
    F.closed_run('v11-01', decision='REVERT',
                 note='v11-01: VERDICT REVERT (+180) :: deaths 1 (0.033/bh over 30.0 measured bot-h) vs control 7 | v11 climbs +239%')
    json.dump({'verdict': 'REVERT', 'extra': {}}, open(os.path.join(F.home, 'digest', 'reads', 'v11-01-verdict-180.json'), 'w'))
    expect(CS, F, 'launch')


def t_s7_deployed_line_missing_but_decided_closes(CS, F):
    """deathfix-02's shape: drawn -> read-180 -> recorded -> promoted, no `deployed` line; ledger row present."""
    F.enqueue(CS); F.regfile('df-02', F.other[:7])
    t = NOW - dt.timedelta(hours=3)
    F.j('df-02', 'drawn', t - dt.timedelta(hours=6), 'board-a,hive-a :: DRAW (2 pools)')
    F.j('df-02', 'read-180', t - dt.timedelta(hours=3), 'VERDICT NOT_YET')
    F.j('df-02', 'recorded', t - dt.timedelta(minutes=10), 'KEEP')
    F.led(F.other[:7], 'board-a,hive-a', 'KEEP', t - dt.timedelta(minutes=10))
    F.j('df-02', 'promoted', t)
    expect(CS, F, 'launch')


def t_l_reused_pid_is_not_alive(CS, F):
    F.enqueue(CS)
    F.state({'state': 'launching', 'run': 'foo-01', 't0': Z(NOW - dt.timedelta(minutes=1)), 'at': Z(NOW - dt.timedelta(minutes=1))})
    F.state({'state': 'launched-pid', 'run': 'foo-01', 'pid': 9998, 'start': '555', 'at': Z(NOW - dt.timedelta(minutes=1))})
    F.add_proc(9998, ['bash', '/x/other'], start='556')      # same pid, different start time
    with Env(F.env()):
        st = CS.gather(CS.paths())
        assert CS.entry_state(st['queue']['entries'][0], st) == 'blocked'


def t_l_crash_before_popen_blocks(CS, F):
    F.enqueue(CS)
    F.state({'state': 'launching', 'run': 'foo-01', 't0': Z(NOW - dt.timedelta(minutes=10)), 'at': Z(NOW - dt.timedelta(minutes=10))})
    expect(CS, F, 'block', 'H3')


def t_l_no_automatic_retry_then_rearm(CS, F):
    F.enqueue(CS); _launch(CS, F, 'refuse')
    expect(CS, F, 'block', 'H3')
    rc, out = human(CS, F, 'rearm', 'foo-01', 'fixed the change rows')
    assert rc == 0, out
    expect(CS, F, 'launch')


def t_human_closed_needs_ledger_row(CS, F):
    F.enqueue(CS); F.closed_run('rf-09', recorded=False, ledger=False)
    rc, out = human(CS, F, 'closed', 'rf-09', 'torn down by hand')
    assert rc == 2 and 'canary_sha' in out and 'Append it' in out, out
    F.led(F.other[:7], 'board-a,hive-a', 'INCONCLUSIVE', NOW - dt.timedelta(hours=1))
    rc, out = human(CS, F, 'closed', 'rf-09', 'ledger row appended')
    assert rc == 0, out
    # a human closure is a closure for S5 too: rows from before it do not count, rows after it do
    expect(CS, F, 'busy', 'S5')
    for b in BOTS:
        F.log(b, NOW + dt.timedelta(minutes=1), F.base[:7] + '+abc123')
    expect(CS, F, 'launch', SCHED_FAKE_NOW=Z(NOW + dt.timedelta(minutes=2)))


def t_human_closed_refuses_live_fleet(CS, F):
    F.enqueue(CS); F.closed_run('rf-10', recorded=False, ledger=True)
    F.set_manifest('board-a,hive-a', F.other[:7])
    rc, out = human(CS, F, 'closed', 'rf-10', 'x')
    assert rc == 2 and 'teardown' in out, out


def t_human_closed_refuses_never_deployed(CS, F):
    F.regfile('nd-02', F.other[:7]); F.j('nd-02', 'drawn', NOW - dt.timedelta(hours=1))
    rc, out = human(CS, F, 'closed', 'nd-02', 'x')
    assert rc == 2 and 'abandon' in out, out


def t_human_abandon_rules(CS, F):
    F.enqueue(CS); F.regfile('ab-01', F.other[:7])
    F.j('ab-01', 'drawn', NOW - dt.timedelta(minutes=10))
    rc, out = human(CS, F, 'abandon', 'ab-01', 'x')
    assert rc == 2 and 'wait until' in out, out             # inside 20 min of `drawn`
    F2 = os.path.join(F.proc, '91'); F.add_proc(91, ['sudo', 'CANARY_ENV=', '/root/d.sh', 'sha'])
    rc, out = human(CS, F, 'abandon', 'ab-01', 'x', SCHED_FAKE_NOW=Z(NOW + dt.timedelta(minutes=30)))
    assert rc == 2 and 'deploy is still running' in out, out
    shutil.rmtree(F2)
    for b in BOTS:
        F.log(b, NOW + dt.timedelta(minutes=29), F.base[:7] + '+abc123')
    rc, out = human(CS, F, 'abandon', 'ab-01', 'x', SCHED_FAKE_NOW=Z(NOW + dt.timedelta(minutes=30)))
    assert rc == 0, out
    expect(CS, F, 'launch', SCHED_FAKE_NOW=Z(NOW + dt.timedelta(minutes=31)))


def t_human_abandon_refuses_deployed(CS, F):
    F.closed_run('ab-02', recorded=False, ledger=False)
    rc, out = human(CS, F, 'abandon', 'ab-02', 'x')
    assert rc == 2 and 'DEPLOYED' in out, out


def t_human_rearm_refuses_deployed(CS, F):
    F.enqueue(CS); F.closed_run('foo-01', recorded=False, ledger=False)
    rc, out = human(CS, F, 'rearm', 'foo-01', 'x')
    assert rc == 2 and 'DEPLOYED' in out, out


def t_human_cancel_moves_on(CS, F):
    F.enqueue(CS); rc, out = human(CS, F, 'cancel', 'foo-01', 'owner dropped it'); assert rc == 0
    expect(CS, F, 'idle')


def t_install_hold_exit_codes(CS, F):
    F.enqueue(CS)
    rc, out = human(CS, F, 'install-hold', 'gate-agent', '60')
    assert rc == 0, out
    expect(CS, F, 'busy', 'S8')
    human(CS, F, 'install-release')
    F.set_manifest('board-c', 'abc1234')
    rc, out = human(CS, F, 'install-hold', 'gate-agent', '60')
    assert rc == 2 and 'NOT free' in out, out
    assert os.path.exists(os.path.join(F.home, 'digest', 'INSTALL-HOLD')), 'hold must still be written'


def t_queue_add_refusals(CS, F):
    with Env(F.env()):
        P = CS.paths()
        e = json.loads(json.dumps(F.entry)); e['variants'] = {F.base[:7]: {'registration': F.reg, 'approved': 'x'}}
        assert any('40-hex' in b for b in CS.validate_entry(P, e, []))
        e = json.loads(json.dumps(F.entry)); del e['variants'][F.base]['approved']
        assert any('approved' in b for b in CS.validate_entry(P, e, []))
        e = json.loads(json.dumps(F.entry)); e['class'] = 'bag-fix'
        assert any('class' in b for b in CS.validate_entry(P, e, []))
        e = json.loads(json.dumps(F.entry))
        assert not CS.validate_entry(P, e, [])
        v = e['variants'][F.base]
        assert v['canary_sha'] == F.canary and set(v['reads']) == {'fooread', 'immobiledid'}
        j = [{'ts': Z(NOW), 'run': 'foo-01', 'phase': 'deployed', 'note': 'board-a %s' % Z(NOW)}]
        assert any('one deployment' in b for b in CS.validate_entry(P, json.loads(json.dumps(F.entry)), j))


def t_w_drawstall_pages_from_first_draw(CS, F):
    F.enqueue(CS)
    F.state({'state': 'launching', 'run': 'foo-01', 't0': Z(NOW - dt.timedelta(hours=5)), 'base': F.base,
             'at': Z(NOW - dt.timedelta(hours=5))})
    F.j('foo-01', 'preflight-ok', NOW - dt.timedelta(hours=5)); F.j('foo-01', 'draw', NOW - dt.timedelta(hours=4))
    F.j('foo-01', 'draw-short', NOW - dt.timedelta(minutes=5))
    F.add_proc(81, ['bash', '/home/mike/canary-loop.sh', 'foo-01'])
    with Env(F.env()):
        CS.tick(CS.paths())
    pages = open(os.path.join(F.home, 'digest', 'page.jsonl')).read()
    assert 'waited 4.0 h' in pages, pages


def t_w_read_drift_pages(CS, F):
    F.enqueue(CS)
    F.state({'state': 'launching', 'run': 'foo-01', 't0': Z(NOW - dt.timedelta(hours=1)), 'base': F.base,
             'at': Z(NOW - dt.timedelta(hours=1))})
    F.j('foo-01', 'drawn', NOW - dt.timedelta(minutes=50))
    F.add_proc(82, ['bash', '/home/mike/canary-loop.sh', 'foo-01'])
    open(os.path.join(F.tmp, 'fooread.py'), 'w').write('# changed\n')
    with Env(F.env()):
        CS.tick(CS.paths())
    pages = open(os.path.join(F.home, 'digest', 'page.jsonl')).read()
    assert 'readdrift' not in pages and 'fooread' in pages and 'restore it' in pages, pages


def t_w4_r10_wait_pages_after_3h(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'draw_exposure': {'require': []}})
    F.enqueue(CS)
    with Env(F.env(FIX_DE='few')):
        CS.tick(CS.paths())
    with Env(F.env(FIX_DE='few', SCHED_FAKE_NOW=Z(NOW + dt.timedelta(hours=3, minutes=5)))):
        for b in BOTS:
            F.log(b, NOW + dt.timedelta(hours=3, minutes=4), F.base[:7] + '+abc123')
        CS.tick(CS.paths())
    pages = open(os.path.join(F.home, 'digest', 'page.jsonl')).read()
    assert 'fewer than two pools' in pages and 'board-a' in pages, pages



def t_impl_sha_from_launch_row_not_mutable_registration(CS, F):
    """Claude impl 1 + IMPL-2: a registration edited after the deploy does not block closure (the launch row decides)
    and the edit is paged."""
    F.enqueue(CS)
    F.state({'state': 'launching', 'run': 'mr-01', 't0': Z(NOW - dt.timedelta(hours=8)), 'canary_sha': F.other,
             'at': Z(NOW - dt.timedelta(hours=8))})
    F.closed_run('mr-01')
    F.regfile('mr-01', F.canary[:7])                       # replaced with ANOTHER sha after the deploy
    expect(CS, F, 'launch')
    with Env(F.env(FIX_LOOP='none')):
        P = CS.paths(); st = CS.gather(P)
        assert st['reg_sha']['mr-01'] == F.other and st.get('reg_edited'), st.get('reg_edited')


def t_impl_immutable_sources_conflict_needs_closed_sha(CS, F):
    """IMPL-2: launch row and promoted note disagree -> refused without --sha; --sha must be a listed source with a
    ledger row; then it closes."""
    F.enqueue(CS); F.regfile('cf-01', F.other[:7])
    t = NOW - dt.timedelta(hours=2)
    F.state({'state': 'launching', 'run': 'cf-01', 't0': Z(t - dt.timedelta(hours=7)), 'canary_sha': F.canary,
             'at': Z(t - dt.timedelta(hours=7))})
    F.j('cf-01', 'drawn', t - dt.timedelta(hours=6), 'board-a,hive-a :: x')
    F.j('cf-01', 'deployed', t - dt.timedelta(hours=6), 'board-a,hive-a %s' % Z(t - dt.timedelta(hours=6)))
    F.j('cf-01', 'recorded', t - dt.timedelta(minutes=5), 'KEEP')
    F.led(F.other[:7], 'board-a,hive-a', 'KEEP', t - dt.timedelta(minutes=5))
    F.j('cf-01', 'promoted', t, '%s fleet-wide' % F.other[:7])
    expect(CS, F, 'block', 'S7', 'cf-01')
    rc, out = human(CS, F, 'closed', 'cf-01', 'x')
    assert rc == 2 and 'cannot be established' in out, out
    rc, out = human(CS, F, 'closed', 'cf-01', 'x', '--sha', 'deadbeefdeadbeef')
    assert rc == 2 and 'none of the recorded sources' in out, out
    rc, out = human(CS, F, 'closed', 'cf-01', 'x', '--sha', F.canary[:7])       # a source, but no ledger row for it
    assert rc == 2, out
    rc, out = human(CS, F, 'closed', 'cf-01', 'promoted note is right', '--sha', F.other[:7])
    assert rc == 0, out
    for b in BOTS:
        F.log(b, NOW + dt.timedelta(minutes=1), F.base[:7] + '+abc123')
    expect(CS, F, 'launch', SCHED_FAKE_NOW=Z(NOW + dt.timedelta(minutes=2)))


def t_impl_historical_seed_is_not_a_closure_time(CS, F):
    """Codex IMPL-2 #2: an install seed must not displace the latest real closure (here a death REVERT)."""
    F.enqueue(CS)
    F.closed_run('dg-09', decision='REVERT', note='dg-09: VERDICT REVERT :: death gate: 3 canary deaths')
    F.regfile('old-01', F.other[:7]); F.j('old-01', 'drawn', NOW - dt.timedelta(days=20), 'board-c :: x')
    F.j('old-01', 'read-90', NOW - dt.timedelta(days=20), 'x')
    F.state({'state': 'human', 'run': 'old-01', 'how': 'historical', 'at': Z(NOW - dt.timedelta(minutes=1))})
    expect(CS, F, 'block', 'R11', 'dg-09')


def t_impl_r11_fails_closed_without_decision(CS, F):
    """Codex IMPL-2 #1: a closed run whose ledger decision cannot be found holds R11."""
    F.enqueue(CS)
    F.closed_run('nf-01')
    with Env(F.env()):
        st = CS.gather(CS.paths())
        st['reg_sha']['nf-01'] = ''
        assert CS.death_hold(CS.paths(), st, 'nf-01'), 'no hold without a findable decision'


def t_impl_r10_bound_to_its_variant(CS, F):
    """Codex IMPL-2 #3: an R10 answer computed for one registration is not reused for another."""
    F.enqueue(CS)
    with Env(F.env(FIX_DE='crash')):
        P = CS.paths()
        st = CS.gather(P, full=True, r10=(('foo-01', 'x' * 40, 'otherhash'), ''))   # a stale "fine" for another key
        assert st['r10'].startswith('drawexposure.py did not answer'), st['r10']


def t_impl_sha_match_needs_real_prefix(CS, F):
    assert CS.sha_match('abcdef1', 'abcdef1234')
    assert not CS.sha_match('abcdef1xx', 'abcdef1yy'), 'two different shas sharing 7 chars matched'
    assert not CS.sha_match('', 'abcdef1')


def t_impl_ledger_row_before_deploy_does_not_close(CS, F):
    F.enqueue(CS)
    F.closed_run('lb-01', ledger=False)
    F.led(F.other[:7], 'board-a,hive-a', 'KEEP', NOW - dt.timedelta(hours=8, minutes=2))   # 2 min BEFORE its deploy
    expect(CS, F, 'block', 'S7', 'lb-01')


def t_impl_drawn_fallback_binds_to_the_deciding_attempt(CS, F):
    """Codex impl: abandon -> rearm -> a different draw -> no `deployed` line: the decision's pools are the 2nd draw's."""
    F.enqueue(CS); F.regfile('dr-01', F.other[:7])
    t = NOW - dt.timedelta(hours=3)
    F.j('dr-01', 'drawn', t - dt.timedelta(hours=9), 'board-c,placebo-d :: DRAW (old, abandoned)')
    F.j('dr-01', 'drawn', t - dt.timedelta(hours=6), 'board-a,hive-a :: DRAW (2 pools)')
    F.j('dr-01', 'read-180', t - dt.timedelta(hours=3), 'VERDICT NOT_YET')
    F.j('dr-01', 'recorded', t - dt.timedelta(minutes=10), 'KEEP')
    F.led(F.other[:7], 'board-a,hive-a', 'KEEP', t - dt.timedelta(minutes=10))
    F.j('dr-01', 'promoted', t)
    expect(CS, F, 'launch')


def t_impl_human_closed_death_revert_still_holds(CS, F):
    """Codex impl: a run closed by a human (no torn-down/promoted line) still drives R11."""
    F.enqueue(CS); F.regfile('hc-01', F.other[:7])
    t = NOW - dt.timedelta(hours=2)
    F.j('hc-01', 'drawn', t - dt.timedelta(hours=6), 'board-a,hive-a :: x')
    F.j('hc-01', 'deployed', t - dt.timedelta(hours=6), 'board-a,hive-a %s' % Z(t - dt.timedelta(hours=6)))
    F.j('hc-01', 'record-failed', t - dt.timedelta(minutes=10), 'x')
    F.led(F.other[:7], 'board-a,hive-a', 'REVERT', t - dt.timedelta(minutes=5), 'hc-01: VERDICT REVERT :: death gate: 4 canary deaths')
    F.state({'state': 'human', 'run': 'hc-01', 'how': 'closed', 'at': Z(t)})
    expect(CS, F, 'block', 'R11', 'hc-01')


def t_impl_death_window_change_row_revert_holds(CS, F):
    """Claude impl 3 / Codex impl: verdict.py's licensed change-row REVERT (extra {'deaths': n}, no by=death_gate)."""
    F.enqueue(CS)
    F.closed_run('cw-01', decision='REVERT', note='cw-01: VERDICT REVERT (+90) :: v11 header only')
    json.dump({'verdict': 'REVERT', 'extra': {'deaths': 2}}, open(os.path.join(F.home, 'digest', 'reads', 'cw-01-verdict-90.json'), 'w'))
    expect(CS, F, 'block', 'R11', 'counts deaths')
    assert CS.DEATH_REVERT.search('change row inside a death window, discriminating: x')


def t_impl_parse_systemd_ts(CS, F):
    assert CS.parse_systemd_ts('Wed 2026-10-07 23:53:11 UTC\n') == dt.datetime(2026, 10, 7, 23, 53, 11, tzinfo=dt.timezone.utc)
    assert CS.parse_systemd_ts('Wed 2026-10-07 18:53:11 CDT') is None
    assert CS.parse_systemd_ts('') is None


def t_impl_install_hold_ignores_its_installer_parent(CS, F):
    """Claude impl 2: install-hold called from inside install-x.sh must not count its own caller as a slot owner."""
    me = os.getpid()
    F.add_proc(5555, ['bash', '/home/mike/gate-vX/install-gate-vX.sh'])
    os.makedirs(os.path.join(F.proc, str(me)), exist_ok=True)
    open(os.path.join(F.proc, str(me), 'cmdline'), 'wb').write(b'python3\0canary-sched.py\0')
    open(os.path.join(F.proc, str(me), 'stat'), 'w').write('%d (python3) S 5555 ' % me + ' '.join(['0'] * 17) + ' 1 0 0\n')
    rc, out = human(CS, F, 'install-hold', 'gate-agent', '30')
    assert rc == 0, out
    F.add_proc(5556, ['bash', '/home/mike/other/install-other.sh'])        # an UNRELATED installer still counts
    human(CS, F, 'install-release')
    rc, out = human(CS, F, 'install-hold', 'gate-agent', '30')
    assert rc == 2 and 'install-other' in out, out


def t_impl_preverify_blocks_a_changed_read(CS, F):
    """Codex impl: a read that appears/changes between gather and the Popen is not launched over."""
    F.enqueue(CS)
    with Env(F.env(FIX_LOOP='ok')):
        P = CS.paths(); st = CS.gather(P)
        d = CS.decide(st); assert d[0] == 'launch', d
        open(os.path.join(F.tmp, 'fooread.py'), 'w').write('# appeared meanwhile\n')
        pid = CS.launch(P, st, d[1], d[2])
    assert pid is None, 'launched over a read with the wrong md5'
    assert open(os.path.join(F.tmp, 'fooread.py')).read() == '# appeared meanwhile\n'
    assert open(F.journal).read() == '', 'the loop ran'
    expect(CS, F, 'block', 'H3', 'blocked since its last attempt')


def t_impl_relaunch_check_after_r10(CS, F):
    """Codex impl: a hold placed while the exposure check runs is honoured (decision re-made after R10)."""
    F.enqueue(CS)
    hook = os.path.join(F.d, 'hold-during-r10.py')
    open(F.de, 'a').write('')
    de2 = os.path.join(F.d, 'de2.py')
    open(de2, 'w').write('import json, sys\nq = json.load(open(%r))\nq["entries"][0]["hold"] = "placed during R10"\n'
                         'json.dump(q, open(%r, "w"))\nprint(sys.argv[1] + " declares no draw_exposure block")\n' % (F.queue, F.queue))
    with Env(F.env(SCHED_DRAWEXPOSURE=de2, FIX_LOOP='ok')):
        CS.tick(CS.paths())
    time.sleep(0.3)
    assert open(F.journal).read() == '', 'launched although a hold landed during the exposure check'


def t_impl_second_r10_defers(CS, F):
    """Codex IMPL-3: when the re-gather after R10 had to run R10 AGAIN (identity changed), the tick does not launch."""
    F.enqueue(CS)
    real = CS.gather
    calls = []

    def fake(P, full=True, r10=None):
        st = real(P, full=full, r10=r10)
        calls.append(r10)
        if r10 is not None:
            st['r10_ran'] = True             # as if the head/base changed and the check ran again
        return st
    CS.gather = fake
    try:
        with Env(F.env(FIX_LOOP='ok')):
            CS.tick(CS.paths())
    finally:
        CS.gather = real
    time.sleep(0.3)
    assert len(calls) == 2 and open(F.journal).read() == '', (calls, open(F.journal).read())


TESTS = [v for k, v in sorted(globals().items()) if k.startswith('t_')]


def run_suite(path, quiet=False):
    CS = load(path)
    fails = []
    for t in TESTS:
        F = Fix()
        try:
            t(CS, F)
            if not quiet:
                print('PASS  %s' % t.__name__)
        except Exception as x:
            fails.append(t.__name__)
            if not quiet:
                print('FAIL  %s\n        -> %s: %s' % (t.__name__, type(x).__name__, str(x)[-600:]))
        finally:
            F.cleanup()
    return fails


# Each mutant removes or inverts ONE decision. The anchor must be present exactly once.
MUTANTS = [
    ("elif man.get('canary_pool') or man.get('canary_code_version'):", "elif False:"),
    ("    if st.get('procs'):\n        busy.append(('S2'", "    if False:\n        busy.append(('S2'"),
    ("    elif lk:\n", "    elif False:\n"),
    ("    elif st.get('dropins'):\n", "    elif False:\n"),
    ("        if len(builds) != 1:", "        if False:"),
    ("        if st.get('stale_units'):", "        if False:"),
    ("        if st.get('transitional_units'):", "        if False:"),
    ("        if nb < max(1, na - 5):", "        if False:"),
    ("    if st.get('canary_procs') and isinstance(man, dict) and not man.get('canary_pool'):", "    if False:"),
    ("        elif js == 'open':", "        elif False:"),
    ("    if any(p in CLOSED_PHASES for p in phases) and 'recorded' in phases and dts is not None and \\",
     "    if any(p in CLOSED_PHASES for p in phases) and dts is not None and \\"),
    ("    if st.get('pause'):", "    if False:"),
    ("        stale = (ts(ih.get('until')) or st['now']) < st['now']", "        stale = False"),
    ("    if st.get('death_hold'):", "    if False:"),
    ("    if DEATH_REVERT.search(str(d.get('note') or '')):", "    if False:"),
    ("DEATH_REVERT = re.compile(r'death gate:|death gate trip|rung-linked death|linked death|death-linked|death window', re.I)",
     "DEATH_REVERT = re.compile(r'death', re.I)"),
    ("    ev = [i for i, r in enumerate(rows) if str(r.get('phase', '')).startswith('read-') or r.get('phase') in DEPLOYED_EVIDENCE]",
     "    ev = []"),
    ("        elif st.get('r10_ran'):\n            # the identity changed", "        elif False:\n            # the identity changed"),
    ("    if not arts:\n        return (run, 'no REVERT", "    if False:\n        return (run, 'no REVERT"),
    ("    if e.get('hold'):", "    if False:"),
    ("        elif nb > st['now']:", "        elif False:"),
    ("        if ds in ('cancelled', 'blocked', 'predeploy', 'abandoned'):", "        if ds in ('cancelled',):"),
    ("    if es == 'blocked':\n        out.append(('H3'", "    if False:\n        out.append(('H3'"),
    ("    elif base not in vs:", "    elif False:"),
    ("        if sha256(reg) != v.get('registration_sha256'):", "        if False:"),
    ("        if (r.get('class') or '') != (e.get('class') or ''):\n            out.append", "        if False:\n            out.append"),
    ("            if sha256(dst) != v.get('registration_sha256'):", "            if False:"),
    ("                if got != want:", "                if False:"),
    ("        if not os.path.exists(dst):                     # never overwrite", "        if True:                     # never overwrite"),
    ("    if bad:\n        append_state(P, {'state': 'launched-pid', 'run': run, 'pid': None",
     "    if False:\n        append_state(P, {'state': 'launched-pid', 'run': run, 'pid': None"),
    ("    return len(a) >= 7 and len(b) >= 7 and (a.startswith(b) or b.startswith(a))",
     "    return bool(a) and bool(b) and (a.startswith(b[:7]) or b.startswith(a[:7]))"),
    ("            if r10 is None or r10[0] != key:", "            if r10 is None:"),
    ("    if not d:\n        return (run, 'its decision cannot be found", "    if False:\n        return (run, 'its decision cannot be found"),
    ("        elif imm:\n            regsha[run] = imm[0]", "        elif False:\n            regsha[run] = imm[0]"),
    ("        if not any(sha_match(sha_arg, v) for v in srcs.values()):", "        if False:"),
    ("        if w is None or w < since:\n            continue\n        if str(d.get('decision')",
     "        if w is None or w < since - dt.timedelta(minutes=5):\n            continue\n        if str(d.get('decision')"),
    ("            regsha[run] = imm[0] if all(sha_match(imm[0], x) for x in imm) else ''",
     "            regsha[run] = imm[-1]"),
    ("        dr = [r for r in rows[:ev[0]] if r.get('phase') == 'drawn']", "        dr = [r for r in rows if r.get('phase') == 'drawn'][:1]"),
    ("        if hw == 'closed' and hat and (ct is None or hat > ct):", "        if False:"),
    ("    if any('deaths' in (a.get('extra') or {}) for a in arts):", "    if False:"),
    ("        st['procs'] = [x for x in st['procs'] if x['pid'] not in anc]", "        pass"),
    ("        d = decide(st)\n        if d[0] != 'launch':", "        d = d\n        if d[0] != 'launch':"),
    ("    if st.get('next_slot') and e.get('class') != 'underground-safety':", "    if False:"),
    ("    if e.get('class') == 'bag-fix' and not st.get('drawrec_k4'):", "    if False:"),
    ("        if not declared and r.returncode == 0 and 'declares no draw_exposure' in txt:", "        if r.returncode == 0:"),
    ("        if declared and 'eligible on exposure:' in txt and 'REFUSED: the exposure read found' not in txt:",
     "        if 'eligible on exposure:' in txt:"),
    ("        if a['pid'] and str(a['pid']) in alive and a.get('start') is not None and alive[str(a['pid'])] == a['start']:",
     "        if a['pid'] and str(a['pid']) in alive:"),
    ("    t0 = iso(now())                 # whole seconds", "    t0 = now().isoformat()                 # whole seconds"),
    ("        if attempt_rows(st, run, a):\n            return 'blocked'", "        if False:\n            return 'blocked'"),
    ("        if ledger_row(st.get('ledger'), (st.get('reg_sha') or {}).get(run), pools, dts) is None:\n            print('REFUSED: ' + ledger_recipe",
     "        if False:\n            print('REFUSED: ' + ledger_recipe"),
    ("        if dep:\n            print('REFUSED: a deploy is still running", "        if False:\n            print('REFUSED: a deploy is still running"),
    ("        if drawn and (st['now'] - max(drawn)).total_seconds() < ABANDON_AFTER_DRAWN_MIN * 60:", "        if False:"),
    ("    if how == 'rearm':\n        if deployed:", "    if how == 'rearm':\n        if False:"),
    ("    if how == 'abandon':\n        if deployed:", "    if how == 'abandon':\n        if False:"),
    ("        if live:\n            print('INSTALL-HOLD written", "        if False:\n            print('INSTALL-HOLD written"),
    ("        if not HEX40.match(k):", "        if False:"),
    ("        if not v.get('approved'):", "        if False:"),
    ("            if int(parts[5].split(':')[-1]) == ino:", "            if False:"),
    ("        if any(P['canary_tree'] in x for x in argv):", "        if False:"),
    ("                if not dropin(b) and ((last_rec and ent and ent > last_rec) or",
     "                if not dropin(b) and ((last_rec and ent) or"),
    ("        h = (st['now'] - ts(draws[0]['ts'])).total_seconds() / 3600",
     "        h = (st['now'] - ts(draws[-1]['ts'])).total_seconds() / 3600"),
    ("            if h > STALL_H:\n                page(P, st, 'flag', '%s|r10wait'", "            if False:\n                page(P, st, 'flag', '%s|r10wait'"),
]


def run_mutants():
    src = open(SRC).read()
    survivors = []
    for i, (old, new) in enumerate(MUTANTS):
        n = src.count(old)
        assert n == 1, 'ANCHOR %s for mutant %d: %r' % ('MISSING' if n == 0 else 'NOT UNIQUE (%d)' % n, i, old[:80])
        d = tempfile.mkdtemp(prefix='sched-mut-')
        p = os.path.join(d, 'canary-sched.py')
        open(p, 'w').write(src.replace(old, new, 1))
        fails = run_suite(p, quiet=True)
        shutil.rmtree(d, ignore_errors=True)
        print('%-8s mutant %2d %-70s %s' % ('KILLED' if fails else 'SURVIVED', i, old.strip().splitlines()[0][:70],
                                           ','.join(fails[:3])))
        if not fails:
            survivors.append(i)
    return survivors


if __name__ == '__main__':
    fails = run_suite(SRC)
    print('\n%d/%d tests pass' % (len(TESTS) - len(fails), len(TESTS)))
    if fails:
        sys.exit(1)
    if '--mutants' in sys.argv:
        s = run_mutants()
        print('\n%d/%d mutants killed' % (len(MUTANTS) - len(s), len(MUTANTS)))
        sys.exit(1 if s else 0)
