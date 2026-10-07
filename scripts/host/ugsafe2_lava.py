#!/usr/bin/env python3
"""ugsafe2_lava.py <an.pkl> [WINDOWS]  -- every lava/fire death: depth, fall, what was running (skill rows covering the
death, the `_fall_path` death row's own path state), the lava warnings already raised in the 30 s before
(`_lava_corridor`, explore blind-step refusals naming lava, `_lava_adjacent_*`; NOT `_reflex_danger_block`), digs in
the 10 s before, and the milestone. Prints one line per death and a crosstab of the ENTRY class:
  fall_into     a fall >= 2 blocks ending in the lava (death detail 'after falling N' or `_fall_path` fell N)
  dig_into      a dig/mine/ore-tunnel/gather dig row in the 10 s before and no fall
  walk_warned   no fall, no dig, a lava warning in the 30 s before (the guard named it; the bot still entered)
  walk_silent   none of the above
"""
import sys, re
from collections import Counter
sys.argv, ARGS = sys.argv[:2], sys.argv[2:]
import io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import ugsafe2_report as R

WINS = (ARGS[0] if ARGS else 'P1,MID,POST').split(',')
WARN = ('_lava_corridor', '_lava_adjacent_no_retreat', '_lava_adjacent_stand_off')
DIGK = ('_dig_approach', '_goto_dig_retry', '_goto_float_dig', '_ore_tunnel', '_mine_stair_step_failed', '_dig_collision',
        '_last_swing', '_spent_swing', '_scaffold_pick')
tot = Counter(); bydepth = Counter(); byskill = Counter(); bywin = {}
for W in WINS:
    ds = [d for d in R.dwin(W) if d['cause'] == 'lava']
    c = Counter()
    print(f'\n#### {W}: {len(ds)} lava deaths')
    for d in ds:
        ctx = d['ctx']
        last30 = [x for x in ctx if x[0] >= -30]
        # warnings BEFORE entry only: `_reflex_danger_block lava` fires once the bot is already in lava (circular), so it
        # is excluded, and so is anything in the last 3 s
        warn = [x for x in last30 if x[0] < -3 and (x[1] in WARN or (x[1] == '_explore_blind_step_refused' and 'lava' in x[3]))]
        digs = [x for x in ctx if x[0] >= -10 and (x[1] in DIGK or (x[1] in ('mine', 'gather') and (x[0] + (x[5] or 0) / 1000) >= -10))]
        fp = [x for x in ctx if x[1] == '_fall_path' and x[3].startswith('death')]
        fell = d['fell']
        if fp:
            m = re.search(r'fell (\d+)', fp[-1][3]); fell = max(fell, int(m.group(1)) if m else 0)
        running = [x[1] for x in ctx if not x[1].startswith('_') and x[0] <= 0 and x[0] + (x[5] or 0) / 1000 >= -2]
        if fell >= 2: cls = 'fall_into'
        elif digs: cls = 'dig_into'
        elif warn: cls = 'walk_warned'
        else: cls = 'walk_silent'
        c[cls] += 1; tot[cls] += 1
        band = 'y<0' if d['y'] < 0 else 'y0-39' if d['y'] < 40 else 'y40-62' if d['y'] < 63 else 'y>=63'
        bydepth[(band, cls)] += 1
        lastskills = [m[2] for m in d['ctx_ms']]
        byskill[(lastskills[-1] if lastskills else None)] += 1
        print(f"  {d['bot']:18s} y={d['y']:6.1f} fell={fell:3d} cls={cls:11s} running={running[-1] if running else '-':8s} last_decisions={lastskills[-3:]} ms={d['milestone']} warns={len(warn)} digs={[x[1] for x in digs][:4]}"
              f" | {(fp[-1][3][:150] if fp else '')}")
    bywin[W] = c
    print('  entry classes:', dict(c))
print('\nALL windows entry classes:', dict(tot))
print('by depth x class:', dict(sorted(bydepth.items())))
print('last decision before death:', dict(byskill.most_common()))
