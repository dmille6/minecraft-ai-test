#!/usr/bin/env python3
"""ugsafe2_fatal.py <an.pkl> <rowsdir> [WINDOW,...]  -- inside every FATAL drowning episode: was there a route up
(the rescue's own `_drowning_route` verdicts), did the bot move, what owned the body, the health timeline after air ran
out, and the bag. Positive control: the same tabulation over SURVIVED sealed episodes."""
import sys, os, re, pickle, bisect
from collections import Counter, defaultdict
sys.argv, ARGS = sys.argv[:2], sys.argv[2:]
import ugsafe2_report as R  # noqa
from ugsafe2_extract import F_T, F_KIND, F_DETAIL, F_Y, F_X, F_Z, F_HP, F_STATUS, F_DUR, F_ARGS

ROWS = ARGS[0]
WINS = (ARGS[1] if len(ARGS) > 1 else 'P1,MID,POST').split(',')
ROUTE = re.compile(r'^(\w+) dist=(-?\d+)')
HPRX = re.compile(r'oxygen (-?\d+), health ([\d.]+)')
cache = {}


def rows_of(bot):
    if bot not in cache:
        cache.clear()
        cache[bot] = pickle.load(open(os.path.join(ROWS, bot + '.pkl'), 'rb'))['rows']
    return cache[bot]


def inspect(bot, t0, t1):
    rows = rows_of(bot); ts = [r[F_T] for r in rows]
    lo, hi = bisect.bisect_left(ts, t0 - 5), bisect.bisect_right(ts, t1 + 1)
    out = {'routes': Counter(), 'updist': [], 'bubble': 0, 'travel_unint': 0, 'skills': Counter(), 'rung': Counter(),
           'ceil': [], 'ys': [], 'xz': [], 'heads': Counter(), 'lowhealth': 0, 'yield': 0}
    for r in rows[lo:hi]:
        k, d = r[F_KIND], r[F_DETAIL] or ''
        if r[F_Y] is not None: out['ys'].append(r[F_Y]); out['xz'].append((r[F_X], r[F_Z]))
        if k == '_drowning_route':
            m = ROUTE.match(d)
            if m:
                out['routes'][m.group(1)] += 1
                if m.group(1) == 'up': out['updist'].append(int(m.group(2)))
        elif k == '_reflex_danger_block' and 'bubble' in d: out['bubble'] += 1
        elif k == '_water_travel_uninterrupted': out['travel_unint'] += 1
        elif k == '_flooded_pocket_rung': out['rung'][d.split(':')[0] + (':' + d.split(':')[1][:30] if ':' in d else '')] += 1
        elif k == '_drowning_ceiling_no_air':
            m = HPRX.search(d)
            if m: out['ceil'].append((r[F_T], int(m.group(1)), float(m.group(2))))
        elif k in ('_air_drowning_observed', '_reflex_drowning'):
            m = re.search(r'head block (\w+)', d)
            if m: out['heads'][m.group(1)] += 1
        elif k == '_reflex_low_health': out['lowhealth'] += 1
        elif k == '_drowning_rescue_yielded': out['yield'] += 1
        elif not k.startswith('_'):
            out['skills'][k] += 1
    return out


for W in WINS:
    ds = [d for d in R.dwin(W) if d['cause'] == 'drowning' and d['episode']]
    surv = [e for e in R.A['episodes'] if R.inwin(e['start'], W) and e['sealed'] and not e['fatal']]
    print(f'\n######## {W}: fatal drowning episodes {len(ds)}; survived sealed episodes {len(surv)}')
    agg = Counter(); slopes = []; t_air0_death = []; moved = Counter()
    upd = Counter(); heads = Counter(); skills = Counter(); rung = Counter()
    for d in sorted(ds, key=lambda d: d['bot']):
        ep = d['episode']
        o = inspect(d['bot'], ep['start'], d['t'])
        cls = 'route_up' if o['routes']['up'] else ('sealed_only' if o['routes'] else 'no_route_row')
        agg[cls] += 1
        if o['updist']: upd[min(o['updist'])] += 1
        if o['bubble']: agg['bubble_column_seen'] += 1
        if o['travel_unint']: agg['skill_owned_not_seized'] += 1
        heads.update(o['heads']); skills.update(o['skills']); rung.update(o['rung'])
        ys = o['ys']
        rng = (max(ys) - min(ys)) if ys else None
        xz = [p for p in o['xz'] if p[0] is not None]
        hmove = max(((a[0]-b[0])**2 + (a[1]-b[1])**2) ** .5 for a in xz for b in xz[:1]) if xz else None
        moved['y range <1' if rng is not None and rng < 1 else 'y range >=1'] += 1
        moved['horiz <2' if hmove is not None and hmove < 2 else 'horiz >=2'] += 1
        c0 = [c for c in o['ceil'] if c[1] <= 0]
        if c0:
            t0, _, h0 = c0[0]
            if d['t'] - t0 > 5:
                slopes.append(h0 / (d['t'] - t0))
                t_air0_death.append(d['t'] - t0)
    n = len(ds)
    print('  route verdicts in the episode:', dict(agg))
    print('  smallest up dist when a route up was reported:', dict(sorted(upd.items())))
    print('  y moved during episode:', dict(moved))
    print('  head block when observed:', dict(heads.most_common(6)))
    print('  skill rows inside fatal episodes:', dict(skills.most_common(8)))
    print('  rung rows:', dict(rung.most_common(6)))
    if slopes:
        slopes.sort(); t_air0_death.sort()
        q = lambda v, p: v[min(len(v) - 1, int(p * len(v)))]
        print(f'  first ceiling at oxygen<=0 -> death: n={len(t_air0_death)} p10 {q(t_air0_death,.1):.0f}s median {q(t_air0_death,.5):.0f}s p90 {q(t_air0_death,.9):.0f}s;'
              f' AVERAGE HP/s (health at that ceiling / seconds to death; not a live slope) median {q(slopes,.5):.2f} p10 {q(slopes,.1):.2f} p90 {q(slopes,.9):.2f}')
    # positive control: same verdicts in survived sealed episodes
    sagg = Counter()
    for e in surv:
        o = inspect(e['bot'], e['start'], e['end'])
        sagg['route_up' if o['routes']['up'] else ('sealed_only' if o['routes'] else 'no_route_row')] += 1
        if o['bubble']: sagg['bubble_column_seen'] += 1
    print('  POSITIVE CONTROL survived sealed episodes, route verdicts:', dict(sagg))
