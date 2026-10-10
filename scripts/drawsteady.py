#!/usr/bin/env python3
"""drawsteady.py  -- which pools may leave the draw exclusion at 6 h instead of 12 h. drawrec.sh calls it; it prints
`STEADY RELEASE [<pools>]` (and `STEADY ...` reasons). Any failure prints `STEADY RELEASE []` (12 h for every pool).

OPERATOR + CODEX 2026-10-10, under the owner's delegation (throughput). docs/reports/threepool-2026-10-10.md.
A pool's exclusion is 12 h after its last canary decision. It is SIX hours only when ALL of these hold:
  1. every ledger decision naming the pool in the last 12 h is a KEEP that was PROMOTED fleet-wide (the run's journal
     `promoted` row names the canary's sha and "fleet-wide", at or after the decision), and the newest is >= 6 h old.
     A REVERT, INCONCLUSIVE or an unpromoted KEEP keeps 12 h. ANY malformed ledger line, unreadable ts or row naming no
     pool releases NOTHING (a row we cannot read could be the REVERT that holds a pool; round 3, Codex).
  2. THE POOL RUNS THE PROMOTED VERSION, VERIFIED, ON ITS WHOLE MEMBERSHIP. Membership is the systemd unit list
     (mcbot@<bot>.service, --all), never log activity: a down bot must hold its pool, not vanish from it (round 3,
     Codex). Every unit of the pool must be active/running; every bot must have >= MIN_ROWS rows in the last
     STEADY_MIN minutes, no unreadable file and no corrupt row, ALL on the fleet version, which is the promoted sha or
     a later fleet deploy (declared_at at or after the decision). No row of another build in that hour = restart lag
     cleared (restart-lag rows are not canary: memory 10-01).
  3. THE CARRYOVER HAS CLEARED AND IS NOT STILL MOVING: every bot carries a bag reading in BOTH halves of the hour, and
     the pool's bag fill (bagread's minimum-stack slots, per bot then per pool) lies inside the CONTROL pools' min..max
     for the whole hour AND for each half, AND its change from the first half to the second lies inside the controls'
     min..max of the same change. A pool drifting down through the band (36 -> 28 averaging 32) fails the last test
     (round 3, Codex). Controls are pools no decision touched in 12 h (not isolated-*, placebo-c or a live canary) that
     pass EXACTLY the same membership, version, row and corruption checks as the candidate; >= MIN_CONTROL_POOLS needed.
Fail closed everywhere: an unreadable ledger, manifest, unit list or log, too few rows or controls -> 12 h."""
import datetime as dt, json, os, subprocess, sys

LEDGER = os.environ.get('STEADY_LEDGER', '/var/log/mcai/_canary-decisions.jsonl')
JOURNAL = os.environ.get('STEADY_JOURNAL', os.path.expanduser('~/canary-journal.jsonl'))
MANIFEST = os.environ.get('STEADY_MANIFEST', '/srv/mcbots/trial-manifest.json')
LOGROOT = os.environ.get('STEADY_LOGROOT', '/var/log/mcai')
UNITS_FILE = os.environ.get('STEADY_UNITS_FILE', '')   # fixture: `systemctl list-units --plain --no-legend` lines
EXCL_H = 12
EARLY_H = 6
STEADY_MIN = 60
MIN_ROWS = 20                 # per bot in the hour (a working bot writes hundreds)
MIN_CONTROL_POOLS = 4


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


def _t(s):
    try:
        t = dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
        return t if t.tzinfo else None
    except Exception:
        return None


def pools_in(row):
    return {p.strip() for p in str(row.get('canary_pool') or '').split(',') if p.strip()}


def parse_ledger(lines):
    """PURE. -> rows. Raises ValueError on ANY malformed line, a row that is not a dict, an unreadable ts or a row that
    names no pool: an unreadable decision could be the one that holds a pool."""
    out = []
    for i, l in enumerate(lines):
        l = l.strip()
        if not l:
            continue
        r = json.loads(l)
        if not isinstance(r, dict) or _t(r.get('ts')) is None or not pools_in(r):
            raise ValueError('ledger line %d unusable' % (i + 1))
        out.append(r)
    return out


def candidates(ledger_rows, journal_rows, now):
    """PURE. -> ({pool: (run, sha, decided_at)} eligible for 6 h on rule 1, {pool: why} held at 12 h).
    Every decision within EXCL_H naming a pool must qualify; one that does not holds the pool."""
    promoted = {}
    for r in journal_rows:
        if isinstance(r, dict) and r.get('phase') == 'promoted' and 'fleet-wide' in str(r.get('note') or ''):
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


def parse_units(text):
    """PURE. `systemctl list-units mcbot@* --all --plain --no-legend` -> {bot: active_running (bool)}."""
    out = {}
    for l in text.splitlines():
        w = l.split()
        if len(w) >= 4 and w[0].startswith('mcbot@') and w[0].endswith('.service'):
            out[w[0][len('mcbot@'):-len('.service')]] = (w[1] == 'loaded' and w[2] == 'active' and w[3] == 'running')
    return out


def bot_stats(rows, since, bad=0, corrupt=0):
    """PURE. rows: [(t, version, bag_vector or None)] in [since, since + STEADY_MIN). -> rows, versions, corruption, and
    the mean slots over the hour and over each half (None where the half has no bag reading)."""
    mid = since + dt.timedelta(minutes=STEADY_MIN / 2)
    mean = lambda xs: (sum(xs) / len(xs)) if xs else None
    all_ = [b[0] for _t_, _v, b in rows if b]
    h1 = [b[0] for t, _v, b in rows if b and t < mid]
    h2 = [b[0] for t, _v, b in rows if b and t >= mid]
    return {'rows': len(rows), 'versions': {str(v)[:7] for _t_, v, _b in rows}, 'bad': bad, 'corrupt': corrupt,
            'm': mean(all_), 'h1': mean(h1), 'h2': mean(h2)}


def qualify(stats, units, fv):
    """PURE. One pool. stats: {bot: bot_stats} for EVERY unit of the pool (a unit with no logs maps to None);
    units: {bot: active}. -> ({'m','h1','h2','d','bots'} or None, why). The same test for a candidate and a control."""
    if not fv:
        return None, 'fleet version unreadable'
    if not units:
        return None, 'no mcbot units for this pool'
    for b in sorted(units):
        s = stats.get(b)
        if not units[b]:
            return None, '%s: unit not active/running (a down bot holds its pool)' % b
        if s is None:
            return None, '%s: no log rows in the last %d min' % (b, STEADY_MIN)
        if s['bad'] or s['corrupt']:
            return None, '%s: %d unreadable file(s), %d corrupt row(s) in the hour' % (b, s['bad'], s['corrupt'])
        if s['rows'] < MIN_ROWS:
            return None, '%s: %d rows in %d min (< %d)' % (b, s['rows'], STEADY_MIN, MIN_ROWS)
        if s['versions'] != {fv}:
            return None, '%s: builds %s in the last %d min, not only %s (restart lag)' % (b, sorted(s['versions']), STEADY_MIN, fv)
        if s['h1'] is None or s['h2'] is None:
            return None, '%s: no bag reading in one half of the hour' % b
    n = len(units)
    m = sum(stats[b]['m'] for b in units) / n
    h1 = sum(stats[b]['h1'] for b in units) / n
    h2 = sum(stats[b]['h2'] for b in units) / n
    return {'m': m, 'h1': h1, 'h2': h2, 'd': h2 - h1, 'bots': n}, 'qualified'


def steady(cand, summary, controls, fleet_version, fleet_declared_at):
    """PURE. Rules 2 (fleet version) and 3 for one candidate. summary: qualify()'s summary of the candidate (None = it
    failed); controls: {pool: summary} of QUALIFIED control pools. -> (ok, why)."""
    run, sha, decided = cand
    fv = str(fleet_version or '')[:7]
    if not fv:
        return False, 'fleet version unreadable'
    if fv != sha and not (fleet_declared_at is not None and fleet_declared_at >= decided):
        return False, 'fleet runs %s, not the promoted %s nor a later deploy' % (fv, sha)
    if summary is None:
        return False, 'the pool did not qualify'
    cs = [c for c in controls.values() if c]
    if len(cs) < MIN_CONTROL_POOLS:
        return False, 'only %d qualified control pools (< %d)' % (len(cs), MIN_CONTROL_POOLS)
    for k, name in (('m', 'bag fill over the hour'), ('h1', 'bag fill, first half'), ('h2', 'bag fill, second half'),
                    ('d', 'change between halves')):
        lo, hi = min(c[k] for c in cs), max(c[k] for c in cs)
        if not (lo <= summary[k] <= hi):
            return False, '%s %+.2f outside the controls\' %+.2f..%+.2f (carryover not cleared)' % (name, summary[k], lo, hi)
    return True, ('%s KEEP+promoted %s; %d bots on %s only for %d min; bag fill %.1f (halves %.1f -> %.1f) inside %d '
                  'controls' % (run, decided.strftime('%m-%dT%H:%MZ'), summary['bots'], fv, STEADY_MIN, summary['m'],
                                summary['h1'], summary['h2'], len(cs)))


def read_units():
    if UNITS_FILE:
        return parse_units(open(UNITS_FILE).read())
    r = subprocess.run(['systemctl', 'list-units', 'mcbot@*', '--all', '--no-legend', '--plain'],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise OSError('systemctl list-units failed (%d)' % r.returncode)
    u = parse_units(r.stdout)
    if not u:
        raise OSError('systemctl listed no mcbot units')
    return u


def _journal(path):
    out = []
    with open(path) as f:
        for l in f:
            try:
                out.append(json.loads(l))
            except ValueError:
                continue        # a lost journal row can only lose a `promoted` row: that HOLDS (fail safe)
    return out


def main():
    now = dt.datetime.now(dt.timezone.utc)
    if os.environ.get('STEADY_NOW'):         # REPLAY ONLY (scripts/host/drawsteady_replay.sh); printed, never silent
        now = _t(os.environ['STEADY_NOW']); print('STEADY REPLAY at %s (STEADY_NOW): not a live answer' % now.isoformat())
    try:
        ledger = parse_ledger(open(LEDGER).readlines())
        journal, man = _journal(JOURNAL), json.load(open(MANIFEST))
    except Exception as e:
        print('STEADY inputs unreadable or malformed (%s: %s): 12 h for every pool' % (type(e).__name__, str(e)[:120]))
        print('STEADY RELEASE []'); return 0
    cand, held = candidates(ledger, journal, now)
    for p, why in sorted(held.items()):
        print('STEADY 12h %s: %s' % (p, why))
    if not cand:
        print('STEADY no KEEP+promoted pool between %d and %d h' % (EARLY_H, EXCL_H)); print('STEADY RELEASE []'); return 0
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import bagread
        units = read_units()
        by_pool = {}
        for b, active in units.items():
            by_pool.setdefault(pool_of(b), {})[b] = active
        fv = str(man.get('declared_code_version') or '')[:7]
        touched = set(held) | set(cand) | pools_in(man)
        since = now - dt.timedelta(minutes=STEADY_MIN)

        def summary_of(pool):
            st = {}
            for b in by_pool.get(pool, {}):
                rows, bad, corrupt, _d = bagread.bot_rows(b, since, now, root=LOGROOT)
                st[b] = bot_stats(rows, since, bad, corrupt) if (rows or bad or corrupt) else None
            return qualify(st, by_pool.get(pool, {}), fv)
        ctl = {}
        for p in sorted(by_pool):
            if p in touched or p == 'placebo-c' or p.startswith('isolated'):
                continue
            s, why = summary_of(p)
            ctl[p] = s
            print('STEADY control %s: %s' % (p, ('bag %.1f (%.1f -> %.1f)' % (s['m'], s['h1'], s['h2'])) if s else 'NOT QUALIFIED: ' + why))
        rel = []
        for p, c in sorted(cand.items()):
            s, qwhy = summary_of(p)
            ok, why = steady(c, s, ctl, man.get('declared_code_version'), _t(man.get('declared_at')))
            print('STEADY %s %s: %s' % ('6h' if ok else '12h', p, why if s else why + ': ' + qwhy))
            if ok:
                rel.append(p)
    except Exception as e:
        print('STEADY measurement failed (%s: %s): 12 h for every pool' % (type(e).__name__, str(e)[:160])); print('STEADY RELEASE []'); return 0
    print('STEADY RELEASE %r' % rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
