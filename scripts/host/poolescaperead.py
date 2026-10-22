#!/usr/bin/env python3
# poolescaperead.py [window_min] [--selftest] -- the read for canary `poolescape-01` (a marooned bot WADING in a walled pit
# -- feet in water, head in air, no route -- plugs the water beside one wall, cuts the wall, and steps out with the
# out-of-liquid impulse). Design: docs/reports/poolescape-01-design-2026-10-22.md. CANARY_DRYRUN=pool[,pool]:sha:iso for dry
# runs (never emits). Judges the CANARY ARM; the primary is difference-in-differences against control; DENOMINATORS FIRST.
#
# WHY (measured 10-15..10-22, ES): 415.3 of the fleet's 419.3 bot-h in marooned-water spells >= 30 min were three board-d bots
# in two pits (Alpha 159.5 h at 555,61,116; Comet 138.8 h and Bravo 117.0 h at 329,61,213). The registration requires board-d
# in the draw (draw_require_pools): the population the fix targets lives there.
#
# THE CHANGE (rows only this build writes):
#   _poolescape_mode   once per spawn (the licence)
#   _poolescape_start  BEFORE anything moves: id= hook= at= tries= (the death window opens here: Codex design P1)
#   _poolescape        one per firing, the same id=: outcome=out|progress|refused|yielded steps= dug= placed= hands= marks=
#                      lava_refused= at= -- the change row
#
# THE INSTRUMENT IS POSITION, NOT THE REFLEX'S OWN ROWS (Codex + Claude design P1/P2). A TRAPPED 10-minute bucket of a bot:
#   >= 3 rows carrying bot.pos whose spread on every axis is <= TRAP_SPREAD (3.0) blocks, AND >= 1 `_water_float` or
#   `_marooned` row (afloat / marooned with an open column: the rung's population). A SPELL is >= 3 consecutive trapped
#   buckets. `_path_no_legal_move sealed_in_liquid` alone is NOT a marker: measured 10-22 it also pins ENTOMBED bots in
#   flooded rock (placebo-c-Bravo, placebo-d-Delta, isolated-c-Alpha, isolated-d-Bravo: `_entombed`, head blocked), a
#   different trap the rung never fires for -- counting them would dilute both arms with a population it cannot move.
#   The rung changing how often those markers fire cannot fake an escape: a bot that has not moved stays pinned by bot.pos.
#
# GATES (deterministic; every DEFECT has a failing fixture and a passing control in --selftest)
#   G1 spell_fall       PRIMARY, BLOCKS KEEP: canary spell bot-h post <= HALF of pre, and the DiD (canary post-pre minus
#                       control post-pre, both per bot) < 0. Needs exposure (canary spell bot-h pre >= 0.5); else INCONCLUSIVE.
#                       HALF, not "less": the 10-22 dry run on the BASE (board-d drawn, cut 150 min back) read 7.50 -> 7.33
#                       with control 0.0 -> 0.5, a "fall" of bucket-edge noise that `<` would have credited to the fix.
#   G2 fire_in_escape   REVERT: a canary `_death` with fail_class fire inside an escape window: [start, end + 120 s], or
#                       [start, start + 90 s + 120 s] when the firing never wrote its end row.
#   G3 drown_in_escape  REVERT: the same for fail_class drowning or suffocation.
#   G4 claimed_out      REVERT: an outcome=out row whose bot is in a TRAPPED bucket within 3 blocks of the escape spot 10-30
#                       min later (the row claimed an exit the positions do not show). No later rows: pending, reported.
#   ARMS rows_control   REVERT: a control `_poolescape*` row after the deploy.
#   LIVENESS            canary licence >= 1 (BLOCKS KEEP).
#   INSTRUMENT          rows with bot.pos on both arms, and >= 1 trapped bucket anywhere in the pre window (the detector can
#                       see a presence) -- BLOCKS KEEP.
# EXPOSURE   canary spell bot-h pre >= 0.5 AND canary `_poolescape_start` >= 1.
# REPORTED   the three named bots' spell minutes pre/post; firing outcomes; hands (tools) used; zone/fire/town marks; lava
#            refusals; drowning-rescue rows inside escape windows (a mechanism tripwire); every death on the canary arm.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
BUCKET_S, TRAP_SPREAD, MIN_SAMPLES, SPELL_BUCKETS = 600, 3.0, 3, 3
COVERAGE = 0.75          # a canary bot trapped pre must have positions in >= 75% of its post buckets, or G1 cannot pass
DEATH_END_S = 600        # a spell that ends within 10 min of the bot's death did not end in an escape
WINDOW_PAD_S, NO_END_S = 120, 90
EXPOSURE_BH = 0.5
FALL_RATIO = 0.5          # G1: canary spell bot-h post must be at most HALF of pre (a dry run on the base read 7.50 -> 7.33)
NAMED = ('board-d-Alpha', 'board-d-Bravo', 'board-d-Comet')
MARKERS = ('_water_float', '_marooned', '_path_no_legal_move')
KEEP = ('_poolescape_mode', '_poolescape_start', '_poolescape', '_death', '_drowning_route', '_drowning_rescue', '_water_surface') + MARKERS


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(b):
    return (b or '').rsplit('-', 1)[0].replace('self-', '')


def buckets(rows):
    """rows: dicts with t (epoch s), bot, name, detail, pos (x,y,z) | None -> {bot: {bucket: trapped bool}}. Pure."""
    by = defaultdict(lambda: defaultdict(lambda: {'pos': [], 'mark': False}))
    for r in rows:
        k = int(r['t'] // BUCKET_S)
        b = by[r['bot']][k]
        if r.get('pos') is not None:
            b['pos'].append(r['pos'])
        n = r['name']
        if n in ('_water_float', '_marooned'):
            b['mark'] = True
    out = {}
    for bot, ks in by.items():
        out[bot] = {}
        for k, b in ks.items():
            ps = b['pos']
            # ORDER-INDEPENDENT (Codex code r1 P2): the spread of the bucket's positions on every axis, not distances from
            # whichever row the file happened to list first
            pinned = len(ps) >= MIN_SAMPLES and all(max(p[i] for p in ps) - min(p[i] for p in ps) <= TRAP_SPREAD for i in range(3))
            out[bot][k] = bool(pinned and b['mark'])
    return out


def spells(trapped, lo, hi, deaths=None):
    """Bot-hours of spells (>= SPELL_BUCKETS consecutive trapped buckets) per bot, restricted to buckets in [lo, hi) (epoch s).
    A spell is found on the whole bucket map, so one that started before `lo` still counts its minutes inside.
    A SPELL THAT ENDS IN A DEATH IS NOT AN ESCAPE (Claude code r1 P2-4): a respawn moves bot.pos, so a spell whose last
    bucket ends within DEATH_END_S of one of the bot's `_death` times (deaths: {bot: [t]}) is counted to `hi`. Pure."""
    deaths = deaths or {}
    res = {}
    for bot, ks in trapped.items():
        tks = sorted(k for k, v in ks.items() if v is True)
        runs, cur = [], []
        for k in tks:
            if cur and k == cur[-1] + 1:
                cur.append(k)
            else:
                if cur: runs.append(cur)
                cur = [k]
        if cur: runs.append(cur)
        counted = set()      # a UNION of buckets: two death-extended spells never count one bucket twice (Codex code r2 P2)
        for run in runs:
            if len(run) >= SPELL_BUCKETS:
                end = (run[-1] + 1) * BUCKET_S
                if any(end - BUCKET_S - DEATH_END_S <= t <= end + DEATH_END_S for t in deaths.get(bot, [])):
                    run = list(range(run[0], max(run[-1], int(hi // BUCKET_S)) + 1))
                counted.update(k for k in run if lo <= k * BUCKET_S < hi)
        res[bot] = len(counted) * BUCKET_S / 3600
    return res


def escape_windows(rows):
    """[(bot, t0, t1, id, start_row, end_row)] from `_poolescape_start` / `_poolescape` pairs. Pure."""
    starts, ends = {}, {}
    for r in rows:
        if r['name'] in ('_poolescape_start', '_poolescape'):
            i = kv(r.get('detail')).get('id')
            if i:
                (starts if r['name'] == '_poolescape_start' else ends)[(r['bot'], i)] = r
    out = []
    for key, s in starts.items():
        e = ends.get(key)
        t1 = (e['t'] + WINDOW_PAD_S) if e else (s['t'] + NO_END_S + WINDOW_PAD_S)
        out.append((key[0], s['t'], t1, key[1], s, e))
    for key, e in ends.items():
        if key not in starts:      # a start row before the window: the end row still bounds a death right after it
            out.append((key[0], e['t'] - NO_END_S, e['t'] + WINDOW_PAD_S, key[1], None, e))
    return out


def judge(rows, *, cut, W, cans, population):
    """rows: dicts t, bot, name, status, detail, fc, pos, arm, per. population: {(per, arm): set(bots)}. Pure."""
    res = {}
    trapped = buckets(rows)
    lo_pre, cut_s, hi = cut - W * 60, cut, cut + W * 60
    deaths_by = defaultdict(list)
    for r in rows:
        if r['name'] == '_death':
            deaths_by[r['bot']].append(r['t'])
    pre = spells(trapped, lo_pre, cut_s, deaths_by)
    post = spells(trapped, cut_s, hi, deaths_by)
    arm = lambda b: 'canary' if pool_of(b) in cans else 'control'
    tot = {(p, a): 0.0 for p in ('pre', 'post') for a in ('canary', 'control')}
    for b, h in pre.items(): tot[('pre', arm(b))] += h
    for b, h in post.items(): tot[('post', arm(b))] += h
    n = {k: max(1, len(v)) for k, v in population.items()}
    per_bot = {k: tot[k] / n.get(k, 1) for k in tot}
    res['spell_bh'] = {f'{p}_{a}': round(tot[(p, a)], 2) for (p, a) in tot}
    did = (per_bot[('post', 'canary')] - per_bot[('pre', 'canary')]) - (per_bot[('post', 'control')] - per_bot[('pre', 'control')])
    res['spell_did_per_bot'] = round(did, 4)
    res['exposure_spells'] = tot[('pre', 'canary')] >= EXPOSURE_BH
    # COVERAGE (Codex code r1 P2): a canary bot trapped in the pre window must stay OBSERVED after the deploy -- positions in
    # >= COVERAGE of the post buckets up to the newest row anywhere -- or a bot that went silent would read as escaped
    newest = max((r['t'] for r in rows), default=cut_s)
    post_ks = [k for k in range(int(cut_s // BUCKET_S), int(min(hi, newest) // BUCKET_S))]
    # A BUCKET IS OBSERVED ONLY WITH ENOUGH POSITIONS TO CLASSIFY IT (Codex code r2 P2): one row a bucket could never read
    # as trapped, so it cannot count toward the coverage that lets G1 call a fall
    nseen = defaultdict(Counter)
    for r in rows:
        if r.get('pos') is not None and r['t'] >= cut_s:
            nseen[r['bot']][int(r['t'] // BUCKET_S)] += 1
    seen = {b: {k for k, n in c.items() if n >= MIN_SAMPLES} for b, c in nseen.items()}
    seen = defaultdict(set, seen)
    targets = [b for b, h in pre.items() if h > 0 and arm(b) == 'canary']
    cov = {b: (len(seen[b] & set(post_ks)) / len(post_ks) if post_ks else 0.0) for b in targets}
    res['coverage_post'] = {b: round(v, 2) for b, v in sorted(cov.items())}
    res['coverage_ok'] = 1 if (targets and all(v >= COVERAGE for v in cov.values())) else 0
    res['spell_fall'] = 1 if (res['coverage_ok'] and tot[('post', 'canary')] <= FALL_RATIO * tot[('pre', 'canary')] and did < 0) else 0
    exits = {}
    for b in NAMED:
        if not pre.get(b):
            exits[b] = 'not trapped pre'
        elif cov.get(b, 0) < COVERAGE:
            exits[b] = 'not observed after the deploy'
        elif any(cut_s <= t < hi for t in deaths_by.get(b, [])):
            exits[b] = 'died after the deploy'
        elif post.get(b, 0) * 3600 >= (min(hi, newest) - cut_s) - BUCKET_S:
            exits[b] = 'still trapped'
        else:
            exits[b] = 'escaped (pinned %d min after the deploy)' % round(post.get(b, 0) * 60)
    res['named_exit'] = exits
    res['named'] = {b: {'pre_min': round(pre.get(b, 0) * 60), 'post_min': round(post.get(b, 0) * 60)} for b in NAMED}
    res['spell_bots'] = {b: [round(pre.get(b, 0), 2), round(post.get(b, 0), 2)] for b in sorted(set(pre) | set(post)) if pre.get(b) or post.get(b)}
    can = [r for r in rows if r['arm'] == 'canary' and r['per'] == 'post']
    res['licence_canary'] = sum(1 for r in can if r['name'] == '_poolescape_mode')
    res['starts_canary'] = sum(1 for r in can if r['name'] == '_poolescape_start')
    ends = [r for r in can if r['name'] == '_poolescape']
    res['outcomes'] = dict(Counter(kv(r['detail']).get('outcome', '?') for r in ends))
    res['yielded_share'] = round(res['outcomes'].get('yielded', 0) / len(ends), 2) if ends else None   # Claude code r2: start-of-firing yields show here
    res['hands'] = dict(Counter(h for r in ends for h in (kv(r['detail']).get('hands') or '-').split(',') if h and h != '-'))
    marks = Counter()
    for r in ends:
        for part in (kv(r['detail']).get('marks') or '').split(','):
            if ':' in part:
                k, v = part.split(':', 1)
                marks[k] += int(v) if v.isdigit() else 0
    res['marks'] = dict(marks)
    res['lava_refused'] = sum(int(kv(r['detail']).get('lava_refused') or 0) for r in ends)
    res['rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and r['per'] == 'post' and r['name'].startswith('_poolescape'))
    wins = [w for w in escape_windows([r for r in rows if r['arm'] == 'canary']) if w[1] >= cut_s - NO_END_S]
    fire, drown, rescue, deaths = [], [], 0, []
    for r in rows:
        if r['arm'] != 'canary' or r['per'] != 'post':
            continue
        inwin = [w for w in wins if w[0] == r['bot'] and w[1] <= r['t'] <= w[2]]
        if r['name'] == '_death':
            deaths.append((r['bot'], r.get('fc'), round(r['t'])))
            if inwin and r.get('fc') == 'fire': fire.append((r['bot'], r['t'], inwin[0][3]))
            if inwin and r.get('fc') in ('drowning', 'suffocation'): drown.append((r['bot'], r['t'], r.get('fc'), inwin[0][3]))
        if inwin and r['name'] in ('_drowning_route', '_drowning_rescue', '_water_surface'):
            rescue += 1
    res['fire_in_escape'] = len(fire)
    res['drown_in_escape'] = len(drown)
    res['_fire'] = fire; res['_drown'] = drown
    res['rescue_rows_in_escape'] = rescue
    res['deaths_canary'] = deaths
    # G4: an `out` row whose bot is pinned in a trapped bucket near the escape spot 10-30 min later
    claimed, pending = 0, 0
    pos_by = defaultdict(list)
    for r in rows:
        if r.get('pos') is not None:
            pos_by[r['bot']].append((r['t'], r['pos']))
    last_t = max((r['t'] for r in rows), default=0)
    for r in ends:
        if kv(r['detail']).get('outcome') != 'out':
            continue
        at = kv(r['detail']).get('at')
        try:
            ax, ay, az = (float(v) for v in at.split(','))
        except Exception:
            continue
        own_last = max((t for t, _ in pos_by[r['bot']]), default=0)
        if last_t < r['t'] + 1800 or own_last < r['t'] + 1800:      # the bot itself must have been seen 30 min on
            pending += 1
            continue
        ks = [k for k in range(int((r['t'] + 600) // BUCKET_S), int((r['t'] + 1800) // BUCKET_S) + 1)]
        near = [p for t, p in pos_by[r['bot']] if r['t'] + 600 <= t <= r['t'] + 1800 and max(abs(p[0] - ax), abs(p[2] - az)) <= 3 and abs(p[1] - ay) <= 3]
        if near and any(trapped.get(r['bot'], {}).get(k) for k in ks):
            claimed += 1
    res['claimed_out'] = claimed
    res['claimed_out_pending'] = pending
    res['instrument_control'] = 1 if (any(trapped.get(b, {}).get(k) for b in trapped for k in trapped[b] if lo_pre <= k * BUCKET_S < cut_s)
                                      and any(r.get('pos') is not None and r['arm'] == 'canary' for r in rows)
                                      and any(r.get('pos') is not None and r['arm'] == 'control' for r in rows)) else 0
    res['exposure_ready'] = 1 if (res['exposure_spells'] and res['starts_canary'] >= 1) else 0
    res['exposure_spells'] = 1 if res['exposure_spells'] else 0
    return res


def selftest():
    T = 1_000_000.0 * 600
    cut, W = T + 6 * 3600, 360
    def row(bot, t, name='_affordance_scan', pos=(0.0, 61.0, 0.0), detail='', fc=None):
        per = 'post' if t >= cut else 'pre'
        return {'t': t, 'bot': bot, 'name': name, 'detail': detail, 'fc': fc, 'pos': pos, 'per': per,
                'arm': 'canary' if pool_of(bot) == 'board-d' else 'control', 'status': None}
    def pinned(bot, t0, t1, at=(0.0, 61.0, 0.0)):
        out = []
        t = t0
        while t < t1:
            out += [row(bot, t, pos=at), row(bot, t + 100, '_water_float', pos=at), row(bot, t + 200, pos=at), row(bot, t + 300, pos=at)]
            t += 600
        return out
    def moving(bot, t0, t1):
        return [row(bot, t, pos=(float(t % 997), 64.0, float(t % 991))) for t in range(int(t0), int(t1), 60)]
    pop = {('pre', 'canary'): {'board-d-Bravo', 'board-d-Delta'}, ('post', 'canary'): {'board-d-Bravo', 'board-d-Delta'},
           ('pre', 'control'): {'hive-a-Alpha'}, ('post', 'control'): {'hive-a-Alpha'}}
    base = pinned('board-d-Bravo', cut - W * 60, cut + 1200) + moving('board-d-Bravo', cut + 1200, cut + W * 60) + \
        moving('hive-a-Alpha', cut - W * 60, cut + W * 60) + moving('board-d-Delta', cut - W * 60, cut + W * 60)
    st = row('board-d-Bravo', cut + 900, '_poolescape_start', detail='id=a1 hook=climb at=0,61,0 tries=1')
    en = row('board-d-Bravo', cut + 960, '_poolescape', detail='id=a1 hook=climb outcome=out steps=1 rose=1.0 dug=1 placed=1 hands=stone_pickaxe marks=zone:0,fire:0,town:0 lava_refused=0 at=0,61,0')
    lic = row('board-d-Bravo', cut + 10, '_poolescape_mode', detail='on=1')
    ok = judge(base + [st, en, lic], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert ok['spell_fall'] == 1 and ok['exposure_ready'] == 1 and ok['instrument_control'] == 1, ok
    assert ok['fire_in_escape'] == 0 and ok['drown_in_escape'] == 0 and ok['claimed_out'] == 0 and ok['rows_control'] == 0, ok
    # G1 fails: still pinned after the deploy
    stuck = pinned('board-d-Bravo', cut - W * 60, cut + W * 60) + moving('hive-a-Alpha', cut - W * 60, cut + W * 60)
    bad = judge(stuck + [st, lic], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert bad['spell_fall'] == 0, bad
    # G2: a fire death 60 s after the end row; control: the same death 10 min later is outside the window
    f = judge(base + [st, en, lic, row('board-d-Bravo', cut + 1020, '_death', fc='fire')], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert f['fire_in_escape'] == 1, f
    f2 = judge(base + [st, en, lic, row('board-d-Bravo', cut + 1700, '_death', fc='fire')], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert f2['fire_in_escape'] == 0, f2
    # G2 with NO end row (died mid-firing): the window still covers it
    f3 = judge(base + [st, lic, row('board-d-Bravo', cut + 960, '_death', fc='fire')], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert f3['fire_in_escape'] == 1, f3
    # G3: drowning in the window
    d = judge(base + [st, en, lic, row('board-d-Bravo', cut + 950, '_death', fc='drowning')], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert d['drown_in_escape'] == 1, d
    # G4: claimed out but pinned at the spot 10-30 min later
    claimed = judge(pinned('board-d-Bravo', cut - W * 60, cut + W * 60) + moving('hive-a-Alpha', cut - W * 60, cut + W * 60) + [st, en, lic],
                    cut=cut, W=W, cans={'board-d'}, population=pop)
    assert claimed['claimed_out'] == 1, claimed
    assert ok['claimed_out'] == 0
    # ARMS: a control row after the deploy
    a = judge(base + [st, en, lic, row('hive-a-Alpha', cut + 50, '_poolescape_mode')], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert a['rows_control'] == 1, a
    # INSTRUMENT: no pinned bucket anywhere pre -> blind
    blind = judge(moving('board-d-Bravo', cut - W * 60, cut + W * 60) + moving('hive-a-Alpha', cut - W * 60, cut + W * 60) + [lic],
                  cut=cut, W=W, cans={'board-d'}, population=pop)
    assert blind['instrument_control'] == 0 and blind['exposure_ready'] == 0, blind
    # COVERAGE (Codex code r1 P2): pinned pre, licence + start + out right after the deploy, then SILENT -> G1 cannot pass
    silent = pinned('board-d-Bravo', cut - W * 60, cut + 600) + moving('hive-a-Alpha', cut - W * 60, cut + W * 60)
    sres = judge(silent + [st, en, lic], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert sres['spell_fall'] == 0 and sres['coverage_ok'] == 0 and sres['claimed_out_pending'] == 1, sres
    # ORDER (Codex code r1 P2): the same positions in any order classify the same
    pos3 = [(0.0, 61.0, 0.0), (2.0, 61.0, 0.0), (4.0, 61.0, 0.0)]
    import itertools
    verdicts = set()
    for perm in itertools.permutations(pos3):
        rs = [row('o-o-O', 10 + i, pos=p) for i, p in enumerate(perm)] + [row('o-o-O', 50, '_water_float', pos=None)]
        verdicts.add(buckets(rs)['o-o-O'][0])
    assert verdicts == {False}, verdicts
    # A DEATH ENDS A SPELL WITHOUT AN ESCAPE (Claude code r1 P2-4): pinned to cut+1200, dies there, then moves -> no fall
    died = base + [st, lic, row('board-d-Bravo', cut + 1150, '_death', fc='other')]
    dres = judge(died, cut=cut, W=W, cans={'board-d'}, population=pop)
    assert dres['spell_fall'] == 0, dres
    # SPARSE (Codex code r2 P2): pinned pre, then ONE position per bucket after the deploy -> not observed, G1 cannot pass
    sparse = pinned('board-d-Bravo', cut - W * 60, cut + 600) + [row('board-d-Bravo', t) for t in range(int(cut + 600), int(cut + W * 60), 600)] + \
        [row('board-d-Bravo', t + 50, '_water_float') for t in range(int(cut + 600), int(cut + W * 60), 600)] + moving('hive-a-Alpha', cut - W * 60, cut + W * 60)
    spres = judge(sparse + [st, en, lic], cut=cut, W=W, cans={'board-d'}, population=pop)
    assert spres['coverage_ok'] == 0 and spres['spell_fall'] == 0, spres
    # TWO death-extended spells never count a bucket twice (Codex code r2 P2)
    tr = {'b-c-D': {k: True for k in list(range(0, 4)) + list(range(6, 10))}}
    two = spells(tr, 0, 20 * BUCKET_S, {'b-c-D': [3.5 * BUCKET_S, 9.5 * BUCKET_S]})
    assert abs(two['b-c-D'] - 20 * BUCKET_S / 3600) < 1e-9, two
    # a moving bot that happens to log _water_float is never trapped (positions decide)
    assert not any(buckets(moving('x-y-Z', 0, 3600) + [row('x-y-Z', 100, '_water_float', pos=(5.0, 1.0, 5.0))])['x-y-Z'].values())
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    from lib.telemetry import Events
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
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 180)
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
    rows, walked, offbuild, withpos = [], 0, 0, 0
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
        bots[(per, arm)].add(b)
        pos = (r.get('bot') or {}).get('pos')
        p = (float(pos['x']), float(pos['y']), float(pos['z'])) if isinstance(pos, dict) and pos.get('x') is not None else None
        name = r.get('name')
        if p is not None:
            withpos += 1
        if p is not None or name in KEEP:
            sk = ((r.get('raw') or {}).get('skill') or {})
            rows.append({'t': t.timestamp(), 'per': per, 'arm': arm, 'name': name, 'status': sk.get('status'),
                         'detail': (r.get('detail') or '') if name in KEEP else '', 'bot': b, 'fc': sk.get('fail_class'), 'pos': p})
    res = judge(rows, cut=CUT.timestamp(), W=W, cans=CANS, population=bots)
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d; rows with bot.pos %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, offbuild, withpos, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0)))
    print('PRIMARY G1   marooned-water spell bot-h (pinned by bot.pos, >= 30 min) %s -> DiD per bot %s -> %s'
          % (res['spell_bh'], res['spell_did_per_bot'], 'FELL' if res['spell_fall'] else 'DID NOT FALL'))
    print('NAMED        %s | exits %s' % (json.dumps(res['named']), json.dumps(res['named_exit'])))
    print('COVERAGE     post-window position coverage of canary bots trapped pre %s -> %s (need >= %.2f each)'
          % (json.dumps(res['coverage_post']), 'ok' if res['coverage_ok'] else 'NOT MET (G1 cannot pass)', COVERAGE))
    print('SPELL BOTS   [pre, post] bot-h: %s' % json.dumps(res['spell_bots']))
    print('DEFECTS      G2 fire death in an escape window %d | G3 drowning/suffocation in one %d | G4 claimed out, still pinned %d (pending %d) | ARMS control rows %d'
          % (res['fire_in_escape'], res['drown_in_escape'], res['claimed_out'], res['claimed_out_pending'], res['rows_control']))
    print('LIVENESS     licence %d | firings %d | outcomes %s (yielded share %s) | hands %s | marks %s | lava refusals %d | drowning-rescue rows inside escape windows %d'
          % (res['licence_canary'], res['starts_canary'], res['outcomes'] or '-', res['yielded_share'], res['hands'] or '-', res['marks'] or '-', res['lava_refused'], res['rescue_rows_in_escape']))
    print('REPORTED     canary deaths %s' % (res['deaths_canary'] or '-'))
    print('EXPOSURE     -> %s (canary spell bot-h pre %.2f, need %.1f; firings %d) | INSTRUMENT -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['spell_bh']['pre_canary'], EXPOSURE_BH, res['starts_canary'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        emit('poolescaperead', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
