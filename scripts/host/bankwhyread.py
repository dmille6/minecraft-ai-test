#!/usr/bin/env python3
# bankwhyread.py [window_min] -- the read for the `bank-why` bundle member (branch bank-why-on-8ed9450, 17cca93).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: the deposit refusal names WHICH of five rules held the item back, instead of one sentence for all five.
#   old: "you are carrying apple, but apple is not a banking target right now — nothing to deposit"
#   new: "not a banking target (no goal wants it): you are carrying apple — nothing to deposit"
# The rule goes FIRST because this project's refusal reads bucket on Counter(detail[:95]); a trailing reason falls past
# the cut for a long item name and merges every rule back into the one bucket the change exists to split.
#
# WHY IT IS IN THE BUNDLE: measured on 8ed9450 over 4,483 deposit runs / 80 bots / 24 h (full walk, rotated logs
# included, 1,047,218 rows), this refusal is 49.2% of all deposit outcomes -- 2,203 runs -- and in EVERY one the bot
# held items the chests accept: median 32, max 504, oak_log in 1,275, cobblestone in 606. Once a lid opens 78% of runs
# convert, so the storing path is sound. The row could not say whether a reserve was holding bankable goods or the
# model had proposed junk, and that split decides which lever moves the stock number.
#
# BEHAVIOUR-NEUTRAL, so there is no effect to gate on:
#   LINKAGE      canary rows of the NEW shape >= 1, and control rows of the new shape == 0 (the string cannot exist
#                on the baseline). This is the member's only REVERT line.
#   INSTRUMENT   canary rows of the OLD shape == the positive control for contamination: a canary bot still writing
#                the old sentence has not settled onto the build. Reported, not gated (a restart transient).
#   POSITIVE CONTROL  refusals of EITHER shape, fleet-wide, must be > 0 -- otherwise the query is blind and every
#                zero above is meaningless. This is the check this repo's six confident-zero bugs were missing.
# REPORTED: the rule split, which is the entire point of the member.
import sys, os, json, re
import datetime as dt
from collections import Counter
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
from lib.telemetry import Events

man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man.get('canary_pool') or ''; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc)
elapsed = (now - CUT).total_seconds() / 60
W = int(min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180))
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)

NEW = re.compile(r'not a banking target \(([^)]+)\)')
OLD = re.compile(r'but \w+ is not a banking target right now')

def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])

# ROTATION. A read whose window crosses 23:59Z loses it to the daily .gz, and the live file alone then answers a
# six-hour question with forty minutes of rows. Measured 2026-10-01: a 1440-min walk read 31k rows instead of 1.05M.
def load_window(minutes):
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=minutes)
    import glob as _g
    d = (now - dt.timedelta(minutes=minutes)).date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        g = f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'
        if _g.glob(g):
            ev.rows.extend(Events.load(paths=g, since_minutes=minutes).rows)
        d += dt.timedelta(days=1)
    return ev

ev = load_window(int(elapsed + W + 90))
rows = [r for r in ev.rows if r.get('t') and PRE <= r['t'] < END]
new_rows, old_rows, rules, offbuild = Counter(), Counter(), Counter(), 0
any_refusal = 0
for r in rows:
    if r.get('name') != 'deposit':
        continue
    d = r.get('detail') or ''
    m = NEW.search(d); o = OLD.search(d)
    if not (m or o):
        continue
    any_refusal += 1
    b = (r.get('bot') or {}).get('name')
    arm = 'canary' if pool_of(b) in CANS else 'control'
    era = 'post' if r['t'] >= CUT else 'pre'
    if m:
        new_rows[(era, arm)] += 1
        if era == 'post' and arm == 'canary':
            rules[m.group(1)] += 1
            ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
            if CV and not ver.startswith(CV):
                offbuild += 1
    else:
        old_rows[(era, arm)] += 1

nc = new_rows[('post', 'canary')]; nk = new_rows[('post', 'control')]
oc = old_rows[('post', 'canary')]
print('rows %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
print('POSITIVE CONTROL  refusals of either shape in the window: %d  (0 means this query is blind)' % any_refusal)
print('LINKAGE           new-shape rows: canary %d (>= 1)   control %d (MUST be 0)' % (nc, nk))
print('INSTRUMENT        canary rows still on the OLD sentence: %d  (restart transient; off-build rows %d)' % (oc, offbuild))
print('RULE SPLIT        %s' % (dict(rules.most_common()) or 'none yet'))
ready = int(any_refusal > 0 and nc >= 20 and nk == 0)
print('EXPOSURE          %s (needs >= 20 canary new-shape rows, control 0, and a live positive control)' % ready)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    from readjson import emit
    emit('bankwhyread', W, {
        'rulenamed_rows_canary': nc, 'rulenamed_rows_control': nk,
        'oldshape_rows_canary': oc, 'offbuild_rows_canary': offbuild,
        'any_refusal_rows': any_refusal, 'rules_canary': dict(rules),
        'distinct_rules_canary': len(rules), 'exposure_ready': ready})
except Exception as e:
    print('emit failed:', e)
