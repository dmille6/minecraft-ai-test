#!/usr/bin/env python3
# matsread.py [window_min] -- the read for canary `mats-01` (the building tier's materials job: docs/reports/building-tier-2026-10-23.md
# section 3, 6.1; branch mats-on-7b9db3a). ironsmeltread.py's plumbing (rotation-aware load, restart-lag rows skipped, per-pool
# world evidence from the town index). Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# ROWS (bots/src/mats.mjs matsDetail; skills.mjs makeMaterial / matsReturn):
#   _make_material   one per order: kind= stop= verdict= made= forbidden= stone=b0>b1 note= took= stock= reserve= ... (the gate
#                    fields FIRST: the logger cuts details at 300 chars)
#   _mats_mode       once per spawn (the licence): phase=mode v= on= kinds= reserve=k:n,... reserve_src= buffers= ...
#   _mats_return     the recovery: kind= plan_bank= craft_stone= crafted= furnace= drained= banked= keep=
#   _mats_skip       why=<reason> (at most one per bot per reason per 30 min)
#   make_material    the runner's own row (its duration = the order's body time; the lease-overlap gate's interval)
#   _furnace_session furnace= lease= t0= t1= by=make_material (the furnace lease's interval)
#   NAMES ARE EXACT: lib.telemetry folds `_x` into `x`, so every count keys on raw skill.name.
#
# THE WORLD (not the bot's claims): the town index (townindex-01) -- what the SERVER sent at every open of a town container, by any
# bot. Per pool, the building parts' stock change over the containers KNOWN at both ends of each period (ironsmeltread's
# stock_change), arms compared by per-pool MEANS of post-minus-pre, paired pools only. A boundary before the pool's first index
# record is UNAVAILABLE (None), never a zero.
#
#   LICENCE    kind `_mats_mode` (the base cannot write it).
#   GATES (REVERT, defect -- design 6.1)
#     G1 forbidden: a canary _make_material row with verdict=forbidden (the bag held fewer of an iron-ladder name, a tool or the
#        kit after the order: coal burned included) -- ANY.
#     G2 loss: rows verdict=loss (a family short: items left the boundary unaccounted) -- at least 2 AND > 5% of reconciled rows.
#     G3 reserve_crossed: a row whose own reading of the town (stock=, index-known) less what it took of an input is below that
#        input's reserve (the licence row's reserve=) -- ANY. (The job's own reading: the index only under-counts, so a crossing
#        by it is a crossing.)
#     G4 stone_leak: a bricks row whose bag stone ROSE (stone=b0>b1, b1 > b0) with its note CLOSED -- ANY. (A kept 1-3 remainder
#        is under note=keep; an open note is mats_return's.)
#     G5 overlap: two canary bots' `make_material` runs overlapping in one pool (the materials lease broken), or two bots'
#        `_furnace_session by=make_material` overlapping on one furnace -- ANY.
#     G6 loop: a canary bot with more than 7 make_material rows in any 60 min (the 10 min cooldown broken).
#     ARMS  control _mats_mode or _make_material rows after the deploy (BLOCKS KEEP).
#   LIVENESS   canary licence rows >= 1 and canary _make_material rows >= 1.
#   POSITIVE CONTROL / INSTRUMENT  control rung completions (_milestone_complete) >= 1 and index records in >= 1 control pool.
#   EXPOSURE   >= 20 parts made by rows with verdict=ok (design 6.1) AND the world's canary parts stock change > 0 (the index sees
#              the parts in town) -- KEEP needs exposure_ready.
#   NO-HARM (WATCH, DiD) rung completions per bot-h, gather successes per bot-h, the smelt `furnace_busy` share, bag fill (mean
#              occupied slots of the snapshots).
import sys, os, re, json, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

PARTS = ('stone_bricks', 'glass_pane', 'cut_copper', 'copper_door', 'torch')
LOGS = ('oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(detail):
    """PURE. 'k=v k=v ...' -> {k: v} (raw strings)."""
    out = {}
    for tok in (detail or '').split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            out[k] = v
    return out


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def kv(s):
    """PURE. 'a:1,b:2' -> {a: 1, b: 2}; '-' or junk -> {}."""
    out = {}
    for part in (s or '').split(','):
        m = re.match(r'^([a-z0-9_]+):(-?\d+(?:\.\d+)?)$', part.strip())
        if m:
            out[m.group(1)] = float(m.group(2))
    return out


def reserve_key(name):
    """PURE. mats.mjs reserveKeyOf."""
    if name in LOGS:
        return 'logs'
    if name.endswith('_planks'):
        return 'planks'
    if name == 'stick':
        return 'sticks'
    if name in ('sand', 'red_sand'):
        return 'sand'
    if name in ('cobblestone', 'copper_ingot', 'torch'):
        return name
    return None


def crossed(f, reserve):
    """PURE. Did the order, by its OWN reading of the town (stock=), take an input below its reserve? -> [key] (empty: no).
    A row whose stock= was cut by the logger (absent) or names no such key is not judged (never a crossing by default)."""
    stock = kv(f.get('stock')); took = kv(f.get('took'))
    by = defaultdict(float)
    for n, c in took.items():
        k = reserve_key(n)
        if k:
            by[k] += c
    out = []
    for k, c in by.items():
        if k not in stock or k not in reserve:
            continue
        if stock[k] - c < reserve[k]:
            out.append(k)
    return sorted(out)


def stone_leak(f):
    """PURE. A bricks row whose bag stone rose across the order with its note closed."""
    m = re.match(r'^(\d+)>(\d+)$', f.get('stone') or '')
    return bool(m) and int(m.group(2)) > int(m.group(1)) and f.get('note') == 'closed'


def overlaps(intervals):
    """PURE. [(t0, t1, who)] -> pairs of DIFFERENT `who` whose intervals overlap (sorted by t0)."""
    iv = sorted(intervals)
    out = []
    for i in range(len(iv)):
        for j in range(i + 1, len(iv)):
            if iv[j][0] >= iv[i][1]:
                break
            if iv[j][2] != iv[i][2]:
                out.append((iv[i][2], iv[j][2], iv[i][0], iv[j][0]))
    return out


def window_rate(ts, per_ms=3600_000):
    """PURE. Sorted ms timestamps -> the most rows in any per_ms window."""
    best = 0; j = 0
    for i, t in enumerate(ts):
        while ts[j] < t - per_ms + 1:
            j += 1
        best = max(best, i - j + 1)
    return best


STALE_MS = 6 * 3600 * 1000


def known_at(records, at_ms, stale_ms=STALE_MS):
    """PURE (ironsmeltread's). Index records -> {(world, container): names} KNOWN at at_ms."""
    last = {}
    for r in records:
        at = r.get('at')
        if r.get('t') not in ('obs', 'dirty') or not isinstance(at, (int, float)) or at > at_ms or r.get('k') is None:
            continue
        key = (str(r.get('w')), r['k'])
        cur = last.get(key)
        if cur is None or at > cur['at'] or (at == cur['at'] and r.get('t') == 'dirty'):
            last[key] = r
    return {key: (r.get('names') or {}) for key, r in last.items() if r.get('t') == 'obs' and at_ms - r['at'] < stale_ms}


def stock_change(records, a_ms, b_ms, names=PARTS, first_ms=None):
    """PURE (ironsmeltread's). Stock change over containers KNOWN at both ends -> ({name: delta}, n) or (None, 0)."""
    if first_ms is None or a_ms < first_ms:
        return None, 0
    ka, kb = known_at(records, a_ms), known_at(records, b_ms)
    both = set(ka) & set(kb)
    if not both:
        return None, 0
    cnt = lambda m, n: int((m.get(n) or [0])[0] or 0)
    return {n: sum(cnt(kb[k], n) - cnt(ka[k], n) for k in both) for n in names}, len(both)


def licence_reserve(detail):
    """PURE. The _mats_mode row's reserve=k:n,... -> {k: n}."""
    return {k: int(v) for k, v in kv(fields(detail).get('reserve')).items()}


# ---- positive controls on the shapes (mats.mjs matsDetail / matsModeDetail) ------------------------------------------------
_d = fields('kind=bricks stop=done verdict=ok made=12 forbidden=- stone=0>0 note=closed took=oak_log:2,cobblestone:12 stock=cobblestone:800,logs:1300,stone_bricks:0 reserve=default part=stone_bricks')
_res = licence_reserve('phase=mode v=1 on=1 kinds=bricks reserve=cobblestone:256,logs:512,planks:71,sticks:40,copper_ingot:512,sand:16,torch:32 reserve_src=default')
assert _res == {'cobblestone': 256, 'logs': 512, 'planks': 71, 'sticks': 40, 'copper_ingot': 512, 'sand': 16, 'torch': 32}, _res
assert crossed(_d, _res) == [], 'a normal order crosses nothing'
assert crossed(dict(_d, stock='cobblestone:265,logs:1300'), _res) == ['cobblestone'], '265 - 12 < 256'
assert crossed(dict(_d, stock='cobblestone:268,logs:514'), _res) == [], 'exactly one batch above: lands on the reserve'
assert crossed(dict(_d, stock='logs:513'), _res) == ['logs'] and crossed({'took': 'oak_log:2'}, _res) == [], 'a cut stock= is not judged'
assert not stone_leak(_d) and stone_leak(dict(_d, stone='0>3')) and not stone_leak(dict(_d, stone='0>3', note='keep'))
assert overlaps([(0, 10, 'a'), (5, 15, 'b'), (20, 30, 'a')]) == [('a', 'b', 0, 5)] and overlaps([(0, 10, 'a'), (5, 15, 'a')]) == []
assert window_rate([0, 10, 20]) == 3 and window_rate([]) == 0
_R = [{'t': 'obs', 'k': 'a', 'at': 10, 'names': {'stone_bricks': [0, 0]}, 'w': 'W'}, {'t': 'obs', 'k': 'a', 'at': 20, 'names': {'stone_bricks': [12, 1]}, 'w': 'W'}]
assert stock_change(_R, 15, 25, first_ms=10) == ({'stone_bricks': 12, 'glass_pane': 0, 'cut_copper': 0, 'copper_door': 0, 'torch': 0}, 1)
assert stock_change(_R, 5, 25, first_ms=10) == (None, 0), 'before the index began: unavailable'

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

    def load_window(since, until):
        """Rotation-aware (smeltjobread's): day D's rows live in skill-*.jsonl-<D+1>.gz after ~23:59Z."""
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

    raw = lambda r: ((r.get('raw') or {}).get('skill') or {})
    raw_name = lambda r: raw(r).get('name') or ''
    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    # THE POPULATION: shared towns (the job is off in isolated pools); every pool with rung rows, isolated-* excluded unless canary
    POOLS = {pool_of((r.get('bot') or {}).get('name')) for r in rows if raw_name(r) == '_milestone_complete'}
    POOLS = {p for p in POOLS if not p.startswith('isolated-') and not p.startswith('self-')} | set(CANS)
    bots = defaultdict(set); nrows = Counter(); offbuild = 0; noversion = 0
    n = Counter(); jobs = []; job_ts = defaultdict(list); leak = 0; reserve = {}
    runs = defaultdict(list); fsess = defaultdict(list); slots = defaultdict(list)
    span = defaultdict(lambda: [None, None])
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b or pool_of(b) not in POOLS:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV:
            if not ver:
                noversion += 1; continue
            if not ver.startswith(CV):
                offbuild += 1; continue
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        sp = span[(period, arm, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        k = raw_name(r); d = r.get('detail') or ''; st = raw(r).get('status')
        tms = int(t.timestamp() * 1000)
        inv = ((r.get('raw') or {}).get('bot') or {}).get('inventory')
        if isinstance(inv, dict) and len(slots[(period, arm)]) < 200000:
            slots[(period, arm)].append(len(inv))
        if k == '_mats_mode':
            if period == 'post':
                n[(arm, 'licence')] += 1
                if arm == 'control':
                    leak += 1
                else:
                    reserve = licence_reserve(d) or reserve
        elif k == '_make_material':
            if period == 'post':
                if arm == 'control':
                    leak += 1
                else:
                    jobs.append((tms, b, st, fields(d)))
                    job_ts[b].append(tms)
        elif k == 'make_material':
            if period == 'post' and arm == 'canary':
                dur = raw(r).get('duration_ms') or 0
                runs[pool_of(b)].append((tms - int(dur), tms, b))
        elif k == '_furnace_session':
            f = fields(d)
            if period == 'post' and arm == 'canary' and f.get('by') == 'make_material':
                a0, a1 = num(f.get('t0')), num(f.get('t1'))
                if a0 is not None and a1 is not None:
                    fsess[f.get('furnace')].append((a0, a1, b))
        elif k == '_milestone_complete':
            n[(period, arm, 'rungs')] += 1
        elif k == 'gather':
            if st == 'success':
                n[(period, arm, 'gather')] += 1
        elif k == 'smelt':
            n[(period, arm, 'smelt')] += 1
            if 'in use by another bot' in d:
                n[(period, arm, 'furnace_busy')] += 1

    def bot_hours(period, arm):
        return sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (p_, a_, _), sp in span.items() if p_ == period and a_ == arm and sp[0] is not None)

    def per_bh(v, period, arm):
        bh = bot_hours(period, arm)
        return v / bh if bh else float('nan')

    def did_rate(key):
        return (per_bh(n[('post', 'canary', key)], 'post', 'canary') - per_bh(n[('pre', 'canary', key)], 'pre', 'canary')) - \
               (per_bh(n[('post', 'control', key)], 'post', 'control') - per_bh(n[('pre', 'control', key)], 'pre', 'control'))

    def share(period, arm, a, b):
        d_ = n[(period, arm, b)]
        return n[(period, arm, a)] / d_ if d_ else float('nan')

    def did_share(a, b):
        return (share('post', 'canary', a, b) - share('pre', 'canary', a, b)) - (share('post', 'control', a, b) - share('pre', 'control', a, b))

    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    fill_did = (mean(slots[('post', 'canary')]) - mean(slots[('pre', 'canary')])) - (mean(slots[('post', 'control')]) - mean(slots[('pre', 'control')]))

    verdicts = Counter(f.get('verdict') for _, _, _, f in jobs)
    reconciled = sum(c for v, c in verdicts.items() if v in ('ok', 'loss', 'gain', 'overburn'))
    g1_rows = [(b, f.get('kind'), f.get('forbidden')) for _, b, _, f in jobs if f.get('verdict') == 'forbidden']
    loss_rows = [(b, f.get('kind'), f.get('stop')) for _, b, st, f in jobs if f.get('verdict') == 'loss' and st != 'aborted']
    g2 = int(len(loss_rows) >= 2 and reconciled and len(loss_rows) / reconciled > 0.05)
    g3_rows = [(b, f.get('kind'), crossed(f, reserve)) for _, b, _, f in jobs if reserve and crossed(f, reserve)]
    g4_rows = [(b, f.get('stone')) for _, b, _, f in jobs if f.get('kind') == 'bricks' and stone_leak(f)]
    g5_runs = [o for p, iv in runs.items() for o in overlaps(iv)]
    g5_furn = [o for k, iv in fsess.items() for o in overlaps(iv)]
    loop_bots = sorted(b for b, ts in job_ts.items() if window_rate(sorted(ts)) > 7)
    made_ok = sum(num(f.get('made')) or 0 for _, _, st, f in jobs if f.get('verdict') == 'ok' and f.get('kind') != 'count')
    made_by_kind = Counter()
    for _, _, _, f in jobs:
        if f.get('verdict') == 'ok':
            made_by_kind[f.get('kind')] += num(f.get('made')) or 0
    stops = Counter((f.get('kind'), (f.get('stop') or '').split('(')[0]) for _, _, _, f in jobs)
    can_bh = bot_hours('post', 'canary')

    # THE WORLD: the parts' stock change over containers KNOWN at both ends, per pool; arms by per-pool means, paired pools only
    ms = lambda x: int(x.timestamp() * 1000)
    census = {}
    for d_ in sorted(glob.glob('/var/lib/mcai/_pool-*')):
        p = d_.split('/_pool-')[1]
        if '.pre-' in p or p not in POOLS:
            continue
        recs = []
        for f_ in sorted(glob.glob(d_ + '/town-index-*.g*.jsonl')):
            for line in open(f_, 'rb'):
                try:
                    rr = json.loads(line)
                except Exception:
                    continue
                if rr.get('t') in ('obs', 'dirty'):
                    recs.append(rr)
                elif rr.get('t') == 'ckpt':
                    for w_, ents in (rr.get('worlds') or {}).items():
                        for k_, e_ in (ents or {}).items():
                            o_ = (e_ or {}).get('obs'); l_ = (e_ or {}).get('last') or {}
                            if o_ and isinstance(o_.get('at'), (int, float)):
                                recs.append({'t': 'obs', 'k': k_, 'w': json.loads(w_) if w_ not in ('null', '') else None, 'at': o_['at'], 'names': o_.get('names') or {}})
                            if l_.get('t') == 'dirty' and isinstance(l_.get('at'), (int, float)):
                                recs.append({'t': 'dirty', 'k': k_, 'w': json.loads(w_) if w_ not in ('null', '') else None, 'at': l_['at']})
        if not recs:
            continue
        first = min(r['at'] for r in recs if isinstance(r.get('at'), (int, float)))
        census[p] = {'pre': stock_change(recs, ms(PRE), ms(CUT), first_ms=first), 'post': stock_change(recs, ms(CUT), ms(END), first_ms=first)}
    paired = {p for p, c in census.items() if c['pre'][0] is not None and c['post'][0] is not None}
    excluded = sorted(set(census) - paired)
    def parts(c):
        return sum(c[0].values()) - (c[0].get('torch') or 0)   # torches move for many reasons: the world's parts sum excludes them
    def arm_mean(arm, period):
        vals = [parts(census[p][period]) for p in paired if (p in CANS) == (arm == 'canary')]
        return (sum(vals) / len(vals) if vals else None), len(vals)
    world = {arm: {per: arm_mean(arm, per) for per in ('pre', 'post')} for arm in ('canary', 'control')}
    wvals = [world['canary']['pre'][0], world['canary']['post'][0], world['control']['pre'][0], world['control']['post'][0]]
    world_did = None if any(x is None for x in wvals) else (wvals[1] - wvals[0]) - (wvals[3] - wvals[2])
    canary_post = sum(parts(census[p]['post']) for p in paired if p in CANS) if any(p in CANS for p in paired) else None
    instrument = int(n[('post', 'control', 'rungs')] >= 1 and any(p not in CANS for p in census))
    fmt = lambda v: '-' if v is None else '%+.1f' % v

    print('population pools %d: %s' % (len(POOLS), ','.join(sorted(POOLS))))
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h %.1f  |  offbuild canary rows %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary licence rows %d | canary _make_material rows %d | stops %s' % (n[('canary', 'licence')], len(jobs), dict(stops.most_common(12))))
    print('EXPOSURE     parts made by verdict=ok rows %d (KEEP needs >= 20) by kind %s | the world: canary parts stock change %s over paired pools' % (made_ok, dict(made_by_kind), fmt(canary_post)))
    print('WORLD        per-pool mean parts stock change (containers KNOWN at both ends; torches excluded): canary %s -> %s (pools %d) | control %s -> %s (pools %d) | DiD %s | excluded pools %s'
          % (fmt(world['canary']['pre'][0]), fmt(world['canary']['post'][0]), world['canary']['post'][1],
             fmt(world['control']['pre'][0]), fmt(world['control']['post'][0]), world['control']['post'][1], fmt(world_did), excluded or '-'))
    print('G1 (gate)    forbidden: %d %s' % (len(g1_rows), g1_rows[:4]))
    print('G2 (gate)    loss rows %d of %d reconciled %s | verdicts %s' % (len(loss_rows), reconciled, loss_rows[:4], dict(verdicts)))
    print('G3 (gate)    reserve crossed by the job\'s own reading: %d %s | reserve %s' % (len(g3_rows), g3_rows[:4], reserve or '(no licence row)'))
    print('G4 (gate)    stone rose with the note closed: %d %s' % (len(g4_rows), g4_rows[:4]))
    print('G5 (gate)    overlapping runs in a pool %d %s | overlapping furnace sessions %d %s' % (len(g5_runs), g5_runs[:3], len(g5_furn), g5_furn[:3]))
    print('G6 (gate)    canary bots over 7 make_material rows in any 60 min: %d %s' % (len(loop_bots), loop_bots[:5]))
    print('ARMS         control licence / _make_material rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control rung rows post %d | control pools with index records %d' % (n[('post', 'control', 'rungs')], sum(1 for p in census if p not in CANS)))
    print('NO-HARM      rungs per bot-h DiD %+.3f | gather successes per bot-h DiD %+.3f | smelt furnace_busy share DiD %+.3f | bag fill (slots) DiD %+.2f'
          % (did_rate('rungs'), did_rate('gather'), did_share('furnace_busy', 'smelt'), fill_did))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('matsread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild, 'noversion_canary': noversion,
            'licence_rows': n[('canary', 'licence')], 'jobs_canary': len(jobs),
            'liveness': int(n[('canary', 'licence')] >= 1 and len(jobs) >= 1),
            'parts_made_ok': made_ok, 'world_parts_canary': canary_post, 'world_parts_did': None if world_did is None else round(world_did, 2),
            'exposure_ready': int(made_ok >= 20 and (canary_post or 0) > 0 and instrument == 1),
            'g1_forbidden': len(g1_rows), 'g2_loss': g2, 'loss_rows': len(loss_rows), 'reconciled_rows': reconciled,
            'g3_reserve_crossed': len(g3_rows), 'g4_stone_leak': len(g4_rows), 'g5_overlap': len(g5_runs) + len(g5_furn), 'g6_loop': len(loop_bots),
            'rows_control_post': leak, 'instrument_control': instrument,
            'rungs_per_bh_did': nanless(did_rate('rungs')), 'gather_per_bh_did': nanless(did_rate('gather')),
            'furnace_busy_share_did': nanless(did_share('furnace_busy', 'smelt')), 'bag_fill_did': nanless(fill_did),
            'canary_bot_hours': round(can_bh, 2),
        })
    except Exception as e:
        print('emit failed:', e)
