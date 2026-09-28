#!/usr/bin/env python3
"""Enumerate EVERY chest in a world from its save, with contents. No coordinates guessed.

Chests are block entities, so they are listed in each chunk's `block_entities` with their
Items. This needs no RCON, no plugin, and cannot miss a chest the bots placed somewhere we
did not think to look -- which is exactly how the RCON version read zero.
"""
import sys, os, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anvil

def chests_in(region):
    out = []
    for cx in range(32):
        for cz in range(32):
            try:
                c = anvil.get_chunk(region, cx, cz)
            except Exception:
                continue
            if not c: continue
            for be in (c.get('block_entities') or []):
                bid = str(be.get('id',''))
                if not bid.endswith(('chest','barrel','shulker_box')): continue
                items = be.get('Items') or []
                out.append({
                    'id': bid.split(':')[-1],
                    'x': be.get('x'), 'y': be.get('y'), 'z': be.get('z'),
                    'slots': len(items),
                    'count': sum(int(i.get('count', i.get('Count',0)) or 0) for i in items),
                    'names': [str(i.get('id','?')).split(':')[-1] for i in items],
                })
    return out

if __name__ == '__main__':
    world = sys.argv[1]
    regions = sorted(glob.glob(f'/srv/block2/{world}/world/region/r.*.mca'))
    allc = []
    for r in regions:
        allc += chests_in(r)
    print(f"world {world}: {len(regions)} region files, {len(allc)} containers found")
    if not allc:
        print("  NONE. Either the bots have placed no chest, or the reader is wrong --")
        print("  check the positive control below before believing it.")
    tot_slots = sum(c['slots'] for c in allc)
    full = [c for c in allc if c['slots'] >= 27]
    print(f"  occupied slots total {tot_slots}; containers at/over 27 slots: {len(full)}")
    for c in sorted(allc, key=lambda c: -c['slots'])[:8]:
        names = collections.Counter(c['names'])
        print(f"   {c['id']:14s} {c['x']:6},{c['y']:4},{c['z']:6}  slots {c['slots']:2}/27 "
              f"items {c['count']:5}  top {dict(names.most_common(3))}")
    # POSITIVE CONTROL: the reader must find *some* block entity kind, or it is blind.
    kinds = collections.Counter()
    for r in regions[:2]:
        for cx in range(0,32,4):
            for cz in range(0,32,4):
                try: c = anvil.get_chunk(r, cx, cz)
                except Exception: continue
                if not c: continue
                for be in (c.get('block_entities') or []):
                    kinds[str(be.get('id','?')).split(':')[-1]] += 1
    print(f"  positive control -- block entity kinds seen in a sample: {dict(kinds.most_common(6))}")
