#!/usr/bin/env python3
"""ugsafe2_deaths.py <an.pkl> <WINDOW> [ctx]  -- per-death lines and crosstabs (entry route, milestone, activity, bag)
for one window of ugsafe2_report.py; `ctx` also prints the 120 s before each death."""
import sys, pickle, datetime as dt
from collections import Counter, defaultdict
sys.argv, ARGS = sys.argv[:2], sys.argv[2:]
import ugsafe2_report as R   # noqa: E402  (prints the window report on import; harmless)

W = ARGS[0]
CTX = 'ctx' in ARGS
ds = R.dwin(W)
eps = [e for e in R.A['episodes'] if R.inwin(e['start'], W)]
print(f'\n##### {W}: {len(ds)} deaths, {len(eps)} water episodes')
for d in ds:
    b = d['bag']; ep = d['episode']
    print(f"{dt.datetime.utcfromtimestamp(d['t']):%m-%d %H:%M:%S} {d['bot']:18s} v{d['ver']} {d['cause']:11s} y={d['y']!s:6.6s} "
          f"act={d['activity']:8s} fell={d['fell']:3d} entry={d['entry']:16s} ms={d['milestone']} "
          f"| pick={b['pick']} iron={b['iron_pick']} blocks={b['blocks']} bucket={b['bucket']} items={b['items']}"
          + (f" | ep len={ep['len']:.0f}s sealed={ep['sealed']} y0={ep['y0']}" if ep else '') + f" tags={d['entry_tags']}")
    if CTX:
        for c in d['ctx']:
            if c[0] >= -120 and c[1] not in ('_path_reset', '_affordance_scan', '_reach_probe', '_pickup_skipped', '_path_failure_shapes', '_chunks_evicted', '_livelock_not_fixated', '_explore_toward_known', '_work_order', '_pickups', '_water_float', '_water_float_ended', '_water_surface', '_water_surface_ended', '_inventory_mutation'):
                print(f"      {c[0]:7.1f} {c[1]:28s} {str(c[2]):9s} y={c[4]!s:6.6s} dur={c[5]} {c[6]} | {c[3][:200]}")
        print('      llm:', d['ctx_ms'])


def tab(title, key):
    c = Counter(key(d) for d in ds)
    print(f'  {title}: ' + ', '.join(f'{k} {v}' for k, v in c.most_common()))


print('\nCROSSTABS')
for cause in ('drowning', 'lava', 'fall', 'suffocation'):
    sub = [d for d in ds if d['cause'] == cause]
    if not sub: continue
    print(f' {cause} ({len(sub)}):')
    for title, key in (('entry', lambda d: d['entry']), ('activity', lambda d: d['activity']),
                       ('milestone', lambda d: d['milestone']),
                       ('y band', lambda d: 'y>=63' if d['y'] >= 63 else 'y55-62' if d['y'] >= 55 else 'y40-54' if d['y'] >= 40 else 'y16-39' if d['y'] >= 16 else 'y0-15' if d['y'] >= 0 else 'y<0'),
                       ('pickaxe>0 uses', lambda d: d['bag']['pick'] > 0), ('blocks>=8', lambda d: d['bag']['blocks'] >= 8),
                       ('empty bucket', lambda d: d['bag']['bucket'] > 0), ('iron pickaxe', lambda d: d['bag']['iron_pick'] > 0),
                       ('in sealed episode', lambda d: bool(d['episode'] and d['episode']['sealed']))):
        c = Counter(key(d) for d in sub)
        print(f'   {title}: ' + ', '.join(f'{k} {v}' for k, v in c.most_common()))
se = [e for e in eps if e['sealed']]
print(f'\nSEALED episodes {len(se)} (fatal {sum(e["fatal"] for e in se)}); entry route -> (episodes, fatal):')
c = defaultdict(lambda: [0, 0])
for e in se:
    c[e['entry']][0] += 1; c[e['entry']][1] += e['fatal']
for k, v in sorted(c.items(), key=lambda kv: -kv[1][0]):
    print(f'   {k:20s} {v[0]:4d} {v[1]:4d}  cf {100*v[1]/v[0]:.0f}%')
nf = [e for e in eps if e['fatal'] and not e['sealed']]
print('fatal NOT sealed episodes:', len(nf))
