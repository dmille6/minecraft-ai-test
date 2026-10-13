#!/usr/bin/env python3
# wellsiteread.py [window_min] -- the read for canary `wellsite-01` (branch wellsite-on-82aef34). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/well.mjs, skills.mjs buildWell/throwPhase):
#   A1  an EXHAUSTED site search (every column of rings 7..14 read and refused) is a fact about the town's ground: the
#       build order backs off 2 h (wellOrderOutcome, failClass well_no_site) and the town remembers it in the pool
#       state dir (junkwell-nosite-<home>.json), so no bot of the pool -- after a reconnect or a restart either --
#       searches again for 2 h. Rows: _well_refused reason=no_site (a completed search, tally= FIRST) and
#       reason=no_site_held (no search ran). Anything else that finds no site (an unloaded cell, a record race, an
#       unreadable record) is reason=site_deferred and stays free.
#   A3  a sand/red_sand/gravel WALL resting on non-falling full ground is a wall (steadyWall), and the shaft is read
#       sealed again at the stand immediately before the first throw (reason=breached on a dispose refused there).
#   A4  the no_site row carries tally=cols:N,<class>:n,... (first refusal per column).
#   A5  _well_retired once per well and reason per bot process.
# MEASURED BEFORE (10-12, 24 h, 80 bots): 3,197 no_site refusals in 12 towns from 55 bots, per-bot gap p50 7.2 min;
#   741 _well_retired rows that were two wells; placebo-b's sealed well (280,58,-398) retired for one supported sand block.
#
#   LICENCE      canary _well_refused rows carrying " tally=cols:" (the base never writes it).
#   GATES        G1 breach_search_repeat: two COMPLETED searches (reason=no_site) in one canary POOL closer than the hold
#                   (2 h, less 60 s of slack), excluding a pair inside 60 s (two bots searching in the same second
#                   before either record landed). A held town that searches again is A1 not holding.
#                G2 breach_untallied: a canary reason=no_site row with no tally= field (the instrument incomplete).
#                Disposal safety (C1-C9) is wellread's, registered beside this read.
#   INSTRUMENT   control reason=no_site rows in the post window (>= 1): the population exists and this query sees it.
#   PRIMARY      completed searches per bot-hour, canary vs control, pre vs post (DiD); held rows; deferrals; build_well
#                orders per bot-hour DiD; well_retired rows per bot-hour DiD; canary dispose_well successes by pool
#                (A3's effect where a canary town had a supported-sand well); the latest tally per canary town.
import sys, os, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

HOLD = dt.timedelta(hours=2)           # well.mjs WELL_NO_SITE_BACKOFF_MS
SLACK = dt.timedelta(seconds=60)


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def reason_of(d):
    return kv(d).get('reason')


def tally_of(d):
    t = kv(d).get('tally')
    if not t:
        return None
    out = {}
    for part in t.split(','):
        k, _, v = part.partition(':')
        if k and v.isdigit():
            out[k] = int(v)
    return out or None


def search_repeats(searches):
    """PURE. searches: [(pool, t)] completed searches of the canary arm. -> [(pool, t_prev, t_next)]: pairs closer than the
    hold (less SLACK) and further apart than SLACK (a same-second race between two bots is not a repeat)."""
    by = defaultdict(list)
    for p, t in searches:
        by[p].append(t)
    out = []
    for p, ts in by.items():
        ts.sort()
        for a, b in zip(ts, ts[1:]):
            if SLACK < (b - a) < HOLD - SLACK:
                out.append((p, a, b))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


# ---- positive controls on the bot's own row strings (bots/src/skills.mjs wellRefused: "order=... reason=... <said>") ----
_ROW = "order=build reason=no_site tally=cols:672,column:238,walls:157,floor:152,beyond:119,nocap:3,open:3 the town's junk well site cannot be settled: no cell within 14 of home passes the containment rule; the build order waits 120 min for the ground to change"
assert reason_of(_ROW) == 'no_site' and tally_of(_ROW) == {'cols': 672, 'column': 238, 'walls': 157, 'floor': 152, 'beyond': 119, 'nocap': 3, 'open': 3}
assert reason_of("order=build reason=no_site_held the town's last junk well site search (a, 3 min ago) ...") == 'no_site_held'
assert tally_of("order=build reason=no_site the town's junk well site cannot be settled from here: no valid cell for a well near home") is None, 'the base row has no tally'
_T = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)
_m = lambda n: _T + dt.timedelta(minutes=n)
assert search_repeats([('board-a', _m(0)), ('board-a', _m(30))]) == [('board-a', _m(0), _m(30))], 'a search inside the hold is a repeat'
assert search_repeats([('board-a', _m(0)), ('board-a', _m(121))]) == [], 'after the hold it is not'
assert search_repeats([('board-a', _m(0)), ('board-a', _m(0) + dt.timedelta(seconds=5))]) == [], 'a same-second race is not'
assert search_repeats([('board-a', _m(0)), ('board-b', _m(30))]) == [], 'two towns are two holds'

if __name__ == '__main__':
    import json
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
        """Rotation-aware (wellread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z rotation."""
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        import glob as _glob
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                e2 = Events.load(paths=g, since=since, until=until)
                for r in e2.rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); rows = Counter(); offbuild = 0
    n = Counter()                                   # (period, arm, what)
    searches = []; untallied = []; disposed = Counter(); last_tally = {}; held_by_pool = Counter()
    for r in ev_rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1                           # a restart-lag row of the old build is not canary
            continue
        bots[(period, arm)].add(b); rows[(period, arm)] += 1
        k = (r.get('name') or '').lstrip('_'); d = r.get('detail') or ''
        if k == 'well_refused' and d.startswith('order=build '):
            rs = reason_of(d)
            n[(period, arm, 'refused_' + str(rs))] += 1
            if rs == 'no_site':
                if period == 'post' and arm == 'canary':
                    searches.append((pool_of(b), t))
                    tl = tally_of(d)
                    if tl is None:
                        untallied.append((b, t.strftime('%H:%M:%S')))
                    else:
                        last_tally[pool_of(b)] = kv(d).get('tally')
            if rs == 'no_site_held' and period == 'post' and arm == 'canary':
                held_by_pool[pool_of(b)] += 1
            if ' tally=cols:' in d and arm == 'canary' and period == 'post':
                n[('post', 'canary', 'licence')] += 1
        elif k == 'build_well':
            n[(period, arm, 'build_orders')] += 1
        elif k == 'well_retired':
            n[(period, arm, 'retired')] += 1
        elif k == 'dispose_well' and (r.get('status') == 'success'):
            n[(period, arm, 'dispose_success')] += 1
            if period == 'post' and arm == 'canary':
                disposed[pool_of(b)] += 1

    hours = W / 60.0
    def rate(period, arm, what):
        nb = len(bots[(period, arm)])
        return n[(period, arm, what)] / (nb * hours) if nb and hours else float('nan')
    def did(what):
        return (rate('post', 'canary', what) - rate('pre', 'canary', what)) - (rate('post', 'control', what) - rate('pre', 'control', what))

    g1 = search_repeats(searches)
    inst = n[('post', 'control', 'refused_no_site')]
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots pre/post canary %d/%d control %d/%d  |  offbuild canary rows %d'
          % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]),
             len(bots[('pre', 'control')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     canary rows post %d | licence (canary _well_refused with tally=cols:) %d (>= 1)' % (rows[('post', 'canary')], n[('post', 'canary', 'licence')]))
    print('G1 (gate)    completed searches repeated inside the 2 h hold, per canary town: %d %s | completed searches %d'
          % (len(g1), [(p, a.strftime('%H:%M'), b.strftime('%H:%M')) for p, a, b in g1[:4]], len(searches)))
    print('G2 (gate)    canary no_site rows with no tally=: %d %s' % (len(untallied), untallied[:3]))
    print('INSTRUMENT   control no_site rows post %d (>= 1: the population exists and the query sees it); control pre %d'
          % (inst, n[('pre', 'control', 'refused_no_site')]))
    for what, label in (('refused_no_site', 'completed searches'), ('build_orders', 'build_well orders'), ('retired', 'well_retired rows'),
                        ('dispose_success', 'dispose_well successes')):
        print('PRIMARY      %-22s per bot-h  canary %.3f -> %.3f  control %.3f -> %.3f  DiD %+.3f'
              % (label, rate('pre', 'canary', what), rate('post', 'canary', what), rate('pre', 'control', what), rate('post', 'control', what), did(what)))
    print('             canary held rows (no search ran) %s | deferrals (site_deferred) post canary %d control %d'
          % (dict(held_by_pool), n[('post', 'canary', 'refused_site_deferred')], n[('post', 'control', 'refused_site_deferred')]))
    print('             canary dispose successes by town %s | latest tally per canary town %s' % (dict(disposed), last_tally))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        emit('wellsiteread', W, {
            'rows_canary': rows[('post', 'canary')], 'rows_control': rows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n[('post', 'canary', 'licence')],
            'breach_search_repeat': len(g1), 'breach_untallied': len(untallied),
            'searches_canary': len(searches), 'held_canary': sum(held_by_pool.values()),
            'deferred_canary': n[('post', 'canary', 'refused_site_deferred')], 'instrument_control': inst,
            'search_rate_did': nanless(did('refused_no_site')), 'build_order_rate_did': nanless(did('build_orders')),
            'retired_rate_did': nanless(did('retired')), 'dispose_rate_did': nanless(did('dispose_success')),
            'dispose_success_canary': n[('post', 'canary', 'dispose_success')],
            'exposure_ready': int(n[('post', 'canary', 'licence')] >= 1 and inst >= 1 and W >= 150),
        })
    except Exception as e:
        print('emit failed:', e)
