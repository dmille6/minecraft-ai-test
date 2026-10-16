#!/usr/bin/env python3
# plinth2read.py [window_min] -- the read for canary `plinth-02` (branch plinth02-on-623e92b). Run under `nice`.
# plinthread.py (plinth-01's read): every plinth-01 gate's LOGIC is unchanged; the caps they judge, the licence and exposure grew:
#   GATE CAPS          P3 (open pit), P4 (retired), P5 (stuck near) judge every cap from the canary's _plinth rows AND every
#                      cap this world's plinth records name (gate_caps: the record's plan cap in any state and its `prev`
#                      columns; version 1; the record's world = the pool's current world seen in the window). So a plinth
#                      finished under plinth-01 (board-c, hive-d) is judged though it writes no _plinth row now; P5 can also
#                      count a stuck episode near a column plinth-01 left (a raised well is a raised well, whoever built it).
#   EXPOSURE CAPS      stricter (recorded_caps): a record that is COMPLETE, whose pool's latest well-site generation names the
#                      same cap in the same world, that world affirmed by the window's rows. Exposure = a _well_built at a
#                      COMPLETE cap (per cap). The definition is unchanged.
#   LICENCE            canary `_plinth_mode` rows (once per spawn; they carry the world, w=) or `_plinth` rows -- the base
#                      writes neither; a control row of either is a leak.
#   MECHANISM          `_well_refused order=build reason=well_site` naming a crafting table (the fleet defect plinth-02
#                      fixes), per bot-hour, canary and control, pre and post (report only).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/plinth.mjs, skills.mjs build_plinth; design docs/reports/townground-2026-10-13.md section 3):
#   A town whose last junk-well site search found no cell (wellsite-01's junkwell-nosite record) PLANS a raised well once
#   (the unchanged oracle on the world with the plan applied; every step's support, stand and route proven offline), records
#   it (junkwell-plinth-<home>.json), and BUILDS it in bounded visits -- placements only (leaves in planned cells cleared),
#   one builder per town (a lease), from the bag's surplus stone above STONE_GUARD and a pit cover, else a town chest's.
#   The finished plinth's cap becomes the town's well site; build_well floors and caps it as at any site.
#   Rows: _plinth (stage=planned|none|build|complete|<failClass>), _plinth_step (one per step: op, at, step, id, alt),
#   _well_pit_dug from=plinth|plinth_resume|plinth_cover, _well_pit_covered stage=plinth, _well_pit_open stage=plinth.
#
#   LICENCE      canary _plinth_mode or _plinth rows (the base never writes either kind).
#   POPULATION   a canary town with NO junk well (draw_exposure: no_site rows); control towns without a well are the DiD's
#                comparison (towns with a well are an instrument control only).
#   GATES (defect)
#     P1 breach_outside_shell   a canary _plinth_step op=place whose cell is neither in the 81-cell shell of ITS OWN plan's
#                               cap (the step's id=, mapped by the _plinth rows) nor on its stair lines (a cardinal from
#                               the cap, 3..6 out, lateral -1..1, below g-1).
#     P2 breach_reserve         a canary _plinth build/complete row with placed>0 whose bag (the row's inventory) holds
#                               fewer than 64 RESERVE_STONE (cobblestone, cobbled_deepslate, andesite, diorite, granite).
#     P3 breach_pit_open_10m    a canary plinth pit (the last pit event at a plinth cap is dug/open, not covered/built)
#                               older than 10 min at the read's end -- an uncovered walled-in column nobody covered.
#     P4 breach_retired_plinth  a _well_retired at a canary plinth's cap (a raised well that did not hold).
#     P5 breach_stuck_plinth    > 1 canary stuck EPISODE (entombed / stranded_escape_try / livelock_escape, one per bot per
#                               10 min; _result rows never) with the body within 3 (horizontal Chebyshev, |dy| <= 5) of a
#                               plinth cap.
#     P6 control_plinth_rows    a CONTROL _plinth row (the control is not running the base). Blocks KEEP.
#   INSTRUMENT   the same row selectors on fixture rows (self-tests below, run every read); control no_site rows post >= 1.
#   PRIMARY      canary towns: planned / complete, blocks placed, alt stands, retries, step pace; _well_built at a plinth
#                cap; dispose_well successes per bot-hour DiD against control towns WITHOUT a well (report only).
#   EXPOSURE     a canary plinth complete AND a _well_built at its cap, in a window >= 180 min (caps from rows AND records).
import sys, os, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

RESERVE = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite')   # well.mjs RESERVE_STONE
STONE_GUARD = 64
PIT_OPEN_MAX = dt.timedelta(minutes=10)
MAX_RAISE = 4                                                                        # plinth.mjs PLINTH_MAX_RAISE


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def xyz(s):
    try:
        a = [int(v) for v in (s or '').split(',')]
        return tuple(a) if len(a) == 3 else None
    except ValueError:
        return None


def in_shell(cap, c):
    """PURE. plinth.mjs plinthShell: g 3x3 minus the cap; g-1 5x5 minus the shaft; g-2 5x5 (floor included); g-3 5x5 minus
    the centre."""
    dx, dy, dz = c[0] - cap[0], c[1] - cap[1], c[2] - cap[2]
    r = max(abs(dx), abs(dz))
    if dy == 0:
        return r == 1
    if dy == -1 or dy == -3:
        return 1 <= r <= 2
    if dy == -2:
        return r <= 2
    return False


def on_stair_line(cap, c):
    """PURE. plinth.mjs stairOptions: from the ledge outward along a cardinal, 3..2+MAX_RAISE out, lateral -1..1, every
    cell below g-1 (a step's top is g-1-j)."""
    dx, dy, dz = c[0] - cap[0], c[1] - cap[1], c[2] - cap[2]
    if dy > -2:
        return False
    along, lat = (abs(dx), dz) if abs(dx) >= 3 else (abs(dz), dx)
    return 3 <= along <= 2 + MAX_RAISE and abs(lat) <= 1


def reserve_of(inv):
    return sum(int(inv.get(n, 0) or 0) for n in RESERVE)


def pit_open(events, end):
    """PURE. events: [(t, cap, kind)] kind in dug|open|covered|built. -> [cap] whose LAST event is dug/open and older than
    PIT_OPEN_MAX at `end` (a resume's dug restarts the clock, a cover or a built well ends it)."""
    last = {}
    for t, cap, kind in sorted(events, key=lambda e: e[0]):
        last[cap] = (t, kind)
    return [cap for cap, (t, kind) in last.items() if kind in ('dug', 'open') and end - t > PIT_OPEN_MAX]


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def outside_steps(steps, id_cap):
    """PURE. steps: [(bot, t, fields)] _plinth_step rows; id_cap: {plan id: cap} from the _plinth rows (planned/build/
    complete carry both id= and at=). -> [(bot, t, at)] placements outside THEIR OWN plan's shell and stair lines (Claude r3
    P2-1: a replan to a nearby cap must not judge the old plan's cells against the new cap). A step whose id names no
    known cap is judged against nothing and counted: the instrument must see its own plan."""
    out = []
    for b, t, f in steps:
        if f.get('op') != 'place':
            continue
        c = xyz(f.get('at')); cap = id_cap.get(f.get('id'))
        if not c or not cap or not (in_shell(cap, c) or on_stair_line(cap, c)):
            out.append((b, t, f.get('at')))
    return out


EPISODE = dt.timedelta(minutes=10)


def stuck_episodes(rows):
    """PURE. rows: [(bot, t, kind, pos)] stuck-family rows. -> [(bot, t, pos)], one per (bot, 10-min episode) (Claude r3
    P2-2: reflex.mjs writes _stranded_escape_try AND _result per attempt, and an entombment repeats its row; one episode is
    one event, so the gate's 'more than one' means two episodes). _stranded_escape_result is never counted."""
    out, last = [], {}
    for b, t, k, pos in sorted(rows, key=lambda r: r[1]):
        if k == 'stranded_escape_result':
            continue
        if b in last and t - last[b] < EPISODE:
            continue
        last[b] = t
        out.append((b, t, pos))
    return out


# ---- self-tests on the bot's own row strings (skills.mjs plinthDetail / the step row / the pit rows) ----
_CAP = (100, 70, 100)
assert in_shell(_CAP, (101, 70, 100)) and in_shell(_CAP, (102, 69, 100)) and in_shell(_CAP, (100, 68, 100)) and in_shell(_CAP, (98, 67, 98))
assert not in_shell(_CAP, (100, 70, 100)) and not in_shell(_CAP, (100, 69, 100)) and not in_shell(_CAP, (102, 70, 100)) and not in_shell(_CAP, (100, 67, 100))
assert not in_shell(_CAP, (103, 69, 100)) and not in_shell(_CAP, (100, 71, 100))
assert on_stair_line(_CAP, (103, 68, 100)) and on_stair_line(_CAP, (100, 67, 104)) and on_stair_line(_CAP, (104, 66, 101))
assert not on_stair_line(_CAP, (103, 69, 100)), 'a step top is at most g-2'
assert not on_stair_line(_CAP, (110, 66, 100)) and not on_stair_line(_CAP, (104, 66, 104)), 'off the line'
_STEP = 'op=place at=101,70,100 step=12 id=board-a-Alpha-x1-ab12 stand=103,71,100 alt=0 block=cobblestone'
assert xyz(kv(_STEP)['at']) == (101, 70, 100) and kv(_STEP)['op'] == 'place' and kv(_STEP)['alt'] == '0'
_ROW = 'stage=build at=100,70,100 k=3 placed=12 cleared=0 alt=1 retries=0 done=40/60 left=20 budget=50 took=0 hazard=0 id=x'
assert kv(_ROW)['stage'] == 'build' and kv(_ROW)['placed'] == '12' and xyz(kv(_ROW)['at']) == _CAP
assert reserve_of({'cobblestone': 60, 'andesite': 4, 'dirt': 9}) == 64
_T = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)
_m = lambda n: _T + dt.timedelta(minutes=n)
assert pit_open([(_m(0), _CAP, 'dug')], _m(11)) == [_CAP], 'an uncovered pit older than 10 min'
assert pit_open([(_m(0), _CAP, 'dug')], _m(9)) == [], 'not yet'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(1), _CAP, 'covered')], _m(30)) == [], 'covered'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(1), _CAP, 'covered'), (_m(5), _CAP, 'dug')], _m(30)) == [_CAP], 'a resume re-opens it'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(2), _CAP, 'built')], _m(30)) == [], 'a built well closes it'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(0), _CAP, 'covered')], _m(30)) == [], 'owned but never opened: the by=closed row closes it (Claude r2 P2-B)'
_OLD, _NEW = (100, 70, 100), (103, 70, 100)
_ids = {'a': _OLD, 'b': _NEW}
assert outside_steps([('x', _T, kv('op=place at=101,69,100 id=a'))], _ids) == [], 'judged against its own plan'
assert outside_steps([('x', _T, kv('op=place at=98,69,100 id=a'))], _ids) == [], 'a g-1 ring cell of the old plan'
assert outside_steps([('x', _T, kv('op=place at=98,69,100 id=b'))], _ids) == [('x', _T, '98,69,100')], 'the same cell is outside the NEW plan (the false trip r3 found)'
assert outside_steps([('x', _T, kv('op=place at=110,69,100 id=a'))], _ids) == [('x', _T, '110,69,100')], 'positive control: a real outside placement'
assert outside_steps([('x', _T, kv('op=place at=101,69,100 id=zz'))], _ids) == [('x', _T, '101,69,100')], 'an unknown plan id is counted, never trusted'
assert outside_steps([('x', _T, kv('op=clear at=110,69,100 id=a'))], _ids) == [], 'clears are not placements'
_ep = [('b1', _m(0), 'stranded_escape_try', (1, 2, 3)), ('b1', _m(0), 'stranded_escape_result', (1, 2, 3)), ('b1', _m(3), 'entombed', (1, 2, 3)),
       ('b1', _m(12), 'entombed', (1, 2, 3)), ('b2', _m(1), 'livelock_escape', (1, 2, 3))]
assert [(b, t) for b, t, _p in stuck_episodes(_ep)] == [('b1', _m(0)), ('b2', _m(1)), ('b1', _m(12))], 'one per bot and 10 min; results never'

STATE_DIR = '/var/lib/mcai'


PLINTH_VERSION = 1                                                                   # plinth.mjs PLINTH_VERSION


def _latest_site(state_dir, pool, home):
    """The pool's current well-site record for a home key (the highest generation), or None."""
    import glob, json
    best = None
    for f in glob.glob('%s/_pool-%s/junkwell-site-%s.g*.json' % (state_dir, pool, home)):
        m = re.search(r'\.g(\d+)\.json$', f)
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), f)
    if not best:
        return None
    try:
        return json.load(open(best[1]))
    except Exception:
        return None


def recorded_caps(pools, state_dir=STATE_DIR, worlds=None):
    """{cap (x,y,z): pool} for every COMPLETE plinth of THIS world in the given pools' records (Codex r3 P2 x2):
       - the record is version PLINTH_VERSION and state 'complete' (a plan or a void is not a finished plinth);
       - the pool's LATEST well-site generation for the same home names the same cap and the same world (the hand-off wrote
         both; a site moved since, or a record from another world, does not count);
       - `worlds` {pool: the CURRENT world, from this window's rows (w=: the canary's _plinth_mode licence rows, the no_site
         rows)}: AFFIRMATIVE identity is required (Codex r4 P2) -- a pool with no world seen counts no record, and a record of
         another world does not count."""
    import glob, json
    out = {}
    for pool in sorted(pools):
        for f in sorted(glob.glob('%s/_pool-%s/junkwell-plinth-*.json' % (state_dir, pool))):
            if '.lease.' in f:
                continue
            m = re.search(r'junkwell-plinth-(.+)\.json$', f)
            try:
                rec = json.load(open(f))
            except Exception:
                continue
            if not isinstance(rec, dict) or rec.get('v') != PLINTH_VERSION or rec.get('state') != 'complete':
                continue
            cap = (rec.get('plan') or {}).get('cap') or {}
            if not all(k in cap for k in 'xyz'):
                continue
            site = _latest_site(state_dir, pool, m.group(1)) if m else None
            if not site or (site.get('x'), site.get('y'), site.get('z')) != (cap['x'], cap['y'], cap['z']):
                continue
            world = str(rec.get('world') or '')
            if str(site.get('world') or '') != world:
                continue
            seen = (worlds or {}).get(pool)
            if not seen or not world or not world.startswith(seen):
                continue
            out[(int(cap['x']), int(cap['y']), int(cap['z']))] = pool
    return out


def gate_caps(pools, state_dir=STATE_DIR, worlds=None):
    """{cap (x,y,z): pool} for the GATES (Codex r5 P2): every plinth cap this world's records name -- the record's own plan cap
       (plan, complete, void or none alike) and every column the town ever started (`prev`) -- so a plinth finished before the
       window that is breached, entombs a bot or is left open is judged even after its site moved. Identity: version
       PLINTH_VERSION and the record's world = the pool's CURRENT world seen in this window's rows (affirmative, as for
       recorded_caps). The site record is NOT consulted here: a moved site is exactly when a breach matters."""
    import glob, json
    out = {}
    for pool in sorted(pools):
        seen = (worlds or {}).get(pool)
        if not seen:
            continue
        for f in sorted(glob.glob('%s/_pool-%s/junkwell-plinth-*.json' % (state_dir, pool))):
            if '.lease.' in f:
                continue
            try:
                rec = json.load(open(f))
            except Exception:
                continue
            if not isinstance(rec, dict) or rec.get('v') != PLINTH_VERSION:
                continue
            world = str(rec.get('world') or '')
            if not world or not world.startswith(seen):
                continue
            cells = [(rec.get('plan') or {}).get('cap') or {}] + [c for c in (rec.get('prev') or []) if isinstance(c, dict)]
            for c in cells:
                if all(k in c for k in 'xyz'):
                    out[(int(c['x']), int(c['y']), int(c['z']))] = pool
    return out


TABLE_REFUSAL = re.compile(r'^order=build reason=well_site .*crafting table')


def _selftest_records():
    import tempfile, json
    d = tempfile.mkdtemp()
    for pool in ('board-c', 'hive-a', 'hive-d', 'isolated-a'):
        os.makedirs('%s/_pool-%s' % (d, pool))
    W1 = '-1909043226:-504800724'
    def put(pool, name, obj):
        json.dump(obj, open('%s/_pool-%s/%s' % (d, pool, name), 'w'))
    put('board-c', 'junkwell-plinth-355_73_147.json', {'v': 1, 'state': 'complete', 'world': W1, 'plan': {'cap': {'x': 365, 'y': 73, 'z': 137}}})
    put('board-c', 'junkwell-plinth-355_73_147.lease.g8.json', {'by': 'x', 'until': 1})
    put('board-c', 'junkwell-site-355_73_147.g1.json', {'x': 365, 'y': 73, 'z': 137, 'world': W1})
    # a plan, not a finished plinth (Codex r3 P2-2)
    put('hive-a', 'junkwell-plinth-0_0_0.json', {'v': 1, 'state': 'plan', 'world': 'w', 'plan': {'cap': {'x': 1, 'y': 2, 'z': 3}}})
    put('hive-a', 'junkwell-site-0_0_0.g1.json', {'x': 1, 'y': 2, 'z': 3, 'world': 'w'})
    # a record whose site has MOVED since (g2 names another cap)
    put('hive-d', 'junkwell-plinth-68_65_68.json', {'v': 1, 'state': 'complete', 'world': 'w2', 'plan': {'cap': {'x': 56, 'y': 64, 'z': 69}}})
    put('hive-d', 'junkwell-site-68_65_68.g1.json', {'x': 56, 'y': 64, 'z': 69, 'world': 'w2'})
    put('hive-d', 'junkwell-site-68_65_68.g2.json', {'x': 79, 'y': 57, 'z': 76, 'world': 'w2'})
    # an earlier world's record and site (Codex r3 P2-1), and a wrong version
    put('isolated-a', 'junkwell-plinth-1_1_1.json', {'v': 1, 'state': 'complete', 'world': 'old', 'plan': {'cap': {'x': 9, 'y': 9, 'z': 9}}})
    put('isolated-a', 'junkwell-site-1_1_1.g1.json', {'x': 9, 'y': 9, 'z': 9, 'world': 'old'})
    ALL = {'board-c': W1[:40], 'hive-a': 'w', 'hive-d': 'w2', 'isolated-a': 'old'}
    assert recorded_caps({'board-c', 'hive-a', 'hive-d'}, d, worlds=ALL) == {(365, 73, 137): 'board-c'}, 'complete + same-cap latest site only'
    assert recorded_caps({'isolated-a'}, d, worlds=ALL) == {(9, 9, 9): 'isolated-a'}, 'POSITIVE CONTROL: the world seen -> the consistent record counts'
    assert recorded_caps({'isolated-a'}, d) == {}, 'no world seen in the window -> no record counts (affirmative identity, Codex r4 P2)'
    assert recorded_caps({'isolated-a'}, d, worlds={'isolated-a': 'new'}) == {}, 'a row of the window names another world'
    assert recorded_caps({'board-c'}, d, worlds={'board-c': W1[:40]}) == {(365, 73, 137): 'board-c'}, 'the same world (w= is cut at 40)'
    put('isolated-a', 'junkwell-plinth-1_1_1.json', {'v': 2, 'state': 'complete', 'world': 'old', 'plan': {'cap': {'x': 9, 'y': 9, 'z': 9}}})
    assert recorded_caps({'isolated-a'}, d, worlds=ALL) == {}, 'another version'
    put('board-c', 'junkwell-site-355_73_147.g1.json', {'x': 365, 'y': 73, 'z': 137, 'world': 'other'})
    assert recorded_caps({'board-c'}, d, worlds=ALL) == {}, 'the site names another world'
    assert recorded_caps({'board-c'}, d + '/nowhere', worlds=ALL) == {}, 'no dir, no caps'
    # THE GATES' CAPS (Codex r5 P2): hive-d's plinth whose site MOVED (g2) is not exposure, but its cap and its prev columns are
    # still judged; a plan is judged too; another world, or no world seen, is not
    put('hive-d', 'junkwell-plinth-68_65_68.json', {'v': 1, 'state': 'complete', 'world': 'w2', 'plan': {'cap': {'x': 56, 'y': 64, 'z': 69}},
                                                   'prev': [{'x': 40, 'y': 60, 'z': 40, 'stair': []}]})
    assert recorded_caps({'hive-d'}, d, worlds=ALL) == {}, 'not exposure: the site moved'
    assert gate_caps({'hive-d'}, d, worlds=ALL) == {(56, 64, 69): 'hive-d', (40, 60, 40): 'hive-d'}, 'judged: the cap and its prev'
    assert gate_caps({'hive-a'}, d, worlds=ALL) == {(1, 2, 3): 'hive-a'}, 'a plan is judged'
    assert gate_caps({'hive-d'}, d, worlds={'hive-d': 'w9'}) == {}, 'another world'
    assert gate_caps({'hive-d'}, d) == {}, 'no world seen'
    assert TABLE_REFUSAL.match("order=build reason=well_site nowhere within 2 of the junk well's standing cell to put a crafting table")
    assert TABLE_REFUSAL.match("order=build reason=well_site nowhere within reach of the junk well's standing cell to put a crafting table; carry 2")
    assert not TABLE_REFUSAL.match('order=build reason=well_site the junk well site 1,2,3 is no longer valid (walls)')
    assert WORLD_OF.search('order=build reason=no_site tally=cols:672 rec=ok w=-1683219219:11596751 the town').group(1) == '-1683219219:11596751'
    assert WORLD_OF.search('phase=mode v=2 table=below_stand w=-1909043226:-504800724').group(1) == '-1909043226:-504800724', 'the licence row'


WORLD_OF = re.compile(r'(?:^| )w=(\S+)')


_selftest_records()

if __name__ == '__main__':
    import json
    from lib.telemetry import Events
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

    def load_window(since, until):
        """Rotation-aware (wellread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z rotation."""
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        import glob as _glob
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                e2 = Events.load(paths=g, since=since, until=until)
                for r in e2.rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); rows = Counter(); offbuild = 0; n = Counter()
    caps = {}                                       # canary plinth cap -> pool
    id_cap = {}                                     # plan id -> its cap (the _plinth rows carry both)
    steps = []; reserve_breach = []; pit_events = []; retired = []; stuck = []; leak = 0
    no_well_pre = defaultdict(int); well_pre = defaultdict(int); disposed = Counter()
    plinth_rows = defaultdict(list); step_ts = defaultdict(list); built_at = set(); world_seen = {}
    for r in ev_rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        raw = r.get('raw') or {}
        ver = ((raw.get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); rows[(period, arm)] += 1
        k = (r.get('name') or '').lstrip('_'); d = r.get('detail') or ''; f = kv(d)
        if k == 'well_refused' and d.startswith('order=build ') and (f.get('reason') or '').startswith('no_site'):
            n[(period, arm, 'no_site')] += 1
            if period == 'pre':
                no_well_pre[pool_of(b)] += 1
        if k in ('well_refused', 'plinth_mode'):
            mw = WORLD_OF.search(d)
            if mw and mw.group(1) not in ('-', ''):
                world_seen[pool_of(b)] = mw.group(1)
        if k == 'well_refused' and TABLE_REFUSAL.match(d):
            n[(period, arm, 'table_refused')] += 1
        if k == 'plinth_mode' and period == 'post':
            if arm == 'control':
                leak += 1
            else:
                n[('post', 'canary', 'licence_mode')] += 1
        if k == 'dispose_well' and ((raw.get('skill') or {}).get('status') == 'success'):
            n[(period, arm, 'dispose_success')] += 1
            if period == 'pre':
                well_pre[pool_of(b)] += 1
            if period == 'post' and arm == 'canary':
                disposed[pool_of(b)] += 1
        if period != 'post':
            continue
        if k == 'plinth':
            if arm == 'control':
                leak += 1
                continue
            n[('post', 'canary', 'licence')] += 1
            st = f.get('stage'); cap = xyz(f.get('at'))
            if cap:
                caps[cap] = pool_of(b)
                if f.get('id'):
                    id_cap[f.get('id')] = cap
            plinth_rows[pool_of(b)].append((t, st, f))
            n[('post', 'canary', 'stage_' + str(st))] += 1
            if st in ('build', 'complete') and int(f.get('placed', '0') or 0) > 0:
                inv = ((raw.get('bot') or {}).get('inventory') or {})
                if reserve_of(inv) < STONE_GUARD:
                    reserve_breach.append((b, t.strftime('%H:%M:%S'), reserve_of(inv)))
        elif k == 'plinth_step' and arm == 'canary':
            steps.append((b, t, f))
            step_ts[f.get('id')].append(t)
        elif k in ('well_pit_dug', 'well_pit_open', 'well_pit_covered', 'well_built') and arm == 'canary':
            at = xyz(f.get('at'))
            kind = {'well_pit_dug': 'dug', 'well_pit_open': 'open', 'well_pit_covered': 'covered', 'well_built': 'built'}[k]
            if at:
                pit_events.append((t, at, kind))
                if k == 'well_built':
                    built_at.add(at)
        elif k == 'well_retired':
            at = xyz(f.get('at'))
            if at:
                retired.append((b, t, at))
        elif k in ('entombed', 'livelock_escape', 'stranded_escape_try', 'stranded_escape_result'):
            p = ((raw.get('bot') or {}).get('pos') or {})
            if arm == 'canary' and 'x' in p:
                stuck.append((b, t, k, (p['x'], p['y'], p['z'])))
            n[('post', arm, 'stuck_any')] += 1

    rec_caps = recorded_caps(CANS, worlds=world_seen)            # EXPOSURE: complete, the latest site naming it
    for c, pool in list(rec_caps.items()) + list(gate_caps(CANS, worlds=world_seen).items()):   # GATES: every recorded cap
        caps.setdefault(c, pool)
    outside = [(b, t.strftime('%H:%M:%S'), at) for b, t, at in outside_steps(steps, id_cap)]
    plinth_caps = set(caps)
    pit_events = [e for e in pit_events if e[1] in plinth_caps]
    open_pits = pit_open(pit_events, END)
    retired_p = [x for x in retired if x[2] in plinth_caps]
    near = lambda p, cap: max(abs(p[0] - cap[0] - 0.5), abs(p[2] - cap[2] - 0.5)) <= 3.5 and abs(p[1] - cap[1]) <= 5
    stuck_p = [(b, t.strftime('%H:%M'), p) for b, t, p in stuck_episodes([x for x in stuck if any(near(x[3], c) for c in plinth_caps)])]
    # COMPLETE PER CAP (Codex r3 P2-2): a cap is complete when its own complete row names it, or its record is complete
    complete_caps = {c for c in caps if c in rec_caps or any(st == 'complete' and xyz(f.get('at')) == c for _t, st, f in plinth_rows[caps[c]])}
    complete = {caps[c] for c in complete_caps}
    built_plinths = [c for c in complete_caps if c in built_at]   # exposure: a COMPLETE plinth's own cap

    hours = W / 60.0
    nowell_ctl = {p for p in no_well_pre if p not in CANS and well_pre.get(p, 0) == 0}
    def rate(period, arm, what, pools=None):
        bs = [x for x in bots[(period, arm)] if pools is None or pool_of(x) in pools]
        return (n[(period, arm, what)] / (len(bs) * hours)) if bs and hours else float('nan')
    alt = sum(1 for _b, _t, f in steps if f.get('alt') == '1')
    paces = []
    for _id, ts in step_ts.items():
        ts.sort(); paces += [(b - a).total_seconds() for a, b in zip(ts, ts[1:]) if (b - a).total_seconds() < 120]
    paces.sort()
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots post canary %d control %d  |  offbuild canary rows %d'
          % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     licence (canary _plinth_mode rows %d, _plinth rows %d) | stages %s | steps %d (alt stands %d) | plinth caps %s (from records %s)'
          % (n[('post', 'canary', 'licence_mode')], n[('post', 'canary', 'licence')], {k[2][6:]: v for k, v in n.items() if k[2].startswith('stage_')}, len(steps), alt, sorted(caps), sorted(rec_caps)))
    print('MECHANISM    build refusals for want of a table cell per bot-h: canary %.3f -> %.3f | control %.3f -> %.3f (report only)'
          % (rate('pre', 'canary', 'table_refused'), rate('post', 'canary', 'table_refused'), rate('pre', 'control', 'table_refused'), rate('post', 'control', 'table_refused')))
    print('P1 (gate)    placements outside the shell / a stair line: %d %s' % (len(outside), outside[:3]))
    print('P2 (gate)    build rows that left the bag under %d reserve stone: %d %s' % (STONE_GUARD, len(reserve_breach), reserve_breach[:3]))
    print('P3 (gate)    plinth pits uncovered > 10 min at the read end: %d %s | pit events %d' % (len(open_pits), open_pits[:3], len(pit_events)))
    print('P4 (gate)    _well_retired at a plinth cap: %d' % len(retired_p))
    print('P5 (gate>1)  stuck/entombed rows within 3 of a plinth: %d %s | INSTRUMENT the same rows anywhere: canary %d control %d'
          % (len(stuck_p), stuck_p[:3], n[('post', 'canary', 'stuck_any')], n[('post', 'control', 'stuck_any')]))
    print('P6 (leak)    control _plinth/_plinth_mode rows: %d' % leak)
    print('INSTRUMENT   control no_site rows post %d (>= 1: no-well towns exist and the query sees them) | control towns without a well (pre) %s'
          % (n[('post', 'control', 'no_site')], sorted(nowell_ctl)))
    print('PRIMARY      canary towns complete %s | plinth caps with a built well %s | step pace s p50 %s p90 %s'
          % (sorted(complete), built_plinths, paces[len(paces) // 2] if paces else '-', paces[int(len(paces) * 0.9)] if paces else '-'))
    print('             dispose_well successes per bot-h: canary %.3f -> %.3f | control no-well towns %.3f -> %.3f | by canary town %s'
          % (rate('pre', 'canary', 'dispose_success'), rate('post', 'canary', 'dispose_success'),
             rate('pre', 'control', 'dispose_success', nowell_ctl), rate('post', 'control', 'dispose_success', nowell_ctl), dict(disposed)))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        d_can = rate('post', 'canary', 'dispose_success') - rate('pre', 'canary', 'dispose_success')
        d_ctl = rate('post', 'control', 'dispose_success', nowell_ctl) - rate('pre', 'control', 'dispose_success', nowell_ctl)
        emit('plinth2read', W, {
            'rows_canary': rows[('post', 'canary')], 'rows_control': rows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n[('post', 'canary', 'licence')] + n[('post', 'canary', 'licence_mode')], 'licence_mode_rows': n[('post', 'canary', 'licence_mode')],
            'recorded_plinths': len(rec_caps), 'table_refused_canary_post': n[('post', 'canary', 'table_refused')],
            'steps_canary': len(steps), 'alt_steps': alt,
            'planned_canary': n[('post', 'canary', 'stage_planned')], 'complete_towns': len(complete), 'built_plinths': len(built_plinths),
            'breach_outside_shell': len(outside), 'breach_reserve': len(reserve_breach), 'breach_pit_open_10m': len(open_pits),
            'breach_retired_plinth': len(retired_p), 'breach_stuck_plinth': len(stuck_p), 'control_plinth_rows': leak,
            'instrument_control': n[('post', 'control', 'no_site')],
            'dispose_rate_did': nanless(d_can - d_ctl), 'dispose_success_canary': sum(disposed.values()),
            'exposure_ready': int(len(built_plinths) >= 1 and W >= 180),
        })
    except Exception as e:
        print('emit failed:', e)
