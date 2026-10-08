#!/usr/bin/env python3
"""usafe_bins.py <since-iso> <until-iso> <out.pkl>  -- per bot, per 5-min bin: exposure, deaths and drowning deaths,
built with the LIVE gate's own functions (usafegate.rows: the same rows, timestamps deduplicated, deaths deduplicated),
stored so that the calibration (usafe_null.py) reproduces usafegate's exposure EXACTLY on bin-aligned windows.

THE LIVE ESTIMATOR on a window [a, z): the bot's rows with a <= t < z, and for each CONSECUTIVE PAIR of them,
min(gap, 120 s). A pair counts only when BOTH rows are inside the window (round 2, Codex: the first version credited every
gap to its starting bin, so a window's last gap -- whose end row lies past the cut, which the live scan never sees --
was counted in the calibration and not live: 360 s vs 240 s on a 300-s window).
STORED: each pair credited to the bin of its END row ('end'), plus every pair whose two rows lie in different bins
('cross': (start_bin, end_bin, seconds)). For a window of bins [A, Z): exposure = sum(end over A..Z-1) - sum(v over cross
pairs with start_bin < A <= end_bin < Z), which is exactly the live sum. usafe_null.py asserts it against usafegate.scan
on real logs before it reports anything.
Out: {'bins': {bot: {bin: {'end': s, 'death': n, 'drown': n}}}, 'cross': {bot: [(S, E, v)]}, 'errors': n, ...}.
"""
import sys, os, glob, pickle, datetime as dt
from collections import defaultdict, Counter
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..'), os.path.expanduser('~/mcai-analysis')):
    sys.path.insert(0, p)
import usafegate as G

BIN = 300
since = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
until = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
root = os.environ.get('USAFE_LOG_ROOT') or '/var/log/mcai'
out = {}; cross = {}; err = [0]
for d in sorted(glob.glob(root + '/*-*/')):
    bot = os.path.basename(d.rstrip('/'))
    ts, deaths, _ = G.rows(root, bot, since, until, (), err)
    bins = defaultdict(Counter); cx = []
    for i in range(len(ts) - 1):
        v = min(ts[i + 1] - ts[i], G.CAP_S)
        s_, e_ = int(ts[i] // BIN), int(ts[i + 1] // BIN)
        bins[e_]['end'] += v
        if s_ != e_:
            cx.append((s_, e_, v))
    for t, text in deaths:
        bins[int(t // BIN)]['death'] += 1
        bins[int(t // BIN)]['drown'] += int('drown' in (text or '').split(';', 1)[0])
    out[bot] = {k: dict(v) for k, v in bins.items()}
    cross[bot] = cx
    print(bot, len(ts), len(deaths), round(sum(v.get('end', 0) for v in bins.values()) / 3600, 1), flush=True)
pickle.dump({'bins': out, 'cross': cross, 'errors': err[0], 'since': since.timestamp(), 'until': until.timestamp(),
             'root': root, 'format': 'end+cross'}, open(sys.argv[3], 'wb'))
print('bots', len(out), 'unreadable files', err[0])
