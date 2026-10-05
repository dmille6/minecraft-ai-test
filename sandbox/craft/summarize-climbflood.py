#!/usr/bin/env python3
"""Per-scene table for climbflood-ab.cjs results: summarize-climbflood.py results-ctrl.jsonl results-cand.jsonl

Outcome per trial is the WORLD's (RCON polls of the bot's own cells, Air, Health, Pos; the trace's dig locations), not
the bot's rows. FLOODED = water/lava in the bot's own head cell at any poll, or any water-family row (not counted for
scene D, which starts submerged), or a drowning/lava death. CEILING = the refused cell 700 42 700 was dug (dig start).
OUT = the bot ended >= 2 blocks above its start, alive. PREREQ = an _prereq_* ask to the goal layer made in the scene
(asks written during the spectator setup at y 60, before the arena and the kit exist, are excluded in both arms).
"""
import json, sys
from collections import defaultdict

EXPECT = {
    'A': 'control floods >= 4/5; candidate: no flood, exits dry (sidestep + ramp)',
    'B': 'control floods; candidate: no flood, exits dry',
    'C': 'control floods; candidate: dry and alive, one refusal per back-off, no prerequisite, no spin',
    'D': 'candidate must still dig up (submerged exemption)',
    'E': 'candidate refuses; never digs the ceiling under the lava',
    'F': 'both climb out identically (regression arm)',
    'G': 'control floods; candidate refuses the gravel/ceiling digs',
}
rows = []
for f in sys.argv[1:]:
    for line in open(f):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
by = defaultdict(list)
for r in rows:
    by[(r['scene'], r['arm'])].append(r)
print('%-5s %-5s %-8s %3s %8s %7s %7s %6s %6s %7s %9s %s' % ('scene', 'arm', 'sha', 'n', 'flooded', 'died', 'ceiling', 'out', 'alive', 'prereq', 'refusals', 'flood rows (kinds)'))
for scene in sorted({s for s, _ in by}):
    for arm in ('ctrl', 'cand'):
        rs = by.get((scene, arm))
        if not rs:
            continue
        n = len(rs)
        fl = sum(r['flooded'] for r in rs)
        died = sum(r['died'] for r in rs)
        ceil = sum(r['ceilingDug'] for r in rs)
        out = sum(1 for r in rs if r['alive'] and r['yEnd'] is not None and r['y0'] is not None and r['yEnd'] - r['y0'] >= 2)
        alive = sum(r['alive'] for r in rs)
        # a prereq whose reason names y=60 was written during the SETUP phase (the bot parked in spectator at y 60
        # with an empty bag before the arena and kit exist) -- the harness, not the scene; both arms show it
        pre = sum(1 for r in rs if any('y=60' not in x for x in r['prereqs'] if not x.startswith('dirt-class') and not x.startswith('pickaxe-class')))
        refused = [sum(1 for x in r['floodRows'] if '_climb_flood_refused' in x) for r in rs]
        kinds = defaultdict(int)
        for r in rs:
            for k, v in r['kinds'].items():
                if k.startswith('_climb_flood_'):
                    kinds[k[13:]] += v
        print('%-5s %-5s %-8s %3d %8s %7s %7s %6s %6s %7s %9s %s' % (scene, arm, rs[0]['sha'], n, f'{fl}/{n}', f'{died}/{n}', f'{ceil}/{n}',
              f'{out}/{n}', f'{alive}/{n}', f'{pre}/{n}', ','.join(map(str, refused)), dict(kinds)))
    print('      expected: ' + EXPECT.get(scene, ''))
