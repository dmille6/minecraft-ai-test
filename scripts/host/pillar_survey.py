#!/usr/bin/env python3
"""pillars-01show, survey step 2 (HOST SIDE, read-only copies, never on the showcase VM): the lone pillars outside the walls.

    python3 scripts/host/pillar_survey.py --cand cand.json --cp cp.json --ctx ctx.json --zones protected-zones.json --out pillars.json

Inputs: pillar-colscan.mjs's candidates (the vision render's rule over a region copy), floatclean_cp.py's cp.json over the same
copy (with a passing positive control), the town's walls and project boxes (ctx.json, as the sites/vision scans read them) and
the protected zones. A candidate is OUTSIDE when it is in no walled ring, no project box (+1) and no wall column (vision.py 1b).

Each outside pillar's BODY is its column from the neighbourhood median + 1 to its top. A body block is PROVEN when CoreProtect's
last row on the cell is a bot's placement of the same block (dirt and grass count as one). A pillar is
  proven    every body block proven                       -> the job list (a bot may take it down)
  partial   some body blocks proven                       -> the job list takes only its proven top run (never a natural block)
  natural   no body block proven                          -> never touched
and zoned (a protected zone's cell) pillars are held whatever their proof. Out: { census, pillars: [...] } ordered by distance
from home; prints `_pillar op=survey` with the census out of the full list.
"""
import argparse
import collections
import json
import math
import sys

RINGS = [(-46, -20, 35, 39), (-40, -89, 35, -20)]   # the walled town (vision.py: old ring + extension)
FAMILY = {'grass_block': 'dirt'}


def fam(n):
    n = str(n).replace('minecraft:', '')
    return FAMILY.get(n, n)


def inbox(x, z, b, pad=0):
    return b[0] - pad <= x <= b[2] + pad and b[1] - pad <= z <= b[3] + pad


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--cand', required=True)
    ap.add_argument('--cp', required=True)
    ap.add_argument('--ctx', required=True)
    ap.add_argument('--zones', required=True)
    ap.add_argument('--home', default='0,70,0')
    ap.add_argument('--out', required=True)
    ap.add_argument('--list-out', default=None, help="the bot's list (bots/src/pillarclean/<pool>.json shape)")
    ap.add_argument('--pool', default='showcase')
    ap.add_argument('--walk-r', type=int, default=160, help='PL.walkR: nothing further from home is listed')
    ap.add_argument('--surveyed-at', type=int, default=None, help='ms; default: the CoreProtect window end (the copy\'s time)')
    a = ap.parse_args(argv)
    cand = json.load(open(a.cand))
    cp = json.load(open(a.cp))
    if not cp.get('controls') or not all(c['found'] for c in cp['controls']):
        print('the CoreProtect read carries no passing positive control: refusing', file=sys.stderr)
        return 3
    cells = cp['cells']
    ctx = json.load(open(a.ctx))
    proj = []
    for n, i in ctx['projects'].items():
        if isinstance(i, dict) and i.get('box') and n not in ('country', 'tower', 'tidy', 'paths', 'road', 'decor', 'dress', 'wood'):
            proj.append((n, tuple(i.get('cellbox') or i['box'])))
    if ctx['projects'].get('shrine', {}).get('cellbox'):
        proj.append(('shrine', tuple(ctx['projects']['shrine']['cellbox'])))
    wall = {(x, z) for x, z, _ in ctx['wall']}
    zones = [z['box'] for z in json.load(open(a.zones)).get('zones', []) if len(z.get('box', [])) == 6]
    hx, hy, hz = (int(v) for v in a.home.split(','))
    census = collections.Counter()
    out = []
    for c in cand['cand']:
        x, z = c['x'], c['z']
        census['candidates'] += 1
        if any(inbox(x, z, r) for r in RINGS) or any(inbox(x, z, b, 1) for _, b in proj) or (x, z) in wall:
            census['inside_town_or_project'] += 1
            continue
        census['outside'] += 1
        body = []
        for y, name in c['body']:
            e = cells.get(f'{x},{y},{z}')
            ok = bool(e) and fam(e['block']) == fam(name)
            body.append({'y': y, 'name': name, 'proven': ok, 'user': e['user'] if ok else None, 't': e['t'] if ok else None})
        nproven = sum(b['proven'] for b in body)
        # the proven TOP run: from the top down while proven (a partial pillar loses only bot blocks over natural ground)
        run = []
        for b in reversed(body):
            if not b['proven']:
                break
            run.append(b)
        kind = 'proven' if nproven == len(body) else ('partial' if nproven else 'natural')
        zoned = any(b[0] <= x <= b[3] and b[2] <= z <= b[5] and b[1] <= c['top'] <= b[4] for b in zones)
        census[kind] += 1
        if zoned:
            census[f'zoned_{kind}'] += 1
        users = collections.Counter(b['user'] for b in body if b['user'])
        ts = [b['t'] for b in body if b['t']]
        sea = c['base'] in ('water', 'ice', 'packed_ice', 'blue_ice')
        if kind != 'natural':
            census['sea' if sea else 'land'] += 1
        out.append({'x': x, 'z': z, 'top': c['top'], 'med': c['med'], 'base': c['base'], 'sea': sea, 'kind': kind, 'zoned': zoned,
                    'height': len(body), 'proven': nproven, 'take': [[x, b['y'], z, b['name'], b['user']] for b in run] if not zoned else [],
                    'users': dict(users), 't0': min(ts) if ts else None, 't1': max(ts) if ts else None,
                    'dist': max(abs(x - hx), abs(z - hz)), 'body': body})
    out.sort(key=lambda p: (p['dist'], p['x'], p['z']))
    census['take_blocks'] = sum(len(p['take']) for p in out)
    census['listed'] = sum(1 for p in out if p['take'])
    doc = {'v': 1, 'census': dict(census), 'source': {'cand': a.cand, 'cp': a.cp, 'cp_window': cp.get('window'), 'controls': cp['controls']},
           'pillars': out}
    json.dump(doc, open(a.out, 'w'))
    if a.list_out:
        lp = [p for p in out if p['take'] and p['dist'] <= a.walk_r]
        lst = {'v': 1, 'pool': a.pool, 'surveyedAt': a.surveyed_at or int((cp.get('window') or [0, 0])[1]) * 1000,
               'source': doc['source'], 'census': {**dict(census), 'list_pillars': len(lp), 'list_cells': sum(len(p['take']) for p in lp),
                                                   'far': sum(1 for p in out if p['take'] and p['dist'] > a.walk_r)},
               'pillars': [{'id': i, 'x': p['x'], 'z': p['z'], 'med': p['med'], 'top': p['top'], 'sea': p['sea'], 'kind': p['kind'],
                            'take': p['take']} for i, p in enumerate(lp)]}
        json.dump(lst, open(a.list_out, 'w'), separators=(',', ':'))
        print(f"_pillar op=list pillars={len(lp)} cells={lst['census']['list_cells']} far={lst['census']['far']} out={a.list_out}")
    print('_pillar op=survey ' + ' '.join(f'{k}={v}' for k, v in sorted(census.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
