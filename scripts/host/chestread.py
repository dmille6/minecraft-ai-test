#!/usr/bin/env python3
# chestread.py [window_min] -- the read for canary `chestfull-01` (chest-full recovery).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: when the town chest is full, a deposit sweeps the town's containers (with a shared memory of each one),
# then places a CARRIED chest before ever crafting one, under a per-town budget on NEW chests (>= 10 min apart, <= 4 per
# 24 h, <= 12 recovery-made standing), on a safe site (<= 16 from home, >= 3 from the composter, no lids, no adjacent
# chest, no table standing cells), never dropping a lifted stack (verified cursor return), on the 180 s watchdog clock.
# MOTIVE (10-03, 24 h, 1,970 deposits): 90 blocked by a full chest, 75 of them by bots CARRYING a chest (the old code
# crafted one unconditionally). Row `_deposit_new_chest`: "decision=D near_home=B containers=N unknown=N [standing=N
# today=N] bag=a->b <extras k=v> tried=[...]" (Claude r3 field list).
#
#   LIVENESS     canary `_deposit_new_chest` rows (>= 1); control 0.
#   CORRECTNESS  C1 a placement with home_d > 16 or composter_d < 3; C2 a pool with > 4 placements in the window or two
#                < 10 min apart; C3 failed cursor rescues + transfer_unsettled deposits > 1; C4 (the root cause) a
#                decision=craft while the END snapshot still holds a chest. All REVERT.
#   INSTRUMENT   control deposits with the old "could not make another chest" while holding a chest (>= 1; ~75/day 10-03).
#   PRIMARY      storage_full deposit failures per bot-hour DiD; successful deposits per bot-hour DiD (harm watch).
#   REPORTED     decision shares (refuse_cap = budget saturating), defer share, standing/today per pool.
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
KV = re.compile(r'(\w+)=([^\s\[]+)')

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


def fields(d):
    """key=value tokens before tried=[...] (which may be cut at 300 chars)."""
    return dict(KV.findall((d or '').split(' tried=[')[0]))


def fail_class(r):
    return r.get('fail_class') or (((r.get('raw') or {}).get('skill') or {}).get('fail_class')) or (((r.get('raw') or {}).get('skill') or {}).get('failClass'))


# POSITIVE CONTROL for the parser.
_f = fields('decision=place_carried near_home=true containers=9 unknown=0 standing=1 today=1 bag=500->430 placed=1 at=1,64,2 home_d=7 composter_d=5 tried=[1,64,0:full]')
assert _f['decision'] == 'place_carried' and _f['placed'] == '1' and _f['home_d'] == '7' and _f['bag'] == '500->430'

rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
nc = Counter(); offbuild = 0; dec = Counter(); c1 = []; placed_at = defaultdict(list); c3 = 0; c4 = []; inst = 0
dep = defaultdict(Counter); botsets = defaultdict(lambda: defaultdict(set)); budget = {}
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    botsets[period][arm].add(b)
    k = r.get('name'); d = r.get('detail') or ''
    st = ((r.get('raw') or {}).get('skill') or {}).get('status') or r.get('status')
    inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory') or {}
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    if other:
        if k in ('_deposit_new_chest', '_deposit_cursor_rescue'):
            offbuild += 1
        continue
    if k == 'deposit':
        fc = fail_class(r)
        dep[(period, arm)]['all'] += 1
        dep[(period, arm)]['success'] += st == 'success'
        dep[(period, arm)]['storage_full'] += fc == 'storage_full'
        if period == 'post' and arm == 'canary' and fc == 'transfer_unsettled':
            c3 += 1
        if period == 'post' and arm == 'control' and 'could not make another chest' in d and inv.get('chest', 0) > 0:
            inst += 1
    if period != 'post':
        continue
    if k == '_deposit_cursor_rescue' and arm == 'canary' and st == 'failed':
        c3 += 1
    if k != '_deposit_new_chest':
        continue
    nc[arm] += 1
    if arm != 'canary':
        continue
    f = fields(d); dec[f.get('decision', '?')] += 1
    if 'standing' in f:
        budget[pool_of(b)] = (f.get('standing'), f.get('today'))
    if f.get('placed') == '1':
        placed_at[pool_of(b)].append(t)
        try:
            if float(f.get('home_d', 0)) > 16 or float(f.get('composter_d', 99)) < 3:
                c1.append((b, d[:120]))
        except ValueError:
            pass
    if f.get('decision') == 'craft' and inv.get('chest', 0) > 0:
        c4.append((b, d[:120]))
c2 = {p: len(ts) for p, ts in placed_at.items() if len(ts) > 4 or any((b2 - a2).total_seconds() < 600 for a2, b2 in zip(ts, ts[1:]))}


def per_bh(period, arm, key):
    n = len(botsets[period][arm])
    return dep[(period, arm)][key] / (n * W / 60) if n else float('nan')


did = lambda key: (per_bh('post', 'canary', key) - per_bh('pre', 'canary', key)) - (per_bh('post', 'control', key) - per_bh('pre', 'control', key))
tot = sum(dec.values())
print('-' * 78)
print('LIVENESS     canary _deposit_new_chest rows %d (>= 1) | control %d (must be 0) | other build %d' % (nc['canary'], nc['control'], offbuild))
print('CORRECTNESS  C1 placements off-site %d | C2 pools over budget %s | C3 failed rescues + transfer_unsettled %d (<= 1) | C4 crafted while carrying a chest %d'
      % (len(c1), c2 or 0, c3, len(c4)))
print('INSTRUMENT   control "could not make another chest" while holding a chest: %d (>= 1)' % inst)
print('PRIMARY      storage_full deposits/bot-h DiD %+.3f | successful deposits/bot-h DiD %+.3f (harm watch)' % (did('storage_full'), did('success')))
print('REPORTED     decisions %s | refuse_cap share %s | budget (standing, today) by pool %s'
      % (dict(dec), ('%.0f%%' % (100 * dec['refuse_cap'] / tot)) if tot else '-', budget))
for x in (c1 + c4)[:5]:
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('chestread', W, {
        'rows_canary': nc['canary'], 'rows_control': nc['control'], 'offbuild_canary': offbuild,
        'c1_offsite': len(c1), 'c2_over_budget': len(c2), 'c3_over_1': int(c3 > 1), 'c4_craft_while_carrying': len(c4),
        'instrument_control': inst, 'storage_full_did': None if did('storage_full') != did('storage_full') else round(did('storage_full'), 3),
        'success_did': None if did('success') != did('success') else round(did('success'), 3),
        'refuse_cap': dec['refuse_cap'], 'decisions': tot,
        'exposure_ready': int(dec['place_carried'] + dec['craft'] + dec['refuse_cap'] >= 3 and inst >= 1),
    })
except Exception as e:
    print('emit failed:', e)
