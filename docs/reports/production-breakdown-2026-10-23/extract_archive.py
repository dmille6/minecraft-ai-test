"""Sufficient-statistic tables for the analyses that read the raw sample or compact rows (Codex r2 P2-14), written to
out/archive/ for the repo's out-aggregates/. No ES access.

  sample_features.csv.gz  one row per sampled LLM decision, 10-08..10-22: day, world, bot, folded rung, chosen skill,
                          gather block, outcome, and the derived booleans every sample analysis uses (rung states from
                          rung_state.states(), log within 16 m, iron within 32 m, iron3, trip pickaxe, feet > 8 below home)
  hourly_world.csv.gz     per UTC hour x world: bots seen, gather ok, mine ok, water-float hours (board_d_window.py)
  log_nst_by_bot.csv      LOG gathers ending no_safe_target, per bot, BASE and END totals (final_checks.py (5))
  journal_subset.jsonl    the deploy/promote/teardown/owner-direct journal rows from 10-08 (journal_events.py)
"""
import os, sys, gzip, json, re, glob, csv
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402
from sample_state import LOGS  # noqa: E402
from rung_state import states  # noqa: E402  (runs rung_state's printing as a side effect; harmless)

OUT = os.path.join(HERE, 'out', 'archive')
os.makedirs(OUT, exist_ok=True)
RUNGS = ['stockpile_wood', 'crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'gather_iron_ore_3', 'stockpile_stone']
CODE = {'fulfilled': 'F', 'bypassed': 'B', 'outstanding': 'O'}

with gzip.open(os.path.join(OUT, 'sample_features.csv.gz'), 'wt', newline='') as f:
    w = csv.writer(f)
    w.writerow(['day', 'world', 'bot', 'rung', 'skill', 'block', 'outcome'] + ['st_' + r for r in RUNGS] +
               ['log16', 'iron32', 'iron3', 'trip', 'deep8'])
    for path in sorted(glob.glob(os.path.join(HERE, 'out', 'llm_sample', '*.jsonl.gz'))):
        day = os.path.basename(path)[:10]
        if day > '2026-10-22':
            continue
        with gzip.open(path, 'rt') as g:
            for l in g:
                r = json.loads(l)
                wd = world(r['p'])
                if wd not in HOMES:
                    continue
                S, near, trip, iron3 = states(r)
                per = r['per'] or {}
                log16 = any(isinstance(per.get(x), (int, float)) and per[x] <= 16 for x in LOGS)
                deep = r.get('y') is not None and r['y'] < HOMES[wd][1] - 8
                w.writerow([day, wd, r['b'], re.sub(r'#\d+', '', r['m'] or '').replace('+prereq', ''), r['sk'] or '',
                            r['blk'] or '', r['st'] or ''] + [CODE[S[x]] for x in RUNGS] +
                           [int(log16), int(near), int(iron3), int(trip), int(deep)])

H = defaultdict(lambda: [set(), 0, 0, 0.0])
HELD = re.compile(r'held ([0-9.]+)s')
nst = defaultdict(lambda: [0, 0])
LOGB = set(LOGS) | {'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'}
for path in sorted(glob.glob(os.path.join(HERE, 'out', 'rows', '*.jsonl.gz'))):
    day = os.path.basename(path)[:10]
    with gzip.open(path, 'rt') as g:
        for l in g:
            r = json.loads(l)
            wd = world(r['p'])
            if wd not in HOMES:
                continue
            x = H[(r['t'][:13], wd)]
            x[0].add(r['b'])
            if r['k'] == 'gather' and r['s'] == 'success':
                x[1] += 1
            elif r['k'] == 'mine' and r['s'] == 'success':
                x[2] += 1
            elif r['k'] == '_water_float_ended':
                m = HELD.search(r['d'] or '')
                x[3] += float(m.group(1)) / 3600 if m else 0.0
            if r['k'] == 'gather' and r['fc'] == 'no_safe_target' and r['a'].get('block') in LOGB:
                if day <= '2026-10-10':
                    nst[r['b']][0] += 1
                elif '2026-10-20' <= day <= '2026-10-22':
                    nst[r['b']][1] += 1
with gzip.open(os.path.join(OUT, 'hourly_world.csv.gz'), 'wt', newline='') as f:
    w = csv.writer(f)
    w.writerow(['hour', 'world', 'bots', 'gather_ok', 'mine_ok', 'float_h'])
    for (h, wd), x in sorted(H.items()):
        w.writerow([h, wd, len(x[0]), x[1], x[2], round(x[3], 4)])
with open(os.path.join(OUT, 'log_nst_by_bot.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['bot', 'base_3d_total', 'end_3d_total'])
    for b, v in sorted(nst.items()):
        w.writerow([b, v[0], v[1]])
with open(os.path.join(OUT, 'journal_subset.jsonl'), 'w') as f:
    for l in open(os.path.expanduser('~/canary-journal.jsonl')):
        try:
            r = json.loads(l)
        except ValueError:
            continue
        if (r.get('ts') or '') >= '2026-10-08' and r.get('phase') in ('deployed', 'promoted', 'owner-direct', 'torn-down'):
            f.write(json.dumps({k: r.get(k) for k in ('ts', 'run', 'phase', 'sha')}) + '\n')
print('archive written:', sorted(os.listdir(OUT)))
