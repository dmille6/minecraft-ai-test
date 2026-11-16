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
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed')
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
