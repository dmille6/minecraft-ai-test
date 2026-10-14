#!/usr/bin/env python3
# stockrecountread.py [window_min] -- the read for canary `stocktarget-02` (the town recount order: a refusal on a
# not-yet-counted town triggers the count at once, bounded). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# WHY (chest clear #2, 10-14 02:22Z): after the fence every town container was UNKNOWN; deposits were refused
# `_stock_refused ... *_unknown` (hive-a-Delta 55 times in 2 h) while the only deterministic recount fired at 34+ slots,
# so hive-a and placebo-a stayed uncounted for hours. Counts also expire after 6 h (OBS_TTL), so the not-yet-counted
# refusal recurs on every town, not only after a clear.
#
# MEMORY: STREAMED (stocktargetread's pattern): only the kinds below are held.
#
# THE CHANGE (rows this build writes; the base 2ec19385 writes none):
#   _stock_recount   count_town, one per order: trigger= refused= keys= counted= tried= unknown_after= [timed_out=1] names=
#
#   LIVENESS   recount_live: canary _stock_recount rows that COUNTED (counted >= 1) -- the immediate count seen (>= 1)
#   ARMS       recount_rows_control: control _stock_recount rows (must be 0: the base cannot write them)
#   CORRECTNESS (each REVERTS; each has a failing fixture in --selftest)
#     L1  breach_recount_loop: a canary bot with more than 61 _stock_recount rows in any 60 min (the 60 s cooldown broken)
#     L2  breach_recount_backoff: a canary bot with a _stock_recount row LESS than 9.5 min after its own row that counted
#         nothing (the 10 min backoff after a fruitless count broken)
#   REPORTED   not-yet-counted refusals per bot-h (rows `_stock_refused` with at_cobble=0 and at_stock=0 and *_unknown),
#              canary vs control, DiD with the pre period (the effect: should FALL); the share of canary not-yet-counted
#              refusals followed by a _stock_recount from the same bot within 120 s (the "at once"); counted / tried;
#              rows that counted nothing (all unreachable, timed out)
#   INSTRUMENT control not-yet-counted refusals (>= 1: the population the fix targets is visible)
#   EXPOSURE   >= 3 canary not-yet-counted refusals or recount rows, and the instrument
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('_stock_recount', '_stock_refused')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
FOLLOW_S = 120
LOOP_MAX_PER_H = 61
BACKOFF_MIN_S = 570


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def unknown_refusal(r):
    f = kv(r['detail'])
    return r['name'] == '_stock_refused' and '_unknown' in r['detail'] and num(f, 'at_cobble') == 0 and num(f, 'at_stock') == 0


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
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'detail': sk.get('detail') or '', 'bot': b})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad


def judge(rows):
    out = {}
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    post_k = [r for r in rows if r['per'] == 'post' and r['arm'] == 'control']
    rc_c = [r for r in post_c if r['name'] == '_stock_recount']
    out['recount_rows_canary'] = len(rc_c)
    out['recount_rows_control'] = sum(1 for r in post_k if r['name'] == '_stock_recount')
    out['recount_live'] = sum(1 for r in rc_c if num(kv(r['detail']), 'counted') >= 1)
    out['recount_counted'] = sum(num(kv(r['detail']), 'counted') for r in rc_c)
    out['recount_tried'] = sum(num(kv(r['detail']), 'tried') for r in rc_c)
    out['recount_fruitless'] = sum(1 for r in rc_c if num(kv(r['detail']), 'counted') == 0)
    by_bot = defaultdict(list)
    for r in rc_c:
        by_bot[r['bot']].append(r)
    loop, backoff = [], []
    for b, rs in by_bot.items():
        ts = [r['t'] for r in rs]
        j = 0
        for i in range(len(ts)):
            while ts[i] - ts[j] > dt.timedelta(minutes=60):
                j += 1
            if i - j + 1 > LOOP_MAX_PER_H:
                loop.append((b, i - j + 1, str(ts[i])))
                break
        for a, c in zip(rs, rs[1:]):
            if num(kv(a['detail']), 'counted') == 0 and (c['t'] - a['t']).total_seconds() < BACKOFF_MIN_S:
                backoff.append((b, str(a['t']), str(c['t'])))
    out['breach_recount_loop'] = len(loop)
    out['breach_recount_backoff'] = len(backoff)
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            out['unknown_refusals_%s_%s' % (per, arm)] = sum(1 for r in rows if r['per'] == per and r['arm'] == arm and unknown_refusal(r))
    ur = [r for r in post_c if unknown_refusal(r)]
    rc_times = defaultdict(list)
    for r in rc_c:
        rc_times[r['bot']].append(r['t'])
    out['refusals_followed'] = sum(1 for r in ur if any(dt.timedelta(0) <= t - r['t'] <= dt.timedelta(seconds=FOLLOW_S) for t in rc_times[r['bot']]))
    out['refusals_unknown_canary'] = len(ur)
    out['instrument_control'] = out['unknown_refusals_post_control']
    out['exposure_ready'] = int((len(ur) + len(rc_c)) >= 3 and out['instrument_control'] >= 1)
    out['_lists'] = {'loop': loop[:5], 'backoff': backoff[:5]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 14, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-a-Alpha', arm='canary', per='post', secs=0: {'t': T0 + dt.timedelta(minutes=mins, seconds=secs), 'per': per, 'arm': arm, 'name': name, 'status': 'success', 'detail': detail, 'bot': bot}
    UK = 'via=admission n=1 cobble=0 stock=1 at_cobble=0 at_stock=0 oak_log:128:stock_unknown'
    RC = lambda c, m=0, s=0, bot='hive-a-Alpha', arm='canary': R('_stock_recount', 'trigger=order refused=1 keys=3 counted=%d tried=3 unknown_after=0 names=oak_log:stock_unknown' % c, m, bot=bot, secs=s, arm=arm)
    ok = judge([R('_stock_refused', UK), RC(2, 0, 30), R('_stock_refused', UK, arm='control', bot='board-a-Alpha')])
    assert ok['recount_live'] == 1 and ok['refusals_followed'] == 1 and ok['breach_recount_loop'] == 0 and ok['breach_recount_backoff'] == 0 and ok['exposure_ready'] == 0, ok
    assert judge([R('_stock_refused', UK), RC(2, 3)])['refusals_followed'] == 0, 'three minutes later is not at once'
    assert judge([R('_stock_refused', 'via=deposit n=1 cobble=1 stock=0 at_cobble=1 at_stock=0 cobblestone:95:cobble_cap')])['refusals_unknown_canary'] == 0, 'a proven refusal is not the population'
    assert judge([RC(0)])['recount_live'] == 0, 'a fruitless count is not liveness'
    assert judge([RC(1, m, bot='hive-a-Bravo') for m in range(0, 62)])['breach_recount_loop'] == 0, '62 in 61 min, one a minute: the cooldown holds'
    assert judge([RC(1, 0, s, bot='hive-a-Bravo') for s in range(0, 62 * 30, 30)])['breach_recount_loop'] == 1, 'every 30 s: the cooldown broken'
    assert judge([RC(0, 0), RC(1, 5)])['breach_recount_backoff'] == 1, 'a recount 5 min after a fruitless one: the backoff broken'
    assert judge([RC(0, 0), RC(1, 11)])['breach_recount_backoff'] == 0, 'positive control: 11 min later'
    assert judge([RC(1, 0), RC(1, 1)])['breach_recount_backoff'] == 0, 'after a count that counted, only the cooldown'
    c = judge([RC(1, 0, arm='control', bot='board-a-Alpha')])
    assert c['recount_rows_control'] == 1 and c['recount_live'] == 0, 'a control row is an arms breach'
    ready = judge([R('_stock_refused', UK), R('_stock_refused', UK, 1), RC(1, 1, 10), R('_stock_refused', UK, arm='control', bot='board-a-Alpha')])
    assert ready['exposure_ready'] == 1, ready
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
    did = (rate(res['unknown_refusals_post_canary'], 'post', 'canary') - rate(res['unknown_refusals_pre_canary'], 'pre', 'canary')) \
        - (rate(res['unknown_refusals_post_control'], 'post', 'control') - rate(res['unknown_refusals_pre_control'], 'pre', 'control'))
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W))
    print('LIVENESS     canary recounts that counted %d (of %d rows; %d counted nothing) | containers counted %d of %d tried | control recount rows %d (must be 0)'
          % (res['recount_live'], res['recount_rows_canary'], res['recount_fruitless'], res['recount_counted'], res['recount_tried'], res['recount_rows_control']))
    print('CORRECTNESS  L1 loop %d %s | L2 backoff %d %s' % (res['breach_recount_loop'], res['_lists']['loop'], res['breach_recount_backoff'], res['_lists']['backoff']))
    print('REPORTED     not-yet-counted refusals canary %d -> %d control %d -> %d | per bot-h DiD %+.3f | canary refusals followed by a recount within %d s: %d of %d'
          % (res['unknown_refusals_pre_canary'], res['unknown_refusals_post_canary'], res['unknown_refusals_pre_control'], res['unknown_refusals_post_control'],
             did, FOLLOW_S, res['refusals_followed'], res['refusals_unknown_canary']))
    print('EXPOSURE     -> %s (instrument: control not-yet-counted refusals %d)' % ('READY' if res['exposure_ready'] else 'NOT YET', res['instrument_control']))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('stockrecountread', W, {k: v for k, v in res.items() if not k.startswith('_')} | {'unknown_refusal_did': clean(did)})
    except Exception as e:
        print('emit failed:', e)
