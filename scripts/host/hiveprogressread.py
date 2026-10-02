#!/usr/bin/env python3
# hiveprogressread.py [window_min] -- the hive-progress member of the fixes bundle (branch hive-progress, e102545).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: a SHARED (hive) lessons store keeps each bot's milestone progress in its own versioned slot, so a restart
# restores that bot's skips/backoff/completions instead of starting empty, and peers' slots are never overwritten.
# Every load writes `_progress_restored` (shared=, run=, skipped=, cycle=, blocked=, attempts=), a row only this build
# writes. A legacy slot (the old build's) loads EMPTY by design, so the deploy's own restart restores nothing; only a
# LATER restart can show restored progress. The effect is expected INCONCLUSIVE (hive pools only, n small).
#
#   LIVENESS     canary `_progress_restored` rows (>= 1: every canary bot writes one at the deploy restart); control 0.
#   CORRECTNESS  a canary hive bot whose SECOND or later load in the window restores nothing at all (skipped=0 cycle=0
#                attempts=0 blocked=0) while its earlier load in the window saved progress is REPORTED, not gated:
#                a bot that genuinely made no progress also reads empty.
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
ROW = re.compile(r'shared=(\d) run=(\d+) skipped=(\d+) cycle=(\d+) blocked=(\d+) attempts=(\d+)')
assert ROW.search('shared=1 run=7 skipped=2 cycle=3 blocked=0 attempts=1').groups() == ('1', '7', '2', '3', '0', '1')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(elapsed + 60))
rows, offbuild = Counter(), 0
loads = defaultdict(list)
# COVERAGE (Codex review of fixes-03, where this row is the LICENCE): every canary bot seen on the canary build must have
# written one. `restored_rows_canary >= 1` alone let one bot stand for the pool.
seen_canary, wrote_canary = set(), set()
for r in ev.rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is not None and b and CUT <= t < END and pool_of(b) in CANS and CV and \
            (((r.get('raw') or {}).get('code') or {}).get('version') or '').startswith(CV):
        seen_canary.add(b)
    if t is None or not b or not (CUT <= t < END) or r.get('name') != '_progress_restored':
        continue
    a = 'canary' if pool_of(b) in CANS else 'control'
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    if a == 'canary' and CV and not ver.startswith(CV):
        offbuild += 1
        continue
    rows[a] += 1
    if a == 'canary':
        wrote_canary.add(b)
    m = ROW.search(r.get('detail') or '')
    if a == 'canary' and m:
        loads[b].append((t, tuple(int(x) for x in m.groups())))
restored = sum(1 for b, ls in loads.items() for (_t, g) in sorted(ls)[1:] if g[0] == 1 and (g[2] or g[3] or g[4] or g[5]))
later_loads = sum(max(0, len(ls) - 1) for ls in loads.values())
print('canary %s  sha %s  cutoff %s  window +%d min' % (CAN, CV, CUT.strftime('%H:%MZ'), W))
print('LIVENESS     canary _progress_restored rows %d (>= 1) | control %d (0) | other build %d' % (rows['canary'], rows['control'], offbuild))
missing_bots = sorted(seen_canary - wrote_canary)
print('COVERAGE     canary-build bots seen %d; without a _progress_restored row %d %s' % (len(seen_canary), len(missing_bots), missing_bots[:10]))
print('REPORTED     shared canary bots whose LATER load restored non-empty progress: %d of %d later loads' % (restored, later_loads))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('hiveprogressread', W, {
        'restored_rows_canary': rows['canary'], 'restored_rows_control': rows['control'], 'offbuild_canary': offbuild,
        'later_loads_restored': restored, 'later_loads': later_loads,
        'bots_seen_canary': len(seen_canary), 'bots_without_restore_canary': len(missing_bots),
    })
except Exception as e:
    print('emit failed:', e)
