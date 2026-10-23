#!/usr/bin/env python3
r"""coopread.py -- B1, the daily COOPERATION CENSUS (cooperation-tier design r9.1, docs/reports/cooperation-tier-2026-10-23.md
sections 1 and 6.3 B1). READ ONLY: it reads the skill logs (scripts/lib/telemetry.Events, a full walk of the window) and
the town index journals; it writes only under --out-dir.

What it measures, per shared town and fleet-wide, over a 24 h window (every number with its denominator; every zero beside
a positive control from the same pass):

  [P] WHO FEEDS WHOM through the town chests (design 1.1). The observation chain of each container in the town index
      journal: every difference between consecutive `obs` records is one event, attributed to a bot only when every op
      (`dirty` pre/held/post marks) overlapping that pair belongs to that one bot and none is unfinished; otherwise it is
      UNKNOWN (kept, never dropped). The shipped op lifecycle (townindex.mjs): an op with no `post` is open until OP_TTL
      past its latest `pre` or `held` mark; an op with no `pre` is open from -infinity. Bounds per withdrawer B, container
      K, item: lower = max over B's withdrawals of (withdrawn so far - stock at first open - unknown additions - B's own
      deposits), floored at 0; upper = min(withdrawn, other bots' deposits + unknown additions before B's last withdrawal).
      POSITIVE CONTROL: every verified transfer (`xfer ok=1`) must be the chain pair (pre -> ver) attributed to its own
      bot; a shortfall is a DEFECT of this census (exit 1), not a finding.
  [O] CONCURRENT TOWN JOBS (design 1.2): runs starting inside a townmate's run of the same job (the drain per furnace), a
      chance null (independence, approximate), and overlapped BOT-time (per run, the union of its overlaps). POSITIVE
      CONTROL: smelt_town overlaps are found whenever smelt_town ran >= 200 times.
  [F] FURNACE FOUND EMPTY AGAIN by a townmate within 60 min, invalidated by a non-drain `_furnace_session` whose [t0, t1]
      overlaps the gap; the cost is the summed duration of those repeat drains (furnaceseen-01's target, design B3).
      POSITIVE CONTROL: non-drain sessions with t0/t1 are parsed.
  [C] BEING TOGETHER at the town-job radius (16 h / 12 v): occupancy, stays, minutes with >= 2 / >= 3 bots per town-day,
      longest stretches, and arrivals within 30 min from away, unflagged minutes (design 1.4).
  [B] BUILT TOGETHER (design 5.5), once the building tier's rows exist: multi-builder project-days from witnessed `_build`
      rows (two or more different bots placing cells of one project on one day). Until shop-01 ships it reads
      "no project rows" with the row count it searched -- an idle instrument, never a zero result.

TIMING (design 1, the comms design's rule): a skill row is stamped at its START and carries the END snapshot; an event row
(leading underscore) is stamped at emission. Positions come only from event rows.

MODES
    python3 -B coopread.py --selftest                 # the fixtures (known answers); exit 1 on any failure
    python3 -B coopread.py --day [--until ISO]        # the 24 h ending at --until (default: the last whole hour)
    python3 -B coopread.py --line                     # one fleetstatus line from the newest daily file
Every --day run runs the self-test first and refuses to read the fleet if it fails. A day with no rows, or a town whose
index journal cannot be read, is VOID for that part, never zero. Writes out-dir/daily/<until>.json and .txt and a heartbeat.
CRON (SUGGESTED, NOT INSTALLED; staged by scripts/host/install-coophost.sh): daily at 02:20Z with nice -n 19.
"""
import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import bisect  # noqa: E402
import collections  # noqa: E402
import datetime as dt  # noqa: E402
import glob  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import statistics  # noqa: E402
import time  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UTC = dt.timezone.utc
OP_TTL_MS = 10 * 60 * 1000              # townindex.mjs OP_TTL_MS
TOWN_R, TOWN_DY = 16, 12                # the town-job radius (chestfull inTown)
CARRY_S = 600                           # a position is carried for at most 10 min
FLAG_S = 300
JOBS = ('smelt_town', 'furnace_drain', 'toolkit', 'deposit', 'town_deposit', 'withdraw_pick', 'dispose_well', 'compost')
TRAP = re.compile(r'entomb|strand|maroon|trapped|wedged|reflex_stuck|flooded_pocket|drown|lava_adjacent|_death$')
FURN = re.compile(r'furnace at (-?\d+,-?\d+,-?\d+)')
SESS = re.compile(r'furnace=(-?\d+,-?\d+,-?\d+).*?t0=(\d+) t1=(\d+) by=(\w+)')
GROUP = [('metal', r'iron|copper|gold'), ('fuel', r'^coal$|charcoal|coal_block'),
         ('tools', r'pickaxe|_axe$|shovel|hoe$|sword|bucket|shears'),
         ('stone', r'cobble|stone$|andesite|diorite|granite|tuff|deepslate|sandstone|bricks'),
         ('wood', r'_log$|planks|stick|_slab|_stairs|fence|door|_wood$')]
SMELT_CONTROL_MIN_RUNS = 200


def iso(t):
    return dt.datetime.fromtimestamp(t, UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def group(n):
    for g, pat in GROUP:
        if re.search(pat, n):
            return g
    return 'other'


def hd(a, b):
    return math.hypot(a[0] - b[0], a[2] - b[2])


def end(r):
    """A skill row's interval ends at start + duration; an event row is an instant."""
    return r['t'] + ((r.get('dur') or 0) / 1000.0 if not r['k'].startswith('_') else 0.0)


def union_len(ivs):
    tot, cs, ce = 0.0, None, None
    for s, e in sorted(ivs):
        if ce is None or s > ce:
            if ce is not None:
                tot += ce - cs
            cs, ce = s, e
        else:
            ce = max(ce, e)
    return tot + ((ce - cs) if ce is not None else 0.0)


# ------------------------------------------------------------------------------------------------- [P] provenance
def op_spans(ops):
    """{op_id: {bot, pre, held, post}} -> [(start, end, bot, finished)] under townindex.mjs's lifecycle. Pure."""
    out = []
    for o in ops.values():
        start = o['pre'] if o.get('pre') is not None else float('-inf')
        if o.get('post') is not None:
            out.append((start, o['post'], o['bot'], True))
        else:
            out.append((start, max(o.get('pre') or 0, o.get('held') or 0) + OP_TTL_MS, o['bot'], False))
    return out


PROV_MIN_COVER_H = 20.0                 # a town whose journal covers less of the 24 h is PARTIAL (journals rotate by size)


def provenance(recs, t0_ms, t1_ms):
    """Index journal records (one town) -> the [P] counters over [t0, t1). Pure. Records before t0 are CONTEXT only: the
    last observation of a container before t0 is its starting stock, and ops before t0 still bound the first pair; only
    pairs whose later observation falls in [t0, t1), and transfers in [t0, t1), are counted. `cover_h` is how much of the
    window the journal actually covers (from its first record or t0, whichever is later, to t1)."""
    recs = sorted((r for r in recs if r.get('t') in ('obs', 'dirty', 'xfer') and r.get('at') and r['at'] < t1_ms),
                  key=lambda r: (r['at'], r.get('id', '')))
    obs, ops = collections.defaultdict(list), collections.defaultdict(dict)
    for r in recs:
        if r['t'] == 'obs':
            obs[r['k']].append(r)
        elif r['t'] == 'dirty':
            o = ops[r['k']].setdefault(r.get('op') or r['id'], {'bot': r.get('bot'), 'pre': None, 'post': None, 'held': None})
            ph = r.get('phase') or 'pre'
            if ph == 'held':
                o['held'] = max(o['held'] or 0, r['at'])
            elif ph in ('pre', 'post'):
                o[ph] = r['at']
    P = collections.Counter()
    first = recs[0]['at'] if recs else t1_ms
    P['cover_h'] = round(max(0.0, (t1_ms - max(first, t0_ms)) / 3.6e6), 2)
    P['ops'] = sum(len(v) for v in ops.values())
    P['ops_unfinished'] = sum(1 for v in ops.values() for o in v.values() if o['post'] is None)
    chain_who = {}
    units = collections.Counter()
    for k, lst in obs.items():
        spans = op_spans(ops[k])
        before = [o for o in lst if o['at'] < t0_ms]
        base = before[-1] if before else lst[0]
        stock0 = {n: c for n, (c, s) in (base.get('names') or {}).items()}
        ev = []
        for o1, o2 in zip(lst, lst[1:]):
            if o2['at'] < t0_ms:
                continue
            between = [x for x in spans if x[1] >= o1['at'] and x[0] <= o2['at']]
            who = between[0][2] if between and len({x[2] for x in between}) == 1 and all(x[3] for x in between) else None
            chain_who[(o1['id'], o2['id'])] = who
            n1 = {n: c for n, (c, s) in (o1.get('names') or {}).items()}
            n2 = {n: c for n, (c, s) in (o2.get('names') or {}).items()}
            if n1 == n2:
                continue
            P['pairs_changed'] += 1
            P['pairs_attributed' if who else 'pairs_no_op' if not between else
              'pairs_unfinished_op' if not all(x[3] for x in between) else 'pairs_multi_bot'] += 1
            for n in set(n1) | set(n2):
                d = n2.get(n, 0) - n1.get(n, 0)
                if d:
                    ev.append((o2['at'], who, n, d))
                    if who:
                        units[(group(n), 'dep' if d > 0 else 'wd')] += abs(d)
        for n in {e[2] for e in ev}:
            seq = sorted(e for e in ev if e[2] == n)
            s0 = stock0.get(n, 0)
            for _, who, _, d in seq:
                if who is None:
                    P['unknown_added' if d > 0 else 'unknown_removed'] += abs(d)
            for B in {w for _, w, _, d in seq if w and d < 0}:
                W = own = oth = unk = lb = cap = 0
                for _, who, _, d in seq:
                    if d > 0:
                        if who == B:
                            own += d
                        elif who is None:
                            unk += d
                        else:
                            oth += d
                    elif who == B:
                        W += -d
                        lb = max(lb, W - s0 - unk - own)
                        cap = oth + unk
                P['withdrawn'] += W
                P['other_lb'] += lb
                P['other_ub'] += min(W, cap)
    for x in recs:
        if x['t'] == 'xfer' and x.get('ok') and x['at'] >= t0_ms:
            P['xfer_verified'] += 1
            if chain_who.get((x.get('pre'), x.get('ver'))) == x.get('bot'):
                P['xfer_through_chain'] += 1
    P.update({f'units_{g}_{d}': v for (g, d), v in units.items()})
    return P


# ------------------------------------------------------------------------------------------------- [O] overlaps
def overlaps(rows, t0, t1):
    """Rows of one town -> {job: {runs, start_inside, chance_pct, body_s, overlap_bot_s}}. Pure."""
    out = {}
    for k in JOBS:
        iv = []
        for r in rows:
            if r['k'] == k and r.get('dur') is not None and r.get('bot'):
                key = None
                if k == 'furnace_drain':
                    m = FURN.search(r.get('d') or '')
                    key = m.group(1) if m else ('?', id(r))
                iv.append((r['t'], end(r), r['bot'], key))
        iv.sort()
        busy = collections.Counter()
        for s, e, b, _ in iv:
            busy[b] += e - s
        tot = sum(busy.values())
        si = ov_bot = chance = 0.0
        for i, (s, e, b, key) in enumerate(iv):
            ovs, inside = [], False
            j = i - 1
            while j >= 0 and s - iv[j][0] < 4 * 3600:
                sj, ej, bj, kj = iv[j]
                if bj != b and kj == key and ej > s:
                    ovs.append((s, min(e, ej)))
                    inside = True
                j -= 1
            j = i + 1
            while j < len(iv) and iv[j][0] < e:
                sj, ej, bj, kj = iv[j]
                if bj != b and kj == key:
                    ovs.append((sj, min(e, ej)))
                j += 1
            si += inside
            ov_bot += union_len(ovs)
            chance += min(1.0, (tot - busy[b]) / max(1.0, t1 - t0))
        out[k] = {'runs': len(iv), 'start_inside': int(si), 'chance_pct': round(100 * chance / len(iv), 2) if iv else None,
                  'body_s': round(sum(e - s for s, e, _, _ in iv), 1), 'overlap_bot_s': round(ov_bot, 1)}
    return out


# ------------------------------------------------------------------------------------------------- [F] furnace repeats
def furnace_repeats(rows):
    """Rows of one town -> {empty, empty_s, peer, peer_s, self, invalidated, sessions}. Pure."""
    sess = collections.defaultdict(list)
    for r in rows:
        if r['k'] == '_furnace_session':
            m = SESS.search(r.get('d') or '')
            if m and m.group(4) != 'drain':
                sess[m.group(1)].append((int(m.group(2)) / 1000.0, int(m.group(3)) / 1000.0))
    dr = sorted((end(r), r['t'], r['bot'], m.group(1), (r.get('dur') or 0) / 1000.0)
                for r in rows if r['k'] == 'furnace_drain' for m in [FURN.search(r.get('d') or '')]
                if m and 'is empty' in (r.get('d') or ''))
    F = collections.Counter(sessions=sum(len(v) for v in sess.values()))
    for i, (e, s, b, f, dur) in enumerate(dr):
        F['empty'] += 1
        F['empty_s'] += dur
        prev = [x for x in dr[:i] if x[3] == f and x[0] <= s and s - x[0] <= 3600]
        if not prev:
            continue
        last = prev[-1]
        if any(t0 < s and t1 > last[0] for t0, t1 in sess.get(f, [])):
            F['invalidated'] += 1
            continue
        c = 'peer' if last[2] != b else 'self'
        F[c] += 1
        F[c + '_s'] += dur
    return F


# ------------------------------------------------------------------------------------------------- [C] together
def together(rows, home, t0, t1):
    """Rows of one town -> presence at the town-job radius. Pure."""
    per, flag = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        if r.get('bot') and r['k'].startswith('_'):
            if r.get('p'):
                per[r['bot']].append((r['t'], r['p']))
            if TRAP.search(r['k']):
                flag[r['bot']].append(r['t'])
    m0, m1 = int(t0 // 60) + 1, int(t1 // 60) + 1
    seqs, C, stays = {}, collections.Counter(), []
    for b, lst in per.items():
        lst.sort()
        ts = [x[0] for x in lst]
        ft = sorted(flag[b])
        seq = []
        for m in range(m0, m1):
            j = bisect.bisect_right(ts, m * 60) - 1
            p = lst[j][1] if j >= 0 and m * 60 - ts[j] <= CARRY_S else None
            inside = None if p is None else (hd(p, home) <= TOWN_R and abs(p[1] - home[1]) <= TOWN_DY)
            k = bisect.bisect_right(ft, m * 60) - 1
            flagged = k >= 0 and m * 60 - ft[k] <= FLAG_S
            seq.append((inside, flagged))
        seqs[b] = seq
        run = 0
        for x in [s[0] for s in seq] + [False]:
            if x:
                run += 1
            elif run:
                stays.append(run)
                run = 0
        C['bot_min'] += len(seq)
        C['observed_min'] += sum(1 for x in seq if x[0] is not None)
        C['unknown_min'] += sum(1 for x in seq if x[0] is None)
        C['inside_min'] += sum(1 for x in seq if x[0])
        for i, (x, fl) in enumerate(seq):
            if x is False and not fl and i + 30 < len(seq):
                win = [s[0] for s in seq[i + 1:i + 31]]
                arrived = any(win[q] and win[q + 1] for q in range(len(win) - 1))
                if not arrived and any(w is None for w in win):
                    C['arrival_censored'] += 1          # an unobserved stretch cannot be read as "did not arrive"
                    continue
                C['away_unflagged'] += 1
                C['arrive_30'] += arrived
    best2 = best3 = c2 = c3 = 0
    n = (m1 - m0)
    for i in range(n):
        k = sum(1 for s in seqs.values() if s[i][0])
        C['ge2_min'] += k >= 2
        C['ge3_min'] += k >= 3
        c2 = c2 + 1 if k >= 2 else 0
        c3 = c3 + 1 if k >= 3 else 0
        best2, best3 = max(best2, c2), max(best3, c3)
    C['longest_ge2'], C['longest_ge3'] = best2, best3
    C['stays'] = len(stays)
    C['stay_median_min'] = statistics.median(stays) if stays else None
    return C


# ------------------------------------------------------------------------------------------------- [B] built together
def built_together(rows):
    """`_build` rows (building tier r4: a positioned row per witnessed placement; detail key=value with project= and
    seg=) -> {rows, project_days, multi_builder_project_days}. Pure. Idle (rows 0) until shop-01 ships."""
    days = collections.defaultdict(set)
    n = 0
    for r in rows:
        if r['k'] != '_build':
            continue
        n += 1
        if r.get('s') != 'success':
            continue
        f = dict(re.findall(r'(\w+)=(\S+)', r.get('d') or ''))
        days[(f.get('project', '?'), iso(r['t'])[:10])].add(r['bot'])
    return {'rows': n, 'project_days': len(days), 'multi_builder_project_days': sum(1 for v in days.values() if len(v) >= 2)}


# ------------------------------------------------------------------------------------------------- reading the fleet
def shared_pools(state_dir):
    out = []
    for d in glob.glob(os.path.join(state_dir, '_pool-*')):
        p = os.path.basename(d)[len('_pool-'):]
        if os.path.isdir(d) and '.' not in p and not p.startswith('self-'):
            out.append(p)
    return sorted(out)


def home_of(state_dir, pool):
    fs = glob.glob(os.path.join(state_dir, f'_pool-{pool}', 'town-index-*.g*.jsonl')) or \
        glob.glob(os.path.join(state_dir, f'_pool-{pool}', 'town-chest-*.cobble.jsonl'))
    for f in fs:
        m = re.search(r'-(-?\d+)_(-?\d+)_(-?\d+)\.', os.path.basename(f))
        if m:
            return tuple(int(v) for v in m.groups())
    return None


def read_index(state_dir, pool):
    recs = []
    fs = sorted(glob.glob(os.path.join(state_dir, f'_pool-{pool}', 'town-index-*.g*.jsonl')))
    if not fs:
        return None
    for f in fs:
        try:
            with open(f, errors='replace') as fh:
                for line in fh:
                    try:
                        recs.append(json.loads(line))
                    except ValueError:
                        pass
        except OSError:
            return None
    return recs


def compact_rows(ev):
    out = []
    for r in ev.rows:
        d = r['raw']
        b = d.get('bot') or {}
        sk = d.get('skill') or {}
        rec = {'t': r['t'].timestamp(), 'bot': b.get('name'), 'k': r['name'], 's': sk.get('status'),
               'dur': sk.get('duration_ms'), 'd': (sk.get('detail') or '')[:400]}
        p = b.get('pos')
        if p:
            rec['p'] = [p.get('x', 0), p.get('y', 0), p.get('z', 0)]
        out.append(rec)
    return out


def run_day(a):
    from lib.telemetry import Events
    t1 = dt.datetime.fromisoformat(a.until.replace('Z', '+00:00')) if a.until else \
        dt.datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    t0 = t1 - dt.timedelta(hours=24)
    pools = shared_pools(a.state_dir)
    if not pools:
        raise RuntimeError(f'no shared pool dir under {a.state_dir}')
    res = {'window': [iso(t0.timestamp()), iso(t1.timestamp())], 'towns': {}, 'void': {}}
    for pool in pools:
        home = home_of(a.state_dir, pool)
        ev = Events.load(paths=f'/var/log/mcai/{pool}-*/skill-*.jsonl*', since=t0, until=t1)
        rows = compact_rows(ev)
        del ev
        T = {'rows': len(rows), 'bots': len({r['bot'] for r in rows if r.get('bot')}),
             # the controls' POPULATIONS (Claude r1 P1-5: a control must fail when its population exists and it sees none)
             'pop': {'town_deposit_success': sum(1 for r in rows if r['k'] == 'town_deposit' and r.get('s') == 'success'),
                     'smelt_town_events': sum(1 for r in rows if r['k'] == '_smelt_town'),
                     'furnace_drain_runs': sum(1 for r in rows if r['k'] == 'furnace_drain')}}
        if not rows:
            res['void'][pool] = 'no skill row in the window'
            continue
        if home is None:
            res['void'][pool] = 'home unknown (no town-index or town-chest file)'
        else:
            T['together'] = dict(together(rows, home, t0.timestamp(), t1.timestamp()))
        T['overlaps'] = overlaps(rows, t0.timestamp(), t1.timestamp())
        T['furnace'] = dict(furnace_repeats(rows))
        T['built'] = built_together(rows)
        idx = read_index(a.state_dir, pool)
        T['provenance'] = dict(provenance(idx, t0.timestamp() * 1000, t1.timestamp() * 1000)) if idx is not None else None
        if idx is None:
            res['void'].setdefault(pool, 'index journal unreadable: provenance VOID')
        elif T['provenance']['cover_h'] < PROV_MIN_COVER_H:
            res.setdefault('partial', {})[pool] = f'index journal covers {T["provenance"]["cover_h"]} h of 24 (rotated)'

        res['towns'][pool] = T
        del rows
    res['fleet'] = fleet_totals(res)
    res['controls'] = controls(res)
    return res


def fleet_totals(res):
    F = collections.Counter()
    for T in res['towns'].values():
        if T.get('provenance') is not None:
            F['prov_towns'] += 1
        if T.get('together'):
            F['together_towns'] += 1
        for k, v in (T.get('pop') or {}).items():
            F['pop_' + k] += v
        for k, v in (T.get('provenance') or {}).items():
            F['prov_' + k] += v
        for k, v in T['furnace'].items():
            F['furnace_' + k] += v
        for k, v in (T.get('together') or {}).items():
            if isinstance(v, (int, float)) and k not in ('stay_median_min', 'longest_ge2', 'longest_ge3'):
                F['together_' + k] += v
        for job, o in T['overlaps'].items():
            for k in ('runs', 'start_inside', 'body_s', 'overlap_bot_s'):
                F[f'ov_{job}_{k}'] += o[k]
        for k, v in T['built'].items():
            F['built_' + k] += v
        F['rows'] += T['rows']
        F['bots'] += T['bots']
    return dict(F)


def controls(res):
    """The census's own positive controls -> {name: {ok, detail}}. A failed control is a DEFECT of the census. Each one
    requires PRESENCE whenever its population exists (Claude r1 P1-5): a blind reader fails, it never passes on a zero."""
    F = res['fleet']
    out = {}
    v, c, pop = F.get('prov_xfer_verified', 0), F.get('prov_xfer_through_chain', 0), F.get('pop_town_deposit_success', 0)
    out['xfer_through_chain'] = {'ok': (v > 0 or pop == 0) and c == v,
                                 'detail': f'{c} of {v} verified transfers attributed to their own bot; '
                                           f'{pop} successful town_deposit rows (transfers must exist when they do)'}
    sm, si, ev = F.get('ov_smelt_town_runs', 0), F.get('ov_smelt_town_start_inside', 0), F.get('pop_smelt_town_events', 0)
    out['overlap_sweep_sees'] = {'ok': (sm > 0 or ev == 0) and (sm < SMELT_CONTROL_MIN_RUNS or si > 0),
                                 'detail': f'{si} smelt_town overlaps in {sm} runs ({ev} _smelt_town events; overlaps '
                                           f'required from {SMELT_CONTROL_MIN_RUNS} runs)'}
    dr = F.get('pop_furnace_drain_runs', 0)
    out['furnace_rows_parsed'] = {'ok': dr < 100 or (F.get('furnace_empty', 0) > 0 and F.get('furnace_sessions', 0) > 0),
                                  'detail': f'{F.get("furnace_empty", 0)} empty drains and {F.get("furnace_sessions", 0)} '
                                            f'non-drain sessions parsed from {dr} drain runs'}
    obs, tot = F.get('together_observed_min', 0), F.get('together_bot_min', 0)
    out['positions_seen'] = {'ok': tot > 0 and obs / tot >= 0.5,
                             'detail': f'{obs} of {tot} bot-minutes observed'}
    # EVERY measured town must have a readable index (Codex r2 P2-2: one readable town must not pass for a fleet)
    unread = sorted(t for t, T in res['towns'].items() if T.get('provenance') is None)
    out['provenance_read'] = {'ok': bool(res['towns']) and not unread,
                              'detail': f'{len(res["towns"]) - len(unread)} of {len(res["towns"])} towns with a readable index'
                                        + (f'; UNREADABLE {", ".join(unread)}' if unread else '')}
    return out


def chests_text(res):
    """The [P] phrase, with its coverage, PARTIAL and UNREADABLE towns (a short or blind index is never a quiet zero)."""
    F = res.get('fleet') or {}
    w = F.get('prov_withdrawn', 0)
    unread = sorted(t for t, T in (res.get('towns') or {}).items() if T.get('provenance') is None)
    if not F.get('prov_towns'):
        return 'chests VOID (no readable index)'
    return (f'chests other-bot {F.get("prov_other_lb", 0)}-{F.get("prov_other_ub", 0)} of {w} withdrawn '
            f'({100 * F.get("prov_other_lb", 0) / max(1, w):.0f}-{100 * F.get("prov_other_ub", 0) / max(1, w):.0f}%) over '
            f'{F.get("prov_cover_h", 0):.0f} town-h of index in {F.get("prov_towns", 0)} towns'
            + (f', {len(res.get("partial") or {})} PARTIAL (< {PROV_MIN_COVER_H} h)' if res.get('partial') else '')
            + (f', UNREADABLE {len(unread)}: {",".join(unread)}' if unread else ''))


def line(res):
    F = res['fleet']
    n = F.get('together_towns', 0) or 1
    w = F.get('prov_withdrawn', 0)
    chests = chests_text(res)
    return (f'coop 24h to {res["window"][1]}: {chests}; '
            f'furnace re-found empty {F.get("furnace_peer", 0)} ({F.get("furnace_peer_s", 0) / 3600:.2f} bot-h); '
            f'>=2 together {F.get("together_ge2_min", 0) / n:.0f} min/town-day; multi-builder project-days '
            f'{F.get("built_multi_builder_project_days", 0) if F.get("built_rows") else "idle (no _build rows)"}; '
            f'controls {"OK" if all(c["ok"] for c in res["controls"].values()) else "FAILED"}; void {len(res["void"])}, '
            f'partial {len(res.get("partial") or {})}')


def render(res):
    L = [f'COOPERATION CENSUS (B1) {res["window"][0]} .. {res["window"][1]}', line(res)]
    F = res['fleet']
    L.append(f'  [P] chain pairs changed {F.get("prov_pairs_changed", 0)}: attributed {F.get("prov_pairs_attributed", 0)}, '
             f'no op {F.get("prov_pairs_no_op", 0)}, unfinished op {F.get("prov_pairs_unfinished_op", 0)}, two bots '
             f'{F.get("prov_pairs_multi_bot", 0)}; unknown +{F.get("prov_unknown_added", 0)} / -{F.get("prov_unknown_removed", 0)}')
    for job in JOBS:
        r = F.get(f'ov_{job}_runs', 0)
        if r:
            L.append(f'  [O] {job:14s} runs {r:5d} start inside {F.get(f"ov_{job}_start_inside", 0):4d} '
                     f'({100 * F.get(f"ov_{job}_start_inside", 0) / r:.1f}%); overlapped bot-time '
                     f'{F.get(f"ov_{job}_overlap_bot_s", 0) / 3600:.2f} of {F.get(f"ov_{job}_body_s", 0) / 3600:.2f} bot-h')
    L.append(f'  [F] empty drains {F.get("furnace_empty", 0)}; after a townmate {F.get("furnace_peer", 0)}; after itself '
             f'{F.get("furnace_self", 0)}; invalidated {F.get("furnace_invalidated", 0)}')
    L.append(f'  [C] inside 16/12 {F.get("together_inside_min", 0)} of {F.get("together_bot_min", 0)} bot-minutes; '
             f'arrivals within 30 min {F.get("together_arrive_30", 0)} of {F.get("together_away_unflagged", 0)} away, '
             f'unflagged minutes; >=2 {F.get("together_ge2_min", 0)}, >=3 {F.get("together_ge3_min", 0)} town-minutes')
    L.append(f'  [B] _build rows {F.get("built_rows", 0)}; project-days {F.get("built_project_days", 0)}; multi-builder '
             f'{F.get("built_multi_builder_project_days", 0)}')
    for k, c in res['controls'].items():
        L.append(f'  control {k}: {"ok" if c["ok"] else "FAILED"} -- {c["detail"]}')
    for p, why in res['void'].items():
        L.append(f'  VOID {p}: {why}')
    for p, why in (res.get('partial') or {}).items():
        L.append(f'  PARTIAL {p}: {why}')
    return '\n'.join(L)


# ------------------------------------------------------------------------------------------------- self-test
def selftest(verbose=True):
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f'{name}: got {got!r}, want {want!r}')
        elif verbose:
            print(f'  ok  {name} = {got!r}')

    # [P] one container K: stock 10 iron at first open; A deposits 5 (op 1); B withdraws 12 (op 2): B's lower bound is
    # 12 - 10 - 0 - 0 = 2 from another bot, upper min(12, 5) = 5. A verified xfer for A's deposit (pre/ver = the pair).
    o = lambda i, at, n: {'t': 'obs', 'id': i, 'k': 'K', 'at': at, 'bot': 'x', 'names': {'iron_ingot': [n, 1]}}
    d = lambda op, b, ph, at: {'t': 'dirty', 'id': f'{op}{ph}', 'op': op, 'k': 'K', 'at': at, 'bot': b, 'phase': ph}
    recs = [o('o1', 100, 10), d('op1', 'A', 'pre', 101), d('op1', 'A', 'post', 102), o('o2', 103, 15),
            d('op2', 'B', 'pre', 200), d('op2', 'B', 'post', 201), o('o3', 202, 3),
            {'t': 'xfer', 'id': 'x1', 'k': 'K', 'at': 102, 'bot': 'A', 'ok': 1, 'pre': 'o1', 'ver': 'o2'}]
    P = provenance(recs, 0, 10_000)
    check('[P] bounds on another bot\'s units (lower, upper, withdrawn)', (P['other_lb'], P['other_ub'], P['withdrawn']),
          (2, 5, 12))
    check('[P] positive control: the verified transfer is its own chain pair', (P['xfer_verified'], P['xfer_through_chain']),
          (1, 1))
    # a pair overlapped by two bots' ops, and one by an UNFINISHED op, reads unknown, never misattributed
    recs2 = [o('o1', 100, 10), d('a', 'A', 'pre', 101), d('a', 'A', 'post', 105), d('b', 'B', 'pre', 102),
             d('b', 'B', 'post', 104), o('o2', 106, 4), d('c', 'C', 'pre', 200), o('o3', 300, 2)]
    P2 = provenance(recs2, 0, 10_000)
    check('[P] two bots between one pair -> unknown', P2['pairs_multi_bot'], 1)
    check('[P] an unfinished op (no post) inside its TTL -> unknown', P2['pairs_unfinished_op'], 1)
    check('[P] unknown removals kept, never dropped', P2['unknown_removed'], 8)
    # a held-only op (no pre) is open from -infinity (townindex.mjs openAt)
    recs3 = [o('o1', 130_000, 10), o('o2', 160_000, 6), {'t': 'dirty', 'id': 'h', 'op': 'h', 'k': 'K', 'at': 200_000,
                                                          'bot': 'A', 'phase': 'held'}]
    check('[P] a missing-pre op covers earlier pairs', provenance(recs3, 0, 10**9)['pairs_unfinished_op'], 1)
    # PRIOR-DAY activity is context, not counted (Codex r1 P1-5): the same journal read from t0 = 150 sees only B's
    # withdrawal, and its starting stock is the 15 left by A's deposit before t0
    Pw = provenance(recs, 150, 10_000)
    check('[P] window start: only in-window changes; the stock at t0 is the base', (Pw['withdrawn'], Pw['other_lb'],
                                                                                    Pw['xfer_verified']), (12, 0, 0))
    check('[P] coverage: the journal covers the window from its first record', provenance(recs, 0, 3_600_100)['cover_h'], 1.0)
    # a verified transfer whose chain pair is attributed to ANOTHER bot is a failed control
    bad = [o('o1', 100, 10), d('op', 'B', 'pre', 101), d('op', 'B', 'post', 102), o('o2', 103, 15),
           {'t': 'xfer', 'id': 'x', 'k': 'K', 'at': 102, 'bot': 'A', 'ok': 1, 'pre': 'o1', 'ver': 'o2'}]
    Pb = provenance(bad, 0, 10_000)

    def ctl(**F):
        return controls({'fleet': F, 'towns': {'x': {'provenance': {} if F.get('prov_towns') else None}}})
    check('[P] mutant: a transfer attributed to another bot fails the control',
          ctl(prov_xfer_verified=Pb['xfer_verified'], prov_xfer_through_chain=Pb['xfer_through_chain'],
              pop_town_deposit_success=5)['xfer_through_chain']['ok'], False)
    # BLIND-INPUT MUTANTS (Claude r1 P1-5): each control fails when its population exists and the reader saw nothing
    check('control mutant: no verified transfer while town_deposit succeeded -> FAILED',
          ctl(pop_town_deposit_success=150)['xfer_through_chain']['ok'], False)
    check('control mutant: no smelt_town run while _smelt_town events exist -> FAILED',
          ctl(pop_smelt_town_events=40)['overlap_sweep_sees']['ok'], False)
    check('control mutant: 2,000 drain runs and no empty drain parsed -> FAILED',
          ctl(pop_furnace_drain_runs=2000)['furnace_rows_parsed']['ok'], False)
    check('control mutant: no observed position -> FAILED', ctl(together_bot_min=1440)['positions_seen']['ok'], False)
    check('control mutant: no readable index -> FAILED', ctl()['provenance_read']['ok'], False)
    mixed = controls({'fleet': {'prov_towns': 1}, 'towns': {'ok': {'provenance': {'cover_h': 24}}, 'bad': {'provenance': None}}})
    check('control mutant: one readable town and one UNREADABLE -> FAILED, and the unreadable one is named',
          (mixed['provenance_read']['ok'], 'bad' in mixed['provenance_read']['detail']), (False, True))
    check('controls: a healthy day passes', all(c['ok'] for c in ctl(
        prov_xfer_verified=88, prov_xfer_through_chain=88, pop_town_deposit_success=150, ov_smelt_town_runs=1646,
        ov_smelt_town_start_inside=107, pop_smelt_town_events=1646, pop_furnace_drain_runs=2237, furnace_empty=1435,
        furnace_sessions=795, together_bot_min=1440, together_observed_min=1400, prov_towns=1).values()), True)
    # [O] three smelt_town runs: A 0-100, B 50-150 (starts inside A), C 200-210; drains on two furnaces never overlap
    rows = [{'t': 0, 'bot': 'A', 'k': 'smelt_town', 'dur': 100_000}, {'t': 50, 'bot': 'B', 'k': 'smelt_town', 'dur': 100_000},
            {'t': 200, 'bot': 'C', 'k': 'smelt_town', 'dur': 10_000},
            {'t': 0, 'bot': 'A', 'k': 'furnace_drain', 'dur': 50_000, 'd': 'the furnace at 1,2,3 is empty'},
            {'t': 10, 'bot': 'B', 'k': 'furnace_drain', 'dur': 50_000, 'd': 'the furnace at 9,9,9 is empty'}]
    O = overlaps(rows, 0, 1000)
    check('[O] smelt_town: 1 start inside; overlapped bot-time 50 s for each of A and B',
          (O['smelt_town']['start_inside'], O['smelt_town']['overlap_bot_s']), (1, 100.0))
    check('[O] the drain is keyed by furnace', O['furnace_drain']['start_inside'], 0)
    # [F] A finds furnace F empty at t 0; B finds it empty at 600 s: a peer repeat; C at 1300 after a smelt session
    # (t0 900 s .. t1 1000 s) between: invalidated
    fr = [{'t': 0, 'bot': 'A', 'k': 'furnace_drain', 'dur': 2000, 'd': 'the furnace at 1,1,1 is empty'},
          {'t': 600, 'bot': 'B', 'k': 'furnace_drain', 'dur': 3000, 'd': 'the furnace at 1,1,1 is empty'},
          {'t': 1000, 'bot': 'X', 'k': '_furnace_session', 'd': 'furnace=1,1,1 lease=3 t0=900000 t1=1000000 by=smelt'},
          {'t': 1300, 'bot': 'C', 'k': 'furnace_drain', 'dur': 1000, 'd': 'the furnace at 1,1,1 is empty'}]
    F = furnace_repeats(fr)
    check('[F] one peer repeat (3 s), one invalidated by a load session, sessions parsed',
          (F['peer'], F['peer_s'], F['invalidated'], F['sessions']), (1, 3.0, 1, 1))
    # [C] A inside town for minutes 1-10, B 5-12, C never: >=2 minutes 5..10 = 6; C away and unflagged arrives? no
    tr = []
    for m in range(0, 61):
        tr.append({'t': m * 60 - 1, 'bot': 'A', 'k': '_x', 'p': [0, 64, 0] if 1 <= m <= 10 else [200, 64, 0]})
        tr.append({'t': m * 60 - 1, 'bot': 'B', 'k': '_x', 'p': [3, 64, 3] if 5 <= m <= 12 else [200, 64, 0]})
        tr.append({'t': m * 60 - 1, 'bot': 'C', 'k': '_x', 'p': [300, 64, 0]})
    C = together(tr, (0, 64, 0), 0, 3600)
    check('[C] together >= 2 (minutes), longest stretch', (C['ge2_min'], C['longest_ge2']), (6, 6))
    check('[C] stays and their median', (C['stays'], C['stay_median_min']), (2, 9.0))
    check('[C] observed minutes (every bot has a position each minute)', (C['observed_min'], C['unknown_min']), (180, 0))
    # an UNOBSERVED stretch is censored, never "did not arrive" (Codex r1 P2-7): D seen once, then silent
    C2 = together([{'t': 59, 'bot': 'D', 'k': '_x', 'p': [300, 64, 0]}], (0, 64, 0), 0, 3600)
    check('[C] one snapshot: 10 observed minutes, the rest unknown, no arrival read', (C2['observed_min'],
                                                                                         C2['away_unflagged']), (10, 0))
    # [B] idle until _build rows exist; with two bots on one project-day it counts one multi-builder day
    check('[B] idle instrument', built_together([])['rows'], 0)
    b = [{'t': 86400 * 3, 'bot': 'A', 'k': '_build', 's': 'success', 'd': 'project=workshop seg=wall-N cell=1,2,3'},
         {'t': 86400 * 3 + 60, 'bot': 'B', 'k': '_build', 's': 'success', 'd': 'project=workshop seg=wall-S cell=4,5,6'}]
    check('[B] one multi-builder project-day', built_together(b)['multi_builder_project_days'], 1)
    # THE FLEETSTATUS LINE (design 6.3 B1): absent, failed and healthy daily files, read by fleetstatus.coop_line
    fsp = os.path.join(HERE, 'fleetstatus.py')
    if os.path.exists(fsp):
        import importlib.util
        import tempfile
        spec = importlib.util.spec_from_file_location('fleetstatus_for_test', fsp)
        try:
            fsm = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(fsm)
        except Exception as e:                   # noqa: BLE001 -- fleetstatus needs the ES client: test the line if it loads
            fsm = None
            if verbose:
                print(f'  (fleetstatus not importable here: {type(e).__name__}; its line is tested on the host)')
        if fsm is not None:
            now = dt.datetime(2026, 10, 24, 3, 0, tzinfo=UTC)
            with tempfile.TemporaryDirectory() as d:
                check('fleetstatus: no daily file is an alarm line', fsm.coop_line(now, d).startswith('!!'), True)
                os.makedirs(os.path.join(d, 'daily'))
                good = {'window': ['2026-10-23T02:00:00Z', '2026-10-24T02:00:00Z'], 'controls': {'a': {'ok': True}},
                        'fleet': {'prov_towns': 2, 'prov_withdrawn': 100, 'prov_cover_h': 30},
                        'towns': {'t1': {'provenance': {}}, 't2': {'provenance': {}}}, 'partial': {'t2': 'covers 6 h'}}
                json.dump(good, open(os.path.join(d, 'daily', 'a.json'), 'w'))
                check('fleetstatus: a healthy fresh day is a plain line', fsm.coop_line(now, d).startswith('!!'), False)
                check('fleetstatus: PARTIAL towns stay visible', '1 PARTIAL' in fsm.coop_line(now, d), True)
                json.dump(dict(good, fleet={}, towns={'t1': {'provenance': None}}), open(os.path.join(d, 'daily', 'a2.json'), 'w'))
                check('fleetstatus: no readable index is an alarm line, VOID (never 0-0 of 0)',
                      (fsm.coop_line(now, d).startswith('!!'), 'VOID' in fsm.coop_line(now, d), '0-0 of 0' in fsm.coop_line(now, d)),
                      (True, True, False))
                json.dump(dict(good, towns={'t1': {'provenance': {}}, 't2': {'provenance': None}}),
                          open(os.path.join(d, 'daily', 'a3.json'), 'w'))
                check('fleetstatus: one UNREADABLE town is an alarm line naming it',
                      (fsm.coop_line(now, d).startswith('!!'), 'UNREADABLE t2' in fsm.coop_line(now, d)), (True, True))
                json.dump(good, open(os.path.join(d, 'daily', 'a4.json'), 'w'))
                check('fleetstatus: a 2-day-old file is STALE', 'STALE' in fsm.coop_line(now + dt.timedelta(days=2), d), True)
                json.dump(dict(good, controls={'a': {'ok': False}}), open(os.path.join(d, 'daily', 'b.json'), 'w'))
                check('fleetstatus: a failed control is an alarm line', fsm.coop_line(now, d).startswith('!! cooperation census (B1): controls FAILED'), True)
    if fails:
        print('SELFTEST FAILED:')
        for f in fails:
            print('  !! ' + f)
        return False
    if verbose:
        print('SELFTEST OK')
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--selftest', action='store_true')
    g.add_argument('--day', action='store_true')
    g.add_argument('--line', action='store_true')
    ap.add_argument('--until', help='window end (ISO); default the last whole hour')
    ap.add_argument('--out-dir', default=os.path.expanduser('~/coopread/out'))
    ap.add_argument('--state-dir', default='/var/lib/mcai')
    a = ap.parse_args()
    if a.selftest:
        return 0 if selftest() else 1
    if a.line:
        fs = sorted(glob.glob(os.path.join(a.out_dir, 'daily', '*.json')))
        if not fs:
            print('coop: NO DAILY FILE (the cooperation census has not run)')
            return 1
        res = json.load(open(fs[-1]))
        age_h = (time.time() - dt.datetime.fromisoformat(res['window'][1].replace('Z', '+00:00')).timestamp()) / 3600
        print(line(res) + (f'  ** STALE: {age_h:.0f} h old' if age_h > 30 else ''))
        return 0
    t = time.time()
    hb = {'mode': 'day'}
    try:
        if not selftest(verbose=False):
            hb.update(status='selftest_failed')
            print('SELFTEST FAILED -- refusing to read the fleet; run --selftest')
            return 2
        res = run_day(a)
        txt = render(res)
        print(txt)
        os.makedirs(os.path.join(a.out_dir, 'daily'), exist_ok=True)
        stem = os.path.join(a.out_dir, 'daily', res['window'][1].replace(':', ''))
        with open(stem + '.json', 'w') as f:
            json.dump(res, f, indent=1, sort_keys=True)
        with open(stem + '.txt', 'w') as f:
            f.write(txt + '\n')
        ok = all(c['ok'] for c in res['controls'].values()) and bool(res['towns'])
        hb.update(status='ok' if ok else 'control_failed', window=res['window'], void=len(res['void']),
                  controls={k: c['ok'] for k, c in res['controls'].items()})
        return 0 if ok else 1
    except Exception as e:
        hb.update(status='error', error=f'{type(e).__name__}: {e}'[:300])
        print(f'ERROR {type(e).__name__}: {e}', file=sys.stderr)
        return 1
    finally:
        hb.update(duration_s=round(time.time() - t, 1), at=iso(time.time()))
        try:
            os.makedirs(a.out_dir, exist_ok=True)
            with open(os.path.join(a.out_dir, 'heartbeat.jsonl'), 'a') as f:
                f.write(json.dumps(hb, sort_keys=True) + '\n')
        except OSError:
            pass


if __name__ == '__main__':
    sys.exit(main())
