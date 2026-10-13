#!/usr/bin/env python3
"""regionscan.py <positions-in.json> <positions-out.json> -- READ-ONLY second instrument for container DISCOVERY.
Runs on the worlds host (10.0.0.30) with sudo (region files are owned by minecraft). For each world in the positions
file it reads the region files' chunk NBT around home and lists every block entity whose id is chest, trapped_chest or
barrel inside the bank box (|dx|,|dz| <= 48, |dy| <= 12). It writes the UNION of the input positions and what it
found, and prints per world: input positions, region containers, containers the input did NOT have.

Why: the 10-10 positions.py matched log rows by exp.pool, but isolated bots log pool "self-isolated-a-Alpha", not the
world "isolated-a", so every isolated town had only its 10-04 containers (19-29 positions vs 256-736 elsewhere). A
discovery list that cannot see a container is a cheap negative; this one reads the world's own saved block entities.
Region files lag the live world by up to one autosave; positions3.py (bot logs) covers the newest chests, and the RCON
census (census3.py) is the authority on what each position holds now. Nothing is written to any world file.
"""
import json, os, struct, sys, zlib, gzip

def nbt(buf):
    """Minimal NBT reader: returns the root compound as Python values (lists, dicts, numbers, str)."""
    p = [0]
    def rd(n):
        b = buf[p[0]:p[0] + n]; p[0] += n; return b
    def payload(t):
        if t == 1: return struct.unpack('>b', rd(1))[0]
        if t == 2: return struct.unpack('>h', rd(2))[0]
        if t == 3: return struct.unpack('>i', rd(4))[0]
        if t == 4: return struct.unpack('>q', rd(8))[0]
        if t == 5: return struct.unpack('>f', rd(4))[0]
        if t == 6: return struct.unpack('>d', rd(8))[0]
        if t == 7: n = struct.unpack('>i', rd(4))[0]; rd(n); return None          # byte array: skipped
        if t == 8: n = struct.unpack('>H', rd(2))[0]; return rd(n).decode('utf-8', 'replace')
        if t == 9:
            et = rd(1)[0]; n = struct.unpack('>i', rd(4))[0]
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = rd(1)[0]
                if tt == 0: return d
                k = rd(struct.unpack('>H', rd(2))[0]).decode('utf-8', 'replace'); d[k] = payload(tt)
        if t == 11: n = struct.unpack('>i', rd(4))[0]; rd(4 * n); return None
        if t == 12: n = struct.unpack('>i', rd(4))[0]; rd(8 * n); return None
        raise ValueError('bad tag %d' % t)
    t = rd(1)[0]; rd(struct.unpack('>H', rd(2))[0])
    return payload(t)

KINDS = {'minecraft:chest', 'minecraft:trapped_chest', 'minecraft:barrel'}

def scan(world, home):
    hx, hy, hz = home; found = set(); stats = {'chunks': 0, 'errors': 0, 'external': 0, 'missing_region': 0}
    for cx in range((hx - 48) >> 4, ((hx + 48) >> 4) + 1):
        for cz in range((hz - 48) >> 4, ((hz + 48) >> 4) + 1):
            rf = '/srv/block2/%s/world/region/r.%d.%d.mca' % (world, cx >> 5, cz >> 5)
            if not os.path.exists(rf): stats['missing_region'] += 1; continue
            with open(rf, 'rb') as f:
                idx = 4 * ((cx & 31) + (cz & 31) * 32); f.seek(idx); e = f.read(4)
                off = (e[0] << 16 | e[1] << 8 | e[2]) * 4096
                if not off: continue
                f.seek(off); ln, comp = struct.unpack('>iB', f.read(5)); data = f.read(ln - 1)
            if comp & 128: stats['external'] += 1; continue
            try:
                raw = zlib.decompress(data) if comp == 2 else gzip.decompress(data) if comp == 1 else data if comp == 3 else None
                if raw is None: stats['errors'] += 1; continue
                root = nbt(raw)
            except Exception:
                stats['errors'] += 1; continue
            stats['chunks'] += 1
            for be in root.get('block_entities') or []:
                if be.get('id') in KINDS:
                    x, y, z = be['x'], be['y'], be['z']
                    if abs(x - hx) <= 48 and abs(z - hz) <= 48 and abs(y - hy) <= 12: found.add((x, y, z))
    return found, stats

if __name__ == '__main__':
    P = json.load(open(sys.argv[1])); out = {}
    for w, v in sorted(P.items()):
        have = {tuple(p) for p in v['pos']}
        found, st = scan(w, v['home'])
        new = found - have
        out[w] = {'home': v['home'], 'pos': sorted(have | found), 'region_containers': len(found), 'region_only': sorted(new),
                  'region_stats': st}
        print('%-11s input %4d  region containers %3d  region-only %3d  %s' % (w, len(have), len(found), len(new), st), flush=True)
    json.dump(out, open(sys.argv[2], 'w'))
