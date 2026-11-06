import json, glob, os, re, sys
out = {}
for d in sorted(glob.glob('/var/lib/mcai/_pool-*')):
    p = os.path.basename(d)[6:]
    if '.' in p or p.startswith('self-'): continue
    tp = sorted(glob.glob(d + '/townplan-*'))
    if not tp: continue
    t = json.load(open(tp[-1]))
    home = t['home']
    hk = '%d_%d_%d' % (home['x'], home['y'], home['z'])
    latest = {}
    for f in glob.glob(d + '/project-%s.*.g*.json' % hk):
        m = re.match(r'project-[^.]+\.([A-Za-z0-9_@-]+)\.g(\d+)\.json$', os.path.basename(f))
        if not m: continue
        nm, g = m.group(1), int(m.group(2))
        if nm not in latest or g > latest[nm][0]: latest[nm] = (g, f)
    rec, stations, boxes = {}, [], []
    for nm, (g, f) in latest.items():
        try: r = json.load(open(f))
        except Exception: continue
        if not isinstance(r, dict) or not isinstance(r.get('cells'), list): continue
        if r.get('box'): boxes.append([nm, r['box']])
        for c in r['cells']:
            a = c.get('at') if isinstance(c, dict) else None
            if isinstance(a, list) and len(a) == 3:
                k = '%d,%d,%d' % tuple(a); rec[k] = nm
                if c.get('role') in ('table', 'furnace', 'crafting_table'): stations.append([nm, c.get('role'), k, bool(r.get('structure_complete'))])
    zones = []
    try: zones = json.load(open(d + '/protected-zones.json')).get('zones', [])
    except Exception: pass
    out[p] = {'home': home, 's': t.get('s'), 'plots': [[x.get('id'), x.get('kind'), x.get('box')] for x in t.get('plots', [])], 'records': rec, 'stations': stations, 'boxes': boxes, 'zones': [[z.get('id'), z.get('kind'), z.get('box')] for z in zones]}
json.dump(out, sys.stdout)
