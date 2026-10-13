#!/usr/bin/env python3
"""positions3.py <out.json> <census.json>... -- candidate container positions per WORLD (runs on 10.0.0.31, read-only).
= every container in the given censuses (10-04, 10-10) + every "x,y,z" container coordinate named in bot skill logs
since 10-05 (deposit / town deposit / withdraw / chest rows) inside the bank box (|dx|,|dz| <= 48, |dy| <= 12).

FIX over chestclear2/positions.py: the world is taken from the BOT NAME (isolated-a-Alpha -> isolated-a), not from
exp.pool -- isolated bots log pool "self-isolated-a-Alpha", which matched no world, so the 10-10 list gave the four
isolated towns only their 10-04 containers. Prints mentions per world as its positive control.
"""
import json, glob, re, gzip, sys
from collections import Counter
out_path = sys.argv[1]; pos = {}
for cpath in sys.argv[2:]:
    for w, v in json.load(open(cpath))['worlds'].items():
        e = pos.setdefault(w, {'home': v['home'], 'pos': set()})
        assert e['home'] == v['home'], (w, e['home'], v['home'])
        e['pos'] |= {tuple(c['pos']) for c in v['containers']}
PAT = re.compile(r'(-?\d+),(-?\d+),(-?\d+)(?==|:|;|\])')
files = sorted(glob.glob('/var/log/mcai/*/skill-*.jsonl') + glob.glob('/var/log/mcai/*/skill-*.jsonl-2026100[5-9].gz')
               + glob.glob('/var/log/mcai/*/skill-*.jsonl-202610[1-3]*.gz'))
mentions = Counter(); rows = Counter(); unknown = Counter()
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    try: fh = op(f, 'rt', errors='ignore')
    except Exception: continue
    for l in fh:
        if not any(k in l for k in ('"deposit"', '_town_deposit', '_withdraw_pick', '"withdraw_pick"', 'chest')): continue
        try: r = json.loads(l)
        except Exception: continue
        name = (r.get('bot') or {}).get('name') or ''
        w = name.rsplit('-', 1)[0] if '-' in name else None
        if w not in pos: unknown[w] += 1; continue
        rows[w] += 1
        d = (r.get('skill') or {}).get('detail') or ''
        h = pos[w]['home']
        for m in PAT.finditer(d):
            x, y, z = map(int, m.groups())
            if abs(x - h[0]) <= 48 and abs(z - h[2]) <= 48 and abs(y - h[1]) <= 12:
                pos[w]['pos'].add((x, y, z)); mentions[w] += 1
out = {w: {'home': v['home'], 'pos': sorted(v['pos'])} for w, v in pos.items()}
json.dump(out, open(out_path, 'w'))
print('files', len(files), 'unmatched bot names', dict(unknown.most_common(5)))
for w in sorted(out): print('%-11s chest-rows %7d mentions %7d positions %5d' % (w, rows[w], mentions[w], len(out[w]['pos'])))
