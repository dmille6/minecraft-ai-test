#!/usr/bin/env python3
# townsearchread.py [window_min] -- the read for canary `townsearch-01` (withdraw_pick looks in EVERY town container: the
# stock journal's holders first, then the unknown, nearest the bot; a miss lasts 60 min so the next order continues where the
# last stopped). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM; difference-in-differences
# against control for the effect; DENOMINATORS FIRST.
#
# WHY (docs/reports/townsearch-2026-10-16.md): every town holds usable stone pickaxes (4-16, damage <= 65, in 5-12
# containers) and sticks (census 10-16 16:15Z), yet withdraw_pick orders failed "no usable pickaxe and none of ... in the 6
# container(s) tried here" 134 times in 10-14..16 and took_pick fell 120/day (10-09) -> 6 (10-16 partial). The order only
# ever opened the 3 containers nearest HOME for the pickaxe and the next 3 for the ingredients (the 15-min miss expired before
# the same bot's next order, median gap 16.2 min); the 10-14 02:21Z chest clear left one stick stack per town, so the
# nearest 6 held sticks in 5 towns of 16 (all 16 before).
#
# MEMORY: STREAMED (lidclearread's pattern): only the kinds below are held.
#
# THE CHANGE (rows only this build writes):
#   _townsearch_mode   once per spawn: the licence (proves the build is live, not the effect)
#   _withdraw_pick     the ORDER's row (verb=withdraw_pick) now carries `town=<containers> cand=<pick>,<ing>` before tried=
#
#   METRICS (order rows only: verb=withdraw_pick; the model's `withdraw` verb is unchanged and not judged)
#     took        outcome took_pick | took_ingredients          per BOT-HOUR, DiD
#     took_pick   outcome took_pick                             per BOT-HOUR, DiD   (PRIMARY, reported)
#     notfound    outcome short | has_ingredients (no pickaxe found; and, for short, none of the ingredients either)
#                 per ATTEMPT (order rows), DiD of the proportions (should FALL)
#   LIVENESS   search_rows_canary: canary order rows carrying town= (the new search ran) >= 1
#   ARMS       control rows with town= or _townsearch_mode (must be 0)
#   DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#     D1 loop_same_chest: one canary order's tried= list names the same container 3+ times (a container may appear twice:
#        once in the pickaxe pass, once in the ingredient pass)
#     D2 visits_over_budget: one canary order with more than VISIT_BUDGET (16 + 8) containers in tried=
#   REPORTED   chest_unreachable / container_blocked / aborted / error outcomes per order, DiD (the search walks further);
#              canary cand= (pickaxe candidates when the order began: 0 = the town is a known miss) and tried= sizes
#   INSTRUMENT control order rows (>= 1) and control notfound rows (>= 1: the population is visible in control)
#   EXPOSURE   canary order rows carrying town= in the window >= EXPOSURE_ORDERS (the search ran often enough to read)
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('_withdraw_pick', '_townsearch_mode')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
VISIT_BUDGET = 16 + 8
LOOP_MIN = 3
EXPOSURE_ORDERS = 6
TOOK = ('took_pick', 'took_ingredients')
NOTFOUND = ('short', 'has_ingredients')
WALKS = ('chest_unreachable', 'container_blocked', 'aborted', 'error')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def is_order(r):
    return r['name'] == '_withdraw_pick' and ' verb=withdraw_pick ' in ' %s ' % r['detail']


def outcome(r):
    return kv(r['detail']).get('outcome') or '?'


def searched(r):
    return is_order(r) and ' town=' in ' %s' % r['detail']


def tried_keys(d):
    m = re.search(r'tried=\[(.*)', d or '')
    if not m:
        return []
    body = m.group(1)
    body = body[:-1] if body.endswith(']') else body
    out = []
    for e in body.split(';'):
        k, _, o = e.rpartition(':')
        if k and re.match(r'^-?\d+,-?\d+,-?\d+$', k):
            out.append(k)
    return out


def stream(since, until, cut, cans, logroot='/var/log/mcai'):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    bots = defaultdict(set)
    s_iso, u_iso = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    for f in files:
        try:
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                ts = line[15:34] if line.startswith('{"@timestamp":"') else None
                if ts is None or ts < s_iso or ts >= u_iso:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    bad += 1
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                b = (d.get('bot') or {}).get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                if b:
                    bots[(per, arm)].add(b)
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'fail_class': sk.get('fail_class'),
                                 'detail': sk.get('detail') or '', 'bot': b})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad


def judge(rows):
    out = {}
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm and is_order(r)]
            oc = Counter(outcome(r) for r in sel)
            out['orders_%s_%s' % (per, arm)] = len(sel)
            out['took_%s_%s' % (per, arm)] = sum(oc.get(o, 0) for o in TOOK)
            out['took_pick_%s_%s' % (per, arm)] = oc.get('took_pick', 0)
            out['notfound_%s_%s' % (per, arm)] = sum(oc.get(o, 0) for o in NOTFOUND)
            out['walkfail_%s_%s' % (per, arm)] = sum(oc.get(o, 0) for o in WALKS)
            out['outcomes_%s_%s' % (per, arm)] = dict(oc)
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    s = [r for r in post_c if searched(r)]
    out['search_rows_canary'] = len(s)
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_townsearch_mode')
    out['search_rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and (searched(r) or r['name'] == '_townsearch_mode'))
    loops, over = [], []
    for r in s:
        ks = tried_keys(r['detail'])
        c = Counter(ks)
        top = c.most_common(1)
        if top and top[0][1] >= LOOP_MIN:
            loops.append((r['bot'], top[0][0], top[0][1], str(r['t'])))
        if len(ks) > VISIT_BUDGET:
            over.append((r['bot'], len(ks), str(r['t'])))
    out['loop_same_chest'] = len(loops)
    out['visits_over_budget'] = len(over)
    out['tried_sizes_canary'] = dict(Counter(len(tried_keys(r['detail'])) for r in s))
    out['pick_cand_canary'] = dict(Counter((kv(r['detail']).get('cand') or '-').split(',')[0] for r in s))
    out['instrument_control'] = int(out['orders_post_control'] >= 1 and out['notfound_post_control'] >= 1)
    out['exposure_ready'] = int(out['search_rows_canary'] >= EXPOSURE_ORDERS)
    out['_lists'] = {'loops': loops[:5], 'over': over[:5]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 17, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-d-Alpha', arm='canary', per='post', status='success': {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': None, 'detail': detail, 'bot': bot}
    def W(oc, tried=('1,2,3:none',), search=True, verb='withdraw_pick', **k):
        return R('_withdraw_pick', 'outcome=%s need=stick:2 uses=- verification=server cursor=- err=- chest_room=- plan=- srv=- bag=1->1 deposited=- took=- verb=%s %stried=[%s]'
                 % (oc, verb, 'town=12 cand=3,1 ' if search else '', ';'.join(tried)), **k)
    ctl = [W('short', arm='control', bot='board-a-Alpha', search=False)]
    ok = judge([W('took_pick'), W('short'), R('_townsearch_mode', 'phase=mode')] + ctl)
    assert ok['search_rows_canary'] == 2 and ok['licence_canary'] == 1 and ok['took_pick_post_canary'] == 1 and ok['notfound_post_canary'] == 1, ok
    assert ok['loop_same_chest'] == 0 and ok['visits_over_budget'] == 0 and ok['search_rows_control'] == 0 and ok['instrument_control'] == 1, ok
    assert judge([W('short', tried=['1,2,3:none', '1,2,3:none'])] + ctl)['loop_same_chest'] == 0, 'twice (one per pass) is not a loop'
    assert judge([W('short', tried=['1,2,3:none'] * 3)] + ctl)['loop_same_chest'] == 1, 'D1: the same chest three times'
    assert judge([W('short', tried=['-1,2,-3:none', '-1,2,-3:chest_unreachable', '-1,2,-3:none'])] + ctl)['loop_same_chest'] == 1, 'D1 with negative coordinates'
    assert judge([W('short', tried=['%d,64,0:none' % i for i in range(VISIT_BUDGET + 1)])] + ctl)['visits_over_budget'] == 1, 'D2'
    assert judge([W('short', tried=['%d,64,0:none' % i for i in range(VISIT_BUDGET)])] + ctl)['visits_over_budget'] == 0, 'D2 control: the budget itself'
    assert judge([W('short', search=False)] + ctl)['search_rows_canary'] == 0, 'a base-shaped row is not the search'
    assert judge([W('took', verb='withdraw')] + ctl)['orders_post_canary'] == 0, 'the model verb is not an order'
    c = judge([W('short', arm='control', bot='board-a-Alpha'), R('_townsearch_mode', 'phase=mode', arm='control', bot='board-a-Alpha')])
    assert c['search_rows_control'] == 2, c
    assert judge([W('short', search=False, arm='control', bot='board-a-Alpha', status='failed')])['instrument_control'] == 1
    assert judge([W('took_pick', arm='control', bot='board-a-Alpha')])['instrument_control'] == 0, 'no control notfound: blind'
    assert judge([W('short')] * EXPOSURE_ORDERS + ctl)['exposure_ready'] == 1 and judge([W('short')] * (EXPOSURE_ORDERS - 1) + ctl)['exposure_ready'] == 0
    h = judge([W('has_ingredients'), W('short'), W('took_ingredients'), W('chest_unreachable')] + ctl)
    assert h['notfound_post_canary'] == 2 and h['took_post_canary'] == 1 and h['walkfail_post_canary'] == 1, h
    assert pool_of('self-isolated-b-Comet') == 'isolated-b' and pool_of('hive-d-Alpha') == 'hive-d'
    assert tried_keys('tried=[1,2,3:none;4,5') == ['1,2,3'], 'a cut-off last entry is not counted'
    assert tried_keys('tried=[1,2,3:none;4,5,6:no') == ['1,2,3', '4,5,6'], 'a cut-off outcome still names its container'
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
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
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)
    rows, walked, bots, bad = stream(PRE, END, CUT, CANS)
    res = judge(rows)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    prop = lambda k, per, arm: res['%s_%s_%s' % (k, per, arm)] / res['orders_%s_%s' % (per, arm)] if res['orders_%s_%s' % (per, arm)] else float('nan')
    did_rate = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    did_prop = lambda k: (prop(k, 'post', 'canary') - prop(k, 'pre', 'canary')) - (prop(k, 'post', 'control') - prop(k, 'pre', 'control'))
    dids = {'took': did_rate('took'), 'took_pick': did_rate('took_pick'), 'notfound_per_order': did_prop('notfound'), 'walkfail_per_order': did_prop('walkfail')}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control')))
    print('ORDERS       withdraw_pick order rows canary %d -> %d control %d -> %d (the model verb excluded)'
          % (res['orders_pre_canary'], res['orders_post_canary'], res['orders_pre_control'], res['orders_post_control']))
    print('PRIMARY      took_pick canary %d -> %d control %d -> %d | per bot-h canary %.3f -> %.3f control %.3f -> %.3f | DiD %+.3f /bot-h'
          % (res['took_pick_pre_canary'], res['took_pick_post_canary'], res['took_pick_pre_control'], res['took_pick_post_control'],
             rate(res['took_pick_pre_canary'], 'pre', 'canary'), rate(res['took_pick_post_canary'], 'post', 'canary'),
             rate(res['took_pick_pre_control'], 'pre', 'control'), rate(res['took_pick_post_control'], 'post', 'control'), dids['took_pick']))
    print('             any take (pickaxe or ingredients) canary %d -> %d control %d -> %d | DiD %+.3f /bot-h'
          % (res['took_pre_canary'], res['took_post_canary'], res['took_pre_control'], res['took_post_control'], dids['took']))
    print('NOT FOUND    (short | has_ingredients) per order: canary %d/%d -> %d/%d control %d/%d -> %d/%d | DiD %+.3f (should FALL)'
          % (res['notfound_pre_canary'], res['orders_pre_canary'], res['notfound_post_canary'], res['orders_post_canary'],
             res['notfound_pre_control'], res['orders_pre_control'], res['notfound_post_control'], res['orders_post_control'], dids['notfound_per_order']))
    print('LIVENESS     canary order rows with the search (town=) %d | licence rows %d | control rows with town= or the licence %d (must be 0)'
          % (res['search_rows_canary'], res['licence_canary'], res['search_rows_control']))
    print('DEFECTS      D1 same container %d+ times in one order %d %s | D2 more than %d containers in one order %d %s'
          % (LOOP_MIN, res['loop_same_chest'], res['_lists']['loops'], VISIT_BUDGET, res['visits_over_budget'], res['_lists']['over']))
    print('REPORTED     walk failures (unreachable/blocked/aborted/error) per order DiD %+.3f | canary tried= sizes %s | canary pickaxe candidates at start %s | outcomes post canary %s control %s'
          % (dids['walkfail_per_order'], res['tried_sizes_canary'], res['pick_cand_canary'], res['outcomes_post_canary'], res['outcomes_post_control']))
    print('EXPOSURE     -> %s (canary order rows with the search %d, need %d) | INSTRUMENT control orders %d, control notfound %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['search_rows_canary'], EXPOSURE_ORDERS, res['orders_post_control'], res['notfound_post_control'],
             'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('townsearchread', W, {k: v for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
