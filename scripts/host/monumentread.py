#!/usr/bin/env python3
# monumentread.py [window_min] -- the read for canary `monument-01` (ziggurat stage 4 + structureguard-01 + the generic
# placement builder; docs/reports/ziggurat-mineshaft-2026-10-15.md 3.3-3.8). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: bots near their world's monument site with stone above the 64+1 reserve are ORDERED (cognitive
#   monumentOrder, before the junk well) to build a solid 48-wide ziggurat by layers (build_monument: one visit = at most
#   48 placements / 90 s, nearest first, server-confirmed). Each visit writes ONE `_monument` row (key=value: gen, layer,
#   seg, placed, cleared, refused, silent, unreach, repair, open/done/degraded/foreign/waived/blocked, held, fund, cobble0/1,
#   stuck reasons, gate_ms_p95/max, lag_ms_max, slot, stop). The first writes `_monument_site` (corner, base, face, fill).
#   structureguard: recorded monument cells are kept out of TARGET digs (mine, gather, the ore tunnel, room vetoes).
#   FLEET-VISIBLE WITHOUT A MONUMENT: every gather dig now looks (forced) first and digs with forceLook 'ignore'.
#
#   LICENCE   kind `_monument` (the base cannot write it).
#   GATES     (canary arm, post, only -- never a control event)
#             M1 loop_stall          visits whose bot's event loop lagged > 2000 ms during the visit (the decision loop
#                                    stalls: the coordinator's tripwire on the synchronous pre-click work); defect
#             M2 gate_slow           visits whose pre-click gate p95 > 500 ms; defect
#             M3 stuck_near          canary bots with >= 20 min of rows within 4 of the site box, moving < 2 blocks, no
#                                    build_monument row in that span (design G4); blocks KEEP
#             M4 gather_regressed    the NO-REGRESSION gate (coordinator 10-15): gather success share DiD below its no-change
#                                    1% quantile, or the (unconfirmed + rejected) dig share DiD above its 99% quantile
#                                    (~/mcai-analysis/monument-gathernull.json, gathernull.py), with >= 50 canary gather calls
#                                    post; blocks KEEP (a rate-class gate: never a revert on its own)
#             LEAK control `_monument` rows post (blocks KEEP)
#   EXPOSURE  >= 100 confirmed placements and >= 10 visits, in a window >= 150 min.
#   PRIMARY   REPORTED: confirmed placements per pool-hour (a level, with exposure); cobble + stone-family well disposal per
#             bot-h DiD (expected to fall); gather calls per bot-h DiD (population stability); milestones DiD (G2);
#             the per-visit stop mix, stuck reasons, gate and lag distributions; repairs (G1's proxy: cells lost below the
#             frontier are only seen when a visit re-places them -- the rows cannot see an enclosed loss).
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

# the offline sites (bots/src/monumentjob.mjs MONUMENT_SITES): the fallback when no _monument_site row is in the window
SITES = {'board-a': (289, 51), 'board-b': (-353, 58), 'board-c': (287, 59), 'board-d': (289, 53), 'hive-a': (287, 55),
         'hive-b': (287, 71), 'hive-c': (-12, -156), 'hive-d': (120, -36), 'placebo-a': (189, -112), 'placebo-b': (186, -384),
         'placebo-c': (287, 55), 'placebo-d': (245, -45)}
B, A = 48, 2
NULL_PATH = os.path.expanduser('~/mcai-analysis/monument-gathernull.json')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def kv(detail):
    out = {}
    for part in str(detail or '').split(' '):
        if '=' in part:
            k, v = part.split('=', 1)
            out[k] = v
    return out


def num(f, k):
    try:
        return float(f.get(k))
    except (TypeError, ValueError):
        return None


def near_site(pos, corner, margin=4):
    """PURE. Is a position within `margin` of the site's box (footprint + apron)?"""
    if not pos or not corner:
        return False
    x0, z0 = corner[0] - A - margin, corner[1] - A - margin
    return x0 <= pos['x'] <= corner[0] + B + A + margin and z0 <= pos['z'] <= corner[1] + B + A + margin


def stuck_spans(samples, corner, min_s=1200, move=2.0):
    """PURE. samples = [(t_seconds, pos, building)] of one bot, time-sorted -> spans (seconds) of >= min_s with every row near
    the site, a max displacement < move, and no build_monument row inside."""
    out, run = [], []
    def close():
        if len(run) >= 2 and run[-1][0] - run[0][0] >= min_s:
            xs = [p['x'] for _, p, _ in run]; zs = [p['z'] for _, p, _ in run]
            if max(xs) - min(xs) < move and max(zs) - min(zs) < move and not any(b for _, _, b in run):
                out.append(run[-1][0] - run[0][0])
    for s in samples:
        if near_site(s[1], corner):
            run.append(s)
        else:
            close(); run = []
    close()
    return out


def regressed(succ_did, bad_did, calls, band):
    """PURE. The no-regression verdict -> 1 (regressed), 0 (within the no-change band), None (not enough calls/no band)."""
    if band is None or calls < band.get('min_calls', 50) or succ_did != succ_did or bad_did != bad_did:
        return None
    return int(succ_did < band['success_share_did_q01'] or bad_did > band['bad_dig_share_did_q99'])


# self-tests (pure)
assert kv('gen=3 layer=69 placed=12 stop=max_steps')['placed'] == '12'
assert near_site({'x': 289, 'z': 51}, (289, 51)) and not near_site({'x': 200, 'z': 51}, (289, 51))
_s = [(i * 60, {'x': 300.0, 'z': 60.0}, False) for i in range(25)]
assert stuck_spans(_s, (289, 51)) == [1440]
assert stuck_spans([(t, p, b if i != 5 else True) for i, (t, p, b) in enumerate(_s)], (289, 51)) == []
assert stuck_spans([(t, {'x': 300.0 + (i % 2) * 3, 'z': 60.0}, b) for i, (t, p, b) in enumerate(_s)], (289, 51)) == []
_band = {'success_share_did_q01': -0.08, 'bad_dig_share_did_q99': 0.05, 'min_calls': 50}
assert regressed(-0.10, 0.0, 60, _band) == 1 and regressed(-0.01, 0.06, 60, _band) == 1 and regressed(-0.01, 0.0, 60, _band) == 0
assert regressed(-0.5, 0.5, 10, _band) is None and regressed(0, 0, 60, None) is None

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
    try:
        BAND = json.load(open(NULL_PATH))
    except Exception:
        BAND = None

    def load_window(since, until):
        """Rotation-aware: day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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
    bots = defaultdict(set); offbuild = 0; leak = 0
    n = Counter(); stops = Counter(); stuckw = Counter(); gate95 = []; lags = []
    visits = 0; placed = 0; cleared = 0; repairs = 0; refused = 0
    sites = {}
    samples = defaultdict(list)
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
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
        pos = ((r.get('raw') or {}).get('bot') or {}).get('pos') or (r.get('bot') or {}).get('pos')
        if arm == 'canary' and period == 'post' and pos:
            samples[b].append((t.timestamp(), pos, k in ('build_monument', 'monument')))
        if k == 'monument':
            if arm == 'control' and period == 'post':
                leak += 1
            if arm != 'canary' or period != 'post':
                continue
            f = kv(r.get('detail') or sk.get('detail'))
            visits += 1; stops[f.get('stop', '?')] += 1
            placed += int(num(f, 'placed') or 0); cleared += int(num(f, 'cleared') or 0); repairs += int(num(f, 'repair') or 0)
            refused += int(num(f, 'refused') or 0) + int(num(f, 'silent') or 0)
            for part in str(f.get('stuck') or '').split(','):
                if ':' in part:
                    stuckw[part.split(':')[0]] += int(part.split(':')[1] or 0)
            g = num(f, 'gate_ms_p95'); lg = num(f, 'lag_ms_max')
            if g is not None:
                gate95.append(g)
            if lg is not None:
                lags.append(lg)
        elif k == 'monument_site' and arm == 'canary':
            m = re.search(r'corner=(-?\d+),(-?\d+)', str(r.get('detail') or sk.get('detail') or ''))
            if m:
                sites[pool] = (int(m.group(1)), int(m.group(2)))
        elif k == 'gather':
            st = sk.get('status')
            if st != 'aborted':
                n[(period, arm, 'gather_calls')] += 1
                n[(period, arm, 'gather_ok')] += int(st == 'success')
        elif k == 'dig_town_sum':
            a = sk.get('args') or {}
            n[(period, arm, 'digs')] += a.get('all') or 0
            n[(period, arm, 'digs_bad')] += (a.get('o_unconfirmed') or 0) + (a.get('o_rejected') or 0)
        elif k == 'milestone_complete':
            n[(period, arm, 'milestones')] += 1
        elif k == 'well_dispose':
            f = kv(r.get('detail') or sk.get('detail'))
            items = str(f.get('items') or '')
            stone = sum(int(c) for nm, c in re.findall(r'(cobblestone|cobbled_deepslate|andesite|diorite|granite|tuff):(\d+)', items))
            n[(period, arm, 'well_stone')] += stone

    hours = W / 60.0
    prehours = min(W, 180) / 60.0
    def rate(period, arm, what):
        nb = len(bots[(period, arm)]); h = hours if period == 'post' else prehours
        return n[(period, arm, what)] / (nb * h) if nb and h else float('nan')
    def did(what):
        return (rate('post', 'canary', what) - rate('pre', 'canary', what)) - (rate('post', 'control', what) - rate('pre', 'control', what))
    def sh(period, arm, num_, den):
        d = n[(period, arm, den)]
        return n[(period, arm, num_)] / d if d else float('nan')
    def did_share(num_, den):
        return (sh('post', 'canary', num_, den) - sh('pre', 'canary', num_, den)) - (sh('post', 'control', num_, den) - sh('pre', 'control', num_, den))
    succ_did = did_share('gather_ok', 'gather_calls'); bad_did = did_share('digs_bad', 'digs')
    can_calls = n[('post', 'canary', 'gather_calls')]
    reg = regressed(succ_did, bad_did, can_calls, BAND)
    loop_stall = sum(1 for v in lags if v > 2000)
    gate_slow = sum(1 for v in gate95 if v > 500)
    stuck = []
    for b, s in samples.items():
        corner = sites.get(pool_of(b)) or SITES.get(pool_of(b))
        stuck += [(b, v) for v in stuck_spans(sorted(s, key=lambda x: x[0]), corner)]
    pct = lambda xs, q: (sorted(xs)[min(len(xs) - 1, int(q * (len(xs) - 1)))] if xs else None)
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     canary _monument visits %d | placed %d cleared %d repaired %d refused/silent %d | sites %s' % (visits, placed, cleared, repairs, refused, sites))
    print('             stops %s | stuck reasons %s' % (dict(stops.most_common(8)), dict(stuckw.most_common(8))))
    print('M1 (gate)    visits with event-loop lag > 2000 ms: %d   (lag p50 %s p95 %s max %s ms)' % (loop_stall, pct(lags, .5), pct(lags, .95), max(lags) if lags else None))
    print('M2 (gate)    visits with gate p95 > 500 ms: %d   (gate p95 per visit: p50 %s p95 %s max %s ms)' % (gate_slow, pct(gate95, .5), pct(gate95, .95), max(gate95) if gate95 else None))
    print('M3 (gate)    canary bots idle >= 20 min near the site: %d %s' % (len(stuck), stuck[:4]))
    print('M4 (gate)    gather success share DiD %+.4f (band q01 %s) | (unconf+rej) dig share DiD %+.4f (band q99 %s) | canary calls post %d -> regressed %s'
          % (succ_did, None if not BAND else round(BAND['success_share_did_q01'], 4), bad_did, None if not BAND else round(BAND['bad_dig_share_did_q99'], 4), can_calls, reg))
    print('LEAK         control _monument rows post %d (blocks KEEP)' % leak)
    for what, label in (('gather_calls', 'gather calls'), ('well_stone', 'well stone disposal'), ('milestones', 'milestones completed')):
        print('PRIMARY      %-24s per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f'
              % (label, rate('pre', 'canary', what), rate('post', 'canary', what), rate('pre', 'control', what), rate('post', 'control', what), did(what)))
    print('PRIMARY      confirmed placements per pool-hour %.1f (level, with exposure)' % ((placed / hours / max(1, len(CANS))) if hours else 0))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v is None or v != v else round(v, 4)
        emit('monumentread', W, {
            'rows_canary_bots': len(bots[('post', 'canary')]), 'offbuild_canary': offbuild,
            'licence_rows': visits, 'placed': placed, 'cleared': cleared, 'repairs': repairs, 'refused_or_silent': refused,
            'loop_stall': loop_stall, 'gate_slow': gate_slow, 'stuck_near': len(stuck),
            'gather_regressed': 0 if reg is None else reg, 'gather_regression_unread': int(reg is None),
            'gather_success_did': nanless(succ_did), 'bad_dig_share_did': nanless(bad_did), 'gather_calls_did': nanless(did('gather_calls')),
            'well_stone_did': nanless(did('well_stone')), 'milestones_did': nanless(did('milestones')),
            'control_monument_rows': leak, 'stops': dict(stops), 'stuck_reasons': dict(stuckw),
            'lag_ms_p95': pct(lags, .95), 'gate_ms_p95_p95': pct(gate95, .95),
            'exposure_ready': int(placed >= 100 and visits >= 10 and W >= 150),
        })
    except Exception as e:
        print('emit failed:', e)
