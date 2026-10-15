#!/usr/bin/env python3
# minewellread.py [window_min] -- the read for canary `minewell-01` (branch minewell-on-5e66386). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/minewell.mjs + skills.mjs mine): `mine` never digs a cell of a known junk well's (or plinth's)
# shell -- wellBreakCost's box, +-2 around the well column from cap.y-3 to the cap. Before the first dig every bearing's
# stair is simulated; with no clear bearing the bot WALKS to the nearest clear start (within 8, else 16; never within 12
# of home) and plans again; only then a refusal naming `explore`. Every dig of the descent re-reads the shell immediately
# before bot.dig. Rows: _mine_well_guard action=relocate|refuse|stop at=<cap> from=<cell> [to=<cell>].
# WHY: 10-14 21:32-21:36Z hive-d (base build): `mine` from a well's stand dug its wall and floor; the bot collected the
# shaft's items (9 _well_recollected rows). ES 10-08..10-15: _dig_town rows inside a well shell by mine 9 (all hive-d),
# by gather 6 and reflex 4 (board-b), by build_well 4 (the builder's own shaft); 607 mine rows ended within 8 of a cap.
#
#   LICENCE      _mine_well_guard rows (only this build writes them).
#   GATE G1      breach_shell_dug_by_mine: a CANARY _dig_town row whose `by` is mine (purpose target) at a cell inside the
#                shell of a well its pool knows (caps from the pool's own well rows, pre and post: _well_built,
#                _well_dispose, _well_retired, _well_refused, _well_recollected, _mine_well_guard at=). Positive control:
#                the same function on the CONTROL arm (the base digs shells: hive-d 9 in the week to 10-15) -- reported.
#   EXPOSURE     >= 3 canary guard rows that ACTED (relocate or stop) AND >= 1 control mine row ending within 8 of a known
#                cap (the population this guards exists in the window).
#   PRIMARY      mine success share canary vs control, pre vs post (DiD); canary guard rows by action; relocations that
#                ended in a successful mine; canary refusals (forbidden) per mine run. REPORTED.
import sys, os, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

AT = re.compile(r'(?:^| )at=(-?\d+),(-?\d+),(-?\d+)')
POS = re.compile(r'(?:^| )pos=(-?\d+),(-?\d+),(-?\d+)')
BY = re.compile(r'(?:^| )by=(\S+)')
CAP_KINDS = ('_well_built', '_well_dispose', '_well_retired', '_well_refused', '_well_recollected', '_mine_well_guard', '_well_pit_dug')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def cap_of(detail):
    m = AT.search(detail or '')
    return tuple(int(v) for v in m.groups()) if m else None


def in_shell(cell, cap):
    """well.mjs wellBreakCost / minewell.mjs shellOf: +-2 around the column, cap.y-3 .. cap."""
    x, y, z = cell; cx, cy, cz = cap
    return abs(x - cx) <= 2 and abs(z - cz) <= 2 and cy - 3 <= y <= cy


def shell_digs(digs, caps):
    """PURE. digs: [(pool, bot, detail)] _dig_town rows; caps: {pool: {cap}} -> [(bot, cell, cap, by)] digs by `mine` inside
    a shell of a well its pool knows."""
    out = []
    for pool, bot, d in digs:
        m = POS.search(d or ''); by = BY.search(d or '')
        if not m or not by or not by.group(1).startswith('mine'):
            continue
        cell = tuple(int(v) for v in m.groups())
        for cap in caps.get(pool, ()):
            if in_shell(cell, cap):
                out.append((bot, cell, cap, by.group(1))); break
    return out


# ---- positive controls on the bots' own row strings (digtown.mjs and skills.mjs as they write them) ----------------------
_HD = [('hive-d', 'hive-d-Echo', 'pos=79,57,77 block=sandstone class=ground purpose=target by=mine:y55 outcome=confirmed dt=19'),
       ('hive-d', 'hive-d-Echo', 'pos=79,56,77 block=sandstone class=ground purpose=target by=mine:y55 outcome=confirmed dt=22'),
       ('hive-d', 'hive-d-Delta', 'pos=79,57,76 block=sandstone class=ground purpose=other by=build_well outcome=confirmed dt=38'),
       ('hive-d', 'hive-d-Echo', 'pos=79,57,79 block=sandstone class=ground purpose=target by=mine:y56 outcome=confirmed dt=43')]
_CAPS = {'hive-d': {cap_of('at=79,57,76 facing=south floor=1')}}
assert [c for _, c, _, _ in shell_digs(_HD, _CAPS)] == [(79, 57, 77), (79, 56, 77)], 'the hive-d digs: the wall at g and g-1, not the builder, not 3 out'
assert shell_digs(_HD, {'hive-c': _CAPS['hive-d']}) == [], 'another pool\'s well is not this pool\'s'
assert cap_of('action=relocate at=200,63,200 from=200,64,201 to=203,64,201 try=1') == (200, 63, 200)
assert in_shell((198, 60, 202), (200, 63, 200)) and not in_shell((197, 63, 200), (200, 63, 200)) and not in_shell((200, 59, 200), (200, 63, 200))

if __name__ == '__main__':
    import json
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

    def load_window(since, until):
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
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    caps = defaultdict(set); digs = {'canary': [], 'control': []}; offbuild = 0
    guard = Counter(); mines = Counter(); bots = defaultdict(set); licence = 0; near_ctl = 0; mine_end = []
    for r in rows:
        b = (r.get('bot') or {}).get('name'); t = r.get('t'); k = r.get('name') or ''; d = r.get('detail') or ''
        if not b or t is None:
            continue
        p = pool_of(b); arm = 'canary' if p in CANS else 'control'; period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b)
        if k in CAP_KINDS:
            c = cap_of(d)
            if c:
                caps[p].add(c)
        if period != 'post':
            if k == 'mine':
                st = ((r.get('raw') or {}).get('skill') or {}).get('status')
                mines[('pre', arm, 'runs')] += 1; mines[('pre', arm, 'success')] += st == 'success'
            continue
        if k == '_dig_town':
            digs[arm].append((p, b, d))
        elif k == '_mine_well_guard' and arm == 'canary':
            licence += 1
            a = re.search(r'action=(\w+)', d)
            guard[a.group(1) if a else '?'] += 1
        elif k == 'mine':
            st = ((r.get('raw') or {}).get('skill') or {}).get('status')
            mines[('post', arm, 'runs')] += 1; mines[('post', arm, 'success')] += st == 'success'
            mines[('post', arm, 'forbidden')] += ((r.get('raw') or {}).get('skill') or {}).get('fail_class') == 'forbidden' or 'junk well' in d
            pos = ((r.get('raw') or {}).get('bot') or {}).get('pos') or {}
            if arm == 'control' and isinstance(pos, dict) and 'x' in pos:
                mine_end.append((p, pos))
    for p, pos in mine_end:
        if any(max(abs(pos['x'] - (c[0] + .5)), abs(pos['z'] - (c[2] + .5))) <= 8 and abs(pos['y'] - (c[1] + 1)) <= 6 for c in caps.get(p, ())):
            near_ctl += 1
    g1 = shell_digs(digs['canary'], caps); g1c = shell_digs(digs['control'], caps)
    share = lambda per, arm: (mines[(per, arm, 'success')] / mines[(per, arm, 'runs')]) if mines[(per, arm, 'runs')] else float('nan')
    did = (share('post', 'canary') - share('pre', 'canary')) - (share('post', 'control') - share('pre', 'control'))
    acted = guard['relocate'] + guard['stop']
    print('rows walked %d | canary %s sha %s cutoff %s window +%d min | bots post canary %d control %d | offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), offbuild))
    print('LICENCE      canary _mine_well_guard rows %d %s' % (licence, dict(guard)))
    print('G1 (gate)    canary mine digs inside a known well shell: %d %s' % (len(g1), g1[:3]))
    print('INSTRUMENT   control: mine digs inside a shell %d %s | control mine runs ending within 8 of a known cap %d | caps known %s'
          % (len(g1c), g1c[:2], near_ctl, {p: len(c) for p, c in caps.items()}))
    print('PRIMARY      mine success share canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | canary mine runs %d, refused (forbidden/well) %d'
          % (share('pre', 'canary'), share('post', 'canary'), share('pre', 'control'), share('post', 'control'), did, mines[('post', 'canary', 'runs')], mines[('post', 'canary', 'forbidden')]))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nan = lambda v: None if v != v else round(v, 4)
        emit('minewellread', W, {
            'licence_rows': licence, 'guard_relocate': guard['relocate'], 'guard_refuse': guard['refuse'], 'guard_stop': guard['stop'],
            'breach_shell_dug_by_mine': len(g1), 'control_shell_dug_by_mine': len(g1c), 'instrument_control_near_well': near_ctl,
            'mine_success_did': nan(did), 'mine_runs_canary': mines[('post', 'canary', 'runs')], 'mine_refused_canary': mines[('post', 'canary', 'forbidden')],
            'exposure_ready': int(acted >= 3 and near_ctl >= 1),
        })
    except Exception as e:
        print('emit failed:', e)
