#!/usr/bin/env python3
# peacefulkitread.py [window_min] | --selftest -- the read for canary `peacefulkit-01` (branch pk-on-c6e91a8; pk-on-92bc84f if
# the fleet moves to towndeposit). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/peacefulkit.mjs, under the peaceful food policy's ONE switch, foodskip.mjs FOOD_SKIP auto|on|off,
# default auto = active while the server's difficulty packet says peaceful):
#   SWORDS  never crafted (admission + the craft skill refuse it), never walked to by the pickup sweep, and banked: while
#           active a RUNNING deposit keeps no sword (every usable copy goes; the base keeps the best copy of each name).
#           Admission/advice/milestones count with the base rule, so a sword never makes a deposit due (no new trip).
#   COMPOST the town composter also takes the kit's plants (30 names, each verified consumed by a real Paper 1.21.8
#           composter), WHOLE; saplings above 16 and apples above 4 as before. The candidate's `_compost` row carries the
#           complete inserted map in skill.args.items (the 300-char detail can be cut) and args.peaceful (0/1).
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
#                  (deposit / town_deposit) whose run interval [t - duration - 5 s, t + 1 s] contains it and whose delta
#                  shows the same name leaving; by a death (a fall within -5..+180 s of `_death`); or by a rise of the same
#                  name within 120 s (a snapshot blip). A rise later than that is an acquisition and never cancels a loss.
#                  An empty inventory snapshot is unknown (a reconnect), never a fall. Pending falls in the last 300 s of the
#                  window are UNRESOLVED (reported). Breach: canary lost >= 1 AND its per-bot-hour rate > the control's
#                  (the same ledger on control swords), plus any `_compost` row that composted a sword.
#                  INSTRUMENT: Ledger(PICKAXE) on control bots -- falls the BANK reconciliation explained (>= 1).
#   K3 BANK OFF    took_last(row, inv, SWORD): a bank row whose delta took a sword name to 0 in the END snapshot -- from a
#                  canary bot whose latest kit row was not active=1, or from ANY control bot (the base keeps one copy).
#                  INSTRUMENT: took_last(row, inv, ANY) on control bank rows (a bank run that emptied some name).
#   K4 RESERVES    reserve_breaches(items, inv): a sapling species composted and < 16 left, or apples composted and < 4
#                  left, in the END snapshot. Breach: canary >= 1 AND its rate > the control's (the same predicate on control
#                  rows: the base composts saplings and, under the food policy, apples).  INSTRUMENT: control compost rows
#                  on which the predicate was evaluated (a sapling or apple composted).
#   K5 OFF MEANS OFF  composted_in(items, KIT) on a canary row whose kit row was not active=1 (or args.peaceful == 0), or on
#                  ANY control row.  INSTRUMENT: composted_in(items, BASE + saplings + apple) on control rows.
#   K6 ONLY THE LIST  off_list(items, BASE + KIT + saplings + apple) on a canary row.  INSTRUMENT: off_list(items, BASE) on
#                  control rows (finds the APPLES the base composts under the food policy; off_list always allows saplings).
#   EXPOSURE     liveness AND X1 >= 3 canary BOTS whose bank row took a sword while active AND X2 >= 3 canary BOTS that
#                composted a kit plant (swords are stock: each bot banks once, so X1's ceiling is the holders at the cut). Registered with reads at +180/+360 and extension reads until exposure (deadline
#                -> INCONCLUSIVE); see the registration for the measured power.
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
       'peony', 'pitcher_plant', 'wildflowers', 'pink_petals', 'cactus_flower'}
BASE = {'leaf_litter', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds', 'poppy', 'dandelion', 'short_grass', 'seagrass',
        'tall_grass', 'fern', 'large_fern', 'vine'}
SAPLING = re.compile(r'_sapling$')
SWORD = re.compile(r'_sword$')
TOOL = re.compile(r'_(pickaxe|axe|shovel|hoe|sword)$')
PICKAXE = re.compile(r'_pickaxe$')
ANY = re.compile(r'.')
FOODS = {'apple', 'mushroom_stew', 'bread', 'porkchop', 'cooked_porkchop', 'golden_apple', 'enchanted_golden_apple', 'cod',
         'salmon', 'tropical_fish', 'pufferfish', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice', 'dried_kelp', 'beef',
         'cooked_beef', 'chicken', 'cooked_chicken', 'rotten_flesh', 'spider_eye', 'carrot', 'potato', 'baked_potato',
         'poisonous_potato', 'golden_carrot', 'pumpkin_pie', 'rabbit', 'cooked_rabbit', 'rabbit_stew', 'mutton', 'cooked_mutton',
         'chorus_fruit', 'beetroot', 'beetroot_soup', 'suspicious_stew', 'sweet_berries', 'glow_berries', 'honey_bottle'}
SAPLING_RESERVE = 16
APPLE_RESERVE = 4
BANK_ROWS = ('deposit', 'town_deposit')
FULL = 34
X1_MIN = 3
X2_MIN = 3
RESTORE_S = 120
DEATH_BEFORE_S, DEATH_AFTER_S = 5, 180
BANK_SLACK_BEFORE_S, BANK_SLACK_AFTER_S = 5, 1
LATE_S = 300
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


def took_last(sk, inv, pat):
    """Names matching pat that a bank row's delta took and the END snapshot no longer holds."""
    if (sk or {}).get('name') not in BANK_ROWS or not isinstance(inv, dict):
        return []
    return sorted(n for n, v in (sk.get('inventory_delta') or {}).items()
                  if pat.search(n) and isinstance(v, (int, float)) and v < 0 and int(inv.get(n, 0) or 0) == 0)


def reserve_breaches(items, inv):
    if not isinstance(inv, dict):
        return []
    out = []
    for n in items:
        if SAPLING.search(n) and int(inv.get(n, 0) or 0) < SAPLING_RESERVE:
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


def ledger_step(L, name, start, end, inv, delta):
    """One row into a Ledger, in END order: a death first, then the snapshot (at end), then a bank row's credit over
    its whole run [start, end]."""
    if name == '_death':
        L.death(end)
    L.snapshot(end, inv)
    if name in BANK_ROWS:
        L.bank(end, start, delta)


class Ledger:
    """Per bot: counts of the names matching pat; every fall is pending until a bank row, a death or a blip explains it."""
    def __init__(self, pat):
        self.pat = pat; self.counts = None; self.pending = []; self.deaths = []; self.last_t = None; self.banks = []
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
                    self.pending.append([t, name, -d])
                elif d > 0:
                    for p in self.pending:
                        if d <= 0:
                            break
                        if p[1] == name and p[2] > 0 and (t - p[0]).total_seconds() <= RESTORE_S:
                            k = min(d, p[2]); p[2] -= k; d -= k; self.n['blip'] += k
                    self.n['acquired'] += d
        self.counts = cur; self.last_t = t

    def bank(self, t, start, delta):
        for name, v in (delta or {}).items():
            if not (self.pat.search(name) and isinstance(v, (int, float)) and v < 0):
                continue
            self.banks.append((t, name))
            left = -int(v)
            for p in self.pending:
                if left <= 0:
                    break
                if p[1] == name and p[2] > 0 and (start - p[0]).total_seconds() <= BANK_SLACK_BEFORE_S and (p[0] - t).total_seconds() <= BANK_SLACK_AFTER_S:
                    k = min(left, p[2]); p[2] -= k; left -= k; self.n['banked'] += k

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
    assert KITRE.match('peaceful kit ON: swords=bank,no_craft,no_chase compost=plants mode=auto difficulty=peaceful active=1').groups() == ('ON', 'auto', 'peaceful', '1')
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
    # took_last
    assert took_last({'name': 'deposit', 'inventory_delta': {'stone_sword': -1}}, {'cobblestone': 3}, SWORD) == ['stone_sword']
    assert took_last({'name': 'deposit', 'inventory_delta': {'stone_sword': -1}}, {'stone_sword': 1}, SWORD) == []
    assert took_last({'name': 'deposit', 'inventory_delta': {'raw_copper': -7}}, {'dirt': 1}, ANY) == ['raw_copper']
    # reserves
    assert reserve_breaches({'oak_sapling': 4, 'apple': 6}, {'oak_sapling': 16, 'apple': 4}) == []
    assert reserve_breaches({'oak_sapling': 5}, {'oak_sapling': 15}) == [('oak_sapling', 15)]
    assert reserve_breaches({'apple': 7}, {'apple': 3}) == [('apple', 3)]
    # composted_in / off_list
    assert composted_in({'wildflowers': 3, 'leaf_litter': 2}, KIT) == ['wildflowers']
    assert off_list({'bread': 1, 'wildflowers': 2, 'oak_sapling': 3}, BASE | KIT | {'apple'}) == ['bread']
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
    assert len(KIT) == 30 and not (KIT & BASE) and 'dried_kelp' not in KIT
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
rows_walked = Counter(); bots_seen = defaultdict(set)
tw = defaultdict(lambda: [0.0] * 6)   # (period, arm) -> [seconds, at>=34, slots, sword slots, kit slots, plant+food slots]
kitrows = Counter(); offbuild = 0
B = {k: [] for k in ('K0', 'K1', 'K2c', 'K3', 'K4', 'K5', 'K6')}
inst = Counter(); ctl = Counter(); unjudged = Counter(); x1 = set(); x2 = set(); banked = Counter(); composted_kit = Counter(); incomplete = Counter()
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
        if inv:
            s['pre_inv'] = inv   # the bag at the cutoff: X1's ceiling is the canary bots holding a usable sword then
        continue
    # the ledgers (post only; the first post snapshot is the baseline)
    if k == '_death':
        deaths.append((arm, b, str(t)[11:19])); s['last_death'] = t
    ledger_step(s['sw'], k, t0, t, inv, delta); ledger_step(s['pk'], k, t0, t, inv, delta)
    if k in BANK_ROWS:
        took = took_last(sk, inv, SWORD)
        if took and (arm == 'control' or s['active'] != '1'):
            B['K3'].append((arm, b, str(t)[11:19], took, s['active']))
        if arm == 'control' and took_last(sk, inv, ANY):
            inst['K3'] += 1
        sw_out = {n: -int(v) for n, v in delta.items() if SWORD.search(n) and isinstance(v, (int, float)) and v < 0}
        if arm == 'canary' and s['active'] == '1' and sw_out:
            x1.add(b); banked.update(sw_out)
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
        res = reserve_breaches(items, inv) if judged and (any(SAPLING.search(n) for n in items) or 'apple' in items) else None
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
holders = sorted(b for b, s in st.items() if pool_of(b) in CANS and any(SWORD.search(n) and v for n, v in (s.get('pre_inv') or {}).items()))
exposure = int(live >= 1 and len(x1) >= X1_MIN and len(x2) >= X2_MIN)
print('rows walked pre %s post %s | canary %s sha %s cutoff %s window +%d min | bot-h %s' % (
    {a: rows_walked[('pre', a)] for a in ('canary', 'control')}, {a: rows_walked[('post', a)] for a in ('canary', 'control')},
    sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W, {'%s/%s' % k_: round(v, 1) for k_, v in sorted(bh.items())}))
print('bots post canary %d control %d' % (len(bots_seen[('post', 'canary')]), len(bots_seen[('post', 'control')])))
print('-' * 78)
print('LIVENESS     canary _peaceful_kit active=1 rows %d (>= 1) | control kit rows %d (must be 0) | other build %d' % (live, ctl_rows, offbuild))
print('CORRECTNESS  K0 mode %d | K1 sword crafted while active %d | K2 swords lost %d (canary lost %d %s, control lost %d; composted %d) | K3 last sword banked while off %d' % (
    len(B['K0']), len(B['K1']), k2, can_lost, lost_by_bot, ctl_lost, len(B['K2c']), len(B['K3'])))
print('             K4 reserves breached %d (canary rows %d, control rows %d) | K5 kit plant composted while off / by control %d | K6 off-list composted %d' % (
    k4, len(B['K4']), ctl['K4'], len(B['K5']), len(B['K6'])))
print('INSTRUMENT   K1 control tool crafts %d (control sword crafts %d) | K2 control pickaxe falls explained by a bank row %d (ledger %s; CALIBRATION lost within 60 s after a same-name bank row %d, expected ~0)' % (
    inst['K1'], ctl['sword_crafts'], inst['K2'], dict(L[('control', 'pk')]), L[('control', 'pk')]['lost_after_bank']))
print('             K3 control bank rows that emptied a name %d | K4 control compost rows with the reserve check evaluated %d | K5 control rows composting base/sapling/apple %d | K6 control rows off the BASE list %d' % (
    inst['K3'], inst['K4'], inst['K5'], inst['K6']))
print('LEDGERS      swords canary %s control %s | compost rows incomplete (cut list / interrupted insert): canary %d control %d | reserve not judged (incomplete, aborted, empty bag, death): canary %d control %d' % (
    dict(L[('canary', 'sw')]), dict(L[('control', 'sw')]), incomplete['canary'], incomplete['control'], unjudged['canary'], unjudged['control']))
print('EXPOSURE     X1 canary BOTS whose bank row took a sword while active %d (>= %d; ceiling: %d canary bots held a sword at the cutoff) | X2 canary BOTS that composted a kit plant %d (>= %d) | ready %d' % (
    len(x1), X1_MIN, len(holders), len(x2), X2_MIN, exposure))
print('             swords banked %s | kit plants composted %s | control compost visits holding a kit plant %d' % (
    dict(banked), dict(composted_kit.most_common(8)), ctl['visits_holding_kit']))
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
        'breach_mode': len(B['K0']), 'breach_sword_craft': len(B['K1']), 'breach_sword_lost': k2, 'breach_bank_off': len(B['K3']),
        'breach_reserve': k4, 'breach_compost_off': len(B['K5']), 'breach_off_list': len(B['K6']),
        'instrument_k1': inst['K1'], 'instrument_k2': inst['K2'], 'instrument_k3': inst['K3'], 'instrument_k4': inst['K4'],
        'instrument_k5': inst['K5'], 'instrument_k6': inst['K6'],
        'swords_banked_bots': len(x1), 'sword_holders_at_cut': len(holders), 'kit_compost_bots': len(x2), 'swords_banked': sum(banked.values()), 'kit_composted': sum(composted_kit.values()),
        'swords_lost_canary': can_lost, 'swords_lost_control': ctl_lost, 'sword_falls_unresolved': L[('canary', 'sw')]['unresolved'],
        'sought_swords_canary': sought[('canary', 'sought')], 'hunger_low_canary': hunger_low['canary'],
        'sword_slots_did': nan(did(3)), 'kit_slots_did': nan(did(4)), 'plant_food_slots_did': nan(did(5)),
        'slots_did': nan(did(2)), 'full_share_did': nan(did(1)),
        'exposure_ready': exposure,
    })
except Exception as e:
    print('emit failed:', e)
