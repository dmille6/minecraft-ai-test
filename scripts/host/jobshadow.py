#!/usr/bin/env python3
"""JOB SHADOW (jobshadow-01; docs/reports/job-assigner-2026-11-03.md stage 1; owner 11-03 gap 4, ledger `jobassign-1103`).
Tooling: a host read on the canary host, every 10 min. NOTHING ON A BOT CHANGES: it writes only ~/jobshadow/out and one line to
~/digest/jobshadow.log; it never writes into a pool directory (jobfacts.mjs is read-only) and no bot reads anything it writes.

Each run is ONE TICK of the rule-based town job assigner (scripts/lib/jobrules.py) for each of the 16 towns (pool = town):
  facts   jobfacts.mjs over /var/lib/mcai/_pool-<pool> with the fleet tree's own modules (project records, live leases, the town
          index), the flow ledger's chest stock (~/flowledger/out/latest.json, hourly), and Events over the last WINDOW_MIN:
          each bot's newest position / health / bag, flags (a death, drowning, trap or entombment row in 5 min; health <= 10)
  rules   demand -> assign (hysteresis, term, rest, fairness, caps; state in ~/jobshadow/out/state.json) -> options (the mayor
          hook: opt0 = the rules, up to 3 alternatives, `choices`)
  actual  what each bot DID: role work classified from its rows (ROLE_OF below); interval = the row's own duration
  logged  one `tick` row per town: needs, staffing, events, options, actual role-minutes per bot, COVERAGE (a role with demand on
          and a supported feature: did ANY bot of the town do that role's work in the last 60 min); and `eval` rows for the
          ticks 30-60 min old: did each assigned bot do its role's work in the 30 min after the tick -- for the rules AND for a
          seeded random staffing of the same size (the placebo). CONCORDANCE IS PREDICTION, NOT EFFECT: reported, never a gate.

POSITIVE CONTROLS (a run that fails one writes an ERROR line, never a quiet zero): rows walked > 0, >= 40 bots, `_build_visit`
found by Events.count (raises ZeroLooksWrong on a 0), jobfacts read >= 12 of the pools seen in the rows. Every number in the
summary carries its denominator.

    python3 -B host/jobshadow.py run [--print] [--window-min 70]
    python3 -B host/jobshadow.py summary [--hours 24]          (the 24-h read and the stage-1 go/no-go, from the tick files)
"""
import argparse
import datetime as dt
import glob
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import zlib
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import jobrules as JR  # noqa: E402

UTC = dt.timezone.utc
HOME = os.path.expanduser('~')
WINDOW_MIN = 70
COVER_MIN = 60            # coverage looks back this far
EVAL_MIN = 30             # concordance looks forward this far from a tick
TOWN_R, TOWN_DY = 48, 12  # staffcensus / treefarm farmOrder's at-town predicate
FLAG_MIN = 5
SEEN_KEEP_H = 24
POOLS_DIR = '/var/lib/mcai'
BOTS_SRC = '/opt/minecraft-ai/bots/src'
TELEMETRY = '/opt/minecraft-ai/scripts/lib/telemetry.py'
LOGS = '/var/log/mcai/*/skill-*.jsonl*'
OUT_DIR = f'{HOME}/jobshadow/out'
DIGEST_LOG = f'{HOME}/digest/jobshadow.log'
FLOW_LATEST = f'{HOME}/flowledger/out/latest.json'
MIN_BOTS = 40
RUN_EVERY_MIN = 10        # the cron cadence (install-jobshadow.sh): the schedule the validity gate expects
# the fleet's 16 towns (owner shape: 80 bots / 16 towns): a town that drops out of the rows is a MISSING tick, not absent
EXPECTED_POOLS = tuple(f'{g}-{c}' for g in ('board', 'hive', 'isolated', 'placebo') for c in 'abcd')
MIN_TOWNS_READ = 12

ORES = re.compile(r'(_ore$|^stone$|^cobblestone$|^deepslate$|^andesite$|^diorite$|^granite$|^tuff$|^obsidian$)')
LOGS_RE = re.compile(r'(_log$|_stem$|_sapling$|^bamboo$)')
NO_WORK = {'no_site', 'no_support', 'no_slot', 'busy', 'waiting', 'copper_wait', 'off', 'refused', 'lease_busy'}
# B5's flag set narrowed to what holds the body: `_entombed` is a ROUTINE reflex (107 rows / 10 min fleet-wide, measured 11-03),
# flagging it left 1-2 of 5 bots eligible; its unrecoverable form, a trap, a drowning or a death do flag
FLAG_RE = re.compile(r'(^_?death$|drown|trapped|unrecoverable|suffocat)', re.I)
SMELT = {'smelt_town', 'furnace_drain', 'make_material', 'smelt'}
EXPLORE = {'explore', 'expedition'}


def canon(n):
    return n[1:] if isinstance(n, str) and n.startswith('_') else n


# ------------------------------------------------------------------------------------------------ pure helpers
PROGRESS_RE = re.compile(r'\b(placed|cleared|planted|dug|filled|felled|repaired)=(\d+)')
# the producers' own vocabularies (skills.mjs deepRow / exRow, 11-03): which ops MOVED something, which are only attempts.
# review r2 (Codex): `branch n=0`, `pickaxe why=not_made`, `marker_skip` are attempts, never progress
DEEP_ALWAYS = {'landing', 'deepen', 'seal', 'surfaced'}
DEEP_TRY = {'start', 'turn', 'repair', 'ore', 'branch', 'pickaxe', 'end'}
EXP_PROGRESS = {'start', 'marker', 'deposit', 'detour', 'home_follow'}
EXP_TRY = {'turn', 'aborted', 'marker_skip', 'torch_skip'}


def _num(det, k):
    m = re.search(rf'\b{k}=(\d+)\b', det)
    return int(m.group(1)) if m else 0


def deep_progress(op, det):
    if op in DEEP_ALWAYS:
        return True
    if op in ('ore', 'branch'):
        return _num(det, 'n') > 0
    if op == 'repair':
        return 'repaired' in det
    if op == 'pickaxe':
        return re.search(r'\bwhy=made\b', det) is not None
    return False


def role_of(name, args, detail, status, complete_plots=()):
    """-> (role, project, progress) of one row, or (None, None, False). PURE. progress True = the row shows the role's work
    MOVED something (review r1: an attempt that placed nothing must not read as coverage); False with a role = an attempt.
    A build visit's role is its project's: the tidy is the groundskeeper's, the yard the clerk's, a COMPLETE tree farm's upkeep
    the farmer's; every other project is building. Its progress is placed + cleared + planted (+ dug/filled/felled/repaired) > 0;
    a visit that never started (outcome in NO_WORK, or a visit row with no counts at all) is not role work."""
    n = canon(name or '')
    det = detail or ''
    if n == 'build_visit':
        m = re.search(r'\bproject=(\S+)', det)
        o = re.search(r'\boutcome=(\S+)', det)
        counts = PROGRESS_RE.findall(det)
        if not m or (o and o.group(1) in NO_WORK) or not counts:
            return None, None, False
        p = m.group(1)
        prog = sum(int(v) for _, v in counts) > 0
        if p == 'tidy':
            return 'groundskeeper', p, prog
        if p == 'yard':
            return 'clerk', p, prog
        if p == 'treefarm' and p in complete_plots:
            return 'farmer', p, prog
        return 'builder', p, prog
    if (name or '').startswith('_'):
        op = re.search(r'\bop=(\w+)', det)
        op = op.group(1) if op else None
        if n == 'deepmine' and op in DEEP_ALWAYS | DEEP_TRY:
            return 'deep_miner', None, status != 'no_effect' and deep_progress(op, det)
        if n == 'expedition' and op in EXP_PROGRESS | EXP_TRY:
            return 'explorer', None, status != 'no_effect' and op in EXP_PROGRESS
        return None, None, False
    ok = status == 'success'
    if status in ('no_effect', 'refused'):
        return None, None, False
    if n == 'deep_mine':
        return 'deep_miner', None, ok
    if n == 'mine':
        return 'miner', None, ok
    if n == 'gather':
        b = str((args or {}).get('block') or '')
        if ORES.search(b):
            return 'miner', None, ok
        if LOGS_RE.search(b):
            return 'farmer', None, ok
        return None, None, False
    if n in SMELT:
        return 'smelter', None, ok
    if n in EXPLORE:
        return 'explorer', None, ok
    return None, None, False


def interval(r):
    """-> (start, end) datetimes of a row's work. Skill rows are stamped at their START (staffcensus, measured 10-19); a build
    visit row is written at the visit's END with its own ms."""
    d = r.get('ms') or 0
    if r['name'] == '_build_visit':
        return r['t'] - dt.timedelta(milliseconds=d), r['t']
    return r['t'], r['t'] + dt.timedelta(milliseconds=d)


def slots_used(inv):
    return sum(math.ceil(v / 64) for v in (inv or {}).values() if isinstance(v, (int, float)) and v > 0)


def norm(raw):
    sk = raw.get('skill') or {}
    if not sk.get('name'):
        return None
    try:
        t = dt.datetime.fromisoformat(str(raw.get('@timestamp', '')).replace('Z', '+00:00'))
    except ValueError:
        return None
    b = raw.get('bot') or {}
    det = sk.get('detail') or ''
    ms = sk.get('duration_ms')
    if sk['name'] == '_build_visit':
        m = re.search(r'\bms=(\d+)', det)
        ms = int(m.group(1)) if m else ms
    return {'t': t, 'name': sk['name'], 'bot': b.get('name'), 'pool': (raw.get('exp') or {}).get('pool'),
            'pos': b.get('pos') if isinstance(b.get('pos'), dict) else None, 'hp': b.get('health'),
            'inv': b.get('inventory') if isinstance(b.get('inventory'), dict) else None, 'args': sk.get('args') or {},
            'detail': det, 'status': sk.get('status'), 'fail_class': sk.get('fail_class'), 'ms': ms if isinstance(ms, (int, float)) else 0}


def bot_facts(rows, home, now):
    """-> [{bot, seen_min, flagged, at_town, free_slots, hp}] for one town's rows (sorted by time). PURE."""
    last, flag = {}, set()
    for r in rows:
        if r['bot'] is None:
            continue
        if r['pos'] is not None:
            last[r['bot']] = r
        else:
            last.setdefault(r['bot'], r)
        age = (now - r['t']).total_seconds() / 60
        if age <= FLAG_MIN and (FLAG_RE.search(r['name']) or FLAG_RE.search(str(r.get('fail_class') or ''))):
            flag.add(r['bot'])
    out = []
    for b, r in sorted(last.items()):
        p = r['pos'] or {}
        at = (home is not None and p and math.hypot(p.get('x', 1e9) - home['x'], p.get('z', 1e9) - home['z']) <= TOWN_R
              and abs(p.get('y', 1e9) - home['y']) <= TOWN_DY)
        hp = r['hp'] if isinstance(r['hp'], (int, float)) else None
        out.append({'bot': b, 'seen_min': round((now - r['t']).total_seconds() / 60, 1), 'at_town': bool(at), 'hp': hp,
                    'flagged': b in flag or (hp is not None and hp <= 10),
                    'free_slots': 36 - slots_used(r['inv']) if r['inv'] is not None else None})
    return out


def work_spans(rows, complete_plots):
    """-> {bot: [(start, end, role, project, progress)]}. PURE."""
    out = defaultdict(list)
    for r in rows:
        role, proj, prog = role_of(r['name'], r['args'], r['detail'], r['status'], complete_plots)
        if role and r['bot']:
            s, e = interval(r)
            out[r['bot']].append((s, e, role, proj, prog))
    return out


def did(spans, bot, role, a, b, progress=True):
    """Did `bot` do `role` work overlapping [a, b]? progress True: work that MOVED something; False: any attempt. PURE."""
    return any(rl == role and s <= b and e >= a and (pg or not progress) for s, e, rl, _, pg in spans.get(bot, ()))


def role_minutes(spans, a, b):
    """-> {bot: {role: minutes inside [a, b]}}. PURE."""
    out = defaultdict(Counter)
    for bot, xs in spans.items():
        for s, e, rl, _, _pg in xs:
            o = (min(e, b) - max(s, a)).total_seconds() / 60
            if o > 0:
                out[bot][rl] += o
            elif s <= b and e >= a:
                out[bot][rl] += 0.0
    return {k: {r: round(v, 1) for r, v in c.items()} for k, c in out.items()}


def native_holders(facts):
    """-> {role: [bot]} from the live module leases (native ownership wins in the rules). PURE."""
    L = facts.get('leases') or {}
    out = defaultdict(list)
    for name, l in L.items():
        if not l.get('live') or not l.get('holder'):
            continue
        if name == 'deepmine.slot1':
            out['deep_miner'].append(l['holder'])
        elif name == 'tidy.keeper':
            out['groundskeeper'].append(l['holder'])
        elif name.startswith('yard.slot'):
            out['clerk'].append(l['holder'])
        elif facts.get('active_build') and name.startswith(f"{facts['active_build']}.slot"):
            out['builder'].append(l['holder'])
    return dict(out)


def seed_of(pool, now):
    return zlib.crc32(f'{pool}:{int(now.timestamp())}'.encode())


def tick_town(pool, facts, rows, spans, now, st, flow, seen):
    """One town's tick -> (row, state'). PURE over its inputs."""
    nowms = int(now.timestamp() * 1000)
    home = facts.get('home')
    facts = dict(facts)
    facts['stock'] = flow
    # the safety holds look back further than one read window: their times are kept in the town's state
    since2h, since6h = now - dt.timedelta(hours=2), now - dt.timedelta(hours=6)
    deaths = sorted({*(st.get('deaths') or []), *(r['t'].isoformat() for r in rows if canon(r['name']) == 'death')})
    deaths = [x for x in deaths if dt.datetime.fromisoformat(x) >= since2h]
    strand = sorted({*(st.get('stranded') or []), *(r['t'].isoformat() for r in rows
                                                     if canon(r['name']) == 'deepmine' and 'end=stranded' in r['detail'])})
    strand = [x for x in strand if dt.datetime.fromisoformat(x) >= since6h]
    facts['deaths_2h'], facts['stranded_6h'] = len(deaths), len(strand)
    needs, latches = JR.demand(facts, st.get('latches'), seen)
    bots = bot_facts(rows, home, now)
    native = native_holders(facts)
    staffing, rs = JR.assign(needs, bots, st.get('rules') or {}, nowms, native)
    opts = JR.options(needs, staffing, facts, bots, nowms)
    rnd = JR.random_staffing(staffing, bots, seed_of(pool, now), nowms)
    a = now - dt.timedelta(minutes=COVER_MIN)
    cover, tried = {}, {}
    for r, n in needs.items():
        if n['on']:
            cover[r] = any(did(spans, b['bot'], r, a, now) for b in bots)
            tried[r] = any(did(spans, b['bot'], r, a, now, progress=False) for b in bots)
    row = {'kind': 'tick', 'ts': now.isoformat().replace('+00:00', 'Z'), 'pool': pool, 'home': facts.get('hk'), 'v': JR.V,
           'needs': {r: {k: n[k] for k in ('on', 'slots', 'why', 'supported')} for r, n in needs.items()},
           'roles': staffing['roles'], 'events': staffing['events'], 'eligible': staffing['eligible'], 'seats': staffing['seats'],
           'starving': staffing['starving'], 'native': native, 'random': rnd, 'options': opts,
           'cover': cover, 'tried': tried, 'actual': role_minutes(spans, a, now),
           'bots': {b['bot']: {k: b[k] for k in ('seen_min', 'at_town', 'flagged', 'free_slots')} for b in bots},
           'active': facts.get('active'), 'active_build': facts.get('active_build'),
           'index': {k: (facts.get('index') or {}).get(k) for k in ('ok', 'known', 'unknown')}, 'flow': flow}
    st2 = {'latches': latches, 'rules': rs, 'deaths': deaths, 'stranded': strand,
           'pending': (st.get('pending') or []) + [{'t': row['ts'], 'roles': staffing['roles'], 'random': rnd}]}
    # hours24: role-hours held, for the duty fairness rule (each tick adds its interval to every holder)
    return row, st2


def evaluate(pool, pending, spans, now, window_start):
    """Concordance rows for this town's pending ticks that are EVAL_MIN old -> (rows, still pending, lost). PURE."""
    out, keep, lost = [], [], 0
    for p in pending:
        t = dt.datetime.fromisoformat(p['t'].replace('Z', '+00:00'))
        if t + dt.timedelta(minutes=EVAL_MIN) > now:
            keep.append(p)
            continue
        if t < window_start:
            lost += 1                                   # its forward window is no longer fully in this run's rows
            continue
        b = t + dt.timedelta(minutes=EVAL_MIN)
        res = {}
        for arm in ('roles', 'random'):
            n = hit = 0
            for role, bs in (p.get(arm) or {}).items():
                for bot in bs:
                    n += 1
                    hit += did(spans, bot, role, t, b)
            res[arm] = {'n': n, 'hit': hit}
        out.append({'kind': 'eval', 'pool': pool, 'tick': p['t'], 'ts': now.isoformat().replace('+00:00', 'Z'), **res})
    return out, keep, lost


def add_hours(rs, staffing_roles, minutes, now_ms):
    """Role-hours per bot for the duty fairness rule, decayed: a 24 h exponential half-life of 12 h. PURE (returns rs')."""
    rs = dict(rs)
    h = dict(rs.get('hours24') or {})
    f = 0.5 ** (minutes / (12 * 60))
    h = {b: round(v * f, 3) for b, v in h.items() if v * f > 0.01}
    for role, bs in staffing_roles.items():
        if role in JR.PRIMARY:
            continue
        for b in bs:
            h[b] = round(h.get(b, 0) + minutes / 60, 3)
    rs['hours24'] = h
    return rs


# ------------------------------------------------------------------------------------------------ the summary (pure)
def _ts(x):
    try:
        return dt.datetime.fromisoformat(str(x).replace('Z', '+00:00'))
    except ValueError:
        return None


def summarize(rows, hours=24, now=None):
    """The 24-h read -> dict. rows: tick + eval rows. Every rate with its denominator. PURE."""
    ticks = [r for r in rows if r.get('kind') == 'tick']
    evals = [r for r in rows if r.get('kind') == 'eval']
    skips = [r for r in rows if r.get('kind') == 'skip']
    runs = [r for r in rows if r.get('kind') == 'run']
    towns = sorted({r['pool'] for r in ticks})
    cov = defaultdict(lambda: defaultdict(lambda: [0, 0]))      # role -> pool -> [covered, need ticks]
    unsup = Counter()
    churn = Counter()
    tri = Counter()
    staffed = Counter()
    builders_actual = []
    for r in ticks:
        for role, n in r['needs'].items():
            if not n.get('supported'):
                unsup[role] += 1
            if n.get('on'):
                c = cov[role][r['pool']]
                c[1] += 1
                c[0] += 1 if r['cover'].get(role) else 0
                tri[role] += 1 if (r.get('tried') or {}).get(role) else 0
        for e in r.get('events') or []:
            churn[e[0]] += 1
            if e[0] == 'release' and not (str(e[3]) == 'term' or str(e[3]).startswith('native')):
                churn['unplanned'] += 1
        for role, bs in (r.get('roles') or {}).items():
            staffed[role] += len(bs)
        if r['needs'].get('builder', {}).get('on'):
            builders_actual.append(sum(1 for b, m in (r.get('actual') or {}).items() if 'builder' in m))
    roles = {}
    for role in JR.ROLES:
        per = cov.get(role, {})
        need = sum(v[1] for v in per.values())
        got = sum(v[0] for v in per.values())
        gap_towns = sorted(p for p, v in per.items() if v[1] >= 6 and v[0] / v[1] < 0.5)
        roles[role] = {'need_ticks': need, 'covered_ticks': got, 'tried_ticks': tri[role], 'coverage': round(got / need, 3) if need else None,
                       'towns_with_need': len(per), 'gap_towns': gap_towns, 'unsupported_ticks': unsup[role],
                       'staffed_bot_ticks': staffed[role]}
    arm = {a: {'n': sum(e[a]['n'] for e in evals), 'hit': sum(e[a]['hit'] for e in evals)} for a in ('roles', 'random')}
    for a in arm.values():
        a['share'] = round(a['hit'] / a['n'], 3) if a['n'] else None
    town_hours = len(ticks) * 10 / 60 if ticks else 0
    gap_roles = [r for r, v in roles.items() if len(v['gap_towns']) >= 4]
    # VALIDITY against the expected schedule (review r1): every run (ok or ERROR) writes a `run` row naming the towns it should
    # have ticked; a failed run or a missing town counts as missing town-ticks, never as nothing
    # review r2 (Claude): a run that died outside its try, a run flock skipped or a cron that never fired writes NO row, so the
    # denominator is also taken from the SCHEDULE (one run every RUN_EVERY_MIN from the first run in the window) and the larger wins
    expected = sum(len(r.get('expected') or []) for r in runs)
    tss = sorted(t for t in (_ts(r.get('ts')) for r in runs) if t)
    if tss:
        span = ((now or tss[-1]) - tss[0]).total_seconds() / 60
        expected = max(expected, (int(span // RUN_EVERY_MIN) + 1) * len(EXPECTED_POOLS))
    valid = round(len(ticks) / expected, 3) if expected else None
    return {'ticks': len(ticks), 'skips': len(skips), 'runs': len(runs), 'error_runs': sum(1 for r in runs if not r.get('ok')),
            'expected_town_ticks': expected, 'valid_share': valid, 'towns': len(towns), 'evals': len(evals), 'town_hours': round(town_hours, 1),
            'roles': roles, 'concordance': arm,
            'churn_per_town_hour': round((churn['take'] + churn['release']) / town_hours, 2) if town_hours else None,
            'unplanned_releases_per_town_hour': round(churn['unplanned'] / town_hours, 2) if town_hours else None,
            'events': dict(churn),
            'builders_doing_builder_work_mean': round(sum(builders_actual) / len(builders_actual), 2) if builders_actual else None,
            'builder_need_ticks': len(builders_actual),
            'go': {'valid_ok': valid is not None and valid >= 0.95, 'real_gap_roles': gap_roles, 'churn_ok': churn['unplanned'] / town_hours <= 1.0 if town_hours else None}}


# ------------------------------------------------------------------------------------------------ the run (impure)
def load_rows(window_min, paths=LOGS, telemetry=TELEMETRY):
    spec = importlib.util.spec_from_file_location('js_telemetry', telemetry)
    tm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tm)
    ev = tm.Events.load(paths=paths, since_minutes=window_min)
    rows = [x for x in (norm(r['raw']) for r in ev.rows) if x]
    proof = {'rows': len(ev.rows), 'bots': len(ev.bots()), 'build_visit': ev.count('_build_visit'), 'gather': ev.count('gather')}
    return rows, proof


def read_facts(pools, now, src=BOTS_SRC, pools_dir=POOLS_DIR):
    dirs = [os.path.join(pools_dir, f'_pool-{p}') for p in sorted(pools)]
    r = subprocess.run(['node', os.path.join(HERE, 'jobfacts.mjs'), src, str(int(now.timestamp() * 1000)), *dirs],
                       capture_output=True, text=True, timeout=300)
    if r.returncode:
        raise RuntimeError(f'jobfacts.mjs rc={r.returncode}: {r.stderr.strip()[-200:]}')
    return json.loads(r.stdout)


def read_flow(path=FLOW_LATEST, now=None):
    """The flow ledger's chest stock per pool: {pool: {cobble, logs}} -- only towns fully counted, and only when the ledger is
    under 3 h old (else {}: the rules fall back to the town index, never to zero)."""
    try:
        d = json.load(open(os.path.expanduser(path)))
        ts = dt.datetime.fromisoformat(str(d.get('ts')).replace('Z', '+00:00'))
        if now and (now - ts).total_seconds() > 3 * 3600:
            return {}
        out = {}
        for p, g in (d.get('chest_groups') or {}).items():
            c, lg = g.get('cobble') or {}, g.get('logs') or {}
            out[p] = {'cobble': c.get('lb') if not c.get('uncounted') else None, 'logs': lg.get('lb') if not lg.get('uncounted') else None}
        return out
    except (OSError, ValueError, TypeError):
        return {}


def seen_update(seen, rows, now):
    """Which roles' features each pool shows live (rows in the last SEEN_KEEP_H): {pool: {role: last_iso}}. PURE (returns new)."""
    out = {p: dict(v) for p, v in (seen or {}).items()}
    for r in rows:
        n = canon(r['name'])
        role = 'deep_miner' if n in ('deepmine', 'deep_mine', 'deepmine_mode') and (n != 'deepmine_mode' or 'on=1' in r['detail']) \
            else 'explorer' if n in ('expedition',) else None
        if role and r['pool']:
            out.setdefault(r['pool'], {})[role] = r['t'].isoformat()
    cut = now - dt.timedelta(hours=SEEN_KEEP_H)
    for p in list(out):
        out[p] = {k: v for k, v in out[p].items() if dt.datetime.fromisoformat(v) >= cut}
    return out


def cmd_run(a):
    """Every failure, wherever it happens, writes the ERROR line and a `run ok:false` row (review r2)."""
    now = dt.datetime.now(UTC).replace(microsecond=0)
    try:
        return _run(a, now)
    except Exception as e:  # noqa: BLE001
        return _fail(a, now, e)


def _fail(a, now, e):
    od = os.path.expanduser(a.out_dir)
    os.makedirs(od, exist_ok=True)
    line = f'{now.isoformat()[:19]}Z jobshadow ERROR {type(e).__name__}: {str(e)[:200]}'
    with open(os.path.expanduser(a.digest_log), 'a') as f:
        f.write(line + '\n')
    with open(os.path.join(od, f"ticks-{now.strftime('%Y-%m-%d')}.jsonl"), 'a') as fh:
        fh.write(json.dumps({'kind': 'run', 'ok': False, 'ts': now.isoformat().replace('+00:00', 'Z'),
                             'expected': list(EXPECTED_POOLS), 'error': line[:300]}) + '\n')
    print(line)
    return 1


def _run(a, now):
    od = os.path.expanduser(a.out_dir)
    os.makedirs(od, exist_ok=True)
    state_path = os.path.join(od, 'state.json')
    try:
        state = json.load(open(state_path))
    except (OSError, ValueError):
        state = {}
    try:
        rows, proof = load_rows(a.window_min)
        if proof['rows'] <= 0 or proof['bots'] < MIN_BOTS or proof['build_visit'] <= 0:
            raise RuntimeError(f"positive control failed: rows {proof['rows']}, bots {proof['bots']} (< {MIN_BOTS}), "
                               f"_build_visit {proof['build_visit']}")
        pools = sorted({r['pool'] for r in rows if r['pool'] and r['pool'] != 'showcase'})
        facts = read_facts(pools, now, a.bots_src, a.pools_dir)
        if len(facts['towns']) < min(MIN_TOWNS_READ, len(pools)):
            raise RuntimeError(f"positive control failed: jobfacts read {len(facts['towns'])} of {len(pools)} pools; "
                               f"unreadable {facts['unreadable'][:4]}")
    except Exception as e:  # noqa: BLE001 -- a failed read is a line, never silence
        return _fail(a, now, e)
    flow = read_flow(a.flow, now)
    window_start = now - dt.timedelta(minutes=a.window_min)
    seen = seen_update(state.get('seen'), rows, now)
    by_pool = defaultdict(list)
    for r in rows:
        by_pool[r['pool']].append(r)
    for v in by_pool.values():
        v.sort(key=lambda r: r['t'])
    towns_st = state.get('towns') or {}
    last_run = state.get('last_run')
    dmin = 10.0
    if last_run:
        dmin = max(0.0, min(60.0, (now - dt.datetime.fromisoformat(last_run)).total_seconds() / 60))
    out_rows, lost_total = [], 0
    for pool in pools:
        f = facts['towns'].get(pool)
        if not f:
            out_rows.append({'kind': 'skip', 'ts': now.isoformat().replace('+00:00', 'Z'), 'pool': pool,
                             'why': next((u['why'] for u in facts['unreadable'] if u['dir'] == pool), 'no facts')})
            continue
        complete = {p['plot'] for p in f['projects'] if p.get('complete')}
        spans = work_spans(by_pool[pool], complete)
        st = towns_st.get(pool) or {}
        evs, keep, lost = evaluate(pool, st.get('pending') or [], spans, now, window_start)
        lost_total += lost
        out_rows.extend(evs)
        st = {**st, 'pending': keep}
        row, st2 = tick_town(pool, f, by_pool[pool], spans, now, st,
                             flow.get(pool), {r: True for r in (seen.get(pool) or {})})
        st2['rules'] = add_hours(st2['rules'], row['roles'], dmin, int(now.timestamp() * 1000))
        towns_st[pool] = st2
        out_rows.append(row)
    out_rows.append({'kind': 'run', 'ok': True, 'ts': now.isoformat().replace('+00:00', 'Z'),
                     'expected': sorted(set(EXPECTED_POOLS) | set(pools)), 'proof': proof})
    day = now.strftime('%Y-%m-%d')
    with open(os.path.join(od, f'ticks-{day}.jsonl'), 'a') as fh:
        for r in out_rows:
            fh.write(json.dumps(r, sort_keys=True, default=str) + '\n')
    tmp = state_path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump({'v': JR.V, 'last_run': now.isoformat(), 'seen': seen, 'towns': towns_st}, fh, sort_keys=True, default=str)
    os.replace(tmp, state_path)
    ticks = [r for r in out_rows if r['kind'] == 'tick']
    staffed = sum(len(bs) for r in ticks for bs in r['roles'].values())
    needs_on = sum(1 for r in ticks for n in r['needs'].values() if n['on'])
    covered = sum(1 for r in ticks for v in r['cover'].values() if v)
    line = (f"{now.isoformat()[:19]}Z jobshadow {len(ticks)} of {len(set(EXPECTED_POOLS) | set(pools))} towns ({sum(1 for r in out_rows if r['kind'] == 'skip')} skipped)"
            f" | {proof['rows']:,} rows, {proof['bots']} bots, {a.window_min} min (control: _build_visit {proof['build_visit']}, gather {proof['gather']})"
            f" | needs on {needs_on}, covered in 60 min {covered} of {needs_on} | would staff {staffed} bot-roles"
            f" | evals {sum(1 for r in out_rows if r['kind'] == 'eval')} (lost {lost_total}) | shadow only: nothing written to pools")
    with open(os.path.expanduser(a.digest_log), 'a') as fh:
        fh.write(line + '\n')
    json.dump({'ts': now.isoformat(), 'line': line, 'proof': proof, 'ticks': ticks}, open(os.path.join(od, 'latest.json'), 'w'),
              sort_keys=True, default=str, indent=1)
    if a.print:
        print(line)
        for r in ticks:
            on = [f"{k}{'+' if r['cover'].get(k) else '-'}" for k, n in r['needs'].items() if n['on']]
            print(f"  {r['pool']:<11} build={r['active_build']} eligible={r['eligible']} roles={r['roles']} needs={on}")
    return 0


def cmd_summary(a):
    od = os.path.expanduser(a.out_dir)
    cut = dt.datetime.now(UTC) - dt.timedelta(hours=a.hours)
    rows = []
    for f in sorted(glob.glob(os.path.join(od, 'ticks-*.jsonl'))):
        for line in open(f):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if dt.datetime.fromisoformat(r['ts'].replace('Z', '+00:00')) >= cut:
                rows.append(r)
    s = summarize(rows, a.hours, dt.datetime.now(UTC))
    json.dump(s, open(os.path.join(od, 'summary.json'), 'w'), indent=1, sort_keys=True)
    print(json.dumps(s, indent=1, sort_keys=True))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run')
    r.add_argument('--window-min', type=int, default=WINDOW_MIN)
    r.add_argument('--out-dir', default=OUT_DIR)
    r.add_argument('--digest-log', default=DIGEST_LOG)
    r.add_argument('--bots-src', default=BOTS_SRC)
    r.add_argument('--pools-dir', default=POOLS_DIR)
    r.add_argument('--flow', default=FLOW_LATEST)
    r.add_argument('--print', action='store_true')
    s = sub.add_parser('summary')
    s.add_argument('--hours', type=float, default=24)
    s.add_argument('--out-dir', default=OUT_DIR)
    a = ap.parse_args()
    sys.exit(cmd_run(a) if a.cmd == 'run' else cmd_summary(a))


if __name__ == '__main__':
    main()
