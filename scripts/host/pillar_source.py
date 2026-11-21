#!/usr/bin/env python3
"""pillars-01show, the SOURCE of the proven pillars (host side, read-only log copies, never on the showcase VM).

    python3 scripts/host/pillar_source.py --pillars pillars.json --logs '~/showlogs-*/showcase-*/skill-*' --out source.json

For every PROVEN body block of the survey's pillars (CoreProtect: its placer and second), the placer's own skill rows in
[t - 90 s, t + 10 s] are read (streamed per file through lib.telemetry.open_log; Events.load refuses a two-week walk, and this is
a join on (bot, second), not a count). Per block it records:
  - the top-level skill running then (the last row before t whose name does not start with '_': explore, gather, deep_mine ...);
  - the marker rows in the window (escape, climb, scaffold, drowning, entombed, takeback ...);
  - the take-back's last word on that exact cell (`_takeback ... pos=x,y,z ... outcome=... why=...`), if it noted the block.
A pillar's source is its blocks' commonest (skill, marker) pair. COVERAGE (the positive control): a block whose placer has no
row at all in its window is `no_log` (the copies end 11-19 18:18Z; CoreProtect runs to the backup), counted and never guessed.
"""
import argparse
import collections
import datetime
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lib.telemetry import open_log  # noqa: E402

MARK = re.compile(r'pillar|scaffold|climb|escape|entomb|drown|air_pocket|airpocket|stranded|water_float|ceil|stair|livelock|'
                  r'reflex_stuck|watchdog|fall_path|zone_climb|bridge|tower', re.I)
POS = re.compile(r'pos=(-?\d+),(-?\d+),(-?\d+)')
BEFORE, AFTER = 90, 10


def ts_of(line):
    i = line.find('"@timestamp":"')
    if i < 0:
        return None
    s = line[i + 14:i + 38]
    try:
        return datetime.datetime.fromisoformat(s.split('"')[0].replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--pillars', required=True)
    ap.add_argument('--logs', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args(argv)
    doc = json.load(open(a.pillars))
    pillars = [p for p in doc['pillars'] if p['kind'] != 'natural']
    need = collections.defaultdict(list)    # bot -> [(t, key)]
    for p in pillars:
        for b in p['body']:
            if b['proven']:
                need[b['user']].append((b['t'], f"{p['x']},{b['y']},{p['z']}"))
    win = {}   # bot -> sorted list of needed times, for a quick in-window test
    for u, v in need.items():
        win[u] = sorted(t for t, _ in v)
    rows = collections.defaultdict(list)   # bot -> [(ts, name, status, trigger, detail)]
    seen = set()
    import bisect
    for u in need:
        ts_need = win[u]
        for f in sorted(glob.glob(os.path.expanduser(a.logs))):
            if f'/{u}/' not in f:
                continue
            with open_log(f) as fh:
                for line in fh:
                    t = ts_of(line)
                    if t is None:
                        continue
                    i = bisect.bisect_left(ts_need, t - AFTER)
                    inwin = i < len(ts_need) and ts_need[i] <= t + BEFORE
                    if not inwin and '"name":"_takeback"' not in line and '"name":"_takeback_mode"' not in line \
                            and '"name":"_place_town_sum"' not in line:
                        continue
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    sk = d.get('skill') or {}
                    key = (u, d.get('@timestamp'), sk.get('name'), (sk.get('detail') or '')[:80])
                    if key in seen:
                        continue
                    seen.add(key)
                    rows[u].append((t, sk.get('name') or '', sk.get('status'), d.get('trigger'), sk.get('detail') or '',
                                    (sk.get('args') or {})))
        rows[u].sort(key=lambda r: r[0])
    blocks = {}
    cov = collections.Counter()
    for u, v in need.items():
        rs = rows.get(u, [])
        tl = [r[0] for r in rs]
        for t, key in v:
            lo, hi = bisect.bisect_left(tl, t - BEFORE), bisect.bisect_right(tl, t + AFTER)
            w = rs[lo:hi]
            if all(r[1] == '_takeback' for r in w):
                w = []   # only take-back rows kept from outside the windows: not coverage
            if not w:
                cov['no_log'] += 1
                blocks[key] = {'skill': 'no_log', 'marks': [], 'takeback': None}
                continue
            cov['logged'] += 1
            before = [r for r in w if r[0] <= t + 1]
            top = next((r[1] for r in reversed(before) if r[1] and not r[1].startswith('_')), None)
            marks = collections.Counter(r[1] for r in w if r[1].startswith('_') and MARK.search(r[1]))
            pil = [r for r in w if r[1] == '_scaffold_pick']
            tb = None
            for r in w:
                if r[1] == '_takeback':
                    m = POS.search(r[4])
                    if m and ','.join(m.groups()) == key:
                        tb = r[4][:160]
            # later take-back rows on the cell (the window's tail is short): any in the whole bot stream
            if tb is None:
                for r in rs[hi:]:
                    if r[0] > t + 3600:
                        break
                    if r[1] == '_takeback' and f'pos={key} ' in r[4] + ' ':
                        tb = r[4][:160]
            # the movement audit's own row for this cell (placeaudit.mjs `_place_town`: by=pathfinder|pillarOut|..., its shape, its
            # walk profile; it writes a row per placement in the town and its margin, and only sums outside)
            pt = None
            for r in w:
                if r[1] == '_place_town' and f'pos={key} ' in r[4] and 'outcome=placed' in r[4]:
                    pt = {f: (re.search(f + r'=(\S+)', r[4]) or [None, None])[1] for f in ('by', 'shape', 'profile', 'reason', 'zone')}
            if pt is None:
                # outside the margin: the next 60-s sum's `out.<by>.<shape>.placed n` entries (one placer named there: that one)
                for r in rs[bisect.bisect_right(tl, t):]:
                    if r[0] > t + 75:
                        break
                    if r[1] == '_place_town_sum':
                        ent = re.findall(r'(?:^|[|;] ?)(\w+)\.([\w:?]+)\.(\w+)\.placed (\d+)', r[4])
                        bys = sorted({e[1] for e in ent if e[0] == 'out'})
                        if bys:
                            pt = {'by': bys[0] if len(bys) == 1 else '+'.join(bys), 'shape': None, 'profile': None, 'reason': 'sum', 'zone': 'out'}
                        break
            tbmode = any(r[1] == '_takeback_mode' and r[0] <= t for r in rs)
            blocks[key] = {'skill': top or '(none)', 'marks': [m for m, _ in marks.most_common(4)], 'place': pt, 'tb_installed': tbmode,
                           'scaffold_pick': pil[-1][4][:80] if pil else None, 'takeback': tb}
    per = collections.Counter()
    out = []
    for p in pillars:
        ks = [f"{p['x']},{b['y']},{p['z']}" for b in p['body'] if b['proven']]
        bs = [blocks[k] for k in ks if k in blocks]
        src = collections.Counter((b['skill'], (b['marks'] or ['-'])[0]) for b in bs).most_common(1)
        s = src[0][0] if src else ('?', '-')
        per[s] += 1
        out.append({'x': p['x'], 'z': p['z'], 'kind': p['kind'], 'sea': p['sea'], 'height': p['height'], 'source': list(s),
                    'blocks': {k: blocks.get(k) for k in ks}})
    json.dump({'coverage': dict(cov), 'by_source': [[list(k), v] for k, v in per.most_common()], 'pillars': out}, open(a.out, 'w'))
    print(f"_pillar op=source pillars={len(pillars)} blocks={sum(cov.values())} logged={cov['logged']} no_log={cov['no_log']}")
    for k, v in per.most_common(25):
        print(f'  {v:5d}  {k[0]:<28s} {k[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
