#!/usr/bin/env python3
"""ugsafe2_lavaopp.py <rowsdir> <an.pkl>  -- the lava OPPORTUNITY: an `explore` start (skill rows are stamped at their
start) by a bot whose own guards named lava in the 120 s before (`_lava_corridor`, `_explore_blind_step_refused` naming
lava, `_reflex_danger_block lava`, `_lava_adjacent_*`). Outcome within 60 s of the start: a lava/fire death, or a
`_reflex_danger_block lava` (the bot's feet/body in lava: the near miss). Positive control: explore starts with NO
lava warning in the prior 120 s, same outcomes. Per window of ugsafe2_report.py.
"""
import sys, os, glob, pickle, bisect
from collections import Counter
sys.argv, ARGS = sys.argv[:2], sys.argv[2:]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R
from ugsafe2_extract import F_T, F_KIND, F_DETAIL, F_Y

lavadeath = {(d['bot'], int(d['t'])) for d in R.A['deaths'] if d['cause'] == 'lava'}
deaths_by_bot = {}
for d in R.A['deaths']:
    if d['cause'] == 'lava': deaths_by_bot.setdefault(d['bot'], []).append(d['t'])
res = {w: Counter() for w in R.WIN}
uniq = {w: set() for w in R.WIN}   # UNIQUE lava deaths with >= 1 warned explore start in the 60 s before (Codex: dedupe)
for f in sorted(glob.glob(os.path.join(ARGS[0], '*.pkl'))):
    bot = os.path.basename(f)[:-4]
    rows = pickle.load(open(f, 'rb'))['rows']
    warn = [r[F_T] for r in rows if r[F_KIND] in ('_lava_corridor', '_lava_adjacent_no_retreat', '_lava_adjacent_stand_off')
            or (r[F_KIND] == '_explore_blind_step_refused' and 'lava' in (r[F_DETAIL] or ''))]   # NOT danger_block (already in lava)
    inlava = [r[F_T] for r in rows if r[F_KIND] == '_reflex_danger_block' and 'lava' in (r[F_DETAIL] or '')]
    dts = sorted(deaths_by_bot.get(bot, []))
    starts = [r for r in rows if r[F_KIND] in ('explore', 'gather', 'goto', 'mine')]
    st_t = [r[F_T] for r in starts]
    for r in starts:
        t = r[F_T]
        w = next((w for w in R.WIN if R.inwin(t, w)), None)
        if not w: continue
        i = bisect.bisect_left(warn, t - 120)
        warned = i < len(warn) and warn[i] < t
        j = bisect.bisect_left(inlava, t); near = j < len(inlava) and inlava[j] <= t + 60
        k = bisect.bisect_left(dts, t); dead = k < len(dts) and dts[k] <= t + 60
        # the death is attributed to THIS start only if no later movement start precedes it (dedupe)
        if dead:
            nxt = bisect.bisect_right(st_t, t)
            if nxt < len(st_t) and st_t[nxt] < dts[k]: dead = False
        key = ('warned_' if warned else 'unwarned_') + r[F_KIND]
        res[w][key + '_starts'] += 1; res[w][key + '_inlava60'] += near; res[w][key + '_death60'] += dead
        if dead and warned: uniq[w].add((bot, dts[k]))
tot = Counter()
for w, c in res.items():
    tot.update(c)
    print(f'{w}: UNIQUE lava deaths after a warned movement start (last start before the death, <= 60 s): {len(uniq[w])}')
    for kind in ('explore', 'gather', 'goto', 'mine'):
        a, u = 'warned_' + kind, 'unwarned_' + kind
        print(f'   {kind:8s} warned starts {c[a+"_starts"]:5d} -> in lava {c[a+"_inlava60"]:3d}, death {c[a+"_death60"]:3d} ({100*c[a+"_death60"]/max(c[a+"_starts"],1):.2f}%)'
              f' | unwarned {c[u+"_starts"]:6d} -> in lava {c[u+"_inlava60"]:3d}, death {c[u+"_death60"]:3d} ({100*c[u+"_death60"]/max(c[u+"_starts"],1):.3f}%)')
print('ALL windows:')
for kind in ('explore', 'gather', 'goto', 'mine'):
    a, u = 'warned_' + kind, 'unwarned_' + kind
    print(f'   {kind:8s} warned starts {tot[a+"_starts"]:5d} -> in lava {tot[a+"_inlava60"]:3d}, death {tot[a+"_death60"]:3d} ({100*tot[a+"_death60"]/max(tot[a+"_starts"],1):.2f}%)'
          f' | unwarned {tot[u+"_starts"]:6d} -> death {tot[u+"_death60"]:3d} ({100*tot[u+"_death60"]/max(tot[u+"_starts"],1):.3f}%)')
print('unique deaths, all windows:', sum(len(v) for v in uniq.values()))
