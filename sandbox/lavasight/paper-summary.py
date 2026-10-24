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
            if r['label'] not in ('base', 'cand'):
                print('WARNING: result with an unknown label %r (%s) not counted' % (r['label'], r.get('run_dir')), file=sys.stderr)
                continue
            if r.get('pass') is None and not why:
                why = 'incomplete (no oracle verdict)'
            table[(r['scene'], r.get('start_index', 0))][r['label']].append({
                'sha': r.get('sha'), 'matched': bool(r.get('matched_fleet')), 'dead': bool((r.get('observation') or {}).get('deathsLog') or (r.get('observation') or {}).get('deathsScore')),
                'invalid': why, 'outcome': r.get('outcome'), 'pass': r.get('pass'), 'death': (r.get('deathClass') or {}).get('family'),
                'episodes': len(ep), 'corridor': k.get('_lava_corridor', 0), 'blind': k.get('_explore_blind_step_refused', 0),
                'danger': k.get('_reflex_danger_block', 0), 'mode': mode, 'active': active, 'priced': priced,
                'hook_cells': (r.get('pool_hook') or {}).get('cells')})
    return table, started


MIN_RUNS = 3


def library_verdict(table):
    """THE LIBRARY NON-REGRESSION (not the fix gate: lavasight is not a stuck or a fall fix, so the candidate is not expected to
    escape). Judged ONLY over valid runs (the same rules as the table: a log, and for the candidate a bound, indexed map) and
    only where the comparison means something (Codex + Claude driver r3 P2):
      INCONCLUSIVE  fewer than MIN_RUNS valid runs on either side, unequal valid counts, or the base did not reproduce the
                    fleet's failure in >= 2 of every 3 valid runs (a scene the base no longer fails cannot show a regression)
      REGRESSED     the candidate's death rate or pass rate is worse than the base's
      ok            otherwise
    -> {key: (verdict, why)}. Pure."""
    out = {}
    for key, sides in table.items():
        b = [x for x in sides.get('base', []) if not x['invalid']]
        c = [x for x in sides.get('cand', []) if not x['invalid']]
        mixed = [lab for lab, xs in (('base', b), ('cand', c)) if len({x.get('sha') for x in xs}) > 1]
        if mixed:   # one verdict = one build pair (Codex tooling r5 P2)
            out[key] = ('INCONCLUSIVE', 'mixed builds on %s: %s' % (','.join(mixed), sorted({str(x.get('sha'))[:8] for x in b + c})))
            continue
        if len(b) < MIN_RUNS or len(c) < MIN_RUNS or len(b) != len(c):
            out[key] = ('INCONCLUSIVE', 'valid runs base %d cand %d (need >= %d each, equal)' % (len(b), len(c), MIN_RUNS))
            continue
        m = sum(1 for x in b if x['matched'])
        if m * 3 < len(b) * 2:
            out[key] = ('INCONCLUSIVE', 'the base reproduced the fleet in %d of %d valid runs' % (m, len(b)))
            continue
        db, dc = sum(x['dead'] for x in b) / len(b), sum(x['dead'] for x in c) / len(c)
        pb, pc = sum(1 for x in b if x['pass']) / len(b), sum(1 for x in c if x['pass']) / len(c)
        why = 'death rate base %.2f cand %.2f; pass rate base %.2f cand %.2f; base matched %d/%d' % (db, dc, pb, pc, m, len(b))
        out[key] = ('REGRESSED' if dc > db or pc < pb else 'ok', why)
    return out


def main(dirs):
    library = '--library' in dirs
    dirs = [d for d in dirs if d != '--library']
    table, started = summarize(dirs)
    if library:
        verdicts = library_verdict(table)
        # a scene that was STARTED and wrote no result at all is INCONCLUSIVE too, never absent (Codex + Claude tooling r4 P2)
        for (sc, st, _) in started:
            if (sc, st) not in verdicts:
                verdicts[(sc, st)] = ('INCONCLUSIVE', 'started, no results')
        for key, (v, why) in sorted(verdicts.items()):
            print('LIBRARY %-12s %s start %s: %s' % (v, key[0], key[1], why))
        vs = [v for v, _ in verdicts.values()]
        # exit 1 REGRESSED anywhere; 2 when anything could not be judged or nothing was ok; 0 only for an all-ok library
        sys.exit(1 if 'REGRESSED' in vs else 2 if ('INCONCLUSIVE' in vs or 'ok' not in vs) else 0)
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


def selftest():
    R = lambda matched=True, dead=False, ok=False, invalid=None, sha='a' * 40: {'matched': matched, 'dead': dead, 'pass': ok, 'invalid': invalid, 'sha': sha}
    T = lambda b, c: {('s', 0): {'base': b, 'cand': c}}
    v = lambda b, c: library_verdict(T(b, c))[('s', 0)][0]
    assert v([R()] * 3, [R()] * 3) == 'ok', 'same outcome: ok'
    assert v([R()] * 3, [R(dead=True)] + [R()] * 2) == 'REGRESSED', 'a candidate death the base did not have'
    assert v([R(ok=True)] * 3, [R(ok=False)] + [R(ok=True)] * 2) == 'REGRESSED', 'a pass lost'
    assert v([R()] * 3, [R()] * 2) == 'INCONCLUSIVE', 'too few candidate runs'
    assert v([R()] * 3, [R(invalid='map not bound (absent)')] * 3) == 'INCONCLUSIVE', 'unbound candidates are not runs'
    assert v([R(matched=False)] * 3, [R()] * 3) == 'INCONCLUSIVE', 'a base that no longer reproduces cannot show a regression'
    assert v([R(dead=True)] * 3, [R(dead=True)] * 3) == 'ok', 'the same deaths: not worse'
    assert v([R()] * 3, [R(), R(), R(sha='b' * 40)]) == 'INCONCLUSIVE', 'two candidate builds pooled'
    # THE SEAM (Claude tooling r4 P3): summarize() itself marks a missing log, an unbound and an empty candidate invalid
    import tempfile
    d = tempfile.mkdtemp(prefix='lsps-')
    def run(label, mode, active, log=True):
        rd = tempfile.mkdtemp(dir=d)
        if log:
            os.makedirs(os.path.join(rd, 'bot', 'log'))
            with open(os.path.join(rd, 'bot', 'log', 'skill-bot.jsonl'), 'w') as f:
                f.write(json.dumps({'@timestamp': '2026-10-24T00:00:00Z', 'skill': {'name': '_lavasight_mode', 'args': {'state': mode}}}) + '\n')
                f.write(json.dumps({'@timestamp': '2026-10-24T00:01:00Z', 'skill': {'name': '_lavasight_route', 'args': {'active': active, 'priced': 5}}}) + '\n')
        return {'label': label, 'scene': 's', 'start_index': 0, 'run_dir': rd, 'placed_at': '2026-10-24T00:00:30Z', 'pass': False, 'matched_fleet': True, 'observation': {}}
    rows = [run('base', None, 0), run('base', None, 0, log=False), run('cand', 'ok', 4), run('cand', 'absent', 4), run('cand', 'ok', 0)]
    with open(os.path.join(d, 'results.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(r) + '\n' for r in rows))
    tb, _ = summarize([d])
    got = [(x['invalid'] or 'valid') for x in tb[('s', 0)]['base']] + [(x['invalid'] or 'valid') for x in tb[('s', 0)]['cand']]
    assert got == ['valid', 'no log', 'valid', 'map not bound (absent)', 'no post-placement route or liveness row with an active cell'], got
    import shutil
    shutil.rmtree(d)
    print('SELFTEST ok')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest(); sys.exit(0)
    main(sys.argv[1:])
