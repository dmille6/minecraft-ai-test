"""Board-d's trap, checked two ways (Codex r1 P2-6). No ES access (compact rows).
(1) pre-trend: board-d vs the mean of the other 15 worlds, gather ok per bot-h, daily 10-08 .. 10-15 (before the
    pit held anyone: float holds 22.2 h on 10-16, 47.9 h on 10-17, 66.6 h/day from 10-18).
(2) matched hours around the escape: 02:00-08:00Z on 10-22 (trapped) vs the same hours on 10-23 (poolescape-01 ran on
    board-d, placebo-a and hive-b from 01:48:44Z and was promoted fleet-wide at 08:05Z), board-d vs the 13 worlds that
    had NOT received it in those hours (Codex r2 P2-7): a DiD on gather ok, mine ok and float hours per bot-h.
"""
import os, sys, gzip, json, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402

A = json.load(open(os.path.join(HERE, 'out', 'analyze.json')))
print('(1) gather ok per bot-h, board-d vs mean of the other 15 worlds (120 bot-h per world-day)')
for d in sorted(A):
    if d > '2026-10-22':
        continue
    bd = A[d]['board-d']['gather_ok'] / 120
    o = sum(A[d][w]['gather_ok'] for w in A[d] if w != 'board-d') / 15 / 120
    fl = A[d]['board-d']['float_s'] / 3600
    print(f'   {d}  board-d {bd:5.2f}  others {o:5.2f}  diff {bd - o:+5.2f}   board-d float {fl:5.1f} h')

HELD = re.compile(r'held ([0-9.]+)s')


def window(day):
    X = defaultdict(lambda: defaultdict(float))
    bots = defaultdict(set)
    with gzip.open(os.path.join(HERE, 'out', 'rows', f'{day}.jsonl.gz'), 'rt') as f:
        for l in f:
            r = json.loads(l)
            h = int(r['t'][11:13])
            if not (2 <= h < 8):
                continue
            w = world(r['p'])
            if w not in HOMES or w in ('placebo-a', 'hive-b'):
                continue
            g = 'board-d' if w == 'board-d' else 'others'
            bots[g].add(r['b'])
            if r['k'] == 'gather' and r['s'] == 'success':
                X[g]['gather_ok'] += 1
            elif r['k'] == 'mine' and r['s'] == 'success':
                X[g]['mine_ok'] += 1
            elif r['k'] == '_water_float_ended':
                m = HELD.search(r['d'] or '')
                X[g]['float_h'] += float(m.group(1)) / 3600 if m else 0
    return {g: {k: v / (len(bots[g]) * 6) for k, v in X[g].items()} for g in X}, {g: len(b) for g, b in bots.items()}


a, na = window('2026-10-22')
b, nb = window('2026-10-23')
print(f'\n(2) 02:00-08:00Z, per bot-h, untreated controls only (bots seen: 10-22 {na}, 10-23 {nb}; 6 h each)')
for k in ('gather_ok', 'mine_ok', 'float_h'):
    dd = (b['board-d'].get(k, 0) - a['board-d'].get(k, 0)) - (b['others'].get(k, 0) - a['others'].get(k, 0))
    print(f'   {k:9s} board-d {a["board-d"].get(k, 0):6.2f} -> {b["board-d"].get(k, 0):6.2f}   others '
          f'{a["others"].get(k, 0):6.2f} -> {b["others"].get(k, 0):6.2f}   DiD {dd:+.2f}')
