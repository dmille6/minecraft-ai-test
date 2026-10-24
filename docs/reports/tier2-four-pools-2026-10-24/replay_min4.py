#!/usr/bin/env python3
"""replay_min4.py <snapshot> <scan.jsonl> <host ~/mcai-analysis copy> <queue-speed patches dir> [--emit-queries F]
[--host-r1 F] -- READ-ONLY (copies on the Mac). The rule "a tier-2 run draws exactly 4 pools or waits" replayed over
every tier-2 draw since gate v36 (10-19 16:27Z; no registration carried a tier before it, so 10-12..10-19 has none).

For each tier-2 run that drew fewer than 4 pools: today's rule (drawsim.py, the queue-speed reconstruction whose
positive control reproduced 27/34 draws) is re-drawn every 22 min (the loop's 1200-s sleep + drawrec) from the actual
draw instant until the eligible set holds 4 pools (with draw_require_pools satisfied), up to the proposed 12-h bound,
and on past it (to the scan's end) only to say how long the wait would really have been.

Then, for the counterfactual 4-pool draw (the actual pools still eligible first, then the others in name order;
flagged when it is one of several valid draws):
  R1 the v36 baseline on the HOST with the gate's own code (hostbaseline.py), at the +180 (240) and +360 lookbacks;
  R2 the death gate (deathgate.death_gate) at every 5-min poll to the recorded deciding read;
  R3 tierrule.keep_early at +180 with 4 pools and the recorded +180 artifact's lines -- REASONED;
and both R1 and R2 are CASCADE-BLIND -- reasoned, not re-run -- where the counterfactual window overlaps the run's own
actual canary period on a shared pool (the real logs there hold the canary that, in this world, had not started).
The lane cost is first-order: each wait pushes every later run by the same amount (the lane is serial), a +180 KEEP
pulls the lane forward by (deciding read - 180) min; later draws are NOT re-simulated against the shifted world."""
import argparse, datetime as dt, json, os, re, sys

QS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'queue-speed-2026-10-23')
sys.path.insert(0, os.path.normpath(QS))
import drawsim, flips

T, ISO = drawsim.T, drawsim.ISO
BOUND_H = 12
STEP = dt.timedelta(minutes=22)


def grid(t):
    return t.replace(second=0, microsecond=0) - dt.timedelta(minutes=t.minute % 5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('snap'); ap.add_argument('scan'); ap.add_argument('hostmods'); ap.add_argument('patches')
    ap.add_argument('--emit-queries'); ap.add_argument('--host-r1')
    a = ap.parse_args()
    sim = drawsim.Sim(a.snap, a.scan, a.hostmods, a.patches)
    sys.path.append(os.path.join(a.snap, 'gate-v36'))
    import deathgate
    sim.DG = deathgate
    end = sim.A + dt.timedelta(seconds=sim.BS * (1 + max(max(b) for b in sim.B.values() if b)))
    host = json.load(open(a.host_r1)) if a.host_r1 else None
    queries = {}
    print('scan %d rows to %s' % (sim.total['rows'], ISO(end)))

    def r1(pools, D, L):
        key = '%s|%s|%d' % (','.join(sorted(pools)), D.isoformat(), L)
        queries[key] = {'pools': sorted(pools), 'D': D.isoformat(), 'L': L}
        if host is not None and key in host:
            return host[key]['ok'], host[key]['why'], 'host'
        ok, why = flips.baseline(sim, set(pools), D, L)
        return ok, why, 'approx'
    rows = []
    for run, rs in sim.runs.items():
        reg = sim.reg(run) or {}
        dn = [r for r in rs if r['phase'] == 'drawn']
        d0 = [r for r in rs if r['phase'] == 'draw']
        if not dn or not d0 or sim.TR.tier_of(reg) != 2 or T(dn[0]['ts']) < drawsim.V36:
            continue
        pools = sorted(str(dn[0]['note']).split(' ::')[0].split(','))
        rows.append((T(dn[0]['ts']), run, pools, T(d0[0]['ts']), reg))
    rows.sort()
    total_wait = total_saved = 0.0
    lower_bound_runs = []
    print('\n%-15s %-6s %-34s %-12s %-12s %s' % ('run', 'drew', 'actual pools', 'actual draw', '4-pool draw', 'wait'))
    for drawn_at, run, pools, start, reg in rows:
        D, (v, M), dec = flips.recorded(sim, run)
        if len(pools) >= 4:
            print('%-15s %-6d %-34s %-12s %-12s 0 (already 4)  recorded %s +%s' % (run, len(pools), ','.join(pools),
                                                                               ISO(drawn_at), '-', v, M))
            continue
        # THE FAITHFUL WINDOW. In this world the run did not deploy at its draw; it waits. Until its ACTUAL close the
        # real fleet is the waiting world, except on the run's own pools (which in reality ran its canary): those are
        # taken as still eligible, as they were at the draw (stated assumption). At the actual close the real fleet
        # changes (a promotion restarts every pool; the next run deploys) and the waiting world can no longer be read
        # from the logs -- a wait not found by then is reported as AT LEAST the window, never guessed past it.
        lv0 = [(d0_, c0) for d0_, c0, ps, rn in sim.live if rn == run]
        close = lv0[0][1] if lv0 and lv0[0][1] else end
        t = grid(drawn_at - dt.timedelta(minutes=2))
        first, el = None, []
        while t < min(close, end):
            e, info = sim.eligible(t, run)
            e = sorted(set(e) | set(pools))         # its own pools: eligible at the draw, unchanged while it waits
            if len(e) >= 4:
                first, el = t, e; break
            t += STEP
        t0 = grid(drawn_at - dt.timedelta(minutes=2))
        _e0, info0 = sim.eligible(t0, run)
        alw = info0.get('allowed')
        print('  [%s] at its draw: draw_exposure allows %s; draw_require %s' % (run,
            'any pool (none declared)' if alw is None else '%d pool(s) %s%s' % (len(alw), alw,
            ' -> R10 for tier 2 (>= 4 exposure pools) would have WAITED in the scheduler' if len(alw) < 4 else ''),
            reg.get('draw_require_pools') or '-'))
        window_h = (min(close, end) - t0).total_seconds() / 3600
        wait_h = (first - t0).total_seconds() / 3600 if first else None
        tag = ('%.1f h' % wait_h) if first else '>= %.1f h (no 4th pool before its actual close; unknowable after)' % window_h
        if first and wait_h > BOUND_H:
            tag += '  >>> PAST THE 12-h BOUND: the loop would have refused at +12 h'
        if not first and window_h >= BOUND_H:
            tag += '  >>> REACHES THE 12-h BOUND: the loop refuses (no deploy; a human re-registers tier 3 or rearms)'
        print('%-15s %-6d %-34s %-12s %-12s %s  recorded %s +%s' % (run, len(pools), ','.join(pools), ISO(drawn_at),
                                                                   ISO(first) if first else '-', tag, v, M))
        if not first:
            total_wait += min(window_h, BOUND_H)
            lower_bound_runs.append(run)
            continue
        keep = [p for p in pools if p in el]
        cf = sorted((keep + [p for p in sorted(el) if p not in keep])[:4])
        Dc = first + dt.timedelta(minutes=5)
        lv = [(d0_, c0) for d0_, c0, ps, rn in sim.live if rn == run]
        own = lv[0] if lv else (None, None)
        print('     4-pool counterfactual %s declared ~%s%s' % (','.join(cf), ISO(Dc),
              ' (one of %d valid draws)' % len(el) if len(el) > 4 else ''))
        shared = set(cf) & set(pools)
        for m in sorted({180, M or 360}):
            L = max(240, m)
            w0, w1 = Dc - dt.timedelta(minutes=L), Dc
            blind = shared and own[0] and own[0] < w1 and (own[1] is None or own[1] > w0)
            ok, why, src = r1(cf, Dc, L)
            print('     R1 baseline +%d (lookback %d) [%s]: %s %s%s' % (m, L, src, 'CLEAN' if ok else 'NOT CLEAN', why[:100],
                  ' -- CASCADE-BLIND: the run\'s own canary on %s is inside this lookback; REASONED' % sorted(shared) if blind else ''))
        if M:
            w0, w1 = Dc, Dc + dt.timedelta(minutes=M)
            blind2 = shared and own[0] and own[0] < w1 and (own[1] is None or own[1] > w0)
            if w1 > end:
                print('     R2 death gate: the window ends after the scan (%s): not run' % ISO(w1))
            else:
                cd, kd, cbh, kbh, trips = flips.death_polls(sim, set(cf), Dc, M)
                print('     R2 death gate to +%d: canary %d / %.0f bh vs control %d / %.0f bh; trips %s%s' % (
                    M, cd, cbh, kd, kbh, trips[:1] or 'none',
                    ' -- CASCADE-BLIND (own canary period overlaps on %s): REASONED' % sorted(shared) if blind2 else ''))
        art = None
        try:
            art = json.load(open(os.path.join(a.snap, 'reads', '%s-verdict-180.json' % run)))
        except Exception:
            pass
        saved = 0.0
        if art and M and M > 180:
            why = art.get('why') or []
            watch = [w for w in why if w.startswith('WATCH')]
            blocked = [w for w in why if ' fails ' in w and 'evidence=defect' not in w]
            m_ex = next((re.search(r'exposure \S+ = (\S+)', w) for w in why if w.startswith('exposure ')), None)
            exv = float(m_ex.group(1)) if m_ex else None
            if Dc + dt.timedelta(minutes=180) <= end:
                cd1, kd1, cbh1, kbh1, _t = flips.death_polls(sim, set(cf), Dc, 180)
            else:
                cd1, kd1, cbh1, kbh1 = 0, 0, 60.0, 180.0
            ok1, w1, _s = r1(cf, Dc, 240)
            if shared and own[0] and own[0] < Dc:
                # the logs hold the run's own canary on its pools before Dc, which in this world did not run: the
                # baseline input is unknowable; R3 takes it as CLEAN (the most KEEP-favouring reading, so a "no" here
                # is a "no" for another reason)
                ok1, w1 = True, 'assumed clean (cascade-blind)'
            lic = (reg.get('licence') or {}).get('class')
            k, kw = sim.TR.keep_early(reg, 4, False, 180, reg.get('read_minutes'), watch, blocked, [], reg.get('exposure'),
                                      exv, True, lic, cd1, cbh1, kd1, kbh1, ok1, w1)
            print('     R3 REASONED +180 KEEP with 4 pools: %s (%s)' % ('YES' if k else 'no', kw[:140]))
            if k and v == 'KEEP':
                saved = (M - 180) / 60.0
                print('     -> the same KEEP %.1f h sooner after its draw' % saved)
            elif k and v != 'KEEP':
                print('     >>> a +180 KEEP where the run was recorded %s: REASONED (pools that never ran it)' % v)
        total_wait += wait_h
        total_saved += saved
    print('\nfirst-order lane effect: waits >= +%.1f h (%s only lower bounds, each capped at the 12-h bound), earlier '
          'KEEPs -%.1f h (reasoned), net >= %+.1f h; later draws not re-simulated'
          % (total_wait, ', '.join(lower_bound_runs) or 'none', total_saved, total_wait - total_saved))
    if a.emit_queries:
        json.dump(queries, open(a.emit_queries, 'w'))


if __name__ == '__main__':
    main()
