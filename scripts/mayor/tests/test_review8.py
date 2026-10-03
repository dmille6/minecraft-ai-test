"""Round-5 review of 409ccb7 (Codex: documentation / test claim). The period-matched gate ratio is exactly 1.0 only
for identical retained proposal streams. One candidate per bot does not remove competition ACROSS bots: three
RESTORE_PICK bots under the default duty cap of 2 -- the mayor picks A/B, the leased random baseline B/C (Codex's
repro) -- and the ratio departs from 1.0 because of which bot was chosen. Scorer/docs/tests only; MAYOR_REV frozen."""
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
from checks import T0, make_bot, snap_of, tools_pick  # noqa: E402
from test_review4 import score  # noqa: E402

M = 60000
SHIFT = 5000 * M      # the random order is seeded by snap_id (= time); this start gives Codex's selection


def kit(n, k):
    """Every bot: a worn stone pickaxe (4.6%) and 3 logs -- RESTORE_PICK feasible. A and B craft one at +35; C never."""
    if n in 'AB' and k >= 35:
        return {'stone_pickaxe': 1}, tools_pick('stone_pickaxe', 0, 131)
    return {'oak_log': 3, 'stone_pickaxe': 1}, tools_pick('stone_pickaxe', 125, 131)


def contested_pick_world(d):
    snaps, recs, state = [], [], None
    for k in range(0, 61, 5):
        bots = [make_bot(core, 'w-' + n, (100 + 40 * i, 64, 100), *kit(n, k)) for i, n in enumerate('ABC')]
        s = snap_of(core, bots, [])
        s['t_ms'] = T0 + SHIFT + k * M
        s['t'] = core.iso(s['t_ms'])
        s['snap_id'] = 'w@%s' % s['t']
        rec, state = core.decide(s, state)          # ONE continuous run, as the live shadow writes it
        snaps.append(s)
        recs.append(rec)
    with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(s) + '\n' for s in snaps))
    with open(os.path.join(d, 'assign-w.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(r) + '\n' for r in recs))
    os.makedirs(os.path.join(d, 'logs'))
    with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
        for k in range(0, 95, 2):
            for i, n in enumerate('ABC'):
                inv, tools = kit(n, k)
                f.write(json.dumps({'@timestamp': core.iso(T0 + SHIFT + k * M).replace('Z', '.000Z'), 'exp': {'pool': 'w'},
                                    'bot': {'name': 'w-' + n, 'pos': {'x': 100 + 40 * i, 'y': 64, 'z': 100},
                                            'inventory': inv, 'tools': tools},
                                    'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 0}}) + '\n')
    return snaps, recs


def new_picks(snaps, order_of=None):
    state, out = None, {}
    for s in snaps:
        rec, state = core.decide(s, state, order=order_of(s) if order_of else None)
        got = sorted(a['bot_name'][-1] for a in rec['assignments'] if a['lease'] == 'new')
        if got:
            out[(s['t_ms'] - T0 - SHIFT) // M] = got
    return out


class ContestedAcrossBots(unittest.TestCase):
    def test_three_pick_bots_cap_two(self):
        d = tempfile.mkdtemp()
        try:
            snaps, _ = contested_pick_world(d)
            self.assertEqual(sum(c['feasible'] for c in snaps[0]['candidates'] if c['duty'] == 'RESTORE_PICK'), 3)
            self.assertEqual(core.DEFAULTS['cap_per_duty'], 2, 'precondition: more candidates than the duty cap')
            mayor, rnd = new_picks(snaps), new_picks(snaps, mayor_score.random_order)
            self.assertEqual((mayor[0], mayor[25]), (['A', 'B'], ['A', 'B']), mayor)
            self.assertEqual((rnd[0], rnd[25]), (['B', 'C'], ['B', 'C']), 'Codex: random picks B/C')
            _, r, text = score(d)
            g = r['gate']['RESTORE_PICK']
            # headline period from +25: mayor A,B at 25 (both relieved at 35), C at 35 and 60 (never): 2/4;
            # random B,C at 25 (B relieved), C at 50: 1/3. Same base rate -> (2/4) / (1/3) = 1.5
            self.assertIsNotNone(g['gate_ratio'], 'the ratio is computed')
            self.assertAlmostEqual(g['gate_ratio'], 1.5)
            self.assertNotEqual(g['gate_ratio'], 1.0, 'and it is not 1.0: the bots chosen differ')
            self.assertGreater(g['stateless_contested'], 0)
            self.assertIn('stateless-contested: mayor and random may have chosen different bots', text)
            self.assertNotIn('by construction', text, 'the scorer claims no 1.0 here')
        finally:
            shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
