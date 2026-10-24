#!/usr/bin/env python3
"""paper-summary.py <outDir> [<outDir> ...] -- lavasight-01's Paper table from scene-e2e's results.jsonl and its run dirs.

Each result row names its own run dir (`run_dir`) and placement time (`placed_at`), so a run's bot log is joined EXACTLY,
never by a time window (Codex/Claude driver review P2). Per (scene, start, build): runs started (the runner's started.jsonl)
vs runs with a result, deaths (lava), lava refusal episodes (bot-minutes AFTER PLACEMENT with a `_lava_corridor` or a
lava-naming `_explore_blind_step_refused`, never for an unknown cell), and for the candidate the mechanism's own evidence:
the mode state, the active cells and priced moves from `_lavasight_route`/`_lavasight` rows.

A run is INVALID (listed, never counted) when its bot log is missing (either build), or -- for the candidate -- when its map
did not bind (mode state not `ok`) or bound with nothing to price (no active cell): a candidate that never had lava in its
index is a placebo, not a result.
"""
import glob, json, os, sys
from collections import defaultdict


def rows_of(paths):
    out = []
    for f in paths:
        for l in open(f, errors='replace'):
            try:
                out.append(json.loads(l))
            except ValueError:
                pass
    return out


def summarize(dirs):
    table = defaultdict(lambda: defaultdict(list))
    started = defaultdict(int)
    for d in dirs:
        sp = os.path.join(d, 'started.jsonl')
        if os.path.exists(sp):
            for l in open(sp):
                if l.strip():
                    s = json.loads(l)
                    started[(s['scene'], s['start'], s['label'])] += 1
        rp = os.path.join(d, 'results.jsonl')
        if not os.path.exists(rp):
            continue
        for l in open(rp):
            if not l.strip():
                continue
            r = json.loads(l)
            logs = glob.glob(os.path.join(r.get('run_dir') or '/nonexistent', '*', 'log', 'skill-*.jsonl'))
            rows = rows_of(logs)
            placed = r.get('placed_at') or ''
            ep, mode, active, priced, after = set(), None, 0, 0, 0
            for x in rows:
                sk = x.get('skill') or {}
                n, det, args = sk.get('name') or '', sk.get('detail') or '', sk.get('args') or {}
                ts = x.get('@timestamp', '')
                if n == '_lavasight_mode':
                    mode = args.get('state')
                if ts < placed:
                    continue
                after += 1
                if n in ('_lavasight', '_lavasight_route'):
                    active = max(active, int(args.get('active') or 0))
                    if n == '_lavasight_route':
                        priced += int(args.get('priced') or 0)
                if (n == '_lava_corridor' and 'unknown' not in det) or (n == '_explore_blind_step_refused' and 'lava' in det and 'unknown' not in det):
                    ep.add(ts[:16])
            k = r.get('kinds') or {}
            why = None
            if not logs:
                why = 'no log'
            elif r['label'] == 'cand' and mode != 'ok':
                why = 'map not bound (%s)' % mode
            elif r['label'] == 'cand' and active == 0:
                why = 'no post-placement route or liveness row with an active cell'
            table[(r['scene'], r.get('start_index', 0))][r['label']].append({
                'invalid': why, 'outcome': r.get('outcome'), 'pass': r.get('pass'), 'death': (r.get('deathClass') or {}).get('family'),
                'episodes': len(ep), 'corridor': k.get('_lava_corridor', 0), 'blind': k.get('_explore_blind_step_refused', 0),
                'danger': k.get('_reflex_danger_block', 0), 'mode': mode, 'active': active, 'priced': priced,
                'hook_cells': (r.get('pool_hook') or {}).get('cells')})
    return table, started


def main(dirs):
    table, started = summarize(dirs)
    # every (scene, start) STARTED or with a result: a scene whose runs all crashed still shows (Claude driver r2 P3-1)
    keys = set(table) | {(s, st) for (s, st, _) in started}
    for key in sorted(keys):
        print('== %s start %s' % key)
        for b in ('base', 'cand'):
            xs = table[key].get(b, [])
            valid = [x for x in xs if not x['invalid']]
            inv = [x['invalid'] for x in xs if x['invalid']]
            print('  %-4s started %d, results %d, valid %d%s | lava deaths %d | survived %d | episodes %s | corridor rows %s | blind %s | danger %s%s' % (
                b, started.get((key[0], key[1], b), 0), len(xs), len(valid), (' (invalid: %s)' % inv) if inv else '',
                sum(1 for x in valid if x['death'] == 'lava'), sum(1 for x in valid if x['pass']),
                [x['episodes'] for x in valid], [x['corridor'] for x in valid], [x['blind'] for x in valid], [x['danger'] for x in valid],
                ('  | hook cells %s active %s priced %s' % ([x['hook_cells'] for x in xs], [x['active'] for x in xs], [x['priced'] for x in xs])) if b == 'cand' else ''))


if __name__ == '__main__':
    main(sys.argv[1:])
