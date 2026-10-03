#!/usr/bin/env python3
# logpickupread.py [window_min] -- the read for canary `logpickup-01` (branch logpickup-on-93b3892).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: after each log dig, gather picks up THAT dig's drop: wait if it is in the pickup box, break the supporting
# leaf/log when the drop rests 2.3+ above the feet, else walk to a pickup-box goal; done only on a bag gain; a block broken
# and nothing gained is `pickup_failed` (no learned-avoid vote), not no_path. MOTIVE (10-03, both engines): 291 of 949
# failed log gathers ended "collect threw nothing" -> no_path (an avoid vote); 1,866 log drops left vs 2,584 gained / 3 h.
# SANDBOX (10-03): open trunk 15/15 vs 12/15 at 1.8 vs 6.7 s/log; canopy 18/18 vs 14/18; full bag 1 log + inventory_full
# vs control 3 logs left + no_path + an avoid rule.
#
#   LIVENESS     canary `_pickup_reach` rows from the canary build (>= 1); control 0.
#   CORRECTNESS  canary log gathers ending "collect threw nothing" (the old barren signature): 0, judged on >= 20 canary
#                log gathers. The control's same rows are the positive control.
#   PRIMARY      logs gained per bot-hour (from gather success "collected N <x>_log"), DiD vs the pre-window. REPORTED.
# REPORTED: _pickup_reach outcomes and strategies, left reasons, canary fail classes for log gathers, _pickup_sweep saplings.
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
OLD = 'collect threw nothing'
COLL = re.compile(r'collected (\d+) (\w+_log)')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def skill(r):
    return (r.get('raw') or {}).get('skill') or {}


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=PRE, until=END)
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev.rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
reach = defaultdict(Counter); strat = Counter(); left = Counter(); offbuild = 0
gathers = Counter(); old_sig = Counter(); logs = defaultdict(Counter); fails = Counter(); saplings = 0
botsets = defaultdict(lambda: defaultdict(set))
for r in ev.rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(b)
    k = r.get('name'); d = r.get('detail') or ''
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if k == '_pickup_reach' and period == 'post':
        if other:
            offbuild += 1
            continue
        reach[arm][skill(r).get('status') or '?'] += 1
        if arm == 'canary':
            m = re.search(r' via (\S+)', d); strat[m.group(1).split('>')[0] if m else '?'] += 1
            m = re.search(r'why=(\w+)', d)
            if m:
                left[m.group(1)] += 1
    if k == '_pickup_sweep' and period == 'post' and arm == 'canary' and not other:
        m = re.search(r'saplings[= +]+(\d+)', d); saplings += int(m.group(1)) if m else 0
    if k == 'gather' and str((skill(r).get('args') or {}).get('block', '')).endswith('_log'):
        if period == 'post' and not other:
            gathers[arm] += 1
            if OLD in d:
                old_sig[arm] += 1
            if arm == 'canary' and skill(r).get('status') != 'success':
                fails[skill(r).get('fail_class') or r.get('fail_class') or '?'] += 1
        if skill(r).get('status') == 'success' and not other:
            for n, _ in COLL.findall(d):
                logs[period][arm] += int(n)


def per_bh(c, period, arm):
    n = len(botsets[period][arm])
    return c[period][arm] / (n * W / 60) if n else float('nan')


v = {(p, a): per_bh(logs, p, a) for p in ('pre', 'post') for a in ('canary', 'control')}
did = (v[('post', 'canary')] - v[('pre', 'canary')]) - (v[('post', 'control')] - v[('pre', 'control')])
judged = gathers['canary'] >= 20
print('-' * 78)
print('LIVENESS     canary _pickup_reach %d (>= 1) | control %d (must be 0) | other build %d'
      % (sum(reach['canary'].values()), sum(reach['control'].values()), offbuild))
print('CORRECTNESS  canary log gathers with the old "%s": %d of %d (0; %s)'
      % (OLD, old_sig['canary'], gathers['canary'], 'judged' if judged else 'NOT judged: < 20'))
print('INSTRUMENT   control: %d of %d (positive control, >= 1)' % (old_sig['control'], gathers['control']))
print('PRIMARY      logs/bot-h canary %.2f -> %.2f | control %.2f -> %.2f | DiD %+.2f'
      % (v[('pre', 'canary')], v[('post', 'canary')], v[('pre', 'control')], v[('post', 'control')], did))
print('REPORTED     reach %s | strategy %s | left %s | canary log fail classes %s | sweep saplings %d'
      % (dict(reach['canary']), dict(strat), dict(left), dict(fails.most_common(6)), saplings))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('logpickupread', W, {
        'reach_rows_canary': sum(reach['canary'].values()), 'reach_rows_control': sum(reach['control'].values()),
        'offbuild_canary': offbuild, 'log_gathers_canary': gathers['canary'],
        'old_signature_canary': old_sig['canary'], 'old_signature_judged': int(judged and old_sig['canary'] > 0),
        'old_signature_control': old_sig['control'],
        'logs_did_per_bh': round(did, 3), 'logs_post_canary_per_bh': round(v[('post', 'canary')], 3),
        'exposure_ready': int(judged and old_sig['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
