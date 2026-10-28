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
    line, s = H.judge_showcase([dict(stop, t='2026-10-28T11:50:00Z')], down, T)
    check('halt: inside 15-min grace -> no alarm', line is None and 'grace' in s, s)
    check('halt: units back up -> no alarm', H.judge_showcase([stop], up, T)[0] is None)
    act = {'t': '2026-10-28T11:40:00Z', 'event': 'activated', 'running_bots': 10}
    line, _ = H.judge_showcase([stop, act], down, T)
    check('halt: activated after the stop supersedes it, but down units still alarm', line and 'NO stop-bots row' in line, line)
    check('halt: census unreadable is an alarm', H.judge_showcase([], None, T)[0])
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
    log = ('===== 2026-10-28T09:35:06Z rc=0\nSHOWCASE TRIPWIRE x\nVERDICT      OK\n'
           '===== 2026-10-28T12:35:06Z rc=2\nVERDICT      TRIP -- S6 H2 clear_outside 1\n   stopped showcase-Alpha\n')
    runs = RO.parse_trip_log(log)
    check('trip.log parse', [(r[1], r[2]) for r in runs] == [('OK', ''), ('TRIP', 'S6 H2 clear_outside 1')], runs)
    t0 = dt.datetime(2026, 10, 28, 8, 12, tzinfo=UTC)
    check('trip window OK', RO.trip_in_window(runs, t0, t0 + dt.timedelta(hours=1))['verdict'] == 'OK')
    t0b = dt.datetime(2026, 10, 28, 11, 30, tzinfo=UTC)
    check('trip window TRIP', RO.trip_in_window(runs, t0b, t0b + dt.timedelta(hours=1))['verdict'] == 'TRIP')
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
        out = AH.lines(now, None, state_dir=d, conf=os.path.join(d, 'none'))
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
        check('head ES: halt alarm shown', any(l.startswith('!! SHOWCASE HALTED') for l in es), es)
        check('head ES: stale goal row is an alarm', any(l.startswith('!! showcase goals: STALE') for l in es), es)


# ------------------------------------------------------------------------------------------------ mutants
MUTANTS = [
    ('goalwatch.py', "    if idle < stall:\n        return None\n", "    if idle > stall:\n        return None\n", t_goal),
    ('goalwatch.py', "        return status == 'success' and d.get('op') in PROGRESS_OPS", "        return d.get('op') in PROGRESS_OPS", t_goal),
    ('haltwatch.py', "        if age < grace:\n", "        if age < grace * 0:\n", t_halt),
    ('haltwatch.py', "        if inc.get('dry_run') or not inc.get('stopped')", "        if not inc.get('stopped')", t_halt),
    ('rollout.py', "            if d >= 2 and d > poisson_upper(mu, 0.995):", "            if d > poisson_upper(mu, 0.995):", t_rollout),
    ('rollout.py', "    inside = [r for r in runs if t0 <= r[0] <= t1 + slack]", "    inside = [r for r in runs]", t_rollout),
    ('haltwatch.py', "f'mcbot@{unit_of.get(b, b)}.service'", "f'mcbot@{b}.service'", t_halt),
    ('driftwatch.py', "            if r['alarm']:                      # a zero median", "            if False:                      # a zero median", t_drift),
    ('driftwatch.py', "            if min(lo, hi) >= 0.025:", "            if False:", t_drift),
    ('lib/alarm.py', "        if last is None or now - last >= repush:", "        if True:", t_alarm),
    ('lib/alarmhead.py', "    if age is None or age > stale:\n        return [f'!! {label}: STALE",
     "    if age is None:\n        return [f'!! {label}: STALE", t_head),
]


def run_all(mods):
    t_alarm(mods['lib/alarm.py']); t_goal(mods['goalwatch.py']); t_halt(mods['haltwatch.py'])
    t_rollout(mods['rollout.py']); t_drift(mods['driftwatch.py']); t_head(mods['lib/alarmhead.py'])


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
