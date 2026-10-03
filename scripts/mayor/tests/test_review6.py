"""Round-3 review of 21e8aea (Claude CHANGE x1, Codex CHANGE x3), OFFLINE SCORER ONLY: the gate ratio as the read
rule, baseline state carried only across identical decide() semantics plus a start-offset sensitivity band, the
'stateless-contested' label with x random kept out of the gate, and positive controls per partition with that
partition's cfg. mayor_core / mayor_shadow / stack_sizes.json are byte-identical (MAYOR_REV 2e82cfe81496)."""
import io
import json
import os
import random
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import mayor_score  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, BARE  # noqa: E402
from test_review4 import timeline, score, state_row  # noqa: E402
from test_review5 import rand_snap  # noqa: E402

M = 60000
ONE_GATHERS_AT_40 = [('w-A', 100, 40, 'log')]
LOG1 = [log_at(110, 64, 100)]


def part_by(r, pred):
    ps = [p for p in r['partitions'].values() if pred(p)]
    assert len(ps) == 1, list(r['partitions'])
    return ps[0]


class GateRatio(unittest.TestCase):
    """1. The read rule: deterministic x base / LEASED-random x base in the same partition, GET_WOOD and GET_IRON."""

    def test_gate_ratio_end_to_end(self):
        d = tempfile.mkdtemp()
        try:   # A is short throughout and gathers one log at +40. The mayor proposes at +30 (inside 30..60: relieved);
            # leased random proposes at 0 (warm-up), 25 (relieved) and 50 (not): 1/2. Base cancels -> gate 2.0.
            timeline(d, ONE_GATHERS_AT_40, LOG1, record_ks=(30,))
            rc, r, text = score(d)
            g = r['gate']['GET_WOOD']
            self.assertEqual(sorted(r['gate']), sorted(core.DUTIES), 'every duty has a gate ratio (round 4)')
            eng = r['engines']
            self.assertEqual((eng['deterministic']['GET_WOOD']['concord'], eng['deterministic']['GET_WOOD']['concord_n']), (1, 1))
            self.assertEqual((eng['random']['GET_WOOD']['concord'], eng['random']['GET_WOOD']['concord_n']), (1, 2))
            self.assertAlmostEqual(g['det_xbase'], eng['deterministic']['GET_WOOD']['x_base_elig'])
            self.assertAlmostEqual(g['random_xbase'], eng['random']['GET_WOOD']['x_base_elig'])
            self.assertAlmostEqual(g['gate_ratio'], 2.0, msg='(1/1) / (1/2): the base rate cancels')
            self.assertNotEqual(eng['deterministic']['GET_WOOD']['x_random'], g['gate_ratio'],
                                'precondition: x random differs, so a gate reading it would show')
            self.assertIn('GATE RATIO (the read rule)', text)
            self.assertIn('matched-period xbase: deterministic', text)
            self.assertIn('raw xbase', text)
        finally:
            shutil.rmtree(d)

    def test_gate_reads_x_base_only(self):
        self.assertEqual(mayor_score.gate_ratio(3.0, 1.5), 2.0)
        self.assertIsNone(mayor_score.gate_ratio(3.0, None))
        self.assertIsNone(mayor_score.gate_ratio(3.0, 0.0))
        self.assertIsNone(mayor_score.gate_ratio(None, 1.0))


class ResetBias(unittest.TestCase):
    """2. A baseline carries its OWN state only across identical decide() semantics; every reset gets a band."""

    def test_decide_reads_only_the_declared_cfg_keys(self):
        rng = random.Random(11)

        def perturb(cfg, keys):
            out = dict(cfg)
            for k in keys:
                v = cfg[k]
                if isinstance(v, bool):
                    out[k] = not v
                elif isinstance(v, (int, float)):
                    out[k] = v * 3 + 7 if k not in ('cap_per_duty', 'cap_per_world') else max(1, v - 1)
                elif isinstance(v, dict):
                    out[k] = {kk: not vv for kk, vv in v.items()}
                else:
                    out[k] = () if v else ('x',)
            return out

        def run(seq, cfg):
            state, out = None, []
            for s in seq:
                rec, state = core.decide(s, state, cfg)
                out.append((rec['assignments'], rec['released'], rec['unstaffed'], rec['cooldowns']))
            return out
        others = [k for k in core.DEFAULTS if k not in mayor_score.DECIDE_CFG]
        changed_by = {k: 0 for k in mayor_score.DECIDE_CFG}
        for trial in range(60):
            seq = []
            for i in range(8):
                s = rand_snap(rng)
                s['t_ms'] = T0 + i * 5 * M
                s['snap_id'] = 'w@%d' % s['t_ms']
                seq.append(s)
            base = run(seq, core.DEFAULTS)
            self.assertEqual(run(seq, perturb(core.DEFAULTS, others)), base, 'a non-DECIDE_CFG key changed decide')
            for k in mayor_score.DECIDE_CFG:
                changed_by[k] += run(seq, perturb(core.DEFAULTS, [k])) != base
        for k in ('cap_per_duty', 'lease_s', 'cooldown_s'):
            self.assertGreater(changed_by[k], 0, 'positive control: the test can see %s change decide' % k)

    def run_two(self, d, **kw):
        timeline(d, [('w-A', 100, None, 'log')], LOG1, records=False, k_max=90, **kw)
        _, r, _ = score(d)
        return r

    def test_state_carries_across_a_cfg_change_decide_does_not_read(self):
        d = tempfile.mkdtemp()
        try:   # near_target is a scorer key: decide() identical -> the baseline continues (0/25/50/75), no warm-up
            r = self.run_two(d, cfg_at=lambda k: {'near_target': 20} if k >= 30 else {})
            p2 = part_by(r, lambda p: p['cfg']['near_target'] == 20)
            self.assertEqual(p2['carried_epochs'], 1)
            m = p2['engines']['random']['GET_WOOD']
            self.assertEqual((m['n'], m['warmup_excluded']), (2, 0), '50 and 75 of the continuous run')
        finally:
            shutil.rmtree(d)

    def test_state_resets_across_a_code_change_or_a_decide_cfg_change(self):
        for kw in ({'rev_at': (30, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb')},
                   {'cfg_at': lambda k: {'cooldown_s': 600} if k >= 30 else {}}):
            d = tempfile.mkdtemp()
            try:
                r = self.run_two(d, **kw)
                p2 = sorted(r['partitions'].values(), key=lambda p: p['from'])[1]
                self.assertEqual(p2['carried_epochs'], 0, kw)
                self.assertGreaterEqual(p2['engines']['random']['GET_WOOD']['warmup_excluded'], 1,
                                        'reset at 30: its forced first proposal is warm-up')
                self.assertEqual(p2['gate']['GET_WOOD']['reset_epochs'], 1)
            finally:
                shutil.rmtree(d)

    def test_sensitivity_band_over_start_offsets(self):
        d = tempfile.mkdtemp()
        try:   # random from offset o after the reset: o=0 -> 25 (1), 50 (0); 5 -> 30 (1), 55 (0): 1/2 -> gate 2.0 with
            # the mayor's +30 proposal inside the matched period. From o=10 the period starts at 35 and holds no
            # mayor proposal (and random's x base is 0 from o=15): undefined
            timeline(d, ONE_GATHERS_AT_40, LOG1, record_ks=(30,))
            _, r, text = score(d)
            band = r['gate']['GET_WOOD']['band']
            self.assertEqual(band['offsets_min'], [0, 5, 10, 15, 20, 25])
            self.assertEqual([None if v is None else round(v, 6) for v in band['values']], [2.0, 2.0, None, None, None, None])
            self.assertEqual((band['min'], band['max'], band['undefined']), (2.0, 2.0, 4))
            self.assertEqual(band['values'][0], r['gate']['GET_WOOD']['gate_ratio'], 'offset 0 IS the headline run')
            self.assertEqual(r['gate']['GET_WOOD']['flag'], 'incomplete', 'undefined offsets: never PASSES (round 4)')
            self.assertIn('band over random start offsets', text)
        finally:
            shutil.rmtree(d)

    def test_band_flag(self):
        f = mayor_score.band_flag
        self.assertEqual(f([1.2, 1.8]), 'initialization-dependent')
        self.assertEqual(f([1.5, 1.8]), 'passes')
        self.assertEqual(f([1.0, 1.49]), 'fails')


class StatelessContestedLabel(unittest.TestCase):
    """3. `stcon` is stateless-contested; x random is a diagnostic, never a gate input."""

    def test_label_and_role(self):
        d = tempfile.mkdtemp()
        try:
            timeline(d, ONE_GATHERS_AT_40, LOG1, record_ks=(30,))
            _, r, text = score(d)
            self.assertIn(' stcon ', text)
            self.assertIn('STATELESS-CONTESTED', text)
            self.assertIn('never a gate input', text)
            self.assertNotIn(' contd ', text)
            self.assertIn('never a gate input', next(iter(r['partitions'].values()))['xrand_role'])
        finally:
            shutil.rmtree(d)


def slots_timeline(d, full_slots=None, stale_s=None, row_every=2, rev_at=None, gather_at=None):
    """One bot; its bag is 31 slots until +20 and 29 after (Codex's repro). Snapshots record `full_slots` /
    `stale_s` when given. gather_at: a log gained at that minute (the only GET_WOOD event)."""
    over = {k: v for k, v in (('full_slots', full_slots), ('stale_s', stale_s)) if v is not None}
    snaps = []
    for k in range(0, 61, 5):
        s = snap_of(core, [make_bot(core, 'w-A', (100, 64, 100), BARE, {})], LOG1)
        s['t_ms'], s['t'] = T0 + k * M, core.iso(T0 + k * M)
        s['snap_id'] = 'w@%s' % s['t']
        s['cfg'] = dict(s['cfg'], **over)
        if rev_at:
            s['mayor_rev'] = rev_at[1] if k < rev_at[0] else rev_at[2]
        snaps.append(s)
    with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(s) + '\n' for s in snaps))
    with open(os.path.join(d, 'assign-w.jsonl'), 'w') as f:
        f.write(json.dumps(core.decide(snaps[0], None)[0]) + '\n')
    os.makedirs(os.path.join(d, 'logs'))
    with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
        for k in range(0, 95, row_every):
            inv = {'dirt': 64 * (31 if k < 20 else 29)}                   # exactly 31 slots, then 29
            if gather_at is not None and k >= gather_at:
                inv['oak_log'] = 1
            f.write(json.dumps(state_row('w-A', T0 + k * M, inv, (100, 100))) + '\n')


class ControlsPerPartition(unittest.TestCase):
    """4. Detector counts and coverage per partition, with that partition's cfg; exit 4 judged per partition."""

    def test_free_bag_event_uses_the_partitions_full_slots(self):
        for fs, want in ((30, 1), (None, 0)):
            d = tempfile.mkdtemp()
            try:
                slots_timeline(d, full_slots=fs)
                _, r, _ = score(d)
                p = next(iter(r['partitions'].values()))
                self.assertEqual(p['controls']['detector_events']['FREE_BAG'], want,
                                 '31 -> 29 slots is a FREE_BAG event under full_slots=30, not under 34 (%s)' % fs)
            finally:
                shutil.rmtree(d)

    def test_coverage_uses_the_partitions_stale_s(self):
        for st, full in ((60, False), (None, True)):
            d = tempfile.mkdtemp()
            try:                                  # a row every 4 min: within 300 s of every snapshot, not within 60 s
                slots_timeline(d, stale_s=st, row_every=4)
                _, r, _ = score(d)
                cov = next(iter(r['partitions'].values()))['controls']['coverage']['per_bot']['w-A']
                self.assertEqual(cov == 1.0, full, (st, cov))
            finally:
                shutil.rmtree(d)

    def test_zero_acceptance_is_judged_per_partition(self):
        d = tempfile.mkdtemp()
        try:   # one partition; the log is gained at +60: the detector sees it, so the k=0 zero is controlled
            slots_timeline(d, gather_at=60)
            with redirect_stdout(io.StringIO()):
                rc = mayor_score.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--assign', os.path.join(d, 'assign-*.jsonl'),
                                       '--logs', os.path.join(d, 'logs', '*.jsonl')])
            self.assertEqual(rc, 0, 'control: one partition, the event is in it')
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:   # the revision changes at +40: the k=0 window (to +30) is inside the first partition and sees nothing;
            # the event at +60 is in the SECOND partition, so it cannot control the first one's zero
            slots_timeline(d, gather_at=60, rev_at=(40, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'))
            with redirect_stdout(io.StringIO()) as buf:
                rc = mayor_score.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--assign', os.path.join(d, 'assign-*.jsonl'),
                                       '--logs', os.path.join(d, 'logs', '*.jsonl')])
            self.assertEqual(rc, 4, 'partition aaaa has a zero its own detector could not have seen')
            self.assertIn('aaaaaaaaaaaa/cfg-', buf.getvalue().split('UNCONTROLLED ZERO')[1])
        finally:
            shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
