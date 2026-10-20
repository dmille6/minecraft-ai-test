#!/usr/bin/env python3
# townindexread.py [window_min] [--selftest] -- the read for canary `townindex-01` (the town index: every open of a town
# container records what the server sent, per name count AND slots; every mutation marks it dirty; every verified move is a
# transfer record; count_town adds the index's unknown containers to its candidates). Design: docs/reports/town-plan-2026-10-20.md
# section 4.2 and section 9 row 1. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM;
# difference-in-differences against control for the no-harm lines; DENOMINATORS FIRST.
#
# Run from ~/mcai-analysis (lib/telemetry.py: the file reads). Reads two sources:
#   ROWS   /var/log/mcai/*/skill-*.jsonl* through lib.telemetry Events (rotation-aware: day D's rows sit in the D+1 .gz)
#   INDEX  /var/lib/mcai/_pool-*/town-index-<hx>_<hy>_<hz>.g<N>.jsonl -- the canary's own journal (no ES fields: an unmapped
#          field rejects whole documents, so the index is a file, and this read reads it). The home is in the file name.
#
# THE CHANGE (what only this build writes):
#   _townindex_mode    once per spawn: the licence (proves the build is live, not the effect)
#   _townindex_count   a count_town run whose candidates included index-unknown containers (the change row; duration = the run)
#   town-index-*.jsonl obs / dirty / xfer records (and a ckpt per rotation)
#
# GATES (deterministic; each has a failing fixture and a passing control in --selftest)
#   D1 outside_town     an index record (obs, dirty, xfer) whose container is OUTSIDE town (16 horizontal / 12 vertical of the
#                       home in the file's name: chestfull.mjs inTown) -- the index is the town's, never another chest
#   D2 malformed_obs    an observation whose slots do not add up (sum of per-name slots != used, used > size, a size that is not
#                       27 or 54, a count or slot count < 1, or a count below its slot count)
#   D3 xfer_unjoined    a VERIFIED transfer (ok=1) whose pre-state (`pre`) or verifying re-open (`ver`) is not an observation of
#                       the same container on disk. When a rotation at or after the transfer (less 120 s) could have folded the
#                       observation away, a missing one is INCONCLUSIVE (xfer_unjudged, reported), never a pass by omission and
#                       never a defect (Codex code r1 P2: a later rotation must not erase an earlier failure, nor fake one)
#   D4 xfer_unseen      a verified transfer whose re-open shows less of the name than the transfer moved (verifyTown credits a
#                       stack only if its slot holds it exactly)
#   ARMS                control index records, `_townindex_mode` or `_townindex_count` after the deploy (must be 0); an earlier
#                       build's index records before it are reported, not counted
#   LIVENESS            canary licence rows >= 1 and canary observations >= 1
#   NO HARM (WATCH lines: DiD of shares; a line fails only when the DiD is below its tolerance AND 2 standard errors below 0;
#   null -- never a verdict -- when a cell has fewer than MIN_CELL rows. Measured on the base 10-20 (4 pools, 3 h): the deposit
#   DiD was -0.089 on 11-49 runs per cell with no change at all, so a bare threshold would trip on noise)
#     count_town_ok   `_stock_recount` success share of the runs with refused > 0 and keys > 0 (canary post-pre minus control
#                     post-pre): fails below -0.25 with z < -2
#     deposit_ok      the deposit verb's success share of success|failed (runner rows `deposit`): fails below -0.20 with z < -2
#     refusals_up         `_stock_refused` + `_cobble_refused` per bot-hour: canary post/pre over control post/pre > 2 with >= 20
#                         canary rows (a WATCH line: the index never feeds the cap or the stock targets; a unit test with a mutant
#                         proves it)
#   EXPOSURE            every canary town >= EXPOSURE_OBS observations in the read window AND pre-window rows on both arms
#   INSTRUMENT          control `_stock_recount` rows >= 1 and control deposit rows >= 1 (the no-harm lines can see)
# REPORTED (primary, not gated): observations per canary bot-hour; containers indexed per canary town and their states at the
#   window's end (known / stale / dirty); transfers by kind (verified / unverified); count_town extras tried and counted.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict

EXPOSURE_OBS = 50
MIN_CELL = 10
COUNT_TOL = -0.25
DEPOSIT_TOL = -0.20
REFUSAL_RATIO = 2.0
REFUSAL_MIN = 20
ROT_GRACE_MS = 120_000
TOWN_H, TOWN_V = 16, 12
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
ROW_KINDS = ('_townindex_mode', '_townindex_count', '_stock_recount', 'deposit', '_stock_refused', '_cobble_refused')
FILE_RE = re.compile(r'town-index-(-?\d+)_(-?\d+)_(-?\d+)\.g(\d+)\.jsonl$')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def pool_of_dir(d):
    """`_pool-board-a` -> board-a; `_pool-self-isolated-a-Alpha` -> isolated-a."""
    name = os.path.basename(d.rstrip('/'))
    return pool_of(name[len('_pool-'):] if name.startswith('_pool-') else name)


def in_town(home, k):
    try:
        x, y, z = (int(v) for v in str(k).split(','))
    except ValueError:
        return False
    return math.hypot(x - home[0], z - home[2]) <= TOWN_H and abs(y - home[1]) <= TOWN_V


def malformed(r):
    """-> a reason string, or None. PURE."""
    names = r.get('names')
    if not isinstance(names, dict):
        return 'no names'
    size, used = r.get('size'), r.get('used')
    if size not in (27, 54):
        return 'size %r' % (size,)
    tot = 0
    for n, v in names.items():
        if not (isinstance(v, list) and len(v) == 2):
            return 'shape %s' % n
        c, s = v
        if not (isinstance(c, int) and isinstance(s, int)) or c < 1 or s < 1 or c < s:
            return 'counts %s=%r' % (n, v)
        tot += s
    if tot != used:
        return 'slots %d != used %r' % (tot, used)
    if used > size:
        return 'used %d > size %d' % (used, size)
    return None


def read_index(root='/var/lib/mcai'):
    """-> { pool: [ { home, rec, gen } ] } every record of every town-index file (all generations on disk)."""
    out = defaultdict(list)
    for d in sorted(glob.glob(os.path.join(root, '_pool-*'))):
        if '.pre-reseed-' in d:
            continue
        for f in sorted(glob.glob(os.path.join(d, 'town-index-*.g*.jsonl'))):
            m = FILE_RE.search(f)
            if not m:
                continue
            home = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
            try:
                with open(f, errors='replace') as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except Exception:
                            continue
                        out[pool_of_dir(d)].append({'home': home, 'rec': rec, 'gen': int(m.group(4)), 'dir': d})
            except OSError:
                continue
    return out


def judge_index(idx, cans, cut_ms, end_ms, pre_ms):
    """PURE over read_index()'s shape. -> the index's gates and reports."""
    out = {'outside_town': 0, 'malformed_obs': 0, 'xfer_unjoined': 0, 'xfer_unjudged': 0, 'xfer_unseen': 0, 'index_control_post': 0, 'index_pre_canary': 0, 'index_pre_control': 0}
    lists = defaultdict(list)
    obs_by_pool = Counter(); xfer_v = Counter(); xfer_u = Counter(); dirty_by_pool = Counter()
    states = {}
    for pool, items in idx.items():
        arm = 'canary' if pool in cans else 'control'
        # the observations by id, per directory (a town), for the joins
        by_id = {}
        ckpts = defaultdict(list)
        for it in items:
            r = it['rec']
            if r.get('t') == 'obs' and r.get('id'):
                by_id[(it['dir'], r['id'])] = r
            if r.get('t') == 'ckpt':
                ckpts[it['dir']].append(int(r.get('at') or 0))
                for wm in (r.get('worlds') or {}).values():
                    for e in (wm or {}).values():
                        o = (e or {}).get('obs')
                        if o and o.get('id'):
                            by_id.setdefault((it['dir'], o['id']), {'t': 'obs', 'k': None, **o})
        latest = {}
        for it in items:
            r = it['rec']; t = r.get('t'); at = r.get('at')
            if t not in ('obs', 'dirty', 'xfer') or not isinstance(at, (int, float)):
                continue
            if at < pre_ms or at >= end_ms:
                continue
            post = at >= cut_ms
            if not post:
                out['index_pre_' + arm] += 1
                continue
            if arm == 'control':
                out['index_control_post'] += 1
                lists['control'].append((pool, t, r.get('k'), r.get('bot')))
                continue
            if not in_town(it['home'], r.get('k')):
                out['outside_town'] += 1
                lists['outside'].append((pool, t, r.get('k'), r.get('by')))
            if t == 'obs':
                obs_by_pool[pool] += 1
                why = malformed(r)
                if why:
                    out['malformed_obs'] += 1
                    lists['malformed'].append((pool, r.get('k'), why))
                key = (it['dir'], r.get('k'))
                if key not in latest or (at, 0) > latest[key]:
                    latest[key] = (at, 0)
            elif t == 'dirty':
                dirty_by_pool[pool] += 1
                key = (it['dir'], r.get('k'))
                if key not in latest or (at, 1) >= latest[key]:
                    latest[key] = (at, 1)
            elif t == 'xfer':
                if r.get('ok') == 1:
                    xfer_v[pool] += 1
                    pre = by_id.get((it['dir'], r.get('pre'))); ver = by_id.get((it['dir'], r.get('ver')))
                    same = lambda o: o is not None and (o.get('k') in (None, r.get('k')))
                    wrong = lambda o: o is not None and o.get('k') not in (None, r.get('k'))
                    if same(pre) and same(ver):
                        held = ((ver.get('names') or {}).get(r.get('name')) or [0, 0])[0]
                        if held < (r.get('n') or 0):
                            out['xfer_unseen'] += 1
                            lists['unseen'].append((pool, r.get('k'), r.get('name'), r.get('n'), held))
                    elif not wrong(pre) and not wrong(ver) and any(c >= at - ROT_GRACE_MS for c in ckpts[it['dir']]):
                        out['xfer_unjudged'] += 1          # a rotation may have folded the observation away: no evidence either way
                    else:
                        out['xfer_unjoined'] += 1
                        lists['unjoined'].append((pool, r.get('k'), r.get('op'), bool(pre), bool(ver)))
                else:
                    xfer_u[pool] += 1
        if arm == 'canary':
            st = Counter()
            for key, (at, dirty) in latest.items():
                st['dirty' if dirty else ('stale' if end_ms - at >= 6 * 3600_000 else 'known')] += 1
            states[pool] = dict(st)
    out['obs_by_pool'] = dict(obs_by_pool)
    out['dirty_by_pool'] = dict(dirty_by_pool)
    out['xfer_verified'] = sum(xfer_v.values()); out['xfer_unverified'] = sum(xfer_u.values())
    out['states_by_pool'] = states
    out['obs_canary'] = sum(obs_by_pool.values())
    out['min_obs_canary_town'] = min((obs_by_pool.get(p, 0) for p in cans), default=0)
    out['_lists'] = {k: v[:5] for k, v in lists.items()}
    return out


def share(n, d):
    return n / d if d >= MIN_CELL else None


def did(a, b, c, d):
    return None if None in (a, b, c, d) else (b - a) - (d - c)


def did_z(cells):
    """cells: [(ok, n)] for pre canary, post canary, pre control, post control -> the DiD over its standard error, or None. PURE."""
    if any(n < MIN_CELL for _, n in cells):
        return None
    p = [k / n for k, n in cells]
    se = math.sqrt(sum(q * (1 - q) / n for q, (_, n) in zip(p, cells)))
    d = (p[1] - p[0]) - (p[3] - p[2])
    return d / se if se > 0 else (0.0 if d == 0 else math.copysign(float('inf'), d))


def judge_rows(rows, cut):
    """PURE over rows {t, per, arm, name, status, detail, bot}."""
    out = {}
    c = Counter()
    for r in rows:
        k = (r['per'], r['arm'])
        n = r['name']
        if n == '_stock_recount':
            f = kv(r['detail'])
            try:
                keys, refused = int(f.get('keys', '0')), int(f.get('refused', '0'))
            except ValueError:
                keys, refused = 0, 0
            if f.get('trigger') == 'order' and keys > 0 and refused > 0:   # a run that had something to count
                c[k + ('ct_runs',)] += 1
                if r['status'] == 'success':
                    c[k + ('ct_ok',)] += 1
            c[k + ('ct_rows',)] += 1
        elif n == 'deposit' and r['status'] in ('success', 'failed'):
            c[k + ('dep',)] += 1
            if r['status'] == 'success':
                c[k + ('dep_ok',)] += 1
        elif n in ('_stock_refused', '_cobble_refused'):
            c[k + ('ref',)] += 1
        elif n == '_townindex_mode':
            c[k + ('lic',)] += 1
        elif n == '_townindex_count':
            c[k + ('chg',)] += 1
            f = kv(r['detail'])
            for fld in ('extra', 'counted', 'tried'):
                try:
                    c[k + ('chg_' + fld,)] += int(f.get(fld, '0'))
                except ValueError:
                    pass
    g = lambda per, arm, f: c[(per, arm, f)]
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sfx = '%s_%s' % (per, arm)
            for f in ('ct_runs', 'ct_ok', 'ct_rows', 'dep', 'dep_ok', 'ref', 'lic', 'chg', 'chg_extra', 'chg_counted', 'chg_tried'):
                out['%s_%s' % (f, sfx)] = g(per, arm, f)
    sh = lambda f, d, per, arm: share(g(per, arm, f), g(per, arm, d))
    out['count_town_ok_did'] = did(sh('ct_ok', 'ct_runs', 'pre', 'canary'), sh('ct_ok', 'ct_runs', 'post', 'canary'), sh('ct_ok', 'ct_runs', 'pre', 'control'), sh('ct_ok', 'ct_runs', 'post', 'control'))
    out['deposit_ok_did'] = did(sh('dep_ok', 'dep', 'pre', 'canary'), sh('dep_ok', 'dep', 'post', 'canary'), sh('dep_ok', 'dep', 'pre', 'control'), sh('dep_ok', 'dep', 'post', 'control'))
    cells = lambda ok, n: [(g(per, arm, ok), g(per, arm, n)) for arm in ('canary', 'control') for per in ('pre', 'post')]
    out['count_town_ok_z'] = did_z(cells('ct_ok', 'ct_runs'))
    out['deposit_ok_z'] = did_z(cells('dep_ok', 'dep'))
    out['licence_canary'] = g('post', 'canary', 'lic')
    out['change_rows_canary'] = g('post', 'canary', 'chg')
    out['rows_control_post'] = g('post', 'control', 'lic') + g('post', 'control', 'chg')
    out['rows_pre_earlier_build'] = g('pre', 'canary', 'lic') + g('pre', 'canary', 'chg') + g('pre', 'control', 'lic') + g('pre', 'control', 'chg')
    out['instrument_control'] = int(g('post', 'control', 'ct_rows') >= 1 and g('post', 'control', 'dep') >= 1)
    out['pre_ok'] = int(sum(g('pre', 'canary', f) for f in ('ct_rows', 'dep', 'ref')) >= 1 and sum(g('pre', 'control', f) for f in ('ct_rows', 'dep', 'ref')) >= 1)
    return out


def refusals_up(res, hrs):
    """1 when canary refusals per bot-hour rose more than REFUSAL_RATIO x control's change (>= REFUSAL_MIN canary rows). PURE."""
    rate = lambda per, arm: res['ref_%s_%s' % (per, arm)] / hrs[(per, arm)] if hrs.get((per, arm)) else None
    a, b, c, d = rate('pre', 'canary'), rate('post', 'canary'), rate('pre', 'control'), rate('post', 'control')
    if None in (a, b, c, d) or res['ref_post_canary'] < REFUSAL_MIN:
        return 0
    can = b / a if a > 0 else (float('inf') if b > 0 else 1.0)
    ctl = d / c if c > 0 else (float('inf') if d > 0 else 1.0)
    return int(can > REFUSAL_RATIO * max(ctl, 1e-9))


def combine(ix, rw):
    res = dict(rw)
    res.update({k: v for k, v in ix.items()})
    res['liveness'] = int(res['licence_canary'] >= 1 and res['obs_canary'] >= 1)
    res['arms_breach'] = res['index_control_post'] + res['rows_control_post']
    down = lambda d, z, tol: d is not None and z is not None and d < tol and z < -2
    res['count_town_ok'] = 0 if down(res['count_town_ok_did'], res['count_town_ok_z'], COUNT_TOL) else 1
    res['deposit_ok'] = 0 if down(res['deposit_ok_did'], res['deposit_ok_z'], DEPOSIT_TOL) else 1
    res['exposure_ready'] = int(res['min_obs_canary_town'] >= EXPOSURE_OBS and res['pre_ok'] == 1)
    return res


def selftest():
    T0 = 1_800_000_000_000
    H = (0, 64, 0)
    CANS = {'board-a'}
    good = lambda k='3,64,0', at=T0 + 1000, i='o1', names=None: {'t': 'obs', 'id': i, 'k': k, 'at': at, 'size': 27, 'used': 2, 'names': names or {'iron_ingot': [12, 1], 'coal': [5, 1]}, 'by': 'deposit'}
    I = lambda pool, recs, d='/v/_pool-board-a': {pool: [{'home': H, 'rec': r, 'gen': 1, 'dir': d} for r in recs]}
    run = lambda idx: judge_index(idx, CANS, T0, T0 + 3600_000, T0 - 3600_000)
    ok = run(I('board-a', [good(), {'t': 'dirty', 'id': 'd1', 'k': '3,64,0', 'at': T0 + 2000},
                            good(i='o2', at=T0 + 3000, names={'iron_ingot': [12, 1], 'coal': [5, 1], 'stick': [4, 1]}) | {'used': 3},
                            {'t': 'xfer', 'ok': 1, 'pre': 'o1', 'ver': 'o2', 'k': '3,64,0', 'name': 'stick', 'n': 4, 'at': T0 + 3001, 'op': 'x'},
                            {'t': 'xfer', 'ok': 0, 'pre': 'o1', 'ver': None, 'k': '3,64,0', 'name': 'dirt', 'n': 9, 'at': T0 + 3002}]))
    assert ok['outside_town'] == 0 and ok['malformed_obs'] == 0 and ok['xfer_unjoined'] == 0 and ok['xfer_unseen'] == 0 and ok['index_control_post'] == 0, ok
    assert ok['obs_by_pool'] == {'board-a': 2} and ok['xfer_verified'] == 1 and ok['xfer_unverified'] == 1 and ok['states_by_pool'] == {'board-a': {'known': 1}}, ok
    # D1: a chest 30 from home
    assert run(I('board-a', [good(k='30,64,0')]))['outside_town'] == 1, 'D1'
    assert run(I('board-a', [good(k='16,64,0'), good(k='0,76,0', i='o9')]))['outside_town'] == 0, 'D1 control: the edges are town'
    assert run(I('board-a', [good(k='0,77,0')]))['outside_town'] == 1, 'D1: 13 above'
    # D2: every malformation
    for bad in ({'used': 3}, {'size': 36}, {'names': {'coal': [0, 1]}, 'used': 1}, {'names': {'coal': [2, 3]}, 'used': 3}, {'names': {'coal': [5]}, 'used': 1}, {'names': None}):
        assert run(I('board-a', [good() | bad]))['malformed_obs'] == 1, ('D2', bad)
    assert malformed(good() | {'size': 54, 'used': 2}) is None, 'D2 control: a double chest'
    # D3: a verified transfer whose pre or ver is missing (or another container's)
    x = lambda **kw: {'t': 'xfer', 'ok': 1, 'pre': 'o1', 'ver': 'o2', 'k': '3,64,0', 'name': 'coal', 'n': 5, 'at': T0 + 5000} | kw
    assert run(I('board-a', [good(), x()]))['xfer_unjoined'] == 1, 'D3: no ver'
    assert run(I('board-a', [good(), good(i='o2', k='4,64,0'), x()]))['xfer_unjoined'] == 1, "D3: another container's re-open"
    assert run(I('board-a', [good(), good(i='o2'), x()]))['xfer_unjoined'] == 0, 'D3 control'
    assert run(I('board-a', [good(), x(ok=0)]))['xfer_unjoined'] == 0, 'D3: unverified transfers are not joined'
    ck = {'t': 'ckpt', 'at': T0 + 4950, 'worlds': {}}
    j = run(I('board-a', [ck, good(), x()]))
    assert j['xfer_unjoined'] == 0 and j['xfer_unjudged'] == 1, ('D3: a rotation after it -> inconclusive, reported', j)
    late = run(I('board-a', [{'t': 'ckpt', 'at': T0 + 900_000, 'worlds': {}}, good(), x()]))
    assert late['xfer_unjoined'] == 0 and late['xfer_unjudged'] == 1, 'D3: a LATER rotation makes a missing join inconclusive, never a pass'
    early = run(I('board-a', [{'t': 'ckpt', 'at': T0 - 900_000, 'worlds': {}}, good(), x()]))
    assert early['xfer_unjoined'] == 1, 'D3: a rotation long BEFORE the transfer cannot excuse it'
    assert run(I('board-a', [ck, good(), good(i='o2', k='4,64,0'), x()]))['xfer_unjoined'] == 1, "D3: another container's re-open is a defect whatever the rotations"
    ck2 = {'t': 'ckpt', 'at': T0 + 4000, 'worlds': {'null': {'3,64,0': {'obs': {'id': 'o2', 'at': T0 + 3999, 'names': {'coal': [5, 1]}, 'size': 27, 'used': 1}}}}}
    assert run(I('board-a', [ck2, good(), x(at=T0 + 200_000)]))['xfer_unjoined'] == 0, 'D3: a checkpoint observation joins'
    # D4: the re-open shows less than moved
    assert run(I('board-a', [good(), good(i='o2', names={'coal': [3, 1]}) | {'used': 1}, x()]))['xfer_unseen'] == 1, 'D4'
    assert run(I('board-a', [good(), good(i='o2', names={'coal': [5, 1]}) | {'used': 1}, x()]))['xfer_unseen'] == 0, 'D4 control'
    # ARMS: control records after the deploy; before it, reported only
    cr = run(I('hive-a', [good()], d='/v/_pool-hive-a'))
    assert cr['index_control_post'] == 1 and cr['obs_canary'] == 0, cr
    assert run(I('hive-a', [good(at=T0 - 10)], d='/v/_pool-hive-a'))['index_control_post'] == 0
    pre = run(I('board-a', [good(at=T0 - 10)]))
    assert pre['index_pre_canary'] == 1 and pre['obs_canary'] == 0, pre
    # states: dirty last; stale
    st = run(I('board-a', [good(), {'t': 'dirty', 'id': 'd', 'k': '3,64,0', 'at': T0 + 1000}]))
    assert st['states_by_pool'] == {'board-a': {'dirty': 1}}, 'a tie goes to dirty'
    # exposure: every canary town needs EXPOSURE_OBS
    many = I('board-a', [good(i='o%d' % i, at=T0 + i) for i in range(EXPOSURE_OBS)])
    assert run(many)['min_obs_canary_town'] == EXPOSURE_OBS
    two = judge_index({**many, 'hive-b': [{'home': H, 'rec': good(), 'gen': 1, 'dir': '/v/_pool-hive-b'}]}, CANS | {'hive-b'}, T0, T0 + 3600_000, T0 - 3600_000)
    assert two['min_obs_canary_town'] == 1, 'the quietest canary town decides'
    assert pool_of_dir('/var/lib/mcai/_pool-self-isolated-a-Alpha') == 'isolated-a' and pool_of_dir('/var/lib/mcai/_pool-board-a') == 'board-a'
    # ROWS
    R = lambda name, detail='', status='success', per='post', arm='canary', bot='board-a-Alpha': {'per': per, 'arm': arm, 'name': name, 'status': status, 'detail': detail, 'bot': bot}
    REC = 'trigger=order refused=2 keys=2 counted=1 tried=2 unknown_after=0 fails=- names=cobblestone:cobble_unknown'
    REC0 = 'trigger=order refused=0 keys=3 counted=0 tried=0 nothing held is refused as not yet counted'
    base = []
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            base += [R('_stock_recount', REC, per=per, arm=arm)] * MIN_CELL + [R('deposit', per=per, arm=arm)] * MIN_CELL
    rw = judge_rows(base + [R('_townindex_mode', 'phase=mode index=on'), R('_townindex_count', 'keys=1 extra=3 counted=2 tried=2 unknown_left=1')], None)
    assert rw['count_town_ok_did'] == 0 and rw['deposit_ok_did'] == 0 and rw['licence_canary'] == 1 and rw['change_rows_canary'] == 1 and rw['rows_control_post'] == 0, rw
    assert rw['chg_extra_post_canary'] == 3 and rw['chg_counted_post_canary'] == 2 and rw['instrument_control'] == 1 and rw['pre_ok'] == 1, rw
    down = judge_rows(base + [R('_stock_recount', REC, status='no_effect')] * (3 * MIN_CELL), None)
    assert down['count_town_ok_did'] < COUNT_TOL, ('count_town down', down['count_town_ok_did'])
    assert judge_rows(base + [R('_stock_recount', REC0, status='no_effect')] * (3 * MIN_CELL), None)['count_town_ok_did'] == 0, 'a run with nothing refused is not a count attempt'
    ddown = judge_rows(base + [R('deposit', status='failed')] * (2 * MIN_CELL), None)
    assert ddown['deposit_ok_did'] < DEPOSIT_TOL
    assert judge_rows(base + [R('deposit', status='no_effect')] * (2 * MIN_CELL), None)['deposit_ok_did'] == 0, 'no_effect is not a failure'
    small = judge_rows([R('_stock_recount', REC)] * 3, None)
    assert small['count_town_ok_did'] is None, 'a thin cell is null, never a verdict'
    assert judge_rows([R('_townindex_mode', arm='control')], None)['rows_control_post'] == 1, 'ARMS rows'
    assert judge_rows([R('deposit', arm='control')], None)['instrument_control'] == 0, 'blind without control recounts'
    # refusals_up
    rr = judge_rows(base + [R('_stock_refused', per='pre')] * 10 + [R('_stock_refused')] * 40 + [R('_stock_refused', per='pre', arm='control')] * 10 + [R('_stock_refused', arm='control')] * 10, None)
    hrs = {(p, a): 10.0 for p in ('pre', 'post') for a in ('canary', 'control')}
    assert refusals_up(rr, hrs) == 1, 'canary x4 vs control x1'
    rr2 = judge_rows(base + [R('_stock_refused', per='pre')] * 10 + [R('_stock_refused')] * 25 + [R('_stock_refused', per='pre', arm='control')] * 10 + [R('_stock_refused', arm='control')] * 20, None)
    assert refusals_up(rr2, hrs) == 0, 'x2.5 vs x2: within the band'
    rr3 = judge_rows(base + [R('_stock_refused', per='pre')] * 2 + [R('_stock_refused')] * 10, None)
    assert refusals_up(rr3, hrs) == 0, 'under REFUSAL_MIN canary rows'
    # the combined lines
    cb = combine(ok, rw)
    assert cb['liveness'] == 1 and cb['arms_breach'] == 0 and cb['count_town_ok'] == 1 and cb['deposit_ok'] == 1 and cb['exposure_ready'] == 0, cb
    cb2 = combine(run(many), rw)
    assert cb2['exposure_ready'] == 1, cb2
    assert combine(ok, down)['count_town_ok'] == 0 and combine(ok, ddown)['deposit_ok'] == 0 and combine(ok, small)['count_town_ok'] == 1
    # the noise band: -0.25 on 10 runs a cell is within 2 SE (not a failure); the same DiD on 200 a cell is
    thin = judge_rows([R('_stock_recount', REC, per=p, arm=a, status='success' if i < (5 if (p, a) == ('post', 'canary') else 8) else 'no_effect')
                       for p in ('pre', 'post') for a in ('canary', 'control') for i in range(MIN_CELL)], None)
    assert thin['count_town_ok_did'] < COUNT_TOL and thin['count_town_ok_z'] > -2 and combine(ok, thin)['count_town_ok'] == 1, (thin['count_town_ok_did'], thin['count_town_ok_z'])
    fat = judge_rows([R('_stock_recount', REC, per=p, arm=a, status='success' if i < (100 if (p, a) == ('post', 'canary') else 160) else 'no_effect')
                      for p in ('pre', 'post') for a in ('canary', 'control') for i in range(200)], None)
    assert combine(ok, fat)['count_town_ok'] == 0, (fat['count_town_ok_did'], fat['count_town_ok_z'])
    assert did_z([(5, 10), (5, 10), (5, 10), (5, 10)]) == 0.0 and did_z([(5, 9), (5, 10), (5, 10), (5, 10)]) is None
    assert combine(cr, rw)['arms_breach'] == 1 and combine(cr, rw)['liveness'] == 0
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
        """Rotation-aware (smeltjobread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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
            offbuild += 1      # restart-lag rows on another build are not canary
            continue
        bots[(per, arm)].add(b)
        name = (((r.get('raw') or {}).get('skill') or {}).get('name')) or r.get('name')   # the EXACT name: `deposit` is the runner's row
        if name in ROW_KINDS:
            rows.append({'t': t, 'per': per, 'arm': arm, 'name': name, 'status': ((r.get('raw') or {}).get('skill') or {}).get('status'), 'detail': r.get('detail') or '', 'bot': b})
    idx = read_index()
    ms = lambda d: int(d.timestamp() * 1000)
    ix = judge_index(idx, CANS, ms(CUT), ms(END), ms(PRE))
    rw = judge_rows(rows, CUT)
    res = combine(ix, rw)
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    res['refusals_up'] = refusals_up(res, hrs)
    idx_records = sum(len(v) for v in idx.values())
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f | index records on disk %d in %d pools'
          % (walked, offbuild, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0), idx_records, len(idx)))
    print('LIVENESS     licence rows canary %d | observations canary %d by town %s | change rows (_townindex_count) %d' % (res['licence_canary'], res['obs_canary'], res['obs_by_pool'], res['change_rows_canary']))
    print('ARMS         control index records after the deploy %d, control licence/change rows %d (must be 0) | before the deploy (an earlier build, not counted) canary %d control %d rows %d'
          % (res['index_control_post'], res['rows_control_post'], res['index_pre_canary'], res['index_pre_control'], res['rows_pre_earlier_build']))
    print('DEFECTS      D1 outside town %d %s | D2 malformed observations %d %s' % (res['outside_town'], res['_lists'].get('outside', []), res['malformed_obs'], res['_lists'].get('malformed', [])))
    print('             D3 verified transfers not joined to their pre/ver observations %d %s (inconclusive after a rotation, reported: %d) | D4 a re-open showing less than moved %d %s'
          % (res['xfer_unjoined'], res['_lists'].get('unjoined', []), res['xfer_unjudged'], res['xfer_unseen'], res['_lists'].get('unseen', [])))
    print('NO HARM      count_town success share (runs with keys) canary %d/%d -> %d/%d control %d/%d -> %d/%d | DiD %s (WATCH below %.2f with z < -2)'
          % (res['ct_ok_pre_canary'], res['ct_runs_pre_canary'], res['ct_ok_post_canary'], res['ct_runs_post_canary'], res['ct_ok_pre_control'], res['ct_runs_pre_control'],
             res['ct_ok_post_control'], res['ct_runs_post_control'], 'null' if res['count_town_ok_did'] is None else '%+.3f (z %s) -> %s' % (res['count_town_ok_did'], 'null' if res['count_town_ok_z'] is None else '%+.2f' % res['count_town_ok_z'], 'ok' if res['count_town_ok'] else 'DOWN'), COUNT_TOL))
    print('             deposit verb success share canary %d/%d -> %d/%d control %d/%d -> %d/%d | DiD %s (WATCH below %.2f with z < -2)'
          % (res['dep_ok_pre_canary'], res['dep_pre_canary'], res['dep_ok_post_canary'], res['dep_post_canary'], res['dep_ok_pre_control'], res['dep_pre_control'],
             res['dep_ok_post_control'], res['dep_post_control'], 'null' if res['deposit_ok_did'] is None else '%+.3f (z %s) -> %s' % (res['deposit_ok_did'], 'null' if res['deposit_ok_z'] is None else '%+.2f' % res['deposit_ok_z'], 'ok' if res['deposit_ok'] else 'DOWN'), DEPOSIT_TOL))
    print('             stock/cobble refusals canary %d -> %d control %d -> %d | refusals_up %d (WATCH: canary ratio > %.1fx control\'s with >= %d rows)'
          % (res['ref_pre_canary'], res['ref_post_canary'], res['ref_pre_control'], res['ref_post_control'], res['refusals_up'], REFUSAL_RATIO, REFUSAL_MIN))
    print('REPORTED     observations per canary bot-h %.2f | containers by state at the window end %s | dirty marks %s | transfers verified %d unverified %d | count_town extras tried %d counted %d'
          % (res['obs_canary'] / hrs[('post', 'canary')] if hrs.get(('post', 'canary')) else float('nan'), res['states_by_pool'], res['dirty_by_pool'],
             res['xfer_verified'], res['xfer_unverified'], res['chg_tried_post_canary'], res['chg_counted_post_canary']))
    print('EXPOSURE     -> %s (the quietest canary town %d observations, need %d; pre rows ok %d) | INSTRUMENT control recount rows %d, control deposit rows %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['min_obs_canary_town'], EXPOSURE_OBS, res['pre_ok'], res['ct_rows_post_control'], res['dep_post_control'],
             'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('townindexread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
