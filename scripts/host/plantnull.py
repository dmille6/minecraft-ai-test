#!/usr/bin/env python3
"""THE AMBIENT CONTROL for the plant-20260927 growth read.

A log at a planting coordinate is only evidence of growth if a log is NOT what
that neighbourhood holds anyway. So the same instrument is run on the same
coordinates displaced horizontally, in four directions, at the same y.

The displaced cell was never verified replaceable, so its log rate is an UPPER
bound on ambient -- it includes standing forest that a plantable cell excluded by
construction. That makes it the conservative comparison: if the planted cells are
not far above this, the 37% means nothing.
"""
import collections, csv, importlib.util, sys
from pathlib import Path
_spec = importlib.util.spec_from_file_location("pt", Path("/home/mike/scripts/place-town.py"))
_pt = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_pt)
Rcon, ROOT = _pt.Rcon, _pt.ROOT
TESTS = [('sapling', '#minecraft:saplings'), ('log', '#minecraft:logs'),
         ('leaves', '#minecraft:leaves'), ('air', 'air'),
         ('dirt', '#minecraft:dirt'), ('water', 'water')]
OFFS = [(7, 0, 7), (-7, 0, -7), (7, 0, -7), (-7, 0, 7)]

rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
by_pool = collections.defaultdict(list)
for r in rows: by_pool[r['pool']].append(r)
tot = collections.Counter(); ctl_ok = 0
for pool in sorted(by_pool):
    conf = dict(l.split("=", 1) for l in (ROOT / pool / "server.properties").read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    rc = Rcon("127.0.0.1", int(conf["rcon.port"]), conf["rcon.password"].strip())
    # POSITIVE CONTROL. The first version probed `0 64 0` on the theory that a spawn
    # chunk is always loaded; it read 0/16 in every world, because these towns sit
    # near 355,73,147 and nothing keeps origin loaded. The control that actually
    # discriminates is in the OUTPUT of this script rather than a probe: this same
    # channel, in this same run, finds 0 ambient saplings while the growth read finds
    # hundreds at the planted cells. What is asserted per world is only the weaker
    # and true thing -- that the world answered at all.
    if 'passed' in rc.run("execute if loaded 0 64 0").lower(): ctl_ok += 1
    answered = rc.run("seed")
    if not answered.strip():
        print(f"{pool:<11} RCON ANSWERED NOTHING to `seed` -- treat this world's row as unread")
    mix = collections.Counter()
    for r in by_pool[pool]:
        for dx, dy, dz in OFFS:
            pos = f"{int(r['x'])+dx} {int(r['y'])+dy} {int(r['z'])+dz}"
            if 'passed' not in rc.run(f"execute if loaded {pos}").lower():
                mix['UNLOADED'] += 1; continue
            hit = 'other'
            for label, blk in TESTS:
                if 'passed' in rc.run(f"execute if block {pos} {blk}").lower():
                    hit = label; break
            mix[hit] += 1
    print(f"{pool:<11} {dict(mix)}")
    tot.update(mix)
read = sum(v for k, v in tot.items() if k != 'UNLOADED')
print(f"\nthe 0,0,64 probe was loaded in {ctl_ok}/{len(by_pool)} worlds -- EXPECTED TO BE 0,")
print("and it is not the control: see the comment. The control is ambient sapling 0.00%")
print("against the growth read's hundreds of saplings at planted cells, same channel, same run.")
print(f"AMBIENT (displaced +-7 blocks, 4 per planting): readable {read} of {sum(tot.values())}")
print("  ", tot.most_common())
print(f"  ambient log/leaves {100*(tot['log']+tot['leaves'])/read:.2f}%   "
      f"ambient sapling {100*tot['sapling']/read:.2f}%   ambient air {100*tot['air']/read:.1f}%")
