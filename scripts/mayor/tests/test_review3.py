"""Third-pass review fixes for shadow-mayor a6e8f15. Written BEFORE the fixes and run against a6e8f15 first."""
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
import mayor_frontier  # noqa: E402
import test_review as tr  # noqa: E402
from checks import make_bot, snap_of, log_at, BARE, cand  # noqa: E402

GOOD = json.dumps({'assignments': [], 'unmet_needs': [], 'abstain': True, 'abstain_reason': 'x'})


class ReplayFilterEveryEngine(unittest.TestCase):
    make = tr.ScorerTimeline.make
    run_score = tr.ScorerTimeline.run_score

    def test_a_replay_record_is_not_scored_with_live_snapshots(self):
        def frontier(s0, snaps):
            ca = cand(s0, 'w-A', 'GET_WOOD')
            return [{'engine': 'claude', 'mode': 'blind', 'replay': True, 'snap_id': s0['snap_id'], 'valid': True,
                     'assignments': [{'candidate_id': ca['id'], 'target': ca['targets'][0]}], 'rejected': []}]
        d = tempfile.mkdtemp()
        try:
            self.make(d, extra=frontier)
            rc, r, _ = self.run_score(d)
            self.assertNotIn('claude:blind', r['engines'], 'a replay-flagged record never mixes with live scoring')
            self.assertIn('deterministic', r['engines'], 'control: the live record is still scored')
        finally:
            shutil.rmtree(d)


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Envelopes(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        b = make_bot(core, 'w-A', (100, 64, 100), BARE, {})
        with open(os.path.join(self.d, 'snap-w.jsonl'), 'w') as f:
            f.write(json.dumps(snap_of(core, [b], [log_at(110, 64, 100)])) + '\n')

    def tearDown(self):
        shutil.rmtree(self.d)

    def go(self, engine, envelope):
        out = os.path.join(self.d, 'out-%d' % id(envelope))
        ns = mayor_frontier.parser().parse_args([
            '--snaps', os.path.join(self.d, 'snap-*.jsonl'), '--det', os.path.join(self.d, 'none'), '--out-dir', out,
            '--allow-out-root', self.d, '--engine', engine, '--retry-base-s', '0', '--reask-pct', '0', '--max-retries', '0'])
        env = {'ANTHROPIC_API_KEY': 'test-key-not-real', 'OPENAI_API_KEY': 'test-key-not-real'}
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            rc = mayor_frontier.run(ns, opener=lambda req, timeout=None: Resp(json.dumps(envelope).encode()), env=env)
        with open(os.path.join(out, 'frontier-run-%s.json' % engine)) as f:
            return rc, json.load(f)

    def assert_charged_invalid(self, engine, envelope):
        rc, s = self.go(engine, envelope)
        self.assertEqual(rc, 0, envelope)
        self.assertEqual((s['calls'], s['invalid']), (1, 1), envelope)
        self.assertGreater(s['spent_usd'], 0, envelope)
        self.assertAlmostEqual(s['spent_usd'], s['reserved_usd'], places=6, msg='charged at the reservation: %r' % (envelope,))

    def test_anthropic_malformed_content(self):
        u = {'input_tokens': 10, 'output_tokens': 10}
        for content in ([None], ['x'], [{'type': 'text', 'text': 5}], {'type': 'text'}, 7):
            self.assert_charged_invalid('claude', {'content': content, 'stop_reason': 'end_turn', 'usage': u})

    def test_openai_malformed_output(self):
        u = {'input_tokens': 10, 'output_tokens': 10}
        for output in ([None], [{'type': 'message', 'content': [None]}], [{'type': 'message', 'content': 'x'}],
                       [{'type': 'message', 'content': [{'type': 'output_text', 'text': ['a']}]}], 'x'):
            self.assert_charged_invalid('gpt', {'output': output, 'status': 'completed', 'usage': u})

    def test_missing_or_non_numeric_usage_is_charged_at_reservation(self):
        ok = [{'type': 'text', 'text': GOOD}]
        for usage in ({}, {'input_tokens': 'x', 'output_tokens': 1}, {'input_tokens': 5}, {'input_tokens': True, 'output_tokens': 1},
                      {'input_tokens': -1, 'output_tokens': 1}):
            rc, s = self.go('claude', {'content': ok, 'stop_reason': 'end_turn', 'usage': usage})
            self.assertEqual(rc, 0)
            self.assertAlmostEqual(s['spent_usd'], s['reserved_usd'], places=6, msg='usage %r is missing, not zero' % (usage,))
        rc, s = self.go('claude', {'content': ok, 'stop_reason': 'end_turn', 'usage': {'input_tokens': 1000, 'output_tokens': 100}})
        self.assertAlmostEqual(s['spent_usd'], (1000 * 2 + 100 * 10) / 1e6, places=9, msg='control: real usage is billed as reported')


if __name__ == '__main__':
    unittest.main()
