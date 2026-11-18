#!/usr/bin/env python3
"""Prune superseded lease generations from a pool dir. Keeps, per lease (<key>.<name>.lease), the newest KEEP generations and
anything younger than MIN_AGE_S; removes older generations' .json and .json.released. Dry run unless --apply."""
import os, re, sys, time, collections
d = sys.argv[1]; apply = '--apply' in sys.argv
KEEP, MIN_AGE_S = 3, 4 * 3600
RE = re.compile(r'^(.*\.lease)\.g(\d+)\.json(\.released)?$')
by = collections.defaultdict(set); names = os.listdir(d)
for n in names:
    m = RE.match(n)
    if m: by[m.group(1)].add(int(m.group(2)))
now = time.time(); rm = []
for base, gens in by.items():
    keep = set(sorted(gens)[-KEEP:])
    for g in gens:
        if g in keep: continue
        for suf in ('.json', '.json.released'):
            p = os.path.join(d, f'{base}.g{g}{suf}')
            try:
                if now - os.stat(p).st_mtime >= MIN_AGE_S: rm.append(p)
            except FileNotFoundError: pass
print(f'entries {len(names)} lease-names {len(by)} would-remove {len(rm)} -> left {len(names) - len(rm)}' + (' APPLY' if apply else ' (dry run)'))
if apply:
    for p in rm:
        try: os.unlink(p)
        except FileNotFoundError: pass
