#!/usr/bin/env python3
r"""staffcensus.py -- S0, the deterministic STAFFING CENSUS (overseer-assigner design r3, section 6). READ ONLY.

Design: docs/reports/overseer-assigner-design-2026-10-19.md (sections 4.2, 4.4, 5 and 6). OWNER 10-19 ~14:10Z: the overseer
is not an actor yet; S0 comes first; the first multi-bot project it is judged on is monument-01 (the ziggurat). This script
measures, per SHARED town and per 5-minute slot, minute by minute, whether a job assigner would have had anything to assign:

  open        a project is sited in the town (its record file exists / its site row was logged)
  demand      pending | none | unknown -- the project's own rows say whether work is outstanding. A row that read no plot
              (a lease held by another bot, the lane off, an unloaded view) is NO evidence; unknown is never none
  builders    bots inside the project's skill: [@timestamp, @timestamp + duration_ms) of its rows -- a skill row is stamped
              at its START (measured 10-19: town_deposit's own event lands ~200 ms before @timestamp + duration_ms)
  at town     a bot whose newest INSTANT row (an event row `_kind`, with a position) at or before the minute's end is within
              48 blocks (horizontal) and 12 (vertical) of home -- the farm order's own predicate (treefarm.mjs farmOrder
              TOWN_RADIUS / FARM_ORDER_DY). Skill rows are not used for position or bags: they carry the END snapshot. A
              position is carried for at most 10 minutes
  flagged     the validator's safety filter (design 4.4): a trap or drowning row in the last 5 min, health <= 10, a death
  ASSIGNABLE  a minute is assignable when the project is open, demand is pending, builders < cap, >= 2 bots are at town, and
              >= 1 of them is unflagged, not building, holds the material the work needs, is out of ITS OWN order cooldown /
              failure backoff / budget (the job's own admission: a lease only reorders, design 4.3), and has been so for longer
              than the rotation's own pick-up latency (the order's scan: an eligible bot would take the job itself by then).
              That is the design's "a project is open, 2 or more bots are at town, and a role would change the job order",
              made computable. Every pending minute that is NOT assignable is charged to the FIRST condition that failed (the
              "blocked by" funnel), and the funnel sums to the pending minutes, so a zero always comes with its denominator.
              It is a LOWER BOUND: a run the model chose is charged as an order issue (a cooldown the bot may not have had),
              and a bot restart clears cooldowns and backoffs the census still applies
  labour      at-town bot-minutes: in the project, in another town job, flagged (by class), or free (the pool a lease would
              draw from)
  placed      server-witnessed project cells (the project's own confirmed-placement rows) -> cells per open town-hour,
              the pre-period null of the design's primary metric
  stock       the town journal (town-chest-<home>.cobble.jsonl) folded per container at each slot end: known / stale (> 2 h)
              / unknown (voided and not recounted, or never counted). A town with any unknown container has a LOWER BOUND,
              never a total. Items the journal does not track (saplings) are reported as untracked, never as 0. A journal
              that cannot be read is stock VOID
  home        `home` success under the validator's filter (no interrupt trigger, not flagged in the 5 min before its start,
              health > 10 at its start from the instant rows) -- RECALL's gate (>= 70%), recorded per slot by every tick

PROJECTS are adapters (PROJECTS below). treefarm (treefarm-02, live on its canary pools since 10-19 12:51Z) is single-
builder: ONE leaseholder (blueprint.mjs LEASE_MS 90 s), cap 1, self-supplied from the builder's bag. Its readings are the
INSTRUMENT check (design 6: the census must see its builder lease, placements and sapling stock), not headroom. monument
(monument-01, the ziggurat: SLOTS 3) is built from the rows of the monument-on-* branches and is FIXTURE-ONLY until it runs
on the fleet -- its live mapping is unverified and every report says so.

THE GATE (design 6): >= 20 assignable town-hours/day across eligible towns for 48 h, on a MULTI-BOT project (cap >= 2).
It is decided only on >= 48 h, with >= 90% VALID (of the project's town-hours, of every town's, and of each project
town's every 24-h block), and EVERY whole 24-h block >= 20 (a mean over 48 h is not "for 48 h"). A single-builder project's assignable hours are reported; its gate line says "not applicable".

CAPABILITY (B0a, cooperation-tier design r9.1 sections 1.6 and 6.4). A project is OPEN in a town only when its RECORD exists
AND its code is running there: the town has at least one bot whose newest mode row for the project's module
(`Project.mode_kind`) says on and carries that bot's CURRENT code.version. A record whose code is not running (a reverted
canary's leftover record, a flag set off, a rollback) is `record_without_code`: reported per slot, never open, never
assignable. A bot whose current build's spawn rows (SPAWN_MARKERS: every per-spawn `_*_mode` row) are not in view is VOID
for capability -- unknown, never incapable. Mode rows are written ONCE PER PROCESS, so --tick keeps each bot's newest mode
row per kind as persistent state (out-dir/capability-state.json). The SEED is PER BOT: a first tick (or any --window run)
walks the mode kinds back 1, then 3, then 7 days until every present bot's current build has a spawn row, never past
7 days or before 2026-10-08 (estelemetry refuses windows touching 10-07); a tick re-walks hourly while any present bot is
still missing one; an empty walk is never saved. Every mode query is bounded the same way. POSITIVE CONTROL: the same
reader on `_townindex_mode` over EVERY present bot with a known version (a bot whose version changed < 10 min ago is not
yet eligible; a VOID bot counts as not capable) must find >= 95% capable; a shortfall, or bots present with none
eligible, is an ALARM in the heartbeat (`capability_control.alarm`, StaffCensusCapability in check-staffcensus.py), never a
census void. CAPABILITY IS JUDGED PER MINUTE from each bot's version at that minute: not_capable minutes are not open; VOID
minutes (and pending minutes where only a VOID bot could have been the free one) leave the project's denominator.

VOID, NOT ZERO. A slot is void when ES holds no document in its 10-minute bucket or no positioned event row in it, when a
town logged nothing in it (the town roster comes from the pool state dir, so a town silent for the whole window still gets
VOID rows -- so a RETIRED pool reads VOID forever until the census learns to exclude it; see CRON), or (in --report) when the census
never wrote it. Void slots leave every denominator; their count is printed. A
census that stops, fails or goes blind must read VOID: every run appends a heartbeat line (status ok = it MEASURED
something; void / idle / locked / error are not ok), and check-staffcensus.py alarms when the newest measuring tick goes
stale (the shadow mayor died silently on 10-13 and was believed to be recording for 5.6 days).

MODES
    python3 -B staffcensus.py --selftest            # the fixture: known answers + a positive control; exit 1 on failure
    python3 -B staffcensus.py --window 24           # the last 24 h from ES -> report (stdout + --out-dir/reports), with the
                                                    # live instrument checks (lease files, placements, at-town agreement)
    python3 -B staffcensus.py --tick                # cron: the new complete slots since the last one -> out/slots/*.jsonl
    python3 -B staffcensus.py --report 48           # summarise what the ticks recorded; a slot never written is VOID
Every live mode runs the self-test first and refuses to read the fleet if it fails (a live zero is a negative, not a
control). Runs on 10.0.0.31 (ES read-only key; /var/lib/mcai pool state). Writes ONLY under --out-dir (no bytecode).

CRON (SUGGESTED, NOT INSTALLED; .31 runs UTC). Install from a stable copy, never /opt/minecraft-ai (a deploy resets that
tree): ~/staffcensus/scripts/{host/staffcensus.py,host/check-staffcensus.py,lib/estelemetry.py,lib/telemetry.py}.
  NOTE: every non-self _pool-* dir under /var/lib/mcai is a town. A RETIRED pool's dir reads VOID forever, trips
  StaffCensusVoid at half the roster, and keeps the gate NOT DECIDABLE (every town must be >= 90% valid). Do NOT edit the
  bots' state tree to steer this read-only tool: when a pool retires, add a census-side exclusion option (follow-up,
  not built). 10-19: all 12 shared pools are live.
    */5 * * * * cd /home/mike/staffcensus && /usr/bin/nice -n 10 /usr/bin/python3 -B scripts/host/staffcensus.py --tick --out-dir /home/mike/staffcensus/out >> /home/mike/staffcensus/out/tick.log 2>&1
    3,33 * * * * /usr/bin/python3 -B /home/mike/staffcensus/scripts/host/check-staffcensus.py --dir /home/mike/staffcensus/out >> /home/mike/staffcensus/out/check.log 2>&1
Output is about 2-3 MB/day (daily files under out/slots; nothing is ever deleted, no output cap stops the census).
"""
import sys

sys.dont_write_bytecode = True          # read only: no __pycache__ beside the scripts or the libraries

import argparse  # noqa: E402
import bisect  # noqa: E402
import datetime as dt  # noqa: E402
import fcntl  # noqa: E402
import glob  # noqa: E402
import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402
from collections import Counter, defaultdict  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UTC = dt.timezone.utc
SLOT_MS = 5 * 60_000
MIN_MS = 60_000
DAY_MS = 24 * 3600_000
TOWN_RADIUS = 48            # treefarm.mjs farmOrder: horizontal distance from home
TOWN_DY = 12                # treefarm.mjs FARM_ORDER_DY: at town means at town's level
CARRY_MS = 10 * 60_000      # a bot's last position is carried for at most this long (it logs instant rows constantly)
FLAG_MS = 5 * 60_000        # design 4.4: a trap or drowning flag in the last 5 min
LOW_HEALTH = 10             # design 4.4: health <= 10
STOCK_STALE_MS = 2 * 3600_000
LID_MS = 2 * 3600_000
INGEST_LAG_MS = 5 * 60_000  # estelemetry INGEST_LAG_S is 240 s: --window / --report end >= 5 min ago
TICK_SETTLE_MS = 10 * 60_000  # --tick reads a slot only 10 min after it ends: a skill row is stamped at its START but
#                              written at its END (the runner caps a skill at 180 s + grace), then up to 240 s of ingest
PROJECT_LOOKBACK_MS = 24 * 3600_000
JOB_LOOKBACK_MS = 6 * 3600_000      # >= every backoff below (the farm's no-site backoff is 2 h, the monument's 6 h)
GATE_TOWN_H_PER_DAY = 20.0
GATE_HOURS = 48
GATE_VALID_SHARE = 0.9

# the validator's safety filter (design 4.4), as ES kinds (24 h census 10-19: every name below is present in ES)
TRAP_KINDS = ('_entombed', '_entombed_unrecoverable', '_entombed_needs_blocks', '_marooned', '_marooned_needs_pickaxe',
              '_marooned_needs_scaffold', '_marooned_underfoot', '_stranded', '_stranded_underground',
              '_stranded_unrecoverable', '_stranded_escape_try', '_trapped_in_canopy', '_reflex_stuck', '_pathfinder_wedged',
              '_flooded_pocket_rung', '_flooded_pocket_side_exit', '_lava_adjacent_no_retreat', '_reflex_danger_block')
DROWN_KINDS = ('_drowning_route', '_drowning_up', '_drowning_to_air', '_drowning_breathing', '_drowning_ceiling_no_air',
               '_drowning_rescue_yielded', '_oxygen_critical_state', '_water_no_air_route', '_air_drowning_observed')
HEALTH_KINDS = ('_reflex_low_health', '_death')
FLAG_KINDS = TRAP_KINDS + DROWN_KINDS + HEALTH_KINDS
FLAG_CLASS = {**{k: 'trap' for k in TRAP_KINDS}, **{k: 'drowning' for k in DROWN_KINDS},
              '_reflex_low_health': 'low_health', '_death': 'death'}
# the deterministic town jobs (design 2.1's list): their body time is "in a town job", not free labour
TOWN_JOBS = ('smelt_town', 'furnace_drain', 'count_town', 'town_deposit', 'withdraw_pick', 'toolkit', 'dispose_well',
             'compost', 'wear_out', 'build_plinth', 'build_well', 'bamboo_sticks', 'deposit', 'withdraw', 'smelt')
RUNNER_DECLINES = {'runner_paused', 'runner_busy', 'body_held'}     # composter.mjs RUNNER_DECLINED: the cooldown alone
SAPLINGS = ('birch_sapling', 'oak_sapling')                  # treefarm.mjs FARM_SPECIES
CORE_ITEMS = ('cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'cobblestone')    # monumentjob.mjs
RESERVE_STONE = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite')        # well.mjs
FUND_KEEP = 64 + 1          # monumentjob.mjs FUND_KEEP = STONE_GUARD + 1
MIN_SPEND = 16              # monumentjob.mjs


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def ms_of(s):
    return int(dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp() * 1000)


def floor_slot(ms):
    return ms - ms % SLOT_MS


def kv(detail):
    """key=value fields of a row's detail (the rows these projects log are key=value by design)."""
    return dict(re.findall(r'(\w+)=(\S+)', detail or ''))


def num(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def census_map(s):
    """'ready:6,sapling:1' -> {'ready': 6, 'sapling': 1}; '-' -> {}."""
    out = {}
    for part in (s or '').split(','):
        k, _, v = part.partition(':')
        if k and k != '-' and v:
            out[k] = num(v)
    return out


def at_town(pos, home):
    if not pos or not home or pos[0] is None:
        return False
    dx, dz = pos[0] - home[0], pos[2] - home[2]
    return (dx * dx + dz * dz) ** 0.5 <= TOWN_RADIUS and abs(pos[1] - home[1]) <= TOWN_DY


# ---------------------------------------------------------------------------------------------- project adapters
class Project:
    """A project adapter. Pure: everything comes in as rows (dicts with t, bot, pool, kind, status, detail, args)."""
    name = '?'
    cap = 1
    builder_skill = '?'
    order_prefix = '?'            # a `_work_order` row for this project's job starts with this
    scan_ms = 30_000              # the rotation's own pick-up latency for an eligible bot at town
    cooldown_ms = 5 * 60_000      # per bot, charged when the order is ISSUED
    budget = None                 # (window_ms, max body ms) per bot, or None
    live = False                  # False: built from branch code, never seen on the fleet
    kinds = ()                    # ES kinds this adapter reads (besides _work_order and its builder skill)
    mode_kind = None              # the module's per-spawn licence row (B0a): no such row on a bot = its code is not running

    def mode_on(self, detail):
        """Does this module's mode row say the module is on? The contract asked of new modules (cooperation design A7):
        `on=on|off` (or `mode=on|off`) in the detail."""
        f = kv(detail)
        return str(f.get('on', f.get('mode', ''))).lower() in ('on', '1', 'true')

    def timeline(self, rows):
        """-> ({pool: sorted [(t, state, detail, need)]}, {pool: site time}); state in pending | none | unknown."""
        raise NotImplementedError

    def placed(self, rows):
        """-> {pool: [t, ...]} server-witnessed cells."""
        raise NotImplementedError

    def has_material(self, inv, need):
        raise NotImplementedError

    def backoff_ms(self, status, fail_class):
        """After a run of the builder skill -> ms of backoff (0 clears one), or None (the run changes nothing)."""
        raise NotImplementedError


class TreeFarm(Project):
    """treefarm-02 (blueprint.mjs + treefarm.mjs on tf-on-adbec4f 0b3a0d4c). One builder at a time; the bag supplies."""
    name = 'treefarm'
    cap = 1                       # blueprint.mjs: ONE BUILDER AT A TIME (a 90 s lease)
    builder_skill = 'tend_farm'
    order_prefix = 'tend_farm'
    scan_ms = 30_000              # treefarm.mjs FARM_SCAN_MS
    cooldown_ms = 5 * 60_000      # treefarm.mjs TEND_COOLDOWN_MS, charged when the order is issued (s.lastTendAt)
    live = True
    kinds = ('_farm_tend', '_farm_place', '_farm_site')
    mode_kind = '_treefarm_mode'      # treefarm emits none today: on the fleet its leftover records read record_without_code
    SOFT = {'farm_leased', 'farm_unknown'}   # treefarm.mjs TEND_SOFT_FAILS

    def backoff_ms(self, status, fail_class):
        """treefarm.mjs farmOrderOutcome."""
        if status in ('no_effect', 'aborted') or fail_class in self.SOFT or fail_class in RUNNER_DECLINES:
            return None
        if status == 'success':
            return 0
        return 2 * 3600_000 if fail_class == 'farm_no_site' else 20 * 60_000   # NO_SITE_BACKOFF_MS / TEND_BACKOFF_MS

    def timeline(self, rows):
        tl, site = defaultdict(list), {}
        for r in rows:
            k, p, t, d = r['kind'], r['pool'], r['t'], r.get('detail') or ''
            if k == '_farm_site' and r.get('status') == 'success':
                site[p] = min(site.get(p, t), t)
                tl[p].append((t, 'pending', 'founded: plots to plant', 'sapling'))
            elif k == '_work_order' and d.startswith(self.order_prefix):
                what = d.split('has work:', 1)[-1].strip() if 'has work:' in d else d[:60]
                need = 'sapling' if re.search(r'\b(plant|found)\b', what) else 'dirt' if 'soil' in what else \
                    'torch' if 'torch' in what else 'bone_meal' if 'bonemeal' in what else None
                tl[p].append((t, 'pending', f'order: {what}', need))
            elif k == '_farm_tend':
                f = kv(d)
                c = census_map(f.get('census'))
                # NO PLOT WAS READ (a lease held by another bot, the lane off, "cannot be settled from here": tendFarm
                # writes those skips before its census) or the view was unloaded: no evidence either way
                if not c or c.get('unknown'):
                    continue
                ready, lost, logs = c.get('ready', 0), c.get('soil_lost', 0), c.get('logs_above', 0)
                planted, soil, cleared = num(f.get('planted')), num(f.get('soil')), num(f.get('cleared'))
                left_ready, left_soil = max(0, ready - planted), max(0, lost - soil)   # one sapling / dirt per plot
                if left_ready or left_soil:
                    tl[p].append((t, 'pending', f'left after visit: ready {left_ready} soil {left_soil}',
                                  'sapling' if left_ready else 'dirt'))
                elif logs and cleared == 0:
                    tl[p].append((t, 'pending', f'{logs} plot(s) with leftover logs, none cleared', None))
                elif logs or num(f.get('failed')):
                    # `cleared` counts LOG BLOCKS and the census counts PLOTS; a refused mutation (a torch) is not in the
                    # census at all -- the residual cannot be read from the row
                    tl[p].append((t, 'unknown', f'cleared {cleared} log(s) of {logs} plot(s), failed {f.get("failed")}',
                                  None))
                else:
                    tl[p].append((t, 'none', f'visit left no plot work (census {f.get("census", "-")})', None))
        for p in tl:
            tl[p].sort(key=lambda x: x[0])
        return tl, site

    def placed(self, rows):
        out = defaultdict(list)
        for r in rows:
            if r['kind'] == '_farm_place' and r.get('status') == 'success':
                f = kv(r.get('detail'))
                if f.get('role') in ('plant', 'soil', 'torch') and f.get('verdict') == 'confirmed':   # placed, not dug
                    out[r['pool']].append(r['t'])
        return out

    def has_material(self, inv, need):
        if need == 'sapling':
            return any((inv or {}).get(s, 0) > 0 for s in SAPLINGS)
        if need in ('dirt', 'torch', 'bone_meal'):
            return (inv or {}).get(need, 0) > 0
        return True


def fundable(inv):
    """monumentjob.mjs fundable(items).total, from a bag map. Pure."""
    inv = inv or {}
    spare = max(0, sum(inv.get(n, 0) for n in RESERVE_STONE) - FUND_KEEP)
    total, from_reserve = 0, 0
    for n in CORE_ITEMS:
        have = inv.get(n, 0)
        if not have:
            continue
        if n in RESERVE_STONE:
            take = min(have, spare - from_reserve)
            if take > 0:
                total += take
                from_reserve += take
        else:
            total += have
    return total


class Monument(Project):
    """monument-01 (monumentjob.mjs on monument-on-* d2d7e6ff). Three admission slots. FIXTURE-ONLY until it runs live."""
    mode_kind = '_monument_mode'
    name = 'monument'
    cap = 3                        # monumentjob.mjs SLOTS
    builder_skill = 'build_monument'
    order_prefix = 'build_monument'
    scan_ms = 60_000               # no scan constant: the order is asked at each decision; a minute is the census's grain
    cooldown_ms = 10 * 60_000      # monumentjob.mjs MONUMENT_COOLDOWN_MS (s.lastIssuedAt)
    budget = (3600_000, 10 * 60_000)   # monumentjob.mjs MONUMENT_BUDGET_MS: body time per bot-hour
    live = False
    kinds = ('_monument', '_monument_site')

    def backoff_ms(self, status, fail_class):
        """monumentjob.mjs monumentOrderOutcome."""
        if status == 'success':
            return 0
        if fail_class == 'monument_no_site':
            return 6 * 3600_000
        if fail_class == 'monument_nothing_open':
            return 3600_000
        if fail_class in RUNNER_DECLINES:
            return None
        return 30 * 60_000 if status == 'failed' else None

    def timeline(self, rows):
        tl, site = defaultdict(list), {}
        for r in rows:
            k, p, t, d = r['kind'], r['pool'], r['t'], r.get('detail') or ''
            if k == '_monument_site' and r.get('status') == 'success':
                site[p] = min(site.get(p, t), t)
                tl[p].append((t, 'pending', 'sited', 'core'))
            elif k == '_work_order' and d.startswith(self.order_prefix):
                tl[p].append((t, 'pending', 'order: build_monument', 'core'))
            elif k == '_monument':
                f = dict(kv(d))
                f.update({a: str(v) for a, v in (r.get('args') or {}).items()})    # args are never cut (monumentArgs)
                stop, opn = f.get('stop', ''), num(f.get('open'), -1)
                if stop == 'complete' or r.get('fail_class') == 'monument_nothing_open' or opn == 0:
                    tl[p].append((t, 'none', f'nothing open (stop={stop or "-"} open={opn})', None))
                elif opn > 0:
                    tl[p].append((t, 'pending', f'layer {f.get("layer", "?")}: {opn} open', 'core'))
        for p in tl:
            tl[p].sort(key=lambda x: x[0])
        return tl, site

    def placed(self, rows):
        out = defaultdict(list)
        for r in rows:
            if r['kind'] == '_monument':
                f = dict(kv(r.get('detail')))
                f.update({a: str(v) for a, v in (r.get('args') or {}).items()})
                out[r['pool']].extend([r['t']] * max(0, num(f.get('placed'))))
        return out

    def has_material(self, inv, need):
        return fundable(inv) >= MIN_SPEND


PROJECTS = (TreeFarm(), Monument())


# ---------------------------------------------------------------------------------------------- capability (B0a)
SPAWN_MARKERS = ('_cobblecap_mode', '_lidclear_mode', '_townsearch_mode', '_toolkit_search_mode', '_plinth_mode',
                 '_wellcare_mode', '_poolescape_mode', '_cobblekeep_mode', '_keepout_mode', '_townindex_mode')
CONTROL_KIND = '_townindex_mode'
CAP_ALARM_SHARE = 0.95
CAP_GRACE_MS = 10 * MIN_MS
SEED_FLOOR_MS = ms_of('2026-10-08T00:00:00Z')
SEED_MAX_MS = 7 * DAY_MS
SEED_STEPS_MS = (DAY_MS, 3 * DAY_MS, 7 * DAY_MS)     # walk back until every present bot's current build has a spawn row
RESEED_EVERY_MS = 3600_000                            # a tick re-walks for still-VOID bots at most hourly


def mode_kinds(projects=None):
    return sorted(set(SPAWN_MARKERS) | {P.mode_kind for P in (projects or PROJECTS) if P.mode_kind})


def mode_on_for(kind, detail, projects=None):
    if kind == CONTROL_KIND:
        return kv(detail).get('index') == 'on'
    for P in (projects or PROJECTS):
        if P.mode_kind == kind:
            return P.mode_on(detail)
    return True                       # a spawn marker: only its presence and version matter


def mode_index(modes):
    """[(t, bot, kind, version, on)] -> {bot: [(t, kind, version, on)] sorted by t}. Pure."""
    out = defaultdict(list)
    for t, b, k, v, on in modes:
        out[b].append((t, k, v, on))
    for b in out:
        out[b].sort()
    return out


def bot_capability(idx, ver, bot, kind, t):
    """'capable' | 'not_capable' | 'void' for one bot at time t. Pure.
    void: the bot's current version is unknown, or no spawn row of its current build is in view (unknown, never 'no').
    capable: the bot's newest row of `kind` at or before t says on AND carries the bot's current version."""
    if not ver:
        return 'void'
    spawn = newest = None
    for tr, k, v, on in idx.get(bot) or ():
        if tr > t:
            break
        if k in SPAWN_MARKERS:
            spawn = (tr, v)
        if k == kind:
            newest = (tr, v, on)
    if spawn is None or spawn[1] != ver:
        return 'void'
    return 'capable' if newest and newest[1] == ver and newest[2] else 'not_capable'


def town_capability(statuses):
    """Any capable bot -> capable; every bot void (or none) -> void; else not_capable. Pure."""
    st = list(statuses)
    if 'capable' in st:
        return 'capable'
    return 'void' if all(x == 'void' for x in st) else 'not_capable'


def capability_control(idx, vers, t, changed_at=None):
    """The positive control (Claude r1 P1-2: it must fail on what it exists to catch). EVERY present bot with a known
    current version is eligible, except one whose version changed (in the track) under CAP_GRACE_MS ago; a VOID bot
    (no spawn row of its build in view: a blind or short reader) counts as NOT capable. Every fleet build since townindex-01
    carries `_townindex_mode`, so a healthy reader reads ~100%. Alarm when the share is < CAP_ALARM_SHARE, or when bots are
    present and none is eligible (the control could not be evaluated). -> {present, eligible, capable, void, share, alarm}."""
    changed_at = changed_at or {}
    present = sum(1 for v in vers.values() if v)
    elig = cap = void = 0
    for b, v in vers.items():
        if not v or t - changed_at.get(b, -10**15) < CAP_GRACE_MS:
            continue
        elig += 1
        st = bot_capability(idx, v, b, CONTROL_KIND, t)
        cap += st == 'capable'
        void += st == 'void'
    share = round(cap / elig, 3) if elig else None
    return {'present': present, 'eligible': elig, 'capable': cap, 'void': void, 'share': share,
            'alarm': (present > 0 and elig == 0) or (elig > 0 and share < CAP_ALARM_SHARE)}


def mode_floor(until):
    """The earliest instant any mode query may read: 7 days back, never before 2026-10-08 (estelemetry refuses 10-07)."""
    return max(until - SEED_MAX_MS, SEED_FLOOR_MS)


def missing_spawn(idx, vers, t):
    """Bots whose CURRENT build has no spawn row in view at t -> sorted [bot]. Pure."""
    out = []
    for b, v in vers.items():
        if v and not any(k in SPAWN_MARKERS and vv == v and tr <= t for tr, k, vv, on in idx.get(b) or ()):
            out.append(b)
    return sorted(out)


def seed_walk(fetch, until, vers, have=(), start=None):
    """The PER-BOT seed: walk back from `start` (default `until`) in SEED_STEPS_MS steps (bounded by mode_floor(until))
    until every present bot's current build has a spawn row at or before `until`, counting the rows already in `have`.
    fetch(since, until) -> rows. -> (new rows, info). Pure apart from fetch."""
    have = list(have)
    start = until if start is None else start
    rows, since = [], start
    missing = missing_spawn(mode_index(have), vers, until)
    for step in SEED_STEPS_MS:
        if not missing:
            break
        lo = max(until - step, mode_floor(until))
        if lo < since:
            rows += fetch(lo, since)
            since = lo
        missing = missing_spawn(mode_index(have + rows), vers, until)
        if lo <= mode_floor(until):
            break
    return rows, {'since': iso(since), 'rows': len(rows), 'missing': missing}


def mode_rows(EsEvents, since, until):
    """Mode rows in [since, until) -> [(t, bot, kind, version, on)]."""
    ev = EsEvents.load('skill', since=iso(since), until=iso(until))
    out = []
    for r in ev.rows(fields=['@timestamp', 'bot.name', 'skill.name', 'skill.detail', 'code.version'],
                     match={'skill.name': mode_kinds()}, allow_zero=True, max_rows=400_000):
        k = (r.get('skill') or {}).get('name')
        v = ((r.get('code') or {}).get('version') or '').split('+')[0] or None
        out.append((ms_of(r['@timestamp']), (r.get('bot') or {}).get('name'), k, v,
                    mode_on_for(k, (r.get('skill') or {}).get('detail'))))
    return out


def newest_per_kind(modes):
    """Keep only each bot's newest row per kind (the persistent state). Pure."""
    best = {}
    for m in modes:
        key = (m[1], m[2])
        if key not in best or m[0] > best[key][0]:
            best[key] = m
    return sorted(best.values())


def load_cap_state(out_dir):
    try:
        with open(os.path.join(out_dir, 'capability-state.json')) as f:
            d = json.load(f)
        return [tuple(x) for x in d['modes']], d.get('seeded')
    except (OSError, ValueError, KeyError):
        return None, None


def save_cap_state(out_dir, modes, seeded):
    tmp = os.path.join(out_dir, '.capability-state.json.tmp')
    with open(tmp, 'w') as f:
        json.dump({'modes': newest_per_kind(modes), 'seeded': seeded}, f)
    os.replace(tmp, os.path.join(out_dir, 'capability-state.json'))


# ---------------------------------------------------------------------------------------------- the stock journal
def fold_stock(records, checkpoints, stale_ms=STOCK_STALE_MS):
    """Town journal records (file order) -> {checkpoint_ms: stock}. Pure. A CENSUS LABEL, not cobblecap's admission fold:
    the latest capture per container wins; a claim's void (or a cnt's `dirty`) makes its container UNKNOWN until a count
    captured at or after it; a reset drops every earlier capture. Containers = the latest scan's keys + every counted one.
    stock = {containers, known, stale, unknown, complete, lb: {group: n}} -- lb is a LOWER BOUND whenever unknown > 0."""
    if records:
        world = records[-1].get('w')
        records = [r for r in records if r.get('w') == world]
    obs, claim_k, unknown, scan = {}, {}, {}, set()
    out, i = {}, 0
    for cp in sorted(checkpoints):
        while i < len(records) and (num(records[i].get('at')) or 0) <= cp:
            r = records[i]
            i += 1
            t, at = r.get('t'), num(r.get('at'))
            if t in ('cnt', 'obs') and r.get('k') is not None and r.get('cap') is not None:
                k, cap = r['k'], num(r['cap'])
                if k not in obs or cap >= obs[k]['cap']:
                    m = {g: num(v) for g, v in (r.get('m') or {}).items()} if num(r.get('v')) >= 2 else {}
                    m.setdefault('cobble', max(0, num(r.get('n'))))
                    obs[k] = {'cap': cap, 'm': m}
                if k in unknown and cap >= unknown[k]:
                    del unknown[k]
            if t == 'claim' and r.get('id') and r.get('k') is not None:
                claim_k[r['id']] = r['k']
            if t == 'void':
                for cid in r.get('ids') or []:
                    if cid in claim_k:
                        unknown[claim_k[cid]] = max(unknown.get(claim_k[cid], 0), at)
            if t == 'cnt' and r.get('dirty') is not None:
                unknown[r['dirty']] = max(unknown.get(r['dirty'], 0), at)
            if t == 'reset':
                for k in [k for k, o in obs.items() if o['cap'] <= at]:
                    del obs[k]
            sc = r if t == 'scan' else (r.get('scan') if t == 'cnt' else None)
            if isinstance(sc, dict) and isinstance(sc.get('keys'), list):
                scan = set(sc['keys'])
        keys = scan | set(obs)
        known = stale = unk = 0
        lb = Counter()
        for k in keys:
            o = obs.get(k)
            if o is None or k in unknown:
                unk += 1
                continue
            if cp - o['cap'] > stale_ms:
                stale += 1
            else:
                known += 1
            lb.update(o['m'])
        out[cp] = {'containers': len(keys), 'known': known, 'stale': stale, 'unknown': unk,
                   'complete': unk == 0 and len(keys) > 0, 'lb': dict(lb)}
    return out


# ---------------------------------------------------------------------------------------------- the census (pure)
def build_flags(flags):
    """[(t, bot, kind)] -> {bot: sorted [(t, class)]}"""
    by = defaultdict(list)
    for t, b, k in flags:
        by[b].append((t, FLAG_CLASS.get(k, 'trap')))
    for b in by:
        by[b].sort()
    return by


def flag_at(flags_by_bot, bot, t, health=None):
    """-> the class of the newest flag in (t - FLAG_MS, t], 'low_health', or None."""
    if health is not None and health <= LOW_HEALTH:
        return 'low_health'
    lst = flags_by_bot.get(bot) or []
    i = bisect.bisect_right(lst, (t, '~'))
    if i and t - lst[i - 1][0] < FLAG_MS:
        return lst[i - 1][1]
    return None


def covering(intervals, t):
    """intervals: sorted [(start, end, bot, ...)] -> bots inside one at t."""
    return [x[2] for x in intervals if x[0] <= t < x[1]]


def bot_block(P, runs, issues, tm):
    """THE JOB'S OWN ADMISSION for one bot at tm -> (reason | None, ready_from). Pure.
    runs: the bot's builder runs, sorted [(start, end, status, fail_class)]; issues: sorted order-issue times (its
    `_work_order` rows and run starts). Cooldown from the newest issue; backoff from the newest run that changed the order
    state (P.backoff_ms; a success clears it); budget over P.budget's window."""
    ready = 0
    i = bisect.bisect_right(issues, tm)
    if i:
        until = issues[i - 1] + P.cooldown_ms
        if tm < until:
            return 'cooldown', until
        ready = max(ready, until)
    for st, en, status, fc in reversed([r for r in runs if r[1] <= tm]):
        ms = P.backoff_ms(status, fc)
        if ms is None:
            continue
        if ms and tm < en + ms:
            return 'backoff', en + ms
        if ms:
            ready = max(ready, en + ms)
        break
    if P.budget:
        w, cap = P.budget
        spent = sum(max(0, min(en, tm) - max(st, tm - w)) for st, en, _, _ in runs)
        if spent >= cap:
            return 'budget', tm
    return None, ready


def health_before(track, bot, t):
    """The bot's health on its newest instant row in a whole minute before t (within CARRY_MS), or None."""
    m0 = t - t % MIN_MS
    for k in range(1, CARRY_MS // MIN_MS + 1):
        x = (track.get(m0 - k * MIN_MS) or {}).get(bot)
        if x is not None:
            return x.get('health')
    return None


def census(ds, projects=PROJECTS, emit_from=None):
    """The census over a dataset -> [slot row] for slots >= emit_from (default: all). Pure.
    ds = {since, until, towns: {pool: home | None},
          track: {minute_ms: {bot: {pool, pos, health, inv}}}   each bot's newest instant row with a position, per minute
          void: {slot_ms: why}, flags: [(t, bot, kind)], jobs: [{bot, pool, name, start, end, status, fail_class, ...}],
          home_rows: [the `home` rows, as jobs], prows: [project rows], records: {project: {pool: created_ms}},
          journal: {pool: [records] | None}}
    Every minute is judged at its END (t_m + 59.999 s) on observations at or before it. A tick passes since = start -
    CARRY_MS so the carry is warm, and emit_from = start."""
    flags = build_flags(ds['flags'])
    # B0a: capability gating is on whenever the dataset carries mode rows (every live mode does; legacy fixtures do not)
    cap_idx = mode_index(ds['modes']) if 'modes' in ds else None
    slots = list(range(floor_slot(ds['since']), ds['until'] - SLOT_MS + 1, SLOT_MS))
    emit_from = slots[0] if emit_from is None or not slots else emit_from
    jobs_by_pool = defaultdict(list)
    for j in ds['jobs']:
        jobs_by_pool[j['pool']].append((j['start'], j['end'], j['bot'], j['name']))
    for p in jobs_by_pool:
        jobs_by_pool[p].sort()
    proj_skills = {P.builder_skill for P in projects}
    prj = []
    for P in projects:
        tl, site = P.timeline(ds['prows'])
        placed = P.placed(ds['prows'])
        builds = defaultdict(list)
        runs, issues = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
        for j in ds['jobs']:
            if j['name'] == P.builder_skill:
                builds[j['pool']].append((j['start'], j['end'], j['bot']))
                runs[j['pool']][j['bot']].append((j['start'], j['end'], j.get('status'), j.get('fail_class')))
                issues[j['pool']][j['bot']].append(j['start'])
        for r in ds['prows']:
            if r['kind'] == '_work_order' and (r.get('detail') or '').startswith(P.order_prefix):
                issues[r['pool']][r['bot']].append(r['t'])
        for d in (builds,):
            for p in d:
                d[p].sort()
        for d in (runs, issues):
            for p in d:
                for b in d[p]:
                    d[p][b].sort()
        opened = dict(site)
        for p, at in (ds.get('records', {}).get(P.name) or {}).items():
            opened[p] = min(opened.get(p, at), at)
        prj.append((P, {p: (v, [e[0] for e in v]) for p, v in tl.items()}, opened, placed, builds, runs, issues))
    journal = ds.get('journal') or {}
    stock_cp = {p: fold_stock(journal[p], [s + SLOT_MS for s in slots]) for p in ds['towns']
                if isinstance(journal.get(p), list)}
    lid = defaultdict(list)
    for j in ds['jobs']:
        if j['name'] == 'count_town' and 'lid_blocked' in (j.get('detail') or ''):
            lid[j['pool']].append(j['end'])
    track = ds.get('track') or {}
    homes_by = defaultdict(list)
    for h in ds.get('home_rows') or []:
        homes_by[(floor_slot(h['start']), h['pool'])].append(dict(h, health=health_before(track, h['bot'], h['start'])))
    last_pos = {}
    rows = []
    for s in slots:
        end = s + SLOT_MS
        minutes = []
        for m in range(5):
            t_m = s + m * MIN_MS
            for b, v in (track.get(t_m) or {}).items():
                last_pos[b] = (t_m, v.get('pool'), v.get('pos'), v.get('health'), v.get('inv') or {}, v.get('ver'))
            minutes.append((t_m + MIN_MS - 1, {b: x for b, x in last_pos.items() if t_m - x[0] < CARRY_MS}))
        if s < emit_from:
            continue
        for pool, home in sorted(ds['towns'].items()):
            row = {'slot': iso(s), 'town': pool}
            # the projects open here, recorded on VOID rows too: a project town that is blind stays in the gate's denominator
            row['projects_open'] = sorted(P.name for P, _, opened, *_ in prj if opened.get(pool) is not None
                                          and opened[pool] < end)
            seen = {b for _, cur in minutes for b, x in cur.items() if x[1] == pool}
            if s in ds['void']:
                row.update(void=True, void_why=ds['void'][s])
                rows.append(row)
                continue
            if not seen:
                row.update(void=True, void_why='town_silent: no position from any of its bots in the slot')
                rows.append(row)
                continue
            if home is None:
                row.update(void=True, void_why='home_unknown: no town-chest-<home> file in the pool state dir')
                rows.append(row)
                continue
            jl = jobs_by_pool.get(pool, [])
            per_min = []                      # [(tm, here, flagged, cur)]
            labour, union, flagged_all = Counter(), set(), {}
            for tm, cur in minutes:
                here = sorted(b for b, x in cur.items() if x[1] == pool and at_town(x[2], home))
                flagged = {}
                for b in here:
                    fl = flag_at(flags, b, tm, cur[b][3])
                    if fl:
                        flagged[b] = fl
                inside = {x[2]: x[3] for x in jl if x[0] <= tm < x[1]}
                for b in here:
                    if b in flagged:
                        labour['flagged'] += 1
                        labour[f'flagged:{flagged[b]}'] += 1
                    elif inside.get(b) in proj_skills:
                        labour['project'] += 1
                    elif inside.get(b) in TOWN_JOBS:
                        labour['town_job'] += 1
                    else:
                        labour['free'] += 1
                union.update(here)
                flagged_all.update(flagged)
                per_min.append((tm, here, flagged, cur))
            row.update(void=False, bots_seen=len(seen), at_town_bots=sorted(union),
                       at_town_max=max(len(h) for _, h, _, _ in per_min), flagged=flagged_all, labour_min=dict(labour))
            pj = {}
            vers = {}
            for _, cur in minutes:
                for b, x in cur.items():
                    if x[1] == pool:
                        vers[b] = x[5]
            for P, tl, opened, placed, builds, runs, issues in prj:
                op = opened.get(pool)
                if op is None or op >= end:
                    continue
                # B0a: CAPABILITY PER MINUTE, from each of the town's bots' version AT THAT MINUTE (a restart mid-slot
                # changes only the minutes after it). not_capable minutes are not open (the record's code is not
                # running); void minutes leave the denominator (unknown is never zero)
                cap_min = None
                if cap_idx is not None:
                    cap_min = {}
                    for tm, here, flagged, cur in per_min:
                        bs = {b: bot_capability(cap_idx, x[5], b, P.mode_kind, tm) for b, x in cur.items() if x[1] == pool}
                        # the TOWN's capability is judged over the unflagged bots INSIDE 16/12 (design 6.4: a town with
                        # only VOID bots there voids the minute; Codex r2 P2-1: a far incapable bot must not turn it into
                        # record_without_code); with nobody there, over the pool's bots (is the code running at all)
                        near = [bs[b] for b in here if b not in flagged and b in bs]
                        cap_min[tm] = (town_capability(near if near else bs.values()), bs)
                    sts = [cap_min[tm][0] for tm, *_ in per_min if tm >= op]
                    if sts and all(x == 'not_capable' for x in sts):
                        row.setdefault('capability', {})[P.name] = 'not_capable'
                        row['projects_open'] = [n for n in row['projects_open'] if n != P.name]
                        row.setdefault('record_without_code', []).append(P.name)
                        continue
                    if sts and all(x == 'void' for x in sts):
                        row.setdefault('capability', {})[P.name] = 'void'
                ev, evt = tl.get(pool, ([], []))
                bl = builds.get(pool, [])
                rec = {'open_min': 0, 'pending_min': 0, 'none_min': 0, 'unknown_min': 0, 'builder_min': 0,
                       'assignable_min': 0, 'blocked': Counter(), 'cap': P.cap,
                       'placed': sum(1 for t in placed.get(pool, []) if s <= t < end),
                       # exact body seconds in the project's skill (a visit is often shorter than the sampled minute)
                       'builder_s': round(sum(max(0, min(e, end) - max(st, s)) for st, e, b in bl) / 1000, 1),
                       'visits': sum(1 for st, e, b in bl if s <= st < end), 'cap_void_min': 0, 'rwc_min': 0}
                for tm, here, flagged, cur in per_min:
                    if tm < op:
                        continue
                    bs = None
                    if cap_min is not None:
                        st_tm, bs = cap_min[tm]
                        if st_tm == 'not_capable':
                            rec['rwc_min'] += 1
                            continue
                        if st_tm == 'void':
                            rec['cap_void_min'] += 1
                            continue
                    rec['open_min'] += 1
                    i = bisect.bisect_right(evt, tm)
                    state, why, need, since = ('unknown', 'no evidence yet', None, None) if not i else \
                        (ev[i - 1][1], ev[i - 1][2], ev[i - 1][3], ev[i - 1][0])
                    if state == 'pending':      # the pending run started at the first pending of the run
                        j = i - 1
                        while j > 0 and ev[j - 1][1] == 'pending':
                            j -= 1
                        since = ev[j][0]
                    active = covering(bl, tm)
                    if active:
                        rec['builder_min'] += 1
                    rec[f'{state}_min'] += 1
                    if state != 'pending':
                        continue
                    free = [b for b in here if b not in flagged and b not in active]
                    void_free = []
                    if bs is not None:
                        void_free = [b for b in free if bs.get(b) == 'void']
                        free = [b for b in free if bs.get(b) == 'capable']
                    def reason_for(free):
                        holders = [b for b in free if P.has_material(cur[b][4], need)]
                        ready = []
                        for b in holders:
                            why_b, ready_from = bot_block(P, runs[pool].get(b, []), issues[pool].get(b, []), tm)
                            if why_b is None:
                                ready.append(max(since, ready_from))
                        if len(active) >= P.cap:
                            return 'cap_full'
                        if len(here) == 0:
                            return 'nobody_at_town'
                        if len(here) < 2:
                            return 'one_at_town'
                        if not free:
                            return 'all_flagged_or_building'
                        if not holders:
                            return f'no_material:{need}'
                        if not ready:
                            return 'all_in_own_cooldown'
                        if all(tm - r0 < P.scan_ms for r0 in ready):
                            return 'within_rotation_latency'
                        return 'assignable'
                    reason = reason_for(free)
                    if reason == 'assignable':
                        rec['assignable_min'] += 1
                    elif void_free and reason_for(free + void_free) == 'assignable':
                        # a bot whose capability is unknown WOULD have made the minute assignable: not a zero, a void
                        # minute. When the VOID bots change nothing (no material, own cooldown...) the known reason
                        # stands (Claude r2 P3-1: dropping known-zero minutes would inflate the assignable rate)
                        reason = 'capability_void'
                        rec['cap_void_min'] += 1
                    rec['blocked'][reason] += 1
                    rec['demand_why'] = why
                rec['blocked'] = dict(rec['blocked'])
                pj[P.name] = rec
            if pj:
                row['projects'] = pj
            if pool in stock_cp:
                st = dict(stock_cp[pool][end], lid_blocked_2h=sum(1 for t in lid.get(pool, []) if end - LID_MS < t <= end))
                st['untracked'] = list(SAPLINGS)
                row['stock'] = st
            else:
                row['stock'] = {'void': 'journal_missing: the town journal could not be read'}
            hr = homes_by.get((s, pool))
            if hr:
                row['home'] = home_success(hr, ds['flags'])
            rows.append(row)
    return rows


def home_success(home_rows, flags_list):
    """`home` under the validator's filter -> {all: [ok, n], filtered: [ok, n], excluded: {why: n}}. Pure. `health` on
    each row must be the health at its START (census() supplies it from the instant rows)."""
    flags = build_flags(flags_list)
    allc, filt, excl = [0, 0], [0, 0], Counter()
    for r in home_rows:
        ok = r.get('status') == 'success'
        allc[1] += 1
        allc[0] += ok
        trig = r.get('trigger') or ''
        if trig.startswith('interrupt'):
            excl['interrupt_trigger'] += 1
            continue
        if r.get('health') is None:                 # the filter needs health > 10 AT THE START: unknown is not > 10
            excl['health_unknown'] += 1
            continue
        fl = flag_at(flags, r['bot'], r['start'], r.get('health'))
        if fl:
            excl[f'flagged:{fl}'] += 1
            continue
        filt[1] += 1
        filt[0] += ok
    return {'all': allc, 'filtered': filt, 'excluded': dict(excl)}


def summarize(rows, projects=PROJECTS):
    """[slot row] -> per-town and fleet summary, the gate, and home. Pure."""
    towns = defaultdict(lambda: {'slots': 0, 'void_slots': 0, 'void_why': Counter(), 'at_town_bot_min': 0,
                                 'labour_min': Counter(), 'projects': {}})
    first = min((ms_of(r['slot']) for r in rows), default=0)
    blocks = defaultdict(lambda: defaultdict(lambda: [0, 0]))     # project -> (town, block) -> [assignable min, valid slots]
    valid_slots = Counter()                                       # (town, block) -> valid slots
    home = {'all': [0, 0], 'filtered': [0, 0], 'excluded': Counter()}
    members = defaultdict(set)                                    # project -> towns where it was open (void rows too)
    caps = {P.name: P.cap for P in projects}
    for r in rows:
        for name in list(r.get('projects_open') or []) + list((r.get('projects') or {}).keys()):
            members[name].add(r['town'])
    rwc = defaultdict(Counter)                                    # town -> {project: slots with a record and no code}
    capvoid = defaultdict(Counter)
    for r in rows:
        for name in r.get('record_without_code') or []:
            rwc[r['town']][name] += 1
        for name, st in (r.get('capability') or {}).items():
            if st == 'void':
                capvoid[r['town']][name] += 1
    for r in rows:
        T = towns[r['town']]
        T['slots'] += 1
        blk = (ms_of(r['slot']) - first) // DAY_MS
        if r.get('void'):
            T['void_slots'] += 1
            T['void_why'][r.get('void_why', '?').split(':')[0]] += 1
            continue
        valid_slots[(r['town'], blk)] += 1
        T['labour_min'].update(r.get('labour_min') or {})
        # the four classes partition at-town time; 'flagged:<class>' keys split 'flagged' and are not added again
        T['at_town_bot_min'] += sum(v for k, v in (r.get('labour_min') or {}).items() if ':' not in k)
        h = r.get('home')
        if h:
            for k in ('all', 'filtered'):
                home[k][0] += h[k][0]
                home[k][1] += h[k][1]
            home['excluded'].update(h.get('excluded') or {})
        for name, p in (r.get('projects') or {}).items():
            Q = T['projects'].setdefault(name, {'open_min': 0, 'pending_min': 0, 'none_min': 0, 'unknown_min': 0,
                                                'builder_min': 0, 'assignable_min': 0, 'placed': 0, 'blocked': Counter(),
                                                'cap': p.get('cap'), 'builder_s': 0.0, 'visits': 0, 'cap_void_min': 0,
                                                'rwc_min': 0})
            for k in ('open_min', 'pending_min', 'none_min', 'unknown_min', 'builder_min', 'assignable_min', 'placed',
                      'builder_s', 'visits', 'cap_void_min', 'rwc_min'):
                Q[k] += p.get(k, 0)
            Q['blocked'].update(p.get('blocked') or {})
            blocks[name][(r['town'], blk)][0] += p.get('assignable_min', 0)
            blocks[name][(r['town'], blk)][1] += p.get('cap_void_min', 0)
    win_h = max([T['slots'] * 5 / 60 for T in towns.values()] or [0])
    out = {'towns': {}, 'projects': {}, 'window_h': round(win_h, 2),
           'record_without_code_slots': {t: dict(c) for t, c in sorted(rwc.items())},
           'capability_void_slots': {t: dict(c) for t, c in sorted(capvoid.items())}}
    for name, ts in members.items():                              # a project town with no valid row still counts
        for t in ts:
            towns[t]['projects'].setdefault(name, {'open_min': 0, 'pending_min': 0, 'none_min': 0, 'unknown_min': 0,
                                                   'builder_min': 0, 'assignable_min': 0, 'placed': 0,
                                                   'blocked': Counter(), 'cap': caps.get(name), 'builder_s': 0.0,
                                                   'visits': 0, 'cap_void_min': 0, 'rwc_min': 0})
    # EVERY town must be valid, not the fleet on average: one never-written town among eleven good ones is 92% of the
    # fleet and 0% of itself (Codex r3)
    out['min_town_valid_share'] = round(min((T['slots'] - T['void_slots']) / T['slots'] for T in towns.values()
                                            if T['slots']), 3) if towns else 0.0
    for t, T in sorted(towns.items()):
        valid_h = (T['slots'] - T['void_slots']) * 5 / 60
        T['valid_h'] = round(valid_h, 2)
        T['void_why'] = dict(T['void_why'])
        T['labour_min'] = dict(T['labour_min'])
        for name, Q in T['projects'].items():
            Q['blocked'] = dict(Q['blocked'])
            Q['builder_s'] = round(Q['builder_s'], 1)
            Q['cells_per_open_town_h'] = round(Q['placed'] / (Q['open_min'] / 60), 3) if Q['open_min'] else None
            A = out['projects'].setdefault(name, {'towns': 0, 'open_min': 0, 'pending_min': 0, 'builder_min': 0,
                                                  'assignable_min': 0, 'placed': 0, 'blocked': Counter(),
                                                  'valid_h': 0.0, 'cap': Q['cap'], 'per_day': 0.0, 'builder_s': 0.0,
                                                  'visits': 0, 'town_names': []})
            A['towns'] += 1
            A['town_names'].append(t)
            # B0a: minutes whose capability is VOID leave THIS project's denominator (unknown is never zero)
            pvh = max(0.0, valid_h - Q.get('cap_void_min', 0) / 60)
            A['valid_h'] += pvh
            A['cap_void_h'] = round(A.get('cap_void_h', 0.0) + Q.get('cap_void_min', 0) / 60, 2)
            # the daily rate is per town over the hours the census could SEE (void hours leave the denominator)
            A['per_day'] += (Q['assignable_min'] / 60) * 24 / pvh if pvh else 0.0
            A['builder_s'] = round(A['builder_s'] + Q['builder_s'], 1)
            A['visits'] += Q['visits']
            for k in ('open_min', 'pending_min', 'builder_min', 'assignable_min', 'placed'):
                A[k] += Q[k]
            A['blocked'].update(Q['blocked'])
        out['towns'][t] = T
    nblocks = int(win_h // 24)
    for name, A in out['projects'].items():
        A['blocked'] = dict(A['blocked'])
        A['assignable_town_h'] = round(A['assignable_min'] / 60, 3)
        A['open_town_h'] = round(A['open_min'] / 60, 3)
        A['assignable_town_h_per_day'] = round(A.pop('per_day'), 3)
        A['valid_share'] = round(A['valid_h'] / (A['towns'] * win_h), 3) if win_h and A['towns'] else 0.0
        A['valid_h'] = round(A['valid_h'], 2)
        A['per_day_by_24h_block'] = []
        tb = [max(0.0, valid_slots[(t, blk)] * 5 - blocks[name][(t, blk)][1]) / 1440 for t in A['town_names']
              for blk in range(nblocks)]
        A['min_town_block_valid_share'] = round(min(tb), 3) if tb else 0.0
        for blk in range(nblocks):
            rate = 0.0
            for t in A['town_names']:
                vh = max(0.0, valid_slots[(t, blk)] * 5 - blocks[name][(t, blk)][1]) / 60
                rate += (blocks[name][(t, blk)][0] / 60) * 24 / vh if vh else 0.0
            A['per_day_by_24h_block'].append(round(rate, 3))
        multi = (A['cap'] or 1) >= 2
        rate = (f'{A["assignable_town_h_per_day"]} town-h/day (24-h blocks {A["per_day_by_24h_block"]}) against '
                f'>= {GATE_TOWN_H_PER_DAY:g}; {100 * A["valid_share"]:.0f}% of town-hours valid')
        if not multi:
            A['gate'] = 'not applicable: single-builder project (cap 1) -- the gate is judged on a multi-bot project'
        elif win_h < GATE_HOURS:
            A['gate'] = f'NOT DECIDABLE YET: {win_h:g} h < the {GATE_HOURS} h the gate needs ({rate})'
        elif min(A['valid_share'], out['min_town_valid_share'], A['min_town_block_valid_share']) < GATE_VALID_SHARE:
            A['gate'] = (f'NOT DECIDABLE: under {100 * GATE_VALID_SHARE:.0f}% of town-hours valid (project towns '
                         f'{100 * A["valid_share"]:.0f}%, worst town {100 * out["min_town_valid_share"]:.0f}%, worst '
                         f'town-day {100 * A["min_town_block_valid_share"]:.0f}%; {rate})')
        else:
            ok = all(b >= GATE_TOWN_H_PER_DAY for b in A['per_day_by_24h_block'])
            A['gate'] = ('PASS' if ok else 'NOT MET') + f' ({rate})'
    tot = Counter()
    for T in out['towns'].values():
        tot.update(T['labour_min'])
        tot['at_town'] += T['at_town_bot_min']
        tot['valid_h'] += T['valid_h']
    out['fleet_labour_h'] = {k: round(v / 60, 2) for k, v in tot.items() if k != 'valid_h'}
    out['fleet_valid_town_h'] = round(tot['valid_h'], 2)
    home['excluded'] = dict(home['excluded'])
    out['home'] = home
    return out


# ---------------------------------------------------------------------------------------------- data from the host
def pool_roster(state_dir):
    """The SHARED towns from the pool state dir (never from telemetry presence, so a silent town still gets VOID rows)."""
    out = []
    for d in glob.glob(os.path.join(state_dir, '_pool-*')):
        p = os.path.basename(d)[len('_pool-'):]
        if os.path.isdir(d) and '.' not in p and not p.startswith('self-'):
            out.append(p)
    return sorted(out)


def pool_homes(state_dir, pools):
    """{pool: (x, y, z) | None} from the pool state dir's town-chest-<home>.cobble.jsonl (the town's own key)."""
    out = {}
    for p in pools:
        fs = sorted(glob.glob(os.path.join(state_dir, f'_pool-{p}', 'town-chest-*.cobble.jsonl')), key=os.path.getmtime)
        m = re.match(r'town-chest-(-?\d+)_(-?\d+)_(-?\d+)\.cobble\.jsonl$', os.path.basename(fs[-1])) if fs else None
        out[p] = tuple(int(v) for v in m.groups()) if m else None
    return out


def read_journal(state_dir, pool, home):
    """The town journal's records, or None when it cannot be read (stock VOID, never an empty town)."""
    if home is None:
        return None
    f = os.path.join(state_dir, f'_pool-{pool}', f'town-chest-{home[0]}_{home[1]}_{home[2]}.cobble.jsonl')
    out = []
    try:
        with open(f, 'rb') as fh:
            for line in fh:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        return None
    return out


def read_records(state_dir, pools, homes):
    """({project: {pool: created_ms}} from <name>-<home>.g<N>.json, {pool: [treefarm lease files]}, [errors])."""
    recs, leases, errors = defaultdict(dict), defaultdict(list), []
    for p in pools:
        h = homes.get(p)
        if h is None:
            continue
        key = f'{h[0]}_{h[1]}_{h[2]}'
        d = os.path.join(state_dir, f'_pool-{p}')
        for name in ('treefarm', 'monument'):
            for f in glob.glob(os.path.join(d, f'{name}-{key}.g*.json')):
                if not re.search(r'\.g\d+\.json$', f):
                    continue
                try:
                    r = json.load(open(f))
                    at = ms_of(r['at']) if r.get('at') else int(r.get('created_at') or os.path.getmtime(f) * 1000)
                    recs[name][p] = min(recs[name].get(p, at), at)
                except (OSError, ValueError, KeyError) as e:
                    errors.append(f'{f}: {type(e).__name__}')
        for f in glob.glob(os.path.join(d, f'treefarm-{key}.lease*.json')):
            try:
                r = json.load(open(f))
                leases[p].append({'holder': r.get('holder'), 'at': ms_of(r['at']), 'released': bool(r.get('released')),
                                  'file': os.path.basename(f)})
            except (OSError, ValueError, KeyError) as e:
                errors.append(f'{f}: {type(e).__name__}')
    return dict(recs), dict(leases), errors


def job_from_row(r):
    """An ES skill row -> {bot, pool, name, start, end, ...}. Pure. A SKILL ROW IS STAMPED AT ITS START: measured 10-19,
    town_deposit's own `_town_deposit` event lands 26-318 ms after the skill row's @timestamp and ~200 ms before
    @timestamp + duration_ms; tend_farm's `_farm_tend` (whose t0= is the visit's start) lands at @timestamp + duration_ms.
    So the body interval is [@timestamp, @timestamp + duration_ms). (The first live run read it backwards and its own
    instrument check found 0 of 21 placements inside a visit.)"""
    sk = r.get('skill') or {}
    start = ms_of(r['@timestamp'])
    return {'bot': (r.get('bot') or {}).get('name'), 'pool': (r.get('exp') or {}).get('pool'), 'name': sk.get('name'),
            'start': start, 'end': start + num(sk.get('duration_ms')), 'status': sk.get('status'),
            'detail': sk.get('detail'), 'fail_class': sk.get('fail_class'), 'trigger': r.get('trigger')}


def minute_track(ev):
    """{minute_ms: {bot: {pool, pos, health, inv}}} -- each bot's newest INSTANT row (an event row: a `_kind`, stamped when
    it happened) with a position, per minute of ev's window. One server-side aggregation (bots x minutes, top hit each).
    Uses EsEvents' own transport and completeness check (ev._search / ev._complete), so it inherits the window's filters
    and the read-only key handling. Skill rows are left out on purpose: they are stamped at their START but carry the
    END snapshot."""
    q = ev._query()
    q['bool']['filter'] += [{'prefix': {'skill.name': '_'}}, {'exists': {'field': 'bot.pos.x'}}]
    r = ev._search({'size': 0, 'query': q, 'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 1000}, 'aggs': {
        'm': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '1m'},
              'aggs': {'top': {'top_hits': {'size': 1, 'sort': [{'@timestamp': 'desc'}],
                                            '_source': ['bot.pos', 'bot.health', 'bot.inventory', 'exp.pool',
                                                        'code.version', '@timestamp']}}}}}}}})
    return parse_track(ev._complete(r['aggregations']['b'], 'minute_track: terms on bot.name'))


def parse_track(agg):
    """The bots x minutes aggregation -> {minute_ms: {bot: {pool, pos, health, inv}}}. Pure."""
    out = defaultdict(dict)
    for bb in agg['buckets']:
        for mb in bb['m']['buckets']:
            hits = mb['top']['hits']['hits']
            if not hits:
                continue
            src = hits[0]['_source']
            bo = src.get('bot') or {}
            pos = bo.get('pos') or {}
            out[int(mb['key'])][bb['key']] = {'pool': (src.get('exp') or {}).get('pool'),
                                               'pos': (pos.get('x'), pos.get('y'), pos.get('z')), 'health': bo.get('health'),
                                               'inv': bo.get('inventory') or {},
                                               'ver': ((src.get('code') or {}).get('version') or '').split('+')[0] or None}
    return out


def dataset_from_es(since, until, state_dir, log=print, cap_state=None, reseed_due=None):
    """Everything census() needs, read from ES (estelemetry) and the pool state dir. Read only.
    cap_state: the persistent newest-mode-row state (a list), or None to seed it by the bounded walk (B0a)."""
    from lib.estelemetry import EsEvents, ZeroLooksWrong
    t0 = time.time()
    whole = EsEvents.load('skill', since=iso(since), until=iso(until))
    total, bots = whole.total(), whole.bots_present()
    if not total:
        raise ZeroLooksWrong(f'ES holds no skill document in {iso(since)}..{iso(until)}')
    names = whole.names()
    for k in ('_entombed', '_marooned', '_work_order'):          # positive controls for the kind lists
        if not names.get(k) and (until - since) >= 3600_000:
            raise ZeroLooksWrong(f'{k} has 0 docs in an hour or more: the kind list is wrong, not the fleet')
    cov = whole.coverage()
    void = {}
    for b in cov['empty_10min']:
        b0 = ms_of(b + ':00Z')
        for s in (b0, b0 + SLOT_MS):
            void[s] = 'es_empty: no document from any bot in the 10-minute bucket'
    track = {}
    n_pos = 0
    for s in range(floor_slot(since), until - SLOT_MS + 1, SLOT_MS):
        if s in void:
            continue
        ev = EsEvents.load('skill', since=iso(s), until=iso(s + SLOT_MS))
        tr = minute_track(ev)
        if not tr:
            n = ev.total()
            void[s] = ('es_empty: no document in the slot' if not n else
                       f'track_empty: {n} docs but no positioned event row (an instrument fault, not an absence)')
            continue
        for m, sl in tr.items():
            track[m] = sl
            n_pos += len(sl)
    log(f'  positions and bags: {n_pos} bot-minutes ({time.time() - t0:.0f} s)')
    fl_ev = EsEvents.load('skill', since=iso(since - FLAG_MS), until=iso(until))
    flags = [(ms_of(r['@timestamp']), r['bot']['name'], r['skill']['name'])
             for r in fl_ev.rows(fields=['@timestamp', 'bot.name', 'skill.name'], match={'skill.name': list(FLAG_KINDS)},
                                 allow_zero=True, max_rows=400_000)]
    job_ev = EsEvents.load('skill', since=iso(since - JOB_LOOKBACK_MS), until=iso(until))
    jnames = list(TOWN_JOBS) + [P.builder_skill for P in PROJECTS] + ['home']
    jobs, homes_rows = [], []
    for r in job_ev.rows(fields=['@timestamp', 'bot.name', 'exp.pool', 'skill.name', 'skill.status',
                                 'skill.duration_ms', 'skill.detail', 'skill.fail_class', 'trigger'],
                         match={'skill.name': jnames}, allow_zero=True, max_rows=400_000):
        j = job_from_row(r)
        (homes_rows if j['name'] == 'home' else jobs).append(j)
    pr_ev = EsEvents.load('skill', since=iso(since - PROJECT_LOOKBACK_MS), until=iso(until))
    pkinds = sorted({k for P in PROJECTS for k in P.kinds} | {'_work_order'})
    prows = []
    for r in pr_ev.rows(fields=['@timestamp', 'bot.name', 'exp.pool', 'skill.name', 'skill.status', 'skill.detail',
                                'skill.args', 'skill.fail_class'],
                        match={'skill.name': pkinds}, allow_zero=True, max_rows=400_000):
        sk = r.get('skill') or {}
        if sk.get('name') == '_work_order' and not re.match(r'(tend_farm|build_monument)\b', sk.get('detail') or ''):
            continue
        prows.append({'t': ms_of(r['@timestamp']), 'bot': r['bot']['name'], 'pool': (r.get('exp') or {}).get('pool'),
                      'kind': sk.get('name'), 'status': sk.get('status'), 'detail': sk.get('detail'),
                      'args': sk.get('args') if isinstance(sk.get('args'), dict) else {}, 'fail_class': sk.get('fail_class')})
    roster = pool_roster(state_dir)
    seen = {v['pool'] for sl in track.values() for v in sl.values() if v.get('pool') and not v['pool'].startswith('self-')}
    pools = sorted(set(roster) | seen)
    if not pools:
        raise ZeroLooksWrong(f'no shared town: {state_dir} has no _pool-* dir and no positioned row names a pool')
    homes = pool_homes(state_dir, pools)
    recs, leases, rec_errors = read_records(state_dir, pools, homes)
    journal = {p: read_journal(state_dir, p, homes[p]) for p in pools}
    log(f'  rows: flags {len(flags)}, job rows {len(jobs)}, home rows {len(homes_rows)}, project rows {len(prows)} '
        f'({time.time() - t0:.0f} s)')
    # B0a: MODE ROWS, read after the track so the seed knows which bots and builds it must cover
    vers, changed_at = {}, {}
    for m in sorted(track):
        for b, v in track[m].items():
            if v.get('ver'):
                if b in vers and vers[b] != v['ver']:
                    changed_at[b] = m
                vers[b] = v['ver']
    fetch = lambda a, b: mode_rows(EsEvents, max(a, mode_floor(until)), b)   # noqa: E731 -- every query bounded
    fresh = fetch(since - PROJECT_LOOKBACK_MS, until)
    seeded = None
    state = list(cap_state or ())
    need = missing_spawn(mode_index(state + fresh), vers, until)
    if cap_state is None or (need and (reseed_due if reseed_due is not None else True)):
        extra, seeded = seed_walk(fetch, until, vers, have=state + fresh,
                                  start=max(since - PROJECT_LOOKBACK_MS, mode_floor(until)))
        state += extra
        seeded['at'] = iso(until)
        log(f'  capability seed walk back to {seeded["since"]}: {seeded["rows"]} rows; still missing {len(seeded["missing"])}')
    # FULL history for the census (a persisted predecessor must survive a fresh row of the same kind); compacted only
    # when saved
    modes = sorted(set(state) | set(fresh))
    idx = mode_index(modes)
    control = capability_control(idx, vers, until, changed_at)
    return {'since': since, 'until': until, 'towns': homes, 'track': track, 'void': void, 'flags': flags, 'jobs': jobs,
            'prows': prows, 'records': recs, 'leases': leases, 'journal': journal, 'home_rows': homes_rows,
            'modes': modes, 'cap_seeded': seeded, 'capability_control': control,
            'cap_missing': missing_spawn(idx, vers, until),
            'meta': {'docs': total, 'bots': len(bots), 'kinds_present': {k: names.get(k, 0) for k in
                                                                         sorted(set(pkinds) | set(jnames))},
                     'coverage_bot_h': cov['bot_hours'], 'empty_10min': cov['empty_10min'], 'caveats': whole.caveats,
                     'roster': roster, 'not_in_roster': sorted(seen - set(roster)), 'record_errors': rec_errors,
                     'journal_missing': sorted(p for p, j in journal.items() if j is None)}}


# ---------------------------------------------------------------------------------------------- instrument checks
def instrument_checks(ds):
    """Live positive controls (--window): the census must SEE what the project did (design 6: treefarm-02 is the
    instrument check)."""
    out = {}
    builds = defaultdict(list)
    for j in ds['jobs']:
        if j['name'] == 'tend_farm':
            builds[j['bot']].append((j['start'], j['end']))
    # (1) the builder lease: every lease file on disk inside the window matches a tend_farm interval of its holder
    lw = [(p, l) for p, ls in ds.get('leases', {}).items() for l in ls if ds['since'] - 600_000 <= l['at'] < ds['until']]
    hit = [(p, l) for p, l in lw if any(s - 10_000 <= l['at'] <= e + 10_000 for s, e in builds.get(l['holder'], []))]
    out['lease_files_matched'] = f'{len(hit)} of {len(lw)} lease files in the window match a tend_farm interval of their holder'
    # (2) placements: every confirmed _farm_place lies inside a tend_farm interval of the same bot
    fp = [r for r in ds['prows'] if r['kind'] == '_farm_place' and r.get('status') == 'success'
          and ds['since'] <= r['t'] < ds['until']]
    inside = [r for r in fp if any(s - 2000 <= r['t'] <= e + 2000 for s, e in builds.get(r['bot'], []))]
    out['placements_inside_a_visit'] = f'{len(inside)} of {len(fp)} confirmed _farm_place rows'
    # (3) the at-town predicate AND the minute track: a town job that succeeded (deposit / disposal / compost / pick
    # withdraw / farm visit) ended at town, so the track must put its bot at town in the minute it ended
    tj = [j for j in ds['jobs'] if j['name'] in ('town_deposit', 'dispose_well', 'compost', 'withdraw_pick', 'tend_farm')
          and j.get('status') == 'success' and ds['since'] <= j['end'] < ds['until'] and j['pool'] in ds['towns']]
    ok = n = 0
    track = ds.get('track') or {}
    for j in tj:
        m = j['end'] - j['end'] % MIN_MS
        x = next(((track.get(m - k * MIN_MS) or {}).get(j['bot']) for k in range(CARRY_MS // MIN_MS)
                  if (track.get(m - k * MIN_MS) or {}).get(j['bot'])), None)
        if x is None:
            continue
        n += 1
        ok += at_town(x['pos'], ds['towns'].get(j['pool']))
    out['at_town_predicate'] = (f'{ok} of {n} successful town-job rows ({100 * ok / n:.1f}%) had the bot at town in the '
                                f'minute track at the minute the job ended' if n else 'no town-job success in the window')
    out['at_town_predicate_ok'] = (ok / n >= 0.8) if n else None
    # (4) sapling stock: the bags of the bots at town carry it (the journal does not track saplings)
    sap = Counter()
    lastm = max(track) if track else None
    for b, x in (track.get(lastm) or {}).items():
        if x.get('pool') in ds['towns'] and at_town(x['pos'], ds['towns'][x['pool']]):
            sap[x['pool']] += sum((x.get('inv') or {}).get(k, 0) for k in SAPLINGS)
    out['saplings_in_at_town_bags_last_minute'] = dict(sap)
    return out


# ---------------------------------------------------------------------------------------------- the self-test
def fixture():
    """ONE town ('fx', home 0,64,0), three bots, one hour from T0. Every number in SELFTEST_EXPECT is worked by hand below.
      A, B at town all hour; C far away except 50:00-52:00. A holds 4 saplings; B 0 until 20:00, then 5; C 9 (away).
      00:30 _farm_site (pending, needs sapling).    B is flagged by _entombed at 34:00 (flag lasts until 39:00).
      A tends 01:00-03:00: census ready:6, planted 0, failed 6 -> pending stays (left: ready 6); A's run FAILED, so A is
            in its own 20-min backoff until 23:00 (treefarm.mjs farmOrderOutcome).
      20:40 B is ordered to tend and never does (B's own 5-min cooldown runs 20:40-25:40).
      30:45 C (away) is ordered to tend: a new pending row inside a pending run; the work has waited since 00:30, so it
            does not restart the rotation's latency (the RUN's start counts, not its newest row).
      A tends 41:00-43:00: planted 6 -> none from 43:00.
    """
    T0 = ms_of('2026-10-19T00:00:00Z')
    M = 60_000
    track = {}
    for m in range(60):
        t = T0 + m * M
        track[t] = {'fx-A': {'pool': 'fx', 'pos': (3, 64, 3), 'health': 20, 'inv': {'birch_sapling': 4}},
                    'fx-B': {'pool': 'fx', 'pos': (-10, 66, 5), 'health': 20,
                             'inv': {'oak_sapling': 5} if m >= 20 else {}},
                    # C is away, except a two-minute visit to town at 50:00-52:00 (a transient presence a slot-end
                    # snapshot would miss)
                    'fx-C': {'pool': 'fx', 'pos': (2, 64, 2) if m in (50, 51) else (400, 64, 0), 'health': 20,
                             'inv': {'oak_sapling': 9}}}
    prows = [
        {'t': T0 + 30_000, 'bot': 'fx-A', 'pool': 'fx', 'kind': '_farm_site', 'status': 'success', 'detail': 'gen=1 plots=6'},
        {'t': T0 + 3 * M, 'bot': 'fx-A', 'pool': 'fx', 'kind': '_farm_tend', 'status': 'failed',
         'detail': 'gen=1 planted=0 soil=0 cleared=0 torches=0 failed=6 census=ready:6 stop=nothing_confirmed'},
        {'t': T0 + 20 * M + 40_000, 'bot': 'fx-B', 'pool': 'fx', 'kind': '_work_order', 'status': 'success',
         'detail': 'tend_farm {} -- at town; the town tree farm has work: 6 plant'},     # an order that never ran
        {'t': T0 + 30 * M + 45_000, 'bot': 'fx-C', 'pool': 'fx', 'kind': '_work_order', 'status': 'success',
         'detail': 'tend_farm {} -- at town; the town tree farm has work: 6 plant'},
        {'t': T0 + 43 * M, 'bot': 'fx-A', 'pool': 'fx', 'kind': '_farm_tend', 'status': 'success',
         'detail': 'gen=1 planted=6 soil=0 cleared=0 torches=0 failed=0 census=ready:6 stop=done'},
    ] + [{'t': T0 + 41 * M + k * 10_000, 'bot': 'fx-A', 'pool': 'fx', 'kind': '_farm_place', 'status': 'success',
          'detail': f'role=plant item=birch_sapling at={k},64,0 verdict=confirmed'} for k in range(6)] + [
        {'t': T0 + 42 * M, 'bot': 'fx-A', 'pool': 'fx', 'kind': '_farm_place', 'status': 'success',
         'detail': 'role=bonemeal item=bone_meal at=0,64,0 verdict=consumed grew=0'},
        {'t': T0 + 42 * M + 5000, 'bot': 'fx-A', 'pool': 'fx', 'kind': '_farm_place', 'status': 'success',
         'detail': 'role=leftover_log item=oak_log at=0,66,0 verdict=confirmed'}]
    jobs = [{'bot': 'fx-A', 'pool': 'fx', 'name': 'tend_farm', 'start': T0 + 1 * M, 'end': T0 + 3 * M, 'status': 'failed',
             'fail_class': 'farm_unconfirmed'},
            {'bot': 'fx-A', 'pool': 'fx', 'name': 'tend_farm', 'start': T0 + 41 * M, 'end': T0 + 43 * M, 'status': 'success'},
            {'bot': 'fx-B', 'pool': 'fx', 'name': 'town_deposit', 'start': T0 + 50 * M, 'end': T0 + 52 * M,
             'status': 'success'},
            {'bot': 'fx-B', 'pool': 'fx', 'name': 'count_town', 'start': T0 + 52 * M, 'end': T0 + 52 * M + 500,
             'status': 'no_effect', 'detail': 'counted=0 lid_blocked=2'}]
    home_rows = [{'bot': 'fx-A', 'pool': 'fx', 'start': T0 + 10 * M, 'status': 'success', 'trigger': 'watchdog_home'},
                 # the skill row's END snapshot says health 5; at its start (the instant rows) A had 20: not excluded
                 {'bot': 'fx-A', 'pool': 'fx', 'start': T0 + 12 * M + 30_000, 'status': 'failed', 'trigger': 'llm:idle',
                  'health': 5},
                 {'bot': 'fx-B', 'pool': 'fx', 'start': T0 + 35 * M, 'status': 'failed', 'trigger': 'llm:idle'}]  # flagged
    journal = [{'t': 'cnt', 'k': 'c1', 'cap': T0 - 3 * 3600_000, 'at': T0 - 3 * 3600_000, 'n': 100, 'v': 2,
                'm': {'oak_log': 10}, 'w': 'W', 'scan': {'keys': ['c1', 'c2', 'c3'], 'at': T0 - 3 * 3600_000}},
               {'t': 'cnt', 'k': 'c2', 'cap': T0 - 60_000, 'at': T0 - 60_000, 'n': 50, 'v': 2, 'm': {}, 'w': 'W'},
               {'t': 'claim', 'id': 'q1', 'k': 'c2', 'at': T0 + 10 * M, 'n': 5, 'w': 'W'},
               {'t': 'void', 'ids': ['q1'], 'at': T0 + 12 * M, 'w': 'W'},
               {'t': 'cnt', 'k': 'c2', 'cap': T0 + 30 * M, 'at': T0 + 30 * M, 'n': 70, 'v': 2, 'm': {}, 'w': 'W'}]
    flags = [(T0 + 34 * M, 'fx-B', '_entombed')]
    return {'since': T0, 'until': T0 + 3600_000, 'towns': {'fx': (0, 64, 0)}, 'track': track, 'void': {},
            'flags': flags, 'jobs': jobs, 'prows': prows, 'records': {}, 'leases': {}, 'journal': {'fx': journal},
            'home_rows': home_rows}


# Worked by hand from fixture(): every minute is judged at its END (mm:59.999).
#   open from 00:30 -> 60 open minutes. pending 00:30..43:00 -> minutes 0..42 = 43; none from 43:00 -> 43..59 = 17.
#   builder minutes 1, 2, 41, 42 = 4 -> cap_full 4.
#   minute 0: only A holds saplings; A has no issue or run yet, ready from the pending start 00:30; 00:59.999 - 00:30 =
#     29.999 s < the 30-s scan -> within_rotation_latency 1.
#   minutes 3..19 (17): A in its own backoff (failed run ended 03:00, + 20 min = 23:00); B holds nothing -> the only
#     holder is blocked -> all_in_own_cooldown. Minutes 20..22 (3): B holds saplings but is in its cooldown (20:40 +
#     5 min); A still in backoff -> all_in_own_cooldown. Total 20.
#   minutes 23..40 (18): A out of backoff (ready from 23:00; 23:59.999 - 23:00 >= 30 s) -> assignable 18 (B's flag at
#     34:00 does not matter: A is free; C's order at 30:45 does not restart the run).
#   check: 1 + 4 + 20 + 18 = 43. Placed cells: 6 (the bone meal use and the leftover-log dig are not placed cells).
#   labour: A at town 60 min, 4 in the project -> 56 free; B flagged at minutes 34..38 (ends 34:59.999..38:59.999 are
#     < 5 min after 34:00; 39:59.999 is not) -> 5 flagged; B's town_deposit 50:00-52:00 -> 2 town_job; B free 53; C at
#     town minutes 50, 51 -> 2 free. Total free 56 + 53 + 2 = 111; at town 60 + 60 + 2 = 122.
#   home: 3 rows; the interrupt-free, unflagged ones: A 10:00 success, A 12:30 failed (health 20 at its start, not the
#     row's END health 5) -> filtered 1 of 2; B 35:00 flagged (trap) -> excluded.
#   stock at 01:00 (T0+1h): c1 counted 4 h before -> stale; c2 voided at 00:12, recounted at 00:30 -> known (70);
#     c3 in the scan, never counted -> unknown. lb cobble 100 + 70 = 170, oak_log 10; complete False; lid 1 (2 h).
SELFTEST_EXPECT = {'open_min': 60, 'pending_min': 43, 'none_min': 17, 'builder_min': 4, 'assignable_min': 18,
                   'cap_full': 4, 'within_rotation_latency': 1, 'all_in_own_cooldown': 20, 'placed': 6,
                   'free_min': 111, 'flagged_min': 5, 'town_job_min': 2, 'project_min': 4}


def _tf(ds):
    return summarize(census(ds, projects=(TreeFarm(),)), projects=(TreeFarm(),))


def selftest(verbose=True):
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f'{name}: got {got!r}, want {want!r}')
        elif verbose:
            print(f'  ok  {name} = {got!r}')

    ds = fixture()
    rows = census(ds, projects=(TreeFarm(),))
    S = summarize(rows, projects=(TreeFarm(),))
    q = S['towns']['fx']['projects']['treefarm']
    lab = S['towns']['fx']['labour_min']
    for k in ('open_min', 'pending_min', 'none_min', 'builder_min', 'assignable_min', 'placed'):
        check(f'treefarm {k}', q[k], SELFTEST_EXPECT[k])
    for k in ('cap_full', 'within_rotation_latency', 'all_in_own_cooldown'):
        check(f'blocked {k}', q['blocked'].get(k, 0), SELFTEST_EXPECT[k])
    check('blocked sums to pending', sum(q['blocked'].values()), q['pending_min'])
    check('builder body seconds and visits (exact, not sampled)', (q['builder_s'], q['visits']), (240.0, 2))
    for k in ('free', 'flagged', 'town_job', 'project'):
        check(f'labour {k}', lab.get(k, 0), SELFTEST_EXPECT[f'{k}_min'])
    check('flagged minutes by class', lab.get('flagged:trap'), 5)
    check('at-town bot-minutes = A 60 + B 60 + C 2 (the classes partition it)', S['towns']['fx']['at_town_bot_min'], 122)
    check('gate on a cap-1 project', S['projects']['treefarm']['gate'].startswith('not applicable'), True)
    check('home (all, filtered, excluded) from the census rows, health at the START',
          (S['home']['all'], S['home']['filtered'], S['home']['excluded']), ([1, 3], [1, 2], {'flagged:trap': 1}))
    # POSITIVE CONTROL: the instrument must FIND assignable time where the fixture puts it (a census that cannot see
    # staffing would print 0 here and fail)
    check('positive control: assignable > 0', q['assignable_min'] > 0, True)
    # STARVED vs STAFFED (design 5 (a)): A builds 08:00-30:00 (success) -> minutes 8..29 cap_full (22); the success clears
    # A's backoff, its cooldown from 08:00 ended at 13:00 -> minutes 30..40 assignable (11); minutes 3..7 still backoff (5)
    ds2 = fixture()
    ds2['jobs'].append({'bot': 'fx-A', 'pool': 'fx', 'name': 'tend_farm', 'start': ds2['since'] + 8 * 60_000,
                        'end': ds2['since'] + 30 * 60_000, 'status': 'success'})
    q2 = _tf(ds2)['towns']['fx']['projects']['treefarm']
    check('staffed fixture: assignable', q2['assignable_min'], 11)
    check('staffed fixture: cap_full', q2['blocked'].get('cap_full', 0), 4 + 22)
    check('staffed fixture: own cooldown', q2['blocked'].get('all_in_own_cooldown', 0), 5)
    # FUNNEL ORDER: B alone at town -> one_at_town, never assignable. A is right under home but 30 BELOW it: a bot in a
    # cave under town is not at town (the farm order's FARM_ORDER_DY). Minutes 0 and 3..40 = 39
    ds3 = fixture()
    for sl in ds3['track'].values():
        sl['fx-A']['pos'] = (3, 34, 3)
    q3 = _tf(ds3)['towns']['fx']['projects']['treefarm']
    check('one bot at town: assignable', q3['assignable_min'], 0)
    check('one bot at town: charged to one_at_town', q3['blocked'].get('one_at_town', 0), 39)
    # MATERIAL: nobody at town holds a sapling -> no_material:sapling (C's 9 saplings are away and do not count)
    ds4 = fixture()
    for sl in ds4['track'].values():
        sl['fx-A']['inv'] = {}
        sl['fx-B']['inv'] = {}
    check('no saplings at town: no_material', _tf(ds4)['towns']['fx']['projects']['treefarm']['blocked']
          .get('no_material:sapling', 0), 39)
    # FLAG + PER-BOT LATENCY: only B carries saplings (from 20:00). 0, 3..19 no holder (18); 20..24 B's own cooldown (5);
    # 25: B ready from 25:40, 25:59.999 - 25:40 < 30 s -> within_rotation_latency (1); 26..33 assignable (8); 34..38 B
    # flagged -> free = [A], no sapling -> no_material (5); 39..40 assignable (2)
    ds6 = fixture()
    for sl in ds6['track'].values():
        sl['fx-A']['inv'] = {}
    q6 = _tf(ds6)['towns']['fx']['projects']['treefarm']
    check('flagged holder: assignable', q6['assignable_min'], 10)
    check('flagged holder: no_material', q6['blocked'].get('no_material:sapling', 0), 23)
    check('flagged holder: B own cooldown', q6['blocked'].get('all_in_own_cooldown', 0), 5)
    check('flagged holder: per-bot latency after the cooldown', q6['blocked'].get('within_rotation_latency', 0), 1)
    # VOID, NOT ZERO: the town logs nothing for the whole hour -> every slot void, nothing counted as zero headroom
    ds5 = fixture()
    ds5['track'] = {}
    S5 = _tf(ds5)
    check('silent town: void slots', S5['towns']['fx']['void_slots'], 12)
    q5 = S5['towns']['fx']['projects']['treefarm']
    check('silent town: the project stays, with no minutes and 0% valid (not zero headroom)',
          (q5['open_min'], q5['assignable_min'], S5['projects']['treefarm']['valid_share']), (0, 0, 0.0))
    # THE TICK PATH: twelve one-slot ticks (each loads from start - CARRY_MS, as run_tick does, and emits from start)
    # equal the one-hour census, row for row
    ticks = []
    for k in range(12):
        s = ds['since'] + k * SLOT_MS
        dk = dict(fixture(), since=s - CARRY_MS, until=s + SLOT_MS)
        dk['track'] = {t: v for t, v in dk['track'].items() if s - CARRY_MS <= t < s + SLOT_MS}
        ticks += census(dk, projects=(TreeFarm(),), emit_from=s)
    check('twelve ticks equal the one-hour census', ticks == rows, True)
    # THE TOWN DEMAND READING: a row that read no plot (lease held, lane off) is NO evidence; a partial log clear is unknown
    tf = TreeFarm()
    tl, _ = tf.timeline([{'t': 1, 'pool': 'p', 'kind': '_farm_tend', 'status': 'failed',
                          'detail': 'gen=1 planted=0 failed=0 census=- lease=held:p-B stop=lease_held'},
                         {'t': 2, 'pool': 'p', 'kind': '_farm_tend', 'status': 'success',
                          'detail': 'gen=1 planted=0 soil=0 cleared=1 failed=0 census=logs_above:2 stop=done'},
                         {'t': 3, 'pool': 'p', 'kind': '_farm_tend', 'status': 'success',
                          'detail': 'gen=1 planted=0 soil=0 cleared=0 failed=0 census=logs_above:1 stop=budget'}])
    check('farm demand: census=- is no evidence; cleared logs -> unknown; uncleared logs -> pending',
          [x[1] for x in tl['p']], ['unknown', 'pending'])
    # STOCK: stale / known / unknown and the lower bound
    st = [r for r in rows if r.get('stock')][-1]['stock']
    check('stock containers', (st['containers'], st['known'], st['stale'], st['unknown']), (3, 1, 1, 1))
    check('stock lower bound', (st['lb'].get('cobble'), st['lb'].get('oak_log'), st['complete']), (170, 10, False))
    check('stock lid_blocked within 2 h', st['lid_blocked_2h'], 1)
    mid = [r for r in rows if r['slot'] == iso(ds['since'] + 10 * 60_000)][0]['stock']
    check('stock: a voided container is unknown until recounted (slot ending 00:15)', mid['unknown'], 2)
    check('stock: saplings are untracked, never 0', 'birch_sapling' in st['untracked'] and 'birch_sapling' not in st['lb'],
          True)
    ds8 = fixture()
    ds8['journal'] = {'fx': None}
    check('stock: an unreadable journal is VOID, not an empty town',
          census(ds8, projects=(TreeFarm(),))[0]['stock'].get('void', '').startswith('journal_missing'), True)
    # THE I/O LAYER'S PURE PARTS. A skill row is stamped at its START: board-a-Echo's tend_farm row of 10-19 12:52:54.813Z
    # (duration 16,026 ms) ended at 12:53:10.839Z; its _farm_place rows (12:52:58-12:53:09) lie inside it
    j = job_from_row({'@timestamp': '2026-10-19T12:52:54.813Z', 'bot': {'name': 'board-a-Echo'}, 'exp': {'pool': 'board-a'},
                      'skill': {'name': 'tend_farm', 'duration_ms': 16026, 'status': 'success'}})
    check('job_from_row: the interval starts at @timestamp', (j['start'], j['end'] - j['start']),
          (ms_of('2026-10-19T12:52:54.813Z'), 16026))
    agg = {'buckets': [{'key': 'b1', 'm': {'buckets': [
        {'key': 1000 * 60_000, 'top': {'hits': {'hits': [{'_source': {'exp': {'pool': 'p'}, 'code': {
            'version': '6e1afb52465d+e8f2f5'}, 'bot': {
            'pos': {'x': 1.5, 'y': 64, 'z': -2}, 'health': 19, 'inventory': {'oak_sapling': 2}}}}]}}},
        {'key': 1001 * 60_000, 'top': {'hits': {'hits': []}}}]}}]}
    check('parse_track', dict(parse_track(agg)),
          {1000 * 60_000: {'b1': {'pool': 'p', 'pos': (1.5, 64, -2), 'health': 19, 'inv': {'oak_sapling': 2},
                                  'ver': '6e1afb52465d'}}})
    # TRANSIENT PRESENCE: C's two minutes at town are seen (a slot-end snapshot would not see them)
    s50 = [r for r in rows if r['slot'] == iso(ds['since'] + 50 * 60_000)][0]
    check('transient visit: C at town in the 50:00 slot', 'fx-C' in s50['at_town_bots'], True)
    # THE CARRY: C logs one row at town at 40:00 and then nothing (a disconnect). Its position is carried for 10 minutes
    # (40..49), not for the rest of the hour: free = 56 (A) + 53 (B) + 10 (C)
    ds7 = fixture()
    for t, sl in ds7['track'].items():
        if t == ds7['since'] + 40 * 60_000:
            sl['fx-C']['pos'] = (2, 64, 2)
        else:
            del sl['fx-C']
    check('a silent bot is carried 10 minutes, not forever', _tf(ds7)['towns']['fx']['labour_min'].get('free'), 56 + 53 + 10)
    # HOME under the validator's filter (direct)
    T0 = ds['since']
    hr = [{'bot': 'fx-A', 'start': T0, 'status': 'success', 'trigger': 'watchdog_home', 'health': 20},
          {'bot': 'fx-B', 'start': T0 + 35 * 60_000, 'status': 'failed', 'trigger': 'llm:idle', 'health': 20},   # flagged
          {'bot': 'fx-A', 'start': T0, 'status': 'aborted', 'trigger': 'interrupt:entombed', 'health': 20},
          {'bot': 'fx-A', 'start': T0, 'status': 'failed', 'trigger': 'llm:idle', 'health': 8},                  # low health
          {'bot': 'fx-A', 'start': T0, 'status': 'failed', 'trigger': 'llm:idle', 'health': 20}]
    h = home_success(hr, ds['flags'])
    check('home all', h['all'], [1, 5])
    check('home filtered', h['filtered'], [1, 2])
    check('home excluded', h['excluded'], {'flagged:trap': 1, 'interrupt_trigger': 1, 'flagged:low_health': 1})
    h2 = home_success([{'bot': 'x', 'start': T0, 'status': 'success', 'trigger': 'llm:idle', 'health': None}], [])
    check('home: unknown start health is excluded, not counted as > 10', (h2['filtered'], h2['excluded']),
          ([0, 0], {'health_unknown': 1}))
    # THE GATE: a multi-bot project on 48 h of almost entirely VOID data must not PASS
    gate_rows = []
    for k in range(576):
        r = {'slot': iso(T0 + k * SLOT_MS), 'town': 'g', 'void': True, 'void_why': 'es_empty'}
        if k == 0:
            r = {'slot': iso(T0), 'town': 'g', 'void': False, 'labour_min': {},
                 'projects': {'monument': {'cap': 3, 'open_min': 5, 'pending_min': 5, 'assignable_min': 5,
                                           'blocked': {'assignable': 5}}}}
        gate_rows.append(r)
    check('gate: 1 valid slot of 576 is not a PASS', summarize(gate_rows)['projects']['monument']['gate']
          .startswith('NOT DECIDABLE'), True)
    # a SECOND project town that is void for all 48 h (Codex r2): it stays in the denominator -> 50% valid, not decidable
    two = [{'slot': iso(T0 + k * SLOT_MS), 'town': 'g', 'void': False, 'labour_min': {}, 'projects_open': ['monument'],
            'projects': {'monument': {'cap': 3, 'open_min': 5, 'pending_min': 5, 'assignable_min': 5}}}
           for k in range(576)] + \
          [{'slot': iso(T0 + k * SLOT_MS), 'town': 'h', 'void': True, 'void_why': 'town_silent',
            'projects_open': ['monument']} for k in range(576)]
    S2g = summarize(two)['projects']['monument']
    check('gate: a project town void all window stays in the denominator',
          (S2g['towns'], S2g['valid_share'], S2g['gate'].startswith('NOT DECIDABLE')), (2, 0.5, True))
    # and a non-project town the census never wrote also blocks a decision (every town must be >= 90% valid)
    absent = [dict(r, projects_open=[]) if r['town'] == 'h' else r for r in two]
    for r in absent:
        if r['town'] == 'h':
            r['void_why'] = 'census_absent'
    check('gate: a town the census never wrote blocks the decision too',
          summarize(absent)['projects']['monument']['gate'].startswith('NOT DECIDABLE'), True)
    # Codex r3's case: 12 towns, 11 fully valid, ONE never written (census_absent), a project town at 24 town-h/day. The
    # fleet is 91.7% valid; the silent town is 0% -> not decidable
    twelve = [dict(slot=iso(T0 + k * SLOT_MS), town=str(i), void=(i == 11), void_why='census_absent',
                   projects_open=['monument'] if i == 0 else [],
                   projects={'monument': {'cap': 3, 'open_min': 5, 'pending_min': 5, 'assignable_min': 5}} if i == 0 else {})
              for k in range(576) for i in range(12)]
    S12 = summarize(twelve)
    check('gate: one never-written town of twelve (fleet 91.7% valid) blocks the decision',
          (S12['min_town_valid_share'], S12['projects']['monument']['gate'].startswith('NOT DECIDABLE')), (0.0, True))
    # block 1: 24 town-h; block 2: 17 town-h (204 of 288 slots) -> the 48-h mean is 20.5, but block 2 is under 20
    full = [{'slot': iso(T0 + k * SLOT_MS), 'town': 'g', 'void': False, 'labour_min': {},
             'projects': {'monument': {'cap': 3, 'open_min': 5, 'pending_min': 5,
                                       'assignable_min': 5 if k < 288 + 204 else 0}}} for k in range(576)]
    Sg = summarize(full)['projects']['monument']
    check('gate: blocks 24 and 17 town-h/day (mean 20.5) are NOT MET -- each 24-h block must pass',
          (Sg['per_day_by_24h_block'], Sg['assignable_town_h_per_day'], Sg['gate'].startswith('NOT MET')),
          ([24.0, 17.0], 20.5, True))
    for r in full:
        r['projects']['monument']['assignable_min'] = 5
    check('gate: every block at 24 town-h/day with all hours valid PASSes',
          summarize(full)['projects']['monument']['gate'].startswith('PASS'), True)
    # one town-day 14% void (Claude r2 P3): that town is 93% valid over 48 h and every other check passes, but its second
    # day is 86% valid -- the worst town-day floor refuses a decision (few valid slots must not be scaled up to a day)
    holed = [dict(r, void=True, void_why='es_empty') if 288 <= k < 288 + 40 else r for k, r in enumerate(full)]
    clean = [dict(r, town='g2') for r in full] + [dict(r, town='g3') for r in full]
    check('gate: a 14%-void town-day blocks the decision though every town is >= 90% valid over 48 h',
          summarize(holed + clean)['projects']['monument']['gate'].startswith('NOT DECIDABLE'), True)
    # MONUMENT adapter (fixture-only): 3 slots, funds from the bag, a 10-min budget per bot-hour
    check('fundable: reserve above 65 + tuff', fundable({'cobblestone': 70, 'tuff': 3}), 5 + 3)
    m = Monument()
    tl, site = m.timeline([{'t': 1, 'pool': 'p', 'kind': '_monument_site', 'status': 'success', 'detail': ''},
                           {'t': 2, 'pool': 'p', 'kind': '_monument', 'status': 'success', 'detail': 'gen=1 open=12',
                            'args': {'layer': 70}},
                           {'t': 3, 'pool': 'p', 'kind': '_monument', 'status': 'success', 'detail': 'open=0 stop=complete'}])
    check('monument timeline', [x[1] for x in tl['p']], ['pending', 'pending', 'none'])
    check('monument budget: 10 min of body in the last hour blocks the bot',
          bot_block(m, [(0, 600_000, 'success', None)], [], 1_800_000)[0], 'budget')
    check('monument cooldown: 10 min after the order', bot_block(m, [], [0], 599_999)[0], 'cooldown')
    # ---- B0a CAPABILITY (cooperation design 1.6, 6.4)
    T0c = ms_of('2026-10-19T00:00:00Z')
    V1, V2 = 'aaaa1111', 'bbbb2222'

    def idx_of(*rows):
        return mode_index(list(rows))
    on = idx_of((T0c, 'b', '_cobblecap_mode', V1, True), (T0c, 'b', '_treefarm_mode', V1, True))
    check('capability: an on row of the current build -> capable', bot_capability(on, V1, 'b', '_treefarm_mode', T0c + 1),
          'capable')
    flag_off = idx_of((T0c, 'b', '_cobblecap_mode', V1, True), (T0c, 'b', '_treefarm_mode', V1, True),
                      (T0c + 9e6, 'b', '_cobblecap_mode', V1, True), (T0c + 9e6, 'b', '_treefarm_mode', V1, False))
    check('capability: on, then a restart on the SAME version with the flag off -> not capable',
          bot_capability(flag_off, V1, 'b', '_treefarm_mode', T0c + 1e7), 'not_capable')
    reverted = idx_of((T0c, 'b', '_cobblecap_mode', V1, True), (T0c, 'b', '_treefarm_mode', V1, True),
                      (T0c + 9e6, 'b', '_cobblecap_mode', V2, True))
    check('capability: on, then a restart into a reverted build that emits no mode row -> not capable',
          bot_capability(reverted, V2, 'b', '_treefarm_mode', T0c + 1e7), 'not_capable')
    check('capability: an OLD on row (days before), still on that version -> capable (persistent state)',
          bot_capability(on, V1, 'b', '_treefarm_mode', T0c + 5 * DAY_MS), 'capable')
    check('capability: disabled (mode row off) -> not capable',
          bot_capability(idx_of((T0c, 'b', '_cobblecap_mode', V1, True), (T0c, 'b', '_treefarm_mode', V1, False)), V1, 'b',
                         '_treefarm_mode', T0c + 1), 'not_capable')
    check('capability: no spawn row of the CURRENT build in view -> void, never not_capable',
          bot_capability(on, V2, 'b', '_treefarm_mode', T0c + 1), 'void')
    check('capability: current version unknown -> void', bot_capability(on, None, 'b', '_treefarm_mode', T0c + 1), 'void')
    check('capability: a row AFTER t is not used', bot_capability(on, V1, 'b', '_treefarm_mode', T0c - 1), 'void')
    check('town capability: one capable bot is enough', town_capability(['void', 'not_capable', 'capable']), 'capable')
    check('town capability: all void (staggered restarts) -> void', town_capability(['void', 'void']), 'void')
    check('town capability: none capable, one known -> not_capable', town_capability(['void', 'not_capable']),
          'not_capable')
    check('mode_on contract (on=on / mode=on; townindex index=on)',
          (TreeFarm().mode_on('on=on gen=1'), TreeFarm().mode_on('mode=off'), mode_on_for('_townindex_mode', 'phase=mode index=on'),
           mode_on_for('_townindex_mode', 'phase=mode index=off')), (True, False, True, False))
    # census integration: the hand-worked fixture with mode rows says nothing changes when the code is running ...
    def with_modes(ds, tf_on=True, ver=V1):
        ds['modes'] = []
        for b in ('fx-A', 'fx-B', 'fx-C'):
            ds['modes'].append((ds['since'] - 3600_000, b, '_cobblecap_mode', ver, True))
            if tf_on is not None:
                ds['modes'].append((ds['since'] - 3600_000, b, '_treefarm_mode', ver, tf_on))
        for sl in ds['track'].values():
            for v in sl.values():
                v['ver'] = V1
        return ds
    qc = _tf(with_modes(fixture()))['towns']['fx']['projects']['treefarm']
    check('capable fixture: the hand-worked assignable minutes are unchanged', qc['assignable_min'],
          SELFTEST_EXPECT['assignable_min'])
    # ... and a REVERTED project (its record and rows remain, its module emits no mode row) is record_without_code
    dsr = with_modes(fixture(), tf_on=None)
    rr = census(dsr, projects=(TreeFarm(),))
    Sr = summarize(rr, projects=(TreeFarm(),))
    check('record without code: never open (every valid slot lists it)',
          Sr['record_without_code_slots'].get('fx', {}).get('treefarm'), 12)
    check('record without code: no assignable time', sum((r.get('projects') or {}).get('treefarm', {}).get(
        'assignable_min', 0) for r in rr), 0)
    check('record without code: not in projects_open', any('treefarm' in (r.get('projects_open') or []) for r in rr), False)
    # ... a CAPABLE but STARVED project (record open, code on, no project rows at all) stays OPEN and STALLED, zero placed
    dss = with_modes(fixture())
    dss['prows'] = []
    dss['jobs'] = [j for j in dss['jobs'] if j['name'] != 'tend_farm']
    dss['records'] = {'treefarm': {'fx': dss['since']}}
    qs = _tf(dss)['towns']['fx']['projects']['treefarm']
    check('capable but starved: open all hour, nothing placed, nothing pending (unknown)',
          (qs['open_min'], qs['placed'], qs['pending_min'], qs['unknown_min']), (60, 0, 0, 60))
    # ... a town whose bots' current build has no spawn row in view is capability VOID, never record_without_code
    dsv = with_modes(fixture(), ver=V2)
    Sv = summarize(census(dsv, projects=(TreeFarm(),)), projects=(TreeFarm(),))
    check('capability void: counted as void, not as record_without_code',
          (Sv['capability_void_slots'].get('fx', {}).get('treefarm'), Sv['record_without_code_slots'].get('fx')), (12, None))
    # ... VOID bots at town and an INCAPABLE bot far away: the minutes are VOID, never record_without_code (Codex r2 P2-1)
    dsm = with_modes(fixture())
    dsm['modes'] = [(t, b, k, V2 if b in ('fx-A', 'fx-B') else v, (False if (b == 'fx-C' and k == '_treefarm_mode') else on))
                    for t, b, k, v, on in dsm['modes']]
    Sm = summarize(census(dsm, projects=(TreeFarm(),)), projects=(TreeFarm(),))
    # 11 of 12: in the 50:00 slot C (incapable) is at town for two minutes, so that slot is mixed (neither all-VOID nor
    # all-incapable), as it should be
    check('VOID bots at town + an incapable bot 400 blocks away: VOID slots, no record_without_code',
          (Sm['capability_void_slots'].get('fx', {}).get('treefarm'), Sm['record_without_code_slots'].get('fx')), (11, None))
    dsm2 = with_modes(fixture())
    dsm2['modes'] = [(t, b, k, v, (False if (b in ('fx-A', 'fx-B') and k == '_treefarm_mode') else on))
                     for t, b, k, v, on in dsm2['modes']]
    Sm2 = summarize(census(dsm2, projects=(TreeFarm(),)), projects=(TreeFarm(),))
    check('control for the above: the same town with A and B INCAPABLE (not VOID) at town is record_without_code',
          (Sm2['record_without_code_slots'].get('fx', {}).get('treefarm'), Sm2['capability_void_slots'].get('fx')), (11, None))
    # the POSITIVE CONTROL (an alarm, never a void): every present bot with a known version is eligible; VOID = not capable
    ci = idx_of((T0c, 'a', '_townindex_mode', V1, True), (T0c, 'a', '_cobblecap_mode', V1, True),
                (T0c, 'b', '_townindex_mode', V1, False), (T0c, 'b', '_cobblecap_mode', V1, True),
                (T0c, 'd', '_cobblecap_mode', V2, True))
    cc = capability_control(ci, {'a': V1, 'b': V1, 'c': V1, 'd': V2}, T0c + 11 * 60_000, changed_at={'c': T0c + 6 * 60_000})
    check('positive control: c changed version 5 min ago (not eligible); b off, d a build without it -> 1 of 3, alarm',
          (cc['eligible'], cc['capable'], cc['void'], cc['alarm']), (3, 1, 0, True))
    check('positive control: a bot with no spawn row of its build in view counts VOID and not capable',
          capability_control(ci, {'a': V1, 'e': V1}, T0c + 11 * 60_000)['void'], 1)
    check('positive control: all capable -> no alarm',
          capability_control(idx_of((T0c, 'a', '_townindex_mode', V1, True), (T0c, 'a', '_cobblecap_mode', V1, True)),
                             {'a': V1}, T0c + 11 * 60_000)['alarm'], False)
    check('positive control MUTANT: an EMPTY reader (no mode rows) alarms, never reads healthy',
          capability_control(idx_of(), {'a': V1, 'b': V1}, T0c)['alarm'], True)
    check('positive control MUTANT: a SHORT seed (half the bots VOID) alarms',
          capability_control(idx_of((T0c, 'a', '_townindex_mode', V1, True), (T0c, 'a', '_cobblecap_mode', V1, True)),
                             {'a': V1, 'b': V1}, T0c + 1)['alarm'], True)
    check('positive control: bots present but none eligible (every version just changed) alarms',
          capability_control(idx_of(), {'a': V1}, T0c, changed_at={'a': T0c})['alarm'], True)
    # the SEED WALK is per bot: back 1, 3, 7 days until every present bot's current build has a spawn row
    calls = []

    def fetch(lo, hi, rows=((T0c - 2 * DAY_MS, 'old', '_cobblecap_mode', V1, True),
                            (T0c - 1000, 'new', '_cobblecap_mode', V1, True))):
        calls.append((lo, hi))
        return [r for r in rows if lo <= r[0] < hi]
    got, info = seed_walk(fetch, T0c, {'old': V1, 'new': V1})
    check('seed walk: one day misses the bot that spawned 2 days ago, three days finds it',
          (len(calls), info['missing'], len(got)), (2, [], 2))
    calls.clear()
    got, info = seed_walk(fetch, T0c, {'gone': V1})
    check('seed walk: a bot never found stops at the 7-day bound and is reported missing (VOID, never incapable)',
          (len(calls), info['missing'], iso(ms_of(info['since']))), (3, ['gone'], iso(T0c - 7 * DAY_MS)))
    check('seed walk: never before 2026-10-08', iso(mode_floor(ms_of('2026-10-10T00:00:00Z'))), '2026-10-08T00:00:00Z')
    # FULL HISTORY (Codex r1 P2-2): an old capable state row, then a fresh restart with the flag off: a minute BEFORE the
    # restart still reads capable
    hist = mode_index(sorted({(T0c, 'b', '_cobblecap_mode', V1, True), (T0c, 'b', '_treefarm_mode', V1, True)} |
                             {(T0c + 9e6, 'b', '_cobblecap_mode', V1, True), (T0c + 9e6, 'b', '_treefarm_mode', V1, False)}))
    check('state + fresh: a minute before the restart is capable, after it not',
          (bot_capability(hist, V1, 'b', '_treefarm_mode', T0c + 1e6), bot_capability(hist, V1, 'b', '_treefarm_mode', T0c + 1e7)),
          ('capable', 'not_capable'))
    # VOID LEAVES THE DENOMINATOR (Claude r1 P1-3): every bot VOID -> no valid project hours (not 0 town-h/day at 100%)
    Sv2 = summarize(census(with_modes(fixture(), ver=V2), projects=(TreeFarm(),)), projects=(TreeFarm(),))
    check('every bot VOID: the project has no valid hours, its share is 0, the gate cannot read a zero',
          (Sv2['projects']['treefarm']['valid_h'], Sv2['projects']['treefarm']['valid_share']), (0.0, 0.0))
    # only fx-A VOID (its build's spawn row is not in view): minutes where A was the only possible free holder are
    # capability_void, and they leave the denominator
    dsa = with_modes(fixture())
    dsa['modes'] = [m for m in dsa['modes'] if m[1] != 'fx-A']
    qa = _tf(dsa)['towns']['fx']['projects']['treefarm']
    # (B, capable, is still assignable on its own: the same 10 minutes as the flagged-holder fixture below, ds6)
    # 01:00-20:00 stay no_material (18 min): B has no sapling and A, VOID or not, is in its own backoff until 23:00, so A
    # could not have made them assignable (Claude r2 P3-1); 23:00 onward, where A would have been free, is capability_void
    check('one bot VOID: only the minutes it could have made assignable are capability_void; B still counts',
          (qa['assignable_min'], qa['blocked'].get('capability_void', 0) > 0, qa['blocked'].get('no_material:sapling', 0)),
          (10, True, 18))
    Sa = summarize(census(dsa, projects=(TreeFarm(),)), projects=(TreeFarm(),))
    check('one bot VOID: those minutes leave the project\'s valid hours',
          round(Sa['projects']['treefarm']['valid_h'] + qa['cap_void_min'] / 60, 2), 1.0)
    check('every project adapter declares its mode row', all(P.mode_kind for P in PROJECTS), True)
    # ... a VOID bot that could not have made the minute assignable leaves the KNOWN reason (Claude r2 P3-1): B is VOID and
    # holds no sapling before 20:00, A (capable) is in its own backoff until 23:00, so 01:00-20:00 stays a known zero
    dsk = with_modes(fixture())
    dsk['modes'] = [m for m in dsk['modes'] if m[1] != 'fx-B']
    qk = _tf(dsk)['towns']['fx']['projects']['treefarm']
    qb = _tf(with_modes(fixture()))['towns']['fx']['projects']['treefarm']
    check('VOID bot without material: its minutes keep their known reason, not capability_void',
          (qk['blocked'].get('capability_void', 0) < qb['open_min'] - qb['assignable_min'],
           qk['blocked'].get('all_in_own_cooldown', 0) + qk['blocked'].get('no_material:sapling', 0) > 0), (True, True))
    check('state keeps each bot\'s newest row per kind',
          newest_per_kind([(1, 'b', 'k', V1, True), (5, 'b', 'k', V1, False), (3, 'c', 'k', V1, True)]),
          [(3, 'c', 'k', V1, True), (5, 'b', 'k', V1, False)])
    # THE STALENESS CHECK (check-staffcensus.py)
    chk = load_checker()
    now = ms_of('2026-10-19T12:00:00Z') / 1000

    def hb(at, st='ok', newest='2026-10-19T11:50:00Z', n=12, void=0):
        return json.dumps({'at': at, 'mode': 'tick', 'status': st, 'newest_slot': newest, 'slots_written': n,
                           'void_rows': void, 'capability_control': {'present': 60, 'eligible': 60, 'capable': 60,
                                                                     'void': 0, 'share': 1.0, 'alarm': False}})
    check('checker: fresh measuring tick is healthy', chk.assess([hb('2026-10-19T11:58:00Z')], now)[0], [])
    a = chk.assess([hb('2026-10-19T11:20:00Z', newest='2026-10-19T11:10:00Z')], now)[0]
    check('checker: 40-min-old tick is stale', any(x.startswith('StaffCensusStale: the newest tick is') for x in a), True)
    a = chk.assess([hb('2026-10-19T11:30:00Z'), hb('2026-10-19T11:58:00Z', 'error')], now)[0]
    check('checker: newest tick errored', any(x.startswith('StaffCensusError') for x in a), True)
    check('checker: running but failing -> the newest MEASURING tick is stale',
          any(x.startswith('StaffCensusStale: the newest MEASURING tick') for x in a), True)
    a = chk.assess([hb('2026-10-19T11:55:00Z'), hb('2026-10-19T11:58:00Z', 'void', void=12)], now)[0]
    check('checker: an all-void tick right after a good one alarms', any(x.startswith('StaffCensusVoid') for x in a), True)
    a = chk.assess([hb('2026-10-19T11:58:00Z', void=8)], now)[0]
    check('checker: a tick with 8 of 12 rows void alarms', any(x.startswith('StaffCensusVoid') for x in a), True)
    a = chk.assess([hb('2026-10-19T11:30:00Z'), hb('2026-10-19T11:58:00Z', 'idle', n=0)], now)[0]
    check('checker: idle ticks do not refresh measurement',
          any(x.startswith('StaffCensusStale: the newest MEASURING tick') for x in a), True)
    check('checker: no heartbeat at all', chk.assess([], now)[0][0].startswith('StaffCensusMissing'), True)
    a = chk.assess([hb('2026-10-19T11:58:00Z', newest='2026-10-19T10:00:00Z')], now)[0]
    check('checker: ticking but writing no new slots is behind', any(x.startswith('StaffCensusBehind') for x in a), True)
    a = chk.assess([json.dumps(dict(json.loads(hb('2026-10-19T11:58:00Z')), capability_control={
        'eligible': 60, 'capable': 40, 'share': 0.667, 'alarm': True}))], now)[0]
    check('checker: a capability-control shortfall is an alarm (StaffCensusCapability)',
          any(x.startswith('StaffCensusCapability') for x in a), True)
    a = chk.assess([json.dumps({'at': '2026-10-19T11:59:00Z', 'mode': 'window', 'status': 'ok'})], now)[0]
    a = chk.assess([json.dumps({k: v for k, v in json.loads(hb('2026-10-19T11:58:00Z')).items()
                                if k != 'capability_control'})], now)[0]
    check('checker: a measuring tick WITHOUT a capability control alarms', any(x.startswith('StaffCensusCapability')
                                                                               for x in a), True)
    a = chk.assess([json.dumps({'at': '2026-10-19T11:59:00Z', 'mode': 'window', 'status': 'ok'})], now)[0]
    check('checker: an ad-hoc window run does not count as the standing census',
          bool(a) and a[0].startswith('StaffCensusMissing'), True)
    if fails:
        print('SELFTEST FAILED:')
        for f in fails:
            print('  !! ' + f)
        return False
    if verbose:
        print(f'SELFTEST OK ({len(SELFTEST_EXPECT)} hand-worked values + controls)')
    return True


def load_checker():
    spec = importlib.util.spec_from_file_location('check_staffcensus', os.path.join(HERE, 'check-staffcensus.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------------------------- output
def script_version():
    with open(os.path.abspath(__file__), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def heartbeat(out_dir, rec):
    os.makedirs(out_dir, exist_ok=True)
    rec = dict(rec, at=iso(int(time.time() * 1000)), version=script_version())
    with open(os.path.join(out_dir, 'heartbeat.jsonl'), 'a') as f:
        f.write(json.dumps(rec, sort_keys=True) + '\n')
    tmp = os.path.join(out_dir, '.heartbeat.json.tmp')
    with open(tmp, 'w') as f:
        json.dump(rec, f, sort_keys=True)
    os.replace(tmp, os.path.join(out_dir, 'heartbeat.json'))


def slot_files(out_dir):
    return sorted(glob.glob(os.path.join(out_dir, 'slots', '*.jsonl')))


def newest_recorded(out_dir):
    for f in reversed(slot_files(out_dir)):
        last = None
        with open(f) as fh:
            for line in fh:
                try:
                    last = json.loads(line)['slot']
                except (ValueError, KeyError):
                    pass
        if last:
            return ms_of(last)
    return None


def write_slots(out_dir, rows):
    os.makedirs(os.path.join(out_dir, 'slots'), exist_ok=True)
    by_day = defaultdict(list)
    for r in rows:
        by_day[r['slot'][:10]].append(json.dumps(r, sort_keys=True, default=list))
    for day, lines in sorted(by_day.items()):
        with open(os.path.join(out_dir, 'slots', f'{day}.jsonl'), 'a') as f:
            f.write('\n'.join(lines) + '\n')


def read_recorded(out_dir, since, until, towns=()):
    """Recorded slot rows in [since, until); a (slot, town) the census never wrote is VOID (census_absent). The town list
    is the roster passed in plus every town the files name, so a town the census never wrote still reads VOID."""
    got = {}
    seen_towns = set()
    for f in slot_files(out_dir):
        day = os.path.basename(f)[:10]
        if day < iso(since)[:10] or day > iso(until)[:10]:
            continue
        with open(f) as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                seen_towns.add(r['town'])
                t = ms_of(r['slot'])
                if since <= t < until:
                    got[(t, r['town'])] = r
    rows = []
    for s in range(floor_slot(since), until - SLOT_MS + 1, SLOT_MS):
        for t in sorted(set(towns) | seen_towns):
            rows.append(got.get((s, t)) or {'slot': iso(s), 'town': t, 'void': True,
                                             'void_why': 'census_absent: no slot row was written (the census was not running)'})
    return rows


def render(S, ds=None, checks=None, label='', home_all=None):
    L = [f'STAFF CENSUS (S0) {label}']
    if ds is not None:
        m = ds['meta']
        L.append(f'  window {iso(ds["since"])} .. {iso(ds["until"])}: {m["docs"]:,} skill docs from {m["bots"]} bots, '
                 f'{m["coverage_bot_h"]:,.0f} active bot-h; empty 10-min buckets {len(m["empty_10min"])}')
        L.append('  project kinds in the window: ' + ', '.join(f'{k} {v}' for k, v in m['kinds_present'].items()
                                                                if k.startswith(('_farm', '_monument', 'tend', 'build_mon'))))
        L.append(f'  roster {len(m["roster"])} shared towns from the pool state dir; seen but not in it {m["not_in_roster"]}; '
                 f'journal unreadable {m["journal_missing"]}; record errors {len(m["record_errors"])}')
        for c in m['caveats']:
            L.append(f'  caveat: {c[:160]}')
    L.append(f'  towns {len(S["towns"])} (shared pools; isolated pools excluded) over {S["window_h"]} h')
    L.append('  town        valid_h void  at-town bot-h  free  town-job flagged project | project  open_h pending_h '
             'builder h/visits/body-s ASSIGNABLE_h placed cells/open-h  blocked-by (h)')
    for t, T in S['towns'].items():
        lab = T['labour_min']
        head = (f'  {t:<11} {T["valid_h"]:>6.1f} {T["void_slots"]:>4}  {T["at_town_bot_min"] / 60:>12.1f} '
                f'{lab.get("free", 0) / 60:>5.1f} {lab.get("town_job", 0) / 60:>8.1f} {lab.get("flagged", 0) / 60:>7.1f} '
                f'{lab.get("project", 0) / 60:>7.1f}')
        if not T['projects']:
            L.append(head + ' | (no open project)')
        for name, Q in T['projects'].items():
            bl = ', '.join(f'{k} {v / 60:.2f}' for k, v in sorted(Q['blocked'].items(), key=lambda kv: -kv[1]))
            L.append(head + f' | {name:<8} {Q["open_min"] / 60:>6.2f} {Q["pending_min"] / 60:>9.2f} '
                            f'{Q["builder_min"] / 60:>5.2f}/{Q["visits"]}v/{Q["builder_s"]:.0f}s '
                            f'{Q["assignable_min"] / 60:>12.2f} {Q["placed"]:>6} '
                            f'{Q["cells_per_open_town_h"] if Q["cells_per_open_town_h"] is not None else "-":>12}  {bl or "-"}')
            head = ' ' * len(head)
        if T['void_slots']:
            L.append(f'              void: {T["void_why"]}')
    fl = S.get('fleet_labour_h') or {}
    L.append(f'  ALL TOWNS: {S.get("fleet_valid_town_h")} valid town-h; at-town {fl.get("at_town", 0)} bot-h = free '
             f'{fl.get("free", 0)} + town job {fl.get("town_job", 0)} + project {fl.get("project", 0)} + flagged '
             f'{fl.get("flagged", 0)} (' + ', '.join(f'{k.split(":")[1]} {v}' for k, v in sorted(fl.items())
                                                       if k.startswith('flagged:')) + ')')
    for name, A in S['projects'].items():
        L.append(f'  PROJECT {name} (cap {A["cap"]}{"" if any(P.live for P in PROJECTS if P.name == name) else ", FIXTURE-ONLY adapter"}): '
                 f'{A["towns"]} town(s) open; open {A["open_town_h"]} town-h; {A["visits"]} builder visits, '
                 f'{A["builder_s"]:.0f} body-s; assignable {A["assignable_town_h"]} town-h '
                 f'= {A["assignable_town_h_per_day"]} town-h/day; placed {A["placed"]}; GATE: {A["gate"]}')
    if not S['projects']:
        L.append('  PROJECTS: none open in any shared town in the window -- the gate cannot be read')
    if S.get('record_without_code_slots'):
        L.append('  RECORD WITHOUT CODE (a project record whose module is not running in the town; never open, never '
                 'assignable), slots: ' + ', '.join(f'{t} {c}' for t, c in S['record_without_code_slots'].items()))
    if S.get('capability_void_slots'):
        L.append('  capability VOID (no spawn row of the bots\' current build in view), slots: '
                 + ', '.join(f'{t} {c}' for t, c in S['capability_void_slots'].items()))
    if S.get('capability_control'):
        cc = S['capability_control']
        L.append(f'  capability positive control ({CONTROL_KIND}): {cc["capable"]} of {cc["eligible"]} eligible bots '
                 f'capable (share {cc["share"]}){"  ** ALARM: below " + str(CAP_ALARM_SHARE) if cc["alarm"] else ""}')
    h = S.get('home') or {}
    a, f = h.get('all', [0, 0]), h.get('filtered', [0, 0])
    L.append(f'  home, shared towns (RECALL gate >= 70%): all {a[0]} of {a[1]} ({100 * a[0] / max(1, a[1]):.0f}%); under '
             f'the validator\'s filter {f[0]} of {f[1]} ({100 * f[0] / max(1, f[1]):.0f}%); excluded {h.get("excluded")} '
             f'(health_unknown {(h.get("excluded") or {}).get("health_unknown", 0)} of {a[1]}: a large share means the '
             f'filtered rate covers a selected subset)')
    if home_all:
        L.append(f'  home, all pools incl. isolated: all {home_all["all"]}, filtered {home_all["filtered"]}')
    if checks:
        for k, v in checks.items():
            L.append(f'  instrument: {k}: {v}')
    return '\n'.join(L)


# ---------------------------------------------------------------------------------------------- modes
def run_window(a):
    until = floor_slot(int(time.time() * 1000) - INGEST_LAG_MS) if not a.until else floor_slot(ms_of(a.until))
    since = until - max(1, round(a.window * 60 / 5)) * SLOT_MS          # whole slots only
    print(f'reading {iso(since)} .. {iso(until)} ...')
    ds = dataset_from_es(since - CARRY_MS, until, a.state_dir)
    rows = census(ds, emit_from=since)
    S = summarize(rows)
    S['capability_control'] = ds['capability_control']
    tr = ds['track']
    home_all = home_success([dict(r, health=health_before(tr, r['bot'], r['start'])) for r in ds['home_rows']
                             if since <= r['start'] < until], ds['flags'])
    ds['since'] = since
    checks = instrument_checks(ds)
    txt = render(S, ds, checks, label=f'-- last {a.window:g} h, from ES', home_all=home_all)
    print(txt)
    os.makedirs(os.path.join(a.out_dir, 'reports'), exist_ok=True)
    stem = os.path.join(a.out_dir, 'reports', f'window-{iso(until).replace(":", "")}-{a.window:g}h')
    with open(stem + '.json', 'w') as f:
        json.dump({'summary': S, 'checks': checks, 'home_all': home_all, 'meta': ds['meta'],
                   'since': iso(since), 'until': iso(until)}, f, indent=1, sort_keys=True, default=list)
    with open(stem + '.slots.jsonl', 'w') as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True, default=list) + '\n')
    with open(stem + '.txt', 'w') as f:
        f.write(txt + '\n')
    print(f'  wrote {stem}.json / .slots.jsonl / .txt')
    measured = sum(1 for r in rows if not r.get('void'))
    return {'status': 'ok' if measured else 'void', 'window': [iso(since), iso(until)], 'slots_written': 0,
            'es_docs': ds['meta']['docs'], 'capability_control': ds['capability_control']}


def run_tick(a):
    now = int(time.time() * 1000)
    end = floor_slot(now - TICK_SETTLE_MS)
    last = newest_recorded(a.out_dir)
    start = (last + SLOT_MS) if last is not None else end - 3600_000
    skipped = None
    if start < end - int(a.max_catchup_h * 3600_000):
        skipped = [iso(start), iso(end - int(a.max_catchup_h * 3600_000))]
        start = end - int(a.max_catchup_h * 3600_000)
    if start >= end:
        return {'status': 'idle', 'slots_written': 0, 'newest_slot': iso(last) if last else None,
                'note': 'no new complete slot'}
    # load from start - CARRY_MS so the position carry is warm; write only the new slots
    state, seeded = load_cap_state(a.out_dir)
    due = not seeded or not seeded.get('at') or end - ms_of(seeded['at']) >= RESEED_EVERY_MS
    ds = dataset_from_es(start - CARRY_MS, end, a.state_dir, log=lambda *x: None, cap_state=state, reseed_due=due)
    rows = census(ds, emit_from=start)
    write_slots(a.out_dir, rows)
    if ds['modes']:                      # NEVER save an empty seed (an ES gap must not freeze every bot VOID)
        save_cap_state(a.out_dir, ds['modes'], ds['cap_seeded'] or seeded)
    void = sum(1 for r in rows if r.get('void'))
    return {'status': 'ok' if void < len(rows) else 'void', 'slots_written': len(rows), 'void_rows': void,
            'towns': len(ds['towns']), 'window': [iso(start), iso(end)], 'newest_slot': iso(end - SLOT_MS),
            'es_docs': ds['meta']['docs'], 'skipped_left_void': skipped, 'not_in_roster': ds['meta']['not_in_roster'],
            'journal_missing': ds['meta']['journal_missing'], 'record_errors': len(ds['meta']['record_errors']),
            'capability_control': ds['capability_control'], 'capability_missing_spawn': len(ds['cap_missing']),
            'record_without_code': sorted({f'{r["town"]}:{n}' for r in rows for n in r.get('record_without_code') or []})}


def run_report(a):
    until = floor_slot(int(time.time() * 1000) - INGEST_LAG_MS)
    since = until - max(1, round(a.report * 60 / 5)) * SLOT_MS
    rows = read_recorded(a.out_dir, since, until, towns=pool_roster(a.state_dir))
    if not rows:
        print(f'STAFF CENSUS (S0) -- VOID: no town and no recorded slot in {iso(since)} .. {iso(until)}')
        return {'status': 'void', 'window': [iso(since), iso(until)], 'slots_written': 0}
    S = summarize(rows)
    print(render(S, label=f'-- recorded ticks, last {a.report:g} h ({sum(1 for r in rows if r.get("void"))} of '
                          f'{len(rows)} town-slots void)'))
    return {'status': 'ok', 'window': [iso(since), iso(until)], 'slots_written': 0}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--selftest', action='store_true')
    g.add_argument('--tick', action='store_true')
    g.add_argument('--window', type=float, metavar='HOURS')
    g.add_argument('--report', type=float, metavar='HOURS')
    ap.add_argument('--until', help='window end (ISO), default now - 5 min')
    ap.add_argument('--out-dir', default=os.path.expanduser('~/staffcensus/out'))
    ap.add_argument('--state-dir', default='/var/lib/mcai')
    ap.add_argument('--max-catchup-h', type=float, default=6.0)
    a = ap.parse_args()
    if a.selftest:
        return 0 if selftest() else 1
    mode = 'tick' if a.tick else 'window' if a.window else 'report'
    t0 = time.time()
    rec = {'mode': mode}
    lock = None
    try:
        if not selftest(verbose=False):
            rec.update(status='selftest_failed', error='the fixture self-test failed: no live reading was made')
            print('SELFTEST FAILED -- refusing to read the fleet; run --selftest for the list')
            return 2
        if mode == 'tick':
            os.makedirs(a.out_dir, exist_ok=True)
            lock = open(os.path.join(a.out_dir, '.lock'), 'w')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                rec.update(status='locked', error='another tick holds the lock')
                return 3
            rec.update(run_tick(a))
        elif mode == 'window':
            rec.update(run_window(a))
        else:
            rec.update(run_report(a))
        return 0
    except Exception as e:                      # the heartbeat says so; a crash must never look like a quiet census
        rec.update(status='error', error=f'{type(e).__name__}: {e}'[:400])
        print(f'ERROR {type(e).__name__}: {e}', file=sys.stderr)
        return 1
    finally:
        rec['duration_s'] = round(time.time() - t0, 1)
        try:
            heartbeat(a.out_dir, rec)
        except OSError as e:
            print(f'HEARTBEAT NOT WRITTEN: {e}', file=sys.stderr)
        if mode == 'tick':
            print(f'{iso(int(time.time() * 1000))} tick {rec.get("status")} slots {rec.get("slots_written")} '
                  f'void {rec.get("void_rows", 0)} newest {rec.get("newest_slot")} {rec.get("error", "")}'.rstrip())


if __name__ == '__main__':
    sys.exit(main())
