#!/usr/bin/env python3
"""Tests for statusreport.py's pure parts (the rules, the schedule, the narrative check): python3 -B scripts/host/test_statusreport.py

Every check is a function of the module, so each MUTANT below (one changed line of statusreport.py, its anchor asserted
present and unique) re-runs the check it should break against the mutated module and must FAIL there."""
import copy
import datetime as dt
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'statusreport.py')
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 7, 12, 3, tzinfo=UTC)          # 6:03 AM CST
FAILS = []


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


R = load(SRC, 'statusreport_under_test')


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok:
        FAILS.append(name)


def ts_(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def T(h, m=0, day=7, month=11):
    return dt.datetime(2026, month, day, h, m, tzinfo=UTC)


def base():
    """A healthy fleet: nothing should be reported as broken."""
    return {
        'generated_at': '2026-11-07T12:03:00Z', 'since': '2026-11-07T06:03:00Z', 'window_h': 6, 'errors': {},
        'bots': {'running': 80, 'expected': 80,
                 'win': {'active_bot_hours': 480.0, 'deaths': 3, 'deaths_by_cause': {'fall': 3}, 'actions': {}},
                 'day': {'active_bot_hours': 1920.0, 'deaths': 12}, 'week': {'active_bot_hours': 13440.0, 'deaths': 121}},
        'value': {'cur': 30.0, 'cur_bh': 480, 'cur_h': 6, 'prev': 29.0, 'prev_bh': 1920, 'daily': []},
        'bags': {'bots': 80, 'median': 27, 'full': 5, 'at36': 2},
        'flow': {'cobble_new': 1000, 'cobble_well': 200, 'well_share': 0.2},
        'built': {'completed': [], 'started': [], 'buildings': {'a': 2}, 'buildings_prev': {'a': 2}},
        'goals': {'read': True, 'open': 3, 'records': 50, 'stuck': [], 'blocked_towns': []},
        'projects': {'counts': {'EFFECTIVE': 5}, 'attention': []},
        'worlds': {'worlds': [{'world': 'a', 'up': True}], 'down': [], 'slow': {}, 'disk_high': {}, 'backup_bad': []},
        'showcase': {'units': [13, 13], 'rollouts': [], 'halts': [], 'stuck': []},
        'canary': {'closed': [], 'running': [{'run': 'x-01'}], 'next': [], 'slot_empty': False, 'effect_worse': []},
        'alarms': {'owner': [], 'operator': {}, 'acked': 0, 'pending': []},
    }


def texts(items):
    return ' | '.join(t for _, t in items)


# --------------------------------------------------------------------------------------------- the checks
def ck_slot_cst(M):
    return (M.due_slot(T(12, 3)) == '2026-11-07 06:00' and M.due_slot(T(11, 3)) is None
            and M.due_slot(T(6, 3)) == '2026-11-07 00:00' and M.due_slot(T(18, 3)) == '2026-11-07 12:00'
            and M.due_slot(T(0, 3, day=8)) == '2026-11-07 18:00' and M.due_slot(T(23, 3)) is None)


def ck_slot_cdt(M):
    # July: CDT = UTC-5, so 6 AM is 11:00Z and 12:03Z is 7:03 AM (no slot)
    return (M.due_slot(T(11, 3, day=1, month=7)) == '2026-07-01 06:00' and M.due_slot(T(12, 3, day=1, month=7)) is None
            and M.due_slot(T(5, 3, day=1, month=7)) == '2026-07-01 00:00')


def ck_slot_grace(M):
    return M.due_slot(T(12, 39)) == '2026-11-07 06:00' and M.due_slot(T(12, 41)) is None


def ck_window(M):
    return (M.window_hours(None, NOW) == 6 and M.window_hours(NOW - dt.timedelta(hours=6, minutes=4), NOW) == 6
            and M.window_hours(NOW - dt.timedelta(hours=30), NOW) == 24 and M.window_hours(NOW - dt.timedelta(minutes=9), NOW) == 1)


def ck_healthy_quiet(M):
    j = M.judge(base())
    return not j['didnt'] and not j['stalled'] and not j['unread'] and M.mood(j) == 'GOOD'


def ck_death_spike(M):
    f = base()
    f['bots']['win']['deaths'] = 9            # 9 in 480 bot-h vs 121/13440 x 480 = 4.3 expected
    j = M.judge(f)
    g = base()
    g['bots']['win'].update(deaths=2, active_bot_hours=48.0)   # a high rate but below the 3-death floor: never a 'didn't'
    return 'more deaths than usual: 9' in texts(j['didnt']) and 'more deaths' not in texts(M.judge(g)['didnt'])


def ck_fewer_deaths(M):
    f = base()
    f['bots']['win']['deaths'] = 1
    return 'fewer deaths than usual: 1' in texts(M.judge(f)['worked'])


def ck_value(M):
    up, down, flat = base(), base(), base()
    up['value']['cur'] = 40.0
    down['value']['cur'] = 20.0
    flat['value']['cur'] = 30.5
    return ('production up 38%' in texts(M.judge(up)['worked']) and 'production down 31%' in texts(M.judge(down)['didnt'])
            and 'production' not in texts(M.judge(flat)['worked'] + M.judge(flat)['didnt']))


def ck_unread_no_verdict(M):
    """An unreadable source never yields 'worked' or 'didn't': value and bots missing, only 'could not read'."""
    f = base()
    f.pop('value')
    f['bots'] = {}
    f['errors'] = {'production (valuescore / hourwatch)': 'OSError: gone'}
    try:
        j = M.judge(f)
    except Exception:
        return False
    return ('production' not in texts(j['worked'] + j['didnt']) and 'could not read production' in texts(j['unread'])
            and 'bots are not running' not in texts(j['didnt']))


def ck_bots_down(M):
    f = base()
    f['bots']['running'] = 77
    j = M.judge(f)
    return '3 of 80 bots are not running' in texts(j['didnt']) and M.mood(j) == 'NEEDS A LOOK'


def ck_world_down_first(M):
    f = base()
    f['worlds']['down'] = ['hive-c']
    f['canary']['closed'] = [{'run': 'a-01', 'verdict': 'REVERT', 't': '2026-11-07T10:00:00Z'}]
    j = M.judge(f)
    return j['didnt'][0][1] == 'world hive-c is DOWN' and M.headline(f, j)[2].startswith('Biggest problem: world hive-c')


def ck_canary(M):
    f = base()
    f['canary']['closed'] = [{'run': 'good-01', 'verdict': 'KEEP', 't': 'x', 'title': 'Better bags'},
                             {'run': 'bad-01', 'verdict': 'REVERT', 't': 'x'},
                             {'run': 'meh-01', 'verdict': 'INCONCLUSIVE', 't': 'x'}]
    j = M.judge(f)
    return ('kept good-01 (Better bags)' in texts(j['worked']) and 'reverted bad-01' in texts(j['didnt'])
            and 'meh-01' not in texts(j['worked'] + j['didnt']))


def ck_stuck_and_unstuck(M):
    prev = base()
    prev['goals']['stuck'] = [{'key': 'goal:board-b/tidy@1_2_3', 'town': 'board-b', 'plot': 'tidy', 'hours': 4, 'why': ''},
                              {'key': 'goal:hive-a/wall@1_2_3', 'town': 'hive-a', 'plot': 'wall', 'hours': 20, 'why': ''}]
    f = base()
    f['goals']['stuck'] = [prev['goals']['stuck'][1]]
    f['goals']['blocked_towns'] = ['hive-a']
    j = M.judge(f, prev)
    return ('hive-a town wall stuck 20 h' in texts(j['stalled']) and 'hive-a: no town work' in texts(j['stalled'])
            and 'moving again: board-b town clean-up' in texts(j['worked']))


def ck_bags(M):
    f, prev = base(), base()
    f['bags']['full'] = 30
    prev['bags']['full'] = 2
    g = base()
    g['bags']['full'] = 1
    prev2 = base()
    prev2['bags']['full'] = 9
    return ('bags filling up: 30 of 80' in texts(M.judge(f, prev)['didnt'])
            and 'bags emptier: 1 bots' in texts(M.judge(g, prev2)['worked']))


def ck_showcase_halt(M):
    f = base()
    f['showcase']['halts'] = [('2026-11-07T08:00:00Z', '2026-11-07T08:20:00Z', 'SHOWCASE BOTS DOWN -- x')]
    back = [x for x in M.judge(f)['didnt'] if 'showcase bots were down' in x[1]]
    f['showcase']['units'] = [5, 13]
    down = [x for x in M.judge(f)['didnt'] if 'showcase bots were down' in x[1]]
    return back and back[0][0] == 35 and 'all back now' in back[0][1] and down and down[0][0] == 7 and '25 min' in back[0][1]


def ck_showcase_deaths(M):
    f = base()
    f['showcase'].update(deaths=3, bot_hours=78.0, rate_7d=0.01, death_causes={'drowning': 2})
    g = copy.deepcopy(f)
    g['showcase']['rate_7d'] = 0.05             # 3.9 expected: 3 is not a spike
    return ('showcase: 3 deaths in the last 6 h vs about 0.8 expected' in texts(M.judge(f)['didnt'])
            and 'showcase: 3 deaths' not in texts(M.judge(g)['didnt']))


def ck_finished(M):
    f = base()
    f['built']['completed'] = [('board-a', 'wall', '2026-11-07T09:00:00Z')]
    f['built']['buildings'] = {'a': 3}
    return ('1 project(s) finished: board-a town wall' in texts(M.judge(f)['worked'])
            and '1 more building(s)' in texts(M.judge(f)['worked']))


def ck_narrative_ok(M):
    src = 'Deaths 1,234 in 480 bot-hours at 6:00 AM; value 49.5.'
    good = ('In short\n- Going fine: 1234 deaths in 480 bot-hours, value 49.5 at 6:00 AM.\nWhat worked\n- x\n'
            "What didn't\n- y\nWhat's stalled\n- z\nWhat needs you\n- Nothing right now.")
    return M.check_narrative(good, src) == (True, 'ok')


def ck_narrative_new_number(M):
    src = 'Deaths 12 in 480 bot-hours.'
    bad = "In short\n- 13 deaths\nWhat worked\n- x\nWhat didn't\n- y\nWhat's stalled\n- z\nWhat needs you\n- n"
    ok, why = M.check_narrative(bad, src)
    return not ok and '13' in why


def ck_narrative_parts(M):
    src = 'Deaths 12.'
    miss = 'In short\n- 12 deaths\nWhat worked\n- x'
    sha = "In short\n- kept e447b65b\nWhat worked\n- x\nWhat didn't\n- y\nWhat's stalled\n- z\nWhat needs you\n- n"
    return (not M.check_narrative(miss, src)[0] and not M.check_narrative(sha, src + ' e447b65b')[0]
            and not M.check_narrative('', src)[0] and not M.check_narrative('x' * 4000, src)[0])


def ck_narrative_words(M):
    src = 'Deaths 0 in 6 h. 3 of 80 bots.'
    base_ = "In short\n- {}\nWhat worked\n- x\nWhat didn't\n- y\nWhat's stalled\n- z\nWhat needs you\n- Nothing right now."
    bad = [base_.format(x) for x in ('Bots dead: six.', 'six bots died', 'Ninety-nine bots died', 'half the bots are stuck', 'two towns are blocked',
                                     'deaths doubled' if False else 'twice as many deaths', 'one bot died')]
    good = [base_.format(x) for x in ('3 of 80 bots are stuck, no one knows why', 'one of the towns is blocked', 'Deaths 0 in 6 h',
                                      '3 of 80 bots stuck in one spot')]
    src += ' 3 of 80 bots stuck in one spot. sixteen bots running.'
    return all(not M.check_narrative(b, src)[0] for b in bad) and all(M.check_narrative(g, src)[0] for g in good)


def ck_unread_mood(M):
    f = base()
    f['errors'] = {'alarms': 'OSError: x'}
    f.pop('alarms')
    j = M.judge(f)
    md = M.render(f, j, NOW)
    return (M.mood(j) == 'PARTLY UNKNOWN' and 'Biggest problem: could not read alarms' in M.headline(f, j)[2]
            and 'cannot say that nothing needs you' in md and 'nothing needs you right now' not in md)


def ck_numbers(M):
    return M.numbers_in('a 1,234 b 06 c 5.0 d 0.25 e -3') == {'1234', '6', '5', '0.25', '-3'}


def ck_owner_alarms(M):
    active = {('goalwatch-fleet', 'town:board-b'): ('t', 'goalwatch-fleet', 'TOWN BLOCKED board-b'),
              ('goalwatch-fleet', 'goal:board-b/tidy@1'): ('t', 'goalwatch-fleet', 'STUCK'),
              ('promomerge', 'conflict:abc'): ('t', 'promomerge', 'does not merge'),
              ('stuckwatch', 'pin:bot-a'): ('t', 'stuckwatch', 'PINNED')}
    tier = lambda s, k: 2 if k.startswith('goal:') else 1
    acks = [{'source': 'stuckwatch', 'key': 'pin:*'}]
    find = lambda acks, s, k, now: next((a for a in acks if a['source'] == s and k.startswith(a['key'][:-1])), None)
    a = M.owner_alarms(active, acks, NOW, tier, find, [('row-1', 'pick A or B?')])
    return (a['owner'] == [('goalwatch-fleet', 'town:board-b', 'TOWN BLOCKED board-b')] and a['operator'] == {'promomerge': 1}
            and a['acked'] == 1 and a['pending'] == [('row-1', 'pick A or B?')])


def ck_parsers(M):
    st = M.parse_stuck('STUCK 4.6 h: board-c/shaft@355_73_147 -- last progress 11-06 19:26Z; blocker: last _build_visit '
                       '23:40Z by board-c-Bravo: outcome=walk_failed stop=walk_failed why=did_not_reach_342,18,122_(at_343,'
                       '28,123)_at_step_51:_dug_0,_placed_0_--_the_stair_is_blocked_above_the_work;_the_next_vi; visits')
    pin = M.parse_pinned('2026-11-06T23:47:01Z 2 of 80 bots PINNED for >= 240 min (x):\n  isolated-d-Delta       at '
                         '(359, 58, 180)     items 1 | y\n')
    eff = M.effect_text('EFFECT dirtrung-01 h24 WORSE: kind.rate.v1{"name": "gather"} 19.83 (25,892/1,305) -> 6.12 '
                        '(5,633/920) -69.1% (noise x/1.16)')
    led = {'items': [{'id': 'idlework2-1106', 'title': 'Bags full after idlework-01 (Grafana): idle batches stop'},
                     {'id': 'stations-1106', 'title': "Crafting tables and furnaces (owner 11-06: 'pick up')"}]}
    return (st and st['town'] == 'board-c' and st['plot'] == 'shaft' and st['hours'] == 4.6
            and st['why'] == 'the stair is blocked above the work'
            and pin == {'n': 2, 'of': 80, 'at': '2026-11-06T23:47:01Z', 'bots': [('isolated-d-Delta', '359, 58, 180')]}
            and eff == 'kept change dirtrung-01 made things worse: gather rate 19.83 -> 6.12 (-69.1%) in the 24 h after it'
            and M.title_of('idlework-02', led) == 'Bags full after idlework-01'
            and M.title_of('stations-01', led) == 'Crafting tables and furnaces' and M.title_of('nope-01', led) is None)


def ck_windows_of_time(M):
    # 30 closed hours to 12:00Z (the last 6 worth 2.5/bot-h, the 24 before 1.25) + the open 12:00 hour (must be ignored)
    hours = [{'hour': (T(12) - dt.timedelta(hours=i)).strftime('%Y-%m-%dT%H:00:00Z'), 'value': 200.0 if i <= 6 else 100.0,
              'bot_hours': 80.0} for i in range(1, 31)] + [{'hour': '2026-11-07T12:00:00Z', 'value': 9999.0, 'bot_hours': 80.0}]
    v = M.value_window(hours, T(12, 3), 6)
    lag = M.value_window([h for h in hours if h['hour'] != '2026-11-07T11:00:00Z'], T(12, 3), 6)   # 11:00 not cached yet
    part = M.value_window([h for h in hours if h['hour'][11:13] not in ('07', '08', '09')], T(12, 3), 6)  # 3 of 6 hours
    old = M.value_window([dict(h, hour=(ts_(h['hour']) - dt.timedelta(days=3)).strftime('%Y-%m-%dT%H:00:00Z'))
                          for h in hours], T(12, 3), 6)
    eps = M.halt_episodes([{'t': '2026-11-07T08:00:01Z', 'event': 'halt', 'ok': False, 'why': 'a'},
                           {'t': '2026-11-07T08:05:01Z', 'event': 'halt', 'ok': False, 'why': 'a'},
                           {'t': '2026-11-07T08:10:01Z', 'event': 'running', 'ok': True},
                           {'t': '2026-11-07T09:00:01Z', 'event': 'halt', 'ok': False, 'why': 'b'}])
    recs = [('board-a', 'wall', {'completeAt': T(9).timestamp() * 1000, '_first_at': T(1).timestamp() * 1000}),
            ('hive-a', 'tidy', {'_first_at': T(8).timestamp() * 1000})]
    done, started = M.finished_projects(recs, T(6), T(12))
    return (v['cur'] == 2.5 and v['prev'] == 1.25 and v['cur_h'] == 6 and v['prev_h'] == 24 and len(eps) == 2
            and lag['end'] == '2026-11-07T11:00:00Z' and lag['cur_h'] == 6 and old['cur'] is None and old['prev'] is None
            and part['cur'] is None and part['cur_h'] == 3
            and eps[0][1] == T(8, 5).replace(second=1) and done == [('board-a', 'wall', '2026-11-07T09:00:00Z')]
            and started == [('hive-a', 'tidy', '2026-11-07T08:00:00Z')])


def ck_backups(M):
    ok = [{'check': 'fleet world backup', 't': '2026-11-07T11:25:01Z', 'ok': True, 'line': 'fleet OK'},
          {'check': 'showcase world backup', 't': '2026-11-07T11:35:01Z', 'ok': True, 'line': 'show OK'},
          {'check': 'log store (ES) backup', 't': '2026-11-07T06:20:01Z', 'ok': True, 'line': 'es OK'}]
    old_generic = [{'check': 'world backup', 't': '2026-10-20T14:35:01Z', 'ok': False, 'line': 'world backup ALARM old'}]
    show, bad = M.backup_facts(ok + old_generic, NOW)            # history: both world checks passed after it
    # the showcase check's newest row is a 2-day-old ALARM: still a problem (an unrelated newer OK never clears it)
    stuck = [ok[0], ok[2], {'check': 'showcase world backup', 't': '2026-11-05T11:35:01Z', 'ok': False, 'line': 'show ALARM'}]
    _, bad2 = M.backup_facts(stuck, NOW)
    _, bad3 = M.backup_facts([ok[0], ok[2]] + [dict(old_generic[0], t='2026-11-07T10:35:01Z')], NOW)   # unresolved generic
    return (show == ['fleet OK', 'es OK', 'show OK'] and len(bad) == 1 and 'log store (ES) backup: the check has not' in bad[0]
            and 'show ALARM' in bad2 and 'world backup ALARM old' in bad3)


def ck_render(M):
    f = base()
    j = M.judge(f)
    md = M.render(f, j, NOW)
    empty = {'generated_at': '2026-11-07T12:03:00Z', 'since': '2026-11-07T06:03:00Z', 'window_h': 6,
             'errors': {'everything': 'down'}}
    md2 = M.render(empty, M.judge(empty), NOW)
    h = M.md_to_html('# T\n- a\n  - b\n- c\n**x**\n')
    return ('## 11. Needs you' in md and 'nothing needs you right now' in md and 'could not read the showcase' in md2
            and 'Sat 6:03 AM CT' in md and h.count('<ul>') == 2 and h.count('</ul>') == 2 and '<strong>x</strong>' in h)


CHECKS = [ck_slot_cst, ck_slot_cdt, ck_slot_grace, ck_window, ck_healthy_quiet, ck_death_spike, ck_fewer_deaths, ck_value,
          ck_unread_no_verdict, ck_bots_down, ck_world_down_first, ck_canary, ck_stuck_and_unstuck, ck_bags,
          ck_showcase_halt, ck_showcase_deaths, ck_finished, ck_narrative_ok, ck_narrative_new_number, ck_narrative_parts, ck_numbers,
          ck_narrative_words, ck_unread_mood, ck_owner_alarms, ck_parsers, ck_windows_of_time, ck_backups, ck_render]

# (name, old, new, the check it must break)
MUTANTS = [
    ('slot in UTC, not Central', "    if c.hour in SLOT_HOURS and c.minute < grace_min:",
     "    if now.hour in SLOT_HOURS and now.minute < grace_min:", ck_slot_cdt),
    ('death spike threshold x10', "if win['deaths'] >= 3 and r_now >= 1.5 * r_week:",
     "if win['deaths'] >= 3 and r_now >= 15 * r_week:", ck_death_spike),
    ('death floor dropped', "if win['deaths'] >= 3 and r_now", "if win['deaths'] >= 0 and r_now", ck_death_spike),
    ('value rule ignores an unread source', "    if v.get('cur') is not None and v.get('prev'):",
     "    if True:", ck_unread_no_verdict),
    ('REVERT never reported', "        elif x['verdict'] == 'REVERT':", "        elif x['verdict'] == 'REVERTED':", ck_canary),
    ('INCONCLUSIVE counted as kept', "        if x['verdict'] == 'KEEP':", "        if x['verdict'] != 'REVERT':", ck_canary),
    ('narrative number check off', "    if extra:\n        return False, f'numbers not in the data report",
     "    if False:\n        return False, f'numbers not in the data report", ck_narrative_new_number),
    ('narrative parts check off', "    if miss:\n", "    if False:\n", ck_narrative_parts),
    ('acked alarms listed', "        if find_ack(acks, src, key, now) is not None:", "        if False:", ck_owner_alarms),
    ('operator alarms listed as the owner\'s', "        if src in OPERATOR_SOURCES:", "        if False:", ck_owner_alarms),
    ('a recovered showcase halt ranks as urgent', "D.append((35 if back else 7,", "D.append((7,", ck_showcase_halt),
    ('a world down is not first', "        D.append((1, f'world {x} is DOWN'))", "        D.append((50, f'world {x} is DOWN'))",
     ck_world_down_first),
    ('a stale backup check reads healthy', "        elif now - t > fresh:", "        elif False:", ck_backups),
    ('an old unrecovered backup ALARM forgotten', "        if not r.get('ok'):\n            bad.append(r['line'])",
     "        if not r.get('ok') and now - t < fresh:\n            bad.append(r['line'])", ck_backups),
    ('an old cached window passed off as current', "    ok_cur, ok_prev = len(cur) >= max(1, cur_h - 1), len(prev) >= min_prev",
     "    ok_cur, ok_prev = True, True", ck_windows_of_time),
    ('spelled-out numbers allowed', "    if words:\n", "    if False:\n", ck_narrative_words),
    ('an unread source reads GOOD', "    if j['unread']:\n        return 'PARTLY UNKNOWN'", "    if False:\n        return 'PARTLY UNKNOWN'",
     ck_unread_mood),
    ('bots not running ignored', "        if run < exp:", "        if run < 0:", ck_bots_down),
    ('unstuck never reported', "    if unstuck and g.get('read'):", "    if False:", ck_stuck_and_unstuck),
    ('value window counts the open hour', "    end = now.replace(minute=0, second=0, microsecond=0)",
     "    end = now.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)", ck_windows_of_time),
]


def run_mutants():
    src = open(SRC).read()
    with tempfile.TemporaryDirectory() as d:
        for i, (name, old, new, ck) in enumerate(MUTANTS):
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {name}'
            p = os.path.join(d, f'mut{i}.py')
            with open(p, 'w') as fh:
                fh.write(src.replace(old, new))
            M = load(p, f'statusreport_mut{i}')
            try:
                survived = bool(ck(M))
            except Exception:
                survived = False
            check(f'mutant killed: {name} (by {ck.__name__})', not survived)


if __name__ == '__main__':
    for ck in CHECKS:
        try:
            ok = bool(ck(R))
        except Exception as e:  # noqa: BLE001
            print(f'      {ck.__name__}: {type(e).__name__}: {e}')
            ok = False
        check(ck.__name__, ok)
    run_mutants()
    print(f'\n{len(CHECKS)} checks, {len(MUTANTS)} mutants: ' + ('ALL PASS' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}'))
    sys.exit(1 if FAILS else 0)
