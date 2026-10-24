#!/usr/bin/env python3
# respawnfallread.py [window_min] [--selftest] [--fleet] -- the read for canary `respawnfall-01` (a bot that respawns on a
# high platform climbs down instead of walking off it). Design: docs/reports/respawnfall-01-design-2026-10-24.md section 8.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). DENOMINATORS FIRST.
#
# WHY (ES, 7 d to 10-24 13:00Z): 12 of 278 deaths were falls of 46-118 blocks off isolated-a's bot-built sky platform (y 180
# and 125 over spawn): isolated-a-Comet 11, isolated-d-Comet 1, four respawn-loop episodes, every bot carrying 247-439
# placeable blocks. NO DRAWABLE POOL HAS A PLATFORM (isolated-* and placebo-c are never drawn), so on a canary this read is a
# CORRECTNESS / NO-HARM read: the change must do nothing where there is nothing to do.
#
# THE CHANGE (rows only this build writes):
#   _respawnfall_mode  once per spawn (the licence): on=0|1 elevated_min=8 safe_drop=3 ...
#   _sky_descend       per sky_descend run: "<outcome>: y A -> B; open below N onto K; blocks have H need N; placed P rode R
#                      [; walked x,y,z:arrived|short] [; planks from L log(s)] [; stopped: ...]"
#                      outcome = grounded | progress | stay | stopped (failed) | grounded with status no_effect (not elevated)
#   _needs_rescue      "arm=sky_descend at=x,y,z open=N landing=K have=H need=M -- <reason>" (one per cell per 30 min)
# GATES
#   ARMS            REVERT: a control `_respawnfall_mode` / `_sky_descend` / `_needs_rescue arm=sky_descend` row after the deploy.
#   LIVENESS        REVERT-class (blocks KEEP): every canary-pool bot seen in the window carries the licence on=1 as its latest.
#   G1 descent_fell WATCH: ANY canary `_death` (Claude r1 P3-11: lava too), or a `_fall_path` row with fell >= 6 and >= 4 hp
#                   lost, inside a `sky_descend` run's interval (start .. start + duration + 5 s): the descent let the bot die or fall.
#   G2 acted        WATCH: any canary `_sky_descend` row with status other than no_effect (grounded, progress, stay, stopped).
#                   No drawable world was seen to hold a platform, so each is a bot pillar, a natural spire or a false trigger:
#                   a human reads its position before KEEP. (`wait` rows are no_effect: a transient reading, nothing done.)
#   H1 runaway      HOLD: more than RUNAWAY = 30 `sky_descend` runs by one canary bot in the window.
# REPORTED  runs by outcome; `_needs_rescue` by bot and cell; placed / rode totals; fall-family deaths by arm (two-death
#           floor: one is named, not a verdict); sky_descend share of canary decisions.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

RUNAWAY, FELL_MIN, HP_MIN, EP_S, TAIL_S = 30, 6, 4, 10, 5
DESC = re.compile(r'^(grounded|progress|stay|stopped|wait): y (\S+) -> (\S+); open below (\S+) onto (\w+|\?); blocks have (\d+) need (\S+); placed (\d+) rode (\d+)')
FELL = re.compile(r'fell (\d+)')
HP = re.compile(r'hp (-?[\d.]+)')
FALL_CAUSES = ('fell from a high place', 'hit the ground', 'doomed to fall', 'stalagmite', 'stalactite', 'fell off')
MINE = ('_respawnfall_mode', '_sky_descend', '_needs_rescue')
KEEP = MINE + ('sky_descend', '_fall_path', '_death')


def kv(d):
    return {m.group(1): m.group(2) for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or '')}


def pool_of(b):
    return (b or '').rsplit('-', 1)[0].replace('self-', '')


def desc_row(d):
    """'grounded: y 181.0 -> 74.0; open below 108 onto solid; blocks have 288 need 105; placed 105 rode 3' -> dict | None. Pure."""
    m = DESC.match(d or '')
    if not m:
        return None
    f = lambda v: None if v in ('?', 'undefined', 'null') else float(v)
    return {'outcome': m.group(1), 'y0': f(m.group(2)), 'y1': f(m.group(3)), 'open': f(m.group(4)), 'landing': m.group(5),
            'have': int(m.group(6)), 'need': f(m.group(7)) if m.group(7) not in ('Infinity',) else None,
            'placed': int(m.group(8)), 'rode': int(m.group(9))}


def mine_row(r):
    """Is this a row only this build writes? (`_needs_rescue` only with arm=sky_descend: ceilescape-01 writes the kind too.)"""
    if r['name'] == '_needs_rescue':
        return kv(r['detail']).get('arm') == 'sky_descend'
    return r['name'] in ('_respawnfall_mode', '_sky_descend')


def judge(rows, *, cut, cans, fleet=False, roster=None):
    res = {}
    arm = (lambda b: 'canary') if fleet else (lambda b: 'canary' if pool_of(b) in cans else 'control')
    post = [r for r in rows if r['t'] >= cut]
    can = [r for r in post if arm(r['bot']) == 'canary']
    lic = defaultdict(list)
    for r in sorted(can, key=lambda r: r['t']):
        if r['name'] == '_respawnfall_mode':
            lic[r['bot']].append(kv(r['detail']).get('on') == '1')
    roster = sorted(set(roster) if roster is not None else {r['bot'] for r in can})
    res['licence_on'] = sum(1 for v in lic.values() if v and v[-1])
    res['licence_missing'] = [b for b in roster if not (lic.get(b) and lic[b][-1])]
    res['licence_all'] = 1 if roster and not res['licence_missing'] else 0
    res['rows_control'] = 0 if fleet else sum(1 for r in post if arm(r['bot']) == 'control' and mine_row(r))
    # runs: the skill rows (t = START, dur) and their `_sky_descend` evidence rows
    runs = [r for r in can if r['name'] == 'sky_descend']
    descs = [(r, desc_row(r['detail'])) for r in can if r['name'] == '_sky_descend']
    descs = [(r, d) for r, d in descs if d]
    res['runs'] = len(runs)
    res['by_outcome'] = dict(Counter(('no_effect' if r.get('status') == 'no_effect' else d['outcome']) for r, d in descs))
    res['placed'] = sum(d['placed'] for _, d in descs); res['rode'] = sum(d['rode'] for _, d in descs)
    # G2: anything but the no_effect row -- every one named for the human
    acted = [(r, d) for r, d in descs if r.get('status') != 'no_effect']
    res['acted'] = len(acted)
    res['_acted'] = [(r['bot'], round(r['t']), r.get('pos'), d['outcome'], d['open'], d['landing']) for r, d in acted][:20]
    # H1: runaway
    per_bot = Counter(r['bot'] for r in runs)
    res['runaway'] = 1 if per_bot and max(per_bot.values()) > RUNAWAY else 0
    res['runs_by_bot'] = dict(per_bot)
    # G1: a fall inside a run's interval
    ivs = defaultdict(list)
    for r in runs:
        ivs[r['bot']].append((r['t'] - 1, r['t'] + (r.get('dur') or 0) / 1000.0 + TAIL_S))
    inside = lambda b, t: any(a <= t <= z for a, z in ivs.get(b, ()))
    g1 = []
    for r in can:
        if not inside(r['bot'], r['t']):
            continue
        d = (r['detail'] or '')
        if r['name'] == '_death':
            g1.append((r['bot'], round(r['t']), 'death', d[:80]))
        elif r['name'] == '_fall_path':
            m, h = FELL.search(d), HP.search(d)
            if m and int(m.group(1)) >= FELL_MIN and h and abs(float(h.group(1))) >= HP_MIN:
                g1.append((r['bot'], round(r['t']), 'fall', d[:80]))
    res['descent_fell'] = len(g1); res['_g1'] = g1
    # REPORTED: needs_rescue by bot and cell; fall deaths by arm
    res['rescue'] = dict(Counter((r['bot'], kv(r['detail']).get('at')) for r in can if r['name'] == '_needs_rescue' and kv(r['detail']).get('arm') == 'sky_descend'))
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
    return res


def verdict(res):
    if res['rows_control'] or not res['licence_all']:
        return 'REVERT'
    if res['runaway']:
        return 'HOLD'
    if res['descent_fell'] or res['acted']:
        return 'WATCH'
    return 'POLL_OK'


def selftest():
    cut = 1_000_000.0 * 600
    def row(bot, t, name='_affordance_scan', detail='', status='success', dur=None, pos=(0.5, 64.0, 0.5)):
        return {'t': t, 'bot': bot, 'name': name, 'detail': detail, 'status': status, 'dur': dur, 'pos': pos}
    C, K = 'board-a-Comet', 'hive-a-Alpha'
    lic = row(C, cut + 5, '_respawnfall_mode', detail='on=1 elevated_min=8 safe_drop=3 window_min=10')
    ok = judge([lic], cut=cut, cans={'board-a'})
    assert ok['licence_all'] == 1 and ok['rows_control'] == 0 and ok['acted'] == 0 and ok['descent_fell'] == 0 and verdict(ok) == 'POLL_OK', ok
    # LIVENESS: a second canary bot with no licence; the latest licence decides
    assert judge([lic, row('board-a-Delta', cut + 9)], cut=cut, cans={'board-a'})['licence_missing'] == ['board-a-Delta']
    assert verdict(judge([lic, row(C, cut + 99, '_respawnfall_mode', detail='on=0')], cut=cut, cans={'board-a'})) == 'REVERT'
    assert judge([lic], cut=cut, cans={'board-a'}, roster={C, 'board-a-Echo'})['licence_all'] == 0
    # ARMS: a control licence row after the deploy; a ceilescape `_needs_rescue` in control is NOT ours
    assert judge([lic, row(K, cut + 7, '_respawnfall_mode', detail='on=1')], cut=cut, cans={'board-a'})['rows_control'] == 1
    assert judge([lic, row(K, cut + 7, '_needs_rescue', detail='arm=ceiling at=1,2,3 -- x')], cut=cut, cans={'board-a'})['rows_control'] == 0
    assert judge([lic, row(K, cut + 7, '_needs_rescue', detail='arm=sky_descend at=1,2,3 -- x')], cut=cut, cans={'board-a'})['rows_control'] == 1
    # G2: a no_effect row is not 'acted'; a grounded run is, named with its position
    NE = 'grounded: y 64.0 -> 64.0; open below 2 onto solid; blocks have 40 need 0; placed 0 rode 0'
    GR = 'grounded: y 181.0 -> 74.0; open below 108 onto solid; blocks have 288 need 105; placed 105 rode 3; walked 354,180,148:arrived'
    assert judge([lic, row(C, cut + 20, '_sky_descend', detail=NE, status='no_effect')], cut=cut, cans={'board-a'})['acted'] == 0
    a = judge([lic, row(C, cut + 20, '_sky_descend', detail=GR, pos=(354.5, 74.0, 148.5))], cut=cut, cans={'board-a'})
    assert a['acted'] == 1 and a['placed'] == 105 and a['by_outcome'] == {'grounded': 1} and verdict(a) == 'WATCH', a
    ST = 'stay: y 181.0 -> 181.0; open below 108 onto solid; blocks have 0 need 105; placed 0 rode 0'
    assert desc_row(ST)['outcome'] == 'stay' and desc_row('nonsense') is None
    # G1: a fall death inside a run's interval -> 1; after it -> 0; a 3-block fall inside -> 0
    S = row(C, cut + 100, 'sky_descend', status='success', dur=60_000)
    die = lambda t: row(C, t, '_death', detail='fell from a high place after falling 40 blocks; was running sky_descend')
    assert judge([lic, S, die(cut + 130)], cut=cut, cans={'board-a'})['descent_fell'] == 1
    assert judge([lic, S, die(cut + 200)], cut=cut, cans={'board-a'})['descent_fell'] == 0
    small = row(C, cut + 130, '_fall_path', detail='candidate damage: fell 3, hp -0; descent 1s ago')
    big = row(C, cut + 130, '_fall_path', detail='candidate damage: fell 9, hp -6; descent 1s ago')
    assert judge([lic, S, small], cut=cut, cans={'board-a'})['descent_fell'] == 0
    assert judge([lic, S, row(C, cut + 130, '_death', detail='tried to swim in lava after falling 4 blocks')], cut=cut, cans={'board-a'})['descent_fell'] == 1, 'any death inside a run'
    WT = 'wait: y 181.0 -> 181.0; open below ? onto ?; blocks have 288 need 0; placed 0 rode 0; stopped: not on the ground'
    assert desc_row(WT)['outcome'] == 'wait' and judge([lic, row(C, cut + 20, '_sky_descend', detail=WT, status='no_effect')], cut=cut, cans={'board-a'})['acted'] == 0
    assert judge([lic, S, big], cut=cut, cans={'board-a'})['descent_fell'] == 1
    # a control bot's fall in the same seconds is not the canary's
    assert judge([lic, S, row(K, cut + 130, '_death', detail='fell from a high place after falling 40 blocks')], cut=cut, cans={'board-a'})['descent_fell'] == 0
    # H1: 31 runs by one bot -> HOLD; 30 -> not
    many = lambda n: [lic] + [row(C, cut + 10 + i, 'sky_descend', status='no_effect', dur=10) for i in range(n)]
    assert judge(many(31), cut=cut, cans={'board-a'})['runaway'] == 1 and verdict(judge(many(31), cut=cut, cans={'board-a'})) == 'HOLD'
    assert judge(many(30), cut=cut, cans={'board-a'})['runaway'] == 0
    # rescue rows by bot and cell
    rr = judge([lic, row(C, cut + 40, '_needs_rescue', detail='arm=sky_descend at=353,181,147 open=108 -- staying put')], cut=cut, cans={'board-a'})
    assert rr['rescue'] == {(C, '353,181,147'): 1}, rr['rescue']
    # deaths by arm (lava excluded)
    d = judge([lic, row(C, cut + 10, '_death', detail='fell from a high place after falling 54 blocks'),
               row(K, cut + 20, '_death', detail='tried to swim in lava after falling 6 blocks')], cut=cut, cans={'board-a'})
    assert d['fall_deaths'] == {'canary': {'fell from a high place': 1}, 'control': {}}, d['fall_deaths']
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
    rows, walked, offbuild = [], 0, 0
    roster = set()
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
        if arm == 'canary':
            roster.add(b)
        if not fleet and arm == 'canary' and per == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(per, arm)].add(b)
        name = r.get('name')
        kinds[name] += 1
        if name in KEEP:
            pos = (r.get('bot') or {}).get('pos')
            p = (float(pos['x']), float(pos['y']), float(pos['z'])) if isinstance(pos, dict) and pos.get('x') is not None else None
            sk = ((r.get('raw') or {}).get('skill') or {})
            rows.append({'t': t.timestamp(), 'name': name, 'detail': r.get('detail') or '', 'bot': b, 'pos': p,
                         'status': sk.get('status'), 'dur': sk.get('duration_ms')})
    res = judge(rows, cut=CUT.timestamp(), cans=CANS, fleet=fleet, roster=roster)
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots post canary %d control %d | window %d min'
          % (walked, offbuild, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W))
    print('POSITIVE CONTROL kinds: _death %d, _fall_path %d, sky_descend %d, _sky_descend %d, _respawnfall_mode %d, _needs_rescue %d'
          % tuple(kinds.get(k, 0) for k in ('_death', '_fall_path', 'sky_descend', '_sky_descend', '_respawnfall_mode', '_needs_rescue')))
    if walked == 0:
        print('VERDICT UNREADABLE: no rows walked -- an instrument failure, not a result'); sys.exit(2)
    for k in ('licence_on', 'licence_all', 'licence_missing', 'rows_control', 'runs', 'by_outcome', 'acted', '_acted', 'runaway',
              'runs_by_bot', 'descent_fell', '_g1', 'placed', 'rode', 'rescue', 'fall_deaths', 'fall_deaths_canary_named'):
        print(f'{k}: {res[k]}')
    v = verdict(res)
    print(f'VERDICT {v}' + (' (two-death floor: a named fall death is not a verdict)' if res['fall_deaths_canary_named'] else ''))
