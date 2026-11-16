#!/usr/bin/env python3
"""standprep.py <pool-state-dir> --home X Y Z --out standin.json [--logs GLOB ...] [--days 5] [--min-visits 3] [--town-r 16]

THE INPUT FOR THE STAND REPLAY (bots/scripts/standreplay-offline.mjs; stepclass-01 / civicvisit-01show). READ-ONLY: it reads a
pool's state directory (/var/lib/mcai/_pool-<pool>, or a copy) and, when asked, bot logs; it writes --out and nothing else.

What it collects, for the town at --home (the project key is project-<X>_<Y>_<Z>):
  * every cell on the projects' stuck files (project-<key>.<plot>.stuck.*.json) seen in the last --days days, its visits summed
    over the files; a project's cells with at least --min-visits visits are kept;
  * from each such project's newest record generation (project-<key>.<plot>.g<N>.json): box, walkR, blueprint, standDom, home, the
    count of waived cells, and for each stuck cell what the record says of it (role, seg, blind) -- a stepwell's scaffold stands
    (site.stands) count as cells of segment `stand`;
  * the walk's seeds: the feet cells the bots stood on in town -- the pool's own stood file (project-<key>.shop.stood.jsonl and
    .old, what a visit seeds its walk with), and with --logs every `"pos"` a bot logged within --town-r (Chebyshev) of home in
    the files the globs match.

Output: { home: [x, y, z], projects: { <plot>: { box, walkR, blueprint, standDom, home, waived, cells: [{ c: [x, y, z], visits,
role?, seg?, blind? }] } }, stood: [[x, y, z]] }, cells and projects sorted. One summary line a project on stdout. Stdlib only.

Then, with a block dump of the same ground (scripts/host/townplan_blockdump.py over COPIES of the region files):
  node bots/scripts/standreplay-offline.mjs dump.json standin.json --home X Y Z
"""
import argparse, glob, json, os, re, sys, time
from collections import defaultdict


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def cell_at(c):
    """A record cell's position -> [x, y, z] | None (`at`, the builds' own; `cell` / `pos` / x,y,z for the older shapes)."""
    p = c.get('at') or c.get('cell') or c.get('pos') or ([c.get('x'), c.get('y'), c.get('z')] if 'x' in c else None)
    if isinstance(p, list) and len(p) >= 3 and all(isinstance(v, (int, float)) for v in p[:3]):
        return [int(p[0]), int(p[1]), int(p[2])]
    return None


def collect(pool, home, days=5.0, min_visits=3, now=None):
    """-> { plot: project } from the pool's stuck files and newest records. Pure over the directory."""
    key = 'project-%d_%d_%d' % tuple(home)
    now = time.time() if now is None else now
    since_ms = (now - days * 86400) * 1000
    cells = defaultdict(lambda: defaultdict(int))
    stuck_re = re.compile(r'^' + re.escape(key) + r'\.(\w+)\.stuck\.')
    rec_re = re.compile(r'^' + re.escape(key) + r'\.(\w+)\.g(\d+)\.json$')
    names = sorted(os.listdir(pool))
    for name in names:
        m = stuck_re.match(name)
        if not m or not name.endswith('.json'):
            continue
        d = load(os.path.join(pool, name))
        if not isinstance(d, dict):
            continue
        for c, v in (d.get('cells') or {}).items():
            if isinstance(v, dict) and (v.get('lastAt') or 0) > since_ms:
                cells[m.group(1)][c] += int(v.get('visits') or 0)
    newest = {}
    for name in names:
        m = rec_re.match(name)
        if m and int(m.group(2)) >= newest.get(m.group(1), (-1, None))[0]:
            newest[m.group(1)] = (int(m.group(2)), name)
    out = {}
    for plot in sorted(cells):
        if plot not in newest:
            continue
        j = load(os.path.join(pool, newest[plot][1]))
        if not isinstance(j, dict):
            continue
        rec = j.get('rec') if isinstance(j.get('rec'), dict) else j
        want = {}
        for c in rec.get('cells') or []:
            if not isinstance(c, dict):
                continue
            p = cell_at(c)
            if p:
                want['%d,%d,%d' % tuple(p)] = {k: c[k] for k in ('role', 'seg', 'blind') if c.get(k) is not None}
        for s in ((rec.get('site') or {}).get('stands') or []):
            if isinstance(s, list) and len(s) >= 3:
                want.setdefault('%d,%d,%d' % tuple(int(v) for v in s[:3]), {'role': 'stand', 'seg': 'stand'})
        kept = []
        for c, n in cells[plot].items():
            try:
                at = [int(v) for v in c.split(',')]
            except ValueError:
                continue
            if n >= min_visits and len(at) == 3:
                kept.append(dict({'c': at, 'visits': n}, **want.get(c, {})))
        kept.sort(key=lambda q: q['c'])
        waived = rec.get('waived')
        out[plot] = {k: v for k, v in {
            'box': rec.get('box'), 'walkR': rec.get('walkR'), 'blueprint': rec.get('blueprint'), 'standDom': rec.get('standDom'),
            'home': rec.get('home'), 'waived': len(waived) if isinstance(waived, (dict, list)) else 0, 'gen': newest[plot][0], 'cells': kept,
        }.items() if v is not None}
    return out


POS = re.compile(r'"pos":\s*\{"x":\s*(-?[\d.]+),\s*"y":\s*(-?[\d.]+),\s*"z":\s*(-?[\d.]+)')


def stood_cells(pool, home, globs=(), town_r=16):
    """-> sorted [[x, y, z]]: the pool's stood file, and the logged positions within town_r of home."""
    key = 'project-%d_%d_%d' % tuple(home)
    stood = set()
    for name in (key + '.shop.stood.jsonl.old', key + '.shop.stood.jsonl'):
        try:
            with open(os.path.join(pool, name), errors='replace') as f:
                for line in f:
                    try:
                        c = json.loads(line).get('c')
                    except Exception:
                        continue
                    if isinstance(c, list) and len(c) == 3 and all(isinstance(v, (int, float)) for v in c):
                        stood.add((int(c[0]), int(c[1]), int(c[2])))
        except OSError:
            continue
    for g in globs:
        for path in sorted(glob.glob(g)):
            try:
                with open(path, errors='replace') as f:
                    for line in f:
                        i = line.find('"pos"')
                        if i < 0:
                            continue
                        m = POS.search(line[i:i + 90])
                        if not m:
                            continue
                        x, y, z = float(m.group(1)), float(m.group(2)), float(m.group(3))
                        if max(abs(x - home[0]), abs(z - home[2])) <= town_r:
                            stood.add((int(x // 1), int((y + 0.2) // 1), int(z // 1)))
            except OSError:
                continue
    return [list(c) for c in sorted(stood)]


def main(argv=None):
    ap = argparse.ArgumentParser(description='Collect the stuck cells and stood cells of a pool for standreplay-offline.mjs (read-only).')
    ap.add_argument('pool', help='the pool state directory (or a copy), e.g. /var/lib/mcai/_pool-showcase')
    ap.add_argument('--home', nargs=3, type=int, required=True, metavar=('X', 'Y', 'Z'))
    ap.add_argument('--out', required=True, help='the JSON to write')
    ap.add_argument('--logs', nargs='*', default=[], metavar='GLOB', help='bot skill logs to take stood positions from')
    ap.add_argument('--days', type=float, default=5.0)
    ap.add_argument('--min-visits', type=int, default=3)
    ap.add_argument('--town-r', type=int, default=16)
    a = ap.parse_args(argv)
    if not os.path.isdir(a.pool):
        print('no such directory: %s' % a.pool, file=sys.stderr)
        return 2
    projects = collect(a.pool, a.home, a.days, a.min_visits)
    stood = stood_cells(a.pool, a.home, a.logs, a.town_r)
    for plot, p in projects.items():
        print('%s stuck_cells=%d box=%s walkR=%s waived=%d gen=%s' % (plot, len(p['cells']), p.get('box'), p.get('walkR'), p['waived'], p.get('gen')))
    print('stood_cells=%d projects=%d' % (len(stood), len(projects)))
    with open(a.out, 'w') as f:
        json.dump({'home': list(a.home), 'projects': projects, 'stood': stood}, f)
        f.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
