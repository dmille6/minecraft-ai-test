#!/usr/bin/env python3
"""ugsafe2_report.py <an.pkl>  -- windows, rates and breakdowns for underground safety phase 2 (2026-10-07).

Windows (UTC). Outage gaps are EXCLUDED: 10-06 17:07-19:50 and 10-07 05:01-11:53.
  P1    10-02 17:00 -> 10-05 17:15   phase 1's 72 h (positive control: phase 1 reported 192 deaths 109/39/36/8,
                                      5,759 bot-h, 1,412 underground bot-h, 117 climb->water hits)
  MID   10-05 17:15 -> 10-06 21:01   pre-promotion, climbflood canaries on 10-15 bots part of it
  POST  10-06 21:01 -> END            climbflood-02 fleet-wide (c902d6f, then c6e91a8 from 10-07 12:12)
Rates: per 100 underground bot-hours (y < 56), as phase 1.
"""
import sys, pickle, datetime as dt, math
from collections import Counter, defaultdict

E = lambda s: dt.datetime.fromisoformat(s + '+00:00').timestamp()
BIN = 300
OUT = [(E('2026-10-06T17:07:00'), E('2026-10-06T19:50:00')), (E('2026-10-07T05:01:00'), E('2026-10-07T11:53:00'))]
A = pickle.load(open(sys.argv[1], 'rb'))
END = max(max(b) for b in A['bins'].values() if b) * BIN + BIN
WIN = {'P1': (E('2026-10-02T17:00:00'), E('2026-10-05T17:15:00')),
       'MID': (E('2026-10-05T17:15:00'), E('2026-10-06T21:01:00')),
       'POST': (E('2026-10-06T21:01:00'), END)}


def inwin(t, w):
    a, b = WIN[w]
    return a <= t < b and not any(x <= t < y for x, y in OUT)


def agg(w, bots=None, binpred=None):
    c = Counter()
    for bot, bins in A['bins'].items():
        if bots is not None and bot not in bots: continue
        for b, cnt in bins.items():
            t = b * BIN
            if not inwin(t, w): continue
            if binpred and not binpred(bot, b): continue
            c.update(cnt)
    return c


def pct(n, d): return 100.0 * n / d if d else float('nan')


def poisson_ci(k, conf=0.95):
    # exact Garwood interval via chi-square quantiles approximated with Wilson-Hilferty
    from math import sqrt
    def chi2q(p, df):
        if df <= 0: return 0.0
        z = {0.025: -1.959964, 0.975: 1.959964}[p]
        return df * (1 - 2 / (9 * df) + z * sqrt(2 / (9 * df))) ** 3
    lo = 0.0 if k == 0 else chi2q(0.025, 2 * k) / 2
    hi = chi2q(0.975, 2 * k + 2) / 2
    return lo, hi


def dwin(w):
    return [d for d in A['deaths'] if inwin(d['t'], w)]


print('rows walked', A['rows'], 'bots', len(A['bins']), 'deaths (all)', len(A['deaths']), 'episodes', len(A['episodes']))
for w in WIN:
    c = agg(w)
    ds = dwin(w)
    h, ug = c['sec'] / 3600, c['ug'] / 3600
    print(f"\n=== {w} {dt.datetime.utcfromtimestamp(WIN[w][0]):%m-%d %H:%M} -> {dt.datetime.utcfromtimestamp(WIN[w][1]):%m-%d %H:%M}"
          f"  bot-h {h:.1f}  underground bot-h {ug:.1f} ({pct(ug, h):.1f}%)  deep(<0) bot-h {c['bneg']/3600:.1f}")
    cc = Counter(d['cause'] for d in ds)
    print('  deaths', len(ds), dict(cc), ' underground deaths', sum(1 for d in ds if d['y'] is not None and d['y'] < 56))
    for cause in ('drowning', 'lava', 'fall', 'suffocation', 'other'):
        k = cc[cause]; lo, hi = poisson_ci(k)
        print(f"   {cause:12s} {k:4d}  per 100 ug bot-h {100*k/ug:6.2f}  (95% {100*lo/ug:.2f}-{100*hi/ug:.2f})  per 100 bot-h {100*k/h:.2f}")
    k = len(ds); lo, hi = poisson_ci(k)
    print(f"   {'ALL':12s} {k:4d}  per 100 ug bot-h {100*k/ug:6.2f}  (95% {100*lo/ug:.2f}-{100*hi/ug:.2f})  per 100 bot-h {100*k/h:.2f}")
    eps = [e for e in A['episodes'] if inwin(e['start'], w)]   # exact start times (bins are only 5-min resolution)
    c['wep'], c['wep_crit'], c['wep_sealed'], c['wep_fatal'] = len(eps), sum(e['crit'] for e in eps), sum(e['sealed'] for e in eps), sum(e['fatal'] for e in eps)
    print(f"  water episodes {c['wep']}  critical {c['wep_crit']}  sealed {c['wep_sealed']}  fatal {c['wep_fatal']}"
          f"  | per 100 ug bot-h: crit {100*c['wep_crit']/ug:.1f} sealed {100*c['wep_sealed']/ug:.1f}")
    print(f"  climbs {c['climb']} (ug {c['climb_ug']})  dry->water within 20 s {c['climb_hit']}  sealed {c['climb_hit_sealed']}  fatal {c['climb_hit_fatal']}"
          f"  | per 1000 climbs {1000*c['climb_hit']/max(c['climb'],1):.2f}")
    print(f"  climbflood rows: guard {c['_climb_flood_guard']} refused {c['_climb_flood_refused']} breach {c['_climb_flood_breach']}")
    print(f"  lava rows: corridor {c['_lava_corridor']} danger_block(lava) {c['_reflex_danger_block']} no_retreat {c['_lava_adjacent_no_retreat']} blind_step {c['_explore_blind_step_refused']}")
    print(f"  mine rows {c['mine']} ({c['mine']/h:.2f}/bot-h; ug {c['mine_ug']})  ore_tunnel {c['ore_tunnel']}  gather {c['gather']} (ug {c['gather_ug']})  explore {c['explore']} (deep {c['explore_deep']})")
    print(f"  items gained {c['gained']:.0f} ({c['gained']/h:.1f}/bot-h)  lost at death {c['lost_items']:.0f}  iron picks lost {c['lost_ironpick']}")
    print('  bot-h by band:', {k: round(c[k] / 3600, 1) for k in ('b63', 'b55', 'b40', 'b16', 'b0', 'bneg')})
    # death rate by band x cause
    bandof = lambda y: 'b63' if y >= 63 else 'b55' if y >= 55 else 'b40' if y >= 40 else 'b16' if y >= 16 else 'b0' if y >= 0 else 'bneg'
    tab = defaultdict(Counter)
    for d in ds:
        if d['y'] is not None: tab[bandof(d['y'])][d['cause']] += 1
    print('  per 100 bot-h in band (deaths):')
    for bnd in ('b63', 'b55', 'b40', 'b16', 'b0', 'bneg'):
        bh = c[bnd] / 3600
        row = tab[bnd]
        print(f"    {bnd:5s} bot-h {bh:7.1f}  " + '  '.join(f"{cs} {row[cs]:3d} ({100*row[cs]/bh if bh else float('nan'):5.2f})" for cs in ('drowning', 'lava', 'fall', 'suffocation')))
