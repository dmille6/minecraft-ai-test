#!/usr/bin/env python3
"""Behaviour tests for stallcheck.py (OWNER 10-31). Every detector is shown to FIRE on a seeded case and to stay QUIET on a
clean one; an end-to-end run builds a real git origin + clone and a stand-in canary-sched module and checks the files the
fleetstatus header and the Codex audit read; the wiring (alarmhead prints it, opsaudit's prompt includes it and pushes the
memory list, the installer crons it without touching canary-sched) is asserted on executable text; and the committed ledger
and monitor registry must validate.

    python3 -B scripts/host/test_stallcheck.py      (exit 1 on any failure; bots/test/stallcheck.test.mjs runs it in npm test)

Bottom: MUTANTS. Each disables one decision; the tests must then fail. Every mutant asserts its anchor is present exactly
once (CLAUDE.md: a mutant that silently fails to apply reads as "killed").
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..'))
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 31, 18, 0, tzinfo=UTC)
FLEET = 'f' * 40
OLD = 'a' * 40
SRC_PATH = os.path.join(HERE, 'stallcheck.py')
FAILS = []


def load(src_text=None):
    path = SRC_PATH
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py', dir=HERE)
        os.write(fd, src_text.encode())
        os.close(fd)
    spec = importlib.util.spec_from_file_location('sc_%d' % abs(hash(path)), path)
    m = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(m)
    finally:
        if src_text is not None:
            os.unlink(path)
    return m


def check(name, cond, detail=''):
    if not cond:
        FAILS.append(f'{name} {str(detail)[:300]}')


def H(h):
    return NOW - dt.timedelta(hours=h)


def item(iid='x', **k):
    d = {'id': iid, 'title': 't', 'owner_date': '2026-10-20', 'memory': ['owner-x.md'], 'kind': 'canary', 'lane': 'progress',
         'state': 'open', 'owner': 'control session', 'next_step': 'do it', 'max_quiet_hours': 24, 'evidence': {}}
    d.update(k)
    return d


def EV(**k):
    d = {'runs': {}, 'branch_ts': {}, 'grep_ts': {}, 'path_ts': {}, 'fleet_has': {}}
    d.update(k)
    return d


def dets(fs, det):
    return [f for f in fs if f['det'] == det and not f.get('grace')]


# ---------------------------------------------------------------------------------------------------------- detectors --
def t_ledger(S):
    items, fs = S.validate({'items': [item('ok'), item('noparkdate', state='parked', parked={'why': 'w'}),
                                      item('nostep', next_step=''), item('baddep', depends_on=[{'item': 'ghost'}]),
                                      item('ok')]})
    keys = {f['key'] for f in fs}
    check('L fires: parked without a date', 'L:noparkdate' in keys, keys)
    check('L fires: open without next_step', 'L:nostep' in keys, keys)
    check('L fires: unknown dependency item', 'L:baddep' in keys, keys)
    check('L fires: duplicate id', any('duplicate' in f['line'] for f in fs), fs)
    _, clean = S.validate({'items': [item('a'), item('b', state='done', done={'when': '2026-10-30', 'evidence': 'e'}),
                                     item('c', state='parked', parked={'until': '2026-11-05', 'why': 'w'})]})
    check('L quiet on a valid ledger', clean == [], clean)
    good, fs = S.validate({'items': [item('a'), item('strdep', depends_on=['ledger-01']), item('evlist', evidence=['x']),
                                     item('qstr', max_quiet_hours='2d')]})
    check('L: malformed rows are findings AND left out of the detectors (no crash downstream)',
          [i['id'] for i in good] == ['a'] and {f['key'] for f in fs} == {'L:strdep', 'L:evlist', 'L:qstr'}, (good, fs))
    S.det_quiet(good, EV(), NOW); S.det_deps(good, EV(), '', NOW, {})
    _, empty = S.validate({'items': []})
    check('L fires on an EMPTY ledger (never a quiet zero)', len(empty) == 1, empty)


def t_quiet(S):
    fs = S.det_quiet([item('old', evidence={'grep': ['old']})], EV(grep_ts={'old': H(30)}), NOW)
    check('a fires: 30 h quiet over a 24 h limit', [f['key'] for f in fs] == ['a:old'], fs)
    fs = S.det_quiet([item('never', owner_date='2026-10-25')], EV(), NOW)
    check('a fires: never any evidence since the owner date', len(fs) == 1 and 'NO evidence' in fs[0]['line'], fs)
    fs = S.det_quiet([item('fresh', evidence={'runs': ['r1'], 'grep': ['g']})],
                     EV(runs={'r1': {'last_ts': H(2)}}, grep_ts={'g': H(100)}), NOW)
    check('a quiet: newest evidence (a run row 2 h ago) wins', fs == [], fs)
    fs = S.det_quiet([item('pk', state='parked', parked={'until': '2026-10-30', 'why': 'w'})], EV(), NOW)
    check('a fires: park expired', len(fs) == 1 and 'PARK EXPIRED' in fs[0]['line'], fs)
    fs = S.det_quiet([item('pk', state='parked', parked={'until': '2026-11-30', 'why': 'w'}),
                      item('dn', state='done', done={'when': '2026-01-01'})], EV(), NOW)
    check('a quiet: a future park and a done row', fs == [], fs)
    fs = S.det_quiet([item('on', evidence={'fleet_paths': ['bots/src/a.mjs'], 'grep': ['g']})],
                     EV(fleet_has={'bots/src/a.mjs': True}, grep_ts={'g': H(1)}), NOW)
    check('a fires: open but the fleet carries it', [f['key'] for f in fs] == ['a:on:onfleet'], fs)
    fs = S.det_quiet([item('ow', owner='owner')], EV(), NOW)
    check('a names an owner-blocked item as waiting on the OWNER', fs and 'OWNER' in fs[0]['line'], fs)


def t_deps(S):
    runs = {'ledger-01': {'exists': True, 'state': 'done', 'kept_at': H(150), 'closed_at': H(150), 'last_ts': H(150)},
            'gone-01': {'exists': False}, 'cx-01': {'exists': True, 'state': 'cancelled'},
            'live-01': {'exists': True, 'state': 'running', 'kept_at': None, 'closed_at': None, 'last_ts': H(1)}}
    i = item('furnaceseen-01', depends_on=[{'run': 'ledger-01', 'until': 'kept'}], evidence={'grep': ['furnaceseen']})
    fs = S.det_deps([i], EV(runs=runs, grep_ts={'furnaceseen': H(160)}), '', NOW, {})
    check('b fires: ledger-01 KEPT 150 h ago, dependent last moved before it', [f['key'] for f in fs] == ['b:furnaceseen-01'], fs)
    fs = S.det_deps([i], EV(runs=runs, grep_ts={'furnaceseen': H(5)}), '', NOW, {})
    check('b quiet: the dependent moved after the KEEP', fs == [], fs)
    fs = S.det_deps([item('w', depends_on=[{'run': 'live-01'}])], EV(runs=runs), '', NOW, {})
    check('b quiet: the dependency is not met yet', fs == [], fs)
    fs = S.det_deps([item('co', depends_on=[{'cron': 'cobblecapread.py'}])], EV(runs=runs), '*/5 * * * * other.py', NOW, {})
    check('b fires: a cron trigger that does not exist', len(fs) == 1 and 'NOT in the crontab' in fs[0]['line'], fs)
    fs = S.det_deps([item('co', depends_on=[{'cron': 'cobblecapread.py'}])], EV(runs=runs), '0 * * * * cobblecapread.py', NOW, {})
    check('b quiet: the cron trigger exists', fs == [], fs)
    fs = S.det_deps([item('g', depends_on=[{'run': 'gone-01'}]), item('c', depends_on=[{'run': 'cx-01'}])], EV(runs=runs), '', NOW, {})
    check('b fires: a nonexistent and a cancelled dependency', sorted(f['key'] for f in fs) == ['b:c:never', 'b:g:never'], fs)
    fs = S.det_deps([item('d', depends_on=[{'item': 'up'}])], EV(runs=runs), '', NOW, {'up': H(48)})
    check('b fires: an item dependency DONE 48 h ago', len(fs) == 1, fs)


def Q(run, state='ready', hold=None, after=(), variants=(FLEET,)):
    return {'run': run, 'state': state, 'hold': hold, 'after': list(after), 'variants': list(variants)}


def t_queue(S):
    entries = [Q('done-01', 'done'), Q('cx-01', 'cancelled'), Q('dead-01', variants=(OLD,)),
               Q('afterx', after=['cx-01']), Q('afterdead', after=['dead-01']), Q('afterghost', after=['nope-01']),
               Q('holdstale', hold='wait for done-01 to finish'), Q('fine', after=['done-01']),
               Q('afterjournal', after=['old-07'])]
    fs = S.det_queue(entries, FLEET, {}, {'old-07'})
    keys = {f['key'] for f in fs}
    for k in ('c:dead-01', 'c:afterx', 'c:afterdead', 'c:afterghost', 'c:holdstale'):
        check(f'c fires: {k}', k in keys, keys)
    check('c quiet: a live entry after a done one, and after a journal-only run', not ({'c:fine', 'c:afterjournal'} & keys), keys)
    fs = S.det_queue(entries, FLEET, {'dead-01': 'ledger-row'}, {'old-07'})
    check('c quiet: a dead entry the ledger parks with a date', 'c:dead-01' not in {f['key'] for f in fs}, fs)


def t_branches(S):
    br = [{'name': 'furnaceseen-on-281d566', 'approve_ts': H(48), 'approve_sha': 'b' * 40},
          {'name': 'escapeguard-on-281d5659', 'approve_ts': H(48)}, {'name': 'fresh-on-281d566', 'approve_ts': H(2)},
          {'name': 'wallstuck-show-on-a50a6782', 'approve_ts': H(48)}, {'name': 'parked-on-281d566', 'approve_ts': H(48)}]
    fs = S.det_branches(br, {'escapeguard-01', 'shaft-03'}, ['parked-on-*'], NOW)
    check('d fires only on the approved, unqueued, unowned canary branch', [f['key'] for f in fs] == ['d:furnaceseen'], fs)
    fs = S.det_branches(br + [{'name': 'furnaceseen-on-6e1afb5', 'approve_ts': H(100), 'approve_sha': 'c' * 40}],
                        {'escapeguard-01'}, ['parked-on-*'], NOW)
    check('d: re-stacks of one change are ONE finding naming the newest', len(dets(fs, 'd')) == 1 and
          'furnaceseen-on-281d566 (+1 older' in fs[0]['line'], fs)
    fs = S.det_branches([{'name': 'tk-on-830dc36', 'approve_ts': H(300), 'approve_sha': 'd' * 40}], set(), [], NOW, {'d' * 40})
    check('d quiet: the approved commit was queued under another name (reachable from a canary/promotion/main)', fs == [], fs)


def t_lanes(S):
    lane_of = {'p1': 'progress', 's1': 'survival', 's2': 'survival'}
    entries = [Q('p1'), Q('s1', hold='WAIT for x'), Q('s2', variants=(OLD,))]
    fs = S.det_lanes(entries, FLEET, lane_of, {'e:survival': S.iso(H(72))}, NOW)
    check('e fires: survival has only a held and a dead entry for 72 h', [f['key'] for f in dets(fs, 'e')] == ['e:survival'], fs)
    fs = S.det_lanes(entries, FLEET, lane_of, {}, NOW)
    check('e inside the grace: recorded, not counted', dets(fs, 'e') == [] and any(f.get('grace') for f in fs), fs)
    fs = S.det_lanes(entries + [Q('s3')], FLEET, dict(lane_of, s3='survival'), {'e:survival': S.iso(H(72))}, NOW)
    check('e quiet: both lanes have a runnable entry', fs == [], fs)


def t_unshipped(S):
    commits = [('1' * 40, H(100), 'treefarm-04 r4 on main: x'), ('2' * 40, H(120), 'treefarm-04 on main: y'),
               ('3' * 40, H(10), 'expedition-01 r5: z'), ('4' * 40, H(200), 'bamboo-03: parked one')]
    fs = S.det_unshipped(commits, [('shaft-03', '5' * 40, H(10), False), ('zig', '6' * 40, H(1), False),
                                   ('ok', '7' * 40, H(50), True)], NOW, True, {'bamboo-03': 'row'})
    keys = sorted(f['key'] for f in fs)
    check('f fires: treefarm-04 (2 commits, oldest 5 d) and the 10 h promotion not on main',
          keys == ['f:promo:shaft-03', 'f:unshipped:treefarm-04'], keys)
    check('f groups by feature', any('2 bots/src commit' in f['line'] for f in fs), fs)
    fs = S.det_unshipped([], [], NOW, False, {})
    check('f fires: the fleet sha is not on main', [f['key'] for f in fs] == ['f:fleet-not-on-main'], fs)
    check('feature_of', S.feature_of('treefarm-04 r4 on main (x)') == 'treefarm-04' and S.feature_of('shaft-03: y') == 'shaft-03')


def t_goals(S):
    al = {'goal:hive-d/shop@68_65_68': 'STUCK 69.6 h: hive-d/shop -- ...', 'goal:hive-a/shaft@1': 'STUCK 3.2 h: x',
          'goal:board-a/house1@3': 'STUCK 20.2 h: y'}
    fs = S.det_goals(al, [item('shops', covers_alarms=['goal:*/house*@*'])])
    check('g fires: a 69.6 h STUCK alarm nobody owns', [f['key'] for f in fs] == ['g:goal:hive-d/shop@68_65_68'], fs)
    fs = S.det_goals(al, [item('shops', covers_alarms=['goal:*/house*@*', 'goal:*/shop@*'])])
    check('g quiet: every old alarm is owned', fs == [], fs)
    fs = S.det_goals(al, [item('shops', state='done', covers_alarms=['goal:*/house*@*', 'goal:*/shop@*'])])
    check('g fires: a DONE row does not own a live alarm', len(fs) == 2, fs)


def t_monitors(S):
    reg = [{'id': 'ok', 'cron': 'ok.py', 'outputs': ['~/ok.log'], 'fresh_hours': 1, 'consumer': 'fleetstatus'},
           {'id': 'orphan', 'cron': 'orphan.py', 'outputs': ['~/o.log'], 'fresh_hours': 26, 'consumer': None},
           {'id': 'stale', 'cron': 'stale.py', 'outputs': ['~/s.log'], 'fresh_hours': 1, 'consumer': 'x'},
           {'id': 'gone', 'cron': 'gone.py', 'outputs': [], 'consumer': 'x'},
           {'id': 'act', 'cron': 'act.sh', 'outputs': [], 'kind': 'actuator'},
           {'id': 'mac', 'host': 'mac', 'launchd': 'com.mcai.x', 'consumer': 'x'}]
    cron = ['*/5 * * * * ok.py', '0 * * * * orphan.py', '0 * * * * stale.py', '*/10 * * * * act.sh', '7 * * * * mystery.py']
    mt = {'~/ok.log': H(0.2), '~/o.log': H(1), '~/s.log': H(5)}
    keys = {f['key'] for f in S.det_monitors(reg, cron, mt, NOW, launchd=['com.mcai.y'])}
    for k in ('h:orphan:consumer', 'h:stale:stale', 'h:gone:cron', 'h:mac:launchd'):
        check(f'h fires: {k}', k in keys, keys)
    check('h fires: an unregistered cron line', any(k.startswith('h:unregistered:') and 'mystery' in k for k in keys), keys)
    check('h quiet: the healthy job and the actuator', not any(k.startswith(('h:ok:', 'h:act:')) for k in keys), keys)
    fs = S.det_monitors(reg[:1], cron[:1], mt, NOW, launchd=None)
    check('h quiet on a clean registry', fs == [], fs)


def t_memories(S):
    items = [item('a', memory=['owner-a.md'])]
    ml = {'generated_at': S.iso(H(3)), 'files': {'owner-a.md': 'x', 'owner-new-1031.md': 'x', 'owner-rule.md': 'x', 'other.md': 'x'}}
    keys = {f['key'] for f in S.det_memories(items, ml, {'owner-rule.md'}, NOW)}
    check('m fires: a new owner memory with no row', keys == {'m:owner-new-1031.md'}, keys)
    fs = S.det_memories(items, {'generated_at': S.iso(H(3)), 'files': {'owner-a.md': 'x'}}, set(), NOW)
    check('m quiet: every owner memory has a row', fs == [], fs)
    check('m fires: no list from the Mac', [f['key'] for f in S.det_memories(items, None, set(), NOW)] == ['m:list-missing'])
    fs = S.det_memories(items, {'generated_at': S.iso(H(80)), 'files': {'owner-a.md': 'x'}}, set(), NOW)
    check('m fires: a stale list', [f['key'] for f in fs] == ['m:list-stale'], fs)


def t_header(S):
    fs = [S.F('h', 'z', 'monitor'), S.F('a', 'q', 'quiet item', age_h=5), S.F('b', 'd', 'dep met'), S.F('c', 'q', 'dead entry')]
    al, summary = S.header(fs, {'open': 3, 'items': 5}, [])
    check('header: STALLED with the count and the top 3 by weight', al.get('stalled', '').startswith('STALLED: 4 items')
          and al['stalled'].index('dep met') < al['stalled'].index('dead entry') < al['stalled'].index('quiet item')
          and 'monitor' not in al['stalled'].split('top 3:')[1], al)
    al, summary = S.header([], {'open': 3, 'items': 5, 'queue': 9}, [])
    check('header: nothing stalled -> no alarm, a summary naming the denominators', al == {} and '3 open items of 5' in summary, summary)
    al, _ = S.header([], {}, ['the queue has NO entries'])
    check('header: a missing input is an alarm, never a quiet zero', 'INPUT MISSING' in al.get('inputs', ''), al)
    check('daily push once a day after 13Z', S.daily_push_due({}, NOW) and not S.daily_push_due({'day': '2026-10-31'}, NOW)
          and not S.daily_push_due({}, NOW.replace(hour=9)))


TESTS = [t_ledger, t_quiet, t_deps, t_queue, t_branches, t_lanes, t_unshipped, t_goals, t_monitors, t_memories, t_header]


# -------------------------------------------------------------------------------------------------------- end to end --
SCHED_STUB = '''
import json, os
def paths():
    return {"state": os.environ["SC_TEST_SCHED_STATE"]}
def gather(P, full=True):
    return json.load(open(os.environ["SC_TEST_STATE"]))
def entry_state(e, st):
    return e["_state"]
'''


def sh(*a, cwd=None):
    return subprocess.run(list(a), cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def t_end_to_end():
    with tempfile.TemporaryDirectory() as d:
        env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
        os.environ.update({k: env[k] for k in ('GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL')})
        org = os.path.join(d, 'origin')
        os.makedirs(os.path.join(org, 'config'))
        os.makedirs(os.path.join(org, 'bots', 'src'))
        sh('git', 'init', '-q', '-b', 'main', cwd=org)
        open(os.path.join(org, 'bots/src/a.mjs'), 'w').write('a\n')
        led = {'items': [item('furnaceseen-01', owner_date='2026-10-20', depends_on=[{'run': 'ledger-01', 'until': 'kept'}],
                              evidence={'grep': ['furnaceseen'], 'branches': ['furnaceseen*']}),
                         item('tidy', state='done', done={'when': '2026-10-30', 'evidence': 'x'})]}
        json.dump(led, open(os.path.join(org, 'config/owner-commitments.json'), 'w'))
        json.dump({'monitors': [{'id': 'sched', 'cron': 'canary-sched.py tick', 'outputs': [], 'consumer': 'x'}]},
                  open(os.path.join(org, 'config/monitors.json'), 'w'))
        sh('git', 'add', '-A', cwd=org)
        sh('git', 'commit', '-q', '-m', 'base', cwd=org)
        fleet = sh('git', 'rev-parse', 'HEAD', cwd=org)
        sh('git', 'checkout', '-q', '-b', f'furnaceseen-on-{fleet[:7]}', cwd=org)
        open(os.path.join(org, 'bots/src/f.mjs'), 'w').write('f\n')
        sh('git', 'add', '-A', cwd=org)
        rel = lambda days: (dt.datetime.now(UTC) - dt.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ')
        subprocess.run(['git', 'commit', '-q', '-m', 'furnaceseen-01: x\n\nCodex APPROVE, Claude APPROVE'], cwd=org, check=True,
                       env=dict(env, GIT_COMMITTER_DATE=rel(7), GIT_AUTHOR_DATE=rel(7)))
        sh('git', 'checkout', '-q', 'main', cwd=org)
        open(os.path.join(org, 'bots/src/t.mjs'), 'w').write('t\n')
        sh('git', 'add', '-A', cwd=org)
        subprocess.run(['git', 'commit', '-q', '-m', 'treefarm-04 on main: the farm'], cwd=org, check=True,
                       env=dict(env, GIT_COMMITTER_DATE=rel(10), GIT_AUTHOR_DATE=rel(10)))
        clone = os.path.join(d, 'clone')
        sh('git', 'clone', '-q', org, clone)
        state = {'manifest': {'declared_code_version': fleet[:7]},        # abbreviated, as deploy-fleet may write it
                 'journal': [{'ts': rel(6), 'run': 'ledger-01', 'phase': 'recorded', 'note': 'KEEP'},
                             {'ts': rel(6), 'run': 'ledger-01', 'phase': 'promoted', 'note': f'{fleet} fleet-wide'}],
                 'state_rows': [],
                 'queue': {'entries': [{'run': 'ledger-01', '_state': 'done', 'after': [], 'variants': {OLD: {}}},
                                       {'run': 'treefarm-03', '_state': 'ready', 'hold': 'PARKED', 'after': ['ledger-01'],
                                        'variants': {OLD: {}}},
                                       {'run': 'live-01', '_state': 'ready', 'after': ['ledger-01'], 'variants': {fleet: {}}}]}}
        sp = os.path.join(d, 'state.json')
        json.dump(state, open(sp, 'w'))
        os.environ['SC_TEST_STATE'] = sp
        ssf = os.path.join(d, 'sched-state.jsonl')
        open(ssf, 'w').write('')
        os.environ['SC_TEST_SCHED_STATE'] = ssf
        S0 = load()
        check('e2e positive control: with the full fleet sha the live variant is runnable',
              S0.runnable(Q('x', variants=(fleet,)), [], fleet))
        stub = os.path.join(d, 'sched.py')
        open(stub, 'w').write(SCHED_STUB)
        ct = os.path.join(d, 'crontab')
        open(ct, 'w').write('# comment\n*/5 * * * * python3 canary-sched.py tick\n7 * * * * python3 orphan.py\n')
        json.dump({'alarms': {'goal:hive-d/shop@1': 'STUCK 69.6 h: x'}}, open(os.path.join(d, 'goals.json'), 'w'))
        out = os.path.join(d, 'digest')
        S = load()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            S.main(['run', '--repo', clone, '--sched', stub, '--goals', os.path.join(d, 'goals.json'), '--memories',
                    os.path.join(d, 'none.json'), '--out-dir', out, '--crontab', ct, '--no-push'])
        st = json.load(open(os.path.join(out, 'stallcheck-fleet.json')))
        md = open(os.path.join(out, 'stallcheck-latest.md')).read()
        keys = {f['key'] for f in st['findings']}
        want = {'b:furnaceseen-01', 'c:treefarm-03', 'd:furnaceseen', 'f:unshipped:treefarm-04',
                'g:goal:hive-d/shop@1', 'm:list-missing'}
        check('e2e: the seeded stalls are all found', want <= keys, sorted(keys))
        check('e2e: the orphan cron line is unregistered', any(k.startswith('h:unregistered:') for k in keys), keys)
        check('e2e: no input error on a complete fixture (an abbreviated manifest sha resolves)', 'inputs' not in st['alarms'], st['alarms'])
        check('e2e: the entry with only a stale variant is the one dead entry', 'c:treefarm-03' in keys and
              not any(k.startswith(('c:ledger', 'c:live-01')) for k in keys), keys)
        check('e2e: the header alarm', st['alarms'].get('stalled', '').startswith('STALLED: '), st['alarms'])
        check('e2e: the report opens with its line and names its denominators',
              md.startswith('STALLCHECK ') and '2 ledger rows' in md and '3 queue entries' in md and '2 journal rows' in md, md[:400])
        # the same fixture through alarmhead: the fleetstatus header prints it
        from lib import alarmhead
        hl = alarmhead.file_lines(dt.datetime.now(UTC), 'stallcheck-fleet.json', 'stalled commitments',
                                  dt.timedelta(minutes=150), out)
        check('e2e: alarmhead prints !! STALLED', any(x.startswith('!! STALLED: ') for x in hl), hl)
        # a broken input is an alarm
        os.unlink(ssf)
        json.dump({'manifest': {}, 'journal': [], 'state_rows': [], 'queue': {'entries': []}}, open(sp, 'w'))
        with contextlib.redirect_stdout(io.StringIO()):
            S.main(['run', '--repo', clone, '--sched', stub, '--goals', os.path.join(d, 'goals.json'), '--memories',
                    os.path.join(d, 'none.json'), '--out-dir', out, '--crontab', ct, '--no-push', '--no-fetch'])
        st = json.load(open(os.path.join(out, 'stallcheck-fleet.json')))
        check('e2e: an empty queue/journal/fleet is INPUT MISSING', 'NO entries' in st['alarms'].get('inputs', '')
              and 'fleet sha unknown' in st['alarms'].get('inputs', '') and 'scheduler state' in st['alarms'].get('inputs', ''),
              st['alarms'])
        check('e2e: with no fleet sha, no per-entry c/e noise', not any(f['det'] in 'ce' for f in st['findings']), st['findings'])


# ------------------------------------------------------------------------------------------------------------- wiring --
def code(path):
    """Executable text: shell/python comment lines dropped (this codebase's comments quote the code)."""
    return '\n'.join(l for l in open(path).read().splitlines() if not l.lstrip().startswith('#'))


def t_wiring():
    from lib import alarmhead
    check('alarmhead reads stallcheck-fleet.json', any(f[0] == 'stallcheck-fleet.json' for f in alarmhead.FILES), alarmhead.FILES)
    op = code(os.path.join(ROOT, 'scripts/mac/opsaudit.sh'))
    m = re.search(r'\n\{\n(.*?)\n\} > "\$P"', op, re.S)
    check('opsaudit: the prompt block exists', m is not None)
    if m:
        check('opsaudit: the prompt includes the stallcheck report over ssh',
              re.search(r'\$SSH31 .*stallcheck-latest\.md', m.group(1)) is not None)
        check('opsaudit: the prompt tells Codex to audit STALLED items', 'STALLCHECK report' in m.group(1))
        check('positive control: the prompt still includes the queue', 'canary-sched.py status' in m.group(1))
    check('opsaudit: pushes the owner-memory list to .31', re.search(r'scp .*owner-memories\.json', op) is not None)
    inst = code(os.path.join(ROOT, 'scripts/host/install-stallcheck.sh'))
    check('installer: an hourly cron line running stallcheck.py run', re.search(r"\d+ \* \* \* \* .*stallcheck\.py run", inst) is not None)
    check('installer: never wraps canary-sched.py (flock deadlock rule)', 'canary-sched' not in inst and 'flock' not in inst)


def t_committed_config():
    S = load()
    led = json.load(open(os.path.join(ROOT, 'config/owner-commitments.json')))
    items, fs = S.validate(led)
    check('the committed ledger validates', fs == [], [f['line'] for f in fs][:5])
    check('the committed ledger is not trivially small', len(items) >= 30, len(items))
    check('the ledger has open items to watch', sum(1 for i in items if i['state'] == 'open') >= 5)
    reg = json.load(open(os.path.join(ROOT, 'config/monitors.json')))['monitors']
    check('every monitor has an id and a host', all(r.get('id') and r.get('host') in ('31', 'mac') for r in reg))
    check('the registry registers stallcheck itself', any(r.get('cron') == 'host/stallcheck.py run' for r in reg))


# ------------------------------------------------------------------------------------------------------------ mutants --
MUTANTS = [
    ('L open without next_step', "if st == 'open' and not i.get('next_step'):", "if False:"),
    ('a quiet limit', "if start and h > q:", "if start and h > q * 1000:"),
    ('b dependency met, not moved', "if h > DEP_GRACE_H and (t_ev is None or t_ev < t_sat):", "if False:"),
    ('b missing cron trigger', "if d['cron'] not in crontab:", "if False:"),
    ('c no live variant', "if not live[run]:", "if False:"),
    ('d approved branch age', "if h > BRANCH_GRACE_H:", "if False:"),
    ('d queued under another name', " or b.get('approve_sha') in reached:", ":"),
    ('e lane runnable', "if any(runnable(e, entries, fleet) for e in mine):", "if True:"),
    ('f unshipped feature', "if h > UNSHIPPED_D * 24 and feat not in suppress:", "if False:"),
    ('f promotion not on main', "if not on_main and h > PROMO_GRACE_H:", "if False:"),
    ('g unowned STUCK', "if h <= STUCK_OWNER_H or any(fnmatch.fnmatch(key, p) for p in pats):", "if True:"),
    ('h no consumer', "if (r.get('kind') or 'monitor') == 'monitor' and not (r.get('consumer') or '').strip():", "if False:"),
    ('h unregistered cron', "if not any(r.get('cron') and r['cron'] in line for r in regs):", "if False:"),
    ('h stale output', "if h > float(fresh):", "if False:"),
    ('m memory with no row', "if name.startswith('owner-') and name.endswith('.md') and name not in named and name not in no_row:",
     "if False:"),
    ('header input errors', "    if input_errors:\n        al['inputs']", "    if False:\n        al['inputs']"),
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
    base = run_unit(S)
    FAILS.extend(base)
    for t in (t_end_to_end, t_wiring, t_committed_config):
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
    print(f'stallcheck tests: {len(TESTS)} unit groups + e2e + wiring + config; mutants killed {killed}/{len(MUTANTS)}; '
          f'{"FAIL" if FAILS else "PASS"} ({len(FAILS)} failure(s))')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
