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
# SERVER sent at every open of a town container, by any bot. Per pool, the raw_iron and iron_ingot the index's latest
# observation of each container shows, at the window's start and at its end ("index census"); its change is the world's
# answer to "did raw iron leave the chests and ingots arrive", read canary vs control (difference-in-differences against the
# same-length PRE). Coverage changes (a container first seen mid-window) are reported, not hidden.
#
#   LICENCE    kind `_ironsmelt_mode` (the base cannot write it).
#   GATES (REVERT, defect)
#     G1 balance_broken: canary _smelt_town rows whose family balance is broken -- verdict=loss, or verdict=gain NOT explained
#        by the same bot's `_pickups` of that FAMILY inside [t0-60 s, t+60 s] -- at least 2 AND > 5% of the reconciled rows.
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
NORMAL_END_EXCLUDED = ('interrupted', 'error', 'withdraw_unsettled')


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
    """PURE. A `_pickups` summary 'name n source mode; ... | ...' -> items of `names` in it."""
    n = 0
    for part in (detail or '').split(' | ')[0].split('; '):
        m = re.match(r'^(\S+) (\d+) ', part.strip())
        if m and m.group(1) in names:
            n += int(m.group(2))
    return n


def own_iron(fe):
    """PURE. 'r0/i0>r1/i1' -> (r0, i0, r1, i1) or None."""
    m = re.match(r'^(\d+)/(\d+)>(\d+)/(\d+)$', fe or '')
    return tuple(int(x) for x in m.groups()) if m else None


def own_lost(f):
    """PURE. An iron job that ended normally holding less of its own raw iron OR its own ingots than it opened with."""
    if f.get('in') != 'fe' or f.get('stop') in NORMAL_END_EXCLUDED:
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


def window_rate(ts, per_ms=3600_000):
    """PURE. Sorted ms timestamps -> the most rows in any per_ms window."""
    best = 0; j = 0
    for i, t in enumerate(ts):
        while ts[j] < t - per_ms + 1:
            j += 1
        best = max(best, i - j + 1)
    return best


def index_census(records, at_ms, names=('raw_iron', 'iron_ingot')):
    """PURE. Index records (obs/dirty) -> {name: total} over each container's latest OBSERVATION captured at or before at_ms,
    plus the number of containers counted. A container never observed by then is not counted (coverage is reported)."""
    last = {}
    for r in records:
        if r.get('t') != 'obs' or not isinstance(r.get('at'), (int, float)) or r['at'] > at_ms:
            continue
        k = r.get('k')
        if k is not None and (k not in last or r['at'] >= last[k]['at']):
            last[k] = r
    tot = {n: 0 for n in names}
    for r in last.values():
        for n in names:
            v = (r.get('names') or {}).get(n)
            if isinstance(v, list) and v:
                tot[n] += int(v[0] or 0)
    return tot, len(last)


# ---- positive controls on the shapes (smeltjob.mjs smeltTownDetail) --------------------------------------------------------
_r = fields('stop=done in=fe fe=3/2>3/2 fed=8 ru=4 n=8 bag0=5 withdrawn=8 coal=1 smelted=8 prior=0 deposited=8 dep_i=8 dep_r=0 bag1=5 left=0 furnace=1,64,-1 lease=1 verdict=ok diff=0 chest=4,64,9 t0=1792897257666 fb=- looked=1 more=-')
assert _r['in'] == 'fe' and own_iron(_r['fe']) == (3, 2, 3, 2) and not own_lost(_r) and not fed_over(_r)
assert own_lost(dict(_r, fe='3/2>0/2')) and own_lost(dict(_r, fe='3/2>3/1')) and not own_lost(dict(_r, fe='3/2>0/2', stop='interrupted'))
assert not own_lost(dict(_r, **{'in': 'cu', 'fe': '3/2>0/0'}))
assert fed_over(dict(_r, fed='9')) and not fed_over(dict(_r, fed='-')) and not fed_over(dict(_r, **{'in': 'cu', 'fed': '9'}))
assert family_picked('raw_iron 3 gather:x passive; cobblestone 6 mine:y66 passive | 9 items', FAMILY['fe']) == 3
assert family_picked('raw_copper 3 a b; iron_ingot 1 c d', FAMILY['fe']) == 1
assert explained(2, 1000, 5000, [(50_000, 2)]) and not explained(2, 1000, 5000, [(200_000, 2)])
assert window_rate([0, 10, 20]) == 3 and window_rate([]) == 0
_c, _n = index_census([{'t': 'obs', 'k': 'a', 'at': 10, 'names': {'raw_iron': [5, 1]}}, {'t': 'obs', 'k': 'a', 'at': 20, 'names': {'raw_iron': [2, 1]}},
                       {'t': 'obs', 'k': 'b', 'at': 30, 'names': {'iron_ingot': [8, 1]}}], 25)
assert _c == {'raw_iron': 2, 'iron_ingot': 0} and _n == 1, (_c, _n)

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
    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); nrows = Counter(); offbuild = 0; noversion = 0
    n = Counter(); jobs = defaultdict(list); job_ts = defaultdict(list); leak = 0
    pick = {'fe': defaultdict(list), 'cu': defaultdict(list)}
    body = Counter()           # (period, arm) -> no_effect body ms
    span = defaultdict(lambda: [None, None])
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        if b.startswith('isolated') or b.startswith('self-'):
            continue            # the job is off in isolated pools (owner D2): the population is the shared towns
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
        if v == 'gain' and explained(num(f.get('diff')) or 0, num(f.get('t0')) or tms, tms, pick[fam][b]):
            v = 'ok_pickup'
        verdicts[v] += 1
        if v in ('loss', 'gain'):
            bad.append((b, f.get('in'), f.get('verdict'), f.get('diff'), f.get('stop')))
    reconciled = sum(c for v, c in verdicts.items() if v in ('ok', 'ok_pickup', 'loss', 'gain'))
    g1 = int(len(bad) >= 2 and reconciled and len(bad) / reconciled > 0.05)
    g2_rows = [(b, f.get('fe'), f.get('stop')) for _, b, _, f in iron if own_lost(f)]
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

    # THE WORLD: the index census per pool at PRE, CUT and END (server-sent contents at each container's latest open)
    census = {}
    for d_ in sorted(glob.glob('/var/lib/mcai/_pool-*')):
        p = d_.split('/_pool-')[1]
        if '.pre-' in p or p.startswith('isolated') or p.startswith('self-'):
            continue
        recs = []
        for f_ in sorted(glob.glob(d_ + '/town-index-*.g*.jsonl')):
            for line in open(f_, 'rb'):
                try:
                    rr = json.loads(line)
                except Exception:
                    continue
                if rr.get('t') == 'obs':
                    recs.append(rr)
                elif rr.get('t') == 'ckpt':
                    for w_ in (rr.get('worlds') or {}).values():
                        for k_, e_ in (w_ or {}).items():
                            o_ = (e_ or {}).get('obs')
                            if o_ and isinstance(o_.get('at'), (int, float)):
                                recs.append({'t': 'obs', 'k': k_, 'at': o_['at'], 'names': o_.get('names') or {}})
        if not recs:
            continue
        ms = lambda x: int(x.timestamp() * 1000)
        census[p] = {lbl: index_census(recs, ms(x)) for lbl, x in (('pre', PRE), ('cut', CUT), ('end', END))}
    def cdelta(arm, name, a, b):
        tot = 0
        for p, c in census.items():
            if (p in CANS) == (arm == 'canary'):
                tot += c[b][0][name] - c[a][0][name]
        return tot
    world = {arm: {name: (cdelta(arm, name, 'pre', 'cut'), cdelta(arm, name, 'cut', 'end')) for name in ('raw_iron', 'iron_ingot')} for arm in ('canary', 'control')}
    world_did = {name: (world['canary'][name][1] - world['canary'][name][0]) - (world['control'][name][1] - world['control'][name][0]) for name in ('raw_iron', 'iron_ingot')}

    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  canary bot-h %.1f  |  offbuild canary rows %d, no-version %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), can_bh, offbuild, noversion))
    print('LIVENESS     canary licence rows %d | canary _smelt_town rows %d (iron %d) | stops %s' % (n[('canary', 'licence')], len(cj), len(iron), dict(stops.most_common(10))))
    print('EXPOSURE     delivered iron jobs (success, ok, in=fe, withdrawn/smelted/dep_i >= 1): %d (KEEP needs >= 10)' % len(delivered))
    print('PRIMARY      iron ingots made %d (%.3f per canary bot-h), banked %d, raw iron taken from town %d | copper ingots %d' % (ingots_iron, per_bh(ingots_iron, 'post', 'canary'), banked_iron, raw_taken, copper_ingots))
    print('WORLD        index census delta (pre-window, window): canary raw_iron %s iron_ingot %s | control raw_iron %s iron_ingot %s | DiD raw_iron %+d iron_ingot %+d | containers seen at end canary %d control %d'
          % (world['canary']['raw_iron'], world['canary']['iron_ingot'], world['control']['raw_iron'], world['control']['iron_ingot'], world_did['raw_iron'], world_did['iron_ingot'],
             sum(c['end'][1] for p, c in census.items() if p in CANS), sum(c['end'][1] for p, c in census.items() if p not in CANS)))
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
            'world_raw_iron_did': world_did['raw_iron'], 'world_iron_ingot_did': world_did['iron_ingot'],
            'noeffect_share_did': nanless(did_share('jobs_noeffect', 'jobs_runner')),
            'g1_balance_broken': g1, 'balance_broken_rows': len(bad), 'reconciled_rows': reconciled,
            'g2_own_iron_lost': g2, 'own_iron_lost_rows': len(g2_rows), 'g3_fed_over_take': g3, 'g4_loop': len(loop_bots),
            'rows_control_post': leak, 'instrument_control': int(ctl_jobs >= 1 and ctl_pick >= 1),
            'unreconciled_rows': unrec, 'iron_left_in_bags': left_in_bags, 'no_fuel_jobs': no_fuel,
            'kit_no_iron_did': nanless(did_share('kit_no_iron', 'kit')), 'canary_bot_hours': round(can_bh, 2),
        })
    except Exception as e:
        print('emit failed:', e)
