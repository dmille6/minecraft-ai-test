#!/usr/bin/env python3
"""Behaviour tests for frontiercensus.py's pure decisions (E0), plus MUTANTS that must be killed.

    python3 -B scripts/host/test_frontiercensus.py      (exit 1 on any failure; needs no ES and no network)

The fixture world and its hand-worked answers live in frontiercensus.selftest() (every live mode runs it first). This
file adds boundary cases the fixture does not reach, then mutates each decision: a mutant must make the suite fail, and
its anchor must be present EXACTLY ONCE in the source (CLAUDE.md: a mutant that silently fails to apply reads as
"killed"). Comments are stripped before anchoring, so an anchor can never match the explanation of the code.
"""
import importlib.util
import io
import contextlib
import os
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'frontiercensus.py')


CHK = os.path.join(HERE, 'check-frontiercensus.py')


def load(text=None, src=SRC):
    path = src
    if text is not None:
        fd, path = tempfile.mkstemp(suffix='.py', prefix='_fc_mutant_', dir=HERE)   # same dir: the checker resolves
        with os.fdopen(fd, 'w') as f:
            f.write(text)
    try:
        spec = importlib.util.spec_from_file_location(f'fc_{abs(hash(path))}', path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    finally:
        if text is not None:
            os.unlink(path)


def cases(m, chk=None):
    """-> [(name, ok)]. Boundary behaviour the fixture does not reach. chk: a (mutated) checker module."""
    out = []
    c = lambda name, ok: out.append((name, bool(ok)))     # noqa: E731
    c('band: 47.9 -> 0-48', m.band_of(47.9) == '0-48')
    c('band: 48 -> 48-100 (lo <= d < hi, as section 1.2)', m.band_of(48) == '48-100')
    c('band: 300 -> 300+', m.band_of(300) == '300+')
    c('depth: dy -8 is surface, -8.1 deep', (m.depth_of(56, 64), m.depth_of(55.9, 64)) == ('surface', 'deep'))
    c('region: floor for negatives (-0.1 -> -1, 63.9 -> 0, 64 -> 1)',
      (m.region_of(-0.1, 0), m.region_of(63.9, 0), m.region_of(64, 0)) == ((-1, 0), (0, 0), (1, 0)))
    c('rect_dist: 0 inside, 32 exactly at 32 out', (m.rect_dist(10, 10, 0, 0), m.rect_dist(96, 10, 0, 0)) == (0, 32))
    t = 10 ** 12
    c('unreached: one no_route + one deadline on one region is NOT unreached',
      m.unreached([[t, 'p', 'b', 10, 10, 'no_route'], [t, 'p', 'b', 20, 20, 'deadline']], t) == {})
    c('unreached: two no_route expire after 7 days',
      m.unreached([[t, 'p', 'b', 10, 10, 'no_route'], [t, 'p', 'b', 20, 20, 'no_route']], t + m.UNREACHED_MS + 1) == {})
    c('pick: 40% left counts, 39% does not',
      (m.good_pick({'iron_pickaxe': [{'used': 150, 'max': 250}]}), m.good_pick({'iron_pickaxe': [{'used': 153, 'max': 250}]}))
      == (True, False))
    c('slots: 64 cobble = 1, 65 = 2, eggs by 16, tools one each',
      m.slots({'cobblestone': 65, 'egg': 17, 'iron_pickaxe': 2}) == 2 + 2 + 2)
    c('target family: oak_log log, deepslate_iron_ore ore, cobblestone none',
      (m.target_family({'block': 'oak_log'}), m.target_family({'block': 'deepslate_iron_ore'}),
       m.target_family({'block': 'cobblestone'})) == ('log', 'ore', None))
    c('items_got: ore family only (raw_iron, coal; not cobbled_deepslate)',
      m.items_got({'raw_iron': 2, 'coal': 1, 'cobbled_deepslate': 5}, 'ore') == 3)
    c('alignment: home at the origin has no bearing', m.alignment((5, 64, 5), 100, 100) is None)
    g = [20, 20, 0, 0, 20, 9, 9]
    c('water: 9 of 20 wet and 11 dry -> land; 10 wet -> water',
      (m.water_label(g, None)[0], m.water_label([20, 20, 0, 0, 20, 10, 10], None)[0]) == ('perceived_land', 'perceived_water'))
    c('water: a scan beats perception', m.water_label([20, 20, 0, 0, 20, 20, 20], (1, 9))[0] == 'scanned_land')
    a = {'t': 5, 'kind': '_path_reset', 'x': 1.0, 'z': 1.0}
    b = {'t': 5, 'kind': 'goto', 'x': 90.0, 'z': 1.0}
    c('newest row tie: at the same ms an event row (instant) beats a skill row (END snapshot), either order',
      (m.newer(a, b), m.newer(b, a), m.newer(dict(b, t=6), a)) == (True, False, True))
    pres = m.fold_rows([dict(b, bot='q', pool='fx', y=64), dict(a, bot='q', pool='fx', y=64)], {'fx': (0, 64, 0)})['presence']
    c('presence: the tie resolves to the event row (0-48), not the skill row (48-100), in either stream order',
      pres == {'fx': {'0-48|surface': 1}} and m.fold_rows([dict(a, bot='q', pool='fx', y=64), dict(b, bot='q', pool='fx', y=64)],
                                                          {'fx': (0, 64, 0)})['presence'] == pres)
    # the fold planner (incremental reads)
    H = 10 ** 12 - 10 ** 12 % m.HOUR_MS
    have = {H: {'es_counts': [5, 1], 'homes': {'p': [1, 2, 3]}}, H + m.HOUR_MS: {'es_counts': [5, 1], 'homes': {'p': [1, 2, 3]}},
            H + 2 * m.HOUR_MS: {'es_counts': [7, 0], 'homes': {'p': [1, 2, 3]}}}
    counts = {H: [5, 2], H + m.HOUR_MS: [5, 1], H + 2 * m.HOUR_MS: [7, 0], H + 3 * m.HOUR_MS: [0, 0]}
    plan = dict(m.plan_folds(counts, have, {'p': [1, 2, 3]}))
    c('plan: a late unpositioned event row (event count 1 -> 2) refolds the hour and the next one; a new void hour is folded',
      (sorted(plan) == [H, H + m.HOUR_MS, H + 3 * m.HOUR_MS], plan.get(H + m.HOUR_MS), plan.get(H + 3 * m.HOUR_MS))
      == (True, 'after a refold', 'new'))
    c('plan: a home move refolds every hour', len(m.plan_folds({H: [5, 1]}, {H: have[H]}, {'p': [9, 9, 9]})) == 1)
    c('plan: an unstable hour (counts None) is refolded', len(m.plan_folds({H: [5, 1]}, {H: {'es_counts': None,
                                                                                          'homes': {}}}, {})) == 1)
    # the publisher's refusals
    now_ms = m.ms_of('2026-10-22T12:00:00Z')
    good = {'pool': 'p', 'home': [1, 2, 3], 'generated_at': '2026-10-22T11:58:00Z', 'stale_after': '2026-10-22T13:00:00Z',
            'instrument_ok': True, 'measured_until': '2026-10-22T10:00:00Z'}
    c('publish: a good staged file is published', m.publish_refusal(good, 'p', 'frontier-1_2_3', now_ms) is None)
    c('publish: refused past stale_after (ES blind: measured data too old)',
      'VOID' in (m.publish_refusal(dict(good, stale_after='2026-10-22T11:00:00Z'), 'p', 'frontier-1_2_3', now_ms) or ''))
    c('publish: refused on an instrument failure',
      'instrument' in (m.publish_refusal(dict(good, instrument_ok=False), 'p', 'frontier-1_2_3', now_ms) or ''))
    c('publish: refused when the census stopped staging (staged 30 min ago)',
      'stale' in (m.publish_refusal(dict(good, generated_at='2026-10-22T11:30:00Z'), 'p', 'frontier-1_2_3', now_ms) or ''))
    c('publish: refused for another town\'s file', m.publish_refusal(good, 'q', 'frontier-1_2_3', now_ms) is not None)
    # hazards unreadable -> nothing offered
    recs = m.fixture_records()
    cov = {'uncovered_days': [], 'days': {'2026-10-10': {'covered': True}}}
    F = m.frontier('fx', m.FX_HOME, recs, cov, m.FX_H0 + 3 * m.HOUR_MS, m.FX_H0 + 3 * m.HOUR_MS, [], sites_error='OSError')
    c('frontier: an unreadable world-facts file withholds every candidate and says why',
      (F['counts']['candidates'], F['hazard_sources_ok'], bool(F['ranking_withheld'])) == (0, False, True))
    # a VOID sample is not zero eligibility
    void = [dict(r, sample={'at': r['sample']['at'], 'rows': []}) if n == 1 else r for n, r in enumerate(recs)]
    B = m.baselines(void, ['fx'], {'fx': m.FX_HOME}, m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS)['bag']
    c('bag: an empty sample is a VOID town-hour, not a zero-eligible one (3 hours -> 2 counted, 1 void)',
      (B['town_hours'], B['town_hours_void'], B['town_hours_with_eligible']) == (2, 1, 1))
    two = [dict(r, sample={'at': r['sample']['at'], 'rows': r['sample']['rows']}) for r in recs]
    B2 = m.baselines(two, ['fx', 'gx'], {'fx': m.FX_HOME, 'gx': (0, 64, 0)}, m.FX_H0, m.FX_H0 + 3 * m.HOUR_MS)['bag']
    c('bag: a town with no bot in a sample is VOID for that hour, not zero', (B2['town_hours'], B2['town_hours_void']) == (3, 3))
    c('render: an undefined rate prints "-", never 0', m.fm(None, '6.1f') == '-' and m.fm(0.0, '.1f') == '0.0')
    chk = chk or m.load_checker()
    with tempfile.TemporaryDirectory() as td:
        import json as _j
        os.makedirs(os.path.join(td, 'out', 'publish', 'p'))
        os.makedirs(os.path.join(td, '_pool-p'))
        d = {'pool': 'p', 'home': [1, 2, 3], 'digest': 'abc', 'generated_at': '2026-10-20T11:59:00Z',
             'digest_since': '2026-10-20T11:00:00Z', 'warmup': {'complete': True}}
        with open(os.path.join(td, 'out', 'publish', 'p', 'frontier-1_2_3.json'), 'w') as f:
            _j.dump(d, f)
        c('checker: a publisher that never publishes alarms although the staged file is re-stamped every tick',
          any(x.startswith('FrontierPublishStale') for x in chk.assess_publish(
              os.path.join(td, 'out'), td, m.ms_of('2026-10-20T12:00:00Z') / 1000)[0]))
    import json as _j
    now_s = m.ms_of('2026-10-20T12:00:00Z') / 1000
    tick = lambda at, **kw: _j.dumps(dict({'mode': 'tick', 'at': at, 'status': 'idle',             # noqa: E731
                                           'newest_measured_hour_end': '2026-10-20T11:00:00Z', 'towns': 12}, **kw))
    c('checker: a tick 40 min old is stale', any(x.startswith('FrontierStale') for x in chk.assess([tick('2026-10-20T11:20:00Z')], now_s)[0]))
    c('checker: a healthy idle tick is quiet', chk.assess([tick('2026-10-20T11:58:00Z')], now_s)[0] == [])
    c('checker: a town left out alarms', any(x.startswith('FrontierTownMissing') for x in chk.assess(
        [tick('2026-10-20T11:58:00Z', home_problems={'q': 'conflicting homes'}, towns=11)], now_s)[0]))
    c('checker: fewer towns than earlier today alarms', any(x.startswith('FrontierTownMissing') for x in chk.assess(
        [tick('2026-10-20T11:00:00Z'), tick('2026-10-20T11:58:00Z', towns=11)], now_s)[0]))
    c('checker: unreadable hazards alarm', any(x.startswith('FrontierHazardUnread') for x in chk.assess(
        [tick('2026-10-20T11:58:00Z', site_errors={'q': 'OSError'})], now_s)[0]))
    # coverage: a known-blind hour (or a missing one) uncovers its day; a dropped town uncovers that town
    D0 = m.ms_of('2026-10-12T00:00:00Z')
    full = lambda d, per=100, extra=None: [{'h0': D0 + d * m.DAY_MS + h * m.HOUR_MS,                  # noqa: E731
                                           'bots': dict({'a1': ['a', per, 60], 'b1': ['b', per, 60], 'c1': ['c', per, 60]},
                                                        **(extra or {}))} for h in range(24)]
    recs = full(0) + full(1) + full(2)
    recs[30] = {'h0': recs[30]['h0'], 'void': True, 'bots': {}}
    cv = m.coverage(recs, D0, D0 + 3 * m.DAY_MS)
    c('coverage: one VOID hour in a day at 96% uncovers that day', cv['uncovered_days'] == ['2026-10-13'])
    recs2 = full(0) + full(1) + [r for r in full(2)]
    for r in recs2[48:]:
        r['bots']['c1'] = ['c', 0, 0]
    cv2 = m.coverage(recs2, D0, D0 + 3 * m.DAY_MS)
    F = m.frontier('c', (0, 64, 0), recs2, cv2, D0 + 3 * m.DAY_MS, D0 + 3 * m.DAY_MS, [])
    G = m.frontier('a', (0, 64, 0), recs2, cv2, D0 + 3 * m.DAY_MS, D0 + 3 * m.DAY_MS, [])
    c('coverage: a town at 0% of the fleet median for a day is uncovered for that town only',
      (F['covered'], F['town_uncovered_days'], G['covered']) == (False, ['2026-10-14'], True))
    # hazards: a `_death` row older than 7 days is not a hazard; the site cutoff is the WALL clock
    now = 10 ** 12
    old = [[now - m.HAZARD_MS - 1, 'p', 'b', 10, 64, 10, 'fall']]
    c('hazard: an 8-day-old _death row is not a hazard, a 6-day-old one is',
      (m.hazard_points(old, [], 'p', now), len(m.hazard_points([[now - 6 * m.DAY_MS, 'p', 'b', 10, 64, 10, 'fall']], [], 'p', now)))
      == ([], 1))
    # warm-up: void and locked ticks do not extend it; a new version restarts it
    T = m.ms_of('2026-10-20T00:00:00Z')
    hb = lambda n, st='ok', v='v1': _j.dumps({'mode': 'tick', 'at': m.iso(T + n * 5 * m.MIN_MS), 'status': st, 'version': v})  # noqa: E731
    lines = [hb(n) for n in range(577)]
    c('warm-up: 48 h of measuring ticks completes', m.warmup(lines, T + 48 * m.HOUR_MS)['complete'])
    c('warm-up: 48 h of VOID ticks does not (the instrument never measured)',
      not m.warmup([hb(0)] + [hb(n, 'void') for n in range(1, 577)], T + 48 * m.HOUR_MS)['complete'])
    c('warm-up: a new script version restarts it',
      m.warmup(lines[:300] + [hb(n, v='v2') for n in range(300, 577)], T + 48 * m.HOUR_MS)['run_start'] == m.iso(T + 300 * 5 * m.MIN_MS))
    # parity: the comparison itself
    ref = {'regions': {'p': {'1,1': [3, 1, 5, 6, 0, 0, 0]}}, 'presence': {'p': {'0-48|surface': 1}}, 'bots': {'b': ['p', 3, 1]}}
    c('parity: identical folds agree, one changed bot-minute is a diff',
      (m.parity_diffs(ref, ref), len(m.parity_diffs(ref, dict(ref, regions={'p': {'1,1': [3, 2, 5, 6, 0, 0, 0]}}))))
      == ([], 1))
    c('checker: a void tick alarms even when fresh',
      any(x.startswith('FrontierVoid') for x in chk.assess(['{"mode":"tick","at":"2026-10-20T11:59:00Z","status":"void",'
                                                            '"newest_measured_hour_end":"2026-10-20T11:00:00Z"}'],
                                                           m.ms_of('2026-10-20T12:00:00Z') / 1000)[0]))
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, 'out', 'publish', 'p'))
        os.makedirs(os.path.join(td, '_pool-p'))
        import json
        doc = {'pool': 'p', 'home': [1, 2, 3], 'digest': 'abc', 'generated_at': '2026-10-20T11:00:00Z',
               'warmup': {'complete': True}, 'data_until': 'x'}
        with open(os.path.join(td, 'out', 'publish', 'p', 'frontier-1_2_3.json'), 'w') as f:
            json.dump(doc, f)
        now = m.ms_of('2026-10-20T12:00:00Z') / 1000
        c('checker: a warm staged frontier never published alarms after 15 min',
          any(x.startswith('FrontierPublishStale') for x in chk.assess_publish(os.path.join(td, 'out'), td, now)[0]))
        m.create_gen(os.path.join(td, '_pool-p'), 'frontier-1_2_3', doc)
        c('checker: once published (same digest) it is quiet', chk.assess_publish(os.path.join(td, 'out'), td, now)[0] == [])
    # ---- pools whose status changes (isolated -> shared, 10-21) and the pools that are not the bench
    c('cpool: an isolated bot\'s own pool folds into its world; a shared pool and None pass through',
      (m.cpool('self-isolated-b-Alpha'), m.cpool('board-a'), m.cpool('isolated-b'), m.cpool(None))
      == ('isolated-b', 'board-a', 'isolated-b', None))
    H2 = {'fx': m.FX_HOME}
    iso = [dict(r, pool='self-fx-A', bot='a') for r in m.fixture_rows()[:60] if r.get('x') is not None] + \
          [dict(r, pool='self-fx-B', bot='b') for r in m.fixture_rows()[:60] if r.get('x') is not None]
    fr = m.fold_rows(iso, H2)
    c('fold: two isolated bots of one world fold into ONE census pool (bot-minutes add: one bot per self- pool)',
      (sorted(fr['regions']), fr['regions']['fx'][m.rkey(16, 0)][:2], fr['bots']['a'][0]) == (['fx'], [12, 2], 'fx'))
    c('parse_q1: the self- buckets of one world merge exactly as the reference fold does',
      m.parse_q1(m.fake_q1(iso, ['self-fx-A', 'self-fx-B']), H2) == {'fx': fr['regions']['fx']})
    have1 = {H: {'es_counts': [5, 1], 'homes': {'a': [1, 2, 3], 'z': [0, 0, 0]}}}
    c('plan: a pool absent now (dropped or retired) refolds nothing; the same homes refold nothing',
      m.plan_folds({H: [5, 1]}, have1, {'a': [1, 2, 3]}) == [])
    c('plan: a pool the record lacks (newly folded) refolds the hour',
      [w.split(' ')[0] for _, w in m.plan_folds({H: [5, 1]}, have1, {'a': [1, 2, 3], 'b': [4, 5, 6]})] == ['homes'])
    with tempfile.TemporaryDirectory() as td:
        def mk(d, *files):
            os.makedirs(os.path.join(td, d), exist_ok=True)
            for f in files:
                open(os.path.join(td, d, f), 'w').close()
        mk('_pool-a', 'town-chest-1_2_3.cobble.jsonl')
        mk('_pool-self-iso-Alpha', 'town-chest-7_8_9.cobble.jsonl', 'junkwell-site-7_8_9.g1.json')
        mk('_pool-self-iso-Bravo', 'town-chest-7_8_9.cobble.jsonl')
        mk('_pool-self-iso-Comet')                                        # a bot dir with no town state yet: no vote
        mk('_pool-self-jso-Alpha', 'town-chest-7_8_9.cobble.jsonl')
        mk('_pool-self-jso-Bravo', 'town-chest-1_1_1.cobble.jsonl')       # two homes in one isolated world: refused
        mk('_pool-conv', 'town-chest-5_5_5.cobble.jsonl')                 # converted: shared now on a NEW home
        mk('_pool-self-conv-Alpha', 'town-chest-4_4_4.cobble.jsonl')
        mk('_pool-rs', 'town-chest-2_2_2.cobble.jsonl')
        mk('_pool-rs.pre-reseed-20261012T101500Z')                        # reseeded inside the window
        mk('_pool-old', 'town-chest-3_3_3.cobble.jsonl')
        mk('_pool-old.pre-reseed-20260927T130943Z')                       # before the window: harmless
        mk('_pool-showcase', 'town-chest-6_6_6.cobble.jsonl')             # never the bench
        fold, shared, probs, iprobs = m.census_pools(td)
        c('pools: shared towns publish; an isolated world with one home is folded only; showcase never',
          (shared, sorted(fold)) == (['a', 'conv', 'old'], ['a', 'conv', 'iso', 'old']))
        c('pools: a converted pool takes its SHARED home, not its old per-bot one', fold.get('conv') == (5, 5, 5))
        c('pools: a reseed inside the window leaves the town out and says so; one before it does not',
          ('rs' in probs and 'reseeded 20261012T101500Z' in probs['rs'], 'old' in probs) == (True, False))
        c('pools: an isolated world naming two homes is refused (informational), not guessed',
          'jso' in iprobs and 'jso' not in fold and 'jso' not in probs)
    # ---- the tick's status word and the parity rule
    ts = m.tick_status
    c('status: an instrument failure outranks everything; ES blind is VOID, never idle; a backlog is behind',
      (ts(True, False, True, 3, 3, 1, 'x'), ts(False, False, True, 0, 0, 0, None), ts(False, True, False, 0, 0, 0, None),
       ts(False, False, False, 4, 4, 0, None), ts(False, False, False, 4, 1, 2, None), ts(False, False, False, 0, 0, 0, 'w'),
       ts(False, False, False, 2, 0, 0, None), ts(False, False, False, 0, 0, 0, None))
      == ('instrument', 'void', 'void', 'void', 'behind', 'behind', 'ok', 'idle'))
    now_p = m.ms_of('2026-10-22T12:00:00Z')
    fresh = {'ok': True, 'at': '2026-10-22T01:00:00Z'}
    c('parity: none during the first backfill is not an alarm; none after it is; a failed or 37-h-old one is',
      (m.parity_alarm(None, now_p, 5), m.parity_alarm(None, now_p, 0), m.parity_alarm(fresh, now_p, 0),
       m.parity_alarm(dict(fresh, ok=False), now_p, 5), m.parity_alarm(dict(fresh, at='2026-10-20T23:00:00Z'), now_p, 0))
      == (False, True, False, True, True))
    # ---- the atomic write never follows a symlinked directory
    with tempfile.TemporaryDirectory() as td:
        real, link = os.path.join(td, 'real'), os.path.join(td, 'link')
        os.makedirs(real)
        os.symlink(real, link)
        try:
            m.create_gen(link, 'frontier-1_2_3', {'a': 1})
            refused = False
        except OSError:
            refused = True
        c('generations: a pool dir that is a symlink is refused (O_NOFOLLOW), and nothing lands behind it',
          (refused, os.listdir(real)) == (True, []))
    return out


def run_all(m, chk=None):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        st = m.selftest(verbose=False) if chk is None else True     # a checker mutant is judged by the cases alone
    res = cases(m, chk)
    run_all.why = [ln.strip()[3:] for ln in buf.getvalue().split('\n') if ln.strip().startswith('!!')] + \
        [n for n, ok in res if not ok]
    return st, res


def strip_comments(src):
    out = []
    for line in src.split('\n'):
        s = line.lstrip()
        out.append('' if s.startswith('#') else line)
    return '\n'.join(out)


# (name, anchor, replacement) -- each anchor must occur exactly once in the comment-stripped source
MUTANTS = [
    ('band upper bound inclusive', "if d >= lo and (hi is None or d < hi):", "if d >= lo and (hi is None or d <= hi):"),
    ('coverage ignores the 80% rule', "'covered': bool(M) and ratio >= COVER_SHARE and D['void'] == 0 and D['folded'] == n,",
     "'covered': bool(M) and D['void'] == 0 and D['folded'] == n,"),
    ('uncovered reads not_observed', "status = 'visited' if g else ('not_observed' if covered else 'unknown')",
     "status = 'visited' if g else 'not_observed'"),
    ('hazard radius dropped', "near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= HAZARD_R]",
     "near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= 0]"),
    ('hazard age ignored', "if isinstance(t, (int, float)) and now_ms - HAZARD_MS < t <= now_ms + HOUR_MS:",
     "if isinstance(t, (int, float)):"),
    ('site kind ignored', "if str(s.get('kind', '')).startswith('death:') and", "if True and"),
    ('border margin dropped', "lim = border_r - BORDER_MARGIN", "lim = border_r"),
    ('unreached counts any reason', "if reason == 'no_route':", "if True:"),
    ('histogram key read as an index', "i, j = int(round(xb['key'] / GRID)), int(round(zb['key'] / GRID))",
     "i, j = int(xb['key']), int(zb['key'])"),
    ('bot-minutes count rows', "regions[pool][k][1] = len(s)", "regions[pool][k][1] = regions[pool][k][0]"),
    ('subset control blind', "if k not in ((by_h.get(r['h0']) or {}).get('regions') or {}).get(p, {}):", "if False:"),
    ('warm-up never restarts on a gap', "if last is None or t - last > WARMUP_GAP_MIN * MIN_MS or r.get('version') != ver:",
     "if last is None or r.get('version') != ver:"),
    ('generation overwrites', "os.link(tmp, final, src_dir_fd=dfd, dst_dir_fd=dfd, follow_symlinks=False)",
     "os.replace(tmp, final, src_dir_fd=dfd, dst_dir_fd=dfd)"),
    ('ranking ignores the away half-plane', "return (WATER_RANK[c['water']], 0 if (al is None or al >= 0) else 1,",
     "return (WATER_RANK[c['water']], 0,"),
    ('wet and dry swapped', "if g[5] / g[4] >= LABEL_SHARE:", "if (g[4] - g[6]) / g[4] >= LABEL_SHARE:"),
    ('depth sign', "return 'deep' if (y - home_y) < DEEP_DY else 'surface'", "return 'deep' if (y - home_y) > DEEP_DY else 'surface'"),
    ('pick threshold', "if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.4:", "if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.0:"),
    ('home start band from the end position', "sp = prev_pos(bot, t)", "sp = (p.get('x'), p.get('y'), p.get('z'))"),
    ('bag eligibility ignores at-town', "e = sl <= 24 and gp and (hp or 0) >= 18 and at", "e = sl <= 24 and gp and (hp or 0) >= 18"),
    ('presence uses the oldest row', "if k0 not in newest or newer(r, newest[k0]):", "if k0 not in newest:"),
    ('a same-ms skill row beats the event row', "return na < nb", "return na > nb"),
    ('edge day not pro-rated', "scale = 24 / n", "scale = 1"),
    ('missing hours pro-rated away (folded, not expected)', "scale = 24 / n", "scale = 24 / max(1, D['folded'])"),
    ('a changed count does not refold', "elif r.get('es_counts') != n:", "elif False:"),
    ('the hour after a refold is not refolded', "if why != 'new' and nxt in counts and nxt not in todo and nxt in have:",
     "if False:"),
    ('publish ignores stale_after', "if now > ms_of(doc['stale_after']):", "if False:"),
    ('publish ignores the instrument', "if not doc.get('instrument_ok'):\n        return f'instrument", "if False:\n        return f'instrument"),
    ('unreadable hazards still rank', "k not in unr and not sites_error:", "k not in unr:"),
    ('void town absent from the sample counts', "if p not in seen:", "if False:"),
    ('the checker uses the re-stamped time', "age = (now - _t(doc.get('digest_since') or doc['generated_at'])) / 60",
     "age = (now - _t(doc['generated_at'])) / 60", 'checker'),
    ('the checker forgets VOID', "if st == 'void':", "if False:", 'checker'),
    ('the checker forgets a stale tick', "if age > max_age_min:", "if False:", 'checker'),
    ('the checker ignores a dropped town', "if last.get('towns') is not None and last['towns'] < most:", "if False:", 'checker'),
    ('the checker ignores home problems', "if last.get('home_problems'):", "if False:", 'checker'),
    ('a void hour does not uncover its day', "ratio >= COVER_SHARE and D['void'] == 0 and D['folded'] == n,",
     "ratio >= COVER_SHARE,"),
    ('the town floor is not gated', "if D.get('towns') is not None and (D['towns'].get(pool) or 0.0) < TOWN_FLOOR]",
     "if False]"),
    ('_death rows of any age are hazards', "if p == pool and x is not None and z is not None and now_ms - HAZARD_MS < t <= now_ms:",
     "if p == pool and x is not None and z is not None:"),
    ('void ticks extend the warm-up', "if st not in ('ok', 'idle', 'behind'):", "if st not in ('ok', 'idle', 'behind', 'void'):"),
    ('a new version keeps the warm-up', "or r.get('version') != ver:", ":"),
    ('parity ignores bot-minutes', "if A.get(k) != B.get(k):", "if (A.get(k) or [0])[0] != (B.get(k) or [0])[0]:"),
    ('unpositioned rows folded', "if r.get('x') is None or r.get('z') is None:\n            continue\n        r = dict(r, pool",
     "if False:\n            continue\n        r = dict(r, pool"),
    ('isolated rows keep their self- pool', "return m.group(1) if m else p", "return p"),
    ('a second self- pool overwrites the first', "if o is None:\n                    regs[rkey(i, j)] = g",
     "if True:\n                    regs[rkey(i, j)] = g"),
    ('plan compares the whole homes dict', "moved = sorted(p for p, h in want_homes.items() if (r.get('homes') or {}).get(p) != h)",
     "moved = ['all'] if r.get('homes') != want_homes else []"),
    ('a converted pool keeps its isolated home', "if p in roster:\n            continue", "if False:\n            continue"),
    ('reseeds ignored', "if t > since_ms:", "if False:"),
    ('the showcase is a town', "and p not in EXCLUDE_POOLS:", "and True:"),
    ('ES blind reads idle', "if no_records or blind or (folded and void == folded):", "if no_records:"),
    ('a backlog reads ok', "if backlog or withheld:\n        return 'behind'", "if withheld:\n        return 'behind'"),
    ('parity never alarms when missing', "if par is None and backlog:\n        return False",
     "if par is None:\n        return False"),
    ('the pool dir is followed through a symlink', "return os.open(dir_, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
     "return os.open(dir_, os.O_RDONLY | os.O_DIRECTORY)"),
]


def main():
    fails = []
    m = load()
    st, res = run_all(m)
    if not st:
        fails.append('selftest fails on the real source')
    for name, ok in res:
        print(f'  {"ok " if ok else "FAIL"} {name}')
        if not ok:
            fails.append(name)
    sources = {'census': open(SRC).read(), 'checker': open(CHK).read()}
    for name, old, new, *which in MUTANTS:
        which = which[0] if which else 'census'
        src = sources[which]
        code = strip_comments(src)
        n = code.count(old)
        if n != 1:
            fails.append(f'MUTANT {name}: anchor occurs {n} times in the comment-stripped source (must be 1)')
            print(f'  FAIL mutant {name}: ANCHOR {"MISSING" if n == 0 else "NOT UNIQUE"} ({n})')
            continue
        assert src.count(old) >= 1
        mut = src.replace(old, new) if src.count(old) == 1 else code.replace(old, new)
        try:
            if which == 'checker':
                mst, mres = run_all(m, load(mut, CHK))
            else:
                mm = load(mut)
                mst, mres = run_all(mm)
            killed = (not mst) or any(not ok for _, ok in mres)
            why = run_all.why[0][:110] if run_all.why else '-'
        except Exception as e:                                  # a mutant that crashes the suite is killed
            killed, why = True, f'CRASH {type(e).__name__}: {e}'[:110]
        print(f'  {"ok " if killed else "FAIL"} mutant killed: {name}  <- {why}')
        if not killed:
            fails.append(f'MUTANT SURVIVED: {name}')
    if fails:
        print(f'FAILED ({len(fails)}):')
        for f in fails:
            print('  !! ' + f)
        return 1
    print(f'ALL OK: {len(res)} behaviour cases, selftest, {len(MUTANTS)} mutants killed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
