#!/usr/bin/env python3
# toolsaferead.py [window_min] -- the tool-safe member of the fixes bundle (branch tool-safe, 5756ff2).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: the reflex empties the hand without ever letting mineflayer TOSS the held stack (proved on the sandbox:
# unequip('hand') on a full bag threw a stone pickaxe on the ground); escapes place the cheapest scaffold first;
# travel digs hold a block, not a pickaxe, when the hand will do.
#
#   CORRECTNESS  GOOD PICKAXES LOST: `_tool_gone` rows (the existing index.mjs tool-loss row) for a pickaxe with > 10 uses
#                left, EXCLUDING any within 60 s of the same bot's deposit or death. Measured on 80b3bbd/1d107ed: 301 a
#                day (0.157/bot-h), 273 within 30 s of an escape row, 84% at 35-36 slots. The canary may show at most 2
#                (a residual pickup race), judged on >= 40 canary bot-hours.
#   INSTRUMENT   the control shows the defect (>= 1 such loss) -- the query can see a presence.
#   LIVENESS     canary `_hand_safe` or `_scaffold_pick` rows from the canary build (>= 1); control 0.
# REPORTED: the loss rate per bot-h DiD; losses near an escape; `_hand_safe` how-mix; `_scaffold_pick` count.
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
GONE = re.compile(r'^(\w+_pickaxe) x\d+; the lost copy had (\d+) of')
assert GONE.search('stone_pickaxe x1; the lost copy had 120 of 131 uses left').groups() == ('stone_pickaxe', '120')
ESCAPE = re.compile(r'escape|entomb|stranded|maroon|pillar|climb|last_resort|surface')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=int(elapsed + W + 60))
excl = defaultdict(list)     # bot -> times of deposits and deaths
esc = defaultdict(list)      # bot -> times of escape-type rows
gone = []                    # (t, bot, pickaxe, uses)
bots = defaultdict(set)
safe, pick, offbuild, hows = Counter(), Counter(), 0, Counter()
for r in ev.rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b or not (PRE <= t < END):
        continue
    a = 'canary' if pool_of(b) in CANS else 'control'; p = 'post' if t >= CUT else 'pre'
    bots[(p, a)].add(b)
    k, d = r.get('name') or '', r.get('detail') or ''
    if k in ('deposit', '_death'):
        excl[b].append(t)
    elif ESCAPE.search(k):
        esc[b].append(t)
    if k == '_tool_gone':
        m = GONE.search(d)
        if m and int(m.group(2)) > 10:
            ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
            if p == 'post' and a == 'canary' and CV and ver and not ver.startswith(CV):
                offbuild += 1   # a pre-restart loss on the old build is not the canary's
            else:
                gone.append((t, b, m.group(1), int(m.group(2))))
    if k in ('_hand_safe', '_scaffold_pick') and p == 'post':
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if a == 'canary' and CV and not ver.startswith(CV):
            offbuild += 1
            continue
        (safe if k == '_hand_safe' else pick)[a] += 1
        mm = re.search(r'how=(\w+)', d)
        if k == '_hand_safe' and a == 'canary' and mm:
            hows[mm.group(1)] += 1

near = lambda ts, t, s: any(abs((x - t).total_seconds()) <= s for x in ts)
lost, lost_esc = Counter(), Counter()
for (t, b, name, uses) in gone:
    if near(excl[b], t, 60):
        continue
    a = 'canary' if pool_of(b) in CANS else 'control'; p = 'post' if t >= CUT else 'pre'
    lost[(p, a)] += 1
    if near(esc[b], t, 30):
        lost_esc[(p, a)] += 1


def bh(p, a):
    return len(bots[(p, a)]) * W / 60


def per_bh(c, p, a):
    return c[(p, a)] / bh(p, a) if bh(p, a) else float('nan')


did = (per_bh(lost, 'post', 'canary') - per_bh(lost, 'pre', 'canary')) - (per_bh(lost, 'post', 'control') - per_bh(lost, 'pre', 'control'))
judged = bh('post', 'canary') >= 40
bad = lost[('post', 'canary')] > 2
print('canary %s  sha %s  cutoff %s  window +%d min  (canary %.0f bot-h)' % (CAN, CV, CUT.strftime('%H:%MZ'), W, bh('post', 'canary')))
print('CORRECTNESS  canary good pickaxes lost (not deposit/death): %d (<= 2; judged on >= 40 bot-h: %s) | near an escape %d'
      % (lost[('post', 'canary')], 'judged' if judged else 'NOT judged', lost_esc[('post', 'canary')]))
print('INSTRUMENT   control good pickaxes lost: %d (>= 1) | near an escape %d' % (lost[('post', 'control')], lost_esc[('post', 'control')]))
print('LIVENESS     canary _hand_safe %d, _scaffold_pick %d | control %d, %d | other build %d | how %s'
      % (safe['canary'], pick['canary'], safe['control'], pick['control'], offbuild, dict(hows)))
print('REPORTED     good-pickaxe losses/bot-h DiD %+.3f (canary pre %.3f post %.3f | control pre %.3f post %.3f)'
      % (did, per_bh(lost, 'pre', 'canary'), per_bh(lost, 'post', 'canary'), per_bh(lost, 'pre', 'control'), per_bh(lost, 'post', 'control')))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('toolsaferead', W, {
        'lost_judged': int(judged and bad), 'lost_canary': lost[('post', 'canary')], 'lost_control': lost[('post', 'control')],
        'safe_rows_canary': safe['canary'] + pick['canary'], 'safe_rows_control': safe['control'] + pick['control'],
        'offbuild_canary': offbuild, 'lost_did_per_bh': round(did, 4),
        'exposure_ready': int(judged and lost[('post', 'control')] >= 1),
    })
except Exception as e:
    print('emit failed:', e)
