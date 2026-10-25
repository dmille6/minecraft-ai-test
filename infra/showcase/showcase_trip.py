#!/usr/bin/env python3
"""showcase_trip.py -- THE SHOWCASE TRIPWIRE READ (10.0.0.40, the progress lane: docs/reports/showcase-progress-lane-2026-10-25.md).

A tripwire, not a verdict: the showcase has one pool and no control, so it never decides KEEP. It decides whether the
showcase must STOP (or roll back the piece just deployed) because something the owner protects broke.

    showcase_trip.py read [--minutes 180] [--since ISO] [--zones-regions DIR] [--zones-baseline FILE] [--json OUT]
    showcase_trip.py zones-baseline --regions DIR --out FILE      the protected structures' cells, before the bots touch them
    showcase_trip.py zones-compare  --regions DIR --baseline FILE [--zone ID ...]
    showcase_trip.py selftest

Installed as /srv/showcase/trip/ with copies (from a named sha) of scripts/lib/telemetry.py (lib/), townplanread.py,
foundread.py and structcount.py beside it. Reads only: /var/log/mcai/showcase-*/skill-*.jsonl*, the pool directory
/var/lib/mcai/_pool-showcase (plan generations, protected-zones.json) and COPIES of region files (the timelapse mirror
/srv/showcase/timelapse/mirror/world/region covers x,z -512..511; the nightly /srv/showcase/backup-stage/showcase/world/region
covers the whole world). It never writes a block, a bot file or anything a bench script reads.

LINES (each with its denominator; a zero is printed beside the positive control that could have seen a presence)
  S0 LIVENESS     showcase bots with a skill row in the last 15 min (of 10), rows walked, the builds seen
  S1 DEATHS       `_death` rows, each named; bot-hours observed beside them. TRIP >= 4 inside ANY 180-min span (the fleet's
                  7-d 0.0195 / bot-h gives ~0.6 per 180 min on 10 bots; P(>= 4) ~ 0.3 %); WATCH 2-3 in a span
  S2 STUCK        bots with < 3 blocks of 3-D movement for >= 30 min, sampled with no gap > 5 min, to the window's end.
                  WATCH only, never a stop (Codex 10-25 P1: waiting at home is legal and is not evidence of a trap)
  S3 UNDER        a bot BELOW an underground zone inside its footprint (the trial chambers' named residual): WATCH,
                  and TRIP when still there >= 15 min with < 3 blocks moved
  S3 ZONES        Z1 a bot inside a protected box >= 15 min with < 3 blocks moved (TRIP, the dead end protectzone must never
                  make); Z2 >= 60 refusals by one bot in 10 min (WATCH: a remedy not taken); refusals by op (REPORTED)
  S4 INTEGRITY    every protected structure's cells (structure palette) vs the pre-start baseline: a cell REMOVED or changed
                  to another block name is a BREACH (TRIP); an unreadable chunk is UNKNOWN (WATCH, never OK)
  S5 TOWN PLAN    townplanread D1 chain_invalid, D2 invalid rows, D3 never hits, D4 plan cells in a zone/avoid box, D5 root
                  occupied; foundread G1 found lost, G2 off plan, G3 lid/unreachable, G4 shared side, G5 in a zone. Any > 0: TRIP
  REPORTED        plan generations, found outcomes, founding placements (the evidence the town is being founded)
VERDICT  TRIP (stop-bots.sh, or re-activate the previous release when a piece was just deployed) | WATCH | OK
"""
import argparse, collections, contextlib, datetime as dt, glob, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
POOL_DIR = '/var/lib/mcai/_pool-showcase'
LOGS = '/var/log/mcai/showcase-[A-Z]*/skill-*.jsonl*'
NAMES = ['showcase-' + n for n in 'Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno'.split()]
POOL = 'showcase'
# THE TWO EPOCHS (re-review 10-25, Codex P1 / Claude P2): the town's founding (plan + found history is read from here, so a
# placement never ages out of G1-G4) and the newest start of the bots (the 180-min read never reaches back past it, so a
# restart after a tripwire stop is not re-tripped by the rows that caused the stop). One ISO line each.
TOWN_SINCE = '/srv/showcase/trip/TOWN_SINCE'
RUN_SINCE = '/srv/showcase/trip/RUN_SINCE'
# S5 IS STICKY UNTIL A HUMAN ACKNOWLEDGES IT (verify-2 10-25, Codex P1: subtracting a "before the run" count is not sound --
# G1/G3 counts are not monotone, a replacement can cancel a new defect, and D4 is judged on the CURRENT plan files in both
# passes). Every defect is an ITEM (the reads' own list strings); the read TRIPs on any item not in ACK.json (a multiset), and
# prunes from ACK.json every acknowledged item that no longer appears, so a defect that goes away and comes back trips again.
# `showcase_trip.py ack --why "<...>"` acknowledges the current items (recovery, a human's step).
ACK = '/srv/showcase/trip/ACK.json'
MIRROR_MAX_AGE_MIN = 60
HEALTHZ = 'http://127.0.0.1:11612/healthz'
UTC = dt.timezone.utc

DEATH_TRIP, DEATH_WATCH = 4, 2
STUCK_MIN, STUCK_MOVE = 30, 3.0
TRAP_MIN, TRAP_MOVE = 15, 3.0
LOOP_N, LOOP_MIN = 60, 10
LIVE_MIN = 15
WORLD = [-30000000, -64, -30000000, 30000000, 320, 30000000]

# the structure palette: what a village or the trial chambers are built of and a bot could break or take (structcount's
# BUILT, the village paths, and the trial chambers' own blocks). Natural terrain is NOT here: the bots may dig dirt and
# stone that happen to lie inside a box only where protectzone lets them (survival), and that is not a breach.
TRIAL_RX = (r'tuff_bricks|tuff_brick_(slab|stairs|wall)|chiseled_tuff(_bricks)?|polished_tuff(_slab|_stairs|_wall)?|'
            r'(waxed_)?(exposed_|weathered_|oxidized_)?(copper_block|cut_copper(_slab|_stairs)?|copper_grate|copper_door|'
            r'copper_trapdoor|copper_bulb|chiseled_copper)|(waxed_)?(exposed_|weathered_|oxidized_)copper|'
            r'trial_spawner|vault|decorated_pot|heavy_core|'
            # re-review 10-25 (Codex P1 / Claude P3): every cauldron state (rain or snow fills one only with weather on; the
            # showcase runs doWeatherCycle false, checked 16:36Z), the trial chambers' plain tuff shapes, the village's logs
            # and mossy cobblestone
            r'(water_|lava_|powder_snow_)?cauldron|tuff_(stairs|slab|wall)|[a-z_]+_(log|wood)|mossy_cobblestone(_slab|_stairs|_wall)?')
# COPPER WEATHERS ON ITS OWN (seen 10-25 15:45Z, the first live read: two unwaxed copper_block cells of the trial chambers at
# 69..70,-2,134 read `exposed_copper` 30 min after the start, no bot near -- a false BREACH). A cell is compared by its CANONICAL
# name: the oxidation stage is dropped and `copper` (an oxidised block's base name) equals `copper_block`. Waxing never
# happens on its own, so `waxed_` stays part of the name.
OXID = re.compile(r'(exposed_|weathered_|oxidized_)')


CAULDRON = re.compile(r'^minecraft:(water_|lava_|powder_snow_)cauldron$')


def canon(name):
    n = OXID.sub('', name)
    if CAULDRON.match(n):
        return 'minecraft:cauldron'          # what is IN a cauldron is not the structure; the cauldron is
    return 'minecraft:copper_block' if n == 'minecraft:copper' else n


def struct_rx(built_rx):
    inner = built_rx.pattern[len('^minecraft:('):-len(')$')]
    return re.compile(r'^minecraft:(' + inner + r'|dirt_path|' + TRIAL_RX + r')$')


# ------------------------------------------------------------------------------------------------ pure decisions
def ts(s):
    t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    return t if t.tzinfo else t.replace(tzinfo=UTC)          # a naive epoch line is UTC, never a crash (verify P2)


def in_box(p, b):
    if not p:
        return False
    x, y, z = math.floor(float(p['x'])), math.floor(float(p['y'])), math.floor(float(p['z']))
    return b[0] <= x <= b[3] and b[1] <= y <= b[4] and b[2] <= z <= b[5]


def still_spells(rows, boxes, min_min, move, max_gap_min=None):
    """rows: one bot's [(t, pos)] sorted. -> [(start, end, minutes)] spells inside a box with < move blocks of horizontal
    displacement from the spell's first sample (protectzoneread.trapped's rule, with the end kept). Pure."""
    out, start, anchor, last = [], None, None, None
    for t, p in rows:
        inside = p is not None and any(in_box(p, b) for b in boxes)
        if inside and start is not None and max_gap_min is not None and last is not None and (t - last).total_seconds() / 60 > max_gap_min:
            if (last - start).total_seconds() / 60 >= min_min:
                out.append((start, last, (last - start).total_seconds() / 60))
            start, anchor = t, p          # a gap in the samples: what happened in it is unseen, so the spell restarts
        elif inside and start is None:
            start, anchor = t, p
        elif inside and math.dist((p['x'], p['y'], p['z']), (anchor['x'], anchor['y'], anchor['z'])) >= move:
            if last is not None and (last - start).total_seconds() / 60 >= min_min:
                out.append((start, last, (last - start).total_seconds() / 60))
            start, anchor = t, p
        elif not inside:
            if start is not None and last is not None and (last - start).total_seconds() / 60 >= min_min:
                out.append((start, last, (last - start).total_seconds() / 60))
            start = anchor = None
        last = t
    if start is not None and last is not None and (last - start).total_seconds() / 60 >= min_min:
        out.append((start, last, (last - start).total_seconds() / 60))
    return out


def stuck_now(by_bot, end, min_min=STUCK_MIN, move=STUCK_MOVE, slack_min=10):
    """by_bot: {bot: [(t, pos)] sorted}. -> {bot: minutes} for bots whose still spell runs to within slack of `end`. Pure."""
    out = {}
    for b, rows in by_bot.items():
        for s, e, m in still_spells(rows, [WORLD], min_min, move, max_gap_min=5):
            if (end - e).total_seconds() / 60 <= slack_min:
                out[b] = round(m)
    return out


def split_trapped(spells, refusals):
    """spells {bot: [(start, end, min)]} still inside a zone; refusals {bot: [(t, n)]} from `_protect_zone` minute rows.
    -> (trapped, still): a spell with a refusal inside it is a bot the guard is holding (Z1, TRIP); a spell with none is a bot
    standing still on legal ground -- a village path is walkable (verify 10-25, Claude P2-D) -- reported, WATCH. Pure."""
    trapped, still = {}, {}
    for b, sp in spells.items():
        for s_, e, m in sp:
            held = any(s_ <= t <= e and n > 0 for t, n in refusals.get(b, []))
            (trapped if held else still).setdefault(b, []).append((s_.strftime('%H:%M'), round(m)))
    return trapped, still


def death_peak(times, span_min=180):
    """times: death datetimes. -> the most deaths inside any span_min window. Pure."""
    t = sorted(times)
    best, j = 0, 0
    for i in range(len(t)):
        while (t[i] - t[j]).total_seconds() > span_min * 60:
            j += 1
        best = max(best, i - j + 1)
    return best


def under_boxes(zones):
    """underground zones (y0 above the world's bottom) -> the boxes BELOW them, down to the bottom. Pure."""
    return [[b[0], -64, b[2], b[3], b[1] - 1, b[5]] for _, b in zones if b[1] > -64]


def refusal_peak(minutes, span=LOOP_MIN):
    """minutes: one bot's [(t, refusals)]. -> the largest refusal sum inside any `span` minutes. Pure."""
    best, q = 0, []
    for t, k in sorted(minutes):
        q.append((t, k))
        while q and (t - q[0][0]).total_seconds() > span * 60:
            q.pop(0)
        best = max(best, sum(x for _, x in q))
    return best


def zone_diff(base, now):
    """base, now: {"x,y,z": name}. -> (removed, changed, added) as sorted lists of "x,y,z name". Pure.
    removed: a baseline structure cell whose block is no longer a structure block; changed: another structure block now."""
    removed = sorted('%s %s' % (k, v) for k, v in base.items() if k not in now)
    changed = sorted('%s %s->%s' % (k, v, now[k]) for k, v in base.items() if k in now and canon(now[k]) != canon(v))
    added = sorted('%s %s' % (k, v) for k, v in now.items() if k not in base)
    return removed, changed, added


def verdict(f):
    """f: the facts dict read() builds. -> (verdict, [reasons]). Pure: TRIP beats WATCH beats OK; UNKNOWN is never OK."""
    trip, watch = [], []
    if f['live_bots'] == 0 and f['expect_running'] and f.get('brain_paused'):
        watch.append('S0 no row in %d min while the brain is PAUSED (%s)' % (LIVE_MIN, f['brain_paused']))
    elif f['live_bots'] == 0 and f['expect_running']:
        trip.append('S0 no showcase bot wrote a row in %d min' % LIVE_MIN)
    elif f['live_bots'] < len(NAMES) and f['expect_running']:
        watch.append('S0 %d of %d bots wrote a row in %d min' % (f['live_bots'], len(NAMES), LIVE_MIN))
    if f['deaths'] >= DEATH_TRIP:
        trip.append('S1 %d deaths inside 180 min' % f['deaths'])
    elif f['deaths'] >= DEATH_WATCH:
        watch.append('S1 %d deaths inside 180 min' % f['deaths'])
    if f['stuck']:
        watch.append('S2 still >= %d min %s' % (STUCK_MIN, f['stuck']))
    if f.get('under_trapped'):
        trip.append('S3 UNDER trapped below an underground zone %s' % f['under_trapped'])
    elif f.get('under'):
        watch.append('S3 UNDER below an underground zone %s' % f['under'])
    if f['expect_running'] and f.get('window_min', 0) >= 60 and f.get('plan_towns') == 0 and not f['plan_error']:
        watch.append('S5 no accepted town plan after %d min (UNEXPOSED: zero defects mean nothing yet)' % f['window_min'])
    if f['trapped']:
        trip.append('S3 Z1 trapped in a zone %s' % f['trapped'])
    if f.get('still_in_zone'):
        watch.append('S3 still in a zone with no refusal (legal ground) %s' % f['still_in_zone'])
    if f.get('deep'):
        watch.append('S3 DEEP below a village floor (legal ground) %s' % f['deep'])
    if f.get('zones_error'):
        watch.append('S3 zones file unreadable (%s): Z1 / UNDER saw nothing' % f['zones_error'])
    if f.get('mirror_age_min') is None or f.get('mirror_age_min', 0) > MIRROR_MAX_AGE_MIN:
        watch.append('S4 the region copy is %s min old (max %d): integrity read on stale data' % (f.get('mirror_age_min'), MIRROR_MAX_AGE_MIN))
    if f.get('bad_files'):
        watch.append('S5 unreadable log files %s: the plan history is partial' % f['bad_files'][:3])
    if f.get('ack_error'):
        watch.append('S5 ACK.json problem (%s): it acknowledges nothing until fixed' % f['ack_error'])
    if f.get('run_since_missing'):
        watch.append('EPOCH no run epoch (%s): the read window may reach back past the last start' % RUN_SINCE)
    if f.get('gen_unknown'):
        watch.append('S5 rows naming an unknown plan generation %s' % f['gen_unknown'])
    if f['refusal_loops']:
        watch.append('S3 Z2 refusal loop %s' % f['refusal_loops'])
    integ = f['integrity']
    if integ is None:
        watch.append('S4 integrity not read (no baseline or no regions)')
    else:
        for zid, z in integ.items():
            if z['status'] == 'BREACH':
                trip.append('S4 %s BREACH removed %d changed %d %s' % (zid, z['removed_n'], z['changed_n'], (z['removed'] + z['changed'])[:3]))
            elif z['status'] == 'NOT COVERED':
                pass        # outside the read's region copy (the mirror): the daily compare on the nightly stage covers it
            elif z['status'] != 'INTACT':
                watch.append('S4 %s %s' % (zid, z['status']))
    for k, v in sorted(f['plan_defects'].items()):
        if v:
            trip.append('S5 %s %d' % (k, v))
    if f['plan_error']:
        watch.append('S5 the plan read failed: %s' % f['plan_error'])
    return ('TRIP' if trip else 'WATCH' if watch else 'OK'), trip + watch


# ------------------------------------------------------------------------------------------------ zones (region copies)
def zone_boxes(path=os.path.join(POOL_DIR, 'protected-zones.json')):
    d = json.load(open(path))
    return [(z['id'], z['box']) for z in d.get('zones') or [] if isinstance(z.get('box'), list) and len(z['box']) == 6]


def zone_floors(path=os.path.join(POOL_DIR, 'protected-zones.json')):
    d = json.load(open(path))
    return {z['id']: z.get('floor_y') for z in d.get('zones') or [] if isinstance(z.get('box'), list) and len(z['box']) == 6}


def closed_and_deep(zones, floors):
    """-> (closed boxes, deep boxes). Below a zone's floor_y protectzone lets a bot whose feet are also below it dig its way
    out (protectzone.mjs blockedIn): that DEEP part is legal ground for a bot already there (re-review 10-25, Claude P2-2),
    so Z1 judges only the part at or above the floor; the deep part is reported. Pure."""
    closed, deep = [], []
    for zid, b in zones:
        f = floors.get(zid)
        if f is not None and b[1] <= f - 1:
            closed.append([b[0], f, b[2], b[3], b[4], b[5]])
            deep.append([b[0], b[1], b[2], b[3], f - 1, b[5]])
        else:
            closed.append(list(b))
    return closed, deep


def scan_zone(world, rx, box):
    """-> ({"x,y,z": name} of structure cells inside box, {chunk status: n}). Reads only."""
    cells, st, okc = {}, collections.Counter(), []
    x0, y0, z0, x1, y1, z1 = box
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            d = world.chunk(cx, cz)
            st[world.chunkstat.get((cx, cz), '?')] += 1
            if world.chunkstat.get((cx, cz)) == 'ok':
                okc.append('%d,%d' % (cx, cz))
            if d is None:
                continue
            for x, y, z, n in world.cells_matching(cx, cz, rx, y0, y1):
                if x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1:
                    cells['%d,%d,%d' % (x, y, z)] = n
    st['undecoded'] = world.stats.get('undecoded_hit_sections', 0)
    st = dict(st)
    st['_ok_chunks'] = sorted(okc)
    return cells, st


def covered(regions, box):
    need = {(cx >> 5, cz >> 5) for cx in range(box[0] >> 4, (box[3] >> 4) + 1) for cz in range(box[2] >> 4, (box[5] >> 4) + 1)}
    return all(os.path.exists(os.path.join(regions, 'r.%d.%d.mca' % k)) for k in need)


def cmd_zones_baseline(a):
    import structcount as SC
    rx = struct_rx(SC.BUILT)
    out = {'t': dt.datetime.now(UTC).strftime('%FT%TZ'), 'regions': a.regions, 'zones': {}}
    for zid, box in zone_boxes(a.zones_file):
        if not covered(a.regions, box):
            out['zones'][zid] = {'box': box, 'status': 'NOT COVERED'}
            print('  %-24s not covered by %s' % (zid, a.regions))
            continue
        cells, st = scan_zone(SC.World(a.regions), rx, box)
        out['zones'][zid] = {'box': box, 'n': len(cells), 'chunks': st, 'cells': cells}
        print('  %-24s %6d structure cells  chunks ok %d undecoded %d' % (zid, len(cells), len(st['_ok_chunks']), st['undecoded']))
    tmp = a.out + '.part'
    with open(tmp, 'w') as f:
        json.dump(out, f)
    os.replace(tmp, a.out)
    print('baseline written', a.out)
    return 0


def integrity(regions, baseline_path, only=None):
    import structcount as SC
    rx = struct_rx(SC.BUILT)
    base = json.load(open(baseline_path))
    res = {}
    for zid, b in base['zones'].items():
        if only and zid not in only:
            continue
        if 'cells' not in b:
            res[zid] = {'status': 'NO BASELINE'}
            continue
        if not covered(regions, b['box']):
            res[zid] = {'status': 'NOT COVERED'}
            continue
        cells, st = scan_zone(SC.World(regions), rx, b['box'])
        nb = len(range(b['box'][0] >> 4, (b['box'][3] >> 4) + 1)) * len(range(b['box'][2] >> 4, (b['box'][5] >> 4) + 1))
        if (st['_ok_chunks'] != b['chunks'].get('_ok_chunks') or len(st['_ok_chunks']) != nb or st.get('undecoded')
                or b['chunks'].get('undecoded')):
            # every chunk of the box readable NOW and in the baseline, the same chunks, nothing undecoded -- else UNKNOWN
            res[zid] = {'status': 'UNKNOWN (ok chunks now %d, baseline %d, box %d, undecoded %s/%s)' % (
                len(st['_ok_chunks']), len(b['chunks'].get('_ok_chunks') or []), nb, st.get('undecoded'), b['chunks'].get('undecoded'))}
            continue
        removed, changed, added = zone_diff(b['cells'], cells)
        res[zid] = {'status': 'BREACH' if removed or changed else 'INTACT', 'base_n': b['n'], 'now_n': len(cells),
                    'removed_n': len(removed), 'changed_n': len(changed), 'added_n': len(added),
                    'removed': removed[:20], 'changed': changed[:20], 'added': added[:20]}
    return res


def region_age_min(regions):
    try:
        newest = max(os.path.getmtime(f) for f in glob.glob(os.path.join(regions, 'r.*.mca')))
    except ValueError:
        return None
    return round((dt.datetime.now(UTC).timestamp() - newest) / 60)


def cmd_zones_compare(a):
    res = integrity(a.regions, a.baseline, a.zone)
    for zid, z in res.items():
        print('  %-24s %s %s' % (zid, z['status'], {k: v for k, v in z.items() if k.endswith('_n')}))
        for k in ('removed', 'changed', 'added'):
            if z.get(k):
                print('      %s %s' % (k, z[k][:5]))
    if any(z['status'] == 'BREACH' for z in res.values()):
        return 3                    # 3, so a crash (1) is never read as one
    age = region_age_min(a.regions)
    if age is None or age > a.max_age_min:
        print('  STALE: the newest region file in %s is %s min old (max %d): this compare saw old data' % (a.regions, age, a.max_age_min))
        return 4
    if any(z['status'] != 'INTACT' for z in res.values()):
        return 4                    # blind somewhere (NOT COVERED / UNKNOWN / NO BASELINE): a WATCH, never a stop
    return 0


# ------------------------------------------------------------------------------------------------ the read
@contextlib.contextmanager
def showcase_pools(*mods):
    """ONE SHARED TOWN, BOT IDENTITY KEPT (re-review 10-25, Codex P1 + Claude P3: the r2 rewrite set bot='showcase' on every
    row, which made D5's "the root writer's own first audit" read anyone's). The reads' pool_of('showcase-Alpha') is
    'showcase-Alpha' (two dash parts); here it answers 'showcase' for every showcase bot, so the plan maps (keyed by
    pool_of_dir('_pool-showcase') = 'showcase') match, G4 sees two bots' chests side by side, G1/G3 read every bot's audits,
    and every per-bot key ((pool, bot) in D5) still holds the real bot. The reads themselves are unchanged."""
    olds = [m.pool_of for m in mods]
    orig = olds[0]
    f = lambda b: POOL if (b == POOL or str(b or '').startswith(POOL + '-')) else orig(b)
    for m in mods:
        m.pool_of = f
    try:
        yield
    finally:
        for m, o in zip(mods, olds):
            m.pool_of = o


def plan_read(rows, since, plans=None):
    """townplanread's D-gates and foundread's G-gates over the showcase pool, every showcase bot on the canary arm. `rows`
    must reach back to the town's founding (TOWN_SINCE): foundread builds its placement set from `_found` rows, so a window
    that drops a placement drops its G1-G4 cover (re-review 10-25 P1)."""
    import townplanread as TP
    import foundread as FD
    ms = int(since.timestamp() * 1000)
    if plans is None:
        plans = {POOL: v for k, v in TP.read_plans().items() if k == POOL}
    with showcase_pools(TP, FD):
        pl = TP.judge_plans(plans, {POOL}, ms)
        mark = lambda r: dict(r, arm='canary', per='post')
        rw, lists = TP.judge_rows([mark(r) for r in rows if r['name'] in TP.ROW_KINDS], since, pl['_gen_index'], pl['_rejected'])
        acc, zones = {}, {}
        for pool, keys in plans.items():
            for key, info in keys.items():
                for wkey, files in info['worlds'].items():
                    world = json.loads(wkey) if wkey != '"__unparseable__"' else None
                    head, a_, _, _ = TP.walk(files, world)
                    if head is not None:
                        acc.setdefault(POOL, []).extend(a_)
                        zones.setdefault(POOL, []).extend(TP.zones_of(info['dir'], world))
        fo, flists = FD.judge([mark(r) for r in rows if r['name'] in FD.ROW_KINDS], acc, zones)
    defects = {'D1 chain_invalid': pl['chain_invalid'] + rw.get('chain_invalid', 0), 'D2 invalid_rows': rw.get('invalid_rows', 0),
               'D3 never_hits': rw.get('never_hits', 0), 'D4 zone_cells': pl['zone_cells'], 'D5 root_occupied': rw.get('root_occupied', 0),
               'G1 found_lost': fo.get('found_lost', 0), 'G2 off_plan': fo.get('off_plan', 0), 'G3 lid_unreach': fo.get('lid_unreach', 0),
               'G4 shared_side': fo.get('shared_side', 0), 'G5 zone': fo.get('zone', 0)}
    report = {'towns': pl['_towns'], 'plan_towns': pl['plan_towns_canary'], 'gens': len(pl['_gen_index']), 'plan_rows': rw.get('rows_townplan_canary', 0),
              'ops': {k[3:]: v for k, v in sorted(rw.items()) if k.startswith('op_')},
              'found_rows': fo.get('rows_found_canary', 0), 'found_placed': fo.get('found_placed', 0),
              'found_work_placed': fo.get('found_work_placed', 0), 'found_store_placed': fo.get('found_store_placed', 0),
              'found_outcomes': {k[8:]: v for k, v in sorted(fo.items()) if k.startswith('outcome_')},
              'found_why': flists.get('why', [])[:6], 'lists': {k: v[:3] for k, v in {**lists, **flists}.items() if v},
              'gen_unknown': {k: v for k, v in (('adopt_gen_unknown', rw.get('adopt_gen_unknown', 0)),
                                                ('found_gen_unknown', fo.get('found_gen_unknown', 0))) if v}}
    items = {'D1 chain_invalid': pl['_lists'].get('invalid', []) + lists.get('invalid', []),
             'D2 invalid_rows': lists.get('invalid_rows', []), 'D3 never_hits': lists.get('never_hits', []),
             'D4 zone_cells': ['%s head g%s' % (x, report['gens']) for x in pl['_lists'].get('zone', [])],
             'D5 root_occupied': lists.get('root_occupied', []),
             'G1 found_lost': flists.get('lost', []), 'G2 off_plan': flists.get('off_plan', []),
             'G3 lid_unreach': flists.get('lid_unreach', []), 'G4 shared_side': flists.get('shared_side', []),
             'G5 zone': flists.get('zone', [])}
    report['items'] = defect_items(defects, items)
    return defects, report


@contextlib.contextmanager
def ack_lock(path):
    """One writer at a time for ACK.json (verify-3, Codex P1: the read's prune and `ack` shared an unlocked tmp file)."""
    import fcntl
    with open(path + '.lock', 'a') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def ack_write(path, d):
    tmp = '%s.%d.part' % (path, os.getpid())
    with open(tmp, 'w') as f:
        json.dump(d, f, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def defect_items(counts, lists):
    """{gate: n}, {gate: [item]} -> {gate: [item]} with exactly n items per gate: a count the read did not list gets
    `<gate> unlisted #i` items, so no counted defect can hide behind a missing list entry. Pure."""
    out = {}
    for g, n in counts.items():
        it = list(lists.get(g, []))[:n] if n else []
        out[g] = it + ['%s unlisted #%d' % (g, i) for i in range(len(it), n)]
    return out


def unacked(items, ack):
    """{gate: [item]}, {gate: [item]} -> (new {gate: [item]}, pruned ack {gate: [item]}). Multisets: two identical items
    need two acknowledgements; an acknowledged item no longer present is dropped from the ack. Pure."""
    new, keep = {}, {}
    for g, it in items.items():
        have = collections.Counter(it)
        a = collections.Counter((ack or {}).get(g, []))
        extra = have - a
        if extra:
            new[g] = sorted(extra.elements())
        k = a & have
        if k:
            keep[g] = sorted(k.elements())
    return new, keep


def new_defects(full, before):
    """{gate: n} over the whole history, and over the history BEFORE this run's start -> the defects whose evidence arrived
    during this run (verify 10-25, Codex P1: a defect from before a stop must not re-trip the restart, while the placements
    from before it keep their G1-G4 cover). Every gate counts evidence rows, so adding rows never lowers a count. Pure."""
    return {k: max(0, v - before.get(k, 0)) for k, v in full.items()}


def plan_rows(since, paths=LOGS):
    """The plan / found history since the town epoch, STREAMED (verify 10-25, Claude P2-B: Events.load keeps every row and its
    raw dict, ~180k rows a day, so an hourly read from the founding would grow toward GBs on the live VM). Only lines naming
    one of the reads' row kinds are parsed, and only the fields the reads use are kept. Rotated files are read too
    (telemetry.open_log), and a file older than `since` is skipped by its mtime, as Events.load does.
    -> (rows, {'files', 'lines', 'kept'}) -- the denominators."""
    import townplanread as TP
    import foundread as FD
    from lib.telemetry import open_log
    kinds = set(TP.ROW_KINDS) | set(FD.ROW_KINDS)
    needle = re.compile(rb'"name"\s*:\s*"(' + b'|'.join(re.escape(k.encode()) for k in sorted(kinds)) + rb')"')
    rows, n_files, n_lines, bad = [], 0, 0, []
    for f in sorted(glob.glob(paths)):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), UTC) < since:
                continue
        except OSError:
            continue
        n_files += 1
        try:
            fh = open_log(f)
        except Exception as e:
            bad.append('%s: %s' % (os.path.basename(f), type(e).__name__))
            continue
        try:
          for line in fh:
                n_lines += 1
                lb = line.encode() if isinstance(line, str) else line
                if not needle.search(lb):
                    continue
                try:
                    d = json.loads(line)
                    sk = d.get('skill') or {}
                    t = ts(d.get('@timestamp'))
                except Exception:
                    continue
                b = (d.get('bot') or {}).get('name')
                if t < since or b not in NAMES or sk.get('name') not in kinds:
                    continue
                rows.append({'t': t, 'name': sk['name'], 'status': sk.get('status'), 'detail': sk.get('detail') or '', 'bot': b,
                             'item': (sk.get('args') or {}).get('item') if isinstance(sk.get('args'), dict) else None})
        except Exception as e:      # a corrupt archive is named; the readable files are still judged
            bad.append('%s: %s' % (os.path.basename(f), type(e).__name__))
        finally:
            try:
                fh.close()
            except Exception:
                pass
    return rows, {'files': n_files, 'lines': n_lines, 'kept': len(rows), 'bad_files': bad}


def read_epoch(path):
    try:
        return ts(open(path).read().strip())
    except (OSError, ValueError):
        return None


def brain_paused():
    """-> None when the brain proxy answers ok, else the reason (a pause file, an error). Never raises."""
    import urllib.request, urllib.error
    try:
        d = json.loads(urllib.request.urlopen(HEALTHZ, timeout=8).read())
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read())
        except ValueError:
            d = {'ok': False, 'error': 'http %d' % e.code}
    except Exception as e:
        d = {'ok': False, 'error': str(e)[:80]}
    return None if d.get('ok') is True else str(d.get('paused') or d.get('error') or d)[:120]


def dedupe_deaths(rows, gap_s=10):
    """[(t, bot, detail)] -> the same, one per bot within gap_s (the fleet's re-death rows). Pure."""
    out, last = [], {}
    for t, b, d in sorted(rows):
        if b in last and (t - last[b]).total_seconds() <= gap_s:
            continue
        out.append((t, b, d))
        last[b] = t
    return out


def cmd_read(a):
    from lib.telemetry import Events
    now = dt.datetime.now(UTC)
    run_since, town_since = read_epoch(a.run_since), read_epoch(a.town_since)
    since = ts(a.since) if a.since else max([now - dt.timedelta(minutes=a.minutes)] + ([run_since] if run_since else []))
    ev = Events.load(paths=LOGS, since=since)
    rows, by_bot, mins, builds = [], collections.defaultdict(list), collections.defaultdict(list), collections.Counter()
    death_rows, refused_by_op, newest = [], collections.Counter(), {}
    for r in ev.rows:
        b = (r.get('bot') or {}).get('name')
        if b not in NAMES:
            continue
        raw = r.get('raw') or {}
        sk = raw.get('skill') or {}
        rows.append({'t': r['t'], 'name': r['name'], 'status': sk.get('status'), 'detail': r.get('detail') or '', 'bot': b,
                     'item': (sk.get('args') or {}).get('item') if isinstance(sk.get('args'), dict) else None})
        by_bot[b].append((r['t'], (raw.get('bot') or {}).get('pos')))
        builds[((raw.get('code') or {}).get('version') or '?')[:15]] += 1
        newest[b] = max(newest.get(b, r['t']), r['t'])
        if r['name'] == '_death':
            death_rows.append((r['t'], b, (r.get('detail') or '')[:90]))
        if r['name'] == '_protect_zone':
            kvs = dict(re.findall(r'(?:^| )([a-z_]+)=(\d+)', r.get('detail') or ''))
            n = sum(int(kvs.get(k, 0)) for k in ('dig', 'place', 'use', 'open', 'sleep', 'craft'))
            mins[b].append((r['t'], n))
            for k, v in kvs.items():
                refused_by_op[k] += int(v)
    death_rows = dedupe_deaths(death_rows)
    deaths = ['%s %s %s' % (b, t.strftime('%H:%M:%S'), d) for t, b, d in death_rows]
    death_t = [t for t, _, _ in death_rows]
    for b in by_bot:
        by_bot[b].sort(key=lambda x: x[0])
    end = min(now, max([t for v in by_bot.values() for t, _ in v], default=now))
    boxes, floors, zones_error = [], {}, None
    try:
        boxes, floors = zone_boxes(a.zones_file), zone_floors(a.zones_file)
        if not boxes:
            zones_error = 'no zone in the file'
    except Exception as e:
        zones_error = '%s: %s' % (type(e).__name__, str(e)[:80])
    closed, deepb = closed_and_deep(boxes, floors)
    spells = {b: still_spells(v, closed, TRAP_MIN, TRAP_MOVE, max_gap_min=5) for b, v in by_bot.items()}
    trapped, still_in_zone = split_trapped(spells, mins)
    deep = {b: sum(1 for _, p in v if p and any(in_box(p, x) for x in deepb)) for b, v in by_bot.items()}
    deep = {b: n for b, n in deep.items() if n}
    loops = {b: refusal_peak(v) for b, v in mins.items() if refusal_peak(v) >= LOOP_N}
    ub = under_boxes(boxes)
    under = {b: sum(1 for _, p in v if p and any(in_box(p, x) for x in ub)) for b, v in by_bot.items()}
    under = {b: n for b, n in under.items() if n}
    under_trapped = {b: [(s.strftime('%H:%M'), round(m)) for s, _, m in still_spells(v, ub, TRAP_MIN, TRAP_MOVE, max_gap_min=5)] for b, v in by_bot.items()}
    under_trapped = {b: v for b, v in under_trapped.items() if v}
    bot_h = sum((v[-1][0] - v[0][0]).total_seconds() / 3600 for v in by_bot.values() if v)
    integ = None
    if a.zones_baseline and os.path.exists(a.zones_baseline) and a.zones_regions:
        try:
            integ = integrity(a.zones_regions, a.zones_baseline)
        except Exception as e:
            print('integrity read failed: %s' % e)
    plan_err, defects, report = None, {}, {}
    try:
        if town_since is None:
            raise RuntimeError('no town epoch in %s: the plan gates need the history from the founding' % a.town_since)
        prows, hist = plan_rows(town_since)
        report_hist = hist
        full, report = plan_read(prows, town_since)
        report['history'] = report_hist
        # a bad file is a WATCH beside the verdict, never a reason to drop the defects the readable history shows
        report['bad_files'] = hist.get('bad_files') or []
        with ack_lock(a.ack):
            ackd = {}
            if os.path.exists(a.ack):
                try:
                    ackd = json.load(open(a.ack)).get('items') or {}
                except Exception as e:
                    ackd = {}            # an unreadable ACK acknowledges NOTHING: every defect trips (fail closed)
                    report['ack_error'] = str(e)[:80]
            new, keep = unacked(report['items'], ackd)
            defects = {g: len(new.get(g, [])) for g in full}
            report['acked'] = {g: v for g, v in keep.items() if v}
            report['new_items'] = new
            if ackd and keep != {g: v for g, v in ackd.items() if v}:
                # pruned in EVERY read, stopped or not (verify-3: a defect repaired while stopped must re-arm)
                try:
                    d = json.load(open(a.ack))
                    d['items'] = keep
                    d.setdefault('pruned', []).append(now.strftime('%FT%TZ'))
                    ack_write(a.ack, d)
                except Exception as e:
                    report['ack_error'] = 'prune failed: %s' % str(e)[:80]
    except Exception as e:
        plan_err = '%s: %s' % (type(e).__name__, str(e)[:200])
    paused = brain_paused() if not a.not_running else None
    first = min([v[0][0] for v in by_bot.values() if v], default=now)
    live = sum(1 for b in NAMES if b in newest and (now - newest[b]).total_seconds() <= LIVE_MIN * 60)
    facts = {'run_since_missing': run_since is None and not a.since,
             'bad_files': (report or {}).get('bad_files'), 'ack_error': (report or {}).get('ack_error'),
             'still_in_zone': still_in_zone,
             'live_bots': live, 'expect_running': not a.not_running, 'deaths': death_peak(death_t), 'deaths_total': len(deaths),
             'bot_h': round(bot_h, 1), 'under': under, 'under_trapped': under_trapped, 'deep': deep, 'zones_error': zones_error,
             'mirror_age_min': region_age_min(a.zones_regions), 'gen_unknown': (report or {}).get('gen_unknown'),
             'brain_paused': paused,
             'window_min': round((now - first).total_seconds() / 60), 'plan_towns': (report or {}).get('plan_towns'),
             'stuck': stuck_now(by_bot, end),
             'trapped': trapped, 'refusal_loops': loops, 'integrity': integ, 'plan_defects': defects, 'plan_error': plan_err}
    v, why = verdict(facts)
    W = (now - since).total_seconds() / 60
    print('SHOWCASE TRIPWIRE %s  window %s .. %s (%d min)' % (now.strftime('%FT%TZ'), since.strftime('%FT%TZ'), now.strftime('%H:%M:%SZ'), W))
    print('DENOMINATORS rows walked %d | bots with rows %d of %d | builds %s | positions %d' % (
        len(rows), len(by_bot), len(NAMES), dict(builds), sum(1 for v in by_bot.values() for _, p in v if p)))
    print('EPOCHS       run since %s, town since %s (plan gates read from the town epoch)' % (run_since, town_since))
    print('S0 LIVENESS  %d of %d bots wrote a row in the last %d min | brain %s' % (live, len(NAMES), LIVE_MIN, paused or 'ok'))
    print('S1 DEATHS    %d in the window, at most %d inside 180 min, over %.1f bot-h observed (fleet 0.0195/bot-h -> %.2f expected) %s' % (
        len(deaths), facts['deaths'], bot_h, 0.0195 * bot_h, deaths[:6]))
    print('S2 STUCK     %s (still >= %d min, < %.0f blocks, to the window end)' % (facts['stuck'] or 'none', STUCK_MIN, STUCK_MOVE))
    print('S3 UNDER     samples below an underground zone %s | trapped there %s | DEEP (below a village floor) %s' % (
        under or 'none', under_trapped or 'none', deep or 'none'))
    print('S3 ZONES     zones %d | Z1 trapped %s | Z2 refusal loops %s | refusals by op %s (minute rows %d)' % (
        len(boxes), trapped or 'none', loops or 'none', dict(refused_by_op), sum(len(v) for v in mins.values())))
    print('S4 REGIONS   %s, newest file %s min old' % (a.zones_regions, facts['mirror_age_min']))
    if integ is None:
        print('S4 INTEGRITY not read (baseline %s, regions %s)' % (a.zones_baseline, a.zones_regions))
    else:
        for zid, z in integ.items():
            print('S4 INTEGRITY %-24s %s %s' % (zid, z['status'], {k: v for k, v in z.items() if k.endswith('_n')}))
    print('S5 TOWN PLAN %s%s' % (defects, (' | READ FAILED ' + plan_err) if plan_err else ''))
    if report:
        print('EXPOSURE     towns with an accepted plan %d, accepted generations %d, found placements %d%s' % (
            report['plan_towns'], report['gens'], report['found_placed'], '' if report['plan_towns'] else ' -- UNEXPOSED: zero defects mean nothing yet'))
        print('REPORTED     plans %s' % (report['towns'] or 'none'))
        print('             _townplan rows %d ops %s | _found rows %d placed %d (work %d, store %d) outcomes %s' % (
            report['plan_rows'], report['ops'], report['found_rows'], report['found_placed'], report['found_work_placed'],
            report['found_store_placed'], report['found_outcomes']))
        if report['found_why']:
            print('             found refusals %s' % report['found_why'])
        if report['lists']:
            print('             lists %s' % report['lists'])
        if report.get('history'):
            print('             history from the town epoch: %s' % report['history'])
        if report.get('bad_files'):
            print('             UNREADABLE log files %s' % report['bad_files'][:5])
        if report.get('acked'):
            print('             ACKNOWLEDGED (not judged again until they go away and come back): %s' % report['acked'])
        if report.get('new_items'):
            print('             NEW defect items %s' % report['new_items'])
    print('VERDICT      %s%s' % (v, (' -- ' + '; '.join(why)) if why else ''))
    if a.json:
        try:                        # a failed write must never turn a TRIP into a crash (rc 1 -> no stop)
            with open(a.json, 'w') as f:
                json.dump({'t': now.strftime('%FT%TZ'), 'since': since.strftime('%FT%TZ'), 'verdict': v, 'why': why,
                           'facts': facts, 'report': report, 'rows': len(rows), 'builds': dict(builds)}, f, default=str)
        except Exception as e:
            print('json write failed: %s' % e)
    return {'OK': 0, 'WATCH': 0, 'TRIP': 2}[v]


# ------------------------------------------------------------------------------------------------ selftest
def plan_selftest(T):
    """plan_read over fixtures (re-review 10-25: the r2 shared-pool rewrite was never run through the reads). Needs
    townplanread.py + foundread.py beside this file; skipped (said so) without them."""
    try:
        import townplanread as TP, foundread as FD  # noqa: F401
    except ImportError:
        print('selftest: townplanread/foundread not beside this file -- plan_read checks skipped')
        return
    R = lambda name, detail, bot, m: {'t': T(m), 'name': name, 'detail': detail, 'bot': bot, 'status': 'success', 'item': None}
    plan = {'gen': 1, 'at': 0, 'plots': [{'id': 'store', 'kind': 'storehouse', 'box': [7, -4, 15, 4],
            'cells': [{'at': [9, 64, -2], 'kind': 'chest', 'state': 'placed'}, {'at': [9, 64, -1], 'kind': 'chest', 'state': 'placed'}]}],
            'transitions': []}
    with showcase_pools(TP, FD):
        root = R('_townplan', 'op=root result=accepted gen=1', 'showcase-Alpha', 0)
        other_occ = [root, R('_townplan_audit', 'placed=0 occupied=2 free=10', 'showcase-Bravo', 0.5),
                     R('_townplan_audit', 'placed=0 occupied=0 free=12', 'showcase-Alpha', 1)]
        own_occ = [root, R('_townplan_audit', 'placed=0 occupied=0', 'showcase-Bravo', 0.5),
                   R('_townplan_audit', 'placed=0 occupied=3', 'showcase-Alpha', 1)]
        mark = lambda rs: [dict(r, arm='canary', per='post') for r in rs]
        d_other = TP.judge_rows(mark(other_occ), T(0), {}, {})[0].get('root_occupied', 0)
        d_own = TP.judge_rows(mark(own_occ), T(0), {}, {})[0].get('root_occupied', 0)
        assert (d_other, d_own) == (0, 1), 'D5 judges the ROOT WRITER\'s own first audit: other bot %d, own %d' % (d_other, d_own)
        fr = [R('_found', 'order=F2 kind=chest outcome=placed at=9,64,-2 gen=1', 'showcase-Alpha', 1),
              R('_found', 'order=F2 kind=chest outcome=placed at=9,64,-1 gen=1', 'showcase-Bravo', 2)]
        g4 = FD.judge(mark(fr), {POOL: [(1, plan)]}, {})[0].get('shared_side', 0)
        assert g4 == 1, 'G4 sees two BOTS\' chests side by side in one town (%d)' % g4
        aud = [R('_townplan_audit', 'placed=1 missing=1 first=missing:chest@9,64,-2', 'showcase-Comet', 400)]
        g1 = FD.judge(mark(fr + aud), {POOL: [(1, plan)]}, {})[0].get('found_lost', 0)
        assert g1 == 1, 'G1: a placement 400 min old, then read missing, is lost (the read takes rows from the town epoch) (%d)' % g1
        assert FD.judge(mark(aud), {POOL: [(1, plan)]}, {})[0].get('found_lost', 0) == 0, 'positive control: without the placement row G1 is blind'
    assert TP.pool_of('showcase-Alpha') == 'showcase-Alpha', 'the module is restored after the read'
    print('selftest: plan_read identity + shared pool + history checked (D5, G4, G1)')


def selftest():
    T = lambda m: dt.datetime(2026, 10, 25, 12, 0, tzinfo=UTC) + dt.timedelta(minutes=m)
    P = lambda x, z, y=70: {'x': x, 'y': y, 'z': z}
    still = [(T(m), P(0.5, 0.5)) for m in range(0, 41, 2)]
    moving = [(T(m), P(m * 2, 0)) for m in range(0, 41, 2)]
    assert stuck_now({'a': still, 'b': moving}, T(40)) == {'a': 40}, 'a still bot is stuck; a moving one is not (positive control)'
    early = [(T(m), P(0.5, 0.5)) for m in range(0, 35)] + [(T(m), P(m * 3, 0)) for m in range(35, 80)]
    assert stuck_now({'a': early}, T(80)) == {}, 'a spell that ended long before the window end is not "stuck now"'
    box = [10, 60, 10, 20, 80, 20]
    inside = [(T(m), P(15, 15)) for m in range(0, 20)]
    assert still_spells(inside, [box], TRAP_MIN, TRAP_MOVE), 'still inside a box >= 15 min: trapped'
    assert not still_spells([(t, P(30, 30)) for t, _ in inside], [box], TRAP_MIN, TRAP_MOVE), 'still OUTSIDE is not trapped'
    assert refusal_peak([(T(0), 30), (T(5), 31), (T(30), 5)]) == 61 and refusal_peak([(T(0), 30), (T(20), 31)]) == 31
    rm, ch, ad = zone_diff({'1,2,3': 'minecraft:bell', '4,5,6': 'minecraft:oak_door'}, {'4,5,6': 'minecraft:oak_door', '7,8,9': 'minecraft:torch'})
    assert rm == ['1,2,3 minecraft:bell'] and ch == [] and ad == ['7,8,9 minecraft:torch']
    assert zone_diff({'1,1,1': 'minecraft:chest'}, {'1,1,1': 'minecraft:barrel'})[1] == ['1,1,1 minecraft:chest->minecraft:barrel']
    assert zone_diff({'1,1,1': 'minecraft:copper_block', '2,2,2': 'minecraft:cut_copper'},
                     {'1,1,1': 'minecraft:exposed_copper', '2,2,2': 'minecraft:oxidized_cut_copper'}) == ([], [], []), 'weathering is not a breach'
    assert zone_diff({'1,1,1': 'minecraft:waxed_copper_block'}, {'1,1,1': 'minecraft:copper_block'})[1], 'losing the wax is a change'
    base = {'live_bots': 10, 'expect_running': True, 'deaths': 0, 'stuck': {}, 'trapped': {}, 'refusal_loops': {}, 'mirror_age_min': 10,
            'integrity': {'v': {'status': 'INTACT'}}, 'plan_defects': {'D1 chain_invalid': 0}, 'plan_error': None}
    assert verdict(base) == ('OK', [])
    assert death_peak([T(0), T(10), T(170), T(179)]) == 4 and death_peak([T(0), T(10), T(200), T(390)]) == 2
    gap = [(T(m), P(0.5, 0.5)) for m in (0, 2, 4, 20, 22, 24, 26, 28, 30, 32, 34)]
    assert stuck_now({'a': gap}, T(34)) == {}, 'a 16-min sample gap restarts the spell: no 30 min seen'
    climb = [(T(m), P(0.5, 0.5, 70 + m)) for m in range(0, 41, 2)]
    assert stuck_now({'a': climb}, T(40)) == {}, 'vertical movement is movement'
    ub = under_boxes([('t', [-20, -47, 65, 88, 31, 164]), ('v', [0, -64, 0, 9, 90, 9])])
    assert ub == [[-20, -64, 65, 88, -48, 164]], ub
    assert in_box(P(30, 100, -50), ub[0]) and not in_box(P(30, 100, -47), ub[0])
    assert verdict(dict(base, under={'a': 3}))[0] == 'WATCH' and verdict(dict(base, under_trapped={'a': [('12:00', 20)]}))[0] == 'TRIP'
    assert verdict(dict(base, window_min=90, plan_towns=0))[0] == 'WATCH' and verdict(dict(base, window_min=30, plan_towns=0))[0] == 'OK'
    base = dict(base, mirror_age_min=10)
    assert verdict(dict(base, mirror_age_min=90))[0] == 'WATCH' and verdict(dict(base, mirror_age_min=None))[0] == 'WATCH'
    assert verdict(dict(base, zones_error='no zone'))[0] == 'WATCH' and verdict(dict(base, deep={'a': 9}))[0] == 'WATCH'
    assert verdict(dict(base, live_bots=0, brain_paused='GPU_RESERVED'))[0] == 'WATCH', 'a paused brain is not a dead showcase'
    assert verdict(dict(base, gen_unknown={'found_gen_unknown': 1}))[0] == 'WATCH'
    cl, dp = closed_and_deep([('v', [0, -64, 0, 9, 90, 9]), ('t', [-20, -47, 65, 88, 31, 164])], {'v': 54, 't': None})
    assert cl == [[0, 54, 0, 9, 90, 9], [-20, -47, 65, 88, 31, 164]] and dp == [[0, -64, 0, 9, 53, 9]]
    still_deep = [(T(m), P(5, 5, 20)) for m in range(0, 30)]
    assert not still_spells(still_deep, cl, TRAP_MIN, TRAP_MOVE, 5), 'a bot still in the deep part of a village column is not Z1'
    assert still_spells([(T(m), P(5, 5, 70)) for m in range(0, 30)], cl, TRAP_MIN, TRAP_MOVE, 5), 'still in the village itself is'
    assert not still_spells([(T(0), P(5, 5, 70)), (T(16), P(5, 5, 70))], cl, TRAP_MIN, TRAP_MOVE, 5), 'a 16-min gap is not 15 min seen'
    dd = dedupe_deaths([(T(0), 'a', 'x'), (T(0.1), 'a', 'x'), (T(0.05), 'b', 'y'), (T(5), 'a', 'z')])
    assert [(b, d) for _, b, d in dd] == [('a', 'x'), ('b', 'y'), ('a', 'z')], dd
    assert canon('minecraft:water_cauldron') == canon('minecraft:cauldron') == canon('minecraft:powder_snow_cauldron')
    assert zone_diff({'1,1,1': 'minecraft:cauldron'}, {'1,1,1': 'minecraft:water_cauldron'}) == ([], [], [])
    assert zone_diff({'1,1,1': 'minecraft:water_cauldron'}, {})[0], 'a filled cauldron taken away is a removal'
    plan_selftest(T)
    sp = {'a': [(T(0), T(20), 20)], 'b': [(T(0), T(20), 20)]}
    tr, st = split_trapped(sp, {'a': [(T(5), 3)], 'b': [(T(30), 3), (T(5), 0)]})
    assert list(tr) == ['a'] and list(st) == ['b'], (tr, st)
    assert verdict(dict(base, still_in_zone={'b': [('12:00', 20)]}))[0] == 'WATCH'
    assert defect_items({'G1': 2, 'G3': 0}, {'G1': ['x']}) == {'G1': ['x', 'G1 unlisted #1'], 'G3': []}
    n, k = unacked({'G1': ['x', 'y'], 'G3': ['z']}, {'G1': ['x'], 'G4': ['gone']})
    assert n == {'G1': ['y'], 'G3': ['z']} and k == {'G1': ['x']}, (n, k)
    assert unacked({'G1': ['x', 'x']}, {'G1': ['x']})[0] == {'G1': ['x']}, 'a second identical item needs its own ack'
    assert unacked({'G1': []}, {'G1': ['x']}) == ({}, {}), 'an acked item that went away is pruned: if it comes back it trips'
    import re as _re
    _nd = _re.compile(rb'"name"\s*:\s*"(_found)"')
    assert _nd.search(b'{"skill": {"name": "_found"}}') and _nd.search(b'"name":"_found"') and not _nd.search(b'"name":"_found_mode"')
    assert ts('2026-10-25T15:13:00') == ts('2026-10-25T15:13:00Z'), 'a naive epoch is UTC'
    assert verdict(dict(base, run_since_missing=True))[0] == 'WATCH'
    assert verdict(dict(base, bad_files=['x.gz: EOFError']))[0] == 'WATCH'
    assert verdict(dict(base, bad_files=['x.gz: EOFError'], plan_defects={'D4 zone_cells': 1}))[0] == 'TRIP', 'a bad file never hides a defect'
    assert verdict(dict(base, ack_error='bad json'))[0] == 'WATCH'
    assert verdict(dict(base, deaths=4))[0] == 'TRIP' and verdict(dict(base, deaths=2))[0] == 'WATCH' and verdict(dict(base, deaths=1))[0] == 'OK'
    assert verdict(dict(base, stuck={'a': 30, 'b': 31, 'c': 40}))[0] == 'WATCH', 'stuck never stops the showcase on its own'
    assert verdict(dict(base, trapped={'a': [('12:00', 20)]}))[0] == 'TRIP'
    assert verdict(dict(base, integrity={'v': {'status': 'BREACH', 'removed_n': 1, 'changed_n': 0, 'removed': ['x'], 'changed': []}}))[0] == 'TRIP'
    assert verdict(dict(base, integrity={'v': {'status': 'UNKNOWN (chunks)'}}))[0] == 'WATCH', 'an unreadable zone is never OK'
    assert verdict(dict(base, integrity=None))[0] == 'WATCH', 'no integrity read is never OK'
    assert verdict(dict(base, integrity={'v': {'status': 'INTACT'}, 'far': {'status': 'NOT COVERED'}}))[0] == 'OK', 'a zone outside the copy belongs to the daily check'
    assert verdict(dict(base, integrity={'v': {'status': 'NO BASELINE'}}))[0] == 'WATCH'
    assert verdict(dict(base, plan_defects={'G1 found_lost': 1}))[0] == 'TRIP'
    assert verdict(dict(base, plan_error='KeyError'))[0] == 'WATCH'
    assert verdict(dict(base, live_bots=0))[0] == 'TRIP' and verdict(dict(base, live_bots=0, expect_running=False))[0] == 'OK'
    try:
        import structcount as SC
        rx = struct_rx(SC.BUILT)
        assert rx.match('minecraft:bell') and rx.match('minecraft:tuff_bricks') and rx.match('minecraft:trial_spawner')
        assert rx.match('minecraft:dirt_path') and rx.match('minecraft:waxed_oxidized_cut_copper_stairs')
        assert rx.match('minecraft:exposed_copper') and rx.match('minecraft:oxidized_copper') and rx.match('minecraft:waxed_weathered_copper')
        assert not rx.match('minecraft:stone') and not rx.match('minecraft:tuff') and rx.match('minecraft:spruce_log') and rx.match('minecraft:tuff_stairs')
        print('selftest: structure palette checked against structcount.BUILT')
    except ImportError:
        print('selftest: structcount.py not beside this file -- palette checks skipped')
    print('selftest ok')
    return 0


def cmd_ack(a):
    """Acknowledge every CURRENT plan/found defect item (recovery, a human's step): they stop tripping until they go away and
    come back. Writes ACK.json with the why; prints what it acknowledged."""
    town_since = read_epoch(a.town_since)
    if town_since is None:
        print('REFUSED: no town epoch in %s' % a.town_since)
        return 1
    prows, hist = plan_rows(town_since)
    if hist.get('bad_files'):
        print('REFUSED: the history is partial (unreadable %s); acknowledge only what was read in full' % hist['bad_files'][:3])
        return 1
    _, report = plan_read(prows, town_since)
    items = {g: v for g, v in report['items'].items() if v}
    d = {'t': dt.datetime.now(UTC).strftime('%FT%TZ'), 'why': a.why, 'items': items, 'history': hist}
    with ack_lock(a.ack):
        ack_write(a.ack, d)
    print('ACKNOWLEDGED %s (%s)' % (items or 'nothing', a.why))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    r = sp.add_parser('read')
    r.add_argument('--minutes', type=float, default=180)
    r.add_argument('--since')
    r.add_argument('--zones-file', default=os.path.join(POOL_DIR, 'protected-zones.json'))
    r.add_argument('--zones-regions', default='/srv/showcase/timelapse/mirror/world/region')
    r.add_argument('--zones-baseline', default='/srv/showcase/trip/zones-baseline.json')
    r.add_argument('--not-running', action='store_true', help='the bots are stopped on purpose (S0 does not trip)')
    r.add_argument('--run-since', default=RUN_SINCE)
    r.add_argument('--town-since', default=TOWN_SINCE)
    r.add_argument('--ack', default=ACK)
    k = sp.add_parser('ack')
    k.add_argument('--why', required=True)
    k.add_argument('--ack', default=ACK)
    k.add_argument('--town-since', default=TOWN_SINCE)
    r.add_argument('--json')
    b = sp.add_parser('zones-baseline')
    b.add_argument('--regions', required=True)
    b.add_argument('--out', required=True)
    b.add_argument('--zones-file', default=os.path.join(POOL_DIR, 'protected-zones.json'))
    c = sp.add_parser('zones-compare')
    c.add_argument('--regions', required=True)
    c.add_argument('--baseline', required=True)
    c.add_argument('--zone', action='append')
    c.add_argument('--max-age-min', type=int, default=26 * 60)
    sp.add_parser('selftest')
    a = ap.parse_args()
    return {'read': cmd_read, 'ack': cmd_ack, 'zones-baseline': cmd_zones_baseline, 'zones-compare': cmd_zones_compare,
            'selftest': lambda _a: selftest()}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
