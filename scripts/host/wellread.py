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
#   LIVENESS     canary well rows from the canary build (>= 1); control 0 (control runs the base code).
#   CORRECTNESS  (each judged; any breach REVERTS) -- C1 recollected: _well_recollected rows + recollected= > 0;
#                C2 left open: _well_left_open rows; C3 non-listed thrown: items= naming anything off the list, or
#                nonlisted= > 0 (a CLICKED slot that held a non-listed item, from the server's before-snapshot; other_loss=
#                is eating/planting meanwhile and is reported, never gated); C4 bots inside a well: _well_inside rows; C5 misses left out:
#                sum(misses) - sum(retaken) on completed visits; C6 more than one distinct well cell built per pool.
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
WELL_KINDS = ('_well_dispose', '_well_built', '_well_refused', '_well_left_open', '_well_recollected', '_well_inside', '_well_open_unresolved')


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

ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
rows = Counter(); kinds = Counter(); offbuild = 0
c1 = []; c2 = []; c3 = []; c4 = []; misses = retaken = 0; built = defaultdict(Counter)
visits = 0; items_out = 0; freed = []; refused = Counter(); resynced = 0; pit = 0; deaths = Counter(); unresolved = 0
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
    if k not in WELL_KINDS or period != 'post':
        continue
    if other:
        offbuild += 1
        continue
    rows[arm] += 1; kinds[(arm, k)] += 1
    st = ((r.get('raw') or {}).get('skill') or {}).get('status') or r.get('status')
    f = kv(d)
    if k == '_well_left_open':
        c2.append((b, d[:100]))
    elif k == '_well_recollected':
        c1.append((b, d[:100]))
    elif k == '_well_inside':
        c4.append((b, d[:100]))
    elif k == '_well_open_unresolved':
        unresolved += 1
    elif k == '_well_refused':
        refused[f.get('reason', '?')] += 1
    elif k == '_well_built':
        built[pool_of(b)][f.get('at', '?')] += 1
        pit += num(f, 'pit_first')
    elif k == '_well_dispose':
        if num(f, 'recollected'):
            c1.append((b, 'recollected=%d %s' % (num(f, 'recollected'), d[:80])))
        off = [n for n in f['items'] if n not in LISTED]
        if off or num(f, 'nonlisted'):
            c3.append((b, off or 'nonlisted=%d' % num(f, 'nonlisted'), d[:100]))
        if st in ('success', 'failed') and f.get('stop') != 'aborted':
            misses += num(f, 'misses'); retaken += num(f, 'retaken')
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
c6 = {p: len(cells) for p, cells in built.items() if len(cells) > 1}
c5 = max(0, misses - retaken)
print('-' * 78)
print('DENOMINATORS rows post canary %d / control %d | bots post canary %d / control %d | snapshots pre %d post %d'
      % (totals[('post', 'canary')], totals[('post', 'control')], len(botsets['post']['canary']), len(botsets['post']['control']),
         len(last['pre']), len(last['post'])))
print('LIVENESS     canary well rows %d (>= 1) | control %d (must be 0) | other build %d | by kind %s'
      % (rows['canary'], rows['control'], offbuild, dict((k2, n) for (a, k2), n in kinds.items() if a == 'canary')))
print('CORRECTNESS  C1 recollected %d | C2 left open %d | C3 non-listed thrown %d | C4 bots inside a well %d | C5 misses left out %d (misses %d, retaken %d) | C6 pools with > 1 well %s'
      % (len(c1), len(c2), len(c3), len(c4), c5, misses, retaken, c6 or 0))
print('             wells built %s | pit-first builds %d | disposal visits %d (server-resynced %d) | refusals %s | open unresolved %d (tripwire)'
      % ({p: dict(c) for p, c in built.items()}, pit, visits, resynced, dict(refused), unresolved))
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
        'breach_misses_left': c5, 'breach_multi_well': len(c6), 'open_unresolved': unresolved,
        'dispose_visits_canary': visits, 'wells_built_canary': sum(len(c) for c in built.values()), 'instrument_control': inst,
        'junk_slots_did': None if did('junk') != did('junk') else round(did('junk'), 3),
        'full_share_did': None if did('full') != did('full') else round(did('full'), 4),
        'exposure_ready': int(visits >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
