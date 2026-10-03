#!/usr/bin/env python3
# craftroomread.py [window_min] -- the read for canary `craftroom-01`, REWRITTEN 10-03 for craftroom ON CRAFTSYNC.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (branch cr-on-<fleet>): craft checks bag room before every execution (recursive and planned steps too) and
# again on craftsync's resynced bag just before the first click; makes room only by wearing out a spent tool (never the
# last digging pickaxe); crafts one execution at a time; takes back only the table it placed. craftsync is the ONE
# verifier: a `_craft_room` row is success (source=server), unverified (verdict=denied|unanswered|click_timeout,
# source=server|none) or verified_local (only if craftsync is NOT installed).
# WHY THE OLD READ CANNOT MEASURE THIS (Claude review 10-03): its tripwire parsed source= only on success/verified_local
# rows (0 by construction now), and its "nothing changed" correctness gate cannot fire once the CONTROL runs craftsync.
#
#   LIVENESS     canary `_craft_room` rows from the canary build (>= 1); control 0.
#   CORRECTNESS  canary pickaxe crafts the SERVER saw lost -- `_craft_sync` confirmed=no, verify_source=resync, produced<=0,
#                clicks>0 -- with the bag at >= 35 estimated slots after the craft: <= 1 (one residual pickup race once
#                clicks have started is tolerated; craftsync can detect that toss but not prevent it). Judged on >= 10
#                canary pickaxe crafts. The control's same count is the positive control (>= 1).
#   INSTRUMENT   share of canary execution rows with verdict=unanswered > 5% BLOCKS KEEP (judged on >= 20 rows): the
#                design relies on Paper answering window-0 resyncs. verified_local on the canary must be 0 (it means
#                craftsync is not installed on a canary bot).
# REPORTED: lost-pickaxe rate DiD, room refusals by reason, table_retaken, usable pickaxe holders canary vs control.
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
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')


def occupancy(inv):
    """Estimated bag slots (hygiene-pool-check.py's estimator): unstackables 1 each, else ceil(count/64)."""
    return sum(c if UN.search(n) else -(-c // 64) for n, c in (inv or {}).items() if isinstance(c, (int, float)))


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def skill(r):
    return (r.get('raw') or {}).get('skill') or {}


def lost_on_server(a):
    produced = a.get('produced')
    return (str(a.get('confirmed')) == 'no' and a.get('verify_source') == 'resync'
            and (produced is None or produced <= 0) and int(a.get('clicks') or 0) > 0)


# POSITIVE CONTROL for the predicate and the estimator.
assert lost_on_server({'confirmed': 'no', 'verify_source': 'resync', 'produced': 0, 'clicks': 9})
assert not lost_on_server({'confirmed': 'yes', 'verify_source': 'resync', 'produced': 1, 'clicks': 9})
assert not lost_on_server({'confirmed': 'no', 'verify_source': 'resync', 'produced': 0, 'clicks': 0})    # refused before clicking
assert occupancy({'cobblestone': 65, 'stone_pickaxe': 2}) == 4

ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=PRE, until=END)
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev.rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
room = defaultdict(Counter); verdicts = Counter(); refusals = Counter(); retake = Counter(); offbuild = 0
pick_sync = Counter(); lost_full = Counter(); lost = defaultdict(Counter); picks = defaultdict(Counter)
botsets = defaultdict(lambda: defaultdict(set)); last = {}
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
    if period == 'post' and not other and ((r.get('raw') or {}).get('bot') or {}).get('tools') is not None:
        last[b] = r
    if k in ('_craft_room', '_table_retaken') and period == 'post':
        if other:
            offbuild += 1
            continue
        st = skill(r).get('status') or r.get('status') or '?'
        if k == '_craft_room':
            room[arm][st] += 1
            if arm == 'canary':
                m = re.search(r'verdict=(\w+)', d)
                verdicts[m.group(1) if m else ('server' if st == 'success' else st)] += 1
                m = re.search(r'refus\w*[:=] ?(\w+)', d)
                if st not in ('success', 'unverified', 'verified_local') and m:
                    refusals[m.group(1)] += 1
        elif arm == 'canary':
            retake[st] += 1
    if k == '_craft_sync' and not other:
        a = skill(r).get('args') or {}
        if str(a.get('item') or '').endswith('_pickaxe'):
            picks[period][arm] += 1
            gone = lost_on_server(a)
            lost[period][arm] += int(gone)
            if period == 'post':
                pick_sync[arm] += 1
                inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory') or (r.get('bot') or {}).get('inventory')
                if gone and occupancy(inv) >= 35:
                    lost_full[arm] += 1


def rate(period, arm):
    return lost[period][arm] / picks[period][arm] if picks[period][arm] else float('nan')


def usable(arm):
    n = g = 0
    for b, r in last.items():
        if (pool_of(b) in CANS) != (arm == 'canary'):
            continue
        tools = ((r.get('raw') or {}).get('bot') or {}).get('tools') or {}
        n += 1
        g += any(e.get('max', 0) - e.get('used', 0) > 10 for k, v in tools.items() if k.endswith('_pickaxe') for e in v)
    return g, n


execs = room['canary']['success'] + room['canary']['unverified'] + room['canary']['verified_local']
unans = verdicts['unanswered']
share = unans / execs if execs else float('nan')
judged = pick_sync['canary'] >= 10
did = (rate('post', 'canary') - rate('pre', 'canary')) - (rate('post', 'control') - rate('pre', 'control'))
gc, nc = usable('canary'); gk, nk = usable('control')
print('-' * 78)
print('LIVENESS     canary _craft_room rows %d (>= 1) | control %d (must be 0) | other build %d'
      % (sum(room['canary'].values()), sum(room['control'].values()), offbuild))
print('             canary statuses %s | verdicts %s' % (dict(room['canary']), dict(verdicts)))
print('CORRECTNESS  canary pickaxe crafts lost on the server with a full bag: %d of %d (<= 1; %s)'
      % (lost_full['canary'], pick_sync['canary'], 'judged' if judged else 'NOT judged: < 10'))
print('INSTRUMENT   control: %d of %d (positive control, >= 1)' % (lost_full['control'], pick_sync['control']))
print('TRIPWIRE     verdict=unanswered %d of %d executions = %.1f%% (> 5%% blocks KEEP) | verified_local %d (must be 0)'
      % (unans, execs, 100 * share if execs else float('nan'), room['canary']['verified_local']))
print('REPORTED     lost-pickaxe rate canary %.3f -> %.3f | control %.3f -> %.3f | DiD %+.3f'
      % (rate('pre', 'canary'), rate('post', 'canary'), rate('pre', 'control'), rate('post', 'control'), did))
print('             refusals %s | table_retaken %s | pickaxe>10 uses: canary %d/%d control %d/%d'
      % (dict(refusals), dict(retake), gc, nc, gk, nk))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('craftroomread', W, {
        'room_rows_canary': sum(room['canary'].values()), 'room_rows_control': sum(room['control'].values()),
        'offbuild_canary': offbuild,
        'pick_crafts_canary': pick_sync['canary'], 'lost_full_canary': lost_full['canary'],
        'lost_full_judged': int(judged and lost_full['canary'] > 1), 'lost_full_control': lost_full['control'],
        'unanswered_share': None if not execs else round(share, 4),
        'unanswered_over_5pct': int(execs >= 20 and share > 0.05),
        'verified_local_canary': room['canary']['verified_local'],
        'lost_rate_did': None if did != did else round(did, 4),
        'retake_taken': retake['taken'] + retake['success'], 'retake_left': retake['left'],
        'usable_pick_canary': gc, 'bots_canary': nc, 'usable_pick_control': gk, 'bots_control': nk,
        'exposure_ready': int(judged and lost_full['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
