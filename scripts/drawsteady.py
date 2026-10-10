#!/usr/bin/env python3
"""drawsteady.py  -- which pools may leave the draw exclusion at 6 h instead of 12 h. drawrec.sh calls it; it prints
`STEADY RELEASE [<pools>]` (and `STEADY ...` reasons). Any failure prints `STEADY RELEASE []` (12 h for every pool).

OPERATOR + CODEX 2026-10-10, under the owner's delegation (throughput). docs/reports/threepool-2026-10-10.md.
A pool's exclusion is 12 h after its last canary decision. It is SIX hours only when ALL of these hold:
  1. every ledger decision naming the pool in the last 12 h is a KEEP that was PROMOTED fleet-wide (the run's journal
     `promoted` row names the canary's sha and "fleet-wide", at or after the decision), and the newest is >= 6 h old.
     A REVERT, INCONCLUSIVE or an unpromoted KEEP keeps 12 h.
  2. THE POOL RUNS THE PROMOTED VERSION, VERIFIED: the fleet version (manifest declared_code_version) is the promoted
     sha or a later fleet deploy (declared_at at or after the decision), and EVERY live bot of the pool has
     >= MIN_ROWS rows in the last STEADY_MIN minutes, ALL on the fleet version. No row of another build in that hour
     means the restart lag has cleared (restart-lag rows are not canary: memory 10-01).
  3. THE CARRYOVER HAS CLEARED: the pool's mean bag fill (bagread's minimum-stack slots, per bot then per pool) over the
     same hour lies inside the range spanned by the CONTROL pools' means (pools no decision touched in 12 h; not
     isolated-*, placebo-c or a live canary), with >= MIN_CONTROL_POOLS control pools measured.
Fail closed everywhere: an unreadable ledger, journal, manifest or log, too few rows, too few control pools -> 12 h."""
import datetime as dt, glob, json, os, sys

LEDGER = os.environ.get('STEADY_LEDGER', '/var/log/mcai/_canary-decisions.jsonl')
JOURNAL = os.environ.get('STEADY_JOURNAL', os.path.expanduser('~/canary-journal.jsonl'))
MANIFEST = os.environ.get('STEADY_MANIFEST', '/srv/mcbots/trial-manifest.json')
LOGROOT = os.environ.get('STEADY_LOGROOT', '/var/log/mcai')
EXCL_H = 12
EARLY_H = 6
STEADY_MIN = 60
MIN_ROWS = 20                 # per live bot in the hour (a working bot writes hundreds)
MIN_CONTROL_POOLS = 4
MIN_BAG_BOTS = 3              # bots with a bag reading, per pool, for a pool mean to count
LIVE_H = 6                    # a bot is LIVE when its log dir changed in the last 6 h (a retired dir is not a bot)


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


def _t(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def pools_in(row):
    return {p.strip() for p in str(row.get('canary_pool') or '').split(',') if p.strip()}


def candidates(ledger_rows, journal_rows, now):
    """PURE. -> ({pool: (run, sha, decided_at)} eligible for 6 h on rule 1, {pool: why} held at 12 h).
    Every decision within EXCL_H naming a pool must qualify; one that does not holds the pool."""
    promoted = {}
    for r in journal_rows:
        if r.get('phase') == 'promoted' and 'fleet-wide' in str(r.get('note') or ''):
            promoted.setdefault(r.get('run'), []).append((str(r.get('note')).split()[0][:7], _t(r.get('ts'))))
    ok, held = {}, {}
    for row in ledger_rows:
        t = _t(row.get('ts'))
        if t is None:
            for p in pools_in(row):
                held[p] = 'a ledger row with an unreadable ts'
            continue
        if t > now + dt.timedelta(minutes=10):
            continue          # not yet decided at `now` (a replay); a few minutes ahead is clock skew and HOLDS (age 0)
        age_h = max(0.0, (now - t).total_seconds() / 3600)
        if age_h >= EXCL_H:
            continue
        run = str(row.get('note') or '').split(':')[0].strip()
        sha = str(row.get('canary_sha') or '')[:7]
        prom = [pt for s, pt in promoted.get(run, []) if s == sha and pt is not None and t <= pt <= now]
        if row.get('decision') != 'KEEP':
            why = '%s %s %.1f h ago (12 h)' % (run, row.get('decision'), age_h)
        elif not prom:
            why = '%s KEEP %.1f h ago but not promoted fleet-wide at %s (12 h)' % (run, age_h, sha)
        elif age_h < EARLY_H:
            why = '%s KEEP+promoted %.1f h ago (< %d h)' % (run, age_h, EARLY_H)
        else:
            why = None
        for p in pools_in(row):
            if why:
                held[p] = why
            elif p not in held:
                prev = ok.get(p)
                if prev is None or prev[2] < t:
                    ok[p] = (run, sha, t)
    return {p: v for p, v in ok.items() if p not in held}, held


def bot_stats(rows):
    """PURE. rows: [(t, version, bag_vector or None)] -> {'rows', 'versions' (7-char set), 'mean_slots' or None}."""
    slots = [b[0] for _t_, _v, b in rows if b]
    return {'rows': len(rows), 'versions': {str(v)[:7] for _t_, v, _b in rows},
            'mean_slots': (sum(slots) / len(slots)) if slots else None}


def pool_mean(stats):
    """PURE. Mean of the per-bot mean slots; None with fewer than MIN_BAG_BOTS bots measured."""
    xs = [s['mean_slots'] for s in stats.values() if s.get('mean_slots') is not None]
    return (sum(xs) / len(xs)) if len(xs) >= MIN_BAG_BOTS else None


def steady(pool, cand, stats, control_means, fleet_version, fleet_declared_at):
    """PURE. Rules 2 and 3 for one candidate pool. stats: {bot: bot_stats} for the pool's LIVE bots.
    control_means: {pool: mean or None}. -> (ok, why)."""
    run, sha, decided = cand
    fv = str(fleet_version or '')[:7]
    if not fv:
        return False, 'fleet version unreadable'
    if fv != sha and not (fleet_declared_at is not None and fleet_declared_at >= decided):
        return False, 'fleet runs %s, not the promoted %s nor a later deploy' % (fv, sha)
    if not stats:
        return False, 'no live bot found'
    for b, s in sorted(stats.items()):
        if s['rows'] < MIN_ROWS:
            return False, '%s: %d rows in %d min (< %d)' % (b, s['rows'], STEADY_MIN, MIN_ROWS)
        if s['versions'] != {fv}:
            return False, '%s: builds %s in the last %d min, not only %s (restart lag)' % (b, sorted(s['versions']), STEADY_MIN, fv)
    pm = pool_mean(stats)
    cm = [m for m in control_means.values() if m is not None]
    if pm is None:
        return False, 'bag fill measured on fewer than %d bots' % MIN_BAG_BOTS
    if len(cm) < MIN_CONTROL_POOLS:
        return False, 'only %d control pools measured (< %d)' % (len(cm), MIN_CONTROL_POOLS)
    lo, hi = min(cm), max(cm)
    if not (lo <= pm <= hi):
        return False, 'bag fill %.1f slots outside the control range %.1f..%.1f (carryover)' % (pm, lo, hi)
    return True, ('%s KEEP+promoted %s; %d bots on %s only for %d min; bag fill %.1f inside control %.1f..%.1f'
                  % (run, decided.strftime('%m-%dT%H:%MZ'), len(stats), fv, STEADY_MIN, pm, lo, hi))


def _jsonl(path):
    out = []
    with open(path) as f:
        for l in f:
            l = l.strip()
            if not l:
                continue
            try:
                out.append(json.loads(l))
            except ValueError:
                continue
    return out


def live_bots(now):
    out = {}
    for d in glob.glob(os.path.join(LOGROOT, '*')):
        b = os.path.basename(d)
        if b.startswith('_') or not os.path.isdir(d):
            continue
        fs = glob.glob(os.path.join(d, 'skill-*.jsonl*'))
        if fs and max(os.path.getmtime(f) for f in fs) >= (now - dt.timedelta(hours=LIVE_H)).timestamp():
            out.setdefault(pool_of(b), []).append(b)
    return out


def main():
    now = dt.datetime.now(dt.timezone.utc)
    if os.environ.get('STEADY_NOW'):         # REPLAY ONLY (scripts/host/drawsteady_replay.sh); printed, never silent
        now = _t(os.environ['STEADY_NOW']); print('STEADY REPLAY at %s (STEADY_NOW): not a live answer' % now.isoformat())
    try:
        ledger, journal, man = _jsonl(LEDGER), _jsonl(JOURNAL), json.load(open(MANIFEST))
    except Exception as e:
        print('STEADY inputs unreadable (%s): 12 h for every pool' % type(e).__name__); print('STEADY RELEASE []'); return 0
    cand, held = candidates(ledger, journal, now)
    for p, why in sorted(held.items()):
        print('STEADY 12h %s: %s' % (p, why))
    if not cand:
        print('STEADY no KEEP+promoted pool between %d and %d h' % (EARLY_H, EXCL_H)); print('STEADY RELEASE []'); return 0
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import bagread
        live = live_bots(now)
        touched = set(held) | set(cand) | pools_in(man)
        since = now - dt.timedelta(minutes=STEADY_MIN)

        def stats_of(pool):
            st = {}
            for b in live.get(pool, []):
                rows, bad, corrupt, _d = bagread.bot_rows(b, since, now, root=LOGROOT)
                if bad:
                    raise OSError('%s: %d unreadable log file(s)' % (b, bad))
                st[b] = bot_stats(rows)
            return st
        ctl = {p: pool_mean(stats_of(p)) for p in live if p not in touched and p != 'placebo-c' and not p.startswith('isolated')}
        print('STEADY control pools (bag fill, slots): %s' % ', '.join('%s %s' % (p, 'n/a' if m is None else '%.1f' % m) for p, m in sorted(ctl.items())))
        rel = []
        for p, c in sorted(cand.items()):
            ok, why = steady(p, c, stats_of(p), ctl, man.get('declared_code_version'), _t(man.get('declared_at')))
            print('STEADY %s %s: %s' % ('6h' if ok else '12h', p, why))
            if ok:
                rel.append(p)
    except Exception as e:
        print('STEADY measurement failed (%s: %s): 12 h for every pool' % (type(e).__name__, str(e)[:160])); print('STEADY RELEASE []'); return 0
    print('STEADY RELEASE %r' % rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
