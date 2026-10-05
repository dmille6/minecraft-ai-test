#!/usr/bin/env python3
# towndepositread.py [window_min] -- the read for canary `towndeposit-01` (branch td-on-1918bb5).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/towndeposit.mjs): a bot within 16 h / 12 v of home with a bag at >= 34 of 36 slots (its own
# items().length) and a town container within 16 runs `town_deposit` BEFORE other work: whole stacks of surplus, smallest
# first, inside the fleet's own depositPlan allowance (creditCap 64), never below the keeps (wood units and the stone
# family to 64, dirt 16, sand 8, 4 planks, the iron ladder raw_iron/iron_ingot/coal never, the rung's wants to a stack,
# the scaffold reserve), tools by slot (spent never, the best usable copy kept), at most two containers in 45 s, never a
# stack the container cannot take whole. One attempt per town stay; 5 min cooldown; 15 min backoff after a failure.
# One row per run, `_town_deposit`, detail:
#   "slots A->B stacks K/P bagdelta N tools name@uses,... banked name:n,... stop S[ cursor_unsettled U] containers x,y,z=r;..."
# (END snapshot; A/B = the bot's own slot count; bagdelta = the bag's own loss over the banked names, read after close.)
#
#   LIVENESS     canary `_town_deposit` rows from the canary build (>= 1); control 0.
#   CORRECTNESS  (each judged; any breach REVERTS)
#                G1 a SPENT tool banked: a `tools` entry at <= 10 uses; or a banked tool name with no usable (> 10 uses)
#                   copy left in the END snapshot's tools.
#                G2 a KEEP breached by the order: banked logs/planks and wood units after < 64; banked planks and planks
#                   after < 4; banked cobblestone/cobbled_deepslate/stone and the stone family after < 64.
#                G3 JUNK banked: a banked name outside the bankable set (standing targets, always-banked ores, tools), or
#                   inside the never-banked set (the iron ladder, dirt, sand, food, ballast).
#                G4 an ITEM LOST: cursor_unsettled > 0, or bagdelta > the claimed banked total (items left the bag that the
#                   run did not put in a chest).
#   TRIPWIRES    claim_unconfirmed (claimed > bagdelta: an auto-pickup during the run, or a click the server undid), runs
#                per stop/status, failures per container result, repeat orders within 15 min, compost visits per bot-h DiD
#                (the order runs before compost), deaths (named; the two-death floor is canary-report.py's).
#   INSTRUMENT   (positive control) CONTROL full-bag town stays (>= 34 corrected slots, in town) carrying bankable surplus
#                above the keeps (>= 1): the population this changes exists. Also: canary full-bag town stays and the share
#                served by a successful run.
#   PRIMARY      slots per bot and the share of bot-time at >= 34 slots, TIME-WEIGHTED (gaps capped at 120 s), on the
#                CORRECTED estimator (bag-creep report: eggs/buckets/pearls/signs 16, tools/armour/filled buckets 1, else
#                64; -0.25 slot mean error vs the bots' own N/36 against the scoreboard's -0.77), DiD vs the same-length
#                pre-window. Also: slots freed per successful run (the bot's own count). REPORTED.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
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
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)

# ---- the rules, as towndeposit.mjs / bankable.mjs state them at td-on-1918bb5 ----------------------------------------
STANDING = {'oak_log', 'birch_log', 'jungle_log', 'oak_planks', 'stick', 'cobblestone', 'cobbled_deepslate', 'stone',
            'coal', 'raw_iron', 'iron_ingot', 'diamond'}
ALWAYS = {'iron_ore', 'deepslate_iron_ore', 'raw_copper', 'copper_ingot', 'raw_gold', 'gold_ingot', 'redstone', 'lapis_lazuli',
          'emerald', 'amethyst_shard'}
IRON_LADDER = {'raw_iron', 'iron_ingot', 'iron_nugget', 'iron_ore', 'deepslate_iron_ore', 'coal', 'charcoal'}
LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
PLANKS = ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks']
COBBLE = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'stone', 'andesite', 'diorite', 'granite', 'tuff']
TOOLRE = re.compile(r'_(pickaxe|axe|shovel|sword|hoe)$')
FLOOR = 10
KEEP = 64
NEVER = re.compile(r'^(dirt|sand|apple|bread|.*_seeds|leaf_litter|egg|brown_egg|blue_egg|bone_meal|.*_sapling|bamboo|chest|crafting_table|furnace|torch|bucket)$')
TOWN_H, TOWN_V = 16, 12
FULL = 34

# THE CORRECTED ESTIMATOR (bag-creep report 2026-10-05, validated against 12,566 of the bots' own N/36 rows).
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')


def stack(n):
    return 1 if ONE.search(n) else 16 if SIXTEEN.search(n) else 64


def slots(inv):
    return sum((c if stack(n) == 1 else -(-c // stack(n))) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0)


def fam(inv, names):
    return sum(int((inv or {}).get(n, 0) or 0) for n in names)


def wood_units(inv):
    return fam(inv, LOGS) + fam(inv, PLANKS) // 4


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


def homes():
    out = {}
    for f in glob.glob('/srv/mcbots/harness/env/*.env'):
        h = {}
        try:
            for line in open(f):
                for k in ('HOME_X=', 'HOME_Y=', 'HOME_Z='):
                    if line.startswith(k):
                        h[k[5]] = float(line.split('=', 1)[1])
        except (OSError, ValueError):
            continue
        if 'X' in h and 'Z' in h:
            out[os.path.basename(f)[:-4]] = h
    return out


def in_town(h, pos):
    if not h or not isinstance(pos, dict) or pos.get('x') is None:
        return False
    return math.hypot(pos['x'] - h['X'], pos['z'] - h['Z']) <= TOWN_H and abs(pos.get('y', h.get('Y', 0)) - h.get('Y', pos.get('y', 0))) <= TOWN_V


DET = re.compile(r'^slots (\d+)->(\d+) stacks (\d+)/(\d+) clicked (\d+) bagdelta (\S+) tools (\S+) banked (\S+) stop (.*?)(?: cursor_unsettled (\d+))?(?: unverified (\d+))?(?: containers (\S*))?$')


def parse(d):
    m = DET.match(d or '')
    if not m:
        return None
    banked = {}
    if m.group(8) != '-':
        for kv in m.group(8).split(','):
            k, _, v = kv.partition(':')
            if v.isdigit():
                banked[k] = int(v)
    tools = []
    if m.group(7) != '-':
        for x in m.group(7).split(','):
            n, _, u = x.partition('@')
            try:
                tools.append((n, float(u)))
            except ValueError:
                tools.append((n, None))
    bd = m.group(6)
    return {'before': int(m.group(1)), 'after': int(m.group(2)), 'stacks': int(m.group(3)), 'planned': int(m.group(4)),
            'clicked': int(m.group(5)), 'bagdelta': int(bd) if bd.isdigit() else None, 'tools': tools, 'banked': banked,
            'stop': m.group(9), 'unsettled': int(m.group(10) or 0), 'unverified': int(m.group(11) or 0), 'containers': m.group(12) or ''}


def gates(p, inv, tools_after):
    """The deterministic gates for one parsed canary row and its END snapshot -> {G1: [...], G2: [...], G3: [...], G4: [...]}."""
    out = defaultdict(list)
    for n, u in p['tools']:
        if u is not None and u <= FLOOR:
            out['G1'].append('%s@%s' % (n, u))
    for n in p['banked']:
        if TOOLRE.search(n):
            usable = [c for c in (tools_after or {}).get(n, []) if isinstance(c, dict) and (c.get('max', 0) - c.get('used', 0)) > FLOOR]
            if tools_after is not None and not usable:
                out['G1'].append('%s: no usable copy left' % n)
    bw = sum(p['banked'].get(n, 0) for n in LOGS) + sum(p['banked'].get(n, 0) for n in PLANKS)
    if inv is not None:
        if bw and wood_units(inv) < KEEP:
            out['G2'].append('wood %d < %d after banking %d' % (wood_units(inv), KEEP, bw))
        if sum(p['banked'].get(n, 0) for n in PLANKS) and fam(inv, PLANKS) < 4:
            out['G2'].append('planks %d < 4' % fam(inv, PLANKS))
        bc = sum(p['banked'].get(n, 0) for n in ('cobblestone', 'cobbled_deepslate', 'stone'))
        if bc and fam(inv, COBBLE) < KEEP:
            out['G2'].append('stone family %d < %d after banking %d' % (fam(inv, COBBLE), KEEP, bc))
    for n in p['banked']:
        if not (n in STANDING or n in ALWAYS or TOOLRE.search(n)) or n in IRON_LADDER or NEVER.search(n):
            out['G3'].append(n)
    claimed = sum(p['banked'].values())
    if p['unsettled']:
        out['G4'].append('cursor_unsettled %d' % p['unsettled'])
    if p['bagdelta'] is not None and p['bagdelta'] > claimed:
        out['G4'].append('bag lost %d, banked %d' % (p['bagdelta'], claimed))
    return out


# POSITIVE CONTROLS for the parser and the gates (the skill's own row from bots/test/towndeposit.test.mjs).
_ex = 'slots 36->32 stacks 4/4 clicked 4 bagdelta 38 tools stone_pickaxe@60 banked cobblestone:20,oak_log:10,raw_copper:7,stone_pickaxe:1 stop done containers 2,70,0=took'
_p = parse(_ex)
assert _p and _p['before'] == 36 and _p['after'] == 32 and _p['bagdelta'] == 38 and _p['banked']['cobblestone'] == 20 and _p['tools'] == [('stone_pickaxe', 60.0)]
assert _p['containers'] == '2,70,0=took' and _p['unsettled'] == 0
_okinv = {'cobblestone': 128, 'oak_log': 128, 'oak_planks': 0}
assert not any(gates(_p, _okinv, {'stone_pickaxe': [{'used': 11, 'max': 131}]}).values())
assert gates(_p, {'cobblestone': 40, 'oak_log': 128}, {'stone_pickaxe': [{'used': 11, 'max': 131}]})['G2'], 'G2 must fire on cobble below 64'
assert gates(_p, _okinv, {'stone_pickaxe': [{'used': 130, 'max': 131}]})['G1'], 'G1 must fire with no usable copy left'
assert gates(parse(_ex.replace('stone_pickaxe@60', 'stone_pickaxe@3')), _okinv, None)['G1'], 'G1 must fire on a spent copy banked'
assert gates(parse(_ex.replace('raw_copper:7', 'apple:7')), _okinv, None)['G3'] == ['apple']
assert gates(parse(_ex.replace('raw_copper:7', 'raw_iron:7')), _okinv, None)['G3'] == ['raw_iron']
assert gates(parse(_ex.replace('bagdelta 38', 'bagdelta 45')), _okinv, None)['G4']
_u = parse('slots 36->35 stacks 1/4 clicked 1 bagdelta 20 tools - banked cobblestone:20 stop cursor cursor_unsettled 1 containers 2,70,0=took_some')
assert _u and _u['unsettled'] == 1 and _u['stop'] == 'cursor' and gates(_u, _okinv, None)['G4']
_n = parse('slots 36->36 stacks 0/0 clicked 0 bagdelta 0 tools - banked - stop nothing to bank above the keeps containers -')
_v = parse('slots 36->32 stacks 0/4 clicked 4 bagdelta 0 tools - banked - stop unverified unverified 4 containers 2,70,0=unverified')
assert _v and _v['unverified'] == 4 and _v['clicked'] == 4 and _v['stop'] == 'unverified'
assert _n and _n['banked'] == {} and _n['stop'] == 'nothing to bank above the keeps'
assert slots({'egg': 17, 'cobblestone': 65, 'stone_pickaxe': 2, 'bucket': 3}) == 2 + 2 + 2 + 1


def surplus_stacks(inv, tools):
    """INSTRUMENT: a lower bound on whole stacks the plan could bank from a merged inventory (no slot layout in the
    snapshot): per name, floor(min(64, held - keep) / stack); DEPOSIT_ALWAYS non-iron ores held; spare usable tools."""
    n = 0
    w_keep = min(wood_units(inv), KEEP)
    logs = fam(inv, LOGS)
    if logs > w_keep:
        n += min(KEEP, logs - w_keep) // 64
    c_keep = min(fam(inv, COBBLE), KEEP)
    non_bankable = fam(inv, [x for x in COBBLE if x not in ('cobblestone', 'cobbled_deepslate', 'stone')])
    cob = fam(inv, ['cobblestone', 'cobbled_deepslate', 'stone'])
    if cob > max(0, c_keep - non_bankable):
        n += min(KEEP, cob - max(0, c_keep - non_bankable)) // 64
    n += sum(1 for x in ALWAYS - IRON_LADDER if int(inv.get(x, 0) or 0) > 0)
    n += int(inv.get('diamond', 0) or 0) > 0
    for nm, copies in (tools or {}).items():
        u = [c for c in copies if isinstance(c, dict) and (c.get('max', 0) - c.get('used', 0)) > FLOOR]
        n += max(0, len(u) - 1)
    return n


assert surplus_stacks({'cobblestone': 200, 'oak_log': 64}, {}) == 1
assert surplus_stacks({'cobblestone': 64, 'oak_log': 64, 'raw_copper': 3}, {'stone_pickaxe': [{'used': 0, 'max': 131}, {'used': 10, 'max': 131}]}) == 2

HOME = homes()
rows_walked = Counter(); bots_seen = defaultdict(set)
tw = defaultdict(lambda: [0.0, 0.0, 0.0])        # (period, arm) -> [seconds, seconds at >= 34, slot-seconds]
runs = Counter(); offbuild = 0; status = Counter(); stops = Counter(); results = Counter()
breach = defaultdict(list); freed = []; unconfirmed = []; banked_tot = Counter(); stacks_tot = 0
orders = defaultdict(list); compost = Counter(); deaths = []
stays = defaultdict(lambda: [0, 0])               # arm -> [full-bag town stays, served]
inst_stays = 0
bots = sorted(d for d in os.listdir('/var/log/mcai') if not d.startswith('_') and os.path.isdir('/var/log/mcai/' + d))
for b in bots:
    try:
        ev = Events.load(paths='/var/log/mcai/%s/skill-*.jsonl*' % b, since=PRE, until=END)
    except Exception as e:
        print('load failed', b, e)
        continue
    seen, rs = set(), []
    for r in ev.rows:
        k = (r['t'], r['name'], r['detail'])
        if k in seen:
            continue
        seen.add(k); rs.append(r)
    rs.sort(key=lambda r: r['t'])
    arm = 'canary' if pool_of(b) in CANS else 'control'
    h = HOME.get(b)
    prev_t = None; prev_occ = None
    stay = None                                     # {'start': t, 'last_in': t, 'served': bool}
    for r in rs:
        t = r['t']; raw = r.get('raw') or {}; bot = raw.get('bot') or {}; sk = raw.get('skill') or {}
        period = 'post' if t >= CUT else 'pre'
        rows_walked[(period, arm)] += 1; bots_seen[(period, arm)].add(b)
        ver = ((raw.get('code') or {}).get('version') or '')
        other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
        k = r['name']; d = r.get('detail') or ''
        if prev_t is not None and prev_occ is not None:
            pp = 'post' if prev_t >= CUT else 'pre'
            dtsec = min((t - prev_t).total_seconds(), 120.0)
            acc = tw[(pp, arm)]
            acc[0] += dtsec; acc[1] += dtsec if prev_occ >= FULL else 0; acc[2] += dtsec * prev_occ
        prev_t = t
        inv = bot.get('inventory'); tools = bot.get('tools')
        if isinstance(inv, dict) and not other:
            prev_occ = slots(inv)
            # TOWN STAYS at >= 34 (post): joined while the bot stays in town; a stay ends 10 min after the last in-town row.
            if period == 'post':
                here = in_town(h, bot.get('pos'))
                if stay and (t - stay['last_in']).total_seconds() > 600:
                    stays[arm][0] += 1; stays[arm][1] += int(stay['served']); stay = None
                if here:
                    if stay is None and prev_occ >= FULL:
                        stay = {'start': t, 'last_in': t, 'served': False}
                        if arm == 'control' and surplus_stacks(inv, tools) >= 1:
                            inst_stays += 1
                    if stay:
                        stay['last_in'] = t
        if period != 'post':
            continue
        if k == '_death':
            deaths.append((arm, b, str(t)[11:19]))
        if k in ('compost', '_compost') and sk.get('status') == 'success':
            compost[arm] += 1
        if k == '_work_order' and d.startswith('town_deposit'):
            orders[b].append(t)
        if k != '_town_deposit':
            continue
        if other:
            offbuild += 1
            continue
        runs[arm] += 1
        if arm != 'canary':
            continue
        st = sk.get('status') or r.get('status')
        status[st] += 1
        p = parse(d)
        if not p:
            breach['unparsed'].append(d[:120])
            continue
        stops[p['stop'][:40]] += 1
        for c in p['containers'].split(';'):
            if '=' in c:
                results[c.split('=', 1)[1]] += 1
        for g, ev_ in gates(p, inv if isinstance(inv, dict) else None, tools if isinstance(tools, dict) else None).items():
            for x in ev_:
                breach[g].append((b, str(t)[11:19], x))
        claimed = sum(p['banked'].values())
        if st == 'success' and claimed:
            freed.append(p['before'] - p['after']); stacks_tot += p['stacks']
            for n, c in p['banked'].items():
                banked_tot[n] += c
            if stay is not None:
                stay['served'] = True
        if p['bagdelta'] is not None and p['bagdelta'] < claimed:
            unconfirmed.append((b, claimed - p['bagdelta']))
    if stay:
        stays[arm][0] += 1; stays[arm][1] += int(stay['served'])

repeat = sum(1 for b, ts in orders.items() for a, c in zip(ts, ts[1:]) if (c - a).total_seconds() < 900)


def share(p, a):
    s = tw[(p, a)]
    return (s[1] / s[0], s[2] / s[0]) if s[0] else (float('nan'), float('nan'))


v = {(p, a): share(p, a) for p in ('pre', 'post') for a in ('canary', 'control')}
did_share = (v[('post', 'canary')][0] - v[('pre', 'canary')][0]) - (v[('post', 'control')][0] - v[('pre', 'control')][0])
did_slots = (v[('post', 'canary')][1] - v[('pre', 'canary')][1]) - (v[('post', 'control')][1] - v[('pre', 'control')][1])
bh = {a: tw[('post', a)][0] / 3600 for a in ('canary', 'control')}
bhp = {a: tw[('pre', a)][0] / 3600 for a in ('canary', 'control')}
print('rows walked pre %s post %s | bots pre %s post %s | canary %s sha %s cutoff %s window +%d min' % (
    {a: rows_walked[('pre', a)] for a in ('canary', 'control')}, {a: rows_walked[('post', a)] for a in ('canary', 'control')},
    {a: len(bots_seen[('pre', a)]) for a in ('canary', 'control')}, {a: len(bots_seen[('post', a)]) for a in ('canary', 'control')},
    sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W))
print('-' * 78)
print('LIVENESS     canary _town_deposit rows %d (>= 1) | control %d (must be 0) | other build %d | status %s' % (runs['canary'], runs['control'], offbuild, dict(status)))
print('CORRECTNESS  G1 spent tool banked %d | G2 keep breached %d | G3 junk banked %d | G4 item lost %d | unparsed %d' % (
    len(breach['G1']), len(breach['G2']), len(breach['G3']), len(breach['G4']), len(breach['unparsed'])))
print('TRIPWIRES    claim_unconfirmed runs %d (items %d) | repeat orders < 15 min %d | stops %s | containers %s' % (
    len(unconfirmed), sum(x[1] for x in unconfirmed), repeat, dict(stops.most_common(6)), dict(results)))
print('             compost successes canary %d control %d (per bot-h %.2f vs %.2f) | deaths %s' % (
    compost['canary'], compost['control'], compost['canary'] / bh['canary'] if bh['canary'] else float('nan'),
    compost['control'] / bh['control'] if bh['control'] else float('nan'), deaths[:6]))
print('INSTRUMENT   control full-bag town stays carrying surplus %d (>= 1) | full-bag town stays canary %d (served %d) control %d' % (
    inst_stays, stays['canary'][0], stays['canary'][1], stays['control'][0]))
print('PRIMARY      share at >= 34 canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f' % (
    v[('pre', 'canary')][0], v[('post', 'canary')][0], v[('pre', 'control')][0], v[('post', 'control')][0], did_share,
    v[('pre', 'canary')][1], v[('post', 'canary')][1], v[('pre', 'control')][1], v[('post', 'control')][1], did_slots))
print('             bot-hours pre %s post %s | successes %d, slots freed/run %s, stacks %d, banked %s' % (
    {a: round(x, 1) for a, x in bhp.items()}, {a: round(x, 1) for a, x in bh.items()}, len(freed),
    ('%.2f' % (sum(freed) / len(freed))) if freed else '-', stacks_tot, dict(banked_tot.most_common(8))))
for g in ('G1', 'G2', 'G3', 'G4', 'unparsed'):
    for x in breach[g][:3]:
        print('  breach %s:' % g, x)
nan = lambda x: None if x != x else round(x, 4)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('towndepositread', W, {
        'rows_canary': runs['canary'], 'rows_control': runs['control'], 'offbuild_canary': offbuild,
        'breach_spent_tool': len(breach['G1']), 'breach_keep': len(breach['G2']), 'breach_junk': len(breach['G3']),
        'breach_lost': len(breach['G4']), 'unparsed': len(breach['unparsed']),
        'successes_canary': len(freed), 'claim_unconfirmed': len(unconfirmed), 'repeat_orders': repeat,
        'instrument_control': inst_stays, 'stays_canary': stays['canary'][0], 'stays_served_canary': stays['canary'][1],
        'full_share_did': nan(did_share), 'slots_did': nan(did_slots),
        'slots_freed_per_run': None if not freed else round(sum(freed) / len(freed), 3),
        'exposure_ready': int(len(freed) >= 3 and inst_stays >= 1),
    })
except Exception as e:
    print('emit failed:', e)
