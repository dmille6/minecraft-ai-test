#!/usr/bin/env python3
"""bamboo-03 abort scene oracle: python3 bamboo-abort-summary.py <log-root> <results-cand.jsonl> [<results-ctrl.jsonl>]

<log-root> holds one <tag>/skill-<bot>.jsonl per trial (the driver's LOG_DIR; the first 10-19 run wrote them under
sandbox/log/bamboo-ab/). Per rep, the SERVER's truth (RCON slots before / 6 s after the fold, the ground then and after
logout) against the fold row and the stopped craft's _craft_sync row:
  CONSERVED  bamboo spent on the server == 2 x sticks made on the server; no bamboo/stick on the ground (incl. after
             logout, where the server returns or drops whatever an interrupted craft left in the 2x2 grid / cursor)
  TALLY      the row's crafts == sticks made on the server (bamboo-02's defect: one short when a craft was in flight)
  INFLIGHT   the row credited an in-flight craft (args.inflight == 1): the scene reached the path
"""
import json
import os
import sys


def tot(t, k):
    return int((t or {}).get(k, 0))


def rows_of(root, tag):
    out = []
    d = os.path.join(root, tag)
    for f in (os.listdir(d) if os.path.isdir(d) else []):
        if f.startswith('skill-'):
            for line in open(os.path.join(d, f), 'rb'):
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return [r.get('skill') or {} for r in out]


root = sys.argv[1]
for f in sys.argv[2:]:
    print('==', f)
    agg = {'reps': 0, 'aborted': 0, 'conserved': 0, 'tally_ok': 0, 'inflight': 0, 'one_short': 0, 'ground': 0}
    for line in open(f):
        r = json.loads(line)
        sk = rows_of(root, r['tag'])
        folds = [x for x in sk if x.get('name') == '_bamboo_sticks']
        syncs = [x for x in sk if x.get('name') == '_craft_sync']
        if not folds:
            print(r['id'], r['tag'], 'NO FOLD ROW')
            continue
        row = folds[0]
        a = row.get('args') or {}
        last = (syncs[-1].get('args') or {}) if syncs else {}
        b, lat = r['before']['totals'], r['later']['totals']
        spent = tot(b, 'bamboo') - tot(lat, 'bamboo')
        made = tot(lat, 'stick') - tot(b, 'stick')
        ground = [g for g in (r['after']['ground'] + r['later']['ground'] + r['groundAfterLogout']) if g['id'] in ('bamboo', 'stick')]
        cons = spent == 2 * made and not ground
        tally = a.get('crafts') == made
        agg['reps'] += 1
        agg['aborted'] += row.get('status') == 'aborted'
        agg['conserved'] += cons
        agg['tally_ok'] += tally
        agg['inflight'] += a.get('inflight') == 1
        agg['one_short'] += a.get('crafts') == made - 1
        agg['ground'] += bool(ground)
        print('%-26s %-8s stop=%-20s hurt@%-6s server bamboo -%d sticks +%d | row crafts=%s inflight=%s | stopped craft %s/%s grid_clear=%s | %s %s ground=%s planks %d->%d' % (
            r['tag'], row.get('status'), a.get('stop'), (r.get('hurt') or {}).get('atMs'), spent, made, a.get('crafts'),
            a.get('inflight'), last.get('outcome'), last.get('verify_source'), last.get('grid_clear'),
            'CONSERVED' if cons else 'NOT-CONSERVED', 'TALLY-OK' if tally else 'TALLY-OFF', ground,
            tot(b, 'oak_planks'), tot(lat, 'oak_planks')))
    print('  ', agg)
