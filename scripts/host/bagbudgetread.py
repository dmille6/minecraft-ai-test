#!/usr/bin/env python3
# bagbudgetread.py [window_min] -- the read for canary `bagbudget-01` (one bag allowance every keep layer reads; a full bag at
# town banks the allowance's chest rows: torch, ladders under 26, bone meal, a second eaten food, building stone above the
# scaffold reserve; last-swing keeps no spent pickaxe while the bag holds a stone pickaxe's stone). CANARY_DRYRUN=pool[,pool]:
# sha:iso for dry runs (never emits). Judges the CANARY ARM; difference-in-differences against control for every effect;
# DENOMINATORS FIRST. Design: docs/reports/bagbudget-01-design-2026-10-20.md.
#
# WHY (10-20, files): 38 of 80 bags at >= 34 slots; 646 of 646 town-deposit no_effect runs in 24 h were bags whose plan was
# empty (torch, ladders, bone meal ... had no exit; the town count failed on lids); ~3 slots per full bag are chest rows.
#
# MEMORY: STREAMED (cobblekeepread's pattern): only the kinds below are held, plus per-bot last snapshots.
#
# THE CHANGE (rows only this build writes):
#   _bagbudget_mode   once per spawn: the licence
#   _bagbudget        phase=bank (allow=name=start:banked ... other=name:n, part=i/n, peaceful=0|1), phase=none (a full-bag
#                     no_effect: chest=, rows=, left=classes), phase=wear (row P: listed=, worn=)
#   LIVENESS   licence_canary >= 1
#   ARMS       rows_control: control _bagbudget_mode / _bagbudget rows (must be 0)
#   DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#     D1 breach_junk_chest: a canary bank row banked a junk name (the owner's 10-04 rule; row J's lists; PEACEFUL_COMPOST
#        and apple only on peaceful=1 rows). d1_incomplete: a run whose parts are not all present -- BLOCKS KEEP.
#     D2 breach_below_allowance: a station left below 1 (start >= 1, start - banked < 1), or 26+ ladders banked at all
#     D3 breach_full_noeffect_chest: a canary phase=none row with rows=1 and chest=1 -- a CONSISTENCY tripwire (the row's
#        class comes from the same plan, so it trips only if the two disagree: Claude code r1 P3-1)
#   CROSS-CHECK (REPORTED, never a verdict -- Codex code r2 P2-2): canary full-bag no_effect `_town_deposit` rows (stop nothing
#        to bank above the keeps) whose OWN snapshot holds a torch, bone_meal or < 26 ladders while the phase=none row says
#        rows=1 -- the read's independent look at the planner; a wanted floor or a withdraw hold keeps them legitimately and
#        the read cannot see either, so the names are printed for a human
#     D4 breach_ingot_banked: a canary _town_deposit that banked iron_ingot (cobblekeep-01's, carried)
#     D5 harm_storage_full: canary town_storage_full >= 3 AND above 2x the control's rate per bot-h
#   CROSS-CHECK (REPORTED): canary full-bag no_effect `_town_deposit` rows (stop nothing to bank above the keeps) whose snapshot
#     holds torch, bone_meal or < 26 ladders while the phase=none row says rows=1
#   PRIMARY (DiD, reported): share of bots >= 34 slots (est.), slots per bot, full-bag town deposits that banked > 0, craft
#     "no slot can be freed" per bot-h, gather success; UNLISTED names in canary full bags (the owner's junk-list call)
#   EXPOSURE   >= 3 canary phase=bank rows that banked an allowance stack AND >= 1 canary phase=wear row
#   INSTRUMENT control _town_deposit rows >= 1, control full bags >= 1, control wear_out rows >= 1
import sys, os, json, re, glob, gzip, math
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('_bagbudget_mode', '_bagbudget', '_town_deposit', 'town_deposit', 'wear_out', 'craft', 'gather')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
BANKED = re.compile(r' banked (\S+)')
FULL_SLOTS = 34
LADDER_ESCAPE_MIN = 26
STATIONS = ('crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel', 'composter', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket')
# ROW J, the read's copy (bots/src: bankable NEVER_BANKABLE, well.mjs OWNER_JUNK_1004 + DECORATIONS + SCAFFOLD_DECORATIONS,
# hygiene NEVER_KEEP, peacefulkit PEACEFUL_COMPOST; saplings; bamboo; swords). --selftest holds the JS lists to it when run
# from a checkout (JS_CHECK).
WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'crimson', 'warped']
COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
JUNK = set(['leaf_litter', 'brown_egg', 'egg', 'oak_sapling', 'short_grass', 'dead_bush', 'seagrass', 'vine', 'poppy', 'dandelion', 'pointed_dripstone', 'rail', 'bamboo',
            'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute',
            'glass', 'glass_pane', 'lead', 'powered_rail', 'detector_rail', 'activator_rail', 'brick', 'bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
            'chiseled_stone_bricks', 'polished_andesite', 'polished_diorite', 'polished_granite', 'smooth_basalt', 'polished_tuff', 'tuff_bricks', 'chiseled_tuff_bricks',
            'nether_brick_fence', 'stone_button', 'polished_blackstone_button', 'stone_pressure_plate', 'polished_blackstone_pressure_plate',
            'andesite', 'diorite', 'granite', 'mossy_cobblestone',
            'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'tall_grass', 'fern', 'large_fern']
           + ['%s_stained_glass' % c for c in COLOURS] + ['%s_stained_glass_pane' % c for c in COLOURS] + ['%s_wool' % c for c in COLOURS]
           + ['%s_button' % w for w in WOODS] + ['%s_pressure_plate' % w for w in WOODS] + ['%s_fence' % w for w in WOODS])
PEACEFUL_JUNK = set(['melon_slice', 'kelp', 'brown_mushroom', 'red_mushroom', 'cocoa_beans', 'sweet_berries', 'torchflower_seeds', 'pitcher_pod', 'blue_orchid',
                     'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
                     'closed_eyeblossom', 'open_eyeblossom', 'torchflower', 'apple', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant',
                     'wildflowers', 'pink_petals', 'cactus_flower', 'dried_kelp', 'glow_berries', 'moss_carpet', 'firefly_bush', 'bush', 'bread'])
SAPLING = re.compile(r'(_sapling|_propagule)$')
SWORD = re.compile(r'_sword$')
TOOLISH = re.compile(r'_(pickaxe|axe|shovel|sword|hoe)$|^(bucket|water_bucket|lava_bucket|shears|flint_and_steel|bow|fishing_rod)$')
# the chest rows' names and the names other layers own: everything else in a full bag is UNLISTED (reported)
KNOWN = re.compile(r'^(torch|ladder|bone_meal|stone_bricks|smooth_stone|cobblestone|cobbled_deepslate|stone|dirt|sand|red_sand|gravel|tuff|calcite|deepslate|sandstone|red_sandstone|blackstone|stick|coal|charcoal|raw_iron|iron_ingot|iron_nugget|iron_ore|deepslate_iron_ore|diamond|raw_copper|copper_ingot|raw_gold|gold_ingot|redstone|lapis_lazuli|emerald|amethyst_shard)$|_(log|planks|slab|trapdoor|door|bed|boat)$|_(pickaxe|axe|shovel|sword|hoe)$|^(golden_carrot|cooked_beef|cooked_porkchop|cooked_mutton|cooked_chicken|bread|baked_potato|cooked_cod|cooked_salmon|apple|carrot|melon_slice|sweet_berries)$')

try:
    STACK = json.load(open(os.path.expanduser('~/stack.json')))
except Exception:
    STACK = None


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def est_slots(inv):
    """bot.inventory {name: count} -> slots: ceil(count / stack size) from ~/stack.json (a LOWER bound; checked 10-20 against
    784 rows' real items().length: 0 in 583, +1 in 165, never negative), else one per tool copy and ceil(count / 64)"""
    if STACK:
        return sum(-(-int(c or 0) // int(STACK.get(n, 64) or 64)) for n, c in inv.items() if int(c or 0) > 0)
    return sum(int(c or 0) if TOOLISH.search(n) else -(-int(c or 0) // 64) for n, c in inv.items())


def is_junk(name, peaceful):
    # a sword is junk only in a peaceful world (peacefulkit: outside it a spare sword is the base rule's to bank)
    return name in JUNK or bool(SAPLING.search(name)) or (peaceful and (bool(SWORD.search(name)) or name in PEACEFUL_JUNK))


def bank_tokens(detail):
    """a phase=bank part -> (allow {name: (start, banked)}, other {name: n})"""
    allow, other = {}, {}
    for tok in (detail or '').split():
        if tok.startswith('allow='):
            name, _, sb = tok[6:].partition('=')
            s, _, b = sb.partition(':')
            if s.isdigit() and b.isdigit():
                allow[name] = (int(s), int(b))
        elif tok.startswith('other='):
            name, _, n = tok[6:].partition(':')
            if n.isdigit():
                other[name] = int(n)
    return allow, other


def runs_of(rows):
    """phase=bank parts -> runs [{bot, t, seen, parts_n, peaceful, allow, other, ...}]. A run is the parts of ONE visit of one
    bot: it opens at part 1 (or at any part with no open run -- an orphan, missing its earlier parts), takes each part number
    once, and CLOSES when it holds 1..n (Codex code r1 P2-1: a later run's stray part must never complete an earlier one).
    Complete iff seen == {1..n}."""
    out, cur = [], {}
    for r in rows:
        if r['name'] != '_bagbudget' or not r['detail'].startswith('phase=bank'):
            continue
        f = kv(r['detail'])
        i, _, n = (f.get('part') or '1/1').partition('/')
        i, n = int(i or 1), int(n or 1)
        # THE VISIT ID (v=, Codex code r2 P2-1): parts of different visits never join, whatever their numbers
        vid = f.get('v') if f.get('v') not in (None, '-') else None
        run = cur.get(r['bot'])
        if i == 1 or run is None or run['parts_n'] != n or i in run['seen'] or (vid is not None and run.get('v') != vid):
            run = {'bot': r['bot'], 't': r['t'], 'v': vid, 'seen': set(), 'parts_n': n, 'peaceful': f.get('peaceful') == '1', 'allow': {}, 'other': {},
                   'banked': int(f.get('banked') or 0) if (f.get('banked') or '').isdigit() else 0, 'arm': r['arm'], 'per': r['per'], 'trunc': False}
            out.append(run); cur[r['bot']] = run
        run['seen'].add(i)
        run['parts_seen'] = len(run['seen'])
        if run['seen'] == set(range(1, n + 1)):
            cur.pop(r['bot'], None)
        run['trunc'] = run['trunc'] or 'trunc=1' in r['detail']
        a, o = bank_tokens(r['detail'])
        run['allow'].update(a); run['other'].update(o)
    return out


def stream(since, until, cut, cans, logroot='/var/log/mcai', cv=''):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    lag = [0]
    bots = defaultdict(set)
    last = {}                         # (per, arm, bot) -> (t, slots, inv)
    s_iso, u_iso = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    for f in files:
        try:
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                ts = line[15:34] if line.startswith('{"@timestamp":"') else None
                if ts is None or ts < s_iso or ts >= u_iso:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    bad += 1
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                bo = d.get('bot') or {}
                b = bo.get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                if cv and arm == 'canary' and per == 'post' and not str((d.get('code') or {}).get('version') or '').startswith(cv[:12]):
                    lag[0] += 1
                    continue
                inv = bo.get('inventory') if isinstance(bo.get('inventory'), dict) else None
                if b:
                    bots[(per, arm)].add(b)
                    if inv is not None:
                        prev = last.get((per, arm, b))
                        if prev is None or t >= prev[0]:
                            last[(per, arm, b)] = (t, est_slots(inv), inv)
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'fail_class': sk.get('fail_class'),
                                 'detail': sk.get('detail') or '', 'bot': b, 'inv': inv if n == '_town_deposit' else None})
    kept.sort(key=lambda r: r['t'])
    stream.lag = lag[0]
    return kept, walked, bots, bad, last


def banked(r):
    if r['name'] != '_town_deposit':
        return {}
    m = BANKED.search(r['detail'])
    out = {}
    for part in (m.group(1) if m else '-').split(','):
        n, _, c = part.partition(':')
        if c.isdigit():
            out[n] = int(c)
    return out


def td_slots(r):
    m = re.match(r'slots (\d+)->(\d+)', r['detail'] or '')
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def judge(rows, last=None, hrs=None):
    """last: {(per, arm, bot): (t, slots, inv)}; hrs(per, arm) -> bot-hours (D5 and the rates)"""
    out = {}
    last = last or {}
    hrs = hrs or (lambda per, arm: 1.0)
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_bagbudget_mode')
    out['rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and r['name'] in ('_bagbudget_mode', '_bagbudget'))
    runs = [x for x in runs_of(rows) if x['arm'] == 'canary' and x['per'] == 'post']
    junk, low, inc = [], [], []
    for x in runs:
        if x['seen'] != set(range(1, x['parts_n'] + 1)) or x['trunc']:
            inc.append((x['bot'], '%d/%d' % (x['parts_seen'], x['parts_n']), str(x['t'])))
        names = {n: b for n, (s, b) in x['allow'].items() if b > 0} | {n: c for n, c in x['other'].items() if c > 0}
        for n in names:
            if is_junk(n, x['peaceful']):
                junk.append((x['bot'], n, names[n], str(x['t'])))
        for n, (s, b) in x['allow'].items():
            if n in STATIONS and s >= 1 and s - b < 1:
                low.append((x['bot'], n, s, b, str(x['t'])))
            if n == 'ladder' and s >= LADDER_ESCAPE_MIN and b > 0:
                low.append((x['bot'], n, s, b, str(x['t'])))
    out['breach_junk_chest'] = len(junk)
    out['d1_incomplete'] = len(inc)
    out['breach_below_allowance'] = len(low)
    none = [r for r in post_c if r['name'] == '_bagbudget' and r['detail'].startswith('phase=none')]
    d3 = [(r['bot'], str(r['t'])) for r in none if kv(r['detail']).get('rows') == '1' and kv(r['detail']).get('chest') == '1']
    out['breach_full_noeffect_chest'] = len(d3)
    # D4 reads the town deposit's own row AND the complete bank parts (Codex code r1 P2-2: the 300-char row sorts by count)
    ing = [(r['bot'], banked(r).get('iron_ingot'), str(r['t'])) for r in post_c if banked(r).get('iron_ingot')]
    ing += [(x['bot'], x['other'].get('iron_ingot') or x['allow'].get('iron_ingot', (0, 0))[1], str(x['t'])) for x in runs
            if x['other'].get('iron_ingot') or x['allow'].get('iron_ingot', (0, 0))[1]]
    out['breach_ingot_banked'] = len(ing)
    sf = lambda per, arm: sum(1 for r in rows if r['per'] == per and r['arm'] == arm and r['name'] == 'town_deposit' and r['fail_class'] == 'town_storage_full')
    out['storage_full_post_canary'], out['storage_full_post_control'] = sf('post', 'canary'), sf('post', 'control')
    rc, rk = out['storage_full_post_canary'] / max(hrs('post', 'canary'), 1e-9), out['storage_full_post_control'] / max(hrs('post', 'control'), 1e-9)
    out['harm_storage_full'] = int(out['storage_full_post_canary'] >= 3 and rc > 2 * rk)
    # CROSS-CHECK (reported): a full-bag no_effect whose snapshot holds what a chest row would bank, with rows=1
    cross = []
    nones_by_bot = defaultdict(list)
    for r in none:
        nones_by_bot[r['bot']].append(r)
    for r in post_c:
        if r['name'] != '_town_deposit' or r['status'] != 'no_effect' or 'stop nothing to bank above the keeps' not in r['detail'] and 'stop counted the town; nothing to bank above the keeps' not in r['detail']:
            continue
        s0, _ = td_slots(r)
        inv = r.get('inv') or {}
        if not s0 or s0 < FULL_SLOTS:
            continue
        hit = [n for n in ('torch', 'bone_meal') if int(inv.get(n) or 0) > 0] + (['ladder'] if 0 < int(inv.get('ladder') or 0) < LADDER_ESCAPE_MIN else [])
        near = [x for x in nones_by_bot.get(r['bot'], []) if abs((x['t'] - r['t']).total_seconds()) <= 5]
        if hit and any(kv(x['detail']).get('rows') == '1' for x in near):
            cross.append((r['bot'], hit, str(r['t'])))
    out['crosscheck_omitted'] = len(cross)
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm]
            tds = [r for r in sel if r['name'] == '_town_deposit']
            full_td = [r for r in tds if (td_slots(r)[0] or 0) >= FULL_SLOTS]
            out['td_rows_%s_%s' % (per, arm)] = len(tds)
            out['td_full_%s_%s' % (per, arm)] = len(full_td)
            out['td_full_banked_%s_%s' % (per, arm)] = sum(1 for r in full_td if banked(r))
            out['no_slot_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'craft' and 'no slot can be freed' in r['detail'])
            gs = [r for r in sel if r['name'] == 'gather']
            out['gather_rows_%s_%s' % (per, arm)] = len(gs)
            out['gather_ok_%s_%s' % (per, arm)] = sum(1 for r in gs if r['status'] == 'success')
            out['wear_rows_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'wear_out')
            snaps = [(sl, inv) for (p, a, _b), (_t, sl, inv) in last.items() if p == per and a == arm]
            out['bag_bots_%s_%s' % (per, arm)] = len(snaps)
            out['full_share_%s_%s' % (per, arm)] = round(sum(1 for sl, _ in snaps if sl >= FULL_SLOTS) / len(snaps), 3) if snaps else float('nan')
            out['slots_mean_%s_%s' % (per, arm)] = round(sum(sl for sl, _ in snaps) / len(snaps), 2) if snaps else float('nan')
            out['full_bags_%s_%s' % (per, arm)] = sum(1 for sl, _ in snaps if sl >= FULL_SLOTS)
    unl = Counter()
    for (p, a, _b), (_t, sl, inv) in last.items():
        if p == 'post' and a == 'canary' and sl >= FULL_SLOTS:
            for n, c in inv.items():
                if int(c or 0) > 0 and not KNOWN.search(n) and not is_junk(n, True) and n not in STATIONS:
                    unl[n] += 1
    bank_ok = [x for x in runs if x['banked'] > 0]
    wear = [r for r in post_c if r['name'] == '_bagbudget' and r['detail'].startswith('phase=wear')]
    out['bank_runs_canary'] = len(bank_ok)
    out['wear_rows_canary'] = len(wear)
    out['wear_worn_canary'] = sum(int(kv(r['detail']).get('worn') or 0) for r in wear)
    out['exposure_ready'] = int(len(bank_ok) >= 3 and len(wear) >= 1)
    out['instrument_control'] = int(out['td_rows_post_control'] >= 1 and out['full_bags_post_control'] >= 1 and out['wear_rows_post_control'] >= 1)
    out['_lists'] = {'junk': junk[:5], 'incomplete': inc[:5], 'below': low[:5], 'd3': d3[:5], 'ingot': ing[:5], 'cross': cross[:5], 'unlisted': unl.most_common(12)}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 20, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='placebo-b-Alpha', arm='canary', per='post', status='success', fail=None, inv=None: {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': fail, 'detail': detail, 'bot': bot, 'inv': inv}
    BANK = lambda allow='torch=11:11 allow=bone_meal=32:32', other='-', peaceful=1, part='1/1', banked=43, v='-', **k: R('_bagbudget',
        'phase=bank v=%s peaceful=%d stacks=2 banked=%d slots=36->33 rows=bone_meal:1,torch:1 part=%s %s %s' % (v, peaceful, banked, part,
        ' '.join('allow=' + a if not a.startswith('allow=') else a for a in allow.split(' allow=')) if allow else '', ' '.join('other=' + o for o in other.split(',')) if other != '-' else 'other=-'), **k)
    WEAR = lambda **k: R('_bagbudget', 'phase=wear listed=3 worn=3 of=4 slots=36->32', **k)
    ctl = [R('_town_deposit', 'slots 36->35 stacks 1/1 clicked 1 bagdelta 1 tools - banked raw_copper:7 stop done containers 1,2,3=took', arm='control', bot='hive-b-A'),
           R('wear_out', '36 -> 35 slots: 1 of 1 spent tool(s) worn out', arm='control', bot='hive-b-A')]
    lastc = {('post', 'control', 'hive-b-A'): (T0, 36, {'cobblestone': 64 * 36})}
    ok = judge([R('_bagbudget_mode', 'phase=mode on=1'), BANK(), BANK(mins=1), BANK(mins=2), WEAR()] + ctl, lastc)
    assert ok['licence_canary'] == 1 and ok['breach_junk_chest'] == 0 and ok['d1_incomplete'] == 0 and ok['breach_below_allowance'] == 0, ok
    assert ok['exposure_ready'] == 1 and ok['instrument_control'] == 1 and ok['rows_control'] == 0 and ok['breach_full_noeffect_chest'] == 0, ok
    # D1: junk banked (other= list), a sapling, an egg; PEACEFUL names only on peaceful=1 rows
    assert judge([BANK(other='egg:6')] + ctl, lastc)['breach_junk_chest'] == 1, 'D1: an egg'
    assert judge([BANK(other='oak_sapling:9')] + ctl, lastc)['breach_junk_chest'] == 1, 'D1: a sapling'
    assert judge([BANK(allow='apple=7:7')] + ctl, lastc)['breach_junk_chest'] == 1, 'D1: an apple in a peaceful world'
    assert judge([BANK(allow='apple=7:7', peaceful=0)] + ctl, lastc)['breach_junk_chest'] == 0, 'D1 control: row F banks an apple outside peaceful'
    assert judge([BANK(other='cobblestone:64,raw_copper:7')] + ctl, lastc)['breach_junk_chest'] == 0, 'D1 control: the base plan'
    # D1 coverage: a two-part run missing its second part
    assert judge([BANK(part='1/2')] + ctl, lastc)['d1_incomplete'] == 1, 'incomplete parts'
    assert judge([BANK(part='1/2'), BANK(part='2/2', allow='', other='coal:7')] + ctl, lastc)['d1_incomplete'] == 0, 'both parts present'
    assert judge([BANK(part='1/2'), BANK(part='2/2', allow='', other='egg:4')] + ctl, lastc)['breach_junk_chest'] == 1, 'junk on the second part'
    # Codex code r1 P2-1: a complete run, then a later run missing its part 1 -- the stray 2/2 must not complete anything
    stray = judge([BANK(part='1/2'), BANK(part='2/2', allow='', other='coal:7'), BANK(part='2/2', allow='', other='coal:3', mins=5)] + ctl, lastc)
    assert stray['d1_incomplete'] == 1, stray
    assert judge([BANK(part='1/2'), BANK(part='1/2', mins=5), BANK(part='2/2', allow='', other='coal:3', mins=5)] + ctl, lastc)['d1_incomplete'] == 1, 'a run that never got its 2/2'
    # Codex code r2 P2-1: visit A's 1/2 and visit B's 2/2 (each missing one part) never stitch into one complete run
    st2 = judge([BANK(part='1/2', v='a.1'), BANK(part='2/2', allow='', other='coal:3', mins=5, v='b.2')] + ctl, lastc)
    assert st2['d1_incomplete'] == 2, st2
    assert judge([BANK(part='1/2', v='a.1'), BANK(part='2/2', allow='', other='coal:3', v='a.1')] + ctl, lastc)['d1_incomplete'] == 0, 'control: one visit, both parts'
    # D2: a station below 1; 26+ ladders banked
    assert judge([BANK(allow='crafting_table=1:1')] + ctl, lastc)['breach_below_allowance'] == 1, 'D2: the only table'
    assert judge([BANK(allow='chest=12:0')] + ctl, lastc)['breach_below_allowance'] == 0, 'D2 control: stations kept'
    assert judge([BANK(allow='ladder=30:30')] + ctl, lastc)['breach_below_allowance'] == 1, 'D2: escape ladders'
    assert judge([BANK(allow='ladder=4:4')] + ctl, lastc)['breach_below_allowance'] == 0, 'D2 control: ladders under 26 go'
    # D3
    N = lambda rows='1', chest='1', **k: R('_bagbudget', 'phase=none slots=36 chest=%s rows=%s left=chest' % (chest, rows), status='no_effect', **k)
    assert judge([N()] + ctl, lastc)['breach_full_noeffect_chest'] == 1, 'D3'
    assert judge([N(rows='0')] + ctl, lastc)['breach_full_noeffect_chest'] == 0, 'D3 control: deletion first'
    assert judge([N(chest='0')] + ctl, lastc)['breach_full_noeffect_chest'] == 0, 'D3 control: nothing for a chest'
    # D4
    TD = lambda b, **k: R('_town_deposit', 'slots 36->34 stacks 2/2 clicked 2 bagdelta 12 tools - banked %s stop done containers 1,2,3=ok' % b, **k)
    assert judge([TD('iron_ingot:3')] + ctl, lastc)['breach_ingot_banked'] == 1, 'D4'
    assert judge([TD('iron_ingot:3', arm='control', bot='hive-b-A')] + ctl, lastc)['breach_ingot_banked'] == 0, 'D4 judges the canary'
    assert judge([BANK(other='iron_ingot:3')] + ctl, lastc)['breach_ingot_banked'] == 1, 'D4 from the complete bank parts'
    # D5: >= 3 and > 2x control per bot-h
    SF = lambda **k: R('town_deposit', 'the town chests in reach are full', status='failed', fail='town_storage_full', **k)
    h = lambda per, arm: 10.0
    assert judge([SF()] * 3 + ctl, lastc, h)['harm_storage_full'] == 1, 'D5'
    assert judge([SF()] * 2 + ctl, lastc, h)['harm_storage_full'] == 0, 'D5 control: two'
    assert judge([SF()] * 3 + [SF(arm='control', bot='hive-b-A')] * 2 + ctl, lastc, h)['harm_storage_full'] == 0, 'D5 control: control too'
    # cross-check
    NE = lambda inv, **k: R('_town_deposit', 'slots 36->36 stacks 0/0 clicked 0 bagdelta 0 tools - banked - stop nothing to bank above the keeps containers -', status='no_effect', inv=inv, **k)
    assert judge([NE({'torch': 5}), N(chest='0')] + ctl, lastc)['crosscheck_omitted'] == 1, 'the planner omitted a torch'
    assert 'breach_planner_omitted' not in judge([NE({'torch': 5}), N(chest='0')] + ctl, lastc), 'the cross-check is reported only'
    assert judge([NE({'torch': 5}), N(chest='0', rows='0')] + ctl, lastc)['crosscheck_omitted'] == 0, 'control: withheld for deletion'
    assert judge([NE({'ladder': 30}), N(chest='0')] + ctl, lastc)['crosscheck_omitted'] == 0, 'control: 26+ ladders stay'
    # exposure and instrument
    assert judge([BANK(), BANK()] + [WEAR()] + ctl, lastc)['exposure_ready'] == 0, 'two bank runs are not exposure'
    assert judge([BANK()] * 3 + ctl, lastc)['exposure_ready'] == 0, 'no wear row: row P unexposed'
    assert judge([BANK()] * 3 + [WEAR()], lastc)['instrument_control'] == 0, 'no control rows: BLIND'
    assert judge([R('_bagbudget_mode', 'phase=mode', arm='control', bot='hive-b-A')] + ctl, lastc)['rows_control'] == 1
    # the primary from snapshots
    last = {('pre', 'canary', 'a'): (T0, 36, {}), ('post', 'canary', 'a'): (T0, 30, {'amethyst_block': 4, 'torch': 1}), **lastc}
    p = judge(ctl, last)
    assert p['full_share_pre_canary'] == 1 and p['full_share_post_canary'] == 0 and p['_lists']['unlisted'] == [], p
    p2 = judge(ctl, {('post', 'canary', 'a'): (T0, 35, {'amethyst_block': 4, 'egg': 3, 'torch': 2}), **lastc})
    assert p2['_lists']['unlisted'] == [('amethyst_block', 1)], p2['_lists']
    assert est_slots({'cobblestone': 130, 'stone_pickaxe': 2}) == (3 + 2 if STACK else 3 + 2)
    if os.environ.get('JS_CHECK'):
        # the JS lists, from a checkout: node prints them; every JS junk name must be in this read's copy
        import subprocess
        js = subprocess.run(['node', '--input-type=module', '-e',
            "import { WELL_JUNK } from './bots/src/well.mjs'; import { NEVER_KEEP } from './bots/src/hygiene.mjs'; import { NEVER_BANKABLE } from './bots/src/bankable.mjs';"
            "import { PEACEFUL_COMPOST } from './bots/src/peacefulkit.mjs'; console.log(JSON.stringify({ j: [...WELL_JUNK, ...NEVER_KEEP, ...NEVER_BANKABLE], p: Object.keys(PEACEFUL_COMPOST) }))"],
            capture_output=True, text=True, cwd=os.environ['JS_CHECK'], env={**os.environ, 'OLLAMA_MODEL': 'x'})
        lists = json.loads(js.stdout.strip().splitlines()[-1])
        miss = [n for n in lists['j'] if not is_junk(n, False)] + [n for n in lists['p'] if not is_junk(n, True)]
        assert not miss, 'the read misses junk names the bots use: %s' % miss
        # ...and the other way: every name the read calls junk is one the bot's notForChest refuses (no false REVERT)
        names = json.dumps(sorted(JUNK)); pnames = json.dumps(sorted(PEACEFUL_JUNK))
        js2 = subprocess.run(['node', '--input-type=module', '-e',
            "import { notForChest } from './bots/src/towndeposit.mjs'; const a = %s, b = %s;"
            "console.log(JSON.stringify([...a.filter(n => !notForChest(n, { peaceful: false })), ...b.filter(n => !notForChest(n, { peaceful: true }))]))" % (names, pnames)],
            capture_output=True, text=True, cwd=os.environ['JS_CHECK'], env={**os.environ, 'OLLAMA_MODEL': 'x'})
        extra = json.loads(js2.stdout.strip().splitlines()[-1])
        assert not extra, 'the read calls these junk but the bot may bank them: %s' % extra
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
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
    rows, walked, bots, bad, last = stream(PRE, END, CUT, CANS, cv=CV if CV and CV != 'x' else '')
    lagged = stream.lag
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    res = judge(rows, last, hrs)
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didr = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    lvl = lambda k: (res[k + '_post_canary'] - res[k + '_pre_canary']) - (res[k + '_post_control'] - res[k + '_pre_control'])
    share = lambda a, b: a / b if b else float('nan')
    sh = {f'{p}_{a}': share(res[f'td_full_banked_{p}_{a}'], res[f'td_full_{p}_{a}']) for p in ('pre', 'post') for a in ('canary', 'control')}
    gok = {f'{p}_{a}': share(res[f'gather_ok_{p}_{a}'], res[f'gather_rows_{p}_{a}']) for p in ('pre', 'post') for a in ('canary', 'control')}
    dids = {'full_share': lvl('full_share'), 'slots_mean': lvl('slots_mean'), 'no_slot': didr('no_slot'),
            'td_full_banked_share': (sh['post_canary'] - sh['pre_canary']) - (sh['post_control'] - sh['pre_control']),
            'gather_ok': (gok['post_canary'] - gok['pre_canary']) - (gok['post_control'] - gok['pre_control'])}
    print('RESTART LAG  canary post rows from another build skipped: %d (canary build %s)' % (lagged, CV or '-'))
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f | bag snapshots: bots pre/post canary %d/%d control %d/%d'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control'), res['bag_bots_pre_canary'], res['bag_bots_post_canary'], res['bag_bots_pre_control'], res['bag_bots_post_control']))
    print('PRIMARY      bots >= %d slots (est.) canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f (should FALL) | slots per bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f'
          % (FULL_SLOTS, res['full_share_pre_canary'], res['full_share_post_canary'], res['full_share_pre_control'], res['full_share_post_control'], dids['full_share'],
             res['slots_mean_pre_canary'], res['slots_mean_post_canary'], res['slots_mean_pre_control'], res['slots_mean_post_control'], dids['slots_mean']))
    print('             full-bag town deposits that banked > 0: canary %d/%d -> %d/%d control %d/%d -> %d/%d | share DiD %+.3f (should RISE)'
          % (res['td_full_banked_pre_canary'], res['td_full_pre_canary'], res['td_full_banked_post_canary'], res['td_full_post_canary'],
             res['td_full_banked_pre_control'], res['td_full_pre_control'], res['td_full_banked_post_control'], res['td_full_post_control'], dids['td_full_banked_share']))
    print('             craft "no slot can be freed" canary %d -> %d control %d -> %d DiD %+.3f /bot-h (should FALL) | gather success canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
          % (res['no_slot_pre_canary'], res['no_slot_post_canary'], res['no_slot_pre_control'], res['no_slot_post_control'], dids['no_slot'],
             gok['pre_canary'], gok['post_canary'], gok['pre_control'], gok['post_control'], dids['gather_ok']))
    print('LIVENESS     licence rows %d | bank runs that banked %d | wear rows %d (copies worn %d) | control rows %d (must be 0)'
          % (res['licence_canary'], res['bank_runs_canary'], res['wear_rows_canary'], res['wear_worn_canary'], res['rows_control']))
    print('DEFECTS      D1 junk into a chest %d %s (incomplete runs %d %s: BLOCK KEEP) | D2 below the allowance %d %s | D3 full no_effect with chest surplus %d %s | D4 ingots banked %d %s'
          % (res['breach_junk_chest'], res['_lists']['junk'], res['d1_incomplete'], res['_lists']['incomplete'], res['breach_below_allowance'], res['_lists']['below'],
             res['breach_full_noeffect_chest'], res['_lists']['d3'], res['breach_ingot_banked'], res['_lists']['ingot']))
    print('HARM         D5 town_storage_full canary %d control %d (per bot-h %.3f vs %.3f) -> %s'
          % (res['storage_full_post_canary'], res['storage_full_post_control'], rate(res['storage_full_post_canary'], 'post', 'canary'),
             rate(res['storage_full_post_control'], 'post', 'control'), 'TRIP' if res['harm_storage_full'] else 'ok'))
    print('CROSS-CHECK  (reported) full no_effect with a torch / bone meal / < 26 ladders and rows=1: %d %s (a wanted floor or a withdraw hold keeps them legitimately)' % (res['crosscheck_omitted'], res['_lists']['cross']))
    print('OWNER        unlisted names in canary full bags (stay; the owner\'s junk-list call): %s' % res['_lists']['unlisted'])
    print('EXPOSURE     -> %s (canary bank runs that banked %d, need 3; wear rows %d, need 1) | INSTRUMENT control town deposits %d, full bags %d, wear_out %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['bank_runs_canary'], res['wear_rows_canary'],
             res['td_rows_post_control'], res['full_bags_post_control'], res['wear_rows_post_control'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('bagbudgetread', W, {k: (clean(v) if isinstance(v, float) else v) for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
