#!/usr/bin/env python3
r"""valuescore.py -- the VALUE-WEIGHTED line of the owner's daily scoreboard (OWNER 10-23 "yes to all" on
docs/reports/production-breakdown-2026-10-23.md section 0.6: "the scoreboard counts dirt and staircase steps").

    python3 valuescore.py                         # yesterday (UTC), text
    python3 valuescore.py --day 2026-10-22 --json out.json
    python3 valuescore.py --since 2026-10-22T00:00:00Z --until 2026-10-23T00:00:00Z
    python3 valuescore.py --selftest              # the pure checks, no ES (scripts/host/test_valuescore.py is the suite)

WHAT IT MEASURES. Items the fleet took FROM THE WORLD, weighted by what they are worth to the tool chain and the towns:
  value/bot-h = sum over intake rows of (positive inventory_delta[item] x WEIGHTS[item]) / active bot-hours
  - INTAKE rows are the kinds whose gains come from the world: gather, mine, explore, goto, surface, home (walking pickups
    included). Transfer and transform kinds (craft, smelt, smelt_town, furnace_drain, toolkit, withdraw*, deposit,
    town_deposit, compost, ...) move or convert items already counted, so they are excluded (measured split in the report:
    docs/reports/valuescore-2026-10-23.md).
  - WEIGHTS v1 are in "log-equivalents" (1 = one log, the root of the tool chain). They are FROZEN: a weight that tracked
    current effort would rise as the world depletes and hide the depletion. Items the project's own policy gives no use
    (stocktarget.mjs targets 0, well.mjs WELL_JUNK, junkwell's stone junk) weigh 0. Crafted products weigh 0 as intake
    (they are made, not found). An item in no table is UNWEIGHTED: counted, listed, and never silently 0.

FAILS LOUDLY (ValueBlind), never prints a quiet 0, when:
  - an intake kind has fewer documents than its floor for the window (a renamed or vanished row kind: the blind-input
    mutant in test_valuescore.py renames 'gather' and must raise);
  - an intake kind's rows stop carrying skill.inventory_delta (a renamed field);
  - the window holds no documents, or the weighted total is 0, or unweighted units exceed 10 % of intake units.
POSITIVE CONTROLS printed with every run: window documents and active bot-hours, per-kind document counts and their
inventory_delta shares, and the streamed row count equal to the server's count (EsEvents.rows raises otherwise).

THE OLD COUNTS (gather ok/bot-h, mine ok/day, craft ok/day, town_deposit ok/all) print alongside until OLD_COUNTS_UNTIL so
the two can be compared for a week, then only with --old.

READ ONLY: Elasticsearch searches through scripts/lib/estelemetry.py (the read-only key). Nothing on the fleet is touched.
"""
import argparse
import difflib
import datetime as dt
import json
import os
import re
import sys
from collections import Counter, defaultdict

UTC = dt.timezone.utc
HERE = os.path.dirname(os.path.abspath(__file__))

WEIGHTS_VERSION = 'v1-2026-10-23'
OLD_COUNTS_UNTIL = '2026-10-31'          # one week of side-by-side from the first install (OWNER 10-23)

# ---------------------------------------------------------------------------------------------------- WEIGHTS v1
# Unit: one log. Evidence and the per-item argument: docs/reports/valuescore-2026-10-23.md section 2.
WEIGHTS = {
    # wood: the root of the tool chain (1 log = 4 planks = 1 crafting table); town target 4000 per type (logcap-01)
    # (logs are matched by the LOG pattern below)
    'bamboo': 0.05,                      # 9 bamboo -> 1 bamboo block -> 2 planks = 0.5 log
    # stone: build material (town cap 1000, cobblecap-1000) and the stone-tool input; the fleet takes it ~4x faster per
    # bot-minute than logs (0.074 vs 0.296 bot-min/unit, BASE 10-08..10-10)
    'cobblestone': 0.25, 'cobbled_deepslate': 0.25, 'stone': 0.25, 'blackstone': 0.25,
    # fuel: one coal smelts 8 items
    'coal': 1.0, 'charcoal': 1.0,
    # metals and gems: the iron tier (iron pickaxe = 3, kit shovel = 1, rails ~0.375/block) is the binding input of the
    # owner's plans; raw iron was 304/day against 12,146 oak logs/day at BASE (40x scarcer)
    'raw_iron': 8.0, 'iron_ore': 8.0, 'deepslate_iron_ore': 8.0,
    'raw_copper': 2.0, 'copper_ore': 2.0, 'deepslate_copper_ore': 2.0,     # owner 10-19: copper into builds
    'raw_gold': 8.0, 'gold_ore': 8.0, 'deepslate_gold_ore': 8.0,
    'lapis_lazuli': 2.0, 'redstone': 2.0, 'quartz': 1.0, 'amethyst_shard': 1.0,
    'emerald': 16.0, 'diamond': 32.0, 'obsidian': 2.0,
    'coal_ore': 1.0, 'deepslate_coal_ore': 1.0,
}
PATTERNS = [
    (re.compile(r'(_log|_wood|_stem|_hyphae)$'), 1.0),        # every log species (WOOD IS WOOD, milestones.mjs)
    (re.compile(r'(_sapling|_propagule)$'), 0.5),             # the tree farm's input (treefarm, the planting obligation)
]
# Weighted 0 ON PURPOSE (listed, so they are not "unweighted"). These are SCORING CHOICES, grounded where the project has a
# policy: stocktarget.mjs town targets 0 (dirt, sand, gravel, deepslate, tuff, calcite, sandstone), well.mjs WELL_JUNK (the
# owner's 10-04 junk list, DECORATIONS, the stone junk). Food and compost inputs are NOT junk in the code (stocktarget PROTECTED,
# the composter takes plants): they weigh 0 here because the worlds are peaceful (foodskip) and compost is not output.
ZERO = set('''dirt grass_block coarse_dirt rooted_dirt podzol mud sand red_sand gravel clay_ball clay flint
andesite diorite granite tuff calcite deepslate dripstone_block pointed_dripstone smooth_basalt basalt sandstone red_sandstone
leaf_litter short_grass tall_grass fern large_fern dead_bush seagrass vine kelp dried_kelp wildflowers dandelion poppy
cornflower azure_bluet oxeye_daisy allium blue_orchid lily_of_the_valley red_tulip orange_tulip white_tulip pink_tulip
sunflower lilac rose_bush peony pink_petals moss_block moss_carpet glow_lichen sweet_berries glow_berries
egg brown_egg blue_egg ink_sac glow_ink_sac feather string bone rotten_flesh gunpowder spider_eye leather white_wool
wheat_seeds pumpkin_seeds melon_seeds beetroot_seeds wheat apple melon_slice carrot potato beetroot cocoa_beans
brown_mushroom red_mushroom sugar_cane cactus snowball ice packed_ice salmon cod tropical_fish pufferfish
cooked_mutton cooked_beef cooked_porkchop cooked_chicken mutton beef porkchop chicken rabbit bread bone_meal
armadillo_scute rail powered_rail detector_rail activator_rail lead glass glass_pane mossy_cobblestone azalea flowering_azalea
firefly_bush bush cactus_flower amethyst_block magma_block netherrack name_tag big_dripleaf small_dripleaf
tuff_bricks chiseled_tuff_bricks mossy_stone_bricks cracked_stone_bricks chiseled_stone_bricks bricks brick'''.split())   # well.mjs DECORATIONS
# waxed_* are copper DECOR blocks (trial chambers), not raw copper: seen 10-08..10-23 at 1-5 a day (Claude r3)
ZERO_PATTERNS = re.compile(r'(_wool|_stained_glass|_stained_glass_pane|_button|_pressure_plate|_fence|_carpet)$|^polished_|^waxed_')
# Crafted or smelted PRODUCTS: weighted 0 as intake (made from inputs already counted; a picked-up product is not new).
# No catch-all suffix: a product suffix counts only on a KNOWN stem (Codex r1 P2-3, r4 P2-2: 'diamond_ingot' must surface
# as unweighted, not be zeroed by '_ingot'). Anything else is UNWEIGHTED, and the look-alike guard judges it.
_WOODS = '(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)'
_TIERS = '(wooden|stone|iron|golden|diamond|netherite)'
_STONES = '(stone|cobblestone|mossy_cobblestone|stone_brick|smooth_stone|sandstone|red_sandstone|cobbled_deepslate|deepslate_brick|' \
          'deepslate_tile|polished_deepslate|brick|andesite|diorite|granite|tuff|blackstone|mud_brick|prismarine|quartz)'
PRODUCT = re.compile(rf'^({_WOODS}_planks|stick|{_TIERS}_(pickaxe|axe|shovel|hoe|sword)|(iron|gold|copper|netherite)_ingot'
                     rf'|(iron|gold)_nugget|crafting_table|furnace|chest|barrel|torch|ladder|bucket|(water|lava|milk)_bucket'
                     rf'|composter|[a-z_]+_bed|bowl|paper|book|bricks?|stone_bricks|smooth_stone|{_WOODS}_(slab|stairs|trapdoor|door)'
                     rf'|{_STONES}_(slab|stairs|wall))$')

INTAKE_KINDS = ('gather', 'mine', 'explore', 'goto', 'surface', 'home')
# A kind with fewer documents than this per 24 h has been renamed or has vanished (measured 10-08..10-22: gather 27-42k/day,
# mine 7.7-12k, explore 15-23k, goto 16-23k, surface 0.8-1.6k, home 0.3-0.9k). Scaled by the window's length.
MIN_DOCS_PER_DAY = {'gather': 5000, 'mine': 1500, 'explore': 3000, 'goto': 3000, 'surface': 100, 'home': 50}
# rows carrying inventory_delta, every intake kind (BASE 10-09: gather 57 %, mine 67 %, explore 26 %, goto 22 %,
# surface 40 %, home 38 %; 10-22: 58, 74, 24, 21, 52, 50 %): a floor well under each, so a renamed field raises
MIN_DELTA_SHARE = {'gather': 0.10, 'mine': 0.10, 'explore': 0.05, 'goto': 0.05, 'surface': 0.05, 'home': 0.05}
MAX_UNWEIGHTED_SHARE = 0.10
# A renamed WEIGHTED item (raw_iron -> iron_raw) is a small share of intake units (raw iron is 0.5 %), so the share test cannot
# see it (Claude r1 P2-1). Two more guards, per 24 h and scaled by the window:
MAX_ONE_UNWEIGHTED_PER_DAY = 50          # any single unweighted item above this raises (10-09/10-22 max: rail 5, amethyst_block 4)
SENTINELS_PER_DAY = {'cobblestone': 2000, 'raw_iron': 50, '_log': 100}   # measured 10-08..10-22: >= 24,000 / 229 / 1,147 a day
# A LOW-volume rename (diamond -> diamonds, 8 a day) passes both floors (Codex r2 P2-2): an unweighted name that LOOKS like a
# weighted one raises at any count. "Looks like" = shares a valuable token, or is a close spelling of a weighted name.
VALUABLE_TOKENS = {'iron', 'copper', 'gold', 'diamond', 'diamonds', 'emerald', 'lapis', 'redstone', 'coal', 'quartz',
                   'amethyst', 'obsidian', 'log', 'logs', 'cobblestone', 'cobble', 'charcoal', 'raw', 'ore', 'sapling'}
MIN_SENTINEL_HOURS = 3                   # shorter windows skip the sentinel floors (too few units to judge)
INGEST_LAG_S = 240                       # estelemetry's measured max ingest lag
MAX_INGEST_GAP_MIN = 15                  # the newest document must be within this of the window end
CLASSES = (('wood', re.compile(r'(_log|_wood|_stem|_hyphae)$|^bamboo$')), ('stone', re.compile(r'^(cobblestone|cobbled_deepslate|stone|blackstone)$')),
           ('iron', re.compile(r'iron')), ('copper', re.compile(r'copper')), ('coal', re.compile(r'coal|charcoal')),
           ('gems', re.compile(r'gold|lapis|redstone|quartz|amethyst|emerald|diamond|obsidian')),
           ('saplings', re.compile(r'_sapling$|_propagule$')))


class ValueBlind(RuntimeError):
    """The instrument cannot see what it is supposed to measure: a renamed kind or field, or an empty answer."""


def weight(item):
    """Weight of one unit of `item`, or None when no table names it (UNWEIGHTED: listed, never silently 0)."""
    if item in WEIGHTS:
        return WEIGHTS[item]
    for rx, w in PATTERNS:
        if rx.search(item):
            return w
    if item in ZERO or ZERO_PATTERNS.search(item) or PRODUCT.search(item):
        return 0.0
    return None


def klass(item):
    for name, rx in CLASSES:
        if rx.search(item):
            return name
    return 'other'


def check_inputs(kind_docs, delta_docs, hours):
    """Raise ValueBlind if an intake kind is missing or too thin for the window, or its rows lost inventory_delta."""
    problems = []
    for k in INTAKE_KINDS:
        floor = MIN_DOCS_PER_DAY[k] * hours / 24
        n = kind_docs.get(k, 0)
        if n < floor:
            near = [x for x in kind_docs if x != k and (k in x or x in k)]
            problems.append(f'intake kind {k!r} has {n} docs in {hours:g} h (floor {floor:.0f})'
                            + (f'; similar names present: {near}' if near else '') + ' -- renamed or vanished?')
        share = MIN_DELTA_SHARE[k]
        if n and delta_docs.get(k, 0) / n < share:
            problems.append(f'{k!r}: only {delta_docs.get(k, 0)} of {n} rows carry skill.inventory_delta (< {share:.0%})'
                            f' -- field renamed?')
    if problems:
        raise ValueBlind('; '.join(problems))


def score(rows_by_kind):
    """rows_by_kind: {kind: iterable of {'delta': {item: n}, 'world': str}}. Pure."""
    units, value, unweighted = Counter(), Counter(), Counter()
    by_class, by_world = Counter(), Counter()
    rows = 0
    for k, rows_ in rows_by_kind.items():
        for r in rows_:
            rows += 1
            for item, n in (r.get('delta') or {}).items():
                if not isinstance(n, (int, float)) or n <= 0:
                    continue
                units[item] += n
                w = weight(item)
                if w is None:
                    unweighted[item] += n
                    continue
                if w:
                    value[item] += n * w
                    by_class[klass(item)] += n * w
                    by_world[r.get('world') or '?'] += n * w
    return {'rows': rows, 'units': sum(units.values()), 'units_by_item': dict(units), 'value': sum(value.values()),
            'by_class': dict(by_class),
            'by_world': dict(by_world), 'by_item': dict(value), 'unweighted': dict(unweighted),
            'zero_units': sum(n for i, n in units.items() if weight(i) == 0.0)}


def looks_weighted(item):
    """An unweighted name that resembles a weighted one: a likely rename, never a stray (Codex r2 P2-2)."""
    toks = set(re.split(r'[_\W]+', item))
    if toks & VALUABLE_TOKENS:
        return True
    return bool(difflib.get_close_matches(item, list(WEIGHTS), n=1, cutoff=0.8))


def check_output(res, hours=None):
    if res['rows'] == 0 or res['units'] == 0:
        raise ValueBlind(f'no intake units at all ({res["rows"]} rows): the instrument saw nothing')
    if res['value'] <= 0:
        raise ValueBlind(f'{res["units"]} intake units but a weighted value of 0: every item weighs 0 or is unweighted '
                         f'(renamed item names? top unweighted: {Counter(res["unweighted"]).most_common(5)})')
    hours = hours if hours is not None else res.get('hours', 24)
    alike = {i: n for i, n in res['unweighted'].items() if looks_weighted(i)}
    if alike:
        raise ValueBlind(f'unweighted item(s) that look like weighted ones (renamed?): {alike} -- add to WEIGHTS or ZERO')
    # the per-item COUNT rule is judged on whole-day windows only: short windows trip on geode/trial-chamber bursts (amethyst_block
    # 26 in 10 h on 10-23; Claude r3). The look-alike rule above still applies at every window length.
    big = {i: n for i, n in res['unweighted'].items() if n > MAX_ONE_UNWEIGHTED_PER_DAY * hours / 24} if hours >= 24 else {}
    if big:
        raise ValueBlind(f'unweighted item(s) above {MAX_ONE_UNWEIGHTED_PER_DAY}/day: {big} -- a renamed item? add to WEIGHTS or ZERO')
    if hours >= MIN_SENTINEL_HOURS:
        units = res.get('units_by_item') or {}
        for name, per_day in SENTINELS_PER_DAY.items():
            got = sum(n for i, n in units.items() if (i.endswith(name) if name.startswith('_') else i == name))
            if got < per_day * hours / 24:
                raise ValueBlind(f'sentinel {name!r}: {got:g} units in {hours:g} h (floor {per_day * hours / 24:.0f}) -- '
                                 f'a renamed item or a stalled fleet, not a score')
    uw = sum(res['unweighted'].values())
    if uw > MAX_UNWEIGHTED_SHARE * res['units']:
        raise ValueBlind(f'{uw} of {res["units"]} intake units are UNWEIGHTED (> {MAX_UNWEIGHTED_SHARE:.0%}): '
                         f'{Counter(res["unweighted"]).most_common(8)} -- add them to WEIGHTS or ZERO')


MAX_EMPTY_10MIN = 2      # whole 10-minute bins with NO document from any bot; a stall longer than that is not a day to score


def check_coverage(cov):
    """Raise ValueBlind on a materially incomplete window: an empty whole hour, or more than MAX_EMPTY_10MIN empty
    10-minute bins (EsEvents.coverage reports both; the count floors alone would pass a day with a 6-hour ingest stall)."""
    if cov.get('empty_hours'):
        raise ValueBlind(f'window has empty whole hours (no document from any bot): {cov["empty_hours"][:6]}')
    if len(cov.get('empty_10min') or []) > MAX_EMPTY_10MIN:
        raise ValueBlind(f'{len(cov["empty_10min"])} empty 10-minute bins (> {MAX_EMPTY_10MIN}): {cov["empty_10min"][:6]}')


def world_of(pool):
    if pool and pool.startswith('self-'):
        return '-'.join(pool.split('-')[1:3])
    return pool or '?'


# ---------------------------------------------------------------------------------------------------- ES access
def _estelemetry():
    """Load estelemetry BY FILE from the first stable copy found: $MCAI_ESTEL_SCRIPTS, ~/estel/scripts, then this repo's
    scripts/. By file, because scoreboard.py has already imported a `lib` package from /opt/minecraft-ai/scripts (the
    deploy checkout, which a deploy resets), and `from lib.estelemetry import` would silently resolve inside that one."""
    import importlib.util
    for p in (os.environ.get('MCAI_ESTEL_SCRIPTS'), os.path.expanduser('~/estel/scripts'), os.path.join(HERE, '..')):
        f = os.path.join(p, 'lib', 'estelemetry.py') if p else ''
        if f and os.path.exists(f):
            spec = importlib.util.spec_from_file_location('valuescore_estelemetry', f)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m.EsEvents
    raise ValueBlind('no estelemetry.py found ($MCAI_ESTEL_SCRIPTS, ~/estel/scripts, or the repo)')


def measure(since, until, old=None):
    EsEvents = _estelemetry()
    # Clamp the end to now - INGEST_LAG_S (Claude r3 P2-2): names() and rows() are separate snapshots, so a window that ends
    # at "now" races late documents into one and not the other. The clamp is printed in the header.
    now = dt.datetime.now(UTC)
    u = dt.datetime.fromisoformat(until.replace('Z', '+00:00'))
    clamped = None
    if u > now - dt.timedelta(seconds=INGEST_LAG_S):
        clamped = until
        until = (now - dt.timedelta(seconds=INGEST_LAG_S)).strftime('%Y-%m-%dT%H:%M:%SZ')
    ev = EsEvents.load('skill', since=since, until=until)
    hours = (ev.until - ev.since).total_seconds() / 3600
    total = ev.total()
    if not total:
        raise ValueBlind(f'window {since} .. {until} holds no skill documents')
    names = ev.names()
    q = ev._query()
    q['bool']['filter'].append({'exists': {'field': 'skill.inventory_delta'}})
    r = ev._search({'size': 0, 'query': q, 'aggs': {'k': {'terms': {'field': 'skill.name', 'size': 5000}}}})
    delta_docs = {b['key']: b['doc_count'] for b in ev._complete(r['aggregations']['k'], 'delta kinds')['buckets']}
    check_inputs(names, delta_docs, hours)
    rows_by_kind = {}
    for k in INTAKE_KINDS:
        rows_by_kind[k] = [{'delta': (x.get('skill') or {}).get('inventory_delta') or {},
                            'world': world_of((x.get('exp') or {}).get('pool'))}
                           for x in ev.rows(k, fields=['skill.inventory_delta', 'exp.pool'], max_rows=400_000)]
    res = score(rows_by_kind)
    if res['rows'] != sum(names.get(k, 0) for k in INTAKE_KINDS):        # the streamed rows ARE the kinds' documents
        raise ValueBlind(f'streamed {res["rows"]} intake rows but the kinds hold {sum(names.get(k, 0) for k in INTAKE_KINDS)}')
    check_output(res, hours)
    cov = ev.coverage()
    check_coverage(cov)
    newest = cov.get('newest')
    if newest is not None and (ev.until - newest).total_seconds() > MAX_INGEST_GAP_MIN * 60:
        raise ValueBlind(f'newest document {newest} is more than {MAX_INGEST_GAP_MIN} min before the window end {ev.until}: '
                         f'ingest stalled or the window runs into the future')
    # per-world ACTIVE bot-hours: (bot, hour) pairs with >= 1 document, by world (Codex r1 P2-4)
    r = ev._search({'size': 0, 'query': ev._query(), 'aggs': {'h': {
        'date_histogram': {'field': '@timestamp', 'fixed_interval': '1h', 'min_doc_count': 1},
        'aggs': {'p': {'terms': {'field': 'exp.pool', 'size': 500}, 'aggs': {'b': {'cardinality': {'field': 'bot.name'}}}}}}}})
    wbh = Counter()
    for hb in r['aggregations']['h']['buckets']:
        lo = max(dt.datetime.fromisoformat(hb['key_as_string'].replace('Z', '+00:00')), ev.since)
        hi = min(dt.datetime.fromisoformat(hb['key_as_string'].replace('Z', '+00:00')) + dt.timedelta(hours=1), ev.until)
        frac = max(0.0, (hi - lo).total_seconds() / 3600)
        for pb in ev._complete(hb['p'], 'pool terms')['buckets']:
            wbh[world_of(pb['key'])] += pb['b']['value'] * frac
    res['world_bot_hours'] = dict(wbh)
    res.update({'window': [ev.since.isoformat(), ev.until.isoformat()], 'hours': hours, 'docs': total,
                'bot_hours': cov['bot_hours'], 'kind_docs': {k: names.get(k, 0) for k in INTAKE_KINDS},
                'kind_delta_docs': {k: delta_docs.get(k, 0) for k in INTAKE_KINDS}, 'weights_version': WEIGHTS_VERSION,
                'caveats': ev.caveats + ([f'window end clamped from {clamped} to {until} (now - {INGEST_LAG_S} s: ingest lag)']
                                         if clamped else []),
                'empty_10min': cov['empty_10min'], 'newest': str(cov['newest'])})
    res['value_per_bot_h'] = res['value'] / cov['bot_hours'] if cov['bot_hours'] else None
    show_old = old if old is not None else ev.until.date().isoformat() <= OLD_COUNTS_UNTIL
    if show_old:
        res['old'] = {'gather_ok': int(ev.count('gather', status='success')), 'mine_ok': int(ev.count('mine', status='success')),
                      'craft_ok': int(ev.count('craft', status='success')),
                      'town_deposit_ok': int(ev.count('town_deposit', status='success', allow_zero=True)),
                      'town_deposit_all': int(ev.count('town_deposit', allow_zero=True))}
    return res


def render(res):
    bh = res['bot_hours']
    out = [f'VALUE-WEIGHTED INTAKE ({res["weights_version"]}; unit = one log)  window {res["window"][0][:16]}Z -> '
           f'{res["window"][1][:16]}Z ({res["hours"]:g} h)',
           f'  value {res["value"]:,.0f} = {res["value_per_bot_h"]:.2f} per active bot-h (of {bh:,.1f} bot-h)  from '
           f'{res["units"]:,} intake units; {res["zero_units"]:,} of them weigh 0 by policy (dirt, sand, junk, products)',
           '  by class: ' + ', '.join(f'{k} {v:,.0f}' for k, v in sorted(res['by_class'].items(), key=lambda x: -x[1])),
           '  top items: ' + ', '.join(f'{k} {v:,.0f}' for k, v in Counter(res['by_item']).most_common(6)),
           '  per world (value per ACTIVE bot-h of that world): ' + ', '.join(
               f'{w} {res["by_world"].get(w, 0) / h:.1f}' if h else f'{w} n/a' for w, h in sorted(res['world_bot_hours'].items())),
           f'  unweighted units {sum(res["unweighted"].values()):,}' + (f': {Counter(res["unweighted"]).most_common(5)}'
                                                                      if res['unweighted'] else ''),
           '  positive controls: window docs {:,}; intake kind docs {}; rows with inventory_delta {}; streamed rows {:,}'.format(
               res['docs'], res['kind_docs'], res['kind_delta_docs'], res['rows'])]
    for c in res.get('caveats') or []:
        out.append('  caveat: ' + c)
    if res.get('old'):
        o = res['old']
        out.append(f'  OLD COUNTS (side by side until {OLD_COUNTS_UNTIL}): gather ok {o["gather_ok"]:,} '
                   f'({o["gather_ok"] / bh:.2f}/bot-h), mine ok {o["mine_ok"]:,}, craft ok {o["craft_ok"]:,}, '
                   f'town_deposit {o["town_deposit_ok"]}/{o["town_deposit_all"]}')
    return '\n'.join(out)


def report(since, until, old=None, json_path=None):
    res = measure(since, until, old)
    print(render(res))
    if json_path:
        with open(json_path, 'w') as f:
            json.dump(res, f, indent=1, sort_keys=True)
    return res


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--day', help='UTC day YYYY-MM-DD (default: yesterday)')
    ap.add_argument('--since'); ap.add_argument('--until')
    ap.add_argument('--json'); ap.add_argument('--old', action='store_true', help='print the old counts after the week')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args(argv)
    if a.selftest:
        import importlib.util
        spec = importlib.util.spec_from_file_location('tv', os.path.join(HERE, 'test_valuescore.py'))
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        return m.main()
    if a.since:
        since, until = a.since, a.until or dt.datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')
    else:
        day = dt.date.fromisoformat(a.day) if a.day else dt.datetime.now(UTC).date() - dt.timedelta(days=1)
        since, until = f'{day}T00:00:00Z', f'{day + dt.timedelta(days=1)}T00:00:00Z'
    report(since, until, True if a.old else None, a.json)
    return 0


if __name__ == '__main__':
    sys.exit(main())
