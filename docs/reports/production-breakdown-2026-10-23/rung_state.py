"""Why did the production rungs empty? For every sampled LLM decision (out/llm_sample, 15 worlds:
board-d left out), classify each production rung as the ladder itself would (bots/src/milestones.mjs):

  fulfilled    the bag passes the rung's own completion test            (base.done / fulfilled)
  bypassed     not fulfilled, and the rung's hasMeans gate fails        (rungOf: done = fulfilled || !hasMeans)
  outstanding  neither: the chain would stop here (unless skipped by a give-up backoff)

Rung tests (source lines in the report):
  stockpile_wood   wood units (logs + planks/4) >= 64  (stockpileTarget caps at 64; the lap counter n is not in
                   telemetry, so 64 is assumed -- it is the cap for every lap >= 14)
  crafting_table   holds >= 1; means: planks >= 4 or logs >= 1
  wooden_pickaxe   a wooden-or-better pickaxe with >= 2 uses; means: table and (planks >= 5 or logs >= 2)
  stone_pickaxe    a stone-or-better pickaxe with >= 40 uses (capCount MIN_TRIP_USES); means: table, stone-family
                   >= 3, and (sticks >= 2 or planks >= 2)
  furnace          holds >= 1; means: stone-family >= 8
  gather_iron_ore_3  raw_iron + iron_ingot >= 3; means: iron ore within 32 m AND a trip pickaxe
  stockpile_stone  stone-family >= 64

Also: how many sampled decisions carry NO perception at all (counted as absence by sample_state, so the
sight shares are lower bounds), and the iron sightline among the decisions that actually NEED iron.
No ES access.
"""
import os, sys, gzip, json, re, glob
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402
from sample_state import LOGS, PLANKS, COBBLE, TIER  # noqa: E402

BASE = ['2026-10-08', '2026-10-09', '2026-10-10']
END = ['2026-10-20', '2026-10-21', '2026-10-22']
RUNGS = ['stockpile_wood', 'crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'gather_iron_ore_3',
         'stockpile_stone']


def pick_ok(picks, min_tier, min_uses):
    return any(n.split('_')[0] in TIER[min_tier:] and any(u >= min_uses for u in us) for n, us in (picks or {}).items())


def states(r):
    inv = r['inv'] or {}
    per = r['per'] or {}
    c = lambda names: sum(int(inv.get(n, 0) or 0) for n in names)
    logs, planks, cob = c(LOGS), c(PLANKS), c(COBBLE)
    wood = logs + planks // 4
    table = c(['crafting_table']) >= 1
    iron_near = any(isinstance(per.get(n), (int, float)) and per[n] <= 32 for n in ('iron_ore', 'deepslate_iron_ore'))
    trip = pick_ok(r['picks'], 1, 40)

    def st(full, means):
        return 'fulfilled' if full else ('bypassed' if not means else 'outstanding')
    return {
        'stockpile_wood': st(wood >= 64, True),
        'crafting_table': st(table, planks >= 4 or logs >= 1),
        'wooden_pickaxe': st(pick_ok(r['picks'], 0, 2), table and (planks >= 5 or logs >= 2)),
        'stone_pickaxe': st(trip, table and cob >= 3 and (c(['stick']) >= 2 or planks >= 2)),
        'furnace': st(c(['furnace']) >= 1, cob >= 8),
        'gather_iron_ore_3': st(c(['raw_iron', 'iron_ingot']) >= 3, iron_near and trip),
        'stockpile_stone': st(cob >= 64, True),
    }, iron_near, trip, c(['raw_iron', 'iron_ingot']) >= 3


def tally(days):
    T = {rg: defaultdict(int) for rg in RUNGS}
    n = noper = 0
    need = need_near = need_trip = 0
    allclosed = closed_bypass = 0
    for d in days:
        with gzip.open(os.path.join(HERE, 'out', 'llm_sample', f'{d}.jsonl.gz'), 'rt') as f:
            for l in f:
                r = json.loads(l)
                w = world(r['p'])
                if w not in HOMES or w == 'board-d':
                    continue
                n += 1
                noper += not r['per']
                S, near, trip, iron3 = states(r)
                for rg, s in S.items():
                    T[rg][s] += 1
                if not iron3:
                    need += 1
                    need_near += near
                    need_trip += trip
                if all(s != 'outstanding' for s in S.values()):
                    allclosed += 1
                    closed_bypass += any(s == 'bypassed' for s in S.values())
    return T, n, noper, need, need_near, need_trip, allclosed, closed_bypass


for lab, days in (('BASE', BASE), ('END', END)):
    T, n, noper, need, nn, nt, ac, cb = tally(days)
    print(f'== {lab} {days[0]}..{days[-1]}: {n} sampled decisions (15 worlds); with NO perception recorded: {noper} '
          f'({100 * noper / n:.2f}%)')
    for rg in RUNGS:
        t = T[rg]
        print(f'   {rg:18s} fulfilled {100 * t["fulfilled"] / n:5.1f}%  bypassed {100 * t["bypassed"] / n:5.1f}%  '
              f'outstanding {100 * t["outstanding"] / n:5.1f}%')
    print(f'   all seven checked predicates closed: {100 * ac / n:.1f}% of decisions; of those, closed with >= 1 bypass: '
          f'{100 * cb / max(1, ac):.1f}%')
    print(f'   decisions that NEED iron (< 3 carried): {need} ({100 * need / n:.1f}%); of them iron ore within 32 m '
          f'{100 * nn / max(1, need):.1f}%, trip pickaxe {100 * nt / max(1, need):.1f}%')


# ---------------------------------------------------------------- two depletion SCENARIOS, same populations
# (assumption-dependent: they price the change in what the bot can see, holding everything else fixed)
Y = json.load(open(os.path.join(HERE, 'out', 'milestone_yield.json')))
OTHER = [w for w in HOMES if w != 'board-d']
PRODUCTION = ('stockpile_wood', 'stockpile_stone', 'gather_iron_ore_3', 'gather_oak_log_12', 'gather_cobblestone_8')


def decisions(days, pred, K=None):
    n = s = 0.0
    for d in days:
        for w in OTHER:
            for m, ks in Y[d].get(w, {}).items():
                if not pred(m.replace('+prereq', '')):
                    continue
                for k, st in ks.items():
                    n += sum(st.values()) / len(days)
                    if K and k == K:
                        s += st.get('success', 0) / len(days)
    return n, s


def wood_iron_sample(days):
    out = {'wood': {'vis': [0, 0], 'not': [0, 0]}, 'iron': [0, 0]}
    for d in days:
        with gzip.open(os.path.join(HERE, 'out', 'llm_sample', f'{d}.jsonl.gz'), 'rt') as f:
            for l in f:
                r = json.loads(l)
                w = world(r['p'])
                if w not in HOMES or w == 'board-d':
                    continue
                m = re.sub(r'#\d+', '', r['m'] or '').replace('+prereq', '')
                if m in ('stockpile_wood', 'gather_oak_log_12'):
                    per = r['per'] or {}
                    vis = any(isinstance(per.get(x), (int, float)) and per[x] <= 16 for x in LOGS)
                    c = out['wood']['vis' if vis else 'not']
                    c[0] += 1
                    c[1] += (r['sk'] == 'gather' and r['st'] == 'success')
                S, near, trip, iron3 = states(r)
                if not iron3 and trip:
                    out['iron'][0] += 1
                    out['iron'][1] += near
                    deep = r.get('y') is not None and r['y'] < HOMES[w][1] - 8
                    c = out.setdefault('iron_deep' if deep else 'iron_near', [0, 0])
                    c[0] += 1
                    c[1] += near
    return out


print('\n== SCENARIO A (wood): wood-rung decisions only (stockpile_wood + gather_oak_log_12), 15 worlds, sample')
wb, we = wood_iron_sample(BASE), wood_iron_sample(END)
for lab, x in (('BASE', wb['wood']), ('END', we['wood'])):
    n = x['vis'][0] + x['not'][0]
    print(f'   {lab}: n {n}; a log (oak/birch/spruce: the only species perception scans) within 16 m in '
          f'{100 * x["vis"][0] / n:.1f}%; gather success per decision visible {100 * x["vis"][1] / max(1, x["vis"][0]):.1f}% '
          f'(n {x["vis"][0]}), not visible {100 * x["not"][1] / max(1, x["not"][0]):.1f}% (n {x["not"][0]})')
B, E = wb['wood'], we['wood']
pb = B['vis'][0] / (B['vis'][0] + B['not'][0])
pe = E['vis'][0] / (E['vis'][0] + E['not'][0])
gap = B['vis'][1] / B['vis'][0] - B['not'][1] / max(1, B['not'][0])
yb = (B['vis'][1] + B['not'][1]) / (B['vis'][0] + B['not'][0])
ye = (E['vis'][1] + E['not'][1]) / (E['vis'][0] + E['not'][0])
db, _ = decisions(BASE, lambda m: m in ('stockpile_wood', 'gather_oak_log_12'))
de, _ = decisions(END, lambda m: m in ('stockpile_wood', 'gather_oak_log_12'))
vis_part = (pe - pb) * gap
gap_e = E['vis'][1] / max(1, E['vis'][0]) - E['not'][1] / max(1, E['not'][0])
vis_part_e = (pe - pb) * gap_e
print(f'   per-decision gather success {100 * yb:.1f}% -> {100 * ye:.1f}%; visibility part {100 * vis_part:+.2f} pp at the '
      f'BASE gap ({100 * gap:.1f} pp), {100 * vis_part_e:+.2f} pp at the END gap ({100 * gap_e:.1f} pp)')
SC = {}
for lab, vol in (('END volume', de), ('mean volume', (db + de) / 2), ('BASE volume', db)):
    v = vis_part * vol * 16 / 15
    print(f'   priced at {lab} ({vol:,.0f} wood-rung decisions/day, 15 worlds) x 16/15: {v:+.0f} gather/day '
          f'(END gap: {vis_part_e * vol * 16 / 15:+.0f})')
    SC['A_gather_' + lab.replace(' ', '_').lower()] = v
SC['A_gather_end_volume_end_gap'] = vis_part_e * de * 16 / 15

print('\n== SCENARIO B (iron): decisions that need iron (< 3 carried) AND hold a trip pickaxe, 15 worlds, sample')
ib = wb['iron'][1] / wb['iron'][0]
ie = we['iron'][1] / we['iron'][0]
print(f'   iron ore within 32 m: BASE {100 * ib:.1f}% (n {wb["iron"][0]}) -> END {100 * ie:.1f}% (n {we["iron"][0]})')
for k, lab in (('iron_deep', 'feet > 8 below home'), ('iron_near', 'within 8 of home y or above')):
    b, e = wb.get(k, [0, 1]), we.get(k, [0, 1])
    print(f'     {lab:28s}: {100 * b[1] / max(1, b[0]):5.1f}% (n {b[0]}) -> {100 * e[1] / max(1, e[0]):5.1f}% (n {e[0]})')
di, si = decisions(END, lambda m: m == 'gather_iron_ore_3', 'mine')
dd, sd = decisions(END, lambda m: not (m in PRODUCTION or m.startswith('craft_') or m.startswith('smelt_')), 'mine')
extra = di * (ib / ie - 1)
net = si / di - sd / dd
print(f'   END iron-rung decisions {di:,.0f}/day (mine yield {si / di:.3f}); displaced non-production decisions yield '
      f'{sd / dd:.3f} mine/decision; extra iron-rung decisions had the sightline held at BASE {extra:,.0f}/day; '
      f'net {-extra * net * 16 / 15:+.0f} mine successes/day (x 16/15)')
SC['B_mine'] = -extra * net * 16 / 15
json.dump(SC, open(os.path.join(HERE, 'out', 'scenarios.json'), 'w'), indent=1)
print('   scenarios written to out/scenarios.json:', {k: round(v) for k, v in SC.items()})
