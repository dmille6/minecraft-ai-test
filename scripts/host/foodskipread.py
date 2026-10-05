#!/usr/bin/env python3
# foodskipread.py [window_min] -- the read for canary `foodskip-01` (branch fs-on-1918bb5).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/foodskip.mjs): FOOD_SKIP=auto|on|off (default auto). In auto, while the server says the world is
# PEACEFUL (mineflayer bot.game.difficulty), pickupNearbyItems no longer WALKS to a food drop (minecraft-data's foods:
# apples, bread, meat, berries...). The server still hands over any item within ~1 block, so food still ARRIVES when it
# lands at the bot's feet: this removes the chasing, not the arrival. One `_food_skip` row per process per change of
# (decision, difficulty): "food skip ON|off: mode=auto difficulty=peaceful active=1".
# Pickup telemetry (pickuplog.mjs, on the fleet since 10-03): apples are JUNK -> one `_junk_pickup` row per pickup with
# skill.args {item, count, mode: sought|passive, sought_by: pickup|goal|...}; other food folds into the per-minute
# `_pickups` summary ("name count source mode; ...").
#
#   LIVENESS     canary `_food_skip` rows from the canary build with active=1 (>= 1); control 0 (the base has no row).
#   CORRECTNESS  (any breach REVERTS)
#                F1 MODE: a canary `_food_skip` row with difficulty=peaceful and active=0, or mode != auto (the fleet env
#                   sets nothing; auto is the default) -- the switch did not do what it says.
#                F2 CHASING: canary food pickups SOUGHT by pickupNearbyItems (apple `_junk_pickup` sought_by=pickup): at
#                   least F2_MIN_CANARY of them AND a per-bot-hour rate above 25% of the control's, judged when the control
#                   has >= 20 (the positive control). Not "any": an item entity whose metadata has not arrived yet cannot
#                   be named at the filter and is chased as before. Dry run 10-05 (3 h, 70 control bots): control 15
#                   sought apples (0.07/bot-h), so a 10-bot canary expects ~4 in 6 h if the skip did nothing.
#   TRIPWIRES    canary hunger below 20 (a world that is not peaceful), canary `_food_skip` rows naming another difficulty,
#                food sought by any other path (sought_by != pickup; summary 'sought' groups), deaths (named; the two-death
#                floor is canary-report.py's), gather success DiD (the sweep also collects logs; skipping food must not
#                cost them).
#   INSTRUMENT   (positive control) control apple pickups sought by pickupNearbyItems (>= 1): the chasing exists.
#   PRIMARY      food slots per bot and all slots per bot, time-weighted (gaps capped at 120 s), corrected estimator
#                (bag-creep report), DiD vs the same-length pre-window; share of bot-time at >= 34. Also food items
#                gained per bot-hour (pickups, sought and passive). REPORTED.
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

# minecraft-data 1.21.8 foodsByName (what foodskip.mjs isFoodName reads through bot.registry).
FOODS = {'apple', 'mushroom_stew', 'bread', 'porkchop', 'cooked_porkchop', 'golden_apple', 'enchanted_golden_apple', 'cod',
         'salmon', 'tropical_fish', 'pufferfish', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice', 'dried_kelp', 'beef',
         'cooked_beef', 'chicken', 'cooked_chicken', 'rotten_flesh', 'spider_eye', 'carrot', 'potato', 'baked_potato',
         'poisonous_potato', 'golden_carrot', 'pumpkin_pie', 'rabbit', 'cooked_rabbit', 'rabbit_stew', 'mutton', 'cooked_mutton',
         'chorus_fruit', 'beetroot', 'beetroot_soup', 'suspicious_stew', 'sweet_berries', 'glow_berries', 'honey_bottle'}
FULL = 34
F2_RATIO = 0.25
F2_MIN_CONTROL = 20
F2_MIN_CANARY = 3
ONE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|_horse_armor|^(water|lava|milk|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket|_bed|_boat|_raft|minecart|^potion|^splash_potion|^lingering_potion|^shears|^flint_and_steel|^bow|^crossbow|^trident|^fishing_rod|^carrot_on_a_stick|^warped_fungus_on_a_stick|^shield|^saddle|^elytra|^totem_of_undying|^music_disc|^enchanted_book|^written_book|^writable_book|_stew$|^rabbit_stew|^beetroot_soup|^cake|_shulker_box|^shulker_box|^spyglass|^goat_horn|^brush|^mace|_bundle$|^bundle|^debug_stick|^knowledge_book)$')
SIXTEEN = re.compile(r'^(egg|brown_egg|blue_egg|ender_pearl|snowball|bucket|honey_bottle|armor_stand|.*_sign|.*_hanging_sign|.*_banner)$')


def stack(n):
    return 1 if ONE.search(n) else 16 if SIXTEEN.search(n) else 64


def slots(inv, only=None):
    return sum((c if stack(n) == 1 else -(-c // stack(n))) for n, c in (inv or {}).items()
               if isinstance(c, (int, float)) and c > 0 and (only is None or n in only))


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


SKIPRE = re.compile(r'^food skip (ON|off): mode=(\w+).*? difficulty=(\w+) active=([01])')
SUMRE = re.compile(r'([a-z0-9_]+) (\d+) (\S+) (sought|passive)')


def summary_food(d):
    """`_pickups` detail -> [(item, count, mode)] for food groups (the part before ' | ')."""
    head = (d or '').split(' | ')[0]
    out = []
    for part in head.split('; '):
        m = SUMRE.fullmatch(part.strip())
        if m and m.group(1) in FOODS:
            out.append((m.group(1), int(m.group(2)), m.group(4)))
    return out


# POSITIVE CONTROLS for the parsers.
assert SKIPRE.match('food skip ON: mode=auto difficulty=peaceful active=1').groups() == ('ON', 'auto', 'peaceful', '1')
assert SKIPRE.match('food skip off: mode=auto (FOOD_SKIP=yes unreadable, using auto) difficulty=normal active=0').groups() == ('off', 'auto', 'normal', '0')
assert summary_food('cobblestone 30 mine:y-20 passive; bread 2 gather:oak_log sought | 32 items in 2 pickups in 60s') == [('bread', 2, 'sought')]
assert summary_food('apple 3 gather:oak_log passive | 3 items') == [('apple', 3, 'passive')]
assert slots({'apple': 65, 'bread': 3, 'cobblestone': 10}, FOODS) == 3 and stack('honey_bottle') == 16

tw = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])        # (period, arm) -> [seconds, at >= 34, slot-seconds, food-slot-seconds]
skiprows = Counter(); offbuild = 0; f1 = []; other_diff = Counter()
sought = Counter(); soughtother = Counter(); passive = Counter(); summ = Counter()
hunger_low = Counter(); deaths = []; gathers = defaultdict(Counter)
rows_walked = Counter()
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
    prev_t = None; prev = None
    for r in rs:
        t = r['t']; raw = r.get('raw') or {}; bot = raw.get('bot') or {}; sk = raw.get('skill') or {}
        period = 'post' if t >= CUT else 'pre'
        rows_walked[(period, arm)] += 1
        ver = ((raw.get('code') or {}).get('version') or '')
        other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
        if prev_t is not None and prev is not None:
            pp = 'post' if prev_t >= CUT else 'pre'
            dtsec = min((t - prev_t).total_seconds(), 120.0)
            a = tw[(pp, arm)]
            a[0] += dtsec; a[1] += dtsec if prev[0] >= FULL else 0; a[2] += dtsec * prev[0]; a[3] += dtsec * prev[1]
        prev_t = t
        inv = bot.get('inventory')
        if isinstance(inv, dict) and not other:
            prev = (slots(inv), slots(inv, FOODS))
        k = r['name']; d = r.get('detail') or ''
        key = (period, arm)
        if other:
            if k == '_food_skip':
                offbuild += 1
            continue
        if k == '_food_skip':
            m = SKIPRE.match(d)
            skiprows[(period, arm, m.group(4) if m else '?')] += 1
            if arm == 'canary' and period == 'post':
                if not m or m.group(2) != 'auto' or (m.group(3) == 'peaceful' and m.group(4) != '1'):
                    f1.append((b, d[:100]))
                if m and m.group(3) != 'peaceful':
                    other_diff[m.group(3)] += 1
        elif k == '_junk_pickup':
            a = sk.get('args') or {}
            if a.get('item') in FOODS:
                n = int(a.get('count') or 1)
                if a.get('mode') == 'sought' and a.get('sought_by') == 'pickup':
                    sought[key] += n
                elif a.get('mode') == 'sought':
                    soughtother[key] += n
                else:
                    passive[key] += n
        elif k == '_pickups':
            for item, n, mode in summary_food(d):
                summ[(period, arm, mode)] += n
        elif k == '_death' and period == 'post':
            deaths.append((arm, b, str(t)[11:19]))
        elif k == 'gather' and sk.get('status') in ('success', 'failed', 'no_effect'):
            gathers[key][sk.get('status')] += 1
        h = bot.get('hunger')
        if period == 'post' and isinstance(h, (int, float)) and h < 20:
            hunger_low[arm] += 1

bh = {key: tw[key][0] / 3600 for key in tw}
rate = lambda c, key: c[key] / bh[key] if bh.get(key) else float('nan')
sr = {key: rate(sought, key) for key in tw}
ratio = (sr[('post', 'canary')] / sr[('post', 'control')]) if sr.get(('post', 'control')) else float('nan')
f2_judged = sought[('post', 'control')] >= F2_MIN_CONTROL
f2 = int(f2_judged and sought[('post', 'canary')] >= F2_MIN_CANARY and ratio > F2_RATIO)


def per(key, i):
    s = tw[key]
    return s[i] / s[0] if s[0] else float('nan')


did = lambda i: (per(('post', 'canary'), i) - per(('pre', 'canary'), i)) - (per(('post', 'control'), i) - per(('pre', 'control'), i))
gs = lambda key: gathers[key]['success'] / max(1, sum(gathers[key].values()))
gdid = (gs(('post', 'canary')) - gs(('pre', 'canary'))) - (gs(('post', 'control')) - gs(('pre', 'control')))
print('rows walked pre %s post %s | canary %s sha %s cutoff %s window +%d min' % (
    {a: rows_walked[('pre', a)] for a in ('canary', 'control')}, {a: rows_walked[('post', a)] for a in ('canary', 'control')},
    sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), W))
print('-' * 78)
print('LIVENESS     canary _food_skip active=1 rows %d (>= 1) | control rows %d (must be 0) | other build %d' % (
    skiprows[('post', 'canary', '1')], sum(v for (p, a, _), v in skiprows.items() if a == 'control' and p == 'post'), offbuild))
print('CORRECTNESS  F1 mode/decision wrong %d | F2 sought-by-sweep food/bot-h canary %.2f vs control %.2f ratio %.3f (breach: canary n >= %d and ratio > %.2f; judged=%s, canary n=%d, control n=%d)' % (
    len(f1), sr.get(('post', 'canary'), float('nan')), sr.get(('post', 'control'), float('nan')), ratio, F2_MIN_CANARY, F2_RATIO, f2_judged,
    sought[('post', 'canary')], sought[('post', 'control')]))
print('TRIPWIRES    canary rows naming another difficulty %s | hunger < 20 snapshots canary %d control %d | food sought by other paths canary %d control %d | summary food sought canary %d control %d' % (
    dict(other_diff), hunger_low['canary'], hunger_low['control'], soughtother[('post', 'canary')], soughtother[('post', 'control')],
    summ[('post', 'canary', 'sought')], summ[('post', 'control', 'sought')]))
print('             gather success DiD %+.3f | deaths %s' % (gdid, deaths[:6]))
print('INSTRUMENT   control apple pickups sought by the sweep (post) %d (>= 1); passive canary %d control %d' % (
    sought[('post', 'control')], passive[('post', 'canary')], passive[('post', 'control')]))
print('PRIMARY      food slots/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | slots/bot DiD %+.2f | share >= 34 DiD %+.3f' % (
    per(('pre', 'canary'), 3), per(('post', 'canary'), 3), per(('pre', 'control'), 3), per(('post', 'control'), 3), did(3), did(2), did(1)))
print('             food gained/bot-h (apple rows + summaries) canary %.2f -> %.2f control %.2f -> %.2f | bot-h %s' % (
    (sought[('pre', 'canary')] + passive[('pre', 'canary')] + summ[('pre', 'canary', 'sought')] + summ[('pre', 'canary', 'passive')]) / max(1e-9, bh.get(('pre', 'canary'), 0)),
    (sought[('post', 'canary')] + passive[('post', 'canary')] + summ[('post', 'canary', 'sought')] + summ[('post', 'canary', 'passive')]) / max(1e-9, bh.get(('post', 'canary'), 0)),
    (sought[('pre', 'control')] + passive[('pre', 'control')] + summ[('pre', 'control', 'sought')] + summ[('pre', 'control', 'passive')]) / max(1e-9, bh.get(('pre', 'control'), 0)),
    (sought[('post', 'control')] + passive[('post', 'control')] + summ[('post', 'control', 'sought')] + summ[('post', 'control', 'passive')]) / max(1e-9, bh.get(('post', 'control'), 0)),
    {'%s/%s' % k: round(v, 1) for k, v in bh.items()}))
for x in f1[:3]:
    print('  breach F1:', x)
nan = lambda x: None if x != x else round(x, 4)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('foodskipread', W, {
        'rows_canary': skiprows[('post', 'canary', '1')],
        'rows_control': sum(v for (p, a, _), v in skiprows.items() if a == 'control' and p == 'post'),
        'offbuild_canary': offbuild, 'breach_mode': len(f1), 'breach_chasing': f2, 'chasing_ratio': nan(ratio),
        'sought_control': sought[('post', 'control')], 'sought_canary': sought[('post', 'canary')],
        'hunger_low_canary': hunger_low['canary'], 'other_difficulty_rows': sum(other_diff.values()),
        'food_slots_did': nan(did(3)), 'slots_did': nan(did(2)), 'full_share_did': nan(did(1)), 'gather_success_did': nan(gdid),
        'exposure_ready': int(f2_judged and skiprows[('post', 'canary', '1')] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
