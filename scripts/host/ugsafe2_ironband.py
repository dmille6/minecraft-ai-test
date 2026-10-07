#!/usr/bin/env python3
"""ugsafe2_ironband.py <rowsdir> <since-iso> <until-iso>  -- where iron comes from: raw iron / iron ore gained (positive
`inventory_delta` on skill rows) by the y band of the row (skill rows snapshot the END position), the share of
bot-time per band (gaps capped 120 s), and the `mine` target y requested. Positive control: all items gained per band.
"""
import sys, os, glob, json, pickle, datetime as dt
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ugsafe2_extract import F_T, F_KIND, F_Y, F_DELTA, F_ARGS

IRON = ('raw_iron', 'iron_ore', 'deepslate_iron_ore')
E = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
s0, u0 = E(sys.argv[2]), E(sys.argv[3])
BANDS = [(63, 1e9, 'y>=63'), (40, 63, 'y40-62'), (16, 40, 'y16-39'), (0, 16, 'y0-15'), (-1e9, 0, 'y<0')]
band = lambda y: next(n for lo, hi, n in BANDS if lo <= y < hi)
iron, items, sec, mine_t, diam = Counter(), Counter(), Counter(), Counter(), Counter()
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.pkl'))):
    rows = pickle.load(open(f, 'rb'))['rows']
    lasty = None
    for i, r in enumerate(rows):
        if not (s0 <= r[F_T] < u0): continue
        if r[F_Y] is not None: lasty = r[F_Y]
        if lasty is None: continue
        b = band(lasty)
        if i + 1 < len(rows): sec[b] += min(rows[i + 1][F_T] - r[F_T], 120)
        if r[F_DELTA] and not r[F_KIND].startswith('_'):
            try: d = json.loads(r[F_DELTA])
            except Exception: d = {}
            for k, v in d.items():
                if isinstance(v, (int, float)) and v > 0:
                    items[b] += v
                    if k in IRON: iron[b] += v
                    if k in ('diamond', 'diamond_ore', 'deepslate_diamond_ore'): diam[b] += v
        if r[F_KIND] == 'mine' and r[F_ARGS]:
            try: a = json.loads(r[F_ARGS]) if r[F_ARGS].endswith('}') else {}
            except Exception: a = {}
            if isinstance(a.get('y'), (int, float)): mine_t[band(a['y'])] += 1
T = sum(sec.values()); TI = sum(iron.values()); TA = sum(items.values())
print(f'window {sys.argv[2]} -> {sys.argv[3]}  bot-h {T/3600:.0f}  iron gained {TI}  items gained {TA}  diamonds {sum(diam.values())}')
for _, _, b in BANDS:
    print(f'  {b:7s} bot-time {100*sec[b]/T:5.1f}%  iron {iron[b]:5d} ({100*iron[b]/max(TI,1):5.1f}%)  items {100*items[b]/max(TA,1):5.1f}%  diamonds {diam[b]}  mine targets {mine_t[b]}')
