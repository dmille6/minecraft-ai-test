"""Bot state at decision time, from the systematic LLM sample (out/llm_sample). No ES access.

Per day x world-age group (and per world in out/sample_state.json):
  rung-satisfying bag state: wood units >= 64 (logs + planks/4), stone-family >= 64, iron (raw+ingot) >= 3,
  a stone-or-better pickaxe with >= 40 uses (hasTripPickaxe), crafting_table, furnace;
  what the bot can SEE (perception = nearest block of a kind within the scan, metres):
  iron ore within 32 (ironInReach), any log within 16 / 32, sand within 32, dirt within 8;
  where it is: horizontal distance from home (median, share > 100), feet > 8 below home y.
Every share's denominator (decisions sampled) is printed with it.
"""
import os, sys, gzip, json, glob, math
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402

LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
PLANKS = [l.replace('_log', '_planks') for l in LOGS]
COBBLE = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'stone', 'andesite', 'diorite', 'granite', 'tuff']
TIER = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']
GROUPS = {'orig': ['board-a', 'board-c', 'board-d', 'hive-a', 'hive-b', 'placebo-c'],
          'isolated': ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d'],
          'rs0919': ['placebo-a', 'placebo-b'], 'rs0927': ['board-b', 'hive-c', 'hive-d', 'placebo-d']}
KEYS = ['wood64', 'stone64', 'iron3', 'trip', 'table', 'furnace', 'iron32', 'log16', 'log32', 'sand32', 'dirt8',
        'far100', 'deep8']


def feats(r):
    inv = r['inv'] or {}
    per = r['per'] or {}
    c = lambda names: sum(int(inv.get(n, 0) or 0) for n in names)
    wood = c(LOGS) + c(PLANKS) // 4
    trip = any(n.split('_')[0] in TIER[1:] and any(u >= 40 for u in us) for n, us in (r['picks'] or {}).items())
    near = lambda names, d: any(isinstance(per.get(n), (int, float)) and per[n] <= d for n in names)
    w = world(r['p'])
    hx, hy, hz = HOMES[w]
    dist = math.hypot(r['x'] - hx, r['z'] - hz) if r.get('x') is not None else None
    return {'wood64': wood >= 64, 'stone64': c(COBBLE) >= 64, 'iron3': c(['raw_iron', 'iron_ingot']) >= 3,
            'trip': trip, 'table': c(['crafting_table']) >= 1, 'furnace': c(['furnace']) >= 1,
            'iron32': near(['iron_ore', 'deepslate_iron_ore'], 32), 'log16': near(LOGS, 16), 'log32': near(LOGS, 32),
            'sand32': near(['sand'], 32), 'dirt8': near(['dirt', 'grass_block'], 8),
            'far100': dist is not None and dist > 100, 'deep8': r.get('y') is not None and r['y'] < hy - 8}, dist


def main():
    out = {}
    print(f'{"day":10s} {"group":9s} {"n":>6s} ' + ' '.join(f'{k:>7s}' for k in KEYS) + '  dist_med')
    for path in sorted(glob.glob(os.path.join(HERE, 'out', 'llm_sample', '*.jsonl.gz'))):
        day = os.path.basename(path)[:10]
        acc = defaultdict(lambda: defaultdict(int))
        dists = defaultdict(list)
        with gzip.open(path, 'rt') as f:
            for l in f:
                r = json.loads(l)
                w = world(r['p'])
                if w not in HOMES:
                    continue
                F, dist = feats(r)
                for key in (w, 'g:' + next(g for g, ws in GROUPS.items() if w in ws), 'fleet'):
                    acc[key]['n'] += 1
                    for k, v in F.items():
                        acc[key][k] += bool(v)
                    if dist is not None:
                        dists[key].append(dist)
        out[day] = {}
        for key, A in acc.items():
            ds = sorted(dists[key])
            out[day][key] = {'n': A['n'], **{k: A[k] / A['n'] for k in KEYS},
                             'dist_med': ds[len(ds) // 2] if ds else None}
        for key in ['fleet'] + ['g:' + g for g in GROUPS]:
            X = out[day].get(key)
            if X:
                print(f'{day:10s} {key:9s} {X["n"]:6d} ' + ' '.join(f'{100 * X[k]:6.1f}%' for k in KEYS) +
                      f'  {X["dist_med"]:6.0f}')
    json.dump(out, open(os.path.join(HERE, 'out', 'sample_state.json'), 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
