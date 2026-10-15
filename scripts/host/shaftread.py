#!/usr/bin/env python3
# shaftread.py [window_min] -- the read for canary `shaft-01` (ziggurat stage 5: the shared mineshaft, BUILD ONLY;
# docs/reports/ziggurat-mineshaft-2026-10-15.md 4.6; plan r2 in the stage-5 review record). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: near its world's collar a bot with a pickaxe, stone above the reserve and ladders (held or craftable) is ORDERED
#   (cognitive shaftOrder, after the monument, before the junk well) to build the shared mineshaft one level at a time
#   (dig_shaft: verify -> ride down -> the pure planner's ops -> climb out -> cap). Reserved cells are kept out of EVERY dig
#   by a bot with a verified ladder exit (the dig chokepoint), of every path (T10), and the movement reflexes stand down in
#   the shaft while it has a way out (the bounded hold); a bot in the shaft is ordered shaft_exit first.
#
#   LICENCE   kind `_shaft` (the base cannot write it).
#   GATES     (canary arm, post)
#     S1 lost_unexplained   a missing ladder/lining/open cell in a BUILT level (audit or visit verification) that no
#                           `_shaft_absorbed` row in the window accounts for (a survival dig by a bot with no exit is
#                           absorbed by design); defect. Absorbed cells are reported.
#     S3 wet                liquid found in a built level's lining (audit or visit); defect
#     S4 deaths_in_shaft    a death whose position is inside the recorded shaft box AT OR ABOVE the built frontier (minus one);
#                           defect (mechanism-linked), with every canary death as its positive control
#     S5 guard_misfire      a kind=shaft refusal whose REFUSED CELL lies outside the recorded box; defect (refusals inside
#                           are the control)
#     S8 absorbed_inside    a dig of a reserved cell absorbed while the digger stood INSIDE the envelope (its hold had released:
#                           two failed climbs, or no verified exit); defect at 1
#     S7 held_long          a bot held in the shaft (`_shaft_hold`, one a minute) for > 3 min in one run; defect
#     S6 stuck_near         still runs >= 10 min within 8 of the collar, the builders' dig_shaft time excluded, per bot on
#                           measured exposure, as a DiD against the control pools at their M0 collars; blocks KEEP
#     LEAK                  control `_shaft*` rows post; blocks KEEP
#   EXPOSURE  >= 20 verified levels (or complete) in a window >= 150 min; a stop before 20 levels = INCONCLUSIVE.
#   REPORTED  levels built per pool-hour, visits and their stops, ladders crafted/placed, lining placed, absorbed digs,
#             exits and failed exits, audits (cells checked / unloaded; ladders found vs 2 x levels: the positive control).
import sys, os, json, re, math
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

# the M0 collars (bots/src/shaftjob.mjs SHAFT_SITES) -- for S6's control arm only; the canary's own box comes from its rows
SITES = {'board-a': ((374, 166), 'e', 69), 'board-b': ((-263, 126), 'n', 64), 'board-c': ((368, 167), 's', 69),
         'board-d': ((376, 138), 'e', 68), 'hive-a': ((374, 165), 'e', 72), 'hive-b': ((373, 167), 's', 70),
         'hive-c': ((-85, -65), 'w', 63), 'hive-d': ((56, 50), 'n', 64), 'placebo-a': ((228, -146), 'w', 72),
         'placebo-b': ((261, -406), 'w', 64), 'placebo-c': ((365, 126), 'n', 71), 'placebo-d': ((158, 79), 'w', 76)}


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def kv(detail):
    out = {}
    for part in str(detail or '').split(' '):
        if '=' in part:
            k, v = part.split('=', 1)
            out[k] = v
    return out


def to_local(origin, away, x, z):
    """PURE. World (x, z) -> shaft-local (u, v) (shaftindex.mjs toLocal)."""
    dx, dz = x - origin[0], z - origin[1]
    return {'s': (dx, dz), 'n': (-dx, -dz), 'e': (-dz, dx), 'w': (dz, -dx)}[away]


def in_box(site, x, y, z, bottom=16):
    """PURE. Is a world cell inside the shaft's box -- the envelope AND its lining: u -2..3 (the rooms' side walls), v -2..9
    (the pad side to the stub end), y bottom-1..c+2 (Codex code r1 P2: the landing walls are reserved too)?"""
    if not site:
        return False
    (origin, away, c) = site
    u, v = to_local(origin, away, math.floor(x), math.floor(z))
    return -2 <= u <= 3 and -2 <= v <= 9 and bottom - 1 <= math.floor(y) <= c + 2


def near_collar(site, pos, r=8):
    if not site or not pos:
        return False
    (origin, away, c) = site
    return max(abs(pos['x'] - origin[0]), abs(pos['z'] - origin[1])) <= r


def still_runs(samples, site, min_s=600, move=2.0):
    """PURE. [(t, pos, excluded)] time-sorted -> lengths of still runs (>= min_s) within 8 of the collar; an excluded sample
    (the builder's own dig_shaft time) or leaving the collar ends a run; a move of >= move restarts it."""
    out, anchor, last = [], None, None
    def close():
        if anchor is not None and last is not None and last[0] - anchor[0] >= min_s:
            out.append(last[0] - anchor[0])
    for s in samples:
        t, p, excl = s
        if excl or not near_collar(site, p):
            close(); anchor = None; last = None
            continue
        if anchor is None or abs(p['x'] - anchor[1]['x']) >= move or abs(p['z'] - anchor[1]['z']) >= move:
            close(); anchor = s
        last = s
    close()
    return out


def held_runs(times, gap_s=90):
    """PURE. sorted `_shaft_hold` times of one bot -> the length (s) of each run of rows no more than gap_s apart."""
    out, start, prev = [], None, None
    for t in times:
        if start is None or t - prev > gap_s:
            if start is not None:
                out.append(prev - start)
            start = t
        prev = t
    if start is not None:
        out.append(prev - start)
    return out


def unexplained(missing_cells, absorbed_cells):
    """PURE. Lost cells not accounted for by an absorbed (permitted) dig."""
    return sorted(set(missing_cells) - set(absorbed_cells))


# self-tests (pure)
assert to_local((0, 0), 'e', 0, 1) == (-1, 0) and to_local((0, 0), 'w', -2, 0) == (0, 2)
_site = ((100, 200), 's', 70)
assert in_box(_site, 100.5, 40, 200.5) and in_box(_site, 99, 70, 199) and in_box(_site, 98, 40, 203) and not in_box(_site, 104, 40, 200) and not in_box(_site, 100, 73, 200)
assert in_box(_site, 101, 50, 209) and not in_box(_site, 101, 50, 210), 'the stub end face (v=9) is in the box, v=10 is not'
_s = [(i * 60, {'x': 101.0, 'z': 201.0}, False) for i in range(15)]
assert still_runs(_s, _site) == [840]
assert still_runs([(t, p, i == 7) for i, (t, p, _) in enumerate(_s)], _site) == [], 'the builder\'s own time cuts the run'
assert held_runs([0, 60, 120, 180, 240, 1000, 1060]) == [240, 60]
assert unexplained(['1,2,3', '4,5,6'], ['4,5,6']) == ['1,2,3']
assert in_box(_site, 100, 29, 200, 30) and not in_box(_site, 100, 28, 200, 30), 'frontier 30: y=29 (the floor under it) in, y=28 out'

if __name__ == '__main__':
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
    PRE = CUT - dt.timedelta(minutes=min(W, 180))

    def load_window(since, until):
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
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    # THE CANARY'S SITES FIRST (Codex code r1 P2: a refusal before the first audit row must not read as outside a box not yet seen)
    sites, bottoms, frontier_pre = {}, {}, {}
    frontier_seen = defaultdict(list)   # pool -> [(t, frontier)] in time order (Codex code r3 P2: no future evidence)
    for r in rows:
        b0 = (r.get('bot') or {}).get('name') or ''
        k0 = (r.get('name') or '').lstrip('_')
        if pool_of(b0) not in CANS or k0 not in ('shaft_site', 'shaft_audit', 'shaft'):
            continue
        sk0 = (r.get('raw') or {}).get('skill') or {}
        f0 = dict(kv(r.get('detail') or sk0.get('detail')), **{kk: str(vv) for kk, vv in (sk0.get('args') or {}).items()})
        try:
            ox, oz = [int(x) for x in f0['origin'].split(',')]
            sites[pool_of(b0)] = ((ox, oz), f0['away'], int(f0['c'])); bottoms[pool_of(b0)] = int(f0.get('bottom', 16))
        except (KeyError, ValueError):
            pass
        try:
            fv = int(float(f0.get('frontier') or f0.get('frontier0')))
            frontier_pre[pool_of(b0)] = min(frontier_pre.get(pool_of(b0), 999), fv)
            frontier_seen[pool_of(b0)].append((r['t'].timestamp(), fv))
        except (TypeError, ValueError, AttributeError): pass
    bots = defaultdict(set); offbuild = 0; leak = 0
    visits, stops, deaths, deaths_in = 0, Counter(), 0, []
    levels_max = defaultdict(int); state_last = {}; clean_levels = defaultdict(int); clean_complete = set(); frontier_of = dict(frontier_pre)
    missing, absorbed, wet, absorbed_inside = defaultdict(set), defaultdict(set), [], []
    refusals_in, misfire = 0, []
    holds = defaultdict(list); exits = 0; exit_fails = 0; audits = 0; audit_unloaded = 0; ladders_found = []
    samples = defaultdict(list); samples_pre = defaultdict(list)
    placed = Counter()
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b or b.startswith('isolated') or b.startswith('self-isolated') or b.startswith('sandbox'):
            continue
        pool = pool_of(b)
        arm = 'canary' if pool in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b)
        k = (r.get('name') or '').lstrip('_')
        sk = (r.get('raw') or {}).get('skill') or {}
        a = sk.get('args') or {}
        f = dict(kv(r.get('detail') or sk.get('detail')), **{kk: str(vv) for kk, vv in a.items()})
        pos = ((r.get('raw') or {}).get('bot') or {}).get('pos') or (r.get('bot') or {}).get('pos')
        site = sites.get(pool) or (SITES[pool] if (arm == 'control' and pool in SITES) else None)
        if pos:
            (samples if period == 'post' else samples_pre)[(arm, b)].append((t.timestamp(), pos, k in ('dig_shaft', 'shaft', 'shaft_exit') or (r.get('name') or '') == 'dig_shaft'))
        if k.startswith('shaft') and arm == 'control' and period == 'post':
            leak += 1
        if arm != 'canary' or period != 'post':
            continue
        if k == 'shaft_site' or (k == 'shaft_audit' and 'origin' in f):
            try:
                if k == 'shaft_site':
                    ox, oz = [int(x) for x in f['origin'].split(',')]; sites[pool] = ((ox, oz), f['away'], int(f['c'])); bottoms[pool] = int(f.get('bottom', 16))
                else:
                    ox, oz = [int(x) for x in f['origin'].split(',')]; sites[pool] = ((ox, oz), f['away'], int(f['c'])); bottoms[pool] = int(f.get('bottom', 16))
            except (KeyError, ValueError):
                pass
        if k == 'shaft':
            visits += 1; stops[f.get('stop', '?')] += 1
            for kk in ('digs', 'lined', 'filled', 'ladders', 'levels'):
                try: placed[kk] += int(float(f.get(kk) or 0))
                except ValueError: pass
            if int(float(f.get('wet') or 0)) > 0:
                wet.append((b, 'visit', f.get('why')))
            for c in str(f.get('lost_cells') or '').split(';'):
                if c and c != '-':
                    missing[pool].add(c)
        elif k == 'shaft_audit':
            audits += 1
            audit_unloaded += int(float(f.get('unloaded') or 0))
            levels_max[pool] = max(levels_max[pool], int(float(f.get('levels') or 0)))
            try: frontier_of[pool] = min(frontier_of.get(pool, 999), int(float(f.get('frontier'))))
            except (TypeError, ValueError): pass
            state_last[pool] = f.get('state')
            lf_, le_ = int(float(f.get('ladders') or 0)), int(float(f.get('ladders_expected') or 0))
            ladders_found.append((lf_, le_))
            # A CLEAN OBSERVATION (Codex code r1 P2): every cell read, every ladder found -- only these count toward exposure
            if int(float(f.get('unloaded') or 0)) == 0 and lf_ == le_ and le_ > 0:
                clean_levels[pool] = max(clean_levels[pool], int(float(f.get('levels') or 0)))
                if f.get('state') == 'complete':
                    clean_complete.add(pool)
            for c in str(f.get('cells') or '').split(';'):
                if c:
                    missing[pool].add(c)
            if int(float(f.get('wet') or 0)) > 0:
                wet.append((b, 'audit', f.get('cells')))
        elif k == 'shaft_absorbed':
            d = str(r.get('detail') or sk.get('detail') or '')
            m = re.search(r'at=(-?\d+),(-?\d+),(-?\d+)', d)
            if m:
                # a dig absorbed while the digger stood INSIDE the envelope means its hold had released (Claude code r1
                # P2-5): its own gate, never an explanation for S1
                # ONLY IN THE BUILT PART (Claude code r2 P2-3: a cave crossing an unbuilt future cell is not the shaft)
                fy = re.search(r'feet_y=(-?\d+)', d); fr = re.search(r'frontier=(-?\d+)', d)
                built_part = bool(fy and fr and int(fy.group(1)) >= int(fr.group(1)))
                if 'inside=1' in d and built_part:
                    absorbed_inside.append((b, '%s,%s,%s' % m.groups()))
                else:
                    absorbed[pool].add('%s,%s,%s' % m.groups())
        elif k == 'structure_refusal' and 'kind=shaft' in str(r.get('detail') or sk.get('detail') or ''):
            m = re.search(r'at=(-?\d+),(-?\d+),(-?\d+)', str(r.get('detail') or sk.get('detail') or ''))
            if m:
                x, y, z = [int(v) for v in m.groups()]
                if in_box(sites.get(pool), x, y, z, bottoms.get(pool, 16)):
                    refusals_in += 1
                else:
                    misfire.append((b, (x, y, z), 'no site recorded' if pool not in sites else 'outside'))
        elif k == 'shaft_hold':
            holds[b].append(t.timestamp())
        elif k == 'shaft_exit':
            exits += 1
        elif k == 'shaft_exit_failed':
            exit_fails += 1
        elif k in ('death', 'died', 'bot_death'):
            deaths += 1
            # THE FRONTIER AS KNOWN AT THE DEATH (the latest observation at or before it; none -> nothing built that we know of),
            # and in_box's own bottom-1 makes the boundary frontier-1 inclusive (Codex code r3 P2: never subtract twice)
            known = [fv for (tt, fv) in frontier_seen.get(pool, []) if tt <= t.timestamp()]
            if pos and known and in_box(sites.get(pool), pos['x'], pos['y'], pos['z'], max(bottoms.get(pool, 16), known[-1])):
                deaths_in.append((b, pos))
    lost = {p: unexplained(missing[p], absorbed[p]) for p in missing}
    lost_n = sum(len(v) for v in lost.values())
    held_long = [(b, max(held_runs(sorted(ts)))) for b, ts in holds.items() if ts and max(held_runs(sorted(ts))) > 180]
    # S6: per bot, its own pre rate over its own post hours, canary vs control (DiD on the excess per bot-hour)
    def per_arm(arm, smp_post, smp_pre):
        exp = obs = hp = 0.0
        for (a2, b), sm in smp_post.items():
            if a2 != arm:
                continue
            p = pool_of(b); site = sites.get(p) if arm == 'canary' else (SITES[p] if p in SITES else None)
            sm = sorted(sm, key=lambda x: x[0]); h = len({int(s[0] // 60) for s in sm}) / 60.0
            n = len(still_runs(sm, site)); obs += n; hp += h
            pre = sorted(smp_pre.get((a2, b), []), key=lambda x: x[0]); hpre = len({int(s[0] // 60) for s in pre}) / 60.0
            if hpre > 0:
                exp += len(still_runs(pre, site)) / hpre * h
        return (obs - exp) / hp if hp else float('nan')
    s6 = per_arm('canary', samples, samples_pre) - per_arm('control', samples, samples_pre)
    s6_trip = int(s6 == s6 and s6 > 0.05)
    lv = max(clean_levels.values()) if clean_levels else 0   # levels OBSERVED clean, not claimed
    complete = bool(clean_complete)
    exposure = int((lv >= 20 or complete) and W >= 150)
    stopped_early = int(any(s in ('stopped', 'damaged') for s in state_last.values()) and lv < 20)
    print('rows walked %d | canary %s sha %s cutoff %s window +%d min | bots pre/post canary %d/%d control %d/%d | offbuild %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     visits %d stops %s | placed %s | audits %d (unloaded cells %d) | levels max %d state %s | sites %s' % (visits, dict(stops.most_common(8)), dict(placed), audits, audit_unloaded, lv, state_last, sites))
    print('CONTROL+     ladders found vs expected (last 5 audits): %s' % ladders_found[-5:])
    print('S1 (gate)    lost cells unexplained %d %s | absorbed %d' % (lost_n, {p: v[:4] for p, v in lost.items() if v}, sum(len(v) for v in absorbed.values())))
    print('S8 (gate)    digs absorbed while the digger stood INSIDE (a released hold) %d %s' % (len(absorbed_inside), absorbed_inside[:3]))
    print('S3 (gate)    liquid in built lining %d %s' % (len(wet), wet[:3]))
    print('S4 (gate)    deaths inside the shaft box %d %s (all canary deaths %d)' % (len(deaths_in), deaths_in[:3], deaths))
    print('S5 (gate)    kind=shaft refusals outside the box %d %s (inside: %d)' % (len(misfire), misfire[:3], refusals_in))
    print('S7 (gate)    bots held > 3 min %d %s | exits %d failed exits %d' % (len(held_long), held_long[:3], exits, exit_fails))
    print('S6 (gate)    still runs near the collar, excess per bot-h DiD %s -> %d' % (round(s6, 4) if s6 == s6 else None, s6_trip))
    print('LEAK         control shaft rows post %d' % leak)
    print('EXPOSURE     levels >= 20 or complete, window >= 150: %d | stopped early (INCONCLUSIVE) %d' % (exposure, stopped_early))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('shaftread', W, {
            'licence_rows': visits, 'offbuild_canary': offbuild, 'lost_unexplained': lost_n, 'absorbed': sum(len(v) for v in absorbed.values()),
            'absorbed_inside': len(absorbed_inside), 'wet': len(wet), 'deaths_in_shaft': len(deaths_in), 'deaths_all': deaths, 'guard_misfire': len(misfire), 'refusals_in_box': refusals_in,
            'held_long': len(held_long), 'exits': exits, 'exit_fails': exit_fails, 'stuck_near': s6_trip, 'stuck_near_did': None if s6 != s6 else round(s6, 4),
            'control_shaft_rows': leak, 'levels': lv, 'complete': int(complete), 'stopped_early': stopped_early, 'exposure_ready': exposure,
            'audits': audits, 'audit_unloaded': audit_unloaded, 'stops': dict(stops), 'placed': dict(placed),
        })
    except Exception as e:
        print('emit failed:', e)
