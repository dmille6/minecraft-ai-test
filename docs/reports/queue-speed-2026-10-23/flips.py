#!/usr/bin/env python3
"""flips.py <snapshot> <scan.jsonl> <host mods> <patches> <settle.jsonl> -- READ-ONLY. DESIGN 1: would a changed draw
have flipped its run's verdict?

A changed draw puts into the canary arm a pool that never ran that canary, so the run's own reads CANNOT be re-run on
it: there are no canary rows for that pool. What CAN be re-run exactly, from the logs, is every part of the decision
that depends only on the pools' own past or on rows that exist:
  R1 the v36 tier-2 BASELINE (tierrule.asymmetric_rows, the gate's own function) for the counterfactual canary set at
     the counterfactual declared time, at the read the run was decided at and, for a 4-pool tier-2 draw, at +180 --
     a dirty baseline means the gate CANNOT KEEP there, which is a flip of a recorded KEEP;
  R2 the DEATH GATE (deathgate.death_gate, the gate's own function) at every 5-min poll from the deploy to the decision,
     with the counterfactual arms: the 10-08 method (canary-throughput-2026-10-08.md section 3) generalised -- pools
     move between arms, every death is a real recorded death. A pool that did not run the canary contributes its own
     baseline deaths (a null-effect assumption, stated: it dilutes a harmful canary, the KEEP-favouring direction);
  R3 the tier-2 +180 KEEP (tierrule.keep_early, the gate's own function) for a 4-pool counterfactual, with the recorded
     +180 artifact's lines (WATCH, blocks, exposure) and R1/R2's counterfactual inputs -- REASONED, not re-run: the
     exposure and own lines of a pool that never ran the canary are unknown and are taken from the 3-pool read;
  R4 PRE-window contamination of a TIER-3 run's deciding read (no gate checks it): REASONED, flagged.
Positive controls: the actual arms reproduce each run's recorded death line at its deciding read; the actual canary set
reproduces each tier-2 run's recorded `tier 2 baseline` verdict."""
import datetime as dt, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawsim

T, ISO = drawsim.T, drawsim.ISO


def roster(sim):
    return sorted(b for b in sim.B if '-Charlie' not in b)


def buckets(sim, bots, since, until):
    i0 = sim.bi(since)
    out = {}
    for b in bots:
        bk = out.setdefault(b, {})
        for i, c in sim.cells(b, since, until):
            cc = bk.setdefault((i - i0) // 2, {})
            for v, x in c['v'].items():
                if x[0]:
                    cc[v] = cc.get(v, 0) + x[0]
    return out


def baseline(sim, pools, D, L):
    since, until = D - dt.timedelta(minutes=L), D
    can = [b for b in roster(sim) if sim.pool_of(b) in pools]
    ctl = [b for b in roster(sim) if sim.pool_of(b) not in pools]
    ok, why, _h = sim.TR.asymmetric_rows(buckets(sim, can, since, until), buckets(sim, ctl, since, until), can, since, until, 0)
    return ok, why


def deaths(sim, pools, t0, t1, exclude=()):
    n = 0
    for b in roster(sim):
        if b.startswith('isolated') or sim.pool_of(b) in exclude:
            continue
        if (sim.pool_of(b) in pools) and any(t0 <= x < t1 for x, _d in sim.deaths.get(b, [])):
            n += sum(1 for x, _d in sim.deaths[b] if t0 <= x < t1)
    return n


def death_polls(sim, can, D, M):
    """The gate at every 5-min poll to +M. Control = every non-isolated pool not in the canary (verdict.py's arm)."""
    ctl = [p for p in sim.pools if p not in can and not p.startswith('isolated')]
    trips = []
    for m in range(5, M + 1, 5):
        t1 = D + dt.timedelta(minutes=m)
        cd, kd = deaths(sim, can, D, t1), deaths(sim, ctl, D, t1)
        cbh, kbh = 5 * len(can) * m / 60, 5 * len(ctl) * m / 60
        rev, why = sim.DG.death_gate(cd, cbh, kd, kbh)
        if rev:
            trips.append((m, why[:160]))
    t1 = D + dt.timedelta(minutes=M)
    return deaths(sim, can, D, t1), deaths(sim, ctl, D, t1), 5 * len(can) * M / 60, 5 * len(ctl) * M / 60, trips


def recorded(sim, run):
    rs = sim.runs[run]
    dep = [r for r in rs if r['phase'] == 'deployed']
    D = T(str(dep[0]['note']).split()[1]) if dep else None
    rec = [r for r in rs if r['phase'] == 'recorded']
    reads = [r for r in rs if r['phase'].startswith('read-')]
    dec = None
    for r in rs:
        if r['phase'].startswith('read-') and str(r.get('note', '')).startswith('VERDICT ') and 'NOT_YET' not in str(r['note'])[:20]:
            dec = r
    m = re.match(r'VERDICT (\w+) \(\+(\d+)\)', str(dec['note'])) if dec else None
    return D, (m.group(1), int(m.group(2))) if m else (rec[-1]['note'] if rec else None, None), dec


def main(snap, scan, hostmods, patches, settle_json):
    sim = drawsim.Sim(snap, scan, hostmods, patches)
    # the bundle's deathgate.py (md5 450d32bf = the live gate 635ad8d8's part), copied with ~/gate-v36
    sys.path.append(os.path.join(os.path.dirname(hostmods.rstrip('/')), 'gate-v36'))
    import deathgate
    sim.DG = deathgate
    recs = [json.loads(l) for l in open(settle_json)]
    reads = os.path.join(snap, 'reads')
    print('== POSITIVE CONTROLS (actual arms, actual declared_at)')
    seen = set()
    for r in recs:
        if (r['earlier'] or r['more']) and r['run'] not in seen:
            seen.add(r['run'])
            D, (v, M), dec = recorded(sim, r['run'])
            if not D or not M:
                print('  %-16s no scheduled verdict line (closed by hand): %s' % (r['run'], v)); continue
            cd, kd, cbh, kbh, trips = death_polls(sim, set(r['pools']), D, M)
            line = re.search(r'deaths (\d+) \([^)]*over ([\d.]+) measured bot-h\) vs control (\d+) \([^)]*over ([\d.]+)\)', dec['note'])
            print('  %-16s %s +%d recorded: %s | recomputed: deaths %d / %.0f bh vs %d / %.0f bh, trips %s' % (
                r['run'], v, M, line.group(0) if line else '?', cd, cbh, kd, kbh, trips[:1] or 'none'))
            if sim.TR.tier_of(sim.reg(r['run']) or {}) == 2:
                ok, why = baseline(sim, set(r['pools']), D, max(240, M))
                print('      baseline recomputed at +%d: %s %s' % (M, 'CLEAN' if ok else 'NOT CLEAN', why[:120]))
    for var in sorted({r['variant'] for r in recs}):
        print('\n== %s' % var)
        for r in [x for x in recs if x['variant'] == var and (x['earlier'] or x['more'])]:
            run = r['run']; reg = sim.reg(run) or {}
            tier = sim.TR.tier_of(reg)
            D, (v, M), dec = recorded(sim, run)
            kt, _mk = sim.k_target(run)
            # an EARLIER draw is made at its first attempt, from the pools eligible THEN
            ve = r['variant_first_eligible'] if (r['earlier'] and r.get('variant_first_eligible')) else r['variant_eligible']
            cf = set(ve) if len(ve) <= kt else None
            Dc = (T(r['variant_first']) + dt.timedelta(minutes=5)) if r['earlier'] else D
            print('  %s (tier %d) recorded %s at +%s on %s, declared %s' % (run, tier, v, M, ','.join(r['pools']),
                                                                         ISO(D) if D else '?'))
            if cf is None:
                print('     counterfactual: %d eligible > %d: a RANDOM draw of %d -- the released pool(s) %s may or may '
                      'not be in it; analysed WITH them (worst case)' % (len(ve), kt, kt, sorted(r['released'])))
                cf = set(r['pools']) | set(r['released'])
            print('     counterfactual canary %s declared ~%s (%d pools); released %s' % (
                ','.join(sorted(cf)), ISO(Dc), len(cf), {p: '%s %s, %.0f min before the counterfactual declare' % (
                    x[0], x[1], (Dc - T(x[2])).total_seconds() / 60) for p, x in r['released'].items()}))
            if not M:
                print('     R4 REASONED: the run was closed by hand (%s); nothing to re-run' % v); continue
            # R1
            reads_to = [M] + ([180] if tier == 2 and len(cf) == 4 and M != 180 else [])
            for m in reads_to:
                ok, why = baseline(sim, cf, Dc, max(240, m))
                tag = '' if tier == 2 else ' (tier 3: no gate checks it -- R4 contamination if NOT CLEAN)'
                print('     R1 baseline at +%d (lookback %d): %s %s%s' % (m, max(240, m), 'CLEAN' if ok else 'NOT CLEAN',
                                                                         why[:110], tag))
                if tier == 2 and m == M and v == 'KEEP' and not ok:
                    print('     >>> FLIP: the recorded KEEP at +%d cannot be printed on this baseline -> read on / '
                          'INCONCLUSIVE at the final read' % M)
            # R2
            cd, kd, cbh, kbh, trips = death_polls(sim, cf, Dc, M)
            print('     R2 death gate to +%d: canary %d / %.0f bh vs control %d / %.0f bh; trips %s' % (
                M, cd, cbh, kd, kbh, trips[:1] or 'none'))
            if trips and v != 'REVERT':
                print('     >>> FLIP: the death gate trips at +%d on the counterfactual arms (recorded %s)' % (trips[0][0], v))
            # R3
            if tier == 2 and len(cf) == 4:
                try:
                    a = json.load(open(os.path.join(reads, '%s-verdict-180.json' % run)))
                except Exception:
                    a = None
                if a:
                    why = a.get('why') or []
                    watch = [w for w in why if w.startswith('WATCH')]
                    blocked = [w for w in why if ' fails ' in w and 'evidence=defect' not in w]
                    m_ex = next((re.search(r'exposure \S+ = (\S+)', w) for w in why if w.startswith('exposure ')), None)
                    exv = float(m_ex.group(1)) if m_ex else None
                    cd1, kd1, cbh1, kbh1, _t = death_polls(sim, cf, Dc, 180)
                    ok1, w1 = baseline(sim, cf, Dc, 240)
                    lic = (reg.get('licence') or {}).get('class')
                    k, kw = sim.TR.keep_early(reg, 4, False, 180, reg.get('read_minutes'), watch, blocked, [],
                                              reg.get('exposure'), exv, True, lic, cd1, cbh1, kd1, kbh1, ok1, w1)
                    print('     R3 REASONED +180 tier-2 KEEP with 4 pools: %s (%s)' % ('YES' if k else 'no', kw[:150]))
                    if k and v != 'KEEP':
                        print('     >>> FLIP (reasoned): a +180 KEEP where the run was recorded %s' % v)
                    elif k:
                        print('     (same verdict, KEEP 180 min earlier: saves ~%d min of lane)' % (M - 180))
            if tier != 2:
                print('     R4 REASONED: tier 3; the run\'s own reads on the added pool cannot be re-run')


if __name__ == '__main__':
    main(*sys.argv[1:6])
