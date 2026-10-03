#!/usr/bin/env python3
"""Score mayor proposals against what the bots did next. Offline. It measures PREDICTION, not effect.

    python3 mayor_score.py --snaps '/var/lib/mcai-mayor/snap-*.jsonl' \\
        --assign '/var/lib/mcai-mayor/assign-*.jsonl' --assign 'replay/assign-claude-*.jsonl' \\
        --logs '/var/log/mcai/*/skill-*.jsonl*' [--json out.json --allow-out-root DIR]

Any engine's assignment file works (deterministic, claude, gpt): an assignment is a candidate_id in a
snapshot the scorer also reads. Two baselines are generated from the same snapshots under the same
caps: `random` (a random ELIGIBLE bot) and `nearest`.

Per proposal (held leases are not re-scored; a frontier proposal is scored every time):
  exec        executable at the NEXT snapshot (~5 min later), re-checked with mayor_core.evaluate.
              Denominator: proposals with a next snapshot PLUS the validator's rejected proposals.
              (Executable at its own snapshot is true by construction for the deterministic mayor
              and is kept only as exec_now.)
  persist30/60 the shortage still there 30 / 60 min later (a self-clearing shortage is a false alarm)
  concord     the bot did the duty's OUTCOME anyway within 30 min (= the mayor was redundant)
  unobserved  not done AND the bot's state telemetry has a gap > stale_s in the window: silence is
              not failure, so these leave every denominator below
  unforced    eligible now AND at every snapshot through the window, observed throughout, need
              persisted 30 min, not done: the only place a mayor can add value. Bot-hours (intervals
              unioned per bot+duty) per world-day and per day. A shortage whose certainty is
              'unknown-bank' (GET_IRON: banked iron is unknown) is reported apart, never in the gap.
  downstream  outcome within 30 min AND (for a resource target) the bot came within 16 blocks of it.
  x random    DIAGNOSTIC ONLY, never a gate input: downstream rate / the random baseline's, both on
              STATELESS-CONTESTED proposals (`stcon`: duty-cap, world-cap, bot or target competition inside
              the snapshot -- see contested()) after the warm-up. Differences that come from lease HISTORY
              (who is held, who cools down) are excluded from it by construction. Deterministic vs the
              leased baselines; frontier engines vs the stateless ones (`*-stateless`).
  GATE RATIO  THE READ RULE, EVERY duty: deterministic x base / LEASED-random x base in the same partition
              over the SAME period (both lose the random run's warm-up, both go through the same lease logic); raw x base
              values printed beside it. Identical retained proposal streams give exactly 1.0 when defined.
              Matched periods remove the ASYMMETRIC warm-up exclusion; they do not guarantee identical lease
              phases or selections, so they do not by themselves make the ratio statistically unbiased. With
              more candidates than the duty cap (one candidate per bot does not remove competition ACROSS bots)
              mayor and random can pick different bots, and even FREE_BAG / RESTORE_PICK may then depart from
              1.0 because of which bot was chosen (`stateless_contested` counts such mayor proposals). SENSITIVITY BAND: the leased random baseline rerun from start
              offsets 0/5/10/15/20/25 min after every reset (offset 0 is the headline), min..max; INCOMPLETE if
              any offset is undefined, else 'initialization-dependent' when it straddles 1.5x, else PASSES /
              FAILS. A leased run CARRIES its own state, absolute start and absolute warm-up deadline across a
              transition only when decide() semantics are identical (same code rev, same DECIDE_CFG).
  x base      CONCORDANCE / the base rate of ELIGIBLE short bots: the same outcome, window and observation
              rule on both sides (a base bot has no target, so target-conditioned downstream is not used).
  logs30      GET_WOOD only, its own label: logs gained >= 1 in 30 min (the outcome is shortage RELIEF).

PARTITIONS AND EPOCHS. The key is code revision (`mayor_rev`; 'unstamped' before stamping) + a hash of
the canonical EFFECTIVE configuration recorded in each snapshot ('cfg-unrecorded' if none). Each
world's history splits into EPOCHS: contiguous runs of one key, so a rollback A,B,A is three epochs.
Every lookup stays inside its epoch; a window (outcome, base rate, persistence, gap) that reaches past
a non-final epoch's LAST snapshot crosses a transition and is CENSORED (`censored_epoch`), never credited.
Epochs of one key are summed into one partition, scored with THAT cfg (telemetry compacted with it too);
partitions are never pooled. BASELINES replay each epoch from its first snapshot -- before --since/--until
-- from their OWN empty state (never the mayor's leases); their proposals in the first lease_s +
cooldown_s of an epoch are unmatched warm-up and excluded (`warmup_excluded`), and no engine's x random
counts that period. --since/--until (ISO UTC) select which snapshots' proposals and base windows are
scored. With one partition the JSON also has top-level 'engines'/'base'; with several only 'partitions'.

Outcomes are read from inventory STATE (intent rows are not outcomes): FREE_BAG slots_est < 34 or
down >= 2; GET_WOOD RELIEF -- the short bot gained a log OR is no longer short_of_wood (picked up planks,
got a pickaxe), the same test as the lease's duty_done (GET_WOOD is a PER-BOT shortage: no usable pickaxe
and too little of its own wood to craft one); GET_IRON iron gained >= 1; RESTORE_PICK pickaxe back above 10%.

POSITIVE CONTROLS PRINT FIRST: rows and span globally, then PER PARTITION with that partition's cfg --
outcome EVENTS of each duty the detector finds in its scored span (FREE_BAG = crossing ITS full_slots)
and per-bot coverage of its snapshot times (within ITS stale_s). A zero next to a zero control OF THE
SAME PARTITION prints as UNCONTROLLED and exits 4. REPLAY snapshots (`replay: true`) are refused unless --replay-only, which
scores them on their own and never mixed with live ones.

MEMORY. One world at a time: that world's snapshots (inventories dropped) and its bots' state rows as
small tuples. The assignment records are the only fleet-wide structure, and they are small.
"""
import argparse
import bisect
import glob
import gzip
import hashlib
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402
import mayor_io  # noqa: E402

MIN = 60000
# a compact state row: (t_end_ms, slots_est, logs, iron_units, pick_ok, x, y, z, wood_short)
# wood_short: core.short_of_wood, or None when the pickaxe state is unknown (no durability logged)
T, SLOTS, LOGS, IRON, PICK_OK, X, Y, Z, WOOD_SHORT = range(9)
METRICS = ('n', 'rejected', 'exec_now', 'exec', 'exec_n', 'persist30', 'persist30_n', 'persist60', 'persist60_n',
           'concord', 'concord_n', 'unobserved', 'unforced', 'unforced_unknown_bank', 'not_eligible_through',
           'downstream', 'downstream_n', 'downstream_c', 'downstream_c_n', 'logs30', 'censored', 'censored_epoch',
           'warmup_excluded')
STATEFUL = ('deterministic', 'random', 'nearest')     # engines with lease memory; the rest are per-snapshot
LEASED_BASELINES = ('random', 'nearest')             # replayed by the scorer from an EMPTY state at each epoch start
DROP_BOT = ('inventory', 'last_skills', 'held')


def read_jsonl(paths):
    for p in paths:
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', errors='replace') as f:
            for line in f:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue


def world_of(rec):
    return rec.get('world') or str(rec.get('snap_id', '?')).split('@')[0]


def engine_label(rec):
    lab = rec.get('engine', '?')
    if rec.get('dry_run'):
        lab += '-dry'
    if rec.get('mode'):
        lab += ':' + rec['mode']
    return lab


def compact(row_bot, t, cfg):
    f = core.bot_features(row_bot, cfg)
    p = row_bot.get('pos') or {}
    short = None if f['pick_state'] == 'unknown' else core.short_of_wood(f)
    return (t, f['slots_est'], f['logs'], f['iron_units'], f['pick_state'] == 'ok', p.get('x'), p.get('y'), p.get('z'), short)


def bot_of_path(p):
    m = re.search(r'skill-(.+?)\.jsonl', os.path.basename(p))
    return m.group(1) if m else None


def load_telemetry(paths, bots, t_from, t_to, cfg, other_bots=()):
    """{bot: [compact state rows]} for `bots` inside [t_from, t_to]. Full reads (rotated .gz included)
    -- the window is set by the snapshots, never by seeking. A file named for a bot of ANOTHER world
    is skipped; any other file is read and filtered row by row."""
    out, n = {}, 0
    for p in paths:
        if bot_of_path(p) in other_bots:
            continue
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', errors='replace') as f:
            for line in f:
                if '"pos"' not in line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                rb = r.get('bot') or {}
                name = rb.get('name')
                if name not in bots or not core._valid_pos(rb.get('pos')) or not isinstance(rb.get('inventory'), dict):
                    continue                  # a state row needs a position AND an inventory (no fabricated empty bag)
                t = core.parse_ts(r.get('@timestamp'))
                if t is None or t < t_from or t > t_to:
                    continue
                try:
                    t += int((r.get('skill') or {}).get('duration_ms') or 0)
                except (TypeError, ValueError):
                    pass
                out.setdefault(name, []).append(compact(rb, t, cfg))
                n += 1
    for v in out.values():
        v.sort(key=lambda r: r[T])
    return out, n


def outcome(duty, base, seq, cfg):
    """Did the duty's outcome happen in `seq` (compact rows after the snapshot), from `base` (the
    snapshot's bot view)? Gains are summed over positive steps, so crafting logs away does not hide
    a gather."""
    if not seq:
        return False
    if duty == 'FREE_BAG':
        return any(r[SLOTS] < cfg['full_slots'] or r[SLOTS] <= base['slots_est'] - 2 for r in seq)
    if duty == 'RESTORE_PICK':
        return any(r[PICK_OK] for r in seq)
    if duty == 'GET_WOOD':                    # RELIEF, as duty_done: a log gained, or no longer short
        return gained(LOGS, base['logs'], seq) >= 1 or any(r[WOOD_SHORT] is False for r in seq)
    return gained(IRON, base['iron_units'], seq) >= 1


def gained(k, start, seq):
    prev, total = start, 0
    for r in seq:
        if r[k] > prev:
            total += r[k] - prev
        prev = r[k]
    return total


def logs_gained(base, seq):
    """GET_WOOD's own labelled metric, beside relief: did the bot gather a log at all?"""
    return bool(seq) and gained(LOGS, base['logs'], seq) >= 1


def detector_events(tel, cfg, t_from=None, t_to=None):
    """POSITIVE CONTROL: outcome events of each kind in the loaded telemetry -- judged with `cfg` (a FREE_BAG event
    is crossing THAT partition's full_slots) and, when given, only for steps ending inside [t_from, t_to]."""
    n = dict.fromkeys(core.DUTIES, 0)
    for seq in tel.values():
        for a, b in zip(seq, seq[1:]):
            if (t_from is not None and b[T] < t_from) or (t_to is not None and b[T] > t_to):
                continue
            n['FREE_BAG'] += a[SLOTS] >= cfg['full_slots'] > b[SLOTS]
            n['RESTORE_PICK'] += (not a[PICK_OK]) and b[PICK_OK]
            n['GET_WOOD'] += b[LOGS] > a[LOGS] or (a[WOOD_SHORT] is True and b[WOOD_SHORT] is False)
            n['GET_IRON'] += b[IRON] > a[IRON]
    return n


def window(seq, t0, t1):
    i = bisect.bisect_right(seq, t0, key=lambda r: r[T])
    out = []
    for r in seq[i:]:
        if r[T] > t1:
            break
        out.append(r)
    return out


def observed(seq, t0, t1, gap):
    """Was the bot's STATE seen across [t0, t1] with no silence longer than `gap`?"""
    pts = [r[T] for r in window(seq, t0 - gap, t1 + gap)]
    if not pts or pts[0] > t0 + gap or pts[-1] < t1 - gap:
        return False
    return all(b - a <= gap for a, b in zip(pts, pts[1:]))


def coverage(seq, times, gap):
    """Fraction of snapshot times with a state row within +-gap (the per-bot positive control)."""
    if not times:
        return None
    return coverage_hits(seq, times, gap) / len(times)


def coverage_hits(seq, times, gap):
    ts = [r[T] for r in seq]
    hit = 0
    for t in times:
        i = bisect.bisect_left(ts, t - gap)
        hit += i < len(ts) and ts[i] <= t + gap
    return hit


def need_holds(duty, bot_name, snap):
    """Does the shortage still hold at `snap`? None = UNKNOWN: for a per-bot duty when that bot is not
    fresh there; for a world duty when no bot is (shortages are computed from fresh bots only)."""
    names = {b['id']: b['name'] for b in snap['bots']}
    mine = [s for s in snap['shortages'] if s['duty'] == duty]
    if duty in core.BOT_SCOPE:
        b = next((b for b in snap['bots'] if b['name'] == bot_name), None)
        if b is None or not b['fresh']:
            return None
        if any(s['scope'] != 'bot' for s in mine):
            return None       # a LEGACY world-scope shortage of a per-bot duty says nothing about this bot
        return any(names.get(s['bot']) == bot_name for s in mine)
    if not any(b['fresh'] for b in snap['bots']):
        return None
    return bool(mine)


def snap_at(ws, t, tol):
    best = min(ws, key=lambda s: abs(s['t_ms'] - t), default=None)
    return best if best is not None and abs(best['t_ms'] - t) <= tol else None


def eligible_through(ws, bot_name, duty, t0, t1, cfg):
    """Eligible at EVERY snapshot in (t0, t1]; None if there is no snapshot there to check."""
    seen = False
    for s in ws:
        if t0 < s['t_ms'] <= t1:
            seen = True
            b = next((b for b in s['bots'] if b['name'] == bot_name), None)
            if b is None or not core.evaluate(duty, b, s, cfg)[0]:
                return False
    return True if seen else None


def union_ms(intervals):
    total, cur = 0, None
    for a, b in sorted(intervals):
        if cur is None or a > cur[1]:
            if cur:
                total += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    return total + (cur[1] - cur[0] if cur else 0)


def random_order(snap):
    def order(cs):
        cs = list(cs)
        random.Random(core.stable_hash(snap['snap_id'], 'random')).shuffle(cs)
        return cs
    return order


def nearest_order(snap):
    return lambda cs: sorted(cs, key=lambda c: (core.DUTY_RANK[c['duty']], c['dist'] if c['dist'] is not None else 0,
                                                c['bot_name']))


# The cfg keys core.decide() reads (caps, lease, cooldown; duty_done reads full_slots). Every OTHER key only
# shapes the snapshot (candidates, feasibility), which decide takes as given. Property-tested: perturbing any
# other key leaves decide's output identical; perturbing one of these changes it.
DECIDE_CFG = ('cap_per_world', 'cap_per_duty', 'lease_s', 'cooldown_s', 'full_slots')
BAND_OFFSETS_MIN = (0, 5, 10, 15, 20, 25)     # leased-baseline start offsets after a reset (sensitivity band)
# ALL four duties: raw x base leans KEEP for any leased engine (a failing bot is re-proposed about every 25 min
# while the base samples it every 5); the lease-matched, period-matched ratio compares like with like on that
# account. Identical retained proposal streams give exactly 1.0; it is NOT guaranteed otherwise -- matched
# periods do not equalise lease phases or selections, and with more candidates than the duty cap mayor and
# random may pick different bots, so FREE_BAG / RESTORE_PICK can depart from 1.0 (test_review8).
GATE_DUTIES = core.DUTIES
GATE_THRESHOLD = 1.5


def decide_compat(snap):
    """Two epochs with the same value here run IDENTICAL decide() semantics: the same code revision (decide is
    in mayor_core, inside the hash) and the same DECIDE_CFG values. Only then may a baseline carry its state."""
    cfg = snap.get('_cfg') or effective_cfg(snap)
    return rev_of(snap), json.dumps({k: cfg[k] for k in DECIDE_CFG}, sort_keys=True)


def leased_run(ep, cfg, order_of, state=None, start_ms=None):
    """One leased baseline over one epoch: core.decide with only the ORDER changed (same leases, cooldowns,
    caps). `state` is this baseline's OWN state carried from the previous epoch (never the mayor's), or None
    (a reset); `start_ms` starts the replay later (the sensitivity band). -> (new proposals, end state)"""
    props = []
    for s in ep:
        if start_ms is not None and s['t_ms'] < start_ms:
            continue
        order = order_of(s)
        rec, state = core.decide(s, state, cfg, order=order)
        props += [(s['snap_id'], {'candidate_id': a['candidate_id'], 'target': a['target']})
                  for a in rec['assignments'] if a['lease'] != 'held']
    return props, state


def stateless_run(ep, cfg, order_of):
    """Greedy per snapshot, no memory: the matched baseline for the per-snapshot frontier engines."""
    out = []
    for s in ep:
        out += [(s['snap_id'], a) for a in core.greedy(s, order_of(s)(s['candidates']), cfg)]
    return out


def baselines(snaps, cfg=core.DEFAULTS):
    """All four baselines over one epoch from a reset (kept for callers that want them in one call)."""
    out = {}
    for name, order_of in (('random', random_order), ('nearest', nearest_order)):
        out[name] = leased_run(snaps, cfg, order_of)[0]
        out[name + '-stateless'] = stateless_run(snaps, cfg, order_of)
    return out


def x_base(m, base_elig):
    """CONCORDANCE / the eligible base rate: the same outcome, window and observation rule on both sides."""
    k, n = base_elig
    cr = m['concord'] / m['concord_n'] if m and m['concord_n'] else None
    return (cr / (k / n)) if cr is not None and n and k else None


def gate_ratio(det_xbase, random_xbase):
    """THE READ RULE: the deterministic mayor's x base over the LEASED-random baseline's, same partition, same
    period. Both go through the same lease logic; that does not make their lease phases or selections
    identical, so this is a like-for-like comparison, not a proof of unbiasedness. Reads x base ONLY -- x random
    is a diagnostic and never a gate input."""
    return det_xbase / random_xbase if det_xbase is not None and random_xbase else None


def band_flag(values, threshold=GATE_THRESHOLD):
    """INCOMPLETE if ANY offset is undefined -- including offset 0, which IS the headline gate ratio -- (the
    partial band and the undefined count are still printed); else 'initialization-dependent' when the band
    straddles the gate, 'passes' only when every offset is at or above it, 'fails' when every one is below."""
    got = [v for v in values if v is not None]
    if not got or len(got) < len(values):
        return 'incomplete'
    lo, hi = min(got), max(got)
    return 'initialization-dependent' if lo < threshold <= hi else ('passes' if lo >= threshold else 'fails')


def baseline_for(eng):
    return 'random' if eng.split(':')[0] in STATEFUL else 'random-stateless'


def contested(snap, duty, cfg):
    """Does the ORDER of assignment matter for `duty` in this snapshot? True on ANY competition:
    (1) more feasible candidates of the duty than cap_per_duty; (2) more bots with a feasible candidate (any
    duty) than cap_per_world; (3) a bot of this duty is feasible for another duty too (one duty per bot);
    (4) two of this duty's candidates share a target. Otherwise EVERY order assigns the same candidates of
    this duty with the same targets (property-tested against core.greedy), so random and the mayor cannot
    differ there and the snapshot says nothing about choosing well."""
    feas = [c for c in snap['candidates'] if c['feasible']]
    mine = [c for c in feas if c['duty'] == duty]
    if len(mine) > cfg['cap_per_duty']:
        return True
    if len({c['bot'] for c in feas}) > cfg['cap_per_world']:
        return True
    per_bot = {}
    for c in feas:
        per_bot[c['bot']] = per_bot.get(c['bot'], 0) + 1
    if any(per_bot[c['bot']] > 1 for c in mine):
        return True
    seen = set()
    for c in mine:
        if seen.intersection(c['targets']):
            return True
        seen.update(c['targets'])
    return False


def rev_of(snap):
    return snap.get('mayor_rev') or 'unstamped'


def effective_cfg(snap):
    """The configuration the snapshot was BUILT with: its recorded cfg over DEFAULTS (a key the recording
    lacks falls back to today's default -- the only assumption, and only for files older than the key)."""
    c = dict(core.DEFAULTS)
    if isinstance(snap.get('cfg'), dict):
        c.update(snap['cfg'])
    return c


def cfg_tag(snap):
    rec = snap.get('cfg')
    if not isinstance(rec, dict):
        return 'cfg-unrecorded'
    canon = json.dumps(effective_cfg(snap), sort_keys=True, separators=(',', ':'), default=list)
    return 'cfg-' + hashlib.sha256(canon.encode()).hexdigest()[:8]


def part_key(snap):
    """The scoring partition: CODE revision + canonical EFFECTIVE configuration."""
    return '%s/%s' % (rev_of(snap), cfg_tag(snap))


def epochs(ws):
    """Time-ordered snapshots -> CONTIGUOUS runs of one partition key. A rollback (A, B, A) is three
    epochs: nothing in the first A may read the second, and no window may bridge B."""
    out = []
    for s in ws:
        if out and out[-1][0] == s['_key']:
            out[-1][1].append(s)
        else:
            out.append((s['_key'], [s]))
    return out


def score_world(ws, records, rejected, tel, tel_end, cfg, interval_ms, res, gaps, epoch_end=None,
                scored=lambda s: True, warm_until=None, warm_all=False):
    """Add ONE EPOCH's proposals into `res` {engine: {duty: metrics}} and `gaps`. `ws` is the whole epoch (every
    lookup -- next snapshot, +30/+60, eligibility through -- stays inside it); `scored(s)` picks the snapshots
    whose proposals count (--since/--until). `epoch_end` (None for the last epoch) is the epoch's LAST snapshot:
    a window reaching past it crosses a partition transition and is CENSORED (censored_epoch), never credited.
    Leased-baseline proposals before `warm_until` are unmatched warm-up (empty start state): excluded, and no
    engine's x-random numerator counts that period."""
    tol = interval_ms * 1.5
    gap = cfg['stale_s'] * 1000
    horizon = tel_end if epoch_end is None else min(tel_end, epoch_end)
    by_id = {s['snap_id']: s for s in ws}
    for eng, items in rejected.items():
        for sid, cid in items:
            s = by_id.get(sid)
            if s is None or not scored(s):
                continue                          # another epoch's (or window's) snapshot: not scored here
            c = next((c for c in s['candidates'] if c['id'] == cid), None) if isinstance(cid, str) else None
            m = res.setdefault(eng, {}).setdefault(c['duty'] if c else '?', dict.fromkeys(METRICS, 0))
            m['rejected'] += 1
            m['exec_n'] += 1
    for eng, items in records.items():
        for sid, a in items:
            s = by_id.get(sid)
            c = next((c for c in s['candidates'] if c['id'] == a.get('candidate_id')), None) if s and scored(s) else None
            if c is None:
                continue
            duty, t = c['duty'], s['t_ms']
            bot = next(b for b in s['bots'] if b['id'] == c['bot'])
            m = res.setdefault(eng, {}).setdefault(duty, dict.fromkeys(METRICS, 0))
            warm = warm_until is not None and t < warm_until
            if warm and (warm_all or eng in LEASED_BASELINES):
                m['warmup_excluded'] += 1        # its empty start state forced this proposal: unmatched
                continue
            m['n'] += 1
            ok_now = core.evaluate(duty, bot, s, cfg)[0]
            m['exec_now'] += ok_now
            nxt = next((x for x in ws if interval_ms * 0.5 <= x['t_ms'] - t <= tol), None)
            nb = None if nxt is None else next((b for b in nxt['bots'] if b['name'] == bot['name']), None)
            if nb is not None and nb['fresh']:   # missing or stale at +5 is UNKNOWN, not inexecutable
                m['exec_n'] += 1
                m['exec'] += core.evaluate(duty, nb, nxt, cfg)[0]
            # persistence is read only INSIDE the epoch and only for an interval that ends inside it
            p30 = snap_at(ws, t + 30 * MIN, tol) if t + 30 * MIN <= horizon else None
            p60 = snap_at(ws, t + 60 * MIN, tol) if t + 60 * MIN <= horizon else None
            h30 = None if p30 is None else need_holds(duty, bot['name'], p30)
            h60 = None if p60 is None else need_holds(duty, bot['name'], p60)
            h30 = None if h30 is None else bool(h30)
            if h30 is not None:
                m['persist30_n'] += 1
                m['persist30'] += h30
            if h60 is not None:
                m['persist60_n'] += 1
                m['persist60'] += h60
            if t + 30 * MIN > horizon:
                m['censored_epoch' if epoch_end is not None and t + 30 * MIN > epoch_end else 'censored'] += 1
                continue
            seq = tel.get(bot['name'], [])
            seq30 = window(seq, t, t + 30 * MIN)
            done30 = outcome(duty, bot, seq30, cfg)
            if not observed(seq, t, t + 30 * MIN, gap):
                m['unobserved'] += 1             # silence: out of EVERY outcome denominator, done or not
                continue
            m['concord_n'] += 1
            m['concord'] += done30
            if duty == 'GET_WOOD':
                m['logs30'] += logs_gained(bot, seq30)
            tgt = next((r for r in s['resources'] if r['id'] == a.get('target')), None)
            near = tgt is None or any(r[X] is not None and core.dist3({'x': r[X], 'y': r[Y], 'z': r[Z]}, tgt) <= cfg['near_target']
                                      for r in seq30)
            m['downstream_n'] += 1
            m['downstream'] += done30 and near
            if not warm and contested(s, duty, cfg):
                m['downstream_c_n'] += 1
                m['downstream_c'] += done30 and near
            if not (ok_now and h30 and not done30):
                continue
            through = eligible_through(ws, bot['name'], duty, t, t + 30 * MIN, cfg)
            if not through:
                m['not_eligible_through'] += 1
                continue
            sh = next((x for x in s['shortages'] if x['id'] == c['shortage']), {})
            if sh.get('certainty', 'definite') != 'definite':
                m['unforced_unknown_bank'] += 1
                continue
            m['unforced'] += 1
            end = t + 30 * MIN
            if (h60 and t + 60 * MIN <= horizon and observed(seq, t, t + 60 * MIN, gap)
                    and eligible_through(ws, bot['name'], duty, t, t + 60 * MIN, cfg)
                    and not outcome(duty, bot, window(seq, t, t + 60 * MIN), cfg)):
                end = t + 60 * MIN
            gaps.setdefault((eng, duty), []).append(((s['world'], bot['name']), t, end))


def base_rates(ws, tel, tel_end, cfg, acc, acc_elig, epoch_end=None, scored=lambda s: True):
    """acc: every fresh, observed bot the shortage applied to. acc_elig: of those, the ones the mayor could
    have assigned (core.evaluate feasible) -- what a proposal's CONCORDANCE is divided by (x base). A window
    that reaches past the epoch's last snapshot crosses a partition transition and is left out."""
    horizon = tel_end if epoch_end is None else min(tel_end, epoch_end)
    for s in ws:
        if not scored(s) or s['t_ms'] + 30 * MIN > horizon:
            continue
        for b in s['bots']:
            if not b['fresh']:
                continue
            for d in core.DUTIES:
                seq = tel.get(b['name'], [])
                if need_holds(d, b['name'], s) and observed(seq, s['t_ms'], s['t_ms'] + 30 * MIN, cfg['stale_s'] * 1000):
                    done = outcome(d, b, window(seq, s['t_ms'], s['t_ms'] + 30 * MIN), cfg)
                    acc[d][1] += 1
                    acc[d][0] += done
                    if core.evaluate(d, b, s, cfg)[0]:
                        acc_elig[d][1] += 1
                        acc_elig[d][0] += done


def pct(k, n):
    return '   -  ' if not n else '%5.1f%%' % (100.0 * k / n)


def strip(s):
    for b in s['bots']:
        for k in DROP_BOT:
            b.pop(k, None)
    s.pop('cfg', None)
    s.pop('estimates', None)
    return s


def parse_bound(v, name):
    if v is None:
        return None
    t = core.parse_ts(v if 'T' in v else v + 'T00:00:00Z')
    if t is None:
        raise ValueError('%s %r is not an ISO UTC time (e.g. 2026-10-04T02:00:00Z)' % (name, v))
    return t


def in_window(s, since, until):
    t = s.get('t_ms')
    return isinstance(t, int) and (since is None or t >= since) and (until is None or t <= until)


def finish(res, gaps, wd, days):
    """unforced hours, x random (contested, against the matching baseline), x base (eligible) for ONE revision."""
    for (eng, duty), items in gaps.items():
        per = {}
        for key, a, b in items:
            per.setdefault(key, []).append((a, b))
        res[eng][duty]['unforced_h'] = sum(union_ms(v) for v in per.values()) / 3.6e6
    for eng in res:
        for d, m in res[eng].items():
            rnd = res.get(baseline_for(eng), {}).get(d)
            rr = rnd['downstream_c'] / rnd['downstream_c_n'] if rnd and rnd['downstream_c_n'] else None
            dc = m['downstream_c'] / m['downstream_c_n'] if m['downstream_c_n'] else None
            m['x_random'] = (dc / rr) if dc is not None and rr else None
            m['x_random_vs'] = baseline_for(eng)


def main(argv=None):
    ap = argparse.ArgumentParser(description='score mayor proposals (prediction, not effect)')
    ap.add_argument('--snaps', default='/var/lib/mcai-mayor/snap-*.jsonl')
    ap.add_argument('--assign', action='append', help='glob; repeatable (deterministic, claude, gpt files)')
    ap.add_argument('--logs', default='/var/log/mcai/*/skill-*.jsonl*')
    ap.add_argument('--interval', type=int, default=300)
    ap.add_argument('--since', help='ISO UTC: score only snapshots at or after this time')
    ap.add_argument('--until', help='ISO UTC: score only snapshots at or before this time')
    ap.add_argument('--json', help='write the full result here')
    ap.add_argument('--allow-out-root', action='append', help='allowlisted root for --json (default /var/lib/mcai-mayor)')
    ap.add_argument('--replay-only', action='store_true', help='score ONLY replay snapshots (never mixed with live)')
    ap.add_argument('--allow-zero', action='store_true', help='do not exit 4 on an uncontrolled zero')
    args = ap.parse_args(argv)
    try:
        since, until = parse_bound(args.since, '--since'), parse_bound(args.until, '--until')
    except ValueError as e:
        print('REFUSING: %s' % e, file=sys.stderr)
        return 2
    if args.json:
        try:
            jdir = mayor_io.safe_out_dir(os.path.dirname(os.path.abspath(args.json)), args.allow_out_root)
        except mayor_io.UnsafeOutput as e:
            print('REFUSING --json: %s' % e, file=sys.stderr)
            return 2
    cfg = dict(core.DEFAULTS)
    interval_ms = args.interval * 1000
    gapms = cfg['stale_s'] * 1000

    # index: which snapshot files hold which world (one streaming pass over first lines + replay flags)
    files_by_world, files_by_world_all, bots_by_world, n_replay, n_live = {}, {}, {}, 0, 0
    for p in sorted(glob.glob(args.snaps)):
        for s in read_jsonl([p]):
            files_by_world_all.setdefault(s.get('world'), set()).add(p)     # history: baselines replay from here
            if not in_window(s, since, until):
                continue
            files_by_world.setdefault(s.get('world'), set()).add(p)
            bots_by_world.setdefault(s.get('world'), set()).update(b.get('name') for b in s.get('bots') or [])
            if s.get('replay'):
                n_replay += 1
            else:
                n_live += 1
    if args.replay_only and not n_replay or not args.replay_only and not n_live:
        print('NO %s SNAPSHOTS matched %s%s (%d live, %d replay) -- nothing to score (this is not a zero).%s' % (
            'REPLAY' if args.replay_only else 'LIVE', args.snaps,
            '' if since is None and until is None else ' in [%s, %s]' % (args.since, args.until), n_live, n_replay,
            '' if args.replay_only else ' Replay snapshots are scored only with --replay-only, never mixed with live.'))
        return 2
    records, rejected, invalid = {}, {}, {}
    for pat in args.assign or ['/var/lib/mcai-mayor/assign-*.jsonl']:
        for rec in read_jsonl(sorted(glob.glob(pat))):
            if rec.get('reask_of'):
                continue                          # re-asks measure self-consistency, not the engine
            if bool(rec.get('replay')) != args.replay_only:
                continue                          # EVERY engine: replay records never mix with live scoring
            lab, w = engine_label(rec), world_of(rec)
            for a in rec.get('assignments') or []:
                if isinstance(a, dict) and a.get('lease') != 'held':
                    records.setdefault(w, {}).setdefault(lab, []).append((rec['snap_id'], {k: a.get(k) for k in ('candidate_id', 'target')}))
            for x in rec.get('rejected') or []:
                item = x.get('item') if isinstance(x, dict) else None
                cid = item.get('candidate_id') if isinstance(item, dict) else None
                rejected.setdefault(w, {}).setdefault(lab, []).append((rec['snap_id'], cid))
            if rec.get('valid') is False:
                invalid[lab] = invalid.get(lab, 0) + 1
    paths = sorted(glob.glob(args.logs))
    revs = {}         # partition key (code rev + effective cfg) -> {res, gaps, base, base_elig, det, cov, band, ...}
    n_rows, n_snaps, t_lo, t_hi = 0, 0, None, None

    def new_part(ep, cfg_e, tag):
        return {'res': {}, 'gaps': {}, 'base': {d: [0, 0] for d in core.DUTIES},
                'base_elig': {d: [0, 0] for d in core.DUTIES}, 'wd': 0.0, 'epochs': 0, 'carried_epochs': 0,
                't_lo': None, 't_hi': None, 'snapshots': 0, 'cfg': cfg_e, 'mayor_rev': rev_of(ep[0]), 'cfg_tag': tag,
                'det': dict.fromkeys(core.DUTIES, 0), 'cov': {}, 'band': {o: {} for o in BAND_OFFSETS_MIN}}

    for world in sorted(w for w in files_by_world if w):
        # the WHOLE history of the world (no --since/--until yet): baselines replay from the start of the data
        hist = []
        for s in read_jsonl(sorted(files_by_world_all[world])):
            if s.get('world') == world and bool(s.get('replay')) == args.replay_only and isinstance(s.get('t_ms'), int):
                s['_key'], s['_cfg'], s['_cfg_tag'] = part_key(s), effective_cfg(s), cfg_tag(s)
                hist.append(strip(s))
        hist.sort(key=lambda s: s['t_ms'])
        sel = [s for s in hist if in_window(s, since, until)]
        if not sel:
            continue
        n_snaps += len(sel)
        t0, t1 = sel[0]['t_ms'], sel[-1]['t_ms']
        t_lo, t_hi = min(t_lo or t0, t0), max(t_hi or t1, t1)
        bots = {b['name'] for s in hist for b in s['bots']}
        others = set().union(*(v for k, v in bots_by_world.items() if k != world)) - bots
        tels = {}                                 # telemetry COMPACTED WITH EACH EPOCH'S OWN cfg
        runs = epochs(hist)
        scored = (lambda s: in_window(s, since, until))
        # each leased run (random, nearest, random@offset) carries its OWN {state, start, warm}: the lease state,
        # the ABSOLUTE time it started replaying and the ABSOLUTE end of its warm-up -- all three survive a
        # compatible transition, so a pending band start or an unfinished warm-up is never dropped
        carry, prev_compat = {}, None
        for idx, (key, ep) in enumerate(runs):
            cfg_e = ep[0]['_cfg']
            compat = decide_compat(ep[0])
            carried = compat == prev_compat       # identical decide() semantics across the transition
            prev_compat = compat
            if not carried:
                carry = {}
            ep0 = ep[0]['t_ms']
            warm_ms = (cfg_e['lease_s'] + cfg_e['cooldown_s']) * 1000
            def run_of(nm, start_ms):
                if nm not in carry:               # a reset: this run starts at start_ms with an empty state
                    carry[nm] = {'state': None, 'start': start_ms, 'warm': start_ms + warm_ms}
                return carry[nm]
            # replay EVERY epoch (selected or not) so carried state is never skipped
            leased = {}
            for name, order_of in (('random', random_order), ('nearest', nearest_order)):
                r = run_of(name, ep0)
                leased[name], r['state'] = leased_run(ep, cfg_e, order_of, r['state'], r['start'])
            band_props, band_warm = {}, {}
            for o in BAND_OFFSETS_MIN:
                r = run_of('random@%d' % o, ep0 + o * MIN)
                band_props[o], r['state'] = leased_run(ep, cfg_e, random_order, r['state'], r['start'])
                band_warm[o] = r['warm']
            mine = [s for s in ep if scored(s)]
            if not mine:
                continue
            tag = ep[0]['_cfg_tag']
            if tag not in tels:
                tel_c, n = load_telemetry(paths, bots, t0 - 10 * MIN, t1 + 65 * MIN, cfg_e, others)
                tels[tag] = (tel_c, max((seq[-1][T] for seq in tel_c.values() if seq), default=0))
                n_rows += n
            tel, tel_end = tels[tag]
            epoch_end = ep[-1]['t_ms'] if idx < len(runs) - 1 else None
            warm_until = carry['random']['warm']
            R = revs.setdefault(key, new_part(ep, cfg_e, tag))
            a, b = mine[0]['t_ms'], mine[-1]['t_ms']
            R['t_lo'], R['t_hi'] = min(R['t_lo'] or a, a), max(R['t_hi'] or b, b)
            R['wd'] += (b - a + interval_ms) / 8.64e7
            R['snapshots'] += len(mine)
            R['epochs'] += 1
            R['carried_epochs'] += carried
            recs = dict(records.get(world, {}))
            recs.update(leased)                   # the epoch's FULL history, its own cfg, its own (carried) state
            for name, order_of in (('random', random_order), ('nearest', nearest_order)):
                recs[name + '-stateless'] = stateless_run(ep, cfg_e, order_of)
            score_world(ep, recs, rejected.get(world, {}), tel, tel_end, cfg_e, interval_ms, R['res'], R['gaps'],
                        epoch_end=epoch_end, scored=scored, warm_until=warm_until)
            base_rates(ep, tel, tel_end, cfg_e, R['base'], R['base_elig'], epoch_end=epoch_end, scored=scored)
            det_recs = records.get(world, {}).get('deterministic', [])
            for o in BAND_OFFSETS_MIN:            # the same random baseline started o minutes after each reset,
                # and the mayor over the SAME period (both lose the run's warm-up): the gate is period-matched
                score_world(ep, {'random': band_props[o], 'deterministic': det_recs}, {}, tel, tel_end, cfg_e,
                            interval_ms, R['band'][o], {}, epoch_end=epoch_end, scored=scored,
                            warm_until=band_warm[o], warm_all=True)
            # POSITIVE CONTROLS FOR THIS PARTITION, with ITS cfg: detector events in the scored span (+30 min
            # outcome horizon, never past the epoch), and coverage of its snapshot times with its stale_s
            horizon = min(tel_end, epoch_end) if epoch_end is not None else tel_end
            for d, k in detector_events(tel, cfg_e, a, min(b + 30 * MIN, horizon)).items():
                R['det'][d] += k
            times = [s['t_ms'] for s in mine]
            for bn in bots:
                h, nn = R['cov'].get(bn, (0, 0))
                R['cov'][bn] = (h + coverage_hits(tel.get(bn, []), times, cfg_e['stale_s'] * 1000), nn + len(times))
        del hist, sel, tels
    for R in revs.values():
        R['days'] = (R['t_hi'] - R['t_lo'] + interval_ms) / 8.64e7
        finish(R['res'], R['gaps'], R['wd'], R['days'])
        for eng in R['res']:
            for d, m in R['res'][eng].items():
                m['x_base_elig'] = x_base(m, R['base_elig'].get(d, (0, 0)))
        R['gate'] = {}
        for d in GATE_DUTIES:
            per = []                              # (det x base, random x base) over each offset's matched period
            for o in BAND_OFFSETS_MIN:
                dx = x_base(R['band'][o].get('deterministic', {}).get(d), R['base_elig'][d])
                rx = x_base(R['band'][o].get('random', {}).get(d), R['base_elig'][d])
                per.append((dx, rx))
            vals = [gate_ratio(dx, rx) for dx, rx in per]
            got = [v for v in vals if v is not None]
            lo, hi = (min(got), max(got)) if got else (None, None)
            raw = lambda e: (R['res'].get(e, {}).get(d) or {}).get('x_base_elig')
            bm = [R['band'][o].get('random', {}).get(d) or {} for o in BAND_OFFSETS_MIN]
            dm0 = R['band'][BAND_OFFSETS_MIN[0]].get('deterministic', {}).get(d) or {}
            R['gate'][d] = {'gate_ratio': vals[0], 'det_xbase': per[0][0], 'random_xbase': per[0][1],
                            # mayor proposals in the headline period whose snapshot offered a choice of bot or
                            # target: where they exist, mayor and random may have selected differently
                            'stateless_contested': dm0.get('downstream_c_n', 0),
                            'raw_det_xbase': raw('deterministic'), 'raw_random_xbase': raw('random'),
                            'band': {'offsets_min': list(BAND_OFFSETS_MIN), 'values': vals, 'min': lo, 'max': hi,
                                     'undefined': len(vals) - len(got),
                                     'random_n': [m.get('n', 0) for m in bm],
                                     'random_warmup_excluded': [m.get('warmup_excluded', 0) for m in bm]},
                            'flag': band_flag(vals), 'threshold': GATE_THRESHOLD,
                            'reset_epochs': R['epochs'] - R['carried_epochs']}

    # ---- POSITIVE CONTROLS FIRST: global, then per partition (with each partition's own cfg)
    print('CONTROLS  %s snapshots %d, %s .. %s; partitions (code rev/cfg): %s' % (
        'REPLAY' if args.replay_only else 'live', n_snaps, core.iso(t_lo), core.iso(t_hi),
        ', '.join('%s (%d)' % (r, R['snapshots']) for r, R in sorted(revs.items()))))
    print('          telemetry state rows: %d; invalid responses: %s' % (
        n_rows, ', '.join('%s %d' % kv for kv in sorted(invalid.items())) or 'none'))
    if not n_rows:
        print('UNCONTROLLED: no telemetry rows in the window -- every outcome below would be a blind zero')
        return 4
    uncontrolled = []
    for rev, R in sorted(revs.items()):
        res = R['res']
        cov = {b: (h / n if n else None) for b, (h, n) in R['cov'].items()}
        vals = sorted(v for v in cov.values() if v is not None)
        print('\n=== PARTITION %s: %d snapshots in %d epoch(s) (%d carried a baseline state), %s .. %s (scored alone; '
              'never pooled, no window crosses an epoch)' % (rev, R['snapshots'], R['epochs'], R['carried_epochs'],
                                                             core.iso(R['t_lo']), core.iso(R['t_hi'])))
        print('CONTROLS  (this partition, cfg full_slots=%s stale_s=%s) detector events: %s' % (
            R['cfg']['full_slots'], R['cfg']['stale_s'], ', '.join('%s %d' % kv for kv in R['det'].items())))
        print('          coverage of its snapshot times: %d of %d bots have rows; median %.2f, min %.2f' % (
            sum(1 for v in cov.values() if v), len(cov), vals[len(vals) // 2] if vals else 0, vals[0] if vals else 0))
        low = sorted((v, b) for b, v in cov.items() if v is not None and v < 0.5)
        if low:
            print('          bots under 50%% coverage (their silences are unobserved, not failures): %s' % ', '.join(
                '%s %.2f' % (b, v) for v, b in low[:12]))
        print('          proposals: %s' % (', '.join('%s %d' % (e, sum(m['n'] for m in res[e].values())) for e in sorted(res)) or 'none'))
        print('BASE RATE (outcome within 30 min; all short bots / ELIGIBLE short bots):')
        for d in core.DUTIES:
            print('  %-12s %s  (%d of %d)   eligible %s  (%d of %d)' % (d, pct(*R['base'][d]), R['base'][d][0], R['base'][d][1],
                                                                   pct(*R['base_elig'][d]), R['base_elig'][d][0], R['base_elig'][d][1]))
        print('\nGATE RATIO (the read rule): deterministic x base / LEASED-random x base, same partition, same period; '
              'threshold %.1fx. Exactly 1.0 only for identical retained proposal streams; not a proof of unbiasedness.'
              % GATE_THRESHOLD)
        for d in GATE_DUTIES:
            g = R['gate'][d]
            f = lambda v: '   -  ' if v is None else '%6.2f' % v
            print('  %-12s gate %s   (matched-period xbase: deterministic %s, leased random %s; raw xbase %s, %s)   '
                  'band over random start offsets %s min: %s .. %s (%d undefined) -> %s' % (
                      d, f(g['gate_ratio']), f(g['det_xbase']), f(g['random_xbase']), f(g['raw_det_xbase']),
                      f(g['raw_random_xbase']),
                      '/'.join(map(str, BAND_OFFSETS_MIN)), f(g['band']['min']), f(g['band']['max']),
                      g['band']['undefined'], g['flag'].upper()))
            if g['stateless_contested']:
                print('  %-12s      %d of the mayor\'s observed proposals in this period were stateless-contested: '
                      'mayor and random may have chosen different bots/targets there' % ('', g['stateless_contested']))
        print('\n%-26s %-12s %4s %4s %7s %7s %7s %7s %5s %7s %5s %6s %6s %8s %8s %4s' % (
            'engine', 'duty', 'n', 'rej', 'exec+5', 'pers30', 'pers60', 'concord', 'unobs', 'downstr', 'stcon', 'xrand',
            'xbase', 'gap h/wd', 'gap h/d', 'unkb'))
        for eng in sorted(res):
            for d in list(core.DUTIES) + ['?']:
                m = res[eng].get(d)
                if not m:
                    continue
                gh = m.get('unforced_h', 0.0)
                print('%-26s %-12s %4d %4d %7s %7s %7s %7s %5d %7s %5d %6s %6s %8.2f %8.2f %4d' % (
                    eng, d, m['n'], m['rejected'], pct(m['exec'], m['exec_n']), pct(m['persist30'], m['persist30_n']),
                    pct(m['persist60'], m['persist60_n']), pct(m['concord'], m['concord_n']), m['unobserved'],
                    pct(m['downstream'], m['downstream_n']), m['downstream_c_n'],
                    '%6.2f' % m['x_random'] if m.get('x_random') is not None else '   -  ',
                    '%6.2f' % m['x_base_elig'] if m.get('x_base_elig') is not None else '   -  ',
                    gh / R['wd'] if R['wd'] else 0, gh / R['days'] if R['days'] else 0, m['unforced_unknown_bank']))
                if d == 'GET_WOOD' and m['concord_n']:
                    print('%-26s   (logs gained, its own metric: %d of %d observed; the outcome above is RELIEF)'
                          % ('', m['logs30'], m['concord_n']))
                if d in R['det'] and m['concord_n'] and m['concord'] == 0 and R['det'][d] == 0:
                    uncontrolled.append('%s %s %s concord' % (rev, eng, d))
                if m['censored'] or m['censored_epoch'] or m['warmup_excluded']:
                    print('%-26s   (censored: %d telemetry ends before +30 min, %d window crosses an epoch; %d warm-up '
                          'proposals excluded)' % ('', m['censored'], m['censored_epoch'], m['warmup_excluded']))
        print('  stcon: STATELESS-CONTESTED proposals (any duty-cap, world-cap, bot or target competition within the '
              'snapshot). xrand: downstream on those only, after the warm-up -- a DIAGNOSTIC, never a gate input; '
              'differences that come from lease HISTORY (who is held, who cools down) are excluded from it. '
              'xbase: CONCORDANCE vs the base rate of ELIGIBLE short bots.')
    if args.json:
        out = {'controls': {'snapshots': n_snaps, 'rows': n_rows, 'from': core.iso(t_lo), 'to': core.iso(t_hi),
                            'replay': args.replay_only, 'since': args.since, 'until': args.until,
                            'detector_events': {k: sum(R['det'][k] for R in revs.values()) for k in core.DUTIES}},
               'invalid_responses': invalid,
               'partitions': {rev: {'mayor_rev': R['mayor_rev'], 'cfg_tag': R['cfg_tag'], 'cfg': R['cfg'],
                                    'epochs': R['epochs'], 'carried_epochs': R['carried_epochs'],
                                    'snapshots': R['snapshots'], 'from': core.iso(R['t_lo']), 'to': core.iso(R['t_hi']),
                                    'world_days': R['wd'], 'days': R['days'], 'engines': R['res'], 'gate': R['gate'],
                                    'xrand_role': 'diagnostic (stateless-contested only); never a gate input',
                                    'controls': {'detector_events': R['det'],
                                                 'coverage': {'bots': len(R['cov']),
                                                              'bots_with_rows': sum(1 for h, n in R['cov'].values() if h),
                                                              'per_bot': {
                                                     b: (h / n if n else None) for b, (h, n) in R['cov'].items()}}},
                                    'base': {d: {'k': k, 'n': n} for d, (k, n) in R['base'].items()},
                                    'base_eligible': {d: {'k': k, 'n': n} for d, (k, n) in R['base_elig'].items()}}
                              for rev, R in revs.items()}}
        if len(revs) == 1:                        # one partition: nothing to pool, so the flat view is safe
            (only,) = out['partitions'].values()
            out.update({k: only[k] for k in ('engines', 'base', 'base_eligible', 'world_days', 'days', 'gate')})
            out['controls']['coverage'] = only['controls']['coverage']
        mayor_io.write_atomic(os.path.join(jdir, os.path.basename(args.json)), json.dumps(out, indent=1))
    if uncontrolled:
        print('\nUNCONTROLLED ZERO (this partition\'s detector saw no such outcome, so a 0 could be blindness): %s'
              % '; '.join(uncontrolled))
        if not args.allow_zero:
            return 4
    return 0

if __name__ == '__main__':
    sys.exit(main())
