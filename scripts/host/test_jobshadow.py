#!/usr/bin/env python3
"""Tests for jobshadow-01: the pure rules (scripts/lib/jobrules.py) and the shadow's pure helpers (scripts/host/jobshadow.py).
python3 -B scripts/host/test_jobshadow.py"""
import datetime as dt
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from lib import jobrules as JR  # noqa: E402
import jobshadow as JS  # noqa: E402

M = 60_000
UTC = dt.timezone.utc


def town(active_build='shop', items=None, stock=None, **kw):
    projects = [
        {'plot': 'shop', 'on': True, 'exists': True, 'complete': active_build != 'shop', 'builders': 2},
        {'plot': 'shaft', 'on': True, 'exists': True, 'complete': True, 'builders': 1, 'landings_built': [48, 32, 16]},
        {'plot': 'house1', 'on': True, 'exists': False, 'complete': False, 'after': 'shop', 'builders': 2},
        {'plot': 'tidy', 'on': True, 'exists': True, 'complete': False, 'builders': 1},
    ]
    base = {'iron_ingot': 20, 'raw_iron': 0, 'raw_copper': 0, 'diamond': 5, 'logs': 1500, 'cobblestone': 900}
    base.update(items or {})
    f = {'projects': projects, 'active_build': active_build, 'active': active_build,
         'index': {'ok': True, 'known': 10, 'unknown': 0, 'items': base}, 'stock': stock}
    f.update(kw)
    return f


def bots(n=5, **over):
    out = [{'bot': f'p-{c}', 'seen_min': 1, 'flagged': False, 'at_town': i == 0, 'free_slots': 10}
           for i, c in enumerate(['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'][:n])]
    for b in out:
        b.update(over.get(b['bot'], {}))
    return out


class Latch(unittest.TestCase):
    def test_hysteresis(self):
        self.assertTrue(JR.latch(False, 100, 256, 1000))
        self.assertTrue(JR.latch(True, 500, 256, 1000))      # stays on until TARGET
        self.assertFalse(JR.latch(True, 1000, 256, 1000))
        self.assertFalse(JR.latch(False, 500, 256, 1000))    # does not turn on above LOW

    def test_unknown_keeps_state(self):
        self.assertTrue(JR.latch(True, None, 256, 1000))
        self.assertFalse(JR.latch(False, None, 256, 1000))


class Demand(unittest.TestCase):
    def test_builder_and_quiet_town(self):
        n, _ = JR.demand(town('shop'))
        self.assertTrue(n['builder']['on'])
        self.assertEqual(n['builder']['slots'], 2)
        n, _ = JR.demand(town(None))
        self.assertFalse(n['builder']['on'])

    def test_miner_on_low_cobble_from_flow_stock(self):
        n, lat = JR.demand(town(stock={'cobble': 100, 'logs': 1500}))
        self.assertTrue(n['miner']['on'])
        self.assertIn('cobble', n['miner']['why'])
        # 500 cobble: the latch holds (on below LOW, off at TARGET)
        n, lat = JR.demand(town(stock={'cobble': 500, 'logs': 1500}), lat)
        self.assertTrue(n['miner']['on'])

    def test_unknown_index_is_not_zero(self):
        f = town()
        f['index'] = {'ok': False, 'known': 0, 'items': {}}
        n, lat = JR.demand(f)
        self.assertFalse(n['miner']['on'], 'unknown stock must never read as a shortage')
        self.assertFalse(n['smelter']['on'])

    def test_deep_miner_unsupported_unless_seen(self):
        f = town(items={'iron_ingot': 2})
        n, _ = JR.demand(f, seen={})
        self.assertFalse(n['deep_miner']['on'])
        self.assertFalse(n['deep_miner']['supported'])
        n, _ = JR.demand(f, seen={'deep_miner': True})
        self.assertTrue(n['deep_miner']['on'])

    def test_safety_holds(self):
        n, _ = JR.demand(town(items={'iron_ingot': 2}, deaths_2h=2), seen={'deep_miner': True})
        self.assertFalse(n['deep_miner']['on'])
        self.assertEqual(n['deep_miner']['why'], 'safety_hold')
        n, _ = JR.demand(town(items={'iron_ingot': 2}, stranded_6h=1), seen={'deep_miner': True})
        self.assertFalse(n['deep_miner']['on'])

    def test_groundskeeper_needs_workshop(self):
        n, _ = JR.demand(town('shop'))
        self.assertFalse(n['groundskeeper']['on'])
        n, _ = JR.demand(town('house1'))
        self.assertTrue(n['groundskeeper']['on'])

    def test_smelter_latch(self):
        n, lat = JR.demand(town(items={'raw_iron': 20}))
        self.assertTrue(n['smelter']['on'])
        n, lat = JR.demand(town(items={'raw_iron': 4}), lat)
        self.assertTrue(n['smelter']['on'], 'stays on while anything is left')
        n, lat = JR.demand(town(items={'raw_iron': 0}), lat)
        self.assertFalse(n['smelter']['on'])


def needs_of(**on):
    n = {r: {'on': False, 'slots': 0, 'u0': JR.ROLE[r]['base'], 'why': 'x', 'supported': True} for r in JR.ROLES}
    for r, k in on.items():
        n[r] = {'on': True, 'slots': k, 'u0': JR.ROLE[r]['base'], 'why': 'x', 'supported': True}
    return n


class Assign(unittest.TestCase):
    def test_free_bot_and_primary_cap(self):
        s, st = JR.assign(needs_of(builder=2, miner=1, explorer=1, deep_miner=1, smelter=1), bots(5), {}, 0)
        held = [b for bs in s['roles'].values() for b in bs]
        self.assertEqual(len(held), 4, 'at least one of 5 bots stays free')
        self.assertLessEqual(sum(len(s['roles'].get(r, [])) for r in JR.PRIMARY), JR.PRIMARY_MAX)
        self.assertEqual(len(set(held)), len(held), 'one role per bot')

    def test_flagged_and_stale_not_eligible(self):
        b = bots(5, **{'p-Alpha': {'flagged': True}, 'p-Bravo': {'seen_min': 30}})
        s, _ = JR.assign(needs_of(builder=2), b, {}, 0)
        for r in s['roles'].values():
            self.assertNotIn('p-Alpha', r)
            self.assertNotIn('p-Bravo', r)

    def test_term_then_rest(self):
        n = needs_of(smelter=1)
        s, st = JR.assign(n, bots(5), {}, 0)
        who = s['roles']['smelter'][0]
        s, st = JR.assign(n, bots(5), st, 59 * M)
        self.assertEqual(s['roles']['smelter'], [who])
        s, st = JR.assign(n, bots(5), st, 61 * M)        # term 60 min over
        self.assertNotEqual(s['roles']['smelter'], [who], 'the term ends and another bot takes the duty')
        self.assertIn(('release', 'smelter', who, 'term'), s['events'])
        self.assertIn('smelter', st['rest'][who])

    def test_rest_expires(self):
        b = bots(2)                                   # 1 seat: only Alpha or Bravo
        st = {'rest': {'p-Alpha': {'smelter': 30 * M}, 'p-Bravo': {'smelter': 30 * M}}}
        s, st = JR.assign(needs_of(smelter=1), b, st, 10 * M)
        self.assertNotIn('smelter', s['roles'], 'both resting')
        s, st = JR.assign(needs_of(smelter=1), b, st, 31 * M)
        self.assertIn('smelter', s['roles'], 'the rest ends')

    def test_grace_before_no_work(self):
        s, st = JR.assign(needs_of(smelter=1), bots(5), {}, 0)
        s, st = JR.assign(needs_of(), bots(5), st, 10 * M)
        self.assertIn('smelter', s['roles'], 'kept through the grace')
        s, st = JR.assign(needs_of(), bots(5), st, 31 * M)
        self.assertNotIn('smelter', s['roles'])

    def test_native_holder_wins_and_keeps_past_term(self):
        n = needs_of(deep_miner=1)
        s, st = JR.assign(n, bots(5), {}, 0, native={'deep_miner': ['p-Echo']})
        self.assertEqual(s['roles']['deep_miner'], ['p-Echo'])
        s, st = JR.assign(n, bots(5), st, 200 * M, native={'deep_miner': ['p-Echo']})
        self.assertEqual(s['roles']['deep_miner'], ['p-Echo'], 'a live native lease is never overridden')

    def test_duties_spread_by_hours(self):
        s, _ = JR.assign(needs_of(smelter=1), bots(5), {'hours24': {'p-Alpha': 5, 'p-Bravo': 3, 'p-Comet': 0.5, 'p-Delta': 2, 'p-Echo': 4}}, 0)
        self.assertEqual(s['roles']['smelter'], ['p-Comet'])

    def test_no_role_starves(self):
        # 2 eligible bots -> 1 seat; builder holds it; the farmer waits, then the starvation rule displaces
        b = bots(2)
        n = needs_of(builder=1, farmer=1)
        s, st = JR.assign(n, b, {}, 0)
        self.assertIn('builder', s['roles'])
        self.assertNotIn('farmer', s['roles'])
        t = 0
        while 'farmer' not in s['roles'] and t < 200 * M:
            t += 10 * M
            s, st = JR.assign(n, b, st, t)
        self.assertIn('farmer', s['roles'])
        self.assertLessEqual(t, JR.STARVE * M + 10 * M)

    def test_displacement_needs_two_ticks(self):
        b = bots(2)
        st = {'held': {'farmer': [{'bot': 'p-Alpha', 'term0': 0, 'renew': 0}]}}
        n = needs_of(farmer=1, deep_miner=1)
        n['deep_miner']['u0'] = 90
        s, st = JR.assign(n, b, st, 40 * M)
        self.assertIn('farmer', s['roles'], 'one tick of advantage does not displace')
        s, st = JR.assign(n, b, st, 50 * M)
        self.assertIn('deep_miner', s['roles'])
        self.assertNotIn('farmer', s['roles'])

    def test_native_takes_over_a_rules_holder(self):
        # review r1 (both): a live lease holder takes its role from whoever the rules had named
        n = needs_of(deep_miner=1)
        s, st = JR.assign(n, bots(5), {}, 0)
        first = s['roles']['deep_miner'][0]
        native = [x['bot'] for x in bots(5) if x['bot'] != first][0]
        s, st = JR.assign(n, bots(5), st, 10 * M, native={'deep_miner': [native]})
        self.assertEqual(s['roles']['deep_miner'], [native])
        self.assertIn(('release', 'deep_miner', first, 'native'), s['events'])

    def test_native_leaves_its_other_role(self):
        n = needs_of(builder=2, groundskeeper=1)
        s, st = JR.assign(n, bots(5), {}, 0, native={'groundskeeper': ['p-Alpha']})
        self.assertEqual(s['roles']['groundskeeper'], ['p-Alpha'])
        self.assertNotIn('p-Alpha', s['roles'].get('builder', []))
        st['held'] = {'builder': [{'bot': 'p-Comet', 'term0': 0, 'renew': 0}]}
        s, st = JR.assign(n, bots(5), st, 10 * M, native={'builder': ['p-Comet', 'p-Delta'], 'groundskeeper': ['p-Comet']})
        self.assertEqual(sum(1 for bs in s['roles'].values() for b in bs if b == 'p-Comet'), 1, 'one role per bot even when native twice')

    def test_starving_primary_never_breaks_the_cap(self):
        # review r1 (both): builder x2 + miner held, explorer starving -> a primary is displaced, never a 4th primary
        st = {'held': {'builder': [{'bot': 'p-Bravo', 'term0': 0, 'renew': 0}, {'bot': 'p-Comet', 'term0': 0, 'renew': 0}],
                       'miner': [{'bot': 'p-Alpha', 'term0': 0, 'renew': 0}]}, 'unfilled': {'explorer': 0}}
        n = needs_of(builder=2, miner=1, explorer=1)
        s, st = JR.assign(n, bots(5), st, 130 * M)
        self.assertLessEqual(sum(len(s['roles'].get(r, [])) for r in JR.PRIMARY), JR.PRIMARY_MAX)
        self.assertIn('explorer', s['roles'])

    def test_caps_hold_after_bots_drop_out(self):
        s, st = JR.assign(needs_of(builder=2, smelter=1, farmer=1), bots(5), {}, 0)
        self.assertEqual(sum(len(v) for v in s['roles'].values()), 4)
        b = bots(5, **{'p-Echo': {'seen_min': 30}, 'p-Delta': {'seen_min': 30}})
        s, st = JR.assign(needs_of(builder=2, smelter=1, farmer=1), b, st, 10 * M)
        self.assertLessEqual(sum(len(v) for v in s['roles'].values()), 2, '3 eligible -> 2 seats')

    def test_no_seats_no_roles(self):
        s, _ = JR.assign(needs_of(builder=2), bots(1), {}, 0)
        self.assertEqual(s['roles'], {})


class Mayor(unittest.TestCase):
    def setUp(self):
        self.f = town('house1', projects=None)
        self.f['projects'] = town('house1')['projects'] + [{'plot': 'monument', 'on': True, 'exists': False, 'complete': False, 'after': 'shop'}]
        self.n, _ = JR.demand(self.f)
        self.s, _ = JR.assign(self.n, bots(5), {}, 0)
        self.o = JR.options(self.n, self.s, self.f, bots(5), 0)

    def test_every_option_keeps_the_caps(self):
        for o in self.o['options']:
            self.assertTrue(JR.caps_ok(o['roles']), o)
        self.assertFalse(JR.caps_ok({'builder': ['a', 'b'], 'miner': ['c'], 'explorer': ['d']}))
        # a swap that would make a 4th primary is not offered
        n = needs_of(builder=2, miner=1, farmer=1, deep_miner=1)
        staff = {'roles': {'builder': ['p-Alpha', 'p-Bravo'], 'miner': ['p-Comet'], 'farmer': ['p-Delta']}}
        o = JR.options(n, staff, {'projects': []}, bots(5), 0)
        self.assertFalse(any(x['change'].startswith('swap:') for x in o['options']), o['options'])
        for x in o['options']:
            self.assertTrue(JR.caps_ok(x['roles']), x)
        self.assertFalse(JR.caps_ok({'builder': ['a'], 'smelter': ['a']}))

    def test_opt0_is_the_rules(self):
        self.assertEqual(self.o['options'][0]['roles'], self.s['roles'])
        self.assertLessEqual(len(self.o['options']), 4)
        self.assertIn('monument', self.o['choices']['project_next'])

    def test_fallbacks(self):
        o0 = self.o['options'][0]
        self.assertEqual(JR.validate_pick(None, self.o, 5, 5), (o0, 'no_reply'))
        self.assertEqual(JR.validate_pick({'abstain': True}, self.o, 5, 5)[1], 'abstain')
        self.assertEqual(JR.validate_pick({'gen': 4, 'pick': 'opt1'}, self.o, 5, 5)[1], 'gen')
        self.assertEqual(JR.validate_pick({'gen': 5, 'pick': 'opt9'}, self.o, 5, 5)[1], 'unknown_option')
        self.assertEqual(JR.validate_pick({'gen': 5, 'pick': 'opt0', 'choices': {'project_next': 'castle'}}, self.o, 5, 5)[1], 'unknown_choice')
        last = self.o['options'][-1]
        self.assertEqual(JR.validate_pick({'gen': 5, 'pick': last['id']}, self.o, 5, 5), (last, 'ok'))

    def test_random_same_size(self):
        r = JR.random_staffing(self.s, bots(5), 7)
        self.assertEqual(sorted(len(v) for v in r.values()), sorted(len(v) for v in self.s['roles'].values()))


class Shadow(unittest.TestCase):
    def test_role_of(self):
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=tidy outcome=deadline placed=0 cleared=4 ms=9000', 'success'), ('groundskeeper', 'tidy', True))
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=monument outcome=no_site ms=300', 'no_effect')[0], None)
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=treefarm outcome=complete placed=3', 'x', {'treefarm'})[0], 'farmer')
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=treefarm outcome=complete placed=3', 'x', set())[0], 'builder')
        # review r1: an attempt that moved nothing is an attempt, not coverage; a visit with no counts at all is no work
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=paths outcome=no_tool stop=no_tool placed=0 cleared=0 ms=40000', 'x'), ('builder', 'paths', False))
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=monument outcome=complete ms=129 why=stands', 'x')[0], None)
        self.assertEqual(JS.role_of('_build_visit', {}, 'project=shaft outcome=no_support placed=0 slot=1 ms=24704', 'x')[0], None)
        self.assertEqual(JS.role_of('_expedition', {}, 'op=skip why=no_kit', 'x')[0], None)
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=ore why=diamond n=2', 'x'), ('deep_miner', None, True))
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=error why=x', 'x')[0], None)
        # review r2 (Codex): zero-progress producer rows are attempts
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=branch phase=work why=lava n=0', 'success'), ('deep_miner', None, False))
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=branch phase=work why=len n=12', 'success'), ('deep_miner', None, True))
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=pickaxe why=not_made', 'success'), ('deep_miner', None, False))
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=pickaxe why=made', 'success'), ('deep_miner', None, True))
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=ore why=diamond n=0', 'success')[2], False)
        self.assertEqual(JS.role_of('_expedition', {}, 'op=marker_skip trip=t why=no_spot', 'no_effect'), ('explorer', None, False))
        self.assertEqual(JS.role_of('_expedition', {}, 'op=marker trip=t at=1,2,3', 'success'), ('explorer', None, True))
        # review r3: a stalled deepen and an empty deposit are attempts
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=deepen why=failed n=-40->-40', 'success'), ('deep_miner', None, False))
        self.assertEqual(JS.role_of('_deepmine', {}, 'op=deepen why=success n=16->-12', 'success'), ('deep_miner', None, True))
        self.assertEqual(JS.role_of('_expedition', {}, 'op=deposit items=0 of=0', 'success')[2], False)
        self.assertEqual(JS.role_of('_expedition', {}, 'op=deposit items=12 of=3', 'success')[2], True)
        self.assertEqual(JS.role_of('mine', {}, '', 'failed'), ('miner', None, False))
        self.assertEqual(JS.role_of('mine', {}, '', 'no_effect')[0], None)
        self.assertEqual(JS.role_of('gather', {'block': 'iron_ore'}, '', 'success')[0], 'miner')
        self.assertEqual(JS.role_of('gather', {'block': 'oak_log'}, '', 'success')[0], 'farmer')
        self.assertEqual(JS.role_of('gather', {'block': 'dirt'}, '', 'success')[0], None)
        self.assertEqual(JS.role_of('deep_mine', {}, '', 'success')[0], 'deep_miner')
        self.assertEqual(JS.role_of('smelt_town', {}, '', 'success')[0], 'smelter')
        self.assertEqual(JS.role_of('explore', {}, '', 'success')[0], 'explorer')
        self.assertEqual(JS.role_of('goto', {}, '', 'success')[0], None)

    def _row(self, name, t, bot='p-Alpha', **kw):
        r = {'t': t, 'name': name, 'bot': bot, 'pool': 'p', 'pos': {'x': 0, 'y': 64, 'z': 0}, 'hp': 20, 'inv': {'dirt': 64},
             'args': {}, 'detail': '', 'status': 'success', 'fail_class': None, 'ms': 60_000}
        r.update(kw)
        return r

    def test_bot_facts_flags_and_town(self):
        now = dt.datetime(2026, 11, 3, 5, tzinfo=UTC)
        rows = [self._row('mine', now - dt.timedelta(minutes=3)),
                self._row('_entombed', now - dt.timedelta(minutes=1), pos=None),
                self._row('mine', now - dt.timedelta(minutes=2), bot='p-Bravo', pos={'x': 500, 'y': 64, 'z': 0}),
                self._row('_drowning_route', now - dt.timedelta(minutes=1), bot='p-Bravo', pos=None)]
        b = {x['bot']: x for x in JS.bot_facts(rows, {'x': 0, 'y': 64, 'z': 0}, now)}
        self.assertFalse(b['p-Alpha']['flagged'], 'a routine _entombed reflex is not a flag')
        self.assertTrue(b['p-Alpha']['at_town'])
        self.assertTrue(b['p-Bravo']['flagged'])
        self.assertFalse(b['p-Bravo']['at_town'])
        self.assertEqual(b['p-Alpha']['free_slots'], 35)

    def test_evaluate_and_summary(self):
        now = dt.datetime(2026, 11, 3, 5, tzinfo=UTC)
        t0 = now - dt.timedelta(minutes=40)
        spans = JS.work_spans([self._row('mine', t0 + dt.timedelta(minutes=5))], set())
        pend = [{'t': t0.isoformat().replace('+00:00', 'Z'), 'roles': {'miner': ['p-Alpha']}, 'random': {'miner': ['p-Bravo']}},
                {'t': (now - dt.timedelta(minutes=5)).isoformat().replace('+00:00', 'Z'), 'roles': {}, 'random': {}},
                {'t': (now - dt.timedelta(minutes=200)).isoformat().replace('+00:00', 'Z'), 'roles': {}, 'random': {}}]
        ev, keep, lost = JS.evaluate('p', pend, spans, now, now - dt.timedelta(minutes=70))
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]['roles'], {'n': 1, 'hit': 1})
        self.assertEqual(ev[0]['random'], {'n': 1, 'hit': 0})
        self.assertEqual(len(keep), 1)
        self.assertEqual(lost, 1)
        tick = {'kind': 'tick', 'pool': 'p', 'ts': 'x', 'needs': {'miner': {'on': True, 'supported': True}, 'clerk': {'on': False, 'supported': False}},
                'cover': {'miner': False}, 'tried': {'miner': True}, 'events': [['take', 'miner', 'p-Alpha', 'x']], 'roles': {'miner': ['p-Alpha']}, 'actual': {}}
        run = {'kind': 'run', 'ok': True, 'ts': 'x', 'expected': ['p']}
        s = JS.summarize([tick] * 6 + [run] * 6 + ev)
        self.assertEqual(s['roles']['miner']['tried_ticks'], 6)
        self.assertEqual(s['roles']['miner']['need_ticks'], 6)
        self.assertEqual(s['roles']['miner']['coverage'], 0.0)
        self.assertEqual(s['roles']['miner']['gap_towns'], ['p'])
        self.assertEqual(s['roles']['clerk']['unsupported_ticks'], 6)
        self.assertEqual(s['concordance']['roles']['share'], 1.0)
        self.assertEqual(s['valid_share'], 1.0)
        # review r1: a failed run and a town missing from the rows count against validity (the expected schedule)
        bad = {'kind': 'run', 'ok': False, 'ts': 'x', 'expected': ['p', 'q']}
        s = JS.summarize([tick] * 6 + [run] * 6 + [bad] * 2)
        self.assertEqual(s['expected_town_ticks'], 10)
        self.assertEqual(s['valid_share'], 0.6)
        self.assertEqual(s['error_runs'], 2)
        self.assertFalse(s['go']['valid_ok'])
        # review r2 (Claude): runs that left NO row (a crash outside the try, flock skipped, cron silent) are missed by the
        # schedule: 2 runs written 60 min apart -> 7 scheduled runs x 16 towns expected
        t0 = dt.datetime(2026, 11, 3, 5, tzinfo=UTC)
        iso = lambda t: t.isoformat().replace('+00:00', 'Z')
        runs = [{'kind': 'run', 'ok': True, 'ts': iso(t0), 'expected': list(JS.EXPECTED_POOLS)},
                {'kind': 'run', 'ok': True, 'ts': iso(t0 + dt.timedelta(minutes=60)), 'expected': list(JS.EXPECTED_POOLS)}]
        s = JS.summarize([tick] * 32 + runs, hours=1, now=t0 + dt.timedelta(minutes=60))
        self.assertEqual(s['expected_town_ticks'], 7 * 16)
        self.assertFalse(s['go']['valid_ok'])
        # review r3: runs that survive only at the END of a 24-h window do not shrink the schedule (it starts at the window or
        # at the first run ever, whichever is later)
        late = [{'kind': 'run', 'ok': True, 'ts': iso(t0 + dt.timedelta(hours=23, minutes=10 * k)), 'expected': list(JS.EXPECTED_POOLS)} for k in range(6)]
        s = JS.summarize([tick] * 96 + late, hours=24, now=t0 + dt.timedelta(hours=24), first_run=t0 - dt.timedelta(days=2))
        self.assertGreaterEqual(s['expected_town_ticks'], 144 * 16)
        s = JS.summarize([tick] * 96 + late, hours=24, now=t0 + dt.timedelta(hours=24), first_run=t0 + dt.timedelta(hours=23))
        self.assertEqual(s['expected_town_ticks'], 7 * 16, 'a shadow 1 h old is judged on its own hour')

    def test_planned_rotation_is_not_churn(self):
        # review r1 (Claude B1): one steady need for 24 h passes the churn gate -- term rotations are planned, not churn
        st, rows, now = {}, [], 0
        b = bots(5)
        for k in range(144):
            sf, st = JR.assign(needs_of(builder=2, miner=1, farmer=1, smelter=1), b, st, now)
            rows.append({'kind': 'tick', 'pool': 'p', 'ts': 'x', 'needs': {}, 'cover': {}, 'events': [list(e) for e in sf['events']],
                         'roles': sf['roles'], 'actual': {}})
            now += 10 * M
        s = JS.summarize(rows)
        self.assertGreater(s['churn_per_town_hour'], 1.0, 'positive control: the rotations are there')
        self.assertTrue(s['go']['churn_ok'], s['unplanned_releases_per_town_hour'])

    def test_native_holders(self):
        f = {'active_build': 'shop', 'leases': {'shop.slot1': {'live': True, 'holder': 'a'}, 'house1.slot1': {'live': True, 'holder': 'b'},
                                                 'deepmine.slot1': {'live': False, 'holder': 'c'}, 'tidy.keeper': {'live': True, 'holder': 'd'}}}
        self.assertEqual(JS.native_holders(f), {'builder': ['a'], 'groundskeeper': ['d']})

    def test_seen(self):
        now = dt.datetime(2026, 11, 3, 5, tzinfo=UTC)
        s = JS.seen_update({}, [self._row('_deepmine_mode', now, detail='on=0 slots=1'), self._row('_expedition', now)], now)
        self.assertEqual(set(s['p']), {'explorer'})
        s = JS.seen_update({'q': {'explorer': (now - dt.timedelta(hours=30)).isoformat()}}, [], now)
        self.assertEqual(s['q'], {})


MUTANTS = [   # (file, anchor, replacement): each must make the suite FAIL; the anchor must be present and unique
    ('lib/jobrules.py', 'FREE_MIN = 1 ', 'FREE_MIN = 0 '),
    ('lib/jobrules.py', 'GRACE = 20 ', 'GRACE = 0 '),
    ('lib/jobrules.py', 'if u > now}', 'if u > -1}'),
    ('lib/jobrules.py', '            prim_full = role in PRIMARY and prim >= PRIMARY_MAX', '            prim_full = False'),
    ('lib/jobrules.py', "            if h['bot'] not in nb:\n                release(role, h, 'native', 0)", "            if False:\n                pass"),
    ('lib/jobrules.py', "        if caps_ok(r2):", "        if True:"),
    ('host/jobshadow.py', "    valid = round(len(ticks) / expected, 3) if expected else None", "    valid = 1.0"),
    ('host/jobshadow.py', "        expected = max(expected, (int(span // RUN_EVERY_MIN) + 1) * len(EXPECTED_POOLS))", "        pass"),
    ('host/jobshadow.py', "        return _num(det, 'n') > 0", "        return True"),
    ('host/jobshadow.py', "        return bool(m) and int(m.group(2)) < int(m.group(1))", "        return True"),
    ('host/jobshadow.py', "            start = now - dt.timedelta(hours=hours)", "            start = tss[0]"),
    ('host/jobshadow.py', "        prog = sum(int(v) for _, v in counts) > 0", "        prog = True"),
    ('lib/jobrules.py', "                    if st['displace'][role] >= DISPLACE_TICKS or starving:", '                    if True:'),
    ('lib/jobrules.py', "        return on\n    if on:", "        return False\n    if on:"),
    ('lib/jobrules.py', "            if h['bot'] in native.get(role, ()):\n                continue", "            if False:\n                continue"),
    ('lib/jobrules.py', "    if pick is None:\n        return opt0, 'unknown_option'", "    if pick is None:\n        pick = opt0"),
    ('host/jobshadow.py', "FLAG_RE = re.compile(r'(^_?death$|drown|trapped|unrecoverable|suffocat)', re.I)",
     "FLAG_RE = re.compile(r'(death|drown|trap|entomb|suffocat)', re.I)"),
    ('host/jobshadow.py', "        if not m or (o and o.group(1) in NO_WORK) or not counts:", "        if not m or not counts:"),
]


def run_mutants():
    import shutil
    import subprocess
    import tempfile
    root = os.path.join(HERE, '..')
    killed = 0
    for f, old, new in MUTANTS:
        d = tempfile.mkdtemp(prefix='jsmut-')
        try:
            shutil.copytree(os.path.join(root, 'lib'), os.path.join(d, 'lib'))
            os.makedirs(os.path.join(d, 'host'))
            for x in ('jobshadow.py', 'test_jobshadow.py'):
                shutil.copy(os.path.join(HERE, x), os.path.join(d, 'host', x))
            p = os.path.join(d, f)
            src = open(p).read()
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {f}: {old[:60]}'
            open(p, 'w').write(src.replace(old, new))
            r = subprocess.run([sys.executable, '-B', os.path.join(d, 'host', 'test_jobshadow.py'), '--no-mutants'],
                               capture_output=True, text=True, timeout=120)
            if r.returncode != 0:
                killed += 1
            else:
                print(f'SURVIVED: {f}: {old[:70]}')
        finally:
            shutil.rmtree(d, ignore_errors=True)
    print(f'mutants killed {killed}/{len(MUTANTS)}')
    return killed == len(MUTANTS)


if __name__ == '__main__':
    no_mut = '--no-mutants' in sys.argv
    argv = [a for a in sys.argv if a != '--no-mutants']
    res = unittest.main(argv=argv, exit=False).result
    ok = res.wasSuccessful()
    print('tests passed' if ok else 'tests FAILED')
    if ok and not no_mut:
        ok = run_mutants()
    sys.exit(0 if ok else 1)
