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
  S1 DEATHS       `_death` rows in the window, each named (bot, time, detail). TRIP >= 4 in the window (the fleet's 7-d rate
                  0.0195 / bot-h puts ~0.6 in 3 h on 10 bots; P(>= 4) ~ 0.3 %); WATCH 2-3
  S2 STUCK        bots whose rows show < 3 blocks of movement for >= 30 min that run to the window's end. TRIP >= 3 bots at
                  once; WATCH 1-2 (idle at home is legal; three at once is not the town working)
  S3 ZONES        Z1 a bot inside a protected box >= 15 min with < 3 blocks moved (TRIP, the dead end protectzone must never
                  make); Z2 >= 60 refusals by one bot in 10 min (WATCH: a remedy not taken); refusals by op (REPORTED)
  S4 INTEGRITY    every protected structure's cells (structure palette) vs the pre-start baseline: a cell REMOVED or changed
                  to another block name is a BREACH (TRIP); an unreadable chunk is UNKNOWN (WATCH, never OK)
  S5 TOWN PLAN    townplanread D1 chain_invalid, D2 invalid rows, D3 never hits, D4 plan cells in a zone/avoid box, D5 root
                  occupied; foundread G1 found lost, G2 off plan, G3 lid/unreachable, G4 shared side, G5 in a zone. Any > 0: TRIP
  REPORTED        plan generations, found outcomes, founding placements (the evidence the town is being founded)
VERDICT  TRIP (stop-bots.sh, or re-activate the previous release when a piece was just deployed) | WATCH | OK
"""
import argparse, collections, datetime as dt, glob, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
POOL_DIR = '/var/lib/mcai/_pool-showcase'
LOGS = '/var/log/mcai/showcase-[A-Z]*/skill-*.jsonl*'
NAMES = ['showcase-' + n for n in 'Alpha Bravo Comet Delta Echo Frost Gale Haven Iris Juno'.split()]
POOL = 'showcase'
UTC = dt.timezone.utc

DEATH_TRIP, DEATH_WATCH = 4, 2
STUCK_MIN, STUCK_MOVE, STUCK_TRIP = 30, 3.0, 3
TRAP_MIN, TRAP_MOVE = 15, 3.0
LOOP_N, LOOP_MIN = 60, 10
LIVE_MIN = 15
WORLD = [-30000000, -64, -30000000, 30000000, 320, 30000000]

# the structure palette: what a village or the trial chambers are built of and a bot could break or take (structcount's
# BUILT, the village paths, and the trial chambers' own blocks). Natural terrain is NOT here: the bots may dig dirt and
# stone that happen to lie inside a box only where protectzone lets them (survival), and that is not a breach.
TRIAL_RX = (r'tuff_bricks|tuff_brick_(slab|stairs|wall)|chiseled_tuff(_bricks)?|polished_tuff(_slab|_stairs|_wall)?|'
            r'(waxed_)?(exposed_|weathered_|oxidized_)?(copper_block|cut_copper(_slab|_stairs)?|copper_grate|copper_door|'
            r'copper_trapdoor|copper_bulb|chiseled_copper)|trial_spawner|vault|decorated_pot|heavy_core|waxed_copper_bulb')


def struct_rx(built_rx):
    inner = built_rx.pattern[len('^minecraft:('):-len(')$')]
    return re.compile(r'^minecraft:(' + inner + r'|dirt_path|' + TRIAL_RX + r')$')


# ------------------------------------------------------------------------------------------------ pure decisions
def ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def in_box(p, b):
    if not p:
        return False
    x, y, z = math.floor(float(p['x'])), math.floor(float(p['y'])), math.floor(float(p['z']))
    return b[0] <= x <= b[3] and b[1] <= y <= b[4] and b[2] <= z <= b[5]


def still_spells(rows, boxes, min_min, move):
    """rows: one bot's [(t, pos)] sorted. -> [(start, end, minutes)] spells inside a box with < move blocks of horizontal
    displacement from the spell's first sample (protectzoneread.trapped's rule, with the end kept). Pure."""
    out, start, anchor, last = [], None, None, None
    for t, p in rows:
        inside = p is not None and any(in_box(p, b) for b in boxes)
        if inside and start is None:
            start, anchor = t, p
        elif inside and math.dist((p['x'], p['z']), (anchor['x'], anchor['z'])) >= move:
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
        for s, e, m in still_spells(rows, [WORLD], min_min, move):
            if (end - e).total_seconds() / 60 <= slack_min:
                out[b] = round(m)
    return out


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
    changed = sorted('%s %s->%s' % (k, v, now[k]) for k, v in base.items() if k in now and now[k] != v)
    added = sorted('%s %s' % (k, v) for k, v in now.items() if k not in base)
    return removed, changed, added


def verdict(f):
    """f: the facts dict read() builds. -> (verdict, [reasons]). Pure: TRIP beats WATCH beats OK; UNKNOWN is never OK."""
    trip, watch = [], []
    if f['live_bots'] == 0 and f['expect_running']:
        trip.append('S0 no showcase bot wrote a row in %d min' % LIVE_MIN)
    elif f['live_bots'] < len(NAMES) and f['expect_running']:
        watch.append('S0 %d of %d bots wrote a row in %d min' % (f['live_bots'], len(NAMES), LIVE_MIN))
    if f['deaths'] >= DEATH_TRIP:
        trip.append('S1 %d deaths in the window' % f['deaths'])
    elif f['deaths'] >= DEATH_WATCH:
        watch.append('S1 %d deaths in the window' % f['deaths'])
    if len(f['stuck']) >= STUCK_TRIP:
        trip.append('S2 %d bots stuck at once %s' % (len(f['stuck']), f['stuck']))
    elif f['stuck']:
        watch.append('S2 stuck %s' % f['stuck'])
    if f['trapped']:
        trip.append('S3 Z1 trapped in a zone %s' % f['trapped'])
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


def scan_zone(world, rx, box):
    """-> ({"x,y,z": name} of structure cells inside box, {chunk status: n}). Reads only."""
    cells, st = {}, collections.Counter()
    x0, y0, z0, x1, y1, z1 = box
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            d = world.chunk(cx, cz)
            st[world.chunkstat.get((cx, cz), '?')] += 1
            if d is None:
                continue
            for x, y, z, n in world.cells_matching(cx, cz, rx, y0, y1):
                if x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1:
                    cells['%d,%d,%d' % (x, y, z)] = n
    st['undecoded'] = world.stats.get('undecoded_hit_sections', 0)
    return cells, dict(st)


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
        print('  %-24s %6d structure cells  chunks %s' % (zid, len(cells), st))
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
        if st.get('ok', 0) != b['chunks'].get('ok', 0) or st.get('undecoded'):
            res[zid] = {'status': 'UNKNOWN (chunks %s vs baseline %s)' % (st, b['chunks'])}
            continue
        removed, changed, added = zone_diff(b['cells'], cells)
        res[zid] = {'status': 'BREACH' if removed or changed else 'INTACT', 'base_n': b['n'], 'now_n': len(cells),
                    'removed_n': len(removed), 'changed_n': len(changed), 'added_n': len(added),
                    'removed': removed[:20], 'changed': changed[:20], 'added': added[:20]}
    return res


def cmd_zones_compare(a):
    res = integrity(a.regions, a.baseline, a.zone)
    for zid, z in res.items():
        print('  %-24s %s %s' % (zid, z['status'], {k: v for k, v in z.items() if k.endswith('_n')}))
        for k in ('removed', 'changed', 'added'):
            if z.get(k):
                print('      %s %s' % (k, z[k][:5]))
    return 1 if any(z['status'] == 'BREACH' for z in res.values()) else 0


# ------------------------------------------------------------------------------------------------ the read
def plan_read(rows, since):
    """townplanread's D-gates and foundread's G-gates over the showcase pool, every showcase bot on the canary arm.
    The reads key plans by pool_of_dir('_pool-showcase') = 'showcase' but rows by pool_of('showcase-Alpha') =
    'showcase-Alpha', so the plan maps are re-keyed per bot pool here (the reads themselves are unchanged)."""
    import townplanread as TP
    import foundread as FD
    ms = int(since.timestamp() * 1000)
    plans = {POOL: v for k, v in TP.read_plans().items() if k == POOL}
    pl = TP.judge_plans(plans, {POOL}, ms)
    gen_index, rejected = dict(pl['_gen_index']), dict(pl['_rejected'])
    for (pool, gen), plan in list(pl['_gen_index'].items()):
        for b in NAMES:
            gen_index[(TP.pool_of(b), gen)] = plan
    for (pool, gen), why in list(pl['_rejected'].items()):
        for b in NAMES:
            rejected[(TP.pool_of(b), gen)] = why
    tprows = [dict(r, arm='canary', per='post') for r in rows if r['name'] in TP.ROW_KINDS]
    rw, lists = TP.judge_rows(tprows, since, gen_index, rejected)
    acc, zones = {}, {}
    for pool, keys in plans.items():
        for key, info in keys.items():
            for wkey, files in info['worlds'].items():
                world = json.loads(wkey) if wkey != '"__unparseable__"' else None
                head, a_, _, _ = TP.walk(files, world)
                if head is not None:
                    for b in NAMES:
                        acc.setdefault(TP.pool_of(b), []).extend(a_)
                        zones.setdefault(TP.pool_of(b), []).extend(TP.zones_of(info['dir'], world))
    fdrows = [dict(r, arm='canary', per='post') for r in rows if r['name'] in FD.ROW_KINDS]
    fo, flists = FD.judge(fdrows, acc, zones)
    defects = {'D1 chain_invalid': pl['chain_invalid'] + rw.get('chain_invalid', 0), 'D2 invalid_rows': rw.get('invalid_rows', 0),
               'D3 never_hits': rw.get('never_hits', 0), 'D4 zone_cells': pl['zone_cells'], 'D5 root_occupied': rw.get('root_occupied', 0),
               'G1 found_lost': fo.get('found_lost', 0), 'G2 off_plan': fo.get('off_plan', 0), 'G3 lid_unreach': fo.get('lid_unreach', 0),
               'G4 shared_side': fo.get('shared_side', 0), 'G5 zone': fo.get('zone', 0)}
    report = {'towns': pl['_towns'], 'plan_rows': rw.get('rows_townplan_canary', 0),
              'ops': {k[3:]: v for k, v in sorted(rw.items()) if k.startswith('op_')},
              'found_rows': fo.get('rows_found_canary', 0), 'found_placed': fo.get('found_placed', 0),
              'found_work_placed': fo.get('found_work_placed', 0), 'found_store_placed': fo.get('found_store_placed', 0),
              'found_outcomes': {k[8:]: v for k, v in sorted(fo.items()) if k.startswith('outcome_')},
              'found_why': flists.get('why', [])[:6], 'lists': {k: v[:3] for k, v in {**lists, **flists}.items() if v}}
    return defects, report


def cmd_read(a):
    from lib.telemetry import Events
    now = dt.datetime.now(UTC)
    since = ts(a.since) if a.since else now - dt.timedelta(minutes=a.minutes)
    ev = Events.load(paths=LOGS, since=since)
    rows, by_bot, mins, builds = [], collections.defaultdict(list), collections.defaultdict(list), collections.Counter()
    deaths, refused_by_op, newest = [], collections.Counter(), {}
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
            deaths.append('%s %s %s' % (b, r['t'].strftime('%H:%M:%S'), (r.get('detail') or '')[:90]))
        if r['name'] == '_protect_zone':
            kvs = dict(re.findall(r'(?:^| )([a-z_]+)=(\d+)', r.get('detail') or ''))
            n = sum(int(kvs.get(k, 0)) for k in ('dig', 'place', 'use', 'open', 'sleep', 'craft'))
            mins[b].append((r['t'], n))
            for k, v in kvs.items():
                refused_by_op[k] += int(v)
    for b in by_bot:
        by_bot[b].sort(key=lambda x: x[0])
    end = min(now, max([t for v in by_bot.values() for t, _ in v], default=now))
    boxes = []
    try:
        boxes = zone_boxes(a.zones_file)
    except Exception as e:
        print('zones file unreadable: %s' % e)
    trapped = {b: [(s.strftime('%H:%M'), round(m)) for s, _, m in still_spells(v, [bx for _, bx in boxes], TRAP_MIN, TRAP_MOVE)]
               for b, v in by_bot.items()}
    trapped = {b: v for b, v in trapped.items() if v}
    loops = {b: refusal_peak(v) for b, v in mins.items() if refusal_peak(v) >= LOOP_N}
    integ = None
    if a.zones_baseline and os.path.exists(a.zones_baseline) and a.zones_regions:
        try:
            integ = integrity(a.zones_regions, a.zones_baseline)
        except Exception as e:
            print('integrity read failed: %s' % e)
    plan_err, defects, report = None, {}, {}
    try:
        defects, report = plan_read(rows, since)
    except Exception as e:
        plan_err = '%s: %s' % (type(e).__name__, str(e)[:200])
    live = sum(1 for b in NAMES if b in newest and (now - newest[b]).total_seconds() <= LIVE_MIN * 60)
    facts = {'live_bots': live, 'expect_running': not a.not_running, 'deaths': len(deaths), 'stuck': stuck_now(by_bot, end),
             'trapped': trapped, 'refusal_loops': loops, 'integrity': integ, 'plan_defects': defects, 'plan_error': plan_err}
    v, why = verdict(facts)
    W = (now - since).total_seconds() / 60
    print('SHOWCASE TRIPWIRE %s  window %s .. %s (%d min)' % (now.strftime('%FT%TZ'), since.strftime('%FT%TZ'), now.strftime('%H:%M:%SZ'), W))
    print('DENOMINATORS rows walked %d | bots with rows %d of %d | builds %s | positions %d' % (
        len(rows), len(by_bot), len(NAMES), dict(builds), sum(1 for v in by_bot.values() for _, p in v if p)))
    print('S0 LIVENESS  %d of %d bots wrote a row in the last %d min' % (live, len(NAMES), LIVE_MIN))
    print('S1 DEATHS    %d (rows walked %d) %s' % (len(deaths), len(rows), deaths[:6]))
    print('S2 STUCK     %s (still >= %d min, < %.0f blocks, to the window end)' % (facts['stuck'] or 'none', STUCK_MIN, STUCK_MOVE))
    print('S3 ZONES     zones %d | Z1 trapped %s | Z2 refusal loops %s | refusals by op %s (minute rows %d)' % (
        len(boxes), trapped or 'none', loops or 'none', dict(refused_by_op), sum(len(v) for v in mins.values())))
    if integ is None:
        print('S4 INTEGRITY not read (baseline %s, regions %s)' % (a.zones_baseline, a.zones_regions))
    else:
        for zid, z in integ.items():
            print('S4 INTEGRITY %-24s %s %s' % (zid, z['status'], {k: v for k, v in z.items() if k.endswith('_n')}))
    print('S5 TOWN PLAN %s%s' % (defects, (' | READ FAILED ' + plan_err) if plan_err else ''))
    if report:
        print('REPORTED     plans %s' % (report['towns'] or 'none'))
        print('             _townplan rows %d ops %s | _found rows %d placed %d (work %d, store %d) outcomes %s' % (
            report['plan_rows'], report['ops'], report['found_rows'], report['found_placed'], report['found_work_placed'],
            report['found_store_placed'], report['found_outcomes']))
        if report['found_why']:
            print('             found refusals %s' % report['found_why'])
        if report['lists']:
            print('             lists %s' % report['lists'])
    print('VERDICT      %s%s' % (v, (' -- ' + '; '.join(why)) if why else ''))
    if a.json:
        with open(a.json, 'w') as f:
            json.dump({'t': now.strftime('%FT%TZ'), 'since': since.strftime('%FT%TZ'), 'verdict': v, 'why': why,
                       'facts': facts, 'report': report, 'rows': len(rows), 'builds': dict(builds)}, f, default=str)
    return {'OK': 0, 'WATCH': 0, 'TRIP': 2}[v]


# ------------------------------------------------------------------------------------------------ selftest
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
    base = {'live_bots': 10, 'expect_running': True, 'deaths': 0, 'stuck': {}, 'trapped': {}, 'refusal_loops': {},
            'integrity': {'v': {'status': 'INTACT'}}, 'plan_defects': {'D1 chain_invalid': 0}, 'plan_error': None}
    assert verdict(base) == ('OK', [])
    assert verdict(dict(base, deaths=4))[0] == 'TRIP' and verdict(dict(base, deaths=2))[0] == 'WATCH' and verdict(dict(base, deaths=1))[0] == 'OK'
    assert verdict(dict(base, stuck={'a': 30, 'b': 31, 'c': 40}))[0] == 'TRIP' and verdict(dict(base, stuck={'a': 30}))[0] == 'WATCH'
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
        assert not rx.match('minecraft:stone') and not rx.match('minecraft:tuff') and not rx.match('minecraft:oak_log')
        print('selftest: structure palette checked against structcount.BUILT')
    except ImportError:
        print('selftest: structcount.py not beside this file -- palette checks skipped')
    print('selftest ok')
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
    r.add_argument('--json')
    b = sp.add_parser('zones-baseline')
    b.add_argument('--regions', required=True)
    b.add_argument('--out', required=True)
    b.add_argument('--zones-file', default=os.path.join(POOL_DIR, 'protected-zones.json'))
    c = sp.add_parser('zones-compare')
    c.add_argument('--regions', required=True)
    c.add_argument('--baseline', required=True)
    c.add_argument('--zone', action='append')
    sp.add_parser('selftest')
    a = ap.parse_args()
    return {'read': cmd_read, 'zones-baseline': cmd_zones_baseline, 'zones-compare': cmd_zones_compare,
            'selftest': lambda _a: selftest()}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
