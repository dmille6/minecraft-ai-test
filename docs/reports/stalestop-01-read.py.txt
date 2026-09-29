#!/usr/bin/env python3
# stalestopread.py [window_min] -- the read for canary `stalestop-01` (branch stale-stop).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: halting the pathfinder no longer leaves its stop flag set (withTimeout did setGoal(null) THEN stop();
# the NEXT goto died of it, PathStopped, a walk never tried). haltPath = setGoal(null) at four sites; withTimeout
# consumes the dig watcher's flag after a direct dig. The pickup skip row carries err=/item=/d=/ms=.
# Baseline (6 h to 09-29 07:03Z, 80 bots): 13,275 pickup drops retired (27.5/bot-h); >= 1,261 failed < 0.2 s straight
# after another skip -- the stale-flag signature; 12.8% of gathers barren.
#
#   LIVENESS     canary `_pickup_skipped` rows containing "err=" from the canary build (>= 1); control 0.
#   CORRECTNESS  INSTANT DEATHS: canary skip rows with err=PathStopped and ms < 200 -- a walk killed before it began,
#                the stale-flag signature, visible only in the enriched row. Must be <= 1% of >= 30 canary skips.
#                (A first draft gated on the fast re-skip share vs control; its dry run on UNCHANGED code read
#                "FIXED" -- hive-c 0.041 vs control 0.135 -- so between-pool noise alone passed it. Reported only.)
#   INSTRUMENT   control fast re-skips >= 1 (the signature is visible to this query).
# REPORTED (DiD vs the same-length pre-window): skips/bot-h, barren-gather share, items gained/bot-h from gather rows.
import sys, os, json, glob, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
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
PRE = CUT - dt.timedelta(minutes=W)
FAST_S = 0.2
BARREN = 'collect threw nothing'


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(elapsed + W + 60))
rows = sorted((r for r in ev.rows if r.get('t') and PRE <= r['t'] < END), key=lambda r: r['t'])
bots = defaultdict(set)
skips, fast, gathers, barren, items = Counter(), Counter(), Counter(), Counter(), Counter()
err_rows, offbuild, instant = Counter(), 0, 0
ERR = re.compile(r'err=(\S+) .*?ms=(\d+)')
assert ERR.search('attempt 1/4) err=PathStopped item=dirt d=1.0,0.0,2.0 ms=12').groups() == ('PathStopped', '12')
last = {}
for r in rows:
    b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    a = 'canary' if pool_of(b) in CANS else 'control'; p = 'post' if r['t'] >= CUT else 'pre'
    bots[(p, a)].add(b)
    k, d = r.get('name'), (r.get('detail') or '')
    if k == '_pickup_skipped':
        if p == 'post' and a == 'canary' and CV:
            ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
            if not ver.startswith(CV):
                offbuild += 1
                continue
        skips[(p, a)] += 1
        if p == 'post' and 'err=' in d:
            err_rows[a] += 1
            m = ERR.search(d)
            if a == 'canary' and m and m.group(1) == 'PathStopped' and int(m.group(2)) < 200:
                instant += 1
        prev = last.get(b)
        if prev is not None and (r['t'] - prev).total_seconds() < FAST_S:
            fast[(p, a)] += 1
        last[b] = r['t']
    elif k == 'gather':
        gathers[(p, a)] += 1
        if BARREN in d:
            barren[(p, a)] += 1
        delta = ((r.get('raw') or {}).get('skill') or {}).get('inventory_delta') or {}   # raw.skill.inventory_delta
        if isinstance(delta, dict):
            items[(p, a)] += sum(v for v in delta.values() if isinstance(v, (int, float)) and v > 0)


def per_bh(c, p, a):
    n = len(bots[(p, a)])
    return c[(p, a)] / (n * W / 60) if n else float('nan')


def share(c, d, p, a):
    return c[(p, a)] / d[(p, a)] if d[(p, a)] else float('nan')


fs = {(p, a): share(fast, skips, p, a) for p in ('pre', 'post') for a in ('canary', 'control')}
did = lambda f: (f('post', 'canary') - f('pre', 'canary')) - (f('post', 'control') - f('pre', 'control'))
print('rows %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
print('-' * 78)
print('fast re-skip share  canary %.3f -> %.3f | control %.3f -> %.3f' % (fs[('pre', 'canary')], fs[('post', 'canary')], fs[('pre', 'control')], fs[('post', 'control')]))
print('skips /bot-h        DiD %+.2f  (canary post %.2f, control post %.2f)' % (did(lambda p, a: per_bh(skips, p, a)), per_bh(skips, 'post', 'canary'), per_bh(skips, 'post', 'control')))
print('barren share        DiD %+.3f' % did(lambda p, a: share(barren, gathers, p, a)))
print('gather items /bot-h DiD %+.2f' % did(lambda p, a: per_bh(items, p, a)))
print('err= rows: canary %d control %d; canary rows from another build %d' % (err_rows['canary'], err_rows['control'], offbuild))
# Judged ONLY on enriched rows: a pool without the fix writes no err= at all, so '0 instant deaths' there is vacuous
# (the second draft of this read passed unchanged code exactly that way).
judged = err_rows['canary'] >= 30
fixed = judged and instant <= 0.01 * err_rows['canary']
print('-' * 78)
print('LIVENESS     canary err= rows %d (>= 1) | control %d (0)' % (err_rows['canary'], err_rows['control']))
print('CORRECTNESS  canary instant PathStopped deaths %d of %d enriched skip rows (<= 1%%) -> %s'
      % (instant, err_rows['canary'], 'FIXED' if fixed else ('not judged (< 30 enriched rows)' if not judged else 'NOT FIXED')))
print('REPORTED     fast re-skip share canary %.3f vs control %.3f (noisy between pools)' % (fs[('post', 'canary')], fs[('post', 'control')]))
print('INSTRUMENT   control fast re-skips %d (>= 1)' % fast[('post', 'control')])

try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('stalestopread', W, {
        'err_rows_canary': err_rows['canary'], 'err_rows_control': err_rows['control'],
        'fast_share_canary': round(fs[('post', 'canary')], 4), 'fast_share_control': round(fs[('post', 'control')], 4),
        'instant_deaths_canary': instant, 'instant_over_1pct': int(judged and not fixed), 'skips_canary': skips[('post', 'canary')],
        'fast_control': fast[('post', 'control')], 'offbuild_canary': offbuild,
        'skips_did_per_bh': round(did(lambda p, a: per_bh(skips, p, a)), 3),
        'barren_share_did': round(did(lambda p, a: share(barren, gathers, p, a)), 4),
        'exposure_ready': int(judged and fast[('post', 'control')] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
