#!/usr/bin/env python3
# lavasightread.py [window_min] [--selftest] [--map PATH] -- the read for canary `lavasight-01` (mineshaft-safety F5b: the
# per-seed lava map and the bot's own sightings price, at the MOVE level, the moves the corridor guard would refuse).
# Design: docs/reports/lavasight-01-design-2026-10-24.md (r2) section 7. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never
# emits). Judges the CANARY ARM; the effect is a difference-in-differences against the control pools; DENOMINATORS FIRST.
#
# Run from ~/mcai-analysis (lib/telemetry.py: the window's file reads, rotation-aware).
#
# THE CHANGE (what only this build writes):
#   _lavasight_mode   spawn + every file-state change: on, state (ok|absent|stale|world_mismatch|world_label|world_unknown|
#                     bad_schema|unreadable|off), cells, generated_at
#   _lavasight        every 10 min: state, file_cells, ring, active, index, priced_moves, held_seen, held_priced, set_changed,
#                     corridor_checks, corridor_refused (unsampled), ring_added, rebuild_ms
#   _lavasight_route  at most 1 per 30 s + every noPath/timeout: status, nodes, core_nodes, min_d, refused, priced, held
# PRIMARY (DiD, per bot-h, canary vs control, pre vs post): LAVA REFUSAL EPISODES -- bot-minutes with >= 1 `_lava_corridor`
#   or lava-naming `_explore_blind_step_refused` row (rows are throttled and multi-heading, so minutes, not rows; Claude r1 P2-3)
# CO-PRIMARY: DANGER EPISODES -- bot-minutes with a `_reflex_danger_block` on a lava-like feet/below block.
# DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#   G2 held_priced    a surcharge applied while a body-moving reflex held the body (the wrapper's own observation)
#   G3 set_changed    a wrapped generator returned a different neighbour count than the base (a wall)
#   G4 rows_control   a `_lavasight*` row on a control pool after the deploy
#   G5 malformed      a canary `_lavasight` row without its gate fields (never a pass)
# LIVENESS (BLOCKS KEEP): a canary licence on=1; >= 80% of canary bots' newest mode state `ok` (the map reached them);
#   liveness coverage >= 0.75 of the canary's 10-min slots (INSTRUMENT).
# EXPOSURE: canary priced moves >= 200 and >= 30 canary lava refusal episodes pre+post (the mechanism engaged where it can act).
# NO-HARM (reported, judged by the registration's own lines): path_noPath and path_timeout per bot-h DiD; movement skill
#   successes (goto, explore, gather) per bot-h DiD.
# REPORTED: deaths by family per arm (the TWO-DEATH FLOOR applies; one death is named, never a verdict); deaths AT MAP HAZARDS
#   (within 3 xz / 4 y of a hazard cell or centre of the pool's seed, by kind) per arm; the guard's refusals per check on the
#   canary (unsampled); active cells, removed, index, rebuild ms.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict

LAVA_LIKE = ('lava', 'magma', 'fire')          # lavaguard LAVA_LIKE by substring: lava, flowing_lava, fire, soul_fire, magma_block, campfire
KEEP = ('_lavasight_mode', '_lavasight', '_lavasight_route', '_lava_corridor', '_explore_blind_step_refused',
        '_reflex_danger_block', '_path_noPath', '_path_timeout', '_death', 'goto', 'explore', 'gather')
GATE_FIELDS = ('priced_moves', 'held_priced', 'set_changed', 'held_seen', 'corridor_checks', 'corridor_refused')
EXPOSURE_PRICED, EXPOSURE_EPISODES = 200, 30


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def death_family(msg):
    m = (msg or '').lower()
    if re.search(r'lava|burn|fire|flames|magma|hot floor|floor was lava', m):
        return 'lava'
    if 'drown' in m:
        return 'drowning'
    if re.search(r'fell|fall|stalagmite|stalactite|doomed|hit the ground', m):
        return 'fall'
    if 'suffocat' in m or 'in a wall' in m:
        return 'suffocation'
    return 'other'


def hazard_index(m):
    """map -> {world: [(kind, [(x,y,z)...])]} over every kind, the cells (sightings + deaths) and the centre. Pure."""
    out = defaultdict(list)
    for seed, s in (m or {}).get('seeds', {}).items():
        hz = []
        for h in s.get('hazards') or []:
            cells = [tuple(c[:3]) for c in ((h.get('sightings') or {}).get('cells') or []) + ((h.get('deaths') or {}).get('cells') or []) if isinstance(c, list) and len(c) >= 3]
            if isinstance(h.get('center'), list):
                cells.append(tuple(h['center'][:3]))
            hz.append((h.get('kind'), cells))
        for w in (s.get('worlds') or {}):
            out[w] = hz
    return out


def at_hazard(hz, pos):
    x, y, z = pos
    for kind, cells in hz:
        for (cx, cy, cz) in cells:
            if abs(cx - x) <= 3 and abs(cz - z) <= 3 and abs(cy - y) <= 4:
                return kind
    return None


def judge(rows, W=180, CANS=(), population=None, hazards=None):
    """rows: dicts {t, per, arm, name, status, detail, args, bot, pos}. population: {(per, arm): set((bot, slot))} -- every
    (bot, 10-min slot) the walk saw a RETAINED row in (Codex r2 P1-3: a bot restarted onto the canary build mid-window, or one
    whose off-build rows were skipped, contributes only the slots it was observed in; never the whole window). -> fields. Pure."""
    bots = defaultdict(set)
    for k, v in (population or {}).items():
        bots[k] |= set(v)
    ep, dep = defaultdict(set), defaultdict(set)
    c = Counter()
    newest_mode = {}
    live_slots = defaultdict(set)
    deaths, deaths_at = Counter(), Counter()
    named = []
    for r in rows:
        a, p, n, b, t = r['arm'], r['per'], r['name'], r['bot'], r['t']
        # bot-time from rows BOTH builds write (Claude r3 P2): the canary's 10-min liveness row would otherwise mark every
        # connected canary slot observed and none of the control's, deflating the canary's rates
        if not n.startswith('_lavasight'):
            bots[(p, a)].add((b, int(t // 600)))
        minute = int(t // 60)
        d = r.get('detail') or ''
        # a refusal for an UNKNOWN cell is not lava's (lavasight cannot move it; Claude r2 P3-7)
        if (n == '_lava_corridor' and 'unknown' not in d) or (n == '_explore_blind_step_refused' and 'lava' in d and 'unknown' not in d):
            ep[(p, a)].add((b, minute))
        elif n == '_reflex_danger_block' and any(k in d for k in LAVA_LIKE):
            dep[(p, a)].add((b, minute))
        elif n.startswith('_lavasight'):
            if a == 'control' and p == 'post':
                c['rows_control'] += 1
            if a != 'canary' or p != 'post':
                continue
            args = r.get('args') or {}
            if n == '_lavasight_mode':
                c['lic'] += 1
                if str(args.get('on')) == '1':
                    c['lic_on'] += 1
                if b not in newest_mode or newest_mode[b][0] <= t:
                    newest_mode[b] = (t, args.get('state'))
            elif n == '_lavasight':
                if any(f not in args for f in GATE_FIELDS):
                    c['malformed'] += 1
                    continue
                live_slots[b].add(int(t // 600))
                for f in GATE_FIELDS:
                    try:
                        c[f] += int(args.get(f) or 0)
                    except (TypeError, ValueError):
                        c['malformed'] += 1
                for f in ('active', 'index', 'removed', 'rebuild_ms'):
                    try:
                        c['max_' + f] = max(c['max_' + f], int(args.get(f) or 0))
                    except (TypeError, ValueError):
                        pass
                if args.get('state') == 'ok':
                    c['live_ok'] += 1
                c['live_rows'] += 1
            elif n == '_lavasight_route':
                c['route_rows'] += 1
                if str(args.get('status')) in ('noPath', 'timeout'):
                    c['route_' + str(args.get('status'))] += 1
                    try:
                        if int(args.get('priced') or 0) > 0:
                            c['route_terminal_priced'] += 1
                    except (TypeError, ValueError):
                        pass
                try:
                    c['core_nodes'] += int(args.get('core_nodes') or 0)
                except (TypeError, ValueError):
                    pass
        elif n in ('_path_noPath', '_path_timeout'):
            c[(n, p, a)] += 1
        elif n in ('goto', 'explore', 'gather'):
            if r.get('status') == 'success':
                c[('move_ok', p, a)] += 1
        elif n == '_death' and p == 'post':
            fam = death_family(d)
            deaths[(a, fam)] += 1
            if a == 'canary':
                named.append('%s %s %s' % (b, fam, d[:60]))
            pos = r.get('pos')
            if hazards is not None and pos:
                k = at_hazard(hazards.get(pool_of(b), []), tuple(math.floor(v) for v in pos))
                if k:
                    deaths_at[(a, k)] += 1
    out = {}
    hrs = lambda per, arm: len(bots[(per, arm)]) / 6.0          # observed (bot, 10-min) slots -> bot-hours
    rate = lambda cnt, per, arm: (cnt / hrs(per, arm)) if hrs(per, arm) else None

    def did(get):
        v = [rate(get(p, a), p, a) for p, a in (('pre', 'canary'), ('post', 'canary'), ('pre', 'control'), ('post', 'control'))]
        return v, (None if None in v else round((v[1] - v[0]) - (v[3] - v[2]), 4))
    out['episode_rates'], out['episode_did'] = did(lambda p, a: len(ep[(p, a)]))
    out['danger_rates'], out['danger_did'] = did(lambda p, a: len(dep[(p, a)]))
    out['nopath_rates'], out['nopath_did'] = did(lambda p, a: c[('_path_noPath', p, a)])
    out['timeout_rates'], out['timeout_did'] = did(lambda p, a: c[('_path_timeout', p, a)])
    out['move_ok_rates'], out['move_ok_did'] = did(lambda p, a: c[('move_ok', p, a)])
    out['held_priced'] = c['held_priced']
    out['set_changed'] = c['set_changed']
    out['rows_control'] = c['rows_control']
    out['malformed'] = c['malformed']
    out['licence_canary'] = c['lic']
    out['licence_on'] = int(c['lic_on'] >= 1)
    can_bots = {b for b, _ in bots[('post', 'canary')]}
    # EVERY canary bot is in the denominator; one without a mode row is unmapped (Codex r2 P1-4)
    states = Counter(newest_mode[b][1] if b in newest_mode else 'no_row' for b in can_bots)
    out['mode_states'] = dict(states)
    out['mapped_share'] = round(states.get('ok', 0) / len(can_bots), 3) if can_bots else 0.0
    can_slots = len(bots[('post', 'canary')])
    # only liveness in an OBSERVED slot counts (Codex r4 P2): a liveness row in a slot outside the denominator cannot cover it
    covered = sum(1 for b, q in bots[('post', 'canary')] if q in live_slots.get(b, ()))
    out['coverage'] = round(covered / can_slots, 3) if can_slots else 0.0
    out['instrument'] = int(out['coverage'] >= 0.75 and len(can_bots) >= 1 and len(bots[('pre', 'control')]) >= 1 and len(bots[('post', 'control')]) >= 1)
    out['mapped'] = int(out['mapped_share'] >= 0.8)
    out['priced_moves'] = c['priced_moves']; out['held_seen'] = c['held_seen']
    # G2 is a TRIPWIRE, 0 by construction in this wiring (Claude r2 P2-1): it is EXERCISED only when a held search met the
    # footprint at all (held_seen > 0); otherwise it is said, not passed
    out['g2_exercised'] = int(c['held_seen'] > 0)
    out['corridor_checks'] = c['corridor_checks']; out['corridor_refused'] = c['corridor_refused']
    out['refused_per_check'] = round(c['corridor_refused'] / c['corridor_checks'], 4) if c['corridor_checks'] else None
    out['episodes_canary'] = len(ep[('pre', 'canary')]) + len(ep[('post', 'canary')])
    out['exposure'] = int(c['priced_moves'] >= EXPOSURE_PRICED and out['episodes_canary'] >= EXPOSURE_EPISODES and out['mapped'] == 1)
    out['route_rows'] = c['route_rows']; out['route_terminal'] = {'noPath': c['route_noPath'], 'timeout': c['route_timeout'], 'priced': c['route_terminal_priced']}
    out['core_nodes'] = c['core_nodes']
    out['max'] = {k: c['max_' + k] for k in ('active', 'index', 'removed', 'rebuild_ms')}
    out['deaths'] = {'%s/%s' % k: v for k, v in sorted(deaths.items())}
    out['deaths_canary'] = sum(v for (a, _), v in deaths.items() if a == 'canary')
    out['deaths_control'] = sum(v for (a, _), v in deaths.items() if a == 'control')
    out['deaths_at_hazards'] = {'%s/%s' % k: v for k, v in sorted(deaths_at.items())}
    out['deaths_named'] = named[:8]
    out['bot_h'] = {'%s/%s' % k: round(hrs(*k), 1) for k in (('pre', 'canary'), ('post', 'canary'), ('pre', 'control'), ('post', 'control'))}
    out['canary_bots'] = len(can_bots)
    return out


def selftest():
    T0 = 1_760_000_400                                  # on a 10-min slot boundary
    R = lambda name, detail='', bot='board-d-Alpha', arm='canary', per='post', t=T0, args=None, status='success', pos=None: {
        't': t, 'per': per, 'arm': arm, 'name': name, 'status': status, 'detail': detail, 'args': args or {}, 'bot': bot, 'pos': pos}
    LIVE = lambda **o: dict({'state': 'ok', 'priced_moves': 30, 'held_priced': 0, 'set_changed': 0, 'held_seen': 2, 'corridor_checks': 100,
                             'corridor_refused': 3, 'active': 40, 'index': 900, 'removed': 2, 'rebuild_ms': 4}, **o)
    base = []
    for per in ('pre', 'post'):
        t0 = T0 - 10800 if per == 'pre' else T0           # 180 min each side, one row a minute: 18 slots per bot
        for i in range(180):
            base.append(R('_lava_corridor', 'lava_corridor: lava beside at 1,2,3', per=per, t=t0 + i * 60))
            base.append(R('_lava_corridor', 'lava_corridor: lava beside at 1,2,3', per=per, arm='control', bot='hive-a-Alpha', t=t0 + i * 60))
        base.append(R('goto', per=per, t=t0)); base.append(R('goto', per=per, arm='control', bot='hive-a-Alpha', t=t0))
    can = [R('_lavasight_mode', args={'on': 1, 'state': 'ok'})] + [R('_lavasight', args=LIVE(), t=T0 + i * 600) for i in range(18)]
    ok = judge(base + can, CANS=('board-d',))
    for k in ('held_priced', 'set_changed', 'rows_control', 'malformed'):
        assert ok[k] == 0, (k, ok)
    assert ok['licence_on'] == 1 and ok['mapped'] == 1 and ok['instrument'] == 1 and ok['exposure'] == 1, ok
    assert ok['episode_did'] == 0 and ok['priced_moves'] == 540 and ok['refused_per_check'] == 0.03, ok
    # PRIMARY counts MINUTES: ten corridor rows in one minute are one episode
    burst = judge(base + can + [R('_lava_corridor', 'x', t=T0 + 5) for _ in range(10)], CANS=('board-d',))
    assert burst['episode_did'] == ok['episode_did'], 'one minute, one episode'
    better = judge([r for r in base if not (r['per'] == 'post' and r['arm'] == 'canary' and r['name'] == '_lava_corridor' and r['t'] % 120 == T0 % 120)] + can, CANS=('board-d',))
    assert better['episode_did'] < 0, ('fewer refusal minutes on the canary: the DiD falls', better['episode_did'])
    # a blind-step row counts only when it names lava
    bs = judge(base + can + [R('_explore_blind_step_refused', 'blind_step: drop of 7 ahead at 1,2,3', t=T0 + 5)], CANS=('board-d',))
    assert bs['episode_rates'] == ok['episode_rates'], 'a drop refusal is not a lava episode'
    # G2 / G3 / G4 / G5
    assert judge(base + can + [R('_lavasight', args=LIVE(held_priced=1))], CANS=('board-d',))['held_priced'] == 1, 'G2'
    assert judge(base + can + [R('_lavasight', args=LIVE(set_changed=2))], CANS=('board-d',))['set_changed'] == 2, 'G3'
    assert judge(base + can + [R('_lavasight_mode', args={'on': 1}, arm='control', bot='hive-a-Alpha')], CANS=('board-d',))['rows_control'] == 1, 'G4'
    assert judge(base + can + [R('_lavasight', args={'state': 'ok', 'priced_moves': 3})], CANS=('board-d',))['malformed'] == 1, 'G5: a gate row without its fields'
    # LIVENESS / MAPPED / INSTRUMENT / EXPOSURE controls
    assert judge(base, CANS=('board-d',))['licence_on'] == 0
    assert judge(base + [R('_lavasight_mode', args={'on': 0, 'state': 'off'})] + can[1:], CANS=('board-d',))['licence_on'] == 0, 'on=0 is not live'
    stale = judge(base + [R('_lavasight_mode', args={'on': 1, 'state': 'stale'})] + can[1:], CANS=('board-d',))
    assert stale['mapped'] == 0 and stale['exposure'] == 0, ('a stale map is not exposure', stale['mode_states'])
    assert judge(base + can[:3], CANS=('board-d',))['instrument'] == 0, 'two liveness rows in 180 min: blind'
    assert judge([r for r in base if r['arm'] == 'canary'] + can, CANS=('board-d',))['instrument'] == 0, 'no control arm: blind'
    low = judge(base + can[:1] + [R('_lavasight', args=LIVE(priced_moves=1), t=T0 + i * 600) for i in range(18)], CANS=('board-d',))
    assert low['exposure'] == 0, 'priced 18 < 200'
    # the denominator: silent control bots halve the control rates
    alpha = {int(r['t'] // 600) for r in base if r['arm'] == 'control' and r['per'] == 'post'}
    slots = {(b, q) for b in ('hive-a-Alpha', 'hive-a-Bravo') for q in alpha}
    pop = judge(base + can, CANS=('board-d',), population={('post', 'control'): slots})
    assert pop['episode_rates'][3] == ok['episode_rates'][3] / 2, ('a silent control bot doubles the slots', pop['episode_rates'], ok['episode_rates'])
    # STAGGERED RESTARTS (Codex r2 P1-3): a canary bot seen only in the last slot contributes one slot, not the window
    late = [r for r in base if not (r['arm'] == 'canary' and r['per'] == 'post' and r['t'] < T0 + 170 * 60)]
    st = judge(late, CANS=('board-d',))
    assert abs(st['bot_h']['post/canary'] - 1 / 6) < 0.05, ('one observed slot is a sixth of a bot-hour', st['bot_h'])
    assert abs(st['episode_rates'][1] - ok['episode_rates'][1]) / ok['episode_rates'][1] < 0.05, ('no manufactured fall', st['episode_rates'], ok['episode_rates'])
    # MAPPED: a canary bot without a mode row is unmapped (Codex r2 P1-4)
    other = [R('_lava_corridor', 'lava_corridor: lava beside at 1,2,3', bot='board-d-Bravo', t=T0 + i * 60) for i in range(180)]
    mp = judge(base + can + other, CANS=('board-d',))
    assert mp['mapped_share'] == 0.5 and mp['mapped'] == 0, ('one of two canary bots mapped', mp['mode_states'])
    # an unknown-cell refusal is not a lava episode (Claude r2 P3-7)
    unk = judge(base + can + [R('_lava_corridor', 'lava_corridor: unknown below at 1,2,3', t=T0 + 5)], CANS=('board-d',))
    assert unk['episode_rates'] == ok['episode_rates'], 'unknown is not lava'
    # the canary's own liveness rows add NO bot-time (Claude r3 P2): a silent slot holding only `_lavasight` stays unobserved
    extra = [R('_lavasight', args=LIVE(), t=T0 + 10800 + i * 600) for i in range(6)]
    nb = judge(base + can + extra, CANS=('board-d',))
    assert nb['bot_h'] == ok['bot_h'], ('liveness-only slots counted as bot-time', nb['bot_h'], ok['bot_h'])
    # COVERAGE counts liveness only inside observed slots (Codex r4 P2): two observed slots without liveness and two
    # liveness-only slots elsewhere cover nothing
    cov = [R('_lava_corridor', 'lava_corridor: lava beside at 1,2,3', bot='board-d-Echo', t=T0 + 600 * i) for i in (0, 1)] + \
          [R('_lavasight', args=LIVE(), bot='board-d-Echo', t=T0 + 600 * i) for i in (5, 6)] + [R('_lavasight_mode', args={'on': 1, 'state': 'ok'}, bot='board-d-Echo')]
    cv = judge([r for r in base if r['arm'] == 'control'] + cov, CANS=('board-d',))
    assert cv['coverage'] == 0.0 and cv['instrument'] == 0, ('liveness outside the observed slots covered them', cv['coverage'])
    assert ok['g2_exercised'] == 1 and judge(base + [R('_lavasight_mode', args={'on': 1, 'state': 'ok'})] + [R('_lavasight', args=LIVE(held_seen=0), t=T0 + i * 600) for i in range(18)], CANS=('board-d',))['g2_exercised'] == 0
    # deaths: families, the floor is the registration's; at hazards by kind
    hz = hazard_index({'seeds': {'1': {'worlds': {'board-d': {}}, 'hazards': [{'kind': 'lava', 'center': [396, 69, 109], 'sightings': {'cells': [[397, 69, 109, 5]]}, 'deaths': {'cells': []}}]}}})
    dd = judge(base + can + [R('_death', 'board-d-Alpha tried to swim in lava', pos=(397.5, 70, 110.2)), R('_death', 'board-d-Alpha drowned', pos=(0.5, 60, 0.5)),
                             R('_death', 'hive-a-Alpha fell from a high place', arm='control', bot='hive-a-Alpha', pos=(397.5, 70, 110.2))], CANS=('board-d',), hazards=hz)
    assert dd['deaths'] == {'canary/drowning': 1, 'canary/lava': 1, 'control/fall': 1}, dd['deaths']
    assert dd['deaths_at_hazards'] == {'canary/lava': 1}, ('control hive-a has no seed in this map; the drowning is far from any hazard', dd['deaths_at_hazards'])
    assert death_family('board-a-Comet discovered the floor was lava') == 'lava' and death_family('x was impaled on a stalagmite') == 'fall'
    assert pool_of('self-isolated-b-Comet') == 'isolated-b'
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lib.telemetry import Events
    mp = os.path.expanduser('~/hazardmap/out/hazardmap.json')
    if '--map' in sys.argv:
        mp = sys.argv[sys.argv.index('--map') + 1]
    try:
        HAZ = hazard_index(json.load(open(mp)))
    except Exception as e:
        HAZ = None
        print('MAP unreadable (%s): deaths at hazards not reported' % e)
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        man = json.load(open('/srv/mcbots/trial-manifest.json'))
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    args = [a for a in sys.argv[1:] if not a.startswith('-') and a != mp]
    W = min(elapsed, float(args[0]) if args else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        """Rotation-aware: day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
        evw = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in evw.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    raw = load_window(PRE, END)
    rows, walked, offbuild = [], 0, 0
    bots = defaultdict(set)
    for r in raw:
        b = (r.get('bot') or {}).get('name')
        t = r.get('t')
        if not b or t is None:
            continue
        walked += 1
        arm = 'canary' if pool_of(b) in CANS else 'control'
        per = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and per == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        sk = ((r.get('raw') or {}).get('skill') or {})
        name = sk.get('name') or r.get('name')
        if not str(name or '').startswith('_lavasight'):        # rows both builds write (Claude r3 P2)
            bots[(per, arm)].add((b, int(t.timestamp() // 600)))
        if name in KEEP:
            pos = ((r.get('raw') or {}).get('bot') or {}).get('pos')
            rows.append({'t': t.timestamp(), 'per': per, 'arm': arm, 'name': name, 'status': sk.get('status'), 'detail': r.get('detail') or '',
                         'args': sk.get('args') or {}, 'bot': b,
                         'pos': (pos.get('x'), pos.get('y'), pos.get('z')) if isinstance(pos, dict) and pos.get('x') is not None else None})
    res = judge(rows, W=W, CANS=CANS, population=bots, hazards=HAZ)
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bot-h %s | window %d min'
          % (walked, offbuild, res['bot_h'], W))
    print('PRIMARY      lava refusal episodes (bot-minutes) per bot-h [canary pre, post, control pre, post] %s -> DiD %s (should FALL)'
          % (res['episode_rates'], res['episode_did']))
    print('CO-PRIMARY   danger-block episodes on lava per bot-h %s -> DiD %s' % (res['danger_rates'], res['danger_did']))
    print('DEFECTS      G2 priced while a reflex held the body %d (a tripwire, 0 by construction; %s: held searches that met the footprint %d) | G3 neighbour set changed %d (tripwire) | G4 control rows %d | G5 malformed gate rows %d'
          % (res['held_priced'], 'exercised' if res['g2_exercised'] else 'NOT EXERCISED', res['held_seen'], res['set_changed'], res['rows_control'], res['malformed']))
    print('LIVENESS     licence %d (on: %s) | newest mode states of %d canary bots %s (mapped share %.2f, need 0.80) | coverage %.2f of observed slots (need 0.75) -> INSTRUMENT %s'
          % (res['licence_canary'], 'yes' if res['licence_on'] else 'NO', res['canary_bots'], res['mode_states'] or '-', res['mapped_share'], res['coverage'],
             'ok' if res['instrument'] else 'BLIND'))
    print('MECHANISM    priced moves %d (held_seen %d) | guard refusals per check (canary, unsampled) %s of %d | route core nodes %d | terminal routes %s | max %s'
          % (res['priced_moves'], res['held_seen'], res['refused_per_check'], res['corridor_checks'], res['core_nodes'], res['route_terminal'], res['max']))
    print('NO-HARM      noPath per bot-h %s DiD %s | timeout %s DiD %s | movement successes %s DiD %s'
          % (res['nopath_rates'], res['nopath_did'], res['timeout_rates'], res['timeout_did'], res['move_ok_rates'], res['move_ok_did']))
    print('DEATHS       %s (canary %d v control %d; the two-death floor applies: one death is named, not a verdict) | at map hazards %s | canary: %s'
          % (res['deaths'] or '-', res['deaths_canary'], res['deaths_control'], res['deaths_at_hazards'] or '-', '; '.join(res['deaths_named']) or '-'))
    print('EXPOSURE     -> %s (priced moves %d, need %d; canary lava refusal episodes %d, need %d; mapped %s)'
          % ('READY' if res['exposure'] else 'NOT YET', res['priced_moves'], EXPOSURE_PRICED, res['episodes_canary'], EXPOSURE_EPISODES, 'yes' if res['mapped'] else 'NO'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('lavasightread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
