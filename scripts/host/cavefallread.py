#!/usr/bin/env python3
# cavefallread.py [window_min] [--selftest] [--fleet] -- the read for canary `cavefall-01` (gather never digs a floor with a
# harmful drop under it). Design: docs/reports/cavefall-01-design-2026-10-24.md section 8.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). DENOMINATORS FIRST.
#
# WHY (ES, 7 d to 10-24 13:00Z): 96 fall-family deaths of 278; gather 44 of them in 1,400 gather bot-h (31 per 1,000 h, the
# highest of any skill). Above 13 of 67 shared-seed cave landings the backup holds a one-block hole in a floor (19% vs 5% at
# control cells): bots digging the floor under their own feet over a cave. The canary removes that dig.
#
# THE CHANGE (rows only this build writes):
#   _cavefall_mode    once per spawn (the licence): on=0|1 rule=floor_over_drop ...
#   _cavefall_skip    per gather round with a skip: "<block>: N of M exposed candidate(s) are floors over a harmful drop; skipped"
#   _cavefall_floor   "refused: <block> at x,y,z; drop D onto K (damage N)" at the dig; "allowed: ..." for a standing floor dig
#                     with drop >= 2 or water
# GATES
#   G1 allowed_fell   REVERT: a canary fall episode (fell >= 6) whose onset is within 5 s after an `allowed` row of the same
#                     bot, landing within 1.5 (x, z) of the row's target, falling more than the row's drop + 2.
#   G2 refused_fell   REVERT: within 60 s after a `refused` row, the same bot's position inside the refused cell's column
#                     (x, z within 0.5 of its centre) and >= 6 below its top: the refused floor went anyway.
#   ARMS              REVERT: a control `_cavefall_*` row after the deploy.
#   LIVENESS          canary licence on=1 (the latest per bot) >= 1 (BLOCKS KEEP).
#   EXPOSURE          >= 5 canary `_cavefall_skip` + `_cavefall_floor refused` rows.
# PRIMARY (REPORTED; KEEP does not need it): gather fall episodes (fell >= 12, deduplicated per bot within 10 s, inside a
#   gather run's interval, feet not water) per gather bot-hour, canary vs control, pre vs post: the DiD.
# REPORTED  fall-family deaths by cause (two-death floor: one is named, not a verdict); skips and refusals by bot; gather
#           success per run canary / control (the no-harm HOLD is immobiledid's, registered beside this read).
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

ONSET_S, LAND_XZ, EXTRA_DROP, G2_S, G2_DEPTH, EP_S, EXPOSE_MIN = 5, 1.5, 2, 60, 6, 10, 5
FLOOR = re.compile(r'^(allowed|refused): (\S+) at (-?\d+),(-?\d+),(-?\d+); drop ([\d.]+|\?) onto (\w+)')
FELL = re.compile(r'fell (\d+)')
ONSET = re.compile(r'descent (\d+)s ago')
FEET = re.compile(r'feet (\S+) head')
FALL_CAUSES = ('fell from a high place', 'hit the ground', 'doomed to fall', 'stalagmite', 'stalactite', 'fell off')
KEEP = ('_cavefall_mode', '_cavefall_skip', '_cavefall_floor', '_fall_path', '_death', 'gather')


def kv(d):
    return {m.group(1): m.group(2) for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or '')}


def pool_of(b):
    return (b or '').rsplit('-', 1)[0].replace('self-', '')


def floor_row(d):
    """'allowed: dirt at 3,29,6; drop 2 onto solid (damage 0)' -> dict, or None. Pure."""
    m = FLOOR.match(d or '')
    if not m:
        return None
    return {'decision': m.group(1), 'block': m.group(2), 'at': (int(m.group(3)), int(m.group(4)), int(m.group(5))),
            'drop': None if m.group(6) == '?' else float(m.group(6)), 'landing': m.group(7)}


def episodes(rows):
    """Fall episodes per bot from `_fall_path` rows: rows of one bot within EP_S merge (a damage row and its death row are one
    descent). Each: bot, t (the row's time), onset (t - 'descent Ns ago', else t - 1.5), fell (max), pos (the landing),
    death (any death row), feet (the first named feet cell). Pure."""
    out = []
    last = {}
    for r in sorted((r for r in rows if r['name'] == '_fall_path'), key=lambda r: r['t']):
        d = r['detail'] or ''
        m = FELL.search(d)
        if not m:
            continue
        fell = int(m.group(1))
        o = ONSET.search(d)
        onset = r['t'] - (int(o.group(1)) if o else 1.5)
        f = FEET.search(d)
        e = last.get(r['bot'])
        if e and r['t'] - e['t'] <= EP_S:
            e['fell'] = max(e['fell'], fell); e['death'] = e['death'] or d.startswith('death'); e['onset'] = min(e['onset'], onset)
            e['feet'] = e['feet'] or (f.group(1) if f else None)
            e['pos'] = r.get('pos') or e['pos']
            continue
        e = {'bot': r['bot'], 't': r['t'], 'onset': onset, 'fell': fell, 'pos': r.get('pos'), 'death': d.startswith('death'),
             'feet': f.group(1) if f else None}
        out.append(e); last[r['bot']] = e
    return out


def gather_intervals(rows):
    """Per bot: [(start, end)] of gather runs; a skill row's t is its START and `dur` its duration. Pure."""
    iv = defaultdict(list)
    for r in rows:
        if r['name'] == 'gather' and r.get('dur') is not None:
            iv[r['bot']].append((r['t'], r['t'] + r['dur'] / 1000.0))
    return iv


def inside(iv, bot, t):
    return any(a - 1 <= t <= b + 1 for a, b in iv.get(bot, ()))


def judge(rows, *, cut, cans, fleet=False, pre_s=None):
    res = {}
    arm = (lambda b: 'canary') if fleet else (lambda b: 'canary' if pool_of(b) in cans else 'control')
    post = [r for r in rows if r['t'] >= cut]
    can = [r for r in post if arm(r['bot']) == 'canary']
    lic = defaultdict(list)
    for r in sorted(can, key=lambda r: r['t']):
        if r['name'] == '_cavefall_mode':
            lic[r['bot']].append(kv(r['detail']).get('on') == '1')
    res['licence_on'] = sum(1 for v in lic.values() if v and v[-1])
    floors = [(r, floor_row(r['detail'])) for r in can if r['name'] == '_cavefall_floor']
    floors = [(r, f) for r, f in floors if f]
    skips = [r for r in can if r['name'] == '_cavefall_skip']
    res['skips'] = len(skips)
    res['refused'] = sum(1 for _, f in floors if f['decision'] == 'refused')
    res['allowed'] = sum(1 for _, f in floors if f['decision'] == 'allowed')
    res['exposure'] = res['skips'] + res['refused']
    res['exposure_ready'] = 1 if res['exposure'] >= EXPOSE_MIN else 0
    res['by_bot'] = {b: {'skip': sum(1 for r in skips if r['bot'] == b), 'refused': sum(1 for r, f in floors if r['bot'] == b and f['decision'] == 'refused'),
                         'allowed': sum(1 for r, f in floors if r['bot'] == b and f['decision'] == 'allowed')}
                     for b in sorted({r['bot'] for r in skips} | {r['bot'] for r, _ in floors})}
    eps = episodes(rows)
    ceps = [e for e in eps if e['t'] >= cut and arm(e['bot']) == 'canary']
    # G1: an allowed floor dig followed by a fall bigger than predicted, at that column
    g1 = []
    for r, f in floors:
        if f['decision'] != 'allowed':
            continue
        tx, ty, tz = f['at']
        for e in ceps:
            if e['bot'] != r['bot'] or not (r['t'] <= e['onset'] <= r['t'] + ONSET_S) or e['fell'] < 6 or not e['pos']:
                continue
            if abs(e['pos'][0] - (tx + 0.5)) <= LAND_XZ and abs(e['pos'][2] - (tz + 0.5)) <= LAND_XZ and e['fell'] > (f['drop'] or 0) + EXTRA_DROP:
                g1.append((r['bot'], round(r['t']), f['at'], e['fell']))
    res['allowed_fell'] = len(g1); res['_g1'] = g1
    # G2: a refused floor the bot fell through anyway
    g2 = []
    pos_by = defaultdict(list)
    for r in can:
        if r.get('pos') is not None:
            pos_by[r['bot']].append((r['t'], r['pos']))
    for r, f in floors:
        if f['decision'] != 'refused':
            continue
        tx, ty, tz = f['at']
        for t, p in pos_by.get(r['bot'], ()):
            if r['t'] < t <= r['t'] + G2_S and abs(p[0] - (tx + 0.5)) <= 0.5 and abs(p[2] - (tz + 0.5)) <= 0.5 and p[1] <= ty + 1 - G2_DEPTH:
                g2.append((r['bot'], round(r['t']), f['at'], round(p[1], 1)))
                break
    res['refused_fell'] = len(g2); res['_g2'] = g2
    res['rows_control'] = 0 if fleet else sum(1 for r in post if arm(r['bot']) == 'control' and r['name'].startswith('_cavefall'))
    # PRIMARY: gather fall episodes (fell >= 12, not into water) per gather bot-hour, by arm and period
    iv = gather_intervals(rows)
    lo = cut - (pre_s if pre_s is not None else 0)
    cells = {}
    for a in ('canary', 'control'):
        for per in ('pre', 'post'):
            in_per = (lambda t: t >= cut) if per == 'post' else (lambda t: lo <= t < cut)
            hrs = sum(min(e, cut if per == 'pre' else 1e18) - max(s, lo if per == 'pre' else cut)
                      for b, ivs in iv.items() if arm(b) == a for s, e in ivs
                      if (in_per(s) or in_per(e))) / 3600.0
            n = sum(1 for e in eps if arm(e['bot']) == a and in_per(e['t']) and e['fell'] >= 12 and inside(iv, e['bot'], e['onset'])
                    and not (e['feet'] or '').startswith(('water', 'bubble_column')))
            cells[(a, per)] = (n, round(max(hrs, 0.0), 2))
    rate = lambda c: (c[0] / c[1]) if c[1] > 0 else None
    r_ = {k: rate(v) for k, v in cells.items()}
    res['primary'] = {f'{a}_{p}': {'episodes': cells[(a, p)][0], 'gather_bot_h': cells[(a, p)][1], 'per_h': None if r_[(a, p)] is None else round(r_[(a, p)], 4)}
                      for a in ('canary', 'control') for p in ('pre', 'post')}
    res['primary_did'] = None if None in r_.values() else round((r_[('canary', 'post')] - r_[('canary', 'pre')]) - (r_[('control', 'post')] - r_[('control', 'pre')]), 4)
    # deaths, fall family, by arm (post)
    deaths = defaultdict(Counter)
    for r in post:
        if r['name'] == '_death':
            d = (r['detail'] or '').lower()
            c = next((k for k in FALL_CAUSES if k in d), None)
            if c and 'lava' not in d:
                deaths[arm(r['bot'])][c] += 1
    res['fall_deaths'] = {a: dict(deaths[a]) for a in ('canary', 'control')}
    res['fall_deaths_canary_named'] = [(r['bot'], round(r['t']), (r['detail'] or '')[:80]) for r in can if r['name'] == '_death'
                                       and any(k in (r['detail'] or '').lower() for k in FALL_CAUSES)]
    # gather success per run, post (reported; the HOLD is immobiledid's)
    g = {a: Counter() for a in ('canary', 'control')}
    for r in post:
        if r['name'] == 'gather':
            g[arm(r['bot'])]['runs'] += 1; g[arm(r['bot'])]['ok'] += 1 if r.get('status') == 'success' else 0
    res['gather'] = {a: dict(g[a]) for a in g}
    oc, ok = (g['canary']['ok'] / g['canary']['runs'] if g['canary']['runs'] else None), (g['control']['ok'] / g['control']['runs'] if g['control']['runs'] else None)
    res['gather_ok_ratio'] = round(oc / ok, 3) if oc is not None and ok else None
    return res


def selftest():
    cut = 1_000_000.0 * 600
    def row(bot, t, name='_affordance_scan', pos=(3.5, 30.0, 6.5), detail='', status='success', dur=None):
        return {'t': t, 'bot': bot, 'name': name, 'detail': detail, 'pos': pos, 'status': status, 'dur': dur}
    C, K = 'board-a-Comet', 'hive-a-Alpha'
    lic = row(C, cut + 5, '_cavefall_mode', detail='on=1 rule=floor_over_drop safe_drop=3')
    base = [lic] + [row(C, cut + 10 + i, '_cavefall_skip', detail='dirt: 3 of 9 exposed candidate(s) are floors over a harmful drop; skipped') for i in range(5)]
    ok = judge(base, cut=cut, cans={'board-a'})
    assert ok['licence_on'] == 1 and ok['exposure'] == 5 and ok['exposure_ready'] == 1 and ok['allowed_fell'] == 0 and ok['refused_fell'] == 0 and ok['rows_control'] == 0, ok
    # G1: an allowed 2-block floor dig, then a 21-block fall at that column 2 s later -> 1; a 3-block fall -> 0; another column -> 0
    A = row(C, cut + 100, '_cavefall_floor', detail='allowed: dirt at 3,29,6; drop 2 onto solid (damage 0)')
    fall = lambda t, fell, pos=(3.5, 8.7, 6.5): row(C, t, '_fall_path', pos=pos, detail=f'candidate damage: fell {fell}, hp -20; descent 1s ago: path none; ... running gather; ctl none; feet air head air')
    assert judge(base + [A, fall(cut + 103, 21)], cut=cut, cans={'board-a'})['allowed_fell'] == 1
    assert judge(base + [A, fall(cut + 103, 4)], cut=cut, cans={'board-a'})['allowed_fell'] == 0
    assert judge(base + [A, fall(cut + 103, 21, (12.5, 8.7, 6.5))], cut=cut, cans={'board-a'})['allowed_fell'] == 0
    assert judge(base + [A, fall(cut + 140, 21)], cut=cut, cans={'board-a'})['allowed_fell'] == 0
    # G2: refused at 3,29,6, then positions in that column 21 below -> 1; on the shelf -> 0; beside the column -> 0
    R = row(C, cut + 200, '_cavefall_floor', detail='refused: dirt at 3,29,6; drop 21.3125 onto stalagmite (damage 41)')
    assert judge(base + [R, row(C, cut + 230, pos=(3.5, 8.7, 6.5))], cut=cut, cans={'board-a'})['refused_fell'] == 1
    assert judge(base + [R, row(C, cut + 230, pos=(3.5, 30.0, 6.5))], cut=cut, cans={'board-a'})['refused_fell'] == 0
    assert judge(base + [R, row(C, cut + 230, pos=(5.5, 8.7, 6.5))], cut=cut, cans={'board-a'})['refused_fell'] == 0
    assert judge(base + [R, row(C, cut + 300, pos=(3.5, 8.7, 6.5))], cut=cut, cans={'board-a'})['refused_fell'] == 0
    assert judge(base + [R], cut=cut, cans={'board-a'})['refused'] == 1
    # ARMS: a control row after the deploy
    assert judge(base + [row(K, cut + 50, '_cavefall_mode', detail='on=1')], cut=cut, cans={'board-a'})['rows_control'] == 1
    # LIVENESS reads the latest licence
    assert judge(base + [row(C, cut + 900, '_cavefall_mode', detail='on=0')], cut=cut, cans={'board-a'})['licence_on'] == 0
    # EXPOSURE below 5 is not ready
    assert judge([lic, row(C, cut + 10, '_cavefall_skip', detail='x')], cut=cut, cans={'board-a'})['exposure_ready'] == 0
    # episodes: a damage row and its death row 0.2 s apart are ONE descent; 30 s apart, two
    ep = episodes([fall(cut + 1, 21), row(C, cut + 1.2, '_fall_path', detail='death (fall): fell 22; descent: path unknown'), fall(cut + 40, 13)])
    assert len(ep) == 2 and ep[0]['fell'] == 22 and ep[0]['death'], ep
    # PRIMARY: gather-attributed, >= 12, not water; pre and post cells and the DiD
    G = lambda b, t, dur: row(b, t, 'gather', dur=dur * 1000)
    pre_s = 3600
    rows = [lic,
            G(C, cut - 3000, 1000), fall(cut - 2500, 20), fall(cut - 2400, 14),           # canary pre: 2 episodes in 1000 s
            G(C, cut + 100, 1000), fall(cut + 500, 30, (3.5, 0, 6.5)),                    # canary post: 1
            row(C, cut + 600, '_fall_path', pos=(3.5, 0, 6.5), detail='candidate damage: fell 25, hp -5; descent 1s ago; ctl none; feet water head water'),   # water: not counted
            row(C, cut + 5000, '_fall_path', detail='candidate damage: fell 25, hp -5; descent 1s ago; feet air head air'),     # outside gather: not counted
            G(K, cut - 3000, 1000), row(K, cut - 2500, '_fall_path', pos=(0, 0, 0), detail='candidate damage: fell 20; descent 1s ago; feet air head air'),
            G(K, cut + 100, 1000), row(K, cut + 500, '_fall_path', pos=(0, 0, 0), detail='candidate damage: fell 20; descent 1s ago; feet air head air')]
    p = judge(rows, cut=cut, cans={'board-a'}, pre_s=pre_s)
    assert p['primary']['canary_pre']['episodes'] == 2 and p['primary']['canary_post']['episodes'] == 1, p['primary']
    assert p['primary']['control_pre']['episodes'] == 1 and p['primary']['control_post']['episodes'] == 1, p['primary']
    assert p['primary_did'] is not None and p['primary_did'] < 0, p['primary_did']
    # deaths: fall family by arm; a lava death after a fall is not one
    d = judge(base + [row(C, cut + 10, '_death', detail='was impaled on a stalagmite after falling 21 blocks'),
                      row(K, cut + 20, '_death', detail='tried to swim in lava after falling 6 blocks')], cut=cut, cans={'board-a'})
    assert d['fall_deaths'] == {'canary': {'stalagmite': 1}, 'control': {}}, d['fall_deaths']
    assert floor_row('allowed: dirt at -3,29,6; drop 2 onto water (damage 0)')['at'] == (-3, 29, 6)
    assert floor_row('nonsense') is None
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
    kinds = Counter()
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
        if name in KEEP:
            kinds[name] += 1
        if p is not None or name in KEEP:
            sk = ((r.get('raw') or {}).get('skill') or {})
            rows.append({'t': t.timestamp(), 'name': name, 'detail': (r.get('detail') or '') if name in KEEP else '', 'bot': b,
                         'pos': p, 'status': sk.get('status'), 'dur': sk.get('duration_ms') if name == 'gather' else None})
    res = judge(rows, cut=CUT.timestamp(), cans=CANS, fleet=fleet, pre_s=W * 60)
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d; rows with bot.pos %d) | bots post canary %d control %d | window %d min%s'
          % (walked, offbuild, withpos, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W, ' | FLEET TRIPWIRE' if fleet else ''))
    print('CONTROLS     kinds walked %s' % json.dumps(dict(kinds)))
    print('DEFECTS      G1 allowed floor dig then a bigger fall %d %s | G2 refused floor fallen through %d %s | ARMS control rows %d'
          % (res['allowed_fell'], res['_g1'][:5] or '', res['refused_fell'], res['_g2'][:5] or '', res['rows_control']))
    print('PRIMARY      gather fall episodes (>= 12, not water) per gather bot-h %s | DiD %s' % (json.dumps(res['primary']), res['primary_did']))
    print('REPORTED     fall deaths %s | canary named %s | gather %s ratio %s' % (json.dumps(res['fall_deaths']), res['fall_deaths_canary_named'] or '-', json.dumps(res['gather']), res['gather_ok_ratio']))
    print('ROWS         skips %d refused %d allowed %d | by bot %s' % (res['skips'], res['refused'], res['allowed'], json.dumps(res['by_bot'])))
    print('LIVENESS     licence on %d | EXPOSURE %d (need %d) -> %s' % (res['licence_on'], res['exposure'], EXPOSE_MIN, 'READY' if res['exposure_ready'] else 'NOT YET'))
    try:
        if ovr or fleet:
            raise RuntimeError('CANARY_DRYRUN or --fleet -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        emit('cavefallread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
