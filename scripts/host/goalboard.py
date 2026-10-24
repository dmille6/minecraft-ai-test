#!/usr/bin/env python3
r"""goalboard.py -- the owner's DAILY GOAL SCOREBOARD: build cool structures, survive, and work together for long periods
(peaceful worlds). OWNER 10-19 "yes". One JSON document per UTC day, a 7-day history, and an optional HTML page.

    python3 scripts/host/goalboard.py                                   # yesterday (the cron's day), + 7-day history
    python3 scripts/host/goalboard.py --from 2026-10-12 --to 2026-10-19 --out-dir ~/goalboard/out --html ~/goalboard/out/goalboard.html

Runs on 10.0.0.31 (ES read-only key, /var/lib/mcai well records). READ ONLY: ES searches, local JSON files. Nothing on the
fleet is written or restarted.

CRON (SUGGESTED, NOT INSTALLED -- both hosts run UTC). Install from a stable copy, never /opt/minecraft-ai (a deploy resets
that tree): ~/goalboard/scripts/{host/goalboard.py,lib/estelemetry.py,lib/telemetry.py} on .31, and
scripts/host/chestclear3/goalcensus.py next to census3.py in ~/chestclear3 on .30.
  10.0.0.30, mike's crontab (sudo -n works there), 00:15Z -- the census for the day that just closed:
    15 0 * * * cd /home/mike/chestclear3 && sudo -n python3 goalcensus.py positions-run-20261014T0221Z.json census-goal-$(date -u +\%Y\%m\%dT\%H\%MZ).json >> /var/log/mcai-monitor/goalcensus.log 2>&1
  10.0.0.31, mike's crontab, 00:30Z -- yesterday's board, the 7-day history and the page:
    30 0 * * * cd /home/mike/goalboard && /usr/bin/python3 scripts/host/goalboard.py --out-dir /home/mike/goalboard/out --html /home/mike/goalboard/out/goalboard.html >> /home/mike/digest/goalboard.log 2>&1
  The census file must reach .31's --census-dir (~/goalboard/census) between the two. Neither host can ssh to the other
  today (publickey refused both ways, 10-19), so that hop is the owner's choice: a forced-command key on .30 that only
  cats the newest census-goal file, or a copy from the controller. Without it the chest lines say no_census (UNKNOWN).

SOURCES. Elasticsearch through scripts/lib/estelemetry.py (owner 10-14: ES for analysis wider than a few hours) -- every
count is a server-side aggregation or a bounded row stream; the plinth/well records in /var/lib/mcai/_pool-*; and the
town chest census JSON written on 10.0.0.30 by chestclear3/goalcensus.py (region-file discovery + census3's read-only RCON
reads). The two hosts cannot ssh to each other, so the census file has to be carried to --census-dir; a day with no
census file says so -- its chest numbers are null, never 0.

EVERY METRIC CARRIES: source (ES kind and filter, or file), window, denominator (named, with its value), and a positive
control (the window's documents and bots, the kind's documents in the window, and the kind's first/last document in all of
ES). A metric whose kind had no document yet at the window's end is status "not_live_yet" with value 0. A kind name this
script relies on that ES has NEVER held raises ZeroLooksWrong (a typo, not an absence).

ONE ROW FAMILY PER ACTION, so nothing is counted twice. Several actions log a skill row AND an event row for the same
run (town_deposit/_town_deposit, smelt_town/_smelt_town, dispose_well/_well_dispose, toolkit/_toolkit,
withdraw_pick/_withdraw_pick); each metric names the ONE it reads. _stock_bank rows are deposit() sub-rows (their items
are already in the enclosing skill's inventory_delta) and are not read. The toolkit's crafts call craft() directly and
log no `craft` row (checked 10-19: 204 of 223 kit runs have no craft row within 4 min; the 19 that do are other items),
so toolkit kits and `craft` kits do not overlap.

DENOMINATORS. bot-hours = ACTIVE bot-hours: (bot, hour) pairs with >= 1 document, edge hours pro-rated (EsEvents.coverage).
Deaths/bot-hour, successes/bot-hour divide by it. Per-world figures say "of N worlds"; success rates say "of N attempts".
"""
import argparse
import importlib.util
import datetime as dt
import glob
import html
import json
import math
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from lib.estelemetry import EsEvents, ZeroLooksWrong, http as es_http  # noqa: E402

UTC = dt.timezone.utc
LAG = dt.timedelta(minutes=5)              # ingest lag (max ~3 min measured 10-14)
INDEX = 'mcai-skill-agents'
UNDERGROUND_Y = 60                         # wellread.py's UNDERGROUND_Y: a death below y=60 is "underground"
FULL_AT, SLOTS = 34, 36                    # the owner's shed rule (fleetstatus.py, bagcensus.py)
TOWN_XZ, TOWN_DY = 48 + 5, 12 + 5           # census3's bank box (48, 12) + reach: a generic chest verb counted as town
CHEST_SLOTS = 27                           # one chest/barrel block entity; a double chest is two entities of 27
USABLE_LEFT = 10                           # scoreboard.py: a tool with <= 10 uses left is not usable
STREAK_SINCE = dt.datetime(2026, 10, 8, tzinfo=UTC)   # deaths are read from here (10-07 holds ES re-sends)
DEAD_CAP = dt.timedelta(minutes=60)
NOT_LIVE = {'town_project_blocks': re.compile(r'project'),          # no row kinds yet: 0 + 'not live yet' until one exists
            'ziggurat_blocks': re.compile(r'zigg|monument')}
LOG = re.compile(r'(_log|_wood|_stem|_hyphae)$')
PLANKS = re.compile(r'_planks$')
COBBLE = {'cobblestone', 'cobbled_deepslate'}
KIT_TOOLS = ('iron_axe', 'iron_shovel')
TIERS = ('wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite')
UNSTACKABLE = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|'
                         r'shears|flint_and_steel|bow|fishing_rod)$')
ROW_FIELDS = ['@timestamp', 'skill', 'bot.name', 'bot.pos', 'exp.pool']


# ------------------------------------------------------------------------------------------------ pure helpers
def pool_group(p):
    """fleetstatus.py's grouping: isolated bots each carry their own pool ('self-isolated-a-Alpha') -> world 'isolated-a'."""
    m = re.fullmatch(r'self-(isolated-[a-z])-\w+', str(p))
    return m.group(1) if m else str(p)


def world_of(row):
    pool = (row.get('exp') or {}).get('pool')
    if pool:
        return pool_group(pool)
    name = (row.get('bot') or {}).get('name') or ''
    return name.rsplit('-', 1)[0] if '-' in name else '<missing>'


def num(v, default=0.0):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def kv(detail, key):
    """key=value from a skill.detail string (values never contain spaces in these rows)."""
    m = re.search(r'(?:^|\s)%s=(\S+)' % re.escape(key), detail or '')
    return m.group(1) if m else None


def xyz(s):
    m = re.fullmatch(r'(-?\d+),(-?\d+),(-?\d+)', s or '')
    return tuple(int(v) for v in m.groups()) if m else None


def parse_ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(UTC)


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def delta(row):
    """{item: number} from skill.inventory_delta (flattened in ES: values may arrive as strings)."""
    return {k: num(v) for k, v in ((row.get('skill') or {}).get('inventory_delta') or {}).items()}


def wood_used(d):
    """Wood a row CONSUMED, in log-equivalents (1 log = 4 planks = 8 sticks), from its NET inventory delta. A craft that
    turns a log into planks consumes nothing (0); a crafting table (planks -4) consumes 1; a stone pickaxe's sticks count.
    Net deltas hide intermediates inside one row, which is the point: wood turned into something that is not wood."""
    eq = sum(v for k, v in d.items() if LOG.search(k)) + sum(v for k, v in d.items() if PLANKS.search(k)) / 4 \
        + d.get('stick', 0) / 8
    return max(0.0, -eq)


def cluster_key(p, keys, r=2):
    """The existing key within Chebyshev r of p (one well logged a block apart is one well), else p itself."""
    for k in keys:
        if max(abs(p[0] - k[0]), abs(p[2] - k[2])) <= r and abs(p[1] - k[1]) <= 3:
            return k
    return p


DETAIL_CAP = 300                           # logEvent cuts skill.detail at 300 chars


def well_at(detail):
    """The well a _well_dispose detail names, or None. at= that is the LAST token of a detail cut at the 300-char cap may
    itself be cut and still parse ('at=240,69,-15' for -151: reviewer 10-19, 107 of 1,005 rows end exactly at 300 with
    at= last) -- never trusted: such a row goes to the bot.pos fallback."""
    d = detail or ''
    p = xyz(kv(d, 'at'))
    if p and len(d) >= DETAIL_CAP and re.search(r'(?:^|\s)at=\S+$', d):
        return None
    return p


def locate_wells(rows, known):
    """[(row, world, well_key|None)] for successful _well_dispose rows. at= names the well, but the 300-char detail cap
    cuts it off, or cuts INTO it, ~10-20% of the time (well_at). Such a row is put at the nearest well KNOWN in its world
    (today's at= wells, the site records, the raised caps) within 4 blocks of floor(bot.pos) -- bot.pos was within 1
    block of at= in 887 of 911 rows -- else world_key None: counted as a dispose, never invented as a new well."""
    keys, out, later = defaultdict(list), [], []
    for r in rows:
        p = well_at(r['skill'].get('detail'))
        w = world_of(r)
        if p:
            k = cluster_key(p, keys[w])
            if k == p and p not in keys[w]:
                keys[w].append(p)
            out.append((r, w, k))
        else:
            later.append((r, w))
    for r, w in later:
        pos = (r.get('bot') or {}).get('pos') or {}
        k = None
        if all(isinstance(pos.get(a), (int, float)) for a in 'xyz'):
            b = (math.floor(pos['x']), math.floor(pos['y']), math.floor(pos['z']))
            cands = [c for c in keys[w] + [tuple(x[:3]) for x in known.get(w, [])]
                     if max(abs(c[0] - b[0]), abs(c[2] - b[2])) <= 4 and abs(c[1] - b[1]) <= 4]
            if cands:
                k = cluster_key(min(cands, key=lambda c: max(abs(c[0] - b[0]), abs(c[2] - b[2]))), keys[w])
                if k not in keys[w]:
                    keys[w].append(k)
        out.append((r, w, k))
    return out


def is_raised(p, t, raised):
    """raised: [(x, y, z, done_at)] -- a well is raised once a COMPLETE plinth's cap is within 2 blocks and was done
    before the row (a natural well at the same spot before the plinth counts as natural)."""
    return any(max(abs(p[0] - c[0]), abs(p[2] - c[2])) <= 2 and abs(p[1] - c[1]) <= 3 and (c[3] is None or c[3] <= t)
               for c in raised)


def streaks(deaths, bots, w_start, w_end):
    """Per bot, everything measured INSIDE [w_start, w_end] (so a day's figures compare with the next day's):
      longest_h   the longest death-free interval, clipped to the window
      current_h   w_end - the last death in the window, or the whole window when there was none
      deaths_in_window
    An interval is CENSORED (the true streak is at least that long) when it is cut by the window's start (no death in the
    window before it) or runs to w_end. Wall-clock, not online time; a bot that joined mid-window is credited from w_start."""
    out = {}
    for b in bots:
        inside = [t for t in deaths.get(b, []) if w_start <= t < w_end]
        edges = [None] + inside + [w_end]
        best, best_cens = 0.0, False
        for a, z in zip(edges, edges[1:]):
            lo = a or w_start
            h = (z - lo).total_seconds() / 3600
            cens = (a is None) or z == w_end
            if h > best:
                best, best_cens = h, cens
        last = inside[-1] if inside else None
        out[b] = {'longest_h': round(best, 1), 'longest_censored': best_cens,
                  'current_h': round((w_end - (last or w_start)).total_seconds() / 3600, 1), 'current_censored': last is None,
                  'deaths_in_window': len(inside)}
    return out


def pick_census(files, d_start, d_end, slack=dt.timedelta(hours=3)):
    """The census for a day: started in [d_start, d_end + slack], closest to d_end (the day's closing state). -> path|None"""
    best = None
    for f, started in files:
        if d_start <= started <= d_end + slack:
            if best is None or abs((started - d_end).total_seconds()) < abs((best[1] - d_end).total_seconds()):
                best = (f, started)
    return best


def chest_summary(census):
    """Town chests (bank box) from a census3/goalcensus document."""
    per, top_slots, top_count = {}, Counter(), Counter()
    n = used = full = incomplete = 0
    errors = {}
    for w, v in sorted(census['worlds'].items()):
        if v.get('error'):                       # a world census3 could not read is UNKNOWN, never an empty town
            errors[w] = str(v['error'])[:200]
            continue
        cs = v.get('containers') or []
        wu = sum(len(c.get('items') or []) for c in cs)
        wf = sum(1 for c in cs if len(c.get('items') or []) >= CHEST_SLOTS)
        per[w] = {'containers': len(cs), 'slots_used': wu, 'slots': len(cs) * CHEST_SLOTS, 'full': wf,
                  'pct_full': round(100 * wu / max(1, len(cs) * CHEST_SLOTS), 1)}
        n += len(cs); used += wu; full += wf; incomplete += len(v.get('incomplete') or [])
        for c in cs:
            for it in c.get('items') or []:
                k = str(it.get('id', '?')).replace('minecraft:', '')
                top_slots[k] += 1; top_count[k] += int(num(it.get('count')))
    return {'containers': n, 'slots_used': used, 'slots': n * CHEST_SLOTS, 'full': full, 'incomplete': incomplete,
            'pct_full': round(100 * used / max(1, n * CHEST_SLOTS), 1), 'worlds': len(per), 'per_world': per,
            'worlds_failed': errors,
            'top_items_by_slots': [{'item': k, 'slots': s, 'count': top_count[k]} for k, s in top_slots.most_common(10)]}


def slot_counter(stack_path):
    """fleetstatus.py's estimator: ~/stack.json stack sizes if present (a LOWER bound), else 64 / tools 1."""
    try:
        stack = json.load(open(os.path.expanduser(stack_path)))
        return ((lambda it, c: math.ceil(c / stack.get(it, 64)) if c > 0 else 0),
                f'stack sizes from {stack_path}; a LOWER bound: one item split over partial stacks uses more slots')
    except (OSError, ValueError):
        return ((lambda it, c: (c if UNSTACKABLE.search(it) else -(-c // 64)) if c > 0 else 0),
                'ESTIMATED stack sizes (64; tools 1) -- stack.json not found')


def usable(entries):
    return [e for e in entries or [] if num(e.get('max')) - num(e.get('used')) > USABLE_LEFT]


# ------------------------------------------------------------------------------------------------ the metric record
def metric(value, unit, source, window, denom=None, control=None, status='live', note=None, **extra):
    m = {'value': value, 'unit': unit, 'source': source, 'window': window, 'status': status}
    if denom is not None:
        what, dv = denom
        m['denominator'] = {'what': what, 'value': dv}
        rate_ok = extra.pop('rate_ok', None)
        if rate_ok is None:
            rate_ok = 'bot-hours' in what
        if isinstance(value, (int, float)) and dv and rate_ok:
            m['rate'] = round(value / dv, 4)          # per bot-hour (or an explicit share); never a % divided again
    else:
        extra.pop('rate_ok', None)
    if control is not None:
        m['positive_control'] = control
    if note:
        m['note'] = note
    m.update(extra)
    return m


class Kinds:
    """First/last document of every skill.name in ALL of ES -- the 'is this kind live yet' control."""
    def __init__(self):
        r = es_http('POST', f'{INDEX}/_search', {'size': 0, 'aggs': {'k': {
            'terms': {'field': 'skill.name', 'size': 5000},
            'aggs': {'mn': {'min': {'field': '@timestamp'}}, 'mx': {'max': {'field': '@timestamp'}}}}}})
        b = r['aggregations']['k']
        if b.get('sum_other_doc_count'):
            raise ZeroLooksWrong('kind census truncated; raise size')
        self.span = {x['key']: (parse_ts(x['mn']['value_as_string']), parse_ts(x['mx']['value_as_string']), x['doc_count'])
                     for x in b['buckets']}

    def need(self, kind):
        if kind not in self.span:
            raise ZeroLooksWrong(f'{kind!r} has never been in {INDEX} ({len(self.span)} kinds): the name, not the fleet')
        return self.span[kind]

    def first(self, kind):
        return self.need(kind)[0]

    def matching(self, pat):
        return sorted(k for k in self.span if pat.search(k))


# ------------------------------------------------------------------------------------------------ one UTC day
class Day:
    def __init__(self, day, now, kinds, args):
        self.day = day
        self.start = dt.datetime.combine(day, dt.time(0), UTC)
        self.end = min(self.start + dt.timedelta(days=1), now - LAG)
        self.partial = self.end < self.start + dt.timedelta(days=1)
        self.kinds, self.args = kinds, args
        self.window = f'{iso(self.start)}..{iso(self.end)}' + (' (PARTIAL day)' if self.partial else '')
        self.ev = EsEvents.load('skill', since=self.start, until=self.end, gaps='raise')
        self.total = self.ev.total()
        if not self.total:
            raise ZeroLooksWrong(f'{self.window}: no ES documents at all -- ingest or fleet outage; not reporting zeros')
        self.names = self.ev.names()
        cov = self.ev.coverage()
        self.bh = cov['bot_hours']
        self.bots = self.ev.bots_present()
        self.cov = cov
        self.worlds = sorted({pool_group(p) for p in self.ev.by_pool()})
        self._rows = {}

    # -- controls ----------------------------------------------------------------------------------------------
    def control(self, *kinds):
        c = {'window_docs': self.total, 'bots_present': len(self.bots), 'active_bot_hours': self.bh, 'kinds': {}}
        for k in kinds:
            first, last, n = self.kinds.need(k)
            c['kinds'][k] = {'docs_in_window': self.names.get(k, 0), 'first_in_es': iso(first), 'last_in_es': iso(last)}
        return c

    def live(self, kind):
        """'live' once the kind's first ES document precedes the window's end."""
        return self.kinds.first(kind) < self.end

    def status(self, kind, value):
        """not_live_yet: the kind's first ES doc is after the window. A zero is 'zero_kind_present' when the kind has docs
        in THIS window (the instrument saw the population; the filter matched none) and 'zero_kind_absent' when the kind is
        live in ES but logged nothing in this window (the window itself holds window_docs documents)."""
        if not self.live(kind):
            return 'not_live_yet'
        if value:
            return 'live'
        return 'zero_kind_present' if self.names.get(kind) else 'zero_kind_absent'

    def rows(self, kind, **filters):
        key = (kind, tuple(sorted(filters.items())))
        if key not in self._rows:
            self.kinds.need(kind)
            self._rows[key] = [] if not self.names.get(kind) else list(
                self.ev.rows(kind, fields=ROW_FIELDS, max_rows=200_000, allow_zero=True, **filters))
        return self._rows[key]

    def in_town(self, r):
        """Is the row's bot (end-of-skill position) inside its world's town bank box, a little widened for reach?"""
        h = self.homes.get(world_of(r))
        pos = (r.get('bot') or {}).get('pos') or {}
        if not h or not all(isinstance(pos.get(a), (int, float)) for a in 'xyz'):
            return False
        return abs(pos['x'] - h[0]) <= TOWN_XZ and abs(pos['z'] - h[2]) <= TOWN_XZ and abs(pos['y'] - h[1]) <= TOWN_DY

    def bh_denom(self):
        return ('active bot-hours', self.bh)

    # ======================================================================================================== BUILD
    def build(self, raised):
        W, out = self.window, {}
        # -- wells in use: distinct wells with >= 1 successful dispose today, per world, raised vs natural
        disp = self.rows('_well_dispose', status='success')
        wells, unlocated = defaultdict(dict), 0
        for r, w, k in locate_wells(disp, self.known_wells):
            if k is None:
                unlocated += 1; continue
            e = wells[w].setdefault(k, {'at': list(k), 'disposes': 0, 'bots': set(), 'raised': False})
            e['disposes'] += 1
            e['bots'].add(r['bot']['name'])
            e['raised'] = e['raised'] or is_raised(k, parse_ts(r['@timestamp']), raised.get(w, []))
        self.well_bots = {(w, k): e['bots'] for w, ws in wells.items() for k, e in ws.items()}
        thrown = int(sum(-v for r in self.rows('dispose_well', status='success') for v in delta(r).values() if v < 0))
        per_world = {}
        for w in self.worlds:
            ws = list(wells.get(w, {}).values())
            per_world[w] = {'raised_in_use': sum(e['raised'] for e in ws), 'natural_in_use': sum(not e['raised'] for e in ws),
                            'wells': [dict(e, bots=sorted(e['bots'])) for e in ws]}
        n_raised = sum(v['raised_in_use'] for v in per_world.values())
        n_nat = sum(v['natural_in_use'] for v in per_world.values())
        ctl = self.control('_well_dispose', 'dispose_well', '_plinth')
        src = 'ES _well_dispose status=success, at= (the well; a row whose at= the 300-char cap cut is placed by bot.pos ' \
              'at the nearest known well within 4 blocks); raised = a COMPLETE plinth cap within 2 blocks (plinth records ' \
              '/var/lib/mcai/_pool-*/junkwell-plinth-*.json + ES _plinth stage=complete), done before the row'
        wn = ('worlds present', len(self.worlds))
        out['wells_in_use'] = metric(n_raised + n_nat, 'wells', src, W, wn, ctl, self.status('_well_dispose', n_raised + n_nat),
                                     worlds_with_a_well_in_use=sum(1 for v in per_world.values() if v['raised_in_use'] + v['natural_in_use']),
                                     dispose_rows_unlocated=unlocated)
        out['raised_wells_in_use'] = metric(n_raised, 'wells', src, W, wn, ctl, self.status('_plinth', n_raised))
        out['natural_wells_in_use'] = metric(n_nat, 'wells', src, W, wn, ctl, self.status('_well_dispose', n_nat))
        out['well_disposes'] = metric(len(disp), 'dispose runs', 'ES _well_dispose status=success (one row per run; '
                                      'dispose_well skill rows are the same runs and are not added); items thrown from the '
                                      'dispose_well skill rows\' inventory_delta (never truncated)', W, self.bh_denom(),
                                      self.control('_well_dispose', 'dispose_well'), self.status('_well_dispose', len(disp)),
                                      items_thrown=thrown)
        out['wells_per_world'] = per_world

        # -- structure blocks placed
        steps = [r for r in self.rows('_plinth_step', status='success') if kv(r['skill'].get('detail'), 'op') == 'place']
        by_block = Counter(kv(r['skill'].get('detail'), 'block') or '?' for r in steps)
        out['plinth_blocks_placed'] = metric(len(steps), 'blocks', 'ES _plinth_step status=success op=place (one row = one '
                                             'block placed and verified)', W, self.bh_denom(), self.control('_plinth_step'),
                                             self.status('_plinth_step', len(steps)), by_block=dict(by_block),
                                             by_world=dict(Counter(world_of(r) for r in steps)))
        done = [r for r in self.rows('_plinth', status='success') if kv(r['skill'].get('detail'), 'stage') == 'complete']
        out['plinths_completed'] = metric(len(done), 'plinths', 'ES _plinth status=success stage=complete', W,
                                          ('worlds present', len(self.worlds)), self.control('_plinth'),
                                          self.status('_plinth', len(done)), at=[kv(r['skill'].get('detail'), 'at') for r in done])
        built = self.rows('_well_built', status='success')
        out['wells_built'] = metric(len(built), 'wells', 'ES _well_built status=success', W, ('worlds present', len(self.worlds)),
                                    self.control('_well_built'), self.status('_well_built', len(built)))
        pil = self.rows('build')
        pil_new = sum(int(m.group(1)) for r in pil for m in [re.search(r'\((\d+) new', r['skill'].get('detail') or '')] if m)
        out['llm_build_blocks'] = metric(pil_new, 'blocks', 'ES build (the model\'s build verb, plan=pillar): "(N new" in '
                                         'detail, all statuses', W, self.bh_denom(), self.control('build'),
                                         self.status('build', pil_new), runs=len(pil))
        for k, pat in NOT_LIVE.items():
            nl = self.kinds.matching(pat)
            out[k] = metric(0, 'blocks', 'no ES row kind exists yet', W, None,
                            {'kinds_searched_in_all_es': len(self.kinds.span), 'pattern': pat.pattern, 'matching_kinds': nl},
                            'not_live_yet' if not nl else 'check_matching_kinds',
                            'not live yet: no row kind for this exists in ES; the line turns live when one is logged '
                            '(status check_matching_kinds = a matching kind appeared: add its parser here)')
        # the tree farm (treefarm-02, first ES row 2026-10-19 12:51Z on hive-c): one _farm_place row per placement;
        # verdict=confirmed = the server read back the block. role=bonemeal rows consume, they place nothing.
        fp = [r for r in self.rows('_farm_place', status='success')
              if kv(r['skill'].get('detail'), 'verdict') == 'confirmed' and kv(r['skill'].get('detail'), 'role') != 'bonemeal']
        out['farm_blocks'] = metric(len(fp), 'blocks', 'ES _farm_place status=success verdict=confirmed, role != bonemeal '
                                    '(_farm_tend visit totals are the same placements and are not added)', W, self.bh_denom(),
                                    self.control('_farm_place', '_farm_site', '_farm_tend'), self.status('_farm_place', len(fp)),
                                    by_role=dict(Counter(kv(r['skill'].get('detail'), 'role') for r in fp)),
                                    by_world=dict(Counter(world_of(r) for r in fp)),
                                    place_rows_all_statuses=self.names.get('_farm_place', 0))

        # -- materials put to use
        st = self.rows('_smelt_town')
        cu = sum(int(num(kv(r['skill'].get('detail'), 'smelted'))) for r in st)
        out['copper_smelted'] = metric(cu, 'ingots', 'ES _smelt_town smelted= (all statuses: a run can smelt and then fail; '
                                       'smelt_town skill rows are the same runs and are not added)', W, self.bh_denom(),
                                       self.control('_smelt_town'), self.status('_smelt_town', cu),
                                       runs_that_smelted=sum(1 for r in st if num(kv(r['skill'].get('detail'), 'smelted')) > 0))
        wood_rows = self.rows('craft', status='success') + self.rows('toolkit', status='success') + \
            self.rows('build_well', status='success')
        wsum = Counter()
        for r in wood_rows:
            d = delta(r)
            wsum['log_eq'] += wood_used(d)
            wsum['logs_out'] += -sum(v for k, v in d.items() if LOG.search(k) and v < 0)
            wsum['planks_out'] += -sum(v for k, v in d.items() if PLANKS.search(k) and v < 0)
        out['wood_used_by_crafts'] = metric(round(wsum['log_eq'], 1), 'log-equivalents',
                                            'ES craft + toolkit + build_well status=success, inventory_delta: -(logs + planks/4 '
                                            '+ sticks/8) per row, floored at 0', W, self.bh_denom(),
                                            self.control('craft', 'toolkit', 'build_well'),
                                            self.status('craft', wsum['log_eq']),
                                            logs_consumed=wsum['logs_out'], planks_consumed=wsum['planks_out'], rows=len(wood_rows))
        cob = sum(by_block.get(b, 0) for b in COBBLE)
        cob_pil = sum(-v for r in pil for k, v in delta(r).items() if k in COBBLE and v < 0)
        out['cobble_placed_in_builds'] = metric(cob + int(cob_pil), 'blocks',
                                                'ES _plinth_step place rows with block=cobblestone|cobbled_deepslate (the SAME '
                                                'rows as plinth_blocks_placed, by material -- not additive) + cobble the build '
                                                'verb spent', W, self.bh_denom(), self.control('_plinth_step', 'build'),
                                                self.status('_plinth_step', cob + cob_pil), plinth=cob, llm_build=int(cob_pil))
        kit = self.toolkit_rows()
        iron = sum(k['used'] for k in kit)
        out['iron_used_by_toolkit'] = metric(iron, 'ingots', 'ES _toolkit phase=kit used= (ingots the verified crafts '
                                             'consumed; args, else detail)', W, self.bh_denom(), self.control('_toolkit'),
                                             self.status('_toolkit', iron), runs=len(kit))
        return out

    def toolkit_rows(self):
        """_toolkit phase=kit rows -> [{drew, sticks, used, crafted[], outcome, bot}] (structured args first, detail fallback:
        rows before 10-18 ~00:07Z carry only the detail)."""
        out = []
        for r in self.rows('_toolkit'):
            a, d = r['skill'].get('args') or {}, r['skill'].get('detail') or ''
            g = (lambda k: a.get(k) if a.get(k) is not None else kv(d, k))
            if g('phase') != 'kit':
                continue
            crafted = [c for c in str(g('crafted') or '-').split('+') if c and c != '-']
            out.append({'drew': num(g('drew')), 'sticks': num(g('sticks')), 'used': num(g('used')), 'crafted': crafted,
                        'outcome': g('outcome'), 'bot': r['bot']['name'], 'world': world_of(r)})
        return out

    # ====================================================================================================== SURVIVE
    def survive(self, all_deaths):
        W, out = self.window, {}
        rows = self.rows('_death')
        n = len(rows)
        causes = Counter(r['skill'].get('fail_class') or '<missing>' for r in rows)
        ctl = self.control('_death')
        out['deaths'] = metric(n, 'deaths', 'ES _death (all rows; fail_class = cause)', W, self.bh_denom(), ctl,
                               self.status('_death', n), by_cause=dict(causes.most_common()),
                               by_cause_per_bot_hour={k: round(v / self.bh, 4) for k, v in causes.most_common()} if self.bh else {},
                               by_world=dict(Counter(world_of(r) for r in rows).most_common()))
        with_y = [r for r in rows if isinstance(((r.get('bot') or {}).get('pos') or {}).get('y'), (int, float))]
        ug = [r for r in with_y if r['bot']['pos']['y'] < UNDERGROUND_Y]
        out['underground_death_share'] = metric(round(100 * len(ug) / len(with_y), 1) if with_y else None, '% of deaths',
                                                f'ES _death bot.pos.y < {UNDERGROUND_Y} (wellread.py UNDERGROUND_Y)', W,
                                                ('deaths with a position', len(with_y)), ctl,
                                                self.status('_death', n), underground=len(ug),
                                                no_position=n - len(with_y), underground_by_cause=dict(Counter(
                                                    r['skill'].get('fail_class') or '<missing>' for r in ug)))
        dead_s, open_ = 0.0, 0
        for r in rows:
            t = parse_ts(r['@timestamp'])
            nxt = self.next_doc(r['bot']['name'], t)
            stop = min(nxt or (t + DEAD_CAP), t + DEAD_CAP, self.end)
            open_ += nxt is None
            dead_s += max(0.0, (stop - t).total_seconds())
        out['bot_hours_online'] = metric(self.bh, 'bot-hours', 'ES coverage(): (bot, hour) pairs with >= 1 document, edge '
                                         'hours pro-rated', W, ('bots x window hours', round(len(self.bots) * (self.end - self.start).total_seconds() / 3600, 1)),
                                         {'window_docs': self.total, 'bots_present': len(self.bots),
                                          'empty_hours': self.cov['empty_hours'], 'empty_10min': self.cov['empty_10min'][:20]}, rate_ok=False,
                                         note='equals the nominal bots x hours whenever every bot logs in every hour (it does: '
                                              'the bots log many rows a minute); it falls below that only when a bot is down')
        out['bot_hours_alive'] = metric(round(self.bh - dead_s / 3600, 2), 'bot-hours',
                                        'online bot-hours less, per death, the gap to that bot\'s next ES document after '
                                        f'death+1 s (capped {int(DEAD_CAP.total_seconds() // 60)} min)', W, ('active bot-hours', self.bh), ctl,
                                        dead_hours=round(dead_s / 3600, 3), deaths_with_no_next_doc=open_, rate_ok=False,
                                        note='bots respawn automatically, so alive ~ online; the gap is what the logs can show')
        w_start = max(self.start - dt.timedelta(days=6), STREAK_SINCE)
        sk = streaks(all_deaths, self.bots, w_start, self.end)
        span_d = round((self.end - w_start).total_seconds() / 86400, 2)
        cur = [v['current_h'] for v in sk.values()]
        lon = sorted(((v['longest_h'], b, v['longest_censored']) for b, v in sk.items()), reverse=True)
        out['survival_streaks'] = metric(round(statistics.median(cur), 1) if cur else None, 'hours (median current streak)',
                                         f'ES _death rows from {iso(STREAK_SINCE)} (deduplicated by bot+time); wall-clock, '
                                         'not online time', f'{iso(w_start)}..{iso(self.end)} ({span_d} days; deaths are read from {iso(STREAK_SINCE)})',
                                         ('bots present today', len(sk)), self.control('_death'),
                                         longest=[{'bot': b, 'hours': h, 'censored': c} for h, b, c in lon[:10]],
                                         shortest=[{'bot': b, 'hours': h, 'censored': c} for h, b, c in lon[-5:]],
                                         bots_with_no_death_in_window=sum(1 for v in sk.values() if v['deaths_in_window'] == 0), window_days=span_d,
                                         note='current streak is capped at the window start, so the median is comparable '
                                              'day to day only between full 7-day windows (10-14 onward)',
                                         per_bot=sk)
        return out

    def next_doc(self, bot, t):
        r = es_http('POST', f'{INDEX}/_search', {'size': 1, 'sort': [{'@timestamp': 'asc'}], '_source': ['@timestamp'],
                                                  'query': {'bool': {'filter': [
                                                      {'term': {'bot.name': bot}},
                                                      {'range': {'@timestamp': {'gt': iso(t + dt.timedelta(seconds=1)),
                                                                                'lt': iso(t + DEAD_CAP)}}}]}}})
        h = r['hits']['hits']
        return parse_ts(h[0]['_source']['@timestamp']) if h else None

    # ================================================================================================ WORK TOGETHER
    def together(self):
        W, out = self.window, {}
        td = self.rows('town_deposit', status='success')
        out['town_deposits_ok'] = metric(len(td), 'deposits', 'ES town_deposit status=success (the skill row; _town_deposit '
                                         'is the same run)', W, self.bh_denom(), self.control('town_deposit'),
                                         self.status('town_deposit', len(td)), attempts=int(self.ev.count('town_deposit', allow_zero=True)))
        wp = self.rows('withdraw_pick', status='success')
        # the generic chest verbs (withdraw, deposit) work at ANY chest: only rows whose bot stands in its town's bank box
        # count as town (bot.pos is the end-of-skill snapshot, i.e. at the chest it used)
        wd_all = self.rows('withdraw', status='success')
        dep_all = self.rows('deposit', status='success')
        wd = [r for r in wd_all if self.in_town(r)]
        dep = [r for r in dep_all if self.in_town(r)]
        box = (f'bot.pos within {TOWN_XZ} blocks (x,z) and {TOWN_DY} (y) of its world\'s home (homes from the census files: '
               f'{len(self.homes)} worlds)')
        out['town_withdrawals_ok'] = metric(len(wp) + len(wd), 'withdrawals', 'ES withdraw_pick (a town verb) + withdraw '
                                            f'(generic: only with {box}), status=success',
                                            W, self.bh_denom(), self.control('withdraw_pick', 'withdraw'),
                                            self.status('withdraw_pick', len(wp) + len(wd)), withdraw_pick=len(wp), withdraw=len(wd),
                                            withdraw_outside_town_excluded=len(wd_all) - len(wd))
        st = self.rows('_smelt_town')
        kit = self.toolkit_rows()
        neg = lambda rows: int(sum(-v for r in rows for v in delta(r).values() if v < 0))
        pos = lambda rows: int(sum(v for r in rows for v in delta(r).values() if v > 0))
        # smelt_town takes raw copper out, smelts a few and banks the rest back (10-18: withdrawn 6,452 raw, smelted 1,451):
        # that round trip is churn, so only ingots banked count IN and only raw it did not bring back counts OUT
        sv = lambda r, k: num(kv(r['skill'].get('detail'), k))
        churn = int(sum(min(sv(r, 'withdrawn'), sv(r, 'dep_r')) for r in st))
        ins = {'town_deposit': neg(td), 'deposit (generic chest verb)': neg(dep),
               'smelt_town ingots banked (dep_i)': int(sum(sv(r, 'dep_i') for r in st))}
        outs = {'withdraw_pick': pos(wp), 'withdraw': pos(wd), 'toolkit drew (ingots+sticks)': int(sum(k['drew'] + k['sticks'] for k in kit)),
                'smelt_town raw kept (withdrawn - raw banked back)': int(sum(max(0.0, sv(r, 'withdrawn') - sv(r, 'dep_r')) for r in st))}
        fctl = self.control('town_deposit', 'deposit', '_smelt_town', 'withdraw_pick', 'withdraw', '_toolkit')
        fnote = (f'generic deposit/withdraw rows count only with {box} ({len(dep_all) - len(dep)} deposit and '
                 f'{len(wd_all) - len(wd)} withdraw rows outside were excluded). '
                 'in: items leaving bags on successful town_deposit/deposit rows (inventory_delta < 0) + smelt_town dep_i; '
                 'out: items entering bags on successful withdraw_pick/withdraw (delta > 0) + toolkit drew/sticks + smelt_town '
                 'raw copper withdrawn and NOT banked back (in counts only its ingots, dep_i; the raw round trip is reported as '
                 'smelt_town_raw_round_trip_excluded). _stock_bank '
                 '(deposit() sub-rows) is NOT added. A deposit row\'s delta can include a dirt/cobble loss in the same run, '
                 'so "in" is an upper bound per row and a lower bound overall (reflex banking has no skill row)')
        out['items_into_town_chests'] = metric(sum(ins.values()), 'items', 'ES inventory_delta / detail fields (see note)', W,
                                               self.bh_denom(), fctl, self.status('town_deposit', sum(ins.values())), fnote, by_source=ins,
                                               smelt_town_raw_round_trip_excluded=churn)
        out['items_out_of_town_chests'] = metric(sum(outs.values()), 'items', 'ES inventory_delta / detail fields (see note)', W,
                                                 self.bh_denom(), fctl, self.status('withdraw_pick', sum(outs.values())), fnote, by_source=outs,
                                                 smelt_town_raw_round_trip_excluded=churn)
        picks = Counter()
        for r in wp:
            for k, v in delta(r).items():
                if k.endswith('_pickaxe') and v > 0:
                    picks[k] += int(v)
        out['pickaxes_fetched'] = metric(sum(picks.values()), 'pickaxes', 'ES withdraw_pick status=success, *_pickaxe '
                                         'inventory_delta > 0 (the verb also fetches sticks: not counted here)', W,
                                         self.bh_denom(), self.control('withdraw_pick'),
                                         self.status('withdraw_pick', sum(picks.values())), by_tier=dict(picks),
                                         withdraw_pick_attempts=int(self.ev.count('withdraw_pick', allow_zero=True)))
        town_kit = Counter(t for k in kit for t in k['crafted'])
        bag_kit = Counter()
        bag_pick = 0
        for r in self.rows('craft', status='success'):
            item = str((r['skill'].get('args') or {}).get('item') or '')
            got = delta(r).get(item, 0)
            if item in KIT_TOOLS:
                bag_kit[item] += int(got) if got > 0 else 1
            elif item == 'iron_pickaxe':
                bag_pick += int(got) if got > 0 else 1
        out['kit_tools_from_town_iron'] = metric(sum(town_kit.values()), 'tools', 'ES _toolkit phase=kit crafted= (verified '
                                                 'new usable copies; the toolkit draws only TOWN iron, toolkit.mjs kitDraw)', W,
                                                 self.bh_denom(), self.control('_toolkit'),
                                                 self.status('_toolkit', sum(town_kit.values())), by_tool=dict(town_kit),
                                                 kit_runs=len(kit), runs_by_outcome=dict(Counter(k['outcome'] for k in kit)),
                                                 ingots_drawn=int(sum(k['drew'] for k in kit)))
        out['kit_tools_from_bag_iron'] = metric(sum(bag_kit.values()), 'tools', 'ES craft status=success args.item=iron_axe|'
                                                'iron_shovel (the model\'s own craft, from the bag)', W, self.bh_denom(),
                                                self.control('craft'), self.status('craft', sum(bag_kit.values())),
                                                by_tool=dict(bag_kit), iron_pickaxes_crafted_from_bag=bag_pick)
        # -- shared projects: distinct bots placing blocks of the same plinth
        contrib = defaultdict(set)
        for r in self.rows('_plinth_step', status='success'):
            d = r['skill'].get('detail') or ''
            if kv(d, 'op') == 'place' and kv(d, 'id'):
                contrib[(world_of(r), kv(d, 'id'))].add(r['bot']['name'])
        multi = {k: v for k, v in contrib.items() if len(v) >= 2}
        out['shared_project_contributions'] = metric(len(multi), 'plinths with >= 2 distinct contributing bots',
                                                     'ES _plinth_step status=success op=place, grouped by plan id= and bot.name',
                                                     W, ('plinths worked on today', len(contrib)), self.control('_plinth_step'),
                                                     self.status('_plinth_step', len(contrib)),
                                                     projects=[{'world': w, 'id': i, 'bots': sorted(b)} for (w, i), b in sorted(contrib.items())],
                                                     distinct_contributors=len(set().union(*contrib.values())) if contrib else 0)
        wells = self.well_bots          # build() located them (at=, else bot.pos at a known well)
        out['wells_shared'] = metric(sum(1 for v in wells.values() if len(v) >= 2), 'wells used by >= 2 bots',
                                     'ES _well_dispose status=success, distinct bot.name per well (as wells_in_use locates them)', W,
                                     ('wells in use today', len(wells)), self.control('_well_dispose'),
                                     self.status('_well_dispose', len(wells)),
                                     bots_per_well_median=statistics.median([len(v) for v in wells.values()]) if wells else None)
        return out

    # ======================================================================================================= HEALTH
    def health(self, census_files):
        W, out = self.window, {}
        tail = EsEvents.load('skill', since=self.end - dt.timedelta(hours=3), until=self.end, gaps='raise')
        lat = tail.latest(require='bot.pos.x', fields=['bot.inventory', 'bot.tools', 'exp.pool'])
        slots_of, method = slot_counter(self.args.stack)
        per, items_slots, no_inv = {}, Counter(), []
        tools = Counter()
        for b, src in lat.items():
            bot = src.get('bot') or {}
            inv = bot.get('inventory')
            if not isinstance(inv, dict):
                no_inv.append(b); continue
            s = 0
            for it, c in inv.items():
                k = slots_of(it, num(c))
                s += k; items_slots[it] += k
            per[b] = s
            tl = bot.get('tools') or {}
            for name in ('iron_pickaxe', 'iron_axe', 'iron_shovel'):
                if tl.get(name):
                    tools[name + ' held'] += 1
                if usable(tl.get(name)):
                    tools[name + ' usable'] += 1
            for kind in ('pickaxe', 'axe', 'shovel'):
                best = None
                for tier in reversed(TIERS):
                    if usable(tl.get(f'{tier}_{kind}')):
                        best = tier; break
                tools[f'best usable {kind}: {best or "none"}'] += 1
        S = list(per.values())
        tw = f'{iso(self.end - dt.timedelta(hours=3))}..{iso(self.end)} (latest snapshot per bot)'
        sctl = {'window_docs': tail.total(), 'bots_present': len(tail.bots_present()), 'bots_with_snapshot': len(S),
                'state_row_without_inventory': sorted(no_inv)}
        tot = sum(S)
        out['bags_full'] = metric(sum(x >= FULL_AT for x in S), f'bots at >= {FULL_AT} of {SLOTS} slots',
                                  'ES latest bot.inventory per bot (require bot.pos.x), ' + method, tw,
                                  ('bots with a snapshot', len(S)), sctl,
                                  pct_bots_full=round(100 * sum(x >= FULL_AT for x in S) / len(S), 1) if S else None,
                                  pct_slots_used=round(100 * tot / (SLOTS * len(S)), 1) if S else None,
                                  median_slots=statistics.median(S) if S else None,
                                  top_slot_users=[{'item': k, 'slots': v, 'share_pct': round(100 * v / max(1, tot), 1)}
                                                  for k, v in items_slots.most_common(10)])
        out['tool_tiers'] = metric(tools.get('iron_pickaxe usable', 0), 'bots with a usable iron pickaxe',
                                   f'ES latest bot.tools per bot; usable = more than {USABLE_LEFT} uses left', tw,
                                   ('bots with a snapshot', len(S)), sctl, counts=dict(sorted(tools.items())))
        # -- town chests, from the census file for this day
        pick = pick_census(census_files, self.start, self.end)
        if pick:
            doc = json.load(open(pick[0]))
            cs = chest_summary(doc)
            disc = doc.get('discovery')
            cov = ({'method': disc['method'], 'holes': disc.get('holes'),
                    'region_only_bank_containers': sum(len(v['region_only_bank']) for v in disc['worlds'].values()),
                    'outside_bank_other': sum(v['outside_bank_other'] for v in disc['worlds'].values()),
                    'outside_bank_loot_unopened': sum(v['outside_bank_loot_unopened'] for v in disc['worlds'].values())}
                   if disc else
                   {'method': f'census3 over a fixed positions list ({doc.get("positions_file")}): containers placed after '
                              '10-14 inside the bank box could not be seen by this run',
                    'checked_10_19': 'a region-file discovery at 12:44Z 10-19 found 349 bank-box containers, 0 missing from '
                                     'that list, so the list was complete for the bank box on 10-19; earlier days unverified'})
            cctl = {'census_file': os.path.basename(pick[0]), 'census_started': iso(pick[1]), 'containers_read': cs['containers'],
                    'incomplete_reads': cs['incomplete'], 'worlds_read': cs['worlds'], 'worlds_failed': cs['worlds_failed'],
                    'coverage': cov}
            cst = 'census_partial' if cs['worlds_failed'] or cs['incomplete'] else 'live'
            out['chests_pct_full'] = metric(cs['pct_full'], '% of slots used', 'town chest census (RCON data get, bank box '
                                            '|dx|,|dz|<=48 |dy|<=12 from home)', f'census at {iso(pick[1])}',
                                            ('chest slots (27 per container block entity)', cs['slots']), cctl, cst,
                                            slots_used=cs['slots_used'], top_items_by_slots=cs['top_items_by_slots'])
            out['chests_full'] = metric(cs['full'], 'containers with 27/27 slots used', 'town chest census', f'census at {iso(pick[1])}',
                                        ('containers read', cs['containers']), cctl, cst, per_world=cs['per_world'])
        else:
            for k in ('chests_pct_full', 'chests_full'):
                out[k] = metric(None, '', 'town chest census', W, None,
                                {'census_files_seen': len(census_files), 'census_dir': self.args.census_dir},
                                'no_census', f'no census file started in {iso(self.start)}..{iso(self.end + dt.timedelta(hours=3))}: '
                                'UNKNOWN, not zero (run chestclear3/goalcensus.py on 10.0.0.30 and carry the file here)')
        # -- success rates
        for kind in ('gather', 'craft', 'mine'):
            st = self.ev.terms('skill.status', kind, allow_zero=True)
            n, ok = sum(st.values()), st.get('success', 0)
            out[f'{kind}_success'] = metric(round(100 * ok / n, 1) if n else None, '% of attempts succeeded',
                                            f'ES {kind} skill.status', W, (f'{kind} attempts', n), self.control(kind),
                                            self.status(kind, n), successes=ok, success_per_bot_hour=round(ok / self.bh, 3) if self.bh else None,
                                            by_status=dict(st))
        return out


# ------------------------------------------------------------------------------------------------ fleet-wide inputs
def raised_wells(wells_dir, kinds):
    """{world: [(x, y, z, done_at)]} from the plinth records (state complete) and ES _plinth stage=complete rows."""
    out = defaultdict(list)
    for f in glob.glob(os.path.join(wells_dir, '_pool-*', 'junkwell-plinth-*.json')):
        b = os.path.basename(f)
        if '.lease.' in b or 'caprefused' in b:
            continue
        try:
            o = json.load(open(f))
        except (OSError, ValueError):
            continue
        cap = (o.get('plan') or {}).get('cap')
        if o.get('state') == 'complete' and cap:
            pool = os.path.basename(os.path.dirname(f))[len('_pool-'):]
            done = dt.datetime.fromtimestamp(o['doneAt'] / 1000, UTC) if o.get('doneAt') else None
            out[pool_group(pool)].append((cap['x'], cap['y'], cap['z'], done))
    first = kinds.first('_plinth')
    ev = EsEvents.load('skill', since=first, until=dt.datetime.now(UTC), gaps='clip')
    for r in ev.rows('_plinth', fields=ROW_FIELDS, status='success', allow_zero=True):
        d = r['skill'].get('detail') or ''
        p = xyz(kv(d, 'at'))
        if kv(d, 'stage') == 'complete' and p:
            out[world_of(r)].append(p + (parse_ts(r['@timestamp']),))
    return out


def known_wells(wells_dir, raised):
    """{world: [(x, y, z)]}: every well site ever recorded (all gN files) + every raised cap -- where a dispose row whose
    at= was truncated may be placed (locate_wells)."""
    out = defaultdict(set)
    for f in glob.glob(os.path.join(wells_dir, '_pool-*', 'junkwell-site-*.g*.json')):
        pool = os.path.basename(os.path.dirname(f))[len('_pool-'):]
        if '.pre-reseed' in pool:
            continue
        try:
            o = json.load(open(f))
            out[pool_group(pool)].add((int(o['x']), int(o['y']), int(o['z'])))
        except (OSError, ValueError, KeyError):
            continue
    for w, caps in raised.items():
        out[w] |= {tuple(c[:3]) for c in caps}
    return {w: sorted(v) for w, v in out.items()}


def well_records_now(wells_dir, raised):
    """The well sites on record NOW (files): per world, distinct current sites (the highest g per pool), raised or not."""
    out = {}
    pools = defaultdict(list)
    for f in glob.glob(os.path.join(wells_dir, '_pool-*', 'junkwell-site-*.g*.json')):
        m = re.search(r'\.g(\d+)\.json$', f)
        pool = os.path.basename(os.path.dirname(f))[len('_pool-'):]
        if m and '.pre-reseed' not in pool:
            pools[(pool, re.sub(r'\.g\d+\.json$', '', os.path.basename(f)))].append((int(m.group(1)), f))
    sites = defaultdict(set)
    for (pool, _), gs in pools.items():
        try:
            o = json.load(open(max(gs)[1]))
            sites[pool_group(pool)].add((int(o['x']), int(o['y']), int(o['z'])))
        except (OSError, ValueError, KeyError):
            continue
    now = dt.datetime.now(UTC)
    for w, ss in sorted(sites.items()):
        keys = []
        for p in ss:
            k = cluster_key(p, keys)
            if k == p:
                keys.append(p)
        out[w] = {'sites': len(keys), 'raised': sum(is_raised(p, now, raised.get(w, [])) for p in keys),
                  'at': [list(p) for p in keys]}
    return out


def load_deaths(until):
    ev = EsEvents.load('skill', since=STREAK_SINCE, until=until, gaps='raise')
    seen, out = set(), defaultdict(list)
    for r in ev.rows('_death', fields=['@timestamp', 'bot.name'], allow_zero=True):
        k = (r['bot']['name'], r['@timestamp'])
        if k not in seen:
            seen.add(k); out[k[0]].append(parse_ts(k[1]))
    for v in out.values():
        v.sort()
    return out


def load_homes(census_files):
    """{world: [x, y, z]} -- each town's home, from the newest census file that names it (census3/goalcensus carry it)."""
    homes = {}
    for f, _ in sorted(census_files, key=lambda x: x[1]):
        try:
            for w, v in json.load(open(f)).get('worlds', {}).items():
                if isinstance(v.get('home'), list) and len(v['home']) == 3:
                    homes[w] = v['home']
        except (OSError, ValueError):
            continue
    return homes


def census_index(d):
    out = []
    for f in sorted(glob.glob(os.path.join(os.path.expanduser(d), 'census-*.json'))):
        try:
            with open(f) as fh:
                head = fh.read(400)
            m = re.search(r'"started_utc":\s*"([^"]+)"', head)
            if m:
                out.append((f, parse_ts(m.group(1))))
                continue
            o = json.load(open(f))
            if o.get('started_utc') and isinstance(o.get('worlds'), dict):
                out.append((f, parse_ts(o['started_utc'])))
        except (OSError, ValueError):
            continue
    return out


# ------------------------------------------------------------------------------------------------ the day document
HEADLINES = [   # (section, key, field, label, unit, better)  better: +1 up is good, -1 down is good, 0 neutral
    ('build', 'buildings_b5', 'value', 'Buildings (B5, counted from the world)', 'buildings', 1),
    ('build', 'wells_in_use', 'value', 'Wells in use', 'wells', 1),
    ('build', 'raised_wells_in_use', 'value', 'Raised wells in use', 'wells', 1),
    ('build', 'plinth_blocks_placed', 'value', 'Plinth blocks placed', 'blocks', 1),
    ('build', 'copper_smelted', 'value', 'Copper smelted', 'ingots', 1),
    ('build', 'wood_used_by_crafts', 'value', 'Wood used by crafts', 'log-eq', 1),
    ('build', 'cobble_placed_in_builds', 'value', 'Cobble placed in builds', 'blocks', 1),
    ('build', 'iron_used_by_toolkit', 'value', 'Iron used by toolkit', 'ingots', 1),
    ('build', 'farm_blocks', 'value', 'Farm blocks placed', 'blocks', 1),
    ('survive', 'deaths', 'rate', 'Deaths per bot-hour', '/bot-h', -1),
    ('survive', 'deaths', 'value', 'Deaths', 'deaths', -1),
    ('survive', 'bot_hours_online', 'value', 'Bot-hours online', 'bot-h', 1),
    ('survive', 'underground_death_share', 'value', 'Underground death share', '%', -1),
    ('survive', 'survival_streaks', 'value', 'Median current streak', 'h', 1),
    ('together', 'town_deposits_ok', 'rate', 'Town deposits ok per bot-hour', '/bot-h', 1),
    ('together', 'town_withdrawals_ok', 'rate', 'Town withdrawals ok per bot-hour', '/bot-h', 1),
    ('together', 'items_into_town_chests', 'value', 'Items into town chests', 'items', 1),
    ('together', 'items_out_of_town_chests', 'value', 'Items out of town chests', 'items', 1),
    ('together', 'pickaxes_fetched', 'value', 'Pickaxes fetched', 'pickaxes', 1),
    ('together', 'kit_tools_from_town_iron', 'value', 'Kit tools from town iron', 'tools', 1),
    ('together', 'kit_tools_from_bag_iron', 'value', 'Kit tools from bag iron', 'tools', 0),
    ('together', 'shared_project_contributions', 'value', 'Plinths built by 2+ bots', 'plinths', 1),
    ('together', 'wells_shared', 'value', 'Wells shared by 2+ bots', 'wells', 1),
    ('health', 'bags_full', 'pct_bots_full', 'Bags full', '% bots', -1),
    ('health', 'chests_pct_full', 'value', 'Town chest slots used', '%', 0),
    ('health', 'chests_full', 'value', 'Town chests full', 'chests', -1),
    ('health', 'gather_success', 'value', 'Gather success', '%', 1),
    ('health', 'craft_success', 'value', 'Craft success', '%', 1),
    ('health', 'mine_success', 'value', 'Mine success', '%', 1),
    ('health', 'tool_tiers', 'value', 'Bots with usable iron pickaxe', 'bots', 1),
]


def structcount_metric(day, sdir, reader):
    """OWNER B5 buildings, counted FROM THE WORLD (the structure count, building tier step 0) for one UTC day: the count
    published on 10.0.0.30 after that day's 03:15Z backup and mirrored here by pull.py. Read with the count's own reader;
    anything but an OK publication FOR THAT DAY is a gap ('no_structcount'), never a zero."""
    src = 'structcount (10.0.0.30 ~/structcount/out, mirrored to %s)' % sdir
    window = 'the worlds as of the %s 03:15Z backup' % day.isoformat()
    try:
        spec = importlib.util.spec_from_file_location('scread', os.path.expanduser(reader))
        rd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rd)
        d = os.path.expanduser(sdir)
        r = rd.status(d, os.path.join(d, 'attempts'), day.isoformat(), only=rd.MIRROR_FILES)
    except Exception as e:                       # noqa: BLE001 -- an unreadable count is a gap with its reason
        return metric(None, 'buildings', src, window, status='no_structcount', note='%s: %s' % (type(e).__name__, str(e)[:80]))
    if r['status'] != 'OK':
        return metric(None, 'buildings', src, window, status='no_structcount', note='%s: %s' % (r['status'], r['why']))
    t = r['totals'] or {}
    return metric(t.get('buildings'), 'buildings', src, window, denom=('worlds counted', t.get('worlds')), rate_ok=False,
                  control='published only after the stamp, coverage and negative controls passed in every world',
                  unlit_rooms=t.get('unlit_rooms'), surface_structures=t.get('surface_structures'),
                  by_world={w: v.get('buildings') for w, v in sorted((r['doc'] or {}).items())})


def headline(doc):
    row = {'day': doc['day'], 'partial': doc['partial']}
    for sec, key, field, *_ in HEADLINES:
        m = doc[sec].get(key) or {}
        # a day before the kind existed is a GAP in the trend, not a zero (it would drag the average down)
        row[f'{sec}.{key}.{field}'] = None if m.get('status') in ('not_live_yet', 'no_census', 'no_structcount') else m.get(field)
    return row


RATE_UNITS = ('/bot-h', '%', '% bots', 'h')    # comparable on a partial day; every other headline is a COUNT


def day_doc(day, now, kinds, args, raised, deaths, census_files, known, homes):
    D = Day(day, now, kinds, args)
    D.known_wells = known
    D.homes = homes
    versions = D.ev.terms('code.version')
    doc = {'schema': 'goalboard/1', 'day': day.isoformat(), 'window': D.window, 'partial': D.partial,
           'generated_at': iso(dt.datetime.now(UTC)),
           'fleet': {'docs': D.total, 'bots_present': len(D.bots), 'active_bot_hours': D.bh, 'worlds': D.worlds,
                     'builds_live': {k[:8] + k[40:]: v for k, v in sorted(versions.items(), key=lambda x: -x[1])[:6]},
                     'caveats': D.ev.caveats},
           'build': D.build(raised), 'survive': D.survive(deaths), 'together': D.together(), 'health': D.health(census_files)}
    doc['build']['buildings_b5'] = structcount_metric(day, getattr(args, 'structcount_dir', '~/structcount/in'),
                                                      getattr(args, 'structcount_reader', '~/structcount/bin/scread.py'))
    return doc


# ------------------------------------------------------------------------------------------------ HTML
def fmt(v, unit=''):
    if v is None:
        return '—'
    if isinstance(v, float):
        v = round(v, 3 if abs(v) < 1 else 1)
        if v == int(v) and abs(v) >= 10:
            v = int(v)
    s = f'{v:,}' if isinstance(v, int) else str(v)
    return s


def spark(vals, partial_last=False, w=132, h=34):
    """A 7-day sparkline; a partial last day is drawn HOLLOW with a dashed segment (it is not a full day)."""
    pts = [(i, v) for i, v in enumerate(vals) if isinstance(v, (int, float))]
    if len(pts) < 2:
        return '<svg class="spark" width="%d" height="%d" aria-hidden="true"></svg>' % (w, h)
    lo, hi = min(v for _, v in pts), max(v for _, v in pts)
    span = (hi - lo) or 1
    n = max(1, len(vals) - 1)
    X = lambda i: 4 + i * (w - 8) / n
    Y = lambda v: h - 5 - (v - lo) * (h - 10) / span
    part = partial_last and pts[-1][0] == len(vals) - 1
    solid = pts[:-1] if part else pts
    path = ' '.join(('M' if k == 0 else 'L') + f'{X(i):.1f},{Y(v):.1f}' for k, (i, v) in enumerate(solid))
    dash = ''
    if part:
        (i0, v0), (i1, v1) = pts[-2], pts[-1]
        dash = f'<path class="dash" d="M{X(i0):.1f},{Y(v0):.1f} L{X(i1):.1f},{Y(v1):.1f}"/>'
    last = pts[-1][0]
    dots = ''.join(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="{4 if i == last else 2.2}" '
                   f'class="{("partial" if part else "last") if i == last else "pt"}"><title>{fmt(v)}'
                   f'{" (partial day)" if part and i == last else ""}</title></circle>' for i, v in pts)
    body = (f'<path d="{path}"/>' if len(solid) >= 2 else '') + dash
    return f'<svg class="spark" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img">{body}{dots}</svg>'


def render_html(docs):
    docs = sorted(docs, key=lambda d: d['day'])
    cur = docs[-1]
    hist = docs[-7:]
    days = [d['day'][5:] + ('*' if d['partial'] else '') for d in hist]
    H = [headline(d) for d in hist]
    secs = {'build': 'Build', 'survive': 'Survive', 'together': 'Work together', 'health': 'Health'}
    e = html.escape
    parts = []
    for sec, title in secs.items():
        tiles = []
        for s2, key, field, label, unit, better in HEADLINES:
            if s2 != sec:
                continue
            m = cur[sec].get(key) or {}
            series = [h.get(f'{sec}.{key}.{field}') for h in H]
            v = m.get(field)
            prev = [x for x in series[:-1] if isinstance(x, (int, float))]
            avg = sum(prev) / len(prev) if prev else None
            trend = ''
            if cur['partial'] and unit not in RATE_UNITS:
                trend = '<span class="trend flat">partial day: count not compared</span>'
            elif isinstance(v, (int, float)) and avg is not None:
                diff = v - avg
                cls = 'flat' if abs(diff) < 1e-9 or better == 0 else ('good' if diff * better > 0 else 'bad')
                arrow = '▲' if diff > 0 else '▼' if diff < 0 else '■'
                trend = f'<span class="trend {cls}">{arrow} vs {fmt(avg)} avg</span>'
            den = m.get('denominator') or {}
            badge = ''
            if m.get('status') in ('not_live_yet', 'no_census', 'no_structcount', 'census_partial', 'zero_kind_present', 'zero_kind_absent'):
                badge = f'<span class="badge">{e(m["status"].replace("_", " "))}</span>'
            tip = f'source: {m.get("source", "")}\nwindow: {m.get("window", "")}\ndenominator: {den.get("what", "-")} = {den.get("value", "-")}'
            tiles.append(f'''<div class="tile" title="{e(tip)}"><div class="lab">{e(label)} {badge}</div>
<div class="val">{e(fmt(v))}<span class="unit"> {e(unit)}</span></div>{spark(series, cur['partial'])}
<div class="sub">{trend}</div><div class="den">of {e(str(den.get("what", "—")))}: {e(fmt(den.get("value")))}</div></div>''')
        parts.append(f'<section><h2>{e(title)}</h2><div class="grid">{"".join(tiles)}</div></section>')

    def table(head, rows):
        return '<div class="tw"><table><thead><tr>' + ''.join(f'<th>{e(str(h))}</th>' for h in head) + '</tr></thead><tbody>' + \
            ''.join('<tr>' + ''.join(f'<td>{e(fmt(c) if not isinstance(c, str) else c)}</td>' for c in r) + '</tr>' for r in rows) + \
            '</tbody></table></div>'
    b, s, t, h = cur['build'], cur['survive'], cur['together'], cur['health']
    wp = b['wells_per_world']
    details = [
        ('Wells per world', table(['world', 'raised in use', 'natural in use', 'disposes', 'bots'],
                                  [[w, v['raised_in_use'], v['natural_in_use'], sum(x['disposes'] for x in v['wells']),
                                    len({y for x in v['wells'] for y in x['bots']})] for w, v in wp.items()])),
        ('Deaths by cause', table(['cause', 'deaths', 'per bot-hour'],
                                  [[k, n, s['deaths'].get('by_cause_per_bot_hour', {}).get(k)] for k, n in s['deaths']['by_cause'].items()])),
        (f'Longest survival streaks ({s["survival_streaks"]["window"]})', table(['bot', 'hours', 'censored'],
                                                    [[x['bot'], x['hours'], 'yes' if x['censored'] else 'no'] for x in s['survival_streaks']['longest']])),
        ('Shared plinth projects', table(['world', 'plan id', 'bots'],
                                         [[p['world'], p['id'], ', '.join(p['bots'])] for p in t['shared_project_contributions']['projects']])),
        ('Top bag slot users', table(['item', 'slots', 'share %'],
                                     [[x['item'], x['slots'], x['share_pct']] for x in h['bags_full'].get('top_slot_users', [])])),
        ('Town chests per world', table(['world', 'containers', 'slots used %', 'full'],
                                        [[w, v['containers'], v['pct_full'], v['full']] for w, v in (h['chests_full'].get('per_world') or {}).items()])),
        ('Tool tiers', table(['tool', 'bots'], [[k, v] for k, v in (h['tool_tiers'].get('counts') or {}).items()])),
    ]
    hist_rows = []
    for sec, key, field, label, unit, _ in HEADLINES:
        hist_rows.append([f'{label} ({unit})'] + [hh.get(f'{sec}.{key}.{field}') for hh in H])
    det = ''.join(f'<details><summary>{e(n)}</summary>{x}</details>' for n, x in details)
    cav = ''.join(f'<li>{e(c)}</li>' for c in cur['fleet']['caveats'])
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fleet Goal Board</title>
<style>
:root{{--bg:#f6f6f4;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#7a7974;--line:#e3e2dd;--series:#2a78d6;--good:#008300;--bad:#c4312f;--badge:#eee9da}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#121211;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#97968e;--line:#2e2d2a;--series:#3987e5;--good:#3fae3f;--bad:#e66767;--badge:#34322b}}}}
:root[data-theme="dark"]{{--bg:#121211;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#97968e;--line:#2e2d2a;--series:#3987e5;--good:#3fae3f;--bad:#e66767;--badge:#34322b}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px 16px}}
main{{max-width:1180px;margin:0 auto}}h1{{font-size:22px;margin:0 0 4px}}h2{{font-size:16px;margin:28px 0 10px;color:var(--ink2);font-weight:600;letter-spacing:.02em;text-transform:uppercase}}
.meta{{color:var(--ink2);margin:0 0 6px}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}}
.tile{{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}}
.lab{{color:var(--ink2);font-size:12.5px;min-height:18px}}.val{{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums;margin:2px 0}}
.unit{{font-size:12px;color:var(--muted);font-weight:400}}.sub{{font-size:12px;min-height:16px}}.den{{font-size:11.5px;color:var(--muted)}}
.trend.good{{color:var(--good)}}.trend.bad{{color:var(--bad)}}.trend.flat{{color:var(--muted)}}
.badge{{background:var(--badge);color:var(--ink2);border-radius:4px;padding:0 5px;font-size:11px;white-space:nowrap}}
.spark{{display:block;margin:4px 0;overflow:visible}}.spark path{{fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}}
.spark path.dash{{stroke-dasharray:3 3}}.spark circle.partial{{fill:var(--surface);stroke:var(--series);stroke-width:2}}.spark circle.pt{{fill:var(--series);opacity:.55}}.spark circle.last{{fill:var(--series);stroke:var(--surface);stroke-width:2}}
details{{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:8px 14px}}summary{{cursor:pointer;font-weight:600}}
.tw{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;margin:8px 0;font-variant-numeric:tabular-nums}}th,td{{text-align:left;padding:4px 10px 4px 0;border-bottom:1px solid var(--line);white-space:nowrap}}
th{{color:var(--ink2);font-weight:600;font-size:12.5px}}ul{{color:var(--ink2);font-size:12.5px;padding-left:18px}}
</style></head><body><main>
<h1>Fleet goal board — {e(cur["day"])}{" (partial day)" if cur["partial"] else ""}</h1>
<p class="meta">Build, survive, work together. Window {e(cur["window"])} · {fmt(cur["fleet"]["bots_present"])} bots · {fmt(cur["fleet"]["active_bot_hours"])} active bot-hours · {len(cur["fleet"]["worlds"])} worlds · generated {e(cur["generated_at"])}</p>
<p class="meta">Each tile: today's value, the trend over the last {len(hist)} days ({e(", ".join(days))}; * = partial day), and today against the earlier days' average. Hover a tile for its source, window and denominator; the JSON carries every positive control.</p>
{"".join(parts)}
<h2>Details</h2>{det}
<details open><summary>History table ({len(hist)} days)</summary>{table(["metric"] + days, hist_rows)}</details>
<h2>Caveats</h2><ul>{cav}<li>Raised vs natural wells use plinth records as they stand now plus ES _plinth completions.</li><li>Town chest figures come from the census nearest each day's end (census files before 10-19 used the fixed 10-14 positions list).</li></ul>
</main></body></html>'''


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--from', dest='frm', help='first UTC day (YYYY-MM-DD); default: yesterday')
    ap.add_argument('--to', help='last UTC day; default: --from. Today gives a PARTIAL day')
    ap.add_argument('--out-dir', default='~/goalboard/out')
    ap.add_argument('--census-dir', default='~/goalboard/census')
    ap.add_argument('--structcount-dir', default='~/structcount/in', help='the pull.py mirror of the structure count')
    ap.add_argument('--structcount-reader', default='~/structcount/bin/scread.py')
    ap.add_argument('--wells-dir', default='/var/lib/mcai')
    ap.add_argument('--stack', default='~/stack.json')
    ap.add_argument('--html', help='write the self-contained page here (today vs the 7-day trend)')
    ap.add_argument('--now', help='ISO "now" (testing)')
    a = ap.parse_args()
    now = parse_ts(a.now) if a.now else dt.datetime.now(UTC)
    first = dt.date.fromisoformat(a.frm) if a.frm else (now - dt.timedelta(days=1)).date()
    last = dt.date.fromisoformat(a.to) if a.to else first
    out_dir = os.path.expanduser(a.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    kinds = Kinds()
    raised = raised_wells(a.wells_dir, kinds)
    deaths = load_deaths(min(now, dt.datetime.combine(last + dt.timedelta(days=1), dt.time(0), UTC)))
    census_files = census_index(a.census_dir)
    known = known_wells(a.wells_dir, raised)
    homes = load_homes(census_files)
    day = first
    while day <= last:
        doc = day_doc(day, now, kinds, a, raised, deaths, census_files, known, homes)
        if day == last:
            doc['build']['well_records_now'] = {'source': 'files /var/lib/mcai/_pool-*/junkwell-site-*.gN.json (highest g per '
                                                          'pool) vs complete plinths', 'as_of': iso(now),
                                                'worlds': well_records_now(a.wells_dir, raised)}
        path = os.path.join(out_dir, f'goalboard-{day.isoformat()}.json')
        with open(path, 'w') as fh:
            json.dump(doc, fh, indent=1, default=str)
        b, s, t = doc['build'], doc['survive'], doc['together']
        print(f'{day} {"PARTIAL " if doc["partial"] else ""}bots {doc["fleet"]["bots_present"]} bh {doc["fleet"]["active_bot_hours"]} | '
              f'wells {b["wells_in_use"]["value"]} (raised {b["raised_wells_in_use"]["value"]}) plinth blocks {b["plinth_blocks_placed"]["value"]} '
              f'copper {b["copper_smelted"]["value"]} | deaths {s["deaths"]["value"]} ({s["deaths"].get("rate")}/bh) '
              f'ug {s["underground_death_share"]["value"]}% | deposits ok {t["town_deposits_ok"]["value"]} picks {t["pickaxes_fetched"]["value"]} '
              f'kits town {t["kit_tools_from_town_iron"]["value"]} bag {t["kit_tools_from_bag_iron"]["value"]} -> {path}', flush=True)
        day += dt.timedelta(days=1)
    # the 7-day history: every saved day doc in out_dir up to `last`
    docs = []
    for f in sorted(glob.glob(os.path.join(out_dir, 'goalboard-????-??-??.json'))):
        d = json.load(open(f))
        if d['day'] <= last.isoformat():
            docs.append(d)
    docs = docs[-7:]
    hist = {'schema': 'goalboard-history/1', 'through': last.isoformat(), 'generated_at': iso(dt.datetime.now(UTC)),
            'metrics': [{'section': s, 'key': k, 'field': f, 'label': l, 'unit': u, 'better': b} for s, k, f, l, u, b in HEADLINES],
            'days': [headline(d) for d in docs]}
    with open(os.path.join(out_dir, 'goalboard-history.json'), 'w') as fh:
        json.dump(hist, fh, indent=1)
    if a.html:
        with open(os.path.expanduser(a.html), 'w') as fh:
            fh.write(render_html(docs))
        print('html ->', a.html)


if __name__ == '__main__':
    main()
