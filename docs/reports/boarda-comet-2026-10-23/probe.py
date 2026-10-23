import sys, collections
from anvil_read import Region, short
r = Region('r.0.0.mca')
B = lambda x, y, z: r.block(x, y, z)
for p in [(359, 40, 187), (359, 41, 187), (359, 42, 187), (359, 43, 187), (360, 41, 187), (360, 40, 187), (361, 40, 187), (361, 39, 187),
          (359, 39, 187), (359, 38, 187), (358, 40, 187), (359, 40, 186), (359, 41, 186), (358, 41, 187), (359, 41, 188), (359, 40, 188), (359, 40, 185)]:
    print(p, B(*p))
# sources (level 0) within radius 12
src = []
for x in range(347, 372):
    for z in range(175, 200):
        for y in range(30, 75):
            b = B(x, y, z)
            if b and b['Name'] == 'minecraft:water' and b.get('Properties', {}).get('level') == '0':
                src.append((x, y, z))
print('water sources within 12 blocks horizontally, y30-74:', len(src), sorted(src, key=lambda p: (abs(p[0]-359)+abs(p[2]-187)+abs(p[1]-40)))[:15])

SOLIDLESS = {'minecraft:air', 'minecraft:cave_air', 'minecraft:ladder', 'minecraft:vine', 'minecraft:short_grass', 'minecraft:torch',
             'minecraft:wall_torch', 'minecraft:glow_lichen', 'minecraft:tall_grass', 'minecraft:fern'}
def dry(x, y, z):
    b = B(x, y, z)
    return b is not None and b['Name'] in SOLIDLESS and b.get('Properties', {}).get('waterlogged') != 'true'
def sky(x, y, z):
    for yy in range(y, 200):
        b = B(x, yy, z)
        if b is None: return False
        n = b['Name']
        if n not in SOLIDLESS and not n.endswith('leaves') and n != 'minecraft:water': return False
    return True
# flood fill of DRY non-solid cells from the east pocket
start = (361, 40, 187)
seen = {start}; q = collections.deque([start]); maxy = start; skyhit = None
while q:
    c = q.popleft()
    if c[1] > maxy[1]: maxy = c
    if skyhit is None and sky(*c): skyhit = c
    if skyhit: break
    for d in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]:
        n = (c[0]+d[0], c[1]+d[1], c[2]+d[2])
        if n in seen or abs(n[0]-359) > 60 or abs(n[2]-187) > 60 or n[1] < 0 or n[1] > 120: continue
        if dry(*n):
            seen.add(n); q.append(n)
print('dry flood from', start, 'cells', len(seen), 'max y', maxy, 'sky-open cell', skyhit)
# same from above the copper (359,44,187)
for st in [(359, 44, 187), (360, 42, 187)]:
    seen = {st}; q = collections.deque([st]); skyhit = None; maxy = st
    while q:
        c = q.popleft()
        if c[1] > maxy[1]: maxy = c
        if sky(*c): skyhit = c; break
        for d in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]:
            n = (c[0]+d[0], c[1]+d[1], c[2]+d[2])
            if n in seen or abs(n[0]-359) > 60 or abs(n[2]-187) > 60 or n[1] < 0 or n[1] > 120: continue
            if dry(*n): seen.add(n); q.append(n)
    print('dry flood from', st, 'cells', len(seen), 'max y', maxy, 'sky-open cell', skyhit)
# surface height at the column
for yy in range(120, 30, -1):
    b = B(359, yy, 187)
    if b and b['Name'] not in ('minecraft:air', 'minecraft:cave_air'):
        print('topmost non-air at 359,_,187: y', yy, short(b)); break
