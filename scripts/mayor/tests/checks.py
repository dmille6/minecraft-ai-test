"""Behavioural checks, parameterised by the core MODULE so the same checks run against the real
mayor_core (test_mayor.py, must pass) and against mutants of it (test_mutants.py, must fail).
Each check raises AssertionError when the behaviour is wrong."""

T0 = 1790990000000          # 2026-10-03T01:13:20Z
HOUR = 3600000


def tools_pick(name, used, mx):
    return {name: [{'slot': 10, 'used': used, 'max': mx}]}


def make_bot(core, name, pos=(0, 64, 0), inventory=None, tools=None, fresh=True, trapped_s=None,
             milestone=None, cfg=None):
    cfg = cfg or core.DEFAULTS
    st = core.BotState(name)
    st.world, st.pool = 'w', 'w'
    st.last_ms = T0 - (1000 if fresh else (cfg['stale_s'] + 60) * 1000)
    st.full_ms = st.last_ms
    st.full = {'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]}, 'health': 20, 'hunger': 20, 'held': None,
               'inventory': dict(inventory or {}), 'tools': tools if tools is not None else {}, 'dimension': 'overworld'}
    if trapped_s is not None:
        st.trap_ms, st.trap_kind = T0 - trapped_s * 1000, '_entombed'
    st.milestone = milestone
    return core.bot_view(st, T0, cfg)


def log_at(x, y, z, age_h=1.0, kind='oak_log'):
    return {'kind': kind, 'x': x, 'y': y, 'z': z, 'count': 3, 'age_h': age_h}


def snap_of(core, bots, resources, bank=None, cfg=None):
    return core.build_snapshot('w', bots, resources, T0, bank or {'accepts_recently': False, 'why': 'test'},
                               cfg or core.DEFAULTS)


def cand(snap, bot_name, duty):
    for c in snap['candidates']:
        if c['bot_name'] == bot_name and c['duty'] == duty:
            return c
    return None


def codes(c):
    return sorted(b['code'] for b in c['blockers'])


BARE = {'dirt': 10, 'apple': 5}         # no wood, no pickaxe: the 10-02 bot


def check_wood_needs_a_near_log(core):
    """10-02: a bot with no pickaxe and no wood gets GET_WOOD only if a log resource is near."""
    b = make_bot(core, 'A', (100, 64, 100), BARE, {})
    s = snap_of(core, [b], [log_at(130, 66, 100)])
    gw, rp = cand(s, 'A', 'GET_WOOD'), cand(s, 'A', 'RESTORE_PICK')
    assert gw is not None and gw['feasible'], ('near log should make GET_WOOD feasible', gw)
    assert gw['target'] == 'R1', gw
    assert rp is not None and not rp['feasible'] and codes(rp) == ['no_ingredients'], rp
    assert rp['blockers'][0]['remedy'] == 'GET_WOOD', 'the refusal names a remedy the bot can perform'
    for res, why in (([log_at(200, 64, 100)], 'too far horizontally'),
                     ([log_at(120, 80, 100)], 'too far vertically (16 > 10)'),
                     ([log_at(120, 64, 100, age_h=7)], 'seen more than 6 h ago'),
                     ([], 'no log at all')):
        s = snap_of(core, [b], res)
        gw = cand(s, 'A', 'GET_WOOD')
        assert gw is not None and not gw['feasible'] and 'no_log_near' in codes(gw), (why, gw)
    full = dict(BARE, cobblestone=64 * 30)      # 30 + 2 slots = 32 used, 4 free -> ok; 33 used -> 3 free -> ok
    b2 = make_bot(core, 'B', (100, 64, 100), dict(BARE, cobblestone=64 * 32), {})   # 34 used, 2 free
    s = snap_of(core, [b2], [log_at(110, 64, 100)])
    gw = cand(s, 'B', 'GET_WOOD')
    assert gw is not None and not gw['feasible'] and 'no_room' in codes(gw), gw
    assert [x['remedy'] for x in gw['blockers'] if x['code'] == 'no_room'] == ['FREE_BAG']
    b3 = make_bot(core, 'C', (100, 64, 100), full, {})
    assert cand(snap_of(core, [b3], [log_at(110, 64, 100)]), 'C', 'GET_WOOD')['feasible']


def check_trapped_and_stale_are_excluded(core):
    for kw, code in (({'trapped_s': 60}, 'trapped'), ({'fresh': False}, 'stale')):
        b = make_bot(core, 'A', (100, 64, 100), BARE, {}, **kw)
        live = make_bot(core, 'L', (0, 64, 0), BARE, {})     # keeps the world shortage alive
        s = snap_of(core, [b, live], [log_at(110, 64, 100)])
        gw = cand(s, 'A', 'GET_WOOD')
        assert gw is not None and not gw['feasible'] and code in codes(gw), (code, gw)
    b = make_bot(core, 'A', (100, 64, 100), BARE, {}, trapped_s=400)     # trapped 400 s ago: outside 5 min
    s = snap_of(core, [b], [log_at(110, 64, 100)])
    assert cand(s, 'A', 'GET_WOOD')['feasible']


def check_full_bag_gets_free_bag(core):
    inv = {'bamboo': 64 * 30, 'leaf_litter': 64 * 3, 'stone_axe': 1}      # 34 slots
    spent = {'stone_axe': [{'slot': 9, 'used': 130, 'max': 131}]}
    b = make_bot(core, 'A', (0, 64, 0), inv, spent)
    assert b['slots_est'] == 34, b['slots_est']
    s = snap_of(core, [b], [])
    sh = [x for x in s['shortages'] if x['duty'] == 'FREE_BAG']
    assert len(sh) == 1 and sh[0]['bot'] == 'B1', s['shortages']
    fb = cand(s, 'A', 'FREE_BAG')
    assert fb['feasible'] and [m['method'] for m in fb['methods']] == ['wear_out'], fb
    b2 = make_bot(core, 'A', (0, 64, 0), inv, {'stone_axe': [{'slot': 9, 'used': 3, 'max': 131}]})
    fb = cand(snap_of(core, [b2], []), 'A', 'FREE_BAG')
    assert not fb['feasible'] and codes(fb) == ['no_disposal'], fb
    cfg = dict(core.DEFAULTS, composter=True)
    b3 = make_bot(core, 'A', (0, 64, 0), inv, {'stone_axe': [{'slot': 9, 'used': 3, 'max': 131}]}, cfg=cfg)
    fb = cand(snap_of(core, [b3], [], cfg=cfg), 'A', 'FREE_BAG')
    assert fb['feasible'] and fb['methods'][0]['method'] == 'compost', fb
    # deposit only on recent proof the bank accepts
    inv4 = dict(inv, cobblestone=64 * 3)
    b4 = make_bot(core, 'A', (0, 64, 0), inv4, {})
    fb = cand(snap_of(core, [b4], []), 'A', 'FREE_BAG')
    assert not fb['feasible'], fb
    fb = cand(snap_of(core, [b4], [], bank={'accepts_recently': True, 'why': 't'}), 'A', 'FREE_BAG')
    assert fb['feasible'] and fb['methods'][0]['method'] == 'deposit', fb


def check_restore_pick_needs_ingredients(core):
    b = make_bot(core, 'A', (0, 64, 0), {'oak_log': 2}, {})          # 8 planks: 3 + 2 sticks' planks + ... table needs 4
    rp = cand(snap_of(core, [b], []), 'A', 'RESTORE_PICK')
    assert not rp['feasible'], rp                                       # 8 < 3 + 2 + 4
    b = make_bot(core, 'A', (0, 64, 0), {'oak_log': 3}, {})             # 12 planks >= 9
    rp = cand(snap_of(core, [b], []), 'A', 'RESTORE_PICK')
    assert rp['feasible'] and rp['recipe'] == 'wooden_pickaxe', rp
    b = make_bot(core, 'A', (0, 64, 0), {'cobblestone': 3, 'stick': 2, 'crafting_table': 1},
                 tools_pick('stone_pickaxe', 125, 131))                 # 6 of 131 = 4.6% -> low
    s = snap_of(core, [b], [])
    rp = cand(s, 'A', 'RESTORE_PICK')
    assert rp['feasible'] and rp['recipe'] == 'stone_pickaxe', rp
    b = make_bot(core, 'A', (0, 64, 0), {'oak_log': 9}, tools_pick('stone_pickaxe', 10, 131))
    assert cand(snap_of(core, [b], []), 'A', 'RESTORE_PICK') is None, 'a healthy pickaxe is not a shortage'


def check_iron_needs_pick_near_ore_and_room(core):
    iron = log_at(150, 40, 100, kind='iron_ore')
    good = make_bot(core, 'A', (100, 60, 100), {'dirt': 1}, tools_pick('stone_pickaxe', 31, 131))
    assert cand(snap_of(core, [good], [iron]), 'A', 'GET_IRON')['feasible']
    for name, bot, res, code in (
            ('wooden', make_bot(core, 'A', (100, 60, 100), {}, tools_pick('wooden_pickaxe', 0, 59)), [iron], 'no_trip_pick'),
            ('worn', make_bot(core, 'A', (100, 60, 100), {}, tools_pick('stone_pickaxe', 120, 131)), [iron], 'no_trip_pick'),
            ('far', good, [log_at(250, 40, 100, kind='iron_ore')], 'no_iron_near'),
            ('full', make_bot(core, 'A', (100, 60, 100), {'bamboo': 64 * 35}, tools_pick('stone_pickaxe', 0, 131)), [iron], 'no_room')):
        c = cand(snap_of(core, [bot], res), 'A', 'GET_IRON')
        assert c is not None and not c['feasible'] and code in codes(c), (name, c)


def five_eligible(core):
    """Five fresh bots, every one eligible for GET_WOOD and GET_IRON, two log sightings."""
    bots = [make_bot(core, n, (100 + 5 * i, 64, 100), {'dirt': 1}, tools_pick('stone_pickaxe', 0, 131))
            for i, n in enumerate(['A', 'B', 'C', 'D', 'E'])]
    res = [log_at(110, 64, 105), log_at(120, 64, 105), log_at(130, 60, 100, kind='iron_ore'),
           log_at(140, 60, 100, kind='iron_ore'), log_at(150, 60, 100, kind='iron_ore')]
    return snap_of(core, bots, res)


def check_caps_and_unique_targets(core):
    s = five_eligible(core)
    assert sum(c['feasible'] for c in s['candidates']) >= 8, [c['feasible'] for c in s['candidates']]
    rec, _ = core.decide(s, None)
    a = rec['assignments']
    assert 1 <= len(a) <= core.DEFAULTS['cap_per_world'], a
    for d in core.DUTIES:
        assert sum(x['duty'] == d for x in a) <= core.DEFAULTS['cap_per_duty'], (d, a)
    assert len({x['bot'] for x in a}) == len(a), 'one duty per bot'
    tg = [x['target'] for x in a if x['target']]
    assert len(tg) == len(set(tg)), ('duplicate target', a)
    assert any(u['reason'] == 'passed_over' for u in rec['unstaffed']) or len(a) == 3, rec['unstaffed']


def check_one_log_one_bot(core):
    bots = [make_bot(core, n, (100 + i, 64, 100), {'dirt': 1}, tools_pick('stone_pickaxe', 0, 131))
            for i, n in enumerate(['A', 'B'])]
    s = snap_of(core, bots, [log_at(110, 64, 105)])
    rec, _ = core.decide(s, None)
    wood = [x for x in rec['assignments'] if x['duty'] == 'GET_WOOD']
    assert len(wood) == 1, ('no duplicate targets: one sighting, one bot', rec['assignments'])
    assert rec['unstaffed'] == [] or all(u['duty'] != 'GET_WOOD' for u in rec['unstaffed'])


def check_hysteresis_and_cooldown(core):
    """A lease is held for 10 min although a better-ranked bot appears; released on done; a failed
    lease cools down 15 min before the same bot is offered the same duty again."""
    cfg = core.DEFAULTS
    a = make_bot(core, 'A', (100, 64, 100), BARE, {})
    s1 = snap_of(core, [a], [log_at(130, 64, 100)])
    r1, st = core.decide(s1, None)
    assert [(x['bot_name'], x['duty'], x['lease']) for x in r1['assignments']] == [('A', 'GET_WOOD', 'new')], r1
    # 5 min later B appears closer to the log: A keeps it (held), B gets nothing for wood (cap 2 allows B? target taken)
    def at(core_snap, dt_s):
        core_snap['t_ms'] += dt_s * 1000
        core_snap['snap_id'] = 'w@%d' % core_snap['t_ms']
        return core_snap
    b = make_bot(core, 'B', (128, 64, 100), BARE, {})
    s2 = at(snap_of(core, [a, b], [log_at(130, 64, 100)]), 300)
    r2, st = core.decide(s2, st)
    got = {(x['bot_name'], x['duty'], x['lease']) for x in r2['assignments']}
    assert ('A', 'GET_WOOD', 'held') in got and ('B', 'GET_WOOD', 'new') not in got, got
    # done: A now holds a log -> released 'done', no cooldown
    a_done = make_bot(core, 'A', (100, 64, 100), dict(BARE, oak_log=1), {})
    s3 = at(snap_of(core, [a_done, b], [log_at(130, 64, 100)]), 360)
    r3, st3 = core.decide(s3, st)
    assert any(x['bot'] == 'A' and x['why'] == 'done' for x in r3['released']), r3['released']
    assert not any(k.startswith('A|') for k in st3['cooldowns']), st3['cooldowns']
    # failed: A trapped -> released 'failed' + cooldown; A not re-offered within 15 min, re-offered after
    a_trap = make_bot(core, 'A', (100, 64, 100), BARE, {}, trapped_s=10)
    s4 = at(snap_of(core, [a_trap], [log_at(130, 64, 100)]), 360)
    r4, st4 = core.decide(s4, st)
    assert any(x['bot'] == 'A' and x['why'] == 'failed' for x in r4['released']), r4['released']
    s5 = at(snap_of(core, [a], [log_at(130, 64, 100)]), 360 + 600)
    r5, st5 = core.decide(s5, st4)
    assert not any(x['bot_name'] == 'A' and x['duty'] == 'GET_WOOD' for x in r5['assignments']), ('cooldown', r5)
    assert any(u['passed_over'].get('cooldown') for u in r5['unstaffed']), r5['unstaffed']
    s6 = at(snap_of(core, [a], [log_at(130, 64, 100)]), 360 + cfg['cooldown_s'] + 1)
    r6, _ = core.decide(s6, st5)
    assert any(x['bot_name'] == 'A' and x['duty'] == 'GET_WOOD' and x['lease'] == 'new' for x in r6['assignments']), r6


def check_validator(core):
    s = five_eligible(core)
    feas = [c for c in s['candidates'] if c['feasible']]
    wood = [c for c in feas if c['duty'] == 'GET_WOOD']
    iron = [c for c in feas if c['duty'] == 'GET_IRON']

    def A(c, target=None, ev=None, conf=0.6, reason='ok'):
        return {'candidate_id': c if isinstance(c, str) else c['id'],
                'target': target if target is not None else (c['targets'][0] if not isinstance(c, str) and c['targets'] else ''),
                'reason': reason, 'evidence': ev or ['S1'], 'confidence': conf}

    def V(assigns, **kw):
        out = dict({'assignments': assigns, 'unmet_needs': [], 'abstain': False, 'abstain_reason': ''}, **kw)
        return core.validate(s, out)
    ok = V([A(wood[0])])
    assert ok['valid'] and len(ok['accepted']) == 1, ok
    cases = [
        ([A('C999')], 'unknown_candidate'),
        ([A(wood[0], target='R999')], 'invented_or_ineligible_target'),
        ([A(wood[0], target=iron[0]['targets'][0])], 'invented_or_ineligible_target'),
        ([A(wood[0], ev=['B9'])], 'unknown_evidence_id'),
        ([A(wood[0], reason='go to R77 now')], 'unknown_evidence_id'),
        ([A(wood[0], conf=1.5)], 'bad_confidence'),
        ([A(wood[0]), A(next(c for c in feas if c['bot'] == wood[0]['bot'] and c is not wood[0]))], 'bot_already_assigned'),
        ([A(wood[0]), A(wood[1], target=wood[0]['targets'][0])], 'duplicate_target'),
        ([A(wood[0], target=wood[0]['targets'][0]), A(wood[2], target=wood[2]['targets'][1]),
          A(wood[3], target='R999')], 'invented_or_ineligible_target'),
    ]
    for assigns, why in cases:
        r = V(assigns)
        assert not r['valid'] and any(x['why'].startswith(why) for x in r['rejected']), (why, r)
    # caps: three GET_WOOD to three bots -> the third breaks cap_per_duty (2)
    r = V([A(wood[0], target=wood[0]['targets'][0]), A(wood[1], target=wood[1]['targets'][1]), A(iron[2]),
           A(iron[3], target=iron[3]['targets'][1])])
    assert not r['valid'] and any(x['why'] in ('cap_duty', 'cap_world') for x in r['rejected']), r
    # infeasible candidate
    b = make_bot(core, 'A', (100, 64, 100), BARE, {})
    s2 = snap_of(core, [b], [])
    inf = cand(s2, 'A', 'GET_WOOD')
    r = core.validate(s2, {'assignments': [{'candidate_id': inf['id'], 'target': '', 'reason': 'x', 'evidence': [inf['id']],
                                            'confidence': 0.5}], 'unmet_needs': [], 'abstain': False, 'abstain_reason': ''})
    assert not r['valid'] and r['rejected'][0]['why'].startswith('infeasible_candidate'), r
    for bad in (None, [], {'assignments': []}, {'assignments': 'x', 'unmet_needs': [], 'abstain': False, 'abstain_reason': ''}):
        assert not core.validate(s, bad)['valid'], bad
    # each cap on its own: room for both kinds of target, so only the cap can refuse
    bots5 = [make_bot(core, n, (100 + 3 * i, 64, 100), {'dirt': 1}, tools_pick('stone_pickaxe', 0, 131)) for i, n in enumerate('ABCDE')]
    res = [log_at(100 + 3 * i, 64, 104) for i in range(5)] + [log_at(100 + 3 * i, 60, 108, kind='iron_ore') for i in range(5)]
    s3 = snap_of(core, bots5, res)
    w3 = [c for c in s3['candidates'] if c['duty'] == 'GET_WOOD' and c['feasible']]
    i3 = [c for c in s3['candidates'] if c['duty'] == 'GET_IRON' and c['feasible']]
    assert len({c['targets'][0] for c in w3}) == 5 and len({c['targets'][0] for c in i3}) == 5, 'distinct nearest targets'

    def V3(cs):
        return core.validate(s3, {'assignments': [{'candidate_id': c['id'], 'target': c['targets'][0], 'reason': 'r',
                                                   'evidence': [c['id']], 'confidence': 0.5} for c in cs],
                                  'unmet_needs': [], 'abstain': False, 'abstain_reason': ''})
    r = V3(w3[:3])
    assert [x['why'] for x in r['rejected']] == ['cap_duty'], ('per-duty cap', r)
    r = V3([w3[0], w3[1], i3[2], i3[3]])
    assert [x['why'] for x in r['rejected']] == ['cap_world'], ('world cap', r)


def check_per_duty_cap(core):
    """With room for 5 bots in the world, GET_WOOD still takes at most cap_per_duty (2)."""
    cfg = dict(core.DEFAULTS, cap_per_world=5)
    bots = [make_bot(core, n, (100 + 3 * i, 64, 100), {'dirt': 1}, tools_pick('stone_pickaxe', 0, 131), cfg=cfg)
            for i, n in enumerate('ABCDE')]
    res = [log_at(100 + 3 * i, 64, 104) for i in range(5)]
    s = snap_of(core, bots, res, cfg=cfg)
    assert sum(c['feasible'] for c in s['candidates'] if c['duty'] == 'GET_WOOD') == 5, s['candidates']
    rec, _ = core.decide(s, None, cfg)
    wood = [x for x in rec['assignments'] if x['duty'] == 'GET_WOOD']
    assert len(wood) == cfg['cap_per_duty'], ('per-duty cap', wood)


def check_lease_expiry(core):
    """A lease with no progress ends at 10 min ('expired') and the bot cools down for that duty."""
    a = make_bot(core, 'A', (100, 64, 100), BARE, {})
    s1 = snap_of(core, [a], [log_at(130, 64, 100)])
    _, st = core.decide(s1, None)
    s2 = snap_of(core, [a], [log_at(130, 64, 100)])
    s2['t_ms'] += core.DEFAULTS['lease_s'] * 1000
    s2['snap_id'] = 'w@expiry'
    r2, st2 = core.decide(s2, st)
    assert [(x['bot'], x['why']) for x in r2['released']] == [('A', 'expired')], r2['released']
    assert 'A|GET_WOOD' in st2['cooldowns'], st2
    assert not any(x['bot_name'] == 'A' for x in r2['assignments']), r2['assignments']


def check_nearest_first(core):
    """One log, two eligible bots: the NEARER one gets it (the far one sorts first by name)."""
    far = make_bot(core, 'A', (100, 64, 100), BARE, {})
    near = make_bot(core, 'B', (145, 64, 100), BARE, {})
    s = snap_of(core, [far, near], [log_at(150, 64, 100)])
    rec, _ = core.decide(s, None)
    wood = [x['bot_name'] for x in rec['assignments'] if x['duty'] == 'GET_WOOD']
    assert wood == ['B'], ('nearest first', rec['assignments'])
