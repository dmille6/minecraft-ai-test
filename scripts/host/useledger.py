#!/usr/bin/env python3
"""The town's USE LEDGER, as the week's table (useledger-01, bagfix-02show; owner 11-16: "store everything now, and evaluate
what we use over the next week or two, then determine what goes in the well").

  python3 scripts/host/useledger.py <pool dir or ledger file> [--days 7] [--world W] [--all]

Reads `use-ledger-<home>.jsonl` (the bots append to it: bots/src/useledger.mjs has every line's meaning) and prints, per kind:
the standing stock (the newest stock line), what went IN and OUT in the window, what the draws were FOR, the number of draws and
the last one, and what went down the well at the cap. The kinds with stock or intake and ZERO draws come first: they are the
candidates for the well. The fold is the same as bots/src/useledger.mjs foldLedger (its test holds the two to one fixture).
A negative needs its positive control: the header says how many lines, of which kinds, over which span were read.
"""
import argparse, glob, json, os, sys, time

KINDS = ('in', 'out', 'move', 'waste', 'stock')


def fold(lines, since=float('-inf'), until=float('inf'), world=None):
    kinds, n, bad, lo, hi = {}, 0, 0, None, None
    newest, stock = float('-inf'), None
    seen = {k: 0 for k in KINDS}

    def K(name):
        return kinds.setdefault(name, {'in': 0, 'out': 0, 'move': 0, 'waste': 0, 'by': {}, 'lastOut': None, 'draws': 0, 'stock': None})

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            r = json.loads(raw)
        except ValueError:
            bad += 1
            continue
        if not isinstance(r, dict) or not isinstance(r.get('t'), (int, float)) or r.get('d') not in KINDS or not isinstance(r.get('n'), dict):
            bad += 1
            continue
        if world is not None and r.get('g') is not None and r.get('g') != world:
            continue
        if r['d'] == 'stock':
            if newest <= r['t'] < until:
                newest, stock = r['t'], r['n']
            seen['stock'] += 1
            continue
        if not (since <= r['t'] < until):
            continue
        n += 1
        seen[r['d']] += 1
        lo = r['t'] if lo is None else min(lo, r['t'])
        hi = r['t'] if hi is None else max(hi, r['t'])
        for name, c in r['n'].items():
            c = c if isinstance(c, (int, float)) else 0
            if c <= 0:
                continue
            k = K(name)
            k[r['d']] += c
            if r['d'] == 'out':
                w = r.get('w') or '-'
                k['by'][w] = k['by'].get(w, 0) + c
                k['draws'] += 1
                k['lastOut'] = max(k['lastOut'] or float('-inf'), r['t'])
    if stock:
        for name, c in stock.items():
            K(name)['stock'] = c if isinstance(c, (int, float)) else 0
    return {'kinds': kinds, 'lines': n, 'bad': bad, 'from': lo, 'to': hi, 'seen': seen, 'stockAt': newest if stock else None}


def table(f):
    rows = []
    for kind, k in f['kinds'].items():
        cand = k['draws'] == 0 and ((k['stock'] or 0) > 0 or k['in'] > 0)
        rows.append(dict(kind=kind, candidate=cand, **k))
    rows.sort(key=lambda r: (not r['candidate'], -r['out'], -(r['stock'] or 0), r['kind']))
    return rows


def iso(ms):
    return '-' if ms is None else time.strftime('%m-%d %H:%MZ', time.gmtime(ms / 1000))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path')
    ap.add_argument('--days', type=float, default=7)
    ap.add_argument('--world', default=None)
    ap.add_argument('--all', action='store_true', help='every kind (default: candidates, and kinds with any in, out or waste)')
    ap.add_argument('--now', type=float, default=None, help='epoch ms (tests)')
    a = ap.parse_args()
    files = [a.path] if os.path.isfile(a.path) else sorted(glob.glob(os.path.join(a.path, 'use-ledger-*.jsonl')))
    if not files:
        print(f'no use-ledger-*.jsonl at {a.path}: the ledger is written by the bots from bagfix-02show on (USELEDGER=off stops it)')
        return 2
    now = a.now if a.now is not None else time.time() * 1000
    lines = []
    for fn in files:
        with open(fn, errors='replace') as fh:
            lines += fh.readlines()
    f = fold(lines, since=now - a.days * 86400_000, until=now + 1, world=a.world)
    s = f['seen']
    print(f"use ledger: {len(files)} file(s), {f['lines']} line(s) in the last {a.days:g} d ({iso(f['from'])} .. {iso(f['to'])}); "
          f"in {s['in']}, out {s['out']}, move {s['move']}, waste {s['waste']}; stock lines {s['stock']} (newest {iso(f['stockAt'])}); unreadable {f['bad']}")
    if f['lines'] == 0 and not f['stockAt']:
        print('NOTHING READ in the window: no table (an empty table would read as "nothing is used")')
        return 1
    rows = [r for r in table(f) if a.all or r['candidate'] or r['in'] or r['out'] or r['waste']]
    print(f"{'kind':28} {'stock':>7} {'in':>7} {'out':>7} {'draws':>5} {'last used':>12} {'waste':>6}  used for")
    for r in rows:
        by = ' '.join(f'{w}:{int(c)}' for w, c in sorted(r['by'].items(), key=lambda x: -x[1])) or ('-- WELL CANDIDATE (no draw)' if r['candidate'] else '-')
        st = '?' if r['stock'] is None else int(r['stock'])
        print(f"{r['kind'][:28]:28} {st:>7} {int(r['in']):>7} {int(r['out']):>7} {r['draws']:>5} {iso(r['lastOut']):>12} {int(r['waste']):>6}  {by}")
    print(f"{sum(1 for r in rows if r['candidate'])} candidate(s) for the well (stock or intake, zero draws) of {len(f['kinds'])} kind(s) seen")
    return 0


if __name__ == '__main__':
    sys.exit(main())
