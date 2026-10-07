#!/usr/bin/env python3
# toolhygieneread.py [window_min] -- the read for canary `toolhygiene-01` (branch th-on-c6e91a8).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (docs/reports/toolhygiene-design-2026-10-07.md; TOOL_HYGIENE=on|off, default on):
#   PART 1  admission refuses a craft of a pickaxe/crafting_table/furnace the bag already covers (toolhygiene.mjs
#           redundantCraft): never what the task wants; a pickaxe only beside a same-or-better copy with >= need uses
#           (40 for stone = the ladder's MIN_TRIP_USES, else 11) AND >= 2 usable pickaxes (the escape reserve) AND
#           enough summed swings for a descent from the bot's y (exit-contract descentPickNeed); a station when one is
#           carried. Rows: `_redundant_craft` per refusal, `_craft_admit` per admitted hygiene craft (snapshot at the
#           decision, args incl. the task's whole wanted set `wants`), `_tool_hygiene` once per process.
#   PART 2  toolFor: within a name the most-worn open pickaxe digs; a worn copy (2..10 uses) is open only beside a
#           keeper (same-or-higher tier > 10) AND two other pickaxes no deposit can take. Row: `_worn_first` (<= 1 per 10 min per
#           process) with the last changed pick's context in args {n, block, chosen, base, reason, mode, picks}.
#
#   LIVENESS     canary `_tool_hygiene` ON rows (>= 1); control rows 0.
#   CORRECTNESS  (any breach REVERTS; each re-derived HERE, by an independent implementation of the rule, from the row's
#                own snapshot -- taken in the same tick as the admission check, so exact)
#                G1 a canary `_craft_admit` the rule calls redundant (given the row's `wants`);
#                G2 a canary `_redundant_craft` the rule does not justify;
#                G3 a canary `_worn_first` whose logged context does not justify the chosen copy;
#                G4 a refusal whose own `wants` holds the item, whose task is craft_<item>_*, or whose source is a work order.
#                Exit-contract edge: snapshot y is rounded to 0.1, so a breach needs the verdict to hold at both floors.
#   POSITIVE CONTROLS  the same rule over the CONTROL's decision stream (llm-*.jsonl: START snapshot, proposal, llm.error,
#                task id) finds admitted redundant crafts (>= 1, with a 3-use margin since that snapshot precedes the
#                check by the model's latency); control best-first wear intervals (>= 1).
#   DIAGNOSTIC   wear intervals between consecutive snapshots (ordered by game.tick), unambiguous only: "fuller wore while a
#                more-worn usable copy stayed" vs "a less-full copy wore while the fullest stayed", per arm/period, with
#                denominators. Intervals touching a flooded-pocket row are excluded (that path takes the first pickaxe).
#   PRIMARY      (REPORTED) redundant crafts per bot-h DiD (decision stream, both arms, same rule), pickaxe slots/bot
#                DiD, all slots/bot DiD, share >= 34 DiD, share of bot-time under two usable pickaxes DiD, pickaxe-less
#                bot-time share, escape refusals per bot-h DiD, pickaxe breaks by use per bot-h, stone_pickaxe crafts
#                per bot-h. Time-weighted slots as foodskipread (gaps capped at 120 s).
import sys, os, json, re, glob, math, gzip
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

# ---- the rule, restated independently (toolhygiene.mjs / toolfor.mjs / exit-contract.mjs) --------------------------
FLOOR, HARD_STOP, MIN_TRIP, ESC = 10, 1, 40, 2
RANK = {'wooden': 1, 'golden': 1, 'stone': 2, 'iron': 3, 'diamond': 4, 'netherite': 5}
TIER = {'wooden': 0, 'golden': 1, 'stone': 2, 'iron': 3, 'diamond': 4, 'netherite': 5}   # toolfor TOOL_TIER index
ESC_NAMES = {'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'}
PICK_MAX = {'wooden_pickaxe': 59, 'golden_pickaxe': 32, 'stone_pickaxe': 131, 'iron_pickaxe': 250, 'diamond_pickaxe': 1561, 'netherite_pickaxe': 2031}
STATIONS = {'crafting_table', 'furnace'}
ITEMS = set(PICK_MAX) | STATIONS
INF = float('inf')
PICK = re.compile(r'^(wooden|golden|stone|iron|diamond|netherite)_pickaxe$')


def rank(n):
    m = PICK.match(n or '')
    return RANK[m.group(1)] if m else None


def tier(n):
    m = PICK.match(n or '')
    return TIER[m.group(1)] if m else -1


def copies(bot):
    """[(name, uses)] for every pickaxe copy in a snapshot; a copy with no durability data counts as full (INF)."""
    tools = bot.get('tools') or {}
    inv = bot.get('inventory') or {}
    out = []
    for n in set(tools) | {k for k in inv if PICK.match(k)}:
        if not PICK.match(n):
            continue
        known = [c for c in tools.get(n, []) if isinstance(c, dict) and c.get('max')]
        for c in known:
            out.append((n, c['max'] - (c.get('used') or 0)))
        extra = int(inv.get(n, 0) or 0) - len(known)
        out += [(n, INF)] * max(0, extra)
    return out


def descent_need(y):
    debt = max(0, 63 - math.floor(y))
    res = max(min(12, debt), math.ceil(debt / 4)) if debt > 0 else 0
    return debt + 2 + res


def pick_uses(cs):
    return sum(max(0, (PICK_MAX[n] if u == INF else u) - 1) for n, u in cs)


def verdict(item, bot, wants, margin=0, exit_want=None):
    """True = redundant (refuse), False = admit, None = the snapshot cannot decide (exit-contract rounding edge)."""
    if item in wants:
        return False
    inv = bot.get('inventory') or {}
    if item in STATIONS:
        return int(inv.get(item, 0) or 0) >= 1
    r = rank(item)
    if r is None:
        return False
    cs = [(n, u - margin) for n, u in copies(bot)]
    usable = sum(1 for n, u in cs if n in ESC_NAMES and u > HARD_STOP)
    if usable < ESC:
        return False
    y = ((bot.get('pos') or {}).get('y'))
    if isinstance(y, (int, float)):
        pu = pick_uses(cs)
        lo, hi = sorted((descent_need(y), descent_need(y - 0.05)))
        if pu < lo:
            return False
        if pu < hi:
            return None
    if exit_want is not None and pick_uses(cs) < exit_want:
        return False   # mine refused for want of swings in the last 15 min (toolhygiene exitShortOpen)
    need = MIN_TRIP if item == 'stone_pickaxe' else FLOOR + 1
    # stone/wooden crafts are covered only by stone/wooden/golden copies (iron retention); iron+ by the same rank or higher
    return any(rank(n) is not None and rank(n) >= r and (r >= 3 or rank(n) <= 2) and u >= need for n, u in cs)


EXITRE = re.compile(r'^pickaxe: .*\(need (\d+) with reserve\)')
EXIT_TTL = dt.timedelta(minutes=15)


def wants_of(args):
    return set(x for x in str((args or {}).get('wants') or '').split('|') if x)


def tag(s):
    n, _, u = str(s).partition('@')
    return n, (INF if u == 'full' else float(u)) if u else None


def opened_copy(n, u, rest):
    """The hygiene rule: is copy (n, u) open given the OTHER pickaxes `rest` [(name, uses)]? (toolfor hasKeeper +
    depositSurvivors: above FLOOR; or above HARD_STOP beside a same-or-higher-tier keeper above FLOOR and two other
    copies no deposit can take -- every copy at 2..10 plus one copy above FLOOR per name)."""
    if u > FLOOR:
        return True
    if u <= HARD_STOP:
        return False
    keeper = any(tier(m) >= tier(n) and v > FLOOR for m, v in rest)
    survivors = sum(1 for m, v in rest if HARD_STOP < v <= FLOOR) + len({m for m, v in rest if v > FLOOR})
    return keeper and survivors >= ESC


def worn_breach(a):
    """G3: does the logged context justify the chosen copy? -> reason string or None."""
    reason = a.get('reason')
    picks = [tag(x) for x in str(a.get('picks') or '').split(',') if x]
    cn, cu = tag(a.get('chosen'))
    if cu is None or not PICK.match(cn or ''):
        return None   # a non-pickaxe pick is outside part 2 (axes/shovels keep their own rule)
    if cu <= HARD_STOP and reason not in ('last_swing', 'spend_spent'):
        return 'chosen at %s uses (%s)' % (cu, reason)
    others = list(picks)
    if (cn, cu) in others:
        others.remove((cn, cu))

    opened = opened_copy
    if HARD_STOP < cu <= FLOOR and reason in ('cheapest', 'slow') and not opened(cn, cu, others):
        return 'worn %s@%s chosen without a keeper and two others' % (cn, cu)
    if reason in ('cheapest', 'slow'):
        for i, (m, v) in enumerate(others):
            if m == cn and HARD_STOP < v < cu:
                rest = others[:i] + others[i + 1:] + [(cn, cu)]
                if opened(m, v, rest):
                    return 'a more-worn open %s@%s was held (chose %s)' % (m, v, cu)
    return None


# POSITIVE CONTROLS for the rule and the parsers (the bot's own unit tests hold the JS side).
_b = lambda inv, tools, y=70: {'inventory': inv, 'tools': tools, 'pos': {'y': y}}
_t = lambda *cs: {n: [{'slot': i, 'used': PICK_MAX[n] - u, 'max': PICK_MAX[n]} for i, (m, u) in enumerate(cs) if m == n] for n in {c[0] for c in cs}}
_s52w30 = _b({'stone_pickaxe': 1, 'wooden_pickaxe': 1}, _t(('stone_pickaxe', 52), ('wooden_pickaxe', 30)))
assert verdict('stone_pickaxe', _s52w30, set()) is True
assert verdict('stone_pickaxe', _s52w30, {'stone_pickaxe'}) is False
assert verdict('iron_pickaxe', _s52w30, set()) is False
assert verdict('stone_pickaxe', _b({'stone_pickaxe': 1}, _t(('stone_pickaxe', 131))), set()) is False, 'escape reserve'
assert verdict('stone_pickaxe', _b({'stone_pickaxe': 1, 'wooden_pickaxe': 1}, _t(('stone_pickaxe', 40), ('wooden_pickaxe', 10)), 15), set()) is False, 'descent'
assert verdict('stone_pickaxe', _b({'stone_pickaxe': 1, 'wooden_pickaxe': 1}, _t(('stone_pickaxe', 40), ('wooden_pickaxe', 10)), 70), set()) is True
assert verdict('furnace', _b({'furnace': 1}, {}), set()) is True and verdict('furnace', _b({}, {}), set()) is False
assert verdict('stone_pickaxe', _b({'stone_pickaxe': 2, 'wooden_pickaxe': 1}, _t(('stone_pickaxe', 52), ('wooden_pickaxe', 30))), set()) is True, 'unknown-durability copy counted full'
assert descent_need(15) == 62 and descent_need(70) == 2
assert verdict('stone_pickaxe', _b({'iron_pickaxe': 1, 'stone_pickaxe': 1, 'wooden_pickaxe': 1}, _t(('iron_pickaxe', 200), ('stone_pickaxe', 5), ('wooden_pickaxe', 4))), set()) is False, 'iron never covers stone'
assert verdict('stone_pickaxe', _s52w30, set(), exit_want=90) is False and verdict('stone_pickaxe', _s52w30, set(), exit_want=50) is True
assert opened_copy('stone_pickaxe', 8, [('stone_pickaxe', 120)]) is False, 'the two-copy spare stays closed'
assert opened_copy('stone_pickaxe', 5, [('stone_pickaxe', 120), ('stone_pickaxe', 8)]) is True
assert EXITRE.search('pickaxe: 60 pickaxe swings left against a 47-block climb out (need 61 with reserve)').group(1) == '61'
assert worn_breach({'chosen': 'stone_pickaxe@5', 'reason': 'cheapest', 'picks': 'stone_pickaxe@120,stone_pickaxe@8,stone_pickaxe@5'}) is None
assert worn_breach({'chosen': 'stone_pickaxe@8', 'reason': 'cheapest', 'picks': 'stone_pickaxe@120,stone_pickaxe@8'}) is not None
assert worn_breach({'chosen': 'stone_pickaxe@8', 'reason': 'cheapest', 'picks': 'stone_pickaxe@120,stone_pickaxe@60,stone_pickaxe@8'}) is not None, 'two of one name are one survivor'
assert worn_breach({'chosen': 'stone_pickaxe@60', 'reason': 'cheapest', 'picks': 'stone_pickaxe@120,stone_pickaxe@60,stone_pickaxe@8'}) is None
assert worn_breach({'chosen': 'stone_pickaxe@8', 'reason': 'cheapest', 'picks': 'stone_pickaxe@120,stone_pickaxe@8,stone_pickaxe@5'}) is not None, 'the 5 was open and more worn'
assert worn_breach({'chosen': 'stone_pickaxe@1', 'reason': 'spend_spent', 'picks': 'stone_pickaxe@120,stone_pickaxe@1'}) is None

def wear_intervals(snaps):
    """[(period, kind)] for consecutive snapshots (tick, period, copies, pocket?, segment) of ONE bot, compared only within
    a segment (no excluded-build row between them), the same period, strictly increasing tick, no pocket row. Per
    pickaxe name with >= 2 copies, equal counts, exactly one copy changed and fell: kinds 'eligible', 'fuller_wore'
    (the fullest wore beside a usable more-worn copy), 'fuller_wore_open' (...one the hygiene rule opens),
    'worn_wore' (a less-full copy wore while the fullest stayed), 'worn_le10_wore' (...a copy at <= 10 uses)."""
    out = []
    snaps = sorted(snaps, key=lambda s: (s[4], s[0]))
    for (t0, p0, c0, k0, g0), (t1, p1, c1, k1, g1) in zip(snaps, snaps[1:]):
        if g0 != g1 or t1 <= t0 or k0 or k1 or p0 != p1:
            continue
        for n in {x for x, _ in c0}:
            a0 = sorted(u for m, u in c0 if m == n); a1 = sorted(u for m, u in c1 if m == n)
            if len(a0) < 2 or len(a0) != len(a1) or INF in a0 or INF in a1:
                continue
            gone = Counter(a0) - Counter(a1); new = Counter(a1) - Counter(a0)
            if sum(gone.values()) != 1 or sum(new.values()) != 1:
                continue
            u0 = next(iter(gone)); u1 = next(iter(new))
            if u1 >= u0:
                continue
            stay = sorted((Counter(a0) - gone).elements())
            out.append((p0, 'eligible'))
            lower = [w for w in stay if HARD_STOP < w < u1]
            if u0 == max(a0) and lower:
                out.append((p0, 'fuller_wore'))   # unambiguous: a more-worn usable copy (< u1) cannot have become u1

                def others_of(w):
                    rest = list(c0); rest.remove((n, w)); return rest
                # ...beside one the hygiene rule would OPEN: an opportunity, not a spare kept closed (Codex round 3)
                if any(opened_copy(n, w, others_of(w)) for w in lower):
                    out.append((p0, 'fuller_wore_open'))
            elif u0 < max(a0):
                out.append((p0, 'worn_wore'))     # the fullest stayed
                if u0 <= FLOOR:
                    out.append((p0, 'worn_le10_wore'))
    return out


_S = lambda tick, uses, seg: (tick, 'post', [('stone_pickaxe', u) for u in uses], False, seg)
assert ('post', 'worn_le10_wore') in wear_intervals([_S(1, [120, 8, 5], 0), _S(2, [120, 8, 4], 0)]), 'positive control: uninterrupted'
assert wear_intervals([_S(1, [120, 8, 5], 0), _S(3, [120, 8, 4], 1)]) == [], 'an excluded-build stretch between them: no interval (Codex r4)'
assert ('post', 'fuller_wore_open') not in wear_intervals([_S(1, [120, 8], 0), _S(2, [119, 8], 0)]), 'the two-copy spare is no opportunity'
assert ('post', 'fuller_wore_open') in wear_intervals([_S(1, [120, 8, 5], 0), _S(2, [119, 8, 5], 0)])


# ---- slots (foodskipread's estimator) --------------------------------------------------------------------------------
FULL = 34
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')


def stack(n):
    return 1 if ONE.search(n) else 16 if SIXTEEN.search(n) else 64


def slots(inv):
    return sum((c if stack(n) == 1 else -(-c // stack(n))) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0)


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


# ---- the decision stream (llm-*.jsonl, rotation-aware, mtime-skipped like Events.load) ------------------------------
def llm_rows(bot):
    out = []
    for f in sorted(glob.glob('/var/log/mcai/%s/llm-*.jsonl*' % bot)):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < PRE:
                continue
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"tool_calls":[{"skill":"craft"' not in line:
                    continue
                try:
                    r = json.loads(line)
                    t = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
                except Exception:
                    continue
                if PRE <= t < END:
                    out.append((t, r))
    return out


ESCAPE_KINDS = {'_maroon_dig_refused', '_marooned_needs_pickaxe', '_entombed_unrecoverable'}
tw = defaultdict(lambda: [0.0] * 6)   # (period, arm) -> [sec, sec at >= 34, slot-sec, pickaxe-slot-sec, sec under 2 usable, sec no usable]
ctrl_rows = Counter(); rows_walked = Counter(); llm_walked = Counter(); hyg = Counter(); offbuild = Counter()
g1, g2, g3, g4 = [], [], [], []
refusals = Counter(); admits = Counter(); worn_rows = Counter(); worn_n = Counter()
dec_red = Counter(); dec_red_ok = Counter(); dec_amb = Counter(); dec_refused = Counter(); dec_all = Counter()
esc = Counter(); breaks = Counter(); stone_crafts = Counter(); deaths = []
diag = defaultdict(Counter)   # (period, arm) -> {eligible, fuller_wore, worn_wore}
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
    prev_t = None; prev = None; exit_short = None   # (t, want) of this bot's last `mine` refusal for want of swings
    snaps = []   # (tick, period, copies, pocket?, segment) -- a new segment after every excluded-build row
    seg = 0
    for r in rs:
        t = r['t']; raw = r.get('raw') or {}; bot = raw.get('bot') or {}; sk = raw.get('skill') or {}
        period = 'post' if t >= CUT else 'pre'
        key = (period, arm)
        rows_walked[key] += 1
        ver = ((raw.get('code') or {}).get('version') or '')
        other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
        if other:
            # A ROW FROM ANOTHER BUILD (restart lag) accrues no time and breaks the snapshot chain (Codex round 3):
            # neither its interval nor the stale snapshot before it may count toward either period.
            offbuild[r['name']] += 1
            prev_t = None; prev = None; seg += 1   # and wear is never compared across the excluded stretch (Codex r4)
            continue
        if prev_t is not None and prev is not None:
            gap = min((t - prev_t).total_seconds(), 120.0)
            parts = [('pre' if prev_t < CUT else 'post', gap)]
            if prev_t < CUT <= t:   # split an interval that crosses the cutoff (capped total, pre share first)
                pre_s = min(gap, (CUT - prev_t).total_seconds())
                parts = [('pre', pre_s), ('post', gap - pre_s)]
            for pp, d in parts:
                a = tw[(pp, arm)]
                a[0] += d; a[1] += d if prev[0] >= FULL else 0; a[2] += d * prev[0]; a[3] += d * prev[1]; a[4] += d if prev[2] < ESC else 0; a[5] += d if prev[2] < 1 else 0
        prev_t = t
        inv = bot.get('inventory')
        if isinstance(inv, dict):
            cs = copies(bot)
            prev = (slots(inv), sum(1 for n, _ in cs), sum(1 for n, u in cs if n in ESC_NAMES and u > HARD_STOP))
            tick = (raw.get('game') or {}).get('tick')
            if isinstance(tick, (int, float)):
                snaps.append((tick, period, cs, 'pocket' in r['name'], seg))
        k = r['name']; dtl = r.get('detail') or ''; args = sk.get('args') or {}
        if k == '_tool_hygiene':
            exit_short = None   # a new process: bot.exitPickShort starts empty (Codex round 3)
        ew = exit_short[1] if exit_short and t - exit_short[0] < EXIT_TTL else None
        if k == '_exit_reserve_abort':
            m = EXITRE.search(dtl)
            if m:
                exit_short = (t, int(m.group(1)))
        if k == '_tool_hygiene':
            hyg[(period, arm, 'ON' if dtl.startswith('tool hygiene ON') else 'off')] += 1
        elif k == '_redundant_craft' and period == 'post' and arm == 'canary':
            refusals[arm] += 1
            item = args.get('item')
            v = verdict(item, bot, set(), exit_want=ew)   # the rule without the task exemption: G2 asks only "is it covered?"
            if v is False:
                g2.append((b, str(t)[11:19], dtl[:120]))
            ws = wants_of(args)
            if item in ws or str(args.get('task') or '').startswith('craft_%s_' % item) or args.get('source') == 'order':
                g4.append((b, str(t)[11:19], dtl[:120]))
        elif k == '_craft_admit' and period == 'post' and arm == 'canary':
            admits[arm] += 1
            if verdict(args.get('item'), bot, wants_of(args), exit_want=ew) is True:
                g1.append((b, str(t)[11:19], dtl[:120]))
        elif k == '_worn_first' and period == 'post' and arm == 'canary':
            worn_rows[arm] += 1; worn_n[arm] += int(args.get('n') or 0)
            why = worn_breach(args)
            if why:
                g3.append((b, str(t)[11:19], why))
        elif k in ('_redundant_craft', '_craft_admit', '_worn_first') and period == 'post':
            ctrl_rows[k] += 1   # the control must write none (the arms check)
        elif k in ESCAPE_KINDS:
            esc[key] += 1
        elif k == '_tool_broke' and '_pickaxe' in dtl:
            breaks[key] += 1
        elif k == 'craft' and (sk.get('args') or {}).get('item') == 'stone_pickaxe' and sk.get('status') == 'success':
            stone_crafts[key] += 1
        elif k == '_death' and period == 'post':
            deaths.append((arm, b, str(t)[11:19]))
    # the decision stream: admitted redundant crafts by the same rule (3-use margin: this snapshot precedes the check)
    for t, r in llm_rows(b):
        period = 'post' if t >= CUT else 'pre'
        key = (period, arm)
        ver = ((r.get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            continue
        llm_walked[key] += 1
        tc = (r.get('tool_calls') or [{}])[0] or {}
        item = (tc.get('args') or {}).get('item')
        if item not in ITEMS:
            continue
        dec_all[key] += 1
        task = str(((r.get('messages') or [{}])[0] or {}).get('milestone') or '')
        err = (r.get('llm') or {}).get('error')
        if err == 'redundant_craft':
            dec_refused[key] += 1
            continue
        if err:
            continue
        if task.endswith('+prereq'):
            dec_amb[key] += 1   # a detour's wanted set is not in the decision row
            continue
        ws = {item} if task.startswith('craft_%s_' % item) else set()
        v = verdict(item, r.get('bot') or {}, ws, margin=3)
        if v is True:
            dec_red[key] += 1
            if ((r.get('outcome') or {}).get('status')) == 'success':
                dec_red_ok[key] += 1
        elif v is None:
            dec_amb[key] += 1
    # DIAGNOSTIC wear attribution, consecutive snapshots by game.tick, never across an excluded-build stretch
    for p0, kind in wear_intervals(snaps):
        diag[(p0, arm)][kind] += 1

bh = {key: tw[key][0] / 3600 for key in tw}


def per(key, i):
    s = tw[key]
    return s[i] / s[0] if s[0] else float('nan')


did = lambda i: (per(('post', 'canary'), i) - per(('pre', 'canary'), i)) - (per(('post', 'control'), i) - per(('pre', 'control'), i))
rate = lambda c, key: c[key] / bh[key] if bh.get(key) else float('nan')
rdid = lambda c: (rate(c, ('post', 'canary')) - rate(c, ('pre', 'canary'))) - (rate(c, ('post', 'control')) - rate(c, ('pre', 'control')))
nan = lambda x: None if x != x else round(x, 4)
pc_g1 = dec_red[('post', 'control')] + dec_red[('pre', 'control')]
pc_wear = diag[('post', 'control')]['fuller_wore_open'] + diag[('pre', 'control')]['fuller_wore_open']
worn_seen = diag[('post', 'canary')]['worn_le10_wore']
# The DEPLOYED toolFor cannot produce "a <= 10 copy wore while the fullest same-name copy stayed" (an open same-name copy
# above FLOOR digs first; reserved_required is fullest-first; spend_spent's 1-use copies are excluded by the count rule),
# so the control's own count is noise from dig paths outside toolFor (Claude r4). Exposure needs the canary ABOVE it.
worn_rate = lambda key: diag[key]['worn_le10_wore'] / bh[key] if bh.get(key) else float('nan')
worn_rate_c, worn_rate_k = worn_rate(('post', 'canary')), worn_rate(('post', 'control'))
worn_beats_noise = int(worn_seen >= 3 and worn_rate_c == worn_rate_c and worn_rate_k == worn_rate_k and worn_rate_c > worn_rate_k)
live_on = hyg[('post', 'canary', 'ON')]; live_ctrl = sum(v for (p, a, _), v in hyg.items() if a == 'control') + sum(ctrl_rows.values())
print('rows walked skill pre %s post %s | decisions (craft) pre %s post %s | canary %s sha %s cutoff %s window +%d min' % (
    {a: rows_walked[('pre', a)] for a in ('canary', 'control')}, {a: rows_walked[('post', a)] for a in ('canary', 'control')},
    {a: llm_walked[('pre', a)] for a in ('canary', 'control')}, {a: llm_walked[('post', a)] for a in ('canary', 'control')},
    sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W))
print('-' * 78)
print('LIVENESS     canary _tool_hygiene ON rows %d (>= 1) | off rows %d | control rows %d (must be 0) | other-build canary rows skipped %d' % (
    live_on, hyg[('post', 'canary', 'off')], live_ctrl, sum(offbuild.values())))
print('             canary _redundant_craft %d  _craft_admit %d  _worn_first rows %d (n=%d digs) | control rows %d/%d/%d' % (
    refusals['canary'], admits['canary'], worn_rows['canary'], worn_n['canary'], ctrl_rows['_redundant_craft'], ctrl_rows['_craft_admit'], ctrl_rows['_worn_first']))
print('CORRECTNESS  G1 admitted-redundant %d | G2 refused-unjustified %d | G3 worn-pick-unjustified %d | G4 refused-wanted %d' % (len(g1), len(g2), len(g3), len(g4)))
print('POSITIVE     control admitted redundant crafts (decision stream, margin 3) %d (>= 1) | control best-first wear beside a copy the rule opens %d (>= 1)' % (pc_g1, pc_wear))
print('EFFICACY     a <= 10-use copy wore while the fullest stayed (observed): canary post %d (%.3f/bot-h) vs control post %d (%.3f/bot-h, noise outside toolFor) -> %s' % (
    worn_seen, worn_rate_c, diag[('post', 'control')]['worn_le10_wore'], worn_rate_k, 'ABOVE NOISE' if worn_beats_noise else 'not above noise'))
print('DIAGNOSTIC   wear intervals (eligible / fuller wore / ...beside an open copy / less-full wore / of which <= 10): ' + ' | '.join(
    '%s %s %d/%d/%d/%d/%d' % (a, p, diag[(p, a)]['eligible'], diag[(p, a)]['fuller_wore'], diag[(p, a)]['fuller_wore_open'], diag[(p, a)]['worn_wore'], diag[(p, a)]['worn_le10_wore'])
    for a in ('canary', 'control') for p in ('pre', 'post')))
print('             decisions (hygiene items): all %s refused %s ambiguous %s' % (dict(dec_all), dict(dec_refused), dict(dec_amb)))
print('PRIMARY      redundant crafts admitted/bot-h canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f (crafted %s)' % (
    rate(dec_red, ('pre', 'canary')), rate(dec_red, ('post', 'canary')), rate(dec_red, ('pre', 'control')), rate(dec_red, ('post', 'control')), rdid(dec_red), dict(dec_red_ok)))
print('             pickaxe slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | slots/bot DiD %+.2f | share >= 34 DiD %+.3f' % (
    per(('pre', 'canary'), 3), per(('post', 'canary'), 3), per(('pre', 'control'), 3), per(('post', 'control'), 3), did(3), did(2), did(1)))
print('             share under 2 usable pickaxes canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | no usable pickaxe share canary post %.3f control post %.3f' % (
    per(('pre', 'canary'), 4), per(('post', 'canary'), 4), per(('pre', 'control'), 4), per(('post', 'control'), 4), did(4), per(('post', 'canary'), 5), per(('post', 'control'), 5)))
print('             escape refusals/bot-h DiD %+.3f (canary %d->%d control %d->%d) | pickaxe breaks/bot-h DiD %+.3f | stone_pickaxe crafts/bot-h DiD %+.3f | deaths %s' % (
    rdid(esc), esc[('pre', 'canary')], esc[('post', 'canary')], esc[('pre', 'control')], esc[('post', 'control')], rdid(breaks), rdid(stone_crafts), deaths[:6]))
print('             bot-h %s' % {'%s/%s' % k: round(v, 1) for k, v in bh.items()})
for nm, xs in (('G1', g1), ('G2', g2), ('G3', g3), ('G4', g4)):
    for x in xs[:3]:
        print('  breach %s:' % nm, x)
exposure = int(refusals['canary'] >= 5 and admits['canary'] >= 1 and worn_beats_noise and worn_rows['canary'] >= 1 and pc_g1 >= 1 and pc_wear >= 1)
print('EXPOSURE     %s (canary refusals >= 5, canary _craft_admit >= 1 (G1 has a population), observed canary worn-first wear >= 3 AND above the control rate, canary _worn_first rows >= 1, both positive controls >= 1)' % ('READY' if exposure else 'not yet'))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('toolhygieneread', W, {
        'rows_canary': live_on, 'rows_control': live_ctrl, 'off_rows_canary': hyg[('post', 'canary', 'off')],
        'refusals_canary': refusals['canary'], 'admits_canary': admits['canary'], 'worn_rows_canary': worn_rows['canary'],
        'breach_admitted_redundant': len(g1), 'breach_refused_unjustified': len(g2), 'breach_worn_unjustified': len(g3), 'breach_refused_wanted': len(g4),
        'pc_redundant_control': pc_g1, 'pc_bestfirst_control': pc_wear, 'worn_wear_seen_canary': worn_seen, 'worn_wear_rate_canary': nan(worn_rate_c), 'worn_wear_rate_control': nan(worn_rate_k), 'worn_wear_above_noise': worn_beats_noise,
        'redundant_did': nan(rdid(dec_red)), 'pick_slots_did': nan(did(3)), 'slots_did': nan(did(2)), 'full_share_did': nan(did(1)),
        'under2_share_did': nan(did(4)), 'escape_refusals_did': nan(rdid(esc)), 'breaks_did': nan(rdid(breaks)), 'stone_crafts_did': nan(rdid(stone_crafts)),
        'exposure_ready': exposure,
    })
except Exception as e:
    print('emit failed:', e)
