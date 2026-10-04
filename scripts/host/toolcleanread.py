#!/usr/bin/env python3
# toolcleanread.py [window_min] -- the read for canary `toolclean-01` (branch tc-on-56db2cd).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE: spent tools get used up. toolFor no longer reserves axes/shovels/hoes at <= 10 uses; the most-worn
# same-name copy is used first; on HARVEST digs a 1-use axe/shovel/hoe is swung and breaks (its drop still lands);
# travel/reflex digs keep a 1-use hard stop; a spent axe/shovel/hoe beats the hand when strictly faster; on stone-family
# harvest digs a 1-use pickaxe is swung only while another pickaxe with > 10 uses is held. MOTIVE (10-03): full bags
# held 191 spent dig-tool copies; ~118-170 at 2-10 uses, mostly SOLE axes (74) and shovels (53) the reserve never released.
# Rows (both reviews, 10-04): _tool_spent, _spent_swing "(use_up|cheapest|spend_spent)", _tool_broke/_tool_gone "the lost
# copy had L of M uses left", _spent_equip_fallback, _wear_out_late. bot.tools = {name: [{slot, used, max}]}.
#
#   LIVENESS     canary `_spent_swing` rows for an axe/shovel/hoe from the canary build (>= 1); control 0 (new kind).
#   CORRECTNESS  G1: a `spend_spent` swing whose own snapshot shows NO other pickaxe with > 10 uses;
#                G2: a bot whose pickaxes with > 10 uses go from >= 1 to 0 within 10 s after a `spend_spent` swing (the
#                backup lost); G3: a `_tool_gone` with > 10 uses left outside a death or deposit (+-5 s) -- a good tool
#                lost early. All 0.
#   INSTRUMENT   control `_last_swing` + pickaxe `_tool_broke` rows >= 1 (the tool rows are visible to this query).
#   PRIMARY      spent (<= 10 uses) axe/shovel/hoe copies per bot (latest snapshot per bot), DiD vs the pre-window;
#                secondary 1-use pickaxes per bot. REPORTED.
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
SOFT = re.compile(r'_(axe|shovel|hoe)$')
SWING = re.compile(r'with a (\w+) at \d+ use\(s\) \((\w+)\)')
LOST = re.compile(r'^(\w+) x\d+; the lost copy had (\d+|\?) of')


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


def tools_of(r):
    return ((r.get('raw') or {}).get('bot') or {}).get('tools')


def left(e):
    return e.get('max', 0) - e.get('used', 0)


def good_picks(tools):
    return sum(1 for k, v in (tools or {}).items() if k.endswith('_pickaxe') for e in v if left(e) > 10)


# POSITIVE CONTROL for the parsers: the row formats both reviewers listed.
assert SWING.search('broke stone at 1,64,2 with a stone_pickaxe at 1 use(s) (spend_spent)').groups() == ('stone_pickaxe', 'spend_spent')
assert SWING.search('broke oak_log at 1,64,2 with a stone_axe at 1 use(s) (use_up)').group(1) == 'stone_axe'
assert LOST.search('stone_axe x1; the lost copy had 40 of 131 uses left').groups() == ('stone_axe', '40')
assert good_picks({'stone_pickaxe': [{'used': 120, 'max': 131}, {'used': 130, 'max': 131}]}) == 1

rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
soft_swing = Counter(); kinds = Counter(); g1 = []; g3 = []; offbuild = 0; reasons = Counter(); fallback = Counter()
control_pos = Counter(); deaths = defaultdict(list); deposits = defaultdict(list)
spend_at = defaultdict(list)                       # bot -> [(t, good picks before)]
snaps = defaultdict(list)                          # bot -> [(t, good picks)] post, canary build
last = defaultdict(dict)
for r in rows:
    t = r['t']; b = (r.get('bot') or {}).get('name')
    if not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    k = r.get('name'); d = r.get('detail') or ''
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    tl = tools_of(r)
    if tl is not None and not other:
        last[period][b] = tl
        if period == 'post' and arm == 'canary':
            snaps[b].append((t, good_picks(tl)))
    if k == '_death':
        deaths[b].append(t)
    if k == 'deposit':
        deposits[b].append(t)
    if period != 'post':
        continue
    if k in ('_spent_swing', '_tool_spent', '_spent_equip_fallback') and other:
        offbuild += 1
        continue
    if arm == 'control':
        if k == '_last_swing' or (k == '_tool_broke' and '_pickaxe' in d):
            control_pos[k] += 1
        if k in ('_spent_swing', '_tool_spent'):
            kinds['control_' + k] += 1
        continue
    if other:
        continue
    kinds[k] += k in ('_spent_swing', '_tool_spent', '_spent_equip_fallback', '_tool_broke', '_tool_gone', '_wear_out_late')
    if k == '_spent_swing':
        m = SWING.search(d)
        if m:
            reasons[m.group(2)] += 1
            if SOFT.search(m.group(1)):
                soft_swing['canary'] += 1
            if m.group(2) == 'spend_spent':
                gp = good_picks(tl)
                spend_at[b].append((t, gp))
                if gp < 1:
                    g1.append((b, d[:100]))
    if k == '_spent_equip_fallback':
        fallback[((r.get('raw') or {}).get('skill') or {}).get('status')] += 1
    if k == '_tool_gone':
        m = LOST.search(d)
        if m and m.group(2) != '?' and int(m.group(2)) > 10:
            near = lambda xs: any(abs((x - t).total_seconds()) <= 5 for x in xs)
            if not near(deaths[b]) and not near(deposits[b]):
                g3.append((b, d[:100]))

g2 = []
for b, events in spend_at.items():
    for t, gp in events:
        if gp < 1:
            continue
        after = [g for (ts, g) in snaps[b] if 0 < (ts - t).total_seconds() <= 10]
        if after and min(after) == 0:
            g2.append((b, t.strftime('%H:%M:%S')))


def spent_soft(tools):
    return sum(1 for k, v in (tools or {}).items() if SOFT.search(k) for e in v if 1 <= left(e) <= 10)


def one_use_picks(tools):
    return sum(1 for k, v in (tools or {}).items() if k.endswith('_pickaxe') for e in v if left(e) == 1)


def per_bot(period, arm, f):
    vals = [f(tl) for b, tl in last[period].items() if (pool_of(b) in CANS) == (arm == 'canary')]
    return sum(vals) / len(vals) if vals else float('nan')


v = {(p, a, n): per_bot(p, a, f) for p in ('pre', 'post') for a in ('canary', 'control') for n, f in (('soft', spent_soft), ('pick1', one_use_picks))}
did = lambda n: (v[('post', 'canary', n)] - v[('pre', 'canary', n)]) - (v[('post', 'control', n)] - v[('pre', 'control', n)])
pos = sum(control_pos.values())
print('-' * 78)
print('LIVENESS     canary axe/shovel/hoe spent swings %d (>= 1) | control new-kind rows %d (must be 0) | other build %d'
      % (soft_swing['canary'], kinds['control__spent_swing'] + kinds['control__tool_spent'], offbuild))
print('             canary rows %s | swing reasons %s | equip fallbacks %s' % (dict((k, n) for k, n in kinds.items() if not k.startswith('control')), dict(reasons), dict(fallback)))
print('CORRECTNESS  G1 spend_spent without a > 10-use backup %d | G2 backup lost within 10 s %d | G3 good tool (> 10 uses) gone outside death/deposit %d'
      % (len(g1), len(g2), len(g3)))
print('INSTRUMENT   control _last_swing + pickaxe _tool_broke rows %d (>= 1) %s' % (pos, dict(control_pos)))
print('PRIMARY      spent axe/shovel/hoe copies/bot canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f | 1-use pickaxes/bot DiD %+.2f'
      % (v[('pre', 'canary', 'soft')], v[('post', 'canary', 'soft')], v[('pre', 'control', 'soft')], v[('post', 'control', 'soft')], did('soft'), did('pick1')))
for x in (g1 + g2 + g3)[:6]:
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('toolcleanread', W, {
        'soft_swings_canary': soft_swing['canary'], 'new_rows_control': kinds['control__spent_swing'] + kinds['control__tool_spent'],
        'offbuild_canary': offbuild, 'g1_no_backup': len(g1), 'g2_backup_lost': len(g2), 'g3_good_tool_gone': len(g3),
        'instrument_control': pos, 'equip_fallback_failed': fallback.get('failed', 0),
        'spent_soft_did': None if did('soft') != did('soft') else round(did('soft'), 3),
        'one_use_picks_did': None if did('pick1') != did('pick1') else round(did('pick1'), 3),
        'exposure_ready': int(soft_swing['canary'] >= 5 and pos >= 1),
    })
except Exception as e:
    print('emit failed:', e)
