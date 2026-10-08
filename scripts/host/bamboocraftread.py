#!/usr/bin/env python3
# bamboocraftread.py [window_min] -- the read for canary `bamboocraft-01` (a room-blocked craft folds bamboo into sticks
# when that, and only that, makes it fit; branches bc-on-6fb6fd9 / bc-on-786da4c, on top of bamboo-01, launched only after
# bamboo-01 is KEPT). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/bamboo.mjs foldForCraft; skills.mjs foldForRoom): when the craft skill's room check refuses a craft
# for ROOM and the bag holds bamboo, the craft folds the smallest batch of bamboo into sticks that (simulated in the real
# slot order) frees a slot, throws nothing, keeps the 64-stick cap (or opens no new stick slot), never spends bamboo the
# craft or a later whole-tree step needs, fits the time left -- AND leaves a bag the craft fits on; then it recounts the
# server's bag and re-runs the craft's own room check (enabled). One fold per craft level; otherwise the existing remedy.
#   _bamboo_room  "<item>: <why> attempted=yes|no crafts=<made>/<planned> slots=<o0>-><o1> enabled=yes|no", status
#                 made_room | refused | skipped | aborted; args {item, attempted, crafts, planned, o0, o1, enabled, reason,
#                 source}. Written whenever the bag holds bamboo (skipped rows are the denominator).
#
#   LIVENESS     canary _bamboo_room rows (>= 1) and canary attempted folds; control rows 0 (the base cannot write it).
#   CORRECTNESS  (each REVERTS)
#     B1 A FOLD FOR A CRAFT THAT CONSUMES BAMBOO: an attempted fold whose item is scaffolding or bamboo_block.
#     B2 MORE CRAFTS THAN PLANNED: crafts > planned.
#     B3 ROOM CLAIMED, NO SLOT FREED: a made_room row (enabled=yes) on the server's bag (source=server) with o1 >= o0.
#   TRIPWIRES   (named, not gated) B4 the stick cap: an attempted fold whose END snapshot holds > 64 sticks in MORE stick
#                slots than the sticks before the fold needed (a pickup can fake it); refused-after-fold rows by reason;
#                aborted folds; deaths within 60 s of a fold.
#   INSTRUMENT   control _craft_room refusals (the room check refused a craft) by bots holding >= 2 bamboo (>= 1): the
#                population exists in the control arm.
#   EXPOSURE     >= 3 canary attempted folds AND the instrument.
#   PRIMARY      of canary room refusals with >= 2 bamboo held, the share followed within 120 s by a successful craft of
#                the same item, DiD against the control (difference-in-differences, never canary-vs-fleet); REPORTED:
#                enabled share of attempted folds, crafts per fold, skip reasons.
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
BAMBOO_CRAFTS = ('scaffolding', 'bamboo_block')


def load_window(since, until):
    """Rotation-aware (wellread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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


def kv(d):
    return {m.group(1): m.group(2) for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or '')}


def room_fields(d):
    """-> {item, attempted, made, planned, o0, o1, enabled} from a _bamboo_room detail, or None."""
    m = re.match(r'^(\S+): .* attempted=(yes|no) crafts=(\d+)/(\d+) slots=(\d+)->(\d+) enabled=(yes|no)$', d or '')
    if not m:
        return None
    return {'item': m.group(1), 'attempted': m.group(2), 'made': int(m.group(3)), 'planned': int(m.group(4)),
            'o0': int(m.group(5)), 'o1': int(m.group(6)), 'enabled': m.group(7)}


def b1(f):
    return f['attempted'] == 'yes' and f['item'] in BAMBOO_CRAFTS


def b2(f):
    return f['made'] > f['planned']


def b3(f, status, source):
    return status == 'made_room' and source == 'server' and f['o1'] >= f['o0']


def b4(f, sticks_end):
    """the stick cap, from the row and the END snapshot: more stick slots than the sticks before the fold needed, past 64"""
    if f['attempted'] != 'yes' or sticks_end is None or sticks_end <= 64:
        return False
    before = max(0, sticks_end - f['made'])
    return -(-sticks_end // 64) > max(1, -(-before // 64))


# POSITIVE CONTROLS: the build's own row shape (bots/test/bamboocraft.test.mjs writes the same string)
_ok = room_fields('stone_pickaxe: made room by folding 64 bamboo into 32 sticks attempted=yes crafts=32/32 slots=36->35 enabled=yes')
assert _ok == {'item': 'stone_pickaxe', 'attempted': 'yes', 'made': 32, 'planned': 32, 'o0': 36, 'o1': 35, 'enabled': 'yes'}
assert not b1(_ok) and not b2(_ok) and not b3(_ok, 'made_room', 'server')
assert b1(room_fields('scaffolding: x attempted=yes crafts=1/1 slots=36->35 enabled=no'))
assert not b1(room_fields('scaffolding: the craft consumes bamboo attempted=no crafts=0/0 slots=36->36 enabled=no')), 'a protected skip is the rule working'
assert b2(room_fields('stone_pickaxe: x attempted=yes crafts=33/32 slots=36->35 enabled=yes'))
assert b3(room_fields('stone_pickaxe: x attempted=yes crafts=32/32 slots=36->36 enabled=yes'), 'made_room', 'server')
assert not b3(room_fields('stone_pickaxe: x attempted=yes crafts=32/32 slots=36->36 enabled=no'), 'refused', 'server')
assert b4(_ok, 129) and b4(_ok, 96) and not b4(_ok, 64) and not b4(_ok, 100), 'a new stick slot past 64 trips (64 + 32 -> 96 in 2 slots); within the old slots (68 + 32 = 100, 2 slots) does not'

rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W))
lic = Counter(); offbuild = 0; c1 = []; c2 = []; c3 = []; t4 = []; refused_after = Counter(); aborted = 0
attempted = Counter(); enabled = Counter(); crafts = []; skips = Counter(); deaths_near = []
refusals = defaultdict(list); successes = defaultdict(list); bots = defaultdict(set); last_fold = {}
for r in rows:
    t = r.get('t'); b = (r.get('bot') or {}).get('name')
    if t is None or not b:
        continue
    arm = 'canary' if pool_of(b) in CANS else 'control'
    period = 'post' if t >= CUT else 'pre'
    bots[(period, arm)].add(b)
    k = r.get('name'); d = r.get('detail') or ''
    raw = r.get('raw') or {}
    inv = (raw.get('bot') or {}).get('inventory') or {}
    ver = ((raw.get('code') or {}).get('version') or '')
    other = arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV)
    sk = raw.get('skill') or {}
    st = sk.get('status') or r.get('status')
    args = sk.get('args') or {}
    if k == '_bamboo_room' and period == 'post':
        if other:
            offbuild += 1
            continue
        lic[arm] += 1
        f = room_fields(d)
        if f is None or arm != 'canary':
            continue
        if f['attempted'] == 'yes':
            attempted['canary'] += 1; crafts.append(f['made']); last_fold[b] = t
            if f['enabled'] == 'yes':
                enabled['canary'] += 1
            elif st == 'aborted':
                aborted += 1
            else:
                refused_after[args.get('reason') or '?'] += 1
        else:
            skips[args.get('reason') or '?'] += 1
        if b1(f):
            c1.append((b, d[:120]))
        if b2(f):
            c2.append((b, d[:120]))
        if b3(f, st, args.get('source')):
            c3.append((b, d[:120]))
        if b4(f, inv.get('stick') if isinstance(inv, dict) else None):
            t4.append((b, inv.get('stick'), d[:100]))
    if k == '_craft_room' and st == 'refused' and isinstance(inv, dict) and inv.get('bamboo', 0) >= 2 and not other:
        m_ = re.match(r'^([a-z0-9_]+):', d or '')
        item = args.get('item') or (m_.group(1) if m_ else '?')
        refusals[(period, arm)].append((b, t, item))
    if k == 'craft' and st == 'success' and not other:
        successes[b].append((t, args.get('item')))
    if k in ('_death', 'death') and b in last_fold and (t - last_fold[b]).total_seconds() < 60:
        deaths_near.append((b, d[:80]))


def unblocked(period, arm):
    """share of room refusals (>= 2 bamboo held) followed within 120 s by a successful craft of the same item"""
    rs = refusals[(period, arm)]
    if not rs:
        return float('nan'), 0
    ok = 0
    for b, t, item in rs:
        if any(0 <= (t2 - t).total_seconds() <= 120 and (it2 == item or it2 is None) for t2, it2 in successes.get(b, [])):
            ok += 1
    return ok / len(rs), len(rs)


u = {(p, a): unblocked(p, a) for p in ('pre', 'post') for a in ('canary', 'control')}
did = (u[('post', 'canary')][0] - u[('pre', 'canary')][0]) - (u[('post', 'control')][0] - u[('pre', 'control')][0])
inst = u[('post', 'control')][1]
exposure = int(attempted['canary'] >= 3 and inst >= 1)
print('-' * 78)
print('DENOMINATORS bots pre canary %d control %d | post canary %d control %d | room refusals with >= 2 bamboo held: pre canary %d control %d | post canary %d control %d'
      % (len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]),
         u[('pre', 'canary')][1], u[('pre', 'control')][1], u[('post', 'canary')][1], u[('post', 'control')][1]))
print('LIVENESS     canary _bamboo_room rows %d (>= 1), attempted folds %d | control rows %d (must be 0) | other build %d'
      % (lic['canary'], attempted['canary'], lic['control'], offbuild))
print('CORRECTNESS  B1 fold for a bamboo craft %d | B2 crafts > planned %d | B3 room claimed, no slot freed (server) %d' % (len(c1), len(c2), len(c3)))
print('TRIPWIRES    B4 a new stick slot past 64 %d %s | refused after a fold %s | aborted folds %d | deaths within 60 s of a fold %d %s'
      % (len(t4), t4[:2], dict(refused_after) or '-', aborted, len(deaths_near), deaths_near[:2]))
print('INSTRUMENT   control room refusals with >= 2 bamboo held: %d (>= 1) | POSITIVE CONTROL for the unblock join: successful crafts seen %d (bots %d)' % (inst, sum(len(v) for v in successes.values()), len(successes)))
print('EXPOSURE     canary attempted folds %d (>= 3) and the instrument -> %s' % (attempted['canary'], 'READY' if exposure else 'NOT YET'))
print('PRIMARY      unblocked within 120 s: canary %.2f -> %.2f control %.2f -> %.2f DiD %+.3f'
      % (u[('pre', 'canary')][0], u[('post', 'canary')][0], u[('pre', 'control')][0], u[('post', 'control')][0], did))
print('             enabled share of attempted folds %s | crafts per fold median %s | skip reasons %s'
      % (('%.2f' % (enabled['canary'] / attempted['canary'])) if attempted['canary'] else '-',
         sorted(crafts)[len(crafts) // 2] if crafts else '-', dict(skips) or '-'))
for x in (c1[:3] + c2[:3] + c3[:3]):
    print('  breach:', x)
try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    clean = lambda v: None if v != v else round(v, 4)
    emit('bamboocraftread', W, {
        'rows_canary': lic['canary'], 'rows_control': lic['control'], 'offbuild_canary': offbuild, 'attempted_canary': attempted['canary'],
        'breach_bamboo_craft': len(c1), 'breach_crafts_over_plan': len(c2), 'breach_no_slot_freed': len(c3),
        'tripwire_stick_cap': len(t4), 'aborted_folds': aborted, 'deaths_near_fold': len(deaths_near),
        'enabled_canary': enabled['canary'], 'instrument_control': inst,
        'unblocked_did': clean(did), 'exposure_ready': exposure,
    })
except Exception as e:
    print('emit failed:', e)
