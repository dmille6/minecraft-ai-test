#!/usr/bin/env python3
# peacefulkitread.py [window_min] | --selftest -- the read for canary `peacefulkit-01` (branch pk-on-c6e91a8; pk-on-92bc84f if
# the fleet moves to towndeposit). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/peacefulkit.mjs, under the peaceful food policy's ONE switch, foodskip.mjs FOOD_SKIP auto|on|off,
# default auto = active while the server's difficulty packet says peaceful):
#   SWORDS  (OWNER 10-07 ~19:50Z revision) never crafted, never walked to, and NEVER BANKED while active (not even a
#           spare: "no reason to store swords at all"). A smelt that is ALREADY happening burns carried WOODEN swords
#           first (one per item; `_sword_fuel` row each; the switch re-read before each); stone swords stay in the bag.
#   COMPOST the town composter also takes the kit's plants (36 names incl. dried_kelp, glow_berries, moss_carpet,
#           firefly_bush, bush, bread; each consumed by a real Paper 1.21.8 composter), WHOLE; oak and birch saplings
#           keep 16, every other species none (while active); apples above 4. The order counts the real surplus after
#           every reserve and only when a fill can start (always). `_compost` rows carry args.items and args.peaceful.
#   ROW     one `_peaceful_kit` row per process per change of (decision, difficulty): "peaceful kit ON: ... active=1".
#
# EVERY GATE IS A NAMED PREDICATE, AND ITS INSTRUMENT RUNS THE SAME PREDICATE (Codex review r1): the instrument proves the
# predicate fires on rows the CONTROL arm produces in the same window; --selftest proves each predicate on fixtures.
#   LIVENESS     canary `_peaceful_kit` active=1 rows (>= 1); control 0.
#   K0 MODE        a canary kit row with difficulty=peaceful and active=0, or mode != auto.
#   K1 CRAFT       crafted(row, SWORD): a `craft` row whose REQUESTED item is a sword, status success, and the delta shows
#                  that item gained -- from a canary bot whose latest kit row said active=1. (A passive pickup during some
#                  other craft is not a craft.)  INSTRUMENT: crafted(row, TOOL) on control rows.
#   K2 LOST        Ledger(SWORD) per canary bot: every fall in a snapshot is PENDING until explained -- by a bank row
#                  (deposit / town_deposit) whose run interval [start - 5 s, end + 1 s] contains it and whose delta shows the
#                  same name leaving; by a CONFIRMED burn (a `_sword_fuel` 'burned' row: the slot emptied while the furnace
#                  burned) within the 60 s before it, or a 'left in the furnace' row (bag full, never tossed); -- a smelt
#                  row's own delta is NOT a credit (Codex r-rev1: it would hide a dropped or vanished sword); by a death (a fall within -5..+180 s of `_death`); or by a rise of the same
#                  name within 120 s (a snapshot blip). A rise later than that is an acquisition and never cancels a loss.
#                  An empty inventory snapshot is unknown (a reconnect), never a fall. Pending falls in the last 300 s of the
#                  window are UNRESOLVED (reported). Breach: canary lost >= 1 AND its per-bot-hour rate > the control's
#                  (the same ledger on control swords), plus any `_compost` row that composted a sword.
#                  INSTRUMENT: Ledger(PICKAXE) on control bots -- falls the BANK reconciliation explained (>= 1).
#   K3 BANKED      took(row, SWORD): a bank row (deposit / town_deposit) whose delta shows ANY sword leaving, from a canary
#                  bot whose latest kit row said active=1 -- must be 0 (owner: swords are never stored in a peaceful world).
#                  A bank row whose run [start - 5 s, end + 5 s] holds a `_death` of that bot is excluded and counted
#                  (a death's loss shows in the run's delta; Claude r-rev1).
#                  INSTRUMENT: took(row, TOOL) on control bank rows (the base banks spare tool copies every hour).
#   K7 BURN OFF    sword_burn(row): a CONFIRMED burn row whose OWN active= (the switch read at the put, which is the burn: a
#                  sword only goes into a cold furnace) is 0 -- must be 0. Judged per burn, never from a smelt's aggregate
#                  delta against a later switch state (Codex r-rev1). INSTRUMENT: burned_fuel(row) on control smelt rows --
#                  ordinary fuel consumed that is NOT the job's input (a log->charcoal job's logs never count). SAME-
#                  PREDICATE CONTROL (reported): canary confirmed burns with active=1. REPORTED: swords burned, smelts.
#   K4 RESERVES    reserve_breaches(items, inv, active): a sapling species composted and fewer left than its reserve (oak and
#                  birch 16; while active every other species 0, off 16), or apples composted and < 4 left, at END. Breach: canary >= 1 AND its rate > the control's (the same predicate on control
#                  rows: the base composts saplings and, under the food policy, apples).  INSTRUMENT: control compost rows
#                  on which the predicate was evaluated (a sapling or apple composted).
#   K5 OFF MEANS OFF  composted_in(items, KIT) on a canary row whose kit row was not active=1 (or args.peaceful == 0), or on
#                  ANY control row.  INSTRUMENT: composted_in(items, BASE + saplings + apple) on control rows.
#   K6 ONLY THE LIST  off_list(items, BASE + KIT + saplings + apple) on a canary row.  INSTRUMENT: off_list(items, BASE) on
#                  control rows (finds the APPLES the base composts under the food policy; off_list always allows saplings).
#   EXPOSURE     liveness AND X2 >= 3 canary BOTS that composted a kit plant (verified inserts). The sword half has no
#                exposure gate: it is a set of deterministic tripwires (K1 K3 K7) plus the reported burns. Reads at
#                +180/+360 and extension reads until exposure (deadline -> INCONCLUSIVE); see the registration.
#   TRIPWIRES    swords SOUGHT by the sweep (`_pickups` summary), deaths (named; the two-death floor is canary-report.py's),
#                hunger < 20 snapshots (a world that is not peaceful), UNRESOLVED ledger falls.
#   PRIMARY      (REPORTED, never gated) time-weighted per bot (gaps capped at 120 s), DiD vs the same-length pre-window:
#                sword slots/bot, kit-plant slots/bot, plant+food slots/bot, all slots/bot, share at >= 34 slots.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict

KIT = {'melon_slice', 'kelp', 'brown_mushroom', 'red_mushroom', 'cocoa_beans', 'sweet_berries', 'torchflower_seeds', 'pitcher_pod',
       'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
       'lily_of_the_valley', 'wither_rose', 'closed_eyeblossom', 'open_eyeblossom', 'torchflower', 'sunflower', 'lilac', 'rose_bush',
       'peony', 'pitcher_plant', 'wildflowers', 'pink_petals', 'cactus_flower',
       'dried_kelp', 'glow_berries', 'moss_carpet', 'firefly_bush', 'bush', 'bread'}
BASE = {'leaf_litter', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'poppy', 'dandelion', 'short_grass', 'seagrass',
        'tall_grass', 'fern', 'large_fern', 'vine'}
SAPLING = re.compile(r'_sapling$')
SWORD = re.compile(r'_sword$')
TOOL = re.compile(r'_(pickaxe|axe|shovel|hoe|sword)$')
PICKAXE = re.compile(r'_pickaxe$')
FOODS = {'apple', 'mushroom_stew', 'bread', 'porkchop', 'cooked_porkchop', 'golden_apple', 'enchanted_golden_apple', 'cod',
         'salmon', 'tropical_fish', 'pufferfish', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice', 'dried_kelp', 'beef',
         'cooked_beef', 'chicken', 'cooked_chicken', 'rotten_flesh', 'spider_eye', 'carrot', 'potato', 'baked_potato',
         'poisonous_potato', 'golden_carrot', 'pumpkin_pie', 'rabbit', 'cooked_rabbit', 'rabbit_stew', 'mutton', 'cooked_mutton',
         'chorus_fruit', 'beetroot', 'beetroot_soup', 'suspicious_stew', 'sweet_berries', 'glow_berries', 'honey_bottle'}
SAPLING_RESERVE = 16
KEPT_SAPLINGS = {'oak_sapling', 'birch_sapling'}
APPLE_RESERVE = 4
BANK_ROWS = ('deposit', 'town_deposit')
FUEL_NAMES = re.compile(r'^(coal|charcoal|coal_block|blaze_rod|dried_kelp_block|stick|bamboo|[a-z_]+_planks|[a-z_]+_(log|wood|stem|hyphae))$')
FULL = 34
X2_MIN = 3
RESTORE_S = 120
DEATH_BEFORE_S, DEATH_AFTER_S = 5, 180
BANK_SLACK_BEFORE_S, BANK_SLACK_AFTER_S = 5, 1
LATE_S = 300
# A SWORD SINK'S CREDIT IS KEPT (Claude r-rev3): mineflayer copies the furnace window's bag into bot.inventory only at the
# close, so a burn row written mid-job carried a snapshot that still listed the burned sword, and its credit found no fall
# yet. The skill now writes the rows after the close; the read ALSO keeps an unused burn / in-furnace credit this long and
# lets it cancel a LATER fall of the same name (measured on sandbox3 rows at 7784220: 2 of 2 real burns read as lost).
SINK_CARRY_S = 180
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')


def stack(n):
    return 1 if ONE.search(n) else 16 if SIXTEEN.search(n) else 64


def slots(inv, pred=None):
    return sum((c if stack(n) == 1 else -(-int(c) // stack(n))) for n, c in (inv or {}).items()
               if isinstance(c, (int, float)) and c > 0 and (pred is None or pred(n)))


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


# ---- the predicates (one definition each; gates and instruments both call them) --------------------------------------
ITEMSRE = re.compile(r' items=(\S+)')
PAIR = re.compile(r'^([a-z0-9_]+):(\d+)$')


def compost_items(sk):
    """-> ({item: n}, complete). skill.args.items (the candidate's VERIFIED map) when the row has it -- plus, on an
    interrupted visit (args.incomplete), the NAME of the insert in flight counted as maybe composted (1), and complete
    False; else the detail's items= list, whose LAST pair is dropped when the detail reached the 300-char cut."""
    a = (sk or {}).get('args') or {}
    if isinstance(a.get('items'), dict):
        out = {k: int(v) for k, v in a['items'].items() if isinstance(v, (int, float)) and v > 0}
        if a.get('incomplete'):
            if isinstance(a.get('inflight'), str):
                out[a['inflight']] = out.get(a['inflight'], 0) + 1
            return out, False
        return out, True
    d = (sk or {}).get('detail') or ''
    m = ITEMSRE.search(d)
    out = {}
    if m and m.group(1) != '-':
        pairs = m.group(1).split(',')
        cut = len(d) >= 299
        if cut:
            pairs = pairs[:-1]
        for kv in pairs:
            p = PAIR.match(kv)
            if p:
                out[p.group(1)] = out.get(p.group(1), 0) + int(p.group(2))
        return out, not cut
    return out, True


def crafted(sk, pat):
    """A craft row that made the REQUESTED item matching pat (status success and the item gained)."""
    if (sk or {}).get('name') != 'craft' or sk.get('status') != 'success':
        return None
    item = str((sk.get('args') or {}).get('item') or '')
    d = (sk.get('inventory_delta') or {}).get(item)
    return item if pat.search(item) and isinstance(d, (int, float)) and d > 0 else None


def took(sk, pat):
    """Names matching pat that a bank row's delta shows leaving the bag."""
    if (sk or {}).get('name') not in BANK_ROWS:
        return []
    return sorted(n for n, v in (sk.get('inventory_delta') or {}).items() if pat.search(n) and isinstance(v, (int, float)) and v < 0)


def burned_sword(sk):
    """Wooden swords a smelt row's delta shows leaving the bag (the furnace burned them)."""
    if (sk or {}).get('name') != 'smelt':
        return 0
    v = (sk.get('inventory_delta') or {}).get('wooden_sword')
    return -int(v) if isinstance(v, (int, float)) and v < 0 else 0


LOGS = re.compile(r'_(log|wood|stem|hyphae)$')


def burned_fuel(sk):
    """A smelt row that consumed ORDINARY fuel: a fuel item left the bag and it is not the job's input (a requested log, or
    any log when the job makes charcoal, is input, never counted). The K7 instrument."""
    if (sk or {}).get('name') != 'smelt':
        return False
    item = str((sk.get('args') or {}).get('item') or '')
    def is_input(n):
        return n == item or (LOGS.search(n) and (item == 'charcoal' or LOGS.search(item)))
    return any(FUEL_NAMES.match(n) and not is_input(n) and isinstance(v, (int, float)) and v < 0
               for n, v in (sk.get('inventory_delta') or {}).items())


SWORD_FUEL_RE = re.compile(r'^(burned wooden_sword|wooden_sword returned unburned|wooden_sword left in the furnace fuel slot).* active=([01])$')


def sword_burn(sk):
    """A `_sword_fuel` row -> ('burned' | 'returned' | 'in_furnace', active) or None."""
    if (sk or {}).get('name') != '_sword_fuel':
        return None
    m = SWORD_FUEL_RE.match((sk.get('detail') or '').strip())
    if not m:
        return None
    kind = 'burned' if m.group(1).startswith('burned') else 'returned' if 'returned' in m.group(1) else 'in_furnace'
    return kind, m.group(2)


def death_in(deaths, start, end):
    return any((start - d).total_seconds() <= 5 and (d - end).total_seconds() <= 5 for d in deaths)


def sapling_reserve(name, active):
    """The kit's per-species reserve: oak and birch 16 always; every other species 0 while active, 16 off."""
    return SAPLING_RESERVE if (name in KEPT_SAPLINGS or not active) else 0


def reserve_breaches(items, inv, active=False):
    if not isinstance(inv, dict):
        return []
    out = []
    for n in items:
        if SAPLING.search(n) and int(inv.get(n, 0) or 0) < sapling_reserve(n, active):
            out.append((n, inv.get(n, 0)))
        if n == 'apple' and int(inv.get('apple', 0) or 0) < APPLE_RESERVE:
            out.append((n, inv.get('apple', 0)))
    return out


def verified_items(sk):
    """The VERIFIED inserts only (Codex r4, Claude r4): exposure and the composted totals never count an in-flight name.
    args.items is verified; a legacy detail list is whatever survived the cut."""
    a = (sk or {}).get('args') or {}
    if isinstance(a.get('items'), dict):
        return {k: int(v) for k, v in a['items'].items() if isinstance(v, (int, float)) and v > 0}
    return compost_items(sk)[0]


def reserve_judged(complete, status, inv, t, last_death):
    """May K4 judge a reserve on this `_compost` row? Only when its END bag is the visit's own: a complete map, not an
    interrupted visit, a non-empty bag, and no death in the 120 s before (Codex r3)."""
    return bool(complete and status != 'aborted' and inv and not (last_death is not None and (t - last_death).total_seconds() <= 120))


def composted_in(items, names, pat=None):
    return sorted(n for n, c in items.items() if c > 0 and (n in names or (pat is not None and pat.search(n))))


def off_list(items, allowed):
    return sorted(n for n, c in items.items() if c > 0 and not (n in allowed or SAPLING.search(n)))


def row_times(r):
    """-> (start, end) of a telemetry row. THE CLOCK (both reviews r2): logger.mjs logSkill stamps a SKILL row at its START
    (@timestamp = startedAt) while its snapshot is the bag at the END; a `_kind` event row (logEvent) is stamped when it is
    written. So a skill row's snapshot belongs at start + duration_ms, and that is where it sorts."""
    t = r['t']
    sk = ((r.get('raw') or {}).get('skill') or {})
    name = r.get('name') or sk.get('name') or ''
    ms = sk.get('duration_ms')
    if not str(name).startswith('_') and isinstance(ms, (int, float)) and ms > 0:
        return t, t + dt.timedelta(milliseconds=float(ms))
    return t, t


def ledger_step(L, name, start, end, inv, delta, sk=None):
    """One row into a Ledger, in END order: a death first, then the snapshot (at end), then a sink's credit -- a bank row
    over its whole run [start, end]; a CONFIRMED sword burn (or a sword left in the furnace) over the 60 s before it."""
    if name == '_death':
        L.death(end)
    L.snapshot(end, inv)
    if name in BANK_ROWS:
        L.bank(end, start, delta, kind='banked')
    sb = sword_burn(sk) if name == '_sword_fuel' else None
    if sb and sb[0] in ('burned', 'in_furnace'):
        L.bank(end, end - dt.timedelta(seconds=60), {'wooden_sword': -1}, kind=sb[0])


class Ledger:
    """Per bot: counts of the names matching pat; every fall is pending until a bank row, a death or a blip explains it."""
    def __init__(self, pat):
        self.pat = pat; self.counts = None; self.pending = []; self.deaths = []; self.last_t = None; self.banks = []
        self.credits = []    # [t, name, left, kind] -- a sword sink's credit no fall had yet used
        self.n = Counter()   # banked, death, blip, acquired, lost, unresolved

    def snapshot(self, t, inv):
        if not isinstance(inv, dict) or not inv:
            return   # an empty / missing bag is unknown (a reconnect), never a fall
        cur = {k: int(v) for k, v in inv.items() if self.pat.search(k) and isinstance(v, (int, float)) and v > 0}
        if self.counts is not None:
            for name in set(cur) | set(self.counts):
                d = cur.get(name, 0) - self.counts.get(name, 0)
                if d < 0 and any(self.last_t is not None and (d_t - self.last_t).total_seconds() > -DEATH_BEFORE_S and d_t <= t for d_t in self.deaths):
                    self.n['death'] += -d   # a death since the last non-empty snapshot (a respawn may show the bag much later)
                elif d < 0:
                    for c in self.credits:
                        if d >= 0:
                            break
                        if c[1] == name and c[2] > 0 and 0 <= (t - c[0]).total_seconds() <= SINK_CARRY_S:
                            k = min(-d, c[2]); c[2] -= k; d += k; self.n[c[3]] += k
                    if d < 0:
                        self.pending.append([t, name, -d])
                elif d > 0:
                    for p in self.pending:
                        if d <= 0:
                            break
                        if p[1] == name and p[2] > 0 and (t - p[0]).total_seconds() <= RESTORE_S:
                            k = min(d, p[2]); p[2] -= k; d -= k; self.n['blip'] += k
                    self.n['acquired'] += d
        self.counts = cur; self.last_t = t

    def bank(self, t, start, delta, kind='banked'):
        for name, v in (delta or {}).items():
            if not (self.pat.search(name) and isinstance(v, (int, float)) and v < 0):
                continue
            self.banks.append((t, name))
            left = -int(v)
            for p in self.pending:
                if left <= 0:
                    break
                if p[1] == name and p[2] > 0 and (start - p[0]).total_seconds() <= BANK_SLACK_BEFORE_S and (p[0] - t).total_seconds() <= BANK_SLACK_AFTER_S:
                    k = min(left, p[2]); p[2] -= k; left -= k; self.n[kind] += k
            if left > 0 and kind in ('burned', 'in_furnace'):
                self.credits.append([t, name, left, kind])

    def death(self, t):
        self.deaths.append(t)

    def finalize(self, end):
        for p in self.pending:
            if p[2] <= 0:
                continue
            if any(-DEATH_BEFORE_S <= (p[0] - d).total_seconds() <= DEATH_AFTER_S for d in self.deaths):
                self.n['death'] += p[2]
            elif (end - p[0]).total_seconds() < LATE_S:
                self.n['unresolved'] += p[2]
            else:
                self.n['lost'] += p[2]
                # CALIBRATION (Claude r3): a loss within 60 s AFTER a bank row that took the same name is the bank-credit
                # window being too short (a late inventory sync), not a loss. Expected ~0; reported with the ledger.
                if any(nm == p[1] and 0 <= (p[0] - bt).total_seconds() <= 60 for bt, nm in self.banks):
                    self.n['lost_after_bank'] += p[2]
            p[2] = 0
        return self.n


KITRE = re.compile(r'^peaceful kit (ON|off): .*? mode=(\w+) difficulty=(\w+) active=([01])$')
SUMRE = re.compile(r'([a-z0-9_]+) (\d+) (\S+) (sought|passive)')


def summary_swords(d):
    head = (d or '').split(' | ')[0]
    out = []
    for part in head.split('; '):
        m = SUMRE.fullmatch(part.strip())
        if m and SWORD.search(m.group(1)):
            out.append((m.group(1), int(m.group(2)), m.group(4)))
    return out


def selftest():
    T = lambda s: dt.datetime(2026, 10, 7, 12, 0, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=s)
    assert KITRE.match('peaceful kit ON: swords=no_bank,no_craft,no_chase,burn_wooden compost=plants mode=auto difficulty=peaceful active=1').groups() == ('ON', 'auto', 'peaceful', '1')
    # the sword sinks: banking (K3), burning (K7) and its instrument
    assert took({'name': 'deposit', 'inventory_delta': {'stone_sword': -1, 'cobblestone': -5}}, SWORD) == ['stone_sword']
    assert took({'name': 'smelt', 'inventory_delta': {'stone_sword': -1}}, SWORD) == []
    assert took({'name': 'town_deposit', 'inventory_delta': {'stone_pickaxe': -1}}, TOOL) == ['stone_pickaxe']
    assert burned_sword({'name': 'smelt', 'inventory_delta': {'wooden_sword': -2, 'raw_iron': -3, 'iron_ingot': 3}}) == 2
    assert burned_sword({'name': 'deposit', 'inventory_delta': {'wooden_sword': -1}}) == 0
    assert burned_fuel({'name': 'smelt', 'args': {'item': 'raw_iron'}, 'inventory_delta': {'coal': -1, 'raw_iron': -8}})
    assert burned_fuel({'name': 'smelt', 'args': {'item': 'raw_iron'}, 'inventory_delta': {'oak_planks': -2}})
    assert not burned_fuel({'name': 'smelt', 'args': {'item': 'raw_iron'}, 'inventory_delta': {'wooden_sword': -1, 'raw_iron': -1}})
    assert not burned_fuel({'name': 'smelt', 'args': {'item': 'oak_log'}, 'inventory_delta': {'oak_log': -4, 'charcoal': 4}}), 'input logs are not fuel'
    assert not burned_fuel({'name': 'smelt', 'args': {'item': 'charcoal'}, 'inventory_delta': {'birch_log': -4, 'charcoal': 4}})
    assert burned_fuel({'name': 'smelt', 'args': {'item': 'charcoal'}, 'inventory_delta': {'birch_log': -4, 'coal': -1, 'charcoal': 4}})
    assert sword_burn({'name': '_sword_fuel', 'detail': 'burned wooden_sword for raw_iron active=1'}) == ('burned', '1')
    assert sword_burn({'name': '_sword_fuel', 'detail': 'burned wooden_sword (unconfirmed) for raw_iron active=1'}) == ('burned', '1')
    assert sword_burn({'name': '_sword_fuel', 'detail': 'wooden_sword left in the furnace fuel slot (the bag is full) for raw_iron active=1'}) == ('in_furnace', '1')
    assert sword_burn({'name': '_sword_fuel', 'detail': 'wooden_sword returned unburned for raw_iron active=0'}) == ('returned', '0')
    assert sword_burn({'name': 'smelt', 'detail': 'burned wooden_sword for raw_iron active=1'}) is None
    assert death_in([T(30)], T(10), T(60)) and death_in([T(64)], T(10), T(60)) and not death_in([T(80)], T(10), T(60))
    # saplings by species
    assert reserve_breaches({'spruce_sapling': 5}, {'dirt': 1}, active=True) == []
    assert reserve_breaches({'spruce_sapling': 5}, {'spruce_sapling': 3}, active=False) == [('spruce_sapling', 3)]
    assert reserve_breaches({'oak_sapling': 5}, {'oak_sapling': 15}, active=True) == [('oak_sapling', 15)]
    assert reserve_breaches({'birch_sapling': 5}, {'birch_sapling': 16}, active=True) == []
    # a burned sword is explained, not lost (the sink credit, kind=burned)
    L4 = Ledger(SWORD)
    L4.snapshot(T(0), {'wooden_sword': 1, 'dirt': 1}); L4.snapshot(T(20), {'dirt': 1}); L4.bank(T(30), T(5), {'wooden_sword': -1}, kind='burned')
    n4 = L4.finalize(T(4000))
    assert (n4['burned'], n4['lost']) == (1, 0), dict(n4)
    L6 = Ledger(SWORD)   # a stone sword that vanished during a smelt is a loss (no burn row can credit it)
    ledger_step(L6, 'gather', T(0), T(0), {'stone_sword': 1, 'dirt': 1}, {})
    ledger_step(L6, 'smelt', T(10), T(40), {'dirt': 1}, {'stone_sword': -1}, {'name': 'smelt'})
    assert L6.finalize(T(4000))['lost'] == 1
    L5 = Ledger(SWORD)   # a CONFIRMED burn row is the sink; a smelt row's delta alone is NOT (Codex r-rev1)
    ledger_step(L5, 'gather', T(0), T(0), {'wooden_sword': 2, 'dirt': 1}, {})
    ledger_step(L5, '_sword_fuel', T(12), T(12), {'wooden_sword': 1, 'dirt': 1}, {}, {'name': '_sword_fuel', 'detail': 'burned wooden_sword for raw_iron active=1'})
    ledger_step(L5, 'smelt', T(10), T(40), {'dirt': 1}, {'wooden_sword': -2}, {'name': 'smelt'})   # the second sword vanished
    n5 = L5.finalize(T(4000))
    assert (n5['burned'], n5['lost']) == (1, 1), dict(n5)
    # THE FROZEN BAG (Claude r-rev3): burn rows whose snapshots still list the swords; the fall shows on the smelt row
    # after the close -> both credits are kept and cancel it. A fall past SINK_CARRY_S is not explained.
    L7 = Ledger(SWORD)
    ledger_step(L7, 'gather', T(0), T(0), {'wooden_sword': 2, 'dirt': 1}, {})
    for at in (12, 14):
        ledger_step(L7, '_sword_fuel', T(at), T(at), {'wooden_sword': 2, 'dirt': 1}, {}, {'name': '_sword_fuel', 'detail': 'burned wooden_sword for raw_iron active=1'})
    ledger_step(L7, 'smelt', T(10), T(40), {'dirt': 1}, {'wooden_sword': -2}, {'name': 'smelt'})
    n7 = L7.finalize(T(4000))
    assert (n7['burned'], n7['lost']) == (2, 0), dict(n7)
    L8 = Ledger(SWORD)
    ledger_step(L8, 'gather', T(0), T(0), {'wooden_sword': 1, 'dirt': 1}, {})
    ledger_step(L8, '_sword_fuel', T(12), T(12), {'wooden_sword': 1, 'dirt': 1}, {}, {'name': '_sword_fuel', 'detail': 'burned wooden_sword for raw_iron active=1'})
    ledger_step(L8, 'gather', T(400), T(400), {'dirt': 1}, {})
    n8 = L8.finalize(T(4000))
    assert (n8['burned'], n8['lost']) == (0, 1), dict(n8)
    # an outcome-unknown row (the furnace could not be read) credits nothing
    assert sword_burn({'name': '_sword_fuel', 'detail': 'wooden_sword outcome unknown (the furnace could not be read) for raw_iron active=1'}) is None
    assert sword_burn({'name': '_sword_fuel', 'detail': 'wooden_sword returned unburned (left by an earlier call) for raw_iron active=0'}) == ('returned', '0')
    assert KITRE.match('peaceful kit off: swords=as_before compost=as_before mode=auto difficulty=easy active=0').group(4) == '0'
    # compost_items: args first; a cut detail drops its last pair (a cut count too); a whole detail keeps every pair
    assert compost_items({'args': {'items': {'wildflowers': 30, 'apple': 6}}, 'detail': 'x items=wildflowers:3'}) == ({'wildflowers': 30, 'apple': 6}, True)
    whole = 'slots=36->33 level=0->4 bonemeal=1 n=67 stop=done items=leaf_litter:64,wildflowers:3'
    assert compost_items({'detail': whole}) == ({'leaf_litter': 64, 'wildflowers': 3}, True)
    start, body = 'slots=36->33 level=0->4 bonemeal=1 n=67 stop=done items=', ''
    while len(start + body) + 14 <= 287 - 8:
        body += 'leaf_litter:1,'
    body += 'kelp:' + '1' * (287 - len(start + body) - 6) + ','
    cut = (start + body + 'wildflowers:31')[:300]
    assert cut.endswith(',wildflowers:3'), cut[-20:]   # the count itself is cut: 31 reads as 3
    got, complete = compost_items({'detail': cut})
    assert not complete and 'wildflowers' not in got, 'a cut detail drops the (possibly cut) last pair'
    # crafted: the requested sword, verified; a passive sword during a planks craft is not a craft
    assert crafted({'name': 'craft', 'status': 'success', 'args': {'item': 'wooden_sword'}, 'inventory_delta': {'wooden_sword': 1, 'oak_planks': -2}}, SWORD) == 'wooden_sword'
    assert crafted({'name': 'craft', 'status': 'success', 'args': {'item': 'oak_planks'}, 'inventory_delta': {'oak_planks': 4, 'stone_sword': 1}}, SWORD) is None
    assert crafted({'name': 'craft', 'status': 'failed', 'args': {'item': 'wooden_sword'}, 'inventory_delta': {}}, SWORD) is None
    assert crafted({'name': 'craft', 'status': 'success', 'args': {'item': 'stone_pickaxe'}, 'inventory_delta': {'stone_pickaxe': 1}}, TOOL) == 'stone_pickaxe'
    # reserves
    assert reserve_breaches({'oak_sapling': 4, 'apple': 6}, {'oak_sapling': 16, 'apple': 4}) == []
    assert reserve_breaches({'oak_sapling': 5}, {'oak_sapling': 15}) == [('oak_sapling', 15)]
    assert reserve_breaches({'apple': 7}, {'apple': 3}) == [('apple', 3)]
    # composted_in / off_list
    assert composted_in({'wildflowers': 3, 'leaf_litter': 2}, KIT) == ['wildflowers']
    assert off_list({'carrot': 1, 'wildflowers': 2, 'oak_sapling': 3}, BASE | KIT | {'apple'}) == ['carrot']
    assert off_list({'apple': 2, 'leaf_litter': 2}, BASE) == ['apple']
    # the ledger: banked through an intermediate snapshot; a death; a blip; a late acquisition does not cancel a loss
    L = Ledger(SWORD)
    L.snapshot(T(0), {'stone_sword': 1, 'wooden_sword': 1, 'dirt': 1})
    L.snapshot(T(10), {'wooden_sword': 1, 'dirt': 1})          # an intermediate row sees the fall first ...
    L.bank(T(15), T(8), {'stone_sword': -1})                    # ... the deposit row that took it credits it
    L.snapshot(T(100), {'dirt': 1})                             # wooden sword gone: no bank, no death ...
    L.snapshot(T(1000), {'wooden_sword': 1, 'dirt': 1})         # ... and a pickup 900 s later is an acquisition
    L.snapshot(T(1100), {'dirt': 2})
    L.death(T(1105))                                            # this fall is the death's
    L.snapshot(T(1300), {'wooden_sword': 1, 'dirt': 2})        # 200 s later: another acquisition, not a blip
    L.snapshot(T(1310), {'dirt': 2})
    L.snapshot(T(1330), {'wooden_sword': 1, 'dirt': 2})        # a 20 s blip
    L.snapshot(T(1340), {})                                     # a reconnect: unknown, never a fall
    L.snapshot(T(1345), {'wooden_sword': 1, 'dirt': 2})        # (so the bag after it is no "rise" either)
    L.snapshot(T(1350), {'dirt': 2})                          # a fall 90 s before the end: unresolved
    n = L.finalize(T(1440))
    assert (n['banked'], n['lost'], n['death'], n['blip'], n['acquired'], n['unresolved']) == (1, 1, 1, 1, 2, 1), dict(n)
    # LOGGER-SHAPED ROWS (both reviews r2): the deposit is stamped at its START (10 s) and runs 50 s; a reflex row at 20 s
    # still holds the sword, one at 50 s does not; then a death at 100 s whose respawn bag first shows at 500 s.
    rows_ = [
        {'t': T(0), 'name': 'gather', 'raw': {'skill': {'duration_ms': 1000}, 'bot': {'inventory': {'stone_sword': 1, 'iron_sword': 1, 'dirt': 1}}}},
        {'t': T(10), 'name': 'deposit', 'raw': {'skill': {'duration_ms': 50000, 'inventory_delta': {'stone_sword': -1}}, 'bot': {'inventory': {'iron_sword': 1, 'dirt': 1}}}},
        {'t': T(20), 'name': '_tool_gone', 'raw': {'skill': {}, 'bot': {'inventory': {'stone_sword': 1, 'iron_sword': 1, 'dirt': 1}}}},
        {'t': T(50), 'name': '_pickups', 'raw': {'skill': {}, 'bot': {'inventory': {'iron_sword': 1, 'dirt': 1}}}},
        {'t': T(100), 'name': '_death', 'raw': {'skill': {}, 'bot': {'inventory': {}}}},
        {'t': T(500), 'name': '_respawn', 'raw': {'skill': {}, 'bot': {'inventory': {'dirt': 1}}}},
    ]
    order = [r['name'] for r in sorted(rows_, key=lambda r: row_times(r)[1])]
    assert order == ['gather', '_tool_gone', '_pickups', 'deposit', '_death', '_respawn'], order
    L2 = Ledger(SWORD)
    for r in sorted(rows_, key=lambda r: row_times(r)[1]):
        a, z = row_times(r)
        sk_ = r['raw']['skill']
        ledger_step(L2, r['name'], a, z, r['raw']['bot']['inventory'], sk_.get('inventory_delta') or {})
    n2 = L2.finalize(T(2000))
    assert (n2['banked'], n2['death'], n2['lost'], n2['acquired']) == (1, 1, 0, 0), dict(n2)
    # an interrupted visit: the verified map, plus the in-flight NAME as maybe composted; never complete
    assert compost_items({'args': {'items': {'oak_sapling': 2}, 'incomplete': 1, 'inflight': 'wildflowers'}}) == ({'oak_sapling': 2, 'wildflowers': 1}, False)
    assert reserve_judged(True, 'success', {'apple': 4}, T(500), None)
    assert not reserve_judged(False, 'success', {'apple': 4}, T(500), None)
    assert not reserve_judged(True, 'aborted', {'apple': 4}, T(500), None)
    assert not reserve_judged(True, 'success', {}, T(500), None)
    assert not reserve_judged(True, 'success', {'apple': 4}, T(500), T(450))
    assert reserve_judged(True, 'success', {'apple': 4}, T(500), T(300))
    # exposure counts verified inserts only: an abort before anything went in has an in-flight name and no kit insert
    aborted0 = {'status': 'aborted', 'args': {'items': {}, 'incomplete': 1, 'inflight': 'wildflowers', 'peaceful': 1}}
    assert composted_in(compost_items(aborted0)[0], KIT) == ['wildflowers'], 'K5/K6 see the maybe-composted name'
    assert composted_in(verified_items(aborted0), KIT) == [], 'X2 does not'
    assert verified_items({'args': {'items': {'kelp': 3}, 'incomplete': 1, 'inflight': 'kelp'}}) == {'kelp': 3}
    # calibration: a loss right after a bank row of the same name is flagged
    L3 = Ledger(SWORD)
    L3.snapshot(T(0), {'stone_sword': 2, 'dirt': 1}); L3.snapshot(T(10), {'stone_sword': 1, 'dirt': 1})
    L3.bank(T(10), T(5), {'stone_sword': -1}); L3.snapshot(T(40), {'dirt': 1})
    n3 = L3.finalize(T(4000))
    assert (n3['lost'], n3['lost_after_bank']) == (1, 1), dict(n3)
    assert summary_swords('stone_sword 1 pickup sought; cobblestone 3 mine:y-20 passive | 4 items') == [('stone_sword', 1, 'sought')]
    assert slots({'stone_sword': 2, 'wildflowers': 70}, lambda x: x in KIT) == 2
    assert len(KIT) == 36 and not (KIT & BASE) and 'bread' in KIT and 'carrot' not in KIT
    print('selftest OK')


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == '--selftest':
    selftest(); sys.exit(0)
selftest()

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
    """scoreboard.py's rotation-aware loader (logs rotate ~23:59Z; day D's rows live in skill-*.jsonl-<D+1>.gz)."""
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


rows = sorted(load_window(PRE, END), key=lambda r: row_times(r)[1])   # SORTED by when each SNAPSHOT was taken (row_times)
# EVERY BOT'S DEATHS, INDEXED BEFORE THE WALK (Codex r-rev2): a `_death` logged up to 5 s AFTER a bank row's end must still
# exclude that row from K3, and the walk sees rows in end order.
DEATHS = defaultdict(list)
for _r in rows:
    if _r.get('name') == '_death':
        DEATHS[(_r.get('bot') or {}).get('name')].append(row_times(_r)[1])
rows_walked = Counter(); bots_seen = defaultdict(set)
tw = defaultdict(lambda: [0.0] * 6)   # (period, arm) -> [seconds, at>=34, slots, sword slots, kit slots, plant+food slots]
kitrows = Counter(); offbuild = 0
B = {k: [] for k in ('K0', 'K1', 'K2c', 'K3', 'K4', 'K5', 'K6', 'K7')}
inst = Counter(); ctl = Counter(); unjudged = Counter(); x2 = set(); burned = Counter(); burn_bots = set(); composted_kit = Counter(); incomplete = Counter()
deaths = []; sought = Counter(); hunger_low = Counter()
st = {}
for r in rows:
    b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    t0, t = row_times(r); raw = r.get('raw') or {}; bot = raw.get('bot') or {}; sk = raw.get('skill') or {}
    period = 'post' if t >= CUT else 'pre'
    arm = 'canary' if pool_of(b) in CANS else 'control'
    rows_walked[(period, arm)] += 1
    bots_seen[(period, arm)].add(b)
    ver = ((raw.get('code') or {}).get('version') or '')
    if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
        if r['name'] == '_peaceful_kit':   # restart-lag rows are not canary (memory 10-01)
            offbuild += 1
        continue
    s = st.setdefault(b, {'prev_t': None, 'prev': None, 'active': None, 'sw': Ledger(SWORD), 'pk': Ledger(PICKAXE)})
    if s['prev_t'] is not None and s['prev'] is not None:
        pp = 'post' if s['prev_t'] >= CUT else 'pre'
        dts = min((t - s['prev_t']).total_seconds(), 120.0)
        a = tw[(pp, arm)]
        a[0] += dts; a[1] += dts if s['prev'][0] >= FULL else 0
        for i in range(4):
            a[2 + i] += dts * s['prev'][i]
    s['prev_t'] = t
    inv = bot.get('inventory') if isinstance(bot.get('inventory'), dict) else None
    if inv is not None:
        s['prev'] = (slots(inv), slots(inv, lambda n: bool(SWORD.search(n))), slots(inv, lambda n: n in KIT),
                     slots(inv, lambda n: n in KIT or n in BASE or n in FOODS or bool(SAPLING.search(n))))
    k = r['name']; d = r.get('detail') or ''
    delta = sk.get('inventory_delta') or {}
    post = period == 'post'
    if k == '_peaceful_kit':
        m = KITRE.match(d)
        s['active'] = m.group(4) if m else s['active']
        if post:
            kitrows[(arm, m.group(4) if m else '?')] += 1
            if arm == 'canary' and (not m or m.group(2) != 'auto' or (m.group(3) == 'peaceful' and m.group(4) != '1')):
                B['K0'].append((b, d[:100]))
    if not post:
        continue
    # the ledgers (post only; the first post snapshot is the baseline)
    if k == '_death':
        deaths.append((arm, b, str(t)[11:19])); s['last_death'] = t
    ledger_step(s['sw'], k, t0, t, inv, delta, sk); ledger_step(s['pk'], k, t0, t, inv, delta, sk)
    if k in BANK_ROWS:
        tk = took(sk, SWORD)
        if tk and arm == 'canary' and s['active'] == '1':
            if death_in(DEATHS[b], t0, t):
                ctl['K3_death_excluded'] += 1
            else:
                B['K3'].append((b, str(t)[11:19], tk))
        if arm == 'control':
            inst['K3'] += bool(took(sk, TOOL))
            ctl['sword_bank_rows'] += bool(tk)
    sb = sword_burn(sk) if k == '_sword_fuel' else None
    if k == '_sword_fuel' and arm == 'canary' and 'outcome unknown' in d:
        burned['unknown'] += 1      # the furnace could not be read: no credit; the fall stays pending (Codex r-rev3)
    if sb:
        if sb[0] == 'burned' and sb[1] != '1':
            B['K7'].append((arm, b, str(t)[11:19], d[:80]))
        if arm == 'canary':
            burned[sb[0]] += 1
            if sb[0] == 'in_furnace':
                burned[('in_furnace', b)] += 1
            if '(unconfirmed)' in d:
                burned['unconfirmed'] += 1
            if sb[0] == 'burned':
                burn_bots.add(b)
                burned['same_predicate_on'] += sb[1] == '1'
    if k == 'smelt':
        burned[(arm, 'smelt_rows')] += 1
        burned[(arm, 'swords_burned_delta')] += burned_sword(sk)
        if arm == 'control':
            inst['K7'] += burned_fuel(sk)
    c = crafted(sk, SWORD) if k == 'craft' else None
    if c and arm == 'canary' and s['active'] == '1':
        B['K1'].append((b, str(t)[11:19], c))
    if k == 'craft' and arm == 'control':
        inst['K1'] += bool(crafted(sk, TOOL))
        ctl['sword_crafts'] += bool(c)
    if k == '_compost':
        items, complete = compost_items(sk)
        if not complete:
            incomplete[arm] += 1
        judged = reserve_judged(complete, sk.get('status'), inv, t, s.get('last_death'))
        if not judged:
            unjudged[arm] += 1
        row_active = ((sk.get('args') or {}).get('peaceful') == 1) if 'peaceful' in ((sk.get('args') or {})) else (arm == 'canary' and s['active'] == '1')
        res = reserve_breaches(items, inv, row_active) if judged and (any(SAPLING.search(n) for n in items) or 'apple' in items) else None
        if arm == 'control':
            inst['K4'] += res is not None
            ctl['K4'] += bool(res)
            inst['K5'] += bool(composted_in(items, BASE | {'apple'}, SAPLING))
            inst['K6'] += bool(off_list(items, BASE))
            ctl['visits_holding_kit'] += bool(inv and any(n in KIT and v for n, v in inv.items()))
            if composted_in(items, KIT):
                B['K5'].append((arm, b, str(t)[11:19], None, composted_in(items, KIT)[:3]))
        else:
            if res:
                B['K4'].append((b, str(t)[11:19], res))
            kit = composted_in(items, KIT)   # the maybe-composted in-flight name counts here (K5: a breach either way)
            if kit and (s['active'] != '1' or ((sk.get('args') or {}).get('peaceful') == 0)):
                B['K5'].append((arm, b, str(t)[11:19], s['active'], kit[:3]))
            elif kit:
                ver = verified_items(sk)
                vkit = composted_in(ver, KIT)   # EXPOSURE counts verified inserts only
                if vkit:
                    x2.add(b); composted_kit.update({n: ver[n] for n in vkit})
            bad = off_list(items, BASE | KIT | {'apple'})
            if bad:
                B['K6'].append((b, str(t)[11:19], bad[:3]))
            if any(SWORD.search(n) for n in items):
                B['K2c'].append((b, str(t)[11:19], 'sword composted'))
    if k == '_pickups':
        for n, cnt, mode in summary_swords(d):
            sought[(arm, mode)] += cnt
    h = bot.get('hunger')
    if isinstance(h, (int, float)) and h < 20:
        hunger_low[arm] += 1

L = {('canary', 'sw'): Counter(), ('control', 'sw'): Counter(), ('canary', 'pk'): Counter(), ('control', 'pk'): Counter()}
lost_by_bot = {}
for b, s in st.items():
    arm = 'canary' if pool_of(b) in CANS else 'control'
    for key in ('sw', 'pk'):
        n = s[key].finalize(END)
        L[(arm, key)].update(n)
        if key == 'sw' and arm == 'canary' and n['lost']:
            lost_by_bot[b] = n['lost']
bh = {key: tw[key][0] / 3600 for key in tw}
rate = lambda n, arm: n / bh[('post', arm)] if bh.get(('post', arm)) else float('nan')
can_lost, ctl_lost = L[('canary', 'sw')]['lost'], L[('control', 'sw')]['lost']
k2 = len(B['K2c']) + (can_lost if can_lost and (not ctl_lost or rate(can_lost, 'canary') > rate(ctl_lost, 'control')) else 0)
k4 = len(B['K4']) if B['K4'] and (not ctl['K4'] or rate(len(B['K4']), 'canary') > rate(ctl['K4'], 'control')) else 0
inst['K2'] = L[('control', 'pk')]['banked']


def per(key, i):
    v = tw[key]
    return v[i] / v[0] if v[0] else float('nan')


did = lambda i: (per(('post', 'canary'), i) - per(('pre', 'canary'), i)) - (per(('post', 'control'), i) - per(('pre', 'control'), i))
live = kitrows[('canary', '1')]
ctl_rows = sum(v for (a, _), v in kitrows.items() if a == 'control')
exposure = int(live >= 1 and len(x2) >= X2_MIN)
print('rows walked pre %s post %s | canary %s sha %s cutoff %s window +%d min | bot-h %s' % (
    {a: rows_walked[('pre', a)] for a in ('canary', 'control')}, {a: rows_walked[('post', a)] for a in ('canary', 'control')},
    sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W, {'%s/%s' % k_: round(v, 1) for k_, v in sorted(bh.items())}))
print('bots post canary %d control %d' % (len(bots_seen[('post', 'canary')]), len(bots_seen[('post', 'control')])))
print('-' * 78)
print('LIVENESS     canary _peaceful_kit active=1 rows %d (>= 1) | control kit rows %d (must be 0) | other build %d' % (live, ctl_rows, offbuild))
print('CORRECTNESS  K0 mode %d | K1 sword crafted while active %d | K2 swords lost %d (canary lost %d %s, control lost %d; composted %d) | K3 sword banked while active %d | K7 sword burned while off %d' % (
    len(B['K0']), len(B['K1']), k2, can_lost, lost_by_bot, ctl_lost, len(B['K2c']), len(B['K3']), len(B['K7'])))
print('             K4 reserves breached %d (canary rows %d, control rows %d) | K5 kit plant composted while off / by control %d | K6 off-list composted %d' % (
    k4, len(B['K4']), ctl['K4'], len(B['K5']), len(B['K6'])))
print('INSTRUMENT   K1 control tool crafts %d (control sword crafts %d) | K2 control pickaxe falls explained by a bank row %d (ledger %s; CALIBRATION lost within 60 s after a same-name bank row %d, expected ~0)' % (
    inst['K1'], ctl['sword_crafts'], inst['K2'], dict(L[('control', 'pk')]), L[('control', 'pk')]['lost_after_bank']))
print('             K3 control bank rows that took a tool copy %d (control bank rows that took a sword %d) | K7 control smelts that burned ordinary fuel %d' % (
    inst['K3'], ctl['sword_bank_rows'], inst['K7']))
print('             K4 control compost rows with the reserve check evaluated %d | K5 control rows composting base/sapling/apple %d | K6 control rows off the BASE list %d' % (
    inst['K4'], inst['K5'], inst['K6']))
print('LEDGERS      swords canary %s control %s | compost rows incomplete (cut list / interrupted insert): canary %d control %d | reserve not judged (incomplete, aborted, empty bag, death): canary %d control %d' % (
    dict(L[('canary', 'sw')]), dict(L[('control', 'sw')]), incomplete['canary'], incomplete['control'], unjudged['canary'], unjudged['control']))
print('EXPOSURE     X2 canary BOTS that composted a kit plant %d (>= %d) | ready %d | kit plants composted %s | control compost visits holding a kit plant %d' % (
    len(x2), X2_MIN, exposure, dict(composted_kit.most_common(8)), ctl['visits_holding_kit']))
print('SWORDS       REPORTED: confirmed burns %d by %d bots (K7 same-predicate control: burns with active=1 %d%s); returned unburned %d; left in the furnace %d %s; burns marked unconfirmed %d; outcome unknown (no credit) %d | smelt rows canary %d control %d; smelt-delta wooden swords canary %d control %d | K3 bank rows excluded for a death %d' % (
    burned['burned'], len(burn_bots), burned['same_predicate_on'], '' if burned['same_predicate_on'] else ' -- the predicate was not exercised', burned['returned'], burned['in_furnace'],
    {k[1]: v for k, v in burned.items() if isinstance(k, tuple) and k[0] == 'in_furnace'}, burned['unconfirmed'], burned['unknown'],
    burned[('canary', 'smelt_rows')], burned[('control', 'smelt_rows')],
    burned[('canary', 'swords_burned_delta')], burned[('control', 'swords_burned_delta')], ctl['K3_death_excluded']))
print('TRIPWIRES    swords sought by the sweep canary %d control %d | hunger < 20 canary %d control %d | unresolved sword falls canary %d | deaths %s' % (
    sought[('canary', 'sought')], sought[('control', 'sought')], hunger_low['canary'], hunger_low['control'], L[('canary', 'sw')]['unresolved'], deaths[:6]))
print('PRIMARY      sword slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | kit-plant slots/bot DiD %+.2f | plant+food slots/bot DiD %+.2f' % (
    per(('pre', 'canary'), 3), per(('post', 'canary'), 3), per(('pre', 'control'), 3), per(('post', 'control'), 3), did(3), did(4), did(5)))
print('             all slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | share >= 34 DiD %+.3f' % (
    per(('pre', 'canary'), 2), per(('post', 'canary'), 2), per(('pre', 'control'), 2), per(('post', 'control'), 2), did(2), did(1)))
for nm, xs in B.items():
    for x in xs[:3]:
        print('  breach %s:' % nm, x)
nan = lambda x: None if x != x else round(x, 4)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('peacefulkitread', W, {
        'rows_canary': live, 'rows_control': ctl_rows, 'offbuild_canary': offbuild,
        'breach_mode': len(B['K0']), 'breach_sword_craft': len(B['K1']), 'breach_sword_lost': k2, 'breach_sword_banked': len(B['K3']), 'breach_burn_off': len(B['K7']),
        'breach_reserve': k4, 'breach_compost_off': len(B['K5']), 'breach_off_list': len(B['K6']),
        'instrument_k1': inst['K1'], 'instrument_k2': inst['K2'], 'instrument_k3': inst['K3'], 'instrument_k4': inst['K4'],
        'instrument_k5': inst['K5'], 'instrument_k6': inst['K6'], 'instrument_k7': inst['K7'],
        'swords_burned': burned['burned'], 'swords_left_in_furnace': burned['in_furnace'], 'k3_death_excluded': ctl['K3_death_excluded'], 'sword_burn_bots': len(burn_bots), 'kit_compost_bots': len(x2), 'kit_composted': sum(composted_kit.values()),
        'swords_lost_canary': can_lost, 'swords_lost_control': ctl_lost, 'sword_falls_unresolved': L[('canary', 'sw')]['unresolved'],
        'sought_swords_canary': sought[('canary', 'sought')], 'hunger_low_canary': hunger_low['canary'],
        'sword_slots_did': nan(did(3)), 'kit_slots_did': nan(did(4)), 'plant_food_slots_did': nan(did(5)),
        'slots_did': nan(did(2)), 'full_share_did': nan(did(1)),
        'exposure_ready': exposure,
    })
except Exception as e:
    print('emit failed:', e)
