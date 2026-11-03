"""THE TOWN JOB RULES (jobshadow-01; docs/reports/job-assigner-2026-11-03.md, owner 11-03 gap 4). PURE: no I/O, no clock.

One town (= one pool, 5 bots) per call. Three pure steps, each tested in scripts/host/test_jobshadow.py:

  demand(facts, latches, caps)            -> (needs, latches')   what the town needs now, per role, with a reason
  assign(needs, bots, state, now)         -> (staffing, state')  who holds which role: hysteresis, term, rest, fairness, caps
  options(needs, bots, staffing, facts)   -> [opt0..opt3] + choices: what a later LLM mayor may pick between (opt0 = rules)
  validate_pick(reply, offered, gen, ...) -> the option to apply; anything invalid, late or absent -> opt0 (the rules)

The rules decide WHAT the town needs from host facts (project records, the town index, the flow ledger, live leases) and WHO
should do it. In stage 1 (shadow) nothing reads the result: it is logged next to what the bots actually did. Numbers marked
PROPOSED are this design's; the others are the owner's (BUILD_RESERVE 256 cobble / 512 logs, TOWN_COBBLE_CAP 1000) or an
existing module's (BUILDERS_MAX 2, DEEPMINE_SLOTS 1, the keeper's term 4 h / rest 1 h).
"""
import random

V = 1
ROLES = ('builder', 'deep_miner', 'miner', 'explorer', 'groundskeeper', 'clerk', 'farmer', 'smelter')
PRIMARY = frozenset(('builder', 'deep_miner', 'miner', 'explorer'))
# per role: seats (cap per town), term and rest (min), base priority (the demand ladder), the native lease it maps to
ROLE = {
    'builder':       dict(cap=2, term=180, rest=60, base=50),
    'deep_miner':    dict(cap=1, term=120, rest=60, base=55),
    'miner':         dict(cap=1, term=120, rest=60, base=45),
    'explorer':      dict(cap=1, term=180, rest=120, base=20),
    'groundskeeper': dict(cap=1, term=240, rest=60, base=40),   # = groundskeeper.mjs GK termMs 4 h / restMs 1 h
    'clerk':         dict(cap=1, term=60, rest=30, base=40),
    'farmer':        dict(cap=1, term=120, rest=30, base=30),
    'smelter':       dict(cap=1, term=60, rest=30, base=45),
}
MINERS_MAX = 2            # miner + deep_miner together
PRIMARY_MAX = 3           # at most 3 of 5 bots on a primary role
FREE_MIN = 1              # at least one eligible bot holds no role (the generalist; gather is half of all skill time)
MIN_DWELL = 30            # min: a held role is not displaced inside this, except for safety
GRACE = 20                # min: a held role whose demand went off is kept this long (hysteresis), then released `no_work`
NO_WORK_COOLDOWN = 10     # min: after a `no_work` release the same bot may take that role again after this (not a full rest)
DISPLACE_BY = 20          # a waiting role displaces a held one only with this much more urgency for DISPLACE_TICKS ticks
DISPLACE_TICKS = 2
STARVE = 120              # min: demand on and unstaffed this long -> the role goes first (no role starves)
FRESH = 10                # min: a bot seen longer ago is unknown, never eligible
CONTINUITY = 30           # min: the last holder of a role is preferred this long after its release (deepmine PREFER_MS)
# stock marks (latch on below LOW, off at TARGET or above; marks-01 replaces these with its table once shipped)
MARKS = {
    'cobble': (256, 1000),   # owner BUILD_RESERVE / TOWN_COBBLE_CAP
    'logs': (512, 2000),     # owner BUILD_RESERVE logs 512; TARGET PROPOSED (the 4000 cap is a ceiling, not a refill goal)
    'iron': (15, 30),        # PROPOSED: usable iron = ingots + raw (+9 a block)
    'smeltable': (16, 0),    # PROPOSED: raw iron + raw copper in town chests >= 16 opens the smelter (off when it falls to 0)
}


def latch(on, value, low, target):
    """A hysteresis latch. value None (unknown) keeps the latch as it was (unknown is never 0)."""
    if value is None:
        return on
    if on:
        return value < target
    return value < low


def _proj(facts, plot):
    return next((p for p in facts.get('projects') or [] if p.get('plot') == plot), None)


def demand(facts, latches=None, seen=None):
    """-> (needs, latches'). facts: one town of jobfacts.mjs + `stock` (flow ledger chests: {cobble, logs} or None) +
    `deaths_2h`, `stranded_6h`. seen: role -> bool, the pool shows the role's feature live (rows in the last 24 h); a role
    whose feature is not on the pool's build is `unsupported` (logged, never staffed). needs[role] =
    {on, slots, u0, why, supported}."""
    latches = dict(latches or {})
    seen = seen or {}
    idx = (facts.get('index') or {})
    items = idx.get('items') or {}
    known = bool(idx.get('ok')) and (idx.get('known') or 0) > 0
    stock = facts.get('stock') or {}
    cobble = stock.get('cobble') if stock.get('cobble') is not None else (items.get('cobblestone', 0) + items.get('cobbled_deepslate', 0) if known else None)
    logs = stock.get('logs') if stock.get('logs') is not None else (items.get('logs') if known else None)
    iron = (items.get('iron_ingot', 0) + items.get('raw_iron', 0) + 9 * items.get('iron_block', 0)) if known else None
    smeltable = (items.get('raw_iron', 0) + items.get('raw_copper', 0)) if known else None
    for k, v in (('cobble', cobble), ('logs', logs), ('iron', iron)):
        lo, tg = MARKS[k]
        latches[k] = latch(latches.get(k, False), v, lo, tg)
    lo, _ = MARKS['smeltable']
    latches['smeltable'] = latches.get('smeltable', False) if smeltable is None else (smeltable > 0 if latches.get('smeltable') else smeltable >= lo)
    unsafe = (facts.get('deaths_2h') or 0) >= 2
    N = {}

    def need(role, on, why, slots=1, bonus=0, supported=True):
        N[role] = dict(on=bool(on) and supported, slots=slots if on and supported else 0, u0=ROLE[role]['base'] + bonus, why=why,
                       supported=supported)

    ab = facts.get('active_build')
    p = _proj(facts, ab) if ab else None
    need('builder', bool(ab), f'project:{ab}' if ab else 'no_open_project',
         slots=min(ROLE['builder']['cap'], max(1, int((p or {}).get('builders') or 1))))
    shaft = _proj(facts, 'shaft') or {}
    stair = bool(shaft.get('complete')) and 16 in (shaft.get('landings_built') or [])
    dm_want = latches['iron'] or (known and items.get('diamond', 0) < 3)
    dm_hold = unsafe or (facts.get('stranded_6h') or 0) > 0
    need('deep_miner', stair and dm_want and not dm_hold,
         'safety_hold' if dm_hold else ('no_stair' if not stair else ('iron_low' if latches['iron'] else ('diamonds_low' if dm_want else 'stocked'))),
         supported=bool(seen.get('deep_miner')))
    m_why = [k for k in ('cobble', 'iron') if latches[k]]
    need('miner', bool(m_why), 'low:' + '+'.join(m_why) if m_why else 'stocked', bonus=15 if latches['cobble'] else 0)
    need('explorer', bool(seen.get('explorer')) and not unsafe and (facts.get('active') is None),
         'safety_hold' if unsafe else ('idle_town' if facts.get('active') is None else 'projects_open'),
         supported=bool(seen.get('explorer')))
    tidy = _proj(facts, 'tidy') or {}
    shop = _proj(facts, 'shop') or {}
    gk = bool(tidy.get('on')) and bool(shop.get('complete')) and (not tidy.get('complete') or bool(tidy.get('damaged')))
    need('groundskeeper', gk, 'grounds_open' if gk else ('no_workshop' if not shop.get('complete') else 'grounds_done'),
         supported=bool(tidy.get('on')))
    yard = _proj(facts, 'yard') or {}
    need('clerk', bool(yard.get('complete')) and (cobble or 0) > MARKS['cobble'][1] + 128,
         'yard_backlog' if yard.get('complete') else 'no_yard', supported=bool(yard.get('exists')))
    farm = _proj(facts, 'treefarm') or {}
    need('farmer', bool(farm.get('complete')) or latches['logs'], 'logs_low' if latches['logs'] else ('farm_due' if farm.get('complete') else 'stocked'),
         bonus=25 if latches['logs'] else 0)
    need('smelter', latches['smeltable'], f'smeltable:{smeltable}' if smeltable is not None else 'unknown')
    return N, latches


def urgency(n, unfilled_min):
    return n['u0'] * (1 + max(0.0, unfilled_min) / 60.0)


def _eligible(b, now):
    return (b.get('seen_min') is not None and b['seen_min'] <= FRESH and not b.get('flagged'))


def _rank_bots(role, bots, st, now, native=None):
    """Bots for `role`, best first. native: the live module-lease holders of the role (they win: native ownership is not overridden).
    Then the last holder within CONTINUITY; primaries then prefer at town, more free slots; duties prefer the fewest role-hours in
    24 h (chores are spread); a stable name breaks ties."""
    last = st.get('last', {}).get(role) or {}

    def key(b):
        n = b['bot']
        return (0 if n in (native or ()) else 1,
                0 if (last.get('bot') == n and now - last.get('at', -1e18) <= CONTINUITY * 60_000) else 1,
                (0 if b.get('at_town') else 1, -(b.get('free_slots') or 0)) if role in PRIMARY else (st.get('hours24', {}).get(n, 0.0), 0),
                n)
    return sorted(bots, key=key)


def assign(needs, bots, state=None, now=0, native=None):
    """-> (staffing, state'). PURE. bots: [{bot, seen_min, flagged, at_town, free_slots}]. native: role -> [live holder names] of
    the role's module leases (deepmine slot1, tidy keeper, the active build plot's slots). state (persisted by the driver):
      held     {role: [{bot, term0, renew}]}      rest {bot: {role: until_ms}}      last {role: {bot, at}}
      unfilled {role: since_ms}                   off {role: since_ms}             displace {role: ticks}
      hours24  {bot: role-hours in the last 24 h (the driver keeps it)}
    staffing: {role: [bot]}, plus `events`: [(op, role, bot, why)] for the tick row."""
    st = {k: (dict(v) if isinstance(v, dict) else v) for k, v in (state or {}).items()}
    for k in ('held', 'rest', 'last', 'unfilled', 'off', 'displace', 'hours24'):
        st.setdefault(k, {})
    st['held'] = {r: [dict(h) for h in hs] for r, hs in st['held'].items()}
    st['rest'] = {b: dict(v) for b, v in st['rest'].items()}
    native = native or {}
    ev = []
    byname = {b['bot']: b for b in bots}
    elig = {b['bot'] for b in bots if _eligible(b, now)}

    def release(role, h, why, rest_min):
        st['held'][role] = [x for x in st['held'].get(role, []) if x['bot'] != h['bot']]
        st['last'][role] = {'bot': h['bot'], 'at': now}
        if rest_min:
            st['rest'].setdefault(h['bot'], {})[role] = now + rest_min * 60_000
        ev.append(('release', role, h['bot'], why))

    def holder_of(name):
        return next((r for r, hs in st['held'].items() for h in hs if h['bot'] == name), None)

    # 0. NATIVE OWNERSHIP FIRST (review r1, both engines): a live module-lease holder HOLDS that role. It is imported (its term
    #    starts now unless it already held the role), a rules holder of the same role who is not native is released `native`
    #    (no rest), and a native holder holding another role leaves that one. Imports may exceed a cap: then no new takes, and
    #    nobody native is evicted (design s.5).
    nat_bots = {b for bs in native.values() for b in bs}
    for role in ROLES:
        nb = [b for b in native.get(role, ()) if b in byname]
        if not nb:
            continue
        for b in nb:
            other = holder_of(b)
            if other and other != role:
                release(other, next(h for h in st['held'][other] if h['bot'] == b), f'native:{role}', 0)
            if not any(h['bot'] == b for h in st['held'].get(role, [])):
                st['held'].setdefault(role, []).append({'bot': b, 'term0': now, 'renew': now})
                ev.append(('take', role, b, 'native'))
        for h in list(st['held'].get(role, [])):
            if h['bot'] not in nb:
                release(role, h, 'native', 0)

    # 1. the held roles: release on lost bot, safety, term end, unsupported, demand off past the grace
    for role in ROLES:
        n = needs.get(role) or {'on': False, 'slots': 0, 'supported': False}
        if n['on']:
            st['off'].pop(role, None)
        else:
            st['off'].setdefault(role, now)
        for h in list(st['held'].get(role, [])):
            if h['bot'] in native.get(role, ()):
                continue                                  # native: the module lease decides when it ends
            b = byname.get(h['bot'])
            if b is None or b.get('seen_min') is None or b['seen_min'] > FRESH:
                release(role, h, 'gone', 0)
            elif b.get('flagged'):
                release(role, h, 'flagged', 0)
            elif not n.get('supported', True):
                release(role, h, 'unsupported', 0)
            elif now - h['term0'] >= ROLE[role]['term'] * 60_000:
                release(role, h, 'term', ROLE[role]['rest'])
            elif not n['on'] and now - st['off'][role] >= GRACE * 60_000:
                release(role, h, 'no_work', NO_WORK_COOLDOWN)
        # more holders than seats (the demand shrank): the newest go
        hs = sorted([h for h in st['held'].get(role, []) if h['bot'] not in nat_bots], key=lambda h: h['term0'])
        keep = max(n['slots'] - len([b for b in native.get(role, ()) if b in byname]), 0) if n['on'] else len(hs)
        for h in hs[keep:]:
            release(role, h, 'seats', NO_WORK_COOLDOWN)
    # the town caps hold after eligibility changed (fewer seats now than holders, or more primaries than PRIMARY_MAX): the least
    # urgent non-native holders go (review r1)
    def over():
        held = [(r, h) for r, hs in st['held'].items() for h in hs]
        prim = [(r, h) for r, h in held if r in PRIMARY]
        return held, prim
    seats0 = max(0, len(elig) - FREE_MIN)
    while True:
        held, prim = over()
        pool = held if len(held) > seats0 else (prim if len(prim) > PRIMARY_MAX else [])
        pool = [(r, h) for r, h in pool if h['bot'] not in nat_bots]
        if not pool:
            break
        r, h = min(pool, key=lambda t: (needs.get(t[0], {}).get('u0', 0), -t[1]['term0'], t[1]['bot']))
        release(r, h, 'seats', NO_WORK_COOLDOWN)
    for b in list(st['rest']):
        st['rest'][b] = {r: u for r, u in st['rest'][b].items() if u > now}
        if not st['rest'][b]:
            del st['rest'][b]

    def counts():
        c = {r: len(st['held'].get(r, [])) for r in ROLES}
        prim = sum(c[r] for r in PRIMARY)
        return c, prim, sum(c.values())

    # 2. the waiting roles by urgency (aging; a starving role first)
    def unf_min(role):
        s = st['unfilled'].get(role)
        return (now - s) / 60_000 if s is not None else 0.0

    waiting = []
    for role in ROLES:
        n = needs.get(role) or {}
        have = len(st['held'].get(role, []))
        if n.get('on') and have < n['slots']:
            st['unfilled'].setdefault(role, now)
            waiting.append(role)
        else:
            st['unfilled'].pop(role, None)
            st['displace'].pop(role, None)
    waiting.sort(key=lambda r: (0 if unf_min(r) >= STARVE else 1, -urgency(needs[r], unf_min(r)), ROLES.index(r)))

    seats = max(0, len(elig) - FREE_MIN)
    for role in waiting:
        n = needs[role]
        while len(st['held'].get(role, [])) < n['slots']:
            c, prim, total = counts()
            starving = unf_min(role) >= STARVE
            prim_full = role in PRIMARY and prim >= PRIMARY_MAX
            if prim_full and not starving:
                break
            miners_full = role in ('miner', 'deep_miner') and c['miner'] + c['deep_miner'] >= MINERS_MAX
            if miners_full and not starving:
                break
            free = [byname[x] for x in sorted(elig) if holder_of(x) is None and role not in st['rest'].get(x, {})]
            if total >= seats or not free or prim_full or miners_full:
                # full: displace the least urgent held role past its dwell, when this one is much more urgent for 2 CONSECUTIVE
                # ticks, or starving. At a primary (or miner) cap the victim must be a primary (a miner): a cap is never broken.
                victims = [(urgency(needs.get(r, {'u0': 0}), 0), r, h) for r, hs in st['held'].items() for h in hs
                           if r != role and now - h['term0'] >= MIN_DWELL * 60_000 and h['bot'] not in nat_bots
                           and (not prim_full or r in PRIMARY) and (not miners_full or r in ('miner', 'deep_miner'))]
                if not victims:
                    break
                vu, vr, vh = min(victims, key=lambda t: (t[0], t[1]))
                if urgency(n, unf_min(role)) - vu >= DISPLACE_BY or starving:
                    st['displace'][role] = st['displace'].get(role, 0) + 1
                    if st['displace'][role] >= DISPLACE_TICKS or starving:
                        release(vr, vh, f'displaced_by:{role}', NO_WORK_COOLDOWN)
                        st['displace'].pop(role, None)
                        continue
                else:
                    st['displace'].pop(role, None)        # not ahead this tick: the count restarts (consecutive)
                break
            if total >= seats or not free:
                break
            pick = _rank_bots(role, free, st, now, native.get(role))[0]
            st['held'].setdefault(role, []).append({'bot': pick['bot'], 'term0': now, 'renew': now})
            ev.append(('take', role, pick['bot'], 'native' if pick['bot'] in native.get(role, ()) else needs[role]['why']))
        if len(st['held'].get(role, [])) >= n['slots']:
            st['unfilled'].pop(role, None)
    for hs in st['held'].values():
        for h in hs:
            h['renew'] = now
    staffing = {r: [h['bot'] for h in st['held'].get(r, [])] for r in ROLES if st['held'].get(r)}
    st['held'] = {r: hs for r, hs in st['held'].items() if hs}
    return {'roles': staffing, 'events': ev, 'seats': seats, 'eligible': len(elig),
            'starving': [r for r in ROLES if r in st['unfilled'] and unf_min(r) >= STARVE]}, st


def caps_ok(roles):
    """Does a staffing keep the town caps (one role per bot, seats per role, primaries, miners)? PURE."""
    allb = [b for bs in roles.values() for b in bs]
    if len(allb) != len(set(allb)):
        return False
    if any(len(bs) > ROLE[r]['cap'] for r, bs in roles.items()):
        return False
    if sum(len(roles.get(r, [])) for r in PRIMARY) > PRIMARY_MAX:
        return False
    return len(roles.get('miner', [])) + len(roles.get('deep_miner', [])) <= MINERS_MAX


def options(needs, staffing, facts, bots, now=0):
    """THE MAYOR HOOK -> {options: [{id, roles, change}], choices: {...}}. opt0 is the rules' staffing; opt1..3 are complete
    alternatives the rules also accept (each passes the same caps): (a) the least urgent held role swapped for the most urgent
    unstaffed one; (b) the builders on another open project whose `after` stands; (c) the second-best bot for the most urgent
    primary. `choices` holds what the rules leave open (the land plan's pattern): the next project, and later the expedition
    bearing and names. PURE."""
    roles = staffing['roles']
    out = [{'id': 'opt0', 'roles': roles, 'change': 'rules'}]
    held = [(needs[r]['u0'], r, b) for r, bs in roles.items() for b in bs]
    unstaffed = sorted([r for r in ROLES if needs.get(r, {}).get('on') and len(roles.get(r, [])) < needs[r]['slots']],
                       key=lambda r: -needs[r]['u0'])
    if held and unstaffed:
        _, vr, vb = min(held)
        r2 = {r: [b for b in bs if not (r == vr and b == vb)] for r, bs in roles.items()}
        r2.setdefault(unstaffed[0], []).append(vb)
        r2 = {r: bs for r, bs in r2.items() if bs}
        if caps_ok(r2):
            out.append({'id': f'opt{len(out)}', 'roles': r2, 'change': f'swap:{vr}->{unstaffed[0]}'})
    projs = facts.get('projects') or []
    done = {p['plot'] for p in projs if p.get('complete')}
    open_ok = [p['plot'] for p in projs if p.get('on') and not p.get('complete') and p['plot'] not in ('tidy', 'yard')
               and (not p.get('after') or p['after'] in done)]
    alt = [q for q in open_ok if q != facts.get('active_build')]
    if roles.get('builder') and alt:
        out.append({'id': f'opt{len(out)}', 'roles': roles, 'project': alt[0], 'change': f'project:{alt[0]}'})
    free = [b['bot'] for b in bots if _eligible(b, now) and not any(b['bot'] in bs for bs in roles.values())]
    prim = [r for r in ('builder', 'deep_miner', 'miner', 'explorer') if roles.get(r)]
    if prim and free and len(out) < 4:
        r = prim[0]
        r3 = dict(roles)
        r3[r] = [free[0]] + roles[r][1:]
        out.append({'id': f'opt{len(out)}', 'roles': r3, 'change': f'bot:{r}:{roles[r][0]}->{free[0]}'})
    return {'options': out[:4], 'choices': {'project_next': open_ok}}


def validate_pick(reply, offered, gen, now_gen, max_age=2):
    """-> (option, why). The mayor may only pick an offered option id (and a project_next member) for an acceptable generation;
    anything else, or no reply, is opt0 -- the rules are the permanent fallback. PURE."""
    opts = (offered or {}).get('options') or []
    opt0 = opts[0] if opts else None
    if not isinstance(reply, dict):
        return opt0, 'no_reply'
    if reply.get('abstain') is True:
        return opt0, 'abstain'
    g = reply.get('gen')
    if not isinstance(g, int) or g != gen or now_gen - g > max_age:
        return opt0, 'gen'
    pick = next((o for o in opts if o['id'] == reply.get('pick')), None)
    if pick is None:
        return opt0, 'unknown_option'
    pn = (reply.get('choices') or {}).get('project_next')
    if pn is not None and pn not in ((offered.get('choices') or {}).get('project_next') or []):
        return opt0, 'unknown_choice'
    return pick, 'ok'


def random_staffing(staffing, bots, seed, now=0):
    """The placebo for the concordance report: the same number of bots per role, drawn uniformly from the eligible bots. PURE."""
    rng = random.Random(seed)
    pool = sorted(b['bot'] for b in bots if _eligible(b, now))
    rng.shuffle(pool)
    out, i = {}, 0
    for r in ROLES:
        k = len(staffing['roles'].get(r, []))
        if k:
            out[r] = pool[i:i + k]
            i += k
    return out
