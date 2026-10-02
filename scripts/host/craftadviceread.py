#!/usr/bin/env python3
# craftadviceread.py [window_min] -- the craft-advice member of the fixes bundle (branch craft-advice, ada1e4d).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: craft's recipe choice breaks a tie by where the bot can get the ingredient (sourceReachCost): cobblestone
# above y=0, cobbled_deepslate below, never blackstone in the overworld, never "gather charcoal". 24 h to 09-29 17:30Z
# on 80b3bbd: 1,782 of 4,238 craft rows (42%, 71 bots) named cobbled_deepslate, 1,773 at y >= 0.
# LOW IMPACT by both reviews (the model already asks for cobblestone); this read is a CORRECTNESS gate only.
#
#   CORRECTNESS  canary craft rows at y >= 0 whose detail names cobbled_deepslate while the bot holds none of it: 0,
#                judged on >= 10 canary craft rows that name a stone-family gather ("gather cob").
#                Plus 0 canary craft rows advising "gather charcoal".
#   INSTRUMENT   control rows of the same defect >= 1.
import sys, os, json, re
import datetime as dt
from collections import Counter
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


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(elapsed + 60))
stoneish, bad, charcoal, offbuild = Counter(), Counter(), Counter(), 0
for r in ev.rows:
    t = r.get('t'); bot = r.get('bot') or {}; b = bot.get('name')
    if t is None or not b or not (CUT <= t < END) or r.get('name') != 'craft':
        continue
    a = 'canary' if pool_of(b) in CANS else 'control'
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    if a == 'canary' and CV and not ver.startswith(CV):
        offbuild += 1
        continue
    d = r.get('detail') or ''
    if 'gather cob' in d:
        stoneish[a] += 1
    y = (bot.get('pos') or {}).get('y')
    held = ((bot.get('inventory') or {}).get('cobbled_deepslate') or 0)
    if 'cobbled_deepslate' in d and y is not None and y >= 0 and held == 0:
        bad[a] += 1
    if 'gather charcoal' in d:
        charcoal[a] += 1

judged = stoneish['canary'] >= 10
print('canary %s  sha %s  cutoff %s  window +%d min' % (CAN, CV, CUT.strftime('%H:%MZ'), W))
print('CORRECTNESS  canary deepslate advice at y >= 0 holding none: %d (0; judged on >= 10 stone-family craft rows, have %d: %s) | charcoal advice %d'
      % (bad['canary'], stoneish['canary'], 'judged' if judged else 'NOT judged', charcoal['canary']))
print('INSTRUMENT   control rows of the same defect: %d (>= 1) | other build %d' % (bad['control'], offbuild))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('craftadviceread', W, {
        'deepslate_advice_judged': int(judged and bad['canary'] > 0), 'deepslate_advice_canary': bad['canary'],
        'charcoal_advice_canary': charcoal['canary'], 'defect_control': bad['control'], 'stoneish_canary': stoneish['canary'],
        'exposure_ready': int(judged and bad['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
