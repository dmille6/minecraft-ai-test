#!/usr/bin/env python3
# indexsearchread.py [window_min] [--selftest] -- the read for canary `indexsearch-01` (the town search opens the containers the
# town index says hold the need first: the toolkit's iron, the smelt job's copper and coal, withdraw_pick's ingredients; plus
# KITSTICKS: a bag that cannot make the kit's sticks draws them first from whichever town container holds them). Design:
# docs/reports/town-plan-2026-10-20.md section 7.7 and section 9 row 2. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never
# emits). Judges the CANARY ARM; difference-in-differences against control for the effect; DENOMINATORS FIRST.
#
# Run from ~/mcai-analysis (lib/telemetry.py: the file reads, rotation-aware).
#
# WHY (measured 10-20, 24 h of rows; the 00:15Z census): 428 of 660 toolkit runs failed "no town container in reach holds 1
# iron ingot with 4 to spare", 441 of 1,582 smelt_town runs found "no coal in the town containers looked in", in towns that
# held both (iron ingots in 9-25 containers per town). toolkit-03's every-container search ranks a container first only on a
# stock-journal count, and iron/copper/coal are no journal group.
#
# THE CHANGE (what only this build writes):
#   _indexsearch_mode  once per spawn: the licence
#   _index_search      one per search pass (by=toolkit | smelt_town | kit_sticks): need, town, cand, ix (candidates the index
#                      ranked first), first (ix | journal | near), visits, took, hit (the container that gave the take was
#                      index-ranked), tried -- the change row
#   _kit_sticks        one per KITSTICKS pre-draw: want, took, left, cand, first, visits, tried
#
# METRICS (rows the base writes too)
#   KIT        `_toolkit` phase=kit rows; ATTEMPTS = outcome not nothing/off. PRIMARY no_iron per attempt (DiD, should FALL), read
#              WITH unfound (no_iron|more|stalled|unseen|no_sticks) per attempt; crafted (crafted|partial) per attempt (should RISE)
#   SMELT      `_smelt_town` jobs; PRIMARY no_fuel per job (DiD, should FALL), read WITH fuel_unfound (no_fuel|search_more|
#              search_stalled) per job
#   GATE       withdraw_pick order success (outcome took_*) per order: a WATCH line, below -0.15 DiD with z < -2
# DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#   D1 ix_over_cand        an `_index_search` row with ix > cand (it cannot rank more containers than it has)
#   D2 first_ix_unranked   first=ix with ix=0
#   D3 sticks_over_want    a `_kit_sticks` row that took more sticks than it wanted
#   D4 pass_over_budget    visits past the pass's own budget (toolkit 12, smelt_town 16, kit_sticks 4)
#   D5 hit_without_take    hit=1 with took=0
#   ARMS                   control `_index_search`, `_indexsearch_mode` or `_kit_sticks` after the deploy (must be 0)
#   LIVENESS               canary licence >= 1 and canary `_index_search` rows >= 1
# EXPOSURE   >= 13 canary kit attempts AND >= 13 canary smelt jobs (the design: "13 toolkit runs and 13 smelt_town fuel draws"),
#            AND pre-window rows on both arms (the DiD has a baseline)
# INSTRUMENT control kit attempts >= 1 and control smelt jobs >= 1 (the population is visible in control)
# REPORTED   passes by caller; first=ix share; hit rate (hit / took); kit_sticks took; index-ranked candidates per pass.
import sys, os, json, re, glob, math
import datetime as dt
from collections import Counter, defaultdict

KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
KEEP = ('_toolkit', '_smelt_town', '_withdraw_pick', '_index_search', '_indexsearch_mode', '_kit_sticks')
BUDGET = {'toolkit': 12, 'smelt_town': 16, 'kit_sticks': 4}
EXPOSURE_KIT = 13
EXPOSURE_SMELT = 13
MIN_CELL = 10
WP_TOL = -0.15
NOT_ATTEMPT = ('nothing', 'off')
UNFOUND = ('no_iron', 'more', 'stalled', 'unseen', 'no_sticks')
CRAFTED = ('crafted', 'partial')
FUEL_UNFOUND = ('no_fuel', 'search_more', 'search_stalled')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def num(f, k, default=0):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def is_kit(r):
    return r['name'] == '_toolkit' and (r['detail'] or '').startswith('phase=kit ')


def is_order(r):
    return r['name'] == '_withdraw_pick' and ' verb=withdraw_pick ' in ' %s ' % r['detail']


def did_z(cells):
    """[(k, n)] pre canary, post canary, pre control, post control -> (did, z) or (None, None). PURE."""
    if any(n < MIN_CELL for _, n in cells):
        return None, None
    p = [k / n for k, n in cells]
    se = math.sqrt(sum(q * (1 - q) / n for q, (_, n) in zip(p, cells)))
    d = (p[1] - p[0]) - (p[3] - p[2])
    return d, (d / se if se > 0 else (0.0 if d == 0 else math.copysign(float('inf'), d)))


def judge(rows):
    """PURE over rows {t, per, arm, name, status, detail, bot}."""
    out = {}
    c = Counter()
    for r in rows:
        k = (r['per'], r['arm'])
        f = kv(r['detail'])
        if is_kit(r):
            oc = f.get('outcome') or '?'
            if oc not in NOT_ATTEMPT:
                c[k + ('kit',)] += 1
                c[k + ('no_iron',)] += oc == 'no_iron'
                c[k + ('unfound',)] += oc in UNFOUND
                c[k + ('crafted',)] += oc in CRAFTED
        elif r['name'] == '_smelt_town':
            stop = f.get('stop') or '?'
            c[k + ('job',)] += 1
            c[k + ('no_fuel',)] += stop == 'no_fuel'
            c[k + ('fuel_unfound',)] += stop in FUEL_UNFOUND
        elif is_order(r):
            c[k + ('wp',)] += 1
            c[k + ('wp_ok',)] += (f.get('outcome') or '').startswith('took_')
        elif r['name'] in ('_index_search', '_indexsearch_mode', '_kit_sticks'):
            c[k + (r['name'],)] += 1
    g = lambda per, arm, f: c[(per, arm, f)]
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            for f in ('kit', 'no_iron', 'unfound', 'crafted', 'job', 'no_fuel', 'fuel_unfound', 'wp', 'wp_ok', '_index_search', '_indexsearch_mode', '_kit_sticks'):
                out['%s_%s_%s' % (f.strip('_'), per, arm)] = g(per, arm, f)
    cells = lambda kk, n: [(g(per, arm, kk), g(per, arm, n)) for arm in ('canary', 'control') for per in ('pre', 'post')]
    for name, kk, n in (('no_iron_per_attempt', 'no_iron', 'kit'), ('unfound_per_attempt', 'unfound', 'kit'), ('crafted_per_attempt', 'crafted', 'kit'),
                        ('no_fuel_per_job', 'no_fuel', 'job'), ('fuel_unfound_per_job', 'fuel_unfound', 'job'), ('withdraw_pick_ok', 'wp_ok', 'wp')):
        d, z = did_z(cells(kk, n))
        out[name + '_did'], out[name + '_z'] = d, z
    out['withdraw_pick_gate'] = 0 if (out['withdraw_pick_ok_did'] is not None and out['withdraw_pick_ok_did'] < WP_TOL and out['withdraw_pick_ok_z'] < -2) else 1
    # the change rows: defects, arms, liveness, reports
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    lists = defaultdict(list)
    d = Counter()
    by = Counter(); first = Counter(); took = hit = 0
    for r in post_c:
        f = kv(r['detail'])
        if r['name'] == '_index_search':
            b = f.get('by') or '?'
            by[b] += 1; first[f.get('first') or '?'] += 1
            ix, cand, visits = num(f, 'ix'), num(f, 'cand'), num(f, 'visits')
            if ix > cand:
                d['ix_over_cand'] += 1; lists['ix_over_cand'].append((r['bot'], ix, cand))
            if f.get('first') == 'ix' and ix == 0:
                d['first_ix_unranked'] += 1; lists['first_ix_unranked'].append((r['bot'], str(r['t'])))
            if visits > BUDGET.get(b, 16):
                d['pass_over_budget'] += 1; lists['pass_over_budget'].append((r['bot'], b, visits))
            if num(f, 'hit') and not num(f, 'took'):
                d['hit_without_take'] += 1; lists['hit_without_take'].append((r['bot'], b))
            took += num(f, 'took'); hit += num(f, 'hit')
        elif r['name'] == '_kit_sticks':
            if num(f, 'took') > num(f, 'want'):
                d['sticks_over_want'] += 1; lists['sticks_over_want'].append((r['bot'], num(f, 'took'), num(f, 'want')))
            if num(f, 'visits') > BUDGET['kit_sticks']:
                d['pass_over_budget'] += 1; lists['pass_over_budget'].append((r['bot'], 'kit_sticks', num(f, 'visits')))
    for k in ('ix_over_cand', 'first_ix_unranked', 'sticks_over_want', 'pass_over_budget', 'hit_without_take'):
        out[k] = d[k]
    out['passes_by'] = dict(by); out['first'] = dict(first)
    out['took_passes'] = took; out['hit_passes'] = hit
    out['kit_sticks_took'] = sum(num(kv(r['detail']), 'took') for r in post_c if r['name'] == '_kit_sticks')
    out['rows_control_post'] = sum(g('post', 'control', f) for f in ('_index_search', '_indexsearch_mode', '_kit_sticks'))
    out['rows_pre_earlier_build'] = sum(g('pre', a, f) for a in ('canary', 'control') for f in ('_index_search', '_indexsearch_mode', '_kit_sticks'))
    out['liveness'] = int(g('post', 'canary', '_indexsearch_mode') >= 1 and g('post', 'canary', '_index_search') >= 1)
    out['instrument_control'] = int(g('post', 'control', 'kit') >= 1 and g('post', 'control', 'job') >= 1)
    out['pre_ok'] = int(g('pre', 'canary', 'kit') + g('pre', 'canary', 'job') >= 1 and g('pre', 'control', 'kit') + g('pre', 'control', 'job') >= 1)
    out['exposure_ready'] = int(g('post', 'canary', 'kit') >= EXPOSURE_KIT and g('post', 'canary', 'job') >= EXPOSURE_SMELT and out['pre_ok'] == 1)
    out['_lists'] = {k: v[:5] for k, v in lists.items()}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 20, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='board-a-Alpha', arm='canary', per='post', status='success': {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'detail': detail, 'bot': bot}
    KIT_OK = 'phase=kit outcome=crafted needs=iron_axe+iron_shovel drew=4 sticks=0 used=4 crafted=iron_axe+iron_shovel credit=0->0 town=22 cand=22 visits=1 vfail=0 maxrep=1 left=0 stop=- before=- after=- tried=[1,2,3:success]'
    KIT_NO = 'phase=kit outcome=no_iron needs=iron_axe+iron_shovel drew=0 sticks=0 used=0 crafted=- credit=0->0 town=31 cand=14 visits=12 vfail=1 maxrep=1 left=0 stop=12_of_14 before=- after=- tried=[]'
    KIT_NOTHING = 'phase=kit outcome=nothing needs=- drew=0 sticks=0 used=0 crafted=- credit=0->0 stop=- before=- after=- tried=[]'
    SM_OK = 'stop=done n=8 bag0=0 withdrawn=8 coal=1 smelted=8 prior=0 deposited=8 looked=4 more=-'
    SM_NF = 'stop=no_fuel n=0 bag0=0 withdrawn=8 coal=0 smelted=0 prior=0 deposited=8'
    WP_OK = 'outcome=took_pick need=pick uses=120 verification=server verb=withdraw_pick line=- town=12 cand=3,0 visits=1 maxrep=1 vfail=0 cursor=- tried=[]'
    WP_NO = 'outcome=short need=pick uses=- verification=server verb=withdraw_pick line=- town=12 cand=3,0 visits=3 maxrep=1 vfail=0 cursor=- tried=[]'
    IX = 'by=toolkit need=kit_iron town=22 cand=22 ix=3 first=ix visits=1 took=1 hit=1 tried=[1,2,3:success]'
    IXS = 'by=smelt_town need=coal town=10 cand=10 ix=1 first=ix visits=1 took=1 hit=1 tried=[1,2,3]'
    LIC = 'phase=mode rank=index kitsticks=on needs=kit_iron,coal,raw_copper,stick,cobblestone,planks fresh_h=6 positive_only=1'
    KS = 'want=6 took=6 left=0 cand=4 first=journal visits=1 tried=[1,2,3:success]'
    base = []
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            bot = 'board-a-Alpha' if arm == 'canary' else 'hive-c-Alpha'
            base += [R('_toolkit', KIT_NO, per=per, arm=arm, bot=bot, status='failed')] * 5 + [R('_toolkit', KIT_OK, per=per, arm=arm, bot=bot)] * 5
            base += [R('_smelt_town', SM_NF, per=per, arm=arm, bot=bot)] * 5 + [R('_smelt_town', SM_OK, per=per, arm=arm, bot=bot)] * 8
            base += [R('_withdraw_pick', WP_OK, per=per, arm=arm, bot=bot)] * 5 + [R('_withdraw_pick', WP_NO, per=per, arm=arm, bot=bot)] * 5
    live = [R('_indexsearch_mode', LIC), R('_index_search', IX), R('_index_search', IXS), R('_kit_sticks', KS)]
    ok = judge(base + live + [R('_toolkit', KIT_NOTHING)])
    assert ok['kit_post_canary'] == 10 and ok['job_post_canary'] == 13 and ok['wp_post_canary'] == 10, ok
    assert ok['no_iron_per_attempt_did'] == 0 and ok['no_fuel_per_job_did'] == 0 and ok['withdraw_pick_ok_did'] == 0 and ok['withdraw_pick_gate'] == 1, ok
    for k in ('ix_over_cand', 'first_ix_unranked', 'sticks_over_want', 'pass_over_budget', 'hit_without_take', 'rows_control_post'):
        assert ok[k] == 0, (k, ok)
    assert ok['liveness'] == 1 and ok['instrument_control'] == 1 and ok['pre_ok'] == 1 and ok['exposure_ready'] == 0, ok
    assert ok['passes_by'] == {'toolkit': 1, 'smelt_town': 1} and ok['hit_passes'] == 2 and ok['kit_sticks_took'] == 6, ok
    more = judge(base + live + [R('_toolkit', KIT_OK)] * 3)
    assert more['exposure_ready'] == 1, 'kit 13, smelt 13'
    # the primary moves the right way
    better = judge(base + live + [R('_toolkit', KIT_OK)] * 10)
    assert better['no_iron_per_attempt_did'] < 0 and better['crafted_per_attempt_did'] > 0, better
    # DEFECTS: each fails on its fixture
    assert judge(base + [R('_index_search', IX.replace('ix=3', 'ix=23'))])['ix_over_cand'] == 1, 'D1'
    assert judge(base + [R('_index_search', IX.replace('ix=3', 'ix=0'))])['first_ix_unranked'] == 1, 'D2'
    assert judge(base + [R('_index_search', IX.replace('ix=3', 'ix=0').replace('first=ix', 'first=near'))])['first_ix_unranked'] == 0, 'D2 control'
    assert judge(base + [R('_kit_sticks', KS.replace('took=6', 'took=7'))])['sticks_over_want'] == 1, 'D3'
    assert judge(base + [R('_index_search', IX.replace('visits=1', 'visits=13'))])['pass_over_budget'] == 1, 'D4 toolkit'
    assert judge(base + [R('_index_search', IXS.replace('visits=1', 'visits=16'))])['pass_over_budget'] == 0, 'D4 control: the smelt budget is 16'
    assert judge(base + [R('_kit_sticks', KS.replace('visits=1', 'visits=5'))])['pass_over_budget'] == 1, 'D4 kit_sticks'
    assert judge(base + [R('_index_search', IX.replace('took=1', 'took=0'))])['hit_without_take'] == 1, 'D5'
    # ARMS
    assert judge(base + [R('_index_search', IX, arm='control', bot='hive-c-Alpha')])['rows_control_post'] == 1, 'ARMS'
    pre = judge(base + [R('_index_search', IX, per='pre')])
    assert pre['rows_control_post'] == 0 and pre['rows_pre_earlier_build'] == 1 and pre['ix_over_cand'] == 0, pre
    # LIVENESS / INSTRUMENT
    assert judge(base)['liveness'] == 0, 'no licence: not live'
    assert judge([r for r in base if r['arm'] == 'canary'])['instrument_control'] == 0, 'blind without control'
    # the withdraw_pick gate: noise is not a failure; a large real drop is
    worse = judge(base + [R('_withdraw_pick', WP_NO)] * 6)
    assert worse['withdraw_pick_ok_did'] < WP_TOL and worse['withdraw_pick_gate'] == 1, ('within 2 SE', worse['withdraw_pick_ok_did'], worse['withdraw_pick_ok_z'])
    big = []
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            okn = 60 if (per, arm) == ('post', 'canary') else 150
            big += [R('_withdraw_pick', WP_OK, per=per, arm=arm)] * okn + [R('_withdraw_pick', WP_NO, per=per, arm=arm)] * (200 - okn)
    assert judge(big)['withdraw_pick_gate'] == 0, 'a real drop'
    assert judge([R('_withdraw_pick', WP_OK)] * 3)['withdraw_pick_ok_did'] is None, 'thin: null'
    assert pool_of('self-isolated-b-Comet') == 'isolated-b'
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
            offbuild += 1
            continue
        bots[(per, arm)].add(b)
        name = (((r.get('raw') or {}).get('skill') or {}).get('name')) or r.get('name')
        if name in KEEP:
            rows.append({'t': t, 'per': per, 'arm': arm, 'name': name, 'status': ((r.get('raw') or {}).get('skill') or {}).get('status'), 'detail': r.get('detail') or '', 'bot': b})
    res = judge(rows)
    hrs = {k: len(v) * W / 60 for k, v in bots.items()}
    fz = lambda d, z: 'null' if d is None else '%+.3f (z %+.2f)' % (d, z)
    sh = lambda a, b: '%d/%d' % (res[a], res[b])
    print('DENOMINATORS rows walked %d (canary rows on another build skipped %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, offbuild, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs.get(('post', 'canary'), 0), hrs.get(('post', 'control'), 0)))
    print('KIT          attempts canary %d -> %d control %d -> %d | PRIMARY no_iron per attempt canary %s -> %s control %s -> %s DiD %s (should FALL); unfound DiD %s; crafted DiD %s (should RISE)'
          % (res['kit_pre_canary'], res['kit_post_canary'], res['kit_pre_control'], res['kit_post_control'],
             sh('no_iron_pre_canary', 'kit_pre_canary'), sh('no_iron_post_canary', 'kit_post_canary'), sh('no_iron_pre_control', 'kit_pre_control'), sh('no_iron_post_control', 'kit_post_control'),
             fz(res['no_iron_per_attempt_did'], res['no_iron_per_attempt_z']), fz(res['unfound_per_attempt_did'], res['unfound_per_attempt_z']), fz(res['crafted_per_attempt_did'], res['crafted_per_attempt_z'])))
    print('SMELT        jobs canary %d -> %d control %d -> %d | PRIMARY no_fuel per job canary %s -> %s control %s -> %s DiD %s (should FALL); fuel_unfound DiD %s'
          % (res['job_pre_canary'], res['job_post_canary'], res['job_pre_control'], res['job_post_control'],
             sh('no_fuel_pre_canary', 'job_pre_canary'), sh('no_fuel_post_canary', 'job_post_canary'), sh('no_fuel_pre_control', 'job_pre_control'), sh('no_fuel_post_control', 'job_post_control'),
             fz(res['no_fuel_per_job_did'], res['no_fuel_per_job_z']), fz(res['fuel_unfound_per_job_did'], res['fuel_unfound_per_job_z'])))
    print('GATE         withdraw_pick order success canary %s -> %s control %s -> %s DiD %s -> %s (WATCH below %.2f with z < -2)'
          % (sh('wp_ok_pre_canary', 'wp_pre_canary'), sh('wp_ok_post_canary', 'wp_post_canary'), sh('wp_ok_pre_control', 'wp_pre_control'), sh('wp_ok_post_control', 'wp_post_control'),
             fz(res['withdraw_pick_ok_did'], res['withdraw_pick_ok_z']), 'ok' if res['withdraw_pick_gate'] else 'DOWN', WP_TOL))
    print('LIVENESS     licence canary %d | _index_search canary %d by %s | _kit_sticks canary %d (took %d) | ARMS control rows after the deploy %d (must be 0); earlier-build rows before it %d'
          % (res['indexsearch_mode_post_canary'], res['index_search_post_canary'], res['passes_by'], res['kit_sticks_post_canary'], res['kit_sticks_took'], res['rows_control_post'], res['rows_pre_earlier_build']))
    print('DEFECTS      D1 ix>cand %d | D2 first=ix with ix=0 %d | D3 sticks over want %d | D4 a pass over its budget %d | D5 hit without a take %d %s'
          % (res['ix_over_cand'], res['first_ix_unranked'], res['sticks_over_want'], res['pass_over_budget'], res['hit_without_take'], res['_lists']))
    print('REPORTED     first container %s | passes that took %d, of which the index ranked the giver %d'
          % (res['first'], res['took_passes'], res['hit_passes']))
    print('EXPOSURE     -> %s (canary kit attempts %d need %d; canary smelt jobs %d need %d; pre ok %d) | INSTRUMENT control kit %d smelt %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['kit_post_canary'], EXPOSURE_KIT, res['job_post_canary'], EXPOSURE_SMELT, res['pre_ok'],
             res['kit_post_control'], res['job_post_control'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        emit('indexsearchread', W, {k: v for k, v in res.items() if not k.startswith('_')})
    except Exception as e:
        print('emit failed:', e)
