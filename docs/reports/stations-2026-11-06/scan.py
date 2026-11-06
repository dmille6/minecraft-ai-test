import json, sys, os, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('tb', os.path.join(here, 'townplan_blockdump.py')); tb = importlib.util.module_from_spec(spec); spec.loader.exec_module(tb)
rdir, hx, hy, hz, R = sys.argv[1], *map(int, sys.argv[2:6])
WANT = {'crafting_table', 'furnace'}
found, missing, chunks = [], 0, 0
for cx in range((hx - R) >> 4, ((hx + R) >> 4) + 1):
    for cz in range((hz - R) >> 4, ((hz + R) >> 4) + 1):
        try: ch = tb.chunk(rdir, cx, cz)
        except Exception: ch = None
        if ch is None: missing += 1; continue
        chunks += 1
        be = {}
        for e in ch.get('block_entities', []) or []:
            if e.get('id') == 'minecraft:furnace': be[(e.get('x'), e.get('y'), e.get('z'))] = sum(int(i.get('count', i.get('Count', 1))) for i in (e.get('Items') or []))
        for s in ch.get('sections', []):
            bs = s.get('block_states') or {}
            pal = bs.get('palette') or []
            idx = {i: p for i, p in enumerate(pal) if p.get('Name', '').replace('minecraft:', '') in WANT}
            if not idx: continue
            vals = tb.section_values(bs)
            sy = s.get('Y')
            for n in range(4096):
                v = vals[n] if vals is not None else 0
                if v in idx:
                    ly, rem = divmod(n, 256); lz, lx = divmod(rem, 16)
                    x, y, z = cx * 16 + lx, sy * 16 + ly, cz * 16 + lz
                    if max(abs(x - hx), abs(z - hz)) > R: continue
                    p = idx[v]; nm = p['Name'].replace('minecraft:', '')
                    found.append({'at': [x, y, z], 'name': nm, 'lit': (p.get('Properties') or {}).get('lit') == 'true', 'items': be.get((x, y, z), 0) if nm == 'furnace' else None})
print(json.dumps({'chunks': chunks, 'missing': missing, 'found': found}))
