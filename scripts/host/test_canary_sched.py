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
                      'variants': {self.base: {'registration': self.reg,
                                               'approved': 'test fixture: Claude APPROVE + Codex APPROVE'}}}

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
    F.closed_run('dg-01', decision='REVERT', note='dg-01: VERDICT REVERT (+0) :: rung-linked death on a non-ladder change',
                 t=NOW - dt.timedelta(minutes=40))
    # an artifact WITHOUT by=death_gate: only the note's /death/ can hold it (junkwell-01's shape)
    json.dump({'verdict': 'REVERT', 'extra': {}}, open(os.path.join(F.home, 'digest', 'reads', 'dg-01-verdict-0.json'), 'w'))
    expect(CS, F, 'block', 'R11', 'decided by a death')
    rc, out = human(CS, F, 'continue', 'dg-01', 'owner says go')
    assert rc == 0, out
    expect(CS, F, 'launch')


def t_r11_artifact_by_death_gate(CS, F):
    F.enqueue(CS)
    F.closed_run('dg-02', decision='REVERT', note='dg-02: VERDICT REVERT (+180) :: v15c guard', t=NOW - dt.timedelta(minutes=40))
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
    F.closed_run('na-01', decision='REVERT', note='na-01: VERDICT REVERT (+180) :: v11 climbs', t=NOW - dt.timedelta(minutes=40))
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
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'lab': True})
    F.enqueue(CS); open(os.path.join(F.home, 'digest', 'NEXT-SLOT.json'), 'w').write('{}'); expect(CS, F, 'block', 'H5')


def t_h6_bagfix_needs_k4(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'class': 'bag-fix', 'lab': True})
    e = dict(F.entry); e['class'] = 'bag-fix'; F.enqueue(CS, e)
    expect(CS, F, 'launch')
    open(os.path.join(F.home, 'mcai-analysis', 'drawrec.sh'), 'w').write('TARGET_K = 2\n')
    expect(CS, F, 'block', 'H6')


def t_r10_crash_blocks(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'lab': True})
    F.enqueue(CS); expect(CS, F, 'block', 'R10', FIX_DE='crash')


def t_r10_declared_needs_eligible_line(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'draw_exposure': {'require': []}, 'lab': True})
    F.enqueue(CS)
    expect(CS, F, 'launch', FIX_DE='ok')
    expect(CS, F, 'block', 'R10', FIX_DE='undeclared')       # a declared registration answered as undeclared
    expect(CS, F, 'block', 'R10', FIX_DE='little')
    expect(CS, F, 'wait', 'R10', 'board-a', FIX_DE='few')


def t_r10_undeclared_must_say_so(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'lab': True})
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
                 note='v11-01: VERDICT REVERT (+180) :: deaths 1 (0.033/bh over 30.0 measured bot-h) vs control 7 | v11 climbs +239%',
                 t=NOW - dt.timedelta(minutes=40))   # inside the v37 2-h expiry, so only the regex can release it
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
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'draw_exposure': {'require': []}, 'lab': True})
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
    F.closed_run('dg-09', decision='REVERT', note='dg-09: VERDICT REVERT :: death gate: 3 canary deaths',
                 t=NOW - dt.timedelta(minutes=40))   # inside the v37 2-h R11 expiry
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
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'read_minutes': [180, 360], 'lab': True})
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
    t = NOW - dt.timedelta(minutes=40)   # inside the v37 2-h R11 expiry
    F.j('hc-01', 'drawn', t - dt.timedelta(hours=6), 'board-a,hive-a :: x')
    F.j('hc-01', 'deployed', t - dt.timedelta(hours=6), 'board-a,hive-a %s' % Z(t - dt.timedelta(hours=6)))
    F.j('hc-01', 'record-failed', t - dt.timedelta(minutes=10), 'x')
    F.led(F.other[:7], 'board-a,hive-a', 'REVERT', t - dt.timedelta(minutes=5), 'hc-01: VERDICT REVERT :: death gate: 4 canary deaths')
    F.state({'state': 'human', 'run': 'hc-01', 'how': 'closed', 'at': Z(t)})
    expect(CS, F, 'block', 'R11', 'hc-01')


def t_impl_death_window_change_row_revert_holds(CS, F):
    """Claude impl 3 / Codex impl: verdict.py's licensed change-row REVERT (extra {'deaths': n}, no by=death_gate)."""
    F.enqueue(CS)
    F.closed_run('cw-01', decision='REVERT', note='cw-01: VERDICT REVERT (+90) :: v11 header only', t=NOW - dt.timedelta(minutes=40))
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
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'read_minutes': [180, 360], 'lab': True})
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


# ---------------------------------------------------------------------------------------- v37 fun mode (W4) --
def t_fun_r10_not_required(CS, F):
    """A fun-mode registration (no `lab`) launches although drawexposure would crash: R10 is lab-only."""
    F.enqueue(CS); expect(CS, F, 'launch', FIX_DE='crash')
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'lab': 'yes'})   # only the boolean true is lab
    F.enqueue(CS); expect(CS, F, 'launch', FIX_DE='crash')


def t_fun_h5_h6_not_required(CS, F):
    F.write_reg({'sha': F.canary[:7], 'reads': ['fooread', 'immobiledid'], 'class': 'bag-fix'})
    e = dict(F.entry); e['class'] = 'bag-fix'; F.enqueue(CS, e)
    open(os.path.join(F.home, 'mcai-analysis', 'drawrec.sh'), 'w').write('TARGET_K = 2\n')
    open(os.path.join(F.home, 'digest', 'NEXT-SLOT.json'), 'w').write('{}')
    expect(CS, F, 'launch')


def _death_revert(F, run, hours, note, extra):
    F.closed_run(run, decision='REVERT', note=note, t=NOW - dt.timedelta(hours=hours))
    json.dump({'verdict': 'REVERT', 'extra': extra}, open(os.path.join(F.home, 'digest', 'reads', '%s-verdict-180.json' % run), 'w'))


def t_r11_expires_after_two_hours_unlinked(CS, F):
    F.enqueue(CS)
    _death_revert(F, 'ex-01', 1.5, 'ex-01: VERDICT REVERT (+180) :: death gate: 3 canary deaths', {'by': 'death_gate', 'deaths': 3})
    expect(CS, F, 'block', 'R11', 'expires')
    F2 = Fix()
    try:
        F2.enqueue(CS)
        _death_revert(F2, 'ex-02', 2.5, 'ex-02: VERDICT REVERT (+180) :: death gate: 3 canary deaths', {'by': 'death_gate', 'deaths': 3})
        d, st = expect(CS, F2, 'launch')
        assert st.get('r11_expired') and st['r11_expired'][0] == 'ex-02', st.get('r11_expired')
    finally:
        F2.cleanup()


def t_r11_change_linked_never_expires(CS, F):
    F.enqueue(CS)
    _death_revert(F, 'ln-01', 6, 'ln-01: VERDICT REVERT (+0) :: rung-linked death on a non-ladder change', {})
    expect(CS, F, 'block', 'R11', 'CHANGE-LINKED')


def t_r11_artifact_linked_never_expires(CS, F):
    """funread.py's REVERT artifact carries extra.linked: a linked death holds past 2 h even with a bland note."""
    F.enqueue(CS)
    _death_revert(F, 'ln-02', 6, 'ln-02: VERDICT REVERT (+180) :: fun-mode generic read', {'by': 'death_gate', 'deaths': 2, 'linked': 1})
    expect(CS, F, 'block', 'R11', 'CHANGE-LINKED')


def t_r11_lab_run_never_expires(CS, F):
    """A LAB run keeps the old hold (review r1, Codex): only `continue` releases it."""
    F.enqueue(CS)
    _death_revert(F, 'lb-01', 6, 'lb-01: VERDICT REVERT (+180) :: death gate: 3 canary deaths', {'by': 'death_gate', 'deaths': 3})
    json.dump({'sha': F.other[:7], 'reads': ['immobiledid'], 'lab': True},
              open(os.path.join(F.home, 'mcai-analysis', 'registrations', 'lb-01.json'), 'w'))
    expect(CS, F, 'block', 'R11', 'lab run')


def t_r11_change_row_revert_is_linked(CS, F):
    """verdict.py's licensed change-row REVERT ({'deaths': n}, no by=death_gate) is change-linked: no expiry (review r1)."""
    F.enqueue(CS)
    _death_revert(F, 'cr-01', 6, 'cr-01: VERDICT REVERT (+90) :: change row inside a death window, discriminating: x', {'deaths': 2})
    expect(CS, F, 'block', 'R11', 'CHANGE-LINKED')
    F2 = Fix()
    try:
        F2.enqueue(CS)
        _death_revert(F2, 'cr-02', 6, 'cr-02: VERDICT REVERT (+90) :: v11 header only', {'deaths': 2})
        expect(CS, F2, 'block', 'R11', 'CHANGE-LINKED')
    finally:
        F2.cleanup()


def t_r11_expired_pure(CS, F):
    t = NOW
    assert CS.r11_expired(False, t - dt.timedelta(hours=2), t) is True
    assert CS.r11_expired(False, t - dt.timedelta(hours=1, minutes=59), t) is False
    assert CS.r11_expired(True, t - dt.timedelta(hours=9), t) is False
    assert CS.r11_expired(False, None, t) is False


def t_approval_names_reviewer(CS, F):
    assert CS.approval_problem('Codex', False) == ''
    assert CS.approval_problem('  ', False)
    assert CS.approval_problem(None, False)
    assert CS.approval_problem('Codex APPROVE', True)
    assert CS.approval_problem('Claude r1 + Codex r1 APPROVE', True) == ''


STUB_PROTECTED = """import sys, subprocess, argparse
ap = argparse.ArgumentParser()
for a in ('--repo', '--base', '--head', '--list'):
    ap.add_argument(a)
a = ap.parse_args()
pats = [l.strip() for l in open(a.list) if l.strip() and not l.startswith('#')]
if 'CRASH' in pats:
    sys.exit(2)
ch = subprocess.run(['git', '-C', a.repo, 'diff', '--name-only', a.base, a.head], capture_output=True, text=True, check=True).stdout.split()
h = [c for c in ch if c in pats]
print('PROTECTED (tier 3):' if h else 'not protected')
for x in h:
    print('  ' + x)
sys.exit(1 if h else 0)
"""


def _prot_repo(F, listing):
    """base2 (adds the stub decider + list) -> c_ok (touches build.mjs) / c_prot (touches reflex.mjs)."""
    g = lambda *a: sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a, cwd=F.git)
    os.makedirs(os.path.join(F.git, 'scripts', 'lib')); os.makedirs(os.path.join(F.git, 'config'))
    os.makedirs(os.path.join(F.git, 'bots', 'src'))
    open(os.path.join(F.git, 'scripts', 'lib', 'protected.py'), 'w').write(STUB_PROTECTED)
    open(os.path.join(F.git, 'config', 'protected-paths.txt'), 'w').write(listing)
    g('add', '-A'); g('commit', '-q', '-m', 'base2')
    base2 = sh('git', 'rev-parse', 'HEAD', cwd=F.git)
    open(os.path.join(F.git, 'bots', 'src', 'build.mjs'), 'w').write('x\n'); g('add', '-A'); g('commit', '-q', '-m', 'ok')
    ok = sh('git', 'rev-parse', 'HEAD', cwd=F.git)
    g('checkout', '-q', base2)
    os.makedirs(os.path.join(F.git, 'bots', 'src'), exist_ok=True)
    open(os.path.join(F.git, 'bots', 'src', 'reflex.mjs'), 'w').write('x\n'); g('add', '-A'); g('commit', '-q', '-m', 'prot')
    prot = sh('git', 'rev-parse', 'HEAD', cwd=F.git)
    return base2, ok, prot


def _validate(CS, F, base, canary, approved, extra_reg=None):
    reg = os.path.join(F.home, 'mcai-analysis', 'v-%s.json' % canary[:7])
    json.dump(dict({'sha': canary[:7], 'reads': []}, **(extra_reg or {})), open(reg, 'w'))
    e = {'run': 'p-01', 'class': '', 'variants': {base: {'registration': reg, 'approved': approved}}}
    with Env(F.env()):
        return CS.validate_entry(CS.paths(), e, []), e


def t_queue_add_protected_needs_both_engines(CS, F):
    base2, ok, prot = _prot_repo(F, 'bots/src/reflex.mjs\n')
    bad, e = _validate(CS, F, base2, ok, 'Codex r1 APPROVE')
    assert not bad, bad
    assert e['variants'][base2]['protected'] is False
    bad, _ = _validate(CS, F, base2, prot, 'Codex r1 APPROVE')
    assert any('both engines' in b for b in bad), bad
    bad, _ = _validate(CS, F, base2, prot, 'Claude r1 + Codex r1 APPROVE')
    assert not bad, bad
    bad, _ = _validate(CS, F, base2, prot, 'Codex r1 APPROVE', {'lab': True})   # lab mode: the old rule (any name)
    assert not bad, bad
    bad, _ = _validate(CS, F, base2, prot, '   ', {'lab': True})                # ...but a name is still required
    assert any('reviewer' in b for b in bad), bad


def t_queue_add_undecidable_is_protected(CS, F):
    # no decider at the base (the fixture's empty commits): undecidable = protected
    bad, _ = _validate(CS, F, F.base, F.canary, 'Codex APPROVE')
    assert any('both engines' in b and 'absent at the base' in b for b in bad), bad
    F2 = Fix()
    try:
        base2, ok, _ = _prot_repo(F2, 'CRASH\n')
        bad, _ = _validate(CS, F2, base2, ok, 'Codex APPROVE')
        assert any('could not decide' in b for b in bad), bad
    finally:
        F2.cleanup()



# ------------------------------------------------------------------------------------------- v41 bundles + fast --
PROT_LIB = os.path.join(os.path.normpath(os.path.join(HERE, '..', 'lib')), 'protected.py')
JS_BASE = """import { x } from './x.mjs'

export function alpha() {
  return 1
}

export function beta() {
  return 2
}

export const SKILLS = {
  dig: { run: alpha },
  walk: { run: beta },
}
"""


def _js_repo(variants):
    """A throwaway repo: base commit with bots/src/m.mjs = JS_BASE and bots/test/t.test.mjs; each variant {name:
    {path: new text}} is a branch off the base. -> (dir, base sha, {name: sha})."""
    d = tempfile.mkdtemp(prefix='sched-js-')
    g = lambda *a: sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a, cwd=d)
    g('init', '-q')
    os.makedirs(os.path.join(d, 'bots', 'src')); os.makedirs(os.path.join(d, 'bots', 'test'))
    open(os.path.join(d, 'bots', 'src', 'm.mjs'), 'w').write(JS_BASE)
    open(os.path.join(d, 'bots', 'test', 't.test.mjs'), 'w').write('// a\n// b\n// c\n// d\n// e\n// f\n')
    g('add', '-A'); g('commit', '-q', '-m', 'base')
    base = sh('git', 'rev-parse', 'HEAD', cwd=d)
    out = {}
    for name, files in variants.items():
        g('checkout', '-q', '--detach', base)
        for rel, body in files.items():
            os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True)
            open(os.path.join(d, rel), 'w').write(body)
        g('add', '-A'); g('commit', '-q', '-m', name)
        out[name] = sh('git', 'rev-parse', 'HEAD', cwd=d)
    return d, base, out


def _prot_mod():
    spec = importlib.util.spec_from_file_location('protected_for_test', PROT_LIB)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _fp_facts(CS, d, base, shas):
    prot = _prot_mod()
    out = {}
    for name, sha in shas.items():
        fp, decl, used = CS.member_footprint(d, prot, base, sha)
        out[name] = {'run': name, 'entry': {}, 'reg': {'change_rows': ['row_%s' % name]}, 'fp': fp, 'decl': decl, 'used': used}
    return out


def t_v41_read_plan(CS, F):
    assert CS.read_plan({}) == ('90 180', 240, '')
    assert CS.read_plan({'fun_reads': None})[:2] == ('90 180', 240)
    assert CS.read_plan({'fun_reads': '45 90'})[:2] == ('45 90', 150)
    for bad in ('30 60', '90', ['45', '90'], 45):
        assert CS.read_plan({'fun_reads': bad})[0] is None, bad


def _diff(path, adds, dels=0, header=''):
    return ('diff --git a/%s b/%s\n%s--- a/%s\n+++ b/%s\n@@ -1,%d +1,%d @@\n' % (path, path, header, path, path, dels, adds)
            + ''.join('-old%d\n' % i for i in range(dels)) + ''.join('+  x%d = %d\n' % (i, i) for i in range(adds)))


def t_v41_fast_problem(CS, F):
    reg = {'sha': 'x'}
    assert CS.fast_problem(_diff('bots/src/a.mjs', 100, 50), 'none', reg, False) == ''
    assert '151 changed' in CS.fast_problem(_diff('bots/src/a.mjs', 151), 'none', reg, False)
    cm = _diff('bots/src/a.mjs', 100) + ''.join('+  // comment %d\n+\n' % i for i in range(200))
    assert CS.fast_problem(cm, 'none', reg, False) == '', 'comment and blank lines must not count'
    assert CS.fast_problem(_diff('bots/test/a.test.mjs', 900), 'none', reg, False) == '', 'tests are free'
    bc = _diff('bots/src/a.mjs', 0) + ''.join('+/* annotation */ doWork(%d);\n' % i for i in range(151))
    assert '151 changed' in CS.fast_problem(bc, 'none', reg, False), 'Codex r1: code after a block comment counts'
    for line, want in (('// x', True), ('/* x */', True), ('/* open', True), (' * prose line', True), ('*/', True),
                       ('/* a */ f()', False), (' * 2;', False), ('x = 1 // y', False), ('*/ f()', False), ('// ${f()}', False)):
        assert CS.comment_only(line) is want, (line, want)
    assert 'adds' in CS.fast_problem(_diff('bots/src/new.mjs', 5, header='new file mode 100644\n'), 'none', reg, False)
    assert 'package' in CS.fast_problem(_diff('bots/package.json', 1), 'none', reg, False)
    assert 'tier 3' in CS.fast_problem(_diff('bots/src/a.mjs', 1), '3', reg, False)
    assert 'bundle' in CS.fast_problem(_diff('bots/src/a.mjs', 1), 'none', reg, True)
    assert CS.fast_problem(_diff('bots/src/a.mjs', 1), 'none', {'lab': True}, False)
    assert CS.fast_problem(_diff('bots/src/a.mjs', 1), 'none', {'class': 'model-env'}, False)


def t_v41_footprints(CS, F):
    alpha2 = JS_BASE.replace('  return 1\n', '  return 11\n')
    beta2 = JS_BASE.replace('  return 2\n', '  return 22\n')
    alpha3 = JS_BASE.replace('  return 1\n', '  return 111\n')
    dig2 = JS_BASE.replace('  dig: { run: alpha },', '  dig: { run: alpha, cost: 2 },')
    walk2 = JS_BASE.replace('  walk: { run: beta },', '  walk: { run: beta, cost: 3 },')
    imp1 = JS_BASE.replace("import { x } from './x.mjs'\n", "import { x } from './x.mjs'\nimport { y } from './y.mjs'\n")
    imp2 = JS_BASE.replace("import { x } from './x.mjs'\n", "import { z } from './z.mjs'\nimport { x } from './x.mjs'\n")
    impchg = JS_BASE.replace("import { x } from './x.mjs'\n", "import { x, w } from './x.mjs'\n")
    uses = JS_BASE.replace('  return 2\n', '  return alpha() + 2\n')
    t1 = '// a\n// b CHANGED\n// c\n// d\n// e\n// f\n'
    t2 = '// a\n// b\n// c\n// d\n// e CHANGED\n// f\n'
    d, base, sh_ = _js_repo({'A': {'bots/src/m.mjs': alpha2, 'bots/test/t.test.mjs': t1},
                             'B': {'bots/src/m.mjs': beta2, 'bots/test/t.test.mjs': t2},
                             'C': {'bots/src/m.mjs': alpha3}, 'DIG': {'bots/src/m.mjs': dig2},
                             'WALK': {'bots/src/m.mjs': walk2}, 'I1': {'bots/src/m.mjs': imp1},
                             'I2': {'bots/src/m.mjs': imp2}, 'ICHG': {'bots/src/m.mjs': impchg},
                             'USES': {'bots/src/m.mjs': uses},
                             'TPL2': {'bots/src/t2.mjs': 'export const t2 = () => `\n// ${alpha()}\n`\n'}, 'TPL': {'bots/src/t.mjs': 'export const t = () => `${alpha()}`\n'},
                             'OTHER': {'bots/src/o.mjs': 'export const o = 1\n'}})
    try:
        f = _fp_facts(CS, d, base, sh_)
        P = lambda a, b: CS.pair_problems(f[a], f[b])
        assert P('A', 'B') == [], 'different functions of one file, shared test file: %s' % P('A', 'B')
        assert any('m.mjs::alpha' in x for x in P('A', 'C')), P('A', 'C')
        assert P('DIG', 'WALK') == [], 'two rows of one table: %s' % P('DIG', 'WALK')
        assert any('row' in x for x in CS.fp_overlaps(f['DIG']['fp'], f['DIG']['fp'])), 'the same row overlaps'
        assert CS.fp_overlaps(f['I1']['fp'], f['I2']['fp']) == [], 'both only add imports'
        assert any('import block' in x for x in CS.fp_overlaps(f['I1']['fp'], f['ICHG']['fp'])), 'a changed import'
        assert any('use' in x and 'alpha' in x for x in P('A', 'USES')), 'cross-reference: %s' % P('A', 'USES')
        assert any('alpha' in x for x in P('A', 'TPL')), 'Codex r1: a template interpolation is a use: %s' % P('A', 'TPL')
        assert any('alpha' in x for x in P('A', 'TPL2')), 'Codex r2: a template interior line: %s' % P('A', 'TPL2')
        assert any('alpha' in x for x in P('A', 'DIG')), 'a row naming the changed function: %s' % P('A', 'DIG')
        assert any('whole file' in x for x in CS.fp_overlaps(f['OTHER']['fp'], f['OTHER']['fp'])), 'a new file is whole'
        assert P('A', 'OTHER') == []
        f['B']['reg'] = {'change_rows': ['_row_A']}
        assert any('shared change rows' in x for x in P('A', 'B')), 'rows are compared without the underscore'
        f['B']['reg'] = {'change_rows': ['row_B']}
        f['B']['entry'] = {'couples_with': ['A']}
        assert any('couples_with' in x for x in P('A', 'B'))
    finally:
        shutil.rmtree(d, ignore_errors=True)


def _mfacts(**kw):
    sb, tip = 'a' * 40, 'b' * 40
    e = {'run': 'm-01', 'class': '', 'hold': None, 'patch': {'base': sb, 'tip': tip, 'diff_sha256': 'c' * 64, 'files': ['bots/src/x.mjs']},
         'variants': {sb: {'canary_sha': tip, 'approved': 'Codex r1 APPROVE'}}}
    e.update(kw.pop('entry', {}))
    m = {'entry': e, 'state': 'ready', 'reg': {'sha': tip, 'reads': [], 'change_rows': ['x_row'], 'promotion': 'fleet-wide'},
         'tier': 'none', 'stacked': False, 'files': ['bots/src/x.mjs']}
    m.update(kw)
    return m


def t_v41_member_problem(CS, F):
    assert CS.member_problem(_mfacts()) == ''
    cases = [(dict(state='blocked'), 'state'), (dict(entry={'hold': 'x'}), 'held'), (dict(entry={'class': 'model-env'}), 'class'),
             (dict(entry={'bundled_in': 'b'}), 'already'), (dict(entry={'patch': None}), 'patch'),
             (dict(reg={'lab': True, 'change_rows': ['x']}), 'lab'),
             (dict(reg={'canary_env': ['A=1'], 'change_rows': ['x']}), 'canary_env'),
             (dict(reg={'reads': ['r'], 'change_rows': ['x']}), 'reads'), (dict(reg={'change_rows': []}), 'change_rows'),
             (dict(reg={'change_rows': ['x'], 'licence': {'class': 'rate'}}), 'rate'),
             (dict(tier='3'), 'tier'), (dict(tier='undecidable'), 'tier'), (dict(stacked=True), 'STACKED'),
             (dict(files=['bots/package.json']), 'package'),
             (dict(reg={'change_rows': ['x'], 'promotion': 'keep-subset'}), 'promotion')]
    for kw, word in cases:
        p = CS.member_problem(_mfacts(**kw))
        assert word in p, (kw, p)
    e = _mfacts()['entry']
    e['variants'][e['patch']['base']]['approved'] = ''
    assert 'reviewer' in CS.member_problem(_mfacts(entry={'variants': e['variants']}))


def t_v41_plan_bundle(CS, F):
    f = {}
    for r in ('a-01', 'b-01', 'c-01', 'd-01'):
        m = _mfacts(entry={'run': r})
        m.update({'run': r, 'fp': {('DECL', 'bots/src/%s.mjs' % r, 'f')}, 'decl': set(), 'used': set()})
        m['reg'] = dict(m['reg'], change_rows=['row_' + r])
        f[r] = m
    mid = {'run': 'mid-01', 'class': '', 'hold': None, 'variants': {'x': {'protected': False}}}
    held = {'run': 'held-01', 'class': '', 'hold': 'HELD', 'variants': {'x': {'protected': False}}}
    t3 = {'run': 't3-01', 'class': '', 'hold': None, 'variants': {'x': {'protected': True}}}
    ents = [f['a-01']['entry'], mid, f['b-01']['entry'], held, t3, f['c-01']['entry'], f['d-01']['entry']]
    states = {e['run']: 'ready' for e in ents}
    probs, notes, ordered, after = CS.plan_bundle(['b-01', 'a-01'], f, ents, states)
    assert not probs and ordered == ['a-01', 'b-01'] and any('mid-01 waits' in n for n in notes), (probs, notes, ordered)
    probs, _, _, _ = CS.plan_bundle(['b-01', 'c-01'], f, ents, states)
    assert any('held-01' in p for p in probs) and any('t3-01' in p for p in probs), probs
    assert any('2..3' in p for p in CS.plan_bundle(['a-01'], f, ents, states)[0])
    assert any('2..3' in p for p in CS.plan_bundle(['a-01', 'b-01', 'c-01', 'd-01'], f, ents, states)[0])
    f['b-01']['entry']['after'] = ['a-01', 'zz-01']
    assert CS.plan_bundle(['a-01', 'b-01'], f, ents, states)[3] == ['zz-01'], 'an after between members is ordering only'


def _bundle_queue(F, CS, hold=None):
    """foo-01 + bar-01 reserved by bundle b-01 (variant on the fleet base), and dep-01 after bar-01."""
    regb = os.path.join(F.home, 'mcai-analysis', 'b-01.json')
    # the plan as the launch check recomputes it from the member entries (the fixture members carry no patch source)
    plan = CS.plan_hash([{'run': r, 'base': None, 'tip': None, 'diff_sha256': None, 'registration_sha256': None,
                          'couples_with': []} for r in ('foo-01', 'bar-01')])
    json.dump({'sha': F.canary[:7], 'reads': [], 'bundle': {'plan_sha256': plan, 'members': [{'run': 'foo-01'}, {'run': 'bar-01'}]}},
              open(regb, 'w'))
    regd = os.path.join(F.home, 'mcai-analysis', 'dep-01.json')
    json.dump({'sha': F.canary[:7], 'reads': []}, open(regd, 'w'))
    with Env(F.env()):
        P = CS.paths()
        b = {'run': 'b-01', 'class': '', 'after': [], 'hold': hold, 'not_before': None,
             'bundle': {'schema': 1, 'members': ['foo-01', 'bar-01'], 'plan_sha256': plan},
             'variants': {F.base: {'registration': regb, 'approved': 'bundle fixture: Claude + Codex'}}}
        assert not CS.validate_entry(P, b, [])
        b['variants'][F.base]['protected'] = False          # the fixture repo has no protected.py (undecidable)
        m1 = dict(json.loads(json.dumps(F.entry)), bundled_in='b-01')
        m2 = dict(json.loads(json.dumps(F.entry)), run='bar-01', bundled_in='b-01')
        assert not CS.validate_entry(P, m1, []) and not CS.validate_entry(P, m2, [])
        dep = {'run': 'dep-01', 'class': '', 'after': ['bar-01'], 'hold': None, 'not_before': None,
               'variants': {F.base: {'registration': regd, 'approved': 'fixture Claude + Codex'}}}
        assert not CS.validate_entry(P, dep, [])
        json.dump({'version': 1, 'entries': [b, m1, m2, dep]}, open(F.queue, 'w'))


def _close(F, run, decision, promoted):
    t = NOW - dt.timedelta(hours=1)
    F.regfile(run, F.other[:7])
    F.j(run, 'drawn', t - dt.timedelta(hours=3))
    F.j(run, 'deployed', t - dt.timedelta(hours=3), 'board-a,hive-a %s' % Z(t - dt.timedelta(hours=3)))
    F.j(run, 'recorded', t - dt.timedelta(minutes=5), decision)
    F.led(F.other[:7], 'board-a,hive-a', decision, t - dt.timedelta(minutes=5))
    F.j(run, 'promoted' if promoted else 'torn-down', t, F.other if promoted else 'x')


def t_v41_bundle_pending_members_skipped(CS, F):
    _bundle_queue(F, CS)
    d, st = expect(CS, F, 'launch')
    assert d[1]['run'] == 'b-01', d[1]['run']
    ents = {e['run']: e for e in st['queue']['entries']}
    assert CS.entry_state(ents['foo-01'], st) == 'bundled' and CS.entry_state(ents['bar-01'], st) == 'bundled'


def t_v41_bundle_keep_promoted_members_done(CS, F):
    _bundle_queue(F, CS)
    _close(F, 'b-01', 'KEEP', True)
    d, st = expect(CS, F, 'launch')
    assert d[1]['run'] == 'dep-01', 'a member of a KEPT+promoted bundle satisfies `after`: %s' % d[1]['run']
    ents = {e['run']: e for e in st['queue']['entries']}
    assert CS.entry_state(ents['bar-01'], st) == 'done'


def t_v41_bundle_keep_unpromoted_is_failed(CS, F):
    _bundle_queue(F, CS)
    _close(F, 'b-01', 'KEEP', False)
    expect(CS, F, 'block', 'H8', 'closed KEEP without a promotion')


def t_v41_bundle_revert_blocks_until_split(CS, F):
    _bundle_queue(F, CS)
    _close(F, 'b-01', 'REVERT', False)
    expect(CS, F, 'block', 'R11')                          # R11 applies to a bundle exactly as to any run
    rc, out = human(CS, F, 'continue', 'b-01', 'not death-driven (fixture)')
    assert rc == 0, out
    expect(CS, F, 'block', 'H8', 'bundle split b-01')
    rc, out = human(CS, F, 'bundle', 'split', 'b-01', 'diagnosed offline', '--hold', 'bar-01=suspect')
    assert rc == 0 and 'return as single runs' in out, out
    d, st = expect(CS, F, 'launch')
    assert d[1]['run'] == 'foo-01', d[1]['run']
    ents = {e['run']: e for e in st['queue']['entries']}
    assert ents['bar-01']['hold'] == 'suspect' and 'bundled_in' not in ents['foo-01'], ents['bar-01']
    assert ents['foo-01']['bundle_history'][0]['decision'] == 'REVERT'


def t_v41_split_refuses_live_and_kept(CS, F):
    _bundle_queue(F, CS)
    F.j('b-01', 'drawn', NOW - dt.timedelta(hours=1))
    F.j('b-01', 'deployed', NOW - dt.timedelta(hours=1), 'board-a,hive-a %s' % Z(NOW - dt.timedelta(hours=1)))
    rc, out = human(CS, F, 'bundle', 'split', 'b-01', 'x')
    assert rc == 2 and 'not closed' in out, out
    F2 = Fix()
    try:
        _bundle_queue(F2, CS)
        _close(F2, 'b-01', 'KEEP', True)
        rc, out = human(CS, F2, 'bundle', 'split', 'b-01', 'x')
        assert rc == 2 and 'KEPT' in out, out
    finally:
        F2.cleanup()


def t_v41_split_never_deployed_cancels_bundle(CS, F):
    _bundle_queue(F, CS, hold='first bundle: report before release')
    expect(CS, F, 'block', 'H1', 'held')
    rc, out = human(CS, F, 'bundle', 'split', 'b-01', 'not now')
    assert rc == 0, out
    d, _ = expect(CS, F, 'launch')
    assert d[1]['run'] == 'foo-01', d[1]['run']


def t_v41_dangling_reservation_blocks(CS, F):
    _bundle_queue(F, CS)
    q = json.load(open(F.queue))
    q['entries'][0]['bundle']['members'] = ['foo-01']     # bar-01 still says bundled_in b-01
    q['entries'] = q['entries'][1:]                        # ...and the bundle entry is gone
    json.dump(q, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H8', 'dangling')


def t_v41_bundle_h3_members_must_stay_reserved(CS, F):
    _bundle_queue(F, CS)
    q = json.load(open(F.queue))
    q['entries'][2].pop('bundled_in')
    json.dump(q, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H3', 'no longer reserved')


def t_v41_reserved_member_is_frozen(CS, F):
    """Claude review r1 BLOCKER: a member reserved by a bundle cannot be cancelled, held or re-pointed (it would ship
    anyway); and a member changed by hand behind the commands is caught at launch (H3)."""
    _bundle_queue(F, CS)
    for argv in (('cancel', 'foo-01', 'x'), ('queue', 'hold', 'foo-01', 'x'), ('queue', 'not-before', 'foo-01', Z(NOW)),
                 ('queue', 'set-patch', 'foo-01', F.base)):
        rc, out = human(CS, F, *argv)
        assert rc == 2 and 'bundle split b-01' in out, (argv, out)
    expect(CS, F, 'launch')
    q = json.load(open(F.queue))
    q['entries'][2]['hold'] = 'edited by hand'
    json.dump(q, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H3', 'held or cancelled')
    q['entries'][2]['hold'] = None
    q['entries'][2]['couples_with'] = ['foo-01']
    json.dump(q, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H3', 'changed since `bundle make`')


def t_v41_split_clears_a_dangling_reservation(CS, F):
    _bundle_queue(F, CS)
    q = json.load(open(F.queue)); q['entries'] = q['entries'][1:]; json.dump(q, open(F.queue, 'w'))
    expect(CS, F, 'block', 'H8', 'dangling')
    rc, out = human(CS, F, 'bundle', 'split', 'b-01', 'the bundle entry was deleted by hand')
    assert rc == 0 and 'dangling' in out, out
    d, _ = expect(CS, F, 'launch')
    assert d[1]['run'] == 'foo-01'


def t_v41_status_parses_for_the_servea_waiter(CS, F):
    _bundle_queue(F, CS)
    rc, out = human(CS, F, 'status')
    assert rc == 0 and 'bundled_in=b-01' in out and 'BUNDLE b-01: pending' in out, out
    sq = os.path.join(HERE, 'servea-q.py')
    spec = importlib.util.spec_from_file_location('servea_q_for_test', sq)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    ents, busy, dec = m.parse_status(out)
    assert [e['run'] for e in ents] == ['b-01', 'foo-01', 'bar-01', 'dep-01'], ents
    assert [e['state'] for e in ents][1:3] == ['bundled', 'bundled'] and not m.head_ready(ents, 'dep-01'), ents


def t_v41_queue_add_refuses_bad_or_unjustified_plan(CS, F):
    base2, ok, _ = _prot_repo(F, 'bots/src/reflex.mjs\n')
    bad, _ = _validate(CS, F, base2, ok, 'Claude + Codex APPROVE', {'fun_reads': '30 60'})
    assert any('not one of' in b for b in bad), bad
    bad, _ = _validate(CS, F, base2, ok, 'Claude + Codex APPROVE', {'fun_reads': '45 90'})
    assert any('not justified' in b and 'adds' in b for b in bad), bad
    bad, _ = _validate(CS, F, base2, ok, 'Claude + Codex APPROVE', {'fun_reads': '90 180'})
    assert not bad, bad

# ------------------------------------------------------------------------------------- v42 (phase 1 item 1, 11-06) --
def _two(CS, F, first=None, second=None):
    """A queue of two entries: foo-01 (the head) and bar-01 (its own registration copy)."""
    reg2 = os.path.join(F.home, 'mcai-analysis', 'bar-01.json')
    shutil.copy(F.reg, reg2)
    a = dict(json.loads(json.dumps(F.entry)), **(first or {}))
    b = dict(json.loads(json.dumps(F.entry)), run='bar-01', **(second or {}))
    b['variants'] = {F.base: {'registration': reg2, 'approved': 'test fixture: Claude APPROVE + Codex APPROVE'}}
    with Env(F.env()):
        for e in (a, b):
            bad = CS.validate_entry(CS.paths(), e, [])
            assert not bad, bad
        json.dump({'version': 1, 'entries': [a, b]}, open(F.queue, 'w'))


def t_v42_held_head_is_skipped(CS, F):
    _two(CS, F, first={'hold': 'owner wants a pause'})
    d, st = decision(CS, F)
    assert d[0] == 'launch' and d[1]['run'] == 'bar-01', d
    assert [r for r, _ in st['skipped']] == ['foo-01'] and 'held' in st['skipped'][0][1], st['skipped']
    assert CS.head_entry(st)['run'] == 'foo-01', 'the physical head is unchanged'


def t_v42_skip_launch_writes_rows_and_digest_page(CS, F):
    _two(CS, F, first={'hold': 'owner wants a pause'})
    with Env(F.env(FIX_LOOP='ok')):
        assert CS.tick(CS.paths()) == 0
    time.sleep(0.5)
    rows = [json.loads(l) for l in open(os.path.join(F.home, 'digest', 'sched-state.jsonl'))]
    assert any(r.get('state') == 'skipped' and r.get('run') == 'foo-01' and r.get('target') == 'bar-01' for r in rows), rows
    assert any(r.get('state') == 'launching' and r.get('run') == 'bar-01' for r in rows), rows
    pages = [json.loads(l) for l in open(os.path.join(F.home, 'digest', 'page.jsonl'))]
    assert any(p['level'] == 'flag' and 'SKIPPED foo-01' in p['msg'] for p in pages), pages
    assert not any(p['level'] == 'error' for p in pages), 'a skip is not an error page (the queue is moving)'


def t_v42_never_past_an_entry_another_waits_on(CS, F):
    _two(CS, F, first={'hold': 'owner wants a pause'}, second={'after': ['foo-01']})
    d, st = expect(CS, F, 'block', 'H1', 'held')
    assert not st['skipped'], st['skipped']


def t_v42_unrelated_waiter_still_barriers(CS, F):
    """The literal rule (both engines): an entry ANY unfinished entry waits on is never skipped, even for another one."""
    _two(CS, F, first={'hold': 'x'})
    q = json.load(open(F.queue))
    third = dict(json.loads(json.dumps(q['entries'][1])), run='baz-01', after=['foo-01'])
    q['entries'].append(third)
    json.dump(q, open(F.queue, 'w'))
    d, st = expect(CS, F, 'block', 'H1', 'held')
    assert not st['skipped']


def t_v42_mixed_blockers_are_not_skipped(CS, F):
    """held AND not_before: one blocker is not a skippable kind, so the head is not skipped."""
    _two(CS, F, first={'hold': 'x', 'not_before': Z(NOW + dt.timedelta(hours=1))})
    d, st = expect(CS, F, 'block', 'H1', 'held')
    assert not st['skipped'], st['skipped']


def t_v42_not_before_is_not_skipped(CS, F):
    _two(CS, F, first={'not_before': Z(NOW + dt.timedelta(hours=1))})
    d, st = expect(CS, F, 'wait', 'H1', 'not before')
    assert not st['skipped']


def t_v42_skip_off_restores_strict_order(CS, F):
    _two(CS, F, first={'hold': 'x'})
    open(os.path.join(F.home, 'digest', 'SKIP-OFF'), 'w').close()
    expect(CS, F, 'block', 'H1', 'held')


def t_v42_blocked_attempt_is_skipped(CS, F):
    _two(CS, F)
    _launch(CS, F, 'refuse')                                  # foo-01 refused at launch -> H3 blocked, never deployed
    d, st = decision(CS, F)
    assert d[0] == 'launch' and d[1]['run'] == 'bar-01', (d[0], d[1] if d[0] != 'launch' else d[1]['run'])
    assert 'blocked-attempt' in st['skipped'][0][1], st['skipped']


def t_v42_all_skippable_pages_nothing_can_run(CS, F):
    _two(CS, F, first={'hold': 'a'}, second={'hold': 'b'})
    d, st = expect(CS, F, 'block', 'H1', 'bar-01: held')
    assert any(c == 'K' and 'foo-01 skipped' in r for c, r in d[1]), d
    with Env(F.env()):
        CS.tick(CS.paths())
    pages = [json.loads(l) for l in open(os.path.join(F.home, 'digest', 'page.jsonl'))]
    assert any(p['level'] == 'error' and 'BLOCKED H1 bar-01' in p['msg'] for p in pages), pages


def t_v42_skip_kinds_pure(CS, F):
    e = {'run': 'x-01'}
    st = {'pid_alive': {'77': '1'}, 'ar_job': {'pid': 99}, 'queue': {'entries': []}, 'journal': [], 'state_rows': [],
          'humans': [], 'now': NOW}
    k = lambda c, r: CS.skip_kind(c, 'x-01: ' + r, st, e)
    assert k('H1', 'held: x') == 'held'
    assert k('H1', 'not before 2026-11-07T00:00:00Z') is None
    assert k('H1', 'waits for y-01 to close (live)') is None
    assert k('H1', 'depends on y-01, which is cancelled (not a completion): edit the queue') is None
    assert k('H2', 'no variant for the fleet base abc (have: d): autorebase REFUSED at step repo: x') == 'autorebase-refused'
    assert k('H2', 'no variant ...: the autorebase job (pid 99) went silent at step suite (heartbeat x): it died') == 'autorebase-dead'
    st['ar_job'] = {'pid': 77}
    assert k('H2', 'no variant ...: the autorebase job (pid 77) went silent at step suite') is None, 'a live pid is not dead'
    assert k('H2', 'no variant ...: autorebase of a..b is building (step suite)') is None
    assert k('H3', 'registration x changed since it was queued') is None
    assert k('R10', 'WAIT fewer than two pools') == 'exposure'
    assert CS.skip_kind('H2', 'x-01: autorebase REFUSED at step repo', st, dict(e, bundle={'members': []})) is None


def t_v42_skipped_lab_head_r10_is_not_rerun_and_the_launch_uses_fresh_facts(CS, F):
    """Claude review r2: a lab head skipped on R10, then the target launches. Every entry's R10 answer is carried to the
    re-gather, so drawexposure runs once per entry (not again during the re-gather, which would make the launch use
    slot facts from before a 15-min check)."""
    _two(CS, F)
    q = json.load(open(F.queue))
    lab = json.load(open(F.reg)); lab.update(lab=True, draw_exposure={'kind': 'x'}); json.dump(lab, open(F.reg, 'w'))
    with Env(F.env()):
        q['entries'][0] = dict(q['entries'][0]); q['entries'][0]['variants'][F.base].pop('registration_sha256', None)
        bad = CS.validate_entry(CS.paths(), q['entries'][0], [])
        assert not bad, bad
    json.dump(q, open(F.queue, 'w'))
    calls = os.path.join(F.d, 'de-calls')
    de = os.path.join(F.d, 'de2.py')
    open(de, 'w').write('import sys\nopen(%r, "a").write(sys.argv[1] + "\\n")\n' % calls + open(F.de).read())
    with Env(F.env(SCHED_DRAWEXPOSURE=de, FIX_DE='few', FIX_LOOP='ok')):
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            CS.tick(CS.paths())
    out = buf.getvalue()
    time.sleep(0.5)
    n = open(calls).read().split() if os.path.exists(calls) else []
    assert 'LAUNCH bar-01' in out and 'past foo-01' in out, out
    assert n.count('foo-01') == 1, 'the skipped head was exposure-checked %d times (re-run in the re-gather)' % n.count('foo-01')


def _hold(F, until, **kw):
    json.dump(dict({'owner': 'servea-roll', 'until': Z(until), 'at': Z(NOW - dt.timedelta(hours=8))}, **kw),
              open(os.path.join(F.home, 'digest', 'INSTALL-HOLD'), 'w'))


def t_v42_expired_hold_released_on_a_baseline_fleet(CS, F):
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    d, st = decision(CS, F)
    assert st['hold_release'][0] and 'expired' in st['hold_release'][1], st['hold_release']
    with Env(F.env(FIX_LOOP='ok')):
        assert CS.tick(CS.paths()) == 0
    time.sleep(0.5)
    assert not os.path.exists(os.path.join(F.home, 'digest', 'INSTALL-HOLD')), 'the hold must be gone'
    assert [f for f in os.listdir(os.path.join(F.home, 'digest')) if f.startswith('INSTALL-HOLD.auto-released-')], 'kept aside'
    rows = [json.loads(l) for l in open(os.path.join(F.home, 'digest', 'sched-state.jsonl'))]
    assert any(r.get('state') == 'hold-auto-released' and r.get('owner') == 'servea-roll' for r in rows), rows
    assert any(r.get('state') == 'launching' for r in rows), 'the same tick goes on and launches'


def t_v42_live_hold_kept(CS, F):
    F.enqueue(CS); _hold(F, NOW + dt.timedelta(minutes=30))
    d, st = expect(CS, F, 'busy', 'S8')
    assert not st['hold_release'][0]


def t_v42_expired_hold_kept_while_a_dropin_remains(CS, F):
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    dd = os.path.join(F.unit, 'mcbot@%s.service.d' % BOTS[0]); os.makedirs(dd)
    open(os.path.join(dd, '10-canary.conf'), 'w').close()
    d, st = decision(CS, F)
    assert not st['hold_release'][0] and 'S4' in st['hold_release'][1], st['hold_release']
    assert any(c == 'S8' and 'not released' in r for c, r in d[1]), d


def t_v42_expired_hold_kept_while_an_installer_holds_the_lock(CS, F):
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    ino = os.stat(F.lock).st_ino
    open(F.locks, 'w').write('1: FLOCK  ADVISORY  WRITE 4242 08:01:%d 0 EOF\n' % ino)
    d, st = decision(CS, F)
    assert not st['hold_release'][0] and 'S3' in st['hold_release'][1], st['hold_release']


def t_v42_expired_hold_kept_while_a_rollout_runs(CS, F):
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    F.add_proc(4343, ['/usr/bin/python3', '/home/mike/w5alarms/scripts/host/modelrollout.py', 'resume'])
    d, st = decision(CS, F)
    assert not st['hold_release'][0] and 'rollout' in st['hold_release'][1], st['hold_release']


def t_v42_expired_hold_kept_with_a_silent_active_unit(CS, F):
    """Codex review r2: S5 lets a silent unit that started after the last decision pass; a release does not."""
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    with Env(F.env()):
        st = CS.gather(CS.paths())
    st['silent_started_after'] = [BOTS[0]]
    st['active_builds'] = {k: v - 1 for k, v in st['active_builds'].items()}
    rel, why = CS.hold_release(st)
    assert not rel and 'silent' in why, why


def t_v42_expired_hold_kept_on_two_builds(CS, F):
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    F.log(BOTS[0], NOW - dt.timedelta(minutes=1), F.canary[:7] + '+abc123')
    d, st = decision(CS, F)
    assert not st['hold_release'][0] and 'S5' in st['hold_release'][1], st['hold_release']


def t_v42_hold_with_dead_declared_pid_released_early(CS, F):
    F.enqueue(CS); _hold(F, NOW + dt.timedelta(minutes=30), pid=31337, start='999')
    d, st = decision(CS, F)
    assert st['hold_release'][0] and '31337' in st['hold_release'][1], st['hold_release']
    F.add_proc(31337, ['bash', '/home/mike/x.sh'], start='999')
    d, st = decision(CS, F)
    assert not st['hold_release'][0], 'its declared installer is alive'


def t_v42_autorelease_off(CS, F):
    F.enqueue(CS); _hold(F, NOW - dt.timedelta(minutes=30))
    open(os.path.join(F.home, 'digest', 'AUTORELEASE-OFF'), 'w').close()
    d, st = expect(CS, F, 'block', 'S8', 'STALE')
    assert not st['hold_release'][0]


def t_v42_install_hold_records_a_declared_pid(CS, F):
    F.add_proc(5151, ['bash', '/home/mike/install-x.sh'], start='4321')
    with Env(F.env()):
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            CS.main(['install-hold', 'x-install', '30', '--pid', '5151'])
    h = json.load(open(os.path.join(F.home, 'digest', 'INSTALL-HOLD')))
    assert h['pid'] == 5151 and h['start'] == '4321', h


def t_v42_patch_repair_rule_pure(CS, F):
    A, B = 'a' * 40, 'b' * 40
    assert CS.patch_repair_problem({'base': A, 'tip': B}, {'canary_sha': B, 'approved': 'Claude + Codex'}) == ''
    assert 'not the patch tip' in CS.patch_repair_problem({'base': A, 'tip': B}, {'canary_sha': A, 'approved': 'x'})
    assert 'no reviewer' in CS.patch_repair_problem({'base': A, 'tip': B}, {'canary_sha': B, 'approved': ' '})
    assert 'full shas' in CS.patch_repair_problem({'base': 'abc', 'tip': B}, {'canary_sha': B, 'approved': 'x'})


def _spec(CS, F, second=None):
    """live-01 is the LIVE canary (declared, its loop alive) and foo-01 waits behind it with a patch source."""
    reg_l = os.path.join(F.home, 'mcai-analysis', 'live-01.json'); shutil.copy(F.reg, reg_l)
    live = dict(json.loads(json.dumps(F.entry)), run='live-01')
    live['variants'] = {F.base: {'registration': reg_l, 'approved': 'test fixture: Claude APPROVE + Codex APPROVE'}}
    foo = dict(json.loads(json.dumps(F.entry)), after=['live-01'], **(second or {}))
    foo['patch'] = {'base': F.base, 'tip': F.canary, 'diff_sha256': '0' * 64, 'branch': 'foo'}
    with Env(F.env()):
        for e in (live, foo):
            bad = CS.validate_entry(CS.paths(), dict(e, patch=None) if e.get('patch') else e, [])
            assert not bad, bad
    json.dump({'version': 1, 'entries': [live, foo]}, open(F.queue, 'w'))
    F.regfile('live-01', F.other[:7])
    F.j('live-01', 'draw', NOW - dt.timedelta(hours=1)); F.j('live-01', 'drawn', NOW - dt.timedelta(minutes=50))
    F.j('live-01', 'deployed', NOW - dt.timedelta(minutes=45), 'board-a %s' % Z(NOW - dt.timedelta(minutes=45)))
    F.add_proc(80, ['bash', '/home/mike/canary-loop.sh', 'live-01'])
    F.set_manifest('board-a', F.other[:7])


def t_v42_spec_build_during_the_read(CS, F):
    _spec(CS, F)
    d, st = decision(CS, F)
    assert d[0] == 'busy', d
    sp = CS.spec_target(st)
    assert sp and sp[0]['run'] == 'foo-01' and sp[1] == F.other, (sp, st.get('canary_full'))


def t_v42_spec_not_when_off_held_or_tried(CS, F):
    _spec(CS, F)
    open(os.path.join(F.home, 'digest', 'SPEC-OFF'), 'w').close()
    d, st = decision(CS, F)
    assert CS.spec_target(st) is None, 'SPEC-OFF'
    os.unlink(os.path.join(F.home, 'digest', 'SPEC-OFF'))
    jd = os.path.join(F.home, 'autorebase', 'jobs'); os.makedirs(jd)
    json.dump({'state': 'refused', 'run': 'foo-01', 'base': F.other}, open(os.path.join(jd, 'foo-01--x.json'), 'w'))
    d, st = decision(CS, F)
    assert CS.spec_target(st) is None, 'a job for the canary sha exists (never a retry)'


def t_v42_spec_not_for_a_held_entry(CS, F):
    _spec(CS, F, second={'hold': 'x'})
    d, st = decision(CS, F)
    assert CS.spec_target(st) is None


def t_v42_spec_not_without_a_live_canary(CS, F):
    _spec(CS, F)
    F.set_manifest()
    d, st = decision(CS, F)
    assert CS.spec_target(st) is None


def t_v42_spec_not_on_a_half_torn_down_manifest(CS, F):
    """canary_pool cleared (teardown step 2) but the version left: no canary is deployed, so nothing to build onto."""
    _spec(CS, F)
    F.set_manifest(None, F.other[:7])
    with Env(F.env()):
        st = CS.gather(CS.paths())
    assert st.get('canary_full') == F.other and CS.spec_target(st) is None, st.get('canary_full')


def t_v42_spec_not_while_another_build_runs(CS, F):
    _spec(CS, F)
    jd = os.path.join(F.home, 'autorebase', 'jobs'); os.makedirs(jd)
    json.dump({'state': 'running', 'run': 'zzz-01', 'base': F.base, 'hb': Z(NOW - dt.timedelta(minutes=1))},
              open(os.path.join(jd, 'zzz-01--x.json'), 'w'))
    d, st = decision(CS, F)
    assert CS.spec_target(st) is None


def t_v42_remote_answer_pure(CS, F):
    out = 'ok   a.test.mjs 1ms\n3/3 files passed\n'
    assert CS.remote_answer({'rc': 0}, out) == (0, out)
    assert CS.remote_answer({'rc': 1}, 'FAIL a.test.mjs\n2/3 files passed\n')[0] == 1
    assert CS.remote_answer({'rc': 75}, out) is None, 'a lock timeout is no answer'
    assert CS.remote_answer({'rc': 'timeout'}, out) is None
    assert CS.remote_answer({'rc': 0}, 'truncated') is None, 'an unfinished log is no answer'
    assert CS.remote_answer({'rc': 0}, None) is None


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
    ("        if ds in ('cancelled', 'blocked', 'predeploy', 'abandoned', 'bundle-failed'):", "        if ds in ('cancelled',):"),
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
    ("            if key not in known:", "            if not known:"),
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
    ("    if lab and st.get('next_slot') and e.get('class') != 'underground-safety':", "    if False:"),
    ("    if lab and e.get('class') == 'bag-fix' and not st.get('drawrec_k4'):", "    if False:"),
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
    ("        if approval_problem(v.get('approved'), False):", "        if False:"),
    ("    return (not linked) and closed_at is not None and (t - closed_at).total_seconds() >= R11_EXPIRE_H * 3600",
     "    return closed_at is not None and (t - closed_at).total_seconds() >= R11_EXPIRE_H * 3600"),
    ("    if not lab and r11_expired(linked, closed_at, st['now']):", "    if False:"),
    ("    if not lab and r11_expired(linked, closed_at, st['now']):", "    if r11_expired(linked, closed_at, st['now']):"),
    ("    linked = linked or any('deaths' in (a.get('extra') or {}) and (a.get('extra') or {}).get('by') != 'death_gate'",
     "    linked = linked or any(False"),
    ("    linked = linked or any(int((a.get('extra') or {}).get('linked') or 0) > 0 for a in arts", "    linked = linked or any(False for a in arts"),
    ("            if json.load(f).get('lab') is not True:\n                return ''", "            if True:\n                return ''"),
    ("    if lab and st.get('next_slot')", "    if st.get('next_slot')"),
    ("    if protected and not all(rx.search(approved) for rx in TWO_ENGINES):", "    if False:"),
    ("            if rc != 0:\n                return 2, '%s is absent", "            if rc != 0:\n                return 0, '%s is absent"),
    ("    if rc == 1:\n        return True, ' '.join(out.split())[:300]", "    if rc == 1:\n        return False, ' '.join(out.split())[:300]"),
    ("            if int(parts[5].split(':')[-1]) == ino:", "            if False:"),
    ("        if any(P['canary_tree'] in x for x in argv):", "        if False:"),
    ("                if not dropin(b) and ((last_rec and ent and ent > last_rec) or",
     "                if not dropin(b) and ((last_rec and ent) or"),
    ("        h = (st['now'] - ts(draws[0]['ts'])).total_seconds() / 3600",
     "        h = (st['now'] - ts(draws[-1]['ts'])).total_seconds() / 3600"),
    ("            if h > STALL_H:\n                page(P, st, 'flag', '%s|r10wait'", "            if False:\n                page(P, st, 'flag', '%s|r10wait'"),
    # v41 bundles + the fast plan
    ("    return {'keep': 'done', 'failed': 'bundle-failed', 'pending': 'bundled'}.get(o)",
     "    return {'keep': 'done', 'failed': 'bundle-failed'}.get(o)"),
    ("        if ds == 'done':\n            continue                             # v41", "        if False:\n            continue                             # v41"),
    ("        return 'keep' if promoted and run_decision(st, be.get('run')) == 'KEEP' else 'failed'",
     "        return 'keep' if run_decision(st, be.get('run')) == 'KEEP' else 'failed'"),
    ("        return 'bundle-failed'                  # dangling reservation", "        return None                  # dangling reservation"),
    ("                if ta[2] == tb[2]:\n                    out.append('%s::%s'", "                if False:\n                    out.append('%s::%s'"),
    ("            elif k == {'IMPORTS+'}:\n                continue", "            elif False:\n                continue"),
    ("                if ta[2] == tb[2] and ta[3] & tb[3]:", "                if ta[2] == tb[2]:"),
    ("        hit = sorted((changed_decls(x['fp']) | x.get('decl', set())) & y.get('used', set()))", "        hit = []"),
    ("            if n.lstrip('_'):\n                out.add(n.lstrip('_'))", "            if n.lstrip('_'):\n                out.add(n)"),
    ("    if m.get('stacked'):", "    if False:"),
    ("    if m.get('tier') != 'none':", "    if False:"),
    ("    if state != 'ready' or e.get('hold') or", "    if state != 'ready' or"),
    ("    if n > FAST_MAX_LINES:", "    if False:"),
    ("        if cur.startswith('bots/src/') and l[:1] in ('+', '-') and not comment_only(l[1:]):",
     "        if cur.startswith('bots/src/') and l[:1] in ('+', '-') and l[1:].strip():"),
    ("        return end < 0 or comment_only(b[end + 2:])", "        return True"),
    ("        used.update(_IDENT_RE.findall(body))", "        used.update(_IDENT_RE.findall(re.sub(r'`[^`]*`', '', body)))"),
    ("    if '${' in b:\n        return False", "    if False:\n        return False"),
    ("    if not isinstance(v, str) or v not in READ_PLANS:", "    if not isinstance(v, str):"),
    ("    return ['fun_reads %r is not justified: %s' % (plan, fp)] if fp else []", "    return []"),
    ("    if es == 'bundle-failed':", "    if False:"),
    ("            if lost:", "            if False:"),
    ("                if x.get('run') in members and x.get('bundled_in') == brun:\n                    x.pop('bundled_in', None)",
     "                if x.get('run') in members and x.get('bundled_in') == brun:\n                    pass"),
    ("        if js == 'live' or entry_state(be, st) in ('running', 'launching') or (deployed and js != 'closed'):",
     "        if js == 'live':"),
    ("    if not 2 <= len(set(runs)) <= BUNDLE_MAX:", "    if False:"),
    ("    if hit:\n        return ('REFUSED: %s is reserved by bundle %s", "    if False:\n        return ('REFUSED: %s is reserved by bundle %s"),
    ("            if plan_hash(meta) != qb.get('plan_sha256'):", "            if False:"),
    ("            if held:\n                out.append(('H3', 'bundle member(s) %s are held", "            if False:\n                out.append(('H3', 'bundle member(s) %s are held"),
    # v42 (phase 1 item 1): skip-head, hold auto-release
    ("    if code == 'H1' and r.startswith('held: '):", "    if code == 'H1':"),
    ("    if code == 'H3' and r.startswith('blocked since its last attempt') and journal_status(run, st) not in ('open', 'live'):",
     "    if code == 'H3':"),
    ("        if 'went silent' in r and str(job.get('pid') or '') not in (st.get('pid_alive') or {}):", "        if 'went silent' in r:"),
    ("    if any(k is None for k in kinds):\n        return ''", "    if all(k is None for k in kinds):\n        return ''"),
    ("    if waited_on(e.get('run'), st):\n        return ''", "    if False:\n        return ''"),
    ("            if run in (x.get('after') or []) and entry_state(x, st) not in ('done', 'cancelled')]",
     "            if run in (x.get('after') or []) and x.get('run') == 'bar-01']"),
    ("        if not st['skip_on'] or i == len(cands) - 1", "        if i == len(cands) - 1"),
    ("    if not (expired or dead):\n        return False, ''", "    if False:\n        return False, ''"),
    ("    if bad:\n        return False, 'not released: '", "    if False:\n        return False, 'not released: '"),
    ("    if st.get('rollout_procs'):\n        bad.append", "    if False:\n        bad.append"),
    ("    if st.get('silent_started_after') or seen != nact:", "    if False:"),
    ("    st['hold_release'] = hold_release(st) if st['autorel_on'] else (False, '')", "    st['hold_release'] = hold_release(st)"),
    ("    if st.get('hold_release', (False, ''))[0]:", "    if False:"),
    ("            row.update(pid=pid, start=starttime(P, pid))", "            pass"),
    ("    if (src or {}).get('canary_sha') != pt.get('tip'):", "    if False:"),
    ("    if st.get('spec_off'):\n        return None", "    if False:\n        return None"),
    ("    if idx is None or st.get('ar_busy'):", "    if idx is None:"),
    ("        if es != 'ready' or e.get('hold') or e.get('bundle') is not None or not ar_token(e):",
     "        if es != 'ready' or e.get('bundle') is not None or not ar_token(e):"),
    ("        if csha in (e.get('variants') or {}) or (st.get('spec_jobs') or {}).get(e.get('run')):",
     "        if csha in (e.get('variants') or {}):"),
    ("    if not man.get('canary_pool') or not csha:", "    if not csha:"),
    ("    if not isinstance(rc, int) or rc == 75 or not re.search(", "    if not isinstance(rc, int) or not re.search("),
    ("    if not str((src or {}).get('approved') or '').strip():", "    if False:"),
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
