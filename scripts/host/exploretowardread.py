#!/usr/bin/env python3
# exploretowardread.py [window_min] -- the read for canary `exploretoward-01` (branch explore-toward).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: an explore under a gather/stockpile-wood task (or a detour naming logs, sand, raw_iron or coal) walks to
# the nearest sighting of THAT material, re-aims after each leg and stops on arrival -- instead of the iron-first
# order, which chose every walk (1,287 of 8,766 explores walked to iron under a wood/dirt/sand/stone task, 28-29 Sep).
# Stone and dirt tasks keep today's explore. A null heading no longer means due east.
# Exposure is ~0.74-0.80 in-scope explores/bot-h (both reviews), so an items effect is NOT measurable on 10 bots in
# 6 h: this is a CORRECTNESS gate (owner 09-29: fixes are judged on a deterministic correctness gate).
#
#   LIVENESS     canary `_explore_toward_milestone` rows from the canary build (>= 1); control 0.
#   CORRECTNESS  every aimed row's target is one of the kinds the task asked for (0 outside, judged on >= 15 rows).
#                The positive control is the row's own `legacy=`: the old order's pick, which must differ from the
#                target in some rows, or the check could not have seen a wrong target.
#   INSTRUMENT   control `_explore_toward_known` rows >= 1 (explore targeting is visible to this query).
# REPORTED: arrived share of aimed walks (`_explore_toward_milestone_end`), none_known share, target != legacy share,
# explore distance_moved median and failed/no_effect share (DiD vs the same-length pre-window), explores/bot-h.
import sys, os, json, re
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

ROW = re.compile(r'kinds=(\S+) target=(\S+?)(?:@\S+ d=(\d+))?(?: skipped=\d+)? legacy=(\S+)')
m = ROW.search('task=gather_oak_log_12 kinds=oak_log,birch_log,spruce_log target=birch_log@1,64,2 d=35 legacy=iron_ore')
assert m and m.groups() == ('oak_log,birch_log,spruce_log', 'birch_log', '35', 'iron_ore'), m and m.groups()
m = ROW.search('task=stockpile_wood#3 kinds=oak_log target=none_known skipped=0 legacy=none')
assert m and m.group(2) == 'none_known' and m.group(4) == 'none', m and m.groups()


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else float('nan')


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(elapsed + W + 60))
bots = defaultdict(set)
aimed, outside, differs, none_known, unparsed, offbuild = Counter(), 0, 0, 0, 0, 0
ends, arrived = 0, 0
explores, bad, moved, known_rows = Counter(), Counter(), defaultdict(list), Counter()
for r in ev.rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b or not (PRE <= t < END):
        continue
    a = 'canary' if pool_of(b) in CANS else 'control'; p = 'post' if t >= CUT else 'pre'
    bots[(p, a)].add(b)
    k, d = r.get('name'), (r.get('detail') or '')
    if k == '_explore_toward_milestone' and p == 'post':
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if a == 'canary' and CV and not ver.startswith(CV):
            offbuild += 1
            continue
        aimed[a] += 1
        if a != 'canary':
            continue
        mm = ROW.search(d)
        if not mm:
            unparsed += 1
            continue
        kinds, target, _dist, legacy = mm.groups()
        if target == 'none_known':
            none_known += 1
        else:
            if target not in kinds.split(','):
                outside += 1
            if target != legacy:
                differs += 1
    elif k == '_explore_toward_milestone_end' and p == 'post' and a == 'canary':
        ends += 1
        arrived += d.startswith('arrived')
    elif k == '_explore_toward_known' and p == 'post':
        known_rows[a] += 1
    elif k == 'explore':
        explores[(p, a)] += 1
        if r.get('status') in ('failed', 'no_effect'):
            bad[(p, a)] += 1
        dm = (((r.get('raw') or {}).get('skill') or {}).get('distance_moved'))
        if isinstance(dm, (int, float)):
            moved[(p, a)].append(dm)


def per_bh(c, p, a):
    n = len(bots[(p, a)])
    return c[(p, a)] / (n * W / 60) if n else float('nan')


def share(c, d, p, a):
    return c[(p, a)] / d[(p, a)] if d[(p, a)] else float('nan')


did = lambda f: (f('post', 'canary') - f('pre', 'canary')) - (f('post', 'control') - f('pre', 'control'))
targeted = aimed['canary'] - none_known - unparsed
judged = aimed['canary'] >= 15
print('canary %s  sha %s  cutoff %s  window +%d min' % (CAN, CV, CUT.strftime('%H:%MZ'), W))
print('-' * 78)
print('LIVENESS     canary aimed rows %d (>= 1) | control %d (0) | canary rows from another build %d'
      % (aimed['canary'], aimed['control'], offbuild))
print('CORRECTNESS  targets outside the task kinds: %d of %d targeted (0; judged on >= 15 rows: %s)'
      % (outside, targeted, 'judged' if judged else 'NOT judged'))
print('             positive control: target != legacy pick in %d of %d (the check could see a wrong target)' % (differs, targeted))
print('INSTRUMENT   control _explore_toward_known rows %d (>= 1)' % known_rows['control'])
print('REPORTED     arrived %d of %d aimed walks with a target; none_known %d of %d; unparsed %d'
      % (arrived, ends, none_known, aimed['canary'], unparsed))
print('             explores/bot-h DiD %+.2f | failed+no_effect share DiD %+.3f'
      % (did(lambda p, a: per_bh(explores, p, a)), did(lambda p, a: share(bad, explores, p, a))))
print('             median distance_moved canary %s -> %s | control %s -> %s'
      % (median(moved[('pre', 'canary')]), median(moved[('post', 'canary')]), median(moved[('pre', 'control')]), median(moved[('post', 'control')])))
print('-' * 78)

try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('exploretowardread', W, {
        'aimed_rows_canary': aimed['canary'], 'aimed_rows_control': aimed['control'], 'offbuild_canary': offbuild,
        'outside_kinds_judged': int(judged and outside > 0), 'outside_kinds': outside, 'targeted': targeted,
        'differs_from_legacy': differs, 'none_known': none_known, 'unparsed': unparsed,
        'arrived': arrived, 'aimed_ends': ends, 'known_rows_control': known_rows['control'],
        'explores_did_per_bh': round(did(lambda p, a: per_bh(explores, p, a)), 3),
        'bad_share_did': round(did(lambda p, a: share(bad, explores, p, a)), 4),
        'exposure_ready': int(judged and known_rows['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
