#!/usr/bin/env python3
"""test_bagfix_loop.py [--junkwell] -- the v33 LOOP PATH end to end, `canary-loop.sh <run> --no-act`, against a fixture
HOME and a recorded journal. HOST ONLY (bash, flock, timeout). Touches nothing live: CANARY_MANIFEST, CANARY_LOCK,
CANARY_READ_DIR/CWD point into a temp tree; the manifest already names the canary sha, so the loop never reaches the
preflights, the draw or the deploy; --no-act stops it before any record, promotion or teardown.

What is real and what is a stub:
  REAL     canary-loop.sh (the file under test), bagfixgate.py + bagfixrule.py + deathgate.py (copies of the files under
           test), the live ~/v30check.py, the journal/page/NEXT-SLOT handling, the fake clock driving every wait.
  STUB     verdict.py (replays a scripted verdict and writes the artifact the loop and bagfixgate read: the death-gate
           REVERT with by=death_gate and its counts) and the registered read (writes a bound evidence object for the bag
           metric). verdict.py's own v33 behaviour is tested in test_bagfix.py against the real file. In `blind`, the
           measuring half is a shim that fails every poll (the loop's handling of a blind extension is what is tested).

Scenarios (synthetic fixture logs, 80 bots, 48 h of 2-min snapshots):
  keep      the death poll trips at +90 (6 vs 4 deaths), 0 linked -> EXTEND -> polls CONTINUE -> reads +180/+360 and a
            +1440 read -> final KEEP -> NEXT-SLOT written
  ceiling   the same, then 9 more canary deaths after +120 -> an extension poll REVERTs by (b)
  linked    one of the 6 deaths has the fix's own row 60 s before it -> no extension, the REVERT stands
  readtrip  the gate trips at the +180 READ (verdict exits at the gate); the extension RE-RUNS +180 with the gate
            report-only and an own line there reverts -> REVERT (round 1, both reviewers)
  blind     extension polls produce nothing usable -> REVERT after 3 in a row
  resume    the journal already holds bagfix-extend + bagfix-decided REVERT -> straight to "would act: REVERT"
  pending   a crash DURING extend-check (bagfix-pending, no bagfix-check) -> resumed: extend-check re-runs, the stale
            verdict artifact makes it REVERT (fail closed) -> decided REVERT
  rerun     a crash between bagfix-extend (+180) and the gate-off re-run of +180 -> the resume re-runs it
  readfail  every guard read during the extension is UNREADABLE -> journalled as failed (never done), 3 -> REVERT
  redeploy  the journal shows this run deployed but the manifest no longer names its sha -> refused, nothing drawn
  noguards  guard reads answer NOT_YET without reaching the guards (unreadable immobiledid) -> failed, 3 -> REVERT
  checkcrash a crash after bagfix-check but before bagfix-extend/decided -> the pending REVERT is recovered (fail closed)
--junkwell (host data): junkwell-01's recorded journal and the REAL logs of placebo-a/board-b on 10-05, the clock for
  bagfixgate frozen at the recorded poll-revert (15:13:26Z: after it the pools were torn down, so later data is not
  canary data). Expect EXTEND, then CONTINUE polls on frozen data, then +1440 NOT_YET (never run) until the
  extension deadline closes it INCONCLUSIVE. The honest replay of a window that was never run.
"""
import os, sys, json, subprocess, tempfile, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, '..') if os.path.exists(os.path.join(HERE, '..', 'bagfixgate.py')) else HERE
LOOP = os.path.join(HERE, 'canary-loop.sh')
sys.path.insert(0, SCRIPTS)
import test_bagfix as TB

T = []


def t(name, ok, detail=''):
    T.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + ('' if ok else f"\n        -> {str(detail)[-1500:]}"))


STUB_VERDICT = r'''#!/usr/bin/env python3
import sys, os, json, datetime as dt
run, M = sys.argv[1], int(sys.argv[2])
reads = os.environ['BAGFIX_READS_DIR']; trip = float(os.environ['STUB_TRIP_EPOCH'])
clk = os.environ.get('CANARY_FAKE_CLOCK'); now = float(open(clk).read())
at = os.environ.get('STUB_ARTIFACT_AT') or dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()
cd, cbh, kd, kbh = os.environ['STUB_COUNTS'].split(',')
gate = {'by': 'death_gate', 'cd': int(cd), 'cbh': float(cbh), 'kd': int(kd), 'kbh': float(kbh)}
rtrip = int(os.environ.get('STUB_READ_TRIP') or -1)
if '--poll' in sys.argv and now >= trip:
    v, extra, line = 'REVERT', gate, 'death gate: (stub replay of the recorded trip)'
elif '--poll' in sys.argv:
    v, extra, line = 'POLL_OK', {}, 'poll: stub'
elif '--bagfix-extended' in sys.argv and os.environ.get('STUB_EXT_UNREADABLE'):
    v, extra, line = 'UNREADABLE', {}, 'immobiledid: no evidence object (stub)'
elif '--bagfix-extended' in sys.argv and os.environ.get('STUB_EXT_NOGUARDS'):
    v, extra, line = 'NOT_YET', {}, 'not readable yet (stub: exits before the guards)'
elif '--bagfix-extended' in sys.argv and M == rtrip and os.environ.get('STUB_EXT_REVERT'):
    v, extra, line = 'REVERT', {}, 'death gate -- REPORTED, not a verdict | own line stubread.breach = 1 fails <= 0 (stub)'
elif '--bagfix-extended' in sys.argv:
    v, extra, line = 'NOT_YET', {}, 'death gate ... -- REPORTED, not a verdict: bag-fix extension in force (stub)'
elif M == int(os.environ.get('STUB_BASE_UNREADABLE') or -1):
    v, extra, line = 'UNREADABLE', {}, 'immobiledid: no evidence object (stub: base read failed)'
elif M == rtrip:
    v, extra, line = 'REVERT', gate, 'death gate at a scheduled read (stub)'
else:
    v, extra, line = 'NOT_YET', {}, 'stub read'
guards = (v not in ('UNREADABLE',) or bool(os.environ.get('STUB_BASE_GUARDS'))) and not os.environ.get('STUB_EXT_NOGUARDS')
json.dump({'run_id': run, 'window_min': M, 'verdict': v, 'why': [line], 'at': at, 'extra': extra, 'guards': guards},
          open(os.path.join(reads, '%s-verdict-%d.json' % (run, M)), 'w'))
print('VERDICT %s (+%d) :: %s' % (v, M, line))
'''
# the registered read: writes an evidence object bound the way every read does (sha, pools, run, declared_at, minute)
STUB_READ = r'''import sys, os, json, datetime as dt
M = int(sys.argv[1]); man = json.load(open(os.environ['BAGFIX_MANIFEST']))
now = float(open(os.environ['CANARY_FAKE_CLOCK']).read())
o = {'sha': man['canary_code_version'], 'pools': man['canary_pool'], 'run_id': man['run_id'], 'declared_at': man['declared_at'],
     'window_min': M, 'emitted_at': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(), 'fields': {'junk_slots_did': -1.3}}
json.dump(o, open(os.path.join(os.environ['BAGFIX_READS_DIR'], '%s-stubread-%d.json' % (man['run_id'], M)), 'w'))
print('stub read', M)
'''
BLIND_SHIM = r'''import sys, os, runpy
if len(sys.argv) > 1 and sys.argv[1] == 'poll':
    print('BAGFIX ERROR (+0) :: shim: the measuring half is down'); sys.exit(1)
sys.argv[0] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bagfixgate_real.py')
runpy.run_path(sys.argv[0], run_name='__main__')
'''


def home(tmp, run, reg, journal_lines, blind=False):
    h = os.path.join(tmp, 'home'); os.makedirs(os.path.join(h, 'mcai-analysis', 'registrations'))
    os.makedirs(os.path.join(h, 'digest', 'reads')); rd = os.path.join(tmp, 'readdir'); os.makedirs(rd)
    for f in ('bagfixgate.py', 'bagfixrule.py', 'deathgate.py'):
        shutil.copy(os.path.join(SCRIPTS, f), os.path.join(h, 'mcai-analysis', f))
    if blind:
        os.rename(os.path.join(h, 'mcai-analysis', 'bagfixgate.py'), os.path.join(h, 'mcai-analysis', 'bagfixgate_real.py'))
        open(os.path.join(h, 'mcai-analysis', 'bagfixgate.py'), 'w').write(BLIND_SHIM)
    open(os.path.join(h, 'verdict.py'), 'w').write(STUB_VERDICT)
    # the loop's v30 schedule check is REAL: the live ~/v30check.py, copied (the loop runs $HOME/v30check.py)
    shutil.copy('/home/mike/v30check.py', os.path.join(h, 'v30check.py'))
    for s in reg['reads']:
        open(os.path.join(rd, s + '.py'), 'w').write(STUB_READ)
    json.dump(reg, open(os.path.join(h, 'mcai-analysis', 'registrations', run + '.json'), 'w'))
    with open(os.path.join(h, 'canary-journal.jsonl'), 'w') as f:
        for l in journal_lines:
            f.write(l.rstrip('\n') + '\n')
    return h, rd


def run_loop(tmp, h, rd, run, man_path, logs, clock0, trip_epoch, counts, bagfix_now=None, extra_env=None, poll_s=1800):
    clk = os.path.join(tmp, 'clock'); open(clk, 'w').write(str(int(clock0)))
    env = dict(os.environ, HOME=h, CANARY_MANIFEST=man_path, CANARY_LOCK=os.path.join(tmp, 'lock'),
               CANARY_READ_DIR=rd, CANARY_READ_CWD=tmp, CANARY_FAKE_CLOCK=clk, CANARY_POLL_S=str(poll_s),
               BAGFIX_LOG_ROOT=logs, BAGFIX_MANIFEST=man_path, BAGFIX_REG_DIR=os.path.join(h, 'mcai-analysis', 'registrations'),
               BAGFIX_READS_DIR=os.path.join(h, 'digest', 'reads'), BAGFIX_JOURNAL=os.path.join(h, 'canary-journal.jsonl'),
               BAGFIX_NOW=bagfix_now or ('@' + clk), STUB_TRIP_EPOCH=str(trip_epoch), STUB_COUNTS=counts,
               **(extra_env or {}))
    r = subprocess.run(['bash', LOOP, run, '--no-act'], capture_output=True, text=True, env=env, timeout=3000)
    jl = [json.loads(l) for l in open(os.path.join(h, 'canary-journal.jsonl')) if l.strip()]
    return r, [(j['phase'], j['note']) for j in jl if j.get('run') == run], h


def jline(run, phase, note=''):
    return json.dumps({'ts': 'x', 'run': run, 'phase': phase, 'note': note}, separators=(',', ':'))


def synthetic(tmp, scenario):
    tmp = tempfile.mkdtemp(dir=tmp)
    w = TB.final_world(tmp)        # 48 h of snapshots
    cb = w.bots(TB.POOLS_C); kb = w.bots(TB.POOLS_K)
    for i in range(6):
        w.add(cb[i], TB.line(w.decl + dt.timedelta(minutes=10 * (i + 1)), cb[i], '_death', inv={}))
    for i in range(4):
        w.add(kb[i], TB.line(w.decl + dt.timedelta(minutes=12 + 10 * i), kb[i], '_death', inv={}))
    for b in (cb[19], cb[18]):
        for i in range(3):
            w.add(b, TB.line(w.decl + dt.timedelta(minutes=3 + i), b, '_well_dispose', dur=4000))
    if scenario == 'linked':
        w.add(cb[0], TB.line(w.decl + dt.timedelta(minutes=10, seconds=-60), cb[0], '_well_dispose', dur=4000))
    if scenario == 'ceiling':
        for i in range(9):
            w.add(cb[6 + i], TB.line(w.decl + dt.timedelta(minutes=120 + 10 * i), cb[6 + i], '_death', inv={}))
    w.flush()
    if scenario == 'outage':
        # every bot's log stops at +150: a fleet outage (or a logging failure) during the extension
        cut = TB.Z(w.decl + dt.timedelta(minutes=150))
        for b in os.listdir(w.logs):
            f = os.path.join(w.logs, b, f'skill-{b}.jsonl')
            keep = [l for l in open(f) if l[15:39] < cut]     # '{"@timestamp":"' is 15 chars
            open(f, 'w').write(''.join(keep))
    reg = json.load(open(os.path.join(w.regs, TB.RUN + '.json')))
    reg.update({'reads': ['stubread'], 'read_minutes': [180, 360], 'deadline_min': 780,
                'bag_fix': dict(reg['bag_fix'], extended_deadline_min=1560,
                                primary={'read': 'stubread', 'field': 'junk_slots_did', 'op': '<=', 'value': -0.5})})
    lines = [jline(TB.RUN, 'deployed', 'board-a,board-b,hive-a,hive-b (fixture)')]
    if scenario == 'pending':
        lines += [jline(TB.RUN, 'poll-revert', 'VERDICT REVERT (+0) :: x'), jline(TB.RUN, 'bagfix-pending', 'FROM=0')]
    if scenario == 'rerun':
        lines += [jline(TB.RUN, 'read-180', 'VERDICT REVERT (+180) :: death gate'), jline(TB.RUN, 'bagfix-pending', 'FROM=180'),
                  jline(TB.RUN, 'bagfix-check', 'BAGFIX EXTEND (+180) :: x'), jline(TB.RUN, 'bagfix-extend', 'BAGFIX EXTEND (+180) :: x')]
    if scenario == 'checkcrash':
        lines += [jline(TB.RUN, 'bagfix-pending', 'FROM=180'), jline(TB.RUN, 'read-180', 'VERDICT REVERT (+180) :: death gate'),
                  jline(TB.RUN, 'bagfix-check', 'BAGFIX EXTEND (+180) :: x')]
    if scenario == 'resume':
        lines += [jline(TB.RUN, 'poll-revert', 'VERDICT REVERT (+0) :: x'), jline(TB.RUN, 'bagfix-extend', 'BAGFIX EXTEND (+0) :: x'),
                  jline(TB.RUN, 'bagfix-decided', 'REVERT :: BAGFIX REVERT (+0) :: (b) recorded before a crash')]
    h, rd = home(tmp, TB.RUN, reg, lines, blind=(scenario == 'blind'))
    d0 = w.decl.timestamp()
    extra = {}
    trip = d0 + 65 * 60
    counts = '6,30.0,4,90.0'
    if scenario == 'readtrip':
        trip = d0 + 10 ** 9                        # the polls never trip; the +180 READ does
        extra = {'STUB_READ_TRIP': '180', 'STUB_EXT_REVERT': '1'}
        counts = '6,60.0,4,180.0'
    if scenario == 'rerun':
        trip = d0 + 10 ** 9
        extra = {'STUB_READ_TRIP': '180', 'STUB_EXT_REVERT': '1'}
    if scenario == 'readfail':
        extra = {'STUB_EXT_UNREADABLE': '1'}
    if scenario == 'noguards':
        extra = {'STUB_EXT_NOGUARDS': '1'}
    if scenario in ('basefail', 'basefail2'):
        extra = {'STUB_BASE_UNREADABLE': '180'}
        trip = d0 + 200 * 60
    if scenario == 'basefail2':
        extra['STUB_BASE_GUARDS'] = '1'           # UNREADABLE AFTER the guards (an undefined own line)
    if scenario == 'checkcrash':
        trip = d0 + 10 ** 9
    if scenario == 'pending':
        extra = {'STUB_ARTIFACT_AT': '2020-01-01T00:00:00+00:00'}    # the interrupted check's artifact is long stale
    mp = os.path.join(w.d, 'man.json')
    if scenario == 'redeploy':
        man = json.load(open(mp)); man.update(canary_pool=None, canary_code_version=None); json.dump(man, open(mp, 'w'))
    clock0 = d0 + (200 * 60 if scenario in ('rerun', 'checkcrash') else 0)
    return run_loop(tmp, h, rd, TB.RUN, mp, w.logs, clock0, trip, counts, extra_env=extra)


def phases(js):
    return [p for p, _n in js]


def junkwell(tmp):
    """junkwell-01's recorded journal + real logs. Host only."""
    J = os.path.expanduser('~/canary-journal.jsonl')
    rec = [l for l in open(J) if '"run":"junkwell-01"' in l]
    upto = [l for l in rec if '"phase":"poll-revert"' not in l and '"phase":"recorded"' not in l
            and 'teardown' not in l and 'torn-down' not in l]
    reg = json.load(open(os.path.expanduser('~/mcai-analysis/registrations/junkwell-01.json')))
    reg.update({'class': 'bag-fix', 'reads': ['stubread'],
                'bag_fix': {'own_kinds': ['_well_built', '_well_dispose', '_well_inside', '_well_pit_open', '_well_retired'],
                            'primary': {'read': 'stubread', 'field': 'junk_slots_did', 'op': '<=', 'value': -0.5},
                            'extended_deadline_min': 1560}})
    tmp = tempfile.mkdtemp(dir=tmp)
    h, rd = home(tmp, 'junkwell-01', reg, upto)
    man = {'trial': 'instance-1', 'run_id': 'junkwell-01', 'declared_code_version': '1918bb5',
           'declared_at': '2026-10-05T10:05:20.951551Z', 'canary_pool': 'placebo-a,board-b', 'canary_code_version': reg['sha']}
    mp = os.path.join(tmp, 'man.json'); json.dump(man, open(mp, 'w'))
    trip = dt.datetime(2026, 10, 5, 15, 13, 26, tzinfo=dt.timezone.utc).timestamp()
    # the recorded gate: 6 canary deaths in 51.1 bot-h vs 11 control in 358.2 (ledger row 84)
    return run_loop(tmp, h, rd, 'junkwell-01', mp, '/var/log/mcai', trip - 300, trip, '6,51.1,11,358.2',
                    bagfix_now='2026-10-05T15:13:26Z',
                    extra_env={'STUB_ARTIFACT_AT': '2026-10-05T15:13:26+00:00'}, poll_s=3600)


if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='bagfixloop-')
    if '--junkwell' in sys.argv:
        r, js, h = junkwell(tmp)
        for p, n in js[-14:]:
            print('  journal  %-18s %s' % (p, n[:300]))
        print('  stdout tail:', r.stdout.strip().splitlines()[-3:])
        ph = phases(js)
        chk = [n for p, n in js if p == 'bagfix-check']
        t('junkwell-01 replay: extend-check EXTENDS (re-measures the recorded 6 vs 11, 0 linked, own rows on >= 2 bots, LB < 2)',
          'bagfix-extend' in ph, chk)
        t('junkwell-01 replay: no extension poll reverts on the frozen (canary-only) data', 'bagfix-poll-revert' not in ph, js[-6:])
        t('junkwell-01 replay: +1440 is never reached on real data, so the extension deadline contains it -> INCONCLUSIVE',
          'would act: INCONCLUSIVE' in r.stdout and 'bagfix-final' not in ph, r.stdout[-400:])
    else:
        for sc in ('keep', 'ceiling', 'linked', 'readtrip', 'blind', 'resume', 'pending', 'rerun', 'readfail', 'redeploy',
                   'noguards', 'checkcrash', 'outage', 'basefail', 'basefail2'):
            r, js, h = synthetic(tmp, sc)
            ph = phases(js)
            print(f'  [{sc}] journal phases: {ph}')
            out = r.stdout + r.stderr
            if sc == 'keep':
                t('keep: the death poll REVERT is handed to extend-check and EXTENDS', 'poll-revert' in ph and 'bagfix-extend' in ph, js)
                t('keep: reads +180, +360 and +1440 EVALUATED during the extension',
                  all(x in ph for x in ('eval-read-180', 'eval-read-360', 'eval-read-1440')), js)
                fin = [n for p, n in js if p == 'bagfix-final']
                t('keep: +1440 final KEEP, decision journalled, next slot recorded',
                  fin and fin[-1].startswith('BAGFIX KEEP') and 'bagfix-decided' in ph and 'next-slot' in ph
                  and os.path.exists(os.path.join(h, 'digest', 'NEXT-SLOT.json')), js)
                t('keep: --no-act stops before acting', 'would act: KEEP' in out, out[-600:])
            if sc == 'outage':
                t('outage: both arms stale -> PAUSED, paged once, and 12 in a row close it INCONCLUSIVE (never silent)',
                  ph.count('bagfix-paused') == 12 and 'would act: INCONCLUSIVE' in out
                  and any(p == 'bagfix-decided' and n.startswith('INCONCLUSIVE') for p, n in js), js)
            if sc == 'ceiling':
                t('ceiling: EXTEND, then an extension poll REVERTs by (b) before +1440',
                  'bagfix-extend' in ph and 'bagfix-poll-revert' in ph and 'bagfix-final' not in ph and 'would act: REVERT' in out, js)
            if sc == 'linked':
                chk = [n for p, n in js if p == 'bagfix-check']
                t('linked: the REVERT stands -- bagfix-check REVERT, no extension',
                  chk and chk[0].startswith('BAGFIX REVERT') and 'bagfix-extend' not in ph and 'would act: REVERT' in out, js)
            if sc == 'readtrip':
                t('readtrip: the +180 read trips, EXTENDS, the +180 read is RE-RUN gate-off and its own line REVERTs',
                  'bagfix-extend' in ph and 'read-180-ext' in ph and 'would act: REVERT' in out
                  and any(p == 'bagfix-decided' and n.startswith('REVERT') for p, n in js), js)
            if sc == 'blind':
                t('blind: 3 unusable polls after the trip -> REVERT ("extension BLIND")',
                  'bagfix-extend' in ph and ph.count('poll-failed') == 3 and 'would act: REVERT' in out
                  and any(p == 'bagfix-decided' and 'BLIND' in n for p, n in js), js)
            if sc == 'pending':
                t('pending: an interrupted extend-check is re-run on resume and, on a stale artifact, REVERTs',
                  'bagfix-check' in ph and 'bagfix-extend' not in ph and 'would act: REVERT' in out
                  and any(p == 'bagfix-decided' and n.startswith('REVERT') for p, n in js), js)
            if sc == 'rerun':
                t('rerun: the lost gate-off re-run of the tripping read is redone on resume, and its REVERT decides',
                  'read-180-ext' in ph and 'would act: REVERT' in out and any(p == 'bagfix-decided' and n.startswith('REVERT') for p, n in js), js)
            if sc == 'readfail':
                t('readfail: UNREADABLE guard reads are journalled as FAILED, never done, and 3 of them REVERT',
                  'bagfix-extend' in ph and 'eval-read-180' not in ph and sum(p.endswith('-failed') for p in ph) >= 3
                  and 'would act: REVERT' in out and any(p == 'bagfix-decided' and 'BLIND' in n for p, n in js), js)
            if sc in ('basefail', 'basefail2'):
                t('basefail: a base read that never evaluated (+180 UNREADABLE) is re-read in the extension before any final',
                  'read-180' in ph and 'bagfix-extend' in ph and 'eval-read-180' in ph and 'read-180-ext' in ph
                  and ph.index('eval-read-180') > ph.index('bagfix-extend'), js)
            if sc == 'noguards':
                t('noguards: NOT_YET reads that stopped before the guards are FAILED, never done; 3 -> REVERT, and final never runs',
                  'bagfix-extend' in ph and 'eval-read-180' not in ph and 'bagfix-final' not in ph
                  and 'would act: REVERT' in out and any(p == 'bagfix-decided' and 'BLIND' in n for p, n in js), js)
            if sc == 'checkcrash':
                t('checkcrash: a pending REVERT survives a crash after bagfix-check; extend-check re-runs and REVERTs',
                  ph.count('bagfix-check') == 2 and 'bagfix-extend' not in ph and 'would act: REVERT' in out
                  and any(p == 'bagfix-decided' and n.startswith('REVERT') for p, n in js), js)
            if sc == 'redeploy':
                t('redeploy: a run id already deployed, with the manifest cleared, is refused before any draw',
                  'refused-redeploy' in ph and 'draw' not in ph and 'would deploy' not in out, (js, out[-300:]))
            if sc == 'resume':
                t('resume: a journalled bag-fix decision is resumed into, never re-read',
                  'would act: REVERT' in out and 'poll-failed' not in ph and 'bagfix-check' not in ph and 'read-180' not in ph, (js, out[-400:]))
    n = len(T); bad = n - sum(T)
    print(f'\n{n - bad}/{n} pass')
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if bad else 0)
