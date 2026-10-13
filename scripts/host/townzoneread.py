#!/usr/bin/env python3
# townzoneread.py [window_min] -- the read for canary `townzone-01` (branch tz-on-82aef34): THE TOWN'S GROUND, the zone.
# Run under `nice`. CANARY_DRYRUN=pool:sha:iso for dry runs (never emits). REQUIRES the `_dig_town` instrument
# (digtown-01) live on BOTH arms -- the zone's base is the fleet with digtown-01 promoted.
#
# THE CHANGE (bots/src/townground.mjs, skills.mjs gather/mine, oretunnel.mjs, index.mjs; townground-2026-10-13.md 2.4-2.7):
#   town ground = terrain in a square of half-width 16 around home, above home.y - 12.
#   gather   candidates filtered at enumeration (findBlocks matcher) + a target conjunction at the filter and at the swing.
#   mine     the 12-block rule stays; a bearing whose stair would cut town ground is not chosen; each step re-checks its
#            three cells (failClass town_ground, reason=town_ground_step); no clear bearing -> a deterministic walk-out to
#            16 + 3 out, then once more (failClass town_ground, reason=town_ground, names goto).
#   tunnel   town ground costs 100 in the ore tunnel's profile (nearHome's 12 stays).
#   transit  every other dig-capable profile prices town ground at 30 (< 100): never a refusal.
#   survival untouched (reflexes, canopy descent, float dig, ride-floor-down, the well build, lid clears, wear_out, craft room).
#   ROW: `_town_ground` once a minute when the zone refused anything (args: gather_skipped, gather_refused,
#        mine_bearing_refused, mine_walkout, mine_step_refused, mine_refused).
#
#   LICENCE      kind `_town_ground` (the base cannot write it).
#   PRIMARY      deduped CONFIRMED `_dig_town` rows of town ground with purpose `target` (gather / mine / ore_tunnel), per
#                bot-h, canary vs control, pre vs post (DiD). Expected: the canary falls to ~0. Transit and survival town
#                digs are reported beside it (transit may RISE: a bot that walks round may dig through).
#   GATES        Z1 breach_target_ground: any canary post confirmed town-ground TARGET dig by gather/mine/ore_tunnel --
#                   a defect by construction (the three guards make it impossible). Deduped (cell, +-2 s).
#                Z2 breach_mine_loop: one canary bot with >= 3 zone-caused mine refusals (failClass town_ground) inside
#                   10 min: the walk-out is not resolving it (a dead end in practice).
#                Z3 breach_gather_loop: one canary bot with >= 6 zone-caused gather refusals inside 10 min (the remedy
#                   printed and not taken: CLAUDE.md "advice printed is not advice taken").
#                Z4 breach_trapped: trapped-in-town rows (_entombed, _stranded_escape_result, _livelock_escape with the bot
#                   within 20 of home) per bot-h DiD > TRAP_DID with >= TRAP_MIN canary rows (calibrated on null windows).
#                LEAK control `_town_ground` rows (BLOCKS KEEP).
#   INSTRUMENT   positive control: the CONTROL arm's confirmed town-ground target digs in the post window (>= 1: the
#                population exists and this query sees it) -- Z1's population on the arm that still digs.
import sys, os, re, json, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

DEDUPE = dt.timedelta(seconds=2)
LOOP_WIN = dt.timedelta(minutes=10)
MINE_LOOP, GATHER_LOOP = 3, 6
TRAP_DID, TRAP_MIN = 3.0, 20          # null calibration 10-13 (24 h, 44 pool x cut samples, W 180): max DiD 2.04, 1 of 44 over 2.0, 0 over 3.0
TRAP_KINDS = {'entombed', 'stranded_escape_result', 'livelock_escape'}
TARGET_BY = {'gather', 'mine', 'ore_tunnel'}
HALF = 16


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def args_of(r):
    return (((r.get('raw') or {}).get('skill') or {}).get('args')) or {}


def dedupe(rows):
    """PURE. [(t, bot, x, y, z)] -> unique digs, one per (cell, +-2 s) cluster across bots."""
    by = defaultdict(list)
    for t, b, x, y, z in rows:
        by[(x, y, z)].append(t)
    n = 0
    for ts in by.values():
        ts.sort(); start = None
        for t in ts:
            if start is not None and t - start <= DEDUPE:
                continue
            start = t; n += 1
    return n


def loops(events, k, win=LOOP_WIN):
    """PURE. events: [(bot, t)] -> bots with >= k events inside any window of length win."""
    by = defaultdict(list)
    for b, t in events:
        by[b].append(t)
    out = []
    for b, ts in by.items():
        ts.sort()
        for i in range(len(ts) - k + 1):
            if ts[i + k - 1] - ts[i] <= win:
                out.append(b); break
    return sorted(out)


def is_target_town(a):
    """PURE. a `_dig_town` row's args -> a confirmed town-ground TARGET dig by gather/mine/ore_tunnel."""
    return (a.get('outcome') == 'confirmed' and a.get('cls') == 'ground' and a.get('purpose') == 'target'
            and str(a.get('by') or '').split(':')[0] in TARGET_BY)


def zone_refusal(name, d, fail_class):
    """PURE. -> 'mine' | 'gather' | None for a skill row the zone caused."""
    if name == 'mine' and (fail_class == 'town_ground' or 'reason=town_ground' in d):
        return 'mine'
    if name == 'gather' and ("outside the town's ground" in d or d.startswith('town_ground:') or 'town_ground:' in d):
        return 'gather'
    return None


_T = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)
_m = lambda n: _T + dt.timedelta(minutes=n)
assert dedupe([(_T, 'a', 1, 2, 3), (_T + dt.timedelta(seconds=1), 'b', 1, 2, 3)]) == 1
assert loops([('a', _m(0)), ('a', _m(4)), ('a', _m(9))], 3) == ['a'] and loops([('a', _m(0)), ('a', _m(6)), ('a', _m(12))], 3) == []
assert is_target_town({'outcome': 'confirmed', 'cls': 'ground', 'purpose': 'target', 'by': 'gather:dirt'})
assert is_target_town({'outcome': 'confirmed', 'cls': 'ground', 'purpose': 'target', 'by': 'ore_tunnel'})
assert not is_target_town({'outcome': 'confirmed', 'cls': 'ground', 'purpose': 'transit', 'by': 'gather:dirt'}), 'transit is allowed'
assert not is_target_town({'outcome': 'unconfirmed', 'cls': 'ground', 'purpose': 'target', 'by': 'mine:y12'}), 'a refused dig removed nothing'
assert not is_target_town({'outcome': 'confirmed', 'cls': 'ground', 'purpose': 'other', 'by': 'wear_out'}), 'maintenance digs are not the zone\'s'
assert zone_refusal('mine', 'reason=town_ground walked_out=success to 219,203: every stair ...', 'town_ground') == 'mine'
assert zone_refusal('mine', 'stopped at y=40: water in the tread ahead', 'hazard_interrupt') is None, "mine's own refusals are not the zone's"
assert zone_refusal('gather', "no dirt within 32 blocks outside the town's ground (16 blocks around home is kept: walk 20+ blocks from home)", 'nothing_found') == 'gather'


def homes():
    out = {}
    for f in glob.glob('/srv/mcbots/harness/env/*.env'):
        try:
            kv = dict(l.strip().split('=', 1) for l in open(f) if '=' in l and not l.startswith('#'))
            out[os.path.basename(f)[:-4]] = (float(kv['HOME_X']), float(kv['HOME_Z']))
        except Exception:
            pass
    return out


if __name__ == '__main__':
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
    HOMES = homes()

    def load_window(since, until):
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); nrows = Counter(); offbuild = 0
    n = Counter(); target = defaultdict(list); transit = Counter(); leak = 0; licence = 0
    mine_ref = []; gather_ref = []; zargs = Counter()
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        k = (r.get('name') or '').lstrip('_'); d = r.get('detail') or ''
        sk = ((r.get('raw') or {}).get('skill') or {})
        if k == 'town_ground':
            if period == 'post' and arm == 'control':
                leak += 1
            if period == 'post' and arm == 'canary':
                licence += 1
                for kk, v in args_of(r).items():
                    zargs[kk] += int(v or 0)
        elif k == 'dig_town':
            a = args_of(r)
            n[(period, arm, 'dig_town_rows')] += 1
            if is_target_town(a):
                target[(period, arm)].append((t, b, a.get('x'), a.get('y'), a.get('z')))
            elif a.get('outcome') == 'confirmed':
                transit[(period, arm, a.get('purpose'))] += 1
        else:
            z = zone_refusal(k, d, r.get('fail_class') or sk.get('fail_class'))
            if z and period == 'post' and arm == 'canary':
                (mine_ref if z == 'mine' else gather_ref).append((b, t))
            if k in TRAP_KINDS:
                pos = (r.get('bot') or {}).get('pos') or {}
                h = HOMES.get(b)
                if h and 'x' in pos and max(abs(pos['x'] - h[0]), abs(pos['z'] - h[1])) <= HALF + 4:
                    n[(period, arm, 'trapped')] += 1
            if k == 'gather' and re.search(r'^(dirt|cobblestone|stone)\b', str((sk.get('args') or {}).get('block') or '')):
                n[(period, arm, 'gather_ground')] += 1
                if sk.get('status') != 'success':
                    n[(period, arm, 'gather_ground_fail')] += 1

    hours = W / 60.0
    nb = lambda p, a: len(bots[(p, a)])
    def rate(p, a, what):
        return n[(p, a, what)] / (nb(p, a) * hours) if nb(p, a) and hours else float('nan')
    def trate(p, a):
        return dedupe(target[(p, a)]) / (nb(p, a) * hours) if nb(p, a) and hours else float('nan')
    did_t = (trate('post', 'canary') - trate('pre', 'canary')) - (trate('post', 'control') - trate('pre', 'control'))
    did_trap = (rate('post', 'canary', 'trapped') - rate('pre', 'canary', 'trapped')) - (rate('post', 'control', 'trapped') - rate('pre', 'control', 'trapped'))
    z1 = dedupe(target[('post', 'canary')])
    z2 = loops(mine_ref, MINE_LOOP); z3 = loops(gather_ref, GATHER_LOOP)
    z4 = int(did_trap > TRAP_DID and n[('post', 'canary', 'trapped')] >= TRAP_MIN)
    inst = dedupe(target[('post', 'control')])
    instr_any = n[('post', 'control', 'dig_town_rows')] + n[('post', 'canary', 'dig_town_rows')]
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, nb('pre', 'canary'), nb('post', 'canary'), nb('pre', 'control'), nb('post', 'control'), offbuild))
    print('LIVENESS     canary _town_ground rows %d | refused: %s | _dig_town rows on both arms %d (0 = the instrument is not live: this read cannot judge)'
          % (licence, dict(zargs), instr_any))
    print('Z1 (gate)    canary confirmed town-ground TARGET digs (gather/mine/ore_tunnel), deduped: %d' % z1)
    print('Z2 (gate)    canary bots with >= %d zone mine refusals in 10 min: %s (zone mine refusals %d)' % (MINE_LOOP, z2, len(mine_ref)))
    print('Z3 (gate)    canary bots with >= %d zone gather refusals in 10 min: %s (zone gather refusals %d)' % (GATHER_LOOP, z3, len(gather_ref)))
    print('Z4 (gate)    trapped-in-town rows per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f (gate > %.1f with >= %d canary rows; canary rows %d)'
          % (rate('pre', 'canary', 'trapped'), rate('post', 'canary', 'trapped'), rate('pre', 'control', 'trapped'), rate('post', 'control', 'trapped'),
             did_trap, TRAP_DID, TRAP_MIN, n[('post', 'canary', 'trapped')]))
    print('LEAK         control _town_ground rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control confirmed town-ground target digs post (deduped) %d (>= 1: the population exists and the query sees it)' % inst)
    print('PRIMARY      confirmed town-ground target digs per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f'
          % (trate('pre', 'canary'), trate('post', 'canary'), trate('pre', 'control'), trate('post', 'control'), did_t))
    print('             confirmed town-ground non-target digs post: canary %s | control %s'
          % ({p: v for (pp, a, p), v in transit.items() if pp == 'post' and a == 'canary'}, {p: v for (pp, a, p), v in transit.items() if pp == 'post' and a == 'control'}))
    print('             gather dirt/cobblestone/stone fail share  canary %.2f -> %.2f  control %.2f -> %.2f'
          % tuple((n[(p, a, 'gather_ground_fail')] / n[(p, a, 'gather_ground')]) if n[(p, a, 'gather_ground')] else float('nan')
                  for p, a in (('pre', 'canary'), ('post', 'canary'), ('pre', 'control'), ('post', 'control'))))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('townzoneread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': licence, 'instrument_rows': instr_any,
            'breach_target_ground': z1, 'breach_mine_loop': len(z2), 'breach_gather_loop': len(z3), 'breach_trapped': z4,
            'control_town_rows': leak, 'instrument_control': inst,
            'target_ground_did': nanless(did_t), 'trapped_did': nanless(did_trap),
            'mine_zone_refusals': len(mine_ref), 'gather_zone_refusals': len(gather_ref),
            'exposure_ready': int(licence >= 1 and inst >= 1 and W >= 150),
        })
    except Exception as e:
        print('emit failed:', e)
