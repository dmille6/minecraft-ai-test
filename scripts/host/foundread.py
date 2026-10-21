#!/usr/bin/env python3
# foundread.py [window_min] [--selftest] -- the read for canary `found-01` (a town's first chest, workshop table and furnace go
# into their plots; crafted when the bot has none). Stacked on townplan-01: its plan files and audits are this read's oracle.
# Build spec docs/reports/townplan-found-spec-2026-10-21.md section 2.4 (both engines APPROVE r7). CANARY_DRYRUN=pool[,pool]:sha:iso
# for dry runs (never emits). Judges the CANARY ARM; DiD against control for the no-harm lines; DENOMINATORS FIRST.
# Needs townplanread.py beside it (the plan-file port is shared, never copied).
#
# THE CHANGE (what only this build writes):
#   _found_mode       once per spawn: the licence
#   _found            every run, every exit: order kind step outcome at source gen role group lease spare ms why
#   _found_recovery   the full-town recovery's chest redirected into the next free store cell (cell=section)
#
# GATES (deterministic; each has a failing fixture and a passing control in --selftest)
#   G1 found_lost      a found placement (`_found outcome=placed at=`, or the greenfield recovery's `_found_recovery outcome=placed`)
#                      later read gone: a `gone` transition on its cell in an
#                      accepted plan generation, or a later `_townplan_audit` naming it missing:/other
#   G2 off_plan        a found placement whose cell is not a cell of the plan generation recorded in its row
#   G3 lid_unreach     a later audit naming a found container lid: or unreachable: -- the REVERT stands whatever caused it
#                      (Codex r5 P2); the read also names a SOFT/BOX adopter placement in the same plot box before it (that
#                      placement broke ACCESS: its own defect), and calls an unrelated one unrelated
#   G4 shared_side     two found chests sharing a side (a double chest the plan never asked for)
#   G5 zone            a found placement inside a protected zone or the plan's seed avoid box
#   ARMS               control `_found*` rows after the deploy (must be 0). found_store/found_work are chatOnly: a player chatting
#                      one to a CONTROL bot would write `_found outcome=off` -- read that row before calling it a leak
#   LIVENESS           canary `_found_mode` rows >= 1 and canary `_found` rows >= 1
#   EXPOSURE           canary found placements >= 1 (F1 / F3b fire on the bench: bench bots carry tables and furnaces, read as
#                      real exposure). Store placements are reported apart: rare on the bench (design section 9 row 4), so an
#                      INCONCLUSIVE on them is expected and the FOUND Paper scenes are their gate
#   NO HARM (WATCH, DiD of success shares; fails only below its tolerance with z < -2; UNEXPOSED under MIN_CELL)
#     craft_ok, rung_ok (wooden/stone/iron pickaxe crafts), deposit_ok, town_deposit_ok; deaths: the default gate
# REPORTED: outcomes by order and kind, why for every refusal, the spare crafts, the lease losses, recovery redirects.
import sys, os, json, re, glob
import datetime as dt
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from townplanread import (kv, pool_of, walk, plan_cells, read_plans, zones_of, in_box, did_z, ck, MIN_CELL)  # noqa: E402

TOL = -0.20
RUNGS = ('wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe')
ROW_KINDS = ('_found_mode', '_found', '_found_recovery', '_townplan_audit', '_deposit_new_chest', '_townplan_adopt',
             'craft', 'deposit', '_town_deposit', 'town_deposit')
NAME_RE = re.compile(r'^(missing:[a-z_]+@|lid:|unreachable:|[a-z_]+@)(-?\d+,-?\d+,-?\d+)$')


def xyz_of(s):
    try:
        a = [int(v) for v in str(s).split(',')]
        return a if len(a) == 3 else None
    except ValueError:
        return None


def audit_names(detail):
    """`first=a;b;c` -> [(class, 'x,y,z')] with class missing | other | lid | unreachable. A detail cut at 300 characters may
    end inside a name (`...@9,64,-23` cut to `...@9,64,-2` would name ANOTHER cell): the last name of a cut detail is dropped."""
    m = re.search(r'(?:^| )first=(\S+)', detail or '')
    names = m.group(1).split(';') if m else []
    if len(detail or '') >= 300 and names:
        names = names[:-1]
    out = []
    for n in names:
        q = NAME_RE.match(n)
        if not q:
            continue
        p = q.group(1)
        cls = 'missing' if p.startswith('missing:') else 'lid' if p == 'lid:' else 'unreachable' if p == 'unreachable:' else 'other'
        out.append((cls, q.group(2)))
    return out


def plot_box_of(plan, at):
    for p in plan.get('plots') or []:
        for c in list(p.get('cells') or []) + list(p.get('stations') or []):
            if c.get('at') == at:
                return p.get('box')
    return None


def judge(rows, plans_by_pool, zones_by_pool):
    """rows: [{t, per, arm, name, status, detail, bot, item}] sorted or not; plans_by_pool: {pool: (accepted [(gen, plan)])}."""
    out = Counter()
    lists = defaultdict(list)
    rows = sorted(rows, key=lambda r: r['t'])
    found = []          # (t, pool, at, kind, gen, bot)
    adopters = []       # (t, pool, at, tier, name)
    for r in rows:
        f = kv(r['detail'])
        arm, per, name, pool = r['arm'], r['per'], r['name'], pool_of(r['bot'])
        if name in ('_found_mode', '_found', '_found_recovery') and arm == 'control' and per == 'post':
            out['arms_rows_control_post'] += 1
        if arm == 'canary' and per == 'post':
            if name == '_found_mode':
                out['licence_canary'] += 1
            if name == '_found':
                out['rows_found_canary'] += 1
                out['outcome_%s_%s_%s' % (f.get('order', '?'), f.get('kind', '?'), f.get('outcome', '?'))] += 1
                if f.get('outcome') not in ('placed', None):
                    lists['why'].append('%s %s:%s' % (f.get('outcome'), f.get('step', '-'), (f.get('why') or '-')[:50]))
                if f.get('spare') not in (None, '-', '0'):
                    out['spare_crafts'] += 1
                if f.get('outcome') in ('lost_lease', 'lost_reservation'):
                    out['lost_%s' % f['outcome'][5:]] += 1
                at = xyz_of(f.get('at'))
                if f.get('outcome') == 'placed' and at:
                    found.append((r['t'], pool, at, f.get('kind', '?'), f.get('gen'), r['bot']))
            if name == '_found_recovery':
                out['recovery_%s' % f.get('cell', '?')] += 1
                # the greenfield recovery's chest in a plan cell IS a found placement: judged by every gate (Claude/Codex
                # code r2 P2: townplanread's D3 hands it here)
                at = xyz_of(f.get('at'))
                if f.get('outcome') == 'placed' and at:
                    found.append((r['t'], pool, at, 'chest', f.get('gen'), r['bot']))
                    out['recovery_placed'] += 1
            if name in ('_deposit_new_chest', '_townplan_adopt') and f.get('tier') in ('soft', 'box'):
                a = xyz_of(f.get('at'))
                if a:
                    adopters.append((r['t'], pool, a, f['tier'], name))
        if name == 'craft':
            out['craft_%s_%s' % (per, arm)] += 1
            ok = r['status'] == 'success'
            out['craft_ok_%s_%s' % (per, arm)] += int(ok)
            if r.get('item') in RUNGS:
                out['rung_%s_%s' % (per, arm)] += 1
                out['rung_ok_%s_%s' % (per, arm)] += int(ok)
        if name == 'deposit':
            out['dep_%s_%s' % (per, arm)] += 1
            out['dep_ok_%s_%s' % (per, arm)] += int(r['status'] == 'success')
        if name in ('_town_deposit', 'town_deposit'):
            out['td_%s_%s' % (per, arm)] += 1
            out['td_ok_%s_%s' % (per, arm)] += int(r['status'] == 'success')
    out['found_placed'] = len(found)
    out['found_store_placed'] = sum(1 for x in found if x[3] == 'chest')
    out['found_work_placed'] = len(found) - out['found_store_placed']
    fset = {(pool, ck(at)): (t, kind, bot) for t, pool, at, kind, _, bot in found}
    # G2 off plan, G5 zone
    for t, pool, at, kind, gen, bot in found:
        acc = dict(plans_by_pool.get(pool) or [])
        try:
            plan = acc.get(int(gen))
        except (TypeError, ValueError):
            plan = None
        if plan is None:
            out['found_gen_unknown'] += 1
        elif ck(at) not in plan_cells(plan):
            out['off_plan'] += 1; lists['off_plan'].append('%s %s g%s' % (bot, ck(at), gen))
        zs = list(zones_by_pool.get(pool) or [])
        if plan is not None:
            zs += [a['box'] for a in ((plan.get('seed') or {}).get('avoid') or []) if isinstance(a, dict) and isinstance(a.get('box'), list)]
        if any(in_box(b, at) for b in zs):
            out['zone'] += 1; lists['zone'].append('%s %s' % (bot, ck(at)))
    # G1 lost via the plan files: a `gone` transition on a found cell in a generation after the placement
    for pool, acc in plans_by_pool.items():
        for gen, plan in acc:
            for tr in plan.get('transitions') or []:
                k = (pool, ck(tr.get('at') or [0, 0, 0]))
                if tr.get('why') == 'gone' and k in fset and plan.get('at', 0) >= int(fset[k][0].timestamp() * 1000):
                    out['found_lost'] += 1; lists['lost'].append('%s %s gone in g%d' % (pool, k[1], gen))
    # G1 / G3 via the audits after the placement
    seen = set()
    for r in rows:
        if r['name'] != '_townplan_audit' or r['arm'] != 'canary' or r['per'] != 'post':
            continue
        pool = pool_of(r['bot'])
        for cls, at in audit_names(r['detail']):
            k = (pool, at)
            if k not in fset or r['t'] < fset[k][0] or (k, cls) in seen:
                continue
            seen.add((k, cls))
            if cls in ('missing', 'other'):
                out['found_lost'] += 1; lists['lost'].append('%s %s %s (audit %s)' % (pool, at, cls, r['bot']))
            else:
                out['lid_unreach'] += 1
                acc = plans_by_pool.get(pool) or []
                box = plot_box_of(acc[-1][1], xyz_of(at)) if acc else None
                blame = [a for a in adopters if a[1] == pool and a[0] <= r['t'] and box and box[0] - 1 <= a[2][0] <= box[2] + 1 and box[1] - 1 <= a[2][2] <= box[3] + 1]
                lists['lid_unreach'].append('%s %s %s; %s' % (pool, at, cls, ('responsible: %s %s %s at %s' % (blame[-1][4], blame[-1][3], blame[-1][0].strftime('%H:%MZ'), ck(blame[-1][2]))) if blame else 'no SOFT/BOX adopter in that box before it (unrelated or the found placement itself)'))
    # G4 two found chests sharing a side
    chests = [(pool, at) for _, pool, at, kind, _, _ in found if kind == 'chest']
    for i in range(len(chests)):
        for j in range(i + 1, len(chests)):
            (p1, a), (p2, b) = chests[i], chests[j]
            if p1 == p2 and a[1] == b[1] and abs(a[0] - b[0]) + abs(a[2] - b[2]) == 1:
                out['shared_side'] += 1; lists['shared_side'].append('%s %s|%s' % (p1, ck(a), ck(b)))
    return out, lists


def combine(out, lists):
    g = lambda k: out.get(k, 0)
    res = {k: v for k, v in out.items()}
    for k in ('found_lost', 'off_plan', 'lid_unreach', 'shared_side', 'zone'):
        res[k] = g(k)
    res['arms_breach'] = g('arms_rows_control_post')
    res['liveness'] = int(g('licence_canary') >= 1 and g('rows_found_canary') >= 1)
    res['exposure_ready'] = int(g('found_placed') >= 1)
    res['store_exposed'] = int(g('found_store_placed') >= 1)
    res['instrument_control'] = int(g('dep_post_control') >= 1 and g('craft_post_control') >= 1)
    for name, key in (('craft_ok', 'craft'), ('rung_ok', 'rung'), ('deposit_ok', 'dep'), ('town_deposit_ok', 'td')):
        cells = [(g('%s_ok_pre_canary' % key), g('%s_pre_canary' % key)), (g('%s_ok_post_canary' % key), g('%s_post_canary' % key)),
                 (g('%s_ok_pre_control' % key), g('%s_pre_control' % key)), (g('%s_ok_post_control' % key), g('%s_post_control' % key))]
        d, z = did_z(cells)
        res['%s_did' % name] = d; res['%s_z' % name] = z
        res[name] = 1 if d is None or z is None or not (d < TOL and z < -2) else 0
    res['_lists'] = dict(lists)
    return res


def verdict_of(res, name):
    if res.get('%s_did' % name) is None or res.get('%s_z' % name) is None:
        return 'UNEXPOSED'
    return 'ok' if res[name] else 'DOWN'


def selftest():
    import hashlib
    t0 = dt.datetime(2026, 10, 22, tzinfo=dt.timezone.utc)
    R = lambda name, detail, arm='canary', per='post', s=0, status='success', bot='board-a-Alpha', item=None: {
        't': t0 + dt.timedelta(seconds=s), 'per': per, 'arm': arm, 'name': name, 'detail': detail, 'status': status, 'bot': bot, 'item': item}
    home = {'x': 0, 'y': 64, 'z': 0}
    def plan(gen, at, cells, transitions=()):
        return {'v': 1, 'template': 'ring@1', 'gen': gen, 'prev': None if gen == 1 else gen - 1, 'prevSha': None, 'home': home, 'mode': 'greenfield',
                'world': 'w', 'at': at, 'plots': [{'id': 'store', 'kind': 'storehouse', 'box': [7, -4, 15, 4], 'cells': cells}], 'groups': {'v': 1}, 'transitions': list(transitions)}
    c1 = {'at': [9, 64, -2], 'kind': 'chest', 'stand': [10, 64, -1], 'state': 'placed', 'role': 'overflow'}
    c2 = {'at': [9, 64, 2], 'kind': 'chest', 'stand': [10, 64, 1], 'state': 'free'}
    g1 = plan(1, 0, [c1, c2])
    plans = {'board-a': [(1, g1)]}
    base = [R('_found_mode', 'phase=mode found=on v=1'), R('_found', 'order=F2 kind=chest step=place outcome=placed at=9,64,-2 gen=1 role=overflow', s=10),
            R('deposit', '', arm='control', bot='hive-b-Alpha'), R('craft', '', arm='control', bot='hive-b-Alpha')]
    # CONTROL: a clean placement: no defect, exposed, live
    res = combine(*judge(base, plans, {}))
    assert res['found_lost'] == res['off_plan'] == res['lid_unreach'] == res['shared_side'] == res['zone'] == res['arms_breach'] == 0, res
    assert res['liveness'] == 1 and res['exposure_ready'] == 1 and res['store_exposed'] == 1 and res['instrument_control'] == 1, res
    # G1 via the audit (and the same audit BEFORE the placement does not count)
    r1 = combine(*judge(base + [R('_townplan_audit', 'gen=1 placed=1 missing=1 first=missing:chest@9,64,-2', s=5),
                                R('_townplan_audit', 'gen=1 placed=1 missing=1 first=missing:chest@9,64,-2', s=700)], plans, {}))
    assert r1['found_lost'] == 1, r1
    # G1 via a gone transition in a later generation
    g2 = plan(2, int((t0 + dt.timedelta(seconds=900)).timestamp() * 1000), [dict(c1, state='free'), c2], [{'at': [9, 64, -2], 'why': 'gone'}])
    assert combine(*judge(base, {'board-a': [(1, g1), (2, g2)]}, {}))['found_lost'] == 1
    # G2 off plan
    r2 = combine(*judge(base + [R('_found', 'order=F3 kind=chest step=place outcome=placed at=20,64,20 gen=1', s=20)], plans, {}))
    assert r2['off_plan'] == 1, r2
    # G3 lid with a responsible SOFT adopter in the same box before it; and without one
    adopt = R('_deposit_new_chest', 'decision=craft at=11,64,-2 tier=soft plan_refused=0 gen=1 placed=1', s=300)
    lid = R('_townplan_audit', 'gen=1 placed=1 lid=1 first=lid:9,64,-2', s=600)
    r3 = combine(*judge(base + [adopt, lid], plans, {}))
    assert r3['lid_unreach'] == 1 and 'responsible: _deposit_new_chest soft' in r3['_lists']['lid_unreach'][0], r3['_lists']
    r3b = combine(*judge(base + [lid], plans, {}))
    assert r3b['lid_unreach'] == 1 and 'no SOFT/BOX adopter' in r3b['_lists']['lid_unreach'][0]
    # G4 shared side
    c3 = {'at': [9, 64, -1], 'kind': 'chest', 'stand': [10, 64, 0], 'state': 'placed'}
    r4 = combine(*judge(base + [R('_found', 'order=F3 kind=chest step=place outcome=placed at=9,64,-1 gen=1', s=30)], {'board-a': [(1, plan(1, 0, [c1, c2, c3]))]}, {}))
    assert r4['shared_side'] == 1 and r4['off_plan'] == 0, r4
    # G5 zone
    assert combine(*judge(base, plans, {'board-a': [[9, -64, -2, 9, 90, -2]]}))['zone'] == 1
    # arms
    assert combine(*judge(base + [R('_found', 'order=F1 outcome=refused', arm='control', bot='hive-b-Alpha')], plans, {}))['arms_breach'] == 1
    # the RECOVERY's section placement is judged too: on its plan cell -> clean; off it -> G2; lost in a later audit -> G1
    rec_ok = R('_found_recovery', 'cell=section at=9,64,2 gen=1 outcome=placed placed_the_chest', s=40)
    rr0 = combine(*judge(base + [rec_ok], plans, {}))
    assert rr0['recovery_placed'] == 1 and rr0['off_plan'] == 0 and rr0['found_placed'] == 2, rr0
    rr1 = combine(*judge(base + [R('_found_recovery', 'cell=section at=30,64,30 gen=1 outcome=placed x', s=40)], plans, {}))
    assert rr1['off_plan'] == 1, rr1
    rr2 = combine(*judge(base + [rec_ok, R('_townplan_audit', 'gen=1 placed=2 missing=1 first=missing:chest@9,64,2', s=900)], plans, {}))
    assert rr2['found_lost'] == 1, rr2
    assert combine(*judge(base + [R('_found_recovery', 'cell=section at=9,64,2 gen=1 outcome=lost_reservation x', s=40)], plans, {})).get('recovery_placed', 0) == 0
    # a CUT audit detail (300 characters) drops its last name: `@9,64,-23` cut to `@9,64,-2` is not the found cell
    tail = ';missing:chest@9,64,-2'
    long_ = ('gen=1 placed=1 missing=1 first=' + ';'.join(['missing:chest@50,64,%d' % (100 + i) for i in range(12)]))[:300 - len(tail)] + tail
    assert len(long_) == 300 and long_.endswith('9,64,-2')
    assert combine(*judge(base + [R('_townplan_audit', long_, s=900)], plans, {}))['found_lost'] == 0, 'a name at the cut is never trusted'
    assert combine(*judge(base + [R('_townplan_audit', 'gen=1 placed=1 missing=1 first=missing:chest@9,64,-2', s=900)], plans, {}))['found_lost'] == 1, 'positive control'
    # G5 over the plan's own seed avoid box (recorded by the writer)
    g1s = plan(1, 0, [c1, c2]); g1s['seed'] = {'why': 'ok', 'avoid': [{'id': 'tc', 'box': [9, -64, -2, 9, 90, -2]}]}
    assert combine(*judge(base, {'board-a': [(1, g1s)]}, {}))['zone'] == 1
    # no-harm: a rung collapse with enough rows -> DOWN; few rows -> UNEXPOSED
    rows = []
    for arm, per, ok, n in (('canary', 'pre', 9, 10), ('canary', 'post', 2, 10), ('control', 'pre', 9, 10), ('control', 'post', 9, 10)):
        for i in range(n):
            rows.append(R('craft', '', arm=arm, per=per, status='success' if i < ok else 'failed', item='stone_pickaxe', bot='board-a-A' if arm == 'canary' else 'hive-b-A'))
    rr = combine(*judge(rows, {}, {}))
    assert rr['rung_ok'] == 0 and verdict_of(rr, 'rung_ok') == 'DOWN', rr
    assert verdict_of(combine(*judge(rows[:5], {}, {})), 'rung_ok') == 'UNEXPOSED'
    assert hashlib  # (the plan files' own sha chain is townplanread's: this read takes its accepted list)
    print('foundread selftest: ok')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
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
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 180)
    END, PRE = CUT + dt.timedelta(minutes=W), CUT - dt.timedelta(minutes=W)

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

    raw = load_window(PRE, END)
    rows, walked, offbuild = [], 0, 0
    bots = defaultdict(set)
    for r in raw:
        b = (r.get('bot') or {}).get('name')
        t = r.get('t')
        if not b or t is None:
            continue
        walked += 1
        arm = 'canary' if pool_of(b) in CANS else 'control'
        per = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and per == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(per, arm)].add(b)
        sk = ((r.get('raw') or {}).get('skill') or {})
        name = sk.get('name') or r.get('name')
        if name in ROW_KINDS:
            item = (sk.get('args') or {}).get('item') if isinstance(sk.get('args'), dict) else None
            rows.append({'t': t, 'per': per, 'arm': arm, 'name': name, 'status': sk.get('status'), 'detail': r.get('detail') or '', 'bot': b, 'item': item})
    plans = read_plans()
    acc_by_pool, zones_by_pool = {}, {}
    for pool, keys in plans.items():
        for key, info in keys.items():
            for wkey, files in info['worlds'].items():
                world = json.loads(wkey) if wkey != '"__unparseable__"' else None
                head, acc, _, _ = walk(files, world)
                if head is not None:
                    acc_by_pool.setdefault(pool, []).extend(acc)
                    zones_by_pool.setdefault(pool, []).extend(zones_of(info['dir'], world))
    out, lists = judge(rows, acc_by_pool, zones_by_pool)
    res = combine(out, lists)
    L = res['_lists']
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f | towns with a plan %d'
          % (walked, offbuild, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0), len(acc_by_pool)))
    print('LIVENESS     licence rows canary %d | _found rows canary %d -> %s' % (out.get('licence_canary', 0), out.get('rows_found_canary', 0), 'ok' if res['liveness'] else 'INERT'))
    print('OUTCOMES     %s' % {k[8:]: v for k, v in sorted(out.items()) if k.startswith('outcome_')})
    print('             refusals (first 6) %s | spare crafts %d | lost lease %d reservation %d | recovery redirects %s'
          % (L.get('why', [])[:6], out.get('spare_crafts', 0), out.get('lost_lease', 0), out.get('lost_reservation', 0), {k[9:]: v for k, v in out.items() if k.startswith('recovery_')}))
    print('ARMS         control _found* rows after the deploy %d (must be 0)' % res['arms_breach'])
    print('DEFECTS      G1 found placements later read gone %d %s | G2 off a plan cell %d of %d (gen unknown %d) %s'
          % (res['found_lost'], L.get('lost', [])[:3], res['off_plan'], out.get('found_placed', 0), out.get('found_gen_unknown', 0), L.get('off_plan', [])[:3]))
    print('             G3 lid-blocked / unreachable found containers %d %s | G4 found chests sharing a side %d %s | G5 in a zone %d %s'
          % (res['lid_unreach'], L.get('lid_unreach', [])[:3], res['shared_side'], L.get('shared_side', [])[:3], res['zone'], L.get('zone', [])[:3]))
    print('NO HARM      craft DiD %s -> %s | pickaxe rungs DiD %s -> %s | deposit DiD %s -> %s | town_deposit DiD %s -> %s | deaths: the default gate'
          % tuple(x for n in ('craft_ok', 'rung_ok', 'deposit_ok', 'town_deposit_ok') for x in ('null' if res['%s_did' % n] is None else '%+.3f' % res['%s_did' % n], verdict_of(res, n))))
    print('             (cells: craft canary %d->%d control %d->%d | rungs canary %d->%d control %d->%d; UNEXPOSED = a cell under %d rows, never ok)'
          % (out.get('craft_pre_canary', 0), out.get('craft_post_canary', 0), out.get('craft_pre_control', 0), out.get('craft_post_control', 0),
             out.get('rung_pre_canary', 0), out.get('rung_post_canary', 0), out.get('rung_pre_control', 0), out.get('rung_post_control', 0), MIN_CELL))
    print('EXPOSURE     found placements canary %d (work %d, store %d) -> %s | store: %s | INSTRUMENT control deposit %d craft %d -> %s'
          % (out.get('found_placed', 0), out.get('found_work_placed', 0), out.get('found_store_placed', 0), 'READY' if res['exposure_ready'] else 'NOT YET',
             'exposed' if res['store_exposed'] else 'UNEXPOSED (expected on the bench; the FOUND Paper scenes are its gate)',
             out.get('dep_post_control', 0), out.get('craft_post_control', 0), 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('foundread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
