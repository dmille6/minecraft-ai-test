"""Round-4 review of 5c100e4 (both CHANGE, small), OFFLINE SCORER ONLY: a compatible transition keeps each leased
run's ABSOLUTE start and warm-up deadline; a band with any undefined offset is INCOMPLETE, never PASSES; and every
duty has a gate ratio, FREE_BAG / RESTORE_PICK coming out at 1.0 by construction. mayor_core / mayor_shadow /
stack_sizes.json are byte-identical (MAYOR_REV 2e82cfe81496)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import mayor_score  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, tools_pick  # noqa: E402
from test_review4 import timeline, score  # noqa: E402

M = 60000


class CarriedRunsKeepTheirClock(unittest.TestCase):
    """1. Codex's repro: reset at 0, a near_target change at +15 (decide() does not read it: compatible)."""

    def test_pending_offsets_and_warm_up_survive_a_compatible_transition(self):
        d = tempfile.mkdtemp()
        try:
            timeline(d, [('w-A', 100, None, 'log')], [log_at(110, 64, 100)], records=False, k_max=90,
                     cfg_at=lambda k: {'near_target': 20} if k >= 15 else {})
            _, r, _ = score(d)
            p2 = [p for p in r['partitions'].values() if p['cfg']['near_target'] == 20][0]
            self.assertEqual(p2['carried_epochs'], 1, 'precondition: the transition is compatible')
            band = p2['gate']['GET_WOOD']['band']
            # offset o starts at ABSOLUTE 0+o and proposes every 25 min; its warm-up ends at o+25 (absolute):
            #   0: (0) 25 50 75   5: (5) 30 55 80   10: (10) 35 60 85   15: 15 40 65 90   20: 20 45 70   25: 25 50 75
            # -- in the second epoch, proposals before o+25 excluded. Dropping the clock gave 15/40/65/90, unexcluded.
            self.assertEqual(band['random_n'], [3, 3, 3, 3, 2, 2])
            self.assertEqual(band['random_warmup_excluded'], [0, 0, 0, 1, 1, 1])
        finally:
            shutil.rmtree(d)


class IncompleteBand(unittest.TestCase):
    """2. Any undefined offset (offset 0 is the headline) -> INCOMPLETE; PASSES needs every offset >= 1.5x."""

    def test_flag(self):
        f = mayor_score.band_flag
        self.assertEqual(f([None, 2, 2, 2, 2, 2]), 'incomplete', "Codex's repro: the headline itself undefined")
        self.assertEqual(f([2, 2, 2, 2, 2, None]), 'incomplete')
        self.assertEqual(f([None] * 6), 'incomplete')
        self.assertEqual(f([2, 2, 2, 2, 2, 2]), 'passes')
        self.assertEqual(f([2, 2, 1.4, 2, 2, 2]), 'initialization-dependent')
        self.assertEqual(f([1.0] * 6), 'fails')


def bag_and_pick_world(d):
    """Bot R: a worn stone pickaxe (4.6%) and 3 logs -- RESTORE_PICK feasible; it crafts a new one at +40.
    Bot F: 34 slots and a spent axe (wear_out) -- FREE_BAG feasible; it is down to 32 slots at +40.
    The deterministic records come from ONE continuous decide() run, as the live shadow writes them."""
    def kit(name, k):
        if name == 'R':
            return ({'oak_log': 3, 'stone_pickaxe': 1}, tools_pick('stone_pickaxe', 125, 131)) if k < 40 else \
                   ({'stone_pickaxe': 1}, tools_pick('stone_pickaxe', 0, 131))
        tools = dict(tools_pick('stone_pickaxe', 0, 131), stone_axe=[{'slot': 9, 'used': 130, 'max': 131}])
        return ({'bamboo': 64 * (32 if k < 40 else 30), 'stone_pickaxe': 1, 'stone_axe': 1}, tools)
    snaps, recs, state = [], [], None
    for k in range(0, 61, 5):
        bots = [make_bot(core, 'w-' + n, (100 + 40 * i, 64, 100), *kit(n, k)) for i, n in enumerate('RF')]
        s = snap_of(core, bots, [])
        s['t_ms'], s['t'] = T0 + k * M, core.iso(T0 + k * M)
        s['snap_id'] = 'w@%s' % s['t']
        rec, state = core.decide(s, state)
        snaps.append(s)
        recs.append(rec)
    with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(s) + '\n' for s in snaps))
    with open(os.path.join(d, 'assign-w.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(r) + '\n' for r in recs))
    os.makedirs(os.path.join(d, 'logs'))
    with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
        for k in range(0, 95, 2):
            for i, n in enumerate('RF'):
                inv, tools = kit(n, k)
                f.write(json.dumps({'@timestamp': core.iso(T0 + k * M).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                                    'bot': {'name': 'w-' + n, 'pos': {'x': 100 + 40 * i, 'y': 64, 'z': 100},
                                            'inventory': inv, 'tools': tools},
                                    'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 0}}) + '\n')
    return snaps


class EveryDutyHasAGate(unittest.TestCase):
    """3. FREE_BAG / RESTORE_PICK: one candidate per short bot, so the lease-matched ratio is 1.0 by construction."""

    def test_bag_and_pick_gate_is_one(self):
        d = tempfile.mkdtemp()
        try:
            snaps = bag_and_pick_world(d)
            self.assertTrue(all(c['feasible'] for c in snaps[0]['candidates'] if c['duty'] in ('FREE_BAG', 'RESTORE_PICK')))
            _, r, text = score(d)
            self.assertEqual(sorted(r['gate']), sorted(core.DUTIES))
            for duty in ('FREE_BAG', 'RESTORE_PICK'):
                g = r['gate'][duty]
                self.assertEqual(g['gate_ratio'], 1.0, (duty, g))
                self.assertIsNotNone(g['raw_det_xbase'])
                self.assertNotEqual(g['raw_det_xbase'], g['raw_random_xbase'],
                                    'precondition: the raw values differ (the warm-up proposal); the gate matches periods')
                self.assertIn('%-12s gate   1.00' % duty, text)
        finally:
            shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
