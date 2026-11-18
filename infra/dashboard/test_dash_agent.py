#!/usr/bin/env python3
"""Behaviour tests for the dashboard agent's alarm list (infra/dashboard/agent/mcai-dash-agent.py).

    python3 infra/dashboard/test_dash_agent.py        # exit 1 on any failure; no network, no hosts

An alarm the owner acknowledged with `pager.py ack` is listed as 'acked', not 'critical', so the "Critical fleet alarm" rule
(sum of mcai_alarms_active{severity="critical"}) counts only what nobody has answered. Everything else stays loud: an
expired ack, another key of the same source, an unreadable ack file.
"""
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.join(HERE, 'agent', 'mcai-dash-agent.py')
NOW = 1794806400.0          # 2026-11-16T05:20:00Z
FAILS = []


def load(src=None):
    path = AGENT
    if src is not None:
        f = tempfile.NamedTemporaryFile('w', suffix='.py', delete=False)
        f.write(src)
        f.close()
        path = f.name
    spec = importlib.util.spec_from_file_location('dash_agent_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.NOW = lambda: NOW
    if src is not None:
        os.unlink(path)
    return mod


def check(name, cond, got=None):
    print(('ok   ' if cond else 'FAIL ') + name + ('' if cond else f' -- got {got!r}'))
    if not cond:
        FAILS.append(name)


def raises(fn):
    try:
        fn()
    except Exception:       # noqa: BLE001
        return True
    return False


LOG = """2026-11-16T02:45:01Z STILL   slotwatch slot:nodeploy:block:H2-refused :: canary slot: NO canary deployed for 1115 min
2026-11-16T03:00:00Z NEW     slotwatch slot:scheduler :: canary scheduler: last tick 40 min ago -- cron stopped?
2026-11-16T04:00:00Z NEW     haltwatch-fleet halt:fleet :: fleet HALTED
2026-11-16T04:10:00Z NEW     goalwatch goal:board-a/tidy@1_2_3 :: STUCK 13 h
"""


def scene(acks):
    d = tempfile.mkdtemp()
    with open(os.path.join(d, 'ALARMS.log'), 'w') as f:
        f.write(LOG)
    if acks is not None:
        with open(os.path.join(d, 'alarm-acks.json'), 'w') as f:
            f.write(acks if isinstance(acks, str) else json.dumps({'acks': acks}))
    return os.path.join(d, 'ALARMS.log')


def sev(mod, acks):
    active, _ = mod.alarms(scene(acks), 'fleet')
    return {r['key']: r['severity'] for r in active}, active


ACK = {'source': 'slotwatch', 'key': 'slot:nodeploy:block:*', 'why': 'consolidation', 'by': 'owner',
       'at': '2026-11-16T04:43:02Z', 'until': '2026-11-23T04:43:02Z'}


def crit_count(mod, acks):
    """What the 'Critical fleet alarm' rule sums: mcai_alarms_active{severity="critical"}."""
    class M:
        def __init__(self): self.rows = []
        def add(self, name, v, labels, help_=''): self.rows.append((name, v, labels))
    m = M()
    active, _ = mod.alarms(scene(acks), 'fleet')
    mod.alarm_metrics(m, active, 'fleet')
    return sum(v for n, v, lab in m.rows if n == 'mcai_alarms_active' and lab.get('severity') == 'critical')


def main():
    A = load()
    # CONTROL: with no ack file all four alarms are active and three are critical (the scene really holds alarms).
    s, active = sev(A, None)
    check('control: no acks -> 4 active, slot + scheduler + halt critical', len(active) == 4 and
          [s['slot:nodeploy:block:H2-refused'], s['slot:scheduler'], s['halt:fleet'], s['goal:board-a/tidy@1_2_3']] ==
          ['critical', 'critical', 'critical', 'warning'], s)
    check('control: the rule sums 3 critical', crit_count(A, None) == 3, crit_count(A, None))
    # THE ACK: only the acked key leaves 'critical'; it stays listed, with the reason.
    s, active = sev(A, [ACK])
    row = next(r for r in active if r['key'] == 'slot:nodeploy:block:H2-refused')
    check('acked key is listed as acked', s['slot:nodeploy:block:H2-refused'] == 'acked', s)
    check('acked row says until when, by whom and why', all(x in row['text'] for x in ('2026-11-23T04:43:02Z', 'owner', 'consolidation', 'NO canary deployed')), row['text'])
    check('a dead scheduler (another key of the same source) stays critical', s['slot:scheduler'] == 'critical', s)
    check('a halt stays critical', s['halt:fleet'] == 'critical', s)
    check('the rule sums 2 critical with the ack', crit_count(A, [ACK]) == 2, crit_count(A, [ACK]))
    check('still 4 active (an acked alarm is not hidden)', len(active) == 4, len(active))
    check('acked sorts last', active[-1]['key'] == 'slot:nodeploy:block:H2-refused', [r['key'] for r in active])
    # LOUD ON DOUBT
    check('an expired ack does nothing', sev(A, [dict(ACK, until='2026-11-16T05:00:00Z')])[0]['slot:nodeploy:block:H2-refused'] == 'critical')
    check('an ack with no until does nothing', sev(A, [{k: v for k, v in ACK.items() if k != 'until'}])[0]['slot:nodeploy:block:H2-refused'] == 'critical')
    check('an ack for another source does nothing', sev(A, [dict(ACK, source='hourwatch')])[0]['slot:nodeploy:block:H2-refused'] == 'critical')
    check('an ack with no key covers nothing', crit_count(A, [dict(ACK, key='')]) == 3)
    check('an unreadable ack file is no acks', crit_count(A, '{not json') == 3)
    check('an ack file of the wrong shape is no acks', crit_count(A, '[1, 2]') == 3)
    check('acks that is not a list is no acks (no crash)', crit_count(A, '{"acks": 1}') == 3 and crit_count(A, '{"acks": true}') == 3)
    check('a zoneless until does nothing (alarm.py refuses it too)', crit_count(A, [dict(ACK, until='2099-01-01T00:00:00')]) == 3)
    check('ack_for: source glob defaults to *', A.ack_for([{'key': 'slot:*'}], 'slotwatch', 'slot:scheduler') is not None)

    # MUTANTS: each must be caught by a check above.
    src = open(AGENT).read()

    def mutant(name, old, new, caught):
        assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {old[:70]}'
        M = load(src.replace(old, new))
        check('mutant killed: ' + name, caught(M))

    mutant('acks ignored', "severity='acked' if ack else severity(src, r['text'])", "severity=severity(src, r['text'])",
           lambda M: crit_count(M, [ACK]) == 3)
    mutant('expired acks honoured', "(ack_until(a) or 0) > now]", "True]",
           lambda M: sev(M, [dict(ACK, until='2026-11-16T05:00:00Z')])[0]['slot:nodeploy:block:H2-refused'] == 'acked')
    mutant('key glob ignored', "and fnmatch.fnmatchcase(str(key), str(a.get('key') or '')):", ":",
           lambda M: sev(M, [ACK])[0]['slot:scheduler'] == 'acked')
    mutant('zoneless until honoured', "return t.timestamp() if t.tzinfo else None", "return t.replace(tzinfo=timezone.utc).timestamp()",
           lambda M: crit_count(M, [dict(ACK, until='2099-01-01T00:00:00')]) == 2)
    mutant('non-list acks crash', "    if not isinstance(rows, list):      # Codex r1: {\"acks\": 1} raised and took the whole alarm list with it\n        return []\n", "",
           lambda M: raises(lambda: crit_count(M, '{"acks": 1}')))

    # STALE BOTS (11-18): the fleet was stopped on purpose; its bots' last rows (bags 34-36) kept the 'Many bags full' rule
    # firing and the bag panels showing 30 full fleet bots. Only bots with a row in the last hour count.
    def mval(m, name):
        return sum(v for _, v in m.rows.get(name, (None, None, []))[2])
    rowf = lambda bot, age_s, bag: {'bot': bot, 'pool': 'p', 'bag_slots': bag, 'health': 20, 'hunger': 20, 'y': 70,
                                    'age_s': age_s, 'version': 'v1'}
    rows = [rowf('a', 30, 36), rowf('b', 300, 35), rowf('c', 7200, 36), rowf('d', None, 36), rowf('e', 59, 10)]
    m = A.Metrics(); A.bot_metrics(m, rows, 'x')
    check('only bots seen within the hour count as full', mval(m, 'mcai_bots_bag_full') == 2, mval(m, 'mcai_bots_bag_full'))
    check('stale bots have no bag gauge', len(m.rows['mcai_bot_bag_slots'][2]) == 3, len(m.rows['mcai_bot_bag_slots'][2]))
    check('reporting still means a row in 10 min', mval(m, 'mcai_bots_reporting') == 3, mval(m, 'mcai_bots_reporting'))
    m0 = A.Metrics(); A.bot_metrics(m0, [rowf('c', 7200, 36)], 'x')
    check('a stopped fleet reports zero full bags, not its last ones', mval(m0, 'mcai_bots_bag_full') == 0)
    mutant('stale bots counted', "    rows = [r for r in rows if age(r) < FRESH_S]\n", "",
           lambda M: (lambda mm: (M.bot_metrics(mm, rows, 'x'), mval(mm, 'mcai_bots_bag_full'))[1])(M.Metrics()) == 4)

    # FLEET STOPPED: no expected-bots metric while the owner's marker exists, so 'Fleet bots not running' has no data.
    d = tempfile.mkdtemp()
    o = type('O', (), {'expected_bots': 80, 'fleet_stopped': os.path.join(d, 'FLEET_STOPPED')})()
    ag = A.Agent('fleet', o)
    A.units = lambda pattern: [{'unit': 'mcbot@x.service', 'bot': 'x', 'load': 'loaded', 'active': 'inactive', 'sub': 'dead'}]
    m1 = A.Metrics(); ag._units(m1, 'mcbot@*', 'fleet')
    check('fleet running (no marker): 80 expected', mval(m1, 'mcai_bot_units_expected') == 80)
    open(o.fleet_stopped, 'w').write('{"why": "owner"}')
    m2 = A.Metrics(); ag._units(m2, 'mcbot@*', 'fleet')
    check('fleet stopped (marker): no expected metric', 'mcai_bot_units_expected' not in m2.rows)
    m3 = A.Metrics(); ag._units(m3, 'mctest@*', 'testworld')
    check('the test world has no expected metric', 'mcai_bot_units_expected' not in m3.rows and mval(m3, 'mcai_bot_units_running') == 0)

    # TRIPWIRE LEVEL: a lost or verdict-less file is not "clear", and a level read earlier is not republished (Codex r1, r2).
    d2 = tempfile.mkdtemp(); tl = os.path.join(d2, 'trip-last.json')
    o2 = type('O', (), {'trip_last': tl, 'every': 60, 'slow_every': 0})()
    ag2 = A.Agent('showcase', o2)
    open(tl, 'w').write('{"t": "2026-11-18T20:35:01Z", "verdict": "WATCH", "why": []}')
    mA = A.Metrics(); ag2._trip(mA)
    check('a WATCH verdict exports level 0', mval(mA, 'mcai_trip_level') == 0 and 'mcai_trip_level' in mA.rows)
    open(tl, 'w').write('{"verdict": "TRIP"}')
    mB = A.Metrics(); ag2._trip(mB)
    check('a TRIP verdict exports level 2', mval(mB, 'mcai_trip_level') == 2)
    os.unlink(tl)
    mC = A.Metrics()
    check('a missing file fails the collector', raises(lambda: ag2._trip(mC)))
    check('and exports no level', 'mcai_trip_level' not in mC.rows)
    check('and drops the cached level', 'mcai_trip_level' not in getattr(ag2, 'slow_metrics', {}))

    # A FAILING SLOW COLLECTOR STAYS FAILING between its runs (Codex r3).
    o3 = type('O', (), {'trip_last': os.path.join(d2, 'nope.json'), 'every': 60, 'slow_every': 3600})()
    ag3 = A.Agent('showcase', o3)
    ag3.showcase_jobs = lambda slow: [('fast', lambda m: None)] + ([('trip', ag3._trip)] if slow else [])
    ag3.cycle()
    ag3.cycle()   # a fast cycle: trip does not run
    trip_ok = [l for l in ag3.metrics_text.splitlines() if l.startswith('mcai_agent_collector_ok') and 'collector="trip"' in l]
    check('a failed slow collector is still reported failing on the next fast cycle', trip_ok and trip_ok[0].endswith(' 0.0'), trip_ok)
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
