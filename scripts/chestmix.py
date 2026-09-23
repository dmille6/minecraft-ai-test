#!/usr/bin/env python3
"""WHAT IS OCCUPYING THE SLOTS. The chests are full; a slot is the scarce thing, so the
question is which NAMES hold slots, not which items are numerous."""
import sys, os, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anvil, chestsave

world = sys.argv[1] if len(sys.argv)>1 else 'hive-b'
NEAR = int(sys.argv[2]) if len(sys.argv)>2 else 24   # blocks from town
homes = {'hive-b': (355,73,147)}
hx,hy,hz = homes.get(world,(355,73,147))

allc=[]
for r in sorted(glob.glob(f'/srv/block2/{world}/world/region/r.*.mca')):
    allc += chestsave.chests_in(r)
town=[c for c in allc if abs(c['x']-hx)<=NEAR and abs(c['z']-hz)<=NEAR]
print(f"world {world}: {len(allc)} containers, {len(town)} within {NEAR} blocks of town {hx},{hz}")
slots=collections.Counter(); counts=collections.Counter()
full=0
for c in town:
    if c['slots']>=27: full+=1
    for n in c['names']: slots[n]+=1
print(f"  town containers FULL (27/27): {full} of {len(town)}")
tot=sum(slots.values()) or 1
print(f"\n  {'slots':>6s} {'%slots':>7s}  name   <- a SLOT is the scarce resource")
for n,k in slots.most_common(18):
    print(f"  {k:6d} {100.0*k/tot:6.1f}%  {n}")
TOOLS=[n for n in slots if n.endswith(('_pickaxe','_axe','_shovel','_sword','_hoe'))]
JUNK=['leaf_litter','bamboo','short_grass','dirt','cobblestone','torch','stick','rotten_flesh','bone','string','seagrass','kelp','vine','sand','gravel']
tool_s=sum(slots[n] for n in TOOLS); junk_s=sum(slots[n] for n in JUNK if n in slots)
logs_s=sum(k for n,k in slots.items() if n.endswith('_log'))
print(f"\n  TOOLS occupy   {tool_s:5d} slots ({100.0*tool_s/tot:.1f}%)  <- deposit banks the tools the bots need")
print(f"  low-value junk {junk_s:5d} slots ({100.0*junk_s/tot:.1f}%)")
print(f"  LOGS occupy    {logs_s:5d} slots ({100.0*logs_s/tot:.1f}%)  <- the thing we are trying to bank")
