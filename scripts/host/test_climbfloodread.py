#!/usr/bin/env python3
"""Behaviour tests for climbfloodread.py on SYNTHETIC rows (Codex's cases, 10-05, and the coordinator's list).

    python3 scripts/host/test_climbfloodread.py            (exit 1 on any failure)

Each test builds rows the way the bots write them and asks the read's own functions. Every decision tested here is
also MUTATED (bottom) to prove the test can fail: a mutant must change the answer, and its anchor must be present
and unique in the source.
"""
import datetime as dt, importlib.util, json, os, sys, tempfile

SRC = os.environ.get('CLIMBFLOODREAD', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'climbfloodread.py'))
T0 = dt.datetime(2026, 10, 5, 12, 0, 0, tzinfo=dt.timezone.utc)


def load(src_text=None):
    path = SRC
    if src_text is not None:
        fd, path = tempfile.mkstemp(suffix='.py'); os.write(fd, src_text.encode()); os.close(fd)
    spec = importlib.util.spec_from_file_location('cfr_%d' % id(path), path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    if src_text is not None:
        os.unlink(path)
    return m


def rec(s, name, detail='', pos=(700, 40, 700), status='failed', dur=0):
    t = (T0 + dt.timedelta(seconds=s)).isoformat().replace('+00:00', 'Z')
    return json.dumps({'@timestamp': t, 'skill': {'name': name, 'detail': detail, 'status': status, 'duration_ms': dur},
                       'bot': {'name': 'board-a-Alpha', 'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]}},
                       'code': {'version': 'test'}})


def rows(m, recs):
    return m.rows_from_lines(recs)


def at(s):
    return T0 + dt.timedelta(seconds=s)


FAILS = []


def t(name, fn):
    try:
        fn(load()); print('  PASS ', name)
    except AssertionError as e:
        FAILS.append(name); print('  FAIL ', name, '--', e)


REFUSED = 'caller=pillar_out cell=700,42,700 submerged=0 y=40 reason=liquid above the block overhead (water)'


def opp1(m, recs, cut=None, end=None):
    o = m.opportunities(rows(m, recs), cut, end if end is not None else at(3600))
    assert len(o) == 1, f'expected one opportunity, got {len(o)}'
    return o[0]


# --- A1: the 20 s endpoint is anchored on an actual upward dig ------------------------------------------------------
def a1_dig_at_21(m):
    # escape at 0 s (refused: no dig), a pillar step (dig evidence) at 21 s, water at 22 s -> COUNTED
    o = opp1(m, [rec(0, '_entombed'), rec(0.5, '_climb_flood_guard', REFUSED), rec(21, '_scaffold_pick', 'pillar_out: dirt instead of cobblestone'),
                 rec(22, '_water_no_air_route')])
    assert o['eligible'] and o['fast'], o


def a1_no_dig_unrelated_water(m):
    # escape at 0 s, refused (no dig), unrelated water at 10 s -> NOT counted
    o = opp1(m, [rec(0, '_entombed'), rec(0.5, '_climb_flood_guard', REFUSED), rec(10, '_water_no_air_route')])
    assert o['eligible'] and not o['fast'], o


def a1_entombed_dig_then_water(m):
    # an entombed escape that was NOT refused digs its ceiling within 45 s; water 38 s later (Paper control) -> counted
    o = opp1(m, [rec(0, '_entombed'), rec(38, '_water_no_air_route')])
    assert o['fast'], o
    o2 = opp1(m, [rec(0, '_entombed'), rec(70, '_water_no_air_route')])
    assert not o2['fast'], 'water 25 s after the dig window closed must not count'


def a1_marooned_alone_is_not_a_dig(m):
    o = opp1(m, [rec(0, '_marooned'), rec(5, '_water_no_air_route')])
    assert not o['fast'], 'a marooned row is not a dig'


def a1_ramp_row_window(m):
    # ramp rows are stamped at the END of the ramp: a flood 30 s before the row is inside its 60 s dig window
    o = opp1(m, [rec(0, '_marooned'), rec(40, '_water_no_air_route'), rec(70, '_marooned_ramp_cut', 'no route; steps=2 climbed=2.0 — stopped')])
    assert o['fast'], o


def a1_first_water_only(m):
    # the FIRST water episode decides: unrelated water at 10 s (no dig yet), a dig at 100 s, water at 105 s (same
    # episode, 90 s gap rule not met) -> not a hit
    o = opp1(m, [rec(0, '_marooned'), rec(10, '_water_no_air_route'), rec(100, '_scaffold_pick', 'pillar_out: x'), rec(105, '_drowning_route')])
    assert not o['fast'], o


# --- eligibility / boundary --------------------------------------------------------------------------------------
def a2_straddle(m):
    cut = at(100)
    recs = [rec(60, '_entombed'), rec(110, '_entombed'), rec(120, '_water_no_air_route')]
    o = m.opportunities(rows(m, recs), cut, at(3600))
    pre = [x for x in o if x['period'] == 'pre']; post = [x for x in o if x['period'] == 'post']
    assert len(pre) == 1 and len(post) == 1, 'a run must not chain across the deploy'
    assert not pre[0]['fast'] and not pre[0]['design'], 'a post-deploy water event leaked into the pre window'
    assert not pre[0]['eligible'], 'a pre opportunity whose follow-up crosses the deploy is incomplete'
    assert post[0]['fast'], post[0]


def a2_already_wet(m):
    o = opp1(m, [rec(-30, '_drowning_route'), rec(0, '_entombed'), rec(10, '_water_no_air_route')])
    assert not o['eligible'], 'already wet before the escape'


def a2_incomplete_followup(m):
    o = opp1(m, [rec(0, '_entombed')], end=at(120))
    assert not o['eligible'], 'the 5-min follow-up does not fit'


def r6_dig_evidence_period(m):
    # _entombed (a dig) at 90 s, deploy at 100 s, _marooned at 100 s, water at 110 s: the post opportunity must NOT be
    # anchored on the pre-deploy dig (Codex r6)
    o = m.opportunities(rows(m, [rec(90, '_entombed'), rec(100, '_marooned'), rec(110, '_water_no_air_route')]), at(100), at(3600))
    post = [x for x in o if x['period'] == 'post']
    assert len(post) == 1 and not post[0]['fast'], post


def r7_post_ramp_into_pre(m):
    # _marooned at 0 s, water at 290 s, deploy at 300 s, a ramp row (steps=2) at 330 s whose interval [270, 330] reaches
    # back before the deploy: it must NOT anchor the pre opportunity (Codex r7)
    o = m.opportunities(rows(m, [rec(0, '_marooned'), rec(290, '_water_no_air_route'),
                                 rec(330, '_marooned_ramp_cut', 'no route; steps=2 climbed=2.0 — stopped')]), at(300), at(3600))
    pre = [x for x in o if x['period'] == 'pre']
    assert len(pre) == 1 and not pre[0]['fast'], pre


def r6_followup_last_escape(m):
    # escapes at 0 s and 590 s (one run), period ends at 600 s: the run's window is not complete -> not eligible
    o = m.opportunities(rows(m, [rec(0, '_entombed'), rec(590, '_entombed')]), None, at(600))
    assert len(o) == 1 and not o[0]['eligible'], o


def r6_chain_censored(m):
    rs = rows(m, [rec(599, '_climb_flood_ramp', RAMP_OK, status='success')])
    out = m.chain(rs, m.water_starts(rs), at(600))[1]
    assert out['out_dry_by_ramp'] == 0 and out['ramp_censored'] == 1, out


def r6_e0_undefined(m):
    assert m.e0(50, {'pre': None, 'post': 0.01}, {'pre': 0.02, 'post': 0.02}) is None, 'no treatment baseline: E0 undefined'
    assert m.e0(50, {'pre': 0.02, 'post': 0.01}, {'pre': 0.0, 'post': 0.02}) is None
    assert abs(m.e0(50, {'pre': 0.02, 'post': 0.01}, {'pre': 0.02, 'post': 0.01}) - 0.5) < 1e-9
    pp = {'a': {'fast': {'pre': 0, 'post': 1}, 'opp': {'pre': 0, 'post': 10}}}
    assert m.arm_rates(pp, ['a'], 'fast', 'opp')['pre'] is None


def r6_paper_missing_candidate(m):
    import shutil
    d = tempfile.mkdtemp(); os.makedirs(os.path.join(d, 'ctrl')); os.makedirs(os.path.join(d, 'cand'))
    open(os.path.join(d, 'ctrl', 'ctrl-A-0-000000.jsonl'), 'w').write('\n'.join([rec(0, '_entombed'), rec(10, '_water_no_air_route')]))
    r = m.paper_detect(d)
    shutil.rmtree(d)
    assert r['ctrl']['detected'] == 1 and r['cand']['trials'] == 0 and r['cand']['eligible'] == 0, r


# --- A3: ratio DiD -------------------------------------------------------------------------------------------------
def a3_ratio_did(m):
    assert abs(m.ratio_did(0.01, 0.02, 0.03, 0.03) - 0.5) < 1e-9
    assert m.ratio_did(0.0, 0.02, 0.03, 0.03) is None, 'zero rate: undefined, never a pseudocount'
    pp = {'a': {'fast': {'pre': 10, 'post': 1}, 'opp': {'pre': 100, 'post': 100}},
          'b': {'fast': {'pre': 10, 'post': 10}, 'opp': {'pre': 100, 'post': 100}},
          'c': {'fast': {'pre': 10, 'post': 10}, 'opp': {'pre': 100, 'post': 100}}}
    assert abs(m.rdid_for(pp, ['a'], ['b', 'c'], 'fast', 'opp') - 0.1) < 1e-9
    r = m.randomization(pp, ['a'], 'fast', 'opp', 'low')
    assert r['n_assign'] == 3 and abs(r['p'] - 1 / 3) < 1e-9, r


# --- A4: refusal-chain follow-up and gates -----------------------------------------------------------------------
RAMP_OK = 'handler=entombed y=40 steps=1 sidestep=1 climbed=1.0 flood=none yielded=0 dry=1 — stopped because a route exists again'


def a4_ramp_then_wet(m):
    rs = rows(m, [rec(0, '_climb_flood_ramp', RAMP_OK, status='success'), rec(180, '_water_no_air_route')])
    g, out = m.chain(rs, m.water_starts(rs))
    assert out['wet_after_ramp'] == 1 and out['out_dry_by_ramp'] == 0, out
    rs2 = rows(m, [rec(0, '_climb_flood_ramp', RAMP_OK, status='success')])
    assert m.chain(rs2, m.water_starts(rs2))[1]['out_dry_by_ramp'] == 1


def a4_later_ramp_own_window(m):
    rs = rows(m, [rec(0, '_climb_flood_ramp', RAMP_OK, status='success'), rec(130, '_climb_flood_ramp', RAMP_OK, status='success'),
                  rec(140, '_water_no_air_route')])
    out = m.chain(rs, m.water_starts(rs))[1]
    assert out['ramp_dig_then_wet_20s'] == 1, out


def a4_gates(m):
    R1 = 'handler=entombed at=700,40,700 refusals=1 backoff_s=15 prereq=none dry=1 — remedy: x'
    R2 = 'handler=entombed at=700,40,700 refusals=2 backoff_s=30 prereq=none dry=1 — remedy: x'
    clean = rows(m, [rec(0, '_climb_flood_refused', R1), rec(30, '_climb_flood_refused', R2)])
    assert sum(m.chain(clean, [])[0].values()) == 0, 'a clean chain tripped a gate'
    spin = rows(m, [rec(0, '_climb_flood_refused', R1), rec(5, '_climb_flood_refused', R2)])
    assert m.chain(spin, [])[0]['spin'] == 1
    ask = rows(m, [rec(0, '_climb_flood_refused', R1), rec(40, '_entombed_needs_pickaxe', 'pillar declined')])
    assert m.chain(ask, [])[0]['prereq'] == 1
    wet = rows(m, [rec(0, '_climb_flood_refused', R1.replace('dry=1', 'dry=0'))])
    assert m.chain(wet, [])[0]['wet'] == 1


def paper_positive_control(m):
    # the real Paper logs, if present next to this test (scratchpad) or on the host
    root = os.environ.get('CLIMBFLOODREAD_PAPER', os.path.expanduser('~/mcai-analysis/climbflood-paper'))
    if not os.path.isdir(os.path.join(root, 'ctrl')):
        print('    (no Paper logs at %s; skipped)' % root); return
    r = m.paper_detect(root)
    assert r['ctrl']['detected'] >= 12, r
    assert r['cand']['detected'] == 0 and r['cand']['eligible'] >= 20, r


for name, fn in list(globals().items()):
    if callable(fn) and name[:2] in ('a1', 'a2', 'a3', 'a4', 'r6', 'r7') or name == 'paper_positive_control':
        t(name, fn)

# --- mutants: anchor present and unique; the mutant must flip at least one decision -------------------------------
SRC_TEXT = open(SRC).read()
MUTANTS = [
    ('fast = bool(first) and any(a <= first <= b + dt.timedelta(seconds=FAST_S) for a, b, _ in own)',
     'fast = bool(first) and secs(t0, first) <= FAST_S', [a1_dig_at_21, a1_no_dig_unrelated_water]),
    ("        if c and c['period'] == period and secs(c['last'], r['t']) <= OPP_GAP_S and (",
     "        if c and secs(c['last'], r['t']) <= OPP_GAP_S and (", [a2_straddle]),
    ("        complete = bound is None or c['last'] + dt.timedelta(seconds=FOLLOW_S) <= bound",
     "        complete = True", [a2_incomplete_followup]),
    ("            if not refused:\n                out.append((t, t + td(seconds=ENTOMB_DIG_S), 'entombed_dig', t))",
     "            out.append((t, t + td(seconds=ENTOMB_DIG_S), 'entombed_dig', t))", [a1_no_dig_unrelated_water]),
    ("            out['wet_after_ramp' if later else ('ramp_censored' if censored(r) else 'out_dry_by_ramp')] += 1",
     "            out['out_dry_by_ramp'] += 1", [a4_ramp_then_wet]),
    ("        if None in (tp, tq, cp, cq) or min(tp, tq, cp, cq) <= 0:\n            return None", "        pass", [a3_ratio_did]),
    ("            if secs(prev['t'], r['t']) + SPIN_TOL_S < back:", "            if False:", [a4_gates]),
    ("                if (rt >= cut) != (c['period'] == 'post'):\n                    continue\n                a, b = (max(a, cut), b) if c['period'] == 'post' else (a, min(b, cut))", "                pass", [r6_dig_evidence_period, r7_post_ramp_into_pre]),
    ("        complete = bound is None or c['last'] + dt.timedelta(seconds=FOLLOW_S) <= bound", "        complete = bound is None or t0 + dt.timedelta(seconds=FOLLOW_S) <= bound", [r6_followup_last_escape]),
    ("        if moved:\n            out['wet_after_ramp' if later else ('ramp_censored' if censored(r) else 'out_dry_by_ramp')] += 1", "        if moved:\n            out['wet_after_ramp' if later else 'out_dry_by_ramp'] += 1", [r6_chain_censored]),
    ("    if rT['pre'] is None or rC['post'] is None or not rC['pre']:\n        return None", "    rT = {'pre': rT['pre'] or 0.0}", [r6_e0_undefined]),
]
for old, new, tests in MUTANTS:
    assert SRC_TEXT.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old[:70]
    mod = load(SRC_TEXT.replace(old, new))
    killed = False
    for fn in tests:
        try:
            fn(mod)
        except Exception:
            killed = True
    print('  %s mutant: %s' % ('KILLED  ' if killed else 'SURVIVED', old.strip()[:80]))
    if not killed:
        FAILS.append('mutant survived: ' + old[:60])

print('\n%d failed' % len(FAILS))
sys.exit(1 if FAILS else 0)
