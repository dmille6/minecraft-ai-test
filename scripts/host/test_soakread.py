#!/usr/bin/env python3
"""soakread.py, the test world's soak read (11-18). The verdict is a pure function of what was collected, so it is driven
here with lines in the hosts' own shapes: Paper's console lines, the bots' `memory` lines, the 5-minute samples. The two
defects it was built for are both replayed: a release that keeps ~18 MB of chunk buffers per reconnect must FAIL the load
step (and the fixed one must pass on the same lines), and a bot near its ceiling must FAIL the untouched hours. Every
"nothing wrong" case sits beside the same input with the fault, and the mutants at the end prove each rule binds."""
import copy, datetime as dt, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import soakread as SR   # noqa: E402

fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1

T0 = dt.datetime(2026, 11, 18, 14, 0, tzinfo=dt.timezone.utc).timestamp()
QE = T0 + 3 * 3600
PS = QE + 17 * 60            # pauses start after a 15-minute squeeze and a short wait
LC = PS + 20 * 60            # the last continue
T1 = LC + 15 * 60
BOTS = ['showcase-' + n for n in 'Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno Kite Lumen Maple Onyx'.split()]
V = 'efee8b5fa4f836349afd9d4bde8d13e1afdf5e57+01febf'
def z(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def clock(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%H:%M:%S')
def joined(t, bot):
    return (t, f'[{clock(t)} INFO]: {bot} joined the game')
def lost(t, bot, why='Timed out'):
    return (t, f'[{clock(t)} INFO]: {bot} lost connection: {why}')
def memline(t, bot, rss, ab):
    stamp = dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.123Z')
    return (f'mctest@{bot}.service', f'[{stamp}] INFO  memory rss_mb={rss} heap_used_mb=180 heap_total_mb=220 external_mb=40 array_buffers_mb={ab} doing=gather {{"n":4}}')

def run(mb=400, slope=0.0, per_reconnect=0.0, rounds=6, restarts_of=None, load=True):
    """A whole soak's inputs: flat memory of `mb` (+slope MB/h), `rounds` forced reconnects a bot, `per_reconnect` MB of chunk
    buffers kept each time."""
    samples, paper, bot_lines = [], [(T0 + 5, '[14:00:05 INFO]: [CoreProtect] ok')], []
    t = T0
    while t <= T1:
        for b in BOTS:
            samples.append({'t': z(t), 'bot': b, 'active': True, 'mem_mb': mb + slope * (t - T0) / 3600.0, 'peak_mb': mb + 50,
                            'restarts': (restarts_of or {}).get(b, 0) if t > T0 + 3600 else 0, 'pid': 1})
            n_before = 0 if t < PS else min(rounds, int((t - PS) // 200) + 1)
            bot_lines.append(memline(t + 7, b, 300 + int(per_reconnect * n_before), 17 + int(per_reconnect * n_before)))
        t += 300
    if load:
        for i, b in enumerate(BOTS):
            for r in range(rounds):
                at = PS + r * 200 + i * 12
                paper += [lost(at + 31, b), joined(at + 62, b)]
    return {'run': 'r1', 'expected_version': V, 'bots': list(BOTS), 't0': T0, 'quiet_end': QE, 't1': T1,
            'load': {'start': QE, 'end': T1, 'pauses_start': PS, 'last_continue': LC} if load else None, 'stopped': None,
            'samples': samples, 'paper': sorted(paper), 'bot_lines': bot_lines, 'oom_lines': [],
            'rows_by_bot': {b: 6000 for b in BOTS}, 'versions': {V: 84000}, 'death_rows': {},
            'stats_start': {b: 3 for b in BOTS}, 'stats_end': {b: 3 for b in BOTS},
            'blocks': [(T0, 300, 200), (T0 + 3600, 310, 190), (T0 + 7200, 290, 210)],
            'llm': {'calls': 2700, 'p50_ms': 1200, 'p95_ms': 2900, 'failed': 0},
            'guards': [{'t': z(T0 + 600 * i), 'verdict': 'OK', 'p95_ms': 3000 + i, 'calls': 400} for i in range(1, 18)],
            'guard_before': {'p95_ms': 2800, 'calls': 420}}

# ---- the parsers, on lines in the hosts' own shapes
ev = SR.paper_events([joined(T0 + 9, 'showcase-Alpha'), lost(T0 + 8, 'showcase-Alpha', 'Timed out'), joined(T0 + 20, 'mike'),
                      (T0 + 30, '[14:00:30 INFO]: showcase-Alpha issued server command: /list'),
                      (T0 + 31, '[14:00:31 INFO]: [Not Secure] <showcase-Bravo> showcase-Alpha joined the game'),
                      (T0 + 32, '[14:00:32 INFO]: showcase-Alpha[/127.0.0.1:40706] logged in with entity id 34 at ([world]-14.5, 71.0, -5.5)')], set(BOTS))
check(ev == [(T0 + 8, 'showcase-Alpha', 'lost', 'Timed out'), (T0 + 9, 'showcase-Alpha', 'join', None)], 'join and lost lines of the bots only, in time order; a chat line quoting one is not one')
rc = SR.reconnects(ev, BOTS, T0, QE)
check(rc['showcase-Alpha'] == {'joins': 1, 'lost': {'Timed out': 1}} and rc['showcase-Bravo']['joins'] == 0, 'reconnects and reasons per bot')
check(SR.reconnects(ev, BOTS, T0 + 10, QE)['showcase-Alpha']['joins'] == 0, 'a join before the window is not in it')
ml = SR.memory_lines([memline(T0 + 7, 'showcase-Alpha', 312, 17), ('mctest@showcase-Alpha.service', '[2026-11-18T14:00:09.000Z] INFO  LLM -> gather ms=900'),
                      ('mcbot@board-a-Alpha.service', memline(T0, 'x', 1, 1)[1])])
check(ml == [(T0 + 7, 'showcase-Alpha', 312, 180, 17)], 'the bot\'s own memory line: time, rss, heap, chunk buffers; other lines and other units ignored')
check(SR.slope_mb_h([(T0 + 300 * i, 400 + 10 * i) for i in range(12)]) == 120.0, '10 MB every 5 min is 120 MB/h')
check(SR.slope_mb_h([(T0, 1), (T0 + 300, 2)]) is None, 'two points give no slope')
st = SR.mem_stats([{'t': z(T0 + 300 * i), 'bot': 'b', 'mem_mb': None if i == 3 else 400 + i} for i in range(10)], 'b', T0, T0 + 3000)
check(st['n'] == 9 and st['down'] == 1 and st['min'] == 400 and st['max'] == 409, 'a sample of a stopped unit is counted as down, never as 0 MB')
check(SR.death_delta({'a': 3, 'b': 1}, {'a': 4, 'c': 0}) == {'a': 1, 'b': None, 'c': None}, 'a bot missing at either end is unknown, never 0 deaths')
check(SR.back_in_world_minutes([(LC + 120, 'showcase-Alpha', 'join', None)], BOTS, LC) == 2.0 and SR.back_in_world_minutes([], BOTS, LC) == 0.0, 'minutes until the last bot is back')

# ---- the two defects, replayed
good = SR.build_report(run())
check(good['verdict'] == 'PASS' and not good['fails'] and not good['blind'], 'the fixed release: flat memory, six forced reconnects a bot, nothing kept: PASS')
check(good['leak']['_median_mb_per_reconnect'] == 0.0 and good['leak']['_bots_counted'] == 14 and good['leak']['showcase-Alpha']['forced_reconnects'] == 6, 'and it counted 6 forced reconnects on 14 of 14 bots')
leaky = SR.build_report(run(per_reconnect=18))
check(leaky['verdict'] == 'FAIL' and any('kept per forced reconnect' in f for f in leaky['fails']), 'THE RECONNECT LEAK: 18 MB kept per reconnect FAILS the load step')
check(leaky['leak']['showcase-Onyx']['buffers_before_mb'] == 17 and leaky['leak']['showcase-Onyx']['buffers_after_mb'] == 125 and leaky['leak']['showcase-Onyx']['mb_per_reconnect'] == 18.0, 'per bot: buffers 17 -> 125 MB over 6 reconnects = 18 MB each')
check(SR.build_report(run(per_reconnect=3))['verdict'] == 'PASS', 'one old world between collections (3 MB a reconnect) is not the leak')
near = SR.build_report(run(mb=1320))
check(near['verdict'] == 'FAIL' and any('ceiling' in f for f in near['fails']), 'THE 100-MINUTE DEFECT: a bot at 86% of its ceiling in the untouched hours FAILS')
check(SR.build_report(run(mb=1290))['verdict'] == 'PASS', 'POSITIVE CONTROL: 84% passes')
climb = SR.build_report(run(mb=400, slope=150))
check(climb['verdict'] == 'PASS' and any('rose' in f for f in climb['flags']), 'a 150 MB/h climb is named (not failed until runs set a band)')

# ---- restarts, kills, deaths
r = SR.build_report(run(restarts_of={'showcase-Gale': 2}))
check(r['verdict'] == 'FAIL' and any('showcase-Gale' in f and 'restarted 2' in f for f in r['fails']), 'a unit systemd restarted twice FAILS, by name')
i = run(); i['oom_lines'] = ['Memory cgroup out of memory: Killed process 4242 (node) total-vm:22000000kB, anon-rss:1028000kB']
check(SR.build_report(i)['verdict'] == 'FAIL', 'a kernel memory-kill line FAILS')
i = run(); i['stats_end']['showcase-Iris'] = 4; i['death_rows'] = {'showcase-Iris': 1}
r = SR.build_report(i)
check(r['verdict'] == 'PASS' and any('1 death' in f and 'Iris' in f for f in r['flags']), 'one death is named, not a verdict')
i['stats_end']['showcase-Juno'] = 4; i['death_rows']['showcase-Juno'] = 1
check(SR.build_report(i)['verdict'] == 'FAIL', 'two deaths FAIL')
i = run(); i['stats_end']['showcase-Iris'] = 4
check(any('disagree' in f for f in SR.build_report(i)['flags']), 'the server counting a death the bots\' rows lack is named')

# ---- reconnects in the untouched hours, and a bot that never comes back
i = run(); i['paper'] += [lost(T0 + 4000, 'showcase-Kite'), joined(T0 + 4020, 'showcase-Kite')]; i['paper'].sort()
r = SR.build_report(i)
check(r['verdict'] == 'PASS' and any('1 reconnect' in f and 'Timed out' in f for f in r['flags']) and r['reconnects_quiet']['showcase-Kite']['joins'] == 1, 'a reconnect in the untouched hours is named with its reason and rate')
i = run(); i['paper'] = [p for p in i['paper'] if not (p[0] > LC - 400 and 'showcase-Onyx joined' in p[1])]
r = SR.build_report(i)
check(r['verdict'] == 'FAIL' and any('never came back' in f and 'Onyx' in f for f in r['fails']), 'a bot whose last line is a lost connection FAILS the load step')
i = run(); i['paper'].append(joined(LC + 11 * 60, 'showcase-Echo')); i['paper'].append(lost(LC + 60, 'showcase-Echo')); i['paper'].sort()
check(any('min after the last pause' in f for f in SR.build_report(i)['fails']), 'the last bot back 11 minutes after the last pause FAILS (limit 10)')

# ---- what it could not see is INCONCLUSIVE, never a pass
i = run(); i['rows_by_bot']['showcase-Comet'] = 0
r = SR.build_report(i)
check(r['verdict'] == 'INCONCLUSIVE' and any('13 of 14' in b for b in r['blind']), 'a bot with no rows: INCONCLUSIVE')
i = run(); i['versions'] = {V: 80000, 'b6b83327d5d7a71d773aa350f8eed74515937996+7b4efa': 4000}
check(SR.build_report(i)['verdict'] == 'INCONCLUSIVE', 'rows on another version: INCONCLUSIVE')
i = run(); i['samples'] = [s for s in i['samples'] if not (s['bot'] == 'showcase-Alpha' and SR.ts(s['t']) < T0 + 3600)]
check(SR.build_report(i)['verdict'] == 'INCONCLUSIVE', 'a third of one bot\'s memory samples missing: INCONCLUSIVE')
i = run(); i['paper'] = []
r = SR.build_report(i)
check(r['verdict'] == 'INCONCLUSIVE' and any('Paper' in b for b in r['blind']), 'no Paper log line read: INCONCLUSIVE (zero reconnects would mean nothing)')
i = run(rounds=2)
r = SR.build_report(i)
check(r['verdict'] == 'INCONCLUSIVE' and any('leak rule cannot speak' in b for b in r['blind']), 'only two forced reconnects a bot: the leak rule cannot speak')
i = run(per_reconnect=18, rounds=2)
check(SR.build_report(i)['verdict'] == 'INCONCLUSIVE', 'and then even a leaking release is not passed: INCONCLUSIVE')
i = run(); i['stopped'] = 'guard: showcase model p95 6.40 s over 30 min'
check(SR.build_report(i)['verdict'] == 'INCONCLUSIVE', 'a run the showcase guard stopped: INCONCLUSIVE')
i = run(); i['quiet_end'] = T0 + 2 * 3600
check(any('not 3' in b for b in SR.build_report(i)['blind']), 'a two-hour untouched stretch is not a three-hour read')
i = run(); del i['stats_end']['showcase-Haven']
check(SR.build_report(i)['verdict'] == 'INCONCLUSIVE', 'no death statistic for a bot at the end: INCONCLUSIVE')
r = SR.build_report(run(load=False))
check(r['verdict'] == 'PASS' and any('load step was not run' in f for f in r['flags']) and r['leak'] is None, 'without the load step it says so and makes no claim about reconnects')
i = run(); i['guards'][3] = {'t': z(T0 + 2400), 'verdict': 'BLIND', 'p95_ms': None, 'calls': 3}
check(any('could not see' in f for f in SR.build_report(i)['flags']), 'a blind showcase-guard check is named')
i = run(per_reconnect=18); i['rows_by_bot']['showcase-Comet'] = 0
check(SR.build_report(i)['verdict'] == 'FAIL', 'a failure outranks a blind spot')

# ---- the load step alone (soak --load-only): a check of reconnects after 20 quiet minutes
def short(**kw):
    i = run(**kw)
    cut = 3 * 3600 - 1200                # drop the first 2 h 40 min of the untouched stretch
    i['t0'] = T0 + cut
    i['samples'] = [x for x in i['samples'] if SR.ts(x['t']) >= i['t0']]
    return i
i = short(per_reconnect=18); i['load_only'] = True
r = SR.build_report(i)
check(r['verdict'] == 'FAIL' and any('kept per forced reconnect' in f for f in r['fails']), 'load-only on the leaking release: FAIL on the leak rule')
i = short(); i['load_only'] = True
r = SR.build_report(i)
check(r['verdict'] == 'PASS' and any('LOAD-STEP CHECK ONLY' in f and 'nothing about the untouched hours' in f for f in r['flags']), 'load-only on the fixed release: PASS, and the read says it is not a soak')
check(SR.render(r).startswith('# Load-step check `r1`: **PASS**'), 'and the page is titled a load-step check, not a soak read')
check(SR.build_report(short())['verdict'] == 'INCONCLUSIVE', 'POSITIVE CONTROL: the same 20-minute run not declared load-only is INCONCLUSIVE (not 3 h)')

# ---- the showcase stopped on purpose: the guard is off, and the read says so
i = run(); i['guard_off'] = {'why': 'tripwire S4 at 15:13Z; control session 11-18', 'armed_at': None}
i['guards'] = [{'t': z(T0 + 600 * k), 'verdict': 'BLIND', 'p95_ms': None, 'calls': 0} for k in range(1, 18)]; i['guard_before'] = {'verdict': 'BLIND', 'p95_ms': None, 'calls': 0}
r = SR.build_report(i)
check(r['verdict'] == 'PASS' and any('GUARD WAS OFF' in f and 'tripwire S4' in f and 'never came back' in f for f in r['flags']), 'guard off because the showcase is stopped: named in the read, and 17 blind checks are not a blind read')
check('GUARD WAS OFF' in SR.render(r) and 'not read in the 30 min before' in SR.render(r), 'and the page says it')
i['guard_off']['armed_at'] = T0 + 3600
check(any('re-armed at 15:00Z' in f for f in SR.build_report(i)['flags']), 'if the showcase came back mid-run the read says when the guard re-armed')

# ---- saplings and the protected village (the 11-18 tripwire stop), on rows in the bots' own shapes
SAP = [(T0 + 10, 'showcase-Frost', '_plant_spot', {}, 'found at=65,70,-2 item=spruce_sapling sap=8 kinds=1 ordered=0', 'success'),
       (T0 + 20, 'showcase-Onyx', '_plant_spot', {}, 'none at=- item=spruce_sapling sap=8 kinds=1 ordered=0', 'success'),
       (T0 + 30, 'showcase-Onyx', '_plant_spot', {}, 'found at=-88,64,-19 item=spruce_sapling sap=8 kinds=1 ordered=0', 'success'),
       (T0 + 40, 'showcase-Maple', '_work_order', {}, 'place {"item":"spruce_sapling","x":121,"y":67,"z":-8} \u2014 holding 12 spruce_sapling on plantable ground', 'success'),
       (T0 + 41, 'showcase-Maple', '_work_order', {}, 'place {"item":"spruce_sapling","x":-54,"y":65,"z":-102} \u2014 holding 12', 'success'),
       (T0 + 42, 'showcase-Maple', '_work_order', {}, 'place {"item":"cobblestone","x":121,"y":67,"z":-8} \u2014 a wall', 'success'),
       (T0 + 43, 'showcase-Maple', '_work_order', {}, 'build_shop {"grounds":true,"why":"idle"} \u2014 the town\'s grounds (planting)', 'success'),
       (T0 + 50, 'showcase-Maple', 'place', {'item': 'spruce_sapling', 'x': 121, 'y': 67, 'z': -8}, 'placed spruce_sapling at (121, 67, -8)', 'success'),
       (T0 + 51, 'showcase-Maple', 'place', {'item': 'spruce_sapling', 'x': 120, 'y': 67, 'z': -8}, 'no reach', 'failed'),
       (T0 + 52, 'showcase-Maple', 'place', {'item': 'spruce_sapling', 'x': -13, 'y': 63, 'z': 110}, 'placed', 'success'),
       (T0 + 53, 'showcase-Maple', 'place', {'item': 'dirt', 'x': 121, 'y': 66, 'z': -8}, 'placed', 'success')]
sp = SR.sapling_rows(SAP)
check(sp['spots']['n'] == 2 and sp['spots']['in_zone'] == [(T0 + 10, 'showcase-Frost', 65, 70, -2)], 'plant spots: 2 found, 1 inside the village (a "none" row is not a spot)')
check(sp['orders']['n'] == 2 and sp['orders']['in_zone'] == [(T0 + 40, 'showcase-Maple', 121, 67, -8)], 'orders to plant: 2 sapling orders, 1 inside (a cobblestone order and a build order are not)')
check(sp['placed']['n'] == 2 and sp['placed']['in_zone'] == [(T0 + 50, 'showcase-Maple', 121, 67, -8)], 'planted: 2 succeeded, 1 inside (a failed place and a dirt block are not)')
check(SR.in_zone(49, -59) and SR.in_zone(157, 45) and not SR.in_zone(48, 0) and not SR.in_zone(100, 46), 'the zone is x 49..157, z -59..45, edges included')
i = run(); i['sapling_rows'] = SAP; i['sapling_places'] = [(T0 + 50, 'showcase-Maple', 121, 67, -8), (T0 + 52, 'showcase-Maple', -13, 63, 110)]
r = SR.build_report(i)
check(r['verdict'] == 'PASS' and any('protected village' in f and '1 plant spot' in f and '1 by the block history' in f for f in r['flags']), 'saplings in the village are named with all four counts, and are not part of the verdict')
md = SR.render(r)
check('## Saplings and the protected village' in md and '2 in all, **1 inside the village**: 14:00Z Maple at 121,67,-8' in md, 'the page lists each one with its time, bot and block')
r = SR.build_report(run())
check(not any('protected village' in f for f in r['flags']) and '**0 inside the village**' in SR.render(r), 'POSITIVE CONTROL: no sapling rows, no flag, and the page still shows the zeros with their totals')

# ---- the page
md = SR.render(leaky)
check('**FAIL**' in md and '| Onyx |' in md and '17 -> 125 MB' in md and '18.0' in md, 'the page puts each bot\'s memory beside its reconnect count')
check('42.0 bot-hours' in md and '84,000 skill rows from 14 of 14 bots' in md and '36 expected' in md, 'and every number has its denominator')
check('300 placed / 200 cleared' in md and 'Timed out' in md, 'blocks by hour and the server\'s reasons for lost connections')
json.dumps(leaky, default=str)
i = run(); i['guard_before'] = {'verdict': 'BLIND', 'p95_ms': None, 'calls': None}; i['guards'] = [{'t': z(T0 + 600), 'verdict': 'BLIND', 'p95_ms': None, 'calls': None}]
check('not read in the 30 min before' in SR.render(SR.build_report(i)), 'a baseline the guard could not read is written as "not read", and the page still renders (review 11-18)')
i = run(); i['guard_before'] = None
check('not read' in SR.render(SR.build_report(i)), 'and so is no baseline at all')

# ---- mutants: each rule binds (the anchor must be present and unique)
SRC = open(os.path.join(HERE, 'soakread.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'soakread_mutant', '__file__': os.path.join(HERE, 'soakread.py')}
    exec(compile(SRC.replace(old, new), 'soakread_mutant', 'exec'), ns)
    return lambda inp: ns['build_report'](copy.deepcopy(inp))['verdict']
def killed(name, got):
    check(got, 'MUTANT KILLED: ' + name)
killed('the leak rule never fails', mutant("            if kept > LEAK_MB:\n", "            if False:\n")(run(per_reconnect=18)) == 'PASS')
killed('the ceiling rule never fails', mutant("        if m['n'] and m['share_of_cap'] >= NEAR_CAP:\n", "        if False:\n")(run(mb=1320)) == 'PASS')
killed('restarts are ignored', mutant("        if rs[b]:\n", "        if False:\n")(run(restarts_of={'showcase-Gale': 2})) == 'PASS')
i = run(); i['oom_lines'] = ['Memory cgroup out of memory: Killed process 1 (node)']
killed('memory kills are ignored', mutant("    if ooms:\n", "    if False:\n")(i) == 'PASS')
i = run(); i['rows_by_bot']['showcase-Comet'] = 0
killed('a missing bot is not blind', mutant("    if len(seen) < len(bots):\n", "    if False:\n")(i) == 'PASS')
killed('two forced reconnects are enough for the leak rule', mutant("LEAK_MIN_RECONNECTS = 4 ", "LEAK_MIN_RECONNECTS = 1 ")(run(rounds=2, per_reconnect=18)) == 'FAIL')
killed('the leak rule wants more bots than exist', mutant("LEAK_MIN_BOTS = 10 ", "LEAK_MIN_BOTS = 20 ")(run()) == 'INCONCLUSIVE')
i = run(); i['paper'] = [p for p in i['paper'] if not (p[0] > LC - 400 and 'showcase-Onyx joined' in p[1])]
killed('a bot that never came back passes', mutant("        if out_now:\n", "        if False:\n")(i) == 'PASS')
i = run(); i['stats_end']['showcase-Iris'] = 5; i['death_rows'] = {'showcase-Iris': 2}
killed('two deaths pass', mutant("    if deaths >= DEATHS_FAIL:\n", "    if False:\n")(i) == 'PASS')
i = run(load=False); i['paper'] = []
check(SR.build_report(i)['verdict'] == 'INCONCLUSIVE', 'POSITIVE CONTROL for the next mutant: no Paper line and no load step is INCONCLUSIVE')
killed('an unread Paper log is not blind', mutant("    if not inp['paper']:\n", "    if False:\n")(i) == 'PASS')
killed('a 20-minute run passes as a soak', mutant("    elif quiet_h < 2.9:\n", "    elif False:\n")(short()) == 'PASS')
i = run(); i['stopped'] = 'guard'
killed('a stopped run passes', mutant("    if inp.get('stopped'):\n        blind.append", "    if False:\n        blind.append")(i) == 'PASS')

print(f'\n{"OK" if not fails else "FAILED"}: {fails} failure(s)')
sys.exit(1 if fails else 0)
