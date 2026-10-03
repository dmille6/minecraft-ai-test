"""Shadow mayor tests. Run from the repo root:  python3 -m unittest discover -s scripts/mayor/tests -v"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import mayor_shadow  # noqa: E402
import mayor_score  # noqa: E402
import mayor_frontier  # noqa: E402
import checks  # noqa: E402

FIX = os.path.join(HERE, 'fixtures')


def fixture_rows():
    with open(os.path.join(FIX, 'skill-rows-sample.jsonl')) as f:
        return [json.loads(l) for l in f if l.strip()]


class Roster(unittest.TestCase):
    """Built from REAL rows copied read-only from 10.0.0.31 on 2026-10-03."""

    def test_roster_from_real_rows(self):
        rows = fixture_rows()
        bots, worlds = {}, {}
        n = sum(1 for r in rows if core.ingest(r, bots, worlds))
        self.assertEqual(n, len(rows), 'positive control: every sample row is a bot row and was ingested')
        by_world = {}
        for st in bots.values():
            by_world.setdefault(st.world, set()).add(st.name)
        self.assertEqual(sorted(by_world), ['hive-a', 'isolated-a'])
        self.assertEqual(len(by_world['hive-a']), 5)
        self.assertEqual(len(by_world['isolated-a']), 5)
        # each bot's position is the one in its LATEST row that carries a position (rows stamp START)
        for name, st in bots.items():
            mine = [r for r in rows if r['bot']['name'] == name and 'pos' in r['bot']]
            last = max(mine, key=lambda r: core.parse_ts(r['@timestamp']) + int(r['skill'].get('duration_ms') or 0))
            self.assertEqual(st.full['pos'], last['bot']['pos'], name)
        now = max(st.last_ms for st in bots.values())
        views = [core.bot_view(st, now) for st in bots.values() if st.world == 'hive-a']
        with open(os.path.join(FIX, 'world-facts-hive-a.json')) as f:
            facts = json.load(f)
        res = core.merge_resources([facts], now)
        self.assertTrue(res, 'positive control: the real facts file yields log/iron sightings')
        snap = core.build_snapshot('hive-a', views, res, now, core.bank_view(worlds.get('hive-a'), now))
        self.assertEqual([b['id'] for b in snap['bots']], ['B1', 'B2', 'B3', 'B4', 'B5'])
        self.assertTrue(all(r['id'].startswith('R') for r in snap['resources']))
        self.assertIn('ESTIMATES', snap['estimates'])
        for c in snap['candidates']:
            self.assertEqual(c['feasible'], not c['blockers'])
        json.dumps(snap)                                  # serialisable as written

    def test_world_key(self):
        self.assertEqual(core.world_key('hive-a', 'hive-a-Alpha'), 'hive-a')
        self.assertEqual(core.world_key('self-isolated-a-Alpha', 'isolated-a-Alpha'), 'isolated-a')
        self.assertEqual(core.world_key(None, 'placebo-d-Echo'), 'placebo-d')

    def test_trap_and_milestone_rows(self):
        bots, worlds = {}, {}
        base = {'@timestamp': '2026-10-03T01:00:00.000Z', 'exp': {'pool': 'hive-a'}, 'bot': {'name': 'hive-a-X'}}
        core.ingest(dict(base, skill={'name': '_marooned', 'status': 'failed', 'detail': 'x'}), bots, worlds)
        core.ingest(dict(base, skill={'name': '_milestone_complete', 'status': 'success',
                                      'detail': 'completed stockpile_wood#1; now craft_wooden_pickaxe_1#1'}), bots, worlds)
        st = bots['hive-a-X']
        self.assertEqual(st.trap_kind, '_marooned')
        self.assertEqual(st.milestone, 'craft_wooden_pickaxe_1')
        core.ingest(dict(base, skill={'name': '_milestone_skipped', 'status': 'failed',
                                      'detail': 'no serving progress in 45 min (skip #2 of stockpile_stone); moved on to patrol#1'}),
                    bots, worlds)
        self.assertEqual(st.milestone, 'patrol')
        core.ingest(dict(base, skill={'name': 'deposit', 'status': 'failed', 'detail': 'had 1 item(s) and the chest is full; x'}),
                    bots, worlds)
        self.assertFalse(core.bank_view(worlds['hive-a'], core.parse_ts('2026-10-03T01:10:00Z'))['accepts_recently'])


class Slots(unittest.TestCase):
    def test_real_stack_sizes(self):
        self.assertEqual(core.stack_size('bamboo'), 64)
        self.assertEqual(core.stack_size('brown_egg'), 16)
        self.assertEqual(core.stack_size('bucket'), 16)
        self.assertEqual(core.stack_size('water_bucket'), 1)
        self.assertEqual(core.stack_size('stone_pickaxe'), 1)
        self.assertIn('minecraft-data', core._stack_table()[2])

    def test_fallback_rules_for_unknown_names(self):
        self.assertEqual(core.stack_size('mystery_pickaxe'), 1)
        self.assertEqual(core.stack_size('mystery_egg'), 16)
        self.assertEqual(core.stack_size('mystery_block'), 64)

    def test_estimate(self):
        # from a real row: 408 bamboo is 7 stacks, 25 brown_egg 2, 7 egg 1, tools 1 each
        inv = {'bamboo': 408, 'brown_egg': 25, 'egg': 7, 'stone_axe': 1, 'stone_shovel': 1, 'leaf_litter': 133}
        self.assertEqual(core.slots_estimate(inv), 7 + 2 + 1 + 1 + 1 + 3)
        self.assertEqual(core.slots_estimate({}), 0)
        self.assertEqual(core.slots_estimate({'dirt': 0}), 0)

    def test_pickaxe_uses(self):
        p = core.pickaxes({'stone_pickaxe': [{'slot': 1, 'used': 131, 'max': 131}, {'slot': 2, 'used': 100, 'max': 131}]})
        self.assertEqual([(x['name'], x['uses_left']) for x in p], [('stone_pickaxe', 31)], 'a 0-use copy is gone')


class Eligibility(unittest.TestCase):
    def test_wood_needs_a_near_log(self):
        checks.check_wood_needs_a_near_log(core)

    def test_trapped_and_stale_are_excluded(self):
        checks.check_trapped_and_stale_are_excluded(core)

    def test_full_bag_gets_free_bag(self):
        checks.check_full_bag_gets_free_bag(core)

    def test_restore_pick_needs_ingredients(self):
        checks.check_restore_pick_needs_ingredients(core)

    def test_iron(self):
        checks.check_iron_needs_pick_near_ore_and_room(core)


class Mayor(unittest.TestCase):
    def test_caps_and_unique_targets(self):
        checks.check_caps_and_unique_targets(core)

    def test_one_log_one_bot(self):
        checks.check_one_log_one_bot(core)

    def test_hysteresis_and_cooldown(self):
        checks.check_hysteresis_and_cooldown(core)

    def test_unstaffed_names_reasons(self):
        b = checks.make_bot(core, 'A', (100, 64, 100), checks.BARE, {})
        s = checks.snap_of(core, [b], [])
        rec, _ = core.decide(s, None)
        self.assertEqual(rec['assignments'], [])
        duties = {u['duty']: u for u in rec['unstaffed']}
        self.assertEqual(set(duties), {'RESTORE_PICK', 'GET_WOOD', 'GET_IRON'})
        self.assertEqual(duties['GET_WOOD']['reason'], 'no_feasible_candidate')
        self.assertIn('no_log_near', duties['GET_WOOD']['blockers'])
        self.assertIn('GET_WOOD', duties['RESTORE_PICK']['remedies'])


class Validator(unittest.TestCase):
    def test_rejections(self):
        checks.check_validator(core)


class Tailer(unittest.TestCase):
    def test_incremental_copytruncate_and_rename(self):
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, 'skill-x.jsonl')
            with open(p, 'w') as f:
                f.write('a\nb\npart')
            t = mayor_shadow.Tail(p, bootstrap_bytes=1 << 20)
            self.assertEqual(t.read(1 << 20), [b'a', b'b'])
            with open(p, 'a') as f:
                f.write('ial\nc\n')
            self.assertEqual(t.read(1 << 20), [b'partial', b'c'])
            with open(p, 'r+') as f:                       # copytruncate
                f.truncate(0)
            with open(p, 'a') as f:
                f.write('d\n')
            self.assertEqual(t.read(1 << 20), [b'd'])
            self.assertEqual(t.rotations, 1)
            os.rename(p, p + '-1')                          # rename-rotate: a new inode
            with open(p, 'w') as f:
                f.write('e\nf\n')
            self.assertEqual(t.read(1 << 20), [b'e', b'f'])
            self.assertEqual(t.rotations, 2)
            t2 = mayor_shadow.Tail(p, bootstrap_bytes=3)    # bootstrap mid-line drops the partial line
            self.assertEqual(t2.read(1 << 20), [b'f'])
            with open(p, 'a') as f:
                f.write('g' * 10 + '\n')
            self.assertEqual(t2.read(4), [])                # bounded read: 4 bytes, no newline yet
            self.assertGreater(t2.lag, 0)
            self.assertEqual(t2.read(1 << 20), [b'g' * 10])
        finally:
            shutil.rmtree(d)

    def test_once_over_real_rows(self):
        d = tempfile.mkdtemp()
        try:
            rows = fixture_rows()
            for r in rows:
                name = r['bot']['name']
                os.makedirs(os.path.join(d, 'logs', name), exist_ok=True)
                with open(os.path.join(d, 'logs', name, 'skill-%s.jsonl' % name), 'a') as f:
                    f.write(json.dumps(r) + '\n')
            os.makedirs(os.path.join(d, 'lib', '_pool-hive-a'))
            shutil.copy(os.path.join(FIX, 'world-facts-hive-a.json'), os.path.join(d, 'lib', '_pool-hive-a'))
            for b in ('Alpha', 'Bravo'):
                os.makedirs(os.path.join(d, 'lib', 'isolated-a-' + b))
                shutil.copy(os.path.join(FIX, 'world-facts-isolated-a-%s.json' % b), os.path.join(d, 'lib', 'isolated-a-' + b))
            out = os.path.join(d, 'out')
            with redirect_stdout(io.StringIO()):
                rc = mayor_shadow.main(['--once', '--now-from-data', '--nice', '0', '--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl'),
                                        '--facts-root', os.path.join(d, 'lib'), '--out-dir', out, '--allow-out-root', d])
            self.assertEqual(rc, 0)
            self.assertEqual(sorted(os.listdir(out)), ['assign-hive-a.jsonl', 'assign-isolated-a.jsonl', 'mayor-state.json',
                                                       'mayor-ticks.jsonl', 'snap-hive-a.jsonl', 'snap-isolated-a.jsonl'])
            with open(os.path.join(out, 'snap-isolated-a.jsonl')) as f:
                s = json.loads(f.readline())
            self.assertEqual(len(s['bots']), 5)
            self.assertEqual(s['meta']['facts_files'], ['world-facts-isolated-a-Alpha.json', 'world-facts-isolated-a-Bravo.json'])
            self.assertTrue(s['resources'], 'isolated world merged the per-bot facts files')
            with open(os.path.join(out, 'mayor-ticks.jsonl')) as f:
                tick = json.loads(f.readline())
            self.assertEqual(tick['rows'], len(rows))
        finally:
            shutil.rmtree(d)


class Scorer(unittest.TestCase):
    """A synthetic timeline: GET_WOOD short at t0, t0+30, t0+60. Bot A gathers a log at +10 min
    (concordant); bot B never does (unforced gap). The control: the detector sees A's gain."""

    def build(self, d):
        T0, M = checks.T0, 60000
        log = checks.log_at(110, 64, 100)
        snaps = []
        for k in (0, 30, 60):
            a = checks.make_bot(core, 'w-A', (100, 64, 100), checks.BARE if k == 0 else dict(checks.BARE, oak_log=1), {})
            b = checks.make_bot(core, 'w-B', (105, 64, 100), checks.BARE, {})
            s = checks.snap_of(core, [a, b], [log, checks.log_at(112, 64, 100)])
            for x in (s,):
                x['t_ms'] = T0 + k * M
                x['t'] = core.iso(x['t_ms'])
                x['snap_id'] = 'w@%s' % x['t']
            snaps.append(s)
        with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
            for s in snaps:
                f.write(json.dumps(s) + '\n')
        s0 = snaps[0]
        ca = checks.cand(s0, 'w-A', 'GET_WOOD')
        cb = checks.cand(s0, 'w-B', 'GET_WOOD')
        rec = {'engine': 'deterministic', 'snap_id': s0['snap_id'], 'assignments': [
            {'candidate_id': ca['id'], 'duty': 'GET_WOOD', 'target': ca['targets'][0], 'lease': 'new'},
            {'candidate_id': cb['id'], 'duty': 'GET_WOOD', 'target': cb['targets'][1], 'lease': 'new'}]}
        with open(os.path.join(d, 'assign-w.jsonl'), 'w') as f:
            f.write(json.dumps(rec) + '\n')
        os.makedirs(os.path.join(d, 'logs'))

        def row(name, k, inv, pos):
            return {'@timestamp': core.iso(T0 + k * M).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                    'bot': {'name': name, 'pos': {'x': pos[0], 'y': 64, 'z': pos[1]}, 'inventory': inv, 'tools': {}},
                    'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 0}}
        with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
            for k in range(0, 95, 5):
                f.write(json.dumps(row('w-A', k, checks.BARE if k < 10 else dict(checks.BARE, oak_log=1), (109, 100))) + '\n')
                f.write(json.dumps(row('w-B', k, checks.BARE, (105, 100))) + '\n')
        return d

    def test_metrics_on_a_synthetic_timeline(self):
        d = tempfile.mkdtemp()
        try:
            self.build(d)
            js = os.path.join(d, 'out.json')
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = mayor_score.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--assign', os.path.join(d, 'assign-*.jsonl'),
                                       '--logs', os.path.join(d, 'logs', '*.jsonl'), '--json', js, '--allow-out-root', d])
            text = buf.getvalue()
            self.assertEqual(rc, 0, text)
            self.assertLess(text.index('CONTROLS'), text.index('BASE RATE'), 'controls print before any rate')
            with open(js) as f:
                r = json.load(f)
            self.assertGreaterEqual(r['controls']['detector_events']['GET_WOOD'], 1, 'positive control')
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['n'], 2)
            self.assertEqual(m['exec_now'], 2)
            self.assertEqual((m['persist30'], m['persist30_n']), (2, 2))
            self.assertEqual((m['concord'], m['concord_n']), (1, 2), 'A gathered anyway; B did not')
            self.assertEqual(m['downstream'], 1, 'A came within 16 blocks of its target and gathered')
            self.assertEqual(m['unforced'], 1, 'B: eligible, need persisted, not done')
            self.assertAlmostEqual(m['unforced_h'], 1.0, places=3, msg='B unforced 60 min (need persisted at 60)')
        finally:
            shutil.rmtree(d)

    def test_uncontrolled_zero_exits_4(self):
        d = tempfile.mkdtemp()
        try:
            self.build(d)
            with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
                f.write('')                                  # an instrument that cannot see anything
            with redirect_stdout(io.StringIO()) as buf:
                rc = mayor_score.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--assign', os.path.join(d, 'assign-*.jsonl'),
                                       '--logs', os.path.join(d, 'logs', '*.jsonl')])
            self.assertEqual(rc, 4)
            self.assertIn('UNCONTROLLED', buf.getvalue())
        finally:
            shutil.rmtree(d)

    def test_outcome_detectors(self):
        base = {'slots_est': 36, 'logs': 0, 'iron_units': 0, 'pick_state': 'none'}

        def f(slots_est=36, logs=0, iron_units=0, pick_state='none'):     # a compact state row
            return (0, slots_est, logs, iron_units, pick_state == 'ok', 0, 64, 0)
        cfg = core.DEFAULTS
        self.assertTrue(mayor_score.outcome('FREE_BAG', base, [f(slots_est=33)], cfg))
        self.assertFalse(mayor_score.outcome('FREE_BAG', base, [f(slots_est=35)], cfg))
        self.assertTrue(mayor_score.outcome('GET_WOOD', base, [f(logs=3), f(logs=0)], cfg), 'a gather then a craft still counts')
        self.assertFalse(mayor_score.outcome('GET_IRON', base, [f(iron_units=0)], cfg))
        self.assertTrue(mayor_score.outcome('RESTORE_PICK', base, [f(pick_state='ok')], cfg))


class Frontier(unittest.TestCase):
    def snaps_file(self, d):
        b = checks.make_bot(core, 'w-A', (100, 64, 100), checks.BARE, {})
        c = checks.make_bot(core, 'w-C', (101, 64, 100), checks.BARE, {})
        out = os.path.join(d, 'snap-w.jsonl')
        with open(out, 'w') as f:
            for k in range(40):
                s = checks.snap_of(core, [b, c], [checks.log_at(110, 64, 100), checks.log_at(111, 64, 100)])
                s['t_ms'] += k * 300000
                s['t'] = core.iso(s['t_ms'])
                s['snap_id'] = 'w@%s' % s['t']
                f.write(json.dumps(s) + '\n')
        return os.path.join(d, 'snap-*.jsonl')

    def args(self, d, *extra):
        return ['--snaps', self.snaps_file(d), '--det', os.path.join(d, 'none-*.jsonl'), '--out-dir', os.path.join(d, 'out'),
                '--allow-out-root', d] + list(extra)

    def test_dry_run_writes_the_scorer_shape(self):
        d = tempfile.mkdtemp()
        try:
            with redirect_stdout(io.StringIO()):
                rc = mayor_frontier.main(self.args(d, '--dry-run', '--fake-invalid-every', '5'))
            self.assertEqual(rc, 0)
            names = sorted(os.listdir(os.path.join(d, 'out')))
            self.assertEqual(names, ['assign-claude-w.jsonl', 'assign-gpt-w.jsonl', 'frontier-run-claude.json', 'frontier-run-gpt.json'])
            with open(os.path.join(d, 'out', 'assign-claude-w.jsonl')) as f:
                recs = [json.loads(l) for l in f]
            self.assertTrue(all(r['engine'] == 'claude' and r['dry_run'] for r in recs))
            self.assertTrue(any(r['assignments'] for r in recs))
            self.assertTrue(any(not r['valid'] and any(x['why'] == 'unknown_candidate' for x in r['rejected']) for r in recs),
                            'the injected unknown id was rejected')
            with open(os.path.join(d, 'out', 'frontier-run-claude.json')) as f:
                summ = json.load(f)
            self.assertGreater(summ['invalid_rate'], 0)
        finally:
            shutil.rmtree(d)

    def test_refuses_without_key(self):
        d = tempfile.mkdtemp()
        try:
            with redirect_stderr(io.StringIO()) as err:
                ns = self.parse(d, '--engine', 'claude')
                rc = mayor_frontier.run(ns, env={})
            self.assertEqual(rc, 2)
            self.assertIn('ANTHROPIC_API_KEY is not set', err.getvalue())
        finally:
            shutil.rmtree(d)

    def parse(self, d, *extra):
        captured = {}
        orig = mayor_frontier.run
        mayor_frontier.run = lambda ns, **kw: captured.setdefault('ns', ns) and 0
        try:
            mayor_frontier.main(self.args(d, *extra))
        finally:
            mayor_frontier.run = orig
        return captured['ns']

    def test_live_path_with_a_fake_transport(self):
        """The Anthropic request shape, the key kept out of every output, the budget stop."""
        d = tempfile.mkdtemp()
        key = 'test-key-not-real-0123456789'
        seen = []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opener(req, timeout=None):
            body = json.loads(req.data.decode())
            seen.append((req.full_url, dict(req.header_items()), body))
            snap_text = body['messages'][0]['content']
            snap = json.loads(snap_text.split('\n', 1)[1].split('\n\n')[0])
            c = next(c for c in snap['candidates'] if c['feasible'])
            ans = {'assignments': [{'candidate_id': c['id'], 'target': c['targets'][0] if c['targets'] else '',
                                    'reason': 'nearest log', 'evidence': [c['id']], 'confidence': 0.7}],
                   'unmet_needs': [], 'abstain': False, 'abstain_reason': ''}
            return Resp(json.dumps({'content': [{'type': 'text', 'text': json.dumps(ans)}], 'stop_reason': 'end_turn',
                                    'usage': {'input_tokens': 3000, 'output_tokens': 500}}).encode())
        try:
            ns = self.parse(d, '--engine', 'claude', '--max-snapshots', '6', '--budget-usd', '1')
            with redirect_stdout(io.StringIO()):
                rc = mayor_frontier.run(ns, opener=opener, env={'ANTHROPIC_API_KEY': key})
            self.assertEqual(rc, 0)
            url, headers, body = seen[0]
            self.assertEqual(url, mayor_frontier.ANTHROPIC_URL)
            self.assertEqual(headers.get('X-api-key'), key)
            self.assertEqual(body['model'], 'claude-sonnet-5')
            self.assertNotIn('temperature', body, 'sonnet-5 rejects sampling params; omitted')
            self.assertEqual(body['output_config']['format']['type'], 'json_schema')
            for name in os.listdir(os.path.join(d, 'out')):
                with open(os.path.join(d, 'out', name)) as f:
                    self.assertNotIn(key, f.read(), name)
            with open(os.path.join(d, 'out', 'assign-claude-w.jsonl')) as f:
                recs = [json.loads(l) for l in f]
            self.assertTrue(all(r['valid'] for r in recs), [r['errors'] for r in recs])
            self.assertGreater(recs[0]['cost_usd'], 0)
            # a budget smaller than one worst-case call: no call is made, the run stops and says so
            seen.clear()
            ns2 = self.parse(d, '--engine', 'claude', '--budget-usd', '0.01')
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                rc = mayor_frontier.run(ns2, opener=opener, env={'ANTHROPIC_API_KEY': key})
            self.assertEqual(rc, 5)
            self.assertEqual(seen, [])
            with open(os.path.join(d, 'out', 'frontier-run-claude.json')) as f:
                self.assertTrue(json.load(f)['budget_hit'])
        finally:
            shutil.rmtree(d)

    def test_split_and_reasks(self):
        ids = ['w@%d' % i for i in range(2000)]
        anchored = sum(mayor_frontier.mode_for(i) == 'anchored' for i in ids) / len(ids)
        reask = sum(mayor_frontier.is_reask(i) for i in ids) / len(ids)
        self.assertTrue(0.45 < anchored < 0.55, anchored)
        self.assertTrue(0.07 < reask < 0.13, reask)
        self.assertTrue(mayor_frontier.sampling_allowed('claude-haiku-4-5'))
        self.assertFalse(mayor_frontier.sampling_allowed('gpt-6.1-sol'))


if __name__ == '__main__':
    unittest.main()
