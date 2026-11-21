#!/usr/bin/env python3
"""SANDBOX-ONLY (stepwell-04show rig): the rig pool COPY's town index made as fresh as the world copy it describes.
The world copy was saved at 11-20 14:48Z, one minute after the index's last observations; on the rig 12 h later every entry
reads stale and the withdraw's search walks the near chests first (live, the index is minutes old). Every 13-digit `"at":`
and `"cap":` ms in town-index-*.jsonl is shifted by (now - the newest one), so ages are kept and the newest reads now.
  freshindex.py <pool dir>"""
import glob, re, sys, time
pool = sys.argv[1]
files = sorted(glob.glob(f'{pool}/town-index-*.jsonl'))
RX = re.compile(r'"(at|cap)":(\d{13})')
newest = max((int(m.group(2)) for f in files for m in RX.finditer(open(f).read())), default=None)
if newest is None: sys.exit('no index')
delta = int(time.time() * 1000) - newest
for f in files:
    s = open(f).read()
    open(f, 'w').write(RX.sub(lambda m: f'"{m.group(1)}":{int(m.group(2)) + delta}', s))
print(f'freshindex: {len(files)} files shifted by {delta / 3.6e6:.1f} h')
