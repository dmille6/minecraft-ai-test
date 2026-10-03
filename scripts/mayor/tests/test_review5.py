"""Round-2 review of 784b71c (Codex CHANGE, Claude AGREE + one fix), all in the OFFLINE scorer: epochs that no
window crosses, baselines replayed from the start of the data with a declared warm-up, partitions keyed by code
revision AND effective configuration, a symmetric x base, and 'contested' that accounts for every competition.
mayor_core / mayor_shadow are untouched, so the deployed MAYOR_REV (2e82cfe81496) is unchanged."""
import itertools
import os
import random
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import mayor_score  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, BARE, tools_pick, worn_diamond  # noqa: E402
from test_review4 import timeline, score  # noqa: E402

M = 60000
ONE = [('w-A', 100, None, 'log')]                 # one short bot that never gathers
LOG1 = [log_at(110, 64, 100)]
TWO = [('w-A', 100, 25, 'log'), ('w-B', 105, None, 'log')]
LOGS2 = [log_at(110, 64, 100), log_at(112, 64, 100)]


def part(r, rev):
    ps = [p for p in r['partitions'].values() if p['mayor_rev'] == rev]
    assert len(ps) == 1, r['partitions'].keys()
    return ps[0]


class EpochIsolation(unittest.TestCase):
    """1. A window that crosses a partition transition is CENSORED, not credited; base-rate windows too; and
    a rollback (A, B, A) never lets the first A read the second."""

    def test_an_outcome_after_the_transition_is_not_credited(self):
        d = tempfile.mkdtemp()
        try:                                       # A gathers at +25; the revision changes at +20
            timeline(d, TWO, LOGS2)
            _, r, _ = score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual((m['concord'], m['concord_n']), (1, 2), 'control: one revision, A credited')
            self.assertGreater(r['base']['GET_WOOD']['n'], 0, 'control: base windows exist')
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:
            timeline(d, TWO, LOGS2, rev_at=(20, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'))
            _, r, _ = score(d)
            pa = part(r, 'aaaaaaaaaaaa')
            m = pa['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['concord_n'], 0, 'the +25 gather is after the transition: not credited to A')
            self.assertEqual(m['censored_epoch'], 2, 'both k=0 proposals cross the transition')
            self.assertEqual(pa['base']['GET_WOOD']['n'], 0, 'every base window of the first epoch crosses it too')
            pb = part(r, 'bbbbbbbbbbbb')
            self.assertGreater(pb['base']['GET_WOOD']['n'], 0, 'control: the last epoch keeps its windows')
        finally:
            shutil.rmtree(d)

    def test_a_rollback_never_bridges_the_intervening_revision(self):
        d = tempfile.mkdtemp()
        try:                                       # A (0-15), B (20-35), A again (40-60); proposals at +10 in A
            revs = lambda k: 'aaaaaaaaaaaa' if k < 20 or k >= 40 else 'bbbbbbbbbbbb'
            timeline(d, TWO, LOGS2, revs=revs, record_ks=(10,))
            _, r, _ = score(d)
            pa = part(r, 'aaaaaaaaaaaa')
            self.assertEqual(pa['epochs'], 2, 'the two A runs are two epochs of one partition')
            m = pa['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['n'], 2)
            self.assertEqual(m['persist30_n'], 0, '+30 (= +40) is in the SECOND A run: never read from the first')
            self.assertEqual(m['censored_epoch'], 2)
        finally:
            shutil.rmtree(d)


class BaselineHistory(unittest.TestCase):
    """2. Baselines replay from the start of the data, before --since/--until; their empty-state warm-up at
    every epoch start is excluded; they never read the mayor's records."""

    def test_since_does_not_restart_the_baseline(self):
        d = tempfile.mkdtemp()
        try:                                       # full history: 0 / 25 / 50. --since +30 must leave only 50
            timeline(d, ONE, LOG1, records=False)
            _, r, _ = score(d)
            self.assertEqual(r['engines']['random']['GET_WOOD']['n'], 2, 'control: 25 and 50 after the warm-up')
            _, r, _ = score(d, '--since', core.iso(T0 + 30 * M))
            self.assertEqual(r['engines']['random']['GET_WOOD']['n'], 1,
                             'replayed from 0, the baseline proposes at 50 only (restarted at 30 it would say 30, 55)')
        finally:
            shutil.rmtree(d)

    def test_warm_up_is_excluded_at_a_revision_boundary(self):
        d = tempfile.mkdtemp()
        try:                                       # epoch B starts at 20 with an empty baseline: 20 (warm-up), 45
            timeline(d, ONE, LOG1, records=False, rev_at=(20, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'))
            _, r, _ = score(d)
            m = part(r, 'bbbbbbbbbbbb')['engines']['random']['GET_WOOD']
            self.assertEqual((m['n'], m['warmup_excluded']), (1, 1), 'the forced proposal at 20 is unmatched warm-up')
        finally:
            shutil.rmtree(d)

    def test_baselines_never_read_the_mayors_records(self):
        d = tempfile.mkdtemp()
        try:
            timeline(d, ONE, LOG1, record_ks=(0, 5, 30, 35))
            _, with_rec, _ = score(d)
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:
            timeline(d, ONE, LOG1, records=False)
            _, without, _ = score(d)
        finally:
            shutil.rmtree(d)
        for b in ('random', 'nearest', 'random-stateless'):
            self.assertEqual(with_rec['engines'][b]['GET_WOOD'], without['engines'][b]['GET_WOOD'], b)


class ConfigPartition(unittest.TestCase):
    """3. Partition = code revision + canonical EFFECTIVE configuration, scored with that configuration."""

    def test_cfg_tag_is_canonical(self):
        s = {'cfg': dict(core.DEFAULTS)}
        rev = {'cfg': dict(reversed(list(core.DEFAULTS.items())))}
        rev['cfg']['bank_unknown_conservative'] = list(rev['cfg']['bank_unknown_conservative'])
        self.assertEqual(mayor_score.cfg_tag(s), mayor_score.cfg_tag(rev), 'key order and tuple/list do not matter')
        self.assertNotEqual(mayor_score.cfg_tag(s), mayor_score.cfg_tag({'cfg': dict(core.DEFAULTS, cap_per_duty=1)}))
        self.assertEqual(mayor_score.cfg_tag({}), 'cfg-unrecorded')

    def test_a_config_change_is_its_own_partition_scored_with_its_own_cfg(self):
        d = tempfile.mkdtemp()
        try:                                       # same code; cap_per_duty 2 -> 1 at +30. Two short bots.
            bots = [('w-A', 100, None, 'log'), ('w-B', 105, None, 'log')]
            timeline(d, bots, LOGS2, records=False, k_max=90, cfg_at=lambda k: {'cap_per_duty': 1} if k >= 30 else {})
            _, r, _ = score(d)
            self.assertEqual(len(r['partitions']), 2, r['partitions'].keys())
            by_cap = {p['cfg']['cap_per_duty']: p for p in r['partitions'].values()}
            self.assertEqual(sorted(by_cap), [1, 2])
            self.assertEqual(by_cap[2]['engines']['random']['GET_WOOD']['downstream_c_n'], 0,
                             'cap 2, two bots: nothing to choose')
            self.assertGreater(by_cap[1]['engines']['random']['GET_WOOD']['downstream_c_n'], 0,
                               'cap 1 (recorded), two bots: contested -- scored with THAT cfg, not the defaults')
        finally:
            shutil.rmtree(d)


class XBaseSymmetry(unittest.TestCase):
    """4. x base = CONCORDANCE / eligible base rate: the same outcome, window and observation rule on both sides.
    Codex's repro: the bot gets enough planks while 40 blocks from its target."""

    def test_relief_far_from_the_target(self):
        d = tempfile.mkdtemp()
        try:
            timeline(d, [('w-A', 100, 10, 'planks')], [log_at(140, 64, 100)])
            _, r, _ = score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual((m['downstream'], m['downstream_n']), (0, 1), 'not within 16 of its target: downstream 0')
            self.assertEqual((m['concord'], m['concord_n']), (1, 1), 'but relieved')
            be = r['base_eligible']['GET_WOOD']
            self.assertEqual(be['k'], be['n'])
            self.assertGreater(be['n'], 0)
            self.assertEqual(m['x_base_elig'], 1.0, 'proposal 1/1 vs base n/n, not 0 vs 1')
        finally:
            shutil.rmtree(d)


def rand_snap(rng):
    n = rng.randint(1, 5)
    kits = [lambda: (BARE, {}), lambda: ({'dirt': 1}, worn_diamond()),
            lambda: ({'dirt': 1}, tools_pick('stone_pickaxe', 10, 131)), lambda: ({'oak_log': 3}, {})]
    bots = []
    for i in range(n):
        inv, tools = rng.choice(kits)()
        bots.append(make_bot(core, 'B%d' % i, (100 + rng.randint(0, 30), 64, 100 + rng.randint(0, 30)), inv, tools))
    res = [log_at(100 + rng.randint(0, 40), 64, 100 + rng.randint(0, 40)) for _ in range(rng.randint(0, 3))]
    res += [log_at(100 + rng.randint(0, 40), 50, 100 + rng.randint(0, 40), kind='iron_ore') for _ in range(rng.randint(0, 3))]
    return snap_of(core, bots, res)


class Contested(unittest.TestCase):
    """5. 'contested' = the order of assignment can matter for the duty. The claim it rests on -- an uncontested
    duty gets the same candidates and targets under EVERY order -- is tested directly against core.greedy."""

    def picks(self, s, order, duty):
        return sorted((a['candidate_id'], a['target']) for a in core.greedy(s, order) if a['duty'] == duty)

    def test_uncontested_means_order_cannot_matter(self):
        rng = random.Random(7)
        seen = {True: 0, False: 0}
        differs = 0
        for _ in range(300):
            s = rand_snap(rng)
            for duty in core.DUTIES:
                if not any(c['feasible'] and c['duty'] == duty for c in s['candidates']):
                    continue
                orders = [list(s['candidates'])]
                for _ in range(12):
                    o = list(s['candidates'])
                    rng.shuffle(o)
                    orders.append(o)
                got = {tuple(self.picks(s, o, duty)) for o in orders}
                c = mayor_score.contested(s, duty, core.DEFAULTS)
                seen[c] += 1
                if not c:
                    self.assertEqual(len(got), 1, ('uncontested yet order-dependent', duty, s['candidates']))
                differs += c and len(got) > 1
        self.assertGreater(seen[False], 20, 'positive control: uncontested cases exist')
        self.assertGreater(seen[True], 20, 'and contested ones')
        self.assertGreater(differs, 5, 'and some contested ones really are order-dependent')

    def test_each_kind_of_competition(self):
        cfg = core.DEFAULTS
        con = mayor_score.contested
        # duty cap: three wood candidates, cap 2
        s = snap_of(core, [make_bot(core, n, (100 + 3 * i, 64, 100), BARE, {}) for i, n in enumerate('ABC')],
                    [log_at(100 + 3 * i, 64, 104) for i in range(3)])
        self.assertTrue(con(s, 'GET_WOOD', cfg))
        s2 = snap_of(core, [make_bot(core, n, (100 + 100 * i, 64, 100), BARE, {}) for i, n in enumerate('AB')],
                     [log_at(100, 64, 104), log_at(200, 64, 104)])
        tg = [c['targets'] for c in s2['candidates'] if c['duty'] == 'GET_WOOD']
        self.assertEqual(len(tg), 2)
        self.assertFalse(set(tg[0]) & set(tg[1]), 'precondition: each bot has its own log')
        self.assertFalse(con(s2, 'GET_WOOD', cfg), 'control: two bots, own logs, cap 2: no choice')
        # world cap: two wood bots + two iron bots = 4 bots > 3, every duty cap respected
        wood = [make_bot(core, n, (100 + 60 * i, 64, 100), BARE, {}) for i, n in enumerate('AB')]
        iron = [make_bot(core, n, (300 + 120 * i, 60, 100), {'dirt': 1}, tools_pick('stone_pickaxe', 0, 131))
                for i, n in enumerate('CD')]
        s3 = snap_of(core, wood + iron, [log_at(100, 64, 104), log_at(160, 64, 104),
                                         log_at(300, 50, 104, kind='iron_ore'), log_at(420, 50, 104, kind='iron_ore')])
        self.assertEqual(sum(c['feasible'] for c in s3['candidates']), 4, s3['candidates'])
        self.assertTrue(con(s3, 'GET_WOOD', cfg), 'four bots for three places')
        # bot competition: one bot feasible for wood AND iron
        s4 = snap_of(core, [make_bot(core, 'A', (100, 60, 100), {'dirt': 1}, worn_diamond())],
                     [log_at(100, 64, 104), log_at(110, 50, 100, kind='iron_ore')])
        self.assertTrue(con(s4, 'GET_WOOD', cfg) and con(s4, 'GET_IRON', cfg))
        # target competition: two bots whose only log is the same one
        s5 = snap_of(core, [make_bot(core, n, (100 + i, 64, 100), BARE, {}) for i, n in enumerate('AB')], [log_at(110, 64, 100)])
        self.assertTrue(con(s5, 'GET_WOOD', cfg))


if __name__ == '__main__':
    unittest.main()
