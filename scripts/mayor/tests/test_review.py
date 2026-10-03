"""Review fixes for shadow-mayor c748f99 (Claude + Codex reviews, 2026-10-03). Each test here was
written BEFORE its fix and was seen to fail against c748f99."""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout, redirect_stderr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import mayor_shadow  # noqa: E402
import mayor_score  # noqa: E402
import mayor_frontier  # noqa: E402
import checks  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, cand, BARE  # noqa: E402

M = 60000


def at(s, dt_s):
    s['t_ms'] += dt_s * 1000
    s['t'] = core.iso(s['t_ms'])
    s['snap_id'] = '%s@%s' % (s['world'], s['t'])
    return s


def coords(snap, rid):
    r = next(r for r in snap['resources'] if r['id'] == rid)
    return (r['kind'], r['x'], r['y'], r['z'])


class Leases(unittest.TestCase):
    def test_a_new_sighting_between_ticks_does_not_move_a_lease(self):
        a = make_bot(core, 'A', (100, 64, 100), BARE, {})
        s1 = snap_of(core, [a], [log_at(130, 64, 100)])
        r1, st = core.decide(s1, None)
        first = coords(s1, r1['assignments'][0]['target'])
        # a nearer sighting appears and sorts first: R-ids shift under the lease
        s2 = at(snap_of(core, [a], [log_at(120, 64, 100), log_at(130, 64, 100)]), 300)
        r2, _ = core.decide(s2, st)
        held = [x for x in r2['assignments'] if x['lease'] == 'held']
        self.assertEqual(len(held), 1, r2['assignments'])
        self.assertEqual(coords(s2, held[0]['target']), first, 'the lease keeps its PLACE, not its R-id')

    def test_held_leases_get_uniqueness_and_caps(self):
        bots = [make_bot(core, n, (100 + i, 64, 100), BARE, {}) for i, n in enumerate('ABCD')]
        res = [log_at(110, 64, 100), log_at(112, 64, 100), log_at(114, 64, 100)]
        s = snap_of(core, bots, res)
        key = lambda rid: core.res_key(next(r for r in s['resources'] if r['id'] == rid))
        L = lambda rid, since: {'duty': 'GET_WOOD', 'target': rid, 'target_key': key(rid), 'since_ms': T0 - since * 1000,
                                'start_logs': 0, 'start_iron': 0}
        # A and B both claim R1 (B is newer); C and D hold R2 and R3: four GET_WOOD leases, cap is 2
        state = {'leases': {'A': L('R1', 200), 'B': L('R1', 100), 'C': L('R2', 150), 'D': L('R3', 50)}, 'cooldowns': {}}
        rec, _ = core.decide(s, state)
        wood = [x for x in rec['assignments'] if x['duty'] == 'GET_WOOD']
        self.assertLessEqual(len(wood), core.DEFAULTS['cap_per_duty'], wood)
        tg = [x['target'] for x in wood]
        self.assertEqual(len(tg), len(set(tg)), 'no two leases on one target')
        self.assertEqual({x['bot_name'] for x in wood}, {'A', 'C'}, 'the OLDEST leases are kept')
        why = {x['bot']: x['why'] for x in rec['released']}
        self.assertEqual(why.get('B'), 'conflict')
        self.assertEqual(why.get('D'), 'over_cap')


class Freshness(unittest.TestCase):
    def test_fresh_needs_state_bearing_telemetry(self):
        bots, worlds = {}, {}
        state = {'@timestamp': core.iso(T0 - 600000).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                 'bot': {'name': 'w-A', 'pos': {'x': 0, 'y': 64, 'z': 0}, 'inventory': {}, 'tools': {}},
                 'skill': {'name': 'gather', 'status': 'success'}}
        reflex = {'@timestamp': core.iso(T0 - 10000).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                  'bot': {'name': 'w-A'}, 'skill': {'name': '_path_reset', 'status': 'success'}}
        core.ingest(state, bots, worlds)
        core.ingest(reflex, bots, worlds)
        v = core.bot_view(bots['w-A'], T0)
        self.assertFalse(v['fresh'], 'a reflex row 10 s ago does not make a 10-min-old position fresh')

    def test_future_timestamps_are_rejected(self):
        st = core.BotState('w-A')
        st.world, st.full = 'w', {'pos': {'x': 0, 'y': 64, 'z': 0}, 'inventory': {}, 'tools': {}, 'dimension': 'overworld'}
        st.full_ms = st.last_ms = T0 + 3600000
        self.assertFalse(core.bot_view(st, T0)['fresh'], 'a state from the future is not fresh')
        bots, worlds, stats = {}, {}, {}
        row = {'@timestamp': core.iso(T0 + 3600000).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
               'bot': {'name': 'w-B', 'pos': {'x': 0, 'y': 64, 'z': 0}}, 'skill': {'name': 'gather'}}
        self.assertIsNone(core.ingest(row, bots, worlds, now_ms=T0, stats=stats))
        self.assertNotIn('w-B', bots)
        self.assertEqual(stats.get('future'), 1)


class Lookahead(unittest.TestCase):
    def test_sightings_after_the_snapshot_are_dropped(self):
        facts = {'resources': [{'kind': 'oak_log', 'x': 1, 'y': 64, 'z': 1, 'count': 1, 'last': T0 + 3600000},
                               {'kind': 'oak_log', 'x': 2, 'y': 64, 'z': 2, 'count': 1, 'last': T0 - 3600000}]}
        res = core.merge_resources([facts], T0)
        self.assertEqual([(r['x'], r['z']) for r in res], [(2, 2)])

    def test_replay_ingests_by_availability_and_marks_snapshots(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, 'logs', 'w-A'))
            def row(t_s, dur_ms, x):
                return {'@timestamp': core.iso(T0 + t_s * 1000).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                        'bot': {'name': 'w-A', 'pos': {'x': x, 'y': 64, 'z': 0}, 'inventory': {}, 'tools': {}},
                        'skill': {'name': 'goto', 'status': 'success', 'duration_ms': dur_ms}}
            with open(os.path.join(d, 'logs', 'w-A', 'skill-w-A.jsonl'), 'w') as f:
                # started at +200 s, ENDED at +400 s: not available at the +300 s snapshot
                for r in (row(0, 0, 0), row(200, 200000, 50), row(420, 0, 60)):
                    f.write(json.dumps(r) + '\n')
            out = os.path.join(d, 'out')
            with redirect_stdout(io.StringIO()):
                rc = mayor_shadow.main(['--replay', '--nice', '0', '--interval', '300', '--allow-out-root', d,
                                        '--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl'),
                                        '--facts-root', os.path.join(d, 'lib'), '--out-dir', out])
            self.assertEqual(rc, 0)
            with open(os.path.join(out, 'snap-w.jsonl')) as f:
                snaps = [json.loads(l) for l in f]
            s300 = next(s for s in snaps if s['t_ms'] == T0 + 300000)
            self.assertEqual(s300['bots'][0]['pos']['x'], 0, 'a row is not seen before it was written')
            self.assertTrue(all(s.get('replay') is True for s in snaps))
            # the scorer refuses replay snapshots unless asked to score them on their own
            with redirect_stdout(io.StringIO()) as buf:
                rc = mayor_score.main(['--snaps', os.path.join(out, 'snap-*.jsonl'), '--assign', os.path.join(out, 'assign-*.jsonl'),
                                       '--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl')])
            self.assertEqual(rc, 2)
            self.assertIn('replay', buf.getvalue())
        finally:
            shutil.rmtree(d)


class TailAndBounds(unittest.TestCase):
    def test_copytruncate_that_regrows_past_the_offset(self):
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, 'skill-x.jsonl')
            with open(p, 'w') as f:
                f.write('{"a":1}\n{"b":2}\n')
            t = mayor_shadow.Tail(p, 1 << 20)
            self.assertEqual(t.read(1 << 20), [b'{"a":1}', b'{"b":2}'])
            with open(p, 'w') as f:                     # truncated and regrown between two ticks
                f.write('{"c":3333333}\n{"d":4}\n')
            self.assertEqual(t.read(1 << 20), [b'{"c":3333333}', b'{"d":4}'])
            self.assertEqual(t.rotations, 1)
        finally:
            shutil.rmtree(d)

    def test_evicts_vanished_files_and_silent_bots(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, 'logs', 'w-A'))
            p = os.path.join(d, 'logs', 'w-A', 'skill-w-A.jsonl')
            with open(p, 'w') as f:
                f.write(json.dumps({'@timestamp': core.iso(T0).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                                    'bot': {'name': 'w-A', 'pos': {'x': 0, 'y': 64, 'z': 0}}, 'skill': {'name': 'goto'}}) + '\n')
            args = mayor_shadow.parser().parse_args(['--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl'), '--nice', '0',
                                                     '--facts-root', d, '--out-dir', os.path.join(d, 'out'), '--allow-out-root', d,
                                                     '--evict-file-min', '30', '--evict-bot-h', '6'])
            sh = mayor_shadow.Shadow(args)
            sh.tick(T0 + 1000)
            self.assertIn(p, sh.tails)
            self.assertIn('w-A', sh.bots)
            os.remove(p)
            sh.tick(T0 + 10 * M)
            self.assertIn(p, sh.tails, 'not evicted before 30 min')
            sh.tick(T0 + 45 * M)
            self.assertNotIn(p, sh.tails)
            sh.tick(T0 + 7 * 60 * M)
            self.assertNotIn('w-A', sh.bots, 'a bot silent for > 6 h is dropped from memory')
        finally:
            shutil.rmtree(d)

    def test_output_cap_stops_clearly(self):
        d = tempfile.mkdtemp()
        try:
            out = os.path.join(d, 'out')
            os.makedirs(out)
            with open(os.path.join(out, 'snap-w.jsonl'), 'w') as f:
                f.write('x' * (2 << 20))
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as err:
                rc = mayor_shadow.main(['--once', '--nice', '0', '--logs', os.path.join(d, 'none', '*'), '--facts-root', d,
                                        '--out-dir', out, '--allow-out-root', d, '--max-out-mb', '1'])
            self.assertEqual(rc, 6)
            self.assertIn('output cap', err.getvalue())
        finally:
            shutil.rmtree(d)


class OutputSafety(unittest.TestCase):
    def test_refuses_bot_state_and_unlisted_paths(self):
        import mayor_io
        d = os.path.realpath(tempfile.mkdtemp())
        try:
            for bad in ('/var/log/mcai/x', '/var/lib/mcai/hive-a-Alpha', '/var/lib/mcai', '/srv/mcbots/h',
                        '/opt/minecraft-ai/scripts', os.path.join(d, '..', 'elsewhere')):
                with self.assertRaises(mayor_io.UnsafeOutput, msg=bad):
                    mayor_io.safe_out_dir(bad, [d])
            self.assertEqual(mayor_io.safe_out_dir(os.path.join(d, 'sub'), [d]), os.path.join(d, 'sub'))
            mayor_io.safe_out_dir('/var/lib/mcai-mayor', None)          # the default allowlisted mayor dir
            with self.assertRaises(mayor_io.UnsafeOutput):
                mayor_io.safe_out_dir('/var/lib/mcai/../mcai/x', ['/var/lib'])   # forbidden even if allowlisted above
        finally:
            shutil.rmtree(d)

    def test_never_follows_a_symlink_on_create(self):
        import mayor_io
        d = tempfile.mkdtemp()
        try:
            victim = os.path.join(d, 'victim')
            with open(victim, 'w') as f:
                f.write('keep')
            os.symlink(victim, os.path.join(d, 'snap-w.jsonl'))
            with self.assertRaises(OSError):
                mayor_io.append_line(os.path.join(d, 'snap-w.jsonl'), 'x')
            with open(victim) as f:
                self.assertEqual(f.read(), 'keep')
        finally:
            shutil.rmtree(d)

    def test_shadow_refuses_a_bot_state_out_dir(self):
        with redirect_stderr(io.StringIO()) as err, redirect_stdout(io.StringIO()):
            rc = mayor_shadow.main(['--once', '--nice', '0', '--out-dir', '/var/lib/mcai/should-never-exist'])
        self.assertEqual(rc, 2)
        self.assertIn('REFUSING', err.getvalue())
        self.assertFalse(os.path.exists('/var/lib/mcai/should-never-exist'))


class Iron(unittest.TestCase):
    def test_iron_shortage_is_not_definite(self):
        b = make_bot(core, 'A', (0, 64, 0), {'dirt': 1}, checks.tools_pick('stone_pickaxe', 0, 131))
        s = snap_of(core, [b], [])
        iron = [x for x in s['shortages'] if x['duty'] == 'GET_IRON']
        self.assertEqual(iron[0]['certainty'], 'unknown-bank')
        wood = make_bot(core, 'A', (0, 64, 0), BARE, {})
        self.assertEqual([x['certainty'] for x in snap_of(core, [wood], [])['shortages'] if x['duty'] == 'RESTORE_PICK'], ['definite'])


class ScorerTimeline(unittest.TestCase):
    """GET_WOOD short all along. A gathers at +10 (concordant). B is eligible and never gathers
    (unforced) -- unless it is SILENT (unobserved) or trapped in between (not eligible through)."""

    def make(self, d, b_rows=True, b_trapped_at=None, extra=None, iron=False, a_gap=None, b_stale_at=None):
        log, log2 = log_at(110, 64, 100), log_at(112, 64, 100)
        ironres = log_at(120, 60, 100, kind='iron_ore')
        snaps = []
        for k in range(0, 65, 5):
            pick = checks.tools_pick('stone_pickaxe', 0, 131) if iron else {}
            a = make_bot(core, 'w-A', (100, 64, 100), BARE if k < 10 else dict(BARE, oak_log=1), pick)
            b = make_bot(core, 'w-B', (105, 64, 100), BARE, pick, trapped_s=10 if b_trapped_at == k else None,
                         fresh=b_stale_at != k)
            s = at(snap_of(core, [a, b], [log, log2, ironres]), k * 60)
            snaps.append(s)
        with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
            for s in snaps:
                f.write(json.dumps(s) + '\n')
        s0 = snaps[0]
        duty = 'GET_IRON' if iron else 'GET_WOOD'
        ca, cb = cand(s0, 'w-A', duty), cand(s0, 'w-B', duty)
        rec = {'engine': 'deterministic', 'snap_id': s0['snap_id'], 'assignments': [
            {'candidate_id': ca['id'], 'duty': duty, 'target': ca['targets'][0], 'lease': 'new'},
            {'candidate_id': cb['id'], 'duty': duty, 'target': cb['targets'][-1], 'lease': 'new'}]}
        recs = [rec] + (extra(s0, snaps) if extra else [])
        with open(os.path.join(d, 'assign-w.jsonl'), 'w') as f:
            for r in recs:
                f.write(json.dumps(r) + '\n')
        os.makedirs(os.path.join(d, 'logs'))

        def row(name, k, inv, pos):
            return {'@timestamp': core.iso(T0 + k * M).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                    'bot': {'name': name, 'pos': {'x': pos[0], 'y': 64, 'z': pos[1]}, 'inventory': inv, 'tools': {}},
                    'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 0}}
        with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
            for k in range(0, 95, 2):
                if not (a_gap and a_gap[0] <= k <= a_gap[1]):
                    f.write(json.dumps(row('w-A', k, BARE if k < 10 else dict(BARE, oak_log=1), (109, 100))) + '\n')
                if b_rows or k == 0:
                    f.write(json.dumps(row('w-B', k, BARE, (105, 100))) + '\n')
        return snaps

    def run_score(self, d, *extra):
        js = os.path.join(d, 'out.json')
        with redirect_stdout(io.StringIO()) as buf:
            rc = mayor_score.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--assign', os.path.join(d, 'assign-*.jsonl'),
                                   '--logs', os.path.join(d, 'logs', '*.jsonl'), '--json', js, '--allow-out-root', d] + list(extra))
        with open(js) as f:
            return rc, json.load(f), buf.getvalue()

    def test_silent_bot_is_unobserved_not_unforced(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, b_rows=False)
            rc, r, text = self.run_score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['unforced'], 0, 'silence is not failure')
            self.assertEqual(m['unobserved'], 1)
            self.assertEqual(m['concord_n'], 1, 'an unobserved proposal is not in the concordance denominator')
            self.assertIn('coverage', text)
        finally:
            shutil.rmtree(d)

    def test_unforced_requires_eligibility_through_the_interval(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, b_trapped_at=15)
            rc, r, _ = self.run_score(d)
            self.assertEqual(r['engines']['deterministic']['GET_WOOD']['unforced'], 0)
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:
            self.make(d)
            rc, r, _ = self.run_score(d)
            self.assertEqual(r['engines']['deterministic']['GET_WOOD']['unforced'], 1, 'control: without the trap it IS unforced')
        finally:
            shutil.rmtree(d)

    def test_iron_unknown_bank_is_excluded_from_unforced(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, iron=True)
            rc, r, _ = self.run_score(d)
            m = r['engines']['deterministic']['GET_IRON']
            self.assertEqual(m['unforced'], 0)
            self.assertEqual(m['unforced_unknown_bank'], 2)
        finally:
            shutil.rmtree(d)

    def test_exec_uses_next_snapshot_and_counts_rejections(self):
        def frontier(s0, snaps):
            ca = cand(s0, 'w-A', 'GET_WOOD')
            return [{'engine': 'claude', 'mode': 'blind', 'snap_id': s0['snap_id'], 'valid': False,
                     'assignments': [{'candidate_id': ca['id'], 'duty': 'GET_WOOD', 'target': ca['targets'][0]}],
                     'rejected': [{'item': {'candidate_id': 'C999'}, 'why': 'unknown_candidate'},
                                  {'item': {'candidate_id': ca['id']}, 'why': 'duplicate_target'}]}]
        d = tempfile.mkdtemp()
        try:
            self.make(d, extra=frontier)
            rc, r, _ = self.run_score(d)
            m = r['engines']['claude:blind']['GET_WOOD']
            self.assertEqual((m['exec'], m['exec_n']), (1, 2), 'one executable at +5; one rejected GET_WOOD proposal')
            self.assertEqual(r['engines']['claude:blind']['?']['rejected'], 1, 'an unknown candidate is a rejected proposal')
            dm = r['engines']['deterministic']['GET_WOOD']
            rnd = r['engines']['random']['GET_WOOD']
            rr = rnd['downstream'] / rnd['downstream_n']
            self.assertAlmostEqual(dm['x_random'], (dm['downstream'] / dm['downstream_n']) / rr if rr else None)
        finally:
            shutil.rmtree(d)

    def test_per_bot_coverage_control_flags_a_blind_bot(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, b_rows=False)
            rc, r, text = self.run_score(d)
            cov = r['controls']['coverage']
            self.assertEqual(cov['bots_with_rows'], 2)
            self.assertLess(cov['per_bot']['w-B'], 0.2)
            self.assertGreater(cov['per_bot']['w-A'], 0.9)
        finally:
            shutil.rmtree(d)


class FrontierHardening(unittest.TestCase):
    def test_validator_never_raises_and_enforces_the_schema(self):
        s = checks.five_eligible(core)
        c = next(c for c in s['candidates'] if c['feasible'])
        good = {'candidate_id': c['id'], 'target': c['targets'][0], 'reason': 'r', 'evidence': [c['id']], 'confidence': 0.5}
        top = {'assignments': [good], 'unmet_needs': [], 'abstain': False, 'abstain_reason': ''}
        self.assertTrue(core.validate(s, top)['valid'])
        bad_items = [dict(good, candidate_id=[1]), dict(good, candidate_id=7), dict(good, target={'x': 1}),
                     dict(good, target=['R1']), dict(good, evidence='C1'), dict(good, evidence=[{'id': 'C1'}]),
                     dict(good, confidence=True), dict(good, confidence='0.5'), dict(good, extra=1),
                     {k: v for k, v in good.items() if k != 'reason'}, dict(good, reason=None), 'C1', None, 5]
        for item in bad_items:
            r = core.validate(s, dict(top, assignments=[item]))
            self.assertFalse(r['valid'], item)
        for bad_top in (dict(top, extra=1), dict(top, abstain='no'), dict(top, abstain_reason=3),
                        dict(top, unmet_needs=[{'duty': 'X', 'reason': '', 'evidence': []}]),
                        dict(top, unmet_needs=[{'duty': 'GET_WOOD', 'reason': '', 'evidence': [], 'more': 1}]),
                        dict(top, unmet_needs=['GET_WOOD']), dict(top, assignments={'a': 1}), [], 'x'):
            self.assertFalse(core.validate(s, bad_top)['valid'], bad_top)

    def frontier_dir(self, d):
        b = make_bot(core, 'w-A', (100, 64, 100), BARE, {})
        with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
            f.write(json.dumps(snap_of(core, [b], [log_at(110, 64, 100)])) + '\n')
        return mayor_frontier.parser().parse_args([
            '--snaps', os.path.join(d, 'snap-*.jsonl'), '--det', os.path.join(d, 'none'), '--out-dir', os.path.join(d, 'out'),
            '--allow-out-root', d, '--engine', 'claude', '--retry-base-s', '0', '--max-retries', '2', '--budget-usd', '5',
            '--reask-pct', '0'])

    def test_timeouts_are_charged_and_every_attempt_reserved(self):
        d = tempfile.mkdtemp()
        calls = []

        def opener(req, timeout=None):
            calls.append(1)
            raise urllib.error.URLError(TimeoutError('timed out'))
        try:
            ns = self.frontier_dir(d)
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                mayor_frontier.run(ns, opener=opener, env={'ANTHROPIC_API_KEY': 'test-key-not-real'})
            with open(os.path.join(d, 'out', 'frontier-run-claude.json')) as f:
                summ = json.load(f)
            self.assertEqual(len(calls), 3, '1 try + 2 retries')
            self.assertEqual(summ['attempts'], 3)
            self.assertGreater(summ['spent_usd'], 0, 'a timed-out attempt may have been billed: charged at worst case')
            self.assertAlmostEqual(summ['spent_usd'], summ['reserved_usd'], places=6)
        finally:
            shutil.rmtree(d)

    def test_error_bodies_are_never_persisted(self):
        d = tempfile.mkdtemp()

        def opener(req, timeout=None):
            body = json.dumps({'type': 'error', 'error': {'type': 'invalid_request_error',
                                                          'message': 'SECRETBODY echo of your prompt'}}).encode()
            raise urllib.error.HTTPError(req.full_url, 400, 'Bad Request', {}, io.BytesIO(body))
        try:
            ns = self.frontier_dir(d)
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as err:
                mayor_frontier.run(ns, opener=opener, env={'ANTHROPIC_API_KEY': 'test-key-not-real'})
            text = ''
            for name in os.listdir(os.path.join(d, 'out')):
                with open(os.path.join(d, 'out', name)) as f:
                    text += f.read()
            self.assertNotIn('SECRETBODY', text + err.getvalue())
            self.assertIn('http_400:invalid_request_error', text)
        finally:
            shutil.rmtree(d)


class KillSurvivors(unittest.TestCase):
    """Mutants that survived c748f99 (Claude review #7)."""

    def test_per_duty_cap(self):
        checks.check_per_duty_cap(core)

    def test_lease_expiry(self):
        checks.check_lease_expiry(core)

    def test_nearest_bot_ranks_first(self):
        checks.check_nearest_first(core)


if __name__ == '__main__':
    unittest.main()
