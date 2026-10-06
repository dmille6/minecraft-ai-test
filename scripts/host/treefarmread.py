#!/usr/bin/env python3
# treefarmread.py [window_min] -- the read for canary `treefarm-01` (branch bp-on-1918bb5: the blueprint builder + town tree farm).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: one tree farm per town (3x3 sapling plots 4 apart, 4 growth torches), founded and tended by a deterministic
# town order `tend_farm`: plant from the bag (birch first, then oak), restore lost soil, clear LEFTOVER logs from plot
# columns, place torches the bot carries; bone meal only with TREEFARM_BONEMEAL=on (OFF: not an owner decision yet).
# Ordinary `gather <log>` harvests the trees -- the farm never chops a standing tree. Every mutation is counted only when a
# SERVER block_change names the result at that cell. Rows: `_farm_tend` (one per visit, incl. no_effect skips; detail
# "gen=N planted=N soil=N cleared=N torches=N bonemeal=N failed=N offplan=N lost=N lease=gN|held:X [at=..] t0=ms stop=..
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
#                lost during a visit); C4 DOUBLE FOUNDING: more than one `_farm_site` row per pool without replaced=.
#   INSTRUMENT   control log gathers with a positive log delta (>= 20): the outcome this changes exists and is read.
#   EXPOSURE     >= 1 canary farm founded or tended with >= 9 confirmed plantings, AND the instrument.
#   PRIMARY      (REPORTED) logs gathered per bot-hour (gather rows' positive *_log inventory_delta), the same within 48 of
#                home, median distance from home of successful log gathers, gather seconds per log; each DiD vs the
#                same-length pre-window. Plus: farm census (plots holding a grown tree when visited), tend outcomes,
#                bone meal used (must be 0 with the arm off), canary bot-hours within 96 of home (the farm's random
#                ticks only fire while a player is that near: a farm nobody visits does not grow).
import sys, os, json, re, glob, statistics
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
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
TOWN = 48          # composter.mjs TOWN_RADIUS
TICK = 96          # simulation-distance 6 chunks on the fleet worlds
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
LOG = re.compile(r'_log$|_stem$')

rows_all = sorted(load_window(PRE, END), key=lambda r: r['t'])
H = homes()
print('rows walked %d  |  bots with a home %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows_all), len(H), CAN, CV, CUT.strftime('%H:%MZ'), W))
rows = Counter(); offbuild = 0
tends = defaultdict(list); places = []; sites = defaultdict(list)
c1 = []; c3 = []; bonemeal_used = 0; tend_status = Counter(); planted = 0; cleared = 0; torches = 0; soil = 0; grown_seen = []
gat = {(p, a): {'logs': 0, 'near': 0, 'secs': 0.0, 'dist': [], 'n': 0, 'pos': 0} for p in ('pre', 'post') for a in ('canary', 'control')}
seen_bots = defaultdict(set); near_rows = Counter(); all_rows = Counter()
for r in rows_all:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
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
            c3.append((b, 'lost=%s' % f.get('lost')))
        planted += num(f, 'planted'); cleared += num(f, 'cleared'); torches += num(f, 'torches'); soil += num(f, 'soil')
        bonemeal_used += num(f, 'bonemeal')
        cz = census(f.get('census'))
        if cz:
            grown_seen.append(cz.get('tree', 0))

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
tick_share = (sum(near_rows.values()) / sum(all_rows.values())) if sum(all_rows.values()) else float('nan')
print('-' * 78)
print('LIVENESS     canary farm rows %d (>= 1) | control %d (must be 0) | other build %d' % (rows['canary'], rows['control'], offbuild))
print('CORRECTNESS  C1 off-plan %d | C2 two builders %d | C3 items lost %d | C4 double founding %s | records on disk %d (unreadable pools %s)'
      % (len(c1), len(c2), len(c3), c4 or 0, nrec, unreadable or '-'))
print('INSTRUMENT   control log gathers with logs > 0: %d (>= 20)' % inst)
print('FARM         sites %d (replaced %s) | visits %s | planted %d cleared %d torches %d soil %d | bone meal used %d (arm off: 0) | trees seen at visit max %s'
      % (founded, replaced or 0, dict(tend_status), planted, cleared, torches, soil, bonemeal_used, max(grown_seen) if grown_seen else '-'))
print('TICKING      canary rows within %d of home: %.1f%% (a farm only grows while someone is that near)' % (TICK, 100 * tick_share))
print('PRIMARY      logs/bot-h canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f' % (logs_rate('pre', 'canary'), logs_rate('post', 'canary'), logs_rate('pre', 'control'), logs_rate('post', 'control'), did(logs_rate)))
print('             near-town logs/bot-h DiD %+.2f | median gather distance canary %.0f -> %.0f control %.0f -> %.0f DiD %+.1f | gather s/log DiD %+.1f'
      % (did(near_rate), med('pre', 'canary'), med('post', 'canary'), med('pre', 'control'), med('post', 'control'), did(med), did(spl)))
for x in (c1[:5] + c2[:3] + c3[:3]):
    print('  breach:', x)
nan = lambda v: None if v != v else round(v, 3)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('treefarmread', W, {
        'rows_canary': rows['canary'], 'rows_control': rows['control'], 'offbuild_canary': offbuild,
        'c1_offplan': len(c1), 'c2_two_builders': len(c2), 'c3_lost': len(c3), 'c4_double_founding': len(c4),
        'instrument_control': inst, 'exposure_ready': exposure, 'sites_founded': founded, 'planted': planted, 'cleared': cleared,
        'torches': torches, 'bonemeal_used': bonemeal_used, 'tick_share': nan(tick_share),
        'logs_per_bh_did': nan(did(logs_rate)), 'near_logs_per_bh_did': nan(did(near_rate)),
        'gather_distance_did': nan(did(med)), 'gather_secs_per_log_did': nan(did(spl)),
    })
except Exception as e:
    print('emit failed:', e)
