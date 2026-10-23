#!/usr/bin/env python3
# stocktargetread.py [window_min] -- the read for canary `stocktarget-01` (per-town stock targets + chest pruning;
# design docs/reports/stocktargets-design-2026-10-08.md r6, both engines APPROVE). CANARY_DRYRUN=pool[,pool]:sha:iso for
# dry runs (never emits). STOCK_CENSUS=<cc2 census json> adds the independent G1b check. STOCK_CC=<cobblecap.mjs> is the
# journal fold to audit with (default: the canary's own copy beside this read, ~/mcai-analysis/stocktarget/cobblecap.mjs).
#
# MEMORY: STREAMED (chestread's pattern): every row in the window is counted for the denominators, only the kinds this
# read uses are held -- the +1440 window costs megabytes, not the 16-18 GB of an Events.load read.
#
# THE CHANGE (rows this build writes; the base writes none of them):
#   _stock_bank      deposit, one per targeted non-cobble name planned: group= name= planned= moved= kept= target=
#                    decision= town_before= town_after= complete= claims= refused= [nowell=1]
#   _stock_dispose   the well, one per targeted click (bag surplus at target): group= name= count= floor= avail= target=
#                    keep= pillar_after= pruned_left= [refused=1]
#   _stock_prune     the well, one per click of a stack a prune took (same fields)
#   _stock_prune_visit  one per prune_town order
#   _stock_recovery  chest-full recovery stages: stage=entry|craft|place aid= [at=] untargeted= nowell= nclaims= qualifying= claims= [held=1]
#   _town_deposit    adds " stock <claims>/<refused>[ valve N nothing_else=1][ counted N]"
#
#   LIVENESS     canary rows of the kinds above, plus deposit/town_deposit refusals naming "town stock target" (>= 1)
#   ARMS         control rows of those kinds (must be 0: the base cannot write them)
#   CORRECTNESS  (each REVERTS; each has a failing fixture in --selftest)
#     G1  a success _stock_dispose/_stock_prune click of a PROTECTED kind or a tool; a _stock_dispose (not pruned) whose
#         avail was below its target; a success click of a pillar block that left pillar_after < 64 (bag disposal only)
#     G1b (independent, STOCK_CENSUS) a canary town whose census holds less than the target of a group the canary
#         disposed or pruned, after adding back the canary's draws of that group in the window -- UNTESTED without a census
#     G2  a canary _deposit_new_chest decision=place|craft placed=1 without the stage=place success row of the SAME
#         recovery (aid=, same bot and site, <= 5 min before) that qualified (untargeted, nowell or reservations -- as
#         many admitted claims carrying that aid in the journal as the row's nclaims=, when the audit ran)
#     G3  a _stock_bank row that moved items with complete=1 and town_after > target; and (journal) an admitted bank
#         claim released into a group total above its target
#     G3v a _town_deposit row with more than one valve, or a valve without nothing_else=1; (journal) more valve claims
#         than valve rows
#     G4  (journal) admitted takes of ONE group released by one count, whose container lost more of that group than they
#         took between admission and release, with no other admission of that group on it (an overlapping one is a TRIPWIRE)
#   TRIPWIRE     the accepted residual (design 3.6): share of bot-minutes a pickaxe-less bag holds >= 34 occupied slots
#                (a lower bound from the snapshot: unstackables per copy, 16-stackers per 16), DiD; never a verdict
#   UNTESTED     near target, before the one-time clear, G1b/G3/G4 have little or no exposure (design 7): reported as
#                UNTESTED when their denominators are 0, never as "0 breaches"
#   INSTRUMENT   control deposit/town_deposit runs that banked a targeted group (the behaviour removed; >= 1)
#   EXPOSURE     >= 10 canary stock actions (refusals at target + dispose clicks + prune clicks + bank rows) and the
#                instrument
#   REPORTED     targeted items banked per bot-h DiD; chest-full deposit failures per bot-h DiD; pruned stacks; disposed
#                stacks; valve uses; nowell rows; recovery stages; reset records; journal generations (rotation)
import sys, os, json, re, glob, gzip, subprocess
import datetime as dt
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from towncap import town_cobble_cap   # noqa: E402  (cobblecap-1000: the cobble cap is read, never written here)
# 'cobble' is filled in by set_cobble_target() from the stocktarget.mjs beside the fold being audited (towncap.py): it was a
# literal 256 here, which would have called every cobble bank between 257 and 1000 a G3 breach once the cap moved
# sand 0 -> 64: matset-01 (OWNER 10-23, building tier §3.4), mirroring stocktarget.mjs
TARGETS = {'cobble': None, 'stick': 64, 'stone': 64, 'dirt': 0, 'sand': 64, 'gravel': 0, 'deepslate': 0, 'tuff': 0,
           'calcite': 0, 'sandstone': 0, 'stone_pickaxe': 16, 'wooden_pickaxe': 4, 'stone_axe': 4, 'stone_shovel': 4,
           'wooden_axe': 0, 'wooden_shovel': 0, 'stone_hoe': 0, 'wooden_hoe': 0}
WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']
for w in WOODS:
    TARGETS[w + '_log'] = 64
for w in WOODS + ['bamboo']:
    TARGETS[w + '_planks'] = 64
GROUP_OF = {'cobblestone': 'cobble', 'cobbled_deepslate': 'cobble', 'sand': 'sand', 'red_sand': 'sand',
            'sandstone': 'sandstone', 'red_sandstone': 'sandstone'}
for g in TARGETS:
    GROUP_OF.setdefault(g, g)


def set_cobble_target(cc=None):
    """TARGETS['cobble'] from the module beside cobblecap.mjs `cc` (STOCK_CC / the canary's copy / the repo)."""
    TARGETS['cobble'] = town_cobble_cap(os.path.join(os.path.dirname(cc), 'stocktarget.mjs') if cc else None)
    return TARGETS['cobble']
PROTECTED = re.compile(r'(_ore$|^raw_|_ingot$|_nugget$|^(coal|charcoal|diamond|emerald|lapis_lazuli|redstone|quartz|amethyst_shard|netherite_scrap|ancient_debris)$|_(pickaxe|axe|shovel|hoe|sword)$|_(helmet|chestplate|leggings|boots)$|^(bow|crossbow|shield|shears|flint_and_steel|fishing_rod|bucket|water_bucket|lava_bucket|milk_bucket)$|_sapling$|_propagule$|^(torch|crafting_table|furnace|blast_furnace|smoker|chest|barrel|composter|bed|bone_meal|bamboo|wheat|wheat_seeds|apple|bread)$|_bed$)')
PILLAR = re.compile(r'^(dirt|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|gravel|sand|netherrack|tuff|deepslate|sandstone|red_sandstone|calcite|dripstone_block|blackstone)$|(_log|_planks|_wood|_hyphae)$')
KEEP = ('_stock_bank', '_stock_dispose', '_stock_prune', '_stock_prune_visit', '_stock_recovery', '_stock_refused', '_town_deposit',
        '_deposit_new_chest', 'deposit', 'town_deposit', 'withdraw_pick', 'withdraw', 'prune_town')
OWN = ('_stock_bank', '_stock_dispose', '_stock_prune', '_stock_prune_visit', '_stock_recovery', '_stock_refused')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
REFUSAL = re.compile(r'town stock (target|not yet counted)')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=None):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


# OCCUPIED SLOTS from the snapshot (Codex code r2 P2: ceil(count/64) counted 36 axes as one slot). The logs carry name ->
# count, never slots, so this is the same LOWER BOUND for every arm and period (partial stacks of one name merge):
# an unstackable takes a slot per copy, a 16-stacker per 16, the rest per 64.
UNSTACKABLE = re.compile(r'_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots|bed|shulker_box|boat|chest_boat|minecart)$|'
                         r'^(bow|crossbow|trident|shield|fishing_rod|shears|flint_and_steel|water_bucket|lava_bucket|milk_bucket|'
                         r'powder_snow_bucket|potion|splash_potion|lingering_potion|saddle|minecart|elytra|totem_of_undying|enchanted_book|'
                         r'written_book|writable_book|mushroom_stew|beetroot_soup|rabbit_stew|suspicious_stew|cake|carrot_on_a_stick|'
                         r'warped_fungus_on_a_stick|spyglass|brush|mace|goat_horn|bundle)$|^music_disc_|_bucket$')
STACK16 = re.compile(r'^(egg|brown_egg|blue_egg|snowball|ender_pearl|bucket|honey_bottle|armor_stand)$|_sign$|_hanging_sign$|_banner$')


def slots_of(inv):
    s = 0
    for k, c in (inv or {}).items():
        if not isinstance(c, (int, float)) or c <= 0:
            continue
        per = 1 if UNSTACKABLE.search(k) else 16 if STACK16.search(k) else 64
        s += -(-int(c) // per)
    return s


class Exposure:
    """THE ACCEPTED RESIDUAL'S TRIPWIRE, TIME-WEIGHTED PER BOT (Codex code r2 P2): each bot-minute observed counts once,
    weighted by the share of that minute's rows from a pickaxe-less bag at >= 34 occupied slots -- so a chatty bot does not
    outweigh a quiet one. share(per, arm) = flagged bot-minutes / observed bot-minutes."""
    def __init__(self):
        self.m = defaultdict(lambda: [0, 0])
    def add(self, per, arm, bot, t, inv):
        if not isinstance(inv, dict) or not bot:
            return
        c = self.m[(per, arm, bot, int(t.timestamp() // 60))]
        c[1] += 1
        if slots_of(inv) >= 34 and not any(k.endswith('_pickaxe') for k in inv):
            c[0] += 1
    def share(self, per, arm):
        mins = [v for k, v in self.m.items() if k[0] == per and k[1] == arm]
        return sum(f / n for f, n in mins) / len(mins) if mins else float('nan')
    def minutes(self, per, arm):
        return sum(1 for k in self.m if k[0] == per and k[1] == arm)


def stream(since, until, cut, cans, logroot='/var/log/mcai'):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    bots = defaultdict(set)
    nopick = Exposure()   # the accepted residual's tripwire: bot-minutes of a pickaxe-less bot at >= 34 slots
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
                b = (d.get('bot') or {}).get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                if b:
                    bots[(per, arm)].add(b)
                nopick.add(per, arm, b, t, (d.get('bot') or {}).get('inventory'))
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'detail': sk.get('detail') or '',
                                 'bot': b, 'delta': sk.get('inventory_delta') or {}, 'cv': (d.get('code') or {}).get('version')})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad, nopick


def judge(rows, hours, census=None, draws=None, bank_aids=None):
    """The gates and the reported numbers from the kept rows. Pure (the --selftest fixtures call it)."""
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    post_k = [r for r in rows if r['per'] == 'post' and r['arm'] == 'control']
    pre_c = [r for r in rows if r['per'] == 'pre' and r['arm'] == 'canary']
    pre_k = [r for r in rows if r['per'] == 'pre' and r['arm'] == 'control']
    out = {}
    out['rows_canary'] = sum(1 for r in post_c if r['name'] in OWN)
    # LIVE = own rows that judged something: every own row but a _stock_refused row whose refusals are ALL unknown (a
    # canary whose journal cannot be replayed refuses everything as unknown and judges nothing: Claude fold-r1 P2-1)
    # (Claude fold-r2 P3: nor a recovery stage that came to nothing, nor a bank row whose claim was undecided)
    proven = lambda r: ((r['name'] != '_stock_refused' or num(kv(r['detail']), 'at_cobble', 0) + num(kv(r['detail']), 'at_stock', 0) > 0)
                        and not (r['name'] == '_stock_recovery' and r['status'] != 'success')
                        and not (r['name'] == '_stock_bank' and kv(r['detail']).get('decision') == 'unknown'))
    out['rows_live'] = sum(1 for r in post_c if r['name'] in OWN and proven(r))
    out['rows_control'] = sum(1 for r in post_k if r['name'] in OWN)
    refusals = sum(1 for r in post_c if r['name'] in ('deposit', 'town_deposit') and REFUSAL.search(r['detail']))
    # THE AT-TARGET REFUSAL ROWS (stonecap-01 INCONCLUSIVE 10-12: on a town already above its cap the only evidence the
    # rule is live is a refusal; the plan used to drop the item silently): rows, and the cobble cap's share of them
    refused_rows = [r for r in post_c if r['name'] == '_stock_refused']
    refused_cobble = sum(1 for r in refused_rows if num(kv(r['detail']), 'cobble', 0) > 0)
    # CONFIRMED at a counted cap/target, apart from unknown-only (fail-closed is not proof: Codex fold-r1); cobble apart
    refused_at_cobble = sum(1 for r in refused_rows if num(kv(r['detail']), 'at_cobble', 0) > 0)
    refused_at_stock = sum(1 for r in refused_rows if num(kv(r['detail']), 'at_stock', 0) > 0)
    refused_via = Counter(kv(r['detail']).get('via', '?') for r in refused_rows)
    g1, g2, g3, g3v, disposed_groups = [], [], [], [], set()
    disposed_by_pool = defaultdict(set)
    disp = prn = bank_rows = valves = nowell = 0
    stages = Counter()
    visits = Counter(); well_keeps = 0   # prune visits by outcome; candidate stacks the well's rule refused (Claude code r3 P3)
    for r in post_c:
        f = kv(r['detail'])
        if r['name'] in ('_stock_dispose', '_stock_prune') and r['status'] == 'success':
            name, grp = f.get('name', ''), f.get('group', '')
            disposed_groups.add(grp)
            if r['name'] == '_stock_dispose':
                disp += 1
            else:
                prn += 1
            # the SAME checks for a pruned stack as for bag surplus (Codex code r1 P2: no prune exemption)
            if PROTECTED.search(name):
                g1.append(('protected', r['bot'], name, str(r['t'])))
            if num(f, 'avail', -1) < TARGETS.get(grp, 0):
                g1.append(('below_target', r['bot'], name, f.get('avail'), str(r['t'])))
            if PILLAR.search(name) and num(f, 'pillar_after', 0) < 64:
                g1.append(('pillar', r['bot'], name, f.get('pillar_after'), str(r['t'])))
            if f.get('left_after') is not None and num(f, 'left_after', 0) < num(f, 'keep', 0):
                g1.append(('keep', r['bot'], name, f.get('left_after'), f.get('keep'), str(r['t'])))
            disposed_by_pool[pool_of(r['bot'])].add(grp)
        if r['name'] == '_stock_bank':
            bank_rows += 1
            if 'nowell=1' in r['detail']:
                nowell += 1
            moved, grp = num(f, 'moved', 0), f.get('group', '')
            ta = num(f, 'town_after')
            if moved > 0 and f.get('complete') == '1' and ta is not None and ta > TARGETS.get(grp, 0) and 'nowell=1' not in r['detail']:
                g3.append((r['bot'], grp, moved, ta, str(r['t'])))
        if r['name'] == '_stock_recovery':
            stages[(f.get('stage'), r['status'])] += 1
        if r['name'] == '_stock_prune_visit':
            visits[r['status']] += 1
            m = re.search(r' well_keeps=(\d+)', r['detail'])
            well_keeps += int(m.group(1)) if m else 0
        if r['name'] == '_town_deposit':
            m = re.search(r' stock (\d+)/(\d+)( valve (\d+)( nothing_else=1)?)?', r['detail'])
            if m and m.group(3):
                v = int(m.group(4))
                valves += v
                if v > 1 or not m.group(5):
                    g3v.append((r['bot'], v, str(r['t'])))
    # G2: a placement needs the place-stage row of the SAME recovery (its action id, aid=: Codex code r2 P2), from the same
    # bot, at the same site, that QUALIFIED: an untargeted item, a nowell name, or reservations -- and, when the journal
    # audit ran, as many admitted claims under that action id as the row's nclaims= (bank_aids). A stale same-site row of
    # another recovery never counts.
    for r in post_c:
        if r['name'] == '_deposit_new_chest' and re.search(r'decision=(place|craft|place_carried)', r['detail']) and 'placed=1' in r['detail']:
            f0 = kv(r['detail'])
            site, aid = f0.get('at'), f0.get('aid')
            def qualifies(q):
                fq = kv(q['detail'])
                if q['name'] != '_stock_recovery' or q['bot'] != r['bot'] or q['status'] != 'success' or fq.get('stage') != 'place':
                    return False
                if not aid or fq.get('aid') != aid or fq.get('at') != site or not (dt.timedelta(0) <= r['t'] - q['t'] <= dt.timedelta(minutes=5)):
                    return False
                # the reservations are counted on the row (nclaims=, never cut) and proven in the JOURNAL by the recovery's
                # action id (each claim record carries aid=) -- the id list itself may be cut at 300 characters (Codex code r3 P2)
                nclaims = num(fq, 'nclaims', None)
                if nclaims is None:
                    nclaims = len([c for c in (fq.get('claims') or '-').split(',') if c and c != '-'])
                if bank_aids is not None and nclaims > 0 and bank_aids.get(aid, 0) < nclaims:
                    return False
                return num(fq, 'untargeted', 0) > 0 or num(fq, 'nowell', 0) > 0 or nclaims > 0
            if not any(qualifies(q) for q in post_c):
                g2.append((r['bot'], site, aid, r['detail'][:80], str(r['t'])))
    # G1b (independent): the census against the targets of the groups this canary disposed or pruned
    g1b, g1b_tested = [], False
    if census is not None:
        g1b_tested = True
        # per TOWN, the groups that town's canary bots disposed or pruned, with the canary's admitted draws added back
        for town, totals in census.items():
            for grp in disposed_by_pool.get(town, ()):
                back = (draws or {}).get(town, {}).get(grp, 0)
                if grp in TARGETS and totals.get(grp, 0) + back < TARGETS[grp]:
                    g1b.append((town, grp, totals.get(grp, 0), back))
    # the instrument and the reported rates
    def banked(rs):
        n = 0
        for r in rs:
            if r['name'] in ('deposit', 'town_deposit') and r['status'] == 'success':
                n += sum(-int(v) for k, v in r['delta'].items() if k in GROUP_OF and str(v).lstrip('-').isdigit() and int(v) < 0)
        return n
    def fullfail(rs):
        return sum(1 for r in rs if r['name'] in ('deposit', 'town_deposit') and r['status'] == 'failed' and 'full' in r['detail'])
    out.update({'breach_g1': len(g1), 'breach_g2': len(g2), 'breach_g3_row': len(g3), 'breach_g3v_row': len(g3v),
                'breach_g1b': len(g1b), 'g1b_tested': int(g1b_tested), 'refusals_canary': refusals,
                'dispose_clicks': disp, 'prune_clicks': prn, 'prune_visits': dict(visits), 'prune_well_keeps': well_keeps, 'bank_rows': bank_rows, 'valve_uses': valves, 'nowell_rows': nowell,
                'recovery_place_ok': stages[('place', 'success')], 'recovery_refused': sum(v for (s, st), v in stages.items() if st != 'success'),
                'instrument_control': sum(1 for r in post_k if r['name'] in ('deposit', 'town_deposit') and r['status'] == 'success'
                                          and any(k in GROUP_OF and str(v).startswith('-') for k, v in r['delta'].items())),
                'banked_canary': banked(post_c), 'banked_control': banked(post_k),
                'banked_pre_canary': banked(pre_c), 'banked_pre_control': banked(pre_k),
                'fullfail_canary': fullfail(post_c), 'fullfail_control': fullfail(post_k),
                'fullfail_pre_canary': fullfail(pre_c), 'fullfail_pre_control': fullfail(pre_k)})
    out['refused_rows'] = len(refused_rows); out['refused_cobble_rows'] = refused_cobble
    out['refused_at_cobble'] = refused_at_cobble; out['refused_at_stock'] = refused_at_stock; out['refused_via'] = dict(refused_via)
    out['_lists'] = {'g1': g1[:5], 'g2': g2[:5], 'g3': g3[:5], 'g3v': g3v[:5], 'g1b': g1b[:5]}
    return out


def selftest():
    """Every gate's failing fixture, and a clean positive control."""
    set_cobble_target(os.environ.get('STOCK_CC'))
    # cobblecap-1000: G3 on a cobble bank row is judged against the module's cap -- at it is clean, one past it is a breach
    capc = TARGETS['cobble']
    # the target judged with is the module's, loaded independently here (Codex cc1000-r1 P2: a literal put back must not pass)
    cc0 = os.environ.get('STOCK_CC')
    assert capc == town_cobble_cap(os.path.join(os.path.dirname(cc0), 'stocktarget.mjs') if cc0 else None), ('the cobble target is not the module\'s', capc)
    g3row = lambda after: {'t': dt.datetime(2026, 10, 14, tzinfo=dt.timezone.utc), 'per': 'post', 'arm': 'canary', 'name': '_stock_bank', 'status': 'success', 'bot': 'hive-a-Alpha',
                           'delta': {}, 'detail': 'group=cobble name=cobblestone planned=30 moved=30 kept=64 target=%d decision=bank town_before=%d town_after=%d complete=1 claims=1 refused=0' % (capc, after - 30, after)}
    assert judge([g3row(capc)], 3)['breach_g3_row'] == 0 and judge([g3row(capc + 1)], 3)['breach_g3_row'] == 1, ('G3 at the cobble cap %d' % capc)
    T0 = dt.datetime(2026, 10, 10, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, status='success', bot='hive-a-Alpha', mins=0, delta=None: {'t': T0 + dt.timedelta(minutes=mins), 'per': 'post', 'arm': 'canary', 'name': name, 'status': status, 'detail': detail, 'bot': bot, 'delta': delta or {}, 'cv': 'x'}
    ok = judge([R('_stock_dispose', 'group=oak_log name=oak_log count=64 floor=900 avail=900 target=64 keep=64 pillar_after=200 pruned_left=0')], 3)
    assert ok['breach_g1'] == 0 and ok['dispose_clicks'] == 1, ok
    # LIVENESS ON AN OVER-CAP TOWN (stonecap-01 INCONCLUSIVE 10-12): a refusal row is a canary row; cobble counted apart
    rf = judge([R('_stock_refused', 'via=deposit n=2 cobble=1 stock=1 at_cobble=1 at_stock=1 cobblestone:95:cobble_cap oak_log:192:stock_target')], 3)
    assert rf['rows_canary'] == 1 and rf['refused_rows'] == 1 and rf['refused_cobble_rows'] == 1 and rf['refused_at_cobble'] == 1 and rf['refused_at_stock'] == 1, rf
    un = judge([R('_stock_refused', 'via=admission n=1 cobble=1 stock=0 at_cobble=0 at_stock=0 cobblestone:95:cobble_unknown')], 3)
    assert un['refused_rows'] == 1 and un['refused_at_cobble'] == 0 and un['refused_via'] == {'admission': 1}, 'unknown is reported apart, not as a confirmed cap'
    assert un['rows_canary'] == 1 and un['rows_live'] == 0, 'an unknown-only refusal is a row, not liveness (Claude fold-r1 P2-1)'
    assert rf['rows_live'] == 1, 'positive control: a proven refusal is liveness'
    assert judge([R('_stock_recovery', 'stage=entry aid=A at=1,2,3 untargeted=0 nowell=0 nclaims=0 qualifying=- claims=-', status='no_effect'),
                  R('_stock_bank', 'group=oak_log name=oak_log planned=64 moved=0 kept=64 target=64 decision=unknown claims=0 refused=1')], 3)['rows_live'] == 0, 'rows that judged nothing'
    assert judge([R('_stock_refused', 'via=deposit n=1 cobble=0 stock=1 oak_log:192:stock_target')], 3)['refused_cobble_rows'] == 0
    ctl = R('_stock_refused', 'via=deposit n=1 cobble=1 stock=0 cobblestone:95:cobble_cap'); ctl['arm'] = 'control'
    assert judge([ctl], 3)['rows_control'] == 1, 'the base writes none: a control refusal row is an arms breach'
    assert judge([R('_stock_dispose', 'group=oak_log name=iron_ingot count=3 floor=900 avail=900 target=64 keep=0 pillar_after=200 pruned_left=0')], 3)['breach_g1'] == 1
    assert judge([R('_stock_dispose', 'group=oak_log name=oak_log count=64 floor=60 avail=60 target=64 keep=0 pillar_after=200 pruned_left=0')], 3)['breach_g1'] == 1
    assert judge([R('_stock_dispose', 'group=dirt name=dirt count=64 floor=0 avail=0 target=0 keep=16 pillar_after=10 pruned_left=0')], 3)['breach_g1'] == 1
    assert judge([R('_stock_prune', 'group=oak_log name=oak_log count=64 floor=60 avail=60 target=64 keep=0 left_after=0 pillar_after=200 pruned_left=64')], 3)['breach_g1'] == 1, 'no prune exemption'
    assert judge([R('_stock_dispose', 'group=oak_log name=oak_log count=64 floor=900 avail=900 target=64 keep=64 left_after=10 pillar_after=200 pruned_left=0')], 3)['breach_g1'] == 1, 'keep breached'
    PL = R('_deposit_new_chest', 'decision=place aid=A1 near_home=true at=1,2,3 placed=1 tried=[]', mins=1)
    assert judge([PL], 3)['breach_g2'] == 1, 'no qualification at all'
    assert judge([R('_stock_recovery', 'stage=place aid=A1 at=1,2,3 untargeted=1 nowell=0 qualifying=iron_ingot claims=-'), PL], 3)['breach_g2'] == 0, 'positive control: untargeted'
    assert judge([R('_stock_recovery', 'stage=place aid=A1 at=1,2,3 untargeted=0 nowell=1 qualifying=oak_log claims=-'), PL], 3)['breach_g2'] == 0, 'positive control: nowell'
    assert judge([R('_stock_recovery', 'stage=place aid=A1 at=9,9,9 untargeted=1 nowell=0 qualifying=iron_ingot claims=-'), PL], 3)['breach_g2'] == 1, 'another site'
    assert judge([R('_stock_recovery', 'stage=place aid=A0 at=1,2,3 untargeted=1 nowell=0 qualifying=iron_ingot claims=-'), PL], 3)['breach_g2'] == 1, 'a stale same-site row of another recovery'
    assert judge([R('_stock_recovery', 'stage=place aid=A1 at=1,2,3 untargeted=0 nowell=0 qualifying=- claims=-'), PL], 3)['breach_g2'] == 1, 'an empty qualification'
    RC = R('_stock_recovery', 'stage=place aid=A1 at=1,2,3 untargeted=0 nowell=0 nclaims=2 qualifying=oak_log,birch_log claims=c1,c')
    assert judge([RC, PL], 3, bank_aids={'A1': 2})['breach_g2'] == 0, 'positive control: both reservations admitted under the aid (the id list cut)'
    assert judge([RC, PL], 3, bank_aids={'A1': 1})['breach_g2'] == 1, 'one of two reservations not admitted'
    assert judge([RC, PL], 3, bank_aids={'A0': 2})['breach_g2'] == 1, 'admitted under another recovery'
    assert judge([RC, PL], 3)['breach_g2'] == 0, 'no journal audit: the row decides (the journal gate is then blind, reported)'
    assert judge([R('_deposit_new_chest', 'decision=place aid=A1 near_home=true at=1,2,3 placed=0 tried=[]', mins=1)], 3)['breach_g2'] == 0, 'nothing placed: nothing to license'
    assert judge([R('_stock_bank', 'group=oak_log name=oak_log planned=20 moved=20 kept=64 target=64 decision=bank town_before=50 town_after=70 complete=1 claims=1 refused=0')], 3)['breach_g3_row'] == 1
    assert judge([R('_stock_bank', 'group=oak_log name=oak_log planned=20 moved=20 kept=64 target=64 decision=bank town_before=30 town_after=50 complete=1 claims=1 refused=0')], 3)['breach_g3_row'] == 0
    assert judge([R('_town_deposit', 'slots 36->35 stacks 1/1 clicked 1 bagdelta 1 tools - stock 1/0 valve 1 banked x')], 3)['breach_g3v_row'] == 1
    assert judge([R('_town_deposit', 'slots 36->35 stacks 1/1 clicked 1 bagdelta 1 tools - stock 1/0 valve 1 nothing_else=1 banked x')], 3)['breach_g3v_row'] == 0
    c = judge([R('_stock_dispose', 'group=oak_log name=oak_log count=64 floor=900 avail=900 target=64 keep=64 pillar_after=200 pruned_left=0')], 3, census={'hive-a': {'oak_log': 10}})
    assert c['breach_g1b'] == 1 and c['g1b_tested'] == 1
    assert judge([R('_stock_dispose', 'group=oak_log name=oak_log count=64 floor=900 avail=900 target=64 keep=64 pillar_after=200 pruned_left=0')], 3, census={'hive-a': {'oak_log': 10}}, draws={'hive-a': {'oak_log': 60}})['breach_g1b'] == 0, 'draws added back'
    assert judge([R('_stock_dispose', 'group=oak_log name=oak_log count=64 floor=900 avail=900 target=64 keep=64 pillar_after=200 pruned_left=0')], 3, census={'board-a': {'oak_log': 10}})['breach_g1b'] == 0, 'another town'
    # the tripwire's slots and its time weighting (Codex code r2 P2)
    axes = {'stone_axe': 36}
    logs = {'oak_log': 34 * 64}
    assert slots_of(axes) == 36 and slots_of(logs) == 34 and slots_of({'egg': 33}) == 3 and slots_of({'oak_log': 65}) == 2
    ex = Exposure()
    t0 = dt.datetime(2026, 10, 10, 12, 0, tzinfo=dt.timezone.utc)
    for m in range(10):
        ex.add('post', 'canary', 'hive-a-1', t0 + dt.timedelta(minutes=m), {'dirt': 64})          # one row a minute, not full
        for k in range(10):                                                                           # ten rows a minute, full of axes
            ex.add('post', 'canary', 'hive-a-2', t0 + dt.timedelta(minutes=m, seconds=k), axes)
    assert abs(ex.share('post', 'canary') - 0.5) < 1e-9, ('per bot-minute, not per row', ex.share('post', 'canary'))
    ex.add('post', 'control', 'board-a-1', t0, dict(logs, stone_pickaxe=1))
    assert ex.share('post', 'control') == 0, 'a pickaxe in the bag: not the residual'
    journal_selftest()
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


def journal_selftest():
    """G4 through the REAL stockjournal.mjs and the canary's fold: takes of two groups released by one count are judged per
    group (Codex code r2 P2). Needs a cobblecap.mjs (STOCK_CC, ~/mcai-analysis/stocktarget, or this repo's bots/src)."""
    import tempfile
    cands = [os.environ.get('STOCK_CC'), os.path.expanduser('~/mcai-analysis/stocktarget/cobblecap.mjs'),
             os.path.join(HERE, '..', '..', 'bots', 'src', 'cobblecap.mjs')]
    cc = next((c for c in cands if c and os.path.exists(c)), None)
    if not cc:
        print('JOURNAL SELFTEST SKIPPED: no cobblecap.mjs'); return
    T = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) - 60000

    def run(oak_after, stick_after, between=()):
        d = tempfile.mkdtemp(prefix='stockjournal-fx-')
        recs = [{'t': 'cnt', 'k': 'a', 'n': 0, 'cap': T, 'at': T, 'v': 2, 'm': {'oak_log': 640, 'stick': 640}, 'ids': [], 'scan': {'keys': ['a'], 'at': T}, 'w': None},
                {'t': 'claim', 'id': 't1', 'n': 64, 'k': 'a', 'at': T + 1, 'bot': 'b1', 'keys': ['a'], 'coverage': True, 'gone': [], 'g': 'oak_log', 'kind': 'take', 'w': None},
                {'t': 'claim', 'id': 't2', 'n': 64, 'k': 'a', 'at': T + 2, 'bot': 'b1', 'keys': ['a'], 'coverage': True, 'gone': [], 'g': 'stick', 'kind': 'take', 'w': None},
                *between,
                {'t': 'cnt', 'k': 'a', 'n': 0, 'cap': T + 5, 'at': T + 5, 'v': 2, 'm': {'oak_log': oak_after, 'stick': stick_after}, 'ids': ['t1', 't2'], 'w': None}]
        with open(os.path.join(d, 'town.cobble.jsonl'), 'w') as fh:
            fh.write(''.join(json.dumps(r) + '\n' for r in recs))
        r = subprocess.run(['node', os.path.join(HERE, 'stockjournal.mjs'), cc, '0', str(T + 600000), d], capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, r.stderr[-300:]
        return json.loads(r.stdout)
    ok = run(576, 576)
    assert ok['admitted']['take'] == 2 and ok['g4'] == [] and ok['g4_overlap'] == [], ('legal control', ok['admitted'], ok['g4'])
    bad = run(576, 512)
    assert [x['g'] for x in bad['g4']] == ['stick'], ('128 sticks removed under a 64 claim', bad['g4'])
    hide = run(512, 640)
    assert [x['g'] for x in hide['g4']] == ['oak_log'], ('128 logs removed, hidden behind the sticks\' allowance', hide['g4'])
    other = run(576, 512, between=[{'t': 'claim', 'id': 'o1', 'n': 64, 'k': 'a', 'at': T + 3, 'bot': 'b2', 'keys': ['a'], 'coverage': True, 'gone': [], 'g': 'oak_log', 'kind': 'draw', 'w': None}])
    assert [x['g'] for x in other['g4']] == ['stick'] and other['g4_overlap'] == [], ('another GROUP\'s draw is no overlap', other['g4'], other['g4_overlap'])
    same = run(576, 512, between=[{'t': 'claim', 'id': 'o2', 'n': 64, 'k': 'a', 'at': T + 3, 'bot': 'b2', 'keys': ['a'], 'coverage': True, 'gone': [], 'g': 'stick', 'kind': 'draw', 'w': None}])
    assert same['g4'] == [] and [x['g'] for x in same['g4_overlap']] == ['stick'], ('the same group\'s draw is an overlap (tripwire)', same['g4'], same['g4_overlap'])
    # C5 ON THE COMBINED JOURNAL (Codex fold-r1 P2-3 probe): cobble 160 counted, a cobble bank claim of 64 admitted, an
    # unrelated live oak claim of 64, the release count says 270 -> the cobble overshoot is found (stonecapread's fold missed it)
    import tempfile
    CAPC = town_cobble_cap(os.path.join(os.path.dirname(cc), 'stocktarget.mjs'))   # the fold's own cap (cobblecap-1000)
    d = tempfile.mkdtemp(prefix='stockjournal-c5-')
    recs = [{'t': 'cnt', 'k': 'a', 'n': CAPC - 96, 'cap': T, 'at': T, 'v': 2, 'm': {'cobble': CAPC - 96, 'oak_log': 0}, 'ids': [], 'scan': {'keys': ['a'], 'at': T}, 'w': None},
            {'t': 'claim', 'id': 'o1', 'n': 64, 'k': 'a', 'at': T + 1, 'bot': 'b2', 'keys': ['a'], 'coverage': True, 'gone': [], 'g': 'oak_log', 'w': None},
            {'t': 'claim', 'id': 'c1', 'n': 64, 'k': 'a', 'at': T + 2, 'bot': 'b1', 'keys': ['a'], 'coverage': True, 'gone': [], 'w': None},
            {'t': 'cnt', 'k': 'a', 'n': CAPC + 14, 'cap': T + 5, 'at': T + 5, 'v': 2, 'm': {'cobble': CAPC + 14, 'oak_log': 0}, 'ids': ['c1'], 'w': None}]
    with open(os.path.join(d, 'town.cobble.jsonl'), 'w') as fh:
        fh.write(''.join(json.dumps(r) + '\n' for r in recs))
    r = subprocess.run(['node', os.path.join(HERE, 'stockjournal.mjs'), cc, '0', str(T + 600000), d], capture_output=True, text=True, timeout=120)
    c5 = json.loads(r.stdout)
    assert c5['admitted_cobble_bank'] == 1 and [x['g'] for x in c5['g3']] == ['cobble'], ('C5 on the combined journal', c5['admitted'], c5['g3'])
    print('JOURNAL SELFTEST ok: G4 per group (legal, excess, hidden, overlap); C5 cobble overshoot beside an oak claim (cap %d)' % CAPC)


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
    rows, walked, bots, bad, nopick = stream(PRE, END, CUT, CANS)
    census = None
    if os.environ.get('STOCK_CENSUS'):
        try:
            d = json.load(open(os.environ['STOCK_CENSUS']))
            census = {}
            for w, v in d.get('worlds', {}).items():
                if w not in CANS:
                    continue
                tot = Counter()
                for ct in v.get('containers', []):
                    for it in ct.get('items', []):
                        g = GROUP_OF.get(it.get('id'))
                        if g:
                            tot[g] += it.get('count', 0)
                census[w] = tot
        except Exception as e:
            print('census unreadable:', e); census = None
    res = None
    # THE JOURNAL HALF (stockjournal.mjs, the canary's own fold)
    cc = os.environ.get('STOCK_CC') or os.path.expanduser('~/mcai-analysis/stocktarget/cobblecap.mjs')
    print('TARGETS      cobble %d (from %s)' % (set_cobble_target(cc), os.path.join(os.path.dirname(cc), 'stocktarget.mjs')))
    jdirs = [d for p in sorted(CANS) for d in glob.glob('/var/lib/mcai/_pool-%s' % p)]
    journal = None
    try:
        r = subprocess.run(['node', os.path.join(HERE, 'stockjournal.mjs'), cc, str(int(CUT.timestamp() * 1000)), str(int(END.timestamp() * 1000)), *jdirs],
                           capture_output=True, text=True, timeout=600)
        journal = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None
        if journal is None:
            print('journal audit failed:', r.stderr[-300:])
    except Exception as e:
        print('journal audit failed:', e)
    jr = journal or {}
    draws = {k.replace('_pool-', ''): v for k, v in jr.get('draws', {}).items()}
    res = judge(rows, W / 60, census, draws, dict(jr.get('bank_aids', {})) if journal is not None else None)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W))
    print('LIVENESS     canary own rows that judged something (rows_live, the line) %d | all own rows %d (of them _stock_refused %d: at a counted cobble cap %d, at a counted stock target %d, naming cobble %d, via %s) | refusal sentences %d (reported apart) | control own rows %d (must be 0)' % (
        res['rows_live'], res['rows_canary'], res['refused_rows'], res['refused_at_cobble'], res['refused_at_stock'], res['refused_cobble_rows'], res['refused_via'], res['refusals_canary'], res['rows_control']))
    print('CORRECTNESS  G1 %d %s | G1b %s %s | G2 %d %s | G3 row %d %s | G3v row %d %s' % (
        res['breach_g1'], res['_lists']['g1'], res['breach_g1b'] if res['g1b_tested'] else 'UNTESTED (no STOCK_CENSUS)', res['_lists']['g1b'],
        res['breach_g2'], res['_lists']['g2'], res['breach_g3_row'], res['_lists']['g3'], res['breach_g3v_row'], res['_lists']['g3v']))
    if journal is not None:
        print('JOURNAL      G3 %d %s | G4 %d %s | G4 overlapping (tripwire) %d | valve claims %d (rows %d) | resets %d | towns %d | generations %s | live > 1 h %s | unreadable %s' % (
            len(jr['g3']), jr['g3'][:2], len(jr['g4']), jr['g4'][:2], len(jr['g4_overlap']), len(jr['valve']), res['valve_uses'], len(jr['resets']),
            len(jr['towns']), jr['generations'], jr['live_over_1h'], jr['unreadable']))
    else:
        print('JOURNAL      UNREADABLE: the G3/G4 journal gates are blind this read')
    print('EXPOSURE     canary stock actions: refusals %d + dispose clicks %d + prune clicks %d + bank rows %d | instrument (control runs that banked a targeted group) %d'
          % (res['refusals_canary'], res['dispose_clicks'], res['prune_clicks'], res['bank_rows'], res['instrument_control']))
    adm = jr.get('admitted', {}) if journal is not None else {}
    print('UNTESTED     (a gate with no exposure is UNTESTED, never "0 breaches"): G3 %s (admitted bank claims %s) | G4 %s (admitted takes %s) | G1b %s | stonecap C1-C5 cobble banking %s (admitted cobble bank claims %s)'
          % ('tested' if adm.get('bank') else 'UNTESTED', adm.get('bank', 'n/a'), 'tested' if adm.get('take') else 'UNTESTED', adm.get('take', 'n/a'),
             'tested' if res['g1b_tested'] else 'UNTESTED', 'tested' if jr.get('admitted_cobble_bank') else 'UNTESTED', jr.get('admitted_cobble_bank', 'n/a')))
    # DIFFERENCE-IN-DIFFERENCES (Codex code r1 P2: post minus post was not one): per bot-hour, (post - pre) canary minus control
    did = lambda key: (rate(res[key + '_canary'], 'post', 'canary') - rate(res[key + '_pre_canary'], 'pre', 'canary')) - (rate(res[key + '_control'], 'post', 'control') - rate(res[key + '_pre_control'], 'pre', 'control'))
    bd, fd = did('banked'), did('fullfail')
    share = nopick.share
    nopick_did = (share('post', 'canary') - share('pre', 'canary')) - (share('post', 'control') - share('pre', 'control'))
    print('TRIPWIRE     the accepted residual (design 3.6): share of BOT-MINUTES a pickaxe-less bag holds >= 34 occupied slots (lower bound) canary %.4f -> %.4f control %.4f -> %.4f DiD %+.4f | bot-minutes canary %d/%d control %d/%d'
          % (share('pre', 'canary'), share('post', 'canary'), share('pre', 'control'), share('post', 'control'), nopick_did,
             nopick.minutes('pre', 'canary'), nopick.minutes('post', 'canary'), nopick.minutes('pre', 'control'), nopick.minutes('post', 'control')))
    print('PRUNE        visits %s | candidate stacks the well would keep (not taken) %d | clicks %d' % (res['prune_visits'], res['prune_well_keeps'], res['prune_clicks']))
    print('REPORTED     targeted items banked/bot-h DiD %+.2f | chest-full failures/bot-h DiD %+.3f (post canary %d control %d) | valve %d | nowell %d | recovery place ok %d refused %d'
          % (bd, fd, res['fullfail_canary'], res['fullfail_control'], res['valve_uses'], res['nowell_rows'], res['recovery_place_ok'], res['recovery_refused']))
    exposure = int((res['refused_rows'] + res['refusals_canary'] + res['dispose_clicks'] + res['prune_clicks'] + res['bank_rows']) >= 10 and res['instrument_control'] >= 1)
    print('EXPOSURE     -> %s' % ('READY' if exposure else 'NOT YET'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('stocktargetread', W, {
            # own rows only (Codex fold-r1 P3: the liveness field is what its name says); sentences apart
            'rows_canary': res['rows_canary'], 'rows_live': res['rows_live'], 'refusal_sentences': res['refusals_canary'], 'rows_control': res['rows_control'],
            'refused_at_cobble': res['refused_at_cobble'], 'refused_at_stock': res['refused_at_stock'],
            'breach_g1': res['breach_g1'], 'breach_g1b': res['breach_g1b'], 'g1b_tested': res['g1b_tested'], 'breach_g2': res['breach_g2'],
            'breach_g3_row': res['breach_g3_row'], 'breach_g3v_row': res['breach_g3v_row'],
            'journal_audit_ran': int(journal is not None),
            'breach_g3_journal': len(jr.get('g3', [])) if journal is not None else 0,
            # stonecap's C5 (journal), judged by the canary's own generation-aware fold (stonecapread's hand-rolled fold
            # predates the groups and kinds: fold-r1 P2-3); UNTESTED while no cobble bank claim is admitted
            'breach_c5_cobble_journal': sum(1 for g in jr.get('g3', []) if g.get('g') == 'cobble') if journal is not None else 0,
            'admitted_cobble_bank': jr.get('admitted_cobble_bank', 0), 'c5_tested': int(bool(jr.get('admitted_cobble_bank'))),
            # (the claim's own proof, not the row text -- Claude code r1 P3)
            'breach_g3v_journal': int(journal is not None and (len(jr.get('valve', [])) > res['valve_uses'] or any(v.get('proof') != 'nothing_else' for v in jr.get('valve', [])))),
            'breach_g4_journal': len(jr.get('g4', [])) if journal is not None else 0,
            'tripwire_g4_overlap': len(jr.get('g4_overlap', [])) if journal is not None else 0,
            'g3_tested': int(bool(adm.get('bank'))), 'g4_tested': int(bool(adm.get('take'))),
            'admitted_bank': adm.get('bank', 0), 'admitted_take': adm.get('take', 0), 'admitted_draw': adm.get('draw', 0),
            'refused_rows': res['refused_rows'], 'refused_cobble_rows': res['refused_cobble_rows'],
            'instrument_control': res['instrument_control'], 'dispose_clicks': res['dispose_clicks'], 'prune_clicks': res['prune_clicks'],
            'bank_rows': res['bank_rows'], 'valve_uses': res['valve_uses'], 'nowell_rows': res['nowell_rows'],
            'banked_did': clean(bd), 'fullfail_did': clean(fd), 'nopick_full_did': clean(nopick_did), 'fullfail_canary': res['fullfail_canary'], 'fullfail_control': res['fullfail_control'],
            'exposure_ready': exposure,
        })
    except Exception as e:
        print('emit failed:', e)
