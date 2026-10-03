#!/usr/bin/env python3
# composterread.py [window_min] -- the read for canary `composter-01` (branch co-on-ffa0f57, built on craftroom).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: one composter per town. A bot at town with room (chain room simulated: from logs 2 free slots) builds it
# from logs (planks -> table -> slabs -> composter) through craftroom's executor; a bot at town with >= 34 slots composts
# leaf litter / seeds / flowers (and saplings above a reserve of 16), never food, logs, ores or tools, collects the bone
# meal, drops nothing. Rows: `_compost` (detail "slots=a->b level=x->y bonemeal=N n=N stop=... items=k:v,...", END
# snapshot) and `_composter_built` (detail "at=x,y,z wood=.. free=N need=M table=..").
# PAPER SANDBOX 10-03 (948bc26, the same code but for logpickup): build 9/9 exact; compost 6/6 with all bone meal in the
# bag at the fleet's 20 s stuck limit; never starts a build at 35-36/36.
#
#   LIVENESS     canary `_compost` or `_composter_built` rows from the canary build (>= 1); control 0.
#   CORRECTNESS  (each judged; any breach REVERTS) -- C1: a compost row whose items include anything that is not
#                compostable junk or a sapling (food, logs, ores, tools...); C2: a compost row that composted saplings
#                but ENDS with fewer than 16 of that sapling; C3: more than one `_composter_built` per pool (one per
#                town -- distinct `at=` cells; a same-cell rebuild after a creeper is reported, not gated); C4: more than
#                ONE composter-chain craft (planks/slabs/crafting_table/composter) the server saw lost (craftsync
#                unconfirmed/no/resync, produced<=0, clicks>0; the race after clicks start is detectable, not
#                preventable). [The row's free=/need= cannot be compared: free is AFTER the build, need BEFORE -- a
#                normal 34/36 build reads free=1 need=2 (Claude review 10-04).] C5: more than one visit ending "bone meal
#                popped but not confirmed" (sandbox 0 of 6; one tolerated).
#   INSTRUMENT   control bots at >= 34 est. slots holding compostable junk (>= 1): the population this changes exists.
#   PRIMARY      compostable-junk slots per bot (latest snapshot per bot) and the share of bots at >= 34 slots, DiD vs
#                the same-length pre-window; slots freed per compost visit. REPORTED.
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
# composter.mjs isCompostInput at 56db2cd (junk) + saplings above SAPLING_RESERVE.
JUNK = {'leaf_litter', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'poppy', 'dandelion',
        'short_grass', 'seagrass', 'tall_grass', 'fern', 'large_fern', 'vine'}
SAPLING_RESERVE = 16
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
DET = re.compile(r'slots=(\d+)->(\d+) level=(\S+)->(\S+) bonemeal=(\d+) n=(\d+).*? stop=(\S+) items=(\S+)')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def is_sapling(n):
    return n.endswith('_sapling')      # composter.mjs isSapling; a propagule is NEVER_COMPOST, so composting one is a C1 breach


def occupancy(inv):
    return sum(c if UN.search(n) else -(-c // 64) for n, c in (inv or {}).items() if isinstance(c, (int, float)))


def parse(d):
    m = DET.search(d or '')
    if not m:
        return None
    items = {}
    if m.group(8) != '-':
        for kv in m.group(8).split(','):
            k, _, v = kv.partition(':')
            if v.isdigit():
                items[k] = int(v)
    return {'before': int(m.group(1)), 'after': int(m.group(2)), 'bonemeal': int(m.group(5)), 'n': int(m.group(6)),
            'stop': m.group(7), 'items': items}


# POSITIVE CONTROL for the parser: compostDetail's own documented example and a truncated item list.
_p = parse('slots=36->33 level=0->4 bonemeal=1 n=67 stop=done items=leaf_litter:64,wheat_seeds:3')
assert _p and _p['before'] == 36 and _p['after'] == 33 and _p['items'] == {'leaf_litter': 64, 'wheat_seeds': 3}
assert parse('slots=36->36 level=7->0 bonemeal=0 n=0 stop=bone_meal_popped_but_not_confirmed_in_the_bag items=-')['items'] == {}
_skip = parse('slots=36->36 level=?->? bonemeal=0 n=0 stop=nothing_compostable_at_36_of_36_slots items=-')
assert _skip is not None and _skip['n'] == 0 and _skip['bonemeal'] == 0           # a skip parses but is NOT a visit
assert re.search(r'at=(-?\d+,-?\d+,-?\d+)', 'at=697,120,699 wood=carried free=1 need=2 table=none').group(1) == '697,120,699'
assert not 'oak_propagule'.endswith('_sapling')
CHAIN = re.compile(r'(_planks|_slab)$|^crafting_table$|^composter$')


def lost_on_server(a):
    produced = a.get('produced')
    return (a.get('outcome') == 'unconfirmed' and str(a.get('confirmed')) == 'no' and a.get('verify_source') == 'resync'
            and (produced is None or produced <= 0) and int(a.get('clicks') or 0) > 0)

ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=PRE, until=END)
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev.rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
rows = Counter(); offbuild = 0; c1 = []; c2 = []; built = defaultdict(Counter); c4 = []; uncollected = 0; freed = []; visits = 0
with_inv = 0; parsed = 0
botsets = defaultdict(lambda: defaultdict(set)); last = defaultdict(dict)
for r in ev.rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(b)
    k = r.get('name'); d = r.get('detail') or ''
    inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory')
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if isinstance(inv, dict) and inv and not other:
        last[period][b] = inv
    if k == '_craft_sync' and period == 'post' and arm == 'canary' and not other:
        a = ((r.get('raw') or {}).get('skill') or {}).get('args') or {}
        if CHAIN.search(str(a.get('item') or '')) and lost_on_server(a):
            c4.append(d[:120])
    if k not in ('_compost', '_composter_built') or period != 'post':
        continue
    if other:
        offbuild += 1
        continue
    rows[arm] += 1
    if arm != 'canary':
        continue
    if k == '_composter_built':
        m = re.search(r'at=(-?\d+,-?\d+,-?\d+)', d)
        built[pool_of(b)][m.group(1) if m else '?'] += 1
        continue
    p = parse(d)
    if not p:
        continue
    parsed += 1
    with_inv += int(isinstance(inv, dict) and bool(inv))
    st = ((r.get('raw') or {}).get('skill') or {}).get('status') or r.get('status')
    if st in ('success', 'failed') and (p['n'] > 0 or p['bonemeal'] > 0):
        visits += 1
        freed.append(p['before'] - p['after'])
    bad = [n for n in p['items'] if n not in JUNK and not is_sapling(n)]
    if bad:
        c1.append((b, bad))
    for n in p['items']:
        if is_sapling(n) and isinstance(inv, dict) and inv.get(n, 0) < SAPLING_RESERVE:
            c2.append((b, n, inv.get(n, 0)))
    if 'popped_but_not_confirmed' in p['stop']:
        uncollected += 1


def junk_slots(inv):
    return sum(-(-c // 64) for n, c in inv.items() if n in JUNK and isinstance(c, (int, float)))


def per_bot(period, arm, f):
    vals = [f(inv) for b, inv in last[period].items() if (pool_of(b) in CANS) == (arm == 'canary')]
    return sum(vals) / len(vals) if vals else float('nan')


full = lambda inv: float(occupancy(inv) >= 34)
v = {(p, a, nm): per_bot(p, a, f) for p in ('pre', 'post') for a in ('canary', 'control') for nm, f in (('junk', junk_slots), ('full', full))}
did = lambda nm: (v[('post', 'canary', nm)] - v[('pre', 'canary', nm)]) - (v[('post', 'control', nm)] - v[('pre', 'control', nm)])
inst = sum(1 for b, inv in last['post'].items() if pool_of(b) not in CANS and occupancy(inv) >= 34 and junk_slots(inv) > 0)
c3 = {p: len(cells) for p, cells in built.items() if len(cells) > 1}            # distinct cells
rebuilt = {p: sum(n - 1 for n in cells.values() if n > 1) for p, cells in built.items() if any(n > 1 for n in cells.values())}
print('-' * 78)
print('LIVENESS     canary compost/built rows %d (>= 1) | control %d (must be 0) | other build %d' % (rows['canary'], rows['control'], offbuild))
print('CORRECTNESS  C1 non-compostables composted %d | C2 saplings below %d after composting %d | C3 pools with > 1 composter %s'
      % (len(c1), SAPLING_RESERVE, len(c2), c3 or 0))
print('             C4 chain crafts lost on the server %d (<= 1) | C5 bone meal left uncollected %d (<= 1) | real compost visits %d'
      % (len(c4), uncollected, visits))
print('             composters built %s | same-cell rebuilds %s | compost rows parsed %d, with an inventory snapshot %d (C2 needs it)'
      % ({p: dict(c) for p, c in built.items()}, rebuilt or 0, parsed, with_inv))
print('INSTRUMENT   control bots at >= 34 slots holding compostable junk: %d (>= 1)' % inst)
print('PRIMARY      junk slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | share at >= 34 DiD %+.3f | slots freed/visit %s'
      % (v[('pre', 'canary', 'junk')], v[('post', 'canary', 'junk')], v[('pre', 'control', 'junk')], v[('post', 'control', 'junk')],
         did('junk'), did('full'), ('%.2f' % (sum(freed) / len(freed))) if freed else '-'))
for x in (c1[:3] + c2[:3] + c4[:3]):
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('composterread', W, {
        'rows_canary': rows['canary'], 'rows_control': rows['control'], 'offbuild_canary': offbuild,
        'breach_noncompostable': len(c1), 'breach_sapling_reserve': len(c2), 'breach_multi_composter': len(c3),
        'chain_lost_over_1': int(len(c4) > 1), 'uncollected_over_1': int(uncollected > 1),
        'compost_visits_canary': visits, 'composters_built_canary': sum(len(c) for c in built.values()), 'same_cell_rebuilds': sum(rebuilt.values()) if rebuilt else 0, 'instrument_control': inst,
        'junk_slots_did': None if did('junk') != did('junk') else round(did('junk'), 3),
        'full_share_did': None if did('full') != did('full') else round(did('full'), 4),
        'exposure_ready': int(visits >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
