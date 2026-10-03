#!/usr/bin/env python3
"""Score mayor proposals against what the bots did next. Offline. It measures PREDICTION, not effect.

    python3 mayor_score.py --snaps '/var/lib/mcai-mayor/snap-*.jsonl' \\
        --assign '/var/lib/mcai-mayor/assign-*.jsonl' --assign 'replay/assign-claude-*.jsonl' \\
        --logs '/var/log/mcai/*/skill-*.jsonl*' [--json out.json]

Any engine's assignment file works (deterministic, claude, gpt): an assignment is a candidate_id
in a snapshot the scorer also reads. Two baselines are generated here from the same snapshots:
`random` (a random eligible bot) and `nearest` (the nearest eligible bot), under the same caps.

Per proposal (held leases are not re-scored; a frontier proposal is scored every time):
  exec_now     the candidate re-checked with mayor_core.evaluate on that snapshot
  exec_next    ... and on the next snapshot of that world (still executable ~5 min later?)
  persist30/60 the shortage still there 30 / 60 min later (a self-clearing shortage is a false alarm)
  concord      the bot did the duty's OUTCOME anyway within 30 min (= the mayor was redundant)
  unforced     exec_now, need persisted 30 min, and not done: the only place a mayor can add value.
               Reported as bot-hours (intervals unioned per bot+duty) per world-day and per day.
  downstream   outcome within 30 min AND (for a resource target) the bot came within 16 blocks of it,
               against the BASE RATE: the same outcome over every fresh bot the shortage applied to.

Outcomes are read from inventory STATE in the telemetry (intent rows are not outcomes):
  FREE_BAG slots_est < 34 or down >= 2; GET_WOOD logs gained >= 1; GET_IRON iron gained >= 1;
  RESTORE_PICK best pickaxe back above 10%.

POSITIVE CONTROLS PRINT FIRST. Before any rate, the scorer prints what the instrument can see: rows,
bots, span, and how many outcome EVENTS of each duty the detector finds anywhere in the telemetry.
A zero next to a zero control is printed as UNCONTROLLED and the exit code is 4 (CLAUDE.md: every
negative claim carries a positive control).
"""
import argparse
import glob
import gzip
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402

MIN = 60000


def read_jsonl(paths):
    for p in paths:
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', errors='replace') as f:
            for line in f:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue


def load_snapshots(pattern):
    snaps = {}
    for s in read_jsonl(sorted(glob.glob(pattern))):
        if s.get('schema') == core.SCHEMA and 'snap_id' in s:
            snaps[s['snap_id']] = s
    by_world = {}
    for s in snaps.values():
        by_world.setdefault(s['world'], []).append(s)
    for v in by_world.values():
        v.sort(key=lambda s: s['t_ms'])
    return snaps, by_world


def engine_label(rec):
    lab = rec.get('engine', '?')
    if rec.get('dry_run'):
        lab += '-dry'
    if rec.get('mode'):
        lab += ':' + rec['mode']
    return lab


def load_telemetry(pattern, bots, t_from, t_to, cfg):
    """{bot: [(t_end_ms, features)]} for rows with a bot snapshot, inside [t_from, t_to]. Full file
    reads (rotated .gz included): the window is set by the snapshots, never by seeking."""
    out, n_rows, seen_bots = {}, 0, set()
    for p in sorted(glob.glob(pattern)):
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', errors='replace') as f:
            for line in f:
                if '"pos"' not in line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                b = r.get('bot') or {}
                name = b.get('name')
                if name not in bots or 'pos' not in b:
                    continue
                t = core.parse_ts(r.get('@timestamp'))
                if t is None or t < t_from or t > t_to:
                    continue
                try:
                    t += int((r.get('skill') or {}).get('duration_ms') or 0)
                except (TypeError, ValueError):
                    pass
                f2 = core.bot_features(b, cfg)
                f2['pos'] = b.get('pos')
                out.setdefault(name, []).append((t, f2))
                n_rows += 1
                seen_bots.add(name)
    for v in out.values():
        v.sort(key=lambda x: x[0])
    return out, n_rows


def outcome(duty, base, seq, cfg):
    """Did the duty's outcome happen in `seq` (features after the snapshot), from `base` (the
    snapshot's bot view)? Gains are summed over positive steps, so crafting logs away does not hide
    a gather."""
    if not seq:
        return False
    if duty == 'FREE_BAG':
        return any(f['slots_est'] < cfg['full_slots'] or f['slots_est'] <= base['slots_est'] - 2 for _, f in seq)
    if duty == 'RESTORE_PICK':
        return any(f['pick_state'] == 'ok' for _, f in seq)
    key = 'logs' if duty == 'GET_WOOD' else 'iron_units'
    prev, gained = base[key], 0
    for _, f in seq:
        if f[key] > prev:
            gained += f[key] - prev
        prev = f[key]
    return gained >= 1


def detector_events(tel, cfg):
    """POSITIVE CONTROL: outcome events of each kind anywhere in the loaded telemetry."""
    n = dict.fromkeys(core.DUTIES, 0)
    for seq in tel.values():
        for (_, a), (_, b) in zip(seq, seq[1:]):
            n['FREE_BAG'] += a['slots_est'] >= cfg['full_slots'] > b['slots_est']
            n['RESTORE_PICK'] += a['pick_state'] in ('none', 'low') and b['pick_state'] == 'ok'
            n['GET_WOOD'] += b['logs'] > a['logs']
            n['GET_IRON'] += b['iron_units'] > a['iron_units']
    return n


def window(tel, name, t0, t1):
    return [x for x in tel.get(name, ()) if t0 < x[0] <= t1]


def snap_at(world_snaps, t, tol_ms):
    best = min(world_snaps, key=lambda s: abs(s['t_ms'] - t), default=None)
    return best if best is not None and abs(best['t_ms'] - t) <= tol_ms else None


def need_holds(duty, bot_name, snap):
    names = {b['id']: b['name'] for b in snap['bots']}
    for s in snap['shortages']:
        if s['duty'] == duty and (s['scope'] == 'world' or names.get(s['bot']) == bot_name):
            return True
    return False


def union_hours(intervals):
    total, cur = 0, None
    for a, b in sorted(intervals):
        if cur is None or a > cur[1]:
            if cur:
                total += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        total += cur[1] - cur[0]
    return total / 3.6e6


def score(snaps, by_world, records, tel, tel_end, cfg, interval_ms=300000):
    """records: {engine_label: [(snap_id, assignment)]} -> per engine per duty metrics."""
    tol = interval_ms * 1.5
    res = {}
    for eng, items in records.items():
        per = {}
        gaps = {}
        for sid, a in items:
            snap = snaps.get(sid)
            if snap is None:
                per.setdefault(a.get('duty', '?'), {}).setdefault('no_snapshot', 0)
                per[a.get('duty', '?')]['no_snapshot'] += 1
                continue
            cand = {c['id']: c for c in snap['candidates']}.get(a['candidate_id'])
            if cand is None:
                continue
            duty, t = cand['duty'], snap['t_ms']
            bot = {b['id']: b for b in snap['bots']}[cand['bot']]
            m = per.setdefault(duty, {k: 0 for k in ('n', 'exec_now', 'exec_next', 'exec_next_n', 'persist30', 'persist30_n',
                                                    'persist60', 'persist60_n', 'concord', 'concord_n', 'unforced',
                                                    'downstream', 'downstream_n', 'censored')})
            m['n'] += 1
            ok_now = core.evaluate(duty, bot, snap, cfg)[0]
            m['exec_now'] += ok_now
            ws = by_world[snap['world']]
            nxt = next((s for s in ws if interval_ms * 0.5 <= s['t_ms'] - t <= tol), None)
            if nxt is not None:
                nb = next((b for b in nxt['bots'] if b['name'] == bot['name']), None)
                m['exec_next_n'] += 1
                m['exec_next'] += bool(nb) and core.evaluate(duty, nb, nxt, cfg)[0]
            p30, p60 = (snap_at(ws, t + k * MIN, tol) for k in (30, 60))
            h30 = None if p30 is None else need_holds(duty, bot['name'], p30)
            h60 = None if p60 is None else need_holds(duty, bot['name'], p60)
            if h30 is not None:
                m['persist30_n'] += 1
                m['persist30'] += h30
            if h60 is not None:
                m['persist60_n'] += 1
                m['persist60'] += h60
            if t + 30 * MIN > tel_end:
                m['censored'] += 1
                continue
            seq30 = window(tel, bot['name'], t, t + 30 * MIN)
            done30 = outcome(duty, bot, seq30, cfg)
            m['concord_n'] += 1
            m['concord'] += done30
            tgt = next((r for r in snap['resources'] if r['id'] == a.get('target')), None)
            near = tgt is None or any(f['pos'] and core.dist3(f['pos'], tgt) <= cfg['near_target'] for _, f in seq30)
            m['downstream_n'] += 1
            m['downstream'] += done30 and near
            if ok_now and h30 and not done30:
                m['unforced'] += 1
                end = t + 30 * MIN
                if h60 and t + 60 * MIN <= tel_end and not outcome(duty, bot, window(tel, bot['name'], t, t + 60 * MIN), cfg):
                    end = t + 60 * MIN
                gaps.setdefault((snap['world'], bot['name'], duty), []).append((t, end))
        for (w, b, duty), iv in gaps.items():
            per[duty]['unforced_h'] = per[duty].get('unforced_h', 0) + union_hours(iv)
        res[eng] = per
    return res


def base_rates(snaps, tel, tel_end, cfg):
    """Fleet base rate: the duty's outcome within 30 min over EVERY fresh bot the shortage applied to."""
    out = {d: [0, 0] for d in core.DUTIES}
    for s in snaps.values():
        if s['t_ms'] + 30 * MIN > tel_end:
            continue
        for b in s['bots']:
            if not b['fresh']:
                continue
            for d in core.DUTIES:
                if need_holds(d, b['name'], s):
                    out[d][1] += 1
                    out[d][0] += outcome(d, b, window(tel, b['name'], s['t_ms'], s['t_ms'] + 30 * MIN), cfg)
    return {d: (k / n if n else None, k, n) for d, (k, n) in out.items()}


def baselines(snaps):
    rnd, near = [], []
    for sid in sorted(snaps):
        s = snaps[sid]
        cs = list(s['candidates'])
        rng = random.Random(core.stable_hash(sid, 'random'))
        rng.shuffle(cs)
        rnd += [(sid, a) for a in core.greedy(s, cs)]
        near += [(sid, a) for a in core.greedy(s, sorted(s['candidates'], key=lambda c: (core.DUTY_RANK[c['duty']],
                                                                                         c['dist'] or 0, c['bot_name'])))]
    return {'random': rnd, 'nearest': near}


def world_days(by_world, interval_ms):
    return sum((ws[-1]['t_ms'] - ws[0]['t_ms'] + interval_ms) for ws in by_world.values() if ws) / 8.64e7


def pct(k, n):
    return '   -  ' if not n else '%5.1f%%' % (100.0 * k / n)


def main(argv=None):
    ap = argparse.ArgumentParser(description='score mayor proposals (prediction, not effect)')
    ap.add_argument('--snaps', default='/var/lib/mcai-mayor/snap-*.jsonl')
    ap.add_argument('--assign', action='append', help='glob; repeatable (deterministic, claude, gpt files)')
    ap.add_argument('--logs', default='/var/log/mcai/*/skill-*.jsonl*')
    ap.add_argument('--interval', type=int, default=300)
    ap.add_argument('--json', help='write the full result here')
    ap.add_argument('--allow-zero', action='store_true', help='do not exit 4 on an uncontrolled zero')
    args = ap.parse_args(argv)
    cfg = dict(core.DEFAULTS)
    interval_ms = args.interval * 1000
    snaps, by_world = load_snapshots(args.snaps)
    if not snaps:
        print('NO SNAPSHOTS matched %s -- nothing to score (this is not a zero)' % args.snaps)
        return 2
    records = {}
    for pat in args.assign or ['/var/lib/mcai-mayor/assign-*.jsonl']:
        for rec in read_jsonl(sorted(glob.glob(pat))):
            if rec.get('reask_of'):
                continue
            lab = engine_label(rec)
            for a in rec.get('assignments') or []:
                if a.get('lease') != 'held':
                    records.setdefault(lab, []).append((rec['snap_id'], a))
    records.update(baselines(snaps))
    bots = {b['name'] for s in snaps.values() for b in s['bots']}
    t0 = min(s['t_ms'] for s in snaps.values())
    t1 = max(s['t_ms'] for s in snaps.values())
    tel, n_rows = load_telemetry(args.logs, bots, t0 - 10 * MIN, t1 + 65 * MIN, cfg)
    tel_end = max((seq[-1][0] for seq in tel.values() if seq), default=0)

    # ---- POSITIVE CONTROLS FIRST
    det = detector_events(tel, cfg)
    print('CONTROLS  snapshots %d in %d worlds, %s .. %s' % (len(snaps), len(by_world), core.iso(t0), core.iso(t1)))
    print('          telemetry rows with a bot state: %d, bots %d of %d in snapshots, data ends %s'
          % (n_rows, len(tel), len(bots), core.iso(tel_end) if tel_end else 'NEVER'))
    print('          outcome events the detector sees anywhere: %s' % ', '.join('%s %d' % kv for kv in det.items()))
    print('          proposals loaded: %s' % ', '.join('%s %d' % (k, len(v)) for k, v in sorted(records.items())))
    if not n_rows:
        print('UNCONTROLLED: no telemetry rows in the window -- every outcome below would be a blind zero')
        return 4
    res = score(snaps, by_world, records, tel, tel_end, cfg, interval_ms)
    base = base_rates(snaps, tel, tel_end, cfg)
    wd = world_days(by_world, interval_ms)
    days = (t1 - t0 + interval_ms) / 8.64e7
    uncontrolled = []
    print('\nBASE RATE (outcome within 30 min, every fresh bot the shortage applied to):')
    for d in core.DUTIES:
        r, k, n = base[d]
        print('  %-12s %s  (%d of %d)' % (d, pct(k, n), k, n))
    print('\n%-22s %-12s %5s %7s %7s %7s %7s %7s %7s %9s %9s %6s' % (
        'engine', 'duty', 'n', 'exec', 'exec+5', 'pers30', 'pers60', 'concord', 'downstr', 'gap h/wd', 'gap h/day', 'x base'))
    for eng in sorted(res):
        for d in core.DUTIES:
            m = res[eng].get(d)
            if not m:
                continue
            br = base[d][0]
            ds = m['downstream'] / m['downstream_n'] if m['downstream_n'] else None
            ratio = '%6.2f' % (ds / br) if ds is not None and br else '   -  '
            gh = m.get('unforced_h', 0.0)
            print('%-22s %-12s %5d %7s %7s %7s %7s %7s %7s %9.2f %9.2f %s' % (
                eng, d, m['n'], pct(m['exec_now'], m['n']), pct(m['exec_next'], m['exec_next_n']),
                pct(m['persist30'], m['persist30_n']), pct(m['persist60'], m['persist60_n']),
                pct(m['concord'], m['concord_n']), pct(m['downstream'], m['downstream_n']),
                gh / wd if wd else 0, gh / days if days else 0, ratio))
            for metric in ('concord', 'downstream'):
                if m[metric + '_n'] and m[metric] == 0 and det[d] == 0:
                    uncontrolled.append('%s %s %s' % (eng, d, metric))
            if m['censored']:
                print('%-22s   (%d censored: telemetry ends before +30 min)' % ('', m['censored']))
    if args.json:
        with open(args.json, 'w') as f:
            json.dump({'controls': {'snapshots': len(snaps), 'worlds': len(by_world), 'rows': n_rows,
                                    'detector_events': det, 'from': core.iso(t0), 'to': core.iso(t1)},
                       'base': base, 'world_days': wd, 'days': days, 'engines': res}, f, indent=1)
    if uncontrolled:
        print('\nUNCONTROLLED ZERO (the detector saw no %s outcome anywhere, so a 0 here could be blindness): %s'
              % ('/'.join(sorted({u.split()[1] for u in uncontrolled})), '; '.join(uncontrolled)))
        if not args.allow_zero:
            return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
