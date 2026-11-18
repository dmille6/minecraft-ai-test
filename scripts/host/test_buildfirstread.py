#!/usr/bin/env python3
"""buildfirstread.py (11-18): the read of buildfirst-01show on the test world. summarize() is driven with rows in the bots' own
shapes: `_build_visit`, `_work_order` and `_well_refused` as the test world wrote them on 11-18, and `_room_well`, `_room_hold`,
`_room_yard`, `_build_first` and `_compact` as bots/src of 802f4ba3 formats them. Each count sits beside a row that must NOT
count, and the mutants prove the rules bind."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import buildfirstread as B   # noqa: E402

fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1

T0 = 1795017600.0            # 2026-11-18T16:00:00Z
T1 = T0 + 2 * 3600
A, Bv = 'showcase-Alpha', 'showcase-Bravo'
def visit(t, bot, project, outcome, placed, stop=None):
    return (t, bot, '_build_visit', 'success' if placed else 'no_effect',
            f'project={project} outcome={outcome} stop={stop or outcome} placed={placed} refused=0 silent=0 cleared=0 planted=0 unknown=0 slot=2 gen=197 took=- back=- crew=worker lane=inside ms=54965 why=93_cell(s)_no_stand', (0.5, 70, 0.5))
def order(t, bot, grounds):
    args = '{"grounds":true,"why":"idle"}' if grounds else '{"why":"idle","plot":"civicM"}'
    return (t, bot, '_work_order', 'success', f'build_shop {args} \u2014 mine crew: idle at the surface', (0.5, 70, 0.5))
def well(t, bot, plot, cobble, deep, before, after, stop=None):
    return (t, bot, '_room_well', 'success' if cobble + deep else 'no_effect',
            f'plot={plot} need=8 planned=5 slots={before}->{after} cobblestone={cobble} cobbled_deepslate={deep} then=build' + (f' stop={stop}' if stop else ''), (12.5, 74, 6.5))
def hold(t, bot, plot, wellf, ok, bank=0, plus=0):
    return (t, bot, '_room_hold', 'no_effect', f'plot={plot} free=1 min=10 bank={bank} plus={plus} well={wellf} well_ok={ok} yard_room=0', (0.5, 70, 0.5))
def first(t, bot, free, why='building'):
    return (t, bot, '_build_first', 'success', f'why={why} run=3 look=- free={free} args=plot plot=civicM', (0.5, 70, 0.5))

ROWS = [
    visit(T0 + 60, A, 'civicM', 'placed', 40), visit(T0 + 600, A, 'civicM', 'complete', 22), visit(T0 + 900, Bv, 'civicH', 'no_material', 7),
    visit(T0 + 1000, Bv, 'tidy', 'cell_deferred', 30), visit(T0 + 1100, Bv, 'house1', 'placed', 3), visit(T0 + 3700, A, 'civicH', 'placed', 0, stop='no_material'),
    visit(T0 + 3800, A, 'tidy', 'deadline', 5), visit(T0 - 10, A, 'civicM', 'placed', 99), visit(T1 + 10, A, 'civicM', 'placed', 99),
    order(T0 + 50, A, False), order(T0 + 700, A, True), order(T0 + 800, Bv, False),
    (T0 + 810, Bv, '_work_order', 'success', 'craft {"item":"stone_pickaxe","count":1} \u2014 no pick', None),
    (T0 + 820, Bv, '_work_order', 'success', 'build_shop {"plot":"shop"} \u2014 the order\'s own turn "why":"idle" is only in this text', None),
    well(T0 + 100, A, 'civicM', 295, 0, 36, 28), well(T0 + 200, Bv, 'civicH', 0, 0, 36, 36, stop='cap_unknown'), well(T0 + 3900, A, 'civicH', 128, 64, 35, 32),
    (T0 + 110, A, '_room_yard', 'success', 'plot=civicM need=8 slots=36->35 cobblestone=64 cobbled_deepslate=0 then=well', None),
    (T0 + 90, A, '_compact', 'success', 'op=bag from=clay_ball to=clay took=88 made=22 banked=- bag_slots=- why=done', None),
    (T0 + 95, Bv, '_compact', 'no_effect', 'op=bag from=clay_ball to=clay took=0 made=0 banked=- bag_slots=- why=craft_failed', None),
    (T0 + 96, Bv, '_compact', 'success', 'op=bank from=cobblestone to=stone took=64 made=64 banked=stone:64 bag_slots=36->35 why=done', None),
    hold(T0 + 300, Bv, 'civicH', '0:cap_unknown', 0), hold(T0 + 400, Bv, 'civicH', '2:cap_below_town_cap', 1), hold(T0 + 500, A, 'warehouse', '0:-', 0),
    hold(T0 + 520, A, 'warehouse', '3:ok', 1, bank=1, plus=2), hold(T0 + 540, A, 'warehouse', '9:ok', 1),
    first(T0 + 40, A, 1), first(T0 + 45, Bv, 0), first(T0 + 1200, A, 8), first(T0 + 3650, A, 9), first(T0 + 3660, Bv, 11),
    (T0 + 30, A, '_well_refused', 'refused', "order=dispose reason=unreachable could not reach the junk well's standing cell at 12,74,6 (the bot is at -2.14,70.00,-20.30)", None),
]
# Bravo stands at the well 400 s (rows every 60 s), Alpha passes it for 120 s
ROWS += [(T0 + 2000 + 60 * i, Bv, 'status', 'success', 'x', (12.4, 74, 6.6)) for i in range(8)]
ROWS += [(T0 + 2600, Bv, 'status', 'success', 'x', (30.0, 70, 6.6))]
ROWS += [(T0 + 5000 + 60 * i, A, 'status', 'success', 'x', (13.0, 74, 5.0)) for i in range(3)]
# Bravo loops well -> hold -> well on civicH; Alpha's well, hold on ANOTHER plot, well is not a loop
ROWS += [well(T0 + 6000, Bv, 'civicH', 0, 0, 36, 36), hold(T0 + 6060, Bv, 'civicH', '0:cap_unknown', 0), well(T0 + 6700, Bv, 'civicH', 0, 0, 36, 36)]
ROWS += [well(T0 + 6000, A, 'civicM', 10, 0, 36, 36), hold(T0 + 6060, A, 'warehouse', '0:-', 0), well(T0 + 6700, A, 'civicM', 10, 0, 36, 36)]

r = B.summarize(ROWS, T0, T1)
h0, h1 = T0, T0 + 3600
check(r['placed'][h0]['unfinished'] == {'civicM': 62, 'civicH': 7} and r['placed'][h0]['tidy'] == {'tidy': 30} and r['placed'][h0]['repairs'] == {'house1': 3},
      'hour 1: 69 into unfinished buildings (civicM 62, civicH 7), 30 tidy, 3 repairs; rows outside the window are not counted')
check(r['placed'][h1] == {'unfinished': {'civicH': 0}, 'tidy': {'tidy': 5}}, 'hour 2: its own row')
check(r['visits'] == {'civicM': 2, 'civicH': 2, 'tidy': 2, 'house1': 1}, 'visits per project are the denominators')
check(r['no_material'] == {'civicH': 2}, 'no_material by project: by outcome, and by stop when the outcome says something else')
check(r['outcomes']['civicM'] == {'placed': 1, 'complete': 1}, 'a project\'s outcomes are kept (civicM completed)')
check(r['idle'] == {'building': 2, 'grounds': 1}, 'idle orders: 2 building, 1 grounds; a craft order and a non-idle build order are neither')
w = r['well']
check(w['trips'] == 7 and w['threw'] == 4 and w['thrown'] == {'cobblestone': 443, 'cobbled_deepslate': 64}, 'well trips 7, 4 threw something; 443 cobblestone and 64 cobbled deepslate')
check(w['slots'][0] == (36, 28) and w['stops'].get('cap_unknown') == 1, 'slots before -> after per trip, and why a trip stopped')
check(r['yard'] == {'trips': 1, 'stocked': {'cobblestone': 64}}, 'yard trips and what they stocked')
check(r['clay'] == {'rows': 2, 'done': 1, 'made': 22}, 'clay compactions: 1 done of 2 tried, 22 blocks; a cobblestone bank compaction is not clay')
check(r['holds'] == {'cap_unknown': 2, 'cap_below': 1, 'well_dead': 2, 'short_of_8': 1, 'other:ok': 1},
      'holds by reason: cap_unknown, cap_below, well dead, short of 8 (1+2+3 slots), and one this does not know is shown as logged')
check(B.hold_reason('plot=x free=1 min=10 bank=4 plus=2 well=2:ok well_ok=1 yard_room=0') == 'other:ok' and
      B.hold_reason('plot=x free=1 min=10 bank=4 plus=1 well=2:ok well_ok=1 yard_room=0') == 'short_of_8', 'short of 8 is bank + plus + well under 8, exactly')
check(r['first_slots'] == 35 and r['slots_by_hour'][h0] == [35, 36, 28] and r['slots_by_hour'][h1] == [27, 25], 'bag slots used = 36 - free at each idle order, by hour')
check(r['build_first'] == {'building': 5}, 'the steer\'s decisions are counted by why=')
check(r['well_stand'] == (12, 74, 6), 'the well\'s standing cell is read from the bots\' own rows')
check([(b, s, sec) for b, s, sec in r['stays']] == [(Bv, T0 + 2000, 420.0)], 'Bravo stood at the well 7 min; Alpha\'s 2 minutes and single trips are not stays')
check(r['loops'] == [(Bv, T0 + 6000, 'civicH')], 'Bravo went well -> hold -> well on civicH; a hold on another plot in between is not a loop')
check(B.stays([(0, 12, 74, 6), (100, 12, 74, 6), (400, 12, 74, 6)]) == [], 'rows more than 2 minutes apart do not join into one stay')
check(B.loops([(0, 'well', 'p'), (60, 'hold', 'p'), (4000, 'well', 'p')]) == [], 'a well trip over 30 minutes later is not a loop')
md = B.render(r, 'r1', 'v')
check('| 16:00Z | 69 (civicM 62, civicH 7) | 3 (house1 3) | 30 (tidy 30) |' in md and '69 (64%) went into unfinished buildings' in md, 'the table and the share, with the total as denominator')
check('- civicM: 2 visits, 62 placed; ended placed 1, complete 1' in md and '- civicH: 2 of its 2 visits ended no_material' in md, 'each unfinished building with its visits, blocks and endings')
check('building 2 (67%), grounds 1' in md and 'median per hour: 16:00Z 35/36 (n=3); 17:00Z 26/36 (n=2)' in md, 'idle split and bag medians with n')
check('Bravo stood there 7.0 min from 16:33Z' in md and 'LOOP: Bravo went well -> hold -> well for civicH from 17:40Z' in md, 'the well stay and the loop are named')
e = B.summarize([visit(T0 + 60, A, 'tidy', 'deadline', 72), order(T0 + 70, A, True)], T0, T1)
md = B.render(e, 'old', 'v')
check('0 (0%) went into unfinished buildings' in md and 'no `_build_first` row carried a count' in md and 'none of 1 build visits ended no_material' in md
      and 'no bot stayed' in md and 'no well -> hold -> well loop' in md, 'POSITIVE CONTROL: a release without buildfirst reads as zeros with their denominators, and says it saw no steer rows')

# ---- mutants: each rule binds (the anchor must be present and unique)
SRC = open(os.path.join(HERE, 'buildfirstread.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'bfr_mutant', '__file__': os.path.join(HERE, 'buildfirstread.py')}
    exec(compile(SRC.replace(old, new), 'bfr_mutant', 'exec'), ns)
    return ns
def killed(name, got):
    check(got, 'MUTANT KILLED: ' + name)
m = mutant("        if not (t0 <= t < t1):\n            continue\n", "")
def window_broken():
    try:
        return m['summarize'](ROWS, T0, T1)['placed'][h0]['unfinished']['civicM'] != 62
    except KeyError:            # the row from before the window has no hour to land in: the mutant falls over, which is a kill
        return True
killed('rows outside the window are counted', window_broken())
m = mutant("    return 'unfinished' if project in UNFINISHED else", "    return 'unfinished' if False else")
killed('an unfinished building is filed under repairs', 'unfinished' not in m['summarize'](ROWS, T0, T1)['placed'][h0])
m = mutant("            if 'no_material' in (oc, f.get('stop')):\n", "            if 'no_material' in (oc,):\n")
killed('a visit stopped for no material under another outcome is missed', m['summarize'](ROWS, T0, T1)['no_material'] == {'civicH': 1})
m = mutant("        if near and start is not None and t - last <= STAY_GAP_S:\n", "        if near and start is not None:\n")
killed('rows any time apart join into one stay', m['stays']([(0, 12, 74, 6), (100, 12, 74, 6), (400, 12, 74, 6)]) != [])
m = mutant("a[2] == b[2] == c[2] and c[0] - a[0] <= LOOP_S", "c[0] - a[0] <= LOOP_S")
killed('a hold on another plot counts as a loop', len(m['summarize'](ROWS, T0, T1)['loops']) == 2)
m = mutant("        elif name == '_compact' and f.get('op') == 'bag' and f.get('from') == 'clay_ball':\n", "        elif name == '_compact':\n")
killed('a cobblestone compaction counts as clay', m['summarize'](ROWS, T0, T1)['clay']['rows'] == 3)

print(f'\n{"OK" if not fails else "FAILED"}: {fails} failure(s)')
sys.exit(1 if fails else 0)
