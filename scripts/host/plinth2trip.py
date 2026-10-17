#!/usr/bin/env python3
# plinth2trip.py [window_min] -- the FLEET TRIPWIRE for plinth-02's direct rollout (OWNER 10-17 option 2: 0fe92258 fleet-wide, no
# canary, rollback = redeploy 0152baeb). READ ONLY. Run under `nice` on 10.0.0.31 from ~/mcai-analysis:
#
#     cd ~/mcai-analysis && nice -n 19 python3 plinth2trip.py
#
# EVERY POOL IS THE TREATED ARM: no control, no DiD. It runs the two installed reads in-process (runpy), plinth2read.py and
# wellread.py, with CANARY_DRYRUN = <all pools>:<the manifest's declared_code_version[:8]>:<declared_at>. The window starts at
# the rollout (declared_at) and runs to now; rows from any other build are skipped (restart lag). Neither read emits anything
# in dry-run mode. Then it judges:
#   P1 outside shell   a _plinth_step placement outside its own plan's shell / stair lines          (plinth2read outside)
#   P2 reserve         a build visit that placed and left the bag under 64 reserve stone            (reserve_breach)
#   P3 pit open        a plinth column walled in and uncovered > 10 min                              (open_pits)
#   P4 retired         a _well_retired at a plinth cap                                                (retired_p)
#   P5 stuck           > 1 stuck episode (entombed / stranded / livelock) within 3 of a plinth cap   (stuck_p; one is named)
#   C1 C2 C4 C5 C6 C9  the junk well's correctness gates (wellread well_gates) on the rows AT RAISED WELLS: a row whose at= is
#                      a plinth cap, or a row with no at= from a pool that has one; C6 (> 1 active well) for those pools.
#                      The same gates over EVERY well are printed as context, never a breach.
#   INSTRUMENT         the read must see the build: >= 1 `_plinth_mode` licence row and >= 1 `_plinth_step` row since the
#                      rollout, and rows walked > 0. Failing that prints `TRIPWIRE BREACH INSTRUMENT ...` -- a blind read,
#                      NOT a rollback trigger.
# Plinth caps are the union of the canary rows' caps and the plinth records' (plinth2read gate_caps / recorded_caps, which need
# the pool's world affirmed by a `_plinth_mode` or no_site row of the window).
# LAST LINE: `TRIPWIRE OK` or one `TRIPWIRE BREACH <line> <town> <detail>` per breach (the first breach is also the last line).
import os, sys, io, re, json, glob, runpy, contextlib
import datetime as dt
from collections import Counter, defaultdict

AN = os.path.dirname(os.path.abspath(__file__))
STATE = '/var/lib/mcai'


def xyz(s):
    try:
        a = [int(v) for v in str(s or '').split(',')]
        return tuple(a) if len(a) == 3 else None
    except ValueError:
        return None


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def records(pool):
    """The pool's plinth records -> [{state, cap, left, steps, k, dirs}] (leases skipped), one per distinct (state, cap). Read only.
    An ISOLATED pool keeps one state dir PER BOT (_pool-self-<pool>-<Bot>): every bot of the world plans and records the same
    plinth on its own, with its own lease -- `dirs` says how many bots hold that record."""
    out = []
    files = sorted(glob.glob('%s/_pool-%s/junkwell-plinth-*.json' % (STATE, pool))) + sorted(glob.glob('%s/_pool-self-%s-*/junkwell-plinth-*.json' % (STATE, pool)))
    for f in files:
        if '.lease.' in f:
            continue
        try:
            r = json.load(open(f))
        except Exception:
            continue
        cap = ((r.get('plan') or {}).get('cap') or {})
        rec = {'state': r.get('state'), 'cap': (cap.get('x'), cap.get('y'), cap.get('z')) if cap else None,
               'left': r.get('left'), 'steps': len((r.get('plan') or {}).get('steps') or []), 'k': (r.get('plan') or {}).get('k'), 'dirs': 1}
        same = [o for o in out if o['state'] == rec['state'] and o['cap'] == rec['cap']]
        if same:
            same[0]['dirs'] += 1
            if rec['left'] is not None and (same[0]['left'] is None or rec['left'] < same[0]['left']):
                same[0]['left'] = rec['left']
        else:
            out.append(rec)
    return out


def well_built_ever(pool, cap):
    """Was a junk well ever built at this cap (a `_well_built ... at=<cap> facing=` row in any of the pool's skill logs, live or
    rotated)? Read only; asked only for complete plinths with no build in the window."""
    import subprocess
    pat = 'at=%d,%d,%d facing=' % cap
    files = glob.glob('/var/log/mcai/%s-*/skill-*.jsonl*' % pool)
    if not files:
        return False
    try:
        r = subprocess.run(['zgrep', '-a', '-l', '-F', pat] + files, capture_output=True, text=True, timeout=120)
        return bool(r.stdout.strip())
    except Exception:
        return False


def raised_rows(rows, caps, pools_with_caps):
    """The well rows AT RAISED WELLS: at= on a plinth cap, or no at= from a pool that has one. Pure."""
    keys = {'%d,%d,%d' % c for c in caps}
    out = []
    for r in rows:
        f = kv(r.get('detail') or '')
        at = f.get('at')
        if at is not None:
            if at in keys:
                out.append(r)
        elif pool_of((r.get('bot') or {}).get('name')) in pools_with_caps:
            out.append(r)
    return out


# ---- self-tests (pure parts) ----------------------------------------------------------------------------------------------
_R = [{'name': '_well_dispose', 'detail': 'slots=36->27 at=365,73,137 misses=1', 'bot': {'name': 'board-c-Alpha'}},
      {'name': '_well_dispose', 'detail': 'slots=36->27 at=1,2,3 misses=1', 'bot': {'name': 'board-c-Alpha'}},
      {'name': '_well_recollected', 'detail': 'item=egg', 'bot': {'name': 'board-c-Bravo'}},
      {'name': '_well_recollected', 'detail': 'item=egg', 'bot': {'name': 'hive-a-Bravo'}}]
assert [r['detail'][:20] for r in raised_rows(_R, {(365, 73, 137)}, {'board-c'})] == ['slots=36->27 at=365,', 'item=egg'], 'at= on a cap, or no at= in a pool with one'
assert raised_rows(_R, set(), set()) == [], 'no caps, nothing raised'
assert pool_of('isolated-a-Comet') == 'isolated-a' and xyz('1,2,3') == (1, 2, 3) and xyz('x') is None


def run_read(name, argv_w):
    sys.argv = [name, str(argv_w)]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        g = runpy.run_path(os.path.join(AN, '%s.py' % name), run_name='__main__')
    return g, buf.getvalue()


def main():
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    cv = (man.get('declared_code_version') or '')[:8]
    cut_iso = man.get('declared_at') or ''
    pools = sorted({os.path.basename(p.rstrip('/')).rsplit('-', 1)[0] for p in glob.glob('/var/log/mcai/*-*/')})
    cut = dt.datetime.fromisoformat(cut_iso.replace('Z', '+00:00'))
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - cut).total_seconds() / 60
    w = min(elapsed, float(sys.argv[1])) if len(sys.argv) > 1 else elapsed
    os.environ['CANARY_DRYRUN'] = '%s:%s:%s' % (','.join(pools), cv, cut_iso)
    breaches = []
    def breach(line, town, detail):
        breaches.append('TRIPWIRE BREACH %s %s %s' % (line, town, str(detail).replace('\n', ' ')[:240]))

    P, _ = run_read('plinth2read', w)
    WR, _ = run_read('wellread', w)

    # ---- denominators first ----
    ev = P['ev_rows']
    post = [r for r in ev if r.get('t') and r['t'] >= cut]
    vers = Counter(((((r.get('raw') or {}).get('code') or {}).get('version') or '')[:8]) for r in post)
    bots = {(r.get('bot') or {}).get('name') for r in post if (((r.get('raw') or {}).get('code') or {}).get('version') or '').startswith(cv)}
    mode_rows = sum(1 for r in post if r.get('name') == '_plinth_mode' and (((r.get('raw') or {}).get('code') or {}).get('version') or '').startswith(cv))
    steps = P['steps']
    print('DENOMINATORS fleet build %s since %s (%.0f min, window %.0f) | rows walked %d, post %d (this build %d, other builds %d) | bots on the build %d | pools %d'
          % (cv, cut_iso[:19] + 'Z', elapsed, w, len(ev), len(post), vers.get(cv, 0), len(post) - vers.get(cv, 0), len(bots), len(pools)))
    print('INSTRUMENT   _plinth_mode licence rows %d (>= 1) | _plinth_step rows %d (>= 1: the read sees the build placing) | _plinth rows %d'
          % (mode_rows, len(steps), P['n'][('post', 'canary', 'licence')]))
    if not ev or mode_rows < 1 or len(steps) < 1:
        breach('INSTRUMENT', 'fleet', 'blind: rows %d, _plinth_mode %d, _plinth_step %d since the rollout -- a blind read, NOT a rollback trigger' % (len(ev), mode_rows, len(steps)))

    # ---- the plinth gates (plinth2read, every pool treated) ----
    caps = dict(P['caps'])                      # cap -> pool (rows + records)
    for c, pool in (P.get('rec_caps') or {}).items():
        caps.setdefault(c, pool)
    for b, t, at in P['outside']:
        breach('P1_outside_shell', pool_of(b), '%s placed %s outside its plan\'s shell/stair at %s' % (b, at, t))
    for b, t, have in P['reserve_breach']:
        breach('P2_reserve', pool_of(b), '%s left the bag at %d reserve stone (< 64) at %s' % (b, have, t))
    for at in P['open_pits']:
        breach('P3_pit_open', caps.get(tuple(at), '?') if isinstance(at, (tuple, list)) else '?', 'plinth column %s walled in and uncovered > 10 min' % (at,))
    for b, t, at in P['retired_p']:
        breach('P4_retired', pool_of(b), 'raised well at %s retired (breached) by %s at %s' % (at, b, t.strftime('%H:%M:%SZ')))
    if len(P['stuck_p']) > 1:
        towns = Counter(pool_of(b) for b, _t, _p in P['stuck_p'])
        breach('P5_stuck', ','.join(sorted(towns)), '%d stuck episodes within 3 of a plinth cap (two-row floor): %s' % (len(P['stuck_p']), P['stuck_p'][:3]))
    elif P['stuck_p']:
        print('NAMED        one stuck episode near a plinth (not a breach, two-row floor): %s' % (P['stuck_p'],))

    # ---- the well gates at RAISED wells (wellread well_gates) ----
    pools_with = set(caps.values())
    allw = WR['well_gates'](WR['ev_rows'], WR['CANS'], WR['CUT'], WR['CV'], WR['END'])['canary']
    rr = raised_rows([r for r in WR['ev_rows'] if r.get('name') in WR['WELL_KINDS']], set(caps), pools_with)
    G = WR['well_gates'](rr, WR['CANS'], WR['CUT'], WR['CV'], WR['END'])['canary']
    c9_all, _c9p = WR['c9'], WR['c9_pending']
    keys = {'%d,%d,%d' % c for c in caps}
    c9r = [x for x in c9_all if str(x[1]) in keys]
    print('WELL GATES   at raised wells (%d rows of %d well rows): C1 %d | C2 %d (pending %d) | C4 %d | C5 %d (misses %d retaken %d) | C6 %s | C9 %d'
          % (len(rr), sum(1 for r in WR['ev_rows'] if r.get('name') in WR['WELL_KINDS']), len(G['c1']), len(G['c2']), len(G['c2_pending']),
             len(G['c4']), G['c5'], G['misses'], G['retaken'], {p: n for p, n in allw['c6'].items() if p in pools_with} or 0, len(c9r)))
    print('             (context, every well, not judged: C1 %d | C2 %d | C4 %d | C5 %d | C6 %s | C9 %d)'
          % (len(allw['c1']), len(allw['c2']), len(allw['c4']), allw['c5'], allw['c6'] or 0, len(c9_all)))
    for b, d in G['c1']:
        breach('C1_recollected', pool_of(b), '%s collected an item out of a raised well: %s' % (b, d))
    for b, key, t in G['c2']:
        breach('C2_left_open', pool_of(b), 'raised-well cap %s left open > 2 min by %s at %s' % (key[1] if isinstance(key, (tuple, list)) else key, b, t[:19]))
    for b, at, span in G['c4']:
        breach('C4_stuck_inside', pool_of(b), '%s inside the raised well at %s for %s' % (b, at, span))
    if G['c5'] > 0:
        breach('C5_misses_left', ','.join(sorted(pools_with)), '%d throws at raised wells missed and were not retaken (misses %d, retaken %d)' % (G['c5'], G['misses'], G['retaken']))
    for p, n in allw['c6'].items():
        if p in pools_with:
            breach('C6_multi_well', p, '%d active wells in one town (a raised well beside another)' % n)
    for b, at, stage in c9r:
        breach('C9_pit_left_open', pool_of(b), 'raised-well pit at %s opened by %s (%s) and not covered or built within 10 min' % (at, b, stage))

    # ---- per town ----
    steps_by = Counter(pool_of(b) for b, _t, _f in steps)
    built_by = defaultdict(set)
    for r in WR['ev_rows']:
        if r.get('name') == '_well_built' and r.get('t') and r['t'] >= cut:
            built_by[pool_of((r.get('bot') or {}).get('name'))].add(kv(r.get('detail') or '').get('at'))
    disp = Counter(); disp_all = Counter()
    for r in WR['ev_rows']:
        if r.get('name') == '_well_dispose' and r.get('t') and r['t'] >= cut:
            f = kv(r.get('detail') or ''); p = pool_of((r.get('bot') or {}).get('name'))
            disp_all[p] += 1
            if f.get('at') in keys:
                disp[p] += 1
    notes = []
    print('TOWNS        town        plinth record (state, cap, k, steps)              steps since rollout  well built at a cap  disposes at raised / all')
    for p in pools:
        recs = records(p)
        rec_s = '; '.join('%s %s k=%s %s%s%s' % (r['state'], '%s,%s,%s' % r['cap'] if r['cap'] and None not in r['cap'] else '-', r['k'], r['steps'],
                                                  (' left=%s' % r['left']) if r['state'] == 'plan' and r['left'] is not None else '',
                                                  (' x%d bots' % r['dirs']) if r['dirs'] > 1 else '') for r in recs) or 'none'
        mine = {'%d,%d,%d' % c for c, q in caps.items() if q == p}
        well = sorted(a for a in built_by.get(p, ()) if a in mine)
        before = [r['cap'] for r in recs if r['state'] == 'complete' and r['cap'] and None not in r['cap'] and not well and well_built_ever(p, tuple(r['cap']))]
        status = ('well built' if well or before or disp.get(p, 0) > 0
                  else 'complete' if any(r['state'] == 'complete' for r in recs)
                  else 'building' if steps_by.get(p) else 'plan' if any(r['state'] == 'plan' for r in recs) else '-')
        print('             %-11s %-9s %-46s %5d                %-20s %d / %d' % (p, status, rec_s[:46], steps_by.get(p, 0), ','.join(well) or '-', disp.get(p, 0), disp_all.get(p, 0)))
        live = {r['cap'] for r in recs if r['state'] in ('plan', 'complete') and r['cap'] and None not in r['cap']}
        if len(live) > 1:
            notes.append('NAMED        %s: %d different plinth caps planned or complete in one world (%s) -- isolated bots plan apart; watch C6' % (p, len(live), sorted(live)))
        if any(r['dirs'] > 1 for r in recs):
            notes.append('NAMED        %s: %s bots each hold their own record and lease for the same plinth (an isolated pool: one state dir per bot)' % (p, max(r['dirs'] for r in recs)))

    for x in notes:
        print(x)
    if breaches:
        for b in breaches:
            print(b)
        print(breaches[0])
    else:
        print('TRIPWIRE OK')


if __name__ == '__main__':
    main()
