#!/usr/bin/env python3
# ironsmeltread.py [window_min] -- the read for canary `ironsmelt-01` (docs/reports/ironsmelt-01-design-2026-10-23.md): the town
# smelt job smelts RAW IRON first (only the town's: the bag's own raw_iron / iron_ingot are the bot's), and does not dispatch into
# a town the town index knows is empty (the index rule-out). Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs
# (never emits).
#
# ROWS (bots/src/smeltjob.mjs smeltTownDetail; skills.mjs smeltTown):
#   _smelt_town      one per job: stop= in=fe|cu|- fe=r0/i0>r1/i1 fed= ru= n= bag0= withdrawn= coal= smelted= prior= deposited=
#                    dep_i= dep_r= bag1= left= furnace= lease= verdict= diff= chest= t0= fb= looked= more=
#                    (bag0/withdrawn/prior/deposited/bag1/left/diff are in the JOB'S FAMILY: raw_iron+iron_ingot for in=fe)
#   _ironsmelt_mode  once per spawn (the licence): phase=mode on= mode= inputs= miss_h= rule_out=
#   smelt_town       the runner's own result row (its duration = the job's body time)
#   _pickups         a 60 s pickup summary 'name n source mode; ...' (explains a balance GAIN by the same family)
#   toolkit          the kit runs (outcome=no_iron: the no-harm line on the kit's iron)
#   NAMES ARE EXACT: lib.telemetry folds `_x` into `x`, so every count keys on raw skill.name (smeltjobread's rule).
#
# THE WORLD (not the bot's claims): the town index (townindex-01, /var/lib/mcai/_pool-<pool>/town-index-*.jsonl) records what the
# SERVER sent at every open of a town container, by any bot. At each boundary (PRE, CUT, END) the index is folded per pool,
# per world and per container (obs + dirty marks, rotation checkpoints included) and a container counts only when it is KNOWN
# there (its latest record an observation, < 6 h old). The stock change is taken over the containers KNOWN at BOTH ends of a
# period (comparable containers), per pool; the arms are compared by their per-pool MEANS (canary mean of post-minus-pre vs
# control mean), with the pool counts printed. A boundary before the index's first record in a pool is UNAVAILABLE (None),
# never a zero (Codex r3 P2 x2).
#
#   LICENCE    kind `_ironsmelt_mode` (the base cannot write it).
#   GATES (REVERT, defect)
#     G1 balance_broken: canary _smelt_town rows whose family balance is broken -- verdict=loss, or verdict=gain NOT explained
#        by the same bot's `_pickups` of that FAMILY inside [t0-60 s, t+60 s] -- at least 2 AND > 5% of the reconciled rows.
#        The pickup summaries are loaded to END + 2 min (a summary is written up to 60 s after its pickups); a job ending in the
#        window's last 60 s is IMMATURE (not judged); a gain whose window holds a pickup summary that hides groups (`+N groups
#        not shown`) or reports errors is INCONCLUSIVE, never a defect (Codex r3 P2).
#     G2 own_iron_lost: canary IRON jobs (in=fe) that ended normally (stop not interrupted/error/withdraw_unsettled) with a
#        closing raw_iron OR iron_ingot below its opening count (fe=r0/i0>r1/i1, per name) -- at least 2 rows (one is reported:
#        a single client-view miscount is not a verdict, smeltjobread's floor).
#     G3 fed_over_take: canary iron jobs with fed > withdrawn (the bag fed the furnace its own raw iron) -- any.
#     G4 loop: a canary bot with more than 7 smelt_town rows in any 60 min (the 10 min cooldown broken).
#     ARMS  control _ironsmelt_mode rows or control _smelt_town rows carrying `in=` after the deploy (BLOCKS KEEP).
#   LIVENESS   canary licence rows >= 1 and canary _smelt_town rows >= 1.
#   POSITIVE CONTROL  control _smelt_town rows >= 1 (the instrument that sees jobs) and control _pickups rows >= 1.
#   EXPOSURE   canary DELIVERED iron jobs: success, verdict=ok, in=fe, withdrawn >= 1, smelted >= 1, dep_i >= 1 -- KEEP needs >= 10.
#   PRIMARY (reported) iron ingots made from town raw iron per canary bot-h; the index census DiD (raw_iron down, iron_ingot up);
#              the smelt_town no_effect share DiD and no_effect body-seconds per bot-h DiD (the churn); opens per job; jobs by
#              rule-out (ru>0 vs ru=0); unreconciled share; town iron left in bags (iron jobs that did not end ok).
#   NO-HARM (WATCH) kit no_iron per kit run DiD (toolkit outcome=no_iron); coal no_fuel per job; copper ingots per bot-h.
import sys, os, re, json, glob
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

FAMILY = {'fe': ('raw_iron', 'iron_ingot'), 'cu': ('raw_copper', 'copper_ingot'), '-': ('raw_copper', 'copper_ingot')}
# an `error` exit of an iron job banks too (r2), so G2 judges it; an interrupted/unsettled one may not have (Claude r3 P3-2)
NORMAL_END_EXCLUDED = ('interrupted', 'withdraw_unsettled')


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
        return int(v)
    except (TypeError, ValueError):
        return None


def family_picked(detail, names):
    """PURE. A `_pickups` summary 'name n source mode; ... | tail' -> items of `names` in it."""
    n = 0
    for part in (detail or '').split(' | ')[0].split('; '):
        m = re.match(r'^(\S+) (\d+) ', part.strip())
        if m and m.group(1) in names:
            n += int(m.group(2))
    return n


def pickups_incomplete(detail):
    """PURE. Does a `_pickups` summary hide groups (pickuplog.mjs formatPickups: '+N groups (M items) not shown') or report
    errors ('err=')? Then it cannot prove an absence of a family's pickups."""
    tail = (detail or '').split(' | ', 1)[1] if ' | ' in (detail or '') else ''
    return 'not shown' in tail or 'err=' in tail


def own_iron(fe):
    """PURE. 'r0/i0>r1/i1' -> (r0, i0, r1, i1) or None."""
    m = re.match(r'^(\d+)/(\d+)>(\d+)/(\d+)$', fe or '')
    return tuple(int(x) for x in m.groups()) if m else None


def own_lost(f, status=None):
    """PURE. An iron job that ended normally holding less of its own raw iron OR its own ingots than it opened with. A row whose
    STATUS is aborted is an interruption whatever its stop says (an abort inside an exit's bank keeps that exit's stop)."""
    if f.get('in') != 'fe' or f.get('stop') in NORMAL_END_EXCLUDED or status == 'aborted':
        return False
    o = own_iron(f.get('fe'))
    return bool(o) and (o[2] < o[0] or o[3] < o[1])


def fed_over(f):
    """PURE. An iron job that fed the furnace more raw iron than it took from town."""
    if f.get('in') != 'fe':
        return False
    a, b = num(f.get('fed')), num(f.get('withdrawn'))
    return a is not None and b is not None and a > b


def explained(gain, t0, t1, picks, slack=60_000):
    """PURE. Is a gain explained by the bot's own same-family pickups inside the job (+- the summary's 60 s)?"""
    return sum(c for (pt, c) in picks if t0 - slack <= pt <= t1 + slack) >= gain


def judge_gain(gain, t0, t1, picks, partial, end_ms, slack=60_000):
    """PURE. A balance GAIN -> 'ok_pickup' (explained by same-family pickups), 'immature' (the job ended within `slack` of the
    window's end: its pickup summary may not be written yet), 'inconclusive' (a summary in the job's window hid groups or
    errored), or 'gain' (unexplained: the defect)."""
    if explained(gain, t0, t1, picks, slack):
        return 'ok_pickup'
    if t1 > end_ms - slack:
        return 'immature'
    if any(t0 - slack <= pt <= t1 + slack for pt in partial):
        return 'inconclusive'
    return 'gain'


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
    """PURE. Index records (obs, dirty) -> {(world, container): names} for the containers KNOWN at at_ms: the latest record at
    or before at_ms is an observation (a dirty mark after it -> not known), younger than stale_ms. Ties: dirty wins (townindex)."""
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


def stock_change(records, a_ms, b_ms, names=('raw_iron', 'iron_ingot'), first_ms=None):
    """PURE. The stock change between a and b over the containers KNOWN at BOTH -> ({name: delta}, n_comparable), or
    (None, 0) when `a` is before the pool's first index record (no evidence: unavailable, never zero)."""
    if first_ms is None or a_ms < first_ms:
        return None, 0
    ka, kb = known_at(records, a_ms), known_at(records, b_ms)
    both = set(ka) & set(kb)
    if not both:
        return None, 0          # no container known at both ends: no evidence, never a zero change (Codex r4 P2)
    cnt = lambda m, n: int((m.get(n) or [0])[0] or 0)
    return {n: sum(cnt(kb[k], n) - cnt(ka[k], n) for k in both) for n in names}, len(both)


# ---- positive controls on the shapes (smeltjob.mjs smeltTownDetail) --------------------------------------------------------
_r = fields('stop=done in=fe fe=3/2>3/2 fed=8 ru=4 n=8 bag0=5 withdrawn=8 coal=1 smelted=8 prior=0 deposited=8 dep_i=8 dep_r=0 bag1=5 left=0 furnace=1,64,-1 lease=1 verdict=ok diff=0 chest=4,64,9 t0=1792897257666 fb=- looked=1 more=-')
assert _r['in'] == 'fe' and own_iron(_r['fe']) == (3, 2, 3, 2) and not own_lost(_r) and not fed_over(_r)
assert own_lost(dict(_r, fe='3/2>0/2')) and own_lost(dict(_r, fe='3/2>3/1')) and not own_lost(dict(_r, fe='3/2>0/2', stop='interrupted'))
assert not own_lost(dict(_r, **{'in': 'cu', 'fe': '3/2>0/0'}))
assert own_lost(dict(_r, fe='3/2>0/2', stop='error')) and not own_lost(dict(_r, fe='3/2>0/2', stop='no_fuel'), 'aborted')
assert fed_over(dict(_r, fed='9')) and not fed_over(dict(_r, fed='-')) and not fed_over(dict(_r, **{'in': 'cu', 'fed': '9'}))
assert family_picked('raw_iron 3 gather:x passive; cobblestone 6 mine:y66 passive | 9 items', FAMILY['fe']) == 3
assert family_picked('raw_copper 3 a b; iron_ingot 1 c d', FAMILY['fe']) == 1
assert explained(2, 1000, 5000, [(50_000, 2)]) and not explained(2, 1000, 5000, [(200_000, 2)])
assert window_rate([0, 10, 20]) == 3 and window_rate([]) == 0
_R = [{'t': 'obs', 'k': 'a', 'at': 10, 'names': {'raw_iron': [5, 1]}, 'w': 'W'}, {'t': 'obs', 'k': 'a', 'at': 20, 'names': {'raw_iron': [2, 1]}, 'w': 'W'},
      {'t': 'obs', 'k': 'b', 'at': 30, 'names': {'iron_ingot': [8, 1]}, 'w': 'W'}, {'t': 'dirty', 'k': 'b', 'at': 40, 'w': 'W'}]
assert known_at(_R, 25) == {('W', 'a'): {'raw_iron': [2, 1]}}, known_at(_R, 25)
assert set(known_at(_R, 35)) == {('W', 'a'), ('W', 'b')} and set(known_at(_R, 45)) == {('W', 'a')}, 'a dirty mark ends "known"'
assert known_at(_R, 25 + STALE_MS) == {}, 'stale'
assert stock_change(_R, 15, 25, first_ms=10) == ({'raw_iron': -3, 'iron_ingot': 0}, 1)
assert stock_change(_R, 5, 25, first_ms=10) == (None, 0), 'before the index began: unavailable'
assert stock_change(_R, 15, 45 + STALE_MS, first_ms=10) == (None, 0), 'nothing known at both ends: unavailable'
assert pickups_incomplete('raw_iron 3 a b | 9 items in 2 pickups in 60s; +3 groups (12 items) not shown') and pickups_incomplete('x 1 a b | 1 items; err=2')
assert not pickups_incomplete('raw_iron 3 a b | 3 items in 1 pickups in 60s')
assert judge_gain(2, 1000, 5000, [(50_000, 2)], [], 10**9) == 'ok_pickup'
assert judge_gain(2, 1000, 5000, [], [], 10**9) == 'gain'
assert judge_gain(2, 1000, 5000, [], [], 5000 + 30_000) == 'immature'
assert judge_gain(2, 1000, 5000, [], [30_000], 10**9) == 'inconclusive'

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

    raw_name = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''
    status_of = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('status'))
    dur_of = lambda r: ((((r.get('raw') or {}).get('skill') or {}).get('duration_ms')) or 0)
    # the pickup summaries run to END + 2 min (a summary is written up to 60 s after its pickups); every other row stops at END
    TAIL = END + dt.timedelta(minutes=2)
    END_MS = int(END.timestamp() * 1000)
    rows = sorted(load_window(PRE, TAIL), key=lambda r: r['t'])
    # THE POPULATION: pools whose bots run the smelt job (any job or tally row in the read's span) -- the job is off in
    # isolated pools (owner D2), but a pool named isolated-* that runs shared towns (the isolated-b pilot) is in; a canary pool
    # is always in. Data-driven, so a reshaped fleet needs no edit here.
    JOBPOOLS = {pool_of((r.get('bot') or {}).get('name')) for r in rows if raw_name(r) in ('_smelt_town', 'smelt_town', '_smelt_job_tally')} | set(CANS)
    bots = defaultdict(set); nrows = Counter(); offbuild = 0; noversion = 0
    n = Counter(); jobs = defaultdict(list); job_ts = defaultdict(list); leak = 0
    pick = {'fe': defaultdict(list), 'cu': defaultdict(list)}
    partial = defaultdict(list)    # bot -> [t_ms] of pickup summaries that hide groups or report errors
    body = Counter()           # (period, arm) -> no_effect body ms
    span = defaultdict(lambda: [None, None])
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        if t > END:
            # past END only the pickup summaries are read, and ONLY to explain gains inside the window: no population, no
            # bot-hours, no counts (Codex r4 P2)
            if raw_name(r) == '_pickups' and pool_of(b) in JOBPOOLS:
                d_ = r.get('detail') or ''; tms_ = int(t.timestamp() * 1000)
                if pickups_incomplete(d_):
                    partial[b].append(tms_)
                for fam in ('fe', 'cu'):
                    c_ = family_picked(d_, FAMILY[fam])
                    if c_:
                        pick[fam][b].append((tms_, c_))
            continue
        if pool_of(b) not in JOBPOOLS:
            continue            # the job is off there (owner D2): not the population
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV:
            if not ver:
                noversion += 1; continue
            if not ver.startswith(CV):
                offbuild += 1; continue        # restart-lag rows on another build are not canary
        bots[(period, arm)].add(b); nrows[(period, arm)] += 1
        sp = span[(period, arm, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        k = raw_name(r); d = r.get('detail') or ''; st = status_of(r)
        tms = int(t.timestamp() * 1000)
        if k == '_ironsmelt_mode':
            if period == 'post':
                n[(arm, 'licence')] += 1
                if arm == 'control':
                    leak += 1
        elif k == '_smelt_town':
            f = fields(d)
            jobs[(period, arm)].append((tms, b, st, f))
            if period == 'post' and arm == 'canary':
                job_ts[b].append(tms)
            if period == 'post' and arm == 'control' and 'in' in f:
                leak += 1
        elif k == 'smelt_town':
            n[(period, arm, 'jobs_runner')] += 1
            if st == 'no_effect':
                n[(period, arm, 'jobs_noeffect')] += 1
                body[(period, arm)] += dur_of(r)
        elif k == '_pickups':
            n[(period, arm, 'pickups')] += 1
            if pickups_incomplete(d):
                partial[b].append(tms)
            for fam in ('fe', 'cu'):
                c = family_picked(d, FAMILY[fam])
                if c:
                    pick[fam][b].append((tms, c))
        elif k == 'toolkit':
            n[(period, arm, 'kit')] += 1
            if 'outcome=no_iron' in d:
                n[(period, arm, 'kit_no_iron')] += 1

    def bot_hours(period, arm):
        return sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (p_, a_, _), sp in span.items() if p_ == period and a_ == arm and sp[0] is not None)

    def share(period, arm, num_key, den_key):
        d = n[(period, arm, den_key)]
        return n[(period, arm, num_key)] / d if d else float('nan')

    def did_share(num_key, den_key):
        return (share('post', 'canary', num_key, den_key) - share('pre', 'canary', num_key, den_key)) - \
               (share('post', 'control', num_key, den_key) - share('pre', 'control', num_key, den_key))

    def per_bh(v, period, arm):
        bh = bot_hours(period, arm)
        return v / bh if bh else float('nan')

    cj = jobs[('post', 'canary')]
    iron = [j for j in cj if j[3].get('in') == 'fe']
    # G1: the family balance, a gain explained by the same family's pickups
    verdicts = Counter(); bad = []
    for tms, b, st, f in cj:
        v = f.get('verdict'); fam = f.get('in') if f.get('in') in ('fe', 'cu') else 'cu'
        if st == 'aborted' and v in ('loss', 'gain'):
            v = 'interrupted'       # an abort inside an exit's bank: the deposit that moved items and threw is uncounted (Claude r3 P3-1)
        if v == 'gain':
            v = judge_gain(num(f.get('diff')) or 0, num(f.get('t0')) or tms, tms, pick[fam][b], partial[b], END_MS)
        verdicts[v] += 1
        if v in ('loss', 'gain'):
            bad.append((b, f.get('in'), f.get('verdict'), f.get('diff'), f.get('stop')))
    reconciled = sum(c for v, c in verdicts.items() if v in ('ok', 'ok_pickup', 'loss', 'gain'))
    g1 = int(len(bad) >= 2 and reconciled and len(bad) / reconciled > 0.05)
    g2_rows = [(b, f.get('fe'), f.get('stop')) for _, b, st, f in iron if own_lost(f, st)]
    g2 = int(len(g2_rows) >= 2)
    g3_rows = [(b, f.get('fed'), f.get('withdrawn')) for _, b, _, f in iron if fed_over(f)]
    g3 = int(len(g3_rows) >= 1)
    loop_bots = sorted(b for b, ts in job_ts.items() if window_rate(sorted(ts)) > 7)
    ok_iron = lambda st, f: st == 'success' and f.get('verdict') == 'ok' and (num(f.get('withdrawn')) or 0) >= 1 and (num(f.get('smelted')) or 0) >= 1 and (num(f.get('dep_i')) or 0) >= 1
    delivered = [j for j in iron if ok_iron(j[2], j[3])]
    ingots_iron = sum(num(f.get('smelted')) or 0 for _, _, st, f in iron)
    banked_iron = sum(num(f.get('dep_i')) or 0 for _, _, st, f in iron)
    raw_taken = sum(num(f.get('withdrawn')) or 0 for _, _, st, f in iron)
    left_in_bags = sum(max(0, (num(f.get('bag1')) or 0) - (num(f.get('bag0')) or 0)) for _, _, st, f in iron if f.get('verdict') != 'ok')
    unrec = verdicts.get('unreconciled', 0)
    stops = Counter((f.get('in'), f.get('stop')) for _, _, _, f in cj)
    ru_split = Counter(('ru>0' if (num(f.get('ru')) or 0) > 0 else 'ru=0', f.get('stop') == 'town_has_none') for _, _, _, f in cj)
    looked = [num(f.get('looked')) for _, _, _, f in cj if num(f.get('looked')) is not None]
    copper_ingots = sum(num(f.get('smelted')) or 0 for _, _, st, f in cj if f.get('in') == 'cu')
    no_fuel = sum(1 for _, _, _, f in cj if f.get('stop') == 'no_fuel')
    can_bh = bot_hours('post', 'canary')
    ctl_jobs = len(jobs[('post', 'control')]); ctl_pick = n[('post', 'control', 'pickups')]

    # THE WORLD: per pool, the stock change over containers KNOWN at both ends of each period; arms compared by per-pool MEANS
    ms = lambda x: int(x.timestamp() * 1000)
    census = {}
    for d_ in sorted(glob.glob('/var/lib/mcai/_pool-*')):
        p = d_.split('/_pool-')[1]
        if '.pre-' in p or p not in JOBPOOLS:
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
                    # a rotation's checkpoint: the fold of the generations it replaced (townindex.mjs rotateIndex)
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
        census[p] = {'pre': stock_change(recs, ms(PRE), ms(CUT), first_ms=first), 'post': stock_change(recs, ms(CUT), ms(END), first_ms=first),
                     'known': {lbl: len(known_at(recs, ms(x))) for lbl, x in (('pre', PRE), ('cut', CUT), ('end', END))}}
    # PAIRED POOLS ONLY (Codex r4 P2): a pool enters an arm's means only when BOTH periods have evidence; the others are named
    paired = {p for p, c in census.items() if c['pre'][0] is not None and c['post'][0] is not None}
    excluded = sorted(set(census) - paired)
    def arm_mean(arm, period, name):
        vals = [census[p][period][0][name] for p in paired if (p in CANS) == (arm == 'canary')]
        return (sum(vals) / len(vals) if vals else None), len(vals)
    world = {arm: {name: {per: arm_mean(arm, per, name) for per in ('pre', 'post')} for name in ('raw_iron', 'iron_ingot')} for arm in ('canary', 'control')}
    def world_did(name):
        a = [world[arm][name][per][0] for arm in ('canary', 'control') for per in ('pre', 'post')]
        return None if any(x is None for x in a) else (a[1] - a[0]) - (a[3] - a[2])
    comparable = {arm: sum(c['post'][1] for p, c in census.items() if (p in CANS) == (arm == 'canary')) for arm in ('canary', 'control')}
    known_n = {arm: {lbl: sum(c['known'][lbl] for p, c in census.items() if (p in CANS) == (arm == 'canary')) for lbl in ('pre', 'cut', 'end')} for arm in ('canary', 'control')}
    fmt = lambda v: '-' if v is None else '%+.1f' % v

    print('population pools (run the job) %d: %s' % (len(JOBPOOLS), ','.join(sorted(JOBPOOLS))))
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h %.1f  |  offbuild canary rows %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary licence rows %d | canary _smelt_town rows %d (iron %d) | stops %s' % (n[('canary', 'licence')], len(cj), len(iron), dict(stops.most_common(10))))
    print('EXPOSURE     delivered iron jobs (success, ok, in=fe, withdrawn/smelted/dep_i >= 1): %d (KEEP needs >= 10)' % len(delivered))
    print('PRIMARY      iron ingots made %d (%.3f per canary bot-h), banked %d, raw iron taken from town %d | copper ingots %d' % (ingots_iron, per_bh(ingots_iron, 'post', 'canary'), banked_iron, raw_taken, copper_ingots))
    print('WORLD        per-pool mean stock change over containers KNOWN at both ends (pre -> post window): canary raw_iron %s -> %s iron_ingot %s -> %s (pools %d) | control raw_iron %s -> %s iron_ingot %s -> %s (pools %d) | DiD raw_iron %s iron_ingot %s | comparable containers in the window canary %d control %d'
          % (fmt(world['canary']['raw_iron']['pre'][0]), fmt(world['canary']['raw_iron']['post'][0]), fmt(world['canary']['iron_ingot']['pre'][0]), fmt(world['canary']['iron_ingot']['post'][0]), world['canary']['raw_iron']['post'][1],
             fmt(world['control']['raw_iron']['pre'][0]), fmt(world['control']['raw_iron']['post'][0]), fmt(world['control']['iron_ingot']['pre'][0]), fmt(world['control']['iron_ingot']['post'][0]), world['control']['raw_iron']['post'][1],
             fmt(world_did('raw_iron')), fmt(world_did('iron_ingot')), comparable['canary'], comparable['control']))
    print('             KNOWN containers at PRE / CUT / END: canary %(pre)d / %(cut)d / %(end)d' % known_n['canary'] + ' | control %(pre)d / %(cut)d / %(end)d' % known_n['control']
          + ' | pools paired (evidence in both periods) %d, excluded %s' % (len(paired), excluded or '-'))
    print('CHURN        smelt_town no_effect share canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | no_effect body-s per bot-h canary %.1f -> %.1f control %.1f -> %.1f'
          % (share('pre', 'canary', 'jobs_noeffect', 'jobs_runner'), share('post', 'canary', 'jobs_noeffect', 'jobs_runner'),
             share('pre', 'control', 'jobs_noeffect', 'jobs_runner'), share('post', 'control', 'jobs_noeffect', 'jobs_runner'), did_share('jobs_noeffect', 'jobs_runner'),
             per_bh(body[('pre', 'canary')] / 1000, 'pre', 'canary'), per_bh(body[('post', 'canary')] / 1000, 'post', 'canary'),
             per_bh(body[('pre', 'control')] / 1000, 'pre', 'control'), per_bh(body[('post', 'control')] / 1000, 'post', 'control')))
    print('SEARCH       opens per canary job %.2f (n=%d) | by rule-out (ru, town_has_none): %s' % (sum(looked) / len(looked) if looked else float('nan'), len(looked), dict(ru_split)))
    print('G1 (gate)    family balance verdicts %s | broken %d of %d reconciled %s' % (dict(verdicts), len(bad), reconciled, bad[:4]))
    print('G2 (gate)    iron jobs ending below their own iron (per name): %d %s' % (len(g2_rows), g2_rows[:4]))
    print('G3 (gate)    iron jobs fed > withdrawn: %d %s' % (len(g3_rows), g3_rows[:4]))
    print('G4 (gate)    canary bots over 7 job rows in any 60 min: %d %s' % (len(loop_bots), loop_bots[:5]))
    print('ARMS         control licence / in= rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control _smelt_town rows post %d | control _pickups rows post %d' % (ctl_jobs, ctl_pick))
    print('ACCOUNTING   unreconciled canary jobs %d of %d | town iron left in bags (iron jobs not ok) %d | coal no_fuel jobs %d' % (unrec, len(cj), left_in_bags, no_fuel))
    print('NO-HARM      kit no_iron per kit run canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
          % (share('pre', 'canary', 'kit_no_iron', 'kit'), share('post', 'canary', 'kit_no_iron', 'kit'), share('pre', 'control', 'kit_no_iron', 'kit'),
             share('post', 'control', 'kit_no_iron', 'kit'), did_share('kit_no_iron', 'kit')))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('ironsmeltread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild, 'noversion_canary': noversion,
            'licence_rows': n[('canary', 'licence')], 'jobs_canary': len(cj), 'iron_jobs': len(iron),
            'liveness': int(n[('canary', 'licence')] >= 1 and len(cj) >= 1),
            'delivered_iron_jobs': len(delivered), 'exposure_ready': int(len(delivered) >= 10 and ctl_jobs >= 1 and ctl_pick >= 1),
            'iron_ingots_made': ingots_iron, 'iron_ingots_per_bh': nanless(per_bh(ingots_iron, 'post', 'canary')), 'iron_banked': banked_iron, 'raw_iron_taken': raw_taken,
            'world_raw_iron_did': None if world_did('raw_iron') is None else round(world_did('raw_iron'), 2),
            'world_iron_ingot_did': None if world_did('iron_ingot') is None else round(world_did('iron_ingot'), 2),
            'world_comparable_canary': comparable['canary'], 'world_comparable_control': comparable['control'],
            'immature_jobs': verdicts.get('immature', 0), 'inconclusive_gains': verdicts.get('inconclusive', 0),
            'noeffect_share_did': nanless(did_share('jobs_noeffect', 'jobs_runner')),
            'g1_balance_broken': g1, 'balance_broken_rows': len(bad), 'reconciled_rows': reconciled,
            'g2_own_iron_lost': g2, 'own_iron_lost_rows': len(g2_rows), 'g3_fed_over_take': g3, 'g4_loop': len(loop_bots),
            'rows_control_post': leak, 'instrument_control': int(ctl_jobs >= 1 and ctl_pick >= 1),
            'unreconciled_rows': unrec, 'iron_left_in_bags': left_in_bags, 'no_fuel_jobs': no_fuel,
            'kit_no_iron_did': nanless(did_share('kit_no_iron', 'kit')), 'canary_bot_hours': round(can_bh, 2),
        })
    except Exception as e:
        print('emit failed:', e)
