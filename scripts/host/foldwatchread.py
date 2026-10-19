#!/usr/bin/env python3
# foldwatchread.py [window_min] -- the read for canary `foldwatch-01` (the stagnation watchdog exempts a PROGRESSING
# bamboo fold; stacked on bamboo-03, so BOTH arms fold). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: watchdog.mjs declaredSession = furnace window OR a fold window that is open (the fold's own plan-sized,
# <= 90 s window) and progressing (a server-confirmed craft within 15 s); the fold's booked item loss is added back to
# the stagnation sample. Nothing new is written: the licence is RATE (report-only by construction; only the
# catastrophe gates can revert).
#
#   PRIMARY     fold stops by the stagnation watchdog per fold run, canary vs control (bamboo-02 fleet: 3 of 14)
#   TRIPWIRES   (reported, named) canary fold runs longer than 95 s (the exemption cannot outlive a 90 s window);
#               canary _stagnation rows per bot-hour vs control (the exemption must not hide stuck bots: a canary rate
#               well BELOW control would say so); canary folds that completed (stop=done) per fold run
#   INSTRUMENT  control fold runs >= 1 (both arms fold on a bamboo-03 fleet) -- the population is visible
#   EXPOSURE    >= 3 canary fold runs (crafted, or cut by an abort)
import sys, os, json
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


def load_window(since, until):
    """Rotation-aware (bambooread's): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z rotation."""
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
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def num(a, k):
    try:
        return int(float(a.get(k)))
    except (TypeError, ValueError):
        return None


def fold_run(a, st):
    """A fold that started crafting -> (ran, stopped_by_stagnation, completed). Pure."""
    c = num(a, 'crafts') or 0
    stop = str(a.get('stop') or '')
    ran = c > 0 or stop.startswith('aborted')
    return ran, ran and stop.startswith('aborted:stagnation'), ran and st == 'success' and stop == 'done'


assert fold_run({'crafts': 6, 'stop': 'aborted:stagnation'}, 'aborted') == (True, True, False)
assert fold_run({'crafts': 0, 'stop': 'aborted:stagnation'}, 'aborted') == (True, True, False)   # Bravo 04:12 (bamboo-02)
assert fold_run({'crafts': 32, 'stop': 'done'}, 'success') == (True, False, True)
assert fold_run({'crafts': 0, 'stop': 'no_plan'}, 'no_effect') == (False, False, False)

rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
folds = Counter(); stag_folds = Counter(); done = Counter(); long_runs = []; stag = Counter(); bots = defaultdict(set)
offbuild = 0
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); sk = (r.get('raw') or {}).get('skill') or {}
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
        offbuild += 1
        continue
    bots[(arm, period)].add(b)
    if k == '_stagnation':
        stag[(arm, period)] += 1
    if k != '_bamboo_sticks':
        continue
    a = sk.get('args') or {}; st = sk.get('status') or r.get('status')
    ran, by_stag, completed = fold_run(a, st)
    if not ran:
        continue
    folds[(arm, period)] += 1; stag_folds[(arm, period)] += by_stag; done[(arm, period)] += completed
    dm = sk.get('durationMs') or sk.get('duration_ms')
    if arm == 'canary' and period == 'post' and isinstance(dm, (int, float)) and dm > 95_000:
        long_runs.append((b, t.strftime('%H:%M:%SZ'), int(dm), a.get('stop')))

bh = lambda arm, period: len(bots[(arm, period)]) * W / 60 or float('nan')
share = lambda arm, period: (stag_folds[(arm, period)] / folds[(arm, period)]) if folds[(arm, period)] else float('nan')
rate = lambda arm, period: stag[(arm, period)] / bh(arm, period)
did_stag = (rate('canary', 'post') - rate('canary', 'pre')) - (rate('control', 'post') - rate('control', 'pre'))
print('-' * 78)
print('PRIMARY      fold runs stopped by stagnation: canary %d of %d (%.2f) | control %d of %d (%.2f)  [post]' % (
    stag_folds[('canary', 'post')], folds[('canary', 'post')], share('canary', 'post'),
    stag_folds[('control', 'post')], folds[('control', 'post')], share('control', 'post')))
print('             completed folds: canary %d of %d | control %d of %d' % (
    done[('canary', 'post')], folds[('canary', 'post')], done[('control', 'post')], folds[('control', 'post')]))
print('TRIPWIRES    canary fold runs > 95 s: %d %s' % (len(long_runs), long_runs[:5]))
print('             _stagnation rows/bot-h  canary %.3f -> %.3f | control %.3f -> %.3f | DiD %+.3f (a canary drop well below control '
      'would mean stuck bots hidden)' % (rate('canary', 'pre'), rate('canary', 'post'), rate('control', 'pre'), rate('control', 'post'), did_stag))
print('INSTRUMENT   control fold runs (post) %d (>= 1) | other build canary rows %d' % (folds[('control', 'post')], offbuild))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    nz = lambda x: None if x != x else round(x, 4)
    emit('foldwatchread', W, {
        'fold_runs_canary': folds[('canary', 'post')], 'fold_runs_control': folds[('control', 'post')],
        'stag_folds_canary': stag_folds[('canary', 'post')], 'stag_folds_control': stag_folds[('control', 'post')],
        'stag_share_canary': nz(share('canary', 'post')), 'stag_share_control': nz(share('control', 'post')),
        'done_canary': done[('canary', 'post')], 'long_runs_canary': len(long_runs),
        'stagnation_did_per_bh': nz(did_stag), 'instrument_control': folds[('control', 'post')],
        'exposure_ready': int(folds[('canary', 'post')] >= 3),
    })
except Exception as e:
    print('emit failed:', e)
