#!/usr/bin/env python3
# townfloorread.py [window_min] -- the read for canary `townfloor-01` (branch tf-on-5e66386). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). --selftest runs the self-tests only.
#
# THE CHANGE (bots/src/townfloor.mjs, skills.mjs fill_town, cognitive.mjs floorOrder; docs/reports/townfloor-2026-10-14.md):
#   at town, a bot with surplus stone above the 64-cobble reserve fills the open cells of the town's dug-out ground --
#   Chebyshev 16 around home, from home.y-2 (the platform's top, L) down 10 layers -- placements only, each on a solid
#   block, from a stand that walks back to the town, never sealing a body, an item or a tunnel, one builder per town.
#   Rows: _town_floor (one per visit: stage, placed, planned, refused, dropped, spent, tier0, budget, left, why, ms) and
#   _town_floor_step (one per block: at, block, stand, tier, L, home, col = the cells below, nb = the non-terrain neighbours).
#
#   LICENCE      canary _town_floor rows (the base never writes the kind).
#   GATES (defect, REVERT)
#     F1 breach_outside_box     a canary step whose cell is outside its own row's box (Chebyshev 16 of home=, L-10..L, and
#                               L == home.y-2): the planner's box, re-derived here from the row.
#     F2 breach_unsupported     a step whose evidence shows the cell below was not a solid block (col[0] open, a liquid,
#                               unloaded): a bridge, which the design forbids.
#     F3 breach_protected       a step whose evidence shows a protected cell: town furniture within Chebyshev 1 (nb), the
#                               cell over farmland, or a sapling below through leaves/open cells (col). Judged by THIS
#                               file's own classifier on the world as the bot read it at the click, not by the bot's.
#     F4 breach_reserve         a step that placed cobble and left the bag (the row's snapshot, after the click) under 64
#                               cobble (cobblestone + cobbled_deepslate): the exit contract's reserve.
#     F5 breach_trapped         > 1 canary stuck EPISODE (entombed / stranded_escape_try / livelock_escape, one per bot per
#                               10 min) with the body within Chebyshev 4 (|dy| <= 4) of a cell its pool filled in the 30
#                               minutes before: a fill that boxed a bot in. One is named, not a verdict.
#     F6 control_floor_rows     a CONTROL _town_floor row (the control is not running the base). Blocks KEEP.
#   INSTRUMENT   the self-tests below run on every read; the stuck-row selector must see rows anywhere (canary + control > 0);
#                truncated step rows (300 chars, nb cut) are counted and judged on what they carry.
#   PRIMARY (report only)  blocks placed per canary town and tier; cobble held per bot (canary vs control, pre vs post DiD);
#                junk-well cobble throws; _fall_path rows inside the box per bot-h (DiD); visits and why they stopped.
#   TRIPWIRE     visits with why=no_start (no standable cell on the floor within 4 of home: a crater around home), reported.
#   EXPOSURE     a canary town with >= 50 blocks placed, in a window >= 180 min.
import sys, os, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

HALF, DEPTH = 16, 10                      # townfloor.mjs FLOOR_HALF, FLOOR_DEPTH
RESERVE = 64                              # bankable.mjs COBBLE_RESERVE
COBBLE = ('cobblestone', 'cobbled_deepslate')
NEAR, NEAR_DY = 4, 4
FRESH = dt.timedelta(minutes=30)
EPISODE = dt.timedelta(minutes=10)
HOMES = {'board-a': (355, 73, 147), 'board-c': (355, 73, 147), 'board-d': (355, 73, 147), 'hive-a': (355, 73, 147), 'hive-b': (355, 73, 147),
         'placebo-c': (355, 73, 147), 'isolated-a': (355, 73, 147), 'isolated-b': (355, 73, 147), 'isolated-c': (355, 73, 147), 'isolated-d': (355, 73, 147),
         'hive-d': (68, 65, 68), 'placebo-d': (177, 75, 73), 'placebo-a': (249, 75, -144), 'placebo-b': (282, 65, -388), 'board-b': (-249, 65, 144), 'hive-c': (-68, 68, -68)}
OPEN = re.compile(r'^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|unloaded)$')
LIQUID = re.compile(r'^(water|lava|flowing_water|flowing_lava|bubble_column)$')
SAPLING = re.compile(r'(_sapling$|_propagule$|^azalea$|^flowering_azalea$)')
LEAVES = re.compile(r'_leaves$')
FURNITURE = re.compile(r'^(chest|trapped_chest|ender_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|brewing_stand|([a-z_]+_)?shulker_box|'
                       r'lectern|bell|crafting_table|composter|cartography_table|smithing_table|loom|grindstone|stonecutter|anvil|enchanting_table|jukebox|note_block)$'
                       r'|_door$|_bed$|_trapdoor$')
# not solid ground under a fill (a plant, a torch, snow, a flower): the read's own list of what a click cannot rest on
NOT_SOLID = re.compile(r'(^torch$|_torch$|^snow$|^poppy$|^dandelion$|_tulip$|^cornflower$|^azure_bluet$|^oxeye_daisy$|^allium$|^blue_orchid$|^lily_of_the_valley$|'
                       r'_sapling$|^sugar_cane$|^vine$|_carpet$|^rail$|_rail$|^ladder$|_sign$|_button$|^lever$|_pressure_plate$|^wheat$|^carrots$|^potatoes$|^beetroots$)')


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-zA-Z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def xyz(s):
    try:
        a = [int(float(v)) for v in (s or '').split(',')]
        return tuple(a) if len(a) == 3 else None
    except ValueError:
        return None


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def in_box(at, home, L):
    """PURE. The repair box re-derived from the row: Chebyshev HALF of home, y in [L-DEPTH, L], and L must be home.y-2."""
    if not at or not home or L is None or L != home[1] - 2:
        return False
    return max(abs(at[0] - home[0]), abs(at[2] - home[2])) <= HALF and L - DEPTH <= at[1] <= L


def unsupported(col):
    """PURE. col = the names below the cell, from y-1 down. The first must be a solid block: not open, not a liquid, not
    unloaded, not a plant/torch-like non-solid."""
    first = (col or [''])[0]
    return not first or bool(OPEN.match(first)) or bool(LIQUID.match(first)) or bool(NOT_SOLID.search(first))


def protected_why(col, nb):
    """PURE. -> None | reason, from the step's evidence: furniture within Chebyshev 1 (nb), the cell over farmland, or a
    sapling below (through leaves or open cells: its growth column)."""
    for item in (nb or []):
        name = item.split('@')[0]
        if FURNITURE.search(name):
            return 'furniture:' + item
    if col and col[0] == 'farmland':
        return 'farmland'
    for name in (col or []):
        if SAPLING.search(name):
            return 'sapling'
        if not (OPEN.match(name) or LEAVES.search(name)):
            break
    return None


def parse_step(detail):
    """PURE. -> (at, home, L, col list, nb list, truncated)"""
    f = kv(detail)
    nb = [] if f.get('nb') in (None, '-') else f.get('nb').split(';')
    col = (f.get('col') or '').split(',') if f.get('col') else []
    try:
        L = int(f.get('L'))
    except (TypeError, ValueError):
        L = None
    return xyz(f.get('at')), xyz(f.get('home')), L, col, nb, len(detail or '') >= 300 or 'nb' not in f


def cobble_of(inv):
    return sum(int((inv or {}).get(n, 0) or 0) for n in COBBLE)


def stuck_episodes(rows):
    """PURE (plinthread's rule). rows: [(bot, t, kind, pos)]. -> [(bot, t, pos)], one per (bot, 10-min episode);
    _stranded_escape_result is never counted."""
    out, last = [], {}
    for b, t, k, pos in sorted(rows, key=lambda r: r[1]):
        if k == 'stranded_escape_result':
            continue
        if b in last and t - last[b] < EPISODE:
            continue
        last[b] = t
        out.append((b, t, pos))
    return out


def trapped_by_fill(stuck, fills):
    """PURE. stuck: [(bot, t, kind, pos)] canary stuck-family rows; fills: [(pool, t, cell)] canary placements. -> the
    episodes whose body was within NEAR (|dy| <= NEAR_DY) of a cell its own pool filled in the FRESH window before."""
    near = []
    for b, t, k, p in stuck:
        pool = pool_of(b)
        for fp, ft, c in fills:
            if fp != pool or not (dt.timedelta(0) <= t - ft <= FRESH):
                continue
            if max(abs(p[0] - c[0] - 0.5), abs(p[2] - c[2] - 0.5)) <= NEAR + 0.5 and abs(p[1] - c[1]) <= NEAR_DY:
                near.append((b, t, k, p))
                break
    return stuck_episodes(near)


def selftest():
    H = (355, 73, 147)
    assert in_box((355, 71, 147), H, 71) and in_box((371, 61, 131), H, 71)
    assert not in_box((372, 61, 147), H, 71), 'outside the square'
    assert not in_box((355, 72, 147), H, 71), 'above the floor level'
    assert not in_box((355, 60, 147), H, 71), 'below the depth'
    assert not in_box((355, 71, 147), H, 72), 'an L that is not home.y-2 is never trusted'
    s = 'at=360,65,150 block=cobblestone stand=361,66,150 tier=0 L=71 home=355,73,147 col=stone nb=-'
    at, home, L, col, nb, tr = parse_step(s)
    assert (at, home, L, col, nb, tr) == ((360, 65, 150), H, 71, ['stone'], [], False)
    assert not unsupported(col) and protected_why(col, nb) is None, 'a plain fill on stone'
    assert unsupported(['air', 'stone']) and unsupported(['water']) and unsupported(['torch']) and unsupported(['unloaded']) and unsupported([])
    assert not unsupported(['cobblestone']) and not unsupported(['oak_leaves']), 'leaves are a solid block to click on'
    assert protected_why(['stone'], ['chest@1,1,0']) == 'furniture:chest@1,1,0'
    assert protected_why(['stone'], ['oak_door@0,0,1']).startswith('furniture')
    assert protected_why(['farmland'], []) == 'farmland'
    assert protected_why(['oak_leaves', 'air', 'oak_sapling', 'dirt'], []) == 'sapling', 'a sapling under leaves: its growth column'
    assert protected_why(['stone', 'oak_sapling'], []) is None, 'a sapling under solid stone is not this cell\'s concern'
    assert protected_why(['stone'], ['torch@1,0,0', 'oak_log@0,1,0']) is None, 'a torch or a log beside is not furniture'
    _, _, _, c2, n2, _ = parse_step('at=1,2,3 block=andesite stand=1,3,4 tier=1 L=2 home=1,4,3 col=oak_leaves,air,oak_sapling nb=chest@0,1,1;torch@1,0,0')
    assert protected_why(c2, n2).startswith('furniture') and c2 == ['oak_leaves', 'air', 'oak_sapling']
    assert parse_step('at=1,2,3 block=x')[5] is True, 'a row without nb= is truncated: counted'
    assert cobble_of({'cobblestone': 60, 'cobbled_deepslate': 4, 'andesite': 9}) == 64
    T = dt.datetime(2026, 10, 14, tzinfo=dt.timezone.utc)
    m = lambda n: T + dt.timedelta(minutes=n)
    fills = [('hive-a', m(0), (100, 60, 100))]
    st = [('hive-a-Alpha', m(5), 'entombed', (101.5, 61, 100.5)), ('hive-a-Alpha', m(6), 'entombed', (101.5, 61, 100.5)),
          ('hive-a-Bravo', m(50), 'entombed', (101.5, 61, 100.5)), ('hive-b-Alpha', m(5), 'entombed', (101.5, 61, 100.5)),
          ('hive-a-Echo', m(7), 'stranded_escape_result', (100.5, 60, 100.5)), ('hive-a-Delta', m(8), 'livelock_escape', (120.5, 60, 100.5))]
    got = trapped_by_fill(st, fills)
    assert [(b, t) for b, t, _p in got] == [('hive-a-Alpha', m(5))], 'one episode; too late, another pool, results and far bodies never count: %s' % got
    assert trapped_by_fill([('hive-a-Alpha', m(-1), 'entombed', (100.5, 60, 100.5))], fills) == [], 'before the fill'
    return True


selftest()

if __name__ == '__main__':
    if '--selftest' in sys.argv:
        print('townfloorread self-tests: PASS')
        sys.exit(0)
    import json
    from lib.telemetry import Events
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    W = min(elapsed, float(args[0]) if args else 180)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        """Rotation-aware (wellread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z rotation."""
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        import glob as _glob
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                e2 = Events.load(paths=g, since=since, until=until)
                for r in e2.rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); rows = Counter(); offbuild = 0; n = Counter()
    fills = []; stuck = []; leak = 0; trunc = 0
    out_box = []; unsup = []; prot = []; reserve = []
    placed = defaultdict(Counter); visits = defaultdict(Counter); held = defaultdict(dict)
    for r in ev_rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        raw = r.get('raw') or {}
        ver = ((raw.get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); rows[(period, arm)] += 1
        k = (r.get('name') or '').lstrip('_'); d = r.get('detail') or ''
        bot = raw.get('bot') or {}
        inv = bot.get('inventory') or {}
        if inv:
            held[(period, arm)][b] = cobble_of(inv)
        pos = bot.get('pos') or {}
        home = HOMES.get(pool_of(b))
        if k == 'fall_path' and home and 'x' in pos and max(abs(pos['x'] - home[0]), abs(pos['z'] - home[2])) <= HALF:
            n[(period, arm, 'fall_box')] += 1
        if k == 'dispose_well' and re.search(r'cobble', d):
            n[(period, arm, 'well_cobble')] += 1
        if k in ('entombed', 'livelock_escape', 'stranded_escape_try', 'stranded_escape_result') and period == 'post':
            n[('post', arm, 'stuck_any')] += 1
            if arm == 'canary' and 'x' in pos:
                stuck.append((b, t, k, (pos['x'], pos['y'], pos['z'])))
        if period != 'post':
            continue
        if k == 'town_floor':
            if arm == 'control':
                leak += 1
                continue
            n[('post', 'canary', 'licence')] += 1
            f = kv(d)
            visits[pool_of(b)][f.get('stage', '?') + ':' + (f.get('why') or '-')] += 1
            if (f.get('why') or '') == 'no_start':
                n[('post', 'canary', 'no_start')] += 1
        elif k == 'town_floor_step':
            if arm == 'control':
                leak += 1
                continue
            at, h, L, col, nb, tr = parse_step(d)
            trunc += int(tr)
            f = kv(d)
            placed[pool_of(b)][f.get('tier', '?')] += 1
            if at:
                fills.append((pool_of(b), t, at))
            if not in_box(at, h, L) or (home and h != home):
                out_box.append((b, t.strftime('%H:%M:%S'), f.get('at')))
            if unsupported(col):
                unsup.append((b, t.strftime('%H:%M:%S'), f.get('at'), col[:2]))
            w = protected_why(col, nb)
            if w:
                prot.append((b, t.strftime('%H:%M:%S'), f.get('at'), w))
            if f.get('block') in COBBLE and cobble_of(inv) < RESERVE:
                reserve.append((b, t.strftime('%H:%M:%S'), cobble_of(inv)))

    trapped = [(b, t.strftime('%H:%M'), p) for b, t, p in trapped_by_fill(stuck, fills)]
    hours = W / 60.0
    def rate(period, arm, what):
        bs = bots[(period, arm)]
        return (n[(period, arm, what)] / (len(bs) * hours)) if bs and hours else float('nan')
    def mean_held(period, arm):
        v = list(held[(period, arm)].values())
        return sum(v) / len(v) if v else float('nan')
    total = {p: sum(c.values()) for p, c in placed.items()}
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots post canary %d control %d  |  offbuild canary rows %d'
          % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     licence (canary _town_floor rows) %d | blocks placed by town %s (by tier %s) | visits %s'
          % (n[('post', 'canary', 'licence')], total, {p: dict(c) for p, c in placed.items()}, {p: dict(c.most_common(4)) for p, c in visits.items()}))
    print('F1 (gate)    placements outside the box: %d %s' % (len(out_box), out_box[:3]))
    print('F2 (gate)    placements not on a solid block (a bridge): %d %s' % (len(unsup), unsup[:3]))
    print('F3 (gate)    placements into a protected cell (the read\'s own judge): %d %s' % (len(prot), prot[:3]))
    print('F4 (gate)    cobble placements that left the bag under %d cobble: %d %s' % (RESERVE, len(reserve), reserve[:3]))
    print('F5 (gate>1)  stuck episodes within %d of a fresh fill: %d %s | INSTRUMENT stuck rows anywhere: canary %d control %d'
          % (NEAR, len(trapped), trapped[:3], n[('post', 'canary', 'stuck_any')], n[('post', 'control', 'stuck_any')]))
    print('F6 (leak)    control _town_floor rows: %d' % leak)
    print('INSTRUMENT   self-tests PASS | truncated step rows %d' % trunc)
    print('TRIPWIRE     visits that found no anchor near home (why=no_start: a crater around home, Claude r6 P3): %d' % n[('post', 'canary', 'no_start')])
    print('PRIMARY      cobble held per bot: canary %.1f -> %.1f | control %.1f -> %.1f'
          % (mean_held('pre', 'canary'), mean_held('post', 'canary'), mean_held('pre', 'control'), mean_held('post', 'control')))
    print('             _fall_path in the box per bot-h: canary %.3f -> %.3f | control %.3f -> %.3f | junk-well cobble disposals canary %d -> %d'
          % (rate('pre', 'canary', 'fall_box'), rate('post', 'canary', 'fall_box'), rate('pre', 'control', 'fall_box'), rate('post', 'control', 'fall_box'),
             n[('pre', 'canary', 'well_cobble')], n[('post', 'canary', 'well_cobble')]))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('townfloorread', W, {
            'rows_canary': rows[('post', 'canary')], 'rows_control': rows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n[('post', 'canary', 'licence')], 'placed_canary': sum(total.values()),
            'breach_outside_box': len(out_box), 'breach_unsupported': len(unsup), 'breach_protected': len(prot),
            'breach_reserve': len(reserve), 'breach_trapped': len(trapped), 'control_floor_rows': leak,
            'no_start_visits': n[('post', 'canary', 'no_start')],
            'instrument_stuck_rows': n[('post', 'canary', 'stuck_any')] + n[('post', 'control', 'stuck_any')], 'truncated_steps': trunc,
            'held_did': nanless((mean_held('post', 'canary') - mean_held('pre', 'canary')) - (mean_held('post', 'control') - mean_held('pre', 'control'))),
            'fall_box_did': nanless((rate('post', 'canary', 'fall_box') - rate('pre', 'canary', 'fall_box')) - (rate('post', 'control', 'fall_box') - rate('pre', 'control', 'fall_box'))),
            'exposure_ready': int(any(v >= 50 for v in total.values()) and W >= 180),
        })
    except Exception as e:
        print('emit failed:', e)
