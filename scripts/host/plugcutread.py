#!/usr/bin/env python3
# plugcutread.py [window_min] [--selftest] [--fleet] -- the read for canary `plugcut-01` (plug the wet face, then cut: a bot
# pinned in a water pit under a ceiling refused for ONE wet face plugs that face with its own block and cuts; the step after
# the cut is plugged the same way). Design: docs/reports/plugcut-01-design-2026-10-24.md. CANARY_DRYRUN=pool[,pool]:sha:iso
# for dry runs (never emits). DENOMINATORS FIRST.
#
# WHY (ES 3 d to 10-24 13:00Z): 51 of 76 bots with a climb-flood refusal reached the licence (a 4th consecutive refusal);
# the shape this rung acts on (the ceiling refused for water BESIDE it) is placebo-d-Delta 657 licensed firings,
# isolated-d-Bravo 638, isolated-c-Alpha 637, isolated-d-Alpha 448, scattered 1-13 elsewhere. placebo-d-Delta is the one
# named bot a canary can draw (isolated-* and placebo-c are never drawn): the registration requires placebo-d.
#
# THE CHANGE (rows only this build writes):
#   _plugcut_mode  once per spawn (the licence): on=0|1 after_refusals= max_plugs= rounds= clear_up= budget_s=
#   _plugcut       one per placement attempt: at=<frame> for=ceiling|step:x,z cell=<offset> ref= block= result=placed|failed|
#                  refused|stopped plugged= sub0=0|1|- sub=0|1 -- why   (sub0 = the head at the decision; sub = now)
#
# THE INSTRUMENT IS POSITION (bot.pos on every row), not the rung's rows.
# PRIMARY (deterministic, n = 1)
#   LEFT  placebo-d-Delta's position leaves its pit (x 197..199, z 186..188, y <= 36.5) after the deploy and stays out for
#         >= 30 min of its own positions; a death first is 'died', never 'left'. KEEP needs it. AND IT WAS IN THE PIT AT THE
#         DEPLOY (Claude r1 P1): its newest position in the 30 min before the cut is inside the box, else
#         'not_in_pit_at_deploy' (cannot KEEP). Every other canary bot with a `result=placed` row is reported the same way (its
#         box: +-1 around the row's frame, y <= frame + 1.5).
# GATES
#   G1 linked_deaths  REVERT on >= 2: a canary `_death` within 120 s after a `_plugcut result=placed` row of the same bot (the
#                     owner's two-death floor; one is reported by name). The fleet death gate runs as always.
#   G2 placed_submerged REVERT: a `result=placed` row with sub0=1 -- the head under at the DECISION (the planner refuses a
#                     submerged bot by construction). `sub=` (after the settle) is reported only: a bot sinking after a
#                     placement is not a defect (Codex r1 P2, Claude r1 P1).
#   ARMS              REVERT: a control `_plugcut*` row after the deploy.
#   LIVENESS          canary licence on=1 >= 1 (BLOCKS KEEP).
#   INSTRUMENT        placebo-d-Delta's post positions in >= 75% of its 10-min buckets -- BLOCKS KEEP.
#   EXPOSURE          >= 1 canary `_plugcut` row (any result).
# REPORTED  results by bot and `for=`; the commonest refusal reasons; `_climb_flood_breach` rows at a cell the same bot plugged
#           (>= 2 is a WATCH: the submerged exemption can dig a plug out, Paper probe 3); licensed ramps that progressed;
#           every canary death.
# --fleet   THE POST-PROMOTION TRIPWIRE: every pool is the arm; the report is every bot's `_plugcut` rows and its LEFT state,
#           plus G1/G2 -- the isolated-* bots (isolated-c-Alpha, isolated-d-Bravo, isolated-d-Alpha) are read only here.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

KV = re.compile(r'(?:^| )([a-z_][a-z_0-9]*)=(\S+)')
BUCKET_S, COVERAGE, HOLD_OUT_S, LINK_S, BREACH_S = 600, 0.75, 1800, 120, 120
DELTA = 'placebo-d-Delta'
DELTA_BOX = ((197.0, 200.0), (186.0, 189.0), (-64.0, 36.5))     # the pit: one cell around (198,34,187), feet <= y 36
KEEP = ('_plugcut_mode', '_plugcut', '_death', '_climb_flood_breach', '_climb_flood_ramp')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(b):
    return (b or '').rsplit('-', 1)[0].replace('self-', '')


def xyz(s):
    try:
        x, y, z = (int(float(v)) for v in (s or '').split(','))
        return (x, y, z)
    except ValueError:
        return None


def in_box(p, box):
    (x0, x1), (z0, z1), (y0, y1) = box
    return x0 <= p[0] < x1 and z0 <= p[2] < z1 and y0 <= p[1] <= y1


def left_box(rows, bot, box, cut):
    """'left' (out after the deploy, no position back inside for HOLD_OUT_S of its own positions), 'out_pending', 'still_in',
    'died' (a `_death` after the deploy before it had left: a respawn is not an escape) or 'unobserved'. Only positions BEFORE
    the bot's first post-deploy death count. Pure."""
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


def judge(rows, *, cut, cans, fleet=False):
    res = {}
    arm = (lambda b: 'canary') if fleet else (lambda b: 'canary' if pool_of(b) in cans else 'control')
    post = [r for r in rows if r['t'] >= cut]
    can = [r for r in post if arm(r['bot']) == 'canary']
    newest = max((r['t'] for r in rows), default=cut)
    lic = {}
    for r in sorted(can, key=lambda r: r['t']):
        if r['name'] == '_plugcut_mode':
            lic[r['bot']] = kv(r['detail']).get('on') == '1'      # the LATEST licence per bot
    res['licence_on'] = sum(1 for v in lic.values() if v)
    pc = [r for r in can if r['name'] == '_plugcut']
    res['exposure'] = len(pc)
    res['results'] = dict(Counter(kv(r['detail']).get('result', '?') for r in pc))
    res['by_bot'] = {b: dict(Counter(f"{kv(r['detail']).get('for', '?')}:{kv(r['detail']).get('result', '?')}" for r in pc if r['bot'] == b))
                     for b in sorted({r['bot'] for r in pc})}
    res['refusals_top'] = Counter((r['detail'].split(' -- ', 1)[-1])[:80] for r in pc if kv(r['detail']).get('result') == 'refused').most_common(5)
    placed = [r for r in pc if kv(r['detail']).get('result') == 'placed']
    # G2: a placement with the head under
    g2 = [(r['bot'], round(r['t'])) for r in placed if kv(r['detail']).get('sub0') == '1']
    res['placed_sank_after'] = sum(1 for r in placed if kv(r['detail']).get('sub0') == '0' and kv(r['detail']).get('sub') == '1')
    res['placed_submerged'] = len(g2); res['_g2'] = g2
    # G1: deaths linked to a placement
    pt = defaultdict(list)
    for r in placed:
        pt[r['bot']].append(r['t'])
    deaths = [(r['bot'], round(r['t']), r.get('fc')) for r in can if r['name'] == '_death']
    linked = [d for d in deaths if any(0 <= d[1] - t <= LINK_S for t in pt.get(d[0], []))]
    res['linked_deaths'] = len(linked); res['_linked'] = linked
    res['deaths_canary'] = deaths
    # REPORTED: a breach at a cell the same bot plugged (absolute: the frame + the offset) within BREACH_S
    cells = defaultdict(list)
    for r in placed:
        k = kv(r['detail'])
        a, c = xyz(k.get('at')), xyz(k.get('cell'))
        if a and c:
            cells[r['bot']].append((r['t'], (a[0] + c[0], a[1] + c[1], a[2] + c[2])))
    br = []
    for r in can:
        if r['name'] != '_climb_flood_breach':
            continue
        c = xyz(kv(r['detail']).get('cell'))
        if c and any(c == q and 0 <= r['t'] - t <= BREACH_S for t, q in cells.get(r['bot'], [])):
            br.append((r['bot'], round(r['t']), c))
    res['plug_breaches'] = len(br); res['_breaches'] = br
    res['breach_watch'] = 1 if len(br) >= 2 else 0
    res['ramps_progressed'] = sum(1 for r in can if r['name'] == '_climb_flood_ramp' and r.get('status') == 'success'
                                  and (kv(r['detail']).get('plugged') or '0') != '0')
    # ARMS
    res['rows_control'] = 0 if fleet else sum(1 for r in post if arm(r['bot']) == 'control' and r['name'] in ('_plugcut_mode', '_plugcut'))
    # PRIMARY + INSTRUMENT
    ks = range(int(cut // BUCKET_S), int(newest // BUCKET_S))
    seen = {int(r['t'] // BUCKET_S) for r in post if r['bot'] == DELTA and r.get('pos') is not None}
    res['delta_coverage'] = round(len(seen & set(ks)) / len(ks), 2) if len(ks) else 0.0
    res['instrument'] = 1 if res['delta_coverage'] >= COVERAGE else 0
    pre = sorted((r['t'], r['pos']) for r in rows if r['bot'] == DELTA and r.get('pos') is not None and cut - HOLD_OUT_S <= r['t'] < cut)
    res['delta_in_pit_at_deploy'] = 1 if pre and in_box(pre[-1][1], DELTA_BOX) else 0
    if not any(r['bot'] == DELTA for r in post):
        res['delta'] = 'not in this read'
    elif not res['delta_in_pit_at_deploy']:
        res['delta'] = 'not_in_pit_at_deploy'
    else:
        res['delta'] = left_box(post, DELTA, DELTA_BOX, cut)
    others = {}
    for b in sorted(pt):
        if b == DELTA:
            continue
        r0 = min((r for r in placed if r['bot'] == b), key=lambda r: r['t'])
        a = xyz(kv(r0['detail']).get('at'))
        if a:
            others[b] = left_box(post, b, ((a[0] - 1.0, a[0] + 2.0), (a[2] - 1.0, a[2] + 2.0), (-64.0, a[1] + 1.5)), cut)
    res['others_left'] = others
    res['primary_left'] = 1 if res['delta'] == 'left' else 0
    return res


def selftest():
    cut = 1_000_000.0 * 600
    def row(bot, t, name='_affordance_scan', pos=(198.3, 34.1, 187.7), detail='', fc=None, status=None):
        return {'t': t, 'bot': bot, 'name': name, 'detail': detail, 'fc': fc, 'pos': pos, 'status': status}
    def stay(bot, t0, t1, at=(198.3, 34.1, 187.7)):
        return [row(bot, t, pos=at) for t in range(int(t0), int(t1), 60)]
    lic = row(DELTA, cut + 5, '_plugcut_mode', detail='on=1 after_refusals=3 max_plugs=3 rounds=3 clear_up=2 budget_s=90')
    P = 'at=198,34,187 for=ceiling cell=0,2,-1 ref=0,1,-1 block=dirt result=placed plugged=1 sub0=0 sub=0 -- dirt'
    out = stay(DELTA, cut - 3600, cut + 240) + [lic, row(DELTA, cut + 240, '_plugcut', detail=P)] + \
        [row(DELTA, t, pos=(198.5, 33.0, 190.5)) for t in range(int(cut + 300), int(cut + 7200), 60)] + stay('hive-a-Alpha', cut - 3600, cut + 7200, (0.0, 64.0, 0.0))
    ok = judge(out, cut=cut, cans={'placebo-d'})
    assert ok['primary_left'] == 1 and ok['instrument'] == 1 and ok['exposure'] == 1 and ok['licence_on'] == 1, ok
    assert ok['placed_submerged'] == 0 and ok['linked_deaths'] == 0 and ok['rows_control'] == 0 and ok['plug_breaches'] == 0, ok
    # PRIMARY fails: still in the pit (one cell over is still the pit)
    stuck = stay(DELTA, cut - 3600, cut + 7200, (199.4, 34.1, 188.2)) + [lic]
    assert judge(stuck, cut=cut, cans={'placebo-d'})['primary_left'] == 0
    # ...and two blocks up IS out (the climb leaves the box by height)
    up = stay(DELTA, cut - 3600, cut + 60) + [lic] + stay(DELTA, cut + 120, cut + 3900, (198.5, 37.0, 187.5))
    assert judge(up, cut=cut, cans={'placebo-d'})['delta'] == 'left'
    # PRIMARY pending; out then back in
    pend = stay(DELTA, cut - 3600, cut + 60) + [lic] + [row(DELTA, t, pos=(198.5, 33.0, 190.5)) for t in range(int(cut + 120), int(cut + 900), 60)]
    assert judge(pend, cut=cut, cans={'placebo-d'})['delta'] == 'out_pending'
    back = stay(DELTA, cut - 3600, cut + 60) + [lic] + [row(DELTA, t, pos=(198.5, 33.0, 190.5)) for t in range(int(cut + 120), int(cut + 600), 60)] + stay(DELTA, cut + 600, cut + 7200)
    assert judge(back, cut=cut, cans={'placebo-d'})['delta'] == 'still_in'
    # a death is not an escape; a late death after leaving is still LEFT
    died = stay(DELTA, cut - 3600, cut + 600) + [lic, row(DELTA, cut + 600, '_death', fc='drowning', pos=None)] + stay(DELTA, cut + 610, cut + 4200, (300.5, 70.0, 300.5))
    assert judge(died, cut=cut, cans={'placebo-d'})['delta'] == 'died'
    assert judge(out + [row(DELTA, cut + 7000, '_death', fc='fire', pos=None)], cut=cut, cans={'placebo-d'})['delta'] == 'left'
    # INSTRUMENT: silent after the deploy
    silent = stay(DELTA, cut - 3600, cut + 60) + [lic, row(DELTA, cut + 7000, pos=None)] + stay('hive-a-Alpha', cut, cut + 7200, (0.0, 64.0, 0.0))
    assert judge(silent, cut=cut, cans={'placebo-d'})['instrument'] == 0
    # G1: two deaths within 120 s of placements -> 2; a death 10 min later is not linked
    d2 = out + [row(DELTA, cut + 3000, '_plugcut', detail=P), row(DELTA, cut + 300, '_death', fc='drowning'), row(DELTA, cut + 3060, '_death', fc='fire')]
    assert judge(d2, cut=cut, cans={'placebo-d'})['linked_deaths'] == 2
    assert judge(out + [row(DELTA, cut + 900, '_death', fc='fire')], cut=cut, cans={'placebo-d'})['linked_deaths'] == 0
    # G2: a placement decided with the head under trips; one that sank AFTER (sub0=0 sub=1) is reported, not gated; a refused
    # row with sub0=1 does not trip
    assert judge(out + [row(DELTA, cut + 260, '_plugcut', detail=P.replace('sub0=0', 'sub0=1'))], cut=cut, cans={'placebo-d'})['placed_submerged'] == 1
    sank = judge(out + [row(DELTA, cut + 260, '_plugcut', detail=P.replace(' sub=0', ' sub=1'))], cut=cut, cans={'placebo-d'})
    assert sank['placed_submerged'] == 0 and sank['placed_sank_after'] == 1, sank
    R_ = P.replace('result=placed', 'result=refused').replace('sub0=0', 'sub0=1')
    assert judge(out + [row(DELTA, cut + 260, '_plugcut', detail=R_)], cut=cut, cans={'placebo-d'})['placed_submerged'] == 0
    # PRIMARY: a Delta already OUT at the deploy cannot KEEP (Claude r1 P1)
    away = stay(DELTA, cut - 3600, cut, (300.5, 70.0, 300.5)) + [lic] + stay(DELTA, cut + 60, cut + 7200, (300.5, 70.0, 300.5))
    ra = judge(away, cut=cut, cans={'placebo-d'})
    assert ra['delta'] == 'not_in_pit_at_deploy' and ra['primary_left'] == 0, ra
    # REPORTED: a breach at the plugged cell (198,36,186) within 120 s; one elsewhere or later does not count
    B = lambda c: f'caller=ramp_step cell={c} before=dirt liquid=water submerged=1 exempt=1'
    rb = judge(out + [row(DELTA, cut + 300, '_climb_flood_breach', detail=B('198,36,186')), row(DELTA, cut + 300, '_climb_flood_breach', detail=B('198,37,186')),
                      row(DELTA, cut + 900, '_climb_flood_breach', detail=B('198,36,186'))], cut=cut, cans={'placebo-d'})
    assert rb['plug_breaches'] == 1 and rb['breach_watch'] == 0, rb
    # ARMS: a control row after the deploy; LIVENESS reads the latest licence
    assert judge(out + [row('hive-a-Alpha', cut + 50, '_plugcut_mode', detail='on=1')], cut=cut, cans={'placebo-d'})['rows_control'] == 1
    assert judge(out + [row(DELTA, cut + 3000, '_plugcut_mode', detail='on=0')], cut=cut, cans={'placebo-d'})['licence_on'] == 0
    # another canary bot that placed is reported by its own frame box
    o2 = out + [row('placebo-d-Comet', cut + 100, '_plugcut', pos=(50.5, 20.0, 50.5), detail=P.replace('at=198,34,187', 'at=50,20,50'))] + \
        [row('placebo-d-Comet', t, pos=(50.5, 23.0, 50.5)) for t in range(int(cut + 160), int(cut + 4000), 60)]
    assert judge(o2, cut=cut, cans={'placebo-d'})['others_left'] == {'placebo-d-Comet': 'left'}
    # --fleet: every pool is the arm; control rows are not a defect there
    fl = judge(out + [row('isolated-c-Alpha', cut + 50, '_plugcut', detail=P)], cut=cut, cans=set(), fleet=True)
    assert fl['rows_control'] == 0 and 'isolated-c-Alpha' in fl['by_bot'], fl
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
                         'fc': sk.get('fail_class'), 'status': sk.get('status'), 'pos': p})
    res = judge(rows, cut=CUT.timestamp(), cans=CANS, fleet=fleet)
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d; rows with bot.pos %d) | bots post canary %d control %d | window %d min%s'
          % (walked, offbuild, withpos, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W, ' | FLEET TRIPWIRE' if fleet else ''))
    print('PRIMARY      placebo-d-Delta %s (in the pit at the deploy %d; coverage %.2f, need %.2f) -> %s | other placing bots %s'
          % (res['delta'], res['delta_in_pit_at_deploy'], res['delta_coverage'], COVERAGE, 'LEFT' if res['primary_left'] else 'NOT LEFT', json.dumps(res['others_left']) or '-'))
    print('DEFECTS      G1 deaths linked to a placement %d %s | G2 placed with the head under (at the decision) %d %s (sank after: %d, reported) | ARMS control rows %d'
          % (res['linked_deaths'], res['_linked'] or '', res['placed_submerged'], res['_g2'][:5] or '', res['placed_sank_after'], res['rows_control']))
    print('REPORTED     breaches at a plugged cell %d %s%s | licensed ramps that progressed %d | top refusals %s'
          % (res['plug_breaches'], res['_breaches'][:5] or '', ' (WATCH)' if res['breach_watch'] else '', res['ramps_progressed'], json.dumps(res['refusals_top'])))
    print('RESULTS      %s | by bot %s' % (json.dumps(res['results']), json.dumps(res['by_bot'])))
    print('LIVENESS     licence on %d | EXPOSURE %d _plugcut rows -> %s | INSTRUMENT -> %s | deaths %s'
          % (res['licence_on'], res['exposure'], 'READY' if res['exposure'] else 'NOT YET', 'ok' if res['instrument'] else 'BLIND', res['deaths_canary'] or '-'))
    try:
        if ovr or fleet:
            raise RuntimeError('CANARY_DRYRUN or --fleet -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        emit('plugcutread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
