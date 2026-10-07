#!/usr/bin/env python3
# wellread.py [window_min] -- the read for canary `junkwell-02` (branches jw-on-c6e91a8 / jw-on-92bc84f; junkwell-01 was
# jw-on-1918bb5, REVERTED 10-05 by the death gate: more mining once bags had room, deaths far from the well, deep).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: one junk well per town (bots/src/well.mjs). A bot at town builds it in survival: a 1x1 shaft two deep at
# the town's canonical site, a wooden trapdoor bottom-half on its floor and a second top-half as a flush cap (one craft
# makes both). A bot at town with >= 34 slots holding listed junk (egg, brown_egg, blue_egg, flint, clay_ball, ink_sac,
# glow_ink_sac, armadillo_scute, dead_bush, pointed_dripstone, rail; and since junkwell-02 the owner's 10-07 decorations --
# glass, wool, buttons, plates, rails, lead, bricks, polished stones, fences -- plus six scaffold-capable stones that go only
# while the bag holds >= 64 cobblestone + cobbled_deepslate: andesite, diorite, granite, stone_bricks, mossy_cobblestone,
# smooth_stone -- while the bag KEEPS 64 reserve stone: cobblestone, cobbled_deepslate, raw andesite/diorite/granite,
# judged at the click. NOTHING else) opens the cap with nobody else within
# 5, throws whole listed stacks from <= 1.15 aimed at the opening, closes it in a finally, and retakes any miss. Vanilla
# despawn (6000 ticking ticks) deletes what lies in the well; nobody can reach it (item 1.8125 below the rim's feet).
# Rows (key=value details):
#   _well_dispose      "slots=a->b freed=N tossed=N n=N misses=N retaken=N recollected=N nonlisted=N other_loss=N server=resync|local
#                       closed_open=0|1 at=x,y,z stop=... items=k:v,..."   (n and items = the SERVER bag's loss)
#   _well_built        "at=x,y,z facing=.. floor=1 wood=.. pit_first=0|1 pit_tossed=N pit_items=N free=N"
#   _well_refused      "order=dispose|build reason=..."
#   _well_left_open    a visit that could not close the cap                                    (must never happen)
#   _well_recollected  a bot collected an item lying in a well's shaft (self-reported)          (must never happen)
#   _well_inside       a bot's feet inside a well column below the rim (self-reported, at most 1/min; the bot digs out
#                       through a wall -- Paper: out in 6-7 s -- so ONE row is a fall it survived; rows spanning >= 2 min
#                       are a bot that could not get out)
#   _well_open_unresolved  an OPEN asked for and not seen within 2 s at cleanup (TRIPWIRE: reported, not gated; close_well
#                       closes any well found open with nobody at it)
#
#   _well_pit_open     an interrupted build left its shaft uncapped (TRIPWIRE: reported; the record keeps it excluded)
#   NOTE (registration): a build digs 1-2 blocks (the shaft) whose drops fall into the shaft and despawn with the junk.
#
#   LIVENESS     canary well rows from the canary build (>= 1); control 0 (control runs the base code).
#   CORRECTNESS  (each judged; any breach REVERTS) -- C1 recollected: _well_recollected rows + recollected= > 0;
#                C2 left open: a _well_left_open / _well_open_unresolved at a (pool, cell) that no later row of the same
#                pool shows CLOSED (cap_end=closed, the cap read back) within OPEN_GRACE (2 min) -- a transient row a
#                visitor fixed is reported, not gated (Claude review P2-4); a visit's status is never taken as a close;
#                C3 non-listed thrown: offlist= > 0 (thrown item entities the SERVER names off the list -- Claude review
#                P1-1: the old nonlisted= was 0 by construction), items= naming anything off the list, or nonlisted= > 0; C4 bots inside a well: _well_inside rows; C5 misses left out:
#                sum(misses) - sum(retaken) on completed visits (a miss another bot took counts as left out); C6 more than
#                one ACTIVE well per pool (built minus breached/_well_retired: a designed rebuild is not a breach).
#                C4 is STUCK INSIDE: one bot's _well_inside rows at one cell spanning >= STUCK_SPAN (2 min); every inside row
#                is a named tripwire.
#   TRIPWIRES    (reported, named) closed_open=1 visits (a cap found open: a crash or a lost close), other_loss= (bag
#                losses during a held phase), unnamed= (thrown entities with no metadata), _well_pit_open, misses on
#                aborted visits, deaths within 3 of a well, refusals per dispose order by reason, no_site per pool.
#                Deaths follow the two-death floor (canary-report.py) -- named here, never a verdict.
#                C7 (junkwell-02) THE STONE GUARD: a visit that CLICKED a scaffold-capable decoration (gclicked= > 0, from
#                its clicks, written right after offlist= so the 300-char cap cannot cut it) whose least reserve left
#                (stone=) is missing or < 64. The END snapshot's reserve stone below 56 on such a visit is a tripwire.
#   DEATH-GATE CONCERN (junkwell-01's revert; REPORTED, the two-death floor decides): mine actions per bot DiD (01 was
#                +34.3 against -8.2..+5.0 on seven other canaries; flagged MINING SHIFT above +15) and every post-window
#                death below y 60 by mechanism, per arm.
#   INSTRUMENT   control bots at >= 34 est. slots holding listed junk (>= 1): the population this changes exists.
#   PRIMARY      listed-junk slots per bot (latest snapshot per bot) and the share of bots at >= 34 slots, DiD vs the
#                same-length pre-window; items and slots freed per visit. REPORTED.
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
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
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)
# well.mjs WELL_JUNK at jw-on-c6e91a8 / jw-on-92bc84f (OWNER_JUNK_1004 + DECORATIONS + SCAFFOLD_DECORATIONS); the build's
# own test asserts the JS list, and the read asserts its copy below against the census names.
OWNER_1004 = {'egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute',
              'dead_bush', 'pointed_dripstone', 'rail'}
_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'crimson', 'warped']
_COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue',
            'brown', 'green', 'red', 'black']
DECORATIONS = ({'glass', 'glass_pane'} | {c + '_stained_glass' for c in _COLOURS} | {c + '_stained_glass_pane' for c in _COLOURS}
               | {c + '_wool' for c in _COLOURS} | {w + '_button' for w in _WOODS} | {'stone_button', 'polished_blackstone_button'}
               | {w + '_pressure_plate' for w in _WOODS} | {'stone_pressure_plate', 'polished_blackstone_pressure_plate'}
               | {'powered_rail', 'detector_rail', 'activator_rail', 'lead', 'brick', 'bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
                  'chiseled_stone_bricks', 'polished_andesite', 'polished_diorite', 'polished_granite', 'smooth_basalt', 'polished_tuff',
                  'tuff_bricks', 'chiseled_tuff_bricks', 'nether_brick_fence'} | {w + '_fence' for w in _WOODS})
GUARDED = {'andesite', 'diorite', 'granite', 'stone_bricks', 'mossy_cobblestone', 'smooth_stone'}
STONE_GUARD = 64
RESERVE_STONE = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite')
LISTED = OWNER_1004 | DECORATIONS | GUARDED
assert len(LISTED) == 124 and not (LISTED & {'cobblestone', 'cobbled_deepslate', 'oak_slab', 'oak_trapdoor', 'red_bed', 'sandstone', 'stone'})
UNDERGROUND_Y = 60
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
# STACK SIZES that are not 64 (Codex review: eggs stack to 16; dividing them by 64 undercounted egg slots fourfold).
ST16 = re.compile(r'^(egg|brown_egg|blue_egg|snowball|ender_pearl|armor_stand|bucket|honey_bottle|.*_sign|.*_hanging_sign|.*_banner)$')


def stack_of(n):
    return 16 if ST16.search(n) else 64
WELL_KINDS = ('_well_dispose', '_well_built', '_well_refused', '_well_left_open', '_well_recollected', '_well_inside', '_well_open_unresolved', '_well_pit_open', '_well_retired')
OPEN_GRACE = dt.timedelta(minutes=2)   # C2: a cap left open that no visit closed within this long
STUCK_SPAN = dt.timedelta(minutes=2)   # C4: inside rows (<= 1/min) for one bot at one cell spanning this long = no escape


def load_window(since, until):
    """Rotation-aware (composterread's pattern): skill logs rotate daily at ~23:59Z (copytruncate), so day D's rows live
    in skill-*.jsonl-<D+1>.gz and the live file starts at ~23:59Z. Reading only the live files drops every earlier row."""
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
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def occupancy(inv):
    # a LOWER BOUND on slots from aggregated counts (a split stack cannot be seen in a name -> count map)
    return sum(c if UN.search(n) else -(-c // stack_of(n)) for n, c in (inv or {}).items() if isinstance(c, (int, float)))


def kv(d):
    """key=value fields of a well row; items= parsed into a dict."""
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out[m.group(1)] = m.group(2)
    items = {}
    for part in (out.get('items') or '-').split(','):
        k, _, v = part.partition(':')
        if v.isdigit():
            items[k] = int(v)
    out['items'] = items
    return out


def num(f, k):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return 0


# POSITIVE CONTROL for the parser: well.mjs wellDisposeDetail's own shape (bots/test/well.test.mjs reads the same fields).
_p = kv('slots=36->32 freed=4 tossed=4 n=110 misses=1 retaken=1 recollected=0 nonlisted=0 other_loss=1 server=resync closed_open=0 at=5,63,0 stop=done items=egg:16,flint:64,ink_sac:10,clay_ball:20')
assert num(_p, 'freed') == 4 and num(_p, 'misses') == 1 and _p['server'] == 'resync' and _p['items'] == {'egg': 16, 'flint': 64, 'ink_sac': 10, 'clay_ball': 20}
assert _p['at'] == '5,63,0' and _p['stop'] == 'done'
assert kv('slots=36->36 freed=0 tossed=0 n=0 misses=0 retaken=0 recollected=0 nonlisted=0 server=local closed_open=0 stop=nothing_listed items=-')['items'] == {}
assert kv('at=-12,70,3 facing=north floor=1 wood=oak pit_first=1 pit_tossed=2 pit_items=32 free=3')['at'] == '-12,70,3'
assert set(_p['items']) <= LISTED and not ({'cobblestone': 1}.keys() <= LISTED)
assert stack_of('egg') == 16 and stack_of('flint') == 64 and -(-576 // stack_of('egg')) == 36   # 576 eggs are 36 slots, not 9
assert kv('slots=36->34 offlist=0 gclicked=10 stone=63 stop=done items=diorite:10,glass:5')['stone'] == '63'

def c3_breach(f):
    """C3 for one _well_dispose row's fields -> the off-list evidence, or None."""
    off = [n for n in f['items'] if n not in LISTED]
    if num(f, 'offlist') or off or num(f, 'nonlisted'):
        return {'offlist': num(f, 'offlist'), 'offlist_items': f.get('offlist_items'), 'items_off': off, 'nonlisted': num(f, 'nonlisted')}
    return None


def c7_breach(f):
    """C7 for one _well_dispose row -> evidence, or None. The bot's own clicks: gclicked= (scaffold-capable decorations
    clicked) > 0 with stone= (the least reserve stone any of those clicks left) missing or < STONE_GUARD."""
    st = f.get('stone')
    if num(f, 'gclicked') > 0 and (st is None or not str(st).isdigit() or int(st) < STONE_GUARD):
        return {'gclicked': num(f, 'gclicked'), 'stone': st}
    return None


def guarded_unclicked(f):
    """TRIPWIRE, never a gate (Claude r2): a guarded name in items= on a row with gclicked=0. items= is the server bag's
    loss across the whole phase, retake walk included, and the pathfinder/pillar reflex may PLACE these stones as
    scaffold there -- so this names a row to look at, it is not evidence of a throw."""
    g = sorted(n for n in f['items'] if n in GUARDED)
    return g if g and num(f, 'gclicked') == 0 else None


def mechanism(detail):
    """A death row's mechanism: the clause before ';' / ' after ' / ' while ' ('drowned', 'fell from a high place', 'tried to swim in lava')."""
    d = (detail or '').split(';')[0].split(' | ')[0]
    for sep in (' after ', ' while ', ' whilst '):
        d = d.split(sep)[0]
    return d.strip()[:40] or '?'


def open_breaches(opens, closes, end):
    """C2: opens [(t, (pool, at), bot)] with no close [(t, (pool, at))] -- a row whose cap READ BACK closed -- of the same
    pool and cell within OPEN_GRACE -> (breaches, pending)."""
    br, pend = [], []
    for t, key, b in opens:
        if any(c_key == key and t <= c_t <= t + OPEN_GRACE for c_t, c_key in closes):
            continue
        (pend if t + OPEN_GRACE > end else br).append((b, key, str(t)))
    return br, pend


def stuck_inside(rows_):
    """C4: [(t, bot, at)] -> [(bot, at, span)] for each bot whose inside rows at one cell span >= STUCK_SPAN with no gap
    over 90 s (rows come at most once a minute while the bot stays inside)."""
    out, runs = [], {}
    for t, b, at in sorted(rows_):
        k = (b, at)
        first, last = runs.get(k, (t, t))
        if t - last > dt.timedelta(seconds=90):
            first = t
        runs[k] = (first, t)
        if t - first >= STUCK_SPAN and not any(o[0] == b and o[1] == at for o in out):
            out.append((b, at, str(t - first)))
    return out


def is_close(f):
    """A row that PROVES the cap closed: its own read-back (cap_end=closed). Never the visit's status (Codex round 5)."""
    return f.get('cap_end') == 'closed'


# POSITIVE CONTROLS for the gates (each must be able to fire): the row the fake server's iron substitution writes
# (bots/test/well.test.mjs 'C3 FIRES'), and a left-open cap nobody closed vs one a visitor closed 30 s later.
assert (c3_breach(kv('slots=35->32 offlist=1 offlist_items=iron_ingot:5 unnamed=0 freed=3 tossed=3 n=80 misses=0 retaken=0 recollected=0 nonlisted=0 other_loss=5 server=resync closed_open=0 stop=done items=egg:16,flint:64')) or {}).get('offlist') == 1, 'C3 must fire on a server-named off-list throw'
assert c3_breach(kv('slots=35->32 offlist=0 offlist_items=- unnamed=0 freed=3 tossed=3 n=83 nonlisted=0 server=resync stop=done items=egg:16,flint:64,rail:3')) is None
_t0 = dt.datetime(2026, 10, 5, tzinfo=dt.timezone.utc)
_k = ('hive-a', '1,2,3')
assert open_breaches([(_t0, _k, 'a')], [], _t0 + dt.timedelta(minutes=10))[0]
assert not open_breaches([(_t0, _k, 'a')], [(_t0 + dt.timedelta(seconds=30), _k)], _t0 + dt.timedelta(minutes=10))[0]
assert open_breaches([(_t0, _k, 'a')], [], _t0 + dt.timedelta(seconds=30))[1]   # too recent to judge: pending
assert stuck_inside([(_t0 + dt.timedelta(minutes=m), 'a', '1,2,3') for m in (0, 1, 2)]), 'C4 must fire on 3 inside rows over 2 min'
assert not stuck_inside([(_t0, 'a', '1,2,3')]), 'one inside row (a fall the bot dug out of) is a tripwire, not C4'
assert not stuck_inside([(_t0, 'a', '1,2,3'), (_t0 + dt.timedelta(minutes=10), 'a', '1,2,3')]), 'two separate falls are not one stay'
assert open_breaches([(_t0, _k, 'a')], [(_t0 + dt.timedelta(seconds=30), ('board-b', '1,2,3'))], _t0 + dt.timedelta(minutes=10))[0], 'another pool\'s cell is not this close'
# C7 POSITIVE CONTROL: a guarded stone thrown under the guard fires; at the guard, or a plain decoration, does not
assert c7_breach(kv('slots=36->34 offlist=0 gclicked=10 stone=63 offlist_items=- server=resync stop=done items=diorite:10,glass:5')) == {'gclicked': 10, 'stone': '63'}
assert c7_breach(kv('slots=36->34 offlist=0 gclicked=10 stone=64 offlist_items=- server=resync stop=done items=diorite:10,glass:5')) is None
assert c7_breach(kv('slots=36->35 offlist=0 gclicked=0 stone=0 offlist_items=- server=resync stop=done items=glass:5')) is None
assert c7_breach(kv('slots=36->35 offlist=0 gclicked=3 offlist_items=- server=resync stop=done items=granite:3')) is not None   # no stone=
# a glass-only visit whose retake walk placed one diorite as scaffold: NOT a breach (Claude r2), a named tripwire
assert c7_breach(kv('slots=36->35 offlist=0 gclicked=0 offlist_items=- server=resync stop=done items=glass:20,diorite:1')) is None
assert guarded_unclicked(kv('slots=36->35 offlist=0 gclicked=0 offlist_items=- server=resync stop=done items=glass:20,diorite:1')) == ['diorite']
assert guarded_unclicked(kv('slots=36->34 offlist=0 gclicked=10 stone=70 offlist_items=- server=resync stop=done items=diorite:10')) is None
# a row the 300-char cap cut inside items= still carries gclicked/stone (bots/test/well.test.mjs builds the same row)
_cut = kv('slots=36->31 offlist=0 gclicked=64 stone=63 offlist_items=- unnamed=0 freed=5 tossed=5 n=320 misses=0 retaken=0 recollected=0 nonlisted=0 other_loss=0 server=resync closed_open=0 at=1000,64,-1000 stop=done items=white_stained_glass_pane:64,light_gray_stained_glass_pane:64,light_blue_stained_glass_pane:64,magenta_stained_glass_pane:64,diori')
assert c7_breach(_cut) == {'gclicked': 64, 'stone': '63'}
assert mechanism('drowned; idle at the moment of death | leading up: goto->success') == 'drowned'
assert mechanism('fell from a high place after falling 30 blocks; was running gather') == 'fell from a high place'
# the visit that LEFT it open still ends "success" (junk went down): its cap_end=open row is no close
assert not is_close(kv('slots=36->33 offlist=0 freed=3 tossed=3 n=144 server=resync closed_open=0 cap_end=open at=1,2,3 stop=done items=egg:16'))
assert is_close(kv('slots=36->36 offlist=0 freed=0 tossed=0 n=0 server=local closed_open=1 cap_end=closed at=1,2,3 stop=closed_only items=-'))

ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
rows = Counter(); kinds = Counter(); offbuild = 0
c1 = []; c3 = []; c4 = []; misses = retaken = 0; built = defaultdict(Counter); breached = defaultdict(set)
visits = 0; items_out = 0; freed = []; refused = Counter(); resynced = 0; pit = 0; deaths = Counter(); unresolved = 0
opens = []; closes = []; closed_open = []; other_loss = 0; unnamed = 0; pit_open = []; aborted_misses = 0
orders = Counter(); refused_pool = defaultdict(Counter); death_pos = []; well_cells = set(); inside_rows = []
c7 = []; g_unclicked = []; guard_low_end = []; mines = defaultdict(Counter); deep_deaths = defaultdict(Counter); deep_list = []
deaths_nopos = Counter(); qual = defaultdict(set)
botsets = defaultdict(lambda: defaultdict(set)); last = defaultdict(dict); totals = Counter()
for r in ev_rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(b); totals[(period, arm)] += 1
    k = r.get('name'); d = r.get('detail') or ''
    inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory')
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if isinstance(inv, dict) and inv and not other:
        last[period][b] = inv
    if not other:
        qual[(period, arm)].add(b)       # build-qualified bots: the mine DiD's denominator (Codex r1 P2)
    if k == 'mine' and not other:
        mines[(period, arm)][b] += 1
    if k == '_death' and period == 'post':
        deaths[arm] += 1
        pos = ((r.get('raw') or {}).get('bot') or {}).get('pos') or (r.get('bot') or {}).get('pos')
        if not (isinstance(pos, dict) and isinstance(pos.get('y'), (int, float))):
            deaths_nopos[arm] += 1
        if isinstance(pos, dict):
            death_pos.append((arm, b, pos))
            if isinstance(pos.get('y'), (int, float)) and pos['y'] < UNDERGROUND_Y:
                deep_deaths[arm][mechanism(d)] += 1
                deep_list.append((arm, b, round(pos['y']), mechanism(d)))
    if k == '_work_order' and period == 'post' and arm == 'canary' and d.startswith('dispose_well'):
        orders[pool_of(b)] += 1
    if k not in WELL_KINDS or period != 'post':
        continue
    if other:
        offbuild += 1
        continue
    rows[arm] += 1; kinds[(arm, k)] += 1
    st = ((r.get('raw') or {}).get('skill') or {}).get('status') or r.get('status')
    f = kv(d)
    if f.get('at'):
        well_cells.add(f['at'])
    if k in ('_well_left_open', '_well_open_unresolved'):
        opens.append((t, (pool_of(b), f.get('at', '?')), b))
        unresolved += k == '_well_open_unresolved'
    elif k == '_well_recollected':
        c1.append((b, d[:100]))
    elif k == '_well_inside':
        inside_rows.append((t, b, f.get('at', '?')))
    elif k == '_well_pit_open':
        pit_open.append((b, f.get('at'), f.get('stage')))
    elif k == '_well_refused':
        refused[f.get('reason', '?')] += 1
        if arm == 'canary':
            refused_pool[pool_of(b)][f.get('reason', '?')] += 1
        if f.get('reason') == 'breached' and f.get('at'):
            breached[pool_of(b)].add(f['at'])
    elif k == '_well_retired':
        if f.get('at'):
            breached[pool_of(b)].add(f['at'])
    elif k == '_well_built':
        built[pool_of(b)][f.get('at', '?')] += 1
        pit += num(f, 'pit_first')
    elif k == '_well_dispose':
        if num(f, 'recollected'):
            c1.append((b, 'recollected=%d %s' % (num(f, 'recollected'), d[:80])))
        why = c3_breach(f)
        if why:
            c3.append((b, why, d[:100]))
        why7 = c7_breach(f)
        if why7:
            c7.append((b, why7, d[:100]))
        gu = guarded_unclicked(f)
        if gu:
            g_unclicked.append((b, gu))
        if num(f, 'gclicked') > 0 and isinstance(inv, dict) and sum(inv.get(n, 0) for n in RESERVE_STONE) < STONE_GUARD - 8:
            guard_low_end.append((b, sum(inv.get(n, 0) for n in RESERVE_STONE)))
        other_loss += num(f, 'other_loss'); unnamed += num(f, 'unnamed')
        if num(f, 'closed_open'):
            closed_open.append((b, f.get('at')))
        # A CLOSE: only a row whose cap was READ BACK closed (Codex round 5: status is not evidence)
        if f.get('at') and is_close(f):
            closes.append((t, (pool_of(b), f['at'])))
        if st in ('success', 'failed') and f.get('stop') != 'aborted':
            misses += num(f, 'misses'); retaken += num(f, 'retaken')
        elif f.get('stop') == 'aborted':
            aborted_misses += num(f, 'misses')
        n = num(f, 'n')
        if n > 0:
            visits += 1; items_out += n; freed.append(num(f, 'freed')); resynced += int(f.get('server') == 'resync')


def junk_slots(inv):
    return sum(-(-c // stack_of(n)) for n, c in inv.items() if n in LISTED and isinstance(c, (int, float)))


def owner_slots(inv):
    return sum(-(-c // stack_of(n)) for n, c in inv.items() if n in OWNER_1004 and isinstance(c, (int, float)))


def deco_slots(inv):
    return sum(-(-c // stack_of(n)) for n, c in inv.items() if n in (DECORATIONS | GUARDED) and isinstance(c, (int, float)))


def per_bot(period, arm, fn):
    vals = [fn(inv) for b, inv in last[period].items() if (pool_of(b) in CANS) == (arm == 'canary')]
    return sum(vals) / len(vals) if vals else float('nan')


full = lambda inv: float(occupancy(inv) >= 34)
v = {(p, a, nm): per_bot(p, a, fn) for p in ('pre', 'post') for a in ('canary', 'control')
     for nm, fn in (('junk', junk_slots), ('full', full), ('owner', owner_slots), ('deco', deco_slots))}


def mine_per_bot(period, arm):
    n = len(qual[(period, arm)])
    return sum(mines[(period, arm)].values()) / n if n else float('nan')


mpb = {(p, a): mine_per_bot(p, a) for p in ('pre', 'post') for a in ('canary', 'control')}
mine_rows = {(p, a): sum(mines[(p, a)].values()) for p in ('pre', 'post') for a in ('canary', 'control')}
# POSITIVE CONTROL (Claude r1 P2): the control's pre-window mine rows must be visible, or the DiD is unknown, never 0.0
mine_blind = mine_rows[('pre', 'control')] == 0 or mine_rows[('post', 'control')] == 0
mine_did = float('nan') if mine_blind else (mpb[('post', 'canary')] - mpb[('pre', 'canary')]) - (mpb[('post', 'control')] - mpb[('pre', 'control')])
did = lambda nm: (v[('post', 'canary', nm)] - v[('pre', 'canary', nm)]) - (v[('post', 'control', nm)] - v[('pre', 'control', nm)])
inst = sum(1 for b, inv in last['post'].items() if pool_of(b) not in CANS and occupancy(inv) >= 34 and junk_slots(inv) > 0)
def active_wells(built_cells, retired_cells):
    return set(built_cells) - set(retired_cells)


assert active_wells({'1,2,3', '9,2,3'}, {'1,2,3'}) == {'9,2,3'}             # the designed rebuild: one active well
assert len(active_wells({'1,2,3', '9,2,3'}, set())) == 2                       # two live wells in one pool: C6 fires
active = {p: active_wells(cells, breached[p]) for p, cells in built.items()}
c6 = {p: len(cells) for p, cells in active.items() if len(cells) > 1}
c5 = max(0, misses - retaken)
c2, c2_pending = open_breaches(opens, closes, END)
c4 = stuck_inside(inside_rows)


def near_well(pos):
    for at in well_cells:
        try:
            x, y, z = (int(v) for v in at.split(','))
        except ValueError:
            continue
        if abs(pos.get('x', 1e9) - (x + 0.5)) <= 3 and abs(pos.get('z', 1e9) - (z + 0.5)) <= 3 and abs(pos.get('y', 1e9) - (y + 1)) <= 3:
            return at
    return None


deaths_near = [(a, b, near_well(p)) for a, b, p in death_pos if near_well(p)]
refusal_rate = {p: {r_: '%d/%d' % (n, orders[p]) for r_, n in c.items()} for p, c in refused_pool.items()}
print('-' * 78)
print('DENOMINATORS rows post canary %d / control %d | bots post canary %d / control %d | snapshots pre %d post %d'
      % (totals[('post', 'canary')], totals[('post', 'control')], len(botsets['post']['canary']), len(botsets['post']['control']),
         len(last['pre']), len(last['post'])))
print('LIVENESS     canary well rows %d (>= 1) | control %d (must be 0) | other build %d | by kind %s'
      % (rows['canary'], rows['control'], offbuild, dict((k2, n) for (a, k2), n in kinds.items() if a == 'canary')))
print('CORRECTNESS  C1 recollected %d | C2 left open > 2 min %d (pending %d) | C3 non-listed thrown %d | C4 bots stuck inside a well >= 2 min %d | C5 misses left out %d (misses %d, retaken %d) | C6 pools with > 1 ACTIVE well %s'
      % (len(c1), len(c2), len(c2_pending), len(c3), len(c4), c5, misses, retaken, c6 or 0))
print('             wells built %s | breached %s | pit-first builds %d | disposal visits %d (server-resynced %d) | refusals %s'
      % ({p: dict(c) for p, c in built.items()}, {p: sorted(c) for p, c in breached.items() if c}, pit, visits, resynced, dict(refused)))
print('TRIPWIRES    inside rows %d %s | caps found open (closed_open=1) %d %s | open rows %d (unresolved %d) | other_loss %d | unnamed thrown %d | pits left open %d %s | aborted-visit misses %d'
      % (len(inside_rows), [(b, at) for _, b, at in inside_rows[:3]], len(closed_open), closed_open[:3], len(opens), unresolved, other_loss, unnamed, len(pit_open), pit_open[:3], aborted_misses))
print('             refusals per dispose order (canary) %s | no_site per pool %s | deaths within 3 of a well %s'
      % (refusal_rate or '-', {p: c['no_site'] for p, c in refused_pool.items() if c.get('no_site')} or '-', deaths_near or '-'))
print('             deaths canary %d control %d (two-death floor: canary-report.py decides; one death is named, not a verdict)' % (deaths['canary'], deaths['control']))
print('             C7 stone guard breaches %d %s | guarded throws ending under %d reserve stone (tripwire) %d %s | guarded stone lost on a gclicked=0 visit (tripwire: scaffold placed on the retake walk?) %d %s'
      % (len(c7), c7[:3], STONE_GUARD - 8, len(guard_low_end), guard_low_end[:3], len(g_unclicked), g_unclicked[:3]))
print('DEATH-GATE   mine actions/bot canary %.1f -> %.1f control %.1f -> %.1f DiD %+.1f%s (junkwell-01: +34.3; 7 other canaries -8.2..+5.0)'
      % (mpb[('pre', 'canary')], mpb[('post', 'canary')], mpb[('pre', 'control')], mpb[('post', 'control')], mine_did,
         '  ** MINING SHIFT **' if mine_did == mine_did and mine_did > 15 else ''))
print('             deaths below y %d by mechanism: canary %s | control %s | %s | deaths with no usable position: canary %d control %d (never read as shallow)'
      % (UNDERGROUND_Y, dict(deep_deaths['canary']) or '-', dict(deep_deaths['control']) or '-', [x for x in deep_list if x[0] == 'canary'][:6],
         deaths_nopos['canary'], deaths_nopos['control']))
print('             mine rows (bots) pre canary %d (%d) control %d (%d) | post canary %d (%d) control %d (%d)%s'
      % (mine_rows[('pre', 'canary')], len(qual[('pre', 'canary')]), mine_rows[('pre', 'control')], len(qual[('pre', 'control')]),
         mine_rows[('post', 'canary')], len(qual[('post', 'canary')]), mine_rows[('post', 'control')], len(qual[('post', 'control')]),
         '  ** MINE QUERY BLIND: the control shows no mine rows -- the DiD is unknown, not zero **' if mine_blind else ''))
print('INSTRUMENT   control bots at >= 34 slots holding listed junk: %d (>= 1)' % inst)
print('PRIMARY      listed-junk slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | share at >= 34 DiD %+.3f | items out %d | slots freed/visit %s'
      % (v[('pre', 'canary', 'junk')], v[('post', 'canary', 'junk')], v[('pre', 'control', 'junk')], v[('post', 'control', 'junk')],
         did('junk'), did('full'), items_out, ('%.2f' % (sum(freed) / len(freed))) if freed else '-'))
print('             owner-junk (10-04) slots/bot DiD %+.2f | decoration slots/bot DiD %+.2f'
      % (did('owner'), did('deco')))
for x in (c1[:3] + c2[:3] + c3[:3] + c4[:3] + c7[:3]):
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('wellread', W, {
        'rows_canary': rows['canary'], 'rows_control': rows['control'], 'offbuild_canary': offbuild,
        'breach_recollected': len(c1), 'breach_left_open': len(c2), 'breach_nonlisted': len(c3), 'breach_inside': len(c4),
        'breach_misses_left': c5, 'breach_multi_well': len(c6), 'open_unresolved': unresolved, 'open_pending': len(c2_pending),
        'breach_stone_guard': len(c7), 'guard_low_end': len(guard_low_end), 'guarded_unclicked': len(g_unclicked),
        'mine_did': None if mine_did != mine_did else round(mine_did, 2),
        'deep_deaths_canary': sum(deep_deaths['canary'].values()), 'deep_deaths_control': sum(deep_deaths['control'].values()),
        'deaths_nopos_canary': deaths_nopos['canary'], 'deaths_nopos_control': deaths_nopos['control'],
        'owner_slots_did': None if did('owner') != did('owner') else round(did('owner'), 3),
        'deco_slots_did': None if did('deco') != did('deco') else round(did('deco'), 3),
        'caps_found_open': len(closed_open), 'inside_rows': len(inside_rows), 'other_loss': other_loss, 'pits_left_open': len(pit_open), 'deaths_near_well': len(deaths_near),
        'dispose_visits_canary': visits, 'wells_built_canary': sum(len(c) for c in built.values()), 'instrument_control': inst,
        'junk_slots_did': None if did('junk') != did('junk') else round(did('junk'), 3),
        'full_share_did': None if did('full') != did('full') else round(did('full'), 4),
        'exposure_ready': int(visits >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
