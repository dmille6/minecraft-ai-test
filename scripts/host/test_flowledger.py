#!/usr/bin/env python3
"""Tests for flowledger.py + flowstock.mjs (flowledger-01). Every alarm FIRES on a seeded history and stays QUIET on a clean
one; the balance closes on a consistent fixture and the fleet control FAILS when the deltas are dropped (the null); flows
classify supply / spend / well / transfers; a failed top-level row's bag change is inferred; flowstock.mjs folds a real
cobblecap journal written by the bots' own appendJournal/recordCount; the wiring (alarmhead MONITOR_LOGS, monitors.json,
the installer's cron line) is present; every anchored mutant is killed.
    python3 -B scripts/host/test_flowledger.py
"""
import datetime as dt
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..'))
UTC = dt.timezone.utc
FAILS = []


def check(name, ok, info=''):
    print(('  PASS  ' if ok else '  FAIL  ') + name + ('' if ok else f'\n        {str(info)[:400]}'))
    if not ok:
        FAILS.append(name)


def load(src=None):
    p = os.path.join(HERE, 'flowledger.py')
    spec = importlib.util.spec_from_file_location('flowledger_t', p)
    m = importlib.util.module_from_spec(spec)
    if src is None:
        spec.loader.exec_module(m)
    else:
        exec(compile(src, p, 'exec'), m.__dict__)
    return m


NOW = dt.datetime(2026, 11, 2, 18, 5, tzinfo=UTC)


def row(t_min, name, bot='b-a-Alpha', pool='board-a', inv=None, delta=None, status='success', args=None, top=True):
    return {'t': NOW - dt.timedelta(minutes=t_min), 'name': name, 'top': top, 'bot': bot, 'pool': pool, 'inv': inv,
            'delta': delta, 'status': status, 'args': args or {}, 'detail': ''}


def fixture_rows():
    """Two bots, one town. Consistent: each END snapshot = previous + delta."""
    R = []
    # Alpha mines 128, goes home, banks 64, wells 64, builds (draw 64, place 10), crafts a table and leaves it
    R += [row(300, 'mine', inv={'cobblestone': 192}, delta={'cobblestone': 128}),
          row(290, 'town_deposit', inv={'cobblestone': 128}, delta={'cobblestone': -64}),
          row(280, 'dispose_well', inv={'cobblestone': 64}, delta={'cobblestone': -64}),
          row(270, 'build_shop', inv={'cobblestone': 118}, delta={'cobblestone': 54}),   # drew 64, placed 10 -> net +54
          *[row(269, 'build', top=False, status='success') | {'detail': f'project=monument op=place seg=F-W cell={i},68,104 block=cobblestone'} for i in range(10)],
          row(268, 'build', top=False) | {'detail': 'project=monument op=stuck_on_cell cell=1,2,3'},
          row(265, 'build_shop', inv={'cobblestone': 108}, delta={'cobblestone': -10}),
          *[row(264, 'build', top=False, status='success') | {'detail': f'project=monument op=place seg=F-W cell={i},69,104 block=cobblestone'} for i in range(10)],
          row(30, 'craft', inv={'cobblestone': 108}, delta={'crafting_table': 0}, args={'item': 'crafting_table', 'count': 1}),
          row(20, 'craft', inv={'cobblestone': 100}, delta={'cobblestone': -8, 'furnace': -1}, args={'item': 'stone_pickaxe'})]
    # Bravo: goto digs 40 (row WITH delta), a failed goto with NO delta that placed 5 scaffold (inferred), a death mid-goto
    R += [row(250, 'goto', bot='b-a-Bravo', inv={'cobbled_deepslate': 140}, delta={'cobbled_deepslate': 40}),
          row(240, 'goto', bot='b-a-Bravo', inv={'cobbled_deepslate': 135}, status='failed'),
          row(200, 'death', bot='b-a-Bravo', inv={'cobbled_deepslate': 135}, status='failed', top=False),
          row(199, 'goto', bot='b-a-Bravo', inv={}, delta={'cobbled_deepslate': -135}, status='failed'),
          row(100, 'deposit', bot='b-a-Bravo', inv={'dirt': 64}, delta={})]
    return R


def t_flows(F):
    R = fixture_rows()
    n = F.infer_deltas(R)
    check('infer: the failed goto without a delta gets its bag change', n >= 1 and any(r.get('inferred') and r['delta'] == {'cobbled_deepslate': -5} for r in R), [r['delta'] for r in R])
    P, X = F.flows(R)
    c = P['board-a']['cobble']
    check('flows: supply counts mine + goto, never a draw', c['supply']['mine'] == 128 and c['supply']['goto'] == 40 and 'build_shop' not in c['supply'], dict(c['supply']))
    check('flows: build_shop placements come from the `_build op=place` rows; the draw is net delta + placed', c['spend']['build_shop'] == 20 and c['drawn'] == 54 - 10 + 20, c)
    check('flows: build placed counted per block row', X['board-a']['build_placed'] == 20, X['board-a'])
    check('flows: the well is dispose_well losses', c['well'] == 64, c)
    check('flows: banked is the deposit loss', c['banked'] == 64, c)
    check('flows: the inferred failed goto is travel spend', c['spend']['goto'] >= 5 + 135, dict(c['spend']))
    check('flows: craft spend 8', c['spend']['craft'] == 8, dict(c['spend']))
    check('flows: deaths reported from the death row', c['deaths'] == 135, c)
    check('flows: a station left by craft counted', X['board-a']['left_stations'] == 1, X['board-a'])
    check('flows: a station craft counted', X['board-a']['crafted_stations'] == 1, X['board-a'])
    check('flows: since= keeps only the slice', F.flows(R, since=NOW - dt.timedelta(minutes=60))[0]['board-a']['cobble']['supply'].get('mine', 0) == 0)
    bal = F.balance(R)
    towns, ctl = F.closure(bal, min_flow=1)
    check('balance: a consistent fixture closes (residual 0)', bal['board-a']['res'] == 0 and towns['board-a'] == 'closes', bal)
    check('balance: the control passes on it', ctl['ok'], ctl)
    # THE NULL: drop every delta -> nothing explains the bags -> the control must FAIL
    R2 = fixture_rows()
    for r in R2:
        if r['delta'] is not None:
            r['delta'] = {k: 0 for k in r['delta']}
    F.infer_deltas(R2)
    b2 = F.balance(R2)
    t2, c2 = F.closure(b2, min_flow=0)
    check('balance: zeroed deltas -> the town is OPEN and the fleet control FAILS', t2['board-a'] == 'OPEN' and not c2['ok'], (b2, c2))
    # Codex r1 BLOCKER: REMOVED delta fields are inferred from the bags and would close by construction -> must still FAIL
    R4 = fixture_rows()
    for r in R4:
        r['delta'] = None
    F.infer_deltas(R4)
    b4 = F.balance(R4)
    t4, c4 = F.closure(b4, min_flow=1)
    check('balance: every delta field removed -> OPEN and the control FAILS (inferred rows cannot carry it)', t4['board-a'] == 'OPEN' and not c4['ok'], (b4, c4))
    # a missed placement (one delta wrong) opens the town
    R3 = fixture_rows()
    R3[2]['delta'] = {'cobblestone': -300}
    F.infer_deltas(R3)
    b3 = F.balance(R3)
    check('balance: a wrong delta opens the town', F.closure(b3, min_flow=1)[0]['board-a'] == 'OPEN', b3)
    check('slots: ceil by stack, 16-stackers', F.slots_of({'cobblestone': 65, 'egg': 17, 'iron_pickaxe': 2}, {'egg': 16, 'iron_pickaxe': 1}) == 2 + 2 + 2)
    check('pct: p75 of 1..4 is 3', F.pct([4, 1, 3, 2], 75) == 3)
    check('yard: held parsed from the newest _yard row', F.yard_held([row(10, 'yard', top=False) | {'detail': 'kind=stock why=x placed=- yard=cobblestone:200,bamboo_block:10 stop=x'}]) == {'board-a': {'cobblestone': 200, 'bamboo_block': 10}})
    R5 = fixture_rows() + [row(5, 'yard', top=False) | {'detail': 'kind=stock why=x placed=- yard=cobblestone:200,bamboo_block:10 stop=x'}]
    F.infer_deltas(R5)
    rec = F.build(R5, {}, NOW, 360, {}, {'towns': {}, 'unreadable': []})
    check('build: bamboo counts the yard (9 a block) with the bags', rec['bamboo']['board-a'] == 90 and rec['yard']['board-a'] == 210, (rec['bamboo'], rec['yard']))


def hist(hours, **kw):
    """One run per hour for `hours` hours back to NOW; kw overrides per-run fields (callables get the index)."""
    H = []
    for i in range(hours):
        ts = NOW - dt.timedelta(hours=hours - 1 - i)
        h = {'ts': ts.strftime('%Y-%m-%dT%H:%M:%SZ'), 'closure': {'board-a': 'closes', 'board-b': 'closes'},
             'control': {'ok': True, 'abs_res': 1, 'null': 100}, 'chests': {'board-a': {'observed': 900, 'counted': 3, 'uncounted': 0},
                                                                            'board-b': {'observed': 900, 'counted': 3, 'uncounted': 0}},
             'yard': {}, 'bamboo': {'board-a': 100}, 'bags': {},
             'slice': {'cobble_supply': 1000, 'cobble_well': 300, 'left_stations': {}, 'depart_n': 10, 'depart_p75': 28}}
        for k, v in kw.items():
            val = v(i) if callable(v) else v
            if isinstance(val, dict) and isinstance(h.get(k), dict) and k == 'slice':
                h[k] = {**h[k], **val}
            else:
                h[k] = val
        H.append(h)
    return H


def t_station_left(F):
    """stnmetric-01: burned fuel and stations picked up again are not 'left'."""
    sm = lambda t, inv, d, detail='': row(t, 'smelt', inv=inv, delta=d, args={'item': 'raw_iron'}) | {'detail': detail}
    # a smelt burned 2 spare tables as fuel and placed/left 1 furnace that is never seen again
    R = [sm(60, {'crafting_table': 1}, {'crafting_table': -2, 'furnace': -1, 'raw_iron': -1}, 'smelted 1x iron_ingot from raw_iron (batch 1, burned 2x crafting_table, placed the furnace first)')]
    c = F.station_left(R)['board-a']
    check('left: tables burned as fuel are not left; the furnace is', (c['gross'], c['burned'], c['left']) == (3, 2, 1), dict(c))
    # a craft left its table, the same bot picks it up 50 s later (a _pickups row's snapshot) -> recovered, not left
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(10 - 50 / 60, 'pickups', inv={'crafting_table': 1}, top=False)]
    c = F.station_left(R)['board-a']
    check('left: picked up again within 120 s -> recovered', (c['recovered'], c['left']) == (1, 0), dict(c))
    # ...the same rise after 200 s is too late to be that table
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(10 - 200 / 60, 'pickups', inv={'crafting_table': 1}, top=False)]
    check('left: a rise after RECOVER_S is not a recovery', F.station_left(R)['board-a']['left'] == 1, dict(F.station_left(R)['board-a']))
    # a chest withdraw (transfer) or a fresh craft of the station is never a recovery
    R = [row(10, 'smelt', inv={'furnace': 0}, delta={'furnace': -1}, args={'item': 'raw_iron'}),
         row(9.5, 'withdraw', inv={'furnace': 1}, delta={'furnace': 1})]
    check('left: a chest withdraw is not a recovery', F.station_left(R)['board-a']['left'] == 1, dict(F.station_left(R)['board-a']))
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(9.5, 'craft', inv={'crafting_table': 1}, delta={'crafting_table': 1}, args={'item': 'crafting_table'})]
    check('left: crafting a new table is not a recovery', F.station_left(R)['board-a']['left'] == 1, dict(F.station_left(R)['board-a']))
    # a row written WHILE the losing skill ran (its start + duration) is a mid-skill bag, never a recovery (MEASURED 11-09)
    R = [row(10, 'smelt', inv={'furnace': 0}, delta={'furnace': -1}, args={'item': 'raw_iron'}) | {'dur_ms': 30_000},
         row(10 - 1 / 60, 'path_noPath', inv={'furnace': 1}, top=False),
         row(10 - 20 / 60, 'ledger_station', inv={'furnace': 0}, top=False)]
    c = F.station_left(R)['board-a']
    check('left: a sub-row inside the skill (mid-skill bag) is not a recovery', (c['recovered'], c['left']) == (0, 1), dict(c))
    R.append(row(10 - 60 / 60, 'pickups', inv={'furnace': 1}, top=False))
    check('left: ...a rise after the skill ended is', F.station_left(R)['board-a']['recovered'] == 1, dict(F.station_left(R)['board-a']))
    # Codex r1: one rise is credited ONCE (two losses, one pickup -> one recovered)
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(9.5, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_shovel'}),
         row(9.0, 'pickups', inv={'crafting_table': 1}, top=False)]
    c = F.station_left(R)['board-a']
    check('left: one pickup recovers one of two losses', (c['gross'], c['recovered'], c['left']) == (2, 1, 1), dict(c))
    # Codex r1: a later skill's END bag is seen at its end -- past RECOVER_S it is not a recovery
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(9, 'goto', inv={'crafting_table': 1}, delta={'crafting_table': 1}) | {'dur_ms': 120_000}]
    check('left: a later skill\'s end bag past RECOVER_S is not a recovery', F.station_left(R)['board-a']['left'] == 1, dict(F.station_left(R)['board-a']))
    # Codex r1: a bag seen INSIDE a later craft of the station is that craft's table, not the lost one
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(9.5, 'craft', inv={'crafting_table': 1}, delta={'crafting_table': 1}, args={'item': 'crafting_table'}) | {'dur_ms': 20_000},
         row(9.5 - 10 / 60, 'craft_sync', inv={'crafting_table': 1}, top=False)]
    check('left: a sub-row inside a craft of the station is not a recovery', F.station_left(R)['board-a']['left'] == 1, dict(F.station_left(R)['board-a']))
    # another bot's pickup never recovers this bot's loss
    R = [row(10, 'craft', inv={'crafting_table': 0}, delta={'crafting_table': -1}, args={'item': 'stone_pickaxe'}),
         row(9.5, 'pickups', bot='b-a-Bravo', inv={'crafting_table': 3}, top=False)]
    check('left: another bot\'s bag is not a recovery', F.station_left(R)['board-a']['left'] == 1)
    # flows carries it: the net number, plus the burned / recovered parts
    R = [sm(60, {'crafting_table': 1, 'furnace': 0}, {'crafting_table': -2, 'furnace': -1}, 'burned 2x crafting_table, placed the furnace first'),
         row(59.5, 'pickups', inv={'crafting_table': 1, 'furnace': 1}, top=False)]
    _, X = F.flows(R)
    x = X['board-a']
    check('flows: left_stations is net of burned and recovered', (x['left_stations'], x['burned_stations'], x['recovered_stations'], x['left_gross']) == (0, 2, 1, 3), x)


def t_alarms(F):
    a, notes = F.judge(hist(26), NOW)
    check('alarms: a clean 26 h history is QUIET', a == {}, a)
    check('alarms: yard absence is SAID', any('no `_yard` rows' in n for n in notes), notes)
    a, notes = F.judge(hist(5), NOW)
    check('alarms: 5 h of history -> sinks WARMING is said, not a pass', any(n.startswith('sinks: WARMING') for n in notes) and 'sinks' not in a, notes)
    a, _ = F.judge(hist(24, slice={'cobble_well': 600}), NOW)
    check('alarms: sinks fires at 60 % well share over 24 h', 'sinks' in a, a)
    a, _ = F.judge(hist(24, slice={'cobble_well': 500}), NOW)
    check('alarms: sinks quiet at exactly 50 %', 'sinks' not in a, a)
    low = {'board-a': {'observed': 100, 'counted': 3, 'uncounted': 0}, 'board-b': {'observed': 900, 'counted': 3, 'uncounted': 0}}
    a, _ = F.judge(hist(7, chests=low), NOW)
    check('alarms: starved fires for the town below LOW for 6 h, not the other', 'starved:board-a' in a and 'starved:board-b' not in a, a)
    unk = {'board-a': {'observed': 100, 'counted': 2, 'uncounted': 1}, 'board-b': {'observed': 900, 'counted': 3, 'uncounted': 0}}
    a, _ = F.judge(hist(7, chests=unk), NOW)
    check('alarms: an UNKNOWN (uncounted) chest never reads as starved', 'starved:board-a' not in a, a)
    a, _ = F.judge(hist(7, chests=lambda i: low if i > 1 else unk), NOW)
    check('alarms: starved needs EVERY run of 6 h', 'starved:board-a' not in a, a)
    a, _ = F.judge(hist(7, slice={'depart_p75': 33}), NOW)
    check('alarms: bags fires at p75 33 for 6 h', 'bags' in a, a)
    a, _ = F.judge(hist(7, slice=lambda i: {'depart_p75': 33 if i != 5 else 20}), NOW)
    check('alarms: one slice at 20 within 6 h -> quiet', 'bags' not in a, a)
    a, _ = F.judge(hist(25, yard={'board-a': 300}), NOW)
    check('alarms: yard full 24 h fires', 'yard:board-a' in a, a)
    a, _ = F.judge(hist(25, yard={'board-a': 200}), NOW)
    check('alarms: a yard with room is quiet', 'yard:board-a' not in a, a)
    a, _ = F.judge(hist(49, yard={'board-a': 300}, bamboo=lambda i: {'board-a': 100 + 10 * i}), NOW)
    check('alarms: bamboo growing 48 h with the yard full fires', 'bamboo:board-a' in a, a)
    a, _ = F.judge(hist(49, yard={'board-a': 300}), NOW)
    check('alarms: flat bamboo is quiet', 'bamboo:board-a' not in a, a)
    a, _ = F.judge(hist(24, slice={'left_stations': {'board-a': 1}}), NOW)
    check('alarms: stations fires at 24 left in 24 h', 'stations:board-a' in a, a)
    a, _ = F.judge(hist(24, slice=lambda i: {'left_stations': {'board-a': 1} if i < 10 else {}}), NOW)
    check('alarms: 10 left is quiet', 'stations:board-a' not in a, a)
    opn = {p: 'OPEN' for p in ('a', 'b', 'c', 'd')}
    a, _ = F.judge(hist(2, closure=opn), NOW)
    check('alarms: 4 OPEN towns -> read broken', 'read:balance' in a, a)
    a, _ = F.judge(hist(2, closure={'a': 'OPEN', 'b': 'OPEN', 'c': 'OPEN'}), NOW)
    check('alarms: 3 OPEN towns is not', 'read:balance' not in a, a)
    a, _ = F.judge(hist(2, control={'ok': False, 'abs_res': 90, 'null': 100}), NOW)
    check('alarms: a failed fleet control -> read broken', 'read:balance' in a, a)
    a, _ = F.judge([], NOW)
    check('alarms: no history at all is an alarm', 'read:no-history' in a, a)
    # spaced: a hand run 10 min after the cron must not count its hour twice
    H = hist(24, slice={'cobble_well': 480})
    extra = dict(H[-1], ts=(NOW - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'), slice=dict(H[-1]['slice'], cobble_well=1000))
    a, _ = F.judge(H[:-1] + [extra, H[-1]], NOW)
    check('alarms: two runs 10 min apart count one slice', 'sinks' not in a, a)


def t_summary(F):
    R = fixture_rows()
    F.infer_deltas(R)
    stock = {'towns': {'_pool-board-a': {'groups': {'cobble': {'observed': 700, 'counted': 2, 'uncounted': 0, 'lb': 700}}}}, 'unreadable': []}
    rec = F.build(R, {'mine': 1}, NOW, 360, {}, stock)
    active, notes = F.judge([{k: rec[k] for k in ('ts', 'closure', 'control', 'chests', 'yard', 'bamboo', 'slice', 'bags')}], NOW)
    line = F.summary_line(rec, active, notes)
    check('summary: one line, starts with the ISO time and flowledger', line.startswith('2026-11-02T18:05:00Z flowledger ') and '\n' not in line, line)
    check('summary: says the denominators (rows, bots, towns) and the control', ' rows, 2 bots, 1 towns' in line and 'vs null' in line, line)
    check('summary: bags counted in the stock', 'bags 100,' in line and 'chests 700' in line, line)


def t_flowstock():
    cc = os.path.join(REPO, 'bots', 'src', 'cobblecap.mjs')
    with tempfile.TemporaryDirectory() as d:
        pool = os.path.join(d, '_pool-board-a')
        os.makedirs(pool)
        js = f"""
import * as CC from {json.dumps(cc)}
const dir = {json.dumps(pool)}, key = 'town-chest-1_2_3'
CC.recordCount(dir, key, 'w1', {{ obs: {{ k: '1,2,3', n: 640, cap: Date.now() - 60000, m: {{ cobble: 640, oak_log: 30 }} }}, scan: {{ keys: ['1,2,3', '4,5,6'], at: Date.now() }}, bot: 'x' }})
"""
        r = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, timeout=60)
        check('flowstock: the fixture journal was written by cobblecap.recordCount', r.returncode == 0 and any(f.endswith('.cobble.jsonl') for f in os.listdir(pool)), r.stderr[-300:])
        r = subprocess.run(['node', os.path.join(HERE, 'flowstock.mjs'), cc, str(int(dt.datetime.now(UTC).timestamp() * 1000)), pool,
                            os.path.join(d, '_pool-none')], capture_output=True, text=True, timeout=60)
        try:
            out = json.loads(r.stdout)
        except ValueError:
            out = {}
        t = (out.get('towns') or {}).get('_pool-board-a') or {}
        g = (t.get('groups') or {}).get('cobble') or {}
        check('flowstock: folds the journal: 640 cobble observed in 1 of 2 containers, the other UNKNOWN', g.get('observed') == 640 and g.get('counted') == 1 and g.get('uncounted') == 1, (r.stderr[-300:], out))
        check('flowstock: logs summed over the wood groups', ((t.get('groups') or {}).get('logs') or {}).get('observed') == 30, t)
        check('flowstock: a missing pool dir is listed unreadable, not zero', any(u.get('dir') == '_pool-none' for u in out.get('unreadable', [])), out)
        check('flowstock: the read wrote nothing into the pool dir (no checkpoint, no base)', sorted(os.listdir(pool)) == ['town-chest-1_2_3.cobble.jsonl'], os.listdir(pool))


def t_wiring():
    ah = open(os.path.join(REPO, 'scripts', 'lib', 'alarmhead.py')).read()
    check('wiring: alarmhead MONITOR_LOGS prints digest/flowledger.log in the fleetstatus header', "('digest/flowledger.log', 'flow ledger'" in ah)
    mon = json.load(open(os.path.join(REPO, 'config', 'monitors.json')))
    row = [m for m in mon['monitors'] if m.get('id') == 'flowledger']
    check('wiring: monitors.json registers flowledger with a consumer', row and row[0].get('consumer') and row[0].get('cron'), row)
    inst = open(os.path.join(HERE, 'install-flowledger.sh')).read()
    check('wiring: the installer adds the hourly cron line', 'host/flowledger.py run' in inst and '# flowledger' in inst)
    import lib.alarmhead as AH  # noqa: E402
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, 'digest'))
        p = os.path.join(d, 'digest', 'flowledger.log')
        open(p, 'w').write('2026-11-02T17:05:00Z flowledger OK | 6 h, 1 rows\n')
        now = dt.datetime.now(UTC)
        out = [l for l in AH.monitor_lines(now, d) if 'flow ledger' in l]
        check('wiring: an OK line is plain in the header', out and out[0].startswith('flow ledger: 2026-11-02T17:05:00Z flowledger OK'), out)
        open(p, 'a').write('2026-11-02T18:05:00Z flowledger ALARMS 1: sinks too small\n')
        out = [l for l in AH.monitor_lines(now, d) if 'flow ledger' in l]
        check('wiring: an ALARMS line is a !! line in the header', out and out[0].startswith('!! flow ledger: 2026-11-02T18:05:00Z flowledger ALARMS 1'), out)
        open(p, 'a').write('2026-11-02T19:05:00Z flowledger ERROR RuntimeError: x\n')
        out = [l for l in AH.monitor_lines(now, d) if 'flow ledger' in l]
        check('wiring: an ERROR line is a !! line', out and out[0].startswith('!! flow ledger:'), out)


MUTANTS = [
    # stnmetric-01: each part of the station rule is load-bearing
    ("                    burned = min(lost, int(m.group(1))) if m else 0", "                    burned = 0", t_station_left),
    ("                    if any(a <= r['t'] <= b or a <= at <= b for a, b in rebase_win[nm]):", "                    if False:", t_station_left),
    ("if rise > 0 and q['n'] > 0 and q['end'] < at and (at - q['end']).total_seconds() <= RECOVER_S:", "if rise > 0 and q['n'] > 0 and q['end'] < at:", t_station_left),
    ("            by[r['bot']].append(r)\n    end_of", "            by['all'].append(r)\n    end_of", t_station_left),
    ("    end_of = lambda r: r['t'] + dt.timedelta(milliseconds=(r.get('dur_ms') or 0)) if r.get('top', True) else r['t']", "    end_of = lambda r: r['t']", t_station_left),
    ("                            rise -= k\n", "", t_station_left),
    ("        if sup and share > SINK_SHARE:", "        if False:", t_alarms),
    ("c.get('uncounted', 1) == 0 and ", "", t_alarms),
    ("            towns[p] = 'closes' if abs(o['res']) <= close_pct / 100 * o['gross'] and share(o) >= measured_min else 'OPEN'", "            towns[p] = 'closes'", t_flows),
    ("           'ok': nl > 0 and ar <= null_ratio * nl and ms >= measured_min}", "           'ok': True}", t_flows),
    ("                x['drawn'] += v          # NET town -> bag", "                x['supply']['build_shop'] += v  # NET town -> bag", t_flows),
    ("           'ok': nl > 0 and ar <= null_ratio * nl and ms >= measured_min}", "           'ok': nl > 0 and ar <= null_ratio * nl}", t_flows),
    ("        'bamboo': {p: bags[p]['bamboo'] + fam(yard_items.get(p) or {}, 'bamboo') for p in pools},", "        'bamboo': {p: bags[p]['bamboo'] for p in pools},", t_flows),
    ("            if r['delta'] is None and prev is not None:", "            if False:", t_flows),
    ("        if not out or _ts(out[-1]['ts']) - _ts(h['ts']) >= gap:", "        if True:", t_alarms),
    ("    if len(open_towns) > READ_BROKEN_TOWNS or not", "    if len(open_towns) > 99 or not", t_alarms),
    ("        if n > STATIONS_LEFT:", "        if n > 999:", t_alarms),
    ("        start = fam(dr[0]['inv'], f) - fam(dr[0]['delta'], f)", "        start = fam(dr[0]['inv'], f)", t_flows),
]


def run_mutants():
    src = open(os.path.join(HERE, 'flowledger.py')).read()
    killed = 0
    for old, new, test in MUTANTS:
        assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {old[:70]!r}'
        global FAILS
        saved = FAILS
        FAILS = []
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                test(load(src.replace(old, new)))
            except Exception:  # noqa: BLE001 -- a crash kills it too
                FAILS.append('crash')
        died = bool(FAILS)
        FAILS = saved
        killed += died
        if not died:
            print(f'  SURVIVED  {old[:80]!r}')
    print(f'mutants killed {killed}/{len(MUTANTS)}')
    if killed != len(MUTANTS):
        FAILS.append('mutants')


if __name__ == '__main__':
    F = load()
    t_flows(F)
    t_station_left(F)
    t_alarms(F)
    t_summary(F)
    t_flowstock()
    t_wiring()
    run_mutants()
    print(f'\n{"FAILED: " + ", ".join(FAILS) if FAILS else "all passed"}')
    sys.exit(1 if FAILS else 0)
