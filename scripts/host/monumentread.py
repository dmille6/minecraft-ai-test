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
#             M1 loop_stall          >= 2 visits AND >= 5% of visits whose bot's event loop lagged > 2000 ms (the decision
#                                    loop stalls: the coordinator's tripwire on the synchronous pre-click work; never one
#                                    visit alone -- the death-gate lesson); defect; the stalls are named
#             M5 guard_misfire       a canary structure-guard refusal (`_structure_refusal` by gather or the ore tunnel; mine's
#                                    `_mine_well_guard ... keepout=monument` stop) at a cell OUTSIDE its pool's RECORDED site box
#                                    (the guard reserving what it should not); defect. A refusal in a pool whose site is not in the
#                                    window is guard_misfire_unread (blocks KEEP; never judged against the offline list)
#             M6 waived_share        a `_monument` row whose open layer has >= 50 cells, >= 10 waived and > 2% of them (design 3.3:
#                                    "a waived share above 2% of a layer is a read defect"); BLOCKS KEEP (never a revert: terrain
#                                    such as lava pockets can waive cells -- Claude stage-4 r2 P1-1); the layer and the waived
#                                    blocks' kinds are named
#             STALL (reported)       visits that stopped on a pending cover (covers > 0 and nothing placed): the cell is
#                                    the record's; the design's 72 h stall is beyond a canary window
#             M2 gate_slow           visits whose pre-click gate p95 > 500 ms; defect
#             M3 stuck_near          canary STILL runs (>= 10 min within 4 of the site box; a move of >= 2 blocks or a
#                                    build_monument row restarts the clock; design G4) in the post period beyond the same bots'
#                                    pre-period RATE per bot-hour carried over the post bot-hours; blocks KEEP
#             M4 gather_regressed    the NO-REGRESSION gate (coordinator 10-15): gather success share DiD below its no-change
#                                    1% quantile, or the (unconfirmed + rejected) dig share DiD above its 99% quantile, from the
#                                    band calibrated for THIS read's window and population (~/mcai-analysis/monument-gathernull
#                                    .json, gathernull.py); only a component with a calibrated 80%-power effect size decides;
#                                    blocks KEEP (rate-class: never a revert on its own). gather_regression_unread (no band, < 50
#                                    canary gather calls post, or no powered component) ALSO blocks KEEP.
#                                    THE DIG SHARE COUNTS EVERY DIG (`_dig_town_sum` has no per-skill split): a canary that digs
#                                    a different mix of things (building more, mining less) shifts it too -- read it with the
#                                    calls-per-bot-h line beside it.
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

# NO OFFLINE FALLBACK (Claude stage-4 r3 P3): the site box is the one the canary RECORDED -- `site=` on every `_monument` row,
# `corner=` on `_monument_site`. Siting may verify a later candidate than the offline first; a pool whose site is not in the
# window is UNREAD for M5 (a refusal there cannot be judged, and blocks KEEP) and has nothing for M3 to be stuck near.
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


REFUSAL = re.compile(r'by=(\S+) at=(-?\d+),(-?\d+),(-?\d+)')
STOPCELL = re.compile(r'action=stop at=- cell=(-?\d+),(-?\d+),(-?\d+) keepout=monument')


def refusal_cell(kind, detail):
    """PURE. A structure-guard refusal row -> (by, x, z) or None: `_structure_refusal` (gather, ore tunnel) and mine's per-dig
    stop (`_mine_well_guard ... keepout=monument`)."""
    d = str(detail or '')
    if kind == 'structure_refusal':
        m = REFUSAL.search(d)
        return (m.group(1), int(m.group(2)), int(m.group(4))) if m else None
    if kind == 'mine_well_guard':
        m = STOPCELL.search(d)
        return ('mine', int(m.group(1)), int(m.group(3))) if m else None
    return None


def stuck_spans(samples, corner, min_s=600, move=2.0):
    """PURE. samples = [(t_seconds, pos, building)] of one bot, time-sorted -> the lengths (seconds) of STILL runs near the site:
    a run starts at a row near the site and is RESET (Codex stage-4 r1 P2-5: rolling, never the whole stay) by a move of >= move
    from its anchor, a build_monument row, or leaving the site; a run of >= min_s (design G4: 10 min) is one stuck span."""
    out, anchor, last = [], None, None
    def close():
        if anchor is not None and last is not None and last[0] - anchor[0] >= min_s:
            out.append(last[0] - anchor[0])
    for s in samples:
        t, p, building = s
        if not near_site(p, corner) or building:
            close(); anchor = None; last = None
            continue
        if anchor is None or abs(p['x'] - anchor[1]['x']) >= move or abs(p['z'] - anchor[1]['z']) >= move:
            close(); anchor = s
        last = s
    close()
    return out


def stuck_excess_of(post_n, pre_n, bh_post, bh_pre):
    """PURE. M3's excess: post still runs beyond the same bots' pre-period RATE carried over the post bot-hours, rounded up
    (a fraction of an expected span is no allowance). No pre exposure -> the pre rate is 0 (every post span counts)."""
    import math
    expected = (pre_n / bh_pre) * bh_post if bh_pre > 0 else 0.0
    return max(0, post_n - math.ceil(expected))


POWER_MIN = 0.8


BAND_SLACK_MIN = 10


def band_for(cal, post_min):
    """PURE. The calibration band for THIS read (Codex stage-4 r2 P2-4): a band whose post window is within BAND_SLACK_MIN of the
    read's, whose pre is min(post, 180) as the read aggregates, from a calibration over the read's population (shared pools only).
    Anything else -> None (the gate is then unread, which blocks KEEP)."""
    if not cal or 'shared pools only' not in str(cal.get('population') or ''):
        return None
    for b in ((cal.get('bands') or {}).values()):
        post = b.get('post')
        if isinstance(post, (int, float)) and abs(post - post_min) <= BAND_SLACK_MIN and b.get('pre') == min(post, 180):
            return dict(b, min_calls=cal.get('min_calls', 50))
    return None


def regressed(succ_did, bad_did, calls, band):
    """PURE. The no-regression verdict -> (verdict, components). verdict 1 = a POWERED component is past its no-change band, 0 =
    every powered component within it, None = no band, too few calls, or NO component has power >= POWER_MIN (Codex stage-4 r1
    P2-4: a gate that catches 7% of a 20% loss is not a clearance). components names each one: 'trip' | 'ok' | 'unpowered'."""
    if band is None or calls < band.get('min_calls', 50) or succ_did != succ_did or bad_did != bad_did:
        return None, {}
    comp = {}
    # a component is POWERED when the calibration found an effect size it sees with POWER_MIN power (mde_*): it then decides
    # against its band; the registration states that effect size as the gate's honest reach
    for name, val, lim, mde, bad in (('success', succ_did, band['success_share_did_q01'], band.get('mde_success_loss'), lambda v, l: v < l),
                                     ('bad_dig', bad_did, band['bad_dig_share_did_q99'], band.get('mde_bad_rise'), lambda v, l: v > l)):
        comp[name] = 'unpowered' if mde is None else ('trip' if bad(val, lim) else 'ok')
    powered = [v for v in comp.values() if v != 'unpowered']
    if not powered:
        return None, comp
    return int('trip' in powered), comp


# self-tests (pure)
assert refusal_cell('structure_refusal', 'by=gather at=300,64,70 kind=monument block=cobblestone') == ('gather', 300, 70)
assert refusal_cell('structure_refusal', 'by=ore_tunnel at=-5,40,9 kind=monument block=stone') == ('ore_tunnel', -5, 9)
assert refusal_cell('mine_well_guard', 'action=stop at=- cell=290,66,60 keepout=monument') == ('mine', 290, 60)
assert refusal_cell('mine_well_guard', 'action=stop at=- cell=290,66,60 farm=1') is None
assert refusal_cell('gather', 'by=gather at=1,2,3') is None
assert kv('gen=3 layer=69 placed=12 stop=max_steps')['placed'] == '12'
assert near_site({'x': 289, 'z': 51}, (289, 51)) and not near_site({'x': 200, 'z': 51}, (289, 51))
_s = [(i * 60, {'x': 300.0, 'z': 60.0}, False) for i in range(25)]
assert stuck_spans(_s, (289, 51)) == [1440]
assert stuck_spans([(t, p, b if i != 5 else True) for i, (t, p, b) in enumerate(_s)], (289, 51)) == [1080], 'a build row resets; the still tail counts'
assert stuck_spans([(t, {'x': 300.0 + (i % 2) * 3, 'z': 60.0}, b) for i, (t, p, b) in enumerate(_s)], (289, 51)) == [], 'moving every minute'
# arrival then still (Codex stage-4 r1 P2-5): moving for 10 minutes, then 30 still minutes
_arr = [(i * 60, {'x': 290.0 + i, 'z': 60.0}, False) for i in range(10)] + [(600 + i * 60, {'x': 300.0, 'z': 60.0}, False) for i in range(31)]
assert stuck_spans(_arr, (289, 51)) == [1800]
assert stuck_spans([(i * 60, {'x': 300.0, 'z': 60.0}, False) for i in range(9)], (289, 51)) == [], 'under 10 minutes'
assert stuck_excess_of(2, 1, 30.0, 15.0) == 0, '2 post spans in twice the bot-hours of 1 pre span: the same rate'
assert stuck_excess_of(2, 1, 15.0, 15.0) == 1 and stuck_excess_of(1, 0, 30.0, 15.0) == 1 and stuck_excess_of(0, 3, 30.0, 15.0) == 0
assert stuck_excess_of(3, 1, 30.0, 0.0) == 3, 'no pre exposure: every post span counts'
_band = {'success_share_did_q01': -0.08, 'bad_dig_share_did_q99': 0.05, 'min_calls': 50, 'mde_success_loss': 0.35, 'mde_bad_rise': 0.02}
assert regressed(-0.10, 0.0, 60, _band)[0] == 1 and regressed(-0.01, 0.06, 60, _band)[0] == 1 and regressed(-0.01, 0.0, 60, _band)[0] == 0
assert regressed(-0.5, 0.5, 10, _band)[0] is None and regressed(0, 0, 60, None)[0] is None
_weak = dict(_band, mde_success_loss=None)
assert regressed(-0.9, 0.0, 60, _weak) == (0, {'success': 'unpowered', 'bad_dig': 'ok'}), 'an unpowered component never decides'
assert regressed(0, 0, 60, dict(_weak, mde_bad_rise=None))[0] is None
_cal = {'min_calls': 50, 'population': 'shared pools only (no isolated, no sandbox)', 'bands': {'180': {'post': 180, 'pre': 180}, '360': {'post': 360, 'pre': 180}}}
assert band_for(_cal, 180)['post'] == 180 and band_for(_cal, 355)['post'] == 360 and band_for(_cal, 540) is None, 'no 540 band: unread'
assert band_for(_cal, 150) is None, 'a 150-min read has no band (Codex r2 P2-4)'
assert band_for(dict(_cal, bands={'180': {'post': 180, 'pre': 360}}), 180) is None, 'a different pre is refused'
assert band_for(dict(_cal, population='isolated pools'), 180) is None, 'another population is refused'
assert band_for(None, 180) is None

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
        BAND = band_for(json.load(open(NULL_PATH)), W)
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
    visits = 0; placed = 0; cleared = 0; repairs = 0; refused = 0; rows_without_args = 0
    sites = {}
    samples = defaultdict(list); samples_pre = defaultdict(list)
    waived_rows, cover_stalls = [], []
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        pool = pool_of(b)
        # THE CALIBRATED POPULATION (Codex stage-4 r1 P2-4): shared pools only -- the isolated pools and the sandbox never control
        if b.startswith('isolated') or b.startswith('self-isolated') or b.startswith('sandbox'):
            continue
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
        if arm == 'canary' and pos:
            (samples if period == 'post' else samples_pre)[b].append((t.timestamp(), pos, k in ('build_monument', 'monument')))
        if k == 'monument':
            if arm == 'control' and period == 'post':
                leak += 1
            if arm != 'canary' or period != 'post':
                continue
            # THE ARGS ARE THE SOURCE (logEvent cuts a detail at 300 chars: a cut row lost lag_ms_max, or cut it mid-digit)
            f = dict(kv(r.get('detail') or sk.get('detail')), **{k: str(v) for k, v in (sk.get('args') or {}).items()})
            visits += 1; stops[f.get('stop', '?')] += 1
            if not sk.get('args'):
                rows_without_args += 1
            sm = re.fullmatch(r'(-?\d+),(-?\d+)', str(f.get('site') or ''))
            if sm:
                sites[pool] = (int(sm.group(1)), int(sm.group(2)))
            placed += int(num(f, 'placed') or 0); cleared += int(num(f, 'cleared') or 0); repairs += int(num(f, 'repair') or 0)
            refused += int(num(f, 'refused') or 0) + int(num(f, 'silent') or 0)
            for part in str(f.get('stuck') or '').split(','):
                if ':' in part:
                    stuckw[part.split(':')[0]] += int(part.split(':')[1] or 0)
            tot = sum(int(num(f, k) or 0) for k in ('done', 'degraded', 'foreign', 'waived', 'open', 'blocked'))
            wv = int(num(f, 'waived') or 0)
            # M6 (Claude stage-4 r2 P1-1): > 2% of a >= 50-cell layer AND >= 10 cells; the kinds name terrain vs a fault
            if tot >= 50 and wv >= 10 and wv > 0.02 * tot:
                waived_rows.append((b, f.get('layer'), wv, tot, f.get('wkinds')))
            if int(num(f, 'covers') or 0) > 0 and int(num(f, 'placed') or 0) == 0:
                cover_stalls.append((b, f.get('layer'), f.get('covers')))
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
    reg, comps = regressed(succ_did, bad_did, can_calls, BAND)
    stalls = [v for v in lags if v > 2000]
    loop_stall = int(len(stalls) >= 2 and len(stalls) >= 0.05 * max(1, len(lags)))
    gate_slow = sum(1 for v in gate95 if v > 500)
    # M5: a canary structure-guard refusal (gather, ore tunnel, mine's stop) at a cell outside its own pool's site box
    misfire, misfire_unread, refusals = [], [], Counter()
    for r in rows:
        b = (r.get('bot') or {}).get('name') or ''
        if pool_of(b) not in CANS or r.get('t') is None or r['t'] < CUT:
            continue
        k = (r.get('name') or '').lstrip('_')
        det = str(((r.get('raw') or {}).get('skill') or {}).get('detail') or r.get('detail') or '')
        rc = refusal_cell(k, det)
        if rc:
            refusals[rc[0]] += 1
            corner = sites.get(pool_of(b))
            if corner is None:
                misfire_unread.append((b, rc))
            elif not near_site({'x': rc[1], 'z': rc[2]}, corner, margin=1):
                misfire.append((b, rc))
    # M3 PER BOT-HOUR (Claude stage-4 r3 P3): the post window is up to 6x the pre one, so a raw count compare fires on exposure
    # alone. The same canary bots' pre-period rate (no monument code) is scaled to the post bot-hours; the gate is the EXCESS.
    # Only pools whose recorded site is known: with no monument there is nothing to be stuck near.
    def spans(smp):
        out = []
        for b, s in smp.items():
            corner = sites.get(pool_of(b))
            if corner is not None:
                out += [(b, v) for v in stuck_spans(sorted(s, key=lambda x: x[0]), corner)]
        return out
    stuck, stuck_pre = spans(samples), spans(samples_pre)
    sited = lambda smp: len([b for b in smp if pool_of(b) in sites])
    bh_post, bh_pre = sited(samples) * W / 60.0, sited(samples_pre) * min(W, 180) / 60.0
    stuck_excess = stuck_excess_of(len(stuck), len(stuck_pre), bh_post, bh_pre)
    pct = lambda xs, q: (sorted(xs)[min(len(xs) - 1, int(q * (len(xs) - 1)))] if xs else None)
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     canary _monument visits %d | placed %d cleared %d repaired %d refused/silent %d | sites %s' % (visits, placed, cleared, repairs, refused, sites))
    print('             stops %s | stuck reasons %s' % (dict(stops.most_common(8)), dict(stuckw.most_common(8))))
    print('ROWS         _monument rows without structured args (detail only, may be cut at 300): %d of %d' % (rows_without_args, visits))
    print('M1 (gate)    visits with event-loop lag > 2000 ms: %d   (lag p50 %s p95 %s max %s ms)' % (loop_stall, pct(lags, .5), pct(lags, .95), max(lags) if lags else None))
    print('M2 (gate)    visits with gate p95 > 500 ms: %d   (gate p95 per visit: p50 %s p95 %s max %s ms)' % (gate_slow, pct(gate95, .5), pct(gate95, .95), max(gate95) if gate95 else None))
    print('M1 named     %s' % (sorted(stalls, reverse=True)[:6],))
    print('M3 (gate)    canary still runs >= 10 min near the RECORDED site (rolling): post %d in %.1f bot-h vs pre %d in %.1f bot-h -> excess %d %s'
          % (len(stuck), bh_post, len(stuck_pre), bh_pre, stuck_excess, stuck[:4]))
    print('M5 (gate)    structure-guard refusals outside the recorded site box: %d %s | in a pool with no recorded site (UNREAD, blocks KEEP): %d %s | refusals by guard %s'
          % (len(misfire), misfire[:3], len(misfire_unread), misfire_unread[:3], dict(refusals)))
    print('M6 (gate)    rows with > 2%% of the open layer waived: %d %s' % (len(waived_rows), waived_rows[:3]))
    print('STALL        visits stopped on a pending cover: %d %s' % (len(cover_stalls), cover_stalls[:3]))
    print('M4 (gate)    gather success share DiD %+.4f (band q01 %s, %s) | (unconf+rej) dig share DiD %+.4f (band q99 %s, %s) | canary calls post %d -> regressed %s %s'
          % (succ_did, None if not BAND else round(BAND['success_share_did_q01'], 4), None if not BAND else 'MDE %s' % BAND.get('mde_success_loss'),
             bad_did, None if not BAND else round(BAND['bad_dig_share_did_q99'], 4), None if not BAND else 'MDE %s' % BAND.get('mde_bad_rise'), can_calls, reg, comps))
    print('G2/G3        milestones DiD and bag-full share are REPORTED, not gated here (rate-class: the project rule); bag-full = bagread full_share_did, a read of this registration')
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
            'licence_rows': visits, 'rows_without_args': rows_without_args, 'placed': placed, 'cleared': cleared, 'repairs': repairs, 'refused_or_silent': refused,
            'loop_stall': loop_stall, 'loop_stalls_named': sorted(stalls, reverse=True)[:6], 'gate_slow': gate_slow,
            'stuck_near': stuck_excess, 'stuck_near_post': len(stuck), 'stuck_near_pre': len(stuck_pre),
            'stuck_bot_h_post': round(bh_post, 2), 'stuck_bot_h_pre': round(bh_pre, 2), 'guard_misfire_unread': len(misfire_unread),
            'refusals_by_guard': dict(refusals), 'waived_rows_named': waived_rows[:4],
            'guard_misfire': len(misfire), 'waived_share_defect': len(waived_rows), 'cover_stalls': len(cover_stalls),
            'gather_regressed': 0 if reg is None else reg, 'gather_regression_unread': int(reg is None), 'gather_components': comps,
            'gather_success_did': nanless(succ_did), 'bad_dig_share_did': nanless(bad_did), 'gather_calls_did': nanless(did('gather_calls')),
            'well_stone_did': nanless(did('well_stone')), 'milestones_did': nanless(did('milestones')),
            'control_monument_rows': leak, 'stops': dict(stops), 'stuck_reasons': dict(stuckw),
            'lag_ms_p95': pct(lags, .95), 'gate_ms_p95_p95': pct(gate95, .95),
            'exposure_ready': int(placed >= 100 and visits >= 10 and W >= 150),
        })
    except Exception as e:
        print('emit failed:', e)
