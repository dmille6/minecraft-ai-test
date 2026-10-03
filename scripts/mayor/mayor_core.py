"""Shadow mayor core: every DECISION the mayor makes, as pure functions over plain dicts.

Plan: docs/reports/shadow-mayor-plan-2026-10-03.md. Observe-only. Nothing here talks to a bot.

WHY EVERYTHING IS A PURE FUNCTION. CLAUDE.md, "Test behaviour": five grep assertions passed
for the wrong reason in one day. Each decision below -- eligibility, ranking, caps, leases,
validation -- takes a snapshot dict and returns a dict, so the tests (and the mutants that
prove the tests can fail) exercise behaviour, not text.

THE SNAPSHOT IS THE CONTRACT. `build_snapshot` freezes everything a decision may read. The
deterministic mayor, the frontier engines and the scorer all read the same snapshot, and the
scorer re-runs `evaluate` on it, so "executable now" is re-checked by the same code from the
same inputs rather than trusted from whoever proposed the assignment.

ESTIMATES ARE LABELLED. Slots are counted from item counts and real stack sizes
(minecraft-data 1.21.11, stack_sizes.json), never observed; the snapshot says so. Banked
contents are UNKNOWN (there is no chest ledger), never zero -- nothing here counts the bank.
"""
import datetime
import hashlib
import json
import math
import os
import re

SCHEMA = 1
DUTIES = ('FREE_BAG', 'RESTORE_PICK', 'GET_WOOD', 'GET_IRON')
# "rank by bottleneck relief (bag, then pick prerequisites, then iron)" -- the plan's order.
DUTY_RANK = {'FREE_BAG': 0, 'RESTORE_PICK': 1, 'GET_WOOD': 2, 'GET_IRON': 3}

DEFAULTS = dict(
    total_slots=36,          # main inventory + hotbar; armour/offhand are not in the estimate
    full_slots=34,           # FREE_BAG shortage, and hygiene.mjs TRIGGER_SLOTS
    pick_low_frac=0.10,      # RESTORE_PICK: best pickaxe <= 10% or none
    stale_s=300,             # a bot not heard from in 5 min is excluded
    trap_window_s=300,       # trapped (entombed/marooned) in the last 5 min is excluded
    log_h=64, log_v=10,      # GET_WOOD: an observed log within 64 horizontal / 10 vertical
    log_age_h=6,             # ...seen within 6 h
    wood_min_free=3,         # ...and >= 3 free slots
    iron_radius=96,          # GET_IRON: observed iron_ore within 96 blocks (3-D)
    iron_age_h=24,           # older sightings are not offered (ore gets mined out)
    iron_trip_uses=32,       # stone+ pickaxe uses for the trip (an ore tunnel plans ~23)
    iron_min_free=2,         # room for ore + spoil (orepack refuses on a full bag)
    iron_target_per_bot=3,   # world held iron (raw/ore/ingot) short of 3 per live bot
    cap_per_duty=2, cap_per_world=3,
    lease_s=600, cooldown_s=900,
    bank_evidence_h=6,       # deposit is a bag remedy only on recent proof the bank accepts
    composter=False,         # FREE_BAG via composting only once the composter ships (flag)
    resource_age_h=24, max_resources=60,
    near_target=16,          # scorer: "near the target"
    # A shortage of an item is 'unknown-bank' (kept out of the scorer's unforced gap) only once WITHDRAW is
    # verified for that item: until a bot can take it back out, banked stock cannot relieve the shortage, so
    # held stock is the honest measure and the shortage is definite. One switch per item.
    withdraw_verified={'iron': False, 'wood': False},
    # DECISION 2026-10-03: iron stays unknown-bank anyway (conservative), so no iron gap is claimed from
    # held iron alone. Remove 'iron' here to apply the rule above strictly.
    bank_unknown_conservative=('iron',),
)
SHORTAGE_ITEM = {'GET_IRON': 'iron', 'GET_WOOD': 'wood'}

TOOL_RE = re.compile(r'_(pickaxe|axe|shovel|hoe|sword)$')
PICK_TIER = {'wooden_pickaxe': 0, 'golden_pickaxe': 0, 'stone_pickaxe': 1, 'copper_pickaxe': 1,
             'iron_pickaxe': 2, 'diamond_pickaxe': 3, 'netherite_pickaxe': 4}
LOG_RE = re.compile(r'(_log|_wood|_stem|_hyphae)$')
FILLER_RUNGS = {'stockpile_wood', 'stockpile_stone', 'patrol', 'deposit_surplus', 'return', 'idle'}
IRON_ITEMS = ('raw_iron', 'iron_ore', 'deepslate_iron_ore', 'iron_ingot')
IRON_RESOURCES = ('iron_ore', 'deepslate_iron_ore')
COBBLE = ('cobblestone', 'cobbled_deepslate', 'blackstone')
# bots/src/hygiene.mjs NEVER_KEEP (main @0e4f5c8): worth nothing in any quantity
NEVER_KEEP = frozenset((
    'leaf_litter', 'egg', 'brown_egg', 'blue_egg', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds',
    'pumpkin_seeds', 'flint', 'ink_sac', 'glow_ink_sac', 'pointed_dripstone', 'dead_bush', 'short_grass',
    'tall_grass', 'fern', 'large_fern', 'poppy', 'dandelion', 'vine', 'seagrass', 'rail'))
# bots/src/composter.mjs COMPOST_CHANCE keys (branch composter-on-3edf1d6 @6b9424e, NOT shipped)
COMPOSTABLE = frozenset(('leaf_litter', 'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
                         'poppy', 'dandelion', 'short_grass', 'seagrass', 'tall_grass', 'fern',
                         'large_fern', 'vine'))
# bots/src/bankable.mjs DEPOSIT_VALUE + DEPOSIT_ALWAYS
BANKABLE = frozenset(('diamond', 'iron_ingot', 'raw_iron', 'iron_ore', 'coal', 'oak_log', 'birch_log',
                      'jungle_log', 'oak_planks', 'stick', 'stone', 'cobbled_deepslate', 'cobblestone',
                      'deepslate_iron_ore', 'raw_copper', 'copper_ingot', 'raw_gold', 'gold_ingot',
                      'redstone', 'lapis_lazuli', 'emerald', 'amethyst_shard'))
SCAFFOLD_KEEP_SLOTS = 1    # a deposit leaves a scaffold reserve behind (bankable.mjs scaffoldKeep)


# ---------------------------------------------------------------- identity ----------

def world_key(pool, bot=None):
    """exp.pool -> world. Shared pools ARE the world ('hive-a'); isolated bots write
    'self-isolated-a-Alpha' (verified in live rows 10-03), so strip 'self-' and the bot suffix."""
    if not pool:
        return bot.rsplit('-', 1)[0] if bot and '-' in bot else None
    if pool.startswith('self-'):
        name = pool[5:]
        return name.rsplit('-', 1)[0] if '-' in name else name
    return pool


def parse_ts(s):
    """'2026-10-03T02:31:38.024Z' -> epoch ms (UTC). Hand-parsed: far cheaper than strptime per row."""
    try:
        y, mo, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        h, mi, sec = int(s[11:13]), int(s[14:16]), float(s[17:].rstrip('Z') or 0)
    except (TypeError, ValueError, IndexError):
        return None
    y2 = y - (mo <= 2)                      # days-from-civil (H. Hinnant)
    era = (y2 if y2 >= 0 else y2 - 399) // 400
    yoe = y2 - era * 400
    doy = (153 * (mo + (-3 if mo > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days = era * 146097 + doe - 719468
    return int(((days * 24 + h) * 60 + mi) * 60000 + round(sec * 1000))


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ---------------------------------------------------------------- items -------------

_STACK = None


def _stack_table():
    global _STACK
    if _STACK is None:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stack_sizes.json')
        try:
            with open(p) as f:
                d = json.load(f)
            _STACK = (d.get('sizes') or {}, int(d.get('default', 64)), d.get('_source', p))
        except (OSError, ValueError):
            _STACK = ({}, 64, 'fallback rules only (stack_sizes.json unreadable)')
    return _STACK


def stack_size(name):
    sizes, default, _ = _stack_table()
    if name in sizes:
        return sizes[name]
    # fallback rules for names minecraft-data 1.21.11 does not list
    if TOOL_RE.search(name) or re.search(r'_(helmet|chestplate|leggings|boots)$|_bucket$|^bucket$|potion|_boat$', name):
        return 1
    if re.search(r'egg$|^snowball$|_sign$|_banner$|^ender_pearl$', name):
        return 16
    return default


def slots_estimate(inventory):
    """Occupied slots, ESTIMATED: sum of ceil(count / stack size). The logged inventory is
    counts per item name, so partial stacks split across slots make this a LOWER bound."""
    n = 0
    for name, c in (inventory or {}).items():
        if isinstance(c, (int, float)) and c > 0:
            n += math.ceil(c / max(1, stack_size(name)))
    return n


def pickaxes(tools):
    """Every pickaxe copy with uses left > 0 (a copy at 0 already broke on the server)."""
    out = []
    for name, copies in (tools or {}).items():
        if not name.endswith('_pickaxe'):
            continue
        for c in copies or []:
            mx, used = c.get('max'), c.get('used')
            if not isinstance(mx, (int, float)) or not isinstance(used, (int, float)) or mx <= 0:
                continue
            left = mx - used
            if left > 0:
                out.append({'name': name, 'uses_left': int(left), 'max': int(mx),
                            'frac': round(left / mx, 4), 'tier': PICK_TIER.get(name, 0)})
    out.sort(key=lambda p: (-p['frac'], -p['tier'], p['name']))
    return out


def _uses_left(c):
    try:
        return c['max'] - c['used']
    except (KeyError, TypeError):
        return None


def bot_features(row_bot, cfg=DEFAULTS):
    """Everything an eligibility rule reads, from one telemetry row's `bot` object."""
    inv = {k: v for k, v in (row_bot.get('inventory') or {}).items() if isinstance(v, (int, float)) and v > 0}
    tools = row_bot.get('tools')
    slots = slots_estimate(inv)
    picks = pickaxes(tools)
    best = picks[0] if picks else None
    if tools is None and any(k.endswith('_pickaxe') for k in inv):
        pick_state = 'unknown'          # a pickaxe held but no durability logged
    elif best is None:
        pick_state = 'none'
    elif best['frac'] <= cfg['pick_low_frac']:
        pick_state = 'low'
    else:
        pick_state = 'ok'
    logs = sum(c for k, c in inv.items() if LOG_RE.search(k))
    planks = sum(c for k, c in inv.items() if k.endswith('_planks'))
    sticks = inv.get('stick', 0)
    spent_other = sum(1 for name, copies in (tools or {}).items() if re.search(r'_(axe|shovel|hoe)$', name)
                      and not name.endswith('_pickaxe') for c in copies or [] if _uses_left(c) == 1)
    spent_picks = sum(1 for name, copies in (tools or {}).items() if name.endswith('_pickaxe')
                      for c in copies or [] if _uses_left(c) == 1)
    junk = {k: c for k, c in inv.items() if k in COMPOSTABLE and k in NEVER_KEEP}
    return {
        'slots_est': slots, 'free_slots_est': max(0, cfg['total_slots'] - slots),
        'pick_state': pick_state, 'best_pick': best,
        'stone_pick_uses': max([p['uses_left'] for p in picks if p['tier'] >= 1], default=0),
        'logs': int(logs), 'planks': int(planks), 'sticks': int(sticks),
        'log_eq': round(logs + planks / 4 + sticks / 8, 2),
        'cobble': int(sum(inv.get(k, 0) for k in COBBLE)),
        'iron_units': int(sum(inv.get(k, 0) for k in IRON_ITEMS)),
        'has_table': inv.get('crafting_table', 0) > 0,
        # hygiene.mjs: wear out spent axes/shovels/hoes, and spent pickaxes beyond the 3 kept
        'wear_out_tools': spent_other + max(0, spent_picks - 3),
        'compost_items': int(sum(junk.values())),
        'compost_slots': sum(math.ceil(c / stack_size(k)) for k, c in junk.items()),
        'bank_slots': sum(math.ceil(c / stack_size(k)) for k, c in inv.items() if k in BANKABLE),
        'ballast_slots': sum(math.ceil(c / stack_size(k)) for k, c in inv.items() if k in NEVER_KEEP),
    }


# ---------------------------------------------------------------- telemetry ingest --

TRAP_PREFIXES = ('_entombed', '_marooned')


def parse_milestone(name, detail):
    """'_milestone_complete': 'completed A#1; now B#1' -> 'B'; '_milestone_skipped': '... moved on to B#1' -> 'B'."""
    if not detail:
        return None
    pat = {'_milestone_complete': r'now (\w+)', '_milestone_skipped': r'moved on to (\w+)'}.get(name)
    m = re.search(pat, detail) if pat else None
    return m.group(1) if m else None


class BotState:
    """Bounded per-bot state. Never holds a row list: memory is O(bots), not O(rows)."""
    __slots__ = ('name', 'world', 'pool', 'last_ms', 'full', 'full_ms', 'trap_ms', 'trap_kind',
                 'skills', 'milestone', 'version', 'rows')

    def __init__(self, name):
        self.name, self.world, self.pool = name, None, None
        self.last_ms = self.full_ms = self.trap_ms = None
        self.full = self.trap_kind = self.milestone = self.version = None
        self.skills, self.rows = [], 0


class WorldEvidence:
    __slots__ = ('deposit_ok_ms', 'chest_full_ms')

    def __init__(self):
        self.deposit_ok_ms = self.chest_full_ms = None


MAX_SKEW_MS = 60000


def ingest(row, bots, worlds, max_skills=6, now_ms=None, stats=None):
    """Fold one telemetry row into the bounded state. Returns the bot name or None.
    Event kinds live in skill.name, position in bot.pos (CLAUDE.md); a reflex row has no pos.
    A row stamped more than MAX_SKEW_MS after `now_ms` is REJECTED (counted in stats['future']):
    a clock that runs ahead would otherwise keep a bot 'fresh' forever."""
    b = row.get('bot') or {}
    name = b.get('name')
    t = parse_ts(row.get('@timestamp'))
    if not name or t is None:
        return None
    if now_ms is not None and t > now_ms + MAX_SKEW_MS:
        if stats is not None:
            stats['future'] = stats.get('future', 0) + 1
        return None
    s = row.get('skill') or {}
    sk, status, detail = s.get('name') or '', s.get('status'), s.get('detail') or ''
    st = bots.get(name)
    if st is None:
        st = bots[name] = BotState(name)
    st.pool = (row.get('exp') or {}).get('pool') or st.pool
    st.world = world_key(st.pool, name) or st.world
    st.rows += 1
    try:
        end = t + int(s.get('duration_ms') or 0)    # rows stamp START; the bot was alive until the end
    except (TypeError, ValueError):
        end = t
    st.last_ms = end if st.last_ms is None else max(st.last_ms, end)
    st.version = (row.get('code') or {}).get('version') or st.version
    # a STATE row needs BOTH a valid position and an inventory object: a row with a position and no
    # inventory must not stand in for one with an empty bag
    if _valid_pos(b.get('pos')) and isinstance(b.get('inventory'), dict) and (st.full_ms is None or end >= st.full_ms):
        st.full = {'pos': b.get('pos'), 'health': b.get('health'), 'hunger': b.get('hunger'),
                   'held': b.get('held'), 'inventory': b['inventory'], 'tools': b.get('tools'),
                   'dimension': (row.get('game') or {}).get('dimension') or 'overworld'}
        st.full_ms = end
    if sk.startswith(TRAP_PREFIXES) and status != 'success' and (st.trap_ms is None or t >= st.trap_ms):
        st.trap_ms, st.trap_kind = t, sk
    if sk in ('_milestone_complete', '_milestone_skipped'):
        st.milestone = parse_milestone(sk, detail) or st.milestone
    if sk and not sk.startswith('_'):
        a = s.get('args') or {}
        st.skills.append({'t': iso(t), 'name': sk, 'status': status,
                          'arg': a.get('block') or a.get('item') or (('y=%s' % a['y']) if 'y' in a else None),
                          'detail': detail[:100]})
        if len(st.skills) > max_skills:
            del st.skills[0]
    if sk == 'deposit' and st.world:
        w = worlds.setdefault(st.world, WorldEvidence())
        if 'chest is full' in detail and status != 'success':
            w.chest_full_ms = max(w.chest_full_ms or 0, t)
        elif status == 'success' and detail.startswith('deposited'):
            w.deposit_ok_ms = max(w.deposit_ok_ms or 0, t)
    return name


def bank_view(ev, now_ms, cfg=DEFAULTS):
    """Does this world's bank accept deposits? Only on recent PROOF: a deposit succeeded within
    bank_evidence_h and no 'chest is full' since. Absence of evidence is 'unknown', not 'yes'."""
    win = cfg['bank_evidence_h'] * 3.6e6
    ok = ev and ev.deposit_ok_ms and now_ms - ev.deposit_ok_ms <= win
    full = ev and ev.chest_full_ms and now_ms - ev.chest_full_ms <= win
    if ok and not (full and ev.chest_full_ms >= ev.deposit_ok_ms):
        return {'accepts_recently': True, 'why': 'deposit succeeded %s' % iso(ev.deposit_ok_ms)}
    if full:
        return {'accepts_recently': False, 'why': "'chest is full' %s" % iso(ev.chest_full_ms)}
    return {'accepts_recently': False, 'why': 'no deposit evidence in %dh (bank contents UNKNOWN)' % cfg['bank_evidence_h']}


def bot_view(st, now_ms, cfg=DEFAULTS):
    """BotState -> the snapshot's view of one bot (without its B-id)."""
    full = st.full or {}
    age = None if st.last_ms is None else round((now_ms - st.last_ms) / 1000)
    pos_age = None if st.full_ms is None else round((now_ms - st.full_ms) / 1000)
    # FRESH = a STATE-BEARING row (position + inventory) within stale_s, and not from the future.
    # A reflex row says the process is alive; it says nothing about where the bot is or what it holds.
    v = {
        'name': st.name,
        'fresh': st.full is not None and pos_age is not None and -MAX_SKEW_MS / 1000 <= pos_age <= cfg['stale_s'],
        'age_s': age, 'pos_age_s': pos_age,
        'pos': full.get('pos'), 'dimension': full.get('dimension'),
        'health': full.get('health'), 'hunger': full.get('hunger'), 'held': full.get('held'),
        'inventory': full.get('inventory') or {},
        'code_version': st.version, 'milestone': st.milestone,
        'last_skills': list(st.skills), 'trap_kind': st.trap_kind,
        'trap_s_ago': None if st.trap_ms is None else round((now_ms - st.trap_ms) / 1000),
    }
    v['trapped'] = v['trap_s_ago'] is not None and v['trap_s_ago'] <= cfg['trap_window_s']
    v.update(bot_features({'inventory': full.get('inventory'), 'tools': full.get('tools')}, cfg))
    return v


# ---------------------------------------------------------------- resources ---------

def res_key(r):
    """A sighting's STABLE identity: kind and block coordinates. R-ids are renumbered every snapshot."""
    return '%s@%s,%s,%s' % (r['kind'], r['x'], r['y'], r['z'])


def merge_resources(facts_list, now_ms, cfg=DEFAULTS):
    """world-facts `resources` (sightings, not reachability; each file capped at 200) from one or
    more files -> deduplicated log/iron sightings with age. Isolated worlds pass five files.
    A sighting whose `last` is AFTER now_ms is dropped: in a replay it is lookahead (the facts file
    is today's), live it is clock skew. Either way the snapshot could not have known it."""
    seen = {}
    for facts in facts_list:
        for r in (facts or {}).get('resources') or []:
            kind = r.get('kind') or ''
            if not (LOG_RE.search(kind) or kind in IRON_RESOURCES):
                continue
            key = (kind, r.get('x'), r.get('y'), r.get('z'))
            if None in key[1:]:
                continue
            if key not in seen or (r.get('last') or 0) > (seen[key].get('last') or 0):
                seen[key] = r
    out = []
    for (kind, x, y, z), r in seen.items():
        if not r.get('last') or r['last'] > now_ms:
            continue
        age_h = round((now_ms - r['last']) / 3.6e6, 2)
        if age_h <= cfg['resource_age_h']:
            out.append({'kind': kind, 'x': x, 'y': y, 'z': z, 'count': r.get('count'), 'age_h': age_h})
    return out


def hdist(a, b):
    return math.hypot(a['x'] - b['x'], a['z'] - b['z'])


def dist3(a, b):
    return math.sqrt((a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2 + (a['z'] - b['z']) ** 2)


# ---------------------------------------------------------------- snapshot ----------

def build_snapshot(world, views, resources, now_ms, bank, cfg=DEFAULTS, meta=None):
    """One immutable per-world snapshot: bots B1.., resources R1.., shortages S1.., candidates C1.."""
    bots = [dict(v, id='B%d' % i) for i, v in enumerate(sorted(views, key=lambda v: v['name']), 1)]
    fresh_pos = [b['pos'] for b in bots if b['fresh'] and b.get('pos')]

    def nearest(r):
        return min((dist3(r, p) for p in fresh_pos), default=1e9)
    res = sorted(resources, key=lambda r: (nearest(r), r['kind'], r['x'], r['y'], r['z']))
    kept, dropped = res[:cfg['max_resources']], max(0, len(res) - cfg['max_resources'])
    kept.sort(key=lambda r: (r['kind'], r['x'], r['y'], r['z']))
    snap = {
        'schema': SCHEMA, 'world': world, 't': iso(now_ms), 't_ms': now_ms,
        'snap_id': '%s@%s' % (world, iso(now_ms)),
        'estimates': 'slots_est/free_slots_est are ESTIMATES from item counts and stack sizes (%s); '
                     'bank contents are UNKNOWN, never 0' % _stack_table()[2],
        'bank': bank, 'cfg': {k: cfg[k] for k in sorted(cfg)},
        'bots': bots, 'resources': [dict(r, id='R%d' % i, key=res_key(r)) for i, r in enumerate(kept, 1)],
        'resources_dropped': dropped,
    }
    if meta:
        snap['meta'] = meta
    snap['shortages'] = shortages(snap, cfg)
    snap['candidates'] = candidates(snap, cfg)
    return snap


def shortages(snap, cfg=DEFAULTS):
    """What the world is short of, from FRESH bots only (a stale bot's state is unknown)."""
    live = [b for b in snap['bots'] if b['fresh']]
    out = []
    for b in live:
        if b['slots_est'] >= cfg['full_slots']:
            out.append({'duty': 'FREE_BAG', 'scope': 'bot', 'bot': b['id'], 'value': b['slots_est'],
                        'threshold': cfg['full_slots'], 'why': 'est. %d of %d slots used' % (b['slots_est'], cfg['total_slots'])})
    for b in live:
        if b['pick_state'] in ('none', 'low'):
            frac = b['best_pick']['frac'] if b['best_pick'] else 0
            out.append({'duty': 'RESTORE_PICK', 'scope': 'bot', 'bot': b['id'], 'value': frac,
                        'threshold': cfg['pick_low_frac'], 'why': 'best pickaxe %s' % (
                            'none' if not b['best_pick'] else '%s at %.0f%%' % (b['best_pick']['name'], frac * 100))})
    no_pick = sum(1 for b in live if b['pick_state'] in ('none', 'low'))
    wood, need = round(sum(b['log_eq'] for b in live), 2), 2 * no_pick + 1
    if live and wood < need:
        out.append({'duty': 'GET_WOOD', 'scope': 'world', 'bot': None, 'value': wood, 'threshold': need,
                    'why': 'held wood %.2f log-eq < 2 x %d bots without a pickaxe + 1 (banked wood UNKNOWN)' % (wood, no_pick)})
    iron, target = sum(b['iron_units'] for b in live), cfg['iron_target_per_bot'] * len(live)
    if live and iron < target:
        out.append({'duty': 'GET_IRON', 'scope': 'world', 'bot': None, 'value': iron, 'threshold': target,
                    'why': 'held iron %d < %d (%d per live bot; banked iron UNKNOWN)' % (iron, target, cfg['iron_target_per_bot'])})
    for i, s in enumerate(out, 1):
        s['id'] = 'S%d' % i
        # 'unknown-bank' shortages stay out of the scorer's unforced gap: see withdraw_verified in DEFAULTS
        s['certainty'] = certainty(s['duty'], cfg)
    return out


def certainty(duty, cfg=DEFAULTS):
    """'unknown-bank' once withdraw is verified for the item (or by the conservative exception), else 'definite'."""
    item = SHORTAGE_ITEM.get(duty)
    if item and ((cfg.get('withdraw_verified') or {}).get(item) or item in (cfg.get('bank_unknown_conservative') or ())):
        return 'unknown-bank'
    return 'definite'


def _valid_pos(p):
    return isinstance(p, dict) and all(isinstance(p.get(k), (int, float)) and not isinstance(p.get(k), bool)
                                       for k in ('x', 'y', 'z'))


def _blk(code, detail, remedy=None):
    """A refusal names a remedy the bot can perform from where it is (CLAUDE.md), or says there is none."""
    return {'code': code, 'detail': detail, 'remedy': remedy or 'none from here'}


def evaluate(duty, bot, snap, cfg=DEFAULTS):
    """THE HARD EXECUTABILITY FILTER -> (feasible, blockers, targets, extra) for one bot and duty,
    read only from the snapshot. The deterministic mayor, the validator and the scorer all use it."""
    blockers, targets, extra = [], [], {}
    if not bot.get('fresh'):
        blockers.append(_blk('stale', 'last heard %ss ago (> %ss)' % (bot.get('age_s'), cfg['stale_s'])))
    if bot.get('trapped'):
        blockers.append(_blk('trapped', '%s %ss ago' % (bot.get('trap_kind'), bot.get('trap_s_ago')),
                             "the bot's own escape reflex"))
    if bot.get('dimension') not in (None, 'overworld'):
        blockers.append(_blk('dimension', str(bot.get('dimension'))))
    pos = bot.get('pos')
    if duty == 'FREE_BAG':
        methods = []
        if bot['wear_out_tools'] > 0:
            methods.append({'method': 'wear_out', 'frees_slots_est': bot['wear_out_tools']})
        if cfg['composter'] and bot['compost_items'] > 0:
            methods.append({'method': 'compost', 'frees_slots_est': bot['compost_slots']})
        bank = snap.get('bank') or {}
        dep_free = max(0, bot['bank_slots'] - SCAFFOLD_KEEP_SLOTS)
        if dep_free > 0 and bank.get('accepts_recently'):
            methods.append({'method': 'deposit', 'frees_slots_est': dep_free})
        extra['methods'] = methods
        if not methods:
            why = []
            if bot['ballast_slots']:
                why.append('%d slots of ballast need the composter (%s)' % (
                    bot['ballast_slots'], 'flag on, none compostable' if cfg['composter'] else 'not shipped'))
            if dep_free > 0 and not bank.get('accepts_recently'):
                why.append('bank not known to accept: %s' % bank.get('why', 'no evidence'))
            blockers.append(_blk('no_disposal', '; '.join(why) or 'nothing disposable held',
                                 'none until a disposal ships'))
    elif duty == 'GET_WOOD':
        if bot['free_slots_est'] < cfg['wood_min_free']:
            blockers.append(_blk('no_room', 'est. %d free slots < %d' % (bot['free_slots_est'], cfg['wood_min_free']), 'FREE_BAG'))
        if pos:
            near = [r for r in snap['resources'] if LOG_RE.search(r['kind']) and r['age_h'] <= cfg['log_age_h']
                    and hdist(r, pos) <= cfg['log_h'] and abs(r['y'] - pos['y']) <= cfg['log_v']]
            near.sort(key=lambda r: (hdist(r, pos), r['id']))
            targets = [r['id'] for r in near]
            if near:
                extra['dist'] = round(hdist(near[0], pos), 1)
            else:
                blockers.append(_blk('no_log_near', 'no log sighting within %d h / %d v seen in %dh' % (
                    cfg['log_h'], cfg['log_v'], cfg['log_age_h']), "the bot's own explore"))
        else:
            blockers.append(_blk('no_pos', 'position unknown'))
    elif duty == 'RESTORE_PICK':
        planks_avail = bot['logs'] * 4 + bot['planks']
        need_table = 0 if bot['has_table'] else 4      # "a table in reach or craftable": held, or 4 planks
        need_sticks = 0 if bot['sticks'] >= 2 else 2
        if bot['cobble'] >= 3 and planks_avail >= need_sticks + need_table:
            extra['recipe'] = 'stone_pickaxe'
        elif planks_avail >= 3 + need_sticks + need_table:
            extra['recipe'] = 'wooden_pickaxe'
        else:
            blockers.append(_blk('no_ingredients', 'short %d planks for a wooden pickaxe%s; banked wood not retrievable '
                                 '(withdraw unverified)' % (3 + need_sticks + need_table - planks_avail,
                                                            '' if bot['has_table'] else ' + table'), 'GET_WOOD'))
    elif duty == 'GET_IRON':
        if bot['stone_pick_uses'] < cfg['iron_trip_uses']:
            blockers.append(_blk('no_trip_pick', 'stone+ pickaxe uses %d < %d' % (bot['stone_pick_uses'], cfg['iron_trip_uses']),
                                 'RESTORE_PICK'))
        if bot['free_slots_est'] < cfg['iron_min_free']:
            blockers.append(_blk('no_room', 'est. %d free slots < %d' % (bot['free_slots_est'], cfg['iron_min_free']), 'FREE_BAG'))
        if pos:
            near = [r for r in snap['resources'] if r['kind'] in IRON_RESOURCES and r['age_h'] <= cfg['iron_age_h']
                    and dist3(r, pos) <= cfg['iron_radius']]
            near.sort(key=lambda r: (dist3(r, pos), r['id']))
            targets = [r['id'] for r in near]
            if near:
                extra['dist'] = round(dist3(near[0], pos), 1)
            else:
                blockers.append(_blk('no_iron_near', 'no iron_ore sighting within %d blocks' % cfg['iron_radius'],
                                     "the bot's own explore"))
        else:
            blockers.append(_blk('no_pos', 'position unknown'))
    else:
        raise ValueError('unknown duty %r' % duty)
    return (not blockers), blockers, targets, extra


def candidates(snap, cfg=DEFAULTS):
    """Every (bot, duty) a shortage makes relevant, feasible or not, with its blockers."""
    by_id = {b['id']: b for b in snap['bots']}
    pairs = []
    for s in snap['shortages']:
        if s['scope'] == 'bot':
            pairs.append((s['duty'], by_id[s['bot']], s['id']))
        else:
            pairs += [(s['duty'], b, s['id']) for b in snap['bots']]
    out = []
    for duty, b, sid in sorted(pairs, key=lambda p: (DUTY_RANK[p[0]], p[1]['name'])):
        ok, blockers, targets, extra = evaluate(duty, b, snap, cfg)
        out.append({'duty': duty, 'bot': b['id'], 'bot_name': b['name'], 'shortage': sid, 'feasible': ok,
                    'blockers': blockers, 'targets': targets, 'target': targets[0] if targets else None,
                    'dist': extra.get('dist'), 'methods': extra.get('methods'), 'recipe': extra.get('recipe')})
    for i, c in enumerate(out, 1):
        c['id'] = 'C%d' % i
    return out


def rank_key(c, bots_by_id):
    """Bottleneck relief, distance, tool uses, free room, filler/idle rung first, stable tie-break."""
    b = bots_by_id[c['bot']]
    filler = 0 if (b.get('milestone') is None or b.get('milestone') in FILLER_RUNGS) else 1
    return (DUTY_RANK[c['duty']], c['dist'] if c['dist'] is not None else 0.0,
            -(b['best_pick']['uses_left'] if b.get('best_pick') else 0), -b['free_slots_est'], filler, b['name'])


# ---------------------------------------------------------------- deterministic mayor ---

def duty_done(duty, start, bot, world_needs, cfg=DEFAULTS):
    """Was the duty done? Read from STATE, never from a skill's status (intent rows are not outcomes)."""
    if duty == 'FREE_BAG':
        return bot['slots_est'] < cfg['full_slots']
    if duty == 'RESTORE_PICK':
        return bot['pick_state'] == 'ok'
    if duty == 'GET_WOOD':
        return bot['logs'] >= start.get('start_logs', 0) + 1 or 'GET_WOOD' not in world_needs
    if duty == 'GET_IRON':
        return bot['iron_units'] >= start.get('start_iron', 0) + 1 or 'GET_IRON' not in world_needs
    return False


def _lease_assign(c, name, tgt, lease, since_ms, reason):
    return {'candidate_id': c['id'], 'bot': c['bot'], 'bot_name': name, 'duty': c['duty'], 'target': tgt,
            'lease': lease, 'lease_since': iso(since_ms), 'reason': reason,
            'evidence': [c['shortage'], c['bot']] + ([tgt] if tgt else [])}


def decide(snap, state=None, cfg=DEFAULTS):
    """The deterministic mayor -> (assign_record, new_state). Pure: state in, state out.
    state = {'leases': {bot_name: {...}}, 'cooldowns': {'bot|duty': until_ms}}"""
    now = snap['t_ms']
    state = json.loads(json.dumps(state or {}))
    leases, cool = state.setdefault('leases', {}), state.setdefault('cooldowns', {})
    for k in [k for k, until in cool.items() if until <= now]:
        del cool[k]
    bots = {b['id']: b for b in snap['bots']}
    by_name = {b['name']: b for b in snap['bots']}
    cands = snap['candidates']
    cand_by_id = {c['id']: c for c in cands}
    cand_of = {(c['bot_name'], c['duty']): c for c in cands}
    world_needs = {s['duty'] for s in snap['shortages'] if s['scope'] == 'world'}
    id_of_key = {(r.get('key') or res_key(r)): r['id'] for r in snap['resources']}
    key_of_id = {v: k for k, v in id_of_key.items()}
    released, assigns = [], []
    taken_bots, taken_targets, per_duty = set(), set(), {}

    def release(name, L, why):
        released.append({'bot': name, 'duty': L['duty'], 'why': why, 'held_s': round((now - L['since_ms']) / 1000)})
        # an ABANDONED duty cools down before it is offered again; a lease the mayor itself trimmed
        # (conflict, over_cap) or that succeeded (done) does not
        if why in ('failed', 'expired', 'target_lost'):
            cool['%s|%s' % (name, L['duty'])] = now + cfg['cooldown_s'] * 1000
        del leases[name]

    # 1. leases, OLDEST first: done / failed / expired / target_lost, then the same uniqueness and caps
    #    as a new assignment (conflict, over_cap), else HELD -- hysteresis: a better-ranked bot does
    #    not bump it. The lease holds a PLACE (target_key = kind@x,y,z), re-resolved to this tick's R-id.
    for name in sorted(leases, key=lambda n: (leases[n].get('since_ms', 0), n)):
        L = leases[name]
        b, c = by_name.get(name), cand_of.get((name, L['duty']))
        if b is not None and b['fresh'] and duty_done(L['duty'], L, b, world_needs, cfg):
            release(name, L, 'done')
            continue
        if b is None or c is None or not c['feasible']:
            release(name, L, 'failed')
            continue
        if now - L['since_ms'] >= cfg['lease_s'] * 1000:
            release(name, L, 'expired')
            continue
        tgt = None
        if c['targets']:
            tgt = id_of_key.get(L.get('target_key'))
            if tgt is None or tgt not in c['targets']:
                release(name, L, 'target_lost')
                continue
            if tgt in taken_targets:
                release(name, L, 'conflict')
                continue
        if len(taken_bots) >= cfg['cap_per_world'] or per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:
            release(name, L, 'over_cap')
            continue
        L['target'] = tgt
        taken_bots.add(name)
        if tgt:
            taken_targets.add(tgt)
        per_duty[c['duty']] = per_duty.get(c['duty'], 0) + 1
        assigns.append(_lease_assign(c, name, tgt, 'held', L['since_ms'], 'lease held (%ds of %ds)' % (
            (now - L['since_ms']) // 1000, cfg['lease_s'])))

    # 2. new assignments over the ranked feasible candidates, under the caps
    skip = {}
    staffed = {cand_by_id[a['candidate_id']]['shortage'] for a in assigns}
    for c in sorted([c for c in cands if c['feasible']], key=lambda c: rank_key(c, bots)):
        why, tgt = None, None
        if c['bot_name'] in taken_bots:
            why = 'bot_busy'
        elif '%s|%s' % (c['bot_name'], c['duty']) in cool:
            why = 'cooldown'
        elif len(taken_bots) >= cfg['cap_per_world']:
            why = 'cap_world'
        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:
            why = 'cap_duty'
        elif c['targets']:
            tgt = next((t for t in c['targets'] if t not in taken_targets), None)
            if tgt is None:
                why = 'target_taken'
        if why:
            d = skip.setdefault(c['shortage'], {})
            d[why] = d.get(why, 0) + 1
            continue
        b = bots[c['bot']]
        taken_bots.add(c['bot_name'])
        if tgt:
            taken_targets.add(tgt)
        per_duty[c['duty']] = per_duty.get(c['duty'], 0) + 1
        staffed.add(c['shortage'])
        leases[c['bot_name']] = {'duty': c['duty'], 'target': tgt, 'target_key': key_of_id.get(tgt), 'since_ms': now,
                                 'start_logs': b['logs'], 'start_iron': b['iron_units']}
        assigns.append(_lease_assign(c, c['bot_name'], tgt, 'new', now, _reason(c, b)))

    # 3. every shortage nobody staffs, with its reason
    unstaffed = []
    for s in snap['shortages']:
        if s['id'] in staffed:
            continue
        mine = [c for c in cands if c['shortage'] == s['id']]
        hist = {}
        for c in mine:
            for bl in c['blockers']:
                hist[bl['code']] = hist.get(bl['code'], 0) + 1
        unstaffed.append({'shortage': s['id'], 'duty': s['duty'], 'bot': s['bot'],
                          'reason': 'passed_over' if any(c['feasible'] for c in mine) else 'no_feasible_candidate',
                          'blockers': hist, 'passed_over': skip.get(s['id'], {}),
                          'remedies': sorted({bl['remedy'] for c in mine for bl in c['blockers']})})
    rec = {'schema': SCHEMA, 'engine': 'deterministic', 'snap_id': snap['snap_id'], 'world': snap['world'],
           't': snap['t'], 'assignments': assigns, 'unstaffed': unstaffed, 'released': released,
           'cooldowns': {k: iso(v) for k, v in sorted(cool.items())}, 'abstain': False}
    return rec, state


def _reason(c, b):
    if c['duty'] == 'FREE_BAG':
        return 'est. %d slots; %s' % (b['slots_est'], ', '.join('%s frees ~%d' % (m['method'], m['frees_slots_est'])
                                                               for m in c['methods'] or []))
    if c['duty'] == 'RESTORE_PICK':
        return 'best pickaxe %s; ingredients for a %s held' % (b['pick_state'], c['recipe'])
    if c['duty'] == 'GET_WOOD':
        return 'nearest log sighting %.0f blocks; est. %d free slots' % (c['dist'], b['free_slots_est'])
    return 'iron sighting %.0f blocks; stone+ pick %d uses; est. %d free slots' % (c['dist'], b['stone_pick_uses'], b['free_slots_est'])


def greedy(snap, order, cfg=DEFAULTS):
    """Baselines for the scorer (random-eligible, nearest): feasible candidates in `order`, same caps."""
    bots_used, targets_used, per_duty, out = set(), set(), {}, []
    for c in order:
        if not c['feasible'] or c['bot'] in bots_used or len(bots_used) >= cfg['cap_per_world'] \
                or per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:
            continue
        tgt = next((t for t in c['targets'] if t not in targets_used), None) if c['targets'] else None
        if c['targets'] and tgt is None:
            continue
        bots_used.add(c['bot'])
        if tgt:
            targets_used.add(tgt)
        per_duty[c['duty']] = per_duty.get(c['duty'], 0) + 1
        out.append({'candidate_id': c['id'], 'bot': c['bot'], 'bot_name': c['bot_name'], 'duty': c['duty'], 'target': tgt})
    return out


# ---------------------------------------------------------------- validator ---------

OUTPUT_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['assignments', 'unmet_needs', 'abstain', 'abstain_reason'],
    'properties': {
        'assignments': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['candidate_id', 'target', 'reason', 'evidence', 'confidence'],
            'properties': {'candidate_id': {'type': 'string'},
                           'target': {'type': 'string', 'description': 'one of the candidate\'s targets, or "" if it has none'},
                           'reason': {'type': 'string'},
                           'evidence': {'type': 'array', 'items': {'type': 'string'}},
                           'confidence': {'type': 'number'}}}},
        'unmet_needs': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['duty', 'reason', 'evidence'],
            'properties': {'duty': {'type': 'string', 'enum': list(DUTIES)}, 'reason': {'type': 'string'},
                           'evidence': {'type': 'array', 'items': {'type': 'string'}}}}},
        'abstain': {'type': 'boolean'}, 'abstain_reason': {'type': 'string'},
    },
}

ID_RE = re.compile(r'\b([BRSC]\d+)\b')


_TYPES = {'object': dict, 'array': list, 'string': str, 'boolean': bool}


def schema_errors(v, sch, path='$'):
    """The JSON-schema subset OUTPUT_SCHEMA uses, enforced in full. Never raises: a model's output
    is untrusted data, so every shape it can take is an answer, not an exception."""
    t = sch.get('type')
    if t == 'number':
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return ['%s:not_number' % path]
    elif t in _TYPES:
        if not isinstance(v, _TYPES[t]):
            return ['%s:not_%s' % (path, t)]
    if 'enum' in sch and v not in sch['enum']:
        return ['%s:not_in_enum' % path]
    errs = []
    if t == 'object':
        props = sch.get('properties', {})
        errs += ['%s.%s:missing' % (path, k) for k in sch.get('required', []) if k not in v]
        if sch.get('additionalProperties') is False:
            errs += ['%s.%s:unexpected' % (path, str(k)[:20]) for k in v if k not in props]
        for k, sub in props.items():
            if k in v:
                errs += schema_errors(v[k], sub, '%s.%s' % (path, k))
    elif t == 'array' and 'items' in sch:
        for i, x in enumerate(v):
            errs += schema_errors(x, sch['items'], '%s[%d]' % (path, i))
    return errs


def validate(snap, out, cfg=DEFAULTS):
    """A frontier answer -> {'valid', 'accepted', 'rejected', 'errors'}. The FULL schema is enforced
    (an assignment that breaks it is rejected; a top level that breaks it accepts nothing), then:
    unknown ids, invented places (a target or evidence id the snapshot does not hold), infeasible
    candidates, a bot or a target twice, broken caps. Any rejection makes the response invalid (a
    metric). Never raises on malformed input."""
    if not isinstance(out, dict):
        return {'valid': False, 'accepted': [], 'rejected': [], 'errors': ['$:not_object']}
    top = dict(OUTPUT_SCHEMA, properties={k: ({'type': 'array'} if k in ('assignments', 'unmet_needs') else v)
                                          for k, v in OUTPUT_SCHEMA['properties'].items()})
    errors = schema_errors(out, top)
    if errors:
        return {'valid': False, 'accepted': [], 'rejected': [], 'errors': errors[:20]}
    item_schema = OUTPUT_SCHEMA['properties']['assignments']['items']
    known = {b['id'] for b in snap['bots']} | {r['id'] for r in snap['resources']} | \
            {s['id'] for s in snap['shortages']} | {c['id'] for c in snap['candidates']}
    cands = {c['id']: c for c in snap['candidates']}
    accepted, rejected = [], []
    bots_used, targets_used, per_duty = set(), set(), {}
    for a in out['assignments']:
        bad = schema_errors(a, item_schema, '$.assignments[]')
        if bad:
            rejected.append({'item': a if isinstance(a, dict) else str(a)[:80], 'why': 'schema:' + bad[0]})
            continue
        c = cands.get(a['candidate_id'])
        tgt = a.get('target') or None
        ev = a.get('evidence') if isinstance(a.get('evidence'), list) else None
        cited = set(map(str, ev or [])) | set(ID_RE.findall(str(a.get('reason') or '')))
        conf = a.get('confidence')
        why = None
        if c is None:
            why = 'unknown_candidate'
        elif not ev:
            why = 'no_evidence'
        elif cited - known:
            why = 'unknown_evidence_id:%s' % ','.join(sorted(cited - known))
        elif not c['feasible']:
            why = 'infeasible_candidate:%s' % ','.join(bl['code'] for bl in c['blockers'])
        elif tgt is not None and tgt not in c['targets']:
            why = 'invented_or_ineligible_target:%s' % tgt
        elif tgt is None and c['targets']:
            why = 'missing_target'
        elif isinstance(conf, bool) or not isinstance(conf, (int, float)) or not 0 <= conf <= 1:
            why = 'bad_confidence'
        elif c['bot'] in bots_used:
            why = 'bot_already_assigned'
        elif tgt is not None and tgt in targets_used:
            why = 'duplicate_target'
        elif per_duty.get(c['duty'], 0) >= cfg['cap_per_duty']:
            why = 'cap_duty'
        elif len(bots_used) >= cfg['cap_per_world']:
            why = 'cap_world'
        if why:
            rejected.append({'item': a, 'why': why})
            continue
        bots_used.add(c['bot'])
        if tgt:
            targets_used.add(tgt)
        per_duty[c['duty']] = per_duty.get(c['duty'], 0) + 1
        accepted.append({'candidate_id': c['id'], 'bot': c['bot'], 'bot_name': c['bot_name'], 'duty': c['duty'],
                         'target': tgt, 'reason': str(a.get('reason'))[:500], 'evidence': ev, 'confidence': conf})
    for u in out['unmet_needs']:
        bad = schema_errors(u, OUTPUT_SCHEMA['properties']['unmet_needs']['items'], '$.unmet_needs[]')
        if bad:
            errors.append(bad[0])
        elif set(u['evidence']) - known:
            errors.append('unmet_need_unknown_evidence')
    if out.get('abstain') is True and out['assignments']:
        errors.append('abstain_with_assignments')
    return {'valid': not rejected and not errors, 'accepted': accepted, 'rejected': rejected, 'errors': errors}


def stable_hash(*parts):
    return int(hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest(), 16)
