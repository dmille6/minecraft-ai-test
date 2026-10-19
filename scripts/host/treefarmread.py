#!/usr/bin/env python3
# treefarmread.py [window_min] -- the read for canary `treefarm-01` (the blueprint builder + town tree farm), REVIVED 10-15 on
# fleet 5e663860 (branch farm-on-5e66386; variant farm-on-1957811 for airpocket-03). First registered 10-06 on 1918bb5.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: one tree farm per town (3x3 sapling plots 4 apart, 4 growth torches), founded and tended by a deterministic
# town order `tend_farm`: plant from the bag (birch first, then oak), restore lost soil, clear LEFTOVER logs from plot
# columns, place torches the bot carries. BONE MEAL is OFF by default (OWNER 10-15, after the Paper A/B): the bounded arm
# (only a sapling whose column is clear, never below the bag's reserve of 8, at most 6 a visit) runs only with
# TREEFARM_BONEMEAL=on. With the arm off, bone_meal_used must be 0 (gated in the registration as a defect).
# Ordinary `gather <log>` harvests the trees -- the farm never chops a standing tree. Every mutation is counted only when a
# SERVER block_change names the result at that cell. Rows: `_farm_tend` (one per visit, incl. no_effect skips; detail
# "gen=N planted=N soil=N cleared=N torches=N bonemeal=N bm_grew=N bm_spent=N scaffold=N failed=N offplan=N lost=N lease=gN|held:X [at=..] t0=ms stop=..
# census=k:v,.. species=k:v,.."), `_farm_place` (one per mutation: "role=.. item=.. at=x,y,z verdict=.."), `_farm_site`
# (a record generation created: "gen=N anchor=x,y,z plots=N torches=N [replaced=x,y,z]").
# PAPER SANDBOX 10-05: see docs/reports/blueprint-builder-design-2026-10-05.md (build, resume after SIGKILL, lease,
# paths, grow+harvest+replant with the ordinary gather, bone meal arm).
#
#   LIVENESS     canary `_farm_tend` rows from the canary build (>= 1); control 0 (arms).
#   CORRECTNESS  (each judged; any breach REVERTS) -- C1 OFF-PLAN: a confirmed `_farm_place` at a cell that is not in its
#                town's farm record (/var/lib/mcai/_pool-<pool>/treefarm-<home>.g<N>.json, any generation still on disk),
#                or any `_farm_tend` offplan > 0; C2 TWO BUILDERS: two `_farm_tend` visits by different bots of one pool
#                whose spans [t0, t] overlap and both mutated; C3 LOST: any `_farm_tend` lost > 0 (non-farm items the bag
#                lost during a visit; since 10-15 a block this bot's own walk placed and the server confirmed is scaffold=,
#                not lost). THE LATE SCAFFOLD WORD (treefarm-03, 10-19; treefarm-02 REVERTED at +180 on exactly this): the
#                bot credits a scaffold placement only when the server's block update lands within ~6 s (5 s mineflayer
#                wait + 1 s settle); one that lands later reads lost=. hive-c-Bravo 13:14:52Z: torches=1 scaffold=1 lost=1,
#                the visit's bag delta torch -1 cobblestone -2, two entombment pillar_out placements (_scaffold_pick) and
#                two pathfinder place_error rows inside the visit. So a C3 row is EXCUSED -- named, never silent -- only
#                when ALL hold (judge_c3, pure, fixtures below): the visit's own bag delta is found (the runner's tend_farm
#                row that started at t0); its non-farm losses are ONLY scaffold-class blocks (SCAFFOLD_CLASS: what the
#                pathfinder or the entombment reflex may place; sand/gravel are the reflex's only and the bot never
#                credits them, so they reach here as lost= whether or not the word was late); they total exactly
#                scaffold= + lost= (a JOIN check: both sides are the same client bag read ms apart, so it proves the right
#                run was found, not independent agreement); lost <= LATE_SCAFFOLD_MAX (2); and lost <= the visit's
#                UNMATCHED placement attempts on record: `_scaffold_pick` rows (logged at the pick) inside [t0, t + 0.5 s]
#                minus the scaffold= already credited (Codex: a pick the credited placement explains cannot also explain a
#                loss), plus every `_path_reset place_error` (logged when placeBlock rejects -- mineflayer's 5 s wait, or
#                sooner -- the late word's own signature; a placement confirmed in time leaves none) inside
#                [t0, t + 5.5 s]; the read loads
#                that 5.5 s evidence tail past its window end. Anything else -- any other item, more blocks than that,
#                no delta, no unmatched attempt -- is the defect, as before. EXCUSED rows are EMITTED
#                (c3_late_scaffold_excused) and named, never counted in c3_lost; a pattern of them is for a human.
#                RESIDUALS (named, accepted): attempt rows carry no item or target, so they show an attempt, not which
#                block it consumed -- a real loss of <= 2 scaffold-class blocks in a visit with as many unmatched attempts
#                is excused (and named); a place_error at t0 + 1 s can describe an attempt just before t0; a credited
#                placement whose word landed 5-6 s late (inside SCAFFOLD_SETTLE_MS) can ALSO have a place_error. Bot side: a
#                placement in flight at the stop whose word lands within 5 s after it leaves no attempt row and still
#                reads as the defect.
#                (bamboo-02's lesson, a client tally that lags the server at a stop, is this same class: see BAMBOO below);
#                C4 DOUBLE FOUNDING: more than one `_farm_site` row per pool without replaced=;
#                C5 BONE MEAL WITH NO GROWTH: canary bone meal used >= BM_NOGROW_FLOOR (36), not one use followed by a
#                server-named log (bm_grew), AND no canary visit ever saw a grown tree on its farm (census tree) --
#                vanilla's 45%-per-stage model says a tree per ~4.4 uses (36 spread over 9 saplings: P(0) = 2.2e-4,
#                _bm_null), but MEASURED on Paper 10-15 only 7 of 61 uses (11%) were followed by a server-named log within
#                600 ms -- P(0 in 36 | 11%) ~ 0.012 -- so the gate also requires that no canary visit ever saw a grown tree
#                (census), which a working farm always does: C5 fires only when bone meal is spent on a farm where nothing
#                grows at all;
#                C6 RESERVE: a canary visit that used bone meal and left the bag under BONEMEAL_RESERVE (8) by the row's own
#                inventory snapshot.
#   BAMBOO       (10-19: bamboo-02 reverted on a client tally one craft short of the server at a stop). Here: planted,
#                soil, cleared, torches and bonemeal count only SERVER-confirmed changes, so a stop can only UNDER-count them
#                (C1/C2 never see a phantom; exposure can only come later). bm_spent is a bag loss and could over-count at a
#                stop: with the arm off nothing clicks bone meal, but bonemeal_used = max(bonemeal, bm_spent), so a bag
#                resync or a lost bone meal inside a visit would still trip `bonemeal_used <= 0` (kept: bone meal is
#                FARM_FLOW, so this is the only line that sees it leave); such a row is NAMED (bm_spent > 0 with 0
#                confirmed uses) for the human reading the verdict. C6 (arm on only; inert with the arm off) reads the
#                row's own client inventory snapshot, which can be stale at a stop in either direction: an arm-on
#                registration must not use it as stop-time proof. C6 has no arm check of its own: with the arm off a
#                bag-only bone meal loss (bm_spent > 0, 0 uses) under the reserve fires it too; the arm-off registration
#                gates it as well. The gather lines (INSTRUMENT, EXPOSURE's log half, PRIMARY) read the runner's client
#                inventory_delta, so a late log update shifts them by its count too (reported/positive-control lines).
#                lost= is the other client counter that over-counts at a
#                stop -- the late scaffold word above.
#   INSTRUMENT   control log gathers with a positive log delta (>= 20): the outcome this changes exists and is read.
#   EXPOSURE     >= 1 canary farm founded or tended with >= 9 confirmed plantings, AND the instrument.
#   PRIMARY      (REPORTED) logs gathered per bot-hour (gather rows' positive *_log inventory_delta), the same within 48 of
#                home, median distance from home of successful log gathers, gather seconds per log; each DiD vs the
#                same-length pre-window. Plus: farm census (plots holding a grown tree when visited; plots another
#                structure took: soil/cell/column_foreign), tend outcomes, BONE MEAL used per canary bot-hour and the share
#                that grew a tree (the fleet's composters made 90 in 24 h on 10-15 -- 0.047 per bot-hour -- and the bags held
#                1,982: the read says how fast the farm spends it), canary bot-hours within 96 of home (the farm's random
#                ticks only fire while a player is that near: a farm nobody visits does not grow).
import sys, os, json, re, glob, statistics
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
if not os.environ.get('TREEFARM_SELFTEST'):   # the selftest (fixtures only) runs anywhere
    from lib.telemetry import Events

# ---- C3: THE LATE SCAFFOLD WORD (treefarm-03) -- pure, judged before anything is loaded --------------------------------
# What a farm visit may consume or gain without it being a loss (skills.mjs FARM_FLOW, verbatim).
FARM_FLOW = re.compile(r'(_sapling$|_log$|^dirt$|^torch$|^bone_meal$|^stick$|^apple$|_leaves$)')
# The blocks this fleet places as scaffold: the pathfinder's (skills.mjs farmScaffoldNames' default: dirt, cobblestone and
# scaffold.mjs PATHFINDER_SCAFFOLD) and the entombment reflex's pillar blocks (reflex.mjs PLACEABLE).
SCAFFOLD_CLASS = re.compile(r'^(dirt|cobblestone|stone|andesite|diorite|granite|deepslate|cobbled_deepslate|tuff|netherrack|sandstone|'
                            r'red_sandstone|dripstone_block|coarse_dirt|rooted_dirt|sand|gravel|mossy_cobblestone|stone_bricks|'
                            r'smooth_stone|blackstone|basalt|crimson_stem|warped_stem|stripped_crimson_stem|stripped_warped_stem)$'
                            r'|(_log|_planks|_wood|_hyphae)$')
LATE_SCAFFOLD_MAX = 2
PLACE_ERROR_LAG = 5.5      # mineflayer place_block's 5 s blockUpdate wait + 0.5 s: a place_error row trails its attempt


def judge_c3(lost, scaffold, delta, attempts):
    """PURE. A `_farm_tend` row's C3 -> None (no breach, or EXCUSED: see `why`) and a reason string, as (breach, why).
    lost/scaffold: the row's lost= and scaffold=; delta: the visit's bag delta {name: signed count} or None (not found);
    attempts: the visit's scaffold placement attempts on record."""
    if lost <= 0:
        return None, None
    if not isinstance(delta, dict):
        return 'lost=%d (no bag delta for the visit)' % lost, None
    gone = {n: -int(v) for n, v in delta.items() if isinstance(v, (int, float)) and v < 0 and not FARM_FLOW.search(str(n))}
    other = sorted(n for n in gone if not SCAFFOLD_CLASS.search(n))
    if other:
        return 'lost=%d (the bag lost %s)' % (lost, ','.join('%s:%d' % (n, gone[n]) for n in other)), None
    total = sum(gone.values())
    if total != scaffold + lost:
        return 'lost=%d (the bag lost %d scaffold-class block(s), the row says scaffold=%d lost=%d)' % (lost, total, scaffold, lost), None
    if lost > LATE_SCAFFOLD_MAX:
        return 'lost=%d (more than %d late scaffold words in one visit)' % (lost, LATE_SCAFFOLD_MAX), None
    if lost > attempts:
        return 'lost=%d (only %d unmatched scaffold placement attempt(s) on record in the visit)' % (lost, attempts), None
    return None, 'lost=%d excused as late scaffold: bag %s, scaffold=%d, %d unmatched attempt(s) on record' % (
        lost, ','.join('%s:-%d' % (n, gone[n]) for n in sorted(gone)), scaffold, attempts)


def judge_c3_rows(cands, tend_runs, place_ev):
    """PURE. cands [(bot, t_end, t0, lost, scaffold)] (epoch s); tend_runs {bot: [(t_start, delta)]}; place_ev {bot:
    [(t, kind)]}, kind 'pick' (_scaffold_pick) or 'error' (_path_reset place_error) -> (breaches [(bot, why)], excused
    [(bot, 'HH:MM:SSZ', why)]). A visit's delta is the ONE tend_farm run that started within 2 s of its t0 (none or two: no
    delta, never excused). CANDIDATE attempts (evidence of an attempt, not proof of a placement): max(0, picks inside
    [t0, t_end + 0.5] - scaffold=) + place errors inside [t0, t_end + PLACE_ERROR_LAG] (an error row trails its attempt by
    mineflayer's 5 s wait)."""
    breaches, excused = [], []
    for b, tend_end, t0s, lost_n, scaf_n in cands:
        runs = [dl for ts, dl in tend_runs.get(b, []) if abs(ts - t0s) <= 2.0]
        delta = runs[0] if len(runs) == 1 else None
        ev = [kind for ts, kind in place_ev.get(b, []) if t0s <= ts <= tend_end + (PLACE_ERROR_LAG if kind == 'error' else 0.5)]
        # the credited scaffold= is matched against PICKS only: a placement the server confirmed in time leaves no place_error
        # (Claude r3: a pathfinder block placed normally logs nothing), and a place_error IS the late word's own signature
        breach, why = judge_c3(lost_n, scaf_n, delta, max(0, ev.count('pick') - scaf_n) + ev.count('error'))
        if breach:
            breaches.append((b, breach))
        elif why:
            excused.append((b, dt.datetime.fromtimestamp(tend_end, dt.timezone.utc).strftime('%H:%M:%SZ'), why))
    return breaches, excused


# FIXTURES. THE REVERTED ROW, verbatim (hive-c-Bravo 2026-10-19 13:14:52.477Z, run treefarm-02, 0b3a0d4c): the visit's
# tend_farm delta {'torch': -1, 'cobblestone': -2}; inside [t0, t]: _path_reset place_error 13:14:43.427 and 13:14:48.521,
# _scaffold_pick pillar_out 13:14:46.168 and 13:14:51.734 -> 4 attempts.
_REVERTED = 'gen=1 planted=0 soil=0 cleared=0 torches=1 bonemeal=0 bm_grew=0 bm_spent=0 scaffold=1 failed=0 offplan=0 lost=1 t0=1792415678218 census=sapling:6 species=- lease=g5 stop=done'
def _j(d, delta, attempts):
    f = {k: v for k, v in re.findall(r'(?:^| )([a-z0-9_]+)=(\S*)', d)}
    return judge_c3(int(f['lost']), int(f['scaffold']), delta, attempts)
assert _j(_REVERTED, {'torch': -1, 'cobblestone': -2}, 4)[0] is None and 'excused' in _j(_REVERTED, {'torch': -1, 'cobblestone': -2}, 4)[1]
# POSITIVE CONTROLS: a real loss is still the defect
assert _j(_REVERTED, {'torch': -1, 'cobblestone': -1, 'stone_pickaxe': -1}, 4)[0], 'a non-farm, non-scaffold item lost'
assert _j(_REVERTED, {'torch': -1, 'cobblestone': -2, 'iron_ingot': -1}, 4)[0], 'scaffold right, plus a real item'
assert _j(_REVERTED, {'torch': -1, 'cobblestone': -3}, 4)[0], 'more blocks gone than scaffold= + lost='
assert _j(_REVERTED, {'torch': -1, 'cobblestone': -1}, 4)[0], 'fewer blocks gone than the row says'
assert _j(_REVERTED, None, 4)[0], 'no bag delta found: never excused'
assert _j(_REVERTED, {'torch': -1, 'cobblestone': -2}, 0)[0], 'no placement attempt on record'
assert _j(_REVERTED.replace('scaffold=1', 'scaffold=0').replace('lost=1', 'lost=3'), {'cobblestone': -3}, 9)[0], 'over LATE_SCAFFOLD_MAX'
assert _j(_REVERTED.replace('lost=1', 'lost=2'), {'cobblestone': -3}, 1)[0], 'more late words than attempts'
assert _j(_REVERTED.replace('lost=1', 'lost=2'), {'cobblestone': -2, 'andesite': -1}, 2)[0] is None, 'two scaffold names, two attempts'
assert _j(_REVERTED.replace('lost=1', 'lost=0'), None, 0) == (None, None), 'lost=0: nothing to judge'
assert FARM_FLOW.search('oak_log') and not SCAFFOLD_CLASS.search('stone_pickaxe') and SCAFFOLD_CLASS.search('cobbled_deepslate')
# THE JOIN, on the reverted visit's own timings (epoch s): t0 13:14:38.218, row 13:14:52.477, tend_farm run stamped at t0
_T0 = 1792415678.218; _TE = 1792415692.477
_EV = {'hive-c-Bravo': [(_T0 + 5.209, 'error'), (_T0 + 7.950, 'pick'), (_T0 + 10.303, 'error'), (_T0 + 13.516, 'pick'), (_T0 + 20.799, 'pick')]}   # 4 inside, 1 pick after (13:14:59)
_RUN = {'hive-c-Bravo': [(_T0, {'torch': -1, 'cobblestone': -2})]}
_C = [('hive-c-Bravo', _TE, _T0, 1, 1)]
_b, _x = judge_c3_rows(_C, _RUN, _EV)
assert _b == [] and len(_x) == 1 and _x[0][1] == '13:14:52Z' and '3 unmatched attempt' in _x[0][2], (_b, _x)
assert judge_c3_rows(_C, {'hive-c-Bravo': [(_T0 + 3.0, {'torch': -1, 'cobblestone': -2})]}, _EV)[0], 'a run 3 s off t0 is not this visit'
assert judge_c3_rows(_C, {'hive-c-Bravo': _RUN['hive-c-Bravo'] * 2}, _EV)[0], 'two candidate runs: ambiguous, never excused'
assert judge_c3_rows(_C, {'other-bot': _RUN['hive-c-Bravo']}, _EV)[0], 'another bot\'s run is not this visit'
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_T0 - 5.0, 'pick'), (_TE + 7.0, 'error'), (_TE + 1.0, 'pick')]})[0], 'attempts outside the windows do not count'
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_TE + 3.0, 'error')]})[0] == [], 'a place_error 3 s after the row (its attempt was inside the visit): the late word itself'
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_T0 + 9.0, 'error')]})[0] == [], 'Claude r3: scaffold=1 placed normally (no row), one late word (one place_error): excused'
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_T0 + 7.950, 'pick'), (_TE + 3.0, 'pick')]})[0], 'a pick after the row is not this visit\'s'
# UNMATCHED (Codex): one attempt and scaffold=1 -- the attempt is the credited placement's; the second cobble is a defect
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_T0 + 7.950, 'pick')]})[0], 'one attempt, already matched to scaffold=1'
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_T0 + 7.950, 'pick'), (_T0 + 13.516, 'pick')]})[0] == [], 'two attempts: one unmatched'
assert judge_c3_rows(_C, _RUN, {'hive-c-Bravo': [(_T0 - 0.3, 'pick'), (_T0 + 7.950, 'pick')]})[0], 'a pick before t0 is not this visit\'s'
_C4 = [('b%d' % i, _TE, _T0, 1, 1) for i in range(4)]
assert len(judge_c3_rows(_C4, {'b%d' % i: _RUN['hive-c-Bravo'] for i in range(4)}, {'b%d' % i: _EV['hive-c-Bravo'] for i in range(4)})[1]) == 4, 'excused rows are never turned into C3 by their count (Claude r2: no denominator); they are emitted and named'
assert judge_c3_rows(_C, _RUN, {'other-bot': _EV['hive-c-Bravo']})[0], 'another bot\'s attempts do not count'
if os.environ.get('TREEFARM_SELFTEST'):
    print('treefarmread selftest OK'); sys.exit(0)

man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)
TOWN = 48          # composter.mjs TOWN_RADIUS
TICK = 96          # simulation-distance 6 chunks on the fleet worlds
BM_NOGROW_FLOOR = 36   # C5: bone meal uses before zero growth is a defect (P(0 trees | healthy) <= 2e-4: _bm_null below)
BM_RESERVE = 8         # treefarm.mjs BONEMEAL_RESERVE
STATE = os.environ.get('TREEFARM_STATE', '/var/lib/mcai')


def load_window(since, until):
    """Rotation-aware (oretunnelread's pattern): logs rotate ~23:59Z, day D's rows live in skill-*.jsonl-<D+1>.gz."""
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


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def homes():
    """bot -> {'X','Y','Z'} from the harness env files. ONLY the HOME_ lines are read (the files hold other settings)."""
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


KV = re.compile(r'(?:^| )([a-z0-9_]+)=(\S*)')


def fields(d):
    return {k: v for k, v in KV.findall(d or '')}


def num(f, k):
    try:
        return int(f.get(k, '0'))
    except ValueError:
        return 0


def census(s):
    out = {}
    for kv in (s or '-').split(','):
        k, _, v = kv.partition(':')
        if v.isdigit():
            out[k] = int(v)
    return out


def records(pool):
    """Every recorded farm cell for the pool, over every generation still on disk -> set of 'x,y,z' (plot, soil, torch,
    column). A placement into ANY generation's cells is on-plan (a replaced farm's late visit), anything else is not."""
    cells = set()
    files = glob.glob(os.path.join(STATE, '_pool-%s' % pool, 'treefarm-*.g*.json'))
    for f in files:
        try:
            r = json.load(open(f))
        except (OSError, ValueError):
            continue
        for c in r.get('cells') or []:
            x, y, z = c.get('x'), c.get('y'), c.get('z')
            if not all(isinstance(v, int) for v in (x, y, z)):
                continue
            if c.get('role') == 'plot':
                for k in range(-1, 8):
                    cells.add('%d,%d,%d' % (x, y + k, z))
            else:
                cells.add('%d,%d,%d' % (x, y, z)); cells.add('%d,%d,%d' % (x, y - 1, z))
    return cells, len(files)


# POSITIVE CONTROLS for the parsers: farmTendDetail's and the place row's own shapes, and a skip.
_t = fields('gen=1 planted=9 soil=0 cleared=2 torches=4 bonemeal=0 failed=1 offplan=0 lost=0 lease=g3 t0=1759690000000 stop=done census=ready:9 species=birch_sapling:6,oak_sapling:3')
assert num(_t, 'planted') == 9 and num(_t, 'cleared') == 2 and _t['lease'] == 'g3' and census(_t['census']) == {'ready': 9}
assert census(_t['species']) == {'birch_sapling': 6, 'oak_sapling': 3} and num(_t, 't0') == 1759690000000
_s = fields('gen=1 planted=0 soil=0 cleared=0 torches=0 bonemeal=0 failed=0 offplan=0 lost=0 lease=held:board-a-Bravo t0=1 stop=another_bot census=- species=-')
assert _s['lease'] == 'held:board-a-Bravo' and census(_s['census']) == {}
_p = fields('role=plant item=birch_sapling at=401,64,229 verdict=confirmed')
assert _p['at'] == '401,64,229' and _p['verdict'] == 'confirmed'
_b = fields('gen=2 planted=0 soil=0 cleared=1 torches=0 bonemeal=6 bm_grew=2 bm_spent=6 failed=0 offplan=0 lost=0 lease=g9 t0=1760500000000 stop=done census=sapling:8,tree:1 species=-')
assert num(_b, 'bonemeal') == 6 and num(_b, 'bm_grew') == 2 and num(_b, 'bm_spent') == 6 and census(_b['census']) == {'sapling': 8, 'tree': 1}
_q = fields('role=bonemeal item=bone_meal at=401,64,229 verdict=consumed grew=1')
assert _q['verdict'] == 'consumed' and _q['grew'] == '1'


def _bm_null(uses=BM_NOGROW_FLOOR, saplings=9, p=0.45, trials=200000, seed=7):
    """P(no tree after `uses` uses spread as evenly as possible over `saplings` stage-0 saplings), by simulation. Pure."""
    import random
    rnd = random.Random(seed); zero = 0
    per = [uses // saplings + (1 if i < uses % saplings else 0) for i in range(saplings)]
    for _ in range(trials):
        if all(sum(rnd.random() < p for _ in range(n)) < 2 for n in per):
            zero += 1
    return zero / trials


def inv_of(raw):
    inv = ((raw or {}).get('bot') or {}).get('inventory')
    if isinstance(inv, dict):
        return inv
    if isinstance(inv, list):
        out = Counter()
        for it in inv:
            if isinstance(it, dict):
                out[it.get('name')] += it.get('count') or 0
        return out
    return None


assert inv_of({'bot': {'inventory': {'bone_meal': 7}}}) == {'bone_meal': 7} and inv_of({'bot': {'inventory': [{'name': 'bone_meal', 'count': 3}]}})['bone_meal'] == 3
assert inv_of({}) is None
if os.environ.get('TREEFARM_SELFTEST_NULL'):
    print('C5 null: P(0 trees | 36 uses over 9 saplings) = %.5f' % _bm_null())
LOG = re.compile(r'_log$|_stem$')

# C3's evidence tail (Codex r2): a place_error trails its attempt by up to PLACE_ERROR_LAG, so evidence rows are read
# PLACE_ERROR_LAG past END; every other line stops at END (the loop below)
EV_END = END + dt.timedelta(seconds=PLACE_ERROR_LAG)
rows_all = sorted(load_window(PRE, EV_END), key=lambda r: r['t'])
H = homes()
print('rows walked %d  |  bots with a home %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows_all), len(H), CAN, CV, CUT.strftime('%H:%MZ'), W))
rows = Counter(); offbuild = 0
tends = defaultdict(list); places = []; sites = defaultdict(list)
scaffold_used = [0]; c1 = []; c3 = []; c3_cand = []; c3_excused = []; bm_bagonly = []; tend_runs = defaultdict(list); place_ev = defaultdict(list); c6 = []; bm_grew = 0; inv_seen = 0; foreign = Counter(); bonemeal_used = 0; tend_status = Counter(); planted = 0; cleared = 0; torches = 0; soil = 0; grown_seen = []
gat = {(p, a): {'logs': 0, 'near': 0, 'secs': 0.0, 'dist': [], 'n': 0, 'pos': 0} for p in ('pre', 'post') for a in ('canary', 'control')}
seen_bots = defaultdict(set); near_rows = Counter(); all_rows = Counter()
for r in rows_all:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    if t > END:   # the evidence tail only: a canary place_error of the build, nothing else
        if pool_of(b) in CANS and r.get('name') == '_path_reset' and (r.get('detail') or '').startswith('place_error'):
            ver2 = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
            if not (CV and ver2 and not ver2.startswith(CV)):
                place_ev[b].append((t.timestamp(), 'error'))
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    raw = r.get('raw') or {}
    ver = ((raw.get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if other:
        if r.get('name') in ('_farm_tend', '_farm_place', '_farm_site'):
            offbuild += 1
        continue
    seen_bots[(period, arm)].add(b)
    pos = (raw.get('bot') or {}).get('pos') or {}
    h = H.get(b)
    dist = None
    if h and isinstance(pos.get('x'), (int, float)):
        dist = ((pos['x'] - h['X']) ** 2 + (pos['z'] - h['Z']) ** 2) ** 0.5
    if period == 'post' and arm == 'canary' and dist is not None:
        all_rows[b] += 1
        near_rows[b] += int(dist <= TICK)
    k = r.get('name'); d = r.get('detail') or ''
    sk = raw.get('skill') or {}
    if k == 'gather':
        args = sk.get('args') or {}
        delta = sk.get('inventory_delta') or {}
        logs = sum(v for n, v in delta.items() if LOG.search(n) and isinstance(v, (int, float)) and v > 0)
        if LOG.search(str(args.get('block') or '')) or logs > 0:
            g = gat[(period, arm)]
            g['n'] += 1; g['logs'] += logs; g['secs'] += (sk.get('duration_ms') or 0) / 1000.0; g['pos'] += int(logs > 0)
            if logs > 0 and dist is not None:
                g['dist'].append(dist)
                g['near'] += logs if dist <= TOWN else 0
        continue
    # C3's evidence (canary, post): the runner's tend_farm rows (stamped at the run's START, = the _farm_tend row's t0) with
    # their bag delta, and the bot's scaffold placement attempts (reflex pillar picks, pathfinder place errors)
    if period == 'post' and arm == 'canary':
        if k == 'tend_farm':
            tend_runs[b].append((t.timestamp(), sk.get('inventory_delta')))
        elif k == '_scaffold_pick':
            place_ev[b].append((t.timestamp(), 'pick'))
        elif k == '_path_reset' and d.startswith('place_error'):
            place_ev[b].append((t.timestamp(), 'error'))
    if k not in ('_farm_tend', '_farm_place', '_farm_site') or period != 'post':
        continue
    rows[arm] += 1
    if arm != 'canary':
        continue
    f = fields(d)
    st = sk.get('status') or r.get('status')
    if k == '_farm_site':
        sites[pool_of(b)].append(f)
    elif k == '_farm_place':
        if f.get('verdict') in ('confirmed', 'consumed'):
            places.append((pool_of(b), b, f.get('at'), f.get('role'), t))
    else:
        tend_status[st] += 1
        tends[pool_of(b)].append({'bot': b, 't': t, 't0': num(f, 't0'), 'mut': num(f, 'planted') + num(f, 'soil') + num(f, 'cleared') + num(f, 'torches') + num(f, 'bonemeal')})
        if num(f, 'offplan') > 0:
            c1.append((b, 'offplan=%s' % f.get('offplan')))
        if num(f, 'lost') > 0:
            c3_cand.append((b, t.timestamp(), num(f, 't0') / 1000.0, num(f, 'lost'), num(f, 'scaffold')))
        scaffold_used[0] += num(f, 'scaffold'); planted += num(f, 'planted'); cleared += num(f, 'cleared'); torches += num(f, 'torches'); soil += num(f, 'soil')
        # USED = the larger of the confirmed uses and the bag's own loss over the visit (a use whose bag update came late)
        bonemeal_used += max(num(f, 'bonemeal'), num(f, 'bm_spent')); bm_grew += num(f, 'bm_grew')
        if num(f, 'bm_spent') > 0 and num(f, 'bonemeal') == 0:
            bm_bagonly.append((b, t.strftime('%H:%M:%SZ'), 'bm_spent=%d with 0 confirmed uses' % num(f, 'bm_spent')))
        inv = inv_of(raw)
        if inv is not None:
            inv_seen += 1
            if max(num(f, 'bonemeal'), num(f, 'bm_spent')) > 0 and (inv.get('bone_meal') or 0) < BM_RESERVE:
                c6.append((b, 'bone_meal left %s after using %s' % (inv.get('bone_meal') or 0, f.get('bonemeal'))))
        cz = census(f.get('census'))
        if cz:
            grown_seen.append(cz.get('tree', 0))
            for k2 in ('soil_foreign', 'cell_foreign', 'column_foreign'):
                foreign[k2] += cz.get(k2, 0)

# C3: each lost row against its own visit's bag delta and placement attempts (judge_c3_rows)
c3, c3_excused = judge_c3_rows(c3_cand, tend_runs, place_ev)
# C1: confirmed placements against the records on disk
rec_cache = {}
nrec = 0
for pool, b, at, role, t in places:
    if pool not in rec_cache:
        rec_cache[pool] = records(pool); nrec += rec_cache[pool][1]
    cells, n = rec_cache[pool]
    if n and at not in cells:
        c1.append((b, 'off-record %s %s' % (role, at)))
unreadable = sorted(p for p, (c, n) in rec_cache.items() if n == 0)
# C2: overlapping mutating visits by different bots of one pool
c2 = []
for pool, vs in tends.items():
    vs = [v for v in vs if v['mut'] > 0 and v['t0'] > 0]
    for i in range(len(vs)):
        for j in range(i + 1, len(vs)):
            a, bb = vs[i], vs[j]
            ta = (a['t0'] / 1000.0, a['t'].timestamp()); tb = (bb['t0'] / 1000.0, bb['t'].timestamp())
            if a['bot'] != bb['bot'] and ta[0] < tb[1] and tb[0] < ta[1]:
                c2.append((pool, a['bot'], bb['bot']))
# C4: double founding
c4 = {p: len([s for s in ss if 'replaced' not in s]) for p, ss in sites.items() if len([s for s in ss if 'replaced' not in s]) > 1}
replaced = {p: len([s for s in ss if 'replaced' in s]) for p, ss in sites.items() if any('replaced' in s for s in ss)}


def bot_hours(period, arm):
    return len(seen_bots[(period, arm)]) * W / 60.0


def rate(period, arm, key):
    bh = bot_hours(period, arm)
    return gat[(period, arm)][key] / bh if bh else float('nan')


def med(period, arm):
    xs = gat[(period, arm)]['dist']
    return statistics.median(xs) if xs else float('nan')


def spl(period, arm):
    g = gat[(period, arm)]
    return g['secs'] / g['logs'] if g['logs'] else float('nan')


def did(f):
    return (f('post', 'canary') - f('pre', 'canary')) - (f('post', 'control') - f('pre', 'control'))


logs_rate = lambda p, a: rate(p, a, 'logs')
near_rate = lambda p, a: rate(p, a, 'near')
inst = gat[('post', 'control')]['pos']
founded = sum(len(ss) for ss in sites.values())
exposure = int((founded >= 1 or planted >= 9) and planted >= 9 and inst >= 20)
c5 = int(bonemeal_used >= BM_NOGROW_FLOOR and bm_grew == 0 and max(grown_seen or [0]) == 0)
can_bh = bot_hours('post', 'canary')
bm_per_bh = bonemeal_used / can_bh if can_bh else float('nan')
tick_share = (sum(near_rows.values()) / sum(all_rows.values())) if sum(all_rows.values()) else float('nan')
print('-' * 78)
print('LIVENESS     canary farm rows %d (>= 1) | control %d (must be 0) | other build %d' % (rows['canary'], rows['control'], offbuild))
print('CORRECTNESS  C1 off-plan %d | C2 two builders %d | C3 items lost %d (rows with lost > 0: %d; excused as late scaffold %d) | C4 double founding %s | records on disk %d (unreadable pools %s)'
      % (len(c1), len(c2), len(c3), len(c3_cand), len(c3_excused), c4 or 0, nrec, unreadable or '-'))
for x in c3_excused:
    print('  C3 excused (named):', x)
for x in bm_bagonly:
    print('  BONE MEAL by the bag only (named; counts in bonemeal_used):', x)
print('INSTRUMENT   control log gathers with logs > 0: %d (>= 20)' % inst)
print('FARM         sites %d (replaced %s) | visits %s | planted %d cleared %d torches %d soil %d | trees seen at visit max %s | taken by another structure %s'
      % (founded, replaced or 0, dict(tend_status), planted, cleared, torches, soil, max(grown_seen) if grown_seen else '-', dict(foreign) or 0))
print('WALKS        scaffold blocks placed by farm-visit walks %d (reported; not a loss -- C3 excludes them since 10-15)' % scaffold_used[0])
print('BONE MEAL    used %d (EXPECTED 0: the arm is off by default) (%.2f per canary bot-hour; fleet composting made 0.047/bot-h on 10-15) | grew a tree %d (%.0f%%) | C5 no-growth %d (floor %d; arm on only) | C6 reserve breaches %d (inventory on %d visit rows)'
      % (bonemeal_used, bm_per_bh, bm_grew, 100.0 * bm_grew / bonemeal_used if bonemeal_used else 0, c5, BM_NOGROW_FLOOR, len(c6), inv_seen))
print('TICKING      canary rows within %d of home: %.1f%% (a farm only grows while someone is that near)' % (TICK, 100 * tick_share))
print('PRIMARY      logs/bot-h canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f' % (logs_rate('pre', 'canary'), logs_rate('post', 'canary'), logs_rate('pre', 'control'), logs_rate('post', 'control'), did(logs_rate)))
print('             near-town logs/bot-h DiD %+.2f | median gather distance canary %.0f -> %.0f control %.0f -> %.0f DiD %+.1f | gather s/log DiD %+.1f'
      % (did(near_rate), med('pre', 'canary'), med('post', 'canary'), med('pre', 'control'), med('post', 'control'), did(med), did(spl)))
for x in (c1[:5] + c2[:3] + c3[:3] + c6[:3]):
    print('  breach:', x)
nan = lambda v: None if v != v else round(v, 3)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('treefarmread', W, {
        'rows_canary': rows['canary'], 'rows_control': rows['control'], 'offbuild_canary': offbuild,
        'c1_offplan': len(c1), 'c2_two_builders': len(c2), 'c3_lost': len(c3), 'c3_late_scaffold_excused': len(c3_excused), 'c4_double_founding': len(c4),
        'instrument_control': inst, 'exposure_ready': exposure, 'sites_founded': founded, 'planted': planted, 'cleared': cleared,
        'torches': torches, 'bonemeal_used': bonemeal_used, 'bonemeal_grew': bm_grew, 'bonemeal_per_bh': nan(bm_per_bh),
        'c5_bonemeal_no_growth': c5, 'c6_bonemeal_reserve': len(c6), 'tend_rows_with_inventory': inv_seen, 'tick_share': nan(tick_share),
        'farm_cells_foreign': sum(foreign.values()), 'scaffold_used': scaffold_used[0],
        'logs_per_bh_did': nan(did(logs_rate)), 'near_logs_per_bh_did': nan(did(near_rate)),
        'gather_distance_did': nan(did(med)), 'gather_secs_per_log_did': nan(did(spl)),
    })
except Exception as e:
    print('emit failed:', e)
