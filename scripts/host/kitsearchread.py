#!/usr/bin/env python3
# kitsearchread.py [window_min] -- the read for canary `toolkit-03` (the kit's iron draw is the TOWN SEARCH: every town
# container, nearest the bot, never twice in a run, a kit_iron miss lasting 60 min so the next run continues; the order's gate
# is the same rule). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM; difference-in-
# differences against control for the effect; DENOMINATORS FIRST.
#
# WHY (measured 10-19, ES 24 h + read-only RCON census 12:05Z): 521 kit runs ended no_iron and 156 crafted, while the town
# chests held 2,343 ingots and every town had 2-11 containers holding a kit's 4 + 4 kept. The draw looked in at most the 3
# containers nearest HOME (a walled-in or lidded double chest spent two of them); the nearest kit-sized holder was the 1st-11th
# nearest home (median 7th). Towns where it was within the first 4: 44 no_iron over 7 towns; 7th or later: 475 over 9.
#
# MEMORY: STREAMED (townsearchread's pattern): only the kinds below are held.
#
# THE CHANGE (rows only this build writes):
#   _toolkit_search_mode  once per spawn: the licence (proves the build is live, not the effect)
#   _toolkit phase=kit    now carries, right after credit=, `town=<containers> cand=<candidates at start> visits=<n>
#                         vfail=<visits that could not look inside> maxrep=<most visits to one container> left=<candidates left>`
#                         (counted over the whole run before the 300-character cut); outcome `more` (the search was cut by its
#                         budget with candidates left: no backoff, the next run continues) is new
#
#   _kit_search           one per kit run whose draw searched; its duration spans the walks (the change row)
#   _smelt_town           now carries `looked=<containers> more=cu|coal|-` at the end (the smelt job's own search, same change)
#
#   ATTEMPTS   kit rows with an outcome that tried to make the kit (everything but nothing/off)
#   METRICS
#     crafted        outcome crafted | partial                    per BOT-HOUR, DiD  (PRIMARY, reported)
#     no_iron        outcome no_iron                              per ATTEMPT, DiD of the proportions (should FALL)
#     unfound        outcome no_iron | more | stalled | unseen | no_sticks   per ATTEMPT, DiD (should FALL too: a new outcome
#                                                                 must not merely relabel a no_iron)
#   LIVENESS   search_rows_canary: canary kit rows carrying town= (the search ran) >= 1; licence rows reported
#   ARMS       control kit rows with town=, or control licence rows, after the deploy (must be 0)
#   DEFECTS (each REVERTS; each has a failing fixture in --selftest)
#     D1 rep_same_container: one canary run with maxrep >= 2 (the kit search opens a container at most once per run)
#     D2 visits_over_budget: one canary run with visits > VISIT_BUDGET (12)
#     D3 more_loop: one canary bot with >= MORE_LOOP_N `more` runs inside MORE_LOOP_MIN minutes (toolkit.mjs KIT_MORE_MAX caps
#        the no-backoff streak at 3 then backs off 30 min, so at most 4 fit; Claude r1 P2: a busy town could otherwise hand
#        every run new candidates for ever)
#     D4 smelt_churn: one canary bot with >= CHURN_N (13) smelt jobs inside CHURN_MIN (360) minutes that took copper and smelted
#        none (search_more | search_stalled | no_fuel with withdrawn > 0) and no smelting job between: the design's bound is
#        12 (3 trips of the 3-more cap, then the 6 h pause; six no_fuel pause it sooner)
#   SMELT (the same change, reported): ingots smelted per bot-h DiD; no_fuel per job DiD (should FALL) WITH its pairing
#              fuel_unfound = no_fuel | search_more | search_stalled per job; town_has_none per job; search_more (canary)
#   SEARCH TIME  _kit_search seconds per canary bot-h (what the walks cost)
#   REPORTED   `more` runs per attempt (canary); runs that began with cand=0 (the gate and the search disagreed: a tripwire);
#              visits / vfail per searched run; outcomes by arm; ingots drawn
#   INSTRUMENT control attempts >= 1 and control no_iron >= 1 (the population is visible in control)
#   EXPOSURE   canary kit rows carrying town= in the window >= EXPOSURE_RUNS, AND pre-window attempts on both arms >= 1 (the
#              DiD has a baseline; Codex r1 P4). A bot with an EARLIER kit-search build's rows in the pre window leaves the pre
#              window WHOLE -- its rows and its bot-hours (Codex r1 P4: dropping only the rows biased the pre rate down).
#   NOTE       no_iron per attempt can fall merely because no-backoff `more` runs add attempts: read it WITH unfound
import sys, os, json, re, glob, gzip
import datetime as dt
from collections import Counter, defaultdict

KEEP = ('_toolkit', '_toolkit_search_mode', '_kit_search', '_smelt_town')
KV = re.compile(r'(?:^| )([a-z_]+)=(\S+)')
VISIT_BUDGET = 12          # toolkit.mjs KIT_SEARCH_VISITS
REP_MAX = 1                # a container is opened at most once per run
EXPOSURE_RUNS = 6
MORE_LOOP_N = 5
MORE_LOOP_MIN = 45
# D4: smeltjob.mjs bounds a churning job at SMELT_MORE_TRIPS (3) x (SMELT_MORE_MAX 3 + 1) = 12 copper-taking, non-smelting
# jobs before its 6 h pause (Claude r3 P1/P2: the 45-min window could never see the capped loop)
CHURN_N = 13
CHURN_MIN = 360
NOT_ATTEMPT = ('nothing', 'off')
CRAFTED = ('crafted', 'partial')
# every kit run that ended without the iron for a SEARCH reason (Codex r2 P2: a reclassified no_iron must stay counted)
UNFOUND = ('no_iron', 'more', 'stalled', 'unseen', 'no_sticks')


def kv(d):
    return {m.group(1): m.group(2) for m in KV.finditer(d or '')}


def pool_of(bot):
    b = (bot or '')
    if b.startswith('self-'):
        b = b[len('self-'):]
    return '-'.join(b.split('-')[:2])


def is_kit(r):
    return r['name'] == '_toolkit' and (r['detail'] or '').startswith('phase=kit ')


def outcome(r):
    return kv(r['detail']).get('outcome') or '?'


def is_attempt(r):
    return is_kit(r) and outcome(r) not in NOT_ATTEMPT


def searched(r):
    return is_kit(r) and ' town=' in ' %s' % r['detail']


def num(f, k, default=None):
    try:
        return int(f.get(k))
    except (TypeError, ValueError):
        return default


def stream(since, until, cut, cans, logroot='/var/log/mcai'):
    files = sorted(glob.glob(logroot + '/*/skill-*.jsonl'))
    for k in range(0, (until.date() - since.date()).days + 2):
        tag = (since.date() + dt.timedelta(days=k)).strftime('%Y%m%d')
        files += sorted(glob.glob(logroot + '/*/skill-*.jsonl-%s.gz' % tag))
    seen, kept, walked, bad = set(), [], 0, 0
    bots = defaultdict(set)
    s_iso, u_iso = since.strftime('%Y-%m-%dT%H:%M:%S'), until.strftime('%Y-%m-%dT%H:%M:%S')
    for f in files:
        try:
            fh = gzip.open(f, 'rt', errors='replace') if f.endswith('.gz') else open(f, errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                ts = line[15:34] if line.startswith('{"@timestamp":"') else None
                if ts is None or ts < s_iso or ts >= u_iso:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    bad += 1
                    continue
                sk = d.get('skill') or {}
                n = sk.get('name')
                b = (d.get('bot') or {}).get('name')
                key = (d.get('@timestamp'), b, n, sk.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                walked += 1
                t = dt.datetime.fromisoformat(d['@timestamp'].replace('Z', '+00:00'))
                arm = 'canary' if pool_of(b) in cans else 'control'
                per = 'post' if t >= cut else 'pre'
                if b:
                    bots[(per, arm)].add(b)
                if n in KEEP:
                    kept.append({'t': t, 'per': per, 'arm': arm, 'name': n, 'status': sk.get('status'), 'detail': sk.get('detail') or '', 'bot': b,
                                 'dur': sk.get('duration_ms') or 0})
    kept.sort(key=lambda r: r['t'])
    return kept, walked, bots, bad


def build_row(r):
    """A row only a kit-search build writes: town= on a kit row, the licence, `_kit_search`, a `_smelt_town` with looked=."""
    return searched(r) or r['name'] in ('_toolkit_search_mode', '_kit_search') or (r['name'] == '_smelt_town' and ' looked=' in ' %s' % r['detail'])


def earlier_build(r):
    """A PRE-window row only a kit-search build writes: an EARLIER canary of this change, never the baseline -- reported,
    not counted (townsearchread's Claude ts02 P1: the pre window grows with each read)."""
    return r['per'] == 'pre' and build_row(r)


def contaminated_bots(rows):
    """Bots with an earlier build's rows in the PRE window: their whole pre window leaves the read (rows AND bot-hours)."""
    return {r['bot'] for r in rows if earlier_build(r)}


def smelt_stop(r):
    return kv(r['detail']).get('stop') or '?'


def judge(rows):
    out = {}
    out['pre_earlier_build_canary'] = sum(1 for r in rows if r['arm'] == 'canary' and earlier_build(r))
    out['pre_earlier_build_control'] = sum(1 for r in rows if r['arm'] == 'control' and earlier_build(r))
    dirty = contaminated_bots(rows)
    out['pre_contaminated_bots'] = sorted(b for b in dirty if b)
    rows = [r for r in rows if not (r['per'] == 'pre' and r['bot'] in dirty)]
    for per in ('pre', 'post'):
        for arm in ('canary', 'control'):
            sel = [r for r in rows if r['per'] == per and r['arm'] == arm and is_attempt(r)]
            oc = Counter(outcome(r) for r in sel)
            sfx = '%s_%s' % (per, arm)
            out['attempts_' + sfx] = len(sel)
            out['crafted_' + sfx] = sum(oc.get(o, 0) for o in CRAFTED)
            out['no_iron_' + sfx] = oc.get('no_iron', 0)
            out['unfound_' + sfx] = sum(oc.get(o, 0) for o in UNFOUND)
            out['more_' + sfx] = oc.get('more', 0)
            out['drew_' + sfx] = sum(num(kv(r['detail']), 'drew', 0) for r in sel)
            out['outcomes_' + sfx] = dict(oc)
            sm = [r for r in rows if r['per'] == per and r['arm'] == arm and r['name'] == '_smelt_town']
            so = Counter(smelt_stop(r) for r in sm)
            out['smelt_jobs_' + sfx] = len(sm)
            out['smelted_' + sfx] = sum(num(kv(r['detail']), 'smelted', 0) for r in sm)
            out['no_fuel_' + sfx] = so.get('no_fuel', 0)
            out['town_has_none_' + sfx] = so.get('town_has_none', 0)
            out['search_more_' + sfx] = so.get('search_more', 0)
            # the pairing (Claude r2 P2): no_fuel can fall because search_more / search_stalled replace it -- read this one
            out['fuel_unfound_' + sfx] = so.get('no_fuel', 0) + so.get('search_more', 0) + so.get('search_stalled', 0)
    post_c = [r for r in rows if r['per'] == 'post' and r['arm'] == 'canary']
    s = [r for r in post_c if searched(r)]
    out['search_rows_canary'] = len(s)
    out['licence_canary'] = sum(1 for r in post_c if r['name'] == '_toolkit_search_mode')
    out['search_rows_control'] = sum(1 for r in rows if r['per'] == 'post' and r['arm'] == 'control' and (searched(r) or r['name'] == '_toolkit_search_mode'))
    reps, over, zero = [], [], []
    for r in s:
        f = kv(r['detail'])
        visits, maxrep, cand = num(f, 'visits', 0), num(f, 'maxrep', 0), num(f, 'cand')
        if maxrep > REP_MAX:
            reps.append((r['bot'], maxrep, str(r['t'])))
        if visits > VISIT_BUDGET:
            over.append((r['bot'], visits, str(r['t'])))
        if cand == 0:
            zero.append((r['bot'], outcome(r), str(r['t'])))
    loops = []
    by = defaultdict(list)
    for r in post_c:
        if is_kit(r) and outcome(r) == 'more':
            by[r['bot']].append(r['t'])
    for b, ts in by.items():
        ts.sort()
        for i in range(len(ts)):
            j = i + MORE_LOOP_N - 1
            if j < len(ts) and (ts[j] - ts[i]).total_seconds() <= MORE_LOOP_MIN * 60:
                loops.append((b, MORE_LOOP_N, str(ts[i]))); break
    out['more_loop'] = len(loops)
    # D4 smelt_churn: one canary bot with >= MORE_LOOP_N smelt jobs inside MORE_LOOP_MIN that each took copper and ended without
    # smelting (search_more / search_stalled / no_fuel with withdrawn > 0) -- the cap (SMELT_MORE_MAX) allows 4
    churn = []
    sby = defaultdict(list)
    for r in sorted((r for r in post_c if r['name'] == '_smelt_town'), key=lambda r: r['t']):
        if num(kv(r['detail']), 'smelted', 0) > 0:
            sby[r['bot']].append(None)                     # a smelting job ends the run
        elif smelt_stop(r) in ('search_more', 'search_stalled', 'no_fuel') and num(kv(r['detail']), 'withdrawn', 0) > 0:
            sby[r['bot']].append(r['t'])
    for b, seq in sby.items():
        run = []
        for t in seq + [None]:
            if t is None:
                for i in range(len(run)):
                    j = i + CHURN_N - 1
                    if j < len(run) and (run[j] - run[i]).total_seconds() <= CHURN_MIN * 60:
                        churn.append((b, CHURN_N, str(run[i]))); break
                if churn and churn[-1][0] == b:
                    break
                run = []
            else:
                run.append(t)
    out['smelt_churn'] = len(churn)
    out['search_s_canary'] = round(sum((r.get('dur') or 0) for r in post_c if r['name'] == '_kit_search') / 1000.0, 1)
    out['rep_same_container'] = len(reps)
    out['visits_over_budget'] = len(over)
    out['zero_cand_runs_canary'] = len(zero)
    out['visits_canary'] = dict(Counter(num(kv(r['detail']), 'visits', -1) for r in s))
    out['vfail_canary'] = sum(num(kv(r['detail']), 'vfail', 0) for r in s)
    out['cand_canary'] = dict(Counter(num(kv(r['detail']), 'cand', -1) for r in s))
    out['instrument_control'] = int(out['attempts_post_control'] >= 1 and out['no_iron_post_control'] >= 1)
    out['pre_ok'] = int(out['attempts_pre_canary'] >= 1 and out['attempts_pre_control'] >= 1)
    out['exposure_ready'] = int(out['search_rows_canary'] >= EXPOSURE_RUNS and out['pre_ok'] == 1)
    out['_lists'] = {'reps': reps[:5], 'over': over[:5], 'zero': zero[:5], 'loops': loops[:5], 'churn': churn[:5]}
    return out


def selftest():
    T0 = dt.datetime(2026, 10, 19, 12, 0, tzinfo=dt.timezone.utc)
    R = lambda name, detail, mins=0, bot='isolated-b-Alpha', arm='canary', per='post', status='success': {
        't': T0 + dt.timedelta(minutes=mins), 'per': per, 'arm': arm, 'name': name, 'status': status, 'detail': detail, 'bot': bot}
    # REAL ROWS (toolkit.mjs toolkitRow, node, 10-19): a crafted run, a cut no_iron run, a cut `more` run, and the BASE layout
    OK = 'phase=kit outcome=crafted needs=iron_axe+iron_shovel drew=4 sticks=3 used=4 crafted=iron_axe+iron_shovel credit=0->0 town=22 cand=22 visits=2 vfail=0 maxrep=1 left=0 stop=- before=iron_pickaxe@180 after=iron_axe@250,iron_pickaxe@180,iron_shovel@250 tried=[1,2,3:none;4,5,6:success]'
    NOI = 'phase=kit outcome=no_iron needs=iron_axe+iron_shovel drew=0 sticks=0 used=0 crafted=- credit=0->0 town=31 cand=14 visits=12 vfail=1 maxrep=1 left=0 stop=12_of_14_candidate(s)_tried before=iron_pickaxe@180,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@105,stone_axe@102,wooden_pickaxe@'
    MORE = 'phase=kit outcome=more needs=iron_axe+iron_shovel drew=0 sticks=0 used=0 crafted=- credit=0->0 town=31 cand=30 visits=12 vfail=0 maxrep=1 left=18 stop=- before=iron_pickaxe@180,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@105,stone_axe@102,wooden_pickaxe@42 after=iron_pickaxe@180,st'
    BASE = 'phase=kit outcome=no_iron needs=iron_axe+iron_shovel drew=0 sticks=0 used=0 crafted=- credit=0->0 stop=3_container(s)_tried before=iron_pickaxe@180,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@1,stone_pickaxe@105,stone_axe@102,wooden_pickaxe@42 after=iron_pickaxe@180,stone_pickaxe@1,stone_pickaxe@1'
    assert len(NOI) == 300 and len(MORE) == 300 and len(BASE) == 300
    MODE = 'phase=mode on=1 mode=on'
    LIC = 'phase=mode search=town need=kit_iron order=unknown,nearest visits=12 craft_reserve_s=60 no_backoff=kit_search_more'
    NOTHING = 'phase=kit outcome=nothing needs=- drew=0 sticks=0 used=0 crafted=- credit=0->0 stop=- before=- after=- tried=[]'
    ctl = [R('_toolkit', BASE, arm='control', bot='board-a-Alpha', status='failed')]
    ok = judge([R('_toolkit', OK), R('_toolkit', NOI, status='failed'), R('_toolkit', MORE, status='failed'), R('_toolkit_search_mode', LIC), R('_toolkit', MODE), R('_toolkit', NOTHING)] + ctl)
    assert ok['search_rows_canary'] == 3 and ok['licence_canary'] == 1 and ok['attempts_post_canary'] == 3, ok
    assert ok['crafted_post_canary'] == 1 and ok['no_iron_post_canary'] == 1 and ok['unfound_post_canary'] == 2 and ok['more_post_canary'] == 1, ok
    assert ok['rep_same_container'] == 0 and ok['visits_over_budget'] == 0 and ok['search_rows_control'] == 0 and ok['instrument_control'] == 1, ok
    assert ok['drew_post_canary'] == 4 and ok['zero_cand_runs_canary'] == 0, ok
    assert judge([R('_toolkit', NOI.replace(' maxrep=1 ', ' maxrep=2 '))] + ctl)['rep_same_container'] == 1, 'D1: one container twice in a run'
    assert judge([R('_toolkit', NOI.replace(' visits=12 ', ' visits=13 '))] + ctl)['visits_over_budget'] == 1, 'D2'
    assert judge([R('_toolkit', NOI)] + ctl)['visits_over_budget'] == 0, 'D2 control: the budget itself'
    assert judge([R('_toolkit', BASE)] + ctl)['search_rows_canary'] == 0, 'a base-shaped row is not the search'
    assert judge([R('_toolkit', BASE)] + ctl)['attempts_post_canary'] == 1, '...but it is an attempt'
    c = judge([R('_toolkit', OK, arm='control', bot='board-a-Alpha'), R('_toolkit_search_mode', LIC, arm='control', bot='board-a-Alpha')])
    assert c['search_rows_control'] == 2, c
    assert judge([R('_toolkit', OK, arm='control', bot='board-a-Alpha')])['instrument_control'] == 0, 'no control no_iron: blind'
    assert judge([R('_toolkit', MODE, arm='control', bot='board-a-Alpha')])['instrument_control'] == 0, 'a mode row is no attempt'
    PRE0 = [R('_toolkit', BASE, per='pre', status='failed'), R('_toolkit', BASE, arm='control', bot='board-a-Alpha', per='pre', status='failed')]
    assert judge([R('_toolkit', OK)] * EXPOSURE_RUNS + ctl + PRE0)['exposure_ready'] == 1 and judge([R('_toolkit', OK)] * (EXPOSURE_RUNS - 1) + ctl + PRE0)['exposure_ready'] == 0
    assert judge([R('_toolkit', OK)] * EXPOSURE_RUNS + ctl)['exposure_ready'] == 0, 'no pre baseline: not ready (Codex r1 P4)'
    z = judge([R('_toolkit', NOI.replace(' cand=14 ', ' cand=0 '))] + ctl)
    assert z['zero_cand_runs_canary'] == 1, z
    # an EARLIER toolkit-03 canary's rows in the PRE window are reported, never counted; after the deploy they are a breach
    prev = [R('_toolkit', OK, arm='control', bot='placebo-d-Alpha', per='pre'), R('_toolkit_search_mode', LIC, arm='control', bot='hive-c-Alpha', per='pre')]
    pv = judge(prev + ctl)
    assert pv['search_rows_control'] == 0 and pv['pre_earlier_build_control'] == 2 and pv['attempts_pre_control'] == 0, pv
    assert judge([R('_toolkit', OK, arm='control', bot='placebo-d-Alpha')] + ctl)['search_rows_control'] == 1, 'post-deploy: a breach'
    assert judge([R('_toolkit', BASE, arm='control', bot='board-a-Alpha', per='pre')] + ctl)['attempts_pre_control'] == 1, 'a base-shaped pre row still counts'
    PRE = [R('_toolkit', BASE, per='pre', status='failed'), R('_toolkit', BASE, arm='control', bot='board-a-Alpha', per='pre', status='failed')]
    assert judge([R('_toolkit', OK)] * EXPOSURE_RUNS + ctl + PRE)['exposure_ready'] == 1, 'with a pre baseline on both arms'
    # Codex r1 P4: an earlier build's bot leaves the pre window WHOLE (its baseline-shaped rows too); its bot is named
    dirty = judge([R('_toolkit', OK, per='pre', bot='hive-c-Bravo'), R('_toolkit', BASE, per='pre', bot='hive-c-Bravo', status='failed')] + PRE + ctl)
    assert dirty['pre_contaminated_bots'] == ['hive-c-Bravo'] and dirty['attempts_pre_canary'] == 1, dirty
    assert contaminated_bots([R('_kit_search', 'outcome=took need=kit_iron town=3 cand=3 visits=1 vfail=0 maxrep=1 left=0 tried=[]', per='pre', bot='x-y-Z')]) == {'x-y-Z'}
    # D3: five `more` runs of one bot inside 45 min trip; four (the cap's most) do not; five spread over 2 h do not
    assert judge([R('_toolkit', MORE, mins=m) for m in (0, 10, 20, 30, 40)] + ctl)['more_loop'] == 1, 'D3'
    assert judge([R('_toolkit', MORE, mins=m) for m in (0, 10, 20, 30)] + ctl)['more_loop'] == 0, 'D3 control: the cap allows 4'
    assert judge([R('_toolkit', MORE, mins=m) for m in (0, 10, 20, 30, 70)] + ctl)['more_loop'] == 0, 'D3 control: after the backoff'
    # the change row's seconds; the smelt job's rows (real smeltTownDetail strings, node 10-19)
    ks = R('_kit_search', 'outcome=took need=kit_iron town=10 cand=10 visits=10 vfail=0 maxrep=1 left=0 tried=[1,2,3:none]')
    ks['dur'] = 12500
    assert judge([ks] + ctl)['search_s_canary'] == 12.5
    SM_OK = 'stop=done n=8 bag0=0 withdrawn=8 coal=1 smelted=8 prior=0 deposited=8 dep_i=8 dep_r=0 bag1=0 left=0 furnace=277,64,-378 lease=13 verdict=ok diff=0 chest=281,64,-388 t0=1792325822037 fb=- looked=4 more=-'
    SM_NF = 'stop=no_fuel n=0 bag0=0 withdrawn=8 coal=0 smelted=0 prior=0 deposited=8 dep_i=0 dep_r=8 bag1=0 left=0 furnace=- lease=- verdict=ok diff=0 chest=356,72,147 t0=1792325767330 fb=-'
    SM_MORE = 'stop=search_more n=0 bag0=0 withdrawn=0 coal=0 smelted=0 prior=0 deposited=0 dep_i=0 dep_r=0 bag1=0 left=0 furnace=- lease=- verdict=ok diff=0 chest=- t0=1 fb=- looked=12 more=cu'
    sj = judge([R('_smelt_town', SM_OK), R('_smelt_town', SM_MORE, status='no_effect'), R('_smelt_town', SM_NF, arm='control', bot='board-a-Alpha', status='no_effect')] + ctl)
    assert sj['smelt_jobs_post_canary'] == 2 and sj['smelted_post_canary'] == 8 and sj['search_more_post_canary'] == 1 and sj['no_fuel_post_control'] == 1, sj
    assert contaminated_bots([R('_smelt_town', SM_OK, per='pre', bot='a-b-C')]) == {'a-b-C'} and contaminated_bots([R('_smelt_town', SM_NF, per='pre')]) == set(), 'a base smelt row has no looked='
    # RELABELLING CANNOT IMPROVE unfound (Codex r2 P2): the same failures as stalled / unseen / no_sticks count the same
    for oc in ('stalled', 'unseen', 'no_sticks'):
        rl = judge([R('_toolkit', NOI.replace('outcome=no_iron', 'outcome=' + oc), status='failed')] + ctl)
        assert rl['unfound_post_canary'] == 1 and rl['no_iron_post_canary'] == 0, (oc, rl)
    SM_MOREC = SM_MORE.replace('withdrawn=0', 'withdrawn=8')
    capped = [m for c in range(4) for m in (c * 50, c * 50 + 10, c * 50 + 20, c * 50 + 30)]   # the cap's pattern, 4 cycles = 16 jobs
    assert judge([R('_smelt_town', SM_MOREC, mins=m, status='no_effect') for m in capped] + ctl)['smelt_churn'] == 1, 'D4: the capped loop past its bound'
    assert judge([R('_smelt_town', SM_MOREC, mins=m, status='no_effect') for m in capped[:12]] + ctl)['smelt_churn'] == 0, 'D4 control: the design bound (12)'
    assert judge([R('_smelt_town', SM_MOREC, mins=m, status='no_effect') for m in capped[:8]] + [R('_smelt_town', SM_OK, mins=85)]
                 + [R('_smelt_town', SM_MOREC, mins=m, status='no_effect') for m in capped[8:]] + ctl)['smelt_churn'] == 0, 'D4 control: a smelt between'
    assert judge([R('_smelt_town', SM_MORE, mins=m, status='no_effect') for m in capped] + ctl)['smelt_churn'] == 0, 'D4 control: no copper taken'
    rf = judge([R('_smelt_town', SM_MOREC, status='no_effect'), R('_smelt_town', SM_NF, status='no_effect')] + ctl)
    assert rf['fuel_unfound_post_canary'] == 2 and rf['no_fuel_post_canary'] == 1, rf
    assert pool_of('self-isolated-b-Comet') == 'isolated-b' and pool_of('hive-d-Alpha') == 'hive-d'
    assert kv(NOI)['visits'] == '12' and kv(NOI)['left'] == '0' and kv(MORE)['left'] == '18', 'the counters survive the 300-character cut'
    print('SELFTEST ok: every gate fails on its fixture and passes its control')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
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
    rows, walked, bots, bad = stream(PRE, END, CUT, CANS)
    res = judge(rows)
    for arm in ('canary', 'control'):
        bots[('pre', arm)] -= set(res['pre_contaminated_bots'])
    hrs = lambda per, arm: len(bots[(per, arm)]) * W / 60
    rate = lambda n, per, arm: n / hrs(per, arm) if hrs(per, arm) else float('nan')
    prop = lambda k, per, arm: res['%s_%s_%s' % (k, per, arm)] / res['attempts_%s_%s' % (per, arm)] if res['attempts_%s_%s' % (per, arm)] else float('nan')
    did_rate = lambda k: (rate(res[k + '_post_canary'], 'post', 'canary') - rate(res[k + '_pre_canary'], 'pre', 'canary')) \
        - (rate(res[k + '_post_control'], 'post', 'control') - rate(res[k + '_pre_control'], 'pre', 'control'))
    did_prop = lambda k: (prop(k, 'post', 'canary') - prop(k, 'pre', 'canary')) - (prop(k, 'post', 'control') - prop(k, 'pre', 'control'))
    sprop = lambda k, per, arm: res['%s_%s_%s' % (k, per, arm)] / res['smelt_jobs_%s_%s' % (per, arm)] if res['smelt_jobs_%s_%s' % (per, arm)] else float('nan')
    did_sprop = lambda k: (sprop(k, 'post', 'canary') - sprop(k, 'pre', 'canary')) - (sprop(k, 'post', 'control') - sprop(k, 'pre', 'control'))
    dids_f = did_sprop('fuel_unfound')
    dids = {'crafted': did_rate('crafted'), 'no_iron_per_attempt': did_prop('no_iron'), 'unfound_per_attempt': did_prop('unfound'), 'drew': did_rate('drew'),
            'smelted': did_rate('smelted'), 'no_fuel_per_job': did_sprop('no_fuel'), 'town_has_none_per_job': did_sprop('town_has_none'),
            'fuel_unfound_per_job': dids_f}
    print('DENOMINATORS rows walked %d (unparsable %d) | bots pre canary %d control %d | post canary %d control %d | window %d min | bot-h post canary %.1f control %.1f'
          % (walked, bad, len(bots[('pre', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'canary')]), len(bots[('post', 'control')]), W,
             hrs('post', 'canary'), hrs('post', 'control')))
    print('ATTEMPTS     kit runs that tried (not nothing/off) canary %d -> %d control %d -> %d'
          % (res['attempts_pre_canary'], res['attempts_post_canary'], res['attempts_pre_control'], res['attempts_post_control']))
    print('PRIMARY      kits crafted (crafted|partial) canary %d -> %d control %d -> %d | per bot-h canary %.3f -> %.3f control %.3f -> %.3f | DiD %+.3f /bot-h'
          % (res['crafted_pre_canary'], res['crafted_post_canary'], res['crafted_pre_control'], res['crafted_post_control'],
             rate(res['crafted_pre_canary'], 'pre', 'canary'), rate(res['crafted_post_canary'], 'post', 'canary'),
             rate(res['crafted_pre_control'], 'pre', 'control'), rate(res['crafted_post_control'], 'post', 'control'), dids['crafted']))
    print('             pre-window bots of an EARLIER kit-search build, left out whole (rows and bot-hours): %s' % (res['pre_contaminated_bots'] or '-'))
    print('NO IRON      per attempt (read WITH the next line: no-backoff `more` runs add attempts): canary %d/%d -> %d/%d control %d/%d -> %d/%d | DiD %+.3f (should FALL)'
          % (res['no_iron_pre_canary'], res['attempts_pre_canary'], res['no_iron_post_canary'], res['attempts_post_canary'],
             res['no_iron_pre_control'], res['attempts_pre_control'], res['no_iron_post_control'], res['attempts_post_control'], dids['no_iron_per_attempt']))
    print('             unfound (no_iron|more|stalled|unseen|no_sticks) per attempt: canary %d/%d -> %d/%d control %d/%d -> %d/%d | DiD %+.3f (`more` must not merely relabel)'
          % (res['unfound_pre_canary'], res['attempts_pre_canary'], res['unfound_post_canary'], res['attempts_post_canary'],
             res['unfound_pre_control'], res['attempts_pre_control'], res['unfound_post_control'], res['attempts_post_control'], dids['unfound_per_attempt']))
    print('LIVENESS     canary kit rows with the search (town=) %d | licence rows %d | control rows with town= or the licence after the deploy %d (must be 0)'
          % (res['search_rows_canary'], res['licence_canary'], res['search_rows_control']))
    print('             pre-window rows of an EARLIER kit-search build (not counted): canary %d control %d'
          % (res['pre_earlier_build_canary'], res['pre_earlier_build_control']))
    print('DEFECTS      D1 a container opened %d+ times in one run %d %s | D2 more than %d visits in one run %d %s'
          % (REP_MAX + 1, res['rep_same_container'], res['_lists']['reps'], VISIT_BUDGET, res['visits_over_budget'], res['_lists']['over']))
    print('             D3 a bot with %d+ `more` runs inside %d min %d %s' % (MORE_LOOP_N, MORE_LOOP_MIN, res['more_loop'], res['_lists']['loops']))
    print('SMELT        jobs canary %d -> %d control %d -> %d | ingots smelted canary %d -> %d control %d -> %d (DiD %+.3f /bot-h) | no_fuel per job DiD %+.3f (should FALL; read WITH no_fuel|search_more|search_stalled per job DiD %+.3f) | town_has_none per job DiD %+.3f | search_more canary %d | D4 smelt churn (>= 13 copper-taking non-smelting jobs of one bot in 6 h) %d %s'
          % (res['smelt_jobs_pre_canary'], res['smelt_jobs_post_canary'], res['smelt_jobs_pre_control'], res['smelt_jobs_post_control'],
             res['smelted_pre_canary'], res['smelted_post_canary'], res['smelted_pre_control'], res['smelted_post_control'], dids['smelted'],
             dids['no_fuel_per_job'], dids['fuel_unfound_per_job'], dids['town_has_none_per_job'], res['search_more_post_canary'], res['smelt_churn'], res['_lists']['churn']))
    print('SEARCH TIME  _kit_search seconds canary %.1f (%.1f s per canary bot-h)' % (res['search_s_canary'], res['search_s_canary'] / hrs('post', 'canary') if hrs('post', 'canary') else float('nan')))
    print('REPORTED     `more` runs canary %d of %d attempts | runs that began with NO candidate (gate/search disagreement, tripwire) %d %s'
          % (res['more_post_canary'], res['attempts_post_canary'], res['zero_cand_runs_canary'], res['_lists']['zero']))
    print('             visits per searched run %s | visits that could not look inside %d | candidates at start %s'
          % (res['visits_canary'], res['vfail_canary'], res['cand_canary']))
    print('             ingots drawn canary %d -> %d control %d -> %d (DiD %+.3f /bot-h) | outcomes post canary %s control %s'
          % (res['drew_pre_canary'], res['drew_post_canary'], res['drew_pre_control'], res['drew_post_control'], dids['drew'],
             res['outcomes_post_canary'], res['outcomes_post_control']))
    print('EXPOSURE     -> %s (canary kit rows with the search %d, need %d; pre attempts canary %d control %d) | INSTRUMENT control attempts %d, control no_iron %d -> %s'
          % ('READY' if res['exposure_ready'] else 'NOT YET', res['search_rows_canary'], EXPOSURE_RUNS, res['attempts_pre_canary'], res['attempts_pre_control'],
             res['attempts_post_control'], res['no_iron_post_control'], 'ok' if res['instrument_control'] else 'BLIND'))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        clean = lambda v: None if v != v else round(v, 4)
        emit('kitsearchread', W, {k: v for k, v in res.items() if not k.startswith('_')} | {'%s_did' % k: clean(v) for k, v in dids.items()})
    except Exception as e:
        print('emit failed:', e)
