#!/usr/bin/env python3
"""test_funmode_loop.py -- the v37 FUN-MODE loop path end to end: `canary-loop.sh <run> --no-act` against a fixture HOME.
HOST ONLY (bash, flock). Touches nothing live: HOME, CANARY_MANIFEST, CANARY_LOCK, CANARY_READ_DIR and the FUNREAD_*
paths point into a temp tree; the manifest already names the canary sha, so the loop resumes past the draw and deploy;
--no-act stops it before any record, promotion or teardown. A fake clock drives every wait.

REAL: canary-loop.sh and funread.py (the files under test). STUB: verdict.py (the death poll answers POLL_OK, or REVERT
from STUB_POLL_REVERT_AT seconds after the deploy), the unit facts (FUNREAD_UNITS_FILE) and the bots' logs.

  keep        no harm at +90 (NOT_YET) or +180 -> KEEP goal-unverified -> "would act: KEEP"
  exposed     the registration's exposure is met by a bound evidence object -> KEEP goal-verified
  crash       one canary unit restarted 4 times -> +90 REVERT (crash loop) -> "would act: REVERT"
  ownline     a REVERT own line fails on bound evidence at +90 -> REVERT
  deathpoll   the death poll REVERTs at +40 -> poll-revert, no read taken
  blind       no canary bot writes on the canary build -> +90 NOT_YET, +180 INCONCLUSIVE (never KEEP)
  readcrash   funread.py crashes -> +180 contained INCONCLUSIVE (a fun run never waits for its deadline)
  lab         `"lab": true`: the loop reads at the registration's minutes with verdict.py, not funread.py
"""
import os, sys, json, shutil, subprocess, tempfile, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
LOOP = os.path.join(HERE, 'canary-loop.sh')
FUNREAD = next(p for p in (os.path.join(HERE, '..', 'funread.py'), os.path.join(HERE, 'funread.py')) if os.path.exists(p))
RUN, SHA = 'fun-01', 'f' * 40
POOLS = ['board-a', 'hive-a']
BOTS = ['%s-%s' % (p, n) for p in POOLS for n in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')]
DECL = dt.datetime(2026, 10, 28, 8, 0, 0, tzinfo=dt.timezone.utc)
T = []

STUB_VERDICT = r'''#!/usr/bin/env python3
import sys, os, json
run, M = sys.argv[1], int(sys.argv[2])
now = float(open(os.environ['CANARY_FAKE_CLOCK']).read()); t0 = float(os.environ['STUB_T0'])
at = os.environ.get('STUB_POLL_REVERT_AT')
if '--poll' in sys.argv:
    if at and now - t0 >= float(at):
        print('VERDICT REVERT (+0) :: death gate: 2 canary deaths (stub)'); sys.exit(0)
    print('VERDICT POLL_OK (+0) :: deaths 0 (0.000/bh over 10.0 measured bot-h) | poll: 0 canary deaths since declared_at, 0 rung-linked, 0 with a change row'); sys.exit(0)
open(os.environ['STUB_LAB_MARK'], 'a').write('%d\n' % M)
print('VERDICT %s (+%d) :: stub lab read' % ('KEEP' if M >= 360 else 'NOT_YET', M))
'''


def t(name, ok, detail=''):
    T.append(bool(ok))
    print('%s  %s' % ('PASS' if ok else 'FAIL', name) + ('' if ok else '\n        -> %s' % str(detail)[-1500:]))


def fixture(scenario):
    d = tempfile.mkdtemp(prefix='funloop-')
    h = os.path.join(d, 'home')
    for sub in ('mcai-analysis/registrations', 'digest/reads'):
        os.makedirs(os.path.join(h, sub))
    shutil.copy(FUNREAD, os.path.join(h, 'mcai-analysis', 'funread.py'))
    if scenario == 'readcrash':
        open(os.path.join(h, 'mcai-analysis', 'funread.py'), 'w').write('raise SystemExit("Traceback: boom")\n')
    open(os.path.join(h, 'verdict.py'), 'w').write(STUB_VERDICT)
    reg = {'run_id': RUN, 'sha': SHA, 'notes': 'fixture'}
    if scenario == 'ownline':
        reg.update(reads=[], own_lines=[{'read': 'ownread', 'field': 'bad', 'op': '<=', 'value': 0, 'on_fail': 'REVERT'}])
    if scenario == 'exposed':
        reg.update(exposure={'read': 'ownread', 'field': 'acted', 'min': 1})
    if scenario == 'lab':
        reg.update(lab=True, reads=[], read_minutes=[180, 360], deadline_min=780)
        shutil.copy('/home/mike/v30check.py', os.path.join(h, 'v30check.py'))
        shutil.copy(os.path.join(HERE, 'heavyread.sh'), os.path.join(h, 'mcai-analysis', 'heavyread.sh'))
    json.dump(reg, open(os.path.join(h, 'mcai-analysis', 'registrations', RUN + '.json'), 'w'))
    open(os.path.join(h, 'canary-journal.jsonl'), 'w').write(
        json.dumps({'ts': 'x', 'run': RUN, 'phase': 'deployed', 'note': ','.join(POOLS) + ' fixture'}) + '\n')
    man = os.path.join(d, 'manifest.json')
    json.dump({'run_id': RUN, 'declared_code_version': 'e' * 40, 'declared_at': DECL.isoformat().replace('+00:00', 'Z'),
               'canary_pool': ','.join(POOLS), 'canary_code_version': SHA}, open(man, 'w'))
    envd = os.path.join(d, 'env'); os.makedirs(envd)
    for b in BOTS:
        open(os.path.join(envd, b + '.env'), 'w').write('X=1\n')
    units = {b: {'restarts': 0, 'active': 'active'} for b in BOTS}
    if scenario == 'crash':
        units[BOTS[3]]['restarts'] = 4
    json.dump(units, open(os.path.join(d, 'units.json'), 'w'))
    logs = os.path.join(d, 'logs')
    for b in BOTS:
        os.makedirs(os.path.join(logs, b))
        v = ('e' * 7 if scenario == 'blind' else SHA[:7]) + '+abc'
        open(os.path.join(logs, b, 'skill-%s.jsonl' % b), 'w').write(json.dumps(
            {'@timestamp': '2026-10-28T09:59:00.000Z', 'code': {'version': v}, 'skill': {'name': 'x'}}) + '\n')
    for M in (90, 180):
        if scenario in ('ownline', 'exposed'):
            json.dump({'sha': SHA, 'pools': ','.join(POOLS), 'run_id': RUN, 'declared_at': DECL.isoformat().replace('+00:00', 'Z'),
                       'window_min': M, 'fields': {'bad': 3, 'acted': 2}},
                      open(os.path.join(h, 'digest', 'reads', '%s-ownread-%d.json' % (RUN, M)), 'w'))
    return d, h, man, envd, logs


def run(scenario, extra=None):
    d, h, man, envd, logs = fixture(scenario)
    clk = os.path.join(d, 'clock'); open(clk, 'w').write(str(int(DECL.timestamp())))
    env = dict(os.environ, HOME=h, CANARY_MANIFEST=man, CANARY_LOCK=os.path.join(d, 'lock'), CANARY_READ_DIR=os.path.join(d, 'rd'),
               CANARY_READ_CWD=d, CANARY_FAKE_CLOCK=clk, CANARY_POLL_S='600', STUB_T0=str(int(DECL.timestamp())),
               STUB_LAB_MARK=os.path.join(d, 'labmark'), FUNREAD_MANIFEST=man, FUNREAD_ENV_DIR=envd,
               FUNREAD_UNITS_FILE=os.path.join(d, 'units.json'), FUNREAD_LOG_ROOT=logs, FUNREAD_NOW='2026-10-28T10:00:00Z',
               FUNREAD_FREEZE=os.path.join(d, 'nofreeze'), FUNREAD_VERDICT=os.path.join(h, 'verdict.py'))
    env.update(extra or {})
    os.makedirs(os.path.join(d, 'rd'))
    r = subprocess.run(['bash', LOOP, RUN, '--no-act'], capture_output=True, text=True, env=env, timeout=600)
    jl = [json.loads(l) for l in open(os.path.join(h, 'canary-journal.jsonl')) if l.strip()]
    ph = [(j['phase'], j['note']) for j in jl if j.get('run') == RUN]
    lab = open(os.path.join(d, 'labmark')).read().split() if os.path.exists(os.path.join(d, 'labmark')) else []
    shutil.rmtree(d, ignore_errors=True)
    return r, ph, lab


def phase(ph, name):
    return [n for p, n in ph if p == name]


def main():
    r, ph, _ = run('keep')
    t('keep: +90 NOT_YET from funread', any(n.startswith('VERDICT NOT_YET (+90)') and 'fun-mode generic read' in n
                                             for n in phase(ph, 'read-90')), ph)
    t('keep: +180 KEEP goal-unverified', any(n.startswith('VERDICT KEEP (+180)') and 'goal-unverified' in n
                                              for n in phase(ph, 'read-180')), ph)
    t('keep: would act KEEP', 'would act: KEEP' in r.stdout, r.stdout[-800:])
    t('keep: no lab read ran (no read-360)', not phase(ph, 'read-360'), ph)
    r, ph, _ = run('exposed')
    t('exposed: KEEP goal-verified', any('goal-verified' in n for n in phase(ph, 'read-180')), ph)
    r, ph, _ = run('crash')
    t('crash: +90 REVERT by crash loop', any(n.startswith('VERDICT REVERT (+90)') and 'crash loop' in n
                                              for n in phase(ph, 'read-90')), ph)
    t('crash: would act REVERT', 'would act: REVERT' in r.stdout, r.stdout[-800:])
    r, ph, _ = run('ownline')
    t('ownline: +90 REVERT on the own line', any('own line ownread.bad = 3 fails' in n for n in phase(ph, 'read-90')), ph)
    r, ph, _ = run('deathpoll', {'STUB_POLL_REVERT_AT': '2400'})
    t('deathpoll: poll-revert before +90', phase(ph, 'poll-revert') and not phase(ph, 'read-90'), ph)
    t('deathpoll: would act REVERT', 'would act: REVERT' in r.stdout, r.stdout[-800:])
    r, ph, _ = run('blind')
    t('blind: +90 NOT_YET', any(n.startswith('VERDICT NOT_YET (+90)') for n in phase(ph, 'read-90')), ph)
    t('blind: +180 INCONCLUSIVE, never KEEP', any(n.startswith('VERDICT INCONCLUSIVE (+180)') and 'positive control' in n
                                                    for n in phase(ph, 'read-180')) and 'would act: INCONCLUSIVE' in r.stdout,
      (ph, r.stdout[-600:]))
    r, ph, _ = run('readcrash')
    t('readcrash: contained INCONCLUSIVE at +180', any('no decision at the final read +180' in n for n in phase(ph, 'contained'))
      and 'would act: INCONCLUSIVE' in r.stdout, (ph, r.stdout[-600:]))
    r, ph, lab = run('lab')
    t('lab: verdict.py read at the registration minutes 180 and 360', lab == ['180', '360'] and 'would act: KEEP' in r.stdout,
      (lab, ph, r.stdout[-600:], r.stderr[-400:]))
    print('\n%d/%d pass' % (sum(T), len(T)))
    return 0 if all(T) else 1


if __name__ == '__main__':
    sys.exit(main())
