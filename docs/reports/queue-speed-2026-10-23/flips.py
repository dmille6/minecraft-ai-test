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


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('snap'); ap.add_argument('scan'); ap.add_argument('hostmods'); ap.add_argument('patches')
    ap.add_argument('settle_json')
    ap.add_argument('--emit-queries', default=None, help='write every R1 baseline query (for hostbaseline.py)')
    ap.add_argument('--host-r1', default=None, help='R1 answers computed ON THE HOST by the gate\'s own loader')
    a = ap.parse_args()
    sim = drawsim.Sim(a.snap, a.scan, a.hostmods, a.patches)
    # the bundle's deathgate.py (md5 450d32bf = the live gate 635ad8d8's part), copied with ~/gate-v36
    sys.path.append(os.path.join(os.path.dirname(a.hostmods.rstrip('/')), 'gate-v36'))
    import deathgate
    sim.DG = deathgate
    host = json.load(open(a.host_r1)) if a.host_r1 else None
    queries = {}

    def r1(pools, D, L):
        """R1 -- EXACT when --host-r1 holds the host's answer (tierrule.load_buckets + asymmetric_rows on the host, the
        gate's own code path, Codex r1 P1); otherwise the 5-min-bucket approximation, labelled as such."""
        key = '%s|%s|%d' % (','.join(sorted(pools)), D.isoformat(), L)
        queries[key] = {'pools': sorted(pools), 'D': D.isoformat(), 'L': L}
        if host is not None and key in host:
            return host[key]['ok'], host[key]['why'], 'host'
        ok, why = baseline(sim, set(pools), D, L)
        return ok, why, 'approx'
    recs = [json.loads(l) for l in open(a.settle_json)]
    reads = os.path.join(a.snap, 'reads')
    print('== POSITIVE CONTROLS (actual arms, actual declared_at)')
    seen = set()
    for r in recs:
        if r.get('changed') and r['run'] not in seen:
            seen.add(r['run'])
            D, (v, M), dec = recorded(sim, r['run'])
            if not D or not M:
                print('  %-16s no scheduled verdict line (closed by hand): %s' % (r['run'], v)); continue
            cd, kd, cbh, kbh, trips = death_polls(sim, set(r['pools']), D, M)
            line = re.search(r'deaths (\d+) \([^)]*over ([\d.]+) measured bot-h\) vs control (\d+) \([^)]*over ([\d.]+)\)', dec['note'])
            print('  %-16s %s +%d recorded: %s | recomputed: deaths %d / %.0f bh vs %d / %.0f bh, trips %s' % (
                r['run'], v, M, line.group(0) if line else '?', cd, cbh, kd, kbh, trips[:1] or 'none'))
            if sim.TR.tier_of(sim.reg(r['run']) or {}) == 2:
                ok, why, src = r1(set(r['pools']), D, max(240, M))
                print('      baseline recomputed at +%d [%s]: %s %s' % (M, src, 'CLEAN' if ok else 'NOT CLEAN', why[:120]))
    summary = {}
    for var in sorted({r['variant'] for r in recs}):
        print('\n== %s' % var)
        flips, reasoned, conditional = [], [], []
        changed_windows = []          # (run, live from, live to) of every run this iteration changed so far
        for r in [x for x in recs if x['variant'] == var and x.get('changed')]:
            lv = [(d0, c0) for d0, c0, _p, rn in sim.live if rn == r['run']]
            if lv:
                s0 = T(r['variant_first']) if r.get('earlier') and r.get('variant_first') else lv[0][0]
                changed_windows.append((r['run'], min(s0, lv[0][0]), lv[0][1]))
            run = r['run']; reg = sim.reg(run) or {}
            tier = sim.TR.tier_of(reg)
            D, (v, M), dec = recorded(sim, run)
            cf = set(r['cf'])
            Dc = (T(r['variant_first']) + dt.timedelta(minutes=5)) if r['earlier'] else D
            print('  %s (tier %d) recorded %s at +%s on %s (%d pools), declared %s' % (
                run, tier, v, M, ','.join(r['pools']), len(r['pools']), ISO(D) if D else '?'))
            print('     counterfactual canary %s declared ~%s (%d pools)%s%s; released %s' % (
                ','.join(sorted(cf)), ISO(Dc), len(cf), ' -- ONE OF SEVERAL VALID DRAWS (released pools taken first)'
                if r.get('ambiguous') else '', ' -- CASCADE: lost %s' % r['cascade_lost'] if r.get('cascade_lost') else '',
                {p: '%s %s, %.0f min before' % (x[0], x[1], (Dc - T(x[2])).total_seconds() / 60) for p, x in r['released'].items()}))
            if r.get('short'):
                print('     >>> UNMODELLED: with %d pool(s) the run would have WAITED; its later draw and verdict are '
                      'unknown -- counted as REASONED' % len(cf))
                reasoned.append(run); continue
            if not M:
                print('     R4 REASONED: the run was closed by hand (%s); nothing to re-run' % v)
                reasoned.append(run); continue
            flipped = False
            # the tier-2 pool-count rule (tierrule.keep_early: EXACTLY 4 pools at +180) -- deterministic, no logs needed
            if tier == 2 and v == 'KEEP' and M == 180 and len(cf) != 4:
                print('     >>> FLIP (rule): recorded KEEP at +180 needs exactly 4 pools; the counterfactual has %d -> it '
                      'reads on to +360 (its verdict there is REASONED)' % len(cf))
                flipped = True
            # R1 -- it reads the REAL logs, so it describes the cascaded world only where no run the cascade changed
            # (or left unmodelled) was live inside the lookback (Claude r2 P1/P2): otherwise it is REASONED
            reads_to = [M] + ([180] if tier == 2 and len(cf) == 4 and M != 180 else [])
            for m in reads_to:
                L = max(240, m)
                w0, w1 = Dc - dt.timedelta(minutes=L), Dc
                blind = [c for c, s0, s1 in changed_windows if c != run and s0 < w1 and (s1 is None or s1 > w0)]
                ok, why, src = r1(cf, Dc, L)
                tag = '' if tier == 2 else ' (tier 3: no gate checks it; a dirty PRE here is a REASONED risk)'
                print('     R1 baseline at +%d (lookback %d) [%s]: %s %s%s%s' % (m, L, src,
                      'CLEAN' if ok else 'NOT CLEAN', why[:110], tag,
                      ' -- CASCADE-BLIND: %s changed inside this lookback, so the real logs are not this world\'s; '
                      'REASONED' % blind if blind else ''))
                if blind:
                    continue
                if tier == 2 and m == M and v == 'KEEP' and not ok:
                    print('     >>> FLIP: the recorded KEEP at +%d cannot be printed on this baseline -> read on / '
                          'INCONCLUSIVE at the final read' % M)
                    flipped = True
            # R2
            cd, kd, cbh, kbh, trips = death_polls(sim, cf, Dc, M)
            print('     R2 death gate to +%d (null effect on pools that did not run it): canary %d / %.0f bh vs control '
                  '%d / %.0f bh; trips %s' % (M, cd, cbh, kd, kbh, trips[:1] or 'none'))
            if trips and v != 'REVERT':
                print('     >>> FLIP: the death gate trips at +%d on the counterfactual arms (recorded %s)' % (trips[0][0], v))
                flipped = True
            # R3
            if tier == 2 and len(cf) == 4 and M != 180:
                try:
                    art = json.load(open(os.path.join(reads, '%s-verdict-180.json' % run)))
                except Exception:
                    art = None
                if art:
                    why = art.get('why') or []
                    watch = [w for w in why if w.startswith('WATCH')]
                    blocked = [w for w in why if ' fails ' in w and 'evidence=defect' not in w]
                    m_ex = next((re.search(r'exposure \S+ = (\S+)', w) for w in why if w.startswith('exposure ')), None)
                    exv = float(m_ex.group(1)) if m_ex else None
                    cd1, kd1, cbh1, kbh1, _t = death_polls(sim, cf, Dc, 180)
                    ok1, w1, _src = r1(cf, Dc, 240)
                    lic = (reg.get('licence') or {}).get('class')
                    k, kw = sim.TR.keep_early(reg, 4, False, 180, reg.get('read_minutes'), watch, blocked, [],
                                              reg.get('exposure'), exv, True, lic, cd1, cbh1, kd1, kbh1, ok1, w1)
                    print('     R3 REASONED +180 tier-2 KEEP with 4 pools: %s (%s)' % ('YES' if k else 'no', kw[:150]))
                    if k and v != 'KEEP':
                        print('     >>> FLIP (reasoned): a +180 KEEP where the run was recorded %s' % v)
                        flipped = True
            if flipped and r.get('conditional_on'):
                print('     ... CONDITIONAL flip: it assumes %s (unmodelled) ran as recorded' % r['conditional_on'])
                conditional.append(run)
            elif flipped:
                flips.append(run)
            else:
                reasoned.append(run)
                print('     no re-runnable flip; the verdict on the pools that never ran this canary is REASONED')
        summary[var] = (flips, reasoned, conditional)
    print('\n== SUMMARY (per iteration: flips found by a re-runnable check | changed verdicts that are reasoned only)')
    for var, (f, rz, cd) in summary.items():
        print('  %-62s flips %d %s | conditional flips %d %s | reasoned %d %s' % (var[:62], len(f), f, len(cd), cd, len(rz), rz))
    if a.emit_queries:
        json.dump(queries, open(a.emit_queries, 'w'), indent=0)
        print('wrote %d R1 queries to %s' % (len(queries), a.emit_queries))


if __name__ == '__main__':
    main()
