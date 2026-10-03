"""Fourth-pass review fixes on 9cad2ad (Claude + Codex, 2026-10-03): an injected-clock eviction test, mayor
revisions (stamped, partitioned, --since/--until, legacy world-scope wood), and the GET_WOOD scorer biases
(contested x random, eligible base rate, shortage relief, lease-matched baselines). The mutant gate is in
test_mutants.MutantGate. Each test here was run against 9cad2ad first and failed (or could not run)."""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mayor_core as core  # noqa: E402
import mayor_shadow  # noqa: E402
import mayor_score  # noqa: E402
import mayor_frontier  # noqa: E402
import wood_replay  # noqa: E402
from checks import T0, make_bot, snap_of, log_at, BARE, tools_pick  # noqa: E402

M = 60000
H = 60 * M


def ts(ms):
    return core.iso(ms).replace('Z', '.000Z')


def state_row(name, t, inv=None, pos=(0, 0)):
    return {'@timestamp': ts(t), 'exp': {'pool': 'w'},
            'bot': {'name': name, 'pos': {'x': pos[0], 'y': 64, 'z': pos[1]}, 'inventory': inv if inv is not None else BARE,
                    'tools': {}},
            'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 0}}


# ---------------------------------------------------------------- 2. the clock ------

class InjectedClock(unittest.TestCase):
    """Eviction reads the SNAPSHOT clock: the data clock under --now-from-data, the (injected) wall
    clock live. No test here depends on today's date: every time is T0 + an offset."""

    def shadow(self, d, rows_by_bot, *flags):
        for name, times in rows_by_bot.items():
            os.makedirs(os.path.join(d, 'logs', name), exist_ok=True)
            with open(os.path.join(d, 'logs', name, 'skill-%s.jsonl' % name), 'w') as f:
                for t in times:
                    f.write(json.dumps(state_row(name, t)) + '\n')
        args = mayor_shadow.parser().parse_args(['--logs', os.path.join(d, 'logs', '*', 'skill-*.jsonl'), '--nice', '0',
                                                 '--facts-root', d, '--out-dir', os.path.join(d, 'out'),
                                                 '--allow-out-root', d, '--evict-bot-h', '6'] + list(flags))
        return mayor_shadow.Shadow(args)

    def test_now_from_data_keeps_a_slice_older_than_the_eviction_window(self):
        d = tempfile.mkdtemp()
        try:
            sh = self.shadow(d, {'w-A': [T0], 'w-B': [T0]}, '--now-from-data')
            tick = sh.tick(T0 + 7 * H)                     # the wall clock is 7 h past every row
            self.assertEqual(sorted(sh.bots), ['w-A', 'w-B'])
            self.assertEqual(tick['t'], core.iso(T0), 'the snapshot clock is the newest row')
            with open(os.path.join(d, 'out', 'snap-w.jsonl')) as f:
                self.assertEqual(len(json.loads(f.readline())['bots']), 2)
        finally:
            shutil.rmtree(d)

    def test_now_from_data_evicts_a_bot_7h_behind_the_newest_row(self):
        d = tempfile.mkdtemp()
        try:
            sh = self.shadow(d, {'w-A': [T0], 'w-B': [T0 + 7 * H]}, '--now-from-data')
            sh.tick(T0 + 7 * H + 1000)
            self.assertEqual(sorted(sh.bots), ['w-B'], 'A is 7 h behind the data clock (> 6 h)')
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:
            sh = self.shadow(d, {'w-A': [T0 + 2 * H], 'w-B': [T0 + 7 * H]}, '--now-from-data')
            sh.tick(T0 + 7 * H + 1000)
            self.assertEqual(sorted(sh.bots), ['w-A', 'w-B'], 'control: 5 h behind is kept')
        finally:
            shutil.rmtree(d)

    def test_live_mode_evicts_by_the_wall_clock(self):
        d = tempfile.mkdtemp()
        try:
            sh = self.shadow(d, {'w-A': [T0]})
            sh.tick(T0 + 1000)
            self.assertEqual(sorted(sh.bots), ['w-A'], 'control: heard 1 s ago')
            sh.tick(T0 + 7 * H)
            self.assertEqual(sorted(sh.bots), [], 'live: silent 7 h by the wall clock is evicted')
        finally:
            shutil.rmtree(d)


# ---------------------------------------------------------------- 4. revisions ------

class Revisions(unittest.TestCase):
    def test_every_snapshot_and_record_is_stamped(self):
        self.assertRegex(core.MAYOR_REV, r'^[0-9a-f]{12}$')
        s = snap_of(core, [make_bot(core, 'A', (100, 64, 100), BARE, {})], [log_at(110, 64, 100)])
        self.assertEqual(s['mayor_rev'], core.MAYOR_REV)
        rec, _ = core.decide(s, None)
        self.assertEqual(rec['mayor_rev'], core.MAYOR_REV)
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
                f.write(json.dumps(dict(s, mayor_rev='abc123abc123')) + '\n')
            with redirect_stdout(io.StringIO()):
                mayor_frontier.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--det', os.path.join(d, 'x-*'),
                                     '--out-dir', os.path.join(d, 'out'), '--allow-out-root', d, '--dry-run',
                                     '--engine', 'claude'])
            with open(os.path.join(d, 'out', 'assign-claude-w.jsonl')) as f:
                self.assertEqual(json.loads(f.readline())['mayor_rev'], 'abc123abc123',
                                 'a frontier record carries the revision of the snapshot it answered')
        finally:
            shutil.rmtree(d)

    def test_the_revision_follows_the_code(self):
        here = os.path.dirname(os.path.abspath(core.__file__))
        self.assertEqual(core.rev_of_dir(here), core.MAYOR_REV)
        d = tempfile.mkdtemp()
        try:
            for f in ('mayor_core.py', 'mayor_shadow.py', 'stack_sizes.json'):
                shutil.copy(os.path.join(here, f), d)
            self.assertEqual(core.rev_of_dir(d), core.MAYOR_REV, 'control: the same code, the same revision')
            with open(os.path.join(d, 'mayor_core.py'), 'a') as f:
                f.write('\n# a change\n')
            self.assertNotEqual(core.rev_of_dir(d), core.MAYOR_REV)
        finally:
            shutil.rmtree(d)

    def test_a_legacy_world_scope_wood_shortage_is_unknown_per_bot(self):
        a = make_bot(core, 'A', (0, 64, 0), BARE, {})
        s = snap_of(core, [a], [])
        self.assertTrue(mayor_score.need_holds('GET_WOOD', 'A', s), 'control: the per-bot shortage holds')
        legacy = dict(s, shortages=[{'id': 'S1', 'duty': 'GET_WOOD', 'scope': 'world', 'bot': None}])
        self.assertIsNone(mayor_score.need_holds('GET_WOOD', 'A', legacy),
                          'a 111dadc world-scope GET_WOOD says nothing about THIS bot')
        iron = dict(s, shortages=[{'id': 'S1', 'duty': 'GET_IRON', 'scope': 'world', 'bot': None}])
        self.assertTrue(mayor_score.need_holds('GET_IRON', 'A', iron), 'control: a world duty still reads world scope')


# ---------------------------------------------------------------- scorer timelines ---

def timeline(d, bots, logs, rev_at=None, records=True, k_max=60):
    """Snapshots every 5 min (0..k_max), state rows every 2 min to +94. bots = [(name, x, gather_at|None, kind)]
    where kind 'log' gains one oak_log, 'planks' picks up 12 planks (relief without a log).
    rev_at = (k, rev_before, rev_after) stamps two revisions. The deterministic mayor's own records at k=0."""
    def inv(kind, k, at):
        if at is None or k < at:
            return BARE
        return dict(BARE, oak_log=1) if kind == 'log' else dict(BARE, oak_planks=12)
    snaps = []
    for k in range(0, k_max + 1, 5):
        views = [make_bot(core, n, (x, 64, 100), inv(kind, k, at), {}) for n, x, at, kind in bots]
        s = snap_of(core, views, logs)
        s['t_ms'] = T0 + k * M
        s['t'] = core.iso(s['t_ms'])
        s['snap_id'] = 'w@%s' % s['t']
        if rev_at:
            s['mayor_rev'] = rev_at[1] if k < rev_at[0] else rev_at[2]
        snaps.append(s)
    with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
        for s in snaps:
            f.write(json.dumps(s) + '\n')
    with open(os.path.join(d, 'assign-w.jsonl'), 'w') as f:
        if records:
            rec, _ = core.decide(snaps[0], None)
            f.write(json.dumps(rec) + '\n')
    os.makedirs(os.path.join(d, 'logs'))
    with open(os.path.join(d, 'logs', 'skill-w.jsonl'), 'w') as f:
        for k in range(0, 95, 2):
            for n, x, at, kind in bots:
                f.write(json.dumps(state_row(n, T0 + k * M, inv(kind, k, at), (x, 100))) + '\n')
    return snaps


def score(d, *extra):
    js = os.path.join(d, 'out.json')
    with redirect_stdout(io.StringIO()) as buf:
        rc = mayor_score.main(['--snaps', os.path.join(d, 'snap-*.jsonl'), '--assign', os.path.join(d, 'assign-*.jsonl'),
                               '--logs', os.path.join(d, 'logs', '*.jsonl'), '--json', js, '--allow-out-root', d,
                               '--allow-zero'] + list(extra))
    if rc not in (0, 4):
        return rc, None, buf.getvalue()
    with open(js) as f:
        return rc, json.load(f), buf.getvalue()


TWO = [('w-A', 100, 10, 'log'), ('w-B', 105, None, 'log')]
LOGS2 = [log_at(110, 64, 100), log_at(112, 64, 100)]


class RevisionScoring(unittest.TestCase):
    def test_two_revisions_are_scored_apart(self):
        d = tempfile.mkdtemp()
        try:
            timeline(d, TWO, LOGS2)
            rc, r, _ = score(d)
            self.assertEqual(list(r['revisions']), [core.MAYOR_REV])
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['persist30_n'], 2, 'control: one revision, +30 is in the same partition')
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:
            timeline(d, TWO, LOGS2, rev_at=(20, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'))
            rc, r, text = score(d)
            self.assertEqual(sorted(r['revisions']), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
            self.assertNotIn('engines', r, 'two revisions: no pooled top-level view')
            self.assertEqual((r['revisions']['aaaaaaaaaaaa']['snapshots'], r['revisions']['bbbbbbbbbbbb']['snapshots']), (4, 9))
            m = r['revisions']['aaaaaaaaaaaa']['engines']['deterministic']['GET_WOOD']
            self.assertEqual(m['persist30_n'], 0, 'the +30 snapshot belongs to ANOTHER revision: never read')
            self.assertNotIn('deterministic', r['revisions']['bbbbbbbbbbbb']['engines'], 'the k=0 records stay in their revision')
            self.assertIn('REVISION aaaaaaaaaaaa', text)
        finally:
            shutil.rmtree(d)

    def test_since_and_until_select_snapshots(self):
        d = tempfile.mkdtemp()
        try:
            timeline(d, TWO, LOGS2)
            _, r, _ = score(d)
            self.assertEqual(r['controls']['snapshots'], 13, 'control: all 13')
            _, r, _ = score(d, '--since', core.iso(T0 + 20 * M))
            self.assertEqual(r['controls']['snapshots'], 9)
            self.assertNotIn('deterministic', r['engines'], 'the k=0 proposals are before --since')
            _, r, _ = score(d, '--until', core.iso(T0 + 20 * M))
            self.assertEqual(r['controls']['snapshots'], 5)
            rc, _, _ = score(d, '--since', 'yesterday')
            self.assertEqual(rc, 2, 'an unparseable bound is refused, never ignored')
        finally:
            shutil.rmtree(d)


# ---------------------------------------------------------------- 5. GET_WOOD biases -

class WoodScoringBiases(unittest.TestCase):
    def test_x_random_only_on_contested_snapshots(self):
        d = tempfile.mkdtemp()
        try:                     # three short bots, cap 2: contested. A and C gather at +10, B never does.
            three = [('w-A', 100, 10, 'log'), ('w-B', 104, None, 'log'), ('w-C', 108, 10, 'log')]
            timeline(d, three, [log_at(110, 64, 100), log_at(112, 64, 100), log_at(114, 64, 100)])
            _, r, _ = score(d)
            eng = r['engines']
            m, rnd = eng['deterministic']['GET_WOOD'], eng['random']['GET_WOOD']
            self.assertGreater(m['downstream_c_n'], 0)
            self.assertGreater(rnd['downstream_c_n'], 0)
            dc, rr = m['downstream_c'] / m['downstream_c_n'], rnd['downstream_c'] / rnd['downstream_c_n']
            self.assertNotEqual(rr, 1.0, 'precondition: the ratio differs from the raw rate')
            self.assertAlmostEqual(m['x_random'], dc / rr)
        finally:
            shutil.rmtree(d)
        d = tempfile.mkdtemp()
        try:                     # two short bots, cap 2: never contested -> no x random at all
            timeline(d, TWO, LOGS2)
            _, r, _ = score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertGreater(m['downstream_n'], 0, 'control: there IS a downstream rate')
            self.assertEqual(m['downstream_c_n'], 0)
            self.assertIsNone(m['x_random'])
        finally:
            shutil.rmtree(d)

    def test_base_rate_is_also_restricted_to_eligible_short_bots(self):
        cfg = core.DEFAULTS
        near = make_bot(core, 'w-A', (100, 64, 100), BARE, {})
        far = make_bot(core, 'w-B', (400, 64, 100), BARE, {})            # short, but no log within 64
        s = snap_of(core, [near, far], [log_at(110, 64, 100)])
        tel = {n: [mayor_score.compact({'inventory': BARE, 'tools': {}, 'pos': {'x': x, 'y': 64, 'z': 100}}, T0 + k * M, cfg)
                   for k in range(0, 40, 2)] for n, x in (('w-A', 100), ('w-B', 400))}
        acc = {dd: [0, 0] for dd in core.DUTIES}
        elig = {dd: [0, 0] for dd in core.DUTIES}
        mayor_score.base_rates([s], tel, T0 + 40 * M, cfg, acc, elig)
        self.assertEqual(acc['GET_WOOD'], [0, 2], 'control: both short bots were observed')
        self.assertEqual(elig['GET_WOOD'], [0, 1], 'only A could have been assigned')

    def test_relief_counts_planks_and_logs_gained_is_its_own_metric(self):
        cfg = core.DEFAULTS
        base = {'logs': 0, 'slots_est': 2, 'iron_units': 0}

        def row(inv, tools=None):
            return mayor_score.compact({'inventory': inv, 'tools': {} if tools is None else tools,
                                        'pos': {'x': 0, 'y': 64, 'z': 0}}, T0, cfg)
        planks = row(dict(BARE, oak_planks=12))
        self.assertIs(planks[mayor_score.WOOD_SHORT], False)
        self.assertTrue(mayor_score.outcome('GET_WOOD', base, [planks], cfg), 'planks picked up: relieved')
        self.assertFalse(mayor_score.logs_gained(base, [planks]), 'but no log was gathered')
        self.assertFalse(mayor_score.outcome('GET_WOOD', base, [row(BARE)], cfg), 'control: still short, nothing gained')
        unknown = mayor_score.compact({'inventory': {'stone_pickaxe': 1}, 'pos': {'x': 0, 'y': 64, 'z': 0}}, T0, cfg)
        self.assertIsNone(unknown[mayor_score.WOOD_SHORT])
        self.assertFalse(mayor_score.outcome('GET_WOOD', base, [unknown], cfg), 'an unknown pickaxe is not relief')
        d = tempfile.mkdtemp()
        try:                     # A picks up planks at +10 and never gathers a log
            timeline(d, [('w-A', 100, 10, 'planks'), ('w-B', 105, None, 'log')], LOGS2)
            _, r, text = score(d)
            m = r['engines']['deterministic']['GET_WOOD']
            self.assertEqual((m['concord'], m['concord_n']), (1, 2), 'A relieved by planks')
            self.assertEqual(m['logs30'], 0, 'and logs gained says so separately')
            self.assertIn('logs gained, its own metric: 0 of 2', text)
        finally:
            shutil.rmtree(d)

    def test_baselines_carry_the_mayors_lease_memory(self):
        d = tempfile.mkdtemp()
        try:                     # one short bot that never gathers: lease 10 min, expire, cool 15, re-offer
            snaps = timeline(d, [('w-A', 100, None, 'log')], [log_at(110, 64, 100)], records=False)
            state, want = None, 0
            for s in snaps:
                rec, state = core.decide(s, state)
                want += sum(a['lease'] == 'new' for a in rec['assignments'])
            _, r, _ = score(d)
            eng = r['engines']
            self.assertEqual(want, 3, 'control: the mayor proposes at 0, 25 and 50')
            self.assertEqual(eng['random']['GET_WOOD']['n'], want, 'random runs through the same leases')
            self.assertEqual(eng['nearest']['GET_WOOD']['n'], want)
            self.assertEqual(eng['random-stateless']['GET_WOOD']['n'], len(snaps), 'the stateless one proposes every tick')
        finally:
            shutil.rmtree(d)


# ---------------------------------------------------------------- 3. wood_replay ----

class WoodReplay(unittest.TestCase):
    def test_replays_recorded_snapshots_by_revision(self):
        d = tempfile.mkdtemp()
        try:
            rich = make_bot(core, 'R', (0, 64, 0), {'oak_log': 64}, tools_pick('stone_pickaxe', 10, 131))
            poor = [make_bot(core, n, (100 + 4 * i, 64, 100), BARE, {}) for i, n in enumerate('BC')]
            s = snap_of(core, [rich] + poor, [log_at(110, 64, 100), log_at(112, 64, 100)])
            legacy = dict(s, shortages=[{'id': 'S1', 'duty': 'GET_WOOD', 'scope': 'world', 'bot': None}])
            legacy.pop('mayor_rev')
            with open(os.path.join(d, 'snap-w.jsonl'), 'w') as f:
                f.write(json.dumps(s) + '\n' + json.dumps(legacy) + '\nnot json\n')
            with redirect_stdout(io.StringIO()) as buf:
                rc = wood_replay.main(['--snaps', os.path.join(d, 'snap-*.jsonl')])
            self.assertEqual(rc, 0)
            out = json.loads(buf.getvalue())
            cur, old = out['by_recorded_rev'][core.MAYOR_REV], out['by_recorded_rev']['unstamped']
            self.assertEqual((cur['per_bot_wood_shortages'], cur['old_world_rule_fired']), (2, 0))
            self.assertEqual((old['old_world_rule_fired'], old['new_rule_fired']), (1, 1))
            self.assertEqual(cur['restore_pick_vs_wood_disagreements'] + old['restore_pick_vs_wood_disagreements'], 0)
            self.assertEqual(out['unreadable_lines'], 1)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(wood_replay.main(['--snaps', os.path.join(d, 'none-*.jsonl')]), 2, 'nothing matched is not a zero')
        finally:
            shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
