#!/usr/bin/env python3
# craftroomread.py [window_min] -- the read for canary `craftroom-01` (branch craftroom-on-3edf1d6).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: craft checks room before every craft step (recursive levels too), makes room only by wearing out a spent
# tool (never the last digging pickaxe), crafts one repetition at a time and accepts a result only on a server packet
# after the final put-away click, else on the local count (`verified_local`); it takes back only the table it placed.
# MOTIVE (10-02, 80 bots, 27 h): 487 of 1,115 claimed stone_pickaxe crafts (44%) ended "nothing changed" -- mineflayer
# throws a craft result out of a full bag; craft placed its table and walked away (256 decrements, 172 re-crafted).
#
#   LIVENESS     canary `_craft_room` rows from the canary build (>= 1); control 0 (the baseline has no such kind).
#   CORRECTNESS  canary pickaxe crafts the runner calls done that gained nothing ("nothing changed that craft exists to
#                change"): 0, judged on >= 10 canary pickaxe crafts. The control's same rows are the positive control.
#   INSTRUMENT   (owner gate, Claude review) share of verified crafts that were confirmed only LOCALLY (`verified_local`):
#                a high share means the server-confirmation assumption broke on this Paper build. > 5% BLOCKS KEEP.
# REPORTED: table_retaken taken/left/gone, crafting_table crafts per bot-hour (DiD), refusals by reason, holders of a
# pickaxe with > 10 uses (last row per bot) canary vs control.
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
NOTHING = 'nothing changed that craft exists to change'


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def args_of(r):
    return ((r.get('raw') or {}).get('skill') or {}).get('args') or {}


def status_of(r):
    return r.get('status') or ((r.get('raw') or {}).get('skill') or {}).get('status')


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=PRE, until=END)
rows = sorted(ev.rows, key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))

room = defaultdict(Counter)            # arm -> status of _craft_room rows (canary-build only for canary)
src = Counter()                        # canary verified sources
retake = Counter()                     # canary _table_retaken statuses
pick_crafts = Counter(); pick_nothing = Counter()   # (arm) post-cutoff pickaxe craft rows / 'nothing changed'
tables = defaultdict(Counter)          # [period][arm] crafting_table crafts
botsets = defaultdict(lambda: defaultdict(set))
offbuild = 0
last = {}
for r in rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(b)
    if period == 'post':
        last[b] = r
    k = r.get('name'); d = r.get('detail') or ''
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    known_other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if k in ('_craft_room', '_table_retaken') and period == 'post':
        if known_other:
            offbuild += 1
            continue
        st = status_of(r) or '?'
        if k == '_craft_room':
            room[arm][st] += 1
            if arm == 'canary':
                m = re.search(r'source=(\w+)', d)
                if m and st in ('success', 'verified_local'):
                    src[m.group(1)] += 1
        elif arm == 'canary':
            retake[st] += 1
    if k == 'craft':
        item = str(args_of(r).get('item') or '')
        if item == 'crafting_table':
            tables[period][arm] += 1
        if item.endswith('_pickaxe') and period == 'post' and not known_other:
            pick_crafts[arm] += 1
            if NOTHING in d:
                pick_nothing[arm] += 1


def per_bh(c, period, arm):
    n = len(botsets[period][arm])
    return c[period][arm] / (n * W / 60) if n else float('nan')


def usable_holders(arm):
    n = good = 0
    for b, r in last.items():
        if (pool_of(b) in CANS) != (arm == 'canary'):
            continue
        tools = ((r.get('raw') or {}).get('bot') or {}).get('tools') or {}
        n += 1
        good += any(e.get('max', 0) - e.get('used', 0) > 10 for k, v in tools.items() if k.endswith('_pickaxe') for e in v)
    return good, n


verified = src['server'] + src['local']
local_share = src['local'] / verified if verified else float('nan')
judged = pick_crafts['canary'] >= 10
tdid = (per_bh(tables, 'post', 'canary') - per_bh(tables, 'pre', 'canary')) - (per_bh(tables, 'post', 'control') - per_bh(tables, 'pre', 'control'))
gc, nc = usable_holders('canary'); gk, nk = usable_holders('control')
print('-' * 78)
print('LIVENESS     canary _craft_room rows %d (>= 1) | control %d (must be 0) | canary rows from another build %d'
      % (sum(room['canary'].values()), sum(room['control'].values()), offbuild))
print('             canary statuses %s' % dict(room['canary']))
print('CORRECTNESS  canary pickaxe crafts that gained nothing: %d of %d (0; %s)'
      % (pick_nothing['canary'], pick_crafts['canary'], 'judged' if judged else 'NOT judged: < 10 crafts'))
print('INSTRUMENT   control pickaxe crafts that gained nothing: %d of %d (positive control, >= 1)' % (pick_nothing['control'], pick_crafts['control']))
print('TRIPWIRE     verified locally only: %d of %d verified crafts = %.1f%% (> 5%% blocks KEEP; ~1%% expected)'
      % (src['local'], verified, 100 * local_share if verified else float('nan')))
print('REPORTED     table_retaken %s | crafting_table crafts/bot-h DiD %+.3f | pickaxe>10 uses: canary %d/%d control %d/%d'
      % (dict(retake), tdid, gc, nc, gk, nk))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('craftroomread', W, {
        'room_rows_canary': sum(room['canary'].values()), 'room_rows_control': sum(room['control'].values()),
        'offbuild_canary': offbuild,
        'pick_crafts_canary': pick_crafts['canary'], 'pick_nothing_canary': pick_nothing['canary'],
        'pick_nothing_judged': int(judged and pick_nothing['canary'] > 0),
        'pick_nothing_control': pick_nothing['control'],
        'verified_server_canary': src['server'], 'verified_local_canary': src['local'],
        'local_share': None if not verified else round(local_share, 4),
        'local_share_over_5pct': int(verified >= 20 and local_share > 0.05),
        'retake_taken': retake['taken'] + retake['success'], 'retake_left': retake['left'],
        'table_crafts_did_per_bh': round(tdid, 4),
        'usable_pick_canary': gc, 'bots_canary': nc, 'usable_pick_control': gk, 'bots_control': nk,
        'exposure_ready': int(judged and pick_nothing['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
