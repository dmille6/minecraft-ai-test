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
  x random    downstream rate / the random-eligible baseline's downstream rate for the same duty.

Outcomes are read from inventory STATE (intent rows are not outcomes): FREE_BAG slots_est < 34 or
down >= 2; GET_WOOD logs gained >= 1; GET_IRON iron gained >= 1; RESTORE_PICK pickaxe back above 10%.

POSITIVE CONTROLS PRINT FIRST, global AND per bot: rows, span, per-bot coverage of the snapshot
times, and outcome EVENTS of each duty the detector finds. A zero next to a zero control prints as
UNCONTROLLED and exits 4. REPLAY snapshots (`replay: true`) are refused unless --replay-only, which
scores them on their own and never mixed with live ones.

MEMORY. One world at a time: that world's snapshots (inventories dropped) and its bots' state rows as
small tuples. The assignment records are the only fleet-wide structure, and they are small.
"""
import argparse
import bisect
import glob
import gzip
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402
import mayor_io  # noqa: E402

MIN = 60000
# a compact state row: (t_end_ms, slots_est, logs, iron_units, pick_ok, x, y, z)
T, SLOTS, LOGS, IRON, PICK_OK, X, Y, Z = range(8)
METRICS = ('n', 'rejected', 'exec_now', 'exec', 'exec_n', 'persist30', 'persist30_n', 'persist60', 'persist60_n',
           'concord', 'concord_n', 'unobserved', 'unforced', 'unforced_unknown_bank', 'not_eligible_through',
           'downstream', 'downstream_n', 'censored')
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
    return (t, f['slots_est'], f['logs'], f['iron_units'], f['pick_state'] == 'ok', p.get('x'), p.get('y'), p.get('z'))


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
    k, bk = (LOGS, 'logs') if duty == 'GET_WOOD' else (IRON, 'iron_units')
    prev, gained = base[bk], 0
    for r in seq:
        if r[k] > prev:
            gained += r[k] - prev
        prev = r[k]
    return gained >= 1


def detector_events(tel, cfg):
    """POSITIVE CONTROL: outcome events of each kind anywhere in the loaded telemetry."""
    n = dict.fromkeys(core.DUTIES, 0)
    for seq in tel.values():
        for a, b in zip(seq, seq[1:]):
            n['FREE_BAG'] += a[SLOTS] >= cfg['full_slots'] > b[SLOTS]
            n['RESTORE_PICK'] += (not a[PICK_OK]) and b[PICK_OK]
            n['GET_WOOD'] += b[LOGS] > a[LOGS]
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
    ts = [r[T] for r in seq]
    hit = 0
    for t in times:
        i = bisect.bisect_left(ts, t - gap)
        hit += i < len(ts) and ts[i] <= t + gap
    return hit / len(times)


def need_holds(duty, bot_name, snap):
    """Does the shortage still hold at `snap`? None = UNKNOWN: for a per-bot duty when that bot is not
    fresh there; for a world duty when no bot is (shortages are computed from fresh bots only)."""
    if duty in ('FREE_BAG', 'RESTORE_PICK'):
        b = next((b for b in snap['bots'] if b['name'] == bot_name), None)
        if b is None or not b['fresh']:
            return None
    elif not any(b['fresh'] for b in snap['bots']):
        return None
    names = {b['id']: b['name'] for b in snap['bots']}
    return any(s['duty'] == duty and (s['scope'] == 'world' or names.get(s['bot']) == bot_name) for s in snap['shortages'])


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


def baselines(snaps):
    rnd, near = [], []
    for s in snaps:
        cs = list(s['candidates'])
        random.Random(core.stable_hash(s['snap_id'], 'random')).shuffle(cs)
        rnd += [(s['snap_id'], a) for a in core.greedy(s, cs)]
        near += [(s['snap_id'], a) for a in core.greedy(s, sorted(s['candidates'], key=lambda c: (
            core.DUTY_RANK[c['duty']], c['dist'] if c['dist'] is not None else 0, c['bot_name'])))]
    return {'random': rnd, 'nearest': near}


def score_world(ws, records, rejected, tel, tel_end, cfg, interval_ms, res, gaps):
    """Add one world's proposals into `res` {engine: {duty: metrics}} and `gaps`."""
    tol = interval_ms * 1.5
    gap = cfg['stale_s'] * 1000
    by_id = {s['snap_id']: s for s in ws}
    for eng, items in rejected.items():
        for sid, cid in items:
            s = by_id.get(sid)
            c = next((c for c in s['candidates'] if c['id'] == cid), None) if s and isinstance(cid, str) else None
            m = res.setdefault(eng, {}).setdefault(c['duty'] if c else '?', dict.fromkeys(METRICS, 0))
            m['rejected'] += 1
            m['exec_n'] += 1
    for eng, items in records.items():
        for sid, a in items:
            s = by_id.get(sid)
            c = next((c for c in s['candidates'] if c['id'] == a.get('candidate_id')), None) if s else None
            if c is None:
                continue
            duty, t = c['duty'], s['t_ms']
            bot = next(b for b in s['bots'] if b['id'] == c['bot'])
            m = res.setdefault(eng, {}).setdefault(duty, dict.fromkeys(METRICS, 0))
            m['n'] += 1
            ok_now = core.evaluate(duty, bot, s, cfg)[0]
            m['exec_now'] += ok_now
            nxt = next((x for x in ws if interval_ms * 0.5 <= x['t_ms'] - t <= tol), None)
            nb = None if nxt is None else next((b for b in nxt['bots'] if b['name'] == bot['name']), None)
            if nb is not None and nb['fresh']:   # missing or stale at +5 is UNKNOWN, not inexecutable
                m['exec_n'] += 1
                m['exec'] += core.evaluate(duty, nb, nxt, cfg)[0]
            p30, p60 = snap_at(ws, t + 30 * MIN, tol), snap_at(ws, t + 60 * MIN, tol)
            h30 = None if p30 is None else need_holds(duty, bot['name'], p30)
            h60 = None if p60 is None else need_holds(duty, bot['name'], p60)
            h30 = None if h30 is None else bool(h30)
            if h30 is not None:
                m['persist30_n'] += 1
                m['persist30'] += h30
            if h60 is not None:
                m['persist60_n'] += 1
                m['persist60'] += h60
            if t + 30 * MIN > tel_end:
                m['censored'] += 1
                continue
            seq = tel.get(bot['name'], [])
            seq30 = window(seq, t, t + 30 * MIN)
            done30 = outcome(duty, bot, seq30, cfg)
            if not observed(seq, t, t + 30 * MIN, gap):
                m['unobserved'] += 1             # silence: out of EVERY outcome denominator, done or not
                continue
            m['concord_n'] += 1
            m['concord'] += done30
            tgt = next((r for r in s['resources'] if r['id'] == a.get('target')), None)
            near = tgt is None or any(r[X] is not None and core.dist3({'x': r[X], 'y': r[Y], 'z': r[Z]}, tgt) <= cfg['near_target']
                                      for r in seq30)
            m['downstream_n'] += 1
            m['downstream'] += done30 and near
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
            if (h60 and t + 60 * MIN <= tel_end and observed(seq, t, t + 60 * MIN, gap)
                    and eligible_through(ws, bot['name'], duty, t, t + 60 * MIN, cfg)
                    and not outcome(duty, bot, window(seq, t, t + 60 * MIN), cfg)):
                end = t + 60 * MIN
            gaps.setdefault((eng, duty), []).append(((s['world'], bot['name']), t, end))


def base_rates(ws, tel, tel_end, cfg, acc):
    for s in ws:
        if s['t_ms'] + 30 * MIN > tel_end:
            continue
        for b in s['bots']:
            if not b['fresh']:
                continue
            for d in core.DUTIES:
                seq = tel.get(b['name'], [])
                if need_holds(d, b['name'], s) and observed(seq, s['t_ms'], s['t_ms'] + 30 * MIN, cfg['stale_s'] * 1000):
                    acc[d][1] += 1
                    acc[d][0] += outcome(d, b, window(seq, s['t_ms'], s['t_ms'] + 30 * MIN), cfg)


def pct(k, n):
    return '   -  ' if not n else '%5.1f%%' % (100.0 * k / n)


def strip(s):
    for b in s['bots']:
        for k in DROP_BOT:
            b.pop(k, None)
    s.pop('cfg', None)
    s.pop('estimates', None)
    return s


def main(argv=None):
    ap = argparse.ArgumentParser(description='score mayor proposals (prediction, not effect)')
    ap.add_argument('--snaps', default='/var/lib/mcai-mayor/snap-*.jsonl')
    ap.add_argument('--assign', action='append', help='glob; repeatable (deterministic, claude, gpt files)')
    ap.add_argument('--logs', default='/var/log/mcai/*/skill-*.jsonl*')
    ap.add_argument('--interval', type=int, default=300)
    ap.add_argument('--json', help='write the full result here')
    ap.add_argument('--allow-out-root', action='append', help='allowlisted root for --json (default /var/lib/mcai-mayor)')
    ap.add_argument('--replay-only', action='store_true', help='score ONLY replay snapshots (never mixed with live)')
    ap.add_argument('--allow-zero', action='store_true', help='do not exit 4 on an uncontrolled zero')
    args = ap.parse_args(argv)
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
    files_by_world, bots_by_world, n_replay, n_live = {}, {}, 0, 0
    for p in sorted(glob.glob(args.snaps)):
        for s in read_jsonl([p]):
            files_by_world.setdefault(s.get('world'), set()).add(p)
            bots_by_world.setdefault(s.get('world'), set()).update(b.get('name') for b in s.get('bots') or [])
            if s.get('replay'):
                n_replay += 1
            else:
                n_live += 1
    if args.replay_only and not n_replay or not args.replay_only and not n_live:
        print('NO %s SNAPSHOTS matched %s (%d live, %d replay) -- nothing to score (this is not a zero).%s' % (
            'REPLAY' if args.replay_only else 'LIVE', args.snaps, n_live, n_replay,
            '' if args.replay_only else ' Replay snapshots are scored only with --replay-only, never mixed with live.'))
        return 2
    records, rejected, invalid = {}, {}, {}
    for pat in args.assign or ['/var/lib/mcai-mayor/assign-*.jsonl']:
        for rec in read_jsonl(sorted(glob.glob(pat))):
            if rec.get('reask_of'):
                continue                          # re-asks measure self-consistency, not the engine
            if rec.get('engine') == 'deterministic' and bool(rec.get('replay')) != args.replay_only:
                continue
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
    res, gaps = {}, {}
    det = dict.fromkeys(core.DUTIES, 0)
    base = {d: [0, 0] for d in core.DUTIES}
    cov, n_rows, n_snaps, wd, t_lo, t_hi = {}, 0, 0, 0.0, None, None
    for world in sorted(w for w in files_by_world if w):
        ws = [strip(s) for s in read_jsonl(sorted(files_by_world[world]))
              if s.get('world') == world and bool(s.get('replay')) == args.replay_only]
        if not ws:
            continue
        ws.sort(key=lambda s: s['t_ms'])
        n_snaps += len(ws)
        t0, t1 = ws[0]['t_ms'], ws[-1]['t_ms']
        t_lo, t_hi = min(t_lo or t0, t0), max(t_hi or t1, t1)
        wd += (t1 - t0 + interval_ms) / 8.64e7
        bots = {b['name'] for s in ws for b in s['bots']}
        others = set().union(*(v for k, v in bots_by_world.items() if k != world)) - bots
        tel, n = load_telemetry(paths, bots, t0 - 10 * MIN, t1 + 65 * MIN, cfg, others)
        n_rows += n
        tel_end = max((seq[-1][T] for seq in tel.values() if seq), default=0)
        times = [s['t_ms'] for s in ws]
        for b in bots:
            cov[b] = coverage(tel.get(b, []), times, gapms)
        for d, k in detector_events(tel, cfg).items():
            det[d] += k
        recs = dict(records.get(world, {}))
        recs.update(baselines(ws))
        score_world(ws, recs, rejected.get(world, {}), tel, tel_end, cfg, interval_ms, res, gaps)
        base_rates(ws, tel, tel_end, cfg, base)
        del ws, tel
    days = ((t_hi - t_lo + interval_ms) / 8.64e7) if t_lo is not None else 0
    for (eng, duty), items in gaps.items():
        per = {}
        for key, a, b in items:
            per.setdefault(key, []).append((a, b))
        res[eng][duty]['unforced_h'] = sum(union_ms(v) for v in per.values()) / 3.6e6
    for eng in res:
        for d, m in res[eng].items():
            rnd = res.get('random', {}).get(d)
            rr = rnd['downstream'] / rnd['downstream_n'] if rnd and rnd['downstream_n'] else None
            ds = m['downstream'] / m['downstream_n'] if m['downstream_n'] else None
            m['x_random'] = (ds / rr) if ds is not None and rr else None

    # ---- POSITIVE CONTROLS FIRST: global, then per bot
    with_rows = sum(1 for v in cov.values() if v)
    vals = sorted(v for v in cov.values() if v is not None)
    print('CONTROLS  %s snapshots %d, %s .. %s' % ('REPLAY' if args.replay_only else 'live', n_snaps,
                                                    core.iso(t_lo), core.iso(t_hi)))
    print('          telemetry state rows: %d; outcome events the detector sees: %s' % (
        n_rows, ', '.join('%s %d' % kv for kv in det.items())))
    print('          per-bot coverage of snapshot times (a state row within %ds): %d of %d bots have rows; '
          'median %.2f, min %.2f' % (cfg['stale_s'], with_rows, len(cov), vals[len(vals) // 2] if vals else 0, vals[0] if vals else 0))
    low = sorted((v, b) for b, v in cov.items() if v is not None and v < 0.5)
    if low:
        print('          bots under 50%% coverage (their silences are unobserved, not failures): %s' % ', '.join(
            '%s %.2f' % (b, v) for v, b in low[:12]))
    print('          proposals: %s; invalid responses: %s' % (
        ', '.join('%s %d' % (e, sum(m['n'] for m in res[e].values())) for e in sorted(res)) or 'none',
        ', '.join('%s %d' % kv for kv in sorted(invalid.items())) or 'none'))
    if not n_rows:
        print('UNCONTROLLED: no telemetry rows in the window -- every outcome below would be a blind zero')
        return 4
    print('\nBASE RATE (outcome within 30 min, every fresh bot the shortage applied to; for context):')
    for d in core.DUTIES:
        print('  %-12s %s  (%d of %d)' % (d, pct(*base[d]), base[d][0], base[d][1]))
    print('\n%-20s %-12s %4s %4s %7s %7s %7s %7s %5s %7s %6s %8s %8s %4s' % (
        'engine', 'duty', 'n', 'rej', 'exec+5', 'pers30', 'pers60', 'concord', 'unobs', 'downstr', 'xrand',
        'gap h/wd', 'gap h/d', 'unkb'))
    uncontrolled = []
    for eng in sorted(res):
        for d in list(core.DUTIES) + ['?']:
            m = res[eng].get(d)
            if not m:
                continue
            gh = m.get('unforced_h', 0.0)
            print('%-20s %-12s %4d %4d %7s %7s %7s %7s %5d %7s %6s %8.2f %8.2f %4d' % (
                eng, d, m['n'], m['rejected'], pct(m['exec'], m['exec_n']), pct(m['persist30'], m['persist30_n']),
                pct(m['persist60'], m['persist60_n']), pct(m['concord'], m['concord_n']), m['unobserved'],
                pct(m['downstream'], m['downstream_n']), '%6.2f' % m['x_random'] if m['x_random'] is not None else '   -  ',
                gh / wd if wd else 0, gh / days if days else 0, m['unforced_unknown_bank']))
            if d in det and m['concord_n'] and m['concord'] == 0 and det[d] == 0:
                uncontrolled.append('%s %s concord' % (eng, d))
            if m['censored']:
                print('%-20s   (%d censored: telemetry ends before +30 min)' % ('', m['censored']))
    if args.json:
        mayor_io.write_atomic(os.path.join(jdir, os.path.basename(args.json)), json.dumps({'controls': {'snapshots': n_snaps, 'rows': n_rows, 'detector_events': det,
                                    'from': core.iso(t_lo), 'to': core.iso(t_hi), 'replay': args.replay_only,
                                    'coverage': {'bots': len(cov), 'bots_with_rows': with_rows, 'per_bot': cov}},
                       'base': {d: {'k': k, 'n': n} for d, (k, n) in base.items()}, 'world_days': wd, 'days': days,
                       'invalid_responses': invalid, 'engines': res}, indent=1))
    if uncontrolled:
        print('\nUNCONTROLLED ZERO (the detector saw no such outcome anywhere, so a 0 could be blindness): %s'
              % '; '.join(uncontrolled))
        if not args.allow_zero:
            return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
