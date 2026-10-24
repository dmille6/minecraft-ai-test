#!/usr/bin/env python3
"""paper-summary.py <outDir> [<outDir> ...] -- lavasight-01's Paper table from scene-e2e's results.jsonl and its run dirs.

Per (scene, start, build): runs, deaths (lava), lava refusal episodes (bot-minutes with a `_lava_corridor` or lava-naming
`_explore_blind_step_refused` row after placement), refusal rows, danger-block rows on lava, goto/explore/gather successes,
and for the candidate the mechanism's own evidence from its log: the mode state (must be `ok`: the hook's file bound to the
sandbox's seed and the run's pool), active cells and priced moves from `_lavasight`/`_lavasight_route` rows. A candidate run
whose mode state is not `ok` is reported INVALID (the mechanism never had the map), never as a result.
"""
import glob, json, os, sys
from collections import defaultdict


def rows_of(path):
    out = []
    for f in glob.glob(path):
        for l in open(f, errors='replace'):
            try:
                out.append(json.loads(l))
            except ValueError:
                pass
    return out


def main(dirs):
    table = defaultdict(lambda: defaultdict(list))
    for d in dirs:
        res = [json.loads(l) for l in open(os.path.join(d, 'results.jsonl')) if l.strip()]
        runs = sorted(glob.glob(os.path.join(d, '*-*-*')), key=os.path.getmtime)
        for r in res:
            # the run dir: the newest dir of this label+scene whose bot log ends before this result row was written
            cands = [x for x in runs if os.path.basename(x).startswith('%s-%s' % (r['label'], r['scene'][:40]))]
            logs = []
            for x in cands:
                lg = glob.glob(os.path.join(x, '*', 'log', 'skill-*.jsonl'))
                if lg and abs(os.path.getmtime(lg[0]) - (__import__('datetime').datetime.fromisoformat(r['at'].replace('Z', '+00:00')).timestamp())) < 120:
                    logs = lg
            rows = rows_of(logs[0]) if logs else []
            placed = None
            k = r.get('kinds') or {}
            ep = set()
            mode, active, priced = None, 0, 0
            for x in rows:
                n = (x.get('skill') or {}).get('name') or ''
                det = (x.get('skill') or {}).get('detail') or ''
                args = (x.get('skill') or {}).get('args') or {}
                if n == '_lavasight_mode':
                    mode = args.get('state')
                elif n == '_lavasight':
                    active = max(active, int(args.get('active') or 0))
                elif n == '_lavasight_route':
                    # a 6-min run may end before the 10-min liveness row: the route rows carry active and priced too
                    active = max(active, int(args.get('active') or 0)); priced += int(args.get('priced') or 0)
                if n == '_lava_corridor' and 'unknown' not in det or (n == '_explore_blind_step_refused' and 'lava' in det):
                    ep.add(x.get('@timestamp', '')[:16])
            key = (r['scene'], r.get('start_index', 0))
            table[key][r['label']].append({'outcome': r.get('outcome'), 'pass': r.get('pass'), 'death': (r.get('deathClass') or {}).get('family'),
                                           'episodes': len(ep), 'corridor': k.get('_lava_corridor', 0), 'blind': k.get('_explore_blind_step_refused', 0),
                                           'danger': k.get('_reflex_danger_block', 0), 'route_rows': k.get('_lavasight_route', 0),
                                           'mode': mode, 'active': active, 'priced': priced, 'log': bool(logs)})
    for key in sorted(table):
        print('== %s start %s' % key)
        for b in ('base', 'cand'):
            xs = table[key].get(b, [])
            if not xs:
                continue
            valid = [x for x in xs if b == 'base' or x['mode'] == 'ok']
            print('  %-4s runs %d (valid %d)  lava deaths %d  passed %d  episodes %s  corridor rows %s  blind %s  danger %s%s' % (
                b, len(xs), len(valid), sum(1 for x in valid if x['death'] == 'lava'), sum(1 for x in valid if x['pass']),
                [x['episodes'] for x in valid], [x['corridor'] for x in valid], [x['blind'] for x in valid], [x['danger'] for x in valid],
                ('  mode %s active %s priced %s' % ([x['mode'] for x in xs], [x['active'] for x in xs], [x['priced'] for x in xs])) if b == 'cand' else ''))


if __name__ == '__main__':
    main(sys.argv[1:])
