"""GET_WOOD is a PER-BOT shortage (2026-10-03). Measured on the live shadow (2,720 world snapshots, 13 h): the
world rule `sum(log_eq) < 2 x no_pick + 1` fired in 59; in 1,376 of the 2,661 where it stayed quiet a bot with
no usable pickaxe held < 2 log-eq, while RESTORE_PICK was blocked `no_ingredients` -> 'GET_WOOD' 3,671 times.
Bots cannot hand each other wood, so pooled wood is the wrong instrument: the wood is on the wrong bot."""
import itertools
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import test_review as tr  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, cand, tools_pick, BARE  # noqa: E402


def old_world_rule(snap):
    """The 111dadc rule, verbatim arithmetic: the instrument this change replaces."""
    live = [b for b in snap['bots'] if b['fresh']]
    no_pick = sum(1 for b in live if b['pick_state'] in ('none', 'low'))
    return bool(live) and round(sum(b['log_eq'] for b in live), 2) < 2 * no_pick + 1


def wood_bots(snap):
    names = {b['id']: b['name'] for b in snap['bots']}
    return sorted(names.get(s['bot'], 'WORLD') for s in snap['shortages'] if s['duty'] == 'GET_WOOD')


def rich_and_poor():
    rich = make_bot(core, 'R', (0, 64, 0), {'oak_log': 64}, tools_pick('stone_pickaxe', 10, 131))
    poor = [make_bot(core, n, (100 + 4 * i, 64, 100), BARE, {}) for i, n in enumerate('BC')]
    return rich, poor


class WoodIsPerBot(unittest.TestCase):
    def test_a_rich_bot_does_not_hide_two_poor_ones(self):
        rich, poor = rich_and_poor()
        res = [log_at(110, 64, 100), log_at(112, 64, 100)]
        s = snap_of(core, [rich] + poor, res)
        # positive control: the old instrument CAN fire -- on the same poor bots without the rich one
        self.assertTrue(old_world_rule(snap_of(core, poor, res)), 'control: the world rule sees a world with no wood')
        self.assertFalse(old_world_rule(s), 'the 10-03 defect: 64 logs on R hide B and C')
        self.assertEqual(wood_bots(s), ['B', 'C'], s['shortages'])
        sh = [x for x in s['shortages'] if x['duty'] == 'GET_WOOD']
        self.assertTrue(all(x['scope'] == 'bot' for x in sh), sh)
        # only the short bot is a candidate for its own shortage: the wood must end up in ITS bag
        wood_c = [c for c in s['candidates'] if c['duty'] == 'GET_WOOD']
        self.assertEqual(sorted(c['bot_name'] for c in wood_c), ['B', 'C'], wood_c)
        for c in wood_c:
            own = next(x for x in sh if x['id'] == c['shortage'])
            self.assertEqual(own['bot'], c['bot'], 'a bot staffs only its own wood shortage')
        rec, _ = core.decide(s, None)
        self.assertEqual(sorted(a['bot_name'] for a in rec['assignments'] if a['duty'] == 'GET_WOOD'), ['B', 'C'], rec)

    def test_a_bot_with_wood_for_its_pickaxe_is_not_short(self):
        def short(inv, tools=None):
            b = make_bot(core, 'A', (0, 64, 0), inv, tools if tools is not None else {})
            return wood_bots(snap_of(core, [b], [])) == ['A']
        cases = [
            ({}, True, 'nothing'),
            ({'oak_log': 2}, True, '8 planks < 3 + 2 (sticks) + 4 (table)'),
            ({'oak_log': 3}, False, '12 planks: a wooden pickaxe and its table'),
            ({'oak_log': 2, 'crafting_table': 1}, False, '8 planks >= 5 with a table held'),
            ({'oak_planks': 4, 'cobblestone': 3}, True, 'stone head, but 4 planks < 2 + 4 (table)'),
            ({'oak_planks': 2, 'cobblestone': 3, 'crafting_table': 1}, False, 'stone head: 2 planks for sticks'),
            ({'stick': 2, 'cobblestone': 3, 'crafting_table': 1}, False, 'stone head, sticks and table held'),
            ({'oak_log': 64, 'birch_planks': 10}, False, 'rich'),
        ]
        for inv, want, why in cases:
            self.assertEqual(short(inv), want, why)
        self.assertTrue(short({}, tools_pick('stone_pickaxe', 125, 131)), 'a LOW pickaxe (4.6%) and no wood is short')
        self.assertFalse(short({}, tools_pick('stone_pickaxe', 10, 131)), 'a usable pickaxe: nothing to make, not short')
        unk = make_bot(core, 'A', (0, 64, 0), {'stone_pickaxe': 1}, {})
        unk.update(core.bot_features({'inventory': {'stone_pickaxe': 1}, 'tools': None}))   # make_bot logs tools {}
        self.assertEqual(unk['pick_state'], 'unknown')
        self.assertEqual(wood_bots(snap_of(core, [unk], [])), [], "pick_state 'unknown' (no durability logged) is not short")

    def test_restore_pick_blocker_and_wood_shortage_agree(self):
        """Over a grid of kits: GET_WOOD is short for a bot IFF its RESTORE_PICK is blocked no_ingredients
        (one shared function), and the shortage's numbers are that function's numbers."""
        seen = {True: 0, False: 0}
        tools = {'none': {}, 'low': tools_pick('stone_pickaxe', 125, 131), 'ok': tools_pick('stone_pickaxe', 10, 131)}
        for logs, planks, sticks, cobble, table, pk in itertools.product(
                (0, 1, 2, 3), (0, 1, 4, 5, 8), (0, 1, 2), (0, 3), (0, 1), ('none', 'low', 'ok')):
            inv = {'oak_log': logs, 'oak_planks': planks, 'stick': sticks, 'cobblestone': cobble, 'crafting_table': table}
            b = make_bot(core, 'A', (0, 64, 0), {k: v for k, v in inv.items() if v}, tools[pk])
            s = snap_of(core, [b], [])
            rp = cand(s, 'A', 'RESTORE_PICK')
            blocked = rp is not None and 'no_ingredients' in [x['code'] for x in rp['blockers']]
            short = wood_bots(s) == ['A']
            self.assertEqual(short, blocked, (inv, pk, s['shortages'], rp))
            self.assertEqual(short, core.short_of_wood(s['bots'][0]), (inv, pk))
            if pk == 'ok':
                self.assertFalse(short, 'a usable pickaxe is never short of wood')
            if short:
                sh = next(x for x in s['shortages'] if x['duty'] == 'GET_WOOD')
                _, need, held = core.pick_ingredients(s['bots'][0])
                self.assertEqual((sh['value'], sh['threshold']), (held, need))
                self.assertLess(held, need)
                self.assertEqual(rp['blockers'][0]['remedy'], 'GET_WOOD', 'the blocker names the shortage that exists')
            seen[short] += 1
        self.assertGreater(seen[True], 20, 'positive control: the grid holds short bots')
        self.assertGreater(seen[False], 20, 'and bots that are not')

    def test_lease_done_is_per_bot_not_world(self):
        """A leased bot is not 'done' because ANOTHER bot holds wood; it is done when it gains a log or
        can make its own pickaxe."""
        def at(snap, dt_s):
            snap['t_ms'] += dt_s * 1000
            snap['snap_id'] = 'w@%d' % snap['t_ms']
            return snap
        res = [log_at(130, 64, 100)]
        a = make_bot(core, 'A', (100, 64, 100), BARE, {})
        r1, st = core.decide(snap_of(core, [a], res), None)
        self.assertEqual([(x['bot_name'], x['duty']) for x in r1['assignments']], [('A', 'GET_WOOD')], r1)
        rich = make_bot(core, 'R', (0, 64, 0), {'oak_log': 64}, tools_pick('stone_pickaxe', 10, 131))
        r2, st2 = core.decide(at(snap_of(core, [a, rich], res), 300), st)
        self.assertEqual(r2['released'], [], 'R holding wood does not finish A\'s duty')
        self.assertIn(('A', 'GET_WOOD', 'held'), {(x['bot_name'], x['duty'], x['lease']) for x in r2['assignments']})
        # done by being able to craft: A picked up planks (no log gained) and is no longer short
        a_planks = make_bot(core, 'A', (100, 64, 100), dict(BARE, oak_planks=12), {})
        r3, _ = core.decide(at(snap_of(core, [a_planks], res), 360), st2)
        self.assertEqual([(x['bot'], x['why']) for x in r3['released']], [('A', 'done')], r3['released'])
        # done by a log gained, although one log does not yet make a pickaxe
        a_log = make_bot(core, 'A', (100, 64, 100), dict(BARE, oak_log=1), {})
        self.assertTrue(core.short_of_wood(a_log), 'control: one log is still short')
        r4, _ = core.decide(at(snap_of(core, [a_log], res), 360), st2)
        self.assertEqual([(x['bot'], x['why']) for x in r4['released']], [('A', 'done')], r4['released'])


class ScorerPersistIsPerBot(unittest.TestCase):
    make = tr.ScorerTimeline.make
    run_score = tr.ScorerTimeline.run_score

    def test_a_stale_bot_leaves_the_persistence_denominator(self):
        d = tempfile.mkdtemp()
        try:
            self.make(d)
            _, r, _ = self.run_score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual((m['persist30'], m['persist30_n']), (2, 2), 'control: both bots fresh and still short at +30')
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:
            self.make(d, b_stale_at=30)
            _, r, _ = self.run_score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual((m['persist30'], m['persist30_n']), (1, 1), 'B stale at +30: its own shortage is UNKNOWN there')
        finally:
            shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
