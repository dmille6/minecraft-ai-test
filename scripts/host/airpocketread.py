#!/usr/bin/env python3
# airpocketread.py [window_min] -- the read for canary `airpocket-01` (branch ap-on-c6e91a8 / ap-on-92bc84f).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/airpocket.mjs + its wiring in reflex.mjs; docs/reports/airpocket-design-2026-10-07.md): inside the
# drowning rescue, a capped rescue (no air straight up; at once when the rescue's own scan says SEALED, else after 8 s)
# may dig the roof cell over the head into a breathing pocket -- a dug cell above a submerged head stays air (Paper
# sandbox2 10-07) -- or break plain ice with air above it. Admitted by geometry (no liquid, falling block or unknown
# around/above the roof cell) and a fixed health envelope (0.5 HP/s peaceful without Hunger, else 2.0; 4 HP reserve;
# predicted dig x1.5 + 3 s). Rows written ONLY by this build:
#   `_air_pocket`         "outcome=success|aborted|failed kind=pocket|ice cell=x,y,z block=B tool=T predicted_ms=N dig_ms=N
#                          ms=N envelope=E health=A->B eye=E -- why | required_ms=N budget_ms=N difficulty=D
#                          trigger_route=R:N held_ms=N"
#   `_air_pocket_refused` "reason=... at=x,y,z health=H difficulty=D trigger_route=R:N held_ms=N"
#
# OWNER RULE FOR FIXES (09-29): a deterministic correctness gate; reads +180/+360, extended until exposure.
#   LIVENESS     canary `_air_pocket` + `_air_pocket_refused` rows (>= 1): the step is reached.
#   CORRECTNESS  (any breach REVERTS; every one is read per ATTEMPT, never as a rate). An attempt is the pair
#                `_air_pocket_start` id=X ... `_air_pocket` id=X (Codex r1: deaths DURING the dig precede the end row).
#                C0 MALFORMED: an end row missing or with a non-finite required field, an unknown outcome/kind/envelope,
#                   or a start row with no end row although the bot logged rows for 120 s after it (unfinished).
#                C1 FALSE SUCCESS (a per-attempt tripwire): a success followed by the same bot's DROWNING death within
#                   120 s. Attempts whose 120-s follow-up is not yet inside the read window are IMMATURE and not judged.
#                C2 DUG INTO DANGER: a lava/fire or suffocation death, or a `_reflex_danger_block` lava row, from the start
#                   row to 30 s after the end row.
#                C3 RESERVE SPENT: an attempt that did not succeed and ended below 3 HP, or ANY death between the start
#                   and the end row (the step must abort on its budget with the 4 HP reserve intact).
#                C4 UP-ROUTE TRIGGER: a canary `_air_pocket` row whose trigger_route is `up` (the swim was working).
#                C5 ENVELOPE: a canary `_air_pocket` row with envelope=0.5 on a world whose difficulty is not peaceful.
#   ARMS         control `_air_pocket*` rows (0).
#   INSTRUMENT   (positive controls, both GATED) control capped rescues (`_drowning_route` sealed/unscanned/out) >= 1,
#                and control no-air sealed ceilings (`_drowning_ceiling_no_air` oxygen <= 0) >= 1 (the draw's filter
#                "(oxygen 0," is a subset of this: it ignores -1). Parser positive controls are asserted below, and
#                scripts/host/test_airpocketread.py drives every gate on fixture logs (each fires; a clean log passes).
#   EXPOSURE     mature canary attempts >= 2; a KEEP also needs >= 1 success (else INCONCLUSIVE: the step never worked).
#   REPORTED     (never gated -- see POWER) attempts by outcome and kind, refusal reasons, predicted vs actual dig ms,
#                health at the end; capped rescues and drowning deaths per bot-h, canary vs control, pre vs post (DiD);
#                drowning deaths per capped rescue; all-cause deaths/bot-h DiD; entombed+marooned rows/bot-h DiD (the
#                pocket leaves a dry-headed, enclosed bot: stranding is the expected cost); mine rows/bot-h DiD.
# POWER (docs/reports/underground-safety-phase2-2026-10-07.md section 5): about 2.4 sealed episodes per 10 bots per 6 h
#   on average pools (more in the pools draw_exposure picks), ~37% of drowning sites admitted on today's save: about one
#   attempt per 6 h. NO DEATH ENDPOINT IS READABLE at this size (drownings 0.8 expected per 6 h on 10 bots); the effect
#   rests on the Paper sandbox scenes and on the per-attempt correctness gates.
import sys, os, json, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))   # the repo's scripts/ (tests)
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

# AIRPOCKET_LOG_ROOT: run the read over another tree of <bot>/skill-*.jsonl (the Paper sandbox logs: the POSITIVE CONTROL
# that the breach and attempt logic reads real `_air_pocket` rows). Dry runs only.
LOGROOT = os.environ.get('AIRPOCKET_LOG_ROOT', '/var/log/mcai')
APRE = re.compile(r'^outcome=(\w+) kind=(\w+) cell=(\S+) block=(\S+) tool=(\S+) (?:standing=[01] )?predicted_ms=(\S+) dig_ms=(\S+) ms=(\S+) '
                  r'envelope=(\S+) health=([\d.\-]+|null|undefined)->([\d.\-]+|null|undefined)')
STAND = re.compile(r' stand=(none|placed:\d+|stopped:.*?) -- ')
DIFF = re.compile(r'difficulty=(\w+)')
TRIG = re.compile(r'trigger_route=(\w+):(\S+)')   # dist may be -1, an integer, or undefined
REASON = re.compile(r'^reason=(.*?) at=')
IDRE = re.compile(r'^id=(\w+) ')
DANGER = re.compile(r'lava|fire|flames|burn|suffocat')   # applied to the death CAUSE text only (before the first ';')
FOLLOW_S = 120
OX = re.compile(r'\(oxygen (-?\d+),')


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


STARTRE = re.compile(r'^id=(\w+) kind=(pocket|ice) cell=(-?\d+),(-?\d+),(-?\d+) block=(\S+) health=(\d+(?:\.\d+)?) difficulty=(peaceful|easy|normal|hard|null|undefined) '
                     r'hunger=([01]) envelope=(0\.5|2|2\.0) trigger_route=(sealed|unscanned|out|up|null):(-?\d+|undefined) held_ms=(\d+)$')
NUM = lambda x: x is not None and re.fullmatch(r'-?\d+(\.\d+)?', str(x)) is not None
POS = lambda x: x is not None and re.fullmatch(r'\d+(\.\d+)?', str(x)) is not None   # finite and >= 0
CELL = re.compile(r'^-?\d+,-?\d+,-?\d+$')


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# POSITIVE CONTROLS for the parsers (a parser that cannot read its own rows reads every breach as zero).
_s = ('outcome=success kind=pocket cell=700,42,700 block=stone tool=stone_pickaxe predicted_ms=14100 dig_ms=14180 ms=17300 '
      'envelope=0.5 health=19->19.5 eye=air -- breathing in the dug pocket | required_ms=24150 budget_ms=30000 '
      'difficulty=peaceful trigger_route=sealed:-1 held_ms=212')
_s = 'id=lx0a1 ' + _s
_m = APRE.match(IDRE.sub('', _s))
assert _m and _m.group(1) == 'success' and _m.group(9) == '0.5' and fnum(_m.group(11)) == 19.5, 'APRE'
assert DIFF.search(_s).group(1) == 'peaceful' and TRIG.search(_s).groups() == ('sealed', '-1'), 'DIFF/TRIG'
assert REASON.match('reason=water beside the roof cell would fill the pocket at=1,2,3 health=19').group(1).startswith('water beside')
assert OX.search('held 20s and never reached air (oxygen -1, health 12.1) — sealed').group(1) == '-1'
assert IDRE.match(_s).group(1) == 'lx0a1'
assert not DANGER.search('drowned; idle at the moment of death | dropped: lava_bucket x1'.split(';')[0])
assert APRE.match('outcome=aborted kind=ice cell=1,2,3 block=ice tool=hand predicted_ms=18750 dig_ms=-1 ms=9000 envelope=0.5 health=12->null eye=water -- x')

bh = defaultdict(float)                       # (period, arm) -> bot-hours
cnt = defaultdict(Counter)                    # (period, arm) -> kind counters
attempts = []; refusals = Counter(); refusals_n = 0; offbuild = 0; bad_starts = []
breach = defaultdict(list)
rows_walked = Counter()
bots = sorted(d for d in os.listdir(LOGROOT) if not d.startswith('_') and os.path.isdir(os.path.join(LOGROOT, d)))
for b in bots:
    try:
        ev = Events.load(paths=os.path.join(LOGROOT, b, 'skill-*.jsonl*'), since=PRE, until=END)
    except Exception as e:
        print('load failed', b, e)
        continue
    seen, rs = set(), []
    for r in ev.rows:
        k = (r['t'], r['name'], r['detail'])
        if k in seen:
            continue
        seen.add(k); rs.append(r)
    rs.sort(key=lambda r: r['t'])
    arm = 'canary' if pool_of(b) in CANS else 'control'
    prev_t = None
    deaths = []                               # (t, detail)
    danger = []                               # t of _reflex_danger_block lava
    mine_aps = []                             # this bot's canary-build _air_pocket rows (t, detail)
    starts = {}                               # id -> t of a VALID _air_pocket_start (STARTRE)
    start_trig = {}                           # id -> the start row's trigger_route match (the END row may omit it: 300-char cap)
    last_t = None
    for r in rs:
        t = r['t']; raw = r.get('raw') or {}; k = r['name']; d = r.get('detail') or ''
        period = 'post' if t >= CUT else 'pre'
        key = (period, arm)
        rows_walked[key] += 1
        if prev_t is not None:
            pp = 'post' if prev_t >= CUT else 'pre'
            bh[(pp, arm)] += min((t - prev_t).total_seconds(), 120.0) / 3600
        prev_t = t; last_t = t
        ver = ((raw.get('code') or {}).get('version') or '')
        other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
        if k == '_death':
            cnt[key]['death'] += 1
            if 'drown' in d: cnt[key]['death_drown'] += 1
            deaths.append((t, d))
        elif k == '_drowning_route' and re.match(r'(sealed|unscanned|out) ', d):
            cnt[key]['capped_rescue'] += 1
        elif k == '_drowning_ceiling_no_air':
            m = OX.search(d)
            if m and int(m.group(1)) <= 0: cnt[key]['noair_ceiling'] += 1
        elif k == '_reflex_danger_block' and 'lava' in d:
            danger.append(t)
        elif k in ('_entombed', '_marooned'):
            cnt[key]['stranding_rows'] += 1
        elif k == 'mine':
            cnt[key]['mine'] += 1
        elif k in ('_air_pocket', '_air_pocket_refused', '_air_pocket_start', '_air_pocket_preempt'):
            cnt[key][k] += 1
            if k == '_air_pocket_preempt':
                continue
            if k == '_air_pocket_start':
                if arm == 'canary' and period == 'post' and not other:
                    ms_ = STARTRE.match(d)
                    if ms_: starts[ms_.group(1)] = t; start_trig[ms_.group(1)] = TRIG.search(d)
                    else: bad_starts.append({'bot': b, 't': t.isoformat()[:19], 'detail': d[:200]})
                continue
            if arm == 'canary' and period == 'post' and other:
                offbuild += 1
                continue
            if arm == 'canary' and period == 'post':
                if k == '_air_pocket':
                    mine_aps.append((t, d))
                else:
                    refusals_n += 1
                    m = REASON.match(d)
                    refusals[(m.group(1).split(' ')[0] + ' ' + ' '.join(m.group(1).split(' ')[1:4])) if m else '?'] += 1
    # per-attempt correctness, read against this bot's own rows from the START row to the follow-up
    ended = set()
    for t, d in mine_aps:
        mi = IDRE.match(d)
        aid = mi.group(1) if mi else None
        body = IDRE.sub('', d)
        m = APRE.match(body)
        outcome = m.group(1) if m else '?'
        hend = fnum(m.group(11)) if m else None
        env = m.group(9) if m else None
        diff = DIFF.search(d); trig = TRIG.search(d) or start_trig.get(aid)
        t0 = starts.get(aid, t)
        if aid: ended.add(aid)
        a = {'bot': b, 'id': aid, 't': t.isoformat()[:19], 'outcome': outcome, 'kind': m.group(2) if m else '?', 'block': m.group(4) if m else '?',
             'tool': m.group(5) if m else '?', 'pred': fnum(m.group(6)) if m else None, 'dig': fnum(m.group(7)) if m else None,
             'hstart': fnum(m.group(10)) if m else None, 'hend': hend, 'difficulty': diff.group(1) if diff else '?',
             'trigger': trig.group(1) if trig else '?', 'mature': (END - t).total_seconds() >= FOLLOW_S, 'detail': d[:200]}
        st = STAND.search(d); a['stand'] = (st.group(1).split(' (')[0][:40] if st else 'absent')
        attempts.append(a)
        req = re.search(r'required_ms=(\S+) budget_ms=(\S+)', d)
        valid = (m and aid and outcome in ('success', 'opened', 'aborted', 'failed') and a['kind'] in ('pocket', 'ice') and env in ('0.5', '2', '2.0')
                 and CELL.match(m.group(3)) and all(NUM(m.group(i)) for i in (6, 7, 8)) and NUM(m.group(10)) and NUM(m.group(11))
                 and req and POS(req.group(1)) and POS(req.group(2)) and diff and diff.group(1) in ('peaceful', 'easy', 'normal', 'hard', 'null', 'undefined')
                 and trig and trig.group(1) in ('sealed', 'unscanned', 'out', 'up', 'null') and re.fullmatch(r'-?\d+|undefined', trig.group(2))
                 and aid in starts and starts[aid] <= t)
        if not valid:
            breach['C0_malformed'].append(a)
        during = [(dt_, dd) for dt_, dd in deaths if t0 <= dt_ <= t]
        after = [(dt_, dd) for dt_, dd in deaths if t < dt_ <= t + dt.timedelta(seconds=FOLLOW_S)]
        if outcome == 'success' and a['mature'] and any('drown' in dd for _, dd in after):
            breach['C1_false_success'].append(a)
        if any(DANGER.search(dd.split(';')[0]) for dt_, dd in during + [x for x in after if (x[0] - t).total_seconds() <= 30]) or \
           any(t0 <= x <= t + dt.timedelta(seconds=30) for x in danger):
            breach['C2_dug_into_danger'].append(a)
        if (outcome != 'success' and hend is not None and hend < 3) or during:
            breach['C3_reserve_spent'].append(a)
        if trig and trig.group(1) == 'up':
            breach['C4_up_route_trigger'].append(a)
        if env == '0.5' and diff and diff.group(1) != 'peaceful':
            breach['C5_envelope'].append(a)
    # STARTS WITH NO END ROW: died during the attempt (judged as C2/C3 by cause) or unfinished while the bot went on
    for aid, t0 in starts.items():
        if aid in ended:
            continue
        a = {'bot': b, 'id': aid, 't': t0.isoformat()[:19], 'outcome': 'no end row', 'kind': '?', 'block': '?', 'tool': '?', 'pred': None,
             'dig': None, 'hstart': None, 'hend': None, 'difficulty': '?', 'trigger': '?', 'mature': True, 'detail': ''}
        died = [(dt_, dd) for dt_, dd in deaths if t0 <= dt_ <= t0 + dt.timedelta(seconds=90)]
        if died:
            attempts.append(a)
            breach['C2_dug_into_danger' if DANGER.search(died[0][1].split(';')[0]) else 'C3_reserve_spent'].append(a)
        elif last_t is not None and (last_t - t0).total_seconds() >= FOLLOW_S:
            attempts.append(a)
            breach['C0_malformed'].append(a)

rate = lambda key, f: cnt[key][f] / bh[key] if bh.get(key) else float('nan')
def did(f):
    return (rate(('post', 'canary'), f) - rate(('pre', 'canary'), f)) - (rate(('post', 'control'), f) - rate(('pre', 'control'), f))
ctl_rows = sum(cnt[(p, 'control')][k] for p in ('pre', 'post')
               for k in ('_air_pocket', '_air_pocket_refused', '_air_pocket_start', '_air_pocket_preempt'))
for x in bad_starts:
    breach['C0_malformed'].append(x)
can_attempts = sum(1 for a in attempts if a['mature'])
mature_success = sum(1 for a in attempts if a['mature'] and a['outcome'] == 'success')
immature = sum(1 for a in attempts if not a['mature'])
can_live = can_attempts + refusals_n
inst_capped = cnt[('post', 'control')]['capped_rescue']; inst_noair = cnt[('post', 'control')]['noair_ceiling']
oc = Counter(a['outcome'] for a in attempts); kinds = Counter(a['kind'] for a in attempts)
nb = sum(len(v) for v in breach.values())
print('rows walked %s | canary %s sha %s cutoff %s window +%d min' % (dict(rows_walked), sorted(CANS), CV, CUT.isoformat()[:19], W))
print('-' * 78)
print('LIVENESS     canary _air_pocket %d + _air_pocket_refused %d = %d (>= 1) | control rows %d (must be 0) | other build %d' % (
    can_attempts, refusals_n, can_live, ctl_rows, offbuild))
print('CORRECTNESS  breaches %d: %s' % (nb, {k: len(v) for k, v in breach.items()} or 'none'))
print('ATTEMPTS     %d mature (+%d immature): outcomes %s kinds %s | mature successes %d | exposure (>= 2) %s' % (can_attempts, immature, dict(oc), dict(kinds), mature_success, 'READY' if can_attempts >= 2 else 'NOT YET'))
for a in attempts[:8]:
    print('   %s %s %s %s %s tool=%s pred=%s dig=%s health %s->%s %s trigger=%s' % (a['t'], a['bot'], a['outcome'], a['kind'], a['block'],
          a['tool'], a['pred'], a['dig'], a['hstart'], a['hend'], a['difficulty'], a['trigger']))
print('STAND        (reported, never gated) %s' % dict(Counter(a.get('stand', 'absent') for a in attempts if a['outcome'] == 'success').most_common(6)))
print('REFUSALS     %d: %s' % (refusals_n, dict(refusals.most_common(8))))
print('INSTRUMENT   control capped rescues (post) %d (>= 1) | control no-air sealed ceilings (post) %d (>= 1)' % (inst_capped, inst_noair))
for f, nm in (('capped_rescue', 'capped rescues/bot-h'), ('noair_ceiling', 'no-air ceilings/bot-h'), ('death_drown', 'drowning deaths/bot-h'),
              ('death', 'all deaths/bot-h'), ('stranding_rows', 'entombed+marooned rows/bot-h'), ('mine', 'mine rows/bot-h')):
    print('REPORTED     %-30s canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f' % (
        nm, rate(('pre', 'canary'), f), rate(('post', 'canary'), f), rate(('pre', 'control'), f), rate(('post', 'control'), f), did(f)))
print('             drowning deaths per capped rescue: canary post %d/%d control post %d/%d | bot-h %s' % (
    cnt[('post', 'canary')]['death_drown'], cnt[('post', 'canary')]['capped_rescue'], cnt[('post', 'control')]['death_drown'],
    cnt[('post', 'control')]['capped_rescue'], {'%s/%s' % k: round(v, 1) for k, v in bh.items()}))
thin = [a for a in ('canary', 'control') if bh.get(('pre', a), 0) < 0.5 * bh.get(('post', a), 0)]
print('POWER        about 1 attempt per 10 bots per 6 h on average pools, ~2-6 on draw_exposure pools; no death endpoint is readable at this size.'
      + (' THIN PRE WINDOW for %s (< half the post bot-h): the DiDs above lean on a short baseline.' % thin if thin else ''))
for k, xs in breach.items():
    for x in xs[:3]:
        print('  breach %s: %s' % (k, x))
nan = lambda x: None if x != x else round(x, 4)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    emit('airpocketread', W, {
        'rows_canary': can_live, 'attempts_canary': can_attempts, 'rows_control': ctl_rows, 'offbuild_canary': offbuild,
        'breach_false_success': len(breach['C1_false_success']), 'breach_dug_into_danger': len(breach['C2_dug_into_danger']),
        'breach_reserve_spent': len(breach['C3_reserve_spent']), 'breach_up_trigger': len(breach['C4_up_route_trigger']),
        'breach_envelope': len(breach['C5_envelope']), 'breach_unparsed': len(breach['C0_malformed']), 'immature_canary': immature,
        'instrument_capped_control': inst_capped, 'instrument_noair_control': inst_noair,
        'successes_canary': mature_success, 'successes_canary_all': oc['success'], 'aborted_canary': oc['aborted'], 'failed_canary': oc['failed'], 'refusals_canary': refusals_n,
        'drown_death_did': nan(did('death_drown')), 'death_did': nan(did('death')), 'stranding_did': nan(did('stranding_rows')),
        'mine_did': nan(did('mine')), 'capped_rescue_did': nan(did('capped_rescue')),
        'exposure_ready': int(can_attempts >= 2 and inst_capped >= 1 and inst_noair >= 1),
    })
except Exception as e:
    print('emit failed:', e)
