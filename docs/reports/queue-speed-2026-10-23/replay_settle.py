#!/usr/bin/env python3
"""replay_settle.py <snapshot> <scan.jsonl> <host ~/mcai-analysis copy> <patches dir> [--since ISO] [--json F]

DESIGN 1 replay. READ-ONLY (copies on the Mac). For every run that drew since --since (default 10-12 00:00Z):
  1. POSITIVE CONTROL: today's rule, re-drawn at the instant the loop drew (2 min before its `drawn` row, on the 5-min
     grid). A draw of fewer than 4 pools must EQUAL the reconstructed eligible set; a 4-pool draw must be inside it.
  2. Each ITERATION re-draws at every attempt the loop made (1 min after `draw`, then every 22 min: sleep 1200 s +
     drawrec's ~2 min) and at the actual draw instant, and is compared with TODAY'S RULE RE-DRAWN THE SAME WAY -- never
     with the actual draw, so the reconstruction's own band noise (section 2.2) cancels. A draw CHANGES when the
     iteration would have drawn at an earlier attempt, or more pools at the same instant, than today's rule.
Every pool the settle path released is listed with its predecessor, how it closed, and the minutes since that close."""
import argparse, collections, datetime as dt, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawsim

T, ISO = drawsim.T, drawsim.ISO


def grid(t):
    return t.replace(second=0, microsecond=0) - dt.timedelta(minutes=t.minute % 5)


def draws(sim, since):
    out = []
    for run, rs in sim.runs.items():
        d = [r for r in rs if r['phase'] == 'draw']
        dn = [r for r in rs if r['phase'] == 'drawn']
        if not d or not dn or T(dn[0]['ts']) < since:
            continue
        pools = str(dn[0]['note']).split(' ::')[0].split(',')
        out.append({'run': run, 'start': T(d[0]['ts']), 'drawn': T(dn[0]['ts']), 'pools': sorted(pools)})
    return sorted(out, key=lambda x: x['drawn'])


def attempts(x):
    t = x['start'] + dt.timedelta(minutes=1)
    out = []
    while t < x['drawn'] - dt.timedelta(minutes=3):
        out.append(grid(t)); t += dt.timedelta(minutes=22)
    out.append(grid(x['drawn'] - dt.timedelta(minutes=2)))
    return out


# --------------------------------------------------------------------------------- the design iterations --
# the fixed pre-windows of the period's read scripts (grep of /tmp/*read*.py on the host, 10-23): homefixread,
# homefix2read and protectzoneread PRE_H = 24; lidclearread and cobblekeepread EXPOSURE_PRE_H = 12; every other read
# script in these registrations takes PRE = CUT - W (immobiledid PRE 180 + 60 trailing). The replay DECLARES these as
# each run's settle.lookback_min, as its author would have to.
LOOKBACK = {'homefix-01': 1440, 'homefix-02': 1440, 'protectzone-01': 1440, 'lidclear-01': 720, 'cobblekeep-01': 720}


def _all_reads(reg):
    """I1: the floor covers EVERY read the loop can take, extensions included (capped: > 720 = no settle release)."""
    m = list(reg.get('read_minutes') or [])
    ext = reg.get('extension') or {}
    if ext.get('until_exposure'):
        m += list(ext.get('extra_reads') or [])
    L = max([240] + m)
    cell = L if L <= 720 else None
    return {2: {'keep-promoted': cell, 'inconclusive': cell, 'revert': cell},
            3: {'keep-promoted': cell, 'inconclusive': cell, 'revert': cell}}


# I2: exactly today's timers (drawsteady.candidates / tierrule.hold_t2), only the build test is the symmetric one
TODAY_TIMERS = {2: {'keep-promoted': {2: 240, 3: 360}, 'inconclusive': {2: 240, 3: None}, 'revert': {2: 240, 3: None}},
                3: {'keep-promoted': 360, 'inconclusive': None, 'revert': None}}
I3 = {2: {'keep-promoted': {2: 240, 3: 360}, 'inconclusive': 240, 'revert': 240},
      3: {'keep-promoted': 360, 'inconclusive': 360, 'revert': 360}}
I4 = {2: {'keep-promoted': 240, 'inconclusive': 240, 'revert': 240},
      3: {'keep-promoted': 360, 'inconclusive': 360, 'revert': 360}}


def variants():
    return collections.OrderedDict([
        ('I1 floor = every read incl. extensions', {'table': _all_reads, 'lookback': LOOKBACK}),
        ("I2 today's timers + symmetric build test", {'table': TODAY_TIMERS, 'lookback': LOOKBACK}),
        ('I3 I2 + INCONCLUSIVE / non-death REVERT at 240 (t2) / 360 (t3)', {'table': I3, 'lookback': LOOKBACK}),
        ('I4 I3 + tier-2 incoming after a tier-3 KEEP at 240', {'table': I4, 'lookback': LOOKBACK}),
        # TIGHTENED after I2-I4's flips (all on tier-2 runs, through the v36 baseline): the settle path for TIER-3
        # incoming runs only; a tier-2 draw keeps exactly today's release
        ("I8 I2 for tier-3 incoming only", {'table': {2: {}, 3: TODAY_TIMERS[3]}, 'lookback': LOOKBACK}),
        ("I9 I3 for tier-3 incoming only", {'table': {2: {}, 3: I3[3]}, 'lookback': LOOKBACK}),
        # the bag band's reference: every settled pool except the candidate and its own decision's pools (S3'),
        # instead of "no decision in 12 h" -- which back-to-back 4-pool runs leave at 2-3 pools
        ("I5 I2 + siblings-out bag reference", {'table': TODAY_TIMERS, 'lookback': LOOKBACK, 'controls': 'siblings-out'}),
        ('I6 I3 + siblings-out bag reference', {'table': I3, 'lookback': LOOKBACK, 'controls': 'siblings-out'}),
        ('I7 I4 + siblings-out bag reference', {'table': I4, 'lookback': LOOKBACK, 'controls': 'siblings-out'}),
    ])


def walk(sim, x, rule):
    """-> (first attempt that draws or None, its eligible, settle releases there, eligible at the actual instant,
    settle releases there)."""
    kt, mk = sim.k_target(x['run'])
    first = None
    for t in attempts(x):
        e, _info = sim.eligible(t, x['run'], rule)
        if len(e) >= mk:
            first = (t, e, dict(getattr(sim, 'last_settle', {}) if rule != 'today' else {})); break
    t_act = grid(x['drawn'] - dt.timedelta(minutes=2))
    e_act, info_act = sim.eligible(t_act, x['run'], rule)
    rel = dict(getattr(sim, 'last_settle', {})) if rule != 'today' else {}
    return first, e_act, rel, info_act


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('snap'); ap.add_argument('scan'); ap.add_argument('hostmods'); ap.add_argument('patches')
    ap.add_argument('--since', default='2026-10-12T00:00:00Z')
    ap.add_argument('--json', default=None)
    ap.add_argument('--only', default=None, help='comma-separated iteration prefixes (I1,I2,...)')
    a = ap.parse_args()
    sim = drawsim.Sim(a.snap, a.scan, a.hostmods, a.patches)
    print('scan: %d rows, %d bots, from %s' % (sim.total['rows'], sim.total['bots_with_rows'], sim.A.isoformat()))
    D = draws(sim, T(a.since))
    print("\n== POSITIVE CONTROL: today's rule re-drawn at each actual draw (%d draws)" % len(D))
    ok, base = 0, {}
    for x in D:
        t = grid(x['drawn'] - dt.timedelta(minutes=2))
        e, info = sim.eligible(t, x['run'])
        kt, _mk = sim.k_target(x['run'])
        n = len(x['pools'])
        match = (set(e) == set(x['pools'])) if n < min(4, kt) else set(x['pools']) <= set(e)
        ok += match
        print('%-3s %-16s %s drew %-38s recon %s%s' % ('OK' if match else 'XX', x['run'], ISO(t), ','.join(x['pools']),
              ','.join(e) or '-', '' if match else '  | median %s band %s' % (info['median'], info['band'])))
        base[x['run']] = walk(sim, x, 'today')
    print('CONTROL: %d of %d draws reproduced' % (ok, len(D)))
    out = []
    for name, rule in variants().items():
        if a.only and not any(name.startswith(o) for o in a.only.split(',')):
            continue
        print('\n== %s' % name)
        nch = 0
        for x in D:
            kt, mk = sim.k_target(x['run'])
            f0, e0, _r0, _i0 = base[x['run']]
            f1, e1, rel, info = walk(sim, x, rule)
            n0, n1 = min(kt, len(e0)), min(kt, len(e1))
            earlier = f1 is not None and (f0 is None or f1[0] < f0[0])
            more = n1 > n0
            rels = dict(f1[2]) if (earlier and f1) else {}
            rels.update(rel)
            rec = {'variant': name, 'run': x['run'], 'start': x['start'].isoformat(), 'drawn': x['drawn'].isoformat(),
                   'pools': x['pools'], 'today_first': f0[0].isoformat() if f0 else None,
                   'variant_first': f1[0].isoformat() if f1 else None, 'today_n': n0, 'variant_n': n1,
                   'today_eligible': e0, 'variant_eligible': e1, 'earlier': earlier, 'more': more,
                   'variant_first_eligible': f1[1] if f1 else None,
                   'released': {p: [c[0], c[4], c[3].isoformat(), c[5]] for p, c in rels.items()},
                   'settle_notes': [n for n in info['notes'] if n.startswith('settle')]}
            out.append(rec)
            if earlier or more:
                nch += 1
                print('  CHANGED %-16s today-recon: first %s, %d pools at the draw | %s: first %s, %d pools %s | released %s'
                      % (x['run'], ISO(f0[0]) if f0 else 'NONE', n0, name.split()[0], ISO(f1[0]) if f1 else 'NONE', n1,
                         ','.join(e1), {p: '%s %s %s floor %d' % (v[0], v[1], v[2][5:16], v[3]) for p, v in rec['released'].items()}))
            elif rels:
                print('  (released, no change) %-16s %s' % (x['run'], sorted(rels)))
        print('  %d of %d draws changed' % (nch, len(D)))
    if a.json:
        with open(a.json, 'w') as f:
            for r in out:
                f.write(json.dumps(r) + '\n')


if __name__ == '__main__':
    main()
