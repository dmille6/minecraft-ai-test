#!/usr/bin/env python3
# wellread.py [window_min] -- the read for canary `junkwell-01` (branch jw-on-1918bb5).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: one junk well per town (bots/src/well.mjs). A bot at town builds it in survival: a 1x1 shaft two deep at
# the town's canonical site, a wooden trapdoor bottom-half on its floor and a second top-half as a flush cap (one craft
# makes both). A bot at town with >= 34 slots holding listed junk (egg, brown_egg, blue_egg, flint, clay_ball, ink_sac,
# glow_ink_sac, armadillo_scute, dead_bush, pointed_dripstone, rail -- NOTHING else) opens the cap with nobody else within
# 5, throws whole listed stacks from <= 1.15 aimed at the opening, closes it in a finally, and retakes any miss. Vanilla
# despawn (6000 ticking ticks) deletes what lies in the well; nobody can reach it (item 1.8125 below the rim's feet).
# Rows (key=value details):
#   _well_dispose      "slots=a->b freed=N tossed=N n=N misses=N retaken=N recollected=N nonlisted=N other_loss=N server=resync|local
#                       closed_open=0|1 at=x,y,z stop=... items=k:v,..."   (n and items = the SERVER bag's loss)
#   _well_built        "at=x,y,z facing=.. floor=1 wood=.. pit_first=0|1 pit_tossed=N pit_items=N free=N"
#   _well_refused      "order=dispose|build reason=..."
#   _well_left_open    a visit that could not close the cap                                    (must never happen)
#   _well_recollected  a bot collected an item lying in a well's shaft (self-reported)          (must never happen)
#   _well_inside       a bot's feet inside a well column below the rim (self-reported, 1/min)   (must never happen)
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
#   TRIPWIRES    (reported, named) closed_open=1 visits (a cap found open: a crash or a lost close), other_loss= (bag
#                losses during a held phase), unnamed= (thrown entities with no metadata), _well_pit_open, misses on
#                aborted visits, deaths within 3 of a well, refusals per dispose order by reason, no_site per pool.
#                Deaths follow the two-death floor (canary-report.py) -- named here, never a verdict.
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
# well.mjs WELL_JUNK at jw-on-1918bb5.
LISTED = {'egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute',
          'dead_bush', 'pointed_dripstone', 'rail'}
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
# STACK SIZES that are not 64 (Codex review: eggs stack to 16; dividing them by 64 undercounted egg slots fourfold).
ST16 = re.compile(r'^(egg|brown_egg|blue_egg|snowball|ender_pearl|armor_stand|bucket|honey_bottle|.*_sign|.*_hanging_sign|.*_banner)$')


def stack_of(n):
    return 16 if ST16.search(n) else 64
WELL_KINDS = ('_well_dispose', '_well_built', '_well_refused', '_well_left_open', '_well_recollected', '_well_inside', '_well_open_unresolved', '_well_pit_open', '_well_retired')
OPEN_GRACE = dt.timedelta(minutes=2)   # C2: a cap left open that no visit closed within this long


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

def c3_breach(f):
    """C3 for one _well_dispose row's fields -> the off-list evidence, or None."""
    off = [n for n in f['items'] if n not in LISTED]
    if num(f, 'offlist') or off or num(f, 'nonlisted'):
        return {'offlist': num(f, 'offlist'), 'offlist_items': f.get('offlist_items'), 'items_off': off, 'nonlisted': num(f, 'nonlisted')}
    return None


def open_breaches(opens, closes, end):
    """C2: opens [(t, (pool, at), bot)] with no close [(t, (pool, at))] -- a row whose cap READ BACK closed -- of the same
    pool and cell within OPEN_GRACE -> (breaches, pending)."""
    br, pend = [], []
    for t, key, b in opens:
        if any(c_key == key and t <= c_t <= t + OPEN_GRACE for c_t, c_key in closes):
            continue
        (pend if t + OPEN_GRACE > end else br).append((b, key, str(t)))
    return br, pend


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
assert open_breaches([(_t0, _k, 'a')], [(_t0 + dt.timedelta(seconds=30), ('board-b', '1,2,3'))], _t0 + dt.timedelta(minutes=10))[0], 'another pool\'s cell is not this close'
# the visit that LEFT it open still ends "success" (junk went down): its cap_end=open row is no close
assert not is_close(kv('slots=36->33 offlist=0 freed=3 tossed=3 n=144 server=resync closed_open=0 cap_end=open at=1,2,3 stop=done items=egg:16'))
assert is_close(kv('slots=36->36 offlist=0 freed=0 tossed=0 n=0 server=local closed_open=1 cap_end=closed at=1,2,3 stop=closed_only items=-'))

ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
rows = Counter(); kinds = Counter(); offbuild = 0
c1 = []; c3 = []; c4 = []; misses = retaken = 0; built = defaultdict(Counter); breached = defaultdict(set)
visits = 0; items_out = 0; freed = []; refused = Counter(); resynced = 0; pit = 0; deaths = Counter(); unresolved = 0
opens = []; closes = []; closed_open = []; other_loss = 0; unnamed = 0; pit_open = []; aborted_misses = 0
orders = Counter(); refused_pool = defaultdict(Counter); death_pos = []; well_cells = set()
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
    if k == '_death' and period == 'post':
        deaths[arm] += 1
        pos = ((r.get('raw') or {}).get('bot') or {}).get('pos') or (r.get('bot') or {}).get('pos')
        if isinstance(pos, dict):
            death_pos.append((arm, b, pos))
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
        c4.append((b, d[:100]))
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


def per_bot(period, arm, fn):
    vals = [fn(inv) for b, inv in last[period].items() if (pool_of(b) in CANS) == (arm == 'canary')]
    return sum(vals) / len(vals) if vals else float('nan')


full = lambda inv: float(occupancy(inv) >= 34)
v = {(p, a, nm): per_bot(p, a, fn) for p in ('pre', 'post') for a in ('canary', 'control') for nm, fn in (('junk', junk_slots), ('full', full))}
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
print('CORRECTNESS  C1 recollected %d | C2 left open > 2 min %d (pending %d) | C3 non-listed thrown %d | C4 bots inside a well %d | C5 misses left out %d (misses %d, retaken %d) | C6 pools with > 1 ACTIVE well %s'
      % (len(c1), len(c2), len(c2_pending), len(c3), len(c4), c5, misses, retaken, c6 or 0))
print('             wells built %s | breached %s | pit-first builds %d | disposal visits %d (server-resynced %d) | refusals %s'
      % ({p: dict(c) for p, c in built.items()}, {p: sorted(c) for p, c in breached.items() if c}, pit, visits, resynced, dict(refused)))
print('TRIPWIRES    caps found open (closed_open=1) %d %s | open rows %d (unresolved %d) | other_loss %d | unnamed thrown %d | pits left open %d %s | aborted-visit misses %d'
      % (len(closed_open), closed_open[:3], len(opens), unresolved, other_loss, unnamed, len(pit_open), pit_open[:3], aborted_misses))
print('             refusals per dispose order (canary) %s | no_site per pool %s | deaths within 3 of a well %s'
      % (refusal_rate or '-', {p: c['no_site'] for p, c in refused_pool.items() if c.get('no_site')} or '-', deaths_near or '-'))
print('             deaths canary %d control %d (two-death floor: canary-report.py decides; one death is named, not a verdict)' % (deaths['canary'], deaths['control']))
print('INSTRUMENT   control bots at >= 34 slots holding listed junk: %d (>= 1)' % inst)
print('PRIMARY      listed-junk slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | share at >= 34 DiD %+.3f | items out %d | slots freed/visit %s'
      % (v[('pre', 'canary', 'junk')], v[('post', 'canary', 'junk')], v[('pre', 'control', 'junk')], v[('post', 'control', 'junk')],
         did('junk'), did('full'), items_out, ('%.2f' % (sum(freed) / len(freed))) if freed else '-'))
for x in (c1[:3] + c2[:3] + c3[:3] + c4[:3]):
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
        'caps_found_open': len(closed_open), 'other_loss': other_loss, 'pits_left_open': len(pit_open), 'deaths_near_well': len(deaths_near),
        'dispose_visits_canary': visits, 'wells_built_canary': sum(len(c) for c in built.values()), 'instrument_control': inst,
        'junk_slots_did': None if did('junk') != did('junk') else round(did('junk'), 3),
        'full_share_did': None if did('full') != did('full') else round(did('full'), 4),
        'exposure_ready': int(visits >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
