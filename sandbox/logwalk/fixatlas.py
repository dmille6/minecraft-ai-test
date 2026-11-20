#!/usr/bin/env python3
"""SANDBOX-ONLY (logwalk-01show rig fixture): the pool copy's atlas agrees with the fixture world.

A wood find standing on a column the fixture cut (fixture-cut.json, within 3 blocks in x/z) is dropped from every atlas-*.json,
as a bot's recorder would have read it gone. Nothing else changes.
    python3 fixatlas.py <pool dir> <fixture-cut.json>
"""
import json
import os
import sys

pool, cutf = sys.argv[1], sys.argv[2]
cut = json.load(open(cutf))
cols = {(c['x'], c['z']) for c in cut}


def near(f):
    return any((f['x'] + dx, f['z'] + dz) in cols for dx in range(-3, 4) for dz in range(-3, 4))


dropped = kept = 0
for n in sorted(os.listdir(pool)):
    if not (n.startswith('atlas-') and n.endswith('.json')):
        continue
    p = os.path.join(pool, n)
    d = json.load(open(p))
    out = []
    for f in d.get('finds', []):
        if f.get('cat') == 'wood' and near(f):
            dropped += 1
        else:
            out.append(f)
            kept += f.get('cat') == 'wood'
    d['finds'] = out
    json.dump(d, open(p, 'w'))
print(f'atlas fixture: dropped {dropped} wood finds on cut columns, kept {kept} wood finds')
