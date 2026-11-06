#!/usr/bin/env python3
"""Behaviour tests for the ONE PAGER (phase 1 item 2, 11-06): lib/alarm tiers / acks / delivery / outbox, pager.py (relay,
digest, acks), alarmhead.slot_nodeploy (no canary deployed for 60 min, keyed by cause), goalwatch.town_blocked,
stuckwatch.judge_pins (rotation false pins) and hourwatch (value / lap / towns). Synthetic inputs; no network, no ES.

    python3 scripts/host/test_pager.py        (exit 1 on any failure)

Bottom: MUTANTS, each asserting its anchor is present exactly once; the named test must then fail.
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, '..')
sys.path.insert(0, SCRIPTS)
UTC = dt.timezone.utc
T = dt.datetime(2026, 11, 6, 12, 0, tzinfo=UTC)
M = lambda m: dt.timedelta(minutes=m)
FAILS = []
PATHS = {'lib/alarm.py': os.path.join(SCRIPTS, 'lib', 'alarm.py'), 'lib/alarmhead.py': os.path.join(SCRIPTS, 'lib', 'alarmhead.py'),
         'pager.py': os.path.join(HERE, 'pager.py'), 'goalwatch.py': os.path.join(HERE, 'goalwatch.py'),
         'hourwatch.py': os.path.join(HERE, 'hourwatch.py'), 'stuckwatch.py': os.path.join(SCRIPTS, 'ops', 'stuckwatch.py')}


def load(name, src_text=None, AL=None):
    path = PATHS[name]
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py', dir=os.path.dirname(PATHS[name]))
        os.write(fd, src_text.encode()); os.close(fd)
    try:
        spec = importlib.util.spec_from_file_location('tp_%d_%s' % (id(path), os.path.basename(name)[:-3]), path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
    finally:
        if src_text is not None:
            os.unlink(path)
    if AL is not None and hasattr(m, 'AL'):
        m.AL = AL                      # the module under test talks to the (possibly mutated) alarm module
    return m


def check(name, cond, detail=''):
    if not cond:
        FAILS.append(f'{name} {str(detail)[:300]}')


class Sender:
    def __init__(self, ok=True):
        self.ok, self.calls = ok, []

    def __call__(self, subject, body, conf_path=None, priority=None):
        self.calls.append((subject, body, priority))
        return {'webhook': self.ok, 'email': None, 'detail': 'HTTP 200' if self.ok else 'HTTP 502'}


# ------------------------------------------------------------------------------------------------ lib/alarm
def t_alarm(AL):
    check('tier: goal digests', AL.tier_of('goalwatch-fleet', 'goal:hive-d/tidy@1_2_3') == AL.TIER_DIGEST)
    check('tier: whole town pages', AL.tier_of('goalwatch-fleet', 'town:hive-d') == AL.TIER_PAGE)
    check('tier: goalwatch crash pages', AL.tier_of('goalwatch-fleet', 'goalwatch:fleet') == AL.TIER_PAGE)
    check('tier: flow digests', AL.tier_of('flowledger', 'starved:hive-a') == AL.TIER_DIGEST)
    check('tier: effect/drift digest', AL.tier_of('effectwatch', 'x') == AL.tier_of('driftwatch', 'x') == AL.TIER_DIGEST)
    check('tier: unknown source pages (fail loud)', AL.tier_of('newwatch', 'k') == AL.TIER_PAGE)
    check('tier: blind check digests', AL.tier_of('hourwatch', 'blind:value') == AL.TIER_DIGEST)
    check('tier: slot/stuck/hour page', all(AL.tier_of(s, k) == AL.TIER_PAGE for s, k in
                                            (('slotwatch', 'slot:nodeploy:block:H2'), ('stuckwatch', 'pin:b'), ('hourwatch', 'lap:share'))))
    check('repush: tier 1 unacked 2 h', AL.repush_for(1) == dt.timedelta(hours=2) and AL.repush_for(1, acked=True) == AL.REPUSH
          and AL.repush_for(2) == AL.REPUSH)
    acks = [{'source': 'hourwatch', 'key': 'lap:*', 'until': AL._iso(T + M(60)), 'at': AL._iso(T - M(1)), 'why': 'idlework queued'}]
    check('ack: glob matches', AL.find_ack(acks, 'hourwatch', 'lap:share', T) is not None)
    check('ack: other source does not match', AL.find_ack(acks, 'stuckwatch', 'lap:share', T) is None)
    check('ack: expired does not match', AL.find_ack(acks, 'hourwatch', 'lap:share', T + M(61)) is None)
    ev = [('NEW', 'lap:share', 'x'), ('STILL', 'value:drop', 'y'), ('CLEARED', 'lap:old', 'z')]
    push, held = AL.push_plan(ev, 'hourwatch', T, acks)
    check('push_plan: acked NEW held, unacked STILL pushed', [k for _, k, _ in push] == ['value:drop', 'lap:old']
          and held[0][1] == 'lap:share' and 'acked' in held[0][3], (push, held))
    acks2 = [{'source': 'hourwatch', 'key': 'lap:*', 'until': AL._iso(T + M(60)), 'at': AL._iso(T - M(1))}]
    p2, _ = AL.push_plan([('CLEARED', 'lap:share', 'z')], 'hourwatch', T, acks2)
    check('push_plan: CLEARED pushes even when acked', len(p2) == 1, p2)
    p3, h3 = AL.push_plan([('NEW', 'goal:a/b@c', 'x')], 'goalwatch-fleet', T)
    check('push_plan: digest tier never pushes', not p3 and h3[0][3] == 'digest', h3)
    s, b = AL.compose('stuckwatch', [('NEW', 'pin:a', 'A'), ('NEW', 'pin:b', 'B'), ('CLEARED', 'pin:c', 'C')])
    check('compose: one message for a batch', '2 NEW' in s and '1 CLEARED' in s and 'pin:a' in b and 'pin:c' in b, (s, b))
    check('curl: exit 0 + 200 + ntfy id delivers', AL.curl_verdict(0, '{"id":"abc","event":"message"}\n200', True)[0])
    check('curl: exit 0 + 500 fails', not AL.curl_verdict(0, 'oops500', False)[0])
    check('curl: exit 28 (timeout) fails even when a 200 was printed', not AL.curl_verdict(28, 'ok200', False)[0])
    check('curl: 200 without an ntfy id fails', not AL.curl_verdict(0, '<html>portal</html>200', True)[0])
    check('curl: 200 webhook (no id needed) delivers', AL.curl_verdict(0, 'ok204', False)[0])
    check('delivered: journald alone is not delivery', not AL.delivered({'webhook': None, 'email': None}))
    check('delivered: a failed webhook is not delivery', not AL.delivered({'webhook': False}))
    with tempfile.TemporaryDirectory() as d:
        sp, lp = os.path.join(d, 's.json'), os.path.join(d, 'ALARMS.log')
        bad, good = Sender(False), Sender(True)
        AL.raise_alarms('slotwatch', {'slot:x': 'idle 60'}, T, sp, log_path=lp, sender=bad)
        check('raise: a failed push is QUEUED, not lost', AL.outbox_status(d)[0] == 1 and len(bad.calls) == 1)
        st = json.load(open(os.path.join(d, 'alarm-delivery.json')))
        check('raise: the failure is recorded', 'last_fail' in st and 'HTTP 502' in st['last_fail']['detail'], st)
        r1 = AL.flush_outbox(T + M(2), d, sender=good)
        check('outbox: backoff (not due at +2 min)', r1['sent'] == 0 and not good.calls and AL.outbox_status(d)[0] == 1, r1)
        r2 = AL.flush_outbox(T + M(6), d, sender=good)
        check('outbox: retried and delivered at +6 min', r2['sent'] == 1 and AL.outbox_status(d)[0] == 0, r2)
        AL.raise_alarms('slotwatch', {'slot:x': 'idle 65'}, T + M(5), sp, log_path=lp, sender=good)
        check('raise: inside the repush interval nothing is pushed', len(good.calls) == 1, good.calls)
        AL.raise_alarms('slotwatch', {'slot:x': 'idle 125'}, T + M(121), sp, log_path=lp, sender=good)
        check('raise: tier 1 re-pushes after 2 h unacked', len(good.calls) == 2 and 'STILL' in good.calls[-1][0], good.calls)
        json.dump({'acks': [{'source': 'slotwatch', 'key': 'slot:*', 'until': AL._iso(T + dt.timedelta(days=1)),
                             'at': AL._iso(T + M(122))}]}, open(os.path.join(d, 'alarm-acks.json'), 'w'))
        AL.raise_alarms('slotwatch', {'slot:x': 'idle 300'}, T + M(300), sp, log_path=lp, sender=good)
        check('raise: acked key is not re-pushed', len(good.calls) == 2, good.calls)
        AL.raise_alarms('slotwatch', {}, T + M(305), sp, log_path=lp, sender=good)
        check('raise: CLEARED is pushed', len(good.calls) == 3 and 'CLEARED' in good.calls[-1][0], good.calls)
        AL.raise_alarms('goalwatch-fleet', {'goal:a/b@c': 'stuck'}, T, os.path.join(d, 'g.json'), log_path=lp, sender=good)
        check('raise: digest tier logs but never pushes', len(good.calls) == 3 and 'NEW     goalwatch-fleet goal:a/b@c' in open(lp).read())
        AL.one_shot('rollout-fleet', {'tidy-01': '60-min: FAIL'}, T, log_path=lp, sender=bad)
        check('one_shot: failed push queued', AL.outbox_status(d)[0] == 1)
        r3 = AL.flush_outbox(T + dt.timedelta(hours=25), d, sender=bad)
        check('outbox: gives up after 24 h, loudly', r3['gaveup'] == 1 and AL.outbox_status(d)[0] == 0
              and 'GAVEUP' in open(os.path.join(d, 'ALARMS-delivery.log')).read(), r3)
        check('outbox: the give-up stays visible for 24 h after the outbox empties',
              AL.gaveup_recent(d, T + dt.timedelta(hours=26))[0] == 1 and AL.gaveup_recent(d, T + dt.timedelta(hours=50))[0] == 0)
    with tempfile.TemporaryDirectory() as d:
        bad, good = Sender(False), Sender(True)
        for i in range(3):
            AL.deliver(f'subj{i}', f'body{i}', T + M(i), d, sender=bad)
        r = AL.flush_outbox(T + M(10), d, sender=good)
        check('outbox: the channel coming back sends ONE message for every delayed push', r['sent'] == 3 and len(good.calls) == 1
              and '3 delayed' in good.calls[0][0] and 'body2' in good.calls[0][1] and AL.outbox_status(d)[0] == 0, (r, good.calls))
        for i in range(50):
            AL.deliver(f'many{i}', 'b' * 290, T, d, sender=bad)
        good.calls.clear()
        r = AL.flush_outbox(T + M(10), d, sender=good)
        body = good.calls[0][1] if good.calls else ''
        check('outbox: a big backlog is sent in chunks that fit; nothing claimed is left out of the message',
              0 < r['sent'] < 50 and r['queued'] == 50 - r['sent'] and body.count('many') == r['sent'] and len(body) <= AL.BODY_MAX, r)
        for k in range(10):
            AL.flush_outbox(T + M(20 + 10 * k), d, sender=good)
        check('outbox: the rest goes on later runs', AL.outbox_status(d)[0] == 0, AL.outbox_status(d))
        good.calls.clear()
        AL.deliver('x', 'y', T, d, sender=bad)
        import fcntl
        held = os.open(os.path.join(d, '.alarm-outbox.lock'), os.O_RDWR)
        fcntl.flock(held, fcntl.LOCK_EX)
        try:
            r = AL.flush_outbox(T + M(10), d, sender=good)
            check('outbox: another flusher holding the lock -> this run skips (never waits, never sends twice)',
                  r['skipped'] and len(good.calls) == 0, r)
        finally:
            fcntl.flock(held, fcntl.LOCK_UN); os.close(held)
        check('outbox: the skipped row is still queued', AL.outbox_status(d)[0] == 1)


# ------------------------------------------------------------------------------------------------ pager.py
def t_pager(P):
    AL = P.AL
    check('tier: error pages', P.page_tier({'level': 'error', 'msg': 'canary-sched: BLOCKED H3 x'}) == 1)
    check('tier: KEEP digests', P.page_tier({'level': 'verdict', 'msg': 'VERDICT KEEP (+180) :: ok'}) == 2)
    check('tier: REVERT pages', P.page_tier({'level': 'verdict', 'msg': 'VERDICT REVERT (+90) :: deaths'}) == 1)
    check('tier: rollback incomplete pages', P.page_tier({'level': 'error', 'msg': 'ROLLBACK INCOMPLETE'}) == 1)
    check('tier: draw stall flag pages', P.page_tier({'level': 'flag', 'msg': 'x has waited 3.2 h for its draw'}) == 1)
    check('tier: other flags digest', P.page_tier({'level': 'flag', 'msg': 'x is closed but journalled y'}) == 2)
    check('tier: info logs', P.page_tier({'level': 'info', 'msg': 'canary-sched: launched x'}) == 3)
    check('tier: unknown level pages', P.page_tier({'level': 'weird', 'msg': 'x'}) == 1)
    check('key: digits and shas collapse', P.page_key({'run': 'r', 'level': 'error', 'msg': 'BLOCKED 12 abcdef1 x'}) ==
          P.page_key({'run': 'r', 'level': 'error', 'msg': 'BLOCKED 13 1234567 x'}))
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'page.jsonl')
        row = lambda ts, lvl, msg, run='r': json.dumps({'ts': ts, 'run': run, 'level': lvl, 'msg': msg}) + '\n'
        open(p, 'w').write(row('2026-11-06T10:00:00Z', 'error', 'old'))
        rows, st = P.read_new(p, {})
        check('relay: first run starts at the end (history not paged)', rows == [] and st['off'] == os.path.getsize(p), st)
        open(p, 'a').write(row('2026-11-06T11:00:00Z', 'error', 'new1') + '{"ts": "2026-11-06T11:01:00Z", "le')
        rows, st2 = P.read_new(p, st)
        check('relay: new complete rows only (a half line waits)', [r['msg'] for r in rows] == ['new1'], rows)
        open(p, 'a').write('vel": "error", "msg": "new2", "run": "r"}\n')
        rows, st3 = P.read_new(p, st2)
        check('relay: the completed half line is read next time', [r['msg'] for r in rows] == ['new2'], rows)
        os.rename(p, p + '.1')
        open(p, 'w').write(row('2026-11-06T11:00:30Z', 'error', 'dup-older') + row('2026-11-06T11:05:00Z', 'error', 'after-rot'))
        rows, st4 = P.read_new(p, st3)
        check('relay: a rotated file restarts at 0 and skips rows already relayed', [r['msg'] for r in rows] == ['after-rot'], rows)
        os.rename(p, p + '.2')
        open(p, 'w').write(row('2026-11-06T11:05:00Z', 'error', 'after-rot') + row('2026-11-06T11:05:00Z', 'error', 'SAME SECOND'))
        rows, _ = P.read_new(p, st4)
        check('relay: after a rotation a NEW row with the last timestamp is still relayed (identity, not time)',
              [r['msg'] for r in rows] == ['SAME SECOND'], rows)
    rows = [{'ts': '2026-11-06T11:59:00Z', 'run': 'a', 'level': 'error', 'msg': 'BLOCKED H3 a 1'},
            {'ts': '2026-11-06T11:59:00Z', 'run': 'a', 'level': 'verdict', 'msg': 'VERDICT KEEP (+180)'},
            {'ts': '2026-11-06T11:59:00Z', 'run': 'a', 'level': 'info', 'msg': 'launched'}]
    push, dig, held, sent = P.relay_plan(rows, {}, T)
    check('relay plan: error pushes, KEEP digests, info dropped', len(push) == 1 and len(dig) == 1 and not held, (push, dig))
    push2, _, held2, _ = P.relay_plan([dict(rows[0], msg='BLOCKED H3 a 2')], sent, T + M(30))
    check('relay plan: same shape inside 2 h held', not push2 and 'pushed' in held2[0][2], held2)
    push3, _, _, _ = P.relay_plan([dict(rows[0], msg='BLOCKED H3 a 2')], sent, T + M(130))
    check('relay plan: same shape after 2 h pushes again', len(push3) == 1)
    acks = [{'source': 'pager', 'key': 'a|error|*', 'until': AL._iso(T + M(600)), 'at': AL._iso(T)}]
    push4, _, held4, _ = P.relay_plan([rows[0]], {}, T, acks)
    check('relay plan: acked page held', not push4 and 'acked' in held4[0][2], held4)
    s, b = P.relay_message([(dict(rows[0], msg=f'm{i}'), 'k') for i in range(25)])
    check('relay message: one push, capped rows', '25 pages' in s and 'and 5 more' in b, s)
    check('for: 6h/2d/90m', P.parse_for('6h') == dt.timedelta(hours=6) and P.parse_for('2d') == dt.timedelta(days=2)
          and P.parse_for('90m') == M(90))
    log = ['2026-11-06T01:00:00Z NEW     goalwatch-fleet goal:hive-d/tidy@1 :: STUCK 3 h',
           '2026-11-06T02:00:00Z NEW     slotwatch slot:nodeploy:block:H2-refused :: NO canary deployed 60 min',
           '2026-11-06T03:00:00Z NEW     flowledger starved:hive-a :: hive-a starved',
           '2026-11-06T04:00:00Z CLEARED flowledger starved:hive-a :: hive-a starved',
           '2026-11-06T05:00:00Z EVENT   pager a|verdict :: 2026-11-06T04:59:00Z VERDICT KEEP (+180)',
           'garbage line']
    ev = P.parse_alarms_log(log)
    check('alarms log parse', len(ev) == 5, ev)
    s, b = P.digest_text(ev, T)
    check('digest: open page listed', 'slot:nodeploy:block:H2-refused' in b and '1 open page' in s, (s, b))
    check('digest: digest-tier sources counted', 'goalwatch-fleet: 1 / 0 / 1' in b and 'flowledger: 1 / 1 / 0' in b, b)
    check('digest: relayed digest pages listed', 'VERDICT KEEP' in b, b)


# ------------------------------------------------------------------------------------------------ alarmhead.slot_nodeploy
def t_slot(AH):
    tk = lambda m, dec, why: (T - M(m), dec, why)
    dep = [tk(m, 'BUSY', 'S1 canary declared: abc on hive-c | S7 x is live') for m in (200, 195)]
    hold = [tk(m, 'BUSY', 'S8 INSTALL-HOLD by servea-roll until 2026-11-06T14:00:00Z') for m in range(190, -1, -5)]
    key, line = AH.slot_nodeploy(dep + hold, T)
    check('slot: a LIVE install-hold with no canary for 190 min alarms (11-05)', key == 'slot:nodeploy:busy:S8-hold'
          and 'NO canary deployed for 190 min' in line, (key, line))
    key, _ = AH.slot_nodeploy(dep + hold[-10:], T)
    check('slot: 45 min without a canary is not yet an alarm', key is None)
    key, line = AH.slot_nodeploy(dep + hold + [tk(0, 'BUSY', 'S1 canary declared: x on y')], T)
    check('slot: a deployed canary clears it', key is None and 'deployed' in line, line)
    ref = [tk(m, 'BLOCK', 'H2 dropdig-01: no variant for the fleet base 4f3b0f5 (have: x): autorebase REFUSED at step repo')
           for m in range(95, -1, -5)]
    key, _ = AH.slot_nodeploy(dep + ref, T)
    check('slot: cause names the refusal', key == 'slot:nodeploy:block:H2-refused', key)
    flap = ref[:-1] + [tk(0, 'WAIT', 'H2 dropdig-01: autorebase of x is building (step suite)')]
    key, _ = AH.slot_nodeploy(dep + flap, T)
    check('slot: a one-tick cause does not re-key (needs 2 ticks)', key == 'slot:nodeploy:block:H2-refused', key)
    two = ref[:-2] + [tk(m, 'WAIT', 'H2 dropdig-01: autorebase of x is building (step suite)') for m in (5, 0)]
    key, _ = AH.slot_nodeploy(dep + two, T)
    check('slot: a cause held 2 ticks re-keys', key == 'slot:nodeploy:wait:H2-building', key)
    alt = [tk(m, 'WAIT' if (m // 5) % 2 else 'BLOCK', 'H1 x: not before 2026-11-07T00:00:00Z' if (m // 5) % 2 else
              'H3 x: blocked since its last attempt') for m in range(95, -1, -5)]
    k1, _ = AH.slot_nodeploy(dep + alt, T)
    k2, _ = AH.slot_nodeploy(dep + alt[:-1], T - M(5))
    check('slot: alternating causes give ONE stable key (no push every 5 min)', k1 == k2 == 'slot:nodeploy:mixed', (k1, k2))
    k3, _ = AH.slot_nodeploy(dep + alt, T, prev_key='slot:nodeploy:block:H3')
    k4, _ = AH.slot_nodeploy(dep + alt[:-1], T - M(5), prev_key='slot:nodeploy:block:H3')
    check('slot: the pushed cause is sticky while it still shows', k3 == k4 == 'slot:nodeploy:block:H3', (k3, k4))
    h3 = [tk(m, 'BLOCK', 'H3 x: blocked since its last attempt') for m in range(95, 5, -5)]
    nb2 = [tk(m, 'WAIT', 'H1 x: not before 2026-11-07T00:00:00Z') for m in (5, 0)]
    k6, _ = AH.slot_nodeploy(dep + h3 + nb2, T, prev_key='slot:nodeploy:block:H3')
    check('slot: two ticks of a new cause do not re-key a cause still in the recent ticks', k6 == 'slot:nodeploy:block:H3', k6)
    k5, _ = AH.slot_nodeploy(dep + ref, T, prev_key='slot:nodeploy:busy:S8-hold')
    check('slot: a cause gone from the recent ticks re-keys', k5 == 'slot:nodeploy:block:H2-refused', k5)
    key, _ = AH.slot_nodeploy(dep[:1] + [tk(m, 'BUSY', 'S2 running: canary-loop.sh (pid 1)') for m in range(190, -1, -5)], T)
    check('slot: a loop that never deploys (draw stall) alarms', key == 'slot:nodeploy:busy:S2-loop', key)
    key, _ = AH.slot_nodeploy(dep[:1], T)
    check('slot: no tick for 195 min is the scheduler key', key == 'slot:scheduler', key)
    check('slot: no ticks at all is the scheduler key', AH.slot_nodeploy([], T)[0] == 'slot:scheduler')
    check('cause: launch', AH.tick_cause('LAUNCH', 'x') == 'launch')
    check('cause: H1 dependency', AH.tick_cause('WAIT', 'H1 idlework-01: waits for stuckproj-01 to close (live)') == 'wait:H1-after')
    check('cause: H1 held', AH.tick_cause('BLOCK', 'H1 townfloor-01: held: PREREQUISITE') == 'block:H1-held')


# ------------------------------------------------------------------------------------------------ goalwatch.town_blocked
def t_town(G):
    goals = [{'key': 'goal:hive-d/monument@1_2_3', 'stuck': True}, {'key': 'goal:hive-d/tidy@1_2_3', 'stuck': True},
             {'key': 'goal:hive-a/wall@4_5_6', 'stuck': True}, {'key': 'goal:hive-a/shop@4_5_6', 'stuck': False}]
    out = G.town_blocked(goals)
    check('town: all open projects stuck -> town key', list(out) == ['town:hive-d'] and 'monument, tidy' in out['town:hive-d'], out)
    check('town: no goals -> nothing (that is hourwatch\'s count)', G.town_blocked([]) == {})


# ------------------------------------------------------------------------------------------------ stuckwatch
def t_stuck(S):
    since = T - M(240)
    f = lambda first, last, npos: {'first': first, 'last': last, 'pos': {(i, 64, i) for i in range(npos)}}
    facts = {'pinned': f(since + M(2), T - M(1), 1), 'moving': f(since + M(1), T - M(1), 40),
             'rotated': f(T - M(17), T - M(1), 1),            # the 00:17Z run: rows only since the 23:59Z rotation
             'silent': f(since + M(1), T - M(60), 2)}
    p, mv, u = S.judge_pins(facts, since, T)
    check('stuck: a covered bot at one cell is pinned', p == ['pinned'], p)
    check('stuck: rows only since the rotation are NOT a pin', 'rotated' in u, u)
    check('stuck: a bot silent for an hour is not judged', 'silent' in u, u)
    check('stuck: movement counted', mv == ['moving'], mv)
    check('stuck: the walk loads rotated files', S.LOGS.endswith('.jsonl*'), S.LOGS)


# ------------------------------------------------------------------------------------------------ hourwatch
def t_hour(H):
    cur, prev = H.value_windows(T.replace(minute=25))
    check('value windows: 2 closed hours after 24', len(cur) == 2 and len(prev) == 24 and cur[-1] == T - M(60)
          and prev[-1] == T - M(180), (cur, prev))
    hrs = lambda v, n, bh=40.0: [{'value': v * bh, 'bot_hours': bh} for _ in range(n)]
    line, s, ok = H.value_check(hrs(9.9, 2), hrs(16.14, 24))
    check('value: the 11-05 drop (16.14 -> 9.90) alarms', ok and line and 'VALUE DROP -39%' in line, (line, s))
    line, s, ok = H.value_check(hrs(13.0, 2), hrs(16.14, 24))
    check('value: -19% does not alarm', ok and line is None, s)
    line, s, ok = H.value_check(hrs(1.0, 2, bh=5.0), hrs(16.14, 24))
    check('value: a thin current window is NOT JUDGED (not a drop)', not ok and line is None and 'NOT JUDGED' in s, s)
    line, s, ok = H.value_check(hrs(9.9, 2), hrs(16.14, 10) + [None] * 14)
    check('value: thin history is NOT JUDGED', not ok and line is None, s)
    lo, hi = T - M(60), T
    lap = {f'b{i}': [(lo + M(j * 2), 'patrol' if i < 30 else 'gather_iron_ore_3') for j in range(30)] for i in range(50)}
    r = H.lap_share(lap, lo, hi)
    check('lap: 30 of 50 bots lapping = 60%', abs(r['share'] - 0.6) < 0.01 and r['bots'] == 50, r['share'])
    line, s, ok = H.lap_check(r)
    check('lap: 60% alarms', ok and line and 'IDLE LAP 60%' in line, (line, s))
    r2 = H.lap_share({f'b{i}': [(lo + M(j * 2), 'gather_iron_ore_3') for j in range(30)] for i in range(50)}, lo, hi)
    line, s, ok = H.lap_check(r2)
    check('lap: 0% lap is judged but no alarm', ok and line is None, s)
    r3 = H.lap_share({f'b{i}': [(lo + M(j * 2), None) for j in range(30)] for i in range(50)}, lo, hi)
    check('lap: unnamed milestones are NOT JUDGED (not 0%)', not H.lap_check(r3)[2])
    # 90% of DECISIONS named but they hold almost no TIME (Codex review r1): not judged
    skew = {f'b{i}': [(lo + dt.timedelta(seconds=j), 'gather') for j in range(90)] +
                     [(lo + dt.timedelta(seconds=90) + M(6 * k), None) for k in range(10)] for i in range(50)}
    rs = H.lap_share(skew, lo, hi)
    check('lap skew fixture: 90% of decisions named, ~3% of time, full coverage', rs['named_rows'] == 0.9 * rs['rows']
          and rs['named_s'] < 0.05 * rs['total_s'] and rs['total_s'] > 0.9 * 50 * 3600, rs)
    check('lap: attribution is judged by time, not by decision count', not H.lap_check(H.lap_share(skew, lo, hi))[2])
    r4 = H.lap_share({f'b{i}': [(lo + M(j * 2), 'patrol') for j in range(30)] for i in range(10)}, lo, hi)
    check('lap: 10 bots is NOT JUDGED', not H.lap_check(r4)[2])
    gap = H.lap_share({'b': [(lo, 'patrol'), (lo + M(50), 'gather')]}, lo, hi)
    check('lap: a slice is capped at 10 min', abs(gap['lap_s'] - 600) < 1, gap)
    towns = {f't{i}' for i in range(16)}
    gr = {'generated_at': AL_iso(T - M(10)), 'records_scanned': 90,
          'goals': [{'key': f'goal:t{i}/shop@1', 'stuck': i in (3, 4)} for i in range(5, 16)] +
                   [{'key': 'goal:t3/m@1', 'stuck': True}, {'key': 'goal:t4/m@1', 'stuck': True}]}
    line, s, ok, bad = H.town_check(gr, towns, T)
    check('towns: 3 with no open project + 2 all stuck = 5 > 2 alarms', ok and line and len(bad) == 5
          and bad['t0'] == 'no open project' and 'stuck' in bad['t3'], (line, bad))
    gr2 = dict(gr, goals=[{'key': f'goal:t{i}/shop@1', 'stuck': False} for i in range(1, 16)])
    line, s, ok, bad = H.town_check(gr2, towns, T)
    check('towns: 1 unworkable does not alarm', ok and line is None and list(bad) == ['t0'], bad)
    line, s, ok, _ = H.town_check(dict(gr, generated_at=AL_iso(T - M(120))), towns, T)
    check('towns: stale goalwatch is NOT JUDGED', not ok and line is None, s)


def AL_iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


# ------------------------------------------------------------------------------------------------ mutants
MUTANTS = [
    ('lib/alarm.py', "    if not (code.isdigit() and code.startswith('2')):\n        return False, f'HTTP {code or \"?\"}'",
     "    if False:\n        return False, ''", 'alarm'),
    ('lib/alarm.py', "    if rc != 0:\n        return False, f'curl exit {rc}'", "    if False:\n        return False, ''", 'alarm'),
    ('lib/alarm.py', "            if not json.loads(body.strip().splitlines()[-1]).get('id'):", "            if False:", 'alarm'),
    ('lib/alarm.py', "    return bool(res) and any(res.get(k) is True for k in ('webhook', 'email'))", "    return True", 'alarm'),
    ('lib/alarm.py', "    if not ok:\n        row = {'at'", "    if False:\n        row = {'at'", 'alarm'),
    ('lib/alarm.py', "    return REPUSH_PAGE if tier == TIER_PAGE and not acked else REPUSH", "    return REPUSH", 'alarm'),
    ('lib/alarm.py', "        if tr != TIER_PAGE:\n            held.append", "        if False:\n            held.append", 'alarm'),
    ('lib/alarm.py', "        a = find_ack(acks, source, key, now) if kind != 'CLEARED' else None", "        a = None", 'alarm'),
    ('lib/alarm.py', "        if until is None or until <= now:\n            continue", "        if until is None:\n            continue", 'alarm'),
    ('lib/alarm.py', "        if now - first >= OUTBOX_GIVEUP:", "        if False:", 'alarm'),
    ('lib/alarm.py', "        elif outbox_due(r, now):", "        elif True:", 'alarm'),
    ('lib/alarm.py', "        if _with_outbox(digest_dir, claim, blocking=False) is None:",
     "        if _with_outbox(digest_dir, claim, blocking=False) is None and False:", 'alarm'),
    ('lib/alarm.py', "    if len(due) == 1:\n        return str(due[0].get('subject')), str(due[0].get('body'))[:BODY_MAX]",
     "    if True:\n        return str(due[0].get('subject')), str(due[0].get('body'))[:BODY_MAX]", 'alarm'),
    ('lib/alarm.py', "        if take and n + ln > limit:\n            break", "        if False:\n            break", 'alarm'),
    ('lib/alarmhead.py', "    if prev and causes[:recent].count(prev) >= min_ticks:\n        return prev",
     "    if False:\n        return prev", 'slot'),
    ('lib/alarm.py', "        return TIER_PAGE if str(key).startswith(('town:', 'goalwatch:')) else TIER_DIGEST",
     "        return TIER_PAGE", 'alarm'),
    ('lib/alarm.py', "    if s in DIGEST_SOURCES:\n        return TIER_DIGEST", "    if False:\n        return TIER_DIGEST", 'alarm'),
    ('pager.py', "    if not st:\n        return [], {'ino'", "    if False:\n        return [], {'ino'", 'pager'),
    ('pager.py', "        if restart and st.get('last_ts') and (ts < st['last_ts']", "        if False and (ts < st['last_ts']", 'pager'),
    ('pager.py', "    end = data.rfind(b'\\n') + 1", "    end = len(data)", 'pager'),
    ('pager.py', "        elif last is not None and now - last < dedup:", "        elif False:", 'pager'),
    ('pager.py', "        return AL.TIER_PAGE if PAGE_WORDS.search(msg) else AL.TIER_DIGEST\n    if level == 'flag':",
     "        return AL.TIER_DIGEST\n    if level == 'flag':", 'pager'),
    ('pager.py', "    if level == 'error':\n        return AL.TIER_PAGE", "    if level == 'error':\n        return AL.TIER_DIGEST", 'pager'),
    ('lib/alarmhead.py', "    if t_last - start < idle:\n        return None, f'canary slot: no canary deployed",
     "    if True:\n        return None, f'canary slot: no canary deployed", 'slot'),
    ('lib/alarmhead.py', "        if deployed(w):\n            bounded = True", "        if 'BUSY' in d:\n            bounded = True", 'slot'),
    ('lib/alarmhead.py', "        if j - i >= min_ticks:\n            return causes[i]", "        if j - i >= 1:\n            return causes[i]", 'slot'),
    ('lib/alarmhead.py', "    return f'slot:nodeploy:{cause}'", "    return 'slot:nodeploy'", 'slot'),
    ('goalwatch.py', "        if gs and all(g.get('stuck') for g in gs):", "        if gs and any(g.get('stuck') for g in gs):", 'town'),
    ('stuckwatch.py', "        elif f.get('first') is None or f['first'] > since + cover or f.get('last') is None or f['last'] < now - fresh:",
     "        elif f.get('first') is None:", 'stuck'),
    ('stuckwatch.py', "LOGS = '/var/log/mcai/*/skill-*.jsonl*'", "LOGS = '/var/log/mcai/*/skill-*.jsonl'", 'stuck'),
    ('hourwatch.py', "    if pv > 0 and cv < (1 - drop) * pv:", "    if pv > 0 and cv < drop * pv:", 'hour'),
    ('hourwatch.py', "    if cv is None or cbh < min_cur_bh:", "    if cv is None:", 'hour'),
    ('hourwatch.py', "    if sh > lap_max:", "    if sh > 0.9:", 'hour'),
    ('hourwatch.py', "    if res.get('named_s', 0.0) < MIN_NAMED * res['total_s']:", "    if res['named_rows'] < MIN_NAMED * res['rows']:", 'hour'),
    ('pager.py', "(ts == st['last_ts'] and row_id(r) in seen_at_last)", "(ts == st['last_ts'])", 'pager'),
    ('lib/alarm.py', "        _delivery_mark(digest_dir, 'last_gaveup', {'at': _iso(now), 'n': stats['gaveup']})", "        pass", 'alarm'),
    ('hourwatch.py', "        end = min(ds[i + 1][0] if i + 1 < len(ds) else hi, t + cap, hi)",
     "        end = min(ds[i + 1][0] if i + 1 < len(ds) else hi, hi)", 'hour'),
    ('hourwatch.py', "        elif all(g.get('stuck') for g in gs):", "        elif False:", 'hour'),
    ('hourwatch.py', "    if gen is None or now - gen > stale:", "    if gen is None:", 'hour'),
    ('hourwatch.py', "    if len(bad) > towns_max:", "    if len(bad) > 10:", 'hour'),
]
TESTS = {'alarm': lambda m: t_alarm(m['lib/alarm.py']), 'pager': lambda m: t_pager(m['pager.py']),
         'slot': lambda m: t_slot(m['lib/alarmhead.py']), 'town': lambda m: t_town(m['goalwatch.py']),
         'stuck': lambda m: t_stuck(m['stuckwatch.py']), 'hour': lambda m: t_hour(m['hourwatch.py'])}


def load_all(over=None):
    over = over or {}
    AL = load('lib/alarm.py', over.get('lib/alarm.py'))
    mods = {'lib/alarm.py': AL}
    for n in ('lib/alarmhead.py', 'pager.py', 'goalwatch.py', 'hourwatch.py', 'stuckwatch.py'):
        mods[n] = load(n, over.get(n), AL=AL)
    return mods


def main():
    mods = load_all()
    for t in TESTS.values():
        t(mods)
    base = list(FAILS)
    for f in base:
        print('FAIL', f)
    killed = 0
    for fn, old, new, test in MUTANTS:
        src = open(PATHS[fn]).read()
        assert src.count(old) == 1, f'MUTANT ANCHOR MISSING OR NOT UNIQUE in {fn}: {old!r} x{src.count(old)}'
        FAILS.clear()
        try:
            m = load_all({fn: src.replace(old, new)})
            with contextlib.redirect_stdout(io.StringIO()):
                TESTS[test](m)
        except Exception as e:      # a crash is a kill too, but say so
            FAILS.append(f'crash {type(e).__name__}: {e}')
        if FAILS:
            killed += 1
        else:
            print(f'MUTANT SURVIVED: {fn}: {old.strip()[:80]!r}')
    FAILS[:] = base
    print(f'pager tests: {"FAIL" if base else "ok"} ({len(base)} failures); mutants killed {killed}/{len(MUTANTS)}')
    return 1 if base or killed < len(MUTANTS) else 0


if __name__ == '__main__':
    sys.exit(main())
