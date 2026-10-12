#!/usr/bin/env python3
# orderroomread.py [window_min] -- the read for canary `orderroom-01` (branch or-on-<fleet sha>).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (workorder.mjs readyFor/roomOrder/roomOutcome, skills.mjs craftRouteFor/craftRoomCheck/roomRemedy,
# admission.mjs memoryRefuses, prompt.mjs noRoomHint): a rung craft order is issued only when the craft's own room
# check passes; with no room the remedy the craft would name (eat / deposit X / home when far from any usable chest) is
# the order, and the prompt stops advertising the craft. Rows only this build writes: `_craft_noroom`, `_room_order`.
#
# Decision rows (llm-<bot>.jsonl, START snapshot): a WORK ORDER is llm.latency_ms == 0 with an empty response and a
# tool_calls entry; a RUNG CRAFT ORDER is one whose skill is craft and whose reason starts "active rung"; a ROOM ORDER is
# one whose reason starts "no room for". Refused = llm.admission null and outcome aborted.
#
#   LIVENESS     canary `_craft_noroom` >= 1 and `_room_order` >= 1; control 0 of each (C4).
#   CORRECTNESS  (REVERT)
#     C1 rung craft orders admitted into a bag without room: canary craft orders failed with "No room for" (pickup
#        refusals "step away from" are counted apart; orders tagged "(room via wear)" -- the craft's own designed wear-out
#        attempt -- and "(room via unknown)" -- the check could not say, issued as before -- are counted apart too) --
#        breach when >= C1_MIN AND canary/bot-h > C1_RATIO x control/bot-h. So C1 judges only crafts the room check PASSED.
#        Positive control (dry run 10-12, identical code on isolated-b+board-b): C1 fires on the base build (33 vs 79).
#     C2 a canary deposit room order whose `lost` names something it may not: anything but its X, EXCEPT what the walk and
#        the deposit's own recovery legitimately spend, IN THE AMOUNTS they spend it (Claude r2/r3): chest; logs/planks up
#        to C2_WOOD (one chest is 8 planks = 2 logs); the pathfinder's scaffold blocks up to C2_SCAFFOLD; tools (worn on the
#        way); food (auto-eat). NO sticks (no chest takes one, and they are the pickaxe's own ingredient). So C2 catches a
#        deposit that banked the craft's own inputs or other valuables. A `lost` ending `+more` counts as a breach.
#     C5 canary room orders refused at admission > C5_SHARE of canary room orders (memoryRefuses should make it ~0).
#     C6 a canary `home` room order issued within DEPOSIT_NEAR_HOME of the ORIGIN -- admission's own distance
#        (horizontalDistanceFromSpawn), which is what farFromBank uses; not the pool's HOME_X/Z (Claude r2).
#     C4 control `_craft_noroom` / `_room_order` rows > 0.
#   PRIMARY      refused rung craft orders per bot-h, DiD (canary vs control, POST vs the same-length PRE), WARM (the first
#                WARM_MIN minutes after the cutoff dropped from POST: the deploy restarts the canary and resets the gate).
#   PRODUCTIVE   (the primary falls partly BY CONSTRUCTION -- a withheld craft is never refused -- so KEEP needs these too,
#                Claude r2) The DiD is REPORTED, not a revert line: the 10-12 dry run on IDENTICAL code read -0.211/bot-h
#                against a control PRE of 0.201 -- a -0.5x line would have reverted the null. Instead, an EXPECTED-COUNT test
#                (Codex r4 / Claude r4): expected canary POST rung successes = canary PRE rate x canary POST bot-h x (control
#                POST rate / control PRE rate). REVERT (catastrophe) when POST = 0 and expected >= PROD_EXPECT_MIN;
#                INCONCLUSIVE (blocks KEEP) when Poisson P(X <= observed | expected) < PROD_P -- a decline beyond chance.
#                INCONCLUSIVE (blocks KEEP): room->craft completion (ok room orders followed by that craft's success within
#                15 min) below COMPLETION_FLOOR with >= COMPLETION_MIN ok room orders.
#                REPORTED: no-room time (canary `_craft_noroom` rows/bot-h, one per item per 5 min while withheld),
#                no-progress give-ups/bot-h DiD, home room orders failed, executed decisions/bot-h DiD, deaths.
#   INSTRUMENT   (positive controls) control refused rung craft orders (POST) >= 1; control no-room craft failures >= 1.
import sys, os, json, re, glob, gzip, math
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events

ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(dt.timezone.utc)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(minutes=W)
WARM_MIN = 30
WARM = CUT + dt.timedelta(minutes=WARM_MIN)
C1_MIN, C1_RATIO, C5_SHARE, PROD_EXPECT_MIN, PROD_P = 3, 0.2, 0.10, 5.0, 0.05
COMPLETION_FLOOR, COMPLETION_MIN = 0.25, 5
C2_WOOD, C2_SCAFFOLD = 16, 8
GAP_CAP_S = 300          # >= the longest room-order skill (home 240 s): a long walk is not lost exposure (both engines r3)
COMPLETION_S = 900
SCAFFOLD = {'dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate', 'gravel', 'sand'}
TOOLISH = re.compile(r'_(pickaxe|axe|shovel|hoe|sword)$')
WOODISH = re.compile(r'(_log|_planks|_wood|_stem|_hyphae)$')

DEPOSIT_NEAR_HOME = 96
FOODS = {'apple', 'mushroom_stew', 'bread', 'porkchop', 'cooked_porkchop', 'golden_apple', 'enchanted_golden_apple', 'cod',
         'salmon', 'tropical_fish', 'pufferfish', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice', 'dried_kelp', 'beef',
         'cooked_beef', 'chicken', 'cooked_chicken', 'rotten_flesh', 'spider_eye', 'carrot', 'potato', 'baked_potato',
         'poisonous_potato', 'golden_carrot', 'pumpkin_pie', 'rabbit', 'cooked_rabbit', 'rabbit_stew', 'mutton', 'cooked_mutton',
         'chorus_fruit', 'beetroot', 'beetroot_soup', 'suspicious_stew', 'sweet_berries', 'glow_berries', 'honey_bottle'}
ROOMRE = re.compile(r'^kind=(\w+) item=(\S+) craft=(\S+) short=(\S+) slots=(\d+)->(\d+) freed=(\d+) verdict=(\w+) run=(\S+) lost=(.*)$')
NOROOMRE = re.compile(r'^item=(\S+) short=(\d+) slots=(\d+) route=(\S+) remedy=(\S+) target=(\S+) order=(\S+)')

# POSITIVE CONTROLS for the parsers (the build's own row shapes, copied from bots/test/orderroom.test.mjs).
assert ROOMRE.match('kind=deposit item=oak_log craft=stone_pickaxe short=1 slots=36->35 freed=1 verdict=ok run=success lost=oak_log:40').groups()[0] == 'deposit'
assert ROOMRE.match('kind=home item=oak_log craft=stone_pickaxe short=1 slots=36->36 freed=0 verdict=ok run=refused:cooldown lost=-').group(9) == 'refused:cooldown'
assert NOROOMRE.match('item=stone_pickaxe short=1 slots=36 route=B remedy=home target=oak_log order=-').group(5) == 'home'


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


def lost_names(s):
    out = {}
    for kv in (s or '').split(','):
        k, _, v = kv.partition(':')
        if k and k not in ('-', '+more') and v.isdigit():
            out[k] = int(v)
    return out


assert lost_names('oak_log:40,bread:1') == {'oak_log': 40, 'bread': 1} and lost_names('-') == {}


def is_craft_success(q, item):
    sk = (q.get('raw') or {}).get('skill') or {}
    return q['name'] == 'craft' and sk.get('status') == 'success' and (item is None or item in (q.get('detail') or ''))


def period_of(t):
    return 'post' if t >= CUT else 'pre'


def llm_rows(bot):
    out = []
    for f in sorted(glob.glob('/var/log/mcai/%s/llm-*.jsonl*' % bot)):
        try:
            if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) < PRE:
                continue
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    r = json.loads(line)
                    t = dt.datetime.fromisoformat(r['@timestamp'].replace('Z', '+00:00'))
                except Exception:
                    continue
                if PRE <= t < END:
                    llm = r.get('llm') or {}; o = r.get('outcome') or {}
                    tc = (r.get('tool_calls') or [None])[0] or {}
                    resp = ((r.get('response') or {}).get('text') or '')
                    order = (llm.get('latency_ms') or 0) == 0 and not resp and bool(tc.get('skill'))
                    out.append(dict(t=t, order=order, skill=tc.get('skill'), args=tc.get('args') or {}, why=str(tc.get('reason') or ''),
                                    adm=llm.get('admission') is not None, st=o.get('status'), det=str(o.get('detail') or ''),
                                    err=llm.get('error'), pos=(r.get('bot') or {}).get('pos') or {},
                                    ver=((r.get('code') or {}).get('version') or '')))
    out.sort(key=lambda r: r['t'])
    return out


C = defaultdict(Counter)            # (period, arm) -> counters
bh = Counter()                      # (period, arm) -> bot-seconds
c1, c2, c6 = [], [], []
room = Counter(); room_kind = Counter(); room_verdict = Counter(); room_refused = 0; room_freed = 0
completion = Counter()              # ok room orders: 'crafted' within 15 min | 'not' | 'immature'
craft_rows = Counter()
liveness = Counter(); offbuild = 0
deaths = []
bots = sorted(d for d in os.listdir('/var/log/mcai') if not d.startswith('_') and os.path.isdir('/var/log/mcai/' + d))
for b in bots:
    arm = 'canary' if pool_of(b) in CANS else 'control'
    rows = llm_rows(b)
    prev = None
    for r in rows:
        t = r['t']
        period = 'post' if t >= CUT else 'pre'
        if period == 'post' and t < WARM:
            prev = t
            continue                                    # the warm-up is dropped from POST (and its time with it)
        other = arm == 'canary' and period == 'post' and CV and r['ver'] and not r['ver'].startswith(CV)
        if other:
            offbuild += 1; prev = t; continue
        if prev is not None:
            bh[(period, arm)] += min((t - prev).total_seconds(), GAP_CAP_S)
        prev = t
        k = C[(period, arm)]
        k['decisions'] += 1
        if r['adm'] and r['st'] not in ('aborted', None):
            k['executed'] += 1
        rung = r['order'] and r['skill'] == 'craft' and r['why'].startswith('active rung')
        if rung:
            k['rung_orders'] += 1
            if '(room via unknown)' in r['why']:
                k['rung_unknown'] += 1
            if not r['adm'] and r['st'] == 'aborted':
                k['rung_refused'] += 1
            elif r['adm'] and r['st'] == 'failed' and 'No room for' in r['det'] and '(room via wear)' in r['why']:
                k['rung_noroom_wear'] += 1
            elif r['adm'] and r['st'] == 'failed' and 'No room for' in r['det'] and '(room via unknown)' in r['why']:
                k['rung_noroom_unknown'] += 1
            elif r['adm'] and r['st'] == 'failed' and 'No room for' in r['det']:
                k['rung_noroom'] += 1
                if arm == 'canary' and period == 'post':
                    c1.append((b, str(t)[11:19], r['args'].get('item'), r['det'][:90]))
            elif r['adm'] and r['st'] == 'failed' and r['det'].startswith('step away from'):
                k['rung_pickup'] += 1
            elif r['adm'] and r['st'] == 'success':
                k['rung_success'] += 1
        if r['order'] and r['why'].startswith('no room for') and arm == 'canary' and period == 'post':
            if r['skill'] == 'home':
                p = r['pos']
                if 'x' in p and (p['x'] ** 2 + p['z'] ** 2) ** 0.5 <= DEPOSIT_NEAR_HOME:
                    c6.append((b, str(t)[11:19], round(p['x']), round(p['z'])))
    # the build's own rows
    try:
        ev = Events.load(paths='/var/log/mcai/%s/skill-*.jsonl*' % b, since=PRE, until=END)
    except Exception as e:
        print('load failed', b, e)
        continue
    rs = sorted(ev.rows, key=lambda r: r['t'])
    for i, r in enumerate(rs):
        t = r['t']; n = r['name']; d = r.get('detail') or ''
        if arm == 'canary' and period_of(t) == 'post' and is_craft_success(r, None):
            craft_rows['canary'] += 1                    # the completion matcher's POSITIVE CONTROL (Claude r3)
        period = 'post' if t >= CUT else 'pre'
        if n in ('_craft_noroom', '_room_order'):
            liveness[(period, arm, n)] += 1
        if n == '_milestone_skipped' and 'no serving progress' in d and not (period == 'post' and t < WARM):
            C[(period, arm)]['giveups'] += 1
        if n == '_death' and period == 'post':
            deaths.append((arm, b, str(t)[11:19]))
        if n == '_room_order' and arm == 'canary' and period == 'post':
            m = ROOMRE.match(d)
            if not m:
                c2.append((b, str(t)[11:19], 'UNPARSED ' + d[:80])); continue
            kind, x, craft, short, s0, s1, freed, verdict, run, lost = m.groups()
            room[arm] += 1; room_kind[kind] += 1; room_verdict[verdict] += 1; room_freed += int(freed)
            if run.startswith('refused'):
                room_refused += 1
            if kind == 'deposit':
                bad = {k: v for k, v in lost_names(lost).items()
                       if k not in (x, 'chest') and k not in FOODS and not TOOLISH.search(k)
                       and not (k in SCAFFOLD and v < C2_SCAFFOLD) and not (WOODISH.search(k) and v < C2_WOOD)}
                if bad or lost.endswith('+more'):
                    c2.append((b, str(t)[11:19], x, bad or 'UNVERIFIABLE +more'))
            if verdict == 'ok' and kind != 'home':   # one judgement per episode: home's ok is followed by that episode's deposit (Claude r4)
                if (END - t).total_seconds() < COMPLETION_S:
                    completion['immature'] += 1          # its 15 minutes are not over inside the window: not judged (Codex r3)
                else:
                    ok = any(0 <= (q['t'] - t).total_seconds() <= COMPLETION_S and is_craft_success(q, craft) for q in rs[i + 1:])
                    completion['crafted' if ok else 'not'] += 1

hours = {k: v / 3600 for k, v in bh.items()}
rate = lambda p, a, c: C[(p, a)][c] / hours[(p, a)] if hours.get((p, a)) else float('nan')
did = lambda c: (rate('post', 'canary', c) - rate('pre', 'canary', c)) - (rate('post', 'control', c) - rate('pre', 'control', c))
ctrl_noroom = C[('post', 'control')]['rung_noroom']
can_noroom = C[('post', 'canary')]['rung_noroom']
c1_breach = int(can_noroom >= C1_MIN and rate('post', 'canary', 'rung_noroom') > C1_RATIO * rate('post', 'control', 'rung_noroom'))
c5_breach = int(room['canary'] > 0 and room_refused / room['canary'] > C5_SHARE)
c4 = sum(v for (p, a, _), v in liveness.items() if a == 'control' and p == 'post')
n_ok = completion['crafted'] + completion['not']
completion_low = int(n_ok >= COMPLETION_MIN and completion['crafted'] / n_ok < COMPLETION_FLOOR)
# FAIL CLOSED (Codex r3): too few judged remedies, or a rate that cannot be computed, is not a pass -- it blocks KEEP.
rates_ok = all(hours.get((p, a), 0) > 0 for p in ('pre', 'post') for a in ('canary', 'control'))
evidence_short = int(n_ok < COMPLETION_MIN or not rates_ok or craft_rows['canary'] < 1)
def poisson_cdf(k, mu):
    if mu <= 0:
        return 1.0
    return sum(math.exp(-mu) * mu ** i / math.factorial(i) for i in range(int(k) + 1))


assert abs(poisson_cdf(0, 5.0) - math.exp(-5)) < 1e-12 and poisson_cdf(10, 0) == 1.0
ctrl_ratio = rate('post', 'control', 'rung_success') / rate('pre', 'control', 'rung_success') if rate('pre', 'control', 'rung_success') else float('nan')
expected = rate('pre', 'canary', 'rung_success') * hours.get(('post', 'canary'), 0) * ctrl_ratio if ctrl_ratio == ctrl_ratio else float('nan')
observed = C[('post', 'canary')]['rung_success']
prod_breach = int(expected == expected and observed == 0 and expected >= PROD_EXPECT_MIN)
prod_p = poisson_cdf(observed, expected) if expected == expected else float('nan')
productive_low = int(prod_p == prod_p and prod_p < PROD_P)
# C1'S BLIND SPOT, GATED (Claude r4): crafts the check could not judge are counted apart from C1, so a check that says
# "unknown" broadly would read clean. Their no-room failures above C1_RATIO x the control's no-room rate block KEEP.
unknown_high = int(C[('post', 'canary')]['rung_noroom_unknown'] >= C1_MIN and
                   rate('post', 'canary', 'rung_noroom_unknown') > C1_RATIO * rate('post', 'control', 'rung_noroom'))
unknown_share = C[('post', 'canary')]['rung_unknown'] / C[('post', 'canary')]['rung_orders'] if C[('post', 'canary')]['rung_orders'] else float('nan')
# AN UNDEFINED PRODUCTIVITY TEST IS NOT A PASS (Codex r5 P1, Claude r5 #3): no control PRE rung successes (or no canary PRE)
# leaves `expected` non-finite -- that is too little evidence, and it blocks KEEP like any other.
productivity_undefined = int(not (expected == expected and math.isfinite(expected)))
evidence_short = int(evidence_short or productivity_undefined)
# THE KEEP BLOCKERS LIVE IN exposure_ready TOO (Claude r5 #1): the verdict code reads own_lines, and exposure_ready is the
# one field every loop version consults, so a blocker the consumer did not know could never be "a checker nobody calls".
keep_blocked = int(evidence_short or completion_low or productive_low or unknown_high)

print('window +%d min (warm from +%d) | canary %s sha %s cutoff %s | bot-h %s | canary rows from another build %d' % (
    W, WARM_MIN, sorted(CANS), CV, CUT.strftime('%m-%d %H:%MZ'), {'%s/%s' % k: round(v, 1) for k, v in hours.items()}, offbuild))
print('-' * 78)
print('LIVENESS     canary _craft_noroom %d, _room_order %d | control (C4, must be 0) %d' % (
    liveness[('post', 'canary', '_craft_noroom')], liveness[('post', 'canary', '_room_order')], c4))
print('PRIMARY      refused rung craft orders/bot-h canary %.2f -> %.2f control %.2f -> %.2f DiD %+.2f' % (
    rate('pre', 'canary', 'rung_refused'), rate('post', 'canary', 'rung_refused'), rate('pre', 'control', 'rung_refused'), rate('post', 'control', 'rung_refused'), did('rung_refused')))
print('CORRECTNESS  C1 no-room craft orders canary %d (%.2f/bot-h) vs control %d (%.2f/bot-h) breach %d | C2 %d | C5 refused room orders %d of %d breach %d | C6 home near home %d' % (
    can_noroom, rate('post', 'canary', 'rung_noroom'), ctrl_noroom, rate('post', 'control', 'rung_noroom'), c1_breach, len(c2), room_refused, room['canary'], c5_breach, len(c6)))
print('PRODUCTIVE   rung craft successes/bot-h DiD %+.3f (REPORTED) | canary POST observed %d vs expected %.1f (P %.3f): low %d, catastrophe %d (inactive while expected < %.0f) | room->craft %s | give-ups/bot-h DiD %+.3f | executed/bot-h DiD %+.2f' % (
    did('rung_success'), observed, expected, prod_p, productive_low, prod_breach, PROD_EXPECT_MIN, dict(completion), did('giveups'), did('executed')))
print('UNKNOWN      canary rung orders issued on an unknown room %d of %d (share %.3f) | their no-room failures %d -> unknown_high %d (blocks KEEP)' % (
    C[('post', 'canary')]['rung_unknown'], C[('post', 'canary')]['rung_orders'], unknown_share, C[('post', 'canary')]['rung_noroom_unknown'], unknown_high))
print('REPORTED     room orders by kind %s verdict %s slots freed %d | pickup refusals canary %d control %d | deaths %s' % (
    dict(room_kind), dict(room_verdict), room_freed, C[('post', 'canary')]['rung_pickup'], C[('post', 'control')]['rung_pickup'], deaths[:6]))
print('EVIDENCE     judged room orders %d (immature %d) of >= %d | canary craft-success rows %d (matcher positive control, >= 1) | rates computable %s | productivity undefined %d -> evidence_short %d | keep_blocked %d (folded into exposure_ready)' % (
    n_ok, completion['immature'], COMPLETION_MIN, craft_rows['canary'], rates_ok, productivity_undefined, evidence_short, keep_blocked))
print('             (completion counts one episode twice when it needed two deposits -- short 2 -- Claude r5 #4; reported as is)')
print('             no-room craft orders on the wear route canary %d control %d, room unknown canary %d | completion low %d | _craft_noroom rows/bot-h canary %.2f' % (
    C[('post', 'canary')]['rung_noroom_wear'], C[('post', 'control')]['rung_noroom_wear'], C[('post', 'canary')]['rung_noroom_unknown'], completion_low,
    liveness[('post', 'canary', '_craft_noroom')] / hours[('post', 'canary')] if hours.get(('post', 'canary')) else float('nan')))
print('INSTRUMENT   control refused rung craft orders (POST) %d (>= 1) | control no-room craft failures %d (>= 1)' % (
    C[('post', 'control')]['rung_refused'], ctrl_noroom))
for nm, xs in (('C1', c1), ('C2', c2), ('C6', c6)):
    for x in xs[:3]:
        print('  breach %s:' % nm, x)
nan = lambda x: None if x != x else round(x, 4)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('orderroomread', W, {
        'rows_canary': liveness[('post', 'canary', '_craft_noroom')] + liveness[('post', 'canary', '_room_order')],
        'room_orders_canary': room['canary'], 'rows_control': c4, 'offbuild_canary': offbuild,
        'refused_rung_did': nan(did('rung_refused')), 'noroom_craft_canary': can_noroom, 'noroom_craft_control': ctrl_noroom,
        'breach_noroom_craft': c1_breach, 'breach_unbankable': len(c2), 'breach_room_refused': c5_breach, 'breach_home_near': len(c6),
        'rung_success_did': nan(did('rung_success')), 'breach_productive': prod_breach, 'completion_low': completion_low,
        'noroom_wear_canary': C[('post', 'canary')]['rung_noroom_wear'], 'noroom_unknown_canary': C[('post', 'canary')]['rung_noroom_unknown'],
        'giveups_did': nan(did('giveups')), 'executed_did': nan(did('executed')),
        'room_to_craft': completion['crafted'], 'room_ok': room_verdict['ok'], 'slots_freed': room_freed,
        'instrument_refused_control': C[('post', 'control')]['rung_refused'], 'instrument_noroom_control': ctrl_noroom,
        'evidence_short': evidence_short, 'completion_judged': n_ok, 'completion_immature': completion['immature'], 'craft_rows_canary': craft_rows['canary'],
        'productive_low': productive_low, 'productive_p': nan(prod_p), 'unknown_high': unknown_high, 'unknown_share': nan(unknown_share),
        'productivity_undefined': productivity_undefined, 'keep_blocked': keep_blocked,
        'exposure_ready': int(not keep_blocked and C[('post', 'control')]['rung_refused'] >= 1 and ctrl_noroom >= 1),
    })
except Exception as e:
    print('emit failed:', e)
