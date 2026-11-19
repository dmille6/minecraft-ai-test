#!/usr/bin/env python3
"""grade_pct: how much of the town's ground stands at the ground plan's height with an earth top (gradetidy-01show, T11 bundle (d)).

    python3 scripts/host/gradepct.py --target TARGET.json --region REGION_DIR [--gate GRADE-TARGET.json] [--before PREV.json]
                                     [--out OUT.json] [--tlregion PATH/tl_region.py]

Runs on a host with a COPY of the timelapse mirror's region files (ci2), NEVER on the showcase VM (.40). TARGET is the plan
(docs/reports/gradeplan-2026-11-18/draft3/target.json: box, h, class) or the pool's published grade-target.json (the same plus
v, sha256 and a gate).

    grade_pct = ground columns with h == target AND an earth top (grass_block, dirt, coarse_dirt, podzol, rooted_dirt,
                mycelium, moss_block, dirt_path) / ground columns                       (ground = classes t, b, a, e)

reported town-wide, per TERRACE (a 4-connected run of class `t` at one target height; named from the plan's `terraces` list
when the run's height and size match one, else `y<h>#<n>`; T11 is the run at y69 holding x10 z-26), and for the GATE (the
published file's columns). Beside it: the height-only share, the 2+ steps between neighbouring ground columns (town-wide and
touching each terrace / the gate, split ground-ground and ground-fixed), and -- with --before (an earlier run's --out) -- the
columns outside the gate whose height changed. CONTROL: the columns read (a top found) and the columns unread; a run that read
nothing raises (a zero is a failed read, not a flat town).
"""
import argparse, collections, json, os, sys

EARTH = {'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'moss_block', 'dirt_path'}
GROUND_CLS = set('tbae')
AIRY = {'air', 'cave_air', 'void_air'}
SOFT = ('leaves', 'log', 'short_grass', 'tall_grass', 'fern', 'flower', 'dandelion', 'poppy', 'tulip', 'sapling', 'snow', 'vine',
        'bush', 'petals', 'azure', 'oxeye', 'cornflower', 'allium', 'lily', 'orchid', 'mushroom', 'sugar_cane', 'bamboo', 'torch',
        'moss_carpet', 'carpet', 'seagrass', 'kelp')
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


class ReadFailed(Exception):
    pass


def soft(n):
    return n in AIRY or (n != 'grass_block' and any(s in n for s in SOFT))


def short(n):
    return n.replace('minecraft:', '').split('[')[0]


def columns_from_box(d, x0, z0, x1, z1, y0, y1):
    """read_box's result -> ({(x, z): h}, {(x, z): top}); a column with no top read is absent from both."""
    names = [short(p) for p in d['palette']]
    cells = d['cells']
    nx, nz, ny = x1 - x0 + 1, z1 - z0 + 1, y1 - y0 + 1
    H, TOP = {}, {}
    for z in range(nz):
        for x in range(nx):
            for y in range(ny - 1, -1, -1):
                n = names[cells[x + nx * (z + nz * y)]]
                if n == '?':
                    break
                if soft(n):
                    continue
                H[(x + x0, z + z0)] = y + y0
                TOP[(x + x0, z + z0)] = n
                break
    return H, TOP


class Plan:
    def __init__(self, t):
        self.box = t['box']
        self.h = t['h']
        self.cls = t['class']
        self.terr = t.get('terraces') or []
        self.gate = {tuple(c) for c in ((t.get('gate') or {}).get('cols') or [])}

    def at(self, x, z):
        x0, z0, x1, z1 = self.box
        if not (x0 <= x <= x1 and z0 <= z <= z1):
            return None, None
        return self.h[z - z0][x - x0], self.cls[z - z0][x - x0]

    def ground(self):
        x0, z0, x1, z1 = self.box
        return [(x, z) for z in range(z0, z1 + 1) for x in range(x0, x1 + 1) if self.at(x, z)[1] in GROUND_CLS]

    def terraces(self):
        """{name: set of (x, z)}: 4-connected runs of class t at one target height."""
        seen, out, k = set(), {}, collections.Counter()
        named = collections.defaultdict(list)
        for tr in self.terr:
            named[(tr.get('y'), tr.get('id'))].append(tr)
        for c in self.ground():
            if c in seen or self.at(*c)[1] != 't':
                continue
            y = self.at(*c)[0]
            run, st = {c}, [c]
            seen.add(c)
            while st:
                x, z = st.pop()
                for dx, dz in N4:
                    n = (x + dx, z + dz)
                    if n not in seen and self.at(*n)[1] == 't' and self.at(*n)[0] == y:
                        seen.add(n); run.add(n); st.append(n)
            k[y] += 1
            out[f'y{y}#{k[y]}'] = run
        # name T11 (the release-1 terrace) and any run whose height is a plan terrace's and holds its listed centre
        renamed = {}
        for name, run in out.items():
            nm = name
            if (10, -26) in run:
                nm = 'T11'
            renamed[nm] = run
        return renamed


def measure(plan, H, TOP, before=None):
    """The numbers. Pure over (plan, H, TOP). -> dict."""
    ground = plan.ground()
    read = [c for c in ground if c in H]
    if not read:
        raise ReadFailed('no ground column read: the region read failed (not a flat town)')

    def stat(cols):
        # Codex T11 r1 BLOCKER 4: the denominator is EVERY ground column; an unread one counts as not at grade and is named
        allc = list(cols)
        cols = [c for c in allc if c in H]
        unread = len(allc) - len(cols)
        at = [c for c in cols if H[c] == plan.at(*c)[0]]
        ok = [c for c in at if TOP[c] in EARTH]
        tops = collections.Counter(TOP[c] for c in at if TOP[c] not in EARTH)
        return {'columns': len(allc), 'unread': unread, 'at_height': len(at), 'at_height_earth': len(ok),
                'grade_pct': round(100.0 * len(ok) / len(allc), 1) if allc else None,
                'height_pct': round(100.0 * len(at) / len(allc), 1) if allc else None,
                'other_tops_at_height': dict(tops.most_common(8))}

    def steps(cols):
        cs = set(cols)
        gg = gf = 0
        pairs = set()
        for c in cs:
            if c not in H:
                continue
            for dx, dz in N4:
                n = (c[0] + dx, c[1] + dz)
                if n not in H or (n in cs and (n, c) in pairs):
                    continue
                pairs.add((c, n))
                if abs(H[c] - H[n]) < 2:
                    continue
                cl = plan.at(*n)[1]
                if cl in GROUND_CLS:
                    gg += 1
                elif cl == 'f':
                    gf += 1
        return {'ground_ground_2plus': gg, 'ground_fixed_2plus': gf}

    out = {'control': {'ground_columns': len(ground), 'read': len(read), 'unread': len(ground) - len(read)},
           'town': {**stat(ground), **steps(ground)}, 'terraces': {}}
    for name, run in sorted(plan.terraces().items()):
        out['terraces'][name] = {**stat(run), **steps(run), 'target_y': plan.at(*next(iter(run)))[0]}
    if plan.gate:
        g = [c for c in plan.gate if plan.at(*c)[1] in GROUND_CLS]
        out['gate'] = {**stat(g), **steps(g)}
        out['town_outside_gate'] = stat([c for c in ground if c not in plan.gate])
    if before is not None:
        bh = {tuple(map(int, k.split(','))): v for k, v in before.items()}
        outside = [c for c in ground if c not in plan.gate and c in H and c in bh]
        changed = [c for c in outside if H[c] != bh[c]]
        out['changed_outside_gate'] = {'compared': len(outside), 'changed': len(changed), 'cols': [list(c) for c in changed[:50]]}
    out['heights'] = {f'{x},{z}': H[(x, z)] for (x, z) in read}
    return out


GREY = {'cobblestone', 'cobbled_deepslate', 'stone', 'mossy_cobblestone'}
OWNERS = ('paths', 'decor', 'dress')


def owned_by_others(pool):
    """{(x, z)} named by the paths, decor and dress records (their newest generation: cells and zone boxes) in a pool copy."""
    import glob, re
    out = set()
    for kind in OWNERS:
        fs = [f for f in glob.glob(os.path.join(pool, f'project-*.{kind}.g*.json')) if re.search(rf'\.{kind}\.g\d+\.json$', f)]
        if not fs:
            continue
        r = json.load(open(max(fs, key=lambda f: int(re.search(r'\.g(\d+)\.json$', f).group(1)))))
        for c in r.get('cells') or []:
            a = c.get('at') if isinstance(c, dict) else None
            if a:
                out.add((a[0], a[2]))
        for zb in r.get('zones') or []:
            b = zb.get('box') if isinstance(zb, dict) else None
            if b and len(b) == 6:
                for x in range(b[0], b[3] + 1):
                    for z in range(b[2], b[5] + 1):
                        out.add((x, z))
    return out


def newest_tidy(pool):
    import glob, re
    fs = [f for f in glob.glob(os.path.join(pool, 'project-*.tidy.g*.json')) if re.search(r'\.tidy\.g\d+\.json$', f)]
    return json.load(open(max(fs, key=lambda f: int(re.search(r'\.g(\d+)\.json$', f).group(1))))) if fs else None


def deferred_cols(plan, H, blk, cols):
    """The columns the grade DEFERS (gradetidy.mjs GRADE.hollow 1: a hollow deeper than the target cell under a crust) -> set. Read
    from the world alone, never the survey: ground above the target, and air AT the target and the cell below it."""
    out = set()
    for c in cols:
        if c not in H:
            continue
        y = plan.at(*c)[0]
        if H[c] > y and blk(c[0], y, c[1]) in AIRY and blk(c[0], y - 1, c[1]) in AIRY:
            out.add(c)
    return out


def criteria(plan, H, TOP, others=frozenset(), rec=None, keep=None, steps_floor=30, grey_max=39, deferred=frozenset(), keep_share=0.95):
    """THE RELEASE-1 READ (control 11-18), each criterion with its count and its verdict. Pure.
       owned   the gate's columns no other record (paths, decor, dress) names: the denominator
       keep    owned columns at target height with an earth top >= `keep`
       outside grade cells and cuts on the tidy record outside the gate == 0 (needs `rec`)
       steps   ground-ground 2+ pairs with a side in the gate <= `steps_floor` (control 11-18: 30, the 06:30Z baseline; 8 is the floor)
       grey    gate columns at target height with a grey top <= `grey_max` (11-18 06:30Z: 39)"""
    gate = {c for c in plan.gate if plan.at(*c)[1] in GROUND_CLS}
    owned = sorted(c for c in gate if c not in others)
    unread = [c for c in owned if c not in H]
    ok = [c for c in owned if c in H and H[c] == plan.at(*c)[0] and TOP[c] in EARTH]
    pairs = set()
    for c in gate:
        if c not in H:
            continue
        for dx, dz in N4:
            n = (c[0] + dx, c[1] + dz)
            if n in H and plan.at(*n)[1] in GROUND_CLS and abs(H[c] - H[n]) >= 2:
                pairs.add(tuple(sorted((c, n))))
    grey = [c for c in gate if c in H and H[c] == plan.at(*c)[0] and TOP[c] in GREY]
    import math
    others_g = [c for c in gate if c in others]
    deferred_owned = [c for c in owned if c in deferred]
    others_ok_n = sum(1 for c in others_g if c in H and H[c] == plan.at(*c)[0] and TOP[c] in EARTH)
    den = len(gate) - (len(others_g) - others_ok_n)
    need = keep if keep is not None else math.ceil(keep_share * (den - len(deferred_owned)))
    others_ok = [c for c in others_g if c in H and H[c] == plan.at(*c)[0] and TOP[c] in EARTH]
    out = {'owned': len(owned), 'others_in_gate': len(others_g), 'others_ok': len(others_ok),
           'gate_ok': len(ok) + len(others_ok), 'gate': len(gate), 'unread': len(unread),
           # the KEEP denominator: the gate less the other records' columns NOT at grade (theirs, never the grade's to fix); the other
           # records' columns already at grade stay in it on both sides (a path at its height with its dirt_path is a graded column)
           # control 11-18 (on d80208101): the bar is ceil(95% of (the denominator less the DEFERRED columns)), unless `keep` is given
           'deferred': len(deferred_owned),
           'keep': {'count': len(ok) + len(others_ok), 'of': den, 'deferred': len(deferred_owned), 'grade_owned_ok': len(ok), 'grade_owned': len(owned),
                    'need': need, 'pass': len(ok) + len(others_ok) >= need and not unread},
           'steps': {'count': len(pairs), 'floor': steps_floor, 'pass': len(pairs) <= steps_floor},
           'grey': {'count': len(grey), 'max': grey_max, 'pass': len(grey) <= grey_max}}
    if rec is not None:
        gk = {(x, z) for (x, z) in plan.gate}
        bad = [q['at'] for q in (rec.get('cells') or []) + (rec.get('cut') or []) if q.get('grade') and (q['at'][0], q['at'][2]) not in gk]
        out['outside'] = {'count': len(bad), 'pass': not bad, 'first': bad[:5]}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', required=True)
    ap.add_argument('--region', required=True)
    ap.add_argument('--gate', help='the published grade-target.json (its gate); default: the target file\'s own gate, if any')
    ap.add_argument('--before', help='an earlier run\'s --out (its heights)')
    ap.add_argument('--out')
    ap.add_argument('--tlregion', default=None)
    ap.add_argument('--keep', type=int, default=None, help='a fixed KEEP count; default ceil(95%% of (185 less the deferred columns))')
    ap.add_argument('--steps', type=int, default=30, help='2+ step pairs touching the gate, at most (control 11-18: 30)')
    ap.add_argument('--pool', help='a pool copy: the paths/decor/dress records (the criteria\'s owned columns) and the newest tidy record')
    ap.add_argument('--y0', type=int, default=50)
    ap.add_argument('--y1', type=int, default=115)
    a = ap.parse_args(argv)
    if os.uname().nodename.endswith('showcase') or os.environ.get('MCAI_HOST') == 'showcase':
        sys.exit('refused: never on the showcase VM')
    tlr = a.tlregion or next((p for p in (os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'infra', 'showcase', 'tl_region.py'),
                                          os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tl_region.py')) if os.path.exists(p)), None)
    if not tlr:
        sys.exit('no tl_region.py (pass --tlregion)')
    sys.path.insert(0, os.path.dirname(os.path.abspath(tlr)))
    import importlib
    tl = importlib.import_module(os.path.splitext(os.path.basename(tlr))[0])
    t = json.load(open(a.target))
    if a.gate:
        t = {**t, 'gate': json.load(open(a.gate)).get('gate')}
    plan = Plan(t)
    ground = plan.ground()
    xs, zs = [c[0] for c in ground], [c[1] for c in ground]
    x0, z0, x1, z1 = min(xs) - 1, min(zs) - 1, max(xs) + 1, max(zs) + 1
    d = tl.read_box(a.region, x0, z0, x1, z1, a.y0, a.y1, absent='air')
    H, TOP = columns_from_box(d, x0, z0, x1, z1, a.y0, a.y1)
    before = json.load(open(a.before)).get('heights') if a.before else None
    m = measure(plan, H, TOP, before)
    m['control']['missing_chunks'] = len(d.get('missing') or [])
    if a.pool and plan.gate:
        names = [short(p) for p in d['palette']]
        nx, nz = x1 - x0 + 1, z1 - z0 + 1
        def blk(x, y, z):
            if not (x0 <= x <= x1 and z0 <= z <= z1 and a.y0 <= y <= a.y1):
                return '?'
            return names[d['cells'][(x - x0) + nx * ((z - z0) + nz * (y - a.y0))]]
        gate_g = [c for c in plan.gate if plan.at(*c)[1] in GROUND_CLS]
        m['criteria'] = criteria(plan, H, TOP, owned_by_others(a.pool), newest_tidy(a.pool), keep=a.keep, steps_floor=a.steps, deferred=deferred_cols(plan, H, blk, gate_g))
    if a.out:
        json.dump(m, open(a.out, 'w'))
    show = {k: v for k, v in m.items() if k != 'heights'}
    print(json.dumps(show, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
