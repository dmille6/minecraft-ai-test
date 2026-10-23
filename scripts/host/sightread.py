#!/usr/bin/env python3
r"""sightread.py -- X1, the EXPLORE SIGHTING-QUALITY READ (cooperation-tier design r9.1, sections 1.2 and 4.4). READ ONLY.

The cooperation census found explore toward a known sighting almost never ends with iron gained near it (10 of 16,958 runs
in the 24 h to 10-23 12:14Z, shared or not). It did not establish WHY. This read splits explore-toward-known runs by what
could explain it, for the expansion lane (E0), with the numbers each bucket rests on:

  reach        did the run END near the sighting? (end position within 8 horizontal and 6 vertical blocks)
  dy           the sighting's height minus the bot's position just before the run (ore seen far below the bot's level)
  distance     the heading's own distance ("(36b)" in the `_explore_toward_known` row)
  co-targeted  a townmate headed for the same sighting in the 30 min before (the census's split)
  still known  the sighting is in the town's world-facts file NOW (a sighting merged over 24 blocks; absence is a proxy
               for decay or pruning, not proof the ore is gone)
  outcome      a raw_iron rise in the bot's bag within 10 min of the run's end, near the sighting (24 / 16) or anywhere;
               each rise is assigned to at most one run (the latest of that bot that ended within 600 s before it)

Positive controls: the window's raw_iron rise events (they must exist for the outcome column to mean anything) and the
heading rows parsed. Every bucket prints n. Snapshot timing: a skill row's position and bag are at its END (start +
duration); event rows at emission.

    python3 -B sightread.py --selftest
    python3 -B sightread.py [--hours 24] [--until ISO] [--out-dir DIR]
"""
import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import bisect  # noqa: E402
import collections  # noqa: E402
import datetime as dt  # noqa: E402
import glob  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
UTC = dt.timezone.utc
HEAD = re.compile(r'heading for (\w+) at (-?\d+),(-?\d+),(-?\d+)(?: \((\d+)b\))?')
RAW = {'iron_ore': 'raw_iron', 'deepslate_iron_ore': 'raw_iron', 'coal_ore': 'coal', 'copper_ore': 'raw_copper'}
REACH_H, REACH_V = 8, 6
NEAR_H, NEAR_V = 24, 16
FOLLOW_S = 600


def end(r):
    return r['t'] + ((r.get('dur') or 0) / 1000.0 if not r['k'].startswith('_') else 0.0)


def hd(a, b):
    return math.hypot(a[0] - b[0], a[2] - b[2])


def dy_bucket(dy):
    return 'below<-20' if dy < -20 else 'below-20..-6' if dy < -5 else 'level-5..5' if dy <= 5 else 'above>5'


def dist_bucket(d):
    return '?' if d is None else '<=24' if d <= 24 else '25-48' if d <= 48 else '>48'


def classify(rows, known_now=()):
    """Rows of one town (compact: t, bot, k, s, dur, d, p, inv) -> [run dict]. Pure."""
    heads = sorted((r['t'], r['bot'], m.group(1), (int(m.group(2)), int(m.group(3)), int(m.group(4))),
                    int(m.group(5)) if m.group(5) else None)
                   for r in rows if r['k'] == '_explore_toward_known' for m in [HEAD.search(r.get('d') or '')] if m)
    hts = [h[0] for h in heads]
    pos = collections.defaultdict(list)
    snaps = collections.defaultdict(list)
    for r in rows:
        if r.get('bot') and r.get('p'):
            if r['k'].startswith('_'):
                pos[r['bot']].append((r['t'], r['p']))
            if 'inv' in r:
                snaps[r['bot']].append((end(r), (r.get('inv') or {}), r['p']))
    for b in pos:
        pos[b].sort()
    for b in snaps:
        snaps[b].sort(key=lambda x: x[0])
    rises = collections.defaultdict(list)
    for b, lst in snaps.items():
        for a, c in zip(lst, lst[1:]):
            for item in set(RAW.values()):
                if c[1].get(item, 0) > a[1].get(item, 0):
                    rises[b].append((c[0], c[2], item))
    runs = []
    for r in rows:
        if r['k'] != 'explore' or not r.get('dur') or not r.get('bot'):
            continue
        i, j = bisect.bisect_left(hts, r['t'] - 2), bisect.bisect_right(hts, r['t'] + 10)
        mine = [h for h in heads[i:j] if h[1] == r['bot']]
        if not mine:
            continue
        t, b, item, xyz, dist = mine[0]
        k0 = bisect.bisect_left(hts, t - 1800)
        peer = any(h[1] != b and h[3] == xyz and h[0] < t for h in heads[k0:bisect.bisect_left(hts, t)])
        pl = pos.get(b) or []
        pj = bisect.bisect_left(pl, (r['t'],)) - 1
        pre = pl[pj][1] if pj >= 0 and r['t'] - pl[pj][0] <= 600 else None
        e = end(r)
        runs.append({'end': e, 'bot': b, 'item': item, 'xyz': xyz, 'dist': dist, 'peer': peer,
                     'dy': (xyz[1] - pre[1]) if pre else None,
                     'reached': bool(r.get('p')) and hd(r['p'], xyz) <= REACH_H and abs(r['p'][1] - xyz[1]) <= REACH_V,
                     'known_now': any(hd(xyz, k) <= 24 and abs(xyz[1] - k[1]) <= 24 for k in known_now),
                     'status': r.get('s'), 'rises': []})
    byb = collections.defaultdict(list)
    for n, x in enumerate(runs):
        byb[x['bot']].append((x['end'], n))
    for b in byb:
        byb[b].sort()
    for b, lst in rises.items():
        el = byb.get(b) or []
        ets = [x[0] for x in el]
        for t, p, item in lst:
            jj = bisect.bisect_right(ets, t) - 1
            if jj >= 0 and t - el[jj][0] <= FOLLOW_S:
                x = runs[el[jj][1]]
                if RAW.get(x['item'], x['item']) == item:
                    x['rises'].append(p)
    for x in runs:
        x['near'] = any(hd(p, x['xyz']) <= NEAR_H and abs(p[1] - x['xyz'][1]) <= NEAR_V for p in x['rises'])
        x['any'] = bool(x['rises'])
        del x['rises']
    return runs, sum(len(v) for v in rises.values())


def table(runs, key):
    T = collections.defaultdict(collections.Counter)
    for x in runs:
        k = key(x)
        T[k]['n'] += 1
        T[k]['near'] += x['near']
        T[k]['any'] += x['any']
        T[k]['reached'] += x['reached']
    return {k: dict(v) for k, v in sorted(T.items(), key=lambda kv: str(kv[0]))}


def summarize(runs):
    return {'runs': len(runs),
            'by_reach': table(runs, lambda x: 'reached' if x['reached'] else 'not_reached'),
            'by_dy': table(runs, lambda x: 'unknown' if x['dy'] is None else dy_bucket(x['dy'])),
            'by_distance': table(runs, lambda x: dist_bucket(x['dist'])),
            'by_cotarget': table(runs, lambda x: 'co-targeted' if x['peer'] else 'fresh'),
            'by_known_now': table(runs, lambda x: 'still_known' if x['known_now'] else 'not_in_file_now'),
            'by_status': table(runs, lambda x: x['status'] or '?')}


def render(S, controls, window):
    L = [f'SIGHTING-QUALITY READ (X1) {window[0]} .. {window[1]}: {S["runs"]} explore runs toward a known sighting']
    for k in ('by_reach', 'by_dy', 'by_distance', 'by_cotarget', 'by_known_now', 'by_status'):
        L.append(f'  {k}:')
        for b, c in S[k].items():
            n = c['n']
            L.append(f'    {b:18s} n {n:6d}  reached {c["reached"]:5d} ({100 * c["reached"] / n:5.1f}%)  iron near '
                     f'{c["near"]:4d} ({100 * c["near"] / n:5.2f}%)  iron anywhere {c["any"]:4d} ({100 * c["any"] / n:5.2f}%)')
    for k, v in controls.items():
        L.append(f'  control {k}: {v}')
    return '\n'.join(L)


def selftest(verbose=True):
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f'{name}: got {got!r}, want {want!r}')
        elif verbose:
            print(f'  ok  {name} = {got!r}')

    rows = [
        # A heads for iron 30 blocks below at (10,40,0) from (0,70,0); the run ends at (9,42,0): reached; raw_iron rises at
        # (9,42,0) 2 min later -> near
        {'t': 99, 'bot': 'A', 'k': '_x', 'p': [0, 70, 0]},
        {'t': 100, 'bot': 'A', 'k': '_explore_toward_known', 'd': 'heading for iron_ore at 10,40,0 (10b) instead of'},
        {'t': 100, 'bot': 'A', 'k': 'explore', 'dur': 60_000, 's': 'success', 'p': [9, 42, 0], 'inv': {'raw_iron': 0}},
        {'t': 280, 'bot': 'A', 'k': 'gather', 'dur': 0, 'p': [9, 42, 0], 'inv': {'raw_iron': 2}},
        # B heads for the same sighting 5 min later (co-targeted), ends 100 blocks away, gains iron far away
        {'t': 399, 'bot': 'B', 'k': '_x', 'p': [0, 70, 0]},
        {'t': 400, 'bot': 'B', 'k': '_explore_toward_known', 'd': 'heading for iron_ore at 10,40,0 (60b) instead of'},
        {'t': 400, 'bot': 'B', 'k': 'explore', 'dur': 60_000, 's': 'failed', 'p': [110, 70, 0], 'inv': {'raw_iron': 1}},
        {'t': 600, 'bot': 'B', 'k': 'mine', 'dur': 0, 'p': [300, 20, 0], 'inv': {'raw_iron': 3}},
    ]
    runs, nr = classify(rows, known_now=[(12, 41, 2)])
    S = summarize(runs)
    check('two runs, two rise events', (len(runs), nr), (2, 2))
    check('A reached, B not', S['by_reach'], {'not_reached': {'n': 1, 'near': 0, 'any': 1, 'reached': 0},
                                              'reached': {'n': 1, 'near': 1, 'any': 1, 'reached': 1}})
    check('dy bucket from the position before the run', sorted(S['by_dy']), ['below<-20'])
    check('co-targeted split', (S['by_cotarget']['co-targeted']['n'], S['by_cotarget']['fresh']['n']), (1, 1))
    check('heading distance buckets', sorted(S['by_distance']), ['<=24', '>48'])
    check('still known now (within 24 of a current sighting)', S['by_known_now'].get('still_known', {}).get('n'), 2)
    if fails:
        print('SELFTEST FAILED:')
        for f in fails:
            print('  !! ' + f)
        return False
    if verbose:
        print('SELFTEST OK')
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--hours', type=float, default=24)
    ap.add_argument('--until')
    ap.add_argument('--out-dir', default=os.path.expanduser('~/sightread/out'))
    ap.add_argument('--state-dir', default='/var/lib/mcai')
    a = ap.parse_args()
    if a.selftest:
        return 0 if selftest() else 1
    if not selftest(verbose=False):
        print('SELFTEST FAILED -- refusing to read the fleet')
        return 2
    from lib.telemetry import Events
    t1 = dt.datetime.fromisoformat(a.until.replace('Z', '+00:00')) if a.until else \
        dt.datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    t0 = t1 - dt.timedelta(hours=a.hours)
    allruns, rises = [], 0
    pools = sorted(p for p in (os.path.basename(d)[len('_pool-'):] for d in glob.glob(os.path.join(a.state_dir, '_pool-*'))
                               if os.path.isdir(d)) if '.' not in p and not p.startswith('self-'))
    for pool in pools:
        ev = Events.load(paths=f'/var/log/mcai/{pool}-*/skill-*.jsonl*', since=t0, until=t1)
        rows = []
        for r in ev.rows:
            d = r['raw']
            b = d.get('bot') or {}
            sk = d.get('skill') or {}
            rec = {'t': r['t'].timestamp(), 'bot': b.get('name'), 'k': r['name'], 's': sk.get('status'),
                   'dur': sk.get('duration_ms'), 'd': (sk.get('detail') or '')[:200]}
            p = b.get('pos')
            if p:
                rec['p'] = [p.get('x', 0), p.get('y', 0), p.get('z', 0)]
            if 'inventory' in b:
                rec['inv'] = {k: v for k, v in (b.get('inventory') or {}).items() if k in set(RAW.values())}
            rows.append(rec)
        del ev
        known = []
        for f in glob.glob(os.path.join(a.state_dir, f'_pool-{pool}', 'world-facts-*.json')):
            try:
                known += [(x['x'], x['y'], x['z']) for x in json.load(open(f)).get('resources', [])
                          if x.get('kind') in RAW]
            except (OSError, ValueError, KeyError):
                pass
        runs, nr = classify(rows, known)
        for x in runs:
            x['pool'] = pool
        allruns += [x for x in runs if x['end'] <= t1.timestamp() - FOLLOW_S]
        rises += nr
    S = summarize(allruns)
    controls = {'rise_events_in_window': rises, 'runs_with_a_heading': len(allruns),
                'note': 'still_known reads the CURRENT world-facts file: a proxy, not the sighting at the time'}
    window = [t0.strftime('%Y-%m-%dT%H:%M:%SZ'), t1.strftime('%Y-%m-%dT%H:%M:%SZ')]
    txt = render(S, controls, window)
    print(txt)
    os.makedirs(a.out_dir, exist_ok=True)
    stem = os.path.join(a.out_dir, window[1].replace(':', ''))
    json.dump({'window': window, 'summary': S, 'controls': controls}, open(stem + '.json', 'w'), indent=1)
    open(stem + '.txt', 'w').write(txt + '\n')
    return 0 if rises and allruns else 1


if __name__ == '__main__':
    sys.exit(main())
