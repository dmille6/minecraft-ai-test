#!/usr/bin/env python3
"""wellread.py's correctness gates C1-C8 judge the CANARY arm only (10-15).

    python3 scripts/host/test_wellread.py            (exit 1 on any failure)

WHY: wellsite-02 was REVERTED at +360 (10-14 23:57Z) on breach_recollected = 9, and all 9 rows were hive-d-Echo, a
CONTROL bot on the base build whose `mine` dug through its town well's wall. C1-C8 accumulated over both arms.

Each gate gets the same evidence row twice: from a CONTROL bot (the canary count must stay 0, the control diagnostic
counts it) and from a CANARY bot (the canary count must fire). Both C1 inputs are covered (a _well_recollected row and
recollected= > 0 on a visit), and every C2-C8 path. The read's head is executed exactly as wellread_c9_e2e.py does
(everything before the walk, the manifest stubbed). MUTANTS at the bottom: each anchor is asserted present and unique,
and each mutant must turn at least one test red.
"""
import datetime as dt, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE)))
READ = os.environ.get('WELLREAD', os.path.join(HERE, 'wellread.py'))
BASE = open(READ).read()
ANCHOR_WALK = 'ev_rows = sorted(load_window(PRE, END)'
ANCHOR_MAN = "man = json.load(open('/srv/mcbots/trial-manifest.json'))"
assert BASE.count(ANCHOR_WALK) == 1 and BASE.count(ANCHOR_MAN) == 1, 'ANCHOR: the walk / the manifest load'


def head(src):
    os.environ['CANARY_DRYRUN'] = 'board-a:abc1234:2026-10-14T17:50:00Z'
    g = {'__name__': 'wellread_head'}
    src = src.replace(ANCHOR_MAN, 'man = {}')
    exec(compile(src[:src.index(ANCHOR_WALK)], READ, 'exec'), g)
    return g


CUT = dt.datetime(2026, 10, 14, 17, 50, tzinfo=dt.timezone.utc)
END = CUT + dt.timedelta(hours=6)
m = lambda n: CUT + dt.timedelta(minutes=n)
CAN, CTL = 'board-a-Alpha', 'hive-d-Echo'


def row(bot, name, detail, t, status='success', ver='abc1234+x'):
    return {'t': t, 'name': name, 'detail': detail, 'bot': {'name': bot},
            'raw': {'code': {'version': ver}, 'skill': {'name': name, 'status': status, 'detail': detail}}}


VISIT = 'slots=36->27 offlist=0 gclicked=0 swords=0 offlist_items=- unnamed=0 freed=9 tossed=9 n=189 misses=0 retaken=0 recollected=0 nonlisted=0 other_loss=0 server=resync closed_open=0 cap_end=closed at=79,57,76 stop=done items=egg:16'
CASES = {
    'C1 a _well_recollected row': ('c1', lambda b: [row(b, '_well_recollected', 'at=79,57,76 item=flint item_pos=79.68,56.19,76.31 feet=79.50,57.00,77.51', m(10), 'failed')]),
    'C1 recollected= on a visit': ('c1', lambda b: [row(b, '_well_dispose', VISIT.replace('recollected=0', 'recollected=2'), m(10))]),
    'C2 a cap left open': ('c2', lambda b: [row(b, '_well_left_open', 'at=79,57,76 why=close_refused', m(10), 'failed')]),
    'C3 an off-list throw': ('c3', lambda b: [row(b, '_well_dispose', VISIT.replace('offlist=0', 'offlist=1').replace('offlist_items=-', 'offlist_items=iron_ingot:5'), m(10))]),
    'C4 stuck inside': ('c4', lambda b: [row(b, '_well_inside', 'at=79,57,76 feet=79.50,56.00,76.50', m(10 + i), 'failed') for i in range(3)]),
    'C5 a miss not retaken': ('c5', lambda b: [row(b, '_well_dispose', VISIT.replace('misses=0', 'misses=1'), m(10))]),
    'C6 two active wells in one pool': ('c6', lambda b: [row(b, '_well_built', 'at=79,57,76 facing=south floor=1 wood=oak pit_first=0 pit_tossed=0 pit_items=0 free=3', m(5)),
                                                          row(b, '_well_built', 'at=90,57,76 facing=south floor=1 wood=oak pit_first=0 pit_tossed=0 pit_items=0 free=3', m(6))]),
    'C7 the stone guard': ('c7', lambda b: [row(b, '_well_dispose', VISIT.replace('gclicked=0', 'gclicked=10 stone=63').replace('items=egg:16', 'items=diorite:10'), m(10))]),
    'C8 swords outside a peaceful world': ('c8', lambda b: [row(b, '_well_dispose', VISIT.replace('swords=0', 'swords=1 peaceful=0').replace('items=egg:16', 'items=stone_sword:1'), m(10))]),
}


def size(v):
    return v if isinstance(v, int) else len(v)


def run(g):
    fails = []
    for name, (gate, mk) in CASES.items():
        ctl = g['well_gates'](mk(CTL), {'board-a'}, CUT, 'abc1234', END)
        can = g['well_gates'](mk(CAN), {'board-a'}, CUT, 'abc1234', END)
        if size(ctl['canary'][gate]) != 0:
            fails.append('%s: a CONTROL row tripped the canary gate (%r)' % (name, ctl['canary'][gate]))
        if size(ctl['control'][gate]) < 1:
            fails.append('%s: the control diagnostic did not count the control row' % name)
        if size(can['canary'][gate]) < 1:
            fails.append('%s: a CANARY row did not trip the gate (positive control)' % name)
    # the pre-window and an old-build canary row are not judged (restart lag), as the walk skips them
    pre = g['well_gates']([row(CAN, '_well_recollected', 'at=1,2,3 item=egg', CUT - dt.timedelta(minutes=5), 'failed')], {'board-a'}, CUT, 'abc1234', END)
    if pre['canary']['c1']:
        fails.append('a PRE-window row tripped C1')
    lag = g['well_gates']([row(CAN, '_well_recollected', 'at=1,2,3 item=egg', m(1), 'failed', ver='9999999+x')], {'board-a'}, CUT, 'abc1234', END)
    if lag['canary']['c1']:
        fails.append('a canary row from ANOTHER build (restart lag) tripped C1')
    # C2's close, C5's completed-visit rule and C6's retirement are ingested per arm (Codex r1 P3)
    opened = [row(CAN, '_well_left_open', 'at=79,57,76 why=close_refused', m(10), 'failed')]
    closed = opened + [row(CAN, '_well_dispose', VISIT, m(11))]                       # cap_end=closed at the same cell, 1 min later
    if g['well_gates'](closed, {'board-a'}, CUT, 'abc1234', END)['canary']['c2']:
        fails.append('C2: a canary close (cap_end=closed) did not close the canary open')
    if not g['well_gates'](opened + [row('board-b-Alpha', '_well_dispose', VISIT, m(11))], {'board-a'}, CUT, 'abc1234', END)['canary']['c2']:
        fails.append('C2: another pool\'s close closed the canary open')
    aborted = [row(CAN, '_well_dispose', VISIT.replace('misses=0', 'misses=1').replace('stop=done', 'stop=aborted'), m(10), 'aborted')]
    if g['well_gates'](aborted, {'board-a'}, CUT, 'abc1234', END)['canary']['c5']:
        fails.append('C5: an aborted visit\'s miss was judged')
    two = [row(CAN, '_well_built', 'at=79,57,76 facing=south floor=1 wood=oak pit_first=0 pit_tossed=0 pit_items=0 free=3', m(5)),
           row(CAN, '_well_built', 'at=90,57,76 facing=south floor=1 wood=oak pit_first=0 pit_tossed=0 pit_items=0 free=3', m(6))]
    if g['well_gates'](two + [row(CAN, '_well_retired', 'at=79,57,76 why=wall_is_air', m(5.5))], {'board-a'}, CUT, 'abc1234', END)['canary']['c6']:
        fails.append('C6: a retired well still counted as active')
    if g['well_gates'](two + [row(CAN, '_well_refused', 'order=dispose reason=breached at=79,57,76 x', m(5.5), 'no_effect')], {'board-a'}, CUT, 'abc1234', END)['canary']['c6']:
        fails.append('C6: a well refused as breached still counted as active')
    recent = [row(CAN, '_well_left_open', 'at=79,57,76 why=close_refused', END - dt.timedelta(seconds=30), 'failed')]
    gr = g['well_gates'](recent, {'board-a'}, CUT, 'abc1234', END)['canary']
    if gr['c2'] or not gr['c2_pending']:
        fails.append('C2: an open 30 s before the window end was judged instead of pending')
    # the hive-d sequence of 10-14, as written: 9 control rows -> canary 0, control 9
    hived = [row(CTL, '_well_recollected', 'at=79,57,76 item=%s item_pos=79.6,56.19,76.31 feet=79.50,57.00,77.51' % it, m(223), 'failed')
             for it in ('cobblestone', 'gravel', 'stone_sword', 'blue_egg', 'flint', 'clay_ball', 'glass', 'ink_sac', 'stone_bricks')]
    gh = g['well_gates'](hived, {'placebo-b', 'board-a', 'board-b', 'board-d'}, CUT, 'abc1234', END)
    if len(gh['canary']['c1']) != 0 or len(gh['control']['c1']) != 9:
        fails.append('the hive-d replay: canary %d (want 0), control %d (want 9)' % (len(gh['canary']['c1']), len(gh['control']['c1'])))
    return fails


def structural(src):
    """The walk below the head cannot be executed off the host (it reads the fleet's logs), so its WIRING is asserted on
    the comment-stripped source: the emitted gate fields are bound from well_gates' CANARY arm, after the walk's own
    all-arm lists and before the emit."""
    code = '\n'.join(l.split('#')[0] for l in src.splitlines())
    fails = []
    bind = "c1, c2, c2_pending, c3, c4, c5, c6, c7, c8 = GC['c1'], GC['c2'], GC['c2_pending'], GC['c3'], GC['c4'], GC['c5'], GC['c6'], GC['c7'], GC['c8']"
    call = "G = well_gates(ev_rows, CANS, CUT, CV, END)"
    arm = "GC, GX = G['canary'], G['control']"
    for need in (bind, call, arm, "'breach_recollected': len(c1)"):
        if code.count(need) != 1:
            fails.append('wiring: %r present %d times' % (need[:60], code.count(need)))
    if not fails:
        WALK = "for r in ev_rows:\n    t = r.get('t'); b = (r.get('bot') or {}).get('name')\n    if t is None or not b:\n        continue\n    arm ="
        if code.count(WALK) != 1:
            return fails + ['wiring: the walk\'s own loop header present %d times' % code.count(WALK)]
        i_walk, i_call, i_arm, i_bind, i_emit = (code.index(x) for x in (WALK, call, arm, bind, "'breach_recollected': len(c1)"))
        if not (i_walk < i_call < i_arm < i_bind < i_emit):
            fails.append('wiring: the canary-arm binding is not between the walk and the emit')
    return fails


FAILS = run(head(BASE)) + structural(BASE)
for f in FAILS:
    print('FAIL ', f)
print('%d of %d gate cases hold' % (len(CASES) - len({f.split(':')[0] for f in FAILS}), len(CASES)))

# ---- MUTANTS: each must turn a test red --------------------------------------------------------------------------------
MUTANTS = [
    ('every row judged as canary', "        arm = 'canary' if pool_of(b) in cans else 'control'\n        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')\n        if arm == 'canary' and cv",
                                   "        arm = 'canary'\n        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')\n        if arm == 'canary' and cv"),
    ('C1 visit input dropped', "            if num(f, 'recollected'):\n                a['c1'].append(", "            if False:\n                a['c1'].append("),
    ('C1 row input dropped', "        elif k == '_well_recollected':\n            a['c1'].append((b, d[:100]))", "        elif k == '_well_recollected':\n            pass"),
    ('the pre-window judged', "if t is None or not b or k not in WELL_KINDS or t < cut:", "if t is None or not b or k not in WELL_KINDS:"),
    ('restart-lag rows judged', "        if arm == 'canary' and cv and ver and not ver.startswith(cv):\n            continue\n        a = acc[arm]", "        a = acc[arm]"),
    ('C2 input dropped', "            a['opens'].append((t, (pool_of(b), f.get('at', '?')), b))", "            pass"),
    ('C3 not judged', "for key_, fn_ in (('c3', c3_breach), ('c7', c7_breach), ('c8', c8_breach)):", "for key_, fn_ in (('c7', c7_breach), ('c8', c8_breach)):"),
    ('C7 not judged', "for key_, fn_ in (('c3', c3_breach), ('c7', c7_breach), ('c8', c8_breach)):", "for key_, fn_ in (('c3', c3_breach), ('c8', c8_breach)):"),
    ('C8 not judged', "for key_, fn_ in (('c3', c3_breach), ('c7', c7_breach), ('c8', c8_breach)):", "for key_, fn_ in (('c3', c3_breach), ('c7', c7_breach)):"),
    ('C2 closes dropped', "                a['closes'].append((t, (pool_of(b), f['at'])))", "                pass"),
    ('C5 counts aborted visits', "            if st in ('success', 'failed') and f.get('stop') != 'aborted':\n                a['misses']", "            if True:\n                a['misses']"),
    ('C6 ignores retirements', "        elif k == '_well_retired':\n            if f.get('at'):\n                a['breached'][pool_of(b)].add(f['at'])", "        elif k == '_well_retired':\n            pass"),
    ('C6 input dropped', "            a['built'][pool_of(b)][f.get('at', '?')] += 1", "            pass"),
    ('C4 input dropped', "            a['inside'].append((t, b, f.get('at', '?')))", "            pass"),
    ('C5 not counted', "                a['misses'] += num(f, 'misses'); a['retaken'] += num(f, 'retaken')", "                pass"),
    ('the walk ignores the gates', "c1, c2, c2_pending, c3, c4, c5, c6, c7, c8 = GC['c1'], GC['c2'], GC['c2_pending'], GC['c3'], GC['c4'], GC['c5'], GC['c6'], GC['c7'], GC['c8']\n", "pass\n"),
    ('the binding moved above the walk', "G = well_gates(ev_rows, CANS, CUT, CV, END)\nGC, GX = G['canary'], G['control']\nc1, c2, c2_pending, c3, c4, c5, c6, c7, c8 = GC['c1'], GC['c2'], GC['c2_pending'], GC['c3'], GC['c4'], GC['c5'], GC['c6'], GC['c7'], GC['c8']\nmisses, retaken = GC['misses'], GC['retaken']\n", lambda src, old: src.replace(old, '').replace("rows = Counter(); kinds = Counter(); offbuild = 0\n", "rows = Counter(); kinds = Counter(); offbuild = 0\n" + old)),
    ('C2 pending ignored', "        c2, c2_pending = open_breaches(a['opens'], a['closes'], end)", "        c2, c2_pending = open_breaches(a['opens'], a['closes'], end + dt.timedelta(days=9))"),
    ('the gates read the control arm', "GC, GX = G['canary'], G['control']", "GC, GX = G['control'], G['canary']"),
]
killed = 0
for name, old, new in MUTANTS:
    assert BASE.count(old) == 1, 'MUTANT ANCHOR %r: present %d times' % (name, BASE.count(old))
    src = new(BASE, old) if callable(new) else BASE.replace(old, new)
    if name in ('the walk ignores the gates', 'the gates read the control arm', 'the binding moved above the walk'):
        ok = bool(structural(src))
    else:
        try:
            ok = bool(run(head(src)))
        except Exception as e:   # a mutant that merely BREAKS the code is a test error, never a kill (Claude r1 P3)
            print('ERROR mutant %r raised %s: %s' % (name, type(e).__name__, e)); ok = False
    killed += ok
    print('%s mutant: %s' % ('KILLED' if ok else 'SURVIVED', name))
print('mutants killed %d of %d' % (killed, len(MUTANTS)))
sys.exit(1 if FAILS or killed != len(MUTANTS) else 0)
