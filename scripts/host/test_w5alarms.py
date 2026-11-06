#!/usr/bin/env python3
"""Behaviour tests for the W5 alarms: goalwatch, haltwatch, rollout (ledger + 60-min check), driftwatch, lib/alarm and
lib/alarmhead. Synthetic inputs shaped the way the hosts write them; no network, no ES, no systemd.

    python3 scripts/host/test_w5alarms.py        (exit 1 on any failure)

Bottom: MUTANTS. Each changes one decision in the source; the test that pins it must then fail. Every mutant asserts its
anchor is present exactly once (CLAUDE.md: a mutant that silently fails to apply reads as "killed").
"""
import datetime as dt
import gzip
import importlib.util
import io
import json
import os
import sys
import tempfile
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
UTC = dt.timezone.utc
T = dt.datetime(2026, 10, 28, 12, 0, tzinfo=UTC)
FAILS = []


def load(name, src_text=None):
    path = os.path.join(HERE if not name.startswith('lib/') else os.path.join(HERE, '..'), name if name.startswith('lib/') else name)
    if src_text is not None:
        fd, path2 = tempfile.mkstemp(suffix='.py', dir=os.path.dirname(path))
        os.write(fd, src_text.encode()); os.close(fd)
        path = path2
    spec = importlib.util.spec_from_file_location('m_%d' % id(path) + os.path.basename(path)[:-3], path)
    m = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(m)
    finally:
        if src_text is not None:
            os.unlink(path)
    return m


def check(name, cond, detail=''):
    if not cond:
        FAILS.append(f'{name} {detail}')


# ------------------------------------------------------------------------------------------------ lib/alarm
def t_alarm(AL):
    ev, st = AL.plan_pushes({}, {'k': 'line'}, T)
    check('alarm NEW', ev == [('NEW', 'k', 'line')], ev)
    ev2, st2 = AL.plan_pushes(st, {'k': 'line2'}, T + dt.timedelta(hours=1))
    check('alarm quiet inside repush', ev2 == [], ev2)
    ev3, st3 = AL.plan_pushes(st2, {'k': 'line3'}, T + dt.timedelta(hours=6))
    check('alarm STILL at repush', ev3 == [('STILL', 'k', 'line3')], ev3)
    ev4, st4 = AL.plan_pushes(st3, {}, T + dt.timedelta(hours=7))
    check('alarm CLEARED', ev4 == [('CLEARED', 'k', 'line3')] and st4 == {}, ev4)
    with tempfile.TemporaryDirectory() as d:
        check('push channel absent', AL.push_channel(os.path.join(d, 'nope'))[0] is False)
        p = os.path.join(d, 'c'); open(p, 'w').write('ALERT_WEBHOOK=https://ntfy.sh/x\n')
        ok, desc = AL.push_channel(p)
        check('push channel ntfy', ok and 'ntfy' in desc and 'ntfy.sh/x' not in desc, desc)
        open(p, 'w').write('# nothing\nALERT_WEBHOOK=\n')
        check('push channel empty conf', AL.push_channel(p)[0] is False)
        evs = AL.raise_alarms('t', {'a': 'x'}, T, os.path.join(d, 's.json'), log_path=os.path.join(d, 'A.log'), push=False)
        check('raise logs NEW', evs and 'NEW' in open(os.path.join(d, 'A.log')).read())


# ------------------------------------------------------------------------------------------------ goalwatch
def R(t, name, detail, status='success', pool='showcase', bot='showcase-Alpha'):
    return {'t': t, 'name': name, 'status': status, 'detail': detail, 'pool': pool, 'bot': bot}


def t_goal(G):
    m = lambda k: T - dt.timedelta(minutes=k)
    rows = [R(m(200), '_build', 'project=shop op=place seg=ring cell=1,2,3 block=stone_bricks'),
            R(m(190), '_build_visit', 'project=shop outcome=no_material stop=no_material placed=0 why=wall-F'),
            R(m(100), '_build_visit', 'project=shop outcome=blocked stop=blocked placed=0 why=wall_for_wall-F'),
            R(m(90), '_build', 'project=shop op=replant_skipped cell=5,70,5 why=no_cell result=accepted'),
            R(m(80), '_build_seg', 'project=shop seg=wall-F open=12 done=0')]
    f = G.summarize_rows(rows)[('showcase', 'shop')]
    check('goal last progress is the place row', f['last_progress'] == m(200), f['last_progress'])
    check('goal replant_skipped is not progress', not G.row_progress('_build', 'success', G.kv(rows[3]['detail'])))
    check('goal failed place is not progress', not G.row_progress('_build', 'failure', {'op': 'place'}))
    check('goal visit placed>0 is progress', G.row_progress('_build_visit', 'no_effect', {'placed': '1'}))
    check('goal visit placed=0 is not', not G.row_progress('_build_visit', 'success', {'placed': '0', 'cleared': '0'}))
    check('goal outcomes since progress', dict(f['outcomes_since_progress']) == {'no_material/no_material': 1, 'blocked/blocked': 1},
          f['outcomes_since_progress'])
    base = {'pool': 'showcase', 'home': '0_70_0', 'plot': 'shop', 'created_at': T - dt.timedelta(days=2),
            'progress_times': [None], 'row_facts': f, 'window': G.WINDOW, 'units': (10, 10), 'rows_in_window': 5}
    line = G.judge(base, T)
    check('goal STUCK at 3.3 h names the blocker', line and 'STUCK 3.3 h' in line and 'why=wall_for_wall-F' in line
          and 'blocked/blocked x1' in line and 'running 10/10' in line, line)
    check('goal not stuck at 2.9 h', G.judge(dict(base, progress_times=[m(175)]), T) is None)
    check('goal progress.json counts', G.judge(dict(base, progress_times=[m(10)]), T) is None)
    check('goal young project not stuck', G.judge(dict(base, created_at=m(60), row_facts=None), T) is None)
    l2 = G.judge(dict(base, row_facts=None, rows_in_window=0, units=(0, 10), stop='last stop-bots x: tripwire'), T)
    check('goal no rows -> bots not running', l2 and 'NO skill rows' in l2 and 'running 0/10' in l2 and 'tripwire' in l2, l2)
    # collect() end to end on files: a record, its progress file, a skill log
    with tempfile.TemporaryDirectory() as d:
        pool = os.path.join(d, 'lib', '_pool-showcase'); os.makedirs(pool)
        logs = os.path.join(d, 'log', 'showcase-Alpha'); os.makedirs(logs)
        ms = lambda t: int(t.timestamp() * 1000)
        json.dump({'state': 'open', 'structure_complete': False, 'at': ms(T - dt.timedelta(days=2))},
                  open(os.path.join(pool, 'project-0_70_0.shop.g1.json'), 'w'))
        json.dump({'state': 'open', 'structure_complete': False, 'at': ms(T - dt.timedelta(days=1))},
                  open(os.path.join(pool, 'project-0_70_0.shop.g2.json'), 'w'))
        json.dump({'at': ms(m(250)), 'why': 'placed'}, open(os.path.join(pool, 'project-0_70_0.shop.progress.json'), 'w'))
        json.dump({'at': ms(T), 'state': 'complete', 'structure_complete': True},
                  open(os.path.join(pool, 'project-0_70_0.well.g1.json'), 'w'))
        with open(os.path.join(logs, 'skill-showcase-Alpha.jsonl'), 'w') as fh:
            for k, (nm, det) in enumerate([('_build_visit', 'project=shop outcome=blocked stop=blocked placed=0 why=wall-F'),
                                            ('gather', 'oak_log')]):
                fh.write(json.dumps({'@timestamp': (m(30 - k)).isoformat().replace('+00:00', 'Z'), 'exp': {'pool': 'showcase'},
                                     'bot': {'name': 'showcase-Alpha'}, 'skill': {'name': nm, 'status': 'no_effect',
                                                                                   'detail': det}}) + '\n')
        rep = G.collect(os.path.join(d, 'lib'), os.path.join(d, 'log'), T)
        check('collect: 2 records, 1 open', rep['records_scanned'] == 2 and rep['open'] == 1, rep)
        al = list(rep['alarms'].values())
        check('collect: stuck from progress.json, blocker from the log', len(al) == 1 and 'STUCK 4.2 h' in al[0]
              and 'why=wall-F' in al[0] and rep['rows_walked'] == 2, al)
        json.dump({'at': ms(m(5)), 'why': 'placed'}, open(os.path.join(pool, 'project-0_70_0.shop.progress.json'), 'w'))
        rep = G.collect(os.path.join(d, 'lib'), os.path.join(d, 'log'), T)
        check('collect: fresh progress clears', not rep['alarms'], rep['alarms'])


# ------------------------------------------------------------------------------------------------ haltwatch
def t_halt(H):
    up = {f'mcshow@showcase-{b}.service': 'active' for b in 'ABCDEFGHIJ'}
    down = {k: 'inactive' for k in up}
    stop = {'t': '2026-10-28T11:30:00Z', 'event': 'stop-bots', 'why': 'tripwire: VERDICT      TRIP -- S6 H2 clear_outside 1'}
    line, _ = H.judge_showcase([stop], down, T)
    check('halt: tripwire stop 30 min, units down -> alarm with reason', line and 'TRIPWIRE' in line
          and 'S6 H2 clear_outside 1' in line and '0/10' in line, line)
    line, s = H.judge_showcase([dict(stop, t='2026-10-28T11:56:00Z')], down, T)
    check('halt: a tripwire stop with no remedy row yet: inside the 5-min grace -> no alarm', line is None and '5-min grace' in s, s)
    line, s = H.judge_showcase([dict(stop, t='2026-10-28T11:50:00Z', why='operator: x')], down, T)
    check('halt: a deliberate stop inside the 15-min grace -> no alarm', line is None and '15-min grace' in s, s)
    check('halt: units back up -> no alarm', H.judge_showcase([stop], up, T)[0] is None)
    act = {'t': '2026-10-28T11:40:00Z', 'event': 'activated', 'running_bots': 10}
    line, _ = H.judge_showcase([stop, act], down, T)
    check('halt: an activation that restarted running bots after the stop supersedes it; down units still alarm',
          line and 'NO stop-bots row' in line, line)
    line, _ = H.judge_showcase([stop, dict(act, running_bots=0)], down, T)
    check('halt: an activation with no bot running is not a start -- the stop stays open', line and 'HALTED' in line, line)
    line, _ = H.judge_showcase([stop, dict(act, cause='auto-rollback', running_bots=3)], down, T)
    check('halt: an auto-rollback activation never clears its stop (its start-verified does)', line and 'HALTED' in line, line)
    check('halt: census unreadable is an alarm', H.judge_showcase([], None, T)[0])
    # phase 1 item 4: the stop row is read FIRST -- disable --now unloads the units, so an empty census during a stop is the stop
    line, _ = H.judge_showcase([stop], {}, T)
    check('halt: tripwire stop + 0 units listed -> HALTED with the reason, never "census is wrong"', line and 'HALTED' in line
          and 'S6 H2 clear_outside 1' in line and 'census is wrong' not in line and 'NO mcshow' not in line, line)
    line, _ = H.judge_showcase([stop], None, T)
    check('halt: tripwire stop + census unreadable -> HALTED, census named', line and 'HALTED' in line and 'UNREADABLE' in line, line)
    check('halt: no stop and 0 units -> the no-units alarm', 'NO mcshow@ units' in (H.judge_showcase([], {}, T)[0] or ''))
    ver = {'t': '2026-10-28T11:45:00Z', 'event': 'start-verified', 'release': 'r1'}
    req = {'t': '2026-10-28T11:44:00Z', 'event': 'start-requested'}
    check('halt: a planned restart (start-verified after the stop) clears it', H.judge_showcase([stop, req, ver], up, T)[0] is None)
    half = dict(up, **{'mcshow@showcase-A.service': 'inactive'})
    line, _ = H.judge_showcase([stop, req, ver], half, T)
    check('halt: after a verified start a down unit is a crash again (not the old stop)', line and 'NO stop-bots row' in line, line)
    line, _ = H.judge_showcase([stop, req, {'t': '2026-10-28T11:46:00Z', 'event': 'start-failed', 'why': 'gate failed'}], down, T)
    check('halt: start-requested / start-failed do not clear a stop', line and 'HALTED' in line, line)
    stop2 = dict(stop, t='2026-10-28T11:47:00Z')
    line, _ = H.judge_showcase([stop, ver, stop2], down, T)
    check('halt: a stop after the start wins', line and 'HALTED' in line and '11:47Z' in line, line)
    check('halt: the legacy start-bots-after-restart rc 0 clears too',
          H.judge_showcase([stop, {'t': '2026-10-28T11:45:00Z', 'event': 'start-bots-after-restart', 'rc': 0}], up, T)[0] is None)
    tstop = dict(stop, t='2026-10-28T11:58:00Z')
    rem0 = {'t': '2026-10-28T11:58:30Z', 'event': 'trip-remedy', 'plan': {'action': 'stop', 'why': 'activated 9 h ago'}}
    line, _ = H.judge_showcase([tstop, rem0], down, T)
    check('halt: a TRIPWIRE stop whose remedy is a plain stop pages at once', line and 'HALTED' in line and 'remedy: stop' in line, line)
    rem = {'t': '2026-10-28T11:58:30Z', 'event': 'trip-remedy', 'plan': {'action': 'rollback-restart', 'why': 'activated 40 min before'}}
    line, s = H.judge_showcase([tstop, rem], down, T)
    check('halt: a tripwire stop being rolled back + restarted gets 30 min to verify', line is None and '30-min grace' in s, s)
    rem2 = dict(rem, plan={'action': 'rollback-stopped', 'why': 'world damage S4'})
    line, _ = H.judge_showcase([tstop, rem2], down, T)
    check('halt: rollback-stopped pages at once and names the remedy', line and 'rollback-stopped' in line and 'world damage' in line, line)
    dstop = {'t': '2026-10-28T11:58:00Z', 'event': 'stop-bots', 'why': 'operator: visuals restart'}
    check('halt: a deliberate stop keeps its 15-min grace', H.judge_showcase([dstop], down, T)[0] is None)
    q = {'t': '2026-10-28T11:50:00Z', 'event': 'quarantine', 'bots': ['showcase-A'], 'why': 'S3 Z1'}
    line, s = H.judge_showcase([ver, q], half, T)
    check('halt: a quarantined (Z1) unit down is expected, not a crash', line is None and 'quarantined' in s, (line, s))
    half2 = dict(half, **{'mcshow@showcase-B.service': 'failed'})
    line, _ = H.judge_showcase([ver, q], half2, T)
    check('halt: a down unit beside the quarantined one still alarms (only B named)', line and 'showcase-B' in line and 'showcase-A' not in line, line)
    # remedy events: paged once each; the first run starts at the end
    rows = [q, {'t': '2026-10-28T11:55:00Z', 'event': 'auto-rollback', 'from': 'r2', 'to': 'r1', 'classes': ['S1'], 'restart': True, 'rc': 0, 'why': 'x'}]
    ev, cur = H.showcase_events(rows, None)
    check('events: the first run pages nothing and starts at the end', ev == [] and cur == {'t': '2026-10-28T11:55:00Z', 'n': 1}, (ev, cur))
    rows2 = rows + [{'t': '2026-10-28T11:55:00Z', 'event': 'auto-rollback-start', 'release': 'r1', 'rc': 0},
                    {'t': '2026-10-28T11:59:00Z', 'event': 'stop-bots', 'why': 'x'}]
    ev, cur2 = H.showcase_events(rows2, cur)
    check('events: a new row at the SAME second as the cursor is paged once; other kinds are not events',
          [k for k, _ in ev] == ['auto-rollback-start:2026-10-28T11:55:00Z'] and 'VERIFIED' in ev[0][1] and cur2['n'] == 2, (ev, cur2))
    check('events: nothing new -> nothing paged', H.showcase_events(rows2, cur2)[0] == [])
    ev, _ = H.showcase_events(rows, {'t': '2026-10-28T11:00:00Z', 'n': 1})
    check('events: quarantine + rollback each one line', [k.split(':')[0] for k, _ in ev] == ['quarantine', 'auto-rollback']
          and 'restarting' in ev[1][1] and 'showcase-A' in ev[0][1], ev)
    # REPORT pages from trip-last.json
    trip = {'t': '2026-10-28T11:35:00Z', 'verdict': 'REPORT', 'reports': ['S6 H1 off_record 119', 'S5 G3 lid_unreach 5',
            "S3 Z1 trapped in a zone {'a': 1} -> QUARANTINE a"], 'new_items': {'H1 off_record': ['b 1,2,3 x'] * 5, 'G3 lid_unreach': ['lid']}}
    rp = H.showcase_reports(trip, T, False, {})
    check('reports: one tier-1 key per REPORT gate with its items; Z1 is paged by its event', sorted(rp) == ['report:S5 G3', 'report:S6 H1']
          and 'no stop' in rp['report:S6 H1'] and '+2' in rp['report:S6 H1'] and "['lid']" in rp['report:S5 G3'], rp)
    check('reports: a WATCH/OK read pages nothing', H.showcase_reports(dict(trip, reports=[]), T, False, {}) == {})
    old = dict(trip, t='2026-10-28T09:30:00Z')
    st = H.showcase_reports(old, T, False, {'report:S6 H1': 'x'})
    check('reports: a stale read keeps the open keys (no false CLEARED) and pages trip:stale', st.get('report:S6 H1') == 'x' and 'trip:stale' in st, st)
    check('reports: a stale read during a stop is by design (no trip:stale)', 'trip:stale' not in H.showcase_reports(old, T, True, {}))
    check('reports: tier 1 (source showtrip pages)', H.AL.tier_of('showtrip', 'report:S6 H1') == H.AL.TIER_PAGE)
    fu = {f'mcbot@b{i}.service': 'active' for i in range(80)}
    fu['mcbot@b0.service'] = 'failed'
    check('fleet: one failed unit is no halt', H.judge_fleet([], fu, T)[0] is None)
    inc = {'at': T - dt.timedelta(minutes=20), 'trips': [['b1', '2 fall deaths in 30m']], 'stopped': ['b1'], 'dry_run': False}
    fu2 = dict(fu, **{'mcbot@b1.service': 'inactive'})
    line, _ = H.judge_fleet([inc], fu2, T)
    check('fleet: tripper stop still down after 15 min -> alarm with trips', line and '2 fall deaths' in line, line)
    fu3 = dict(fu, **{'mcbot@scout.service': 'active'})
    check('fleet: incident names a BOT, resolved to its unit', H.judge_fleet([dict(inc, stopped=['Scout01'])], fu3, T,
                                                                           unit_of={'Scout01': 'scout'})[0] is None)
    check('fleet: dry-run incident ignored', H.judge_fleet([dict(inc, dry_run=True)], fu2, T)[0] is None)
    half = {k: ('inactive' if i < 41 else 'active') for i, k in enumerate(sorted(fu))}
    check('fleet: under half running -> halt', 'only 39/80' in (H.judge_fleet([], half, T)[0] or ''))
    # 11-02: the slot push (a blocked head held the free slot 2.5 h; the header saw it, nothing pushed it)
    check('slot: a plain slot line pushes nothing', H.slot_alarm('canary slot: free 30 min, nothing runnable yet (x)') == {})
    check('slot: IDLE line -> one stable key', H.slot_alarm('!! canary slot IDLE 95 min (since x) ...') ==
          {'slot:idle': 'canary slot IDLE 95 min (since x) ...'})
    check('slot: scheduler silence -> its own key', list(H.slot_alarm('!! canary scheduler: last tick x')) == ['slot:scheduler'])
    with tempfile.TemporaryDirectory() as d:
        now = dt.datetime.now(UTC).replace(microsecond=0)
        tk = lambda m, dec, why: f"{H.AL._iso(now - dt.timedelta(minutes=m))} {dec}: {why}"
        why = ('H2 cooldown15-01: no variant for the fleet base c711879 (have: dfb3ff1): autorebase REFUSED at step lint: '
               'npm test: fail alone on the new tip and NOT on the base: gather-reach.test.mjs')
        log = os.path.join(d, 'sched.log')
        open(log, 'w').write('\n'.join([tk(160, 'BUSY', 'S2 running: canary-loop.sh')] +
                                       [tk(m, 'BLOCK', why) for m in range(150, -1, -5)]) + '\n')
        args = ['--label', 'fleet', '--state-dir', d, '--no-push', '--sched-log', log, '--incidents', d,
                '--manifest', os.path.join(d, 'none.json')]
        with contextlib.redirect_stdout(io.StringIO()) as o1:
            H.main(args)
        alog = open(os.path.join(d, 'ALARMS.log')).read() if os.path.exists(os.path.join(d, 'ALARMS.log')) else ''
        check('slot push: a head BLOCKED 150 min is a NEW slotwatch alarm keyed by cause',
              'NEW     slotwatch slot:nodeploy:block:H2-refused' in alog and 'cooldown15-01' in alog, alog)
        ps = json.load(open(os.path.join(d, 'slotwatch.pushstate.json')))
        check('slot push: its own push state', list(ps) == ['slot:nodeploy:block:H2-refused'], ps)
        hw = json.load(open(os.path.join(d, 'haltwatch-fleet.json')))
        check('slot push: kept out of the haltwatch header state', not any('slot' in k for k in hw.get('alarms') or {}), hw)
        with contextlib.redirect_stdout(io.StringIO()):
            H.main(args)
        alog2 = open(os.path.join(d, 'ALARMS.log')).read()
        check('slot push: deduplicated (no second NEW)', alog2.count('slotwatch slot:nodeploy') == 1, alog2)
        open(log, 'a').write(tk(0, 'BUSY', 'S1 canary declared: abc on hive-c') + '\n')
        with contextlib.redirect_stdout(io.StringIO()):
            H.main(args)
        check('slot push: a deployed canary clears it', 'CLEARED slotwatch slot:nodeploy:block:H2-refused'
              in open(os.path.join(d, 'ALARMS.log')).read())


# ------------------------------------------------------------------------------------------------ rollout
def t_rollout(RO):
    j = [{'ts': '2026-10-28T10:00:00Z', 'run': 'tidy-01', 'phase': 'owner-direct', 'sha': 'abcdef12', 'prev': '1234567a',
          'tier': 1, 'reviewer': 'codex', 'note': 'x'},
         {'ts': '2026-10-17T12:25:10Z', 'run': 'plinth-02', 'phase': 'owner-direct', 'note': 'legacy'},
         {'ts': '2026-10-28T09:00:00Z', 'run': 'other', 'phase': 'read-180', 'note': ''}]
    L = RO.fleet_ledger(j)
    check('ledger: two owner-direct rows', [r['id'] for r in L] == ['tidy-01', 'plinth-02'], L)
    check('ledger: legacy has no check due', [r['id'] for r in RO.due(L, T)] == ['tidy-01'])
    j.append({'ts': '2026-10-28T11:10:00Z', 'run': 'tidy-01', 'phase': 'owner-direct-check', 'of_ts': '2026-10-28T10:00:00Z',
              'verdict': 'PASS', 'note': 'PASS'})
    L = RO.fleet_ledger(j)
    check('ledger: check joins; nothing due', L[0]['check'] and RO.due(L, T) == [], L[0])
    check('ledger: not due before 60 min', RO.due(RO.fleet_ledger(j[:1]), dt.datetime(2026, 10, 28, 10, 59, tzinfo=UTC)) == [])
    check('ledger: not due past the 24 h horizon', RO.due(RO.fleet_ledger(j[:1]), T + dt.timedelta(days=2)) == [])
    d = [{'t': '2026-10-28T08:12:08Z', 'event': 'staged', 'release': 'fc300013-6dd0ded8-fdd64ead', 'sha': 'fc3000135752',
          'prev': '78975c36', 'piece': ['fell-01'], 'why': 'piece stack fell-01'},
         {'t': '2026-10-28T08:12:12Z', 'event': 'activated', 'release': 'fc300013-6dd0ded8-fdd64ead',
          'previous': '78975c36-6dd0ded8-fdd64ead', 'running_bots': 10},
         {'t': '2026-10-28T08:20:00Z', 'event': 'rollout', 'release': 'fc300013-6dd0ded8-fdd64ead', 'tier': 1, 'reviewer': 'claude'}]
    S = RO.showcase_ledger(d)
    check('showcase ledger joins staged + annotation', len(S) == 1 and S[0]['sha'] == 'fc3000135752' and S[0]['prev'] == '78975c36'
          and S[0]['reviewer'] == 'claude', S)
    d2 = d + [{'t': '2026-10-28T08:40:00Z', 'event': 'staged', 'release': 'aa11bb22-6dd0ded8-fdd64ead', 'sha': 'aa11bb22cc',
                'staged_at': '2026-10-28T08:40:00Z'},
               {'t': '2026-10-28T08:40:15Z', 'event': 'activated', 'release': 'aa11bb22-6dd0ded8-fdd64ead', 'running_bots': 10},
               {'t': '2026-10-28T11:00:00Z', 'event': 'activated', 'release': 'cc33dd44-6dd0ded8-fdd64ead', 'running_bots': 10}]
    S2 = RO.showcase_ledger(d2)
    check('showcase: a release replaced inside its hour is cut at the next staged time',
          S2[0].get('superseded_by') == 'aa11bb22-6dd0ded8-fdd64ead'
          and S2[0].get('until') == dt.datetime(2026, 10, 28, 8, 40, tzinfo=UTC), S2[0])
    check('showcase: a release replaced after its hour keeps the full window',
          'until' not in S2[1] and 'until' not in S2[2], S2[1:])
    check('same_sha', RO.same_sha('fc3000135752c9671a', 'fc300013') and not RO.same_sha('fc30001', 'fc30002')
          and not RO.same_sha('fc30', 'fc30'))
    ok = {'tripper': {'verdict': 'OK'}, 'bot_hours': 79.0, 'deaths': 1, 'baseline_rate': 0.05, 'bots_present': 80, 'bots_on_sha': 80}
    check('verdict PASS', RO.verdict(ok)[0] == 'PASS', RO.verdict(ok))
    check('verdict TRIP -> FAIL', RO.verdict(dict(ok, tripper={'verdict': 'TRIP', 'trips': ['x']}))[0] == 'FAIL')
    check('verdict crash loop -> FAIL', RO.verdict(dict(ok, crash_loops={'mcbot@a': 4}))[0] == 'FAIL')
    check('verdict failed after t0 -> FAIL', RO.verdict(dict(ok, failed_after=['mcbot@a']))[0] == 'FAIL')
    mu = 0.05 * 79   # 3.95 expected
    hi = RO.poisson_upper(mu, 0.995)
    check('poisson bound sane', 9 <= hi <= 10, hi)
    check('verdict deaths over 99.5 % -> FAIL', RO.verdict(dict(ok, deaths=hi + 1))[0] == 'FAIL')
    check('verdict deaths at 99.5 % bound -> not FAIL', RO.verdict(dict(ok, deaths=hi))[0] != 'FAIL')
    check('verdict one death on a zero baseline -> PASS (two-death floor)', RO.verdict(dict(ok, deaths=1, baseline_rate=0.0))[0] == 'PASS')
    check('verdict no bot-hours -> WATCH', RO.verdict(dict(ok, bot_hours=0))[0] == 'WATCH')
    check('verdict sha not converged -> WATCH', RO.verdict(dict(ok, bots_on_sha=70, bots_off_sha=['a']))[0] == 'WATCH')
    check('verdict tripper unread -> WATCH', RO.verdict(dict(ok, tripper={'verdict': 'UNREAD'}))[0] == 'WATCH')
    jl = [json.dumps({'UNIT': 'mcbot@a.service', 'MESSAGE': 'mcbot@a.service: Scheduled restart job, restart counter is at 3.'})] * 3 + \
         [json.dumps({'UNIT': 'mcbot@b.service', 'MESSAGE': 'Started mcbot@b.service'}),
          json.dumps({'UNIT': 'ssh.service', 'MESSAGE': 'Scheduled restart job'}), 'not json']
    check('restart counts by unit, other units ignored', RO.restart_counts(jl, 'mcbot@') == ({'mcbot@a.service': 3}, 4),
          RO.restart_counts(jl, 'mcbot@'))
    log = ('===== 2026-10-28T09:35:06Z rc=0\nSHOWCASE TRIPWIRE x\nVERDICT      OK\n'
           '===== 2026-10-28T12:35:06Z rc=2\nVERDICT      TRIP -- S6 H2 clear_outside 1\n   stopped showcase-Alpha\n')
    runs = RO.parse_trip_log(log)
    check('trip.log parse', [(r[1], r[2]) for r in runs] == [('OK', ''), ('TRIP', 'S6 H2 clear_outside 1')], runs)
    t0 = dt.datetime(2026, 10, 28, 8, 12, tzinfo=UTC)
    check('trip window OK', RO.trip_in_window(runs, t0, t0 + dt.timedelta(hours=1))['verdict'] == 'OK')
    t0b = dt.datetime(2026, 10, 28, 11, 30, tzinfo=UTC)
    check('trip window TRIP', RO.trip_in_window(runs, t0b, t0b + dt.timedelta(hours=1))['verdict'] == 'TRIP')
    check('trip window superseded: no slack (a later TRIP is the successor\'s)',
          RO.trip_in_window(runs, t0b, t0b + dt.timedelta(minutes=30), superseded=True)['verdict'] == 'SKIP')
    check('trip window superseded, TRIP inside its life -> TRIP',
          RO.trip_in_window(runs, t0b, t0b + dt.timedelta(minutes=70), superseded=True)['verdict'] == 'TRIP')
    check('verdict tripper SKIP -> not WATCH', RO.verdict(dict(ok, tripper={'verdict': 'SKIP'}))[0] == 'PASS')
    check('trip window none -> UNREAD', RO.trip_in_window(runs, T + dt.timedelta(hours=3), T + dt.timedelta(hours=4))['verdict'] == 'UNREAD')
    rows = [{'t': t0 + dt.timedelta(minutes=k), 'name': '_death' if k == 5 else 'gather', 'bot': {'name': f'b{k % 2}'},
             'raw': {'code': {'version': ('abcdef1234+x' if k % 2 else '99999999+x')}}} for k in range(60)]
    f = RO.window_facts(rows, 'abcdef12', start=t0)
    check('window facts', f['deaths'] == 1 and f['bots_present'] == 2 and f['bots_on_sha'] == 1 and f['bot_hours'] == 2.0, f)


# ------------------------------------------------------------------------------------------------ driftwatch
def t_drift(D):
    hist = [{'items_per_bot_h': 50, 'value_per_bot_h': 8.0, 'deaths_per_bot_h': 0.02} for _ in range(7)]
    day = {'items_per_bot_h': 30, 'value_per_bot_h': 8.4, 'deaths_per_bot_h': 0.02, 'deaths': 38, 'bot_hours': 1920}
    r = D.drift(day, hist)
    check('drift items -40 % alarms', r['items_per_bot_h']['alarm'] and round(r['items_per_bot_h']['change'], 2) == -0.4)
    check('drift value +5 % quiet', not r['value_per_bot_h']['alarm'])
    check('drift needs MIN_DAYS', not D.drift(day, hist[:4])['items_per_bot_h']['alarm'])
    small = {'items_per_bot_h': 50, 'value_per_bot_h': 8, 'deaths_per_bot_h': 0.028, 'deaths': 14, 'bot_hours': 500}
    r = D.drift(small, hist)
    check('drift deaths +40 % inside Poisson -> no alarm', not r['deaths_per_bot_h']['alarm'] and 'inside' in r['deaths_per_bot_h']['note'],
          r['deaths_per_bot_h'])
    big = {'items_per_bot_h': 50, 'value_per_bot_h': 8, 'deaths_per_bot_h': 0.0125, 'deaths': 24, 'bot_hours': 1920}
    r = D.drift(big, hist)
    check('drift deaths -37 % outside Poisson -> alarm', r['deaths_per_bot_h']['alarm'], r['deaths_per_bot_h'])
    text, al = D.lines('2026-10-27', dict(big, units=94851), r, ['2026-10-20', '2026-10-26'])
    z = D.drift(dict(big, deaths_per_bot_h=0.01), [dict(h, deaths_per_bot_h=0.0) for h in hist])
    _, alz = D.lines('2026-10-27', dict(big, units=1), z, ['a', 'b'])
    check('drift zero median still emits the alarm', 'drift:deaths_per_bot_h' in alz, alz)
    check('drift line names denominators', '1,920 active bot-h' in text and '24 deaths' in text and 'drift:deaths_per_bot_h' in al, text)


# ------------------------------------------------------------------------------------------------ alarmhead
def t_head(AH):
    with tempfile.TemporaryDirectory() as d:
        now = T
        json.dump({'generated_at': '2026-10-28T11:55:00Z', 'alarms': {}, 'summary': 'fleet goals OK: 0 open'},
                  open(os.path.join(d, 'goalwatch-fleet.json'), 'w'))
        json.dump({'generated_at': '2026-10-28T10:00:00Z', 'alarms': {}, 'summary': 'x'},
                  open(os.path.join(d, 'haltwatch-fleet.json'), 'w'))
        json.dump({'generated_at': '2026-10-28T11:58:00Z', 'pending': ['a'],
                   'recent': ['... 60-min: PASS', '... 60-min: PENDING', '... 60-min: FAIL']},
                  open(os.path.join(d, 'rollout-fleet.json'), 'w'))
        out = AH.lines(now, None, state_dir=d, conf=os.path.join(d, 'none'), sched_log=os.path.join(d, 'none.log'))
        check('head: unreadable sched.log is an alarm', any(l.startswith('!! canary slot: sched.log UNREADABLE') for l in out), out)
        def tk(mins_ago, dec, why='H1 townfloor-01: held: x'):
            return f"{AH.AL._iso(now - dt.timedelta(minutes=mins_ago))} {dec}: {why}"
        busy = [tk(m, 'BUSY', 'S1 canary declared') for m in (200, 195, 190)]
        idle_ticks = [tk(m, 'BLOCK') for m in range(185, -1, -5)]
        log = '\n'.join(busy[:1] + [tk(199, 'note', 'enabled but inactive')] + busy[1:] + idle_ticks) + '\n'
        ticks = AH.parse_ticks(log)
        check('slot: notes skipped, ticks parsed', len(ticks) == 3 + len(idle_ticks), len(ticks))
        l1 = AH.slot_idle(ticks, now)
        check('slot: idle 185 min after BUSY alarms', l1.startswith('!! canary slot IDLE 185 min') and 'townfloor-01' in l1, l1)
        l2 = AH.slot_idle(AH.parse_ticks('\n'.join(busy + [tk(m, 'WAIT') for m in (30, 25, 0)])), now)
        check('slot: free 30 min is not an alarm', not l2.startswith('!!') and 'free 30 min' in l2, l2)
        l3 = AH.slot_idle(AH.parse_ticks('\n'.join(idle_ticks)), now)
        check('slot: a streak older than the tail reads >=', l3.startswith('!! canary slot IDLE >= 185 min'), l3)
        l4 = AH.slot_idle(AH.parse_ticks('\n'.join(idle_ticks[:-10] + [tk(40, 'LAUNCH', 'x')] + [tk(m, 'BUSY', 'S7 live') for m in (35, 5)])), now)
        check('slot: launched then busy is not idle', l4.startswith('canary slot: busy'), l4)
        l5 = AH.slot_idle(AH.parse_ticks('\n'.join(busy)), now)
        check('slot: no tick for 190 min is a scheduler alarm', l5.startswith('!! canary scheduler: last tick'), l5)
        l6 = AH.slot_idle(AH.parse_ticks('\n'.join(busy + [tk(m, 'BLOCK', 'S8 SCHED-PAUSE present | S1 canary declared: abc on x')
                                                             for m in range(120, -1, -5)])), now)
        check('slot: BLOCK with a declared canary is occupied, not idle', not l6.startswith('!!') and 'occupied' in l6, l6)
        l8 = AH.slot_idle(AH.parse_ticks('\n'.join(busy + [tk(m, 'BLOCK', 'S8 SCHED-PAUSE present | S8 INSTALL-HOLD by x until '
                                                             '2026-10-29T00:00:00Z') for m in range(120, -1, -5)])), now)
        check('slot: BLOCK with a live install-hold is occupied', not l8.startswith('!!'), l8)
        l9 = AH.slot_idle(AH.parse_ticks('\n'.join(busy + [tk(m, 'BLOCK', 'S8 INSTALL-HOLD by x until 2026-10-27T00:00:00Z -- '
                                                             'STALE: the installer must release it') for m in range(120, -1, -5)])), now)
        check('slot: a STALE install-hold is idle (alarm)', l9.startswith('!! canary slot IDLE 120 min'), l9)
        l7 = AH.slot_idle(AH.parse_ticks('\n'.join(busy + [tk(m, 'BLOCK') for m in range(120, 20, -5)]
                                                    + [tk(m, 'QUEUE', 'UNREADABLE x') for m in range(20, -1, -5)])), now)
        check('slot: non-decision lines are not ticks (scheduler alarm)', l7.startswith('!! canary scheduler: last tick'), l7)
        check('slot: no ticks is an alarm', AH.slot_idle([], now).startswith('!! canary slot: NO scheduler tick'))
        txt = '\n'.join(out)
        check('head: no channel is an alarm line', out[0].startswith('!! alarm push: NO CHANNEL'), out[0])
        check('head: fresh OK summary printed plain', 'fleet goals OK: 0 open' in out)
        check('head: stale halt state is an alarm', any(l.startswith('!! fleet halt: STALE') for l in out), txt)
        check('head: rollout FAIL flagged, PENDING not', sum(l.startswith('!! ') and '60-min' in l for l in out) == 1, txt)
        check('head: missing drift state is an alarm', any(l.startswith('!! daily drift: NO STATE') for l in out), txt)

        class C:
            def __init__(self, src): self.src = src
            def __call__(self, m, path, body):
                kind = json.dumps(body)
                for k, s in self.src.items():
                    if f'"{k}"' in kind:
                        return {'hits': {'hits': [{'_source': x} for x in s]}}
                return {'hits': {'hits': []}}
        es = AH.es_lines(now, C({'showcase_halt': [{'t': '2026-10-28T11:57:00Z', 'ok': False, 'why': 'SHOWCASE HALTED 0.4 h: x'}],
                                 'showcase_goal': [{'t': '2026-10-28T10:00:00Z', 'ok': True, 'why': 'y'}]}))
        es2 = AH.es_lines(now, C({'showcase_rollout': [{'t': '2026-10-28T11:50:00Z', 'ok': True, 'event': 'PASS', 'release': 'r1@t', 'why': 'r1: PASS'},
                                                        {'t': '2026-10-28T11:40:00Z', 'ok': False, 'event': 'ERROR', 'release': 'r1@t', 'why': 'r1: ERROR'}]}))
        check('head ES: a re-check supersedes the older row', not any('ERROR' in l for l in es2) and any('1 60-min check' in l for l in es2), es2)
        check('head ES: halt alarm shown', any(l.startswith('!! SHOWCASE HALTED') for l in es), es)
        check('head ES: stale goal row is an alarm', any(l.startswith('!! showcase goals: STALE') for l in es), es)


# ------------------------------------------------------------------------------------------------ owner-direct lane
def t_direct(RO):
    A, B = 'a' * 40, 'b' * 40
    ok = {'tier': 1, 'reviewer': 'codex', 'showcase_evidence': '', 'sha': B, 'prev': A, 'ancestor': True,
          'protected': 'not protected', 'slot': [], 'run': 'tidy-02'}
    check('direct: a clean tier-1 plan passes', RO.direct_plan(ok) == [], RO.direct_plan(ok))
    bad = lambda **k: RO.direct_plan(dict(ok, **k))
    check('direct: protected refuses', any('tier 3' in x for x in bad(protected='protected')))
    check('direct: tooling refuses', any('tooling' in x for x in bad(protected='tooling')))
    check('direct: undecidable refuses', any('could not classify' in x for x in bad(protected='unknown: rc 2')))
    check('direct: a busy slot refuses', any('not empty' in x for x in bad(slot=['S1 canary declared: x on y'])))
    check('direct: a divergent sha refuses', any('does not descend' in x for x in bad(ancestor=False)))
    check('direct: unknown ancestry refuses', any('could not be checked' in x for x in bad(ancestor=None)))
    check('direct: tier 2 needs showcase evidence', any('showcase first' in x for x in bad(tier=2)))
    check('direct: tier 2 with evidence passes', bad(tier=2, showcase_evidence='d4dc532c 2 h, goal moved') == [])
    check('direct: tier 3 refuses', any('tier must be 1 or 2' in x for x in bad(tier=3)))
    check('direct: no reviewer refuses', any('reviewer' in x for x in bad(reviewer=' ')))
    check('direct: a short sha refuses', any('full 40-hex' in x for x in bad(sha='bbbbbbb')))
    check('own reasons: our hold and our lock are not a busy slot', RO.own_reasons_removed(
        ['S8 INSTALL-HOLD by owner-direct:tidy-02 until x', 'S3 the loop lock is held (pid 77)', 'S1 canary declared: a on b',
         'S8 INSTALL-HOLD by owner-direct:other-01 until y', 'S3 the loop lock is held (pid 78)'], 'tidy-02', 77)
          == ['S1 canary declared: a on b', 'S8 INSTALL-HOLD by owner-direct:other-01 until y', 'S3 the loop lock is held (pid 78)'])
    check('protected class: not protected', RO.protected_class(0, 'not protected\n') == 'not protected')
    check('protected class: tooling', RO.protected_class(1, 'PROTECTED (tooling: two engines, no fleet canary):\n  x [tooling]\ntier=tooling\n') == 'tooling')
    check('protected class: tier 3', RO.protected_class(1, 'PROTECTED (tier 3):\n  bots/src/x\ntier=3\n') == 'protected')
    check('protected class: rc 2 is unknown', RO.protected_class(2, '', 'could not decide').startswith('unknown'))
    check('protected class: rc 0 with other text is unknown', RO.protected_class(0, 'garbage').startswith('unknown'))
    with tempfile.TemporaryDirectory() as d:
        sched = os.path.join(d, 'sched.py'); open(sched, 'w').write('import sys\nprint("INSTALL-HOLD ok")\nsys.exit(0)\n')
        dep = os.path.join(d, 'fleet-deploy')
        open(dep, 'w').write('#!/bin/bash\necho "$1 $2" >> %s/calls\n[ "$2" = "tidy-02-direct" ] && [ -e %s/good ] && echo VERIFIED\n'
                             '[ "$2" = "tidy-02-rollback" ] && echo VERIFIED\nexit 0\n' % (d, d))
        os.chmod(dep, 0o755)
        RO.SCHED, RO.FLEET_DEPLOY, RO.CANARY_LOCK, RO.JOURNAL = sched, dep, os.path.join(d, 'lock'), os.path.join(d, 'j.jsonl')
        RO.direct_facts = lambda a: dict(ok)
        quiet = {'v': True}
        RO.deploys_quiet = lambda *x, **k: quiet['v']
        args = ['deploy', '--run', 'tidy-02', '--sha', B, '--tier', '1', '--reviewer', 'codex', '--state-dir', d, '--no-push']
        with contextlib.redirect_stdout(io.StringIO()) as o:
            rc = RO.main(args + ['--dry-run'])
        check('direct e2e: dry run deploys nothing', rc == 0 and not os.path.exists(os.path.join(d, 'calls'))
              and not os.path.exists(RO.JOURNAL), o.getvalue())
        open(os.path.join(d, 'good'), 'w').close()
        with contextlib.redirect_stdout(io.StringIO()) as o:
            rc = RO.main(args)
        rows = [json.loads(l) for l in open(RO.JOURNAL)]
        check('direct e2e: verified deploy writes ONE owner-direct ledger row with prev', rc == 0 and len(rows) == 1
              and rows[0]['phase'] == 'owner-direct' and rows[0]['prev'] == A and rows[0]['sha'] == B, (rc, rows, o.getvalue()))
        os.unlink(os.path.join(d, 'good')); os.unlink(RO.JOURNAL)
        with contextlib.redirect_stdout(io.StringIO()) as o:
            rc = RO.main(args)
        calls = open(os.path.join(d, 'calls')).read().split('\n')
        rows = [json.loads(l) for l in open(RO.JOURNAL)]
        check('direct e2e: an unverified deploy rolls back to prev and writes no owner-direct row', rc == 1
              and ('%s tidy-02-rollback' % A) in calls and [r['phase'] for r in rows] == ['owner-direct-failed'], (rc, calls, rows))
        seq = iter([dict(ok), dict(ok, prev='c' * 40)])
        RO.direct_facts = lambda a: next(seq)
        os.unlink(RO.JOURNAL); os.unlink(os.path.join(d, 'calls')); open(os.path.join(d, 'good'), 'w').close()
        with contextlib.redirect_stdout(io.StringIO()) as o:
            rc = RO.main(args)
        check('direct e2e: the base moved between the check and the lock -> refused, nothing deployed', rc == 2
              and not os.path.exists(os.path.join(d, 'calls')) and 'moved' in o.getvalue(), o.getvalue())
        os.unlink(os.path.join(d, 'good'))
        RO.direct_facts = lambda a: dict(ok)
        open(RO.JOURNAL, 'w').close(); open(os.path.join(d, 'calls'), 'w').close()
        quiet['v'] = False
        with contextlib.redirect_stdout(io.StringIO()) as o:
            rc = RO.main(args)
        calls = open(os.path.join(d, 'calls')).read()
        rows = [json.loads(l) for l in open(RO.JOURNAL)]
        check('direct e2e: a deploy still running is never rolled back over (no second deploy)', rc == 1
              and 'rollback' not in calls and rows[-1]['phase'] == 'owner-direct-failed' and 'STILL RUNNING' in rows[-1]['note'],
              (rc, calls, rows))
        RO.direct_facts = lambda a: dict(ok, slot=['S1 canary declared'])
        with contextlib.redirect_stdout(io.StringIO()) as o:
            rc = RO.main(args)
        check('direct e2e: a refused plan exits 2 and touches nothing', rc == 2 and 'REFUSED' in o.getvalue())


# ------------------------------------------------------------------------------------------------ mutants
def t_monitor_logs(AH):
    """audit 11-01 flag 9: the wired monitor logs reach the header; each alarms on its bad line, stays plain on a good one."""
    with tempfile.TemporaryDirectory() as d:
        now = dt.datetime.now(UTC)
        def w(rel, text, age_h=0):
            p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(text)
            t = (now - dt.timedelta(hours=age_h)).timestamp(); os.utime(p, (t, t))
        w('digest/ironfunnel.log', 'old\niron funnel, last 24 h, 1440 bot-h: raw iron gathered 351\n', 2)
        w('digest/stuckwatch.log', '2026-11-02T14:17:28Z stuckwatch OK (80 bots, 80 moving, none pinned over 240 min)\n'
          '2026-11-02T14:47:29Z 2 of 80 bots PINNED for >= 240 min (<= 3 distinct positions):\n  isolated-d-Delta at (1, 2, 3)\n')
        w('staffcensus/out/check.log', '2026-11-02T14:33:01Z staff census OK -- newest tick 2.7 min ago\n')
        w('failmine/weekly.log', 'PICKS\n  File "x", line 1\nBlindInput: fall-1899: outside the cut\n', 30)
        out = AH.monitor_lines(now, d)
        txt = '\n'.join(out)
        check('monitor logs: iron funnel shown plain', any(l.startswith('iron funnel: iron funnel, last 24 h') for l in out), out)
        check('monitor logs: 2 pinned bots alarm', any(l.startswith('!! pinned bots: 2026-11-02T14:47:29Z 2 of 80') for l in out), out)
        check('monitor logs: staff census OK plain', any(l.startswith('staff census check: 2026') for l in out), out)
        check('monitor logs: a failmine traceback alarms', any(l.startswith('!! failmine weekly: BlindInput') for l in out), out)
        w('failmine/weekly.log', 'PICKS\n  fall-1\nfailmine weekly OK 20261102T0640Z: 2 cut, 0 already in the library, 1 skipped of 3 '
          'picks; skipped fall-1899-isolated-d-384_7_155: the scene script (home skill) walks to [355, 73, 147], outside the cut\n', 30)
        check('monitor logs: a failmine OK summary with a skipped pick is plain',
              any(l.startswith('failmine weekly: failmine weekly OK 20261102T0640Z') for l in AH.monitor_lines(now, d)), AH.monitor_lines(now, d))
        w('failmine/weekly.log', 'failmine weekly NO SCENES 20261102T0640Z: 0 cut, 0 already in the library, 1 skipped of 1 picks\n', 30)
        check('monitor logs: failmine NO SCENES alarms', any(l.startswith('!! failmine weekly: failmine weekly NO SCENES') for l in AH.monitor_lines(now, d)),
              AH.monitor_lines(now, d))
        w('failmine/weekly.log', 'PICKS\n  stuck-1899-board-a-359_40_187  (stuck rank 3)\n', 30)
        check('monitor logs: a failmine run with no summary alarms', any(l.startswith('!! failmine weekly: stuck-1899') for l in AH.monitor_lines(now, d)),
              AH.monitor_lines(now, d))
        w('digest/stuckwatch.log', '2026-11-02T15:17:28Z stuckwatch OK (80 bots, 80 moving, none pinned over 240 min)\n')
        w('staffcensus/out/check.log', '2026-11-02T15:03:01Z StaffCensusStale: newest good heartbeat 3 h old\n')
        out = AH.monitor_lines(now, d)
        check('monitor logs: none pinned is plain', any(l.startswith('pinned bots: 2026-11-02T15:17:28Z stuckwatch OK') for l in out), out)
        check('monitor logs: a staff census line that is not OK alarms', any(l.startswith('!! staff census check: ') for l in out), out)
        w('digest/ironfunnel.log', 'iron funnel, last 24 h\n', 30)
        os.remove(os.path.join(d, 'failmine/weekly.log'))
        out = AH.monitor_lines(now, d)
        check('monitor logs: a stale log alarms', any(l.startswith('!! iron funnel: STALE') for l in out), out)
        check('monitor logs: a missing log alarms', any(l.startswith('!! failmine weekly: NO OUTPUT') for l in out), out)
        full = AH.lines(now, None, state_dir=d, conf=os.path.join(d, 'none'), sched_log=os.path.join(d, 'none.log'), home=d)
        check('monitor logs: lines() includes them', any(l.startswith('!! iron funnel: STALE') for l in full), full)


MUTANTS = [
    ('goalwatch.py', "    if idle < stall:\n        return None\n", "    if idle > stall:\n        return None\n", t_goal),
    ('goalwatch.py', "        return status == 'success' and d.get('op') in PROGRESS_OPS", "        return d.get('op') in PROGRESS_OPS", t_goal),
    ('haltwatch.py', "        if age < g:\n", "        if age < g * 0:\n", t_halt),
    # phase 1 item 4
    ('haltwatch.py', "        elif ev == 'activated' and (r.get('running_bots') or 0) > 0 and r.get('cause') != 'auto-rollback':",
     "        elif ev == 'activated' and r.get('cause') != 'auto-rollback':", t_halt),
    ('haltwatch.py', "        elif ev == 'activated' and (r.get('running_bots') or 0) > 0 and r.get('cause') != 'auto-rollback':",
     "        elif ev == 'activated' and (r.get('running_bots') or 0) > 0:", t_halt),
    ('haltwatch.py', "    if stop is not None and (unit_states is None or up < total or total == 0):",
     "    if stop is not None and unit_states is not None and (up < total):", t_halt),
    ('haltwatch.py', "        elif ev in STARTED or (ev == 'start-bots-after-restart' and r.get('rc') == 0):",
     "        elif ev in STARTED or ev in ('start-requested', 'start-failed') or (ev == 'start-bots-after-restart' and r.get('rc') == 0):", t_halt),
    ('haltwatch.py', "'stop': dt.timedelta(0), 'rollback-stopped': dt.timedelta(0)}.get(plan.get('action'), GRACE_TRIP)",
     "'stop': GRACE, 'rollback-stopped': GRACE}.get(plan.get('action'), GRACE_TRIP)", t_halt),
    ('haltwatch.py', "{'rollback-restart': GRACE_ROLLBACK, 'stop'", "{'rollback-restart': dt.timedelta(0), 'stop'", t_halt),
    ('haltwatch.py', "    if set(down) <= qu:", "    if False:", t_halt),
    ('haltwatch.py', "    down = [u for u in down if u not in qu]\n", "", t_halt),
    ('haltwatch.py', "    if cursor is None:\n        return [], new_cur", "    if cursor is None:\n        cursor = {}", t_halt),
    ('haltwatch.py', "            if seen_at_ct <= cn:", "            if False:", t_halt),
    ('haltwatch.py', "        if len(p) < 2 or (p[0] == 'S3' and p[1] == 'Z1'):", "        if len(p) < 2:", t_halt),
    ('haltwatch.py', "        out = dict(prev_active or {})", "        out = {}", t_halt),
    ('haltwatch.py', "        if not stop_open:\n            out['trip:stale']", "        if True:\n            out['trip:stale']", t_halt),
    ('haltwatch.py', "        if inc.get('dry_run') or not inc.get('stopped')", "        if not inc.get('stopped')", t_halt),
    ('rollout.py', "            if d >= 2 and d > poisson_upper(mu, 0.995):", "            if d > poisson_upper(mu, 0.995):", t_rollout),
    ('rollout.py', "    inside = [r for r in runs if t0 <= r[0] <= t1 + slack]", "    inside = [r for r in runs]", t_rollout),
    ('rollout.py', "        if cut < a['t'] + CHECK_AFTER:", "        if False:", t_rollout),
    ('haltwatch.py', "f'mcbot@{unit_of.get(b, b)}.service'", "f'mcbot@{b}.service'", t_halt),
    ('haltwatch.py', "        AL.raise_alarms('slotwatch', slot, now,", "        AL.raise_alarms('slotwatch', {}, now,", t_halt),
    ('haltwatch.py', "        slot = {key: sline} if key else {}", "        slot = {'slot:x': sline}", t_halt),
    ('driftwatch.py', "            if r['alarm']:                      # a zero median", "            if False:                      # a zero median", t_drift),
    ('driftwatch.py', "            if min(lo, hi) >= 0.025:", "            if False:", t_drift),
    ('lib/alarm.py', "        if last is None or now - last >= rp:", "        if True:", t_alarm),
    ('lib/alarmhead.py', "    if t_last - start >= idle:", "    if False:", t_head),
    ('lib/alarmhead.py', "    return not any(r.startswith(OCCUPIED)", "    return not any(False", t_head),
    ('lib/alarmhead.py', "(r.startswith('S8 INSTALL-HOLD') and 'STALE' not in r)", "(False)", t_head),
    ('lib/alarmhead.py', "        if dec not in DECISIONS:\n            continue", "        if dec == 'NOTE':\n            continue", t_head),
    ('rollout.py', "    if superseded:\n        slack = dt.timedelta(0)", "    if False:\n        slack = dt.timedelta(0)", t_rollout),
    ('lib/alarmhead.py', "        if not is_idle(d, w):\n            bounded = True", "        if False:\n            bounded = True", t_head),
    ('lib/alarmhead.py', "    if age is None or age > stale:\n        return [f'!! {label}: STALE",
     "    if age is None:\n        return [f'!! {label}: STALE", t_head),
    ('lib/alarmhead.py', "        elif not hits or (bad and re.search(bad, last)) or (ok and not re.search(ok, last)):", "        elif False:", t_monitor_logs),
    ('lib/alarmhead.py', "        if now - mt > stale:", "        if False:", t_monitor_logs),
    ('lib/alarmhead.py', "        out += monitor_lines(now, home)\n", "\n", t_monitor_logs),
    ('rollout.py', "    if pr == 'protected':", "    if False:", t_direct),
    ('rollout.py', "    elif pr != 'not protected':", "    elif False:", t_direct),
    ('rollout.py', "    if f.get('slot'):\n        out.append('the canary slot is not empty", "    if False:\n        out.append('the canary slot is not empty", t_direct),
    ('rollout.py', "    if f.get('ancestor') is not True:", "    if f.get('ancestor') is False:", t_direct),
    ('rollout.py', "    if f.get('tier') == 2 and not str(f.get('showcase_evidence') or '').strip():", "    if False:", t_direct),
    ('rollout.py', "        ok = 'VERIFIED' in open(log).read()", "        ok = True", t_direct),
    ('rollout.py', "    if a.dry_run:\n        print('DRY RUN", "    if False:\n        print('DRY RUN", t_direct),
    ('rollout.py', "        if not ok and not deploys_quiet():", "        if False:", t_direct),
    ('rollout.py', "        f2 = direct_facts(a)\n", "        f2 = dict(f)\n", t_direct),
]


def run_all(mods):
    t_alarm(mods['lib/alarm.py']); t_goal(mods['goalwatch.py']); t_halt(mods['haltwatch.py'])
    t_rollout(mods['rollout.py']); t_drift(mods['driftwatch.py']); t_head(mods['lib/alarmhead.py'])
    t_monitor_logs(mods['lib/alarmhead.py']); t_direct(mods['rollout.py'])


def main():
    names = ['lib/alarm.py', 'goalwatch.py', 'haltwatch.py', 'rollout.py', 'driftwatch.py', 'lib/alarmhead.py']
    mods = {n: load(n) for n in names}
    run_all(mods)
    base = list(FAILS)
    for f in base:
        print('FAIL', f)
    killed = 0
    for fn, old, new, test in MUTANTS:
        p = os.path.join(HERE, '..', fn) if fn.startswith('lib/') else os.path.join(HERE, fn)
        src = open(p).read()
        assert src.count(old) == 1, f'MUTANT ANCHOR MISSING OR NOT UNIQUE in {fn}: {old!r} x{src.count(old)}'
        m = load(fn, src.replace(old, new))
        FAILS.clear()
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                test(m)
        except Exception as e:      # a crash is a kill too, but say so
            FAILS.append(f'crash {type(e).__name__}')
        if FAILS:
            killed += 1
        else:
            print(f'MUTANT SURVIVED: {fn}: {old.strip()[:70]!r}')
    FAILS[:] = base
    print(f'w5 alarms: {"FAIL" if base else "ok"} ({len(base)} failures); mutants killed {killed}/{len(MUTANTS)}')
    return 1 if base or killed < len(MUTANTS) else 0


if __name__ == '__main__':
    sys.exit(main())
