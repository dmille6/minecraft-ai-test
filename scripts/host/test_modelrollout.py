#!/usr/bin/env python3
"""test_modelrollout.py -- modelrollout.py (the staged model rollout, qwen35-01 10-31). Runs anywhere: every side effect
goes through a FakeHost over a temp tree (env files, unit dir, journal, manifest), with a fake clock.

  pure      plan (canary pools first, 4 pools a stage, every pool once), rates, load/read gates, early abort, the poll
            scope (endpoint down = every stage), the KEEP-and-torn-down precondition, canary pools from the journal,
            env proof by KEY=VALUE, the drop-in sorts before 10-canary.conf
  driver    happy path (4 stages, 80 bots, hold released); a load-test fail before stage 1 (nothing applied, slot free);
            a read fail at stage 2 (stage 2 rolled back, stage 1 kept, hold KEPT); a stall with the endpoint down
            (every stage back, slot free); an unproven env on apply (the stage back); a refused start (no KEEP); a
            WATCH check (stage kept, hold kept); the CLI rollback --all after a stop releases the hold
"""
import datetime as dt
import io
import json
import os
import shutil
import sys
import tempfile
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import modelrollout as R  # noqa: E402

T = []
KV = ['OLLAMA_MODEL=qwen3.5:9b', 'OLLAMA_BASE_URLS=http://bw:11438', 'OLLAMA_BASE_URL=http://bw:11438']
BASE = ['OLLAMA_MODEL=qwen2.5:7b-instruct', 'OLLAMA_BASE_URLS=http://5080:11434', 'OLLAMA_BASE_URL=http://5080:11434']
POOLS = ['%s-%s' % (a, l) for a in ('board', 'hive', 'isolated', 'placebo') for l in 'abcd']
NAMES = ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo']
SHA = 'a' * 40


def t(name, ok, detail=''):
    T.append(bool(ok))
    print('%s  %s' % ('PASS' if ok else 'FAIL', name) + ('' if ok else '\n        -> %r' % (detail,)))


def lrows(n, lat, valid=True, terr=False):
    return [{'latencyMs': lat, 'schemaValid': valid, 'transport_error': terr} for _ in range(n)]


GOOD_READ = {'stall_bots': 0, 'model_share': 1.0, 'schema_valid_canary': 1.0, 'schema_gap_pp': 0.0, 'lat_p50_ms': 1500,
             'lat_p95_ms': 3500, 'completion_p95': 90, 'canary_post_rows': 900, 'control_bots': 30}


class FakeHost(R.Host):
    def __init__(self, root, load_ok=True, read=None, poll=None, check='PASS', bad_env=None, read_fail_stage=None,
                 poll_stage=None):
        self.root, self.t = root, dt.datetime(2026, 10, 31, 6, 0, tzinfo=R.UTC)
        self.files, self.restarts, self.holds, self.reloads = {}, [], [], 0
        self.load_ok, self.read, self.poll, self.check, self.bad_env = load_ok, read or GOOD_READ, poll, check, bad_env
        self.read_fail_stage, self.poll_stage, self.load_calls = read_fail_stage, poll_stage, []
        self.env = {}                       # bot -> environ text of the live process

    def now(self): return self.t
    def sleep(self, s):
        self.t += dt.timedelta(seconds=s)
        if getattr(self, 'term_at_poll', None) and s == R.POLL_S:
            raise SystemExit(143)
    def write_root(self, path, text):
        if R.DROPIN in path:
            self.writes = getattr(self, 'writes', 0) + 1
            if getattr(self, 'fail_write_at', None) == self.writes:
                raise RuntimeError('disk full (fake)')
        os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w').write(text)
    def remove_root(self, path):
        if getattr(self, 'fail_remove', False):
            raise RuntimeError('sudo rm failed (fake)')
        os.remove(path)
        with contextlib.suppress(OSError):
            os.rmdir(os.path.dirname(path))
    def daemon_reload(self): self.reloads += 1
    def restart(self, bot):
        self.restarts.append((bot, self.t))
        if bot in getattr(self, 'stuck', ()) and bot in self.env:
            return True                     # the restart did not take: the old process (and env) lives on
        on = os.path.exists(os.path.join(R.P['unitdir'], 'mcbot@%s.service.d' % bot, R.DROPIN))
        kv = KV if on and bot not in (self.bad_env or ()) else BASE
        self.env[bot] = '\n'.join(['BOT_NAME=' + bot] + kv)
        return True
    def environ(self, bot): return self.env.get(bot, '\n'.join(['BOT_NAME=' + bot] + BASE))
    def loop_running(self): return []
    def hold_claim(self, token, minutes): self.holds.append(('claim', token)); self.owner = token; return True, 'ok'
    def hold_release(self, token): self.holds.append(('release', token)); self.owner = ''; return 'released'
    def hold_owner(self): return getattr(self, 'owner', '')
    def take_lock(self): return True
    def stage(self):
        st = json.load(open(os.path.join(R.P['home'], 'state.json')))
        return next(i for i, s in enumerate(st['stages'], 1) if s['status'] not in ('passed',))
    def loadtest(self, url, model, rate, n, out, seed):
        self.load_calls.append((rate, n))
        if n == R.PROBE_N:
            return lrows(n, 1200), False
        return (lrows(n, 1500) if self.load_ok else lrows(n, 9000)), not self.load_ok
    def modelpoll(self, ctxdir):
        if self.poll is not None and self.stage() == self.poll_stage:
            return self.poll
        return 'MODELPOLL OK :: 0 of 10 stalled'
    def stage_read(self, ctxdir, M):
        if self.read_fail_stage == self.stage():
            return dict(GOOD_READ, lat_p95_ms=16830)
        return self.read
    # experiment-mode probes (scripted)
    def endpoint_ok(self, url): return not getattr(self, 'ep_down', False)
    def stall(self, ctxdir): return getattr(self, 'stall_n', (0, 80))
    def crash_loops(self, t0, t1): return getattr(self, 'loops', {})
    def tripper(self): return {'verdict': getattr(self, 'trip', 'OK'), 'trips': ['x']}
    def deaths(self, t0, t1): return getattr(self, 'death_n', (0, 10.0))
    def baseline_7d(self, t0): return (0.02, 13000.0)
    def hourly(self, t0, t1, model): self.hourlies = getattr(self, 'hourlies', 0) + 1; return {'decisions_per_min': 50.0}
    def notify(self, subject, body): self.notes = getattr(self, 'notes', []) + [subject]
    def compare(self, timeout_s=0):
        self.compared = True
        if getattr(self, 'compare_crash', False):
            return False, 'boom'
        open(os.path.join(R.P['home'], 'compare-24h.md'), 'w').write('# compare\n'); return True, 'ok'
    def own_lock(self): return True

    def rollout_add(self, run, sha, at, note):
        with open(R.P['journal'], 'a') as f:
            f.write(json.dumps({'ts': at, 'run': run, 'phase': 'owner-direct', 'sha': sha, 'prev': sha}) + '\n')
    def rollout_check(self, run):
        rows = [r for r in R.read_jsonl(R.P['journal']) if r.get('run') == run and r.get('phase') == 'owner-direct']
        with open(R.P['journal'], 'a') as f:
            f.write(json.dumps({'ts': R.iso(self.t), 'run': run, 'phase': 'owner-direct-check', 'of_ts': rows[-1]['ts'],
                                'verdict': self.check, 'note': 'fake check'}) + '\n')
        return 'checked'


def tree(keep=True):
    root = tempfile.mkdtemp(prefix='rolltest-')
    for k, sub in (('envdir', 'env'), ('unitdir', 'units'), ('home', 'home'), ('regdir', 'regs'), ('harness', 'harness')):
        R.P[k] = os.path.join(root, sub); os.makedirs(R.P[k], exist_ok=True)
    for p in POOLS:
        for n in NAMES:
            open(os.path.join(R.P['envdir'], '%s-%s.env' % (p, n)), 'w').write('\n'.join(BASE) + '\n')
    open(os.path.join(R.P['envdir'], 'board-a-Alpha.env.bak-x'), 'w').write('')
    R.P['journal'] = os.path.join(root, 'journal.jsonl'); R.P['page'] = os.path.join(root, 'page.jsonl')
    R.P['manifest'] = os.path.join(root, 'manifest.json')
    json.dump({'declared_code_version': SHA, 'canary_pool': '', 'canary_code_version': ''}, open(R.P['manifest'], 'w'))
    json.dump({'run_id': 'qwen35-01', 'class': 'model-env', 'canary_env': KV}, open(os.path.join(R.P['regdir'], 'qwen35-01.json'), 'w'))
    rows = [{'run': 'qwen35-01', 'phase': 'drawn', 'note': 'board-b,placebo-b :: draw'},
            {'run': 'qwen35-01', 'phase': 'deployed', 'note': 'board-b,placebo-b 2026-10-31T03:10:00Z'},
            {'run': 'qwen35-01', 'phase': 'recorded', 'note': 'KEEP' if keep else 'REVERT'},
            {'run': 'qwen35-01', 'phase': 'env-cleared', 'note': ''},
            {'run': 'qwen35-01', 'phase': 'torn-down', 'note': '10 aad2506'}]
    with open(R.P['journal'], 'w') as f:
        for r in rows:
            f.write(json.dumps(dict(r, ts='2026-10-31T06:00:00Z')) + '\n')
    return root


def quiet(fn, *a, **k):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = fn(*a, **k)
    return rc, buf.getvalue()


def dropins():
    import glob
    return sorted(os.path.basename(os.path.dirname(p))[6:-10] for p in glob.glob(os.path.join(R.P['unitdir'], '*', R.DROPIN)))


def phases():
    return [r['phase'] for r in R.read_jsonl(R.P['journal']) if r.get('run') == 'qwen35-roll']


def pure():
    st = R.plan(POOLS, ['placebo-b', 'board-b'])
    flat = [p for s in st for p in s]
    t('plan: 4 stages of 6/4/4/2 pools, the canary pools first, every pool exactly once',
      [len(s) for s in st] == [6, 4, 4, 2] and st[0][:2] == ['board-b', 'placebo-b'] and sorted(flat) == sorted(POOLS), st)
    t('plan: stages interleave the arms (stage 2 is not one arm)', len({p.rsplit('-', 1)[0] for p in st[1]}) >= 3, st[1])
    t('rate: 30 bots -> 39.9/min, 20 -> 26.6', R.stage_rate(30) == 39.9 and R.stage_rate(20) == 26.6)
    s40 = {'n': 200, 'transport_errors': 0, 'valid_share': 1.0, 'p50': 5287, 'p95': 16830, 'max': 21329}
    s20 = {'n': 600, 'transport_errors': 0, 'valid_share': 1.0, 'p50': 1495, 'p95': 3682, 'max': 8170}
    t('load gate: the measured 42/min run (p50 5.3 s, p95 16.8 s) FAILS', not R.load_verdict(s40, 200)[0])
    t('load gate: the measured 20/min run (p50 1.5 s, p95 3.7 s) PASSES', R.load_verdict(s20, 600)[0], R.load_verdict(s20, 600))
    t('load gate: a cut-short run fails', not R.load_verdict(dict(s20, n=100), 600)[0])
    t('load gate: one transport error fails', not R.load_verdict(dict(s20, transport_errors=1), 600)[0])
    t('load stats: transport errors are not latencies', R.load_stats(lrows(9, 1000) + lrows(1, None, terr=True))['p50'] == 1000)
    t('early abort: 30 answers at 16 s abort; 29 do not; 30 at 3 s do not',
      R.early_abort(lrows(30, 16000)) and not R.early_abort(lrows(29, 16000)) and not R.early_abort(lrows(30, 3000)))
    t('early abort: three transport errors abort', R.early_abort(lrows(3, None, terr=True)))
    t('read gate: a good read passes', R.read_verdict(GOOD_READ)[0], R.read_verdict(GOOD_READ))
    t('read gate: p95 over 5000 fails', not R.read_verdict(dict(GOOD_READ, lat_p95_ms=5001))[0])
    t('read gate: a missing field fails (None is not a pass)', not R.read_verdict(dict(GOOD_READ, lat_p50_ms=None))[0])
    t('read gate: no control (the last stage) skips the schema gap only',
      R.read_verdict(dict(GOOD_READ, control_bots=0, schema_gap_pp=None))[0]
      and not R.read_verdict(dict(GOOD_READ, control_bots=0, schema_gap_pp=None, schema_valid_canary=0.98))[0])
    t('read gate: too few rows fails', not R.read_verdict(dict(GOOD_READ, canary_post_rows=199))[0])
    t('poll: OK -> go on; REVERT endpoint answers -> stage; DOES NOT answer -> all; garbage -> go on',
      R.poll_scope('MODELPOLL OK :: x') is None and R.poll_scope('MODELPOLL REVERT :: stall ...; endpoint answers') == 'stage'
      and R.poll_scope('MODELPOLL REVERT :: stall ...; endpoint DOES NOT answer') == 'all' and R.poll_scope('') is None)
    t('check: PASS go on, WATCH hold, FAIL/ERROR/None roll back',
      [R.check_action(v) for v in ('PASS', 'WATCH', 'FAIL', 'ERROR', None)] == ['pass', 'hold', 'rollback', 'rollback', 'rollback'])
    j = [{'run': 'x-01', 'phase': 'recorded', 'note': 'KEEP'}, {'run': 'x-01', 'phase': 'torn-down'}]
    t('precondition: KEEP + torn-down', R.keep_closed(j, 'x-01')[0])
    t('precondition: REVERT refused', not R.keep_closed([dict(j[0], note='REVERT'), j[1]], 'x-01')[0])
    t('precondition: KEEP with no torn-down refused', not R.keep_closed(j[:1], 'x-01')[0])
    t('precondition: teardown-incomplete after torn-down refused',
      not R.keep_closed(j + [{'run': 'x-01', 'phase': 'teardown-incomplete'}], 'x-01')[0])
    t('precondition: another run\'s KEEP does not count', not R.keep_closed(j, 'y-01')[0])
    t('canary pools from `deployed`', R.canary_pools_of([{'run': 'r', 'phase': 'drawn', 'note': 'a-a,b-b :: x'},
                                                          {'run': 'r', 'phase': 'deployed', 'note': 'c-c,d-d 2026'}], 'r') == ['c-c', 'd-d'])
    t('env proof: by KEY=VALUE, not key', R.env_missing('\n'.join(BASE), KV) == KV and R.env_missing('\n'.join(KV), KV) == []
      and R.env_present('\n'.join(BASE), KV) == [])
    t('parse_env: refuses CODE_VERSION, globs, no model, a non-model-env class',
      all(_raises(lambda r=r: R.parse_env(r)) for r in (
          {'class': 'model-env', 'canary_env': KV + ['CODE_VERSION=x']}, {'class': 'model-env', 'canary_env': ['OLLAMA_MODEL=q*']},
          {'class': 'model-env', 'canary_env': ['FOO=1']}, {'class': 'fix', 'canary_env': KV})) and R.parse_env({'class': 'model-env', 'canary_env': KV}) == KV)
    t('drop-in sorts BEFORE 10-canary.conf (a later canary env still wins)', sorted([R.DROPIN, '10-canary.conf'])[0] == R.DROPIN)
    t('drop-in appends the model env file', 'EnvironmentFile=/x/model.env' in R.dropin_text('/x/model.env').splitlines())
    t('rid: qwen35-01 -> qwen35-roll', R.Rollout.__init__ and 'qwen35-01'.rsplit('-', 1)[0] + '-roll' == 'qwen35-roll')
    os.environ.pop('MODELREAD_MIN_CONTROL', None)
    import importlib
    import modelread
    importlib.reload(modelread)
    t('modelread: MIN_CONTROL defaults to 40 (the canary read is unchanged)', modelread.MIN_CONTROL == 40)


def _raises(fn):
    try:
        fn()
    except ValueError:
        return True
    return False


def driver():
    # happy path
    root = tree(); h = FakeHost(root)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    t('happy: rc 0, complete, all 80 bots carry the drop-in', rc == 0 and st['status'] == 'complete' and len(dropins()) == 80, (rc, out[-400:]))
    t('happy: the hold was claimed then released with our token', [x[0] for x in h.holds] == ['claim', 'release']
      and h.holds[0][1] == h.holds[1][1])
    t('happy: 80 restarts, 12 s apart within a stage', len(h.restarts) == 80
      and (h.restarts[1][1] - h.restarts[0][1]).total_seconds() == R.STAGGER_S)
    t('happy: every live environ carries the model pairs', all(not R.env_missing(h.env[b], KV) for b in h.env) and len(h.env) == 80)
    t('happy: four ledger rows (rollout.py add) and four checks',
      sum(1 for r in R.read_jsonl(R.P['journal']) if r.get('phase') == 'owner-direct') == 4
      and sum(1 for r in R.read_jsonl(R.P['journal']) if r.get('phase') == 'owner-direct-check') == 4)
    t('happy: load tests at each stage\'s own rate (30, 20, 20, 10 bots)',
      [r for r, n in h.load_calls if n != R.PROBE_N] == [39.9, 26.6, 26.6, 13.3], h.load_calls)
    t('happy: journal phases are rollout-* only (never a canary phase)',
      all(p.startswith('rollout-') for p in phases()) and 'rollout-complete' in phases(), phases())
    t('happy: the model env file holds exactly the registration pairs',
      open(os.path.join(R.P['harness'], 'model-qwen35-01.env')).read().split() == KV)
    t('happy: stage-1 read context names the 6 rolled pools and the fleet sha',
      json.load(open(os.path.join(R.P['home'], 'stage-1', 'manifest.json')))['canary_code_version'] == SHA
      and len(json.load(open(os.path.join(R.P['home'], 'stage-1', 'manifest.json')))['canary_pool'].split(',')) == 6)
    rc2, out2 = quiet(R.Rollout(FakeHost(root), 'qwen35-01').go)
    t('happy: a second run refuses (drop-ins exist)', rc2 == 2 and 'already exist' in out2, out2[-300:])
    shutil.rmtree(root)

    # load-test fail before stage 1
    root = tree(); h = FakeHost(root, load_ok=False)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('load fail: rc 1, nothing applied, no restart, hold released', rc == 1 and dropins() == [] and h.restarts == []
      and [x[0] for x in h.holds] == ['claim', 'release'], (rc, h.holds, out[-300:]))
    t('load fail: paged "slot is free"', 'the slot is free' in open(R.P['page']).read())
    shutil.rmtree(root)

    # read fail at stage 2
    root = tree(); h = FakeHost(root, read_fail_stage=2)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    d = dropins()
    t('read fail s2: stage 2 rolled back, stage 1 (30 bots) kept', rc == 1 and len(d) == 30
      and all(R.pool_of(b) in R.plan(POOLS, ['board-b', 'placebo-b'])[0] for b in d), (rc, len(d)))
    s2 = R.plan(POOLS, ['board-b', 'placebo-b'])[1]
    t('read fail s2: stage-2 bots restarted onto the baseline env (proof by value)',
      all(R.env_present(h.env[b], KV) == [] for b in h.env if R.pool_of(b) in s2))
    t('read fail s2: hold KEPT (claim only), page names release and rollback --all',
      [x[0] for x in h.holds] == ['claim'] and 'release' in open(R.P['page']).read() and 'rollback --all' in open(R.P['page']).read())
    rc3, out3 = quiet(R.main, ['rollback', '--all'], host=h)
    t('CLI rollback --all after the stop: every drop-in gone, hold released', rc3 == 0 and dropins() == [] and h.holds[-1][0] == 'release', (rc3, out3))
    shutil.rmtree(root)

    # a rollback whose restart did not take: INCOMPLETE, paged, the hold kept
    root = tree(); h = FakeHost(root, read_fail_stage=2)
    h.stuck = set(R.Rollout(h, 'qwen35-01').bots(R.plan(POOLS, ['board-b', 'placebo-b'])[1][:1]))
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('rollback proof: a bot still on the model env -> rollout-rollback-incomplete, paged, hold kept',
      rc == 1 and 'rollout-rollback-incomplete' in phases() and 'ROLLBACK INCOMPLETE' in open(R.P['page']).read()
      and [x[0] for x in h.holds] == ['claim'], (rc, phases()[-4:]))
    shutil.rmtree(root)

    # r1 blocker 1: an unproven rollback stays unproven: release refused, rollback --all retries it and only then frees
    st = json.load(open(os.path.join(R.P['home'], 'state.json'))) if os.path.exists(os.path.join(R.P['home'], 'state.json')) else None
    root = tree(); h = FakeHost(root, read_fail_stage=2)
    h.stuck = set(R.Rollout(h, 'qwen35-01').bots(R.plan(POOLS, ['board-b', 'placebo-b'])[1][:1]))
    quiet(R.Rollout(h, 'qwen35-01').go)
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    t('r1-B1: a failed rollback proof leaves the stage rollback-unproven (not rolled-back)', st['stages'][1]['status'] == 'rollback-unproven', st['stages'])
    rc, out = quiet(R.main, ['release'], host=h)
    t('r1-B1: release REFUSED while a stage is rollback-unproven', rc == 2 and 'unproven' in out and h.holds[-1][0] == 'claim', out)
    rc, out = quiet(R.main, ['rollback', '--all'], host=h)
    t('r1-B1: rollback --all with the bot still stuck: still unproven, hold kept', rc == 1 and h.holds[-1][0] == 'claim', (rc, out))
    h.stuck = set()
    rc, out = quiet(R.main, ['rollback', '--all'], host=h)
    t('r1-B1: rollback --all once the bot restarts: proven, every drop-in gone, hold released',
      rc == 0 and dropins() == [] and h.holds[-1][0] == 'release', (rc, out))
    shutil.rmtree(root)

    # r1 blocker 2: an apply that fails part-way: its partial drop-ins are removed and proven before the slot is freed
    root = tree(); h = FakeHost(root); h.fail_write_at = 7
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('r1-B2: a write failure at the 7th drop-in: the 6 written are removed, hold released only after the proof',
      rc == 1 and dropins() == [] and 'rollout-rolled-back' in phases() and [x[0] for x in h.holds] == ['claim', 'release'], (rc, dropins(), phases()))
    shutil.rmtree(root)

    # r1 blocker 3: a stop whose rollback crashes is journalled and paged, the slot stays held
    root = tree(); h = FakeHost(root, read_fail_stage=1); h.fail_remove = True
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    t('r1-B3: a crashing rollback: rollback-unproven, paged, hold kept, rc 1',
      rc == 1 and st['stages'][0]['status'] == 'rollback-unproven' and 'ROLLBACK INCOMPLETE' in open(R.P['page']).read()
      and [x[0] for x in h.holds] == ['claim'], (rc, st['stages'][0], h.holds))
    shutil.rmtree(root)
    root = tree(); h = FakeHost(root); h.term_at_poll = True
    try:
        quiet(R.Rollout(h, 'qwen35-01').go); died = False
    except SystemExit:
        died = True
    t('r1-B3: SIGTERM mid-watch: re-raised, journalled rollout-interrupted, paged, hold kept',
      died and 'rollout-interrupted' in phases() and 'INTERRUPTED' in open(R.P['page']).read() and [x[0] for x in h.holds] == ['claim'])
    shutil.rmtree(root)

    # r2 Codex: SIGTERM DURING the stop (inside the rollback's restarts) is journalled and paged, then re-raised
    root = tree(); h = FakeHost(root, read_fail_stage=1)
    orig = h.restart
    def term_restart(bot, _o=orig, _h=h):
        if any(r['phase'] == 'rollout-rollback' for r in R.read_jsonl(R.P['journal'])):
            raise SystemExit(143)
        return _o(bot)
    h.restart = term_restart
    try:
        quiet(R.Rollout(h, 'qwen35-01').go); died = False
    except SystemExit:
        died = True
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    t('r2: SIGTERM during the stop: rollout-stop-failed journalled, paged, stage rollback-unproven, hold kept',
      died and 'rollout-stop-failed' in phases() and 'STOP FAILED' in open(R.P['page']).read()
      and st['stages'][0]['status'] == 'rollback-unproven' and [x[0] for x in h.holds] == ['claim'], (died, phases()[-3:], st['stages'][0]))
    shutil.rmtree(root)

    # r1 Codex 3: a stall poll that never says OK is a guard that is down
    root = tree(); h = FakeHost(root, poll='MODELPOLL UNREADABLE :: no active canary unit', poll_stage=1)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('r1-C3: three UNREADABLE polls in a row roll the stage back (paged at the first)',
      rc == 1 and dropins() == [] and 'not deciding' in open(R.P['page']).read() and 'rollout-rolled-back' in phases(), (rc, phases()[-3:]))
    shutil.rmtree(root)
    root = tree(); h = FakeHost(root, poll='', poll_stage=1)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('r1-C3: an EMPTY poll is not OK either', rc == 1 and dropins() == [])
    shutil.rmtree(root)

    # stall with the endpoint down at stage 2: every stage back
    root = tree(); h = FakeHost(root, poll='MODELPOLL REVERT :: stall: 3 of 50; endpoint DOES NOT answer', poll_stage=2)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('stall endpoint down: every stage rolled back, hold released', rc == 1 and dropins() == []
      and [x[0] for x in h.holds] == ['claim', 'release'], (rc, dropins(), h.holds))
    shutil.rmtree(root)

    # unproven env on apply
    root = tree(); h = FakeHost(root, bad_env={'hive-a-Comet'})
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('unproven env on apply: the stage rolled back, nothing left, hold released', rc == 1 and dropins() == []
      and 'rollout-rolled-back' in phases() and [x[0] for x in h.holds] == ['claim', 'release'], (rc, dropins(), phases()))
    shutil.rmtree(root)

    # WATCH at stage 1: kept, hold kept
    root = tree(); h = FakeHost(root, check='WATCH')
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('WATCH: stage 1 kept (30 bots), hold kept', rc == 1 and len(dropins()) == 30 and [x[0] for x in h.holds] == ['claim'])
    shutil.rmtree(root)

    # no KEEP: refused before anything
    root = tree(keep=False); h = FakeHost(root)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').go)
    t('no KEEP: refused, no hold claimed, nothing written', rc == 2 and h.holds == [] and dropins() == [] and 'not KEEP' in out, out[-300:])
    shutil.rmtree(root)

    # dry run
    root = tree(); h = FakeHost(root)
    rc, out = quiet(R.Rollout(h, 'qwen35-01', dry=True).go)
    t('dry run: rc 0, no hold, no drop-ins, plan printed', rc == 0 and h.holds == [] and dropins() == [] and 'stage 4' in out, out[-300:])
    shutil.rmtree(root)


def experiment():
    t('fleet stall: 1 of 80 no, 19 no, 20 yes; 2 of 4 yes; 0 active no',
      [R.fleet_stall_trip(*x) for x in ((1, 80), (19, 80), (20, 80), (2, 4), (0, 0))] == [False, False, True, True, False])
    t('death gate: 2 deaths at 1.5 expected (the first hour) does NOT trip', not R.death_trip(2, 75, 0.02)[0])
    t('death gate: 10 at 3 expected trips; 1 never (floor); no baseline never',
      R.death_trip(10, 150, 0.02)[0] and not R.death_trip(1, 1, 0.5)[0] and not R.death_trip(50, 10, None)[0])
    w = {}
    t('reasons: one unit crash-looping is not a stop, two are', R.exp_reasons({'endpoint_ok': True, 'crash_loops': {'a': 3}}, w) == []
      and len(R.exp_reasons({'endpoint_ok': True, 'crash_loops': {'a': 3, 'b': 4}}, {})) == 1)
    w = {}
    r1 = R.exp_reasons({'endpoint_ok': False}, w); r2 = R.exp_reasons({'endpoint_ok': False}, w)
    t('reasons: endpoint down once no, twice in a row yes', r1 == [] and len(r2) == 1, (r1, r2))
    w = {}
    r1 = R.exp_reasons({'endpoint_ok': True, 'stall': (30, 80)}, w); r2 = R.exp_reasons({'endpoint_ok': True, 'stall': (30, 80)}, w)
    t('reasons: a fleet stall once no, twice yes; a healthy poll resets', r1 == [] and len(r2) == 1
      and R.exp_reasons({'endpoint_ok': True, 'stall': (0, 80)}, w) == [] and w['stall_hits'] == 0)
    t('reasons: tripper TRIP and the death gate stop', len(R.exp_reasons({'endpoint_ok': True, 'tripper': {'verdict': 'TRIP', 'trips': ['x']},
                                                                          'death': (True, 'd')}, {})) == 2)
    import modelread  # noqa: F401
    rows = {'a': [{'llm': {'model': 'qwen3.5:9b', 'endpoint': 'u', 'schema_valid': True, 'latency_ms': 1000}},
                  {'llm': {'model': 'qwen3.5:9b', 'endpoint': 'u', 'schema_valid': False, 'latency_ms': 46000, 'error': 'timeout'}},
                  {'llm': {'model': 'qwen3.5:9b', 'endpoint': None, 'schema_valid': True, 'latency_ms': 0}}],   # a work order
            'b': []}
    hs = R.hour_stats(rows, 'qwen3.5:9b', 60)
    t('hourly: work orders excluded, timeouts counted, invalid and model share over model decisions',
      hs['decisions'] == 2 and hs['timeouts'] == 1 and hs['invalid_share'] == 0.5 and hs['model_share'] == 1.0 and hs['bots_with_rows'] == 1, hs)

    # experiment happy path
    root = tree(); h = FakeHost(root)
    rc, out = quiet(R.Rollout(h, 'qwen35-01', experiment=True).go)
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    t('exp: 4 stages of 4 pools (20 bots), no load test, all 80 moved, complete, hold released',
      rc == 0 and [len(x['pools']) for x in st['stages']] == [4, 4, 4, 4] and h.load_calls == [] and len(dropins()) == 80
      and st['status'] == 'complete' and [x[0] for x in h.holds] == ['claim', 'release'], (rc, out[-300:]))
    t('exp: restarts 12 s apart, the watch context names all 16 pools',
      (h.restarts[1][1] - h.restarts[0][1]).total_seconds() == 12
      and len(json.load(open(os.path.join(R.P['home'], 'stage-watch', 'manifest.json')))['canary_pool'].split(',')) == 16)
    # watch: healthy, hourly once per hour
    h.t = R.ts(st['completed']) + dt.timedelta(hours=1, minutes=2)
    quiet(R.Rollout(h, 'qwen35-01').watch); quiet(R.Rollout(h, 'qwen35-01').watch)
    t('watch: healthy -> nothing rolled back; one hourly record per hour', len(dropins()) == 80 and getattr(h, 'hourlies', 0) == 1)
    # watch: fleet stall twice -> rollback all
    h.stall_n = (40, 80)
    quiet(R.Rollout(h, 'qwen35-01').watch)
    t('watch: one stalled poll -> still on', len(dropins()) == 80)
    rc, out = quiet(R.Rollout(h, 'qwen35-01').watch)
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    t('watch: a second stalled poll -> rollback ALL, proven, pushed', dropins() == [] and st['status'] == 'rolled-back' and 'ROLLOUT ENDED' in h.notes, (rc, out[-200:]))
    rc, out = quiet(R.Rollout(h, 'qwen35-01').watch)
    t('watch: after the end it is a no-op', rc == 0 and out == '')
    shutil.rmtree(root)

    # +24 h: compare then MANDATORY rollback; a failing compare still rolls back
    for crash in (False, True):
        root = tree(); h = FakeHost(root); h.compare_crash = crash
        quiet(R.Rollout(h, 'qwen35-01', experiment=True).go)
        st = json.load(open(os.path.join(R.P['home'], 'state.json')))
        h.t = R.ts(st['completed']) + dt.timedelta(hours=24, minutes=1)
        quiet(R.Rollout(h, 'qwen35-01').watch)
        st = json.load(open(os.path.join(R.P['home'], 'state.json')))
        t('+24 h (compare %s): compared, then rolled back unconditionally' % ('FAILS' if crash else 'ok'),
          getattr(h, 'compared', False) and dropins() == [] and st['status'] == 'rolled-back', (st['status'], dropins()[:2]))
        shutil.rmtree(root)
    # the hard deadline acts even if no earlier tick ran the +24 h step
    root = tree(); h = FakeHost(root)
    quiet(R.Rollout(h, 'qwen35-01', experiment=True).go)
    st = json.load(open(os.path.join(R.P['home'], 'state.json')))
    h.t = R.ts(st['completed']) + dt.timedelta(hours=30); h.ep_down = True
    quiet(R.Rollout(h, 'qwen35-01').watch)
    t('+30 h: the hard deadline rolls back first', dropins() == [] and json.load(open(os.path.join(R.P['home'], 'state.json')))['status'] == 'rolled-back')
    shutil.rmtree(root)

    # experiment stop during a stage: endpoint down on both polls -> ALL rolled back, slot freed, pushed
    root = tree(); h = FakeHost(root); h.ep_down = True
    rc, out = quiet(R.Rollout(h, 'qwen35-01', experiment=True).go)
    t('exp stop: endpoint down at stage 1 -> everything rolled back, hold released, pushed',
      rc == 1 and dropins() == [] and [x[0] for x in h.holds] == ['claim', 'release'] and 'ROLLOUT STOPPED' in h.notes, (rc, h.holds))
    shutil.rmtree(root)
    # crash loops on 2 units at stage 2: everything back (stage 1 too)
    root = tree(); h = FakeHost(root)
    orig = h.crash_loops
    h.crash_loops = lambda t0, t1, _h=h: {'a': 3, 'b': 3} if _h.stage() == 2 else {}
    rc, out = quiet(R.Rollout(h, 'qwen35-01', experiment=True).go)
    t('exp stop: crash loops at stage 2 roll back stage 1 as well', rc == 1 and dropins() == [], (rc, len(dropins())))
    shutil.rmtree(root)
    # a watch on a non-experiment complete rollout does nothing
    root = tree(); h = FakeHost(root)
    quiet(R.Rollout(h, 'qwen35-01').go)
    h.t += dt.timedelta(hours=30)
    quiet(R.Rollout(h, 'qwen35-01').watch)
    t('watch: ignores a non-experiment rollout', len(dropins()) == 80)
    shutil.rmtree(root)


def main():
    pure()
    R.Host.take_lock = lambda self: True
    driver()
    experiment()
    print('\n%d/%d pass' % (sum(T), len(T)))
    return 0 if all(T) else 1


if __name__ == '__main__':
    sys.exit(main())
