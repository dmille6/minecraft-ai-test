#!/usr/bin/env python3
# kitshrinkread.py [window_min] -- the read for canary `kitshrink-01` (bots/src/kitshrink.mjs; owner 10-16 ~16:30Z "yes shrink").
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). KITSHRINKREAD_SELFTEST=1 runs the self-tests only.
#
# THE CHANGE: torches, and ladders BELOW THE LADDER ESCAPE'S MINIMUM (26: ladder.mjs ladderPlan for the climb_ladder rung's
# 25-block climb), became bankable (bankable.mjs bankableInventory), so the town deposit (in town, >= 34 slots), the deposit
# verb near storage and withdraw's room-making take them out of the bag. The kit alone never walks a bot anywhere
# (depositDue drops its share without storage in reach; the craft room order's far branch keeps it). Stations, the bucket
# and chests are unchanged (the tech ladder's rungs are satisfied by HOLDING them; the carried chest is the full-town
# recovery's remedy). Rows only this build writes, kind `_kitshrink`:
#   phase=mode   once per spawn: the licence
#   phase=bank   the town deposit, whenever the bag held kit at the start: `name=before:banked` for torch, ladder and the
#                three KEEP_ONE names -- START counts (the skill's heldBefore) and what the SERVER showed in the chest.
#                Bounded and first: the town_deposit row sorts `banked` by count and cuts at 300 (design reviews r2).
#
# DENOMINATORS FIRST: rows walked, bots and bot-h per arm and period, before any number.
#   PRIMARY (reported)  kit_slots_did: time-weighted torch+ladder slots per bot, DiD (canary POST-PRE minus control POST-PRE;
#                       negative = emptier); slots_did: all bag slots, the same estimator (bagread.py's, restated);
#                       leave_free_did: FREE SLOTS AT WORK START = 36 - the bag on the first row with a position OUTSIDE town
#                       after a stay (one or more consecutive in-town rows with a bag; town = 16 h / 12 v of home,
#                       towndeposit.mjs inTownZone; homes from the harness env files), DiD of per-stay means, emitted only
#                       with >= MIN_LEAVES departures in each of the four arm x period cells (else null).
#                       SLOTS ARE A PROXY: ceil(count / stack) per name, a LOWER bound on slots used (free is an UPPER
#                       bound), and the change removes whole stacks, so the bias need not be equal across arms; the bank
#                       rows' exact slots before->after are the transfer-local check (reported).
#                       Skill rows are retimed to completion (start + duration_ms); events are instantaneous.
#   LIVENESS/EXPOSURE   canary bank rows that banked a kit item: >= 3 rows from >= 2 canary bots (exposure_ready).
#   DEFECTS (REVERT)    D1 a canary bank row that banked ladders from a bag that STARTED with >= 26;
#                       D2 TRIPWIRE: a canary bank row that banked every crafting_table / furnace / bucket the bag started
#                       with (KEEP_ONE is unchanged code; guarded because the change edits the function that enforces it);
#                       D3 a canary room order of kind=home naming a kit item (the far branch must keep the kit).
#   ARMS                control `_kitshrink` rows 0 (leak; blocks KEEP); canary rows from another build skipped and counted.
#   INSTRUMENT          control bots whose latest bag holds a kit item (>= 1): the population exists and the query sees it.
#   GUARDS (reported)   the TOWN-SIDE COST (the change moves kit into town containers): `_deposit_new_chest` rows per bot-h
#                       by decision, and town deposits whose every tried container answered full per bot-h (only rows whose
#                       container list is complete -- coverage reported, a cut row is unknown, never "not full"), DiD;
#                       room orders kind=home per bot-h DiD (expected unchanged); deposit runs stopped as kit-only per bot-h
#                       (a model-driven loop); kit re-acquisition per bot-h, crafts and
#                       pickups separately, DiD; the deposit verb's and withdraw's NET kit moves (inventory_delta), reported.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict

KIT = ('torch', 'ladder')
STATIONS = ('crafting_table', 'furnace', 'bucket')
LADDER_ESCAPE_MIN = 26          # ladder.mjs ladderEscapeMin(LADDER_CLIMB_NEED = 25); kitshrink.test.mjs asserts the bot's value
OTHER_BANKERS = ('deposit', 'withdraw_pick')
BAG = 36
TOWN_H, TOWN_V = 16, 12
CAP_S = 120.0
MIN_LEAVES = 10
DETAIL_CAP = 300

# ---- the slot estimator (bagread.py's, restated: each read is a standalone file the loop copies to /tmp) ---------------
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')


def stack(n):
    return 1 if ONE.search(n) else 16 if SIXTEEN.search(n) else 64


def nslots(c, n):
    return c if stack(n) == 1 else -(-c // stack(n))


def bag_vector(inv):
    """(all slots, kit slots) of one bag ({name: count}). Pure."""
    items = [(n, c) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0]
    return (sum(nslots(c, n) for n, c in items), sum(nslots(c, n) for n, c in items if n in KIT))


def accrue(rows, cut, tw, arm, end=None):
    """One bot's [(t, bag_vector or None, ok)] sorted -> tw[(period, arm)] += [sec, slot-sec, kit-slot-sec]. The bag last
    OBSERVED holds to the next row, never more than CAP_S past the previous row nor past its own observation + CAP_S; a row
    with ok=False (another build) accrues nothing and breaks the chain. Pure."""
    prev_t = prev = inv_t = None
    for t, bv, ok in rows:
        if end is not None and t > end:
            t = end
        if not ok:
            prev_t = prev = inv_t = None
            continue
        if prev_t is not None and prev is not None and t > prev_t:
            stop = min(t, prev_t + dt.timedelta(seconds=CAP_S), inv_t + dt.timedelta(seconds=CAP_S))
            if stop > prev_t:
                parts = [(prev_t, stop)] if (stop <= cut or prev_t >= cut) else [(prev_t, cut), (cut, stop)]
                for x, y in parts:
                    d = (y - x).total_seconds()
                    if d > 0:
                        a = tw[('pre' if x < cut else 'post', arm)]
                        a[0] += d; a[1] += d * prev[0]; a[2] += d * prev[1]
        prev_t = t
        if bv is not None:
            prev = bv; inv_t = t
        if end is not None and t >= end:
            break


def did(tw, i):
    per = lambda k: tw[k][i] / tw[k][0] if tw[k][0] else float('nan')
    return (per(('post', 'canary')) - per(('pre', 'canary'))) - (per(('post', 'control')) - per(('pre', 'control')))


def in_town(pos, home):
    if not pos or not home or pos.get('x') is None or pos.get('z') is None:
        return None
    if ((pos['x'] - home['X']) ** 2 + (pos['z'] - home['Z']) ** 2) ** 0.5 > TOWN_H:
        return False
    return 'Y' not in home or pos.get('y') is None or abs(pos['y'] - home['Y']) <= TOWN_V


BREAK = object()


def leaves(seq, home):
    """One bot's [(t, pos, inv)] sorted -> [(t, free slots)] at the first row OUTSIDE town after an in-town row with a bag.
    Rows without a position or a bag are skipped (never a departure). Pure."""
    out, was_in = [], False
    for t, pos, inv in seq:
        if pos is BREAK:              # another build's row: no departure spans it (Codex code r1 P2-3)
            was_in = False
            continue
        z = in_town(pos, home)
        if z is None or inv is None:
            continue
        if z:
            was_in = True
        elif was_in:
            out.append((t, BAG - bag_vector(inv)[0])); was_in = False
    return out


def kv(d):
    return {m.group(1): m.group(2) for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or '')}


def bank_row(detail):
    """A `_kitshrink phase=bank` row -> ({name: (before, banked)}, slots 'a->b') or None for another phase. Pure."""
    f = kv(detail)
    if f.get('phase') != 'bank':
        return None
    out = {}
    for n in KIT + STATIONS:
        b, _, k = (f.get(n) or '').partition(':')
        if b.isdigit() and k.isdigit():
            out[n] = (int(b), int(k))
    return out, f.get('slots')


def bank_check(counts):
    """A bank row's {name: (before, banked)} -> (kit banked {name: n}, defects [names]). Pure."""
    kit = {n: counts[n][1] for n in KIT if n in counts and counts[n][1] > 0}
    d = []
    if kit.get('ladder') and counts['ladder'][0] >= LADDER_ESCAPE_MIN:
        d.append('D1_escape_ladders_banked')
    for s in STATIONS:
        b, k = counts.get(s, (0, 0))
        if b >= 1 and k >= b:
            d.append('D2_last_%s_banked' % s); break
    return kit, d


def td_all_full(detail):
    """Did every container this town deposit tried answer `full`? -> True / False / None (the list was cut: unknown). Pure."""
    d = detail or ''
    m = re.search(r' containers (\S+)$', d)
    if len(d) >= DETAIL_CAP or not m:
        return None
    if m.group(1) == '-':
        return False
    res = [p.rpartition('=')[2] for p in m.group(1).split(';') if p]
    return bool(res) and all(r == 'full' for r in res)


def pickups(detail):
    """A `_pickups` row -> [(name, count)] (pickuplog.mjs formatPickups: `name count source mode; ... | N items in M pickups`). Pure."""
    head = (detail or '').split(' | ')[0]
    return [(m.group(1), int(m.group(2))) for m in re.finditer(r'(?:^|; )([a-z_]+) (\d+) [^\s;]+ [^\s;]+', head)]


TD_MIN_COMPLETE = 10
TD_MIN_SHARE = 0.8


def td_coverage_ok(cov):
    """td_all_full_did is emitted only when every arm x period cell has >= TD_MIN_COMPLETE town_deposit rows whose container list
    is complete and they are >= TD_MIN_SHARE of the cell (a cut list is unknown, never "not full"). Pure."""
    for a in ('canary', 'control'):
        for p in ('pre', 'post'):
            c, u = cov.get((a, p, 'complete'), 0), cov.get((a, p, 'unknown'), 0)
            if c < TD_MIN_COMPLETE or c < TD_MIN_SHARE * (c + u):
                return False
    return True


def room_home_kit(detail):
    """A `_room_order` row sending the bot home to bank a kit item (kind=home item=<kit>)? Pure (cognitive.mjs room_order)."""
    f = kv(detail)
    return f.get('kind') == 'home' and f.get('item') in KIT


# ---- positive controls, asserted at every run ------------------------------------------------------------------------
assert bag_vector({'torch': 65, 'chest': 7, 'ladder': 3, 'stone_pickaxe': 2, 'egg': 17}) == (2 + 1 + 1 + 2 + 2, 3)
_T = lambda m: dt.datetime(2026, 10, 16, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=m)
_tw = defaultdict(lambda: [0.0, 0.0, 0.0])
accrue([(_T(0), (34, 3), True), (_T(1), (34, 3), True), (_T(2), (31, 0), True), (_T(3), (31, 0), True)], _T(2), _tw, 'canary')
accrue([(_T(0), (34, 3), True), (_T(1), (34, 3), True), (_T(2), (34, 3), True), (_T(3), (34, 3), True)], _T(2), _tw, 'control')
assert abs(did(_tw, 1) - (-3)) < 1e-9 and abs(did(_tw, 2) - (-3)) < 1e-9, dict(_tw)
_tw2 = defaultdict(lambda: [0.0, 0.0, 0.0])
accrue([(_T(0), (5, 0), True), (_T(1), (50, 2), False), (_T(2), (5, 0), True), (_T(3), (5, 0), True)], _T(0), _tw2, 'canary')
assert _tw2[('post', 'canary')][0] == 60.0, 'another build accrues nothing and breaks the chain'
_h = {'X': 0, 'Y': 70, 'Z': 0}
assert leaves([(_T(0), {'x': 100, 'y': 70, 'z': 0}, {'dirt': 64}), (_T(1), {'x': 3, 'y': 70, 'z': 0}, {'dirt': 64}),
               (_T(2), {'x': 2, 'y': 70, 'z': 0}, {'dirt': 64}), (_T(2.5), None, {'dirt': 1}),
               (_T(3), {'x': 40, 'y': 70, 'z': 0}, {'dirt': 64, 'torch': 3})], _h) == [(_T(3), 34)]
assert in_town({'x': 16, 'y': 70, 'z': 0}, _h) is True and in_town({'x': 16.1, 'y': 70, 'z': 0}, _h) is False and in_town({'x': 0, 'y': 83, 'z': 0}, _h) is False
_B = 'phase=bank via=town_deposit torch=4:4 ladder=3:3 crafting_table=1:0 furnace=1:0 bucket=1:0 slots=35->33'
assert bank_row(_B) == ({'torch': (4, 4), 'ladder': (3, 3), 'crafting_table': (1, 0), 'furnace': (1, 0), 'bucket': (1, 0)}, '35->33')
assert bank_row('phase=mode on=1 mode=on kit=torch,ladder ladder_min=26') is None
assert bank_check(bank_row(_B)[0]) == ({'torch': 4, 'ladder': 3}, [])
assert bank_check({'ladder': (26, 26)}) == ({'ladder': 26}, ['D1_escape_ladders_banked'])
assert bank_check({'ladder': (25, 25)}) == ({'ladder': 25}, []), '25 is below the escape minimum'
assert bank_check({'ladder': (30, 0)}) == ({}, []), 'held 30 and kept them: no defect'
assert bank_check({'crafting_table': (1, 1)}) == ({}, ['D2_last_crafting_table_banked'])
assert bank_check({'crafting_table': (2, 1)}) == ({}, []), 'a spare copy is not the last'
assert bank_check({'torch': (0, 0), 'ladder': (5, 0)}) == ({}, []), 'held kit, banked none: no exposure'
_TD = 'slots 35->32 stacks 3/3 clicked 3 bagdelta 15 tools - banked oak_log:8,torch:4 stop done containers 1,64,2=took;3,64,2=full'
assert td_all_full(_TD) is False and td_all_full('banked - stop done containers 1,64,2=full;3,64,2=full') is True
assert td_all_full(('x' * 280) + ' containers 1,64,2=full') is None, 'a row at the 300 cap is unknown, never full or not'
assert td_all_full('banked - stop nothing to bank above the keeps containers -') is False
assert pickups('dirt 5 home passive; ladder 1 reflex:escape passive | 6 items in 6 pickups in 60s') == [('dirt', 5), ('ladder', 1)]
assert pickups('torch 2 mine:y64 passive | 2 items in 2 pickups in 60s; +1 groups (3 items) not shown') == [('torch', 2)]
_cov = {(a, p, 'complete'): 12 for a in ('canary', 'control') for p in ('pre', 'post')}
assert td_coverage_ok(_cov) and not td_coverage_ok({**_cov, ('canary', 'post', 'unknown'): 4}) and not td_coverage_ok({**_cov, ('control', 'pre', 'complete'): 9})
assert not td_coverage_ok({(a, p, 'unknown'): 50 for a in ('canary', 'control') for p in ('pre', 'post')}), 'an all-truncated population is not a zero'
_h2 = {'X': 0, 'Y': 70, 'Z': 0}
assert leaves([(_T(0), {'x': 2, 'y': 70, 'z': 0}, {'dirt': 1}), (_T(1), BREAK, None), (_T(2), {'x': 40, 'y': 70, 'z': 0}, {'dirt': 1})], _h2) == [], 'no departure across another build'
assert leaves([(_T(0), {'x': 2, 'y': 70, 'z': 0}, {'dirt': 1}), (_T(2), {'x': 40, 'y': 70, 'z': 0}, {'dirt': 1})], _h2) == [(_T(2), 35)], 'the same departure, uninterrupted'
assert room_home_kit('kind=home item=torch craft=stone_pickaxe') and not room_home_kit('kind=home item=oak_log craft=x') \
    and not room_home_kit('kind=deposit item=torch craft=x') and not room_home_kit('kind=home item=- craft=x')

if os.environ.get('KITSHRINKREAD_SELFTEST'):
    print('kitshrinkread self-tests passed')
    sys.exit(0)

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


def load_window(since, until):
    """Rotation-aware (toolkitread's): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z copytruncate."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    out, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen:
            out.append(r); seen.add(key(r))
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


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


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


HOME = homes()
rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
per_bot = defaultdict(list); pos_seq = defaultdict(list)
mode_rows = Counter(); ctrl_rows = 0; offbuild = 0; botsets = defaultdict(set)
banks = []; defects = Counter(); dex = []; banked_tot = Counter(); bank_bots = set(); bank_slots = []
guard = Counter(); ctl = Counter(); td_cov = Counter(); ladder_min_seen = set(); other_moves = Counter(); last_bag = {}
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name') or ''; raw = r.get('raw') or {}; sk = raw.get('skill') or {}
    det = sk.get('detail') or r.get('detail') or ''
    st = sk.get('status') or r.get('status')
    ver = ((raw.get('code') or {}).get('version') or '')
    if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
        offbuild += 1
        per_bot[b].append((t, None, False)); pos_seq[b].append((t, BREAK, None)); continue
    botsets[(arm, period)].add(b)
    inv = (raw.get('bot') or {}).get('inventory')
    inv = inv if isinstance(inv, dict) else None
    dur = sk.get('duration_ms')
    te = t + dt.timedelta(milliseconds=dur) if (not k.startswith('_') and isinstance(dur, (int, float)) and 0 < dur < 6 * 3600 * 1000) else t
    per_bot[b].append((te, bag_vector(inv) if inv is not None else None, True))
    pos_seq[b].append((te, (raw.get('bot') or {}).get('pos'), inv))
    if inv is not None and period == 'post':
        last_bag[b] = inv
    if k == '_kitshrink' and period == 'post':
        if arm == 'control':
            ctrl_rows += 1
            continue
        br = bank_row(det)
        if br is None:
            m = re.search(r'on=(\d)', det)
            mode_rows[m.group(1) if m else '?'] += 1
            lm = re.search(r'ladder_min=(\d+)', det)
            if lm:
                ladder_min_seen.add(int(lm.group(1)))
            continue
        kit, d = bank_check(br[0])
        if kit:
            banks.append((b, t, kit)); bank_bots.add(b)
            for n, v in kit.items():
                banked_tot[n] += v
            bank_slots.append(br[1])
        for g in d:
            defects[g] += 1
            if len(dex) < 5:
                dex.append((b, str(t)[:19], g, det[:160]))
    if k == '_room_order':
        guard[(arm, period, 'room_home')] += int(kv(det).get('kind') == 'home')
        if arm == 'canary' and period == 'post' and room_home_kit(det):
            defects['D3_far_trip_for_kit'] += 1
            if len(dex) < 5:
                dex.append((b, str(t)[:19], 'D3_far_trip_for_kit', det[:160]))
    if k == 'deposit' and 'town deposit takes them' in det:   # the kit-only refusal at execution (a model-driven loop would show)
        guard[(arm, period, 'kit_noop')] += 1
    if k == '_deposit_new_chest':
        dm = re.search(r'decision=(\w+)', det)
        guard[(arm, period, 'new_chest:%s:%s' % (dm.group(1) if dm else '?', st))] += 1
    if k == '_town_deposit':   # the EVENT row (townDepositDetail); `town_deposit` is the skill's prose
        full = td_all_full(det)
        td_cov[(arm, period, 'unknown' if full is None else 'complete')] += 1
        if full:
            guard[(arm, period, 'td_all_full')] += 1
    if k == 'craft' and st == 'success':
        ctl[(arm, period, 'craft')] += 1                       # positive control: the instrument sees crafts at all
        if (sk.get('args') or {}).get('item') in KIT:
            guard[(arm, period, 'reacq_craft')] += 1
    if k == '_pickups':
        for name, cnt in pickups(det):
            ctl[(arm, period, 'pickup')] += cnt                # positive control: the parser sees pickups at all
            if name in KIT:
                guard[(arm, period, 'reacq_pickup')] += cnt
    if k in OTHER_BANKERS and period == 'post':
        for n in KIT:
            v = (sk.get('inventory_delta') or {}).get(n)
            if isinstance(v, (int, float)) and v < 0:
                other_moves[(arm, k, n)] += -int(v)

tw = defaultdict(lambda: [0.0, 0.0, 0.0])
for b, seq in per_bot.items():
    seq.sort(key=lambda x: x[0])
    accrue(seq, CUT, tw, 'canary' if pool_of(b) in CANS else 'control', END)
lv = defaultdict(list); nohome = 0
for b, seq in pos_seq.items():
    h = HOME.get(b)
    if not h:
        nohome += 1; continue
    seq.sort(key=lambda x: x[0])
    for t, free in leaves(seq, h):
        if t <= END:
            lv[('post' if t >= CUT else 'pre', 'canary' if pool_of(b) in CANS else 'control')].append(free)
mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
cells = [('pre', 'canary'), ('post', 'canary'), ('pre', 'control'), ('post', 'control')]
leave_ok = all(len(lv[c]) >= MIN_LEAVES for c in cells)
leave_did = (mean(lv[('post', 'canary')]) - mean(lv[('pre', 'canary')])) - (mean(lv[('post', 'control')]) - mean(lv[('pre', 'control')]))
inst = sum(1 for b, inv in last_bag.items() if pool_of(b) not in CANS and any((inv.get(n) or 0) > 0 for n in KIT))
bh = {k: round(v[0] / 3600, 1) for k, v in tw.items()}
perh = lambda c, arm, per: c / (tw[(per, arm)][0] / 3600) if tw[(per, arm)][0] else float('nan')


def gdid(key):
    return (perh(guard[('canary', 'post', key)], 'canary', 'post') - perh(guard[('canary', 'pre', key)], 'canary', 'pre')) - \
           (perh(guard[('control', 'post', key)], 'control', 'post') - perh(guard[('control', 'pre', key)], 'control', 'pre'))


def gline(key):
    return '%s per bot-h canary %.3f -> %.3f control %.3f -> %.3f DiD %+.4f' % (key,
        perh(guard[('canary', 'pre', key)], 'canary', 'pre'), perh(guard[('canary', 'post', key)], 'canary', 'post'),
        perh(guard[('control', 'pre', key)], 'control', 'pre'), perh(guard[('control', 'post', key)], 'control', 'post'), gdid(key))


exposure = int(len(banks) >= 3 and len(bank_bots) >= 2)
td_ok = td_coverage_ok(td_cov)
nchest = sorted({k[2] for k in guard if k[2].startswith('new_chest:')})

print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  homes %d (bots without one %d)' % (
    len(rows), sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W, len(HOME), nohome))
print('DENOMINATORS bots %s | bot-h %s | town departures %s' % (
    {'%s/%s' % (a, p): len(s) for (a, p), s in sorted(botsets.items())}, {'%s/%s' % (p, a): v for (p, a), v in sorted(bh.items())},
    {'%s/%s' % k: len(v) for k, v in sorted(lv.items())}))
print('-' * 78)
for name, i in (('slots', 1), ('kit_slots', 2)):
    per = lambda k: tw[k][i] / tw[k][0] if tw[k][0] else float('nan')
    print('PRIMARY      %-10s canary %.2f -> %.2f  control %.2f -> %.2f  DiD %+.3f' % (
        name, per(('pre', 'canary')), per(('post', 'canary')), per(('pre', 'control')), per(('post', 'control')), did(tw, i)))
print('PRIMARY      free slots at work start (an upper bound): canary %.2f -> %.2f  control %.2f -> %.2f  DiD %+.3f%s' % (
    mean(lv[('pre', 'canary')]), mean(lv[('post', 'canary')]), mean(lv[('pre', 'control')]), mean(lv[('post', 'control')]), leave_did,
    '' if leave_ok else '  (NOT EMITTED: < %d departures in a cell)' % MIN_LEAVES))
print('LIVENESS     canary bank rows with kit banked %d from %d bots (exposure >= 3 rows / 2 bots: %d) | banked %s | mode rows %s' % (
    len(banks), len(bank_bots), exposure, dict(banked_tot), dict(mode_rows)))
print('             exact slots on those rows: %s' % (bank_slots[:12] or '-'))
print('ARMS         control _kitshrink rows %d (must be 0) | other-build canary rows %d' % (ctrl_rows, offbuild))
print('DEFECTS      %s (all must be 0) | ladder_min on the bots %s (this read assumes %d%s)' % (
    dict(defects) or 0, sorted(ladder_min_seen) or '-', LADDER_ESCAPE_MIN, '' if ladder_min_seen <= {LADDER_ESCAPE_MIN} else ' -- MISMATCH: D1 is blind'))
print('INSTRUMENT   control bots holding a kit item at their last row: %d (>= 1)' % inst)
print('GUARDS       ' + gline('room_home'))
print('             ' + gline('td_all_full') + ' | town_deposit rows complete/unknown %s%s' % ({'%s/%s/%s' % k: v for k, v in sorted(td_cov.items())},
    '' if td_ok else ' (COVERAGE TOO LOW: not emitted)'))
for key in nchest:
    print('             ' + gline(key))
print('             positive controls: all craft successes %s | all items picked up %s' % (
    {'%s/%s' % k[:2]: v for k, v in sorted(ctl.items()) if k[2] == 'craft'}, {'%s/%s' % k[:2]: v for k, v in sorted(ctl.items()) if k[2] == 'pickup'}))
print('             ' + gline('kit_noop') + '  (deposit runs stopped as kit-only: a model loop would show here)')
print('             ' + gline('reacq_craft'))
print('             ' + gline('reacq_pickup'))
print('             net kit moves by the deposit verb / withdraw (post, reported): %s' % ({'%s/%s/%s' % k: v for k, v in sorted(other_moves.items())} or '-'))
for x in dex:
    print('  defect:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    nan = lambda x: None if x != x else round(x, 4)
    emit('kitshrinkread', W, {
        'kit_slots_did': nan(did(tw, 2)), 'slots_did': nan(did(tw, 1)), 'leave_free_did': nan(leave_did) if leave_ok else None,
        'kit_banks_canary': len(banks), 'kit_bank_bots_canary': len(bank_bots), 'exposure_ready': exposure,
        'd1_escape_ladders_banked': defects['D1_escape_ladders_banked'],
        'd2_last_station_banked': sum(v for g, v in defects.items() if g.startswith('D2_')),
        'd3_far_trip_for_kit': defects['D3_far_trip_for_kit'],
        'rows_control': ctrl_rows, 'offbuild_canary': offbuild, 'instrument_control': inst,
        'mode_rows_canary': sum(mode_rows.values()),
        'room_home_did': nan(gdid('room_home')), 'td_all_full_did': nan(gdid('td_all_full')) if td_ok else None,
        'td_rows_complete': sum(v for k, v in td_cov.items() if k[2] == 'complete'), 'td_rows_unknown': sum(v for k, v in td_cov.items() if k[2] == 'unknown'),
        'ladder_min_mismatch': int(bool(ladder_min_seen - {LADDER_ESCAPE_MIN})),
        'reacq_craft_did': nan(gdid('reacq_craft')), 'kit_noop_did': nan(gdid('kit_noop')), 'reacq_pickup_did': nan(gdid('reacq_pickup')),
        'canary_bot_h_post': round(tw[('post', 'canary')][0] / 3600, 2), 'control_bot_h_post': round(tw[('post', 'control')][0] / 3600, 2),
        'rows': len(rows),
    })
except Exception as e:
    print('emit failed:', e)
