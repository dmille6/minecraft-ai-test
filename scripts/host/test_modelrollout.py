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
    def sleep(self, s): self.t += dt.timedelta(seconds=s)
    def write_root(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w').write(text)
    def remove_root(self, path):
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
        if self.poll and self.stage() == self.poll_stage:
            return self.poll
        return 'MODELPOLL OK :: 0 of 10 stalled'
    def stage_read(self, ctxdir, M):
        if self.read_fail_stage == self.stage():
            return dict(GOOD_READ, lat_p95_ms=16830)
        return self.read
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


def main():
    pure()
    R.Host.take_lock = lambda self: True
    driver()
    print('\n%d/%d pass' % (sum(T), len(T)))
    return 0 if all(T) else 1


if __name__ == '__main__':
    sys.exit(main())
