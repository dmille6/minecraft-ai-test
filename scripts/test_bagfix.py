#!/usr/bin/env python3
"""v33 -- the BAG-FIX death rule (OWNER DECISION 2026-10-07). Behaviour, end to end, and mutants.

  1. bagfixrule.py, the pure decisions and the value measure, on behaviour.
  2. bagfixgate.py driven as the loop drives it (a subprocess, its own stdout contract) over FIXTURE logs: extend-check,
     poll and final, each seen to say EXTEND/CONTINUE/KEEP and seen to say REVERT/UNREADABLE/INCONCLUSIVE.
  3. verdict.py's v33 half: the death-gate REVERT carries by=death_gate and its counts; --bagfix-extended demotes it
     only for a bag fix whose extension the journal records. Uses test_verdict_acceptance's Case harness (needs the host
     lib's version_split.in_canary_pool: off the host these cases are reported SKIPPED, loudly).
  4. canarywatch.deadline_for honours a recorded extension and nothing else.
  5. MUTANTS: each applied to a COPY (anchor asserted present and unique), and the cases above must fail under it.

Run: python3 scripts/test_bagfix.py        (exit 0 = all pass; SKIPPED cases are listed and are not passes)
"""
import os, sys, json, tempfile, subprocess, shutil, importlib.util, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
T = []; SKIP = []


def t(name, ok, detail=''):
    T.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + ('' if ok or not detail else f"\n        -> {str(detail)[-700:]}"))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


from deathgate import ratio_lower_bound


# ------------------------------------------------------------------------------------------------ 1. pure
def pure_cases(BR):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    bv = BR.bag_value
    near = lambda a, b: abs(a - b) < 1e-9
    c('junk, ballast and decorations score 0 (owner junk list + junk well list + dirt)',
      bv({'egg': 16, 'flint': 12, 'glass': 6, 'dirt': 64, 'oak_button': 1, 'pointed_dripstone': 15, 'bone_meal': 10}) == 0)
    c('cobble: 0.1 each up to the 64 reserve, 0 above it', near(bv({'cobblestone': 10}), 1.0) and near(bv({'cobblestone': 200}), 6.4),
      bv({'cobblestone': 200}))
    c('cobble reserve is shared by the family', near(bv({'cobblestone': 40, 'cobbled_deepslate': 40}), 6.4))
    c('logs count fully up to one stack', bv({'oak_log': 50}) == 50 and bv({'oak_log': 100}) == 64)
    c('planks 1/4 and sticks 1/8 of a log', bv({'oak_planks': 8, 'stick': 8}) == 3.0)
    c('saplings up to the 16 reserve', bv({'oak_sapling': 9, 'birch_sapling': 11}) == 16)
    c('iron counts fully, uncapped (raw 10, nuggets 10/9)', near(bv({'raw_iron': 3}), 30) and near(bv({'iron_ingot': 2, 'iron_nugget': 9}), 30))
    c('a usable iron pickaxe = its materials (3 ingots + 2 sticks); a spent one 0',
      near(bv({'iron_pickaxe': 1}, {'iron_pickaxe': [{'used': 240, 'max': 250}]}), 30.25)
      and bv({'iron_pickaxe': 1}, {'iron_pickaxe': [{'used': 250, 'max': 250}]}) == 0)
    c('every usable copy counts (crafting conserves): 3 usable + 1 spent stone pickaxes = 3 x 0.55',
      near(bv({'stone_pickaxe': 4}, {'stone_pickaxe': [{'used': 1, 'max': 131}] * 3 + [{'used': 131, 'max': 131}]}), 1.65))
    c('crafting conserves: 3 ingots + 2 sticks == one iron pickaxe',
      near(bv({'iron_ingot': 3, 'stick': 2}), bv({'iron_pickaxe': 1}, {'iron_pickaxe': [{'used': 0, 'max': 250}]})))
    c('kit caps: chests 2; buckets per copy at 3 ingots', bv({'chest': 5}) == 4.0 and bv({'bucket': 2}) == 60.0)
    c('coal capped at 32', bv({'coal': 100}) == 32)
    vd = BR.value_delta
    c('value_delta: a step is SIGNED (consumption and wear are output lost)', vd(10, 15, 'gather', 'gather') == 5 and vd(10, 5, 'gather', 'gather') == -5)
    c('value_delta: transfers by prefix -- skill rows AND the events that carry the post-transfer bag',
      all(vd(10, 50, k, 'gather') == 0 for k in ('withdraw', 'withdraw_pick', '_withdraw_pick', '_withdraw_settled', 'deposit',
                                                  'deposit_surplus', '_deposit_cursor_rescue', 'town_deposit', '_town_deposit')))
    c('value_delta: a death row, and the respawn step after it, are never output; no previous snapshot -> 0',
      vd(10, 50, '_death', 'gather') == 0 and vd(50, 0, 'gather', '_death') == 0 and vd(None, 50, 'gather', None) == 0)
    acc = lambda obs: list(BR.accumulate(obs))
    a = acc([(0, 'gather', 5.0, 0.0), (60, 'place', 4.0, 0.0), (120, '_table_retaken', 5.0, 0.0), (180, 'gather', 5.0, 0.0)])
    c('accumulate: a table placed and retaken nets to 0 (round 1: the retake used to count)', near(sum(x[2] for x in a), 0.0), a)
    a = acc([(0, 'gather', 10.0, 1.0), (60, '_death', 30.0, 2.0), (61, 'gather', 0.0, 0.0), (120, 'gather', 4.0, 0.0)])
    c('accumulate: the bag at death is counted once as lost, the respawn emptying is not output',
      near(sum(x[2] for x in a), 4.0) and near(sum(x[4] for x in a), 30.0) and sum(x[6] for x in a) == 1, a)
    a = acc([(0, 'gather', 10.0, 0.0), (60, 'goto', None, None), (300, 'gather', 15.0, 0.0)])
    c('accumulate: rows without a bag carry the previous snapshot; bot-seconds capped at 120 s',
      near(sum(x[2] for x in a), 5.0) and near(sum(x[1] for x in a), 180.0) and sum(x[8] for x in a) == 2, a)
    ob = BR.to_obs([(0, 'gather', 10, 5.0, 0.0), (20, 'deposit', 30, 2.0, 0.0), (35, '_deposit_cursor_rescue', 0, 1.0, 0.0),
                    (40, '_inventory_mutation', 0, 9.0, 0.0), (60, 'gather', 5, 3.0, 0.0), (70, '', 0, 99.0, 0.0)])
    c('to_obs: skill snapshots re-timed to their END; an event INSIDE a transfer interval is a transfer; no-kind rows dropped',
      [o[0] for o in ob] == [10, 35, 40, 50, 65] and BR.is_transfer(ob[1][1]) and ob[2][1] == BR.TRANSFER_INTERVAL
      and ob[3][1] == 'deposit' and len(ob) == 5, ob)
    a = acc(ob)
    c('to_obs + accumulate: the deposit\'s events do not count as output (round 2: they carried the transfer delta)',
      near(sum(x[2] for x in a), 3.0 - 2.0), a)
    ob = BR.to_obs([(0, 'gather', 10, 50.0, 0.0), (20, 'deposit', 100, 0.0, 0.0), (60, '_death', 0, 50.0, 0.0),
                    (70, '_inventory_mutation', 0, 0.0, 0.0), (130, 'gather', 5, 5.0, 0.0)])
    a = acc(ob)
    c('to_obs: a death INSIDE a deposit stays a death (its bag is lost), and the interval ends there (round 3)',
      [o[1] for o in ob] == ['gather', '_death', '_inventory_mutation', 'deposit', 'gather']
      and near(sum(x[4] for x in a), 50.0) and sum(x[6] for x in a) == 1 and near(sum(x[2] for x in a) - sum(x[4] for x in a), -45.0),
      (ob, a))
    iu = BR.iron_units
    c('iron_units: raw 1, each usable iron pickaxe 3, spent 0, bucket 3',
      iu({'raw_iron': 2, 'iron_pickaxe': 2}, {'iron_pickaxe': [{'used': 1, 'max': 250}, {'used': 2, 'max': 250}]}) == 8
      and iu({'raw_iron': 2, 'iron_pickaxe': 1}, {'iron_pickaxe': [{'used': 250, 'max': 250}]}) == 2 and iu({'bucket': 1}) == 3)
    dl = BR.death_linked
    c('linkage: a skill row whose [start, start+dur] meets the 120 s before the death links', dl(1000, [(850, 40)]))
    c('linkage: a row that ended before the window does not', not dl(1000, [(850, 20)]))
    c('linkage: boundaries -- start 120 s before links, 120.1 s does not, after the death never',
      dl(1000, [(880, 0)]) and not dl(1000, [(879.9, 0)]) and not dl(1000, [(1000.5, 0)]) and dl(1000, [(999, 0)]))
    pl = BR.p_link(1.45)
    c('p_link(1.45 rows/bot-h) = 4.7% (section 7, junkwell-01)', abs(pl - 0.0472) < 0.0005, pl)
    table = [(2, 2), (3, 2), (4, 3), (10, 3), (16, 4), (20, 5), (25, 5), (33, 6), (40, 7)]
    ok = all(BR.linked_beyond_chance(need, n, pl)[0] and not BR.linked_beyond_chance(need - 1, n, pl)[0] for n, need in table)
    c("(a)'s linked-deaths-needed table from section 7 reproduces exactly", ok)
    c('(a) zero linked is never beyond chance', BR.linked_beyond_chance(0, 30, pl)[0] is False)
    ct = lambda *a: BR.ceiling_trips(*a, ratio_lower_bound)
    c('(b) one death never trips the ceiling', ct(1, 1.0, 0, 300.0)[0] is False)
    c('(b) chestfull-01 (3 in 7.2 vs 0 in 31.7, LB 2.58) trips', ct(3, 7.2, 0, 31.7)[0] is True)
    c('(b) junkwell-01 (6 in 51.1 vs 11 in 358.2, LB 1.40) does not', ct(6, 51.1, 11, 358.2)[0] is False)
    c('(b) unmeasured exposure in an arm is UNREADABLE (lb None), not a cleared ceiling',
      ct(6, 51.1, 0, 0.0)[1] is None and ct(6, 0.0, 11, 358.2)[1] is None)
    BAG = {'class': 'bag-fix'}
    M = lambda **k: dict(dict(cd=6, cbh=51.1, kd=11, kbh=358.2, linked=0, own_rows=13, own_bots=3, errors=0), **k)
    G = {'cd': 6, 'cbh': 51.1, 'kd': 11, 'kbh': 358.2}
    ok_ceil = (False, 1.40)
    at = BR.at_trip
    c('at_trip: junkwell-01 shape -> EXTEND', at(BAG, 'death_gate', M(), G, ok_ceil)[0] == 'EXTEND')
    c('at_trip: not a bag fix / wrong spelling -> REVERT', at({'class': 'kind'}, 'death_gate', M(), G, ok_ceil)[0] == 'REVERT'
      and at({'class': 'bag_fix'}, 'death_gate', M(), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: a REVERT not by the all-cause gate -> REVERT', at(BAG, None, M(), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: unreadable logs -> REVERT', at(BAG, 'death_gate', M(errors=1), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: control exposure unmeasured -> REVERT (round 1: it EXTENDED)', at(BAG, 'death_gate', M(kbh=0.0), G, (False, None))[0] == 'REVERT')
    c('at_trip: zero control exposure -> REVERT even if a caller passed a clear ceiling', at(BAG, 'death_gate', M(kbh=0.0), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: an unreadable ceiling (lb None) -> REVERT', at(BAG, 'death_gate', M(), G, (False, None))[0] == 'REVERT')
    c('at_trip: no gate counts on the verdict -> REVERT', at(BAG, 'death_gate', M(), None, ok_ceil)[0] == 'REVERT')
    c('at_trip: fewer deaths re-measured than the gate counted -> REVERT', at(BAG, 'death_gate', M(cd=5), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: fewer CONTROL deaths re-measured than the gate counted -> REVERT', at(BAG, 'death_gate', M(), dict(G, kd=12), ok_ceil)[0] == 'REVERT')
    c('at_trip: gate counts incomplete ({cd} only) -> REVERT', at(BAG, 'death_gate', M(), {'cd': 6}, ok_ceil)[0] == 'REVERT')
    c('at_trip: own rows on only 1 bot (thin positive control) -> REVERT', at(BAG, 'death_gate', M(own_bots=1), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: 0 own rows -> REVERT', at(BAG, 'death_gate', M(own_rows=0, own_bots=0), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: ONE linked death -> REVERT (owner: only when ZERO are linked)', at(BAG, 'death_gate', M(linked=1), G, ok_ceil)[0] == 'REVERT')
    c('at_trip: ceiling already met -> REVERT', at(BAG, 'death_gate', M(), G, (True, 2.5))[0] == 'REVERT')
    P = lambda **k: dict(M(), p_link=pl, **k)
    ep = BR.extended_poll
    c('extended_poll: 2 of 3 linked at p 4.7% -> REVERT (a)', ep(P(cd=3, linked=2), (False, 1.0))[0] == 'REVERT')
    c('extended_poll: 1 of 20 linked -> CONTINUE', ep(P(cd=20, linked=1), (False, 1.5))[0] == 'CONTINUE')
    c('extended_poll: ceiling -> REVERT (b)', ep(P(cd=20), (True, 2.2))[0] == 'REVERT')
    c('extended_poll: control exposure unmeasured -> UNREADABLE, never CONTINUE', ep(P(kbh=0.0), (False, None))[0] == 'UNREADABLE')
    c('extended_poll: unreadable logs -> UNREADABLE', ep(P(errors=2), (False, 1.0))[0] == 'UNREADABLE')
    c('extended_poll: canary telemetry stale, control fresh -> UNREADABLE (round 2: stale counts kept answering CONTINUE)',
      ep(P(fresh_canary=0.1, fresh_control=0.9), (False, 1.0))[0] == 'UNREADABLE')
    c('extended_poll: both arms stale (a fleet outage) -> PAUSED, not blind', ep(P(fresh_canary=0.0, fresh_control=0.1), (False, 1.0))[0] == 'PAUSED')
    c('extended_poll: both fresh -> decides as usual', ep(P(fresh_canary=0.9, fresh_control=0.95), (False, 1.0))[0] == 'CONTINUE')
    cov = BR.coverage_ok
    good = {'bot_h': 480.0, 'inv_obs': 480 * 300, 'deaths': 10, 'deaths_with_inv': 10}
    c('coverage: ~300 snapshots/bot-h and bags on every death -> ok', cov({'a': good})[0])
    c('coverage: no inventory snapshots -> not ok (round 1: stripped telemetry read as zero harm)', not cov({'a': dict(good, inv_obs=0)})[0])
    c('coverage: deaths without a bag -> not ok', not cov({'a': dict(good, deaths_with_inv=5)})[0])
    F = BR.final
    CONT, OKC = ('CONTINUE', 'x'), (True, 'ok')
    c('final: (a)/(b) REVERT at the end -> REVERT', F(('REVERT', '(b)'), 480, OKC, True, 0.0, -5.21, 0.0, -0.136)[0] == 'REVERT')
    c('final: (a)/(b) unreadable at the end -> UNREADABLE (not terminal: counted toward BLIND, so it REVERTs like a poll)',
      F(('UNREADABLE', 'x'), 480, OKC, True, 0.0, -5.21, 0.0, -0.136)[0] == 'UNREADABLE')
    c('final: coverage missing -> INCONCLUSIVE', F(CONT, 480, (False, 'no snapshots'), True, 0.0, -5.21, 0.0, -0.136)[0] == 'INCONCLUSIVE')
    c('final: net below the band -> REVERT even on short exposure', F(CONT, 100, OKC, True, -6.0, -5.21, 0.0, -0.136)[0] == 'REVERT')
    c('final: iron below its band -> REVERT', F(CONT, 480, OKC, True, 0.0, -5.21, -0.2, -0.136)[0] == 'REVERT')
    c('final: exposure < 400 -> INCONCLUSIVE', F(CONT, 399.9, OKC, True, 0.0, -5.21, 0.0, -0.136)[0] == 'INCONCLUSIVE')
    c('final: bag metric not moved / unknown -> INCONCLUSIVE', F(CONT, 480, OKC, False, 0.0, -5.21, 0.0, -0.136)[0] == 'INCONCLUSIVE'
      and F(CONT, 480, OKC, None, 0.0, -5.21, 0.0, -0.136)[0] == 'INCONCLUSIVE')
    c('final: unreadable net (None / NaN) -> INCONCLUSIVE, never KEEP', F(CONT, 480, OKC, True, None, -5.21, 0.0, -0.136)[0] == 'INCONCLUSIVE'
      and F(CONT, 480, OKC, True, float('nan'), -5.21, 0.0, -0.136)[0] == 'INCONCLUSIVE')
    k = F(CONT, 480, OKC, True, -5.0, -5.21, -0.1, -0.136)
    c('final: everything clear -> KEEP and names the next slot', k[0] == 'KEEP' and 'underground-safety' in k[1], k)
    pm = BR.primary_moved
    spec = {'read': 'wellread', 'field': 'junk_slots_did', 'op': '<=', 'value': -0.5}
    c('primary_moved: beyond the edge True, inside False, missing/bool None',
      pm({'junk_slots_did': -1.3}, spec) is True and pm({'junk_slots_did': -0.2}, spec) is False
      and pm({}, spec) is None and pm({'junk_slots_did': True}, spec) is None)
    c('primary_moved: +/-infinity is unreadable, never "moved" -- either sign, either operator, or an infinite edge (round 4)',
      pm({'junk_slots_did': float('-inf')}, spec) is None and pm({'junk_slots_did': float('inf')}, dict(spec, op='>=')) is None
      and pm({'junk_slots_did': -1.3}, dict(spec, value=float('inf'))) is None)
    reg = {'sha': 'abc1234'}; man = {'canary_pool': 'a,b', 'run_id': 'r', 'declared_at': 'D'}
    ev = {'sha': 'abc1234', 'pools': 'a,b', 'run_id': 'r', 'declared_at': 'D', 'window_min': 1440, 'fields': {}}
    eb = BR.evidence_bound
    c('evidence_bound: bound and fresh -> ok; another minute, sha, or 91 min old -> refused',
      eb(ev, reg, man, 1440, 5)[0] and not eb(dict(ev, window_min=360), reg, man, 1440, 5)[0]
      and not eb(dict(ev, sha='zzz'), reg, man, 1440, 5)[0] and not eb(ev, reg, man, 1440, 91)[0])
    rp = BR.registration_problems
    good_reg = {'class': 'bag-fix', 'reads': ['wellread', 'immobiledid'], 'bag_fix': {'own_kinds': ['_well_dispose'], 'primary': spec}}
    c('registration: a well-formed bag fix passes; an ordinary canary is not checked', rp(good_reg) == [] and rp({'class': 'kind'}) == [])
    c('registration: an infinite primary edge is refused',
      bool(rp(dict(good_reg, bag_fix={'own_kinds': ['_x'], 'primary': dict(spec, value=float('-inf'))}))))
    c('registration: no bag_fix block / primary on an unregistered read / bad op -> refused',
      rp({'class': 'bag-fix'}) and rp(dict(good_reg, reads=['immobiledid']))
      and rp(dict(good_reg, bag_fix={'own_kinds': ['_x'], 'primary': dict(spec, op='<')})))
    return out


# ------------------------------------------------------------------------------------------------ 2. bagfixgate e2e
POOLS_C = ['board-a', 'board-b', 'hive-a', 'hive-b']
POOLS_K = ['board-c', 'board-d', 'hive-c', 'hive-d', 'placebo-a', 'placebo-b', 'placebo-d', 'isolated-a', 'isolated-b',
           'isolated-c', 'isolated-d', 'placebo-c']
NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
SHA = 'abc1234'; RUN = 'bagfix-t'


def Z(t):
    return t.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def line(t, bot, kind, dur=0, inv=None):
    r = {'@timestamp': Z(t), 'code': {'version': SHA + '+x'}, 'bot': {'name': bot}, 'skill': {'name': kind, 'duration_ms': dur}}
    if inv is not None:
        r['bot'].update({'inventory': inv, 'health': 20})
    return json.dumps(r, separators=(',', ':'))


class World:
    def __init__(self, tmp, decl_min_ago, reg_extra=None):
        self.d = tempfile.mkdtemp(dir=tmp)
        self.logs = os.path.join(self.d, 'logs'); self.regs = os.path.join(self.d, 'regs'); self.reads = os.path.join(self.d, 'reads')
        for p in (self.logs, self.regs, self.reads): os.makedirs(p)
        self.now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        self.decl = self.now - dt.timedelta(minutes=decl_min_ago)
        self.man = {'run_id': RUN, 'canary_pool': ','.join(POOLS_C), 'canary_code_version': SHA, 'declared_code_version': 'base000',
                    'declared_at': self.decl.isoformat().replace('+00:00', 'Z')}
        json.dump(self.man, open(os.path.join(self.d, 'man.json'), 'w'))
        self.reg = dict({'run_id': RUN, 'sha': SHA, 'class': 'bag-fix', 'change_rows': ['well_dispose'], 'reads': ['wellread'],
                         'bag_fix': {'own_kinds': ['_well_dispose'],
                                     'primary': {'read': 'wellread', 'field': 'junk_slots_did', 'op': '<=', 'value': -0.5}}},
                        **(reg_extra or {}))
        json.dump(self.reg, open(os.path.join(self.regs, RUN + '.json'), 'w'))
        self.journal = os.path.join(self.d, 'journal.jsonl')
        self.reset_journal()
        self.rows = {}

    def reset_journal(self):
        # never empty: another run's extension and this run's own read, so "any line" cannot pass for "this run's extension"
        open(self.journal, 'w').write('{"ts":"x","run":"other-01","phase":"bagfix-extend","note":""}\n'
                                      '{"ts":"x","run":"%s","phase":"read-180","note":"VERDICT NOT_YET"}\n' % RUN)

    def bots(self, pools):
        return [f'{p}-{n}' for p in pools for n in NAMES]

    def add(self, bot, ln):
        self.rows.setdefault(bot, []).append(ln)

    def span(self, a, z, pools=None):
        for b in self.bots(pools or (POOLS_C + POOLS_K)):
            self.add(b, line(a, b, 'gather')); self.add(b, line(z, b, 'gather'))

    def flush(self):
        for b, ls in self.rows.items():
            os.makedirs(os.path.join(self.logs, b), exist_ok=True)
            with open(os.path.join(self.logs, b, f'skill-{b}.jsonl'), 'w') as f:
                f.write('\n'.join(sorted(ls)) + '\n')

    def verdict(self, M=0, by='death_gate', verdict='REVERT', counts=(6, 99.3, 3, 297.9), age_min=1):
        ex = {}
        if by:
            ex['by'] = by
        if counts:
            ex.update(cd=counts[0], cbh=counts[1], kd=counts[2], kbh=counts[3])
        json.dump({'run_id': RUN, 'window_min': M, 'verdict': verdict, 'why': [],
                   'at': (self.now - dt.timedelta(minutes=age_min)).isoformat(), 'extra': ex},
                  open(os.path.join(self.reads, f'{RUN}-verdict-{M}.json'), 'w'))

    def primary(self, value, minute=1440, age_min=5, **override):
        o = dict({'sha': SHA, 'pools': self.man['canary_pool'], 'run_id': RUN, 'declared_at': self.man['declared_at'],
                  'window_min': minute, 'emitted_at': (self.now - dt.timedelta(minutes=age_min)).isoformat(),
                  'fields': {'junk_slots_did': value}}, **override)
        json.dump(o, open(os.path.join(self.reads, f'{RUN}-wellread-{minute}.json'), 'w'))

    def extend_recorded(self):
        with open(self.journal, 'a') as f:
            f.write(json.dumps({'ts': 'x', 'run': RUN, 'phase': 'bagfix-extend', 'note': 'BAGFIX EXTEND'}, separators=(',', ':')) + '\n')

    def run(self, gate, *args):
        env = dict(os.environ, BAGFIX_LOG_ROOT=self.logs, BAGFIX_MANIFEST=os.path.join(self.d, 'man.json'),
                   BAGFIX_REG_DIR=self.regs, BAGFIX_READS_DIR=self.reads, BAGFIX_JOURNAL=self.journal,
                   BAGFIX_NOW=self.now.isoformat())
        r = subprocess.run([sys.executable, gate] + list(args), capture_output=True, text=True, env=env, timeout=600)
        last = (r.stdout.strip().splitlines() or [''])[-1]
        return (last.split()[1] if last.startswith('BAGFIX ') else 'NO_LINE'), last + (r.stderr[-300:] if r.stderr else '')


def trip_world(tmp, linked=False, own=True, extra_deaths=0, control=True, own_bots=2, stale=None):
    """300 min in: 20 canary bots, 60 control; 6 canary deaths vs 3 control -> the gate trips (LB ~1.6), ceiling not.
    stale='canary' | 'all': those arms' last rows are 30 min old (logging stopped)."""
    w = World(tmp, 300)
    if stale:
        old = w.now - dt.timedelta(minutes=30)
        w.span(w.decl + dt.timedelta(minutes=1), old, POOLS_C)
        w.span(w.decl + dt.timedelta(minutes=1), old if stale == 'all' else w.now - dt.timedelta(minutes=1), POOLS_K)
    else:
        w.span(w.decl + dt.timedelta(minutes=1), w.now - dt.timedelta(minutes=1), None if control else POOLS_C)
    cb = w.bots(POOLS_C); kb = w.bots(POOLS_K)
    for i in range(6 + extra_deaths):
        w.add(cb[i], line(w.decl + dt.timedelta(minutes=60 + 20 * i), cb[i], '_death'))
    if control:
        for i in range(3):
            w.add(kb[i], line(w.decl + dt.timedelta(minutes=50 + 20 * i), kb[i], '_death'))
    if own:
        for j in range(own_bots):
            for i in range(3):
                w.add(cb[19 - j], line(w.decl + dt.timedelta(minutes=30 + 10 * i), cb[19 - j], '_well_dispose', dur=4000))
    if linked:
        w.add(cb[0], line(w.decl + dt.timedelta(minutes=60, seconds=-60), cb[0], '_well_dispose', dur=4000))
    w.flush()
    return w


def final_world(tmp, slow=False, few=False, primary=-1.3, noinv=False, lossy=False, torn=False, torn_pre=False):
    """1500 min in; PRE 24 h + POST 24 h of 2-min snapshots. Everyone gathers a log per step and banks at 60 (a deposit
    row, a transfer). slow: canary POST gathers every other step. few: only 2 canary pools carry rows. noinv: no row
    carries a bag. lossy: 40 canary deaths in POST each carrying 96 log-eq (and 120 control deaths carrying nothing,
    so the death RATE is level and (b) cannot decide it) -- only the value carried into deaths can."""
    w = World(tmp, 1500)
    pre = w.decl - dt.timedelta(minutes=1440); end = w.decl + dt.timedelta(minutes=1440)
    cb = set(w.bots(POOLS_C[:2] if few else POOLS_C))
    for b in w.bots(POOLS_C + POOLS_K):
        if b.split('-')[0] + '-' + b.split('-')[1] in POOLS_C and b not in cb:
            continue
        t = pre; n = 0; step = 0
        while t < end:
            inv = (lambda d: None if noinv else d)
            if b in cb and slow and t >= w.decl and step % 2:
                w.add(b, line(t, b, 'explore', inv=inv({'oak_log': n})))
            else:
                n += 1
                if n > 60:
                    n = 0; w.add(b, line(t, b, 'deposit', inv=inv({'oak_log': n})))
                else:
                    w.add(b, line(t, b, 'gather', inv=inv({'oak_log': n})))
            t += dt.timedelta(minutes=2); step += 1
    if lossy:
        cbl = sorted(cb); kbl = w.bots(POOLS_K)
        for i in range(40):
            b = cbl[i % len(cbl)]
            dl = line(w.decl + dt.timedelta(minutes=30 + 35 * i, seconds=7), b, '_death', inv={'oak_log': 64, 'coal': 64})
            w.add(b, dl[:-1] if torn else dl)        # torn: the death rows lost their closing brace (a torn write)
        for i in range(120):
            b = kbl[i % len(kbl)]
            w.add(b, line(w.decl + dt.timedelta(minutes=30 + 11 * i, seconds=7), b, '_death', inv={}))
    if torn_pre:
        # torn death rows in the PRE window only: the POST reconciliation cannot see them, the row-error count must
        for i, b in enumerate(sorted(cb)[:5]):
            w.add(b, line(w.decl - dt.timedelta(minutes=300 - 30 * i, seconds=-7), b, '_death', inv={'oak_log': 64})[:-1])
    w.flush()
    w.primary(primary)
    w.extend_recorded()
    return w


_WORLDS = {}


def worlds(tmp):
    """The fixture worlds are DATA, built once per run; every mutant reads the same ones."""
    if tmp not in _WORLDS:
        W = {'w': trip_world(tmp), 'w2': trip_world(tmp, linked=True), 'w3': trip_world(tmp, own=False),
             'w4': trip_world(tmp), 'w5': trip_world(tmp, extra_deaths=8), 'w6': trip_world(tmp, control=False),
             'w7': trip_world(tmp, own_bots=1), 'w8': trip_world(tmp, stale='canary'), 'w9': trip_world(tmp, stale='all'),
             'f1': final_world(tmp), 'f2': final_world(tmp, slow=True), 'f3': final_world(tmp, primary=-0.1),
             'f4': final_world(tmp, few=True), 'f5': final_world(tmp, noinv=True), 'f6': final_world(tmp, lossy=True),
             'f7': final_world(tmp, lossy=True, torn=True), 'f8': final_world(tmp, torn_pre=True)}
        json.dump({'run_id': RUN, 'sha': SHA, 'class': 'kind', 'change_rows': ['well_dispose']},
                  open(os.path.join(W['w4'].regs, RUN + '.json'), 'w'))
        W['w5'].extend_recorded(); W['w8'].extend_recorded(); W['w9'].extend_recorded()
        _WORLDS[tmp] = W
    return _WORLDS[tmp]


def gate_cases(gate, tmp):
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    W = worlds(tmp)
    w = W['w']
    w.reset_journal()
    from deathgate import death_gate
    c('fixture: the all-cause gate trips on 6/~99 vs 3/~298 bot-h and the ceiling does not',
      death_gate(6, 99.3, 3, 297.9)[0] and ratio_lower_bound(6, 99.3, 3, 297.9) < 2.0)
    w.verdict(0)
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: 0 linked, own rows on 2 bots, LB < 2 -> EXTEND', got[0] == 'EXTEND', got)
    w.verdict(0, by=None)
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: a REVERT without by=death_gate -> REVERT', got[0] == 'REVERT', got)
    w.verdict(0, verdict='POLL_OK')
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: the artifact is not a REVERT -> REVERT (refuses)', got[0] == 'REVERT', got)
    w.verdict(0, age_min=30)
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: a 30-min-old REVERT artifact -> REVERT (not fresh)', got[0] == 'REVERT' and 'fresh' in got[1], got)
    w.verdict(0, counts=(7, 99.3, 3, 297.9))
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: the gate counted 7, the re-measure sees 6 -> REVERT', got[0] == 'REVERT', got)
    w.verdict(0, counts=None)
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: a verdict with no counts -> REVERT', got[0] == 'REVERT', got)
    W['w2'].verdict(0)
    got = W['w2'].run(gate, 'extend-check', RUN, '0'); c('extend-check: one death with an own row 60 s before -> REVERT', got[0] == 'REVERT' and 'linked' in got[1], got)
    W['w3'].verdict(0)
    got = W['w3'].run(gate, 'extend-check', RUN, '0'); c('extend-check: no own rows on the canary -> REVERT (linkage unverifiable)', got[0] == 'REVERT', got)
    W['w7'].verdict(0)
    got = W['w7'].run(gate, 'extend-check', RUN, '0'); c('extend-check: own rows on ONE bot only -> REVERT', got[0] == 'REVERT', got)
    W['w4'].verdict(0)
    got = W['w4'].run(gate, 'extend-check', RUN, '0'); c('extend-check: an ordinary canary -> REVERT', got[0] == 'REVERT', got)
    W['w6'].verdict(0)
    got = W['w6'].run(gate, 'extend-check', RUN, '0'); c('extend-check: NO control logs -> REVERT (round 1: it extended)', got[0] == 'REVERT', got)
    w.verdict(0)
    mp = os.path.join(w.d, 'man.json')
    json.dump(dict(w.man, run_id='someone-else'), open(mp, 'w'))
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: the manifest names another run -> REVERT (refused)', got[0] == 'REVERT' and 'REFUSED' in got[1], got)
    json.dump(w.man, open(mp, 'w'))
    bad = os.path.join(w.logs, 'board-a-Alpha', 'skill-board-a-Alpha.jsonl-20991231.gz')
    open(bad, 'wb').write(b'not a gzip stream')
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: an unreadable log file -> REVERT, never a silent zero', got[0] == 'REVERT' and 'error' in got[1], got)
    os.remove(bad)
    got = w.run(gate, 'poll', RUN); c('poll: refused (UNREADABLE) when the journal records no extension', got[0] == 'UNREADABLE', got)
    w.extend_recorded()
    got = w.run(gate, 'poll', RUN); c('poll: extension recorded, LB < 2, 0 linked -> CONTINUE', got[0] == 'CONTINUE', got)
    got = W['w5'].run(gate, 'poll', RUN); c('poll: 14 canary deaths vs 3 -> (b) REVERT', got[0] == 'REVERT' and '(b)' in got[1], got)
    W['w6'].extend_recorded()
    got = W['w6'].run(gate, 'poll', RUN); c('poll: no control exposure -> UNREADABLE, not CONTINUE', got[0] == 'UNREADABLE', got)
    got = W['w8'].run(gate, 'poll', RUN); c('poll: canary logging stopped 30 min ago -> UNREADABLE', got[0] == 'UNREADABLE' and 'stale' in got[1], got)
    got = W['w9'].run(gate, 'poll', RUN); c('poll: every bot silent 30 min (outage) -> PAUSED', got[0] == 'PAUSED', got)
    w.verdict(0, counts=(6, 99.3, 4, 297.9))
    got = w.run(gate, 'extend-check', RUN, '0'); c('extend-check: the gate counted 4 control deaths, the re-measure 3 -> REVERT', got[0] == 'REVERT', got)
    w.verdict(0)
    got = w.run(gate, 'final', RUN); c('final: asked before +1440 -> NOT_YET (not terminal), and says why', got[0] == 'NOT_YET' and 'before +1440' in got[1], got)
    f1 = W['f1']
    got = f1.run(gate, 'final', RUN); c('final: 20 bots x 24 h, output level with control, bound +1440 bag metric moved -> KEEP', got[0] == 'KEEP', got)
    f1.primary(-1.3, minute=360); os.remove(os.path.join(f1.reads, f'{RUN}-wellread-1440.json'))
    got = f1.run(gate, 'final', RUN); c('final: only a +360 bag metric -> INCONCLUSIVE (round 1: a 6-h metric decided a 24-h KEEP)', got[0] == 'INCONCLUSIVE', got)
    f1.primary(-1.3, sha='zzzzzzz')
    got = f1.run(gate, 'final', RUN); c('final: +1440 evidence bound to another sha -> INCONCLUSIVE', got[0] == 'INCONCLUSIVE', got)
    f1.primary(-1.3, age_min=200)
    got = f1.run(gate, 'final', RUN); c('final: stale +1440 evidence -> INCONCLUSIVE', got[0] == 'INCONCLUSIVE', got)
    f1.primary(-1.3)
    got = W['f2'].run(gate, 'final', RUN); c('final: canary output halves in POST -> REVERT (c)', got[0] == 'REVERT' and '(c)' in got[1], got)
    got = W['f3'].run(gate, 'final', RUN); c('final: bag metric inside its null -> INCONCLUSIVE', got[0] == 'INCONCLUSIVE', got)
    got = W['f4'].run(gate, 'final', RUN); c('final: 10 bots (240 bot-h < 400) -> INCONCLUSIVE', got[0] == 'INCONCLUSIVE' and 'exposure' in got[1], got)
    got = W['f5'].run(gate, 'final', RUN); c('final: no inventory telemetry -> INCONCLUSIVE (coverage), never KEEP', got[0] == 'INCONCLUSIVE' and 'coverage' in got[1], got)
    got = W['f6'].run(gate, 'final', RUN); c('final: level death RATE but bags lost in canary deaths -> REVERT (c)', got[0] == 'REVERT' and '(c)' in got[1], got)
    got = W['f7'].run(gate, 'final', RUN); c('final: the same deaths as torn (malformed) rows -> INCONCLUSIVE, never KEEP (round 4: it gave KEEP)',
                                             got[0] == 'INCONCLUSIVE' and 'coverage' in got[1], got)
    got = W['f8'].run(gate, 'final', RUN); c('final: torn death rows in the PRE window -> INCONCLUSIVE (a malformed death is a measurement error)',
                                             got[0] == 'INCONCLUSIVE' and 'malformed' in got[1], got)
    return out


# ------------------------------------------------------------------------------------------------ 2b. one estimator
def equivalence_cases(gate, tmp):
    """The CALIBRATION pipeline (scripts/host/ugsafe2_value.py walk_bot + bin_bot, a continuous walk binned at 5 min)
    and the LIVE read (bagfixgate.arm_windows, a bounded walk) must give the same window sums -- value, iron, lost,
    bot-seconds -- on a fixture with a 16-min gap before the window, an event inside a deposit, a death and an
    observation at the window's end (round 2, Codex: the old test re-summed one result, a tautology)."""
    out = []
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    uv = os.path.join(HERE, 'host', 'ugsafe2_value.py')
    if not os.path.exists(uv):
        uv = os.path.join(HERE, 'ugsafe2_value.py')
    d = tempfile.mkdtemp(dir=tmp); logs = os.path.join(d, 'logs')
    base = dt.datetime(2026, 10, 6, 0, 0, tzinfo=dt.timezone.utc)
    a, z = base + dt.timedelta(hours=1), base + dt.timedelta(hours=2)
    b = 'board-a-Alpha'; os.makedirs(os.path.join(logs, b))
    L = [line(a - dt.timedelta(minutes=16), b, 'gather', inv={'oak_log': 40}),               # 16 min before the window
         line(a + dt.timedelta(minutes=5), b, 'gather', 30000, inv={'oak_log': 20}),          # ends inside
         line(a + dt.timedelta(minutes=10), b, 'deposit', 60000, inv={'oak_log': 0}),
         line(a + dt.timedelta(minutes=10, seconds=30), b, '_deposit_cursor_rescue', inv={'oak_log': 5}),
         line(a + dt.timedelta(minutes=20), b, 'gather', inv={'oak_log': 9, 'raw_iron': 2}),
         line(a + dt.timedelta(minutes=30), b, '_death', inv={'oak_log': 9, 'raw_iron': 2}),
         line(a + dt.timedelta(minutes=31), b, 'gather', inv={'oak_log': 1}),
         line(z - dt.timedelta(minutes=1), b, 'gather', inv={'oak_log': 4}),
         line(z + dt.timedelta(minutes=2), b, 'gather', inv={'oak_log': 6})]
    open(os.path.join(logs, b, f'skill-{b}.jsonl'), 'w').write('\n'.join(L) + '\n')
    os.utime(os.path.join(logs, b, f'skill-{b}.jsonl'), (z.timestamp() + 3600, z.timestamp() + 3600))
    UV = load(uv, 'uv_eq')
    bins = UV.bin_bot(UV.walk_bot(os.path.join(logs, b), base - dt.timedelta(days=1), z + dt.timedelta(hours=1)))
    cal = {k: sum(v.get(k, 0) for bn, v in bins.items() if a.timestamp() <= bn * 300 < z.timestamp())
           for k in ('vgain', 'vlost', 'igain', 'ilost', 'vsec')}
    os.environ['BAGFIX_LOG_ROOT'] = logs
    G = load(gate, 'gate_eq_' + str(abs(hash(gate))))
    live = G.arm_windows([b], {'w': (a, z)}, [0])['w']
    pairs = [('vgain', 'vg'), ('vlost', 'vl'), ('igain', 'ig'), ('ilost', 'il'), ('vsec', 'sec')]
    c('one estimator: calibration bins and the live window agree on value, iron, lost and bot-seconds',
      all(abs(cal[k1] - live[k2]) < 1e-6 for k1, k2 in pairs), {k1: (cal[k1], live[k2]) for k1, k2 in pairs})
    c('one estimator: positive control -- the fixture window is not empty (value moved, a death lost 29 log-eq)',
      abs(live['vl'] - 29.0) < 1e-6 and live['sec'] > 0 and abs(live['vg']) > 0, live)
    return out


# ------------------------------------------------------------------------------------------------ 3. verdict v33
def verdict_cases(verdict_py, tmp):
    out = []
    # the lib verdict.py itself would resolve (its own sys.path logic: script-dir/lib, then ~/mcai-analysis/lib, /opt)
    for _cand in (os.path.join(os.path.dirname(verdict_py), 'lib'), '/home/mike/mcai-analysis/lib', '/opt/minecraft-ai/scripts/lib'):
        if os.path.isdir(_cand):
            sys.path.insert(1, _cand)
            break
    try:
        from version_split import in_canary_pool  # noqa: F401
    except ImportError:
        SKIP.append('verdict.py v33 cases: this lib has no version_split.in_canary_pool (repo lib drift) -- run on the host')
        return out
    import importlib
    A = importlib.import_module('test_verdict_acceptance')
    A.VERDICT = verdict_py
    c = lambda n, ok, d='': out.append((n, bool(ok), d))
    tripping = dict(canary_deaths=6, canary_bh=51.1, control_deaths=11, control_bh=358.2)

    def case(cls, journal_line=None, flag=False):
        k = A.Case(tmp, reg_extra={'class': cls} if cls else None)
        k.evidence('immobiledid', A.immobiledid(**tripping))
        jp = os.path.join(k.d, 'journal.jsonl')
        open(jp, 'w').write((journal_line or '') + '\n')
        e = dict(os.environ, VERDICT_READS_DIR=k.reads, VERDICT_LOG_ROOT=k.logs, VERDICT_REG_DIR=k.regs,
                 VERDICT_MANIFEST=k.manp, VERDICT_JOURNAL=jp)
        r = subprocess.run([sys.executable, verdict_py, A.RUN, '180'] + (['--bagfix-extended'] if flag else []),
                           capture_output=True, text=True, env=e, cwd=HERE, timeout=120)
        head = (r.stdout.strip().splitlines() or [''])[-1]
        try:
            art = json.load(open(os.path.join(k.reads, f'{A.RUN}-verdict-180.json')))
        except Exception:
            art = {'extra': {}}
        return (head.split()[1] if head.startswith('VERDICT') else 'CRASH'), head, art

    ext = json.dumps({'ts': 'x', 'run': A.RUN, 'phase': 'bagfix-extend', 'note': ''}, separators=(',', ':'))
    v, head, art = case('bag-fix')
    ex = art.get('extra') or {}
    c('verdict: a tripping death gate REVERTs; the artifact says by=death_gate and carries the counts',
      v == 'REVERT' and ex.get('by') == 'death_gate' and ex.get('cd') == 6 and ex.get('kd') == 11, head + ' ' + str(ex))
    v, head, art = case('bag-fix', ext, flag=True)
    c('verdict --bagfix-extended, bag fix, extension recorded: the gate is REPORTED, not a REVERT, and not called "held"',
      v != 'REVERT' and 'REPORTED, not a verdict' in head and 'death gate held (v21)' not in head, head)
    c('verdict: a read that got past the catastrophe guards says so (artifact guards=True)', art.get('guards') is True, art)
    k = A.Case(tmp, reg_extra={'class': 'bag-fix'})
    k.evidence('immobiledid', A.immobiledid(readable=False, **tripping))
    v2, head2 = k.run()
    art2 = json.load(open(os.path.join(k.reads, f'{A.RUN}-verdict-180.json')))
    c('verdict: NOT_YET from an unreadable immobiledid stops BEFORE the guards (artifact guards=False)',
      v2 == 'NOT_YET' and art2.get('guards') is False, (head2, art2.get('guards')))
    # THE +1440 READ the extension takes is OFF-schedule: verdict.py must evaluate it like any registered minute
    k = A.Case(tmp, reg_extra={'class': 'bag-fix'})
    k.evidence('immobiledid', A.immobiledid(**tripping), M=1440)
    jp = os.path.join(k.d, 'journal.jsonl'); open(jp, 'w').write(ext + '\n')
    e = dict(os.environ, VERDICT_READS_DIR=k.reads, VERDICT_LOG_ROOT=k.logs, VERDICT_REG_DIR=k.regs, VERDICT_MANIFEST=k.manp, VERDICT_JOURNAL=jp)
    r = subprocess.run([sys.executable, verdict_py, A.RUN, '1440', '--bagfix-extended'], capture_output=True, text=True, env=e, cwd=HERE, timeout=120)
    h3 = (r.stdout.strip().splitlines() or [''])[-1]
    a3 = json.load(open(os.path.join(k.reads, f'{A.RUN}-verdict-1440.json')))
    c('verdict at the off-schedule +1440 with --bagfix-extended: evaluates past the guards, not REVERT',
      h3.startswith('VERDICT') and h3.split()[1] != 'REVERT' and a3.get('guards') is True, (h3, a3.get('guards')))
    v, head, art = case('bag-fix', None, flag=True)
    c('verdict --bagfix-extended with NO recorded extension: IGNORED, still REVERT', v == 'REVERT' and 'IGNORED' in head, head)
    v, head, art = case('kind', ext, flag=True)
    c('verdict --bagfix-extended on an ordinary canary: IGNORED, still REVERT', v == 'REVERT' and 'IGNORED' in head, head)
    return out


# ------------------------------------------------------------------------------------------------ 4. canarywatch
def watch_cases(cw_path, tmp):
    out = []
    W = load(cw_path, 'cw_t')
    d = tempfile.mkdtemp(dir=tmp)
    json.dump({'class': 'bag-fix', 'deadline_min': 780, 'bag_fix': {'extended_deadline_min': 1600}}, open(os.path.join(d, 'r.json'), 'w'))
    json.dump({'class': 'kind', 'deadline_min': 780}, open(os.path.join(d, 'k.json'), 'w'))
    j = os.path.join(d, 'j.jsonl')
    open(j, 'w').write('{"run":"r","phase":"read-180"}\n')
    out.append(('canarywatch: a bag fix with no recorded extension keeps its base deadline', W.deadline_for('r', d, journal=j) == 780, ''))
    open(j, 'a').write('{"run":"r","phase":"bagfix-extend"}\n{"run":"k","phase":"bagfix-extend"}\n')
    out.append(('canarywatch: a recorded extension moves a bag fix to its extended deadline', W.deadline_for('r', d, journal=j) == 1600, W.deadline_for('r', d, journal=j)))
    out.append(('canarywatch: an ordinary canary never moves, journal or not', W.deadline_for('k', d, journal=j) == 780, ''))
    return out


# ------------------------------------------------------------------------------------------------ 5. mutants
MUTANTS = [
    ('bagfixrule.py', 'at_trip extends with one linked death', "    if linked > 0:\n        return 'REVERT'", "    if linked > 1:\n        return 'REVERT'"),
    ('bagfixrule.py', 'at_trip drops the positive control', "    if own <= 0 or bots < MIN_OWN_BOTS:", "    if own <= 0:"),
    ('bagfixrule.py', 'at_trip ignores which line reverted', "    if revert_by != 'death_gate':", "    if False:"),
    ('bagfixrule.py', 'at_trip ignores missing exposure', "    if None in (cd, cbh, kd, kbh) or cbh <= 0 or kbh <= 0:", "    if None in (cd, cbh, kd, kbh):"),
    ('bagfixrule.py', 'at_trip skips the gate cross-check', "    if cd < FLOOR or cd < g['cd'] or kd < g['kd']:", "    if cd < FLOOR or kd < g['kd']:"),
    ('bagfixrule.py', 'at_trip skips the control-death cross-check', "    if cd < FLOOR or cd < g['cd'] or kd < g['kd']:", "    if cd < FLOOR or cd < g['cd']:"),
    ('bagfixrule.py', 'stale telemetry ignored', "    if fc is not None and fk is not None:", "    if False:"),
    # (the `k != '_death'` guard in to_obs is belt-and-braces behind the clip below: with the clip in place no death can
    #  sit strictly inside an interval, so a mutant of that guard alone is equivalent and is not listed)
    ('bagfixrule.py', 'transfer interval not clipped at a death', "            if j < len(deaths) and deaths[j] < b:", "            if False:"),
    ('bagfixrule.py', 'transfer intervals ignored', "            if j >= 0 and iv[j][0] < to < iv[j][1]:", "            if False:"),
    ('bagfixgate.py', 'live walk without the 6-h lead', "LEAD_S = 6 * 3600", "LEAD_S = 900"),
    ('bagfixgate.py', 'live walk without the tail', "TAIL_S = 600 ", "TAIL_S = 0 "),
    ('bagfixrule.py', 'at_trip treats an unreadable ceiling as clear', "    if lb is None:\n        return 'REVERT', 'ceiling (b) unreadable: the gate stands'",
     "    if False:\n        return 'REVERT', 'ceiling (b) unreadable: the gate stands'"),
    ('bagfixrule.py', 'ceiling test 10x too lenient', "    return lb > ceiling, lb", "    return lb > ceiling * 10, lb"),
    ('bagfixrule.py', 'ceiling reads missing exposure as a clear 0.0', "        return False, None\n    if cd < floor:", "        return False, 0.0\n    if cd < floor:"),
    ('bagfixrule.py', 'linkage ignores the skill duration', "        if t <= death_t and t + max(0.0, dur or 0.0) >= lo:", "        if t <= death_t and t >= lo:"),
    ('bagfixrule.py', '(a) at p < 0.5', "    return p < alpha, p", "    return p < 0.5, p"),
    ('bagfixrule.py', 'poll CONTINUEs on unmeasured exposure', "    if lb is None or not isinstance(cd, int)", "    if not isinstance(cd, int)"),
    ('bagfixrule.py', '(c) net band ignored', "    if net_did < net_p025:", "    if net_did < net_p025 - 100:"),
    ('bagfixrule.py', 'final ignores the end-of-read (a)/(b)', "    if pw == 'REVERT':\n        return 'REVERT', pwhy", "    if False:\n        return 'REVERT', pwhy"),
    ('bagfixrule.py', 'final ignores coverage', "    if not cov_ok:", "    if False:"),
    ('bagfixrule.py', 'an infinite bag metric reads as moved', "    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):",
     "    if not isinstance(v, (int, float)) or isinstance(v, bool) or v != v:"),
    ('bagfixgate.py', 'a malformed death row is silently skipped', "            if '\"name\":\"_death\"' in l and iso(since) <= ts[:19] < iso(until):",
     "            if False:"),
    # (the POST death reconciliation in cmd_final is belt-and-braces behind that error count: both see the same torn
    #  death rows, so a mutant of the reconciliation alone is equivalent on every fixture and is not listed)
    ('bagfixrule.py', 'unknown bag metric reads as moved', "    if primary_moved is not True:", "    if primary_moved is False:"),
    ('bagfixrule.py', 'exposure floor dropped', "    if exposure_bh is None or exposure_bh < MIN_EXPOSURE_BH:", "    if exposure_bh is None:"),
    ('bagfixrule.py', 'withdrawal events count as output', "TRANSFER_PREFIXES = ('withdraw', 'deposit', 'town_deposit')",
     "TRANSFER_PREFIXES = ('deposit', 'town_deposit')"),
    ('bagfixrule.py', 'the respawn step counts', "kind == '_death' or prev_kind == '_death' or is_transfer(kind)", "kind == '_death' or is_transfer(kind)"),
    ('bagfixrule.py', 'output is positive steps only (retakes count)', "    return value - prev_value\n", "    return max(0.0, value - prev_value)\n"),
    ('bagfixrule.py', 'cobble above the reserve counts', "STONE_W * min(stone, STONE_CAP)", "STONE_W * stone"),
    ('bagfixrule.py', 'is_bag_fix accepts any class', "    return isinstance(reg, dict) and reg.get('class') == 'bag-fix'", "    return isinstance(reg, dict)"),
    ('bagfixrule.py', 'evidence binding ignores the minute', "('declared_at', man.get('declared_at')), ('window_min', minute)):", "('declared_at', man.get('declared_at'))):"),
    ('bagfixgate.py', 'extend-check trusts any REVERT as the death gate', "    by = ex.get('by')", "    by = 'death_gate'"),
    ('bagfixgate.py', 'extend-check accepts a stale artifact', "or not (0 <= age <= 15):", "or not (0 <= age):"),
    ('bagfixgate.py', 'extend-check skips the manifest binding', "    b = bound(reg, man, run)\n    if b:\n        return emit(run, 'extend'",
     "    b = None\n    if b:\n        return emit(run, 'extend'"),
    ('bagfixgate.py', 'linkage scan disabled', "            if BR.death_linked(t, own):", "            if False:"),
    ('bagfixgate.py', 'unreadable log files are silent', "            errors[0] += 1\n            sys.stderr.write", "            pass\n            sys.stderr.write"),
    ('bagfixgate.py', 'extension check matches any journal line', """            if '"run":"%s"' % run in l and '"phase":"bagfix-extend"' in l:""", """            if True:"""),
    ('bagfixgate.py', 'final accepts a short read', "    if now() < end:", "    if False:"),
    ('bagfixgate.py', 'own-kind needles never match', """    needles = ['"name":"%s"' % k for k in kinds]""", """    needles = ['"name":"#%s"' % k for k in kinds]"""),
    ('bagfixgate.py', 'value lost in deaths dropped', "x['vl'] += vl", "x['vl'] += 0"),
    ('bagfixgate.py', 'primary read at any minute', 'p = os.path.join(READS, f"{run}-{spec[\'read\']}-{BR.EXTEND_MIN}.json")',
     'p = sorted(glob.glob(os.path.join(READS, f"{run}-{spec[\'read\']}-*.json")))[-1]'),
    # verdict.py's v33 half (run only where its lib resolves: the host)
    ('verdict.py', 'guards never marked evaluated', "_GUARDS = True\n# 8. own lines", "_GUARDS = False\n# 8. own lines"),
    ('verdict.py', 'guards marked evaluated from the start', "_GUARDS = False\n\n\ndef out(v, extra=None):", "_GUARDS = True\n\n\ndef out(v, extra=None):"),
    ('verdict.py', 'death-gate REVERT loses its by= field', "(out('REVERT', {'by': 'death_gate', 'cd': int(_cd)", "(out('REVERT', {'by_': 'death_gate', 'cd': int(_cd)"),
    ('verdict.py', '--bagfix-extended honoured for any class', "        _ext_ok = bagfixrule.is_bag_fix(reg) and any(",
     "        _ext_ok = True or any("),
    ('verdict.py', '--bagfix-extended honoured without a recorded extension',
     """            f'"run":"{run_id}"' in _l and '"phase":"bagfix-extend"' in _l for _l in open(_jp))""",
     """            True for _l in [0])"""),
]


def run_all(rule_path, gate_path, verdict_py, cw_path, tmp, quiet=False):
    """-> list of (name, ok, detail) over every section, using the given copies."""
    BR = load(rule_path, 'br_' + str(abs(hash(rule_path))))
    res = pure_cases(BR)
    if quiet and not all(ok for _n, ok, _d in res):
        return res                     # a mutant already killed by behaviour: the end-to-end half adds nothing
    res += gate_cases(gate_path, tmp) + equivalence_cases(gate_path, tmp)
    if not quiet:
        res += verdict_cases(verdict_py, tmp) + watch_cases(cw_path, tmp)
    return res


if __name__ == '__main__':
    tmp = tempfile.mkdtemp(prefix='bagfixtest-')
    R = os.path.join(HERE, 'bagfixrule.py'); G = os.path.join(HERE, 'bagfixgate.py')
    V = os.path.join(HERE, 'verdict.py'); CW = os.path.join(HERE, 'host', 'canarywatch.py')
    if not os.path.exists(CW):
        CW = os.path.join(HERE, 'canarywatch.py')
    for n, ok, d in run_all(R, G, V, CW, tmp):
        t(n, ok, d)
    print('\nmutants (each applied to a COPY with its anchor asserted present and unique; each must FAIL a case):')
    for fname, name, old, new in MUTANTS:
        src = open(os.path.join(HERE, fname)).read()
        assert old in src, 'ANCHOR MISSING in %s: %r' % (fname, old)
        assert src.count(old) == 1, 'ANCHOR NOT UNIQUE in %s (%d): %r' % (fname, src.count(old), old)
        md = tempfile.mkdtemp(dir=tmp)
        for f in ('bagfixrule.py', 'bagfixgate.py', 'deathgate.py', 'verdict.py', 'singledeath.py', 'usaferule.py', 'usafegate.py',
                  'changerowcheck.py'):
            if os.path.exists(os.path.join(HERE, f)):
                shutil.copy(os.path.join(HERE, f), md)
        open(os.path.join(md, fname), 'w').write(src.replace(old, new, 1))
        if fname == 'verdict.py':
            n0 = len(SKIP)
            res = verdict_cases(os.path.join(md, 'verdict.py'), tmp)
            if len(SKIP) > n0:
                SKIP.pop()
                SKIP.append('verdict.py mutant "%s": not runnable here (repo lib drift) -- run on the host' % name)
                continue
            failed = [n for n, ok, _d in res if not ok]
            t(f'mutant killed: {fname}: {name}', bool(failed), 'SURVIVED')
            continue
        try:
            res = run_all(os.path.join(md, 'bagfixrule.py'), os.path.join(md, 'bagfixgate.py'), V, CW, tmp, quiet=True)
            failed = [n for n, ok, _d in res if not ok]
        except Exception as e:
            failed = ['raised %s' % type(e).__name__]
        t(f'mutant killed: {fname}: {name}', bool(failed), 'SURVIVED')
    for s in SKIP:
        print('SKIPPED  ' + s)
    n = len(T); bad = n - sum(T)
    print(f'\n{n - bad}/{n} pass' + (f'; {len(SKIP)} section(s) SKIPPED (not passes)' if SKIP else ''))
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit(1 if bad else 0)
