#!/usr/bin/env python3
"""READ-ONLY: list a world's generated structures and write protectzone-01's `protected-zones.json` for its villages.

protectzone-01 (docs/reports/protectzone-01-design-2026-10-20.md). Stdlib only (the showcase VM has no nbt package).

  structure_zones.py <region_dir> --home X Z [--radius 1000] [--pad 8] [--seed N] [--world NAME] [--kinds village]
                     [--out zones.json] [--list structures.json]

It reads COPIES of the region files (never the live world: copy them first, e.g. `tar -C <world> -cf - region`):
  1. every structure START in the chunk NBT (`structures.starts`) with its pieces' bounding boxes;
  2. for each kept structure (default: minecraft:village_*), the blocks a village builds inside its pieces' union box
     (beds, bell, workstations, dirt_path, spruce planks/doors/trapdoors, glass panes, torches, cobblestone, chests ...);
  3. its FOOTPRINT: the extent of those blocks together with its house and town-centre pieces (a street piece that left no
     block -- e.g. one generated over podzol -- adds nothing), padded `pad` blocks horizontally, from (lowest block - pad)
     to (highest block or house roof + pad).
`hashed_seed` is the login packet's hashedSeed as mineflayer reads it (worldIdFromLogin: "<hi>:<lo>" of the int64
sha256(seed) first 8 bytes, little-endian) -- verified against a sandbox bot's logged world id.
"""
import argparse, collections, glob, gzip, hashlib, json, math, os, struct, sys, zlib


def tag(b, o, t):
    if t == 1: return struct.unpack_from('>b', b, o)[0], o + 1
    if t == 2: return struct.unpack_from('>h', b, o)[0], o + 2
    if t == 3: return struct.unpack_from('>i', b, o)[0], o + 4
    if t == 4: return struct.unpack_from('>q', b, o)[0], o + 8
    if t == 5: return struct.unpack_from('>f', b, o)[0], o + 4
    if t == 6: return struct.unpack_from('>d', b, o)[0], o + 8
    if t == 7:
        n = struct.unpack_from('>i', b, o)[0]; o += 4; return b[o:o + n], o + n
    if t == 8:
        n = struct.unpack_from('>H', b, o)[0]; o += 2; return b[o:o + n].decode('utf-8', 'replace'), o + n
    if t == 9:
        et, n = struct.unpack_from('>bi', b, o); o += 5; out = []
        for _ in range(n):
            v, o = tag(b, o, et); out.append(v)
        return out, o
    if t == 10:
        d = {}
        while True:
            tt = b[o]; o += 1
            if tt == 0: return d, o
            n = struct.unpack_from('>H', b, o)[0]; o += 2
            name = b[o:o + n].decode('utf-8', 'replace'); o += n
            v, o = tag(b, o, tt); d[name] = v
    if t == 11:
        n = struct.unpack_from('>i', b, o)[0]; o += 4
        return list(struct.unpack_from('>%di' % n, b, o)), o + 4 * n
    if t == 12:
        n = struct.unpack_from('>i', b, o)[0]; o += 4
        return list(struct.unpack_from('>%dq' % n, b, o)), o + 8 * n
    raise ValueError('tag %d' % t)


def chunks(path):
    data = open(path, 'rb').read()
    if len(data) < 8192: return
    for i in range(1024):
        off = int.from_bytes(data[i * 4:i * 4 + 3], 'big'); cnt = data[i * 4 + 3]
        if off == 0 or cnt == 0: continue
        p = off * 4096
        ln = struct.unpack_from('>i', data, p)[0]; comp = data[p + 4]
        raw = data[p + 5:p + 4 + ln]
        try:
            raw = zlib.decompress(raw) if comp == 2 else gzip.decompress(raw) if comp == 1 else raw if comp == 3 else None
            if raw is None: continue
            n = struct.unpack_from('>H', raw, 1)[0]
            yield tag(raw, 3 + n, raw[0])[0]
        except Exception as e:  # a torn chunk in a copied file: named, skipped
            print('WARN chunk', path, i, e, file=sys.stderr)


def regions(rd, x0, z0, x1, z1):
    for f in sorted(glob.glob(os.path.join(rd, 'r.*.mca'))):
        rx, rz = map(int, os.path.basename(f).split('.')[1:3])
        if rx * 512 > x1 or rx * 512 + 511 < x0 or rz * 512 > z1 or rz * 512 + 511 < z0: continue
        yield f


MARK = set('''bell dirt_path hay_block chest barrel smoker blast_furnace cartography_table fletching_table grindstone
lectern loom smithing_table stonecutter cauldron water_cauldron brewing_stand composter spruce_planks spruce_stairs
spruce_slab spruce_door spruce_fence spruce_fence_gate spruce_trapdoor oak_planks oak_stairs oak_door oak_fence
glass_pane torch wall_torch lantern farmland wheat carrots potatoes beetroots campfire flower_pot white_wool cobblestone
cobblestone_stairs cobblestone_slab cobblestone_wall stripped_spruce_log stripped_spruce_wood crafting_table furnace
packed_ice snow_block blue_ice ladder bookshelf white_terracotta'''.split())


def marker(name):
    n = name.split(':', 1)[-1]
    return n in MARK or n.endswith('_bed') or n.startswith('potted_') or n.endswith('_carpet')


def decode(sec):
    bs = sec.get('block_states') or {}
    pal = bs.get('palette') or []
    data = bs.get('data')
    if not pal: return None, None
    if len(pal) == 1 or data is None: return pal, None
    bits = max(4, math.ceil(math.log2(len(pal)))); per = 64 // bits; mask = (1 << bits) - 1
    idx = []
    for v in data:
        v &= (1 << 64) - 1
        for k in range(per):
            idx.append((v >> (k * bits)) & mask)
            if len(idx) == 4096: return pal, idx
    return pal, idx


def scan_markers(rd, box):
    x0, y0, z0, x1, y1, z1 = box
    hits = []
    for f in regions(rd, x0, z0, x1, z1):
        for c in chunks(f):
            cx, cz = c.get('xPos'), c.get('zPos')
            if cx is None or cx * 16 > x1 or cx * 16 + 15 < x0 or cz * 16 > z1 or cz * 16 + 15 < z0: continue
            for sec in c.get('sections', []):
                sy = sec.get('Y')
                if sy is None or sy * 16 > y1 or sy * 16 + 15 < y0: continue
                pal, idx = decode(sec)
                if not pal: continue
                names = [p.get('Name', '') for p in pal]
                mk = [marker(n) for n in names]
                if not any(mk): continue
                for i, pi in enumerate(idx or [0] * 4096):
                    if pi < len(mk) and mk[pi]:
                        x = cx * 16 + (i & 15); z = cz * 16 + ((i >> 4) & 15); y = sy * 16 + (i >> 8)
                        if x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1: hits.append((x, y, z, names[pi].split(':')[-1]))
    return hits


def world_id(seed):
    v = struct.unpack('<q', hashlib.sha256(struct.pack('<q', seed)).digest()[:8])[0]
    hi, lo = struct.unpack('>ii', struct.pack('>q', v))
    return f'{hi}:{lo}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('region_dir'); ap.add_argument('--home', nargs=2, type=int, required=True)
    ap.add_argument('--radius', type=int, default=1000); ap.add_argument('--pad', type=int, default=8)
    ap.add_argument('--seed', type=int); ap.add_argument('--world', default='showcase')
    ap.add_argument('--kinds', default='village'); ap.add_argument('--out'); ap.add_argument('--list')
    a = ap.parse_args()
    hx, hz = a.home
    starts, walked = [], 0
    for f in sorted(glob.glob(os.path.join(a.region_dir, 'r.*.mca'))):
        for c in chunks(f):
            walked += 1
            for sid, st in ((c.get('structures') or {}).get('starts') or {}).items():
                if st.get('id') == 'INVALID': continue
                pcs = [{'id': p.get('id'), 'BB': p.get('BB'), 'pool': (p.get('pool_element') or {}).get('location') if isinstance(p.get('pool_element'), dict) else None}
                       for p in st.get('Children', []) or [] if p.get('BB')]
                if not pcs: continue
                lo = [min(p['BB'][i] for p in pcs) for i in range(3)]; hi = [max(p['BB'][i + 3] for p in pcs) for i in range(3)]
                cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
                starts.append({'structure': sid, 'chunk': [st.get('ChunkX'), st.get('ChunkZ')], 'box': lo + hi, 'pieces': pcs,
                               'dist': round(max(abs(cx - hx), abs(cz - hz)))})
    # POSITIVE CONTROL: the walk saw chunks and structures at all (a zero here is a reader bug, not an empty world)
    print(f'chunks walked {walked}; structure starts {len(starts)}', file=sys.stderr)
    if not walked or not starts: sys.exit('ZERO LOOKS WRONG: no chunks or no structure starts read')
    near = sorted([s for s in starts if s['dist'] <= a.radius], key=lambda s: s['dist'])
    kinds = [k.strip() for k in a.kinds.split(',') if k.strip()]
    zones, report = [], []
    for s in near:
        name = s['structure'].split(':')[-1]
        row = {'structure': s['structure'], 'chunk': s['chunk'], 'box': s['box'], 'pieces': len(s['pieces']), 'dist': s['dist']}
        if any(name.startswith(k) for k in kinds):
            hits = scan_markers(a.region_dir, s['box'])
            houses = [p['BB'] for p in s['pieces'] if p['pool'] and ('/houses/' in p['pool'] or '/town_centers/' in p['pool'])]
            pts = [(h[0], h[1], h[2]) for h in hits] + [(b[0], b[1], b[2]) for b in houses] + [(b[3], b[4], b[5]) for b in houses]
            row['markers'] = len(hits); row['marker_counts'] = dict(collections.Counter(h[3] for h in hits).most_common(12))
            row['houses'] = len(houses)
            if not hits:
                row['zone'] = None; row['why'] = 'no village-made block found (not protected; check by hand)'
            else:
                xs = [p[0] for p in pts]; ys = [h[1] for h in hits]; zs = [p[2] for p in pts]
                top = max(ys + [b[4] for b in houses])
                box = [min(xs) - a.pad, min(ys) - a.pad, min(zs) - a.pad, max(xs) + a.pad, top + a.pad, max(zs) + a.pad]
                zid = f"{name.replace('_', '-')}-{s['chunk'][0]}_{s['chunk'][1]}"
                row['zone'] = zid
                row['special'] = [list(h) for h in hits if h[3] in ('bell', 'chest', 'barrel', 'crafting_table', 'furnace', 'smoker', 'blast_furnace') or h[3].endswith('_bed') or h[3].endswith('_table') or h[3] in ('grindstone', 'lectern', 'loom', 'stonecutter', 'composter', 'water_cauldron', 'cauldron', 'brewing_stand')]
                zones.append({'id': zid, 'kind': 'village', 'label': f"the {name.split('_')[-1]} village at {(box[0] + box[3]) // 2},{(box[2] + box[5]) // 2}",
                              'box': box, 'source': f"{s['structure']} start chunk {s['chunk'][0]},{s['chunk'][1]}: {len(hits)} village blocks, {len(houses)} houses, pad {a.pad}"})
        report.append(row)
    if a.list: json.dump({'home': [hx, hz], 'radius': a.radius, 'chunks_walked': walked, 'structures': report}, open(a.list, 'w'), indent=1)
    if a.out:
        doc = {'version': 1, 'world': a.world, 'zones': zones, 'generated_by': 'infra/showcase/structure_zones.py', 'policy': 'scenery (OWNER 2026-10-20 option 1)'}
        if a.seed is not None: doc = {'version': 1, 'world': a.world, 'seed': a.seed, 'hashed_seed': world_id(a.seed), **{k: v for k, v in doc.items() if k not in ('version', 'world')}}
        json.dump(doc, open(a.out, 'w'), indent=1)
    for r in report:
        print(f"{r['dist']:5d}  {r['structure']:32s} chunk {r['chunk']}  box {r['box']}" + (f"  -> zone {r.get('zone')} markers {r.get('markers')}" if 'markers' in r else ''))
    for z in zones: print('ZONE', z['id'], z['box'], z['source'])


if __name__ == '__main__':
    main()
