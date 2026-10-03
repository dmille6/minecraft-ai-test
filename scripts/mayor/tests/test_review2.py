"""Second-pass review fixes for shadow-mayor ed04dc5 (Claude + Codex, 2026-10-03). Each test here was
written BEFORE its fix and run against ed04dc5 first."""
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
import mayor_frontier  # noqa: E402
import checks  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, BARE  # noqa: E402
import test_review as tr  # noqa: E402

M = 60000


class Silence(unittest.TestCase):
    """1. An unobserved window leaves EVERY denominator, whatever the outcome."""
    make = tr.ScorerTimeline.make
    run_score = tr.ScorerTimeline.run_score

    def test_done_but_unobserved_is_excluded(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, a_gap=(12, 24))          # A gathered at +10, then 14 min of silence inside its window
            rc, r, _ = self.run_score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['unobserved'], 1)
            self.assertEqual((m['concord'], m['concord_n']), (0, 1), 'A left the denominator although it was done')
            self.assertEqual(m['downstream_n'], 1)
        finally:
            shutil.rmtree(d)

    def test_stale_at_the_next_snapshot_is_unknown(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, b_stale_at=5)
            rc, r, _ = self.run_score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual((m['exec'], m['exec_n']), (1, 1), 'B unseen at +5: unknown, not inexecutable')
        finally:
            shutil.rmtree(d)

    def test_base_rate_counts_observed_windows_only(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d, b_rows=False)
            rc, r, _ = self.run_score(d)
            self.assertEqual(r['base']['GET_WOOD']['n'], 13, 'only A\'s 13 observed windows; silent B is not a base-rate miss')
        finally:
            shutil.rmtree(d)

    def test_json_is_written_without_following_a_symlink(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d)
            victim = os.path.join(d, 'victim')
            with open(victim, 'w') as f:
                f.write('keep')
            os.symlink(victim, os.path.join(d, 'out.json'))
            rc, r, _ = self.run_score(d)
            with open(victim) as f:
                self.assertEqual(f.read(), 'keep')
            self.assertFalse(os.path.islink(os.path.join(d, 'out.json')))
        finally:
            shutil.rmtree(d)


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def anthropic_body(text, tin=3000, tout=500):
    return json.dumps({'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn',
                       'usage': {'input_tokens': tin, 'output_tokens': tout}}).encode()


class Frontier(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.d)

    def write_snaps(self, n=3, replay=None, garbage=False):
        b = make_bot(core, 'w-A', (100, 64, 100), BARE, {})
        with open(os.path.join(self.d, 'snap-w.jsonl'), 'w') as f:
            for k in range(n):
                s = snap_of(core, [b], [log_at(110, 64, 100)])
                s['t_ms'] += k * 300000
                s['t'] = core.iso(s['t_ms'])
                s['snap_id'] = 'w@%s' % s['t']
                if replay is not None and replay(k):
                    s['replay'] = True
                f.write(json.dumps(s) + '\n')
            if garbage:
                f.write('{"schema": 1, "world": "w", "t_ms": 17')          # a truncated last line

    def args(self, *extra):
        return mayor_frontier.parser().parse_args([
            '--snaps', os.path.join(self.d, 'snap-*.jsonl'), '--det', os.path.join(self.d, 'none'),
            '--out-dir', os.path.join(self.d, 'out'), '--allow-out-root', self.d, '--engine', 'claude',
            '--retry-base-s', '0', '--reask-pct', '0'] + list(extra))

    def summary(self):
        with open(os.path.join(self.d, 'out', 'frontier-run-claude.json')) as f:
            return json.load(f)

    def run_(self, ns, opener=None):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as err:
            rc = mayor_frontier.run(ns, opener=opener, env={'ANTHROPIC_API_KEY': 'test-key-not-real'}) if opener else \
                mayor_frontier.run(ns, env={})
        return rc, err.getvalue()

    def test_truncated_snapshot_line_is_tolerated(self):
        self.write_snaps(garbage=True)
        rc, _ = self.run_(self.args('--dry-run'))
        self.assertEqual(rc, 0)
        self.assertEqual(self.summary()['skipped_lines'], 1)
        self.assertEqual(self.summary()['snapshots'], 3)

    def test_replay_snapshots_are_refused_unless_replay_only_and_never_mixed(self):
        self.write_snaps(replay=lambda k: True)
        rc, err = self.run_(self.args('--dry-run'))
        self.assertEqual(rc, 2)
        self.assertIn('replay', err)
        rc, _ = self.run_(self.args('--dry-run', '--replay-only'))
        self.assertEqual(rc, 0)
        self.write_snaps(replay=lambda k: k == 0)                     # mixed: live only by default
        rc, _ = self.run_(self.args('--dry-run'))
        self.assertEqual((rc, self.summary()['snapshots']), (0, 2))

    def test_non_json_200_is_billed_counted_and_survived(self):
        self.write_snaps()
        rc, _ = self.run_(self.args(), opener=lambda req, timeout=None: Resp(b'<html>gateway hiccup</html>'))
        self.assertEqual(rc, 0)
        s = self.summary()
        self.assertEqual((s['calls'], s['invalid']), (3, 3))
        self.assertGreater(s['spent_usd'], 0, 'no usage came back, so the reservation is charged')

    def test_malformed_fields_are_normalised_not_consumed(self):
        self.write_snaps(n=1)
        ans = json.dumps({'assignments': [], 'unmet_needs': 1, 'abstain': 'yes', 'abstain_reason': 2})
        rc, _ = self.run_(self.args(), opener=lambda req, timeout=None: Resp(anthropic_body(ans)))
        self.assertEqual(rc, 0)
        self.assertEqual(self.summary()['invalid'], 1)
        with open(os.path.join(self.d, 'out', 'assign-claude-w.jsonl')) as f:
            rec = json.loads(f.readline())
        self.assertEqual((rec['unmet_needs'], rec['unstaffed'], rec['abstain']), ([], [], None))

    def test_budget_estimate_has_overhead_and_actual_billing_stops_the_run(self):
        led = mayor_frontier.Ledger(5, 2.0, 10.0)
        self.assertGreater(led.worst(0, 0), 0, 'a request with an empty prompt still costs the schema and framing')
        self.write_snaps(n=4)
        huge = Resp(anthropic_body(json.dumps({'assignments': [], 'unmet_needs': [], 'abstain': True, 'abstain_reason': 'x'}),
                                   tin=3500000, tout=0))
        rc, _ = self.run_(self.args('--budget-usd', '7'), opener=lambda req, timeout=None: huge)
        s = self.summary()
        self.assertTrue(s['budget_hit'])
        self.assertEqual(s['calls'], 1, 'the ACTUAL $7 bill leaves no room for the next reservation')


class Bounds(unittest.TestCase):
    def test_absent_worlds_and_their_leases_are_evicted(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, 'logs', 'w-A'))
            with open(os.path.join(d, 'logs', 'w-A', 'skill-w-A.jsonl'), 'w') as f:
                f.write(json.dumps({'@timestamp': core.iso(T0).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                                    'bot': {'name': 'w-A', 'pos': {'x': 0, 'y': 64, 'z': 0}, 'inventory': {}},
                                    'skill': {'name': 'goto'}}) + '\n')
            ns = mayor_shadow.parser().parse_args(['--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl'), '--nice', '0',
                                                   '--facts-root', d, '--out-dir', os.path.join(d, 'out'), '--allow-out-root', d,
                                                   '--evict-bot-h', '1', '--evict-world-h', '1'])
            sh = mayor_shadow.Shadow(ns)
            sh.tick(T0 + 1000)
            self.assertIn('w', sh.states)
            sh.states['w']['leases']['w-A'] = {'duty': 'GET_WOOD', 'since_ms': T0, 'target_key': None}
            sh.tick(T0 + 30 * M)
            self.assertIn('w', sh.states, 'present 30 min ago: kept')
            sh.tick(T0 + 3 * 60 * M)
            self.assertNotIn('w', sh.states, 'absent > 1 h: the world and its leases go')
            with open(os.path.join(d, 'out', 'mayor-state.json')) as f:
                self.assertNotIn('w', json.load(f))
        finally:
            shutil.rmtree(d)

    def test_replay_obeys_the_output_cap(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, 'logs', 'w-A'))
            with open(os.path.join(d, 'logs', 'w-A', 'skill-w-A.jsonl'), 'w') as f:
                for k in range(3):
                    f.write(json.dumps({'@timestamp': core.iso(T0 + k * 300000).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                                        'bot': {'name': 'w-A', 'pos': {'x': 0, 'y': 64, 'z': 0}, 'inventory': {}},
                                        'skill': {'name': 'goto'}}) + '\n')
            out = os.path.join(d, 'out')
            os.makedirs(out)
            with open(os.path.join(out, 'snap-w.jsonl'), 'w') as f:
                f.write('x' * (2 << 20))
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()) as err:
                rc = mayor_shadow.main(['--replay', '--nice', '0', '--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl'),
                                        '--facts-root', d, '--out-dir', out, '--allow-out-root', d, '--max-out-mb', '1'])
            self.assertEqual(rc, 6)
            self.assertIn('output cap', err.getvalue())
        finally:
            shutil.rmtree(d)


class StateRows(unittest.TestCase):
    def test_pos_without_inventory_does_not_advance_state(self):
        bots, worlds = {}, {}
        base = {'exp': {'pool': 'w'}, 'skill': {'name': 'goto'}}
        core.ingest(dict(base, **{'@timestamp': core.iso(T0).replace('Z', '.000Z'),
                                  'bot': {'name': 'w-A', 'pos': {'x': 1, 'y': 64, 'z': 1}, 'inventory': {'oak_log': 5}}}), bots, worlds)
        core.ingest(dict(base, **{'@timestamp': core.iso(T0 + 60000).replace('Z', '.000Z'),
                                  'bot': {'name': 'w-A', 'pos': {'x': 9, 'y': 64, 'z': 9}}}), bots, worlds)
        core.ingest(dict(base, **{'@timestamp': core.iso(T0 + 90000).replace('Z', '.000Z'),
                                  'bot': {'name': 'w-A', 'pos': {'x': 'bad'}, 'inventory': {}}}), bots, worlds)
        st = bots['w-A']
        self.assertEqual(st.full['inventory'], {'oak_log': 5}, 'no fabricated empty inventory')
        self.assertEqual(st.full['pos']['x'], 1)
        self.assertEqual(st.full_ms, T0)


class WithdrawSwitch(unittest.TestCase):
    def test_certainty_follows_withdraw_verified(self):
        b = make_bot(core, 'A', (0, 64, 0), BARE, {})
        cert = lambda cfg: {x['duty']: x['certainty'] for x in snap_of(core, [b], [], cfg=cfg)['shortages']}
        c = cert(core.DEFAULTS)
        self.assertEqual((c['GET_WOOD'], c['GET_IRON']), ('definite', 'unknown-bank'), 'the 10-03 decision')
        self.assertEqual(core.DEFAULTS['withdraw_verified'], {'iron': False, 'wood': False})
        c = cert(dict(core.DEFAULTS, withdraw_verified={'iron': False, 'wood': True}))
        self.assertEqual(c['GET_WOOD'], 'unknown-bank', 'once wood can be withdrawn, banked wood matters')
        c = cert(dict(core.DEFAULTS, bank_unknown_conservative=()))
        self.assertEqual(c['GET_IRON'], 'definite', 'the strict rule, without the conservative iron exception')


if __name__ == '__main__':
    unittest.main()
