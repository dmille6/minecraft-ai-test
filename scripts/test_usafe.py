#!/usr/bin/env python3
"""v34 -- the UNDERGROUND-SAFETY death gate. Behaviour, end to end, and mutants.

  1. usaferule.py (pure): the DiD gate, the floor, unmeasured exposure, linkage, the registration check.
  2. usafegate.py over FIXTURE logs: PRE/POST counts and exposure, the PRE cache, linkage from own rows, unreadable
     files, a middle calendar day, spaced JSON; the check-registration CLI on the REAL airpocket registrations (pass) and
     on the version before v34 (refused: its dict in linkage_extra crashes verdict.py and changerowcheck.py).
  3. verdict.py (the file the loop runs) on a fixture where the canary pools drown at 3x the control BEFORE and AFTER
     the deploy (no change): the cross-sectional gate REVERTs it (positive control: the bias is real in the fixture),
     the v34 gate does not; the same fixture with a real tripling, and with linked deaths, REVERTs by death_gate_did.
     Needs the host lib (version_split.in_canary_pool): off the host this section is SKIPPED, loudly.
  4. MUTANTS on copies, anchors asserted present and unique.
"""
import os, sys, json, tempfile, shutil, subprocess, importlib.util, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
T = []; SKIP = []


def t(name, ok, detail=''):
    T.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + ('' if ok or not detail else f"\n        -> {str(detail)[-700:]}"))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


from deathgate import ratio_lower_bound as LB

# the registrations: staged beside this file on the host, else the repo's docs/reports
REGDIR = HERE if os.path.exists(os.path.join(HERE, 'airpocket-01.ee21207.json')) else os.path.join(HERE, '..', 'docs', 'reports')
REAL = json.load(open(os.path.join(REGDIR, 'airpocket-01.ee21207.json')))
RULES = REAL['underground_safety']['link_rules']      # every linkage case runs on the rules the canary will run with


def ap_end(aid, outcome, h0, h1):
    """An `_air_pocket` row's detail in the real format (bots/src/airpocket.mjs airPocketRow)."""
    return (f'id={aid} outcome={outcome} kind=pocket cell=1,60,2 block=stone tool=stone_pickaxe predicted_ms=3000 dig_ms=2900 '
            f'ms=6100 envelope=0.5 health={h0}->{h1} | required_ms=24150 budget_ms=30000 difficulty=peaceful | standing=0 '
            f'eye=water stand=none -- dig failed')


DROWNED = 'drowned; idle at the moment of death | leading up: mine->failed, air_pocket->failed | hp 1.8->0 over 3s | dropped: sand x5'
FELL = 'fell from a high place; idle at the moment of death | leading up: mine->failed | hp 4->0 over 1s | dropped: sand x5'


# ------------------------------------------------------------------------------------------------ 1. pure
def pure_cases(U):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    g = lambda *a: U.did_gate(*a, LB)
    c('the calibrated threshold is the one the null chose (2.0; scripts/host/usafe_null.py)', U.THRESHOLD == 2.0, U.THRESHOLD)
    c('floor: one POST death never trips -- even one whose bound alone would (1 in 1 bh vs 0 in 240 bh)',
      g(1, 1, 0, 240, 5, 300, 20, 1440)[0] is False and LB(1, 1, 0, 240) / 1 > 2.0, LB(1, 1, 0, 240))
    c('no change on a drowning pool (3x control in PRE and POST): held',
      g(6, 60, 24, 240, 6, 180, 24, 720)[0] is False, g(6, 60, 24, 240, 6, 180, 24, 720))
    c('a 5x rise against its own PRE (control flat): trips', g(30, 60, 24, 240, 6, 180, 24, 720)[0] is True, g(30, 60, 24, 240, 6, 180, 24, 720))
    c('a 3x rise at these counts does NOT clear the calibrated 2.0 (the power limit, stated in the report)',
      g(18, 60, 24, 240, 6, 180, 24, 720)[0] is False)
    c('the control ratio scales the expectation: a fleet-wide 5x is NOT the canary\'s doing',
      g(30, 60, 24, 240, 30, 180, 24, 720)[0] is False)
    c('canary PRE exposure missing -> UNREADABLE (None), never clean', g(0, 10, 0, 0, 0, 0, 20, 1440)[0] is None)
    c('control PRE exposure missing -> UNREADABLE even below the floor', g(0, 10, 3, 240, 0, 0, 0, 0)[0] is None)
    c('at the floor with control POST unmeasured -> UNREADABLE', g(3, 10, 3, 240, 0, 0, 20, 1440)[0] is None)
    c('control_ratio continuity: zero deaths in both control windows is 1.0 at equal exposure',
      abs(U.control_ratio(0, 100, 0, 100) - 1.0) < 1e-12 and U.control_ratio(1, 0, 1, 1) is None)
    c('linked deaths revert only at the floor (v23)', U.linked_reverts(1, 1)[0] is False and U.linked_reverts(1, 2)[0] is True
      and U.linked_reverts(0, 9)[0] is False)
    L = lambda t, text, own: U.link_reason(t, text, own, RULES)
    S = lambda t, aid='a1': (t, '_air_pocket_start', f'id={aid} kind=pocket cell=1,60,2 block=stone health=12 difficulty=peaceful')
    E = lambda t, outcome, h1, aid='a1': (t, '_air_pocket', ap_end(aid, outcome, 12, h1))
    c('link: a death DURING the step (start row, no end row) is linked (C3: any death between start and end)',
      L(1000, DROWNED, [S(990)]), L(1000, DROWNED, [S(990)]))
    c('link: a step that ENDED (same id) before the death is not "during"; its end row decides',
      L(1000, DROWNED, [S(900), E(910, 'failed', 8)]) is None, L(1000, DROWNED, [S(900), E(910, 'failed', 8)]))
    c('link: the end row of ANOTHER attempt does not close this one (id matched)',
      L(1000, DROWNED, [S(900, 'a2'), E(910, 'failed', 8, 'a1')]))
    c('link: a start row older than its window (300 s) with no end is not linked',
      L(1000, FELL, [S(699)]) is None and L(1000, FELL, [S(701)]))
    c('link: a drowning after a FAILED attempt whose reserve HELD (ended 8 HP) is the base rate -- NOT linked',
      L(1000, DROWNED, [E(940, 'failed', 8)]) is None and L(1000, DROWNED, [E(940, 'aborted', 3)]) is None
      and L(1000, DROWNED, [E(940, 'opened', 20)]) is None)
    c('link: a drowning after an attempt that SPENT the reserve (< 3 HP, or health unknown) IS linked',
      L(1000, DROWNED, [E(940, 'failed', 2.9)]) and L(1000, DROWNED, [E(940, 'aborted', 'null')]))
    c('link: a drowning after a SUCCESS is linked (the pocket did not hold)', L(1000, DROWNED, [E(940, 'success', 18)]))
    c('link: a NON-drowning death after a reserve-held failure is linked (the step may have caused it)',
      L(1000, FELL, [E(940, 'failed', 8)]))
    c('link: the cause is read before the first ";" -- "drown" later in the text does not excuse a fall',
      L(1000, FELL + ' | note: drowned nearby', [E(940, 'failed', 8)]))
    c('link: an end row 121 s before the death is outside the window; one written AFTER the death never links',
      L(1000, FELL, [E(879, 'success', 18)]) is None and L(1000, FELL, [E(1001, 'success', 18)]) is None
      and L(1000, FELL, [E(880, 'success', 18)]))
    c('link: a death after a PRE-EMPT with no step after it is linked; a step that followed hands it to the step rules',
      L(1000, FELL, [(950, '_air_pocket_preempt', 'asked the in-flight escape to yield')])
      and L(1000, DROWNED, [(900, '_air_pocket_preempt', 'x'), S(905), E(940, 'failed', 8)]) is None)
    good = {'class': 'underground-safety', 'draw_exposure': {'hours': 12},
            'underground_safety': {'link_rules': [{'kind': '_air_pocket', 'window_s': 120}], 'pre_hours': 24}}
    rp = U.registration_problems
    c('registration: well-formed passes; another class is not checked', rp(good) == [] and rp({'class': 'bag-fix'}) == [])
    c('registration: a dict in linkage_extra is refused by name (it crashes verdict.py)',
      any('linkage_extra' in x for x in rp(dict(good, linkage_extra=[{'kind': '_air_pocket'}]))))
    us = lambda rules: dict(good, underground_safety={'link_rules': rules, 'pre_hours': 24})
    c('registration: no block / no rules / the pre-v34 link_kinds format / bad window / bad regex / exception without a '
      'cause / no draw_exposure -> refused',
      rp({'class': 'underground-safety', 'draw_exposure': {}}) and rp(us([]))
      and rp(dict(good, underground_safety={'link_kinds': ['_x'], 'link_window_s': 120}))
      and rp(us([{'kind': '_x', 'window_s': 0}])) and rp(us([{'kind': '_x', 'until_kind': '_y', 'window_s': 7200}]))
      and rp(us([{'kind': '_x', 'window_s': 60, 'except_detail_re': '(', 'except_cause': 'drown'}]))
      and rp(us([{'kind': '_x', 'window_s': 60, 'except_detail_re': 'x'}])) and rp(us([{'kind': 'x', 'window_s': 60}]))
      and rp({k: v for k, v in good.items() if k != 'draw_exposure'}))
    c('registration: the REAL airpocket registrations pass', rp(REAL) == [], rp(REAL))
    p, n = U.randomization_p({'a': 5.0, 'b': 1.0, 'c': 0.0, 'd': -1.0}, ['a'])
    c('randomization p (report only): the top pool of 4 ranks 1 of 4', p == 0.25 and n == 4, (p, n))
    c('randomization p: a treated pool without a PRE gives no statistic, never a crash',
      U.randomization_p({'a': None, 'b': 1.0, 'c': 0.0}, ['a']) == (None, 0))
    return out


# ------------------------------------------------------------------------------------------------ 2. usafegate
def line(t, bot, kind, compact=True, detail=None, extra=None):
    r = {'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'bot': {'name': bot}, 'skill': {'name': kind}}
    if detail is not None:
        r['skill']['detail'] = detail
    if kind == '_death' and detail is None:
        r['skill']['detail'] = DROWNED
    r.update(extra or {})
    return json.dumps(r, separators=(',', ':')) if compact else json.dumps(r)


POOLS_C = ['hive-c', 'hive-d']
POOLS_K = ['board-a', 'board-b', 'board-c', 'board-d', 'hive-a', 'hive-b', 'placebo-a', 'placebo-b']
NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']


def fixture(tmp, cut, now, can_pre=24, can_post=6, ctl_pre=24, ctl_post=6, linked=0, spaced=False, silent_after=None, dead=(),
            excepted=0, decoys=0):
    """Deaths spread evenly; every bot logs a row every 2 min (the 120-s cap: full exposure) from cut-24h to now.
    silent_after: {bot: t} -- that bot stops logging at t. dead: bot dirs that exist with no rows (a stopped unit)."""
    root = tempfile.mkdtemp(dir=tmp)
    rows = {}
    can = [f'{p}-{n}' for p in POOLS_C for n in NAMES]; ctl = [f'{p}-{n}' for p in POOLS_K for n in NAMES]
    t0 = cut - dt.timedelta(hours=24)
    for b in can + ctl:
        t = t0; stop = (silent_after or {}).get(b, now)
        rows.setdefault(b, [])
        if b in dead:
            continue
        while t < min(now, stop):
            rows[b].append(line(t, b, 'gather', not spaced)); t += dt.timedelta(minutes=2)

    def spread(bots, n, a, z, kind='_death'):
        bots = [x for x in bots if x not in dead]
        for i in range(n):
            t = a + (z - a) * (i + 0.5) / max(1, n)
            rows[bots[i % len(bots)]].append(line(t, bots[i % len(bots)], kind, not spaced))
    spread(can, can_pre, t0, cut); spread(can, can_post, cut, now)
    spread(ctl, ctl_pre, t0, cut); spread(ctl, ctl_post, cut, now)
    for i in range(linked):     # a SUCCESSFUL attempt's end row 60 s before a POST drowning on the same bot: linked
        b = can[i]; td = cut + dt.timedelta(minutes=30 + 7 * i)
        rows[b].append(line(td - dt.timedelta(seconds=60), b, '_air_pocket', not spaced, ap_end('s%d' % i, 'success', 12, 18)))
        rows[b].append(line(td, b, '_death', not spaced))
    for i in range(excepted):   # a FAILED attempt that kept its reserve (8 HP), then the drowning it could not prevent
        b = can[-1 - i]; td = cut + dt.timedelta(minutes=40 + 7 * i)
        rows[b].append(line(td - dt.timedelta(seconds=60), b, '_air_pocket', not spaced, ap_end('f%d' % i, 'failed', 12, 8)))
        rows[b].append(line(td, b, '_death', not spaced))
    for i in range(decoys):     # rows of another kind that carry "_death" as a name ELSEWHERE in the row: not deaths
        b = can[i % len(can)]; td = cut + dt.timedelta(minutes=50 + 3 * i)
        rows[b].append(line(td, b, 'gather', not spaced, 'x', {'target': {'name': '_death'}}))
    for b, ls in rows.items():
        os.makedirs(os.path.join(root, b))
        if not ls:
            continue
        open(os.path.join(root, b, f'skill-{b}.jsonl'), 'w').write('\n'.join(sorted(ls, key=lambda l: l[14:38] if l[1] == '"' else l)) + '\n')
    return root, can, ctl


REG = {'class': 'underground-safety', 'draw_exposure': {'hours': 12}, 'underground_safety': REAL['underground_safety']}


def gate_cases(G, tmp):
    tmp = tempfile.mkdtemp(dir=tmp)      # FRESH STATE per run: caches and roster files never leak between runs (round 6)
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    now = dt.datetime(2026, 10, 8, 2, 0, tzinfo=dt.timezone.utc); cut = now - dt.timedelta(hours=6)
    root, can, ctl = fixture(tmp, cut, now)
    m = G.measure(root, REG, can, ctl, cut, now, os.path.join(tmp, 'pre1.json'), expected_pools=POOLS_C)
    c('measure: PRE and POST deaths per arm; exposure (capped 120-s gaps) ~ bots x hours', (m['a'], m['b'], m['c'], m['d']) == (6, 24, 6, 24)
      and abs(m['ta'] - 10 * 5.97) < 1.5 and abs(m['tb'] - 10 * 23.97) < 2 and abs(m['td'] - 40 * 23.97) < 8, m)
    c('capped_gaps: a 10-min silence counts 120 s, not 600', abs(sum(x for _t, x in G.capped_gaps([0, 60, 660, 720])) - 240) < 1e-9)
    c('measure: no change at 4x the control level -> HOLD', G.decide(m, LB)[0] == 'HOLD', G.decide(m, LB))
    c('measure: the PRE is cached under its key', os.path.exists(os.path.join(tmp, 'pre1.json'))
      and json.load(open(os.path.join(tmp, 'pre1.json')))['b'] == 24)
    root2, _, _ = fixture(tmp, cut, now, can_post=30)
    m2 = G.measure(root2, REG, can, ctl, cut, now, os.path.join(tmp, 'pre2.json'))
    c('measure: a 5x rise against its own PRE -> REVERT', G.decide(m2, LB)[0] == 'REVERT', G.decide(m2, LB))
    root3, _, _ = fixture(tmp, cut, now, can_post=2, linked=2)
    m3 = G.measure(root3, REG, can, ctl, cut, now, None)
    c('measure: two deaths 60 s after the bot\'s own _air_pocket row -> REVERT (mechanism-linked)',
      len(m3['linked']) == 2 and G.decide(m3, LB)[0] == 'REVERT' and 'MECHANISM' in G.decide(m3, LB)[1], (m3['linked'], G.decide(m3, LB)))
    root3b, _, _ = fixture(tmp, cut, now, can_post=2, linked=2)
    open(os.path.join(root3b, ctl[0], 'skill-%s.jsonl-20991231.gz' % ctl[0]), 'wb').write(b'not gzip')
    m3b = G.measure(root3b, REG, can, ctl, cut, now, None)
    c('measure: linked harm still REVERTs when an UNRELATED file is unreadable (round 1, Codex)',
      m3b['errors'] >= 1 and G.decide(m3b, LB)[0] == 'REVERT', G.decide(m3b, LB))
    rootX, _, _ = fixture(tmp, cut, now, can_post=0, excepted=2)
    mX = G.measure(rootX, REG, can, ctl, cut, now, None)
    c('measure: two drownings after failed attempts that KEPT the reserve are not linked -> HOLD (a working fix survives '
      'the deaths it could not prevent)', mX['a'] == 2 and mX['linked'] == [] and G.decide(mX, LB)[0] == 'HOLD', (mX['linked'], G.decide(mX, LB)))
    rootY, _, _ = fixture(tmp, cut, now, decoys=6)
    mY = G.measure(rootY, REG, can, ctl, cut, now, None)
    c('measure: a row whose OWN kind is not _death but names "_death" elsewhere is not a death', mY['a'] == 6, mY['a'])
    rootZ, _, _ = fixture(tmp, cut, now)
    import gzip as _gz
    raw = bytearray(_gz.compress(open(os.path.join(rootZ, can[1], f'skill-{can[1]}.jsonl'), 'rb').read())); raw[12] ^= 0x55
    open(os.path.join(rootZ, can[1], f'skill-{can[1]}.jsonl-20991231.gz'), 'wb').write(bytes(raw))
    try:
        mZ = G.measure(rootZ, REG, can, ctl, cut, now, None); dZ = G.decide(mZ, LB)
    except Exception as e:      # noqa: BLE001
        mZ = {'errors': 0}; dZ = ('CRASH %s' % type(e).__name__, '')
    c('measure: a gz whose BODY is corrupt (zlib.error) is counted and UNREADABLE, never a crash (round 1, Claude)',
      mZ['errors'] >= 1 and dZ[0] == 'UNREADABLE', dZ)
    dR = G.decide(m3, LB, linkage_report_only=True)
    c('decide: under a RATE licence two linked deaths are REPORTED, not a verdict (v31; round 4, Codex)',
      dR[0] == 'HOLD' and 'REPORT ONLY' in dR[1], dR)
    dR2 = G.decide(m2, LB, linkage_report_only=True)
    c('decide: ... and the statistical gate still REVERTs a 5x rise under a rate licence', dR2[0] == 'REVERT', dR2)
    root4, _, _ = fixture(tmp, cut, now, linked=1, can_post=0)
    m4 = G.measure(root4, REG, can, ctl, cut, now, None)
    c('measure: ONE linked death is reported, not a verdict (v23 floor)', len(m4['linked']) == 1 and G.decide(m4, LB)[0] != 'REVERT',
      G.decide(m4, LB))
    bad = os.path.join(root, can[0], f'skill-{can[0]}.jsonl-20991231.gz'); open(bad, 'wb').write(b'not gzip')
    m5 = G.measure(root, REG, can, ctl, cut, now, None)
    c('measure: an unreadable log file -> UNREADABLE, never zero deaths', G.decide(m5, LB)[0] == 'UNREADABLE', G.decide(m5, LB))
    os.remove(bad)
    root6, _, _ = fixture(tmp, cut, now, spaced=True)
    m6 = G.measure(root6, REG, can, ctl, cut, now, None)
    c('measure: spaced JSON reads the same as compact (a format change is not zero exposure)',
      (m6['a'], m6['b'], m6['c'], m6['d']) == (6, 24, 6, 24) and m6['tb'] > 200, m6)
    long_now = cut + dt.timedelta(hours=30)
    root7, _, _ = fixture(tmp, cut, long_now, can_post=12)
    m7 = G.measure(root7, REG, can, ctl, cut, long_now, None)
    c('measure: a 30-h POST across three calendar dates sees every day (deaths and exposure)',
      m7['a'] == 12 and abs(m7['ta'] - 10 * 29.97) < 3, m7)
    rootS, _, _ = fixture(tmp, cut, now, silent_after={can[3]: cut + dt.timedelta(minutes=20)})
    mS = G.measure(rootS, REG, can, ctl, cut, now, None, expected_pools=POOLS_C)
    c('measure: a canary bot that ran in PRE and goes silent in POST -> UNREADABLE, named (round 1, Codex)',
      G.decide(mS, LB)[0] == 'UNREADABLE' and can[3] in G.decide(mS, LB)[1], G.decide(mS, LB))
    rootD, _, _ = fixture(tmp, cut, now, dead=(can[2],))
    mD = G.measure(rootD, REG, can, ctl, cut, now, None, expected_pools=POOLS_C)
    c('measure: a stopped unit (directory, no rows in PRE) is not in the roster -> HOLD, and it is named',
      G.decide(mD, LB)[0] == 'HOLD' and can[2] in G.decide(mD, LB)[1], G.decide(mD, LB))
    mP = G.measure(root, REG, can, ctl, cut, now, None, expected_pools=POOLS_C + ['placebo-d'])
    c('measure: a declared canary pool with no bot running -> UNREADABLE', G.decide(mP, LB)[0] == 'UNREADABLE'
      and 'placebo-d' in G.decide(mP, LB)[1], G.decide(mP, LB))
    rootV, _, _ = fixture(tmp, cut, now)
    cp = os.path.join(tmp, 'preV.json')
    mV0 = G.measure(rootV, REG, can, ctl, cut, now, cp, expected_pools=POOLS_C)
    shutil.rmtree(os.path.join(rootV, can[4]))
    can_now = [b for b in can if b != can[4]]          # what directory discovery would list after the loss
    mV1 = G.measure(rootV, REG, can_now, ctl, cut, now, cp, expected_pools=POOLS_C)
    c('measure: a roster bot whose directory DISAPPEARS after the first poll -> UNREADABLE, named (round 2, Codex: the '
      'roster never shrinks)', G.decide(mV0, LB)[0] == 'HOLD' and G.decide(mV1, LB)[0] == 'UNREADABLE'
      and can[4] in G.decide(mV1, LB)[1], (G.decide(mV0, LB)[0], G.decide(mV1, LB)))
    mV2 = G.measure(rootV, REG, can_now, ctl, cut, cut + dt.timedelta(minutes=50), cp, expected_pools=POOLS_C)
    c('measure: ... and inside the first hour too, before the POST coverage rule applies', G.decide(mV2, LB)[0] == 'UNREADABLE'
      and can[4] in G.decide(mV2, LB)[1], G.decide(mV2, LB))
    open(cp + '.roster', 'w').write('{"active": ["' + can[0])          # truncated mid-write
    mV3 = G.measure(rootV, REG, can, ctl, cut, now, cp, expected_pools=POOLS_C)
    c('measure: an established roster file that cannot be read -> UNREADABLE, never an empty roster (round 3, Codex)',
      G.decide(mV3, LB)[0] == 'UNREADABLE' and 'roster' in G.decide(mV3, LB)[1], G.decide(mV3, LB))
    rootW, _, _ = fixture(tmp, cut, now)
    with open(os.path.join(rootW, can[0], f'skill-{can[0]}.jsonl'), 'a') as fh:     # the bot is mid-write
        fh.write('{"@timestamp":"%s","bot":{"name":"%s"},"skill":{"name":"_death","det' % (
            (now - dt.timedelta(seconds=5)).strftime('%Y-%m-%dT%H:%M:%S.000Z'), can[0]))
    mW = G.measure(rootW, REG, can, ctl, cut, now, None, expected_pools=POOLS_C)
    c('measure: an unterminated last line (the bot mid-write) is skipped, not an error (round 2, Claude)',
      mW['errors'] == 0 and G.decide(mW, LB)[0] == 'HOLD', (mW['errors'], G.decide(mW, LB)))
    empty = tempfile.mkdtemp(dir=tmp)
    m8 = G.measure(empty, REG, can, ctl, cut, now, None)
    c('measure: no logs at all -> UNREADABLE (zero exposure is not a clean canary)', G.decide(m8, LB)[0] == 'UNREADABLE', G.decide(m8, LB))
    return out


def cli_cases(gate_py, tmp):
    tmp = tempfile.mkdtemp(dir=tmp)
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    regs = tempfile.mkdtemp(dir=tmp)
    rep = REGDIR
    for f in ('airpocket-01.ee21207.json', 'airpocket-01.dbb4d78.json'):
        shutil.copy(os.path.join(rep, f), os.path.join(regs, 'r-' + f[13:20] + '.json'))
    old = json.load(open(os.path.join(rep, 'airpocket-01.ee21207.json')))
    old.pop('underground_safety', None); old['linkage_extra'] = [{'kind': '_air_pocket', 'window_s': 120}]
    json.dump(old, open(os.path.join(regs, 'r-old.json'), 'w'))
    env = dict(os.environ, USAFE_REG_DIR=regs)
    for r, want in (('r-ee21207', 0), ('r-dbb4d78', 0), ('r-old', 2)):
        p = subprocess.run([sys.executable, gate_py, 'check-registration', r], capture_output=True, text=True, env=env)
        c('check-registration %s -> exit %d' % (r, want), p.returncode == want, p.stdout + p.stderr)
    for f in ('airpocket-01.ee21207.json', 'airpocket-01.dbb4d78.json'):
        r = json.load(open(os.path.join(rep, f)))
        c('%s declares class underground-safety (v33\'s next-slot rule expects it)' % f, r.get('class') == 'underground-safety')
    # the replay CLI decides as the live gate does, licence included (round 5, Codex)
    now = dt.datetime(2026, 10, 8, 2, 0, tzinfo=dt.timezone.utc); cut = now - dt.timedelta(hours=6)
    iso = lambda t: t.isoformat().replace('+00:00', 'Z')
    for name, lic, kw, want in (('rate licence, two linked deaths', 'rate', dict(can_post=2, linked=2), 'HOLD'),
                                ('kind licence, two linked deaths', 'kind', dict(can_post=2, linked=2), 'REVERT'),
                                ('rate licence, a 5x rise', 'rate', dict(can_post=30), 'REVERT')):
        rootL, _, _ = fixture(tmp, cut, now, **kw)
        rf = os.path.join(regs, 'lic-%s.json' % name.replace(' ', '_').replace(',', ''))
        json.dump(dict(REG, licence={'class': lic}), open(rf, 'w'))
        p = subprocess.run([sys.executable, gate_py, 'window', ','.join(POOLS_C), iso(cut), iso(now), '24', rf],
                           capture_output=True, text=True, env=dict(os.environ, USAFE_LOG_ROOT=rootL))
        last = (p.stdout.strip().splitlines() or [''])[-1]
        c('window CLI, %s -> %s' % (name, want), last.startswith('USAFE %s' % want), last[:300] + p.stderr[-300:])
    return out


# ------------------------------------------------------------------------------------------------ 3. verdict.py
def verdict_cases(verdict_py, tmp):
    out = []
    for _cand in (os.path.join(os.path.dirname(verdict_py), 'lib'), '/home/mike/mcai-analysis/lib', '/opt/minecraft-ai/scripts/lib'):
        if os.path.isdir(_cand):
            sys.path.insert(1, _cand)
            break
    try:
        from version_split import in_canary_pool  # noqa: F401
    except ImportError:
        SKIP.append('verdict.py v34 cases: this lib has no version_split.in_canary_pool (repo lib drift) -- run on the host')
        return out
    c = lambda n, ok, d='': out.append((n, bool(ok), d))

    def run(reg_extra, can_post, linked=0, poll=True, c3=0, silent=False, v15c='OK', extra_read=False):
        d = tempfile.mkdtemp(dir=tmp)
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0); cut = now - dt.timedelta(hours=3)
        sil = {f'{POOLS_C[0]}-{NAMES[3]}': cut + dt.timedelta(minutes=10)} if silent else None
        root, can, ctl = fixture(d, cut, now, can_pre=48, can_post=can_post, ctl_pre=48, ctl_post=6, linked=linked, silent_after=sil)
        reads = os.path.join(d, 'reads'); regs = os.path.join(d, 'regs'); os.makedirs(reads); os.makedirs(regs)
        reg = dict({'run_id': 'ut-01', 'sha': 'abc1234', 'reads': ['immobiledid', 'apread'] + (['otherread'] if extra_read else []),
                    'read_minutes': [180, 360],
                    'deadline_min': 420, 'change_rows': [], 'exposure': None,
                    'own_lines': [{'read': 'apread', 'field': 'breach_reserve_spent', 'op': '<=', 'value': 0,
                                   'on_fail': 'REVERT', 'evidence': 'defect'}]}, **reg_extra)
        json.dump(reg, open(os.path.join(regs, 'ut-01.json'), 'w'))
        man = {'run_id': 'ut-01', 'canary_pool': ','.join(POOLS_C), 'canary_code_version': 'abc1234',
               'declared_code_version': 'base000', 'declared_at': cut.isoformat().replace('+00:00', 'Z')}
        mp = os.path.join(d, 'man.json'); json.dump(man, open(mp, 'w'))
        M = 0 if poll else 180
        if not poll:
            # the scheduled read's evidence, bound like a real read (immobiledid's harm is the cross-sectional view)
            sys.path.insert(0, HERE)
            import test_verdict_acceptance as A
            for name, fields in (('immobiledid', A.immobiledid(v15c=v15c, canary_deaths=can_post, canary_bh=30.0, control_deaths=6, control_bh=240.0)),
                                 ('apread', {'breach_reserve_spent': c3})):
                json.dump({'sha': 'abc1234', 'pools': man['canary_pool'], 'run_id': 'ut-01', 'declared_at': man['declared_at'],
                           'window_min': M, 'emitted_at': now.isoformat(), 'fields': fields},
                          open(os.path.join(reads, 'ut-01-%s-%d.json' % (name, M)), 'w'))
        e = dict(os.environ, VERDICT_READS_DIR=reads, VERDICT_LOG_ROOT=root, VERDICT_REG_DIR=regs, VERDICT_MANIFEST=mp)
        r = subprocess.run([sys.executable, verdict_py, 'ut-01', str(M)] + (['--poll'] if poll else []), capture_output=True,
                           text=True, env=e, cwd=HERE, timeout=300)
        head = (r.stdout.strip().splitlines() or [''])[-1]
        try:
            art = json.load(open(os.path.join(reads, 'ut-01-verdict-%d.json' % M)))
        except Exception:
            art = {}
        return (head.split()[1] if head.startswith('VERDICT') else 'CRASH:' + (r.stderr or '')[-300:]), head, art
    us = {'class': 'underground-safety', 'draw_exposure': {'hours': 12}, 'underground_safety': REG['underground_safety']}
    v, h, a = run({}, 6)
    c('POSITIVE CONTROL: the cross-sectional gate REVERTs a no-change canary on pools drowning at 4x the control', v == 'REVERT', h)
    v, h, a = run(us, 6)
    c('v34: the same no-change canary is HELD (each arm against its own PRE)', v == 'POLL_OK' and 'UNDERGROUND-SAFETY' in h, h)
    v, h, a = run(us, 40)
    c('v34: a 6.7x rise against its own PRE REVERTs by death_gate_did', v == 'REVERT' and (a.get('extra') or {}).get('by') == 'death_gate_did', h)
    v, h, a = run(dict(us, licence={'class': 'rate'}), 0, linked=2)
    c('v34 poll, RATE licence: two linked deaths are reported, not a REVERT (v31)', v == 'POLL_OK' and 'REPORT ONLY' in h, h)
    v, h, a = run(dict(us, licence={'class': 'rate'}), 40)
    c('v34 poll, RATE licence: a 6.7x rise still REVERTs by death_gate_did (the statistical gate is not an instrument)',
      v == 'REVERT' and (a.get('extra') or {}).get('by') == 'death_gate_did', h)
    v, h, a = run(us, 0, linked=2)
    c('v34: two mechanism-linked deaths REVERT', v == 'REVERT' and 'MECHANISM' in h, h)
    v, h, a = run({}, 6, poll=False)
    c('READ +180, POSITIVE CONTROL: the cross-sectional gate REVERTs the no-change canary at a scheduled read too', v == 'REVERT', h)
    v, h, a = run(us, 6, poll=False)
    c('READ +180, v34: the no-change canary is not reverted (NOT_YET before the last read)', v == 'NOT_YET' and 'UNDERGROUND-SAFETY' in h, h)
    v, h, a = run(us, 40, poll=False)
    c('READ +180, v34: a 6.7x rise REVERTs by death_gate_did at a scheduled read', v == 'REVERT'
      and (a.get('extra') or {}).get('by') == 'death_gate_did', h)
    v, h, a = run(us, 6, silent=True)
    c('v34 poll: a canary bot silent since +10 min -> UNREADABLE (paged by the loop), not POLL_OK', v == 'UNREADABLE', h)
    v, h, a = run(us, 6, poll=False, silent=True)
    c('READ +180, v34: the death gate is blind and nothing else reverts -> UNREADABLE', v == 'UNREADABLE', h)
    v, h, a = run(us, 6, poll=False, silent=True, c3=1)
    c('READ +180, v34: the death gate is blind BUT the reserve gate (C3) breached -> REVERT by the own line (round 1, '
      'Claude: blindness must not hide a REVERT)', v == 'REVERT' and 'breach_reserve_spent' in h, h)
    v, h, a = run(us, 6, poll=False, silent=True, v15c='REVERT stuck share +40% (fixture)')
    c('READ +180, v34: the death gate is blind and the v15c movement guard REVERTs -> REVERT (blindness defers, never hides)',
      v == 'REVERT' and 'v15c' in h, h)
    v, h, a = run(us, 6, poll=False, c3=1, v15c='UNREADABLE (every movement guard undefined)')
    c('READ +180, v34: the movement guard is UNREADABLE but C3 breached -> REVERT by the defect line (round 2, Codex)',
      v == 'REVERT' and 'breach_reserve_spent' in h, h)
    v, h, a = run(us, 6, poll=False, c3=1, extra_read=True)
    c('READ +180, v34: an unrelated registered read has no evidence but C3 breached -> REVERT by the defect line',
      v == 'REVERT' and 'breach_reserve_spent' in h, h)
    v, h, a = run(us, 6, poll=False, c3=0, v15c='UNREADABLE (every movement guard undefined)')
    c('READ +180, v34: movement guard UNREADABLE and C3 clean -> UNREADABLE (the early defect check reverts nothing else)',
      v == 'UNREADABLE', h)
    v, h, a = run({}, 1, poll=False, c3=1, v15c='UNREADABLE (every movement guard undefined)')   # 1 death: the XS gate cannot decide
    c('READ +180, another class: the early defect check is v34-only (movement UNREADABLE still answers UNREADABLE)',
      v == 'UNREADABLE', h)
    v, h, a = run(dict(us, licence={'class': 'rate'}), 6, poll=False, c3=1, v15c='UNREADABLE (every movement guard undefined)')
    c('READ +180, v34 with a RATE licence: the early defect check keeps v31 report-only (no REVERT on an own line)',
      v != 'REVERT', h)
    v, h, a = run(us, 1, poll=False, c3=1)
    c('READ +180, v34: ONE canary death -- the death gate and linkage hold (floor), the C3 DEFECT line still reverts',
      v == 'REVERT' and 'breach_reserve_spent' in h and (a.get('extra') or {}).get('by') is None, h)
    v, h, a = run(us, 6, poll=False, c3=1)
    c('READ +180, v34: no death harm but the reserve gate (C3) breached -> REVERT by the own line', v == 'REVERT'
      and 'breach_reserve_spent' in h and (a.get('extra') or {}).get('by') is None, h)
    return out


MUTANTS = [
    ('usaferule.py', 'threshold back to the uncalibrated 1.25', 'THRESHOLD = 2.0', 'THRESHOLD = 1.25'),
    ('usaferule.py', 'floor dropped', "    if a < floor:\n        return False, 0.0,", "    if a < 0:\n        return False, 0.0,"),
    ('usaferule.py', 'control ratio ignored', "    lb = lower_bound(a, ta, b, tb) / rk", "    lb = lower_bound(a, ta, b, tb)"),
    ('usaferule.py', 'compares with the control instead of its own PRE (the old bias)', "    lb = lower_bound(a, ta, b, tb) / rk",
     "    lb = lower_bound(a, ta, c, tc)"),
    ('usaferule.py', 'missing exposure reads as clean', "    if not ta or not tb or ta <= 0 or tb <= 0 or not td or td <= 0:", "    if False:"),
    ('usaferule.py', 'linked deaths ignore the floor', "    if deaths < floor:\n        return False, ('%d linked", "    if False:\n        return False, ('%d linked"),
    ('usaferule.py', 'link exception ignored (a reserve-held drowning would revert a working fix)',
     "                if exc and re.search(exc, d or '') and r.get('except_cause', '\\0') in cause:",
     "                if False:"),
    ('usaferule.py', 'link exception applied to every cause', "r.get('except_cause', '\\0') in cause:", "True:"),
    ('usaferule.py', 'link exception reads the whole death text, not its cause', "        cause = (death_text or '').split(';', 1)[0]",
     "        cause = death_text or ''"),
    ('usaferule.py', 'after-row window ignored', "                if k != r['kind'] or death_t - t > r['window_s']:", "                if k != r['kind']:"),
    ('usaferule.py', 'a death during the step is not linked', "            if not closed:\n                return", "            if False:\n                return"),
    ('usaferule.py', 'any end row closes the step (id ignored)', "(sid is None or _id(d) == sid)", "True"),
    ('usaferule.py', 'rows written after the death link', "    before = [(t, k, d) for t, k, d in own if t <= death_t]", "    before = list(own)"),
    ('usaferule.py', 'during-step window ignored', "k == r['kind'] and death_t - t <= r.get('window_s', 600)]", "k == r['kind']]"),
    ('usaferule.py', 'dict linkage_extra accepted', "        if not isinstance(x, str):", "        if False:"),
    ('usafegate.py', 'unreadable files are silent', "            errors[0] += 1\n            sys.stderr.write('usafegate", "            pass\n            sys.stderr.write('usafegate"),
    ('usafegate.py', 'own rows never collected', "                        k = next((k for k in kinds if _named(l, k)), None)", "                        k = None"),
    ('usafegate.py', 'kind matched anywhere in the row (not anchored on skill.name)',
     """    return ('"skill":{"name":"%s"' % kind) in line or""", """    return ('"name":"%s"' % kind) in line or"""),
    ('usafegate.py', 'a corrupt gz body crashes the gate', "gzip.BadGzipFile, zlib.error, UnicodeDecodeError)", "gzip.BadGzipFile, UnicodeDecodeError)"),
    ('usafegate.py', 'spaced timestamps unread', "    m = _TS.match(line)", "    m = None"),
    ('usafegate.py', 'errors do not stop the decision', "    if m['errors']:\n        gaps.append", "    if False:\n        gaps.append"),
    ('usafegate.py', 'a rate licence ignored by the linkage', "    if lrev and linkage_report_only:", "    if False:"),
    ('usafegate.py', 'the replay CLI ignores the licence', "linkage_report_only=U.licence_report_only(reg))", "linkage_report_only=False)"),
    ('usaferule.py', 'licence_report_only always False', "    return isinstance(lic, dict) and lic.get('class') == 'rate'", "    return False"),
    ('usafegate.py', 'linkage never reverts', "    if lrev:\n        extra = ", "    if False:\n        extra = "),
    ('usafegate.py', 'exposure uncapped (first-to-last span)', "    return [(ts[i], min(ts[i + 1] - ts[i], CAP_S)) for i in range(len(ts) - 1)]",
     "    return [(ts[i], ts[i + 1] - ts[i]) for i in range(len(ts) - 1)]"),
    ('usafegate.py', 'POST coverage ignored', "    if m.get('short_post'):\n        gaps.append", "    if False:\n        gaps.append"),
    ('usafegate.py', 'roster includes stopped units', "    active = sorted(x for x in canary_bots if x not in set(short))", "    active = sorted(canary_bots)"),
    ('usafegate.py', 'the roster shrinks with directory discovery',
     "    c['roster'] = sorted(set(first) | set(c.get('active') or []))", "    c['roster'] = sorted(set(c.get('active') or []))"),
    ('usafegate.py', 'an unreadable roster file reads as empty', "    if m.get('roster_error'):\n        gaps.append", "    if False:\n        gaps.append"),
    ('usafegate.py', 'vanished roster bots ignored', "    if m.get('vanished'):\n        gaps.append", "    if False:\n        gaps.append"),
    ('usafegate.py', 'a partial last line counts as an error',
     "                            if not l.endswith('\\n'):\n                                continue",
     "                            if False:\n                                continue"),
    ('usafegate.py', 'missing pools ignored', "    if m.get('missing_pools'):\n        gaps.append", "    if False:\n        gaps.append"),
    ('verdict.py', 'v34 only in the poll', "if _USAFE and not DRY:\n    import usafegate", "if _USAFE and not DRY and POLL:\n    import usafegate"),
    ('verdict.py', 'v34 gate never consulted', "_USAFE = usaferule.is_underground_safety(reg)", "_USAFE = False"),
    ('verdict.py', 'v34 early defect check disabled', "if _USAFE and not POLL and not _LIC_REPORT_ONLY:\n    for ln in reg.get('own_lines', []):",
     "if False:\n    for ln in reg.get('own_lines', []):"),
    ('verdict.py', 'early defect check ignores the report-only licence', "if _USAFE and not POLL and not _LIC_REPORT_ONLY:",
     "if _USAFE and not POLL:"),
    ('verdict.py', 'early defect check applied to every class', "if _USAFE and not POLL and not _LIC_REPORT_ONLY:\n    for ln in reg.get('own_lines', []):",
     "if not POLL and not _LIC_REPORT_ONLY:\n    for ln in reg.get('own_lines', []):"),
    ('verdict.py', 'the rate licence not passed to the v34 linkage', "linkage_report_only=_LIC_REPORT_ONLY)", "linkage_report_only=False)"),
    ('verdict.py', 'v34 REVERT dropped', "    if _uw == 'REVERT':\n", "    if False:\n"),
    ('verdict.py', 'a death-gate UNREADABLE at a read is dropped', "if _USAFE_BLIND:\n", "if False:\n"),
    ('verdict.py', 'a death-gate UNREADABLE at a read stops the evaluation (hides the own lines)',
     "        _USAFE_BLIND = _uwhy", "        (out('UNREADABLE', {'by': 'death_gate_did'}))"),
]


def run_all(rule, gate, verdict_py, tmp, quiet=False):
    U = load(rule, 'usaferule')
    G = load(gate, 'usafegate')
    res = pure_cases(U)
    if quiet and not all(ok for _n, ok, _d in res):
        return res
    res += gate_cases(G, tmp)
    res += cli_cases(gate, tmp)          # mutants run the CLI cases too (round 6, Codex: two CLI mutants survived)
    return res


if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='usafetest-')
    R = os.path.join(HERE, 'usaferule.py'); G = os.path.join(HERE, 'usafegate.py'); V = os.path.join(HERE, 'verdict.py')
    VBASE = verdict_cases(V, tmp)
    VBASE_OK = bool(VBASE) and all(ok for _n, ok, _d in VBASE)
    for n, ok, d in run_all(R, G, V, tmp) + VBASE:
        t(n, ok, d)
    print('\nmutants (copies; anchors asserted present and unique; each must FAIL a case):')
    # THE UNMUTATED CONTROL, through the same copy-and-run path as every mutant (round 6, Codex): a kill counts only if
    # this passes, so a failure caused by the runner (shared state, a missing module) can never score as a kill.
    _cd = tempfile.mkdtemp(dir=tmp)
    for f in ('usaferule.py', 'usafegate.py', 'deathgate.py', 'verdict.py', 'singledeath.py', 'bagfixrule.py',
              'bagfixgate.py', 'changerowcheck.py', 'arms.py'):
        if os.path.exists(os.path.join(HERE, f)):
            shutil.copy(os.path.join(HERE, f), _cd)
    _cres = run_all(os.path.join(_cd, 'usaferule.py'), os.path.join(_cd, 'usafegate.py'), V, tmp, quiet=True)
    CONTROL_OK = bool(_cres) and all(ok for _n, ok, _d in _cres)
    t('mutant runner control: the UNMUTATED copies pass every pure, gate and CLI case (%d)' % len(_cres), CONTROL_OK,
      [n for n, ok, _d in _cres if not ok][:5])
    for fname, name, old, new in MUTANTS:
        src = open(os.path.join(HERE, fname)).read()
        assert old in src, 'ANCHOR MISSING in %s: %r' % (fname, old)
        if fname != 'verdict.py' and not CONTROL_OK:
            t(f'mutant NOT SCORED: {fname}: {name} (the unmutated control copy fails, so a kill proves nothing)', False)
            continue
        assert src.count(old) == 1, 'ANCHOR NOT UNIQUE in %s (%d): %r' % (fname, src.count(old), old)
        md = tempfile.mkdtemp(dir=tmp)
        for f in ('usaferule.py', 'usafegate.py', 'deathgate.py', 'verdict.py', 'singledeath.py', 'bagfixrule.py',
                  'bagfixgate.py', 'changerowcheck.py', 'arms.py'):
            if os.path.exists(os.path.join(HERE, f)):
                shutil.copy(os.path.join(HERE, f), md)
        open(os.path.join(md, fname), 'w').write(src.replace(old, new, 1))
        if fname == 'verdict.py':
            if VBASE and not VBASE_OK:
                t(f'mutant NOT SCORED: {fname}: {name} (the unmutated verdict cases fail, so a kill proves nothing)', False)
                continue
            n0 = len(SKIP)
            res = verdict_cases(os.path.join(md, 'verdict.py'), tmp)
            if len(SKIP) > n0:
                SKIP.pop(); SKIP.append('verdict.py mutant "%s": host only' % name); continue
        else:
            try:
                res = run_all(os.path.join(md, 'usaferule.py'), os.path.join(md, 'usafegate.py'), V, tmp, quiet=True)
            except Exception as e:
                res = [('raised %s' % type(e).__name__, False, '')]
        t(f'mutant killed: {fname}: {name}', not all(ok for _n, ok, _d in res), 'SURVIVED')
    for s in SKIP:
        print('SKIPPED  ' + s)
    n = len(T); bad = n - sum(T)
    print(f'\n{n - bad}/{n} pass' + (f'; {len(SKIP)} section(s) SKIPPED (not passes)' if SKIP else ''))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if bad else 0)
