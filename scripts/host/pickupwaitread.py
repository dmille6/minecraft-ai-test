#!/usr/bin/env python3
# pickupwaitread.py [window_min] -- the read for canary `pickupwait-01` (the pickup sweep waits, bounded, while a drop's
# client copy is still in the air, then walks to it). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
# Judges the CANARY ARM; difference-in-differences against control for the effect; DENOMINATORS FIRST.
#
# WHY (Paper 10-26): `GoalNear(drop.position)` is read once and mineflayer does not simulate other entities, so a log cut
# 4-6 blocks up was chased at a stale mid-air point and the walk timed out (`_pickup_skipped err=path_budget d=0,4.6,0`).
#
# THE CHANGE (rows only this build writes):
#   _pickup_wait    one per real wait: drop <id> outcome=landed|gone|timeout wait_ms= sweep_wait_ms= item= attempt=
#                   (gone = collected or despawned during the wait: status success)
#   _pickup_skipped gains ` wait=<ms>` (the base writes the row without it)
#
#   PRIMARY (reported) gather_log_ok: gather success rows collecting a *_log per bot-h, DiD (should RISE or hold);
#              log_path_budget: _pickup_skipped err=path_budget item=*_log per bot-h, DiD (should FALL).
#   ARMS       rows_control: control _pickup_wait rows or `wait=` on _pickup_skipped (must be 0) -- REVERTS
#   LIVENESS   licence_canary: canary _pickup_wait rows >= 1 (the build waited at least once: a kind the base cannot write)
#   REPORTED   _pickup_wait by outcome, wait_ms p50/max, timeouts; gather (all) ok DiD; gather time is not in the rows.
#   INSTRUMENT control gather rows collecting a log >= 1
#   EXPOSURE   FROZEN BEFORE THE DEPLOY: >= 5 canary `_pickup_skipped err=path_budget` rows in the 24 h before declared_at
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('gather', '_pickup_skipped', '_pickup_wait')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
LOG = re.compile(r'collected \d+ [a-z_]*_log\b')
EXPOSURE_PRE_H = 24


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def mine(r):
    return r['name'] == '_pickup_wait' or (r['name'] == '_pickup_skipped' and ' wait=' in (r['detail'] or ''))


def log_ok(r):
    return r['name'] == 'gather' and r['status'] == 'success' and bool(LOG.search(r['detail'] or ''))


def log_budget(r):
    return r['name'] == '_pickup_skipped' and 'err=path_budget' in (r['detail'] or '') and bool(re.search(r'item=[a-z_]*_log\b', r['detail'] or ''))


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


def judge(rows, exposure_pre=None):
    out = {}
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    w = [r for r in post_c if r['name'] == '_pickup_wait']
    out['licence_canary'] = len(w)
    out['rows_control'] = sum(1 for r in rows if r['arm'] == 'control' and mine(r))
    out['wait_outcomes'] = dict(Counter(kv(r['detail']).get('outcome') or '?' for r in w))
    ms = sorted(int(kv(r['detail']).get('wait_ms') or 0) for r in w)
    out['wait_ms_p50'] = ms[len(ms) // 2] if ms else None
    out['wait_ms_max'] = ms[-1] if ms else None
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm]
            out['gather_log_ok_%s_%s' % (per, arm)] = sum(1 for r in sel if log_ok(r))
            out['gather_ok_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == 'gather' and r['status'] == 'success')
            out['log_path_budget_%s_%s' % (per, arm)] = sum(1 for r in sel if log_budget(r))
            out['path_budget_%s_%s' % (per, arm)] = sum(1 for r in sel if r['name'] == '_pickup_skipped' and 'err=path_budget' in r['detail'])
    out['instrument_control'] = int(out['gather_log_ok_post_control'] >= 1)
    if exposure_pre is None:
        exposure_pre = out['path_budget_pre_canary']
    out['exposure_pre_path_budget'] = exposure_pre
    out['exposure_ready'] = int(exposure_pre >= 5)
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 26, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='hive-a-Alpha', arm='canary', per='post', status='success': {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'fail_class': None, 'detail': detail, 'bot': bot}
    W = lambda o='landed', ms=900, **k: R('_pickup_wait', 'drop 7 outcome=%s wait_ms=%d sweep_wait_ms=%d item=spruce_log attempt=1/4' % (o, ms, ms), **k)
    SK = lambda item='spruce_log', wait=None, **k: R('_pickup_skipped', 'drop 1 refused the walk; retired it and kept sweeping (1 retired, attempt 1/4) err=path_budget item=%s d=0,4,0 ms=6001%s' % (item, '' if wait is None else ' wait=%d' % wait), **k)
    G = lambda what='spruce_log', **k: R('gather', 'collected 1 %s' % what, **k)
    ctl = [G(arm='control', bot='placebo-b-Alpha')]
    r = judge([W(), W('gone', 700), W('timeout', 2000), G(), G('cobblestone'), SK(), SK('cobblestone'), SK(per='pre')] * 1 + [SK(per='pre')] * 4 + ctl)
    assert r['licence_canary'] == 3 and r['wait_outcomes'] == {'landed': 1, 'gone': 1, 'timeout': 1} and r['wait_ms_max'] == 2000, r
    assert r['gather_log_ok_post_canary'] == 1 and r['gather_ok_post_canary'] == 2 and r['log_path_budget_post_canary'] == 1 and r['path_budget_post_canary'] == 2, r
    assert r['rows_control'] == 0 and r['instrument_control'] == 1 and r['exposure_ready'] == 1, r
    assert judge([W(arm='control', bot='board-a-Bravo')] + ctl)['rows_control'] == 1, 'ARMS: a control wait row'
    assert judge([SK(wait=0, arm='control', bot='board-a-Bravo')] + ctl)['rows_control'] == 1, 'ARMS: wait= on a control skipped row'
    assert judge([SK(arm='control', bot='board-a-Bravo')] + ctl)['rows_control'] == 0, 'control: the base skipped row'
    assert judge(ctl)['licence_canary'] == 0 and judge([G()])['instrument_control'] == 0
    assert judge(ctl, exposure_pre=4)['exposure_ready'] == 0 and judge(ctl, exposure_pre=5)['exposure_ready'] == 1
    assert not log_ok(G('oak_planks')) and log_ok(G('dark_oak_log'))
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
    xrows, xwalked, _, _ = stream(CUT - dt.timedelta(hours=EXPOSURE_PRE_H), CUT, CUT, CANS)
    xpre = sum(1 for r in xrows if r['arm'] == 'canary' and r['name'] == '_pickup_skipped' and 'err=path_budget' in r['detail'])
    res = judge(rows, exposure_pre=xpre)
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    didof = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    dids = {k: didof(k) for k in ('gather_log_ok', 'gather_ok', 'log_path_budget', 'path_budget')}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W))
    for k, word in (('gather_log_ok', 'gather log ok (should RISE)'), ('log_path_budget', 'log pickup path_budget (should FALL)'), ('gather_ok', 'gather ok'), ('path_budget', 'all pickup path_budget')):
        print('%-12s %s canary %d -> %d control %d -> %d | DiD %+.4f /bot-h' % ('PRIMARY' if k in ('gather_log_ok', 'log_path_budget') else 'REPORTED', word,
              res[k + '_pre_canary'], res[k + '_post_canary'], res[k + '_pre_control'], res[k + '_post_control'], dids[k]))
    print('LIVENESS     _pickup_wait rows %d outcomes %s wait_ms p50 %s max %s | ARMS control rows %d (must be 0)'
          % (res['licence_canary'], res['wait_outcomes'], res['wait_ms_p50'], res['wait_ms_max'], res['rows_control']))
    print('EXPOSURE     -> %s (frozen: canary path_budget pickups %d in the %d h before declared_at, %d rows walked; need >= 5) | INSTRUMENT control -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['exposure_pre_path_budget'], EXPOSURE_PRE_H, xwalked, 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('pickupwaitread', W, {k: v for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
