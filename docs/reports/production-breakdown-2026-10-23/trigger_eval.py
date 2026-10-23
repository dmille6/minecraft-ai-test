"""Evaluate the report's reseed trigger (section 9.4) per world over one week, POOLED (Claude/Codex r2: daily cells are
too small). No ES access: reads out/llm_sample (4 h/day) and out/analyze.json.

    python3 trigger_eval.py [first_day] [last_day]       default 2026-10-16 .. 2026-10-22

WOOD arm (the wood rungs: stockpile_wood, gather_oak_log_12)
  chronic bot   >= 50 sampled wood-rung decisions in the week and 0 gather successes (excluded from sight AND outcome)
  eligible      wood-rung decisions >= 5 % of the world's sampled decisions AND >= 100 non-chronic of them
  sight         a log (oak/birch/spruce) within 16 m on < 50 % of the non-chronic wood-rung decisions
  outcome       non-chronic gather success per wood-rung decision < 0.5 x the median of the eligible worlds
IRON arm (bots that NEED iron: < 3 raw+ingots carried, a trip pickaxe, feet > 8 below home -- defined on the bot,
          not on the rung, because the rung disappears when no iron is in sight: ironInReach, milestones.mjs:505)
  eligible      >= 5 % of the world's sampled decisions AND >= 100 of them
  sight         iron ore within 32 m on < 85 % of them
  outcome       successful gather(iron_ore) per such decision < 0.5 x the median of the eligible worlds (a mine success
                is a staircase step, so it is not counted)
TRAP guard      the world's exclusive reflex hours/day AND its water-hold exposure hours/day (analyze.json) are each
                < 2 x the fleet median, else 'trapped' (board-d's pit shows as exposure, not exclusive time)
CENSUS          not evaluated here (frontier census output, publishing from 10-24 00:20Z)
An arm FIRES (pending the census) when eligible, sight and outcome all hold and the world is not trapped.
"""
import os, sys, gzip, json, re, glob, statistics, datetime as dt
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402
from sample_state import LOGS, COBBLE, TIER  # noqa: E402

a, b = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ('2026-10-16', '2026-10-22')
days = []
d = dt.date.fromisoformat(a)
while d <= dt.date.fromisoformat(b):
    days.append(str(d))
    d += dt.timedelta(days=1)
A = json.load(open(os.path.join(HERE, 'out', 'analyze.json')))

N = defaultdict(int)
wood = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))     # world -> bot -> n, ok, visible
iron = defaultdict(lambda: [0, 0, 0])                          # world -> n, ok, iron visible
for day in days:
    with gzip.open(os.path.join(HERE, 'out', 'llm_sample', f'{day}.jsonl.gz'), 'rt') as f:
        for l in f:
            r = json.loads(l)
            w = world(r['p'])
            if w not in HOMES:
                continue
            N[w] += 1
            per = r['per'] or {}
            m = re.sub(r'#\d+', '', r['m'] or '').replace('+prereq', '')
            ok = r['st'] == 'success'
            if m in ('stockpile_wood', 'gather_oak_log_12'):
                c = wood[w][r['b']]
                c[0] += 1
                c[1] += r['sk'] == 'gather' and ok
                c[2] += any(isinstance(per.get(x), (int, float)) and per[x] <= 16 for x in LOGS)
            inv = r['inv'] or {}
            need = sum(int(inv.get(x, 0) or 0) for x in ('raw_iron', 'iron_ingot')) < 3
            trip = any(n.split('_')[0] in TIER[1:] and any(u >= 40 for u in us) for n, us in (r['picks'] or {}).items())
            deep = r.get('y') is not None and r['y'] < HOMES[w][1] - 8
            if need and trip and deep:
                c = iron[w]
                c[0] += 1
                c[1] += ok and r['sk'] == 'gather' and 'iron' in (r['blk'] or '')   # iron obtained, not staircase steps (Claude r3)
                c[2] += any(isinstance(per.get(x), (int, float)) and per[x] <= 32 for x in ('iron_ore', 'deepslate_iron_ore'))


def excl_reflex(w):
    h = []
    for day in days:
        x = A[day][w]
        h.append(sum(v for dct in (x['goto_h_trig'], x['home_h_trig'], x['surface_h_trig'], x['explore_h_trig'])
                     for k, v in dct.items() if k not in ('llm', '?')))
    return sum(h) / len(h)


ref = {w: excl_reflex(w) for w in HOMES}
med_ref = statistics.median(ref.values())
expo = {w: sum((A[day][w]['float_s'] + A[day][w]['surface_float_s'] + A[day][w]['noair_s']) / 3600 for day in days) / len(days)
        for w in HOMES}
med_expo = statistics.median(expo.values())
W = {}
for w in sorted(HOMES):
    bots = wood[w]
    chronic = {bt for bt, v in bots.items() if v[0] >= 50 and v[1] == 0}
    n = sum(v[0] for bt, v in bots.items() if bt not in chronic)
    ok = sum(v[1] for bt, v in bots.items() if bt not in chronic)
    vis = sum(v[2] for bt, v in bots.items() if bt not in chronic)
    tot = sum(v[0] for v in bots.values())
    i = iron[w]
    W[w] = {'wood_share': tot / N[w], 'wood_n': n, 'wood_sight': vis / n if n else None, 'wood_yield': ok / n if n else None,
            'chronic': sorted(chronic), 'iron_share': i[0] / N[w], 'iron_n': i[0],
            'iron_sight': i[2] / i[0] if i[0] else None, 'iron_yield': i[1] / i[0] if i[0] else None,
            'reflex_h': ref[w], 'expo_h': expo[w],
            'trapped': ref[w] >= 2 * med_ref or expo[w] >= 2 * med_expo}
elig_w = [x for x in W.values() if x['wood_share'] >= 0.05 and x['wood_n'] >= 100]
elig_i = [x for x in W.values() if x['iron_share'] >= 0.05 and x['iron_n'] >= 100]
med = lambda xs: statistics.median(xs) if xs else None     # conventional median (Codex r3)
mw = med([x['wood_yield'] for x in elig_w])
mi = med([x['iron_yield'] for x in elig_i])
print(f'week {days[0]} .. {days[-1]}; median wood yield (eligible worlds, n={len(elig_w)}) {mw}; median iron yield '
      f'(n={len(elig_i)}) {mi}; median exclusive reflex h/day {med_ref:.1f}, water exposure {med_expo:.1f}')
print(f'{"world":11s} {"wood: share n sight yield":>34s} {"elig/sight/out":>15s} | {"iron: share n sight yield":>34s} '
      f'{"elig/sight/out":>15s} | reflex/exposure h  verdict')
for w, x in W.items():
    we = x['wood_share'] >= 0.05 and x['wood_n'] >= 100
    ws = we and x['wood_sight'] < 0.50
    wo = we and mw is not None and x['wood_yield'] < 0.5 * mw
    ie = x['iron_share'] >= 0.05 and x['iron_n'] >= 100
    is_ = ie and x['iron_sight'] < 0.85
    io = ie and mi is not None and x['iron_yield'] < 0.5 * mi
    fire = [arm for arm, f in (('WOOD', we and ws and wo), ('IRON', ie and is_ and io)) if f and not x['trapped']]
    fmt = lambda v: f'{v:.3f}' if v is not None else '  -  '
    print(f'{w:11s} {100 * x["wood_share"]:5.1f}% {x["wood_n"]:5d} {fmt(x["wood_sight"])} {fmt(x["wood_yield"])}     '
          f'{"YN"[not we]}/{"YN"[not ws]}/{"YN"[not wo]}       | {100 * x["iron_share"]:5.1f}% {x["iron_n"]:5d} '
          f'{fmt(x["iron_sight"])} {fmt(x["iron_yield"])}     {"YN"[not ie]}/{"YN"[not is_]}/{"YN"[not io]}       | '
          f'{x["reflex_h"]:5.1f}/{x["expo_h"]:5.1f}{" TRAPPED" if x["trapped"] else ""}  '
          f'{"FIRES (census pending): " + ",".join(fire) if fire else "no"}   chronic={x["chronic"]}')
