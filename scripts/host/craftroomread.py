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
#   CORRECTNESS  canary pickaxe crafts the SERVER saw lost -- `_craft_sync` outcome=unconfirmed, confirmed=no,
#                verify_source=resync, produced<=0, clicks>0: <= 1 (one residual pickup race once clicks have started is
#                tolerated; craftsync detects that toss but cannot prevent it). NOT filtered by bag fullness: the slot
#                estimate merges split stacks and treats 16-stacks as 64, so a real 36/36 bag often reads < 35 (Claude
#                review r2); the >= 35 subset is REPORTED. Under craftsync's lockstep, server denials are ~0, so what is
#                left is tosses. Judged on >= 10 canary pickaxe crafts; the control's count is the positive control.
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


def load_window(since, until):
    """Rotation-aware (oretunnelread's pattern): skill logs rotate daily at ~23:59Z (copytruncate), so day D's rows live
    in skill-*.jsonl-<D+1>.gz and the live file starts at ~23:59Z. Reading only the live files silently drops every row
    before the last rotation -- found 10-04 01:08Z when a 6 h window walked 58k rows instead of ~290k."""
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


def skill(r):
    return (r.get('raw') or {}).get('skill') or {}


def clicked(a):
    """A craft that sent clicks: excludes craftsync's refused (admission, canary only) and busy rows, which would
    dilute the canary's lost rate and its DiD (Claude review r3)."""
    return int(a.get('clicks') or 0) > 0


def lost_on_server(a):
    produced = a.get('produced')
    return (a.get('outcome') == 'unconfirmed' and str(a.get('confirmed')) == 'no' and a.get('verify_source') == 'resync'
            and (produced is None or produced <= 0) and int(a.get('clicks') or 0) > 0)


# POSITIVE CONTROL for the predicate and the estimator.
assert lost_on_server({'outcome': 'unconfirmed', 'confirmed': 'no', 'verify_source': 'resync', 'produced': 0, 'clicks': 9})
assert not lost_on_server({'outcome': 'unconfirmed', 'confirmed': 'yes', 'verify_source': 'resync', 'produced': 1, 'clicks': 9})
assert not lost_on_server({'outcome': 'refused', 'confirmed': 'no', 'verify_source': 'resync', 'produced': 0, 'clicks': 0})
assert not clicked({'outcome': 'refused', 'clicks': 0}) and not clicked({'outcome': 'busy'}) and clicked({'clicks': 3})
for o in ('aborted', 'deadline', 'error'):      # craftsync writes the same fields on these; they are not a lost craft
    assert not lost_on_server({'outcome': o, 'confirmed': 'no', 'verify_source': 'resync', 'produced': 0, 'clicks': 9})


def refusal_kind(d):
    """One _craft_room row with status=refused -> its kind. Templates read from 21e270c (Claude review r2): one
    admission refusal writes TWO rows (admission + 'needs'), a pre-click refusal up to two make-room rows + one 'needs'
    row -- so 'no_room' and 'admission:*' are counted, 'remedy_failed' is reported but never summed in."""
    if re.search(r'reason=table_out_of_reach', d):   # one row per event, no follow-on 'needs' row (Claude review r4)
        return 'table_out_of_reach'
    if re.search(r'reason=pickup_pending', d):       # before 'admission': the admission-path copy ends '(seen at admission, ...)'
        return 'pickup_pending'
    if re.match(r'refused \S+ at admission:', d):
        m = re.search(r'verdict=(\w+)', d)
        return 'admission:' + (m.group(1) if m else '?')
    if re.match(r'refused \S+: needs \d+ more slot', d):
        return 'no_room'
    if d.startswith('could not check room'):
        return 'unreadable_recipe'
    return 'remedy_failed'


assert refusal_kind('refused stone_pickaxe: needs 1 more slot(s) at 35/36; x') == 'no_room'
assert refusal_kind('refused stone_pickaxe at admission: source=none verdict=no_room_after_resync (x)') == 'admission:no_room_after_resync'
assert refusal_kind('could not check room for stick') == 'unreadable_recipe'
assert refusal_kind('refused stone_pickaxe: reason=pickup_pending dirt 2.0 blocks away (35/36 slots)') == 'pickup_pending'
assert refusal_kind("refused stone_pickaxe: reason=pickup_pending dirt 2.0 blocks away (35/36 slots) (seen at admission, after craftsync's resync)") == 'pickup_pending'
assert refusal_kind('refused stone_pickaxe at admission: source=none verdict=baseline_unanswered (x)') == 'admission:baseline_unanswered'
assert refusal_kind('refused stone_pickaxe: reason=table_out_of_reach the walk to collect dirt left the crafting_table at 1,64,0 out of reach; walk back to it') == 'table_out_of_reach'
assert refusal_kind('stone_pickaxe: no spent tool that can be spared (35 -> 35/36 slots)') == 'remedy_failed'
assert occupancy({'cobblestone': 65, 'stone_pickaxe': 2}) == 4

class _EV: pass
ev = _EV(); ev.rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(ev.rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
room = defaultdict(Counter); verdicts = Counter(); refusals = Counter(); retake = Counter(); offbuild = 0
pick_sync = Counter(); lost_full = Counter(); lost_any = Counter(); lost = defaultdict(Counter); picks = defaultdict(Counter)
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
                if st == 'refused':
                    refusals[refusal_kind(d)] += 1
        elif arm == 'canary':
            retake[st] += 1
    if k == '_craft_sync' and not other:
        a = skill(r).get('args') or {}
        if str(a.get('item') or '').endswith('_pickaxe') and clicked(a):
            picks[period][arm] += 1
            gone = lost_on_server(a)
            lost[period][arm] += int(gone)
            if period == 'post':
                pick_sync[arm] += 1
                lost_any[arm] += int(gone)
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


# A baseline Paper never answered is now a refusal BEFORE any click, not an unanswered execution: count both, or the
# 5% gate cannot see a server that stopped answering resyncs (Claude review r3).
execs = room['canary']['success'] + room['canary']['unverified'] + room['canary']['verified_local'] + verdicts['baseline_unanswered']
unans = verdicts['unanswered'] + verdicts['baseline_unanswered']
share = unans / execs if execs else float('nan')
judged = pick_sync['canary'] >= 10
did = (rate('post', 'canary') - rate('pre', 'canary')) - (rate('post', 'control') - rate('pre', 'control'))
gc, nc = usable('canary'); gk, nk = usable('control')
print('-' * 78)
print('LIVENESS     canary _craft_room rows %d (>= 1) | control %d (must be 0) | other build %d'
      % (sum(room['canary'].values()), sum(room['control'].values()), offbuild))
print('             canary statuses %s | verdicts %s' % (dict(room['canary']), dict(verdicts)))
print('CORRECTNESS  canary pickaxe crafts the server saw lost: %d of %d (<= 1; %s) | of them at >= 35 est. slots %d'
      % (lost_any['canary'], pick_sync['canary'], 'judged' if judged else 'NOT judged: < 10', lost_full['canary']))
print('INSTRUMENT   control: %d of %d (positive control, >= 1) | at >= 35 est. slots %d'
      % (lost_any['control'], pick_sync['control'], lost_full['control']))
print('TRIPWIRE     verdict=unanswered %d of %d executions = %.1f%% (> 5%% blocks KEEP) | verified_local %d (must be 0)'
      % (unans, execs, 100 * share if execs else float('nan'), room['canary']['verified_local']))
print('             of which after the clicks %d, baseline before any click %d' % (verdicts['unanswered'], verdicts['baseline_unanswered']))
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
        'pick_crafts_canary': pick_sync['canary'], 'lost_canary': lost_any['canary'], 'lost_full_canary': lost_full['canary'],
        'lost_judged': int(judged and lost_any['canary'] > 1), 'lost_control': lost_any['control'],
        'unanswered_share': None if not execs else round(share, 4),
        'unanswered_over_5pct': int(execs >= 20 and share > 0.05),
        'verified_local_canary': room['canary']['verified_local'],
        'lost_rate_did': None if did != did else round(did, 4),
        'retake_taken': retake['taken'] + retake['success'], 'retake_left': retake['left'],
        'usable_pick_canary': gc, 'bots_canary': nc, 'usable_pick_control': gk, 'bots_control': nk,
        'exposure_ready': int(judged and lost_any['control'] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
