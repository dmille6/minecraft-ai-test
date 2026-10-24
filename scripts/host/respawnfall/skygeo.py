# skygeo.py <cf_sky_isoa.json> <out platform.json> -- the platform geometry for the respawnfall-01 Paper driver, from the
# failmine region read of isolated-a's 10-24 backup (on 10.0.0.30 /tmp/cf_sky_isoa.json), plus the spawn-square summary.
import json, collections, sys
d = json.load(open(sys.argv[1]))
cells = d['cells']
out = {'source': 'isolated-a staged backup 2026-10-24T03:16:17Z, read-only via failmine fmserve.py region copies; the bot-placed cells (1,118) in box ' + str(d['box']) + '; natural cells (jungle leaves, vines, logs) left out',
       'cells': cells}
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
tops = {}
for x, y, z, b in cells:
    if (x, z) not in tops or y > tops[(x, z)][0]:
        tops[(x, z)] = (y, b)
near = sorted((abs(x - 355) + abs(z - 147), x, z, tops[(x, z)]) for (x, z) in tops if abs(x - 355) <= 10 and abs(z - 147) <= 10)
print(len(cells), 'columns within 10 of spawn with a bot cell:', len(near), 'of 441')
print(collections.Counter(t[3][0] for t in near).most_common(12))
col = sorted(y for x, y, z, b in cells if x == 354 and z == 148)
print('pillar 354,148 ys:', col[0], col[-1], 'n', len(col), 'gaps', [y for y in range(col[0], col[-1]) if y not in col][:60])
# other columns with >= 20 cells (pillars)
cc = collections.Counter((x, z) for x, y, z, b in cells)
print('columns with >= 10 cells:', [(k, v) for k, v in cc.most_common(10)])
for k in [(355, 147), (355, 148), (356, 147), (353, 148)]:
    print(k, sorted(y for x, y, z, b in cells if (x, z) == k)[-5:])
