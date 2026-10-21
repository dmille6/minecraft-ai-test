#!/usr/bin/env python3
# junkoutread.py [window_min] -- the read for canary `junkout-01` (junk out at every town visit -- the well, the composter --
# and the slim bag allowance at the town deposit at any bag size; the wear-out spares cap). CANARY_DRYRUN=pool[,pool]:sha:iso
# for dry runs (never emits). Judges the CANARY ARM; difference-in-differences against control for every effect; DENOMINATORS
# FIRST. Design: docs/reports/junkout-01-design-2026-10-21.md (section 6). Built on bagbudgetread.py's streaming and runs.
#
# WHY (10-21, files, 80 bags): listed well junk 151 slots on 57 bots, torch 72 / 68, bone meal 83 / 77, compost junk 66 -- all
# carried out of town again because the well and the composter run only at >= 34 slots and torch / bone meal had no exit.
#
# THE CHANGE (rows only this build writes):
#   _junkout_mode   once per spawn (per connect): the licence
#   _junkout        phase=well|compost (one per visit run: vid armed dh dy dw offlist swords cobble stock slots listed n status)
#                   phase=bank (every town-deposit run that planned a row or banked: v mode=tail|full armed dh dy keep_picks
#                   allow=name=start:banked other=name:n part=i/n), phase=wear (listed= worn=)
#   LIVENESS   licence_canary >= 1;   ARMS rows_control (control _junkout rows: must be 0)
#   DEFECTS (each REVERTS, evidence=defect; each has a failing fixture and a passing legitimate fixture in --selftest)
#     J1 breach_junk_chest: a canary bank run banked a junk name (the read's lists, held to the bots' by JS_CHECK);
#        j1_incomplete: a run whose parts are not all present -- BLOCKS KEEP. The control's _town_deposit banked names are
#        checked the same way as a NULL (reported: a base-equal pattern is not a defect)
#     J2 breach_below_allowance: a station left below 1 (start >= 1, start - banked < 1); on mode=tail rows, stone_pickaxe
#        left below min(start, keep_picks)
#     J3 breach_dedicated_trip: a canary visit run (well, compost: dh > 16 or |dy| > 12, or dw > 20 -- the well's or the
#        composter's distance) or tail bank run (dh > 16
#        or |dy| > 12) issued outside its gate -- the ISSUE-time position the order carried
#     J4 breach_visit_offlist: a canary phase=well run that threw anything but listed junk (offlist, swords, cobble, stock > 0)
#     J5 breach_reissue: consecutive canary runs of ONE kind by one bot less than the stay window apart (20 min well/compost,
#        15 tail) whose second run's `armed` does not explain the re-arm: `first` needs a _junkout_mode row (a connect) between
#        the two issues; `stay` never; `out:a-b` needs first issue < a, b < second issue, b - a >= 55 s, and an OUT-of-zone
#        position sample inside [a - 10 s, b + 10 s] (event rows at their own time, skill rows at @timestamp + duration_ms:
#        a skill row is stamped at its START with the END position)
#   HARM       harm_storage_full: canary town_storage_full >= 3 AND above 2x the control's rate per bot-h (reported as a line)
#   PRIMARY (DiD, reported): slots per bot (est.), share >= 34, listed-junk slots per bag, torch + bone meal slots per bag,
#              gather success
#   EXPOSURE   canary well runs with n > 0 >= 10 AND compost runs with n > 0 >= 3 AND tail bank runs (unique v) that banked
#              >= 3 AND canary zone visits with listed junk below 34 >= 20
#   INSTRUMENT control dispose_well >= 1, control _town_deposit >= 1, control zone visits with listed junk >= 1
import sys, os, json, re, glob, gzip, math
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('_junkout_mode', '_junkout', '_town_deposit', 'town_deposit', 'dispose_well', 'gather')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
BANKED = re.compile(r' banked (\S+)')
FULL_SLOTS = 34
ZONE_H, ZONE_V, WELL_REACH = 16, 12, 20
STAY_MIN = {'well': 20, 'compost': 20, 'tail': 15}
STATIONS = ('crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel', 'composter', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket')
WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'crimson', 'warped']
COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
# THE WELL'S LIST (well.mjs isWellJunk: OWNER_JUNK_1004 + DECORATIONS; the guarded raw stones apart) -- JS_CHECK holds it equal
WELL_LISTED = set(['egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac', 'armadillo_scute', 'dead_bush', 'pointed_dripstone', 'rail',
                   'glass', 'glass_pane', 'lead', 'powered_rail', 'detector_rail', 'activator_rail', 'brick', 'bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
                   'chiseled_stone_bricks', 'polished_andesite', 'polished_diorite', 'polished_granite', 'smooth_basalt', 'polished_tuff', 'tuff_bricks',
                   'chiseled_tuff_bricks', 'nether_brick_fence', 'stone_button', 'polished_blackstone_button', 'stone_pressure_plate', 'polished_blackstone_pressure_plate']
                  + ['%s_stained_glass' % c for c in COLOURS] + ['%s_stained_glass_pane' % c for c in COLOURS] + ['%s_wool' % c for c in COLOURS]
                  + ['%s_button' % w for w in WOODS] + ['%s_pressure_plate' % w for w in WOODS] + ['%s_fence' % w for w in WOODS])
SCAFFOLD_DECO = set(['andesite', 'diorite', 'granite', 'mossy_cobblestone'])
# J1's junk: the well's list + the guarded stones, the bank's ballast, NEVER_KEEP, saplings, bamboo; and under the peaceful
# switch the composter's peaceful plants, apples and swords (bagbudgetread's ROW J, the same names)
JUNK = WELL_LISTED | SCAFFOLD_DECO | set(['leaf_litter', 'short_grass', 'seagrass', 'vine', 'poppy', 'dandelion', 'bamboo', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds',
                                          'pumpkin_seeds', 'tall_grass', 'fern', 'large_fern'])
PEACEFUL_JUNK = set(['melon_slice', 'kelp', 'brown_mushroom', 'red_mushroom', 'cocoa_beans', 'sweet_berries', 'torchflower_seeds', 'pitcher_pod', 'blue_orchid',
                     'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
                     'closed_eyeblossom', 'open_eyeblossom', 'torchflower', 'apple', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant',
                     'wildflowers', 'pink_petals', 'cactus_flower', 'dried_kelp', 'glow_berries', 'moss_carpet', 'firefly_bush', 'bush', 'bread'])
SAPLING = re.compile(r'(_sapling|_propagule)$')
SWORD = re.compile(r'_sword$')
TOOLISH = re.compile(r'_(pickaxe|axe|shovel|sword|hoe)$|^(bucket|water_bucket|lava_bucket|shears|flint_and_steel|bow|fishing_rod)$')

try:
    STACK = json.load(open(os.path.expanduser('~/stack.json')))
except Exception:
    STACK = None


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def ival(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def est_slots(inv):
    if STACK:
        return sum(-(-int(c or 0) // int(STACK.get(n, 64) or 64)) for n, c in inv.items() if int(c or 0) > 0)
    return sum(int(c or 0) if TOOLISH.search(n) else -(-int(c or 0) // 64) for n, c in inv.items())


def listed_stacks(inv):
    """whole slots of the well's list in a bag (the guarded stones not counted: they go only above 64 reserve stone)"""
    return sum(-(-int(c or 0) // int((STACK or {}).get(n, 64) or 64)) for n, c in (inv or {}).items() if n in WELL_LISTED and int(c or 0) > 0)


def is_junk(name, peaceful):
    return name in JUNK or bool(SAPLING.search(name)) or (peaceful and (bool(SWORD.search(name)) or name in PEACEFUL_JUNK))


def issue_ms(vid):
    """the issue time a visit id carries: <name>.<ms base 36> -> ms, or None"""
    if not vid or vid in ('-', '?') or '.' not in vid:
        return None
    try:
        return int(vid.rsplit('.', 1)[1], 36)
    except ValueError:
        return None


def bank_tokens(detail):
    allow, other = {}, {}
    for tok in (detail or '').split():
        if tok.startswith('allow='):
            name, _, sb = tok[6:].partition('=')
            s, _, b = sb.partition(':')
            if s.isdigit() and b.isdigit():
                allow[name] = (int(s), int(b))
        elif tok.startswith('other=') or tok.startswith('try='):
            # try= a name clicked into a chest beyond what the server verified (an abort): J1 judges it like a banked name
            name, _, n = tok.split('=', 1)[1].partition(':')
            if n.isdigit():
                other[name] = other.get(name, 0) + int(n)
    return allow, other


def runs_of(rows):
    """phase=bank parts -> runs (bagbudgetread's rules: a run opens at part 1, takes each part once, closes at 1..n; parts of
    different visits (v=) never join)."""
    out, cur = [], {}
    for r in rows:
        if r['name'] != '_junkout' or not r['detail'].startswith('phase=bank'):
            continue
        f = kv(r['detail'])
        i, _, n = (f.get('part') or '1/1').partition('/')
        i, n = int(i or 1), int(n or 1)
        vid = f.get('v') if f.get('v') not in (None, '-') else None
        run = cur.get(r['bot'])
        if i == 1 or run is None or run['parts_n'] != n or i in run['seen'] or (vid is not None and run.get('v') != vid):
            run = {'bot': r['bot'], 't': r['t'], 'v': vid, 'seen': set(), 'parts_n': n, 'peaceful': f.get('peaceful') == '1', 'allow': {}, 'other': {},
                   'banked': ival(f.get('banked')) or 0, 'mode': f.get('mode'), 'armed': f.get('armed'), 'dh': ival(f.get('dh')), 'dy': ival(f.get('dy')),
                   'keep_picks': ival(f.get('keep_picks')), 'arm': r['arm'], 'per': r['per']}
            out.append(run); cur[r['bot']] = run
        run['seen'].add(i)
        run['parts_seen'] = len(run['seen'])
        if run['seen'] == set(range(1, n + 1)):
            cur.pop(r['bot'], None)
        a, o = bank_tokens(r['detail'])
        run['allow'].update(a); run['other'].update(o)
    return out


def out_of_zone(pos, home):
    return math.hypot(pos['x'] - home['X'], pos['z'] - home['Z']) > ZONE_H or abs(pos['y'] - home['Y']) > ZONE_V


def home_of(bot):
    h = {}
    try:
        for line in open('/srv/mcbots/harness/env/%s.env' % bot):
            m = re.match(r'^HOME_([XYZ])=(-?\d+)', line.strip())
            if m:
                h[m.group(1)] = int(m.group(2))
    except OSError:
        pass
    return h if len(h) == 3 else None


def stream(since, until, cut, cans, logroot='/var/log/mcai', cv=''):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    lag = [0]
    bots = defaultdict(set)
    last = {}                          # (per, arm, bot) -> (t, slots, inv)
    samples = defaultdict(list)        # canary post bot -> [(ms, out_of_zone)]  (J5)
    visits = defaultdict(lambda: defaultdict(dict))   # (per, arm) -> bot -> {'last_in': t, 'n': visits with junk, 'cur': bool}
    homes = {}
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
                pos = bo.get('pos') if isinstance(bo.get('pos'), dict) else None
                if not b:
                    continue
                bots[(per, arm)].add(b)
                if b not in homes:
                    homes[b] = home_of(b)
                h = homes[b]
                if inv is not None:
                    prev = last.get((per, arm, b))
                    if prev is None or t >= prev[0]:
                        last[(per, arm, b)] = (t, est_slots(inv), inv)
                if pos and h:
                    out = out_of_zone(pos, h)
                    # the position's TIME: an event row's own; a skill row's end (it is stamped at its start with the end position)
                    ms = int(t.timestamp() * 1000) + (0 if (n or '').startswith('_') else int(sk.get('duration_ms') or 0))
                    if arm == 'canary' and per == 'post':
                        samples[b].append((ms, out))
                    # ZONE VISITS with listed junk below 34 (the exposure; split by > 120 s out of the zone)
                    v = visits[(per, arm)][b]
                    if not out:
                        if v.get('last_in') is None or (t - v['last_in']).total_seconds() > 120:
                            v['cur'] = False
                        v['last_in'] = t
                        if inv is not None and not v.get('cur') and est_slots(inv) < FULL_SLOTS and listed_stacks(inv) >= 1:
                            v['cur'] = True; v['n'] = v.get('n', 0) + 1
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'fail_class': sk.get('fail_class'),
                                 'detail': sk.get('detail') or '', 'bot': b})
    kept.sort(key=lambda r: r['t'])
    for b in samples:
        samples[b].sort()
    stream.lag = lag[0]
    vis = {k: sum(x.get('n', 0) for x in v.values()) for k, v in visits.items()}
    return kept, walked, bots, bad, last, samples, vis


def banked(r):
    if r['name'] != '_town_deposit':
        return {}
    m = BANKED.search(r['detail'])
    out = {}
    for part in (m.group(1) if m else '-').split(','):
        nm, _, c = part.partition(':')
        if c.isdigit():
            out[nm] = int(c)
    return out


def visit_runs(rows):
    """canary-or-control visit rows -> [{kind, bot, issue, armed, ...}] (well / compost from phase=well|compost; tail from the
    bank runs with mode=tail)"""
    out = []
    for r in rows:
        if r['name'] != '_junkout':
            continue
        f = kv(r['detail'])
        ph = f.get('phase')
        if ph in ('well', 'compost'):
            out.append({'kind': ph, 'bot': r['bot'], 'arm': r['arm'], 'per': r['per'], 't': r['t'], 'issue': issue_ms(f.get('vid')), 'armed': f.get('armed'),
                        'dh': ival(f.get('dh')), 'dy': ival(f.get('dy')), 'dw': ival(f.get('dw')), 'n': ival(f.get('n')) or 0, 'status': f.get('status'),
                        'offlist': ival(f.get('offlist')) or 0, 'swords': ival(f.get('swords')) or 0, 'cobble': ival(f.get('cobble')) or 0, 'stock': ival(f.get('stock')) or 0})
    return out


def reissue(runs, samples, connects):
    """J5 -> [(bot, kind, why, t)]. runs: one kind's visit runs; samples: bot -> [(ms, out)]; connects: bot -> [ms] (the
    _junkout_mode rows: one per connect)"""
    bad = []
    by = defaultdict(list)
    for x in runs:
        if x['issue'] is not None:
            by[(x['bot'], x['kind'])].append(x)
    for (bot, kind), xs in by.items():
        xs.sort(key=lambda x: x['issue'])
        win = STAY_MIN[kind] * 60000
        for a, c in zip(xs, xs[1:]):
            gap = c['issue'] - a['issue']
            if gap >= win:
                continue
            arm = c.get('armed') or '-'
            if arm == 'first':
                if any(a['issue'] < m <= c['issue'] for m in connects.get(bot, [])):
                    continue
                bad.append((bot, kind, 'first with no connect between', str(c['t']))); continue
            m = re.match(r'^out:([0-9a-z]+)-([0-9a-z]+)$', arm)
            if not m:
                bad.append((bot, kind, 'armed=%s inside the stay window' % arm, str(c['t']))); continue
            o0, o1 = int(m.group(1), 36), int(m.group(2), 36)
            if not (a['issue'] - 2000 <= o0 and o1 <= c['issue'] + 2000 and o1 - o0 >= 55000):
                bad.append((bot, kind, 'out claim %d-%d does not fit the issues' % (o0, o1), str(c['t']))); continue
            if not any(o0 - 10000 <= ms <= o1 + 10000 and out for ms, out in samples.get(bot, [])):
                bad.append((bot, kind, 'no out-of-zone position in the claim', str(c['t'])))
    return bad


def judge(rows, last=None, hrs=None, samples=None, vis=None):
    out = {}
    last, samples, vis = last or {}, samples or {}, vis or {}
    hrs = hrs or (lambda per, arm: 1.0)
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_junkout_mode')
    out['rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and r['name'] in ('_junkout_mode', '_junkout'))
    runs = [x for x in runs_of(rows) if x['arm'] == 'canary' and x['per'] == 'post']
    junk, low, inc, trip = [], [], [], []
    for x in runs:
        if x['seen'] != set(range(1, x['parts_n'] + 1)):
            inc.append((x['bot'], '%d/%d' % (x['parts_seen'], x['parts_n']), str(x['t'])))
        names = {n: b for n, (s, b) in x['allow'].items() if b > 0} | {n: c for n, c in x['other'].items() if c > 0}
        for n in names:
            if is_junk(n, x['peaceful']):
                junk.append((x['bot'], n, names[n], str(x['t'])))
        for n, (s, b) in x['allow'].items():
            if n in STATIONS and s >= 1 and s - b < 1:
                low.append((x['bot'], n, s, b, str(x['t'])))
            if n == 'stone_pickaxe' and x['mode'] == 'tail' and x['keep_picks'] is not None and s - b < min(s, x['keep_picks']):
                low.append((x['bot'], n, s, b, str(x['t'])))
        if x['mode'] == 'tail' and (x['dh'] is None or x['dh'] > ZONE_H or x['dy'] is None or abs(x['dy']) > ZONE_V):
            trip.append((x['bot'], 'tail', x['dh'], x['dy'], str(x['t'])))
    out['breach_junk_chest'] = len(junk)
    out['j1_incomplete'] = len(inc)
    out['breach_below_allowance'] = len(low)
    # J1's NULL (reported): the control's town deposits, the same junk test on their banked names
    ctl_null = [(r['bot'], n) for r in rows if r['arm'] == 'control' and r['per'] == 'post' and r['name'] == '_town_deposit' for n in banked(r) if is_junk(n, True)]
    out['j1_control_null'] = len(ctl_null)
    vr = visit_runs(rows)
    vc = [x for x in vr if x['arm'] == 'canary' and x['per'] == 'post']
    for x in vc:
        if x['dh'] is None or x['dh'] > ZONE_H or x['dy'] is None or abs(x['dy']) > ZONE_V or x['dw'] is None or x['dw'] > WELL_REACH:
            trip.append((x['bot'], x['kind'], x['dh'], x['dy'], str(x['t'])))
    out['breach_dedicated_trip'] = len(trip)
    off = [(x['bot'], x['offlist'], x['swords'], x['cobble'], x['stock'], str(x['t'])) for x in vc if x['kind'] == 'well' and (x['offlist'] or x['swords'] or x['cobble'] or x['stock'])]
    out['breach_visit_offlist'] = len(off)
    connects = defaultdict(list)
    for r in post_c:
        if r['name'] == '_junkout_mode':
            connects[r['bot']].append(int(r['t'].timestamp() * 1000))
    tail_runs = [{'kind': 'tail', 'bot': x['bot'], 't': x['t'], 'issue': issue_ms(x['v']), 'armed': x['armed']} for x in runs if x['mode'] == 'tail']
    re5 = reissue(vc + tail_runs, samples, connects)
    out['breach_reissue'] = len(re5)
    sf = lambda per, arm: sum(1 for r in rows if r['per'] == per and r['arm'] == arm and r['name'] == 'town_deposit' and r['fail_class'] == 'town_storage_full')
    out['storage_full_post_canary'], out['storage_full_post_control'] = sf('post', 'canary'), sf('post', 'control')
    rc, rk = out['storage_full_post_canary'] / max(hrs('post', 'canary'), 1e-9), out['storage_full_post_control'] / max(hrs('post', 'control'), 1e-9)
    out['harm_storage_full'] = int(out['storage_full_post_canary'] >= 3 and rc > 2 * rk)
    wells = [x for x in vc if x['kind'] == 'well' and x['n'] > 0]
    comps = [x for x in vc if x['kind'] == 'compost' and x['n'] > 0]
    tails = {x['v'] or id(x) for x in runs if x['mode'] == 'tail' and x['banked'] > 0}
    out['well_runs_canary'], out['compost_runs_canary'], out['tail_runs_canary'] = len(wells), len(comps), len(tails)
    out['well_items_canary'] = sum(x['n'] for x in wells)
    out['wear_rows_canary'] = sum(1 for r in post_c if r['name'] == '_junkout' and r['detail'].startswith('phase=wear'))
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm]
            out['dispose_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'dispose_well')
            out['td_rows_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == '_town_deposit')
            gs = [r for r in sel if r['name'] == 'gather']
            out['gather_rows_%s_%s' % (per, arm)] = len(gs)
            out['gather_ok_%s_%s' % (per, arm)] = sum(1 for r in gs if r['status'] == 'success')
            snaps = [(sl, inv) for (p, a, _b), (_t, sl, inv) in last.items() if p == per and a == arm]
            nb = len(snaps)
            out['bag_bots_%s_%s' % (per, arm)] = nb
            out['slots_mean_%s_%s' % (per, arm)] = round(sum(sl for sl, _ in snaps) / nb, 2) if nb else float('nan')
            out['full_share_%s_%s' % (per, arm)] = round(sum(1 for sl, _ in snaps if sl >= FULL_SLOTS) / nb, 3) if nb else float('nan')
            out['listed_mean_%s_%s' % (per, arm)] = round(sum(listed_stacks(inv) for _, inv in snaps) / nb, 3) if nb else float('nan')
            tb = lambda inv: sum(-(-int(inv.get(k) or 0) // 64) for k in ('torch', 'bone_meal'))
            out['torchbm_mean_%s_%s' % (per, arm)] = round(sum(tb(inv) for _, inv in snaps) / nb, 3) if nb else float('nan')
            out['visits_junk_%s_%s' % (per, arm)] = vis.get((per, arm), 0)
    out['exposure_ready'] = int(len(wells) >= 10 and len(comps) >= 3 and len(tails) >= 3 and out['visits_junk_post_canary'] >= 20)
    out['instrument_control'] = int(out['dispose_post_control'] >= 1 and out['td_rows_post_control'] >= 1 and out['visits_junk_post_control'] >= 1)
    out['_lists'] = {'junk': junk[:5], 'incomplete': inc[:5], 'below': low[:5], 'trip': trip[:5], 'offlist': off[:5], 'reissue': re5[:5], 'ctl_null': ctl_null[:5]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)
    ms0 = int(T0.timestamp() * 1000)
    R = lambda name, detail, mins=0.0, bot='hive-a-Alpha', arm='canary', per='post', status='success', fail=None: {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': fail, 'detail': detail, 'bot': bot}
    def V(kind='well', mins=0.0, armed='first', dh=5, dy=0, dw=8, n=46, offlist=0, swords=0, cobble=0, stock=0, **k):
        vid = 'hive-a-Alpha.%s' % _b36(ms0 + int(mins * 60000))
        return R('_junkout', 'phase=%s vid=%s armed=%s dh=%s dy=%s dw=%s offlist=%d swords=%d cobble=%d stock=%d slots=20->17 listed=3 n=%d status=success'
                 % (kind, vid, armed, dh, dy, dw, offlist, swords, cobble, stock, n), mins=mins + 0.5, **k)
    def BANK(allow='torch=11:11 allow=bone_meal=30:30', other='', mode='tail', mins=0.0, part='1/1', banked=41, armed='first', dh=4, dy=0, keep=0, peaceful=1, v=None, **k):
        vv = v or 'hive-a-Alpha.%s' % _b36(ms0 + int(mins * 60000))
        toks = ' '.join(('allow=' + a if not a.startswith('allow=') else a) for a in allow.split(' allow=') if a) + (' ' + ' '.join('other=' + o for o in other.split(',')) if other else '')
        return R('_junkout', 'phase=bank v=%s mode=%s armed=%s dh=%s dy=%s peaceful=%d stacks=2 banked=%d slots=17->15 keep_picks=%s rows=bone_meal:1,torch:1 part=%s %s'
                 % (vv, mode, armed, dh, dy, peaceful, banked, keep, part, toks or '-'), mins=mins + 0.5, **k)
    ctl = [R('dispose_well', 'threw 16', arm='control', bot='hive-b-A'), R('_town_deposit', 'slots 36->35 stacks 1/1 clicked 1 bagdelta 1 tools - banked raw_copper:7 stop done containers 1,2,3=took', arm='control', bot='hive-b-A')]
    vis = {('post', 'canary'): 25, ('post', 'control'): 9}
    good = [R('_junkout_mode', 'phase=mode visit=1 allowance=1', mins=-1)] + [V(mins=i * 30) for i in range(10)] + [V('compost', mins=i * 30 + 1) for i in range(3)] \
        + [BANK(mins=i * 20 + 2) for i in range(3)]
    # the legitimate re-arms between the 30-min-apart well runs need nothing (>= 20 min); the bank runs 20 min apart >= 15
    ok = judge(good + ctl, {}, None, {}, vis)
    for k in ('breach_junk_chest', 'j1_incomplete', 'breach_below_allowance', 'breach_dedicated_trip', 'breach_visit_offlist', 'breach_reissue', 'rows_control'):
        assert ok[k] == 0, (k, ok[k], ok['_lists'])
    assert ok['licence_canary'] == 1 and ok['exposure_ready'] == 1 and ok['instrument_control'] == 1, ok
    J = lambda extra, **k: judge(good + extra + ctl, {}, None, k.get('samples', {}), vis)
    # J1
    assert J([BANK(other='egg:6', mins=200)])['breach_junk_chest'] == 1, 'J1: an egg'
    assert J([R('_junkout', 'phase=bank v=hive-a-Alpha.zz mode=tail armed=first dh=4 dy=0 peaceful=1 stacks=1 banked=0 slots=17->17 keep_picks=0 rows=torch:1 part=1/1 allow=torch=11:0 try=egg:4', mins=200)])['breach_junk_chest'] == 1, 'J1: an aborted run clicked an egg (try=)'
    assert J([BANK(other='oak_sapling:9', mins=200)])['breach_junk_chest'] == 1, 'J1: a sapling'
    assert J([BANK(other='brown_mushroom:3', mins=200)])['breach_junk_chest'] == 1, 'J1: a peaceful plant in a peaceful world'
    assert J([BANK(other='brown_mushroom:3', peaceful=0, mins=200)])['breach_junk_chest'] == 0, 'J1 control: outside peaceful, not junk'
    assert J([BANK(other='cobblestone:64,raw_copper:7', mode='full', mins=200)])['breach_junk_chest'] == 0, 'J1 control: the base plan'
    assert J([BANK(part='1/2', mins=200)])['j1_incomplete'] == 1, 'J1 coverage'
    assert J([BANK(part='1/2', mins=200, v='x.1'), BANK(part='2/2', allow='', other='coal:3', mins=200, v='x.1')])['j1_incomplete'] == 0
    assert judge(good + ctl + [R('_town_deposit', 'slots 36->35 stacks 1/1 clicked 1 bagdelta 1 tools - banked glass:5 stop done', arm='control', bot='hive-b-A')], {}, None, {}, vis)['j1_control_null'] == 1
    # J2
    assert J([BANK(allow='crafting_table=1:1', mins=200)])['breach_below_allowance'] == 1, 'J2: the only table'
    assert J([BANK(allow='chest=8:0', mins=200)])['breach_below_allowance'] == 0, 'J2 control'
    assert J([BANK(allow='stone_pickaxe=5:3', keep=3, mins=200)])['breach_below_allowance'] == 1, 'J2: two left of best + 2'
    assert J([BANK(allow='stone_pickaxe=5:2', keep=3, mins=200)])['breach_below_allowance'] == 0, 'J2 control: three left'
    assert J([BANK(allow='stone_pickaxe=5:3', keep=3, mode='full', mins=200)])['breach_below_allowance'] == 0, 'J2: a full bag is the base tool rule (a ceiling)'
    # J3
    assert J([V(mins=400, dh=17)])['breach_dedicated_trip'] == 1, 'J3: 17 from home'
    assert J([V(mins=400, dy=-13)])['breach_dedicated_trip'] == 1, 'J3: 13 below home'
    assert J([V(mins=400, dw=21)])['breach_dedicated_trip'] == 1, 'J3: 21 from the well'
    assert J([V('compost', mins=400, dw=21)])['breach_dedicated_trip'] == 1, 'J3: 21 from the composter (dw carries its distance)'
    assert J([V('compost', mins=400, dw=20)])['breach_dedicated_trip'] == 0, 'J3 control: 20 is in reach'
    assert J([BANK(mins=400, dh=20)])['breach_dedicated_trip'] == 1, 'J3: a tail 20 from home'
    assert J([BANK(mode='full', mins=400, dh='?')])['breach_dedicated_trip'] == 0, 'J3: a full-bag deposit is not a visit order'
    # J4
    assert J([V(mins=400, cobble=64)])['breach_visit_offlist'] == 1, 'J4: cobble at a visit'
    assert J([V(mins=400, swords=1)])['breach_visit_offlist'] == 1, 'J4: a sword at a visit'
    assert J([V('compost', mins=400, offlist=0)])['breach_visit_offlist'] == 0
    # J5: a re-issue inside the window
    base = [V(mins=300)]
    assert J(base + [V(mins=305, armed='first')])['breach_reissue'] == 1, 'J5: first with no connect'
    assert J(base + [R('_junkout_mode', 'phase=mode', mins=302), V(mins=305, armed='first')])['breach_reissue'] == 0, 'J5 control: a connect between'
    assert J(base + [V(mins=305, armed='stay')])['breach_reissue'] == 1, 'J5: stay inside the window'
    o0, o1 = ms0 + int(301 * 60000), ms0 + int(302.2 * 60000)
    claim = 'out:%s-%s' % (_b36(o0), _b36(o1))
    # the LEGITIMATE crossing in the start-stamp / end-position shape: a skill row stamped inside the zone at its start, its END
    # (stamp + duration) outside, inside the claim
    legit = {'hive-a-Alpha': [(o0 - 5000, False), (o0 + 30000, True), (o1 + 4000, False)]}
    assert J(base + [V(mins=305, armed=claim)], samples=legit)['breach_reissue'] == 0, 'J5 control: a real departure'
    assert J(base + [V(mins=305, armed=claim)], samples={'hive-a-Alpha': [(o0 + 30000, False)]})['breach_reissue'] == 1, 'J5: a claim with no position out'
    short = 'out:%s-%s' % (_b36(o0), _b36(o0 + 30000))
    assert J(base + [V(mins=305, armed=short)], samples=legit)['breach_reissue'] == 1, 'J5: 30 s out is not a re-arm'
    assert J(base + [V(mins=321, armed='stay')])['breach_reissue'] == 0, 'J5 control: after the stay window'
    assert J([BANK(mins=300), BANK(mins=310, armed='first')])['breach_reissue'] == 1, 'J5: the tail too'
    # HARM
    SF = lambda **k: R('town_deposit', 'the town chests in reach are full', status='failed', fail='town_storage_full', **k)
    h = lambda per, arm: 10.0
    assert judge(good + [SF()] * 3 + ctl, {}, h, {}, vis)['harm_storage_full'] == 1
    assert judge(good + [SF()] * 2 + ctl, {}, h, {}, vis)['harm_storage_full'] == 0
    # exposure and instrument
    assert judge([V(mins=i * 30) for i in range(9)] + [V('compost', mins=1)] * 3 + [BANK(mins=2 + i * 20) for i in range(3)] + ctl, {}, None, {}, vis)['exposure_ready'] == 0, '9 well runs'
    assert judge(good + ctl, {}, None, {}, {('post', 'canary'): 19, ('post', 'control'): 9})['exposure_ready'] == 0, '19 zone visits'
    assert judge(good, {}, None, {}, vis)['instrument_control'] == 0, 'no control rows: BLIND'
    assert judge(good + ctl + [R('_junkout', 'phase=well vid=x.1', arm='control', bot='hive-b-A')], {}, None, {}, vis)['rows_control'] == 1
    # primary from snapshots
    last = {('pre', 'canary', 'a'): (T0, 30, {'egg': 16, 'torch': 5}), ('post', 'canary', 'a'): (T0, 26, {'cobblestone': 64})}
    p = judge(ctl, last, None, {}, vis)
    assert p['listed_mean_pre_canary'] == 1 and p['listed_mean_post_canary'] == 0 and p['torchbm_mean_pre_canary'] == 1, p
    if os.environ.get('JS_CHECK'):
        import subprocess
        js = subprocess.run(['node', '--input-type=module', '-e',
            "import { WELL_JUNK, isWellJunk, SCAFFOLD_DECORATIONS } from './bots/src/well.mjs'; import { NEVER_KEEP } from './bots/src/hygiene.mjs'; import { NEVER_BANKABLE } from './bots/src/bankable.mjs';"
            "import { PEACEFUL_COMPOST } from './bots/src/peacefulkit.mjs'; const sc = new Set(SCAFFOLD_DECORATIONS);"
            "console.log(JSON.stringify({ w: [...WELL_JUNK].filter(n => isWellJunk(n) && !sc.has(n)), j: [...WELL_JUNK, ...NEVER_KEEP, ...NEVER_BANKABLE], p: Object.keys(PEACEFUL_COMPOST) }))"],
            capture_output=True, text=True, cwd=os.environ['JS_CHECK'], env={**os.environ, 'OLLAMA_MODEL': 'x'})
        lists = json.loads(js.stdout.strip().splitlines()[-1])
        assert set(lists['w']) == WELL_LISTED, 'the well list differs: +%s -%s' % (sorted(set(lists['w']) - WELL_LISTED), sorted(WELL_LISTED - set(lists['w'])))
        miss = [n for n in lists['j'] if not is_junk(n, False)] + [n for n in lists['p'] if not is_junk(n, True)]
        assert not miss, 'the read misses junk names the bots use: %s' % miss
        names = json.dumps(sorted(JUNK)); pnames = json.dumps(sorted(PEACEFUL_JUNK))
        js2 = subprocess.run(['node', '--input-type=module', '-e',
            "import { notForChest } from './bots/src/towndeposit.mjs'; const a = %s, b = %s;"
            "console.log(JSON.stringify([...a.filter(n => !notForChest(n, { peaceful: false })), ...b.filter(n => !notForChest(n, { peaceful: true }))]))" % (names, pnames)],
            capture_output=True, text=True, cwd=os.environ['JS_CHECK'], env={**os.environ, 'OLLAMA_MODEL': 'x'})
        extra = json.loads(js2.stdout.strip().splitlines()[-1])
        assert not extra, 'the read calls these junk but the bot may bank them: %s' % extra
        print('JS_CHECK ok: the well list equal, every bot junk name is junk here, every junk name here is notForChest in the bot')
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


def _b36(n):
    n = int(n)
    s = ''
    while True:
        n, r = divmod(n, 36)
        s = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + s
        if not n:
            return s


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
    rows, walked, bots, bad, last, samples, vis = stream(PRE, END, CUT, CANS, cv=CV if CV and CV != 'x' else '')
    lagged = stream.lag
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    res = judge(rows, last, hrs, samples, vis)
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    lvl = lambda k: (res[k + '_post_canary'] - res[k + '_pre_canary']) - (res[k + '_post_control'] - res[k + '_pre_control'])
    share = lambda a, b: a / b if b else float('nan')
    gok = {f'{p}_{a}': share(res[f'gather_ok_{p}_{a}'], res[f'gather_rows_{p}_{a}']) for p in ('pre', 'post') for a in ('canary', 'control')}
    dids = {'slots_mean': lvl('slots_mean'), 'full_share': lvl('full_share'), 'listed_mean': lvl('listed_mean'), 'torchbm_mean': lvl('torchbm_mean'),
            'gather_ok': (gok['post_canary'] - gok['pre_canary']) - (gok['post_control'] - gok['pre_control'])}
    print('RESTART LAG  canary post rows from another build skipped: %d (canary build %s)' % (lagged, CV or '-'))
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f | bag snapshots: bots pre/post canary %d/%d control %d/%d'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control'), res['bag_bots_pre_canary'], res['bag_bots_post_canary'], res['bag_bots_pre_control'], res['bag_bots_post_control']))
    print('             zone visits with listed junk below 34: canary %d -> %d control %d -> %d'
          % (res['visits_junk_pre_canary'], res['visits_junk_post_canary'], res['visits_junk_pre_control'], res['visits_junk_post_control']))
    print('PRIMARY      slots per bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f (should FALL) | share >= %d canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
          % (res['slots_mean_pre_canary'], res['slots_mean_post_canary'], res['slots_mean_pre_control'], res['slots_mean_post_control'], dids['slots_mean'], FULL_SLOTS,
             res['full_share_pre_canary'], res['full_share_post_canary'], res['full_share_pre_control'], res['full_share_post_control'], dids['full_share']))
    print('             listed-junk slots per bag canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | torch + bone meal slots per bag canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | gather success DiD %+.3f'
          % (res['listed_mean_pre_canary'], res['listed_mean_post_canary'], res['listed_mean_pre_control'], res['listed_mean_post_control'], dids['listed_mean'],
             res['torchbm_mean_pre_canary'], res['torchbm_mean_post_canary'], res['torchbm_mean_pre_control'], res['torchbm_mean_post_control'], dids['torchbm_mean'], dids['gather_ok']))
    print('LIVENESS     licence rows %d | well visit runs that threw %d (%d items) | compost visit runs %d | tail bank runs %d | wear rows %d | control rows %d (must be 0)'
          % (res['licence_canary'], res['well_runs_canary'], res['well_items_canary'], res['compost_runs_canary'], res['tail_runs_canary'], res['wear_rows_canary'], res['rows_control']))
    print('DEFECTS      J1 junk into a chest %d %s (incomplete %d %s: BLOCK KEEP; control null %d %s) | J2 below the allowance %d %s'
          % (res['breach_junk_chest'], res['_lists']['junk'], res['j1_incomplete'], res['_lists']['incomplete'], res['j1_control_null'], res['_lists']['ctl_null'],
             res['breach_below_allowance'], res['_lists']['below']))
    print('             J3 issued outside its gate %d %s | J4 a visit threw off the list %d %s | J5 re-issued inside the visit %d %s'
          % (res['breach_dedicated_trip'], res['_lists']['trip'], res['breach_visit_offlist'], res['_lists']['offlist'], res['breach_reissue'], res['_lists']['reissue']))
    print('HARM         town_storage_full canary %d control %d (per bot-h %.3f vs %.3f) -> %s'
          % (res['storage_full_post_canary'], res['storage_full_post_control'], rate(res['storage_full_post_canary'], 'post', 'canary'),
             rate(res['storage_full_post_control'], 'post', 'control'), 'TRIP' if res['harm_storage_full'] else 'ok'))
    print('EXPOSURE     -> %s (well runs %d need 10; compost runs %d need 3; tail runs %d need 3; zone visits %d need 20) | INSTRUMENT control dispose_well %d, town deposits %d, zone visits %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['well_runs_canary'], res['compost_runs_canary'], res['tail_runs_canary'], res['visits_junk_post_canary'],
             res['dispose_post_control'], res['td_rows_post_control'], res['visits_junk_post_control'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('junkoutread', W, {k: (clean(v) if isinstance(v, float) else v) for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
