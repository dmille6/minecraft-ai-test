#!/usr/bin/env python3
# protectzoneread.py [window_min] -- the read for canary `protectzone-01` (bots/src/protectzone.mjs: a per-world
# protected-zones.json in the pool's directory; nothing in a zone is dug, placed, used, opened, slept in or crafted at;
# survival keeps priority). OWNER 2026-10-20 ~15:30Z "option 1" (the showcase village kept as scenery).
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). PROTECTZONEREAD_SELFTEST=1 (or --selftest) runs the gates
# on fixtures. DRAFT 2026-10-20 (protectzone-01 agent): the coordinator owns the launch; the read is offered with it.
#
# WHAT THE BENCH CAN SHOW. The bench has no village, so a canary is exposed only where a pool's directory holds a zone file:
# the FIXTURE (scripts/host/protectzone-fixture.py, coordinator-installed on every drawable pool BEFORE the launch; inert for
# the control build, which never reads it) is one box per town, 20..44 east of home, from home.y-12 to home.y+24 -- ground
# the bots cross every hour. So this read answers the question a showcase cannot: does a zone the bots MUST live beside cost
# them anything (traps, refusal loops, output), and does the build stay inert where there is no file.
#
# ROWS only this build writes:
#   _protectzone_mode      once per spawn: zones=N why=ok|absent|... ids=... world=...   (the licence)
#   _protect_zone          one a minute when anything was refused or filtered: dig= place= use= open= sleep= craft=
#                          survival_allowed= find_filtered= mine_refused= mine_walkout= mine_step_refused=   (the change row)
#   _protect_zone_refused  one per refusal (<= 30 a minute a bot): op= zone= at= purpose= by=
# GATES (canary arm)
#   Z1 trapped       DEFECT: a canary bot whose rows place it inside a zone box for >= TRAP_MIN minutes with < TRAP_MOVE blocks of
#                    displacement (the dead end the guard must never make; a bot in a zone can always walk out over its surface)
#   Z2 refusal_loop  DEFECT: >= LOOP_N refusals (dig+place+use+open+sleep+craft, from the minute rows) by one bot within LOOP_MIN
#                    minutes: a refusal whose remedy is never taken (CLAUDE.md "advice printed is not advice taken")
#   ARMS             control rows of the three kinds after the deploy (must be 0)
#   LICENCE          canary bots with a zones>=1 why=ok licence row >= 1 per drawn pool (else the fixture is missing: INCONCLUSIVE)
#   INSTRUMENT       control bots with >= 1 row inside a zone box >= 1 (the population visits the ground; positions are readable)
#   EXPOSURE         canary bot-minutes inside zone boxes >= EXPOSE_MIN AND canary protection events
#                    (find_filtered + refusals + mine_walkout) >= EXPOSE_EVENTS
# REPORTED  gather successes per bot-h, DiD vs control (PRIMARY: should not fall); survival_allowed; refusals by op.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict

UTC = dt.timezone.utc
TRAP_MIN, TRAP_MOVE = 15, 3.0
LOOP_N, LOOP_MIN = 60, 10
EXPOSE_MIN, EXPOSE_EVENTS = 60, 10
PRE_H = 24
KINDS = ('_protectzone_mode', '_protect_zone', '_protect_zone_refused')
# every refusal a bot can loop on: the chokepoint's six ops AND the skills' own (Codex r2 P2: mine, place, bucket)
REFUSE_KEYS = ('dig', 'place', 'use', 'open', 'sleep', 'craft', 'mine_refused', 'mine_step_refused', 'place_refused', 'bucket_refused')


def in_box(p, z):
    """p: {'x','y','z'} (floats); z: [x0,y0,z0,x1,y1,z1] inclusive integers. Pure."""
    if not p:
        return False
    x, y, w = math.floor(float(p['x'])), math.floor(float(p['y'])), math.floor(float(p['z']))
    return z[0] <= x <= z[3] and z[1] <= y <= z[4] and z[2] <= w <= z[5]


def trapped(rows, boxes, trap_min=TRAP_MIN, move=TRAP_MOVE):
    """rows: one bot's [(t, pos)] sorted. -> list of (start, minutes) spells inside a box with < move displacement. Pure."""
    out, start, anchor, last = [], None, None, None
    for t, p in rows:
        inside = p is not None and any(in_box(p, b) for b in boxes)
        if inside and start is None:
            start, anchor = t, p
        elif inside and math.dist((p['x'], p['z']), (anchor['x'], anchor['z'])) >= move:
            start, anchor = t, p
        elif not inside:
            if start is not None and last is not None and (last - start).total_seconds() / 60 >= trap_min:
                out.append((start, (last - start).total_seconds() / 60))
            start = anchor = None
        last = t
    if start is not None and last is not None and (last - start).total_seconds() / 60 >= trap_min:
        out.append((start, (last - start).total_seconds() / 60))
    return out


def refusal_loop(minutes, n=LOOP_N, span=LOOP_MIN):
    """minutes: one bot's [(t, refusals)] from `_protect_zone` rows. -> the largest refusal sum in any `span` minutes. Pure."""
    best, q = 0, []
    for t, k in sorted(minutes):
        q.append((t, k))
        while q and (t - q[0][0]).total_seconds() / 60 >= span:
            q.pop(0)
        best = max(best, sum(x for _, x in q))
    return best


def counts_of(detail):
    return {k: int(v) for k, v in re.findall(r'(\w+)=(\d+)', detail or '')}


def selftest():
    T = lambda m: dt.datetime(2026, 10, 20, 12, 0, tzinfo=UTC) + dt.timedelta(minutes=m)
    B = [[100, 60, 0, 120, 90, 20]]
    P = lambda x, z: {'x': x, 'y': 70, 'z': z}
    still = [(T(m), P(110.2, 10.1)) for m in range(0, 20)] + [(T(21), P(130, 10))]
    assert len(trapped(still, B)) == 1, 'a still bot inside 20 min is trapped'
    walking = [(T(m), P(100 + m, 10)) for m in range(0, 20)]
    assert trapped(walking, B) == [], 'a bot walking through is not'
    outside = [(T(m), P(50, 10)) for m in range(0, 30)]
    assert trapped(outside, B) == [], 'a still bot OUTSIDE is not (positive control above)'
    assert refusal_loop([(T(m), 7) for m in range(10)]) == 70 and refusal_loop([(T(m * 20), 7) for m in range(10)]) == 7
    assert counts_of('dig=3 open=1 find_filtered=12') == {'dig': 3, 'open': 1, 'find_filtered': 12}
    mine_loop = [(T(m), sum(counts_of('mine_refused=7 find_filtered=50').get(k, 0) for k in REFUSE_KEYS)) for m in range(10)]
    assert refusal_loop(mine_loop) >= LOOP_N, 'a mine refusal loop (70 in 10 min) trips Z2; find_filtered never counts'
    print('selftest ok')


if os.environ.get('PROTECTZONEREAD_SELFTEST') or '--selftest' in sys.argv:
    selftest(); sys.exit(0)

sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events, ZeroLooksWrong

selftest()
LOGROOT = os.environ.get('PZ_LOGROOT', '/var/log/mcai')
POOLROOT = os.environ.get('PZ_POOLROOT', '/var/lib/mcai')
man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(UTC)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
W = min(elapsed, float(args[0]) if args else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(hours=PRE_H)
pool_of = lambda bot: '-'.join((bot or '').split('-')[:2])


def boxes_of(pool):
    """The pool's zone file (the fixture, or a world's own) -> [[x0..z1]]; [] when absent or unreadable."""
    try:
        d = json.load(open(os.path.join(POOLROOT, '_pool-' + pool, 'protected-zones.json')))
        return [z['box'] for z in d.get('zones', []) if isinstance(z.get('box'), list) and len(z['box']) == 6]
    except Exception:
        return []


bots = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(LOGROOT + '/*/') if glob.glob(d + 'skill-*.jsonl*'))
walked = 0; blind = []
per = {}
for bot in bots:
    try:
        ev = Events.load(paths='%s/%s/skill-*.jsonl*' % (LOGROOT, bot), since=PRE, until=END)
    except ZeroLooksWrong:
        continue
    except Exception as e:
        blind.append((bot, type(e).__name__)); continue
    arm = 'canary' if pool_of(bot) in CANS else 'control'
    d = {'arm': arm, 'pos': [], 'mode': [], 'minutes': [], 'refused': Counter(), 'gather_ok': {'pre': 0, 'post': 0},
         'hours': {'pre': 0.0, 'post': 0.0}, 'ctl_kinds': 0, 'offbuild': 0, 'first': {}, 'last': {}}
    for r in ev.rows:
        walked += 1
        raw = r.get('raw') or {}
        ver = ((raw.get('code') or {}).get('version') or '')
        period = 'post' if r['t'] >= CUT else 'pre'
        if period == 'post' and arm == 'canary' and CV and ver and not ver.startswith(CV):
            d['offbuild'] += 1; continue
        d['first'].setdefault(period, r['t']); d['last'][period] = r['t']
        pos = (raw.get('bot') or {}).get('pos')
        if period == 'post':
            d['pos'].append((r['t'], pos))
        sk = raw.get('skill') or {}
        if r['name'] == 'gather' and sk.get('status') == 'success':
            d['gather_ok'][period] += 1
        if period == 'post' and r['name'] in KINDS:
            if arm == 'control':
                d['ctl_kinds'] += 1; continue
            if r['name'] == '_protectzone_mode':
                d['mode'].append(r['detail'])
            elif r['name'] == '_protect_zone':
                c = counts_of(r['detail']); d['minutes'].append((r['t'], sum(c.get(k, 0) for k in REFUSE_KEYS)))
                for k, v in c.items():
                    d['refused'][k] += v
    for p in ('pre', 'post'):
        if p in d['first']:
            d['hours'][p] = (d['last'][p] - d['first'][p]).total_seconds() / 3600
    d['pos'].sort(key=lambda x: x[0])
    per[bot] = d
    del ev

can = [b for b in per if per[b]['arm'] == 'canary']; ctl = [b for b in per if per[b]['arm'] == 'control']
print('rows walked %d | bots %d (canary %d, control %d) | canary %s sha %s cutoff %s window +%d min'
      % (walked, len(per), len(can), len(ctl), ','.join(sorted(CANS)), CV[:8], CUT.strftime('%m-%d %H:%MZ'), W))
if blind:
    print('UNREADABLE bot logs: %s' % blind[:6])
fixture = {p: boxes_of(p) for p in sorted({pool_of(b) for b in per})}
fx_can = {p: len(fixture.get(p) or []) for p in CANS}
lic_pools = {pool_of(b) for b in can if any(re.search(r'zones=[1-9]\d* why=ok', m) for m in per[b]['mode'])}
z1 = []; z2 = []; inside_min = 0; events = 0; survival = 0; ops = Counter()
for b in can:
    bx = fixture.get(pool_of(b)) or []
    for s, m in trapped(per[b]['pos'], bx):
        z1.append((b, s.isoformat(), round(m)))
    loop = refusal_loop(per[b]['minutes'])
    if loop >= LOOP_N:
        z2.append((b, loop))
    inside_min += len({(t.replace(second=0, microsecond=0)) for t, p in per[b]['pos'] if p and any(in_box(p, z) for z in bx)})
    rf = per[b]['refused']
    events += rf['find_filtered'] + rf['mine_walkout'] + sum(rf[k] for k in REFUSE_KEYS)
    survival += rf['survival_allowed']
    for k in REFUSE_KEYS:
        ops[k] += rf[k]
ctl_inside = sum(1 for b in ctl if any(p and any(in_box(p, z) for z in (fixture.get(pool_of(b)) or [])) for _, p in per[b]['pos']))
rows_ctl = sum(per[b]['ctl_kinds'] for b in ctl)
licence_ok = int(bool(CANS) and lic_pools >= CANS)
exposure_ready = int(licence_ok and inside_min >= EXPOSE_MIN and events >= EXPOSE_EVENTS)


def rate(bs, p):
    h = sum(per[b]['hours'][p] for b in bs)
    return (sum(per[b]['gather_ok'][p] for b in bs) / h) if h else float('nan')


did = (rate(can, 'post') - rate(can, 'pre')) - (rate(ctl, 'post') - rate(ctl, 'pre'))
print('LICENCE      canary pools with a zones>=1 licence row: %s of %s | fixture boxes per canary pool %s' % (sorted(lic_pools), sorted(CANS), fx_can))
print('ARMS         control protectzone rows after the deploy: %d (must be 0) | off-build canary rows %d' % (rows_ctl, sum(per[b]['offbuild'] for b in can)))
print('INSTRUMENT   control bots with a row inside their pool\'s zone box: %d (>= 1)' % ctl_inside)
print('Z1 trapped   %d spells >= %d min inside a zone with < %.0f blocks moved %s' % (len(z1), TRAP_MIN, TRAP_MOVE, z1[:4]))
print('Z2 loop      %d bots with >= %d refusals in %d min %s' % (len(z2), LOOP_N, LOOP_MIN, z2[:4]))
print('EXPOSURE     canary bot-minutes inside zones %d (>= %d) | protection events %d (>= %d) -> exposure_ready %d'
      % (inside_min, EXPOSE_MIN, events, EXPOSE_EVENTS, exposure_ready))
print('REPORTED     refusals by op %s | survival_allowed %d | gather ok/bot-h canary pre %.2f post %.2f control pre %.2f post %.2f DiD %+.2f'
      % (dict(ops), survival, rate(can, 'pre'), rate(can, 'post'), rate(ctl, 'pre'), rate(ctl, 'post'), did))
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    r3 = lambda v: None if v is None or v != v else round(v, 4)
    emit('protectzoneread', W, {
        'rows_walked': walked, 'canary_bots': len(can), 'control_bots': len(ctl), 'readable': int(bool(walked and can and ctl and not blind)),
        'licence_ok': licence_ok, 'rows_control': rows_ctl, 'instrument_control': ctl_inside,
        'z1_trapped': len(z1), 'z2_refusal_loop': len(z2), 'inside_minutes': inside_min, 'protection_events': events,
        'survival_allowed': survival, 'exposure_ready': exposure_ready, 'gather_ok_did': r3(did),
    })
except Exception as e:
    print('emit failed:', e)
