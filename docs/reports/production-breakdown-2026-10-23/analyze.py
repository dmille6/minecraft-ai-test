"""Per (UTC day, world) production, depletion, reflex and travel measures from out/rows/*.jsonl.gz.
No ES access: it reads the compact rows pull_rows.py wrote (each day's per-kind counts are in
<day>.counts.json, the positive control that the instrument saw the kind at all).

Homes come from each world's TOWN-PLACED.json on the world host (read 10-23, quoted in the report);
isolated self-pools fold into their world (same world, same home).

Output: out/analyze.json  {day: {world: {...}}}
"""
import os, sys, gzip, json, re, math, glob
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROWS = os.path.join(HERE, 'out', 'rows')

T = (355, 73, 147)
HOMES = {'board-a': T, 'board-b': (-249, 65, 144), 'board-c': T, 'board-d': T,
         'hive-a': T, 'hive-b': T, 'hive-c': (-68, 68, -68), 'hive-d': (68, 65, 68),
         'isolated-a': T, 'isolated-b': T, 'isolated-c': T, 'isolated-d': T,
         'placebo-a': (249, 75, -144), 'placebo-b': (282, 65, -388), 'placebo-c': T, 'placebo-d': (177, 75, 73)}
# world created / reseeded (TOWN-PLACED + world.pre-reseed-* dir names on 10.0.0.30)
RESEEDED = {'placebo-a': '2026-09-18T23:52Z', 'placebo-b': '2026-09-19T11:10Z', 'board-b': '2026-09-27T13:09Z',
            'hive-c': '2026-09-27T12:35Z', 'hive-d': '2026-09-27T13:23Z', 'placebo-d': '2026-09-27T13:39Z'}


def world(pool):
    if pool and pool.startswith('self-'):
        return '-'.join(pool.split('-')[1:3])
    return pool


def cat(item):
    if not item:
        return 'other'
    if item.endswith('_log') or item.endswith('_stem') or item.endswith('_wood'):
        return 'log'
    if item.endswith('_ore') or item.startswith('raw_') or item in ('coal', 'diamond', 'emerald', 'lapis_lazuli', 'redstone'):
        return 'ore'
    if item in ('stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff',
                'calcite', 'dripstone_block', 'smooth_basalt', 'basalt'):
        return 'stone'
    if item in ('dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mud'):
        return 'dirt'
    if item in ('sand', 'red_sand', 'gravel', 'clay', 'clay_ball', 'flint'):
        return 'sand'
    return 'other'


def gfail(r):
    """Gather outcome class."""
    if r['s'] == 'success':
        return 'ok'
    fc = r['fc'] or r['s']
    d = r['d'] or ''
    if fc == 'nothing_found' or re.match(r'no [a-z_]+ within', d):
        return 'nothing_found'
    if fc in ('no_safe_target', 'canopy_refused', 'canopy_failed'):
        return 'no_safe_target'
    if fc in ('no_path',):
        return 'no_path'
    if fc in ('unreachable',):
        return 'unreachable'
    if fc == 'interrupted' or r['s'] == 'aborted':
        return 'interrupted'
    return 'other'


HELD = re.compile(r'held ([0-9.]+)s')


def q(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))]


def new():
    return {'gather_n': 0, 'gather_ok': 0, 'gather_h': 0.0, 'gather_ok_by': Counter(), 'gather_n_by': Counter(),
            'gather_items_by': Counter(), 'gather_out': Counter(), 'gather_out_by': defaultdict(Counter),
            'gather_h_by': Counter(), 'gok_dist': defaultdict(list), 'gok_depth': [], 'gather_dirt_trig': Counter(),
            'mine_n': 0, 'mine_ok': 0, 'mine_h': 0.0, 'mine_items_by': Counter(), 'mine_fc': Counter(),
            'mine_ok_ore': 0, 'craft_by': defaultdict(Counter), 'craft_fail_cls': Counter(),
            'td_n': 0, 'td_ok': 0, 'td_cls': Counter(), 'dep_n': 0, 'dep_ok': 0,
            'explore_n': 0, 'explore_ok': 0, 'explore_h': 0.0, 'explore_h_trig': Counter(), 'explore_gain': Counter(),
            'goto_h_trig': Counter(), 'goto_n': 0, 'home_h_trig': Counter(), 'surface_h_trig': Counter(),
            'skill_h': Counter(), 'skill_n': Counter(),
            'float_s': 0.0, 'surface_float_s': 0.0, 'noair_s': 0.0, 'reflex_n': Counter(), 'deaths': 0,
            'pos_dist': [], 'ticks': [], 'versions': Counter()}


def trig(t):
    t = t or '?'
    if t.startswith('llm:'):
        return 'llm'
    return t


def craft_cls(d):
    d = d or ''
    if 'banking is refused' in d or 'frees slots' in d or 'deposit' in d[:40]:
        return 'bag_full_redirect'
    if d.startswith('cannot craft') or 'short' in d[:80]:
        return 'missing_ingredients'
    if 'already' in d[:120] or 'redundant' in d:
        return 'redundant'
    if d in ('stagnation', 'entombed', 'aborted'):
        return 'interrupted'
    return 'other'


def td_cls(r):
    d = r['d'] or ''
    if r['s'] == 'success':
        return 'ok'
    if 'nothing to bank' in d:
        return 'nothing_to_bank'
    if 'full' in d[:60]:
        return 'chests_full'
    if 'unreachable' in d or 'unopenable' in d:
        return 'unreachable'
    return r['s'] + ':other'


def run(days):
    out = {}
    for path in sorted(glob.glob(os.path.join(ROWS, '*.jsonl.gz'))):
        day = os.path.basename(path)[:10]
        if days and day not in days:
            continue
        W = defaultdict(new)
        with gzip.open(path, 'rt') as f:
            for l in f:
                r = json.loads(l)
                w = world(r['p'])
                if w not in HOMES:
                    continue
                X = W[w]
                k = r['k']
                h = (r['ms'] or 0) / 3.6e6
                hx, hy, hz = HOMES[w]
                dist = None
                if r.get('x') is not None and r.get('z') is not None:
                    dist = math.hypot(r['x'] - hx, r['z'] - hz)
                if r.get('tick'):
                    X['ticks'].append(r['tick'])
                if r.get('v'):
                    X['versions'][r['v']] += 1
                if not k.startswith('_'):
                    X['skill_h'][k] += h
                    X['skill_n'][k] += 1
                    if dist is not None:
                        X['pos_dist'].append(round(dist))
                if k == 'gather':
                    b = r['a'].get('block')
                    c = cat(b)
                    X['gather_n'] += 1
                    X['gather_n_by'][c] += 1
                    X['gather_h'] += h
                    X['gather_h_by'][c] += h
                    o = gfail(r)
                    X['gather_out'][o] += 1
                    X['gather_out_by'][c][o] += 1
                    for it, v in (r['inv'] or {}).items():
                        if v > 0:
                            X['gather_items_by'][cat(it)] += v
                    if o == 'ok':
                        X['gather_ok'] += 1
                        X['gather_ok_by'][c] += 1
                        if dist is not None:
                            X['gok_dist'][c].append(round(dist))
                        if r.get('y') is not None:
                            X['gok_depth'].append(round(hy - r['y']))
                        if c == 'dirt':
                            X['gather_dirt_trig'][trig(r['tr'])] += 1
                elif k == 'mine':
                    X['mine_n'] += 1
                    X['mine_h'] += h
                    if r['s'] == 'success':
                        X['mine_ok'] += 1
                    else:
                        X['mine_fc'][r['fc'] or r['s']] += 1
                    ore = False
                    for it, v in (r['inv'] or {}).items():
                        if v > 0:
                            X['mine_items_by'][cat(it)] += v
                            ore = ore or cat(it) == 'ore'
                    if ore and r['s'] == 'success':
                        X['mine_ok_ore'] += 1
                elif k == 'craft':
                    it = r['a'].get('item', '?')
                    X['craft_by'][it][r['s']] += 1
                    if r['s'] != 'success':
                        X['craft_fail_cls'][craft_cls(r['d'])] += 1
                elif k == 'town_deposit':
                    X['td_n'] += 1
                    X['td_ok'] += r['s'] == 'success'
                    X['td_cls'][td_cls(r)] += 1
                elif k == 'deposit':
                    X['dep_n'] += 1
                    X['dep_ok'] += r['s'] == 'success'
                elif k == 'explore':
                    X['explore_n'] += 1
                    X['explore_ok'] += r['s'] == 'success'
                    X['explore_h'] += h
                    X['explore_h_trig'][trig(r['tr'])] += h
                    for it, v in (r['inv'] or {}).items():
                        if v > 0:
                            X['explore_gain'][cat(it)] += v
                elif k == 'goto':
                    X['goto_n'] += 1
                    X['goto_h_trig'][trig(r['tr'])] += h
                elif k == 'home':
                    X['home_h_trig'][trig(r['tr'])] += h
                elif k == 'surface':
                    X['surface_h_trig'][trig(r['tr'])] += h
                elif k in ('_water_float_ended', '_water_surface_ended', '_water_no_air_route_ended',
                           '_water_surface_out_ended'):
                    m = HELD.search(r['d'] or '')
                    s = float(m.group(1)) if m else 0.0
                    if k == '_water_float_ended':
                        X['float_s'] += s
                    elif k == '_water_surface_ended':
                        X['surface_float_s'] += s
                    else:
                        X['noair_s'] += s
                elif k == '_death':
                    X['deaths'] += 1
                if k.startswith('_'):
                    X['reflex_n'][k] += 1
        D = {}
        for w, X in W.items():
            Y = {}
            for kk, v in X.items():
                if kk == 'gok_dist':
                    allv = [d for c in v.values() for d in c]
                    Y['gok_dist_q'] = {c: [q(v[c], .5), q(v[c], .75), q(v[c], .9), len(v[c])] for c in v}
                    Y['gok_dist_q']['all'] = [q(allv, .5), q(allv, .75), q(allv, .9), len(allv)]
                    Y['gok_beyond'] = {c: [sum(d > b for d in (v[c] if c != 'all' else allv)) for b in (48, 100, 200)]
                                       for c in list(v) + ['all']}
                elif kk == 'gok_depth':
                    Y['gok_deep_share'] = (sum(d > 8 for d in v) / len(v)) if v else None
                elif kk == 'pos_dist':
                    Y['pos_dist_q'] = [q(v, .5), q(v, .75), q(v, .9), len(v)]
                    Y['pos_bands'] = [sum(d <= 48 for d in v), sum(48 < d <= 100 for d in v),
                                      sum(100 < d <= 200 for d in v), sum(d > 200 for d in v)]
                elif kk == 'ticks':
                    Y['tick_med'] = q(v, .5)
                elif kk == 'craft_by':
                    Y['craft_by'] = {i: dict(c) for i, c in v.items()}
                elif kk == 'gather_out_by':
                    Y['gather_out_by'] = {i: dict(c) for i, c in v.items()}
                elif isinstance(v, Counter):
                    Y[kk] = dict(v)
                else:
                    Y[kk] = v
            D[w] = Y
        out[day] = D
        print(day, 'worlds', len(D), flush=True)
    return out


if __name__ == '__main__':
    res = run(sys.argv[1:])
    p = os.path.join(HERE, 'out', 'analyze.json')
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(res)
    json.dump(old, open(p, 'w'), sort_keys=True)
