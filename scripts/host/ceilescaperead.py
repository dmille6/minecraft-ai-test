#!/usr/bin/env python3
# ceilescaperead.py [window_min] [--selftest] [--fleet] -- the read for canary `ceilescape-01` (a ramp swing whose price
# cannot finish in the time left is never started; a submerged bot under an unaffordable ceiling leaves sideways when that
# fits, and otherwise the firing stops with a `_needs_rescue` flag). Design: docs/reports/ceilescape-01-design-2026-10-24.md.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). DENOMINATORS FIRST.
#
# WHY (ES, 7 d to 10-24 03:40Z): three bots in the fleet logged ramp stops "dig exceeded" -- board-a-Comet 864 (copper over its
# head, in a falling-water column, an affordable lateral exit east), placebo-c-Bravo 1,331 (a sealed flooded stone shaft: the
# escalation case), placebo-a-Alpha 2. The registration requires board-a and placebo-c in the draw.
#
# THE CHANGE (rows only this build writes):
#   _ceilescape_mode   once per spawn (the licence): on=0|1
#   _ceilescape        one per decision: where= at= block= held= grounded_ms= first_ms= env_ms= full_ms= left_ms= env= settled=
#                      cands= action=ceiling|lateral|wait|escalate|off -- reason
#   _needs_rescue      an escalation (one per cell per 30 min)
#
# THE INSTRUMENT IS POSITION (bot.pos on every row), not the rung's rows.
# PRIMARY (deterministic: the population is one bot that CAN be freed -- Claude design r1 P2-10, n = 1)
#   LEFT  board-a-Comet's position leaves the trap box (x 357..362, z 185..190, y <= 44) after the deploy and stays out for
#         >= 30 min of its own positions. KEEP needs it. Every other canary bot with an `action=lateral` row is reported the
#         same way (its box: +-2 around the row's `at`).
# GATES
#   G1 linked_deaths  REVERT on >= 2: a canary `_death` within 120 s after a `_ceilescape action=lateral` row of the same bot
#                     (the owner's two-death floor; one is reported by name). The fleet death gate runs as always.
#   G2 unchanged      REVERT: a `_ceilescape` row on a licence-on bot with env_ms <= left_ms and action != ceiling (the
#                     "an affordable swing takes today's path" promise). `action=off` rows are exempt.
#   G3 declined_swung REVERT: a FIRING (the bot's `_ceilescape` rows since its previous ramp_cut row, up to its next) whose
#                     last row says wait|escalate and whose ramp_cut row reads "dig exceeded". BLIND SPOT (Claude code r3 P3-2): firings
#                     reached through floodBranch and the stranded lattice write no ramp_cut row, so G3 never judges them (it
#                     cannot false-trip on them either). REPORTED, not gated: firings
#                     whose last row says ceiling and still end "dig exceeded" -- near (env_ms > left_ms - 1000: today's
#                     behaviour, no reserve on purpose) vs far (the price model is wrong: >= 2 is a WATCH).
#   ARMS              REVERT: a control `_ceilescape*` / `_needs_rescue` row after the deploy.
#   LIVENESS          canary licence on=1 >= 1 (BLOCKS KEEP).
#   INSTRUMENT        Comet's post positions in >= 75% of its 10-min buckets (else LEFT cannot be read) -- BLOCKS KEEP.
#   EXPOSURE          >= 1 canary `_ceilescape` row with action != ceiling.
# REPORTED  actions by bot; `_needs_rescue` by bot and cell; the no-air-route hold seam (a sidestep ends a water_no_air_route
#           hold: Claude design r2 P3-6); every canary death.
# --fleet   THE POST-PROMOTION TRIPWIRE (design section 6, both engines r2): every pool is read as the arm, and the report is
#           every `_ceilescape` row with action != ceiling, by bot, plus G2/G3 -- the fleet-wide population step 0 was for.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
BUCKET_S, COVERAGE, HOLD_OUT_S, LINK_S = 600, 0.75, 1800, 120
NEAR_MS = 1000
COMET = 'board-a-Comet'
COMET_BOX = ((359.0, 360.0), (186.0, 188.0), (38.5, 41.0))   # design section 9: the COLUMN (x, z, y ranges); its east cell is out (Codex code r1 P2)
RAMP_CUTS = ('_entombed_ramp_cut', '_marooned_ramp_cut')
KEEP = ('_ceilescape_mode', '_ceilescape', '_needs_rescue', '_death', '_water_no_air_route', '_water_no_air_route_ended') + RAMP_CUTS


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(b):
    return (b or '').rsplit('-', 1)[0].replace('self-', '')


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def in_box(p, box):
    (x0, x1), (z0, z1), (y0, y1) = box
    return x0 <= p[0] < x1 and z0 <= p[2] < z1 and y0 <= p[1] <= y1


def left_box(rows, bot, box, cut, newest):
    """'left' (out after the deploy and no position back inside for HOLD_OUT_S of its own positions), 'out_pending' (out, not
    yet 30 min observed), 'still_in', 'died' (a `_death` after the deploy, before it had left: a respawn is not an escape --
    Claude code r2 P1), or 'unobserved'. Only positions BEFORE the bot's first post-deploy death count. Pure."""
    death = min((r['t'] for r in rows if r['bot'] == bot and r['name'] == '_death' and r['t'] >= cut), default=None)
    ps = sorted((r['t'], r['pos']) for r in rows if r['bot'] == bot and r.get('pos') is not None and r['t'] >= cut
                and (death is None or r['t'] < death))
    if not ps:
        return 'died' if death is not None else 'unobserved'
    for i, (t, p) in enumerate(ps):
        if in_box(p, box):
            continue
        later = ps[i:]
        if any(in_box(q, box) for s, q in later if s - t <= HOLD_OUT_S):
            continue
        return 'left' if later[-1][0] - t >= HOLD_OUT_S else ('died' if death is not None else 'out_pending')
    return 'died' if death is not None else 'still_in'


def firings(rows):
    """Per bot: [(ceilescape rows of the firing, the ramp_cut row)]. PAIRED BY THE FIRING ID (Codex code r2 P2, Claude code r2
    P3-1): every `_ceilescape` row and the arms' ramp_cut rows carry `fire=<id>` from the one escapeStairUp call, so a stranded
    lattice's stair_up (which writes `_ceilescape` rows and no ramp_cut) never joins another firing. A ramp_cut row without an
    id pairs with nothing. Pure."""
    ce = defaultdict(list)
    for r in sorted(rows, key=lambda r: r['t']):
        if r['name'] == '_ceilescape':
            f = kv(r['detail']).get('fire')
            if f:
                ce[(r['bot'], f)].append(r)
    out = []
    for r in sorted(rows, key=lambda r: r['t']):
        if r['name'] in RAMP_CUTS:
            f = kv(r['detail']).get('fire')
            out.append((r['bot'], ce.get((r['bot'], f), []) if f else [], r))
    return out


def judge(rows, *, cut, cans, fleet=False):
    res = {}
    arm = (lambda b: 'canary') if fleet else (lambda b: 'canary' if pool_of(b) in cans else 'control')
    post = [r for r in rows if r['t'] >= cut]
    can = [r for r in post if arm(r['bot']) == 'canary']
    newest = max((r['t'] for r in rows), default=cut)
    # THE LICENCE AT EACH DECISION'S OWN TIME (Codex code r1 P2): a later rollback must not erase an earlier violation
    lic_t = defaultdict(list)
    for r in sorted(can, key=lambda r: r['t']):
        if r['name'] == '_ceilescape_mode':
            lic_t[r['bot']].append((r['t'], kv(r['detail']).get('on') == '1'))
    def lic_at(bot, t):
        on = None
        for ts, v in lic_t.get(bot, []):
            if ts <= t:
                on = v
        return on
    res['licence_on'] = sum(1 for b, v in lic_t.items() if v and v[-1][1])   # the LATEST licence per bot (Codex code r2 P2)
    ce = [r for r in can if r['name'] == '_ceilescape']
    res['actions'] = dict(Counter(kv(r['detail']).get('action', '?') for r in ce))
    res['actions_by_bot'] = {b: dict(Counter(kv(r['detail']).get('action', '?') for r in ce if r['bot'] == b)) for b in sorted({r['bot'] for r in ce})}
    res['exposure'] = sum(1 for r in ce if kv(r['detail']).get('action') not in ('ceiling', None))
    # G2: the unchanged promise
    g2 = []
    for r in ce:
        k = kv(r['detail'])
        e, l, a = num(k.get('env_ms')), num(k.get('left_ms')), k.get('action')
        if a in ('off', 'ceiling') or e is None or l is None or lic_at(r['bot'], r['t']) is False:
            continue
        if e <= l:
            g2.append((r['bot'], round(r['t']), a))
    res['unchanged_broken'] = len(g2); res['_g2'] = g2
    # G3: a declined swing that was swung anyway (per firing), and the reported near/far misses
    g3, near, far = [], 0, 0
    for bot, crs, cut_row in firings([r for r in post if arm(r['bot']) == 'canary']):
        if not crs or 'dig exceeded' not in (cut_row.get('detail') or ''):
            continue
        k = kv(crs[-1]['detail'])
        a = k.get('action')
        if a in ('wait', 'escalate'):
            g3.append((bot, round(cut_row['t']), a))
        elif a == 'ceiling':
            e, l = num(k.get('env_ms')), num(k.get('left_ms'))
            if e is not None and l is not None and e > l - NEAR_MS:
                near += 1
            else:
                far += 1
    res['declined_swung'] = len(g3); res['_g3'] = g3
    res['dig_exceeded_near'] = near; res['dig_exceeded_far'] = far
    res['price_watch'] = 1 if far >= 2 else 0
    # G1: deaths linked to a lateral move
    lat = defaultdict(list)
    for r in ce:
        if kv(r['detail']).get('action') == 'lateral':
            lat[r['bot']].append(r['t'])
    deaths = [(r['bot'], round(r['t']), r.get('fc')) for r in can if r['name'] == '_death']
    linked = [d for d in deaths if any(0 <= d[1] - t <= LINK_S for t in lat.get(d[0], []))]
    res['linked_deaths'] = len(linked); res['_linked'] = linked
    res['deaths_canary'] = deaths
    # ARMS
    res['rows_control'] = 0 if fleet else sum(1 for r in post if arm(r['bot']) == 'control' and r['name'] in ('_ceilescape_mode', '_ceilescape', '_needs_rescue'))
    # rescue flags
    res['needs_rescue'] = {b: sorted({kv(r['detail']).get('at', '?') for r in can if r['bot'] == b and r['name'] == '_needs_rescue'})
                           for b in sorted({r['bot'] for r in can if r['name'] == '_needs_rescue'})}
    # the no-air-route hold seam
    res['hold_ended_rows'] = sum(1 for r in can if r['name'] == '_water_no_air_route_ended')
    # PRIMARY: Comet left; INSTRUMENT: Comet observed
    ks = range(int(cut // BUCKET_S), int(newest // BUCKET_S))
    seen = {int(r['t'] // BUCKET_S) for r in post if r['bot'] == COMET and r.get('pos') is not None}
    res['comet_coverage'] = round(len(seen & set(ks)) / len(ks), 2) if len(ks) else 0.0
    res['instrument'] = 1 if res['comet_coverage'] >= COVERAGE else 0
    res['comet'] = left_box(post, COMET, COMET_BOX, cut, newest) if any(r['bot'] == COMET for r in post) else 'not in this read'
    others = {}
    for b, ts in lat.items():
        if b == COMET:
            continue
        r0 = min((r for r in ce if r['bot'] == b and kv(r['detail']).get('action') == 'lateral'), key=lambda r: r['t'])
        try:
            ax, ay, az = (float(v) for v in kv(r0['detail']).get('at', '').split(','))
        except ValueError:
            continue
        others[b] = left_box(post, b, ((ax, ax + 1), (az, az + 1), (ay - 1.5, ay + 1.0)), cut, newest)   # its own column cell
    res['others_left'] = others
    res['primary_left'] = 1 if res['comet'] == 'left' else 0
    return res


def selftest():
    cut = 1_000_000.0 * 600
    def row(bot, t, name='_affordance_scan', pos=(359.5, 40.2, 187.5), detail='', fc=None):
        return {'t': t, 'bot': bot, 'name': name, 'detail': detail, 'fc': fc, 'pos': pos}
    def stay(bot, t0, t1, at=(359.5, 40.2, 187.5)):
        return [row(bot, t, pos=at) for t in range(int(t0), int(t1), 60)]
    lic = row(COMET, cut + 5, '_ceilescape_mode', detail='on=1 reserve_ms=3000')
    LAT = 'where=ceiling at=359,40,187 block=copper_ore held=hand grounded_ms=15000 first_ms=375000 env_ms=375000 full_ms=60000 left_ms=59000 env=g0w1 settled=1000 cands=E:39850 action=lateral -- take E'
    out = stay(COMET, cut - 3600, cut + 60) + [lic, row(COMET, cut + 60, '_ceilescape', detail=LAT)] + \
        [row(COMET, t, pos=(370.5, 50.0, 180.5)) for t in range(int(cut + 120), int(cut + 7200), 60)] + stay('hive-a-Alpha', cut - 3600, cut + 7200, (0.0, 64.0, 0.0))
    ok = judge(out, cut=cut, cans={'board-a'})
    assert ok['primary_left'] == 1 and ok['instrument'] == 1 and ok['exposure'] == 1 and ok['licence_on'] == 1, ok
    assert ok['unchanged_broken'] == 0 and ok['declined_swung'] == 0 and ok['linked_deaths'] == 0 and ok['rows_control'] == 0, ok
    # PRIMARY: the designed lateral exit itself (the east cell, 360.5,40,187.5) held 59 min IS left (Codex code r1 P2)
    east = stay(COMET, cut - 3600, cut + 60) + [lic, row(COMET, cut + 60, '_ceilescape', detail=LAT)] + stay(COMET, cut + 120, cut + 3660, (360.5, 40.0, 187.5))
    assert judge(east, cut=cut, cans={'board-a'})['comet'] == 'left'
    # G2 at the decision's own time: a violation under on=1 survives a later on=0 licence
    v = out + [row(COMET, cut + 200, '_ceilescape', detail=LAT.replace('env_ms=375000', 'env_ms=15000')), row(COMET, cut + 300, '_ceilescape_mode', detail='on=0')]
    assert judge(v, cut=cut, cans={'board-a'})['unchanged_broken'] == 1
    # PRIMARY fails: still in the column
    stuck = stay(COMET, cut - 3600, cut + 7200) + [lic, row(COMET, cut + 60, '_ceilescape', detail=LAT)]
    assert judge(stuck, cut=cut, cans={'board-a'})['primary_left'] == 0
    # PRIMARY pending: out, but not yet 30 min of its own positions
    pend = stay(COMET, cut - 3600, cut + 60) + [lic] + [row(COMET, t, pos=(370.5, 50.0, 180.5)) for t in range(int(cut + 120), int(cut + 900), 60)]
    assert judge(pend, cut=cut, cans={'board-a'})['comet'] == 'out_pending'
    # PRIMARY: out, then back in inside 30 min -> not left
    back = stay(COMET, cut - 3600, cut + 60) + [lic] + [row(COMET, t, pos=(370.5, 50.0, 180.5)) for t in range(int(cut + 120), int(cut + 600), 60)] + stay(COMET, cut + 600, cut + 7200)
    assert judge(back, cut=cut, cans={'board-a'})['comet'] == 'still_in'
    # INSTRUMENT: silent after the deploy
    silent = stay(COMET, cut - 3600, cut + 60) + [lic, row(COMET, cut + 7000, pos=None)] + stay('hive-a-Alpha', cut, cut + 7200, (0.0, 64.0, 0.0))
    assert judge(silent, cut=cut, cans={'board-a'})['instrument'] == 0
    # G1: two deaths 60 s after lateral rows -> 2; control: a death 10 min later is not linked
    d2 = out + [row(COMET, cut + 3000, '_ceilescape', detail=LAT), row(COMET, cut + 120, '_death', fc='drowning'), row(COMET, cut + 3060, '_death', fc='fire')]
    assert judge(d2, cut=cut, cans={'board-a'})['linked_deaths'] == 2
    assert judge(out + [row(COMET, cut + 700, '_death', fc='fire')], cut=cut, cans={'board-a'})['linked_deaths'] == 0
    # G2: an affordable row with a non-ceiling action trips; the rollback's off row does not
    bad2 = LAT.replace('env_ms=375000', 'env_ms=15000')
    assert judge(out + [row(COMET, cut + 200, '_ceilescape', detail=bad2)], cut=cut, cans={'board-a'})['unchanged_broken'] == 1
    off = bad2.replace('action=lateral', 'action=off')
    assert judge(out + [row(COMET, cut + 200, '_ceilescape', detail=off)], cut=cut, cans={'board-a'})['unchanged_broken'] == 0
    # G3: a wait firing that ended dig exceeded trips; a ceiling near-miss is reported, not gated. Rows pair by the firing id.
    W = LAT.replace('action=lateral', 'action=wait')
    F = lambda d, f: d.replace(' action=', f' fire={f} action=')
    CUT_ = lambda f, why: f'steps=0 breached=0 climbed=0.0 fire={f} -- stopped because {why}'
    g3 = out + [row(COMET, cut + 4000, '_ceilescape', detail=F(W, 'f1')), row(COMET, cut + 4060, '_entombed_ramp_cut', detail=CUT_('f1', 'ceiling dig failed on stone: dig exceeded 59000ms'))]
    assert judge(g3, cut=cut, cans={'board-a'})['declined_swung'] == 1
    N = LAT.replace('action=lateral', 'action=ceiling').replace('env_ms=375000', 'env_ms=58500')
    nm = out + [row(COMET, cut + 4000, '_ceilescape', detail=F(N, 'f1')), row(COMET, cut + 4060, '_entombed_ramp_cut', detail=CUT_('f1', 'ceiling dig failed on stone: dig exceeded 59000ms'))]
    r = judge(nm, cut=cut, cans={'board-a'})
    assert r['declined_swung'] == 0 and r['dig_exceeded_near'] == 1 and r['dig_exceeded_far'] == 0, r
    # two firings: a wait row in an EARLIER firing does not pair with a later dig exceeded
    sep = out + [row(COMET, cut + 4000, '_ceilescape', detail=F(W, 'f1')), row(COMET, cut + 4010, '_entombed_ramp_cut', detail=CUT_('f1', 'no affordable ramp exit')),
                 row(COMET, cut + 4020, '_ceilescape', detail=F(N, 'f2')), row(COMET, cut + 4080, '_entombed_ramp_cut', detail=CUT_('f2', 'ceiling dig failed: dig exceeded 59000ms'))]
    assert judge(sep, cut=cut, cans={'board-a'})['declined_swung'] == 0
    # a stranded-lattice stair_up's wait row 65 s before an entombed firing with no row of its own (Codex code r2's reproduction,
    # and the concurrent case Claude code r2 P3-1 named) does not pair with it
    lat2 = out + [row(COMET, cut + 4100, '_ceilescape', detail=F(W, 'L1')), row(COMET, cut + 4165, '_entombed_ramp_cut', detail=CUT_('f9', 'dig failed on stone: dig exceeded 59000ms'))]
    assert judge(lat2, cut=cut, cans={'board-a'})['declined_swung'] == 0
    conc = out + [row(COMET, cut + 4150, '_ceilescape', detail=F(N, 'f9')), row(COMET, cut + 4160, '_ceilescape', detail=F(W, 'L1')),
                  row(COMET, cut + 4165, '_entombed_ramp_cut', detail=CUT_('f9', 'ceiling dig failed: dig exceeded 59000ms'))]
    rc = judge(conc, cut=cut, cans={'board-a'})
    assert rc['declined_swung'] == 0 and rc['dig_exceeded_near'] == 1, rc
    # a ramp_cut row with no id (an old build) pairs with nothing
    assert judge(out + [row(COMET, cut + 4000, '_ceilescape', detail=F(W, 'f1')), row(COMET, cut + 4060, '_entombed_ramp_cut', detail='stopped because dig exceeded 59000ms')],
                 cut=cut, cans={'board-a'})['declined_swung'] == 0
    # PRIMARY: a death is not an escape (Claude code r2 P1) -- dies in the column, respawns at home for 60 min -> died, not left
    died = stay(COMET, cut - 3600, cut + 600) + [lic, row(COMET, cut + 60, '_ceilescape', detail=LAT), row(COMET, cut + 600, '_death', fc='drowning', pos=None)] + \
        stay(COMET, cut + 610, cut + 4200, (355.5, 73.0, 147.5))
    rd = judge(died, cut=cut, cans={'board-a'})
    assert rd['comet'] == 'died' and rd['primary_left'] == 0, rd
    # ...but a bot that left alive and died much later still LEFT
    late = out + [row(COMET, cut + 7000, '_death', fc='fire', pos=None)]
    assert judge(late, cut=cut, cans={'board-a'})['comet'] == 'left'
    # LIVENESS reads the LATEST licence (Codex code r2 P2): on=1 then on=0 is not live
    assert judge(out + [row(COMET, cut + 3000, '_ceilescape_mode', detail='on=0')], cut=cut, cans={'board-a'})['licence_on'] == 0

    # ARMS: a control row after the deploy
    assert judge(out + [row('hive-a-Alpha', cut + 50, '_ceilescape_mode', detail='on=1')], cut=cut, cans={'board-a'})['rows_control'] == 1
    # --fleet: every pool is the arm; control rows are not a defect there
    assert judge(out + [row('hive-a-Alpha', cut + 50, '_ceilescape', detail=W)], cut=cut, cans=set(), fleet=True)['actions_by_bot']['hive-a-Alpha'] == {'wait': 1}
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    from lib.telemetry import Events
    fleet = '--fleet' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
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
    assert elapsed > 0 and (CAN or fleet), 'no canary declared'
    W = min(elapsed, float(args[0]) if args else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        """Rotation-aware: day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
        evw = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in evw.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    raw = load_window(PRE, END)
    rows, walked, offbuild, withpos = [], 0, 0, 0
    bots = defaultdict(set)
    for r in raw:
        b = (r.get('bot') or {}).get('name')
        t = r.get('t')
        if not b or t is None:
            continue
        walked += 1
        arm = 'canary' if (fleet or pool_of(b) in CANS) else 'control'
        per = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if not fleet and arm == 'canary' and per == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(per, arm)].add(b)
        pos = (r.get('bot') or {}).get('pos')
        p = (float(pos['x']), float(pos['y']), float(pos['z'])) if isinstance(pos, dict) and pos.get('x') is not None else None
        name = r.get('name')
        if p is not None:
            withpos += 1
        if p is not None or name in KEEP:
            sk = ((r.get('raw') or {}).get('skill') or {})
            rows.append({'t': t.timestamp(), 'name': name, 'detail': (r.get('detail') or '') if name in KEEP else '', 'bot': b,
                         'fc': sk.get('fail_class'), 'pos': p})
    res = judge(rows, cut=CUT.timestamp(), cans=CANS, fleet=fleet)
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d; rows with bot.pos %d) | bots post canary %d control %d | window %d min%s'
          % (walked, offbuild, withpos, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W, ' | FLEET TRIPWIRE' if fleet else ''))
    print('PRIMARY      board-a-Comet %s (coverage %.2f, need %.2f) -> %s | other lateral bots %s'
          % (res['comet'], res['comet_coverage'], COVERAGE, 'LEFT' if res['primary_left'] else 'NOT LEFT', json.dumps(res['others_left']) or '-'))
    print('DEFECTS      G1 deaths linked to a lateral move %d %s | G2 unchanged broken %d %s | G3 declined then swung %d %s | ARMS control rows %d'
          % (res['linked_deaths'], res['_linked'] or '', res['unchanged_broken'], res['_g2'][:5] or '', res['declined_swung'], res['_g3'][:5] or '', res['rows_control']))
    print('REPORTED     ceiling firings that still ended dig exceeded: near %d, far %d%s | needs rescue %s | hold rows ended %d'
          % (res['dig_exceeded_near'], res['dig_exceeded_far'], ' (WATCH: the price model)' if res['price_watch'] else '', json.dumps(res['needs_rescue']) or '-', res['hold_ended_rows']))
    print('ACTIONS      %s | by bot %s' % (json.dumps(res['actions']), json.dumps(res['actions_by_bot'])))
    print('LIVENESS     licence on %d | EXPOSURE %d rows with action != ceiling -> %s | INSTRUMENT -> %s | deaths %s'
          % (res['licence_on'], res['exposure'], 'READY' if res['exposure'] else 'NOT YET', 'ok' if res['instrument'] else 'BLIND', res['deaths_canary'] or '-'))
    try:
        if ovr or fleet:
            raise RuntimeError('CANARY_DRYRUN or --fleet -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        emit('ceilescaperead', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
