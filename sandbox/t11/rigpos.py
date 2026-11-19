#!/usr/bin/env python3
"""SANDBOX-ONLY (rig, t11reach2-01show 11-19): set one player's saved position in a WORLD COPY's playerdata before a rig run.
The T11 rig world is a copy of the showcase; Echo was saved standing on a chest under a ceiling in the warehouse (12.5,71.9,-54.5),
from which the pathfinder never leaves (runs 16-25: every walk failed). The bots in the fleet have survival reflexes the rig harness
lacks. Never run against a live world: the rig restores the copy first, and this edits only that copy's file.
    sudo python3 rigpos.py <world dir> <uuid> <x> <y> <z>
Only the Pos list (three doubles) changes; the file is NBT, gzip, and is rewritten in place (a .bak beside it)."""
import gzip, struct, sys, shutil
world, uuid, x, y, z = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
p = f'{world}/playerdata/{uuid}.dat'
raw = gzip.open(p, 'rb').read()
tag = b'\x09\x00\x03Pos\x06\x00\x00\x00\x03'   # TAG_List "Pos" of 3 TAG_Double
assert raw.count(tag) == 1, 'Pos tag missing or not unique'
i = raw.index(tag) + len(tag)
old = struct.unpack('>ddd', raw[i:i + 24])
new = raw[:i] + struct.pack('>ddd', x, y, z) + raw[i + 24:]
shutil.copy2(p, p + '.bak')
with gzip.open(p, 'wb') as f:
    f.write(new)
print('pos', old, '->', (x, y, z))
