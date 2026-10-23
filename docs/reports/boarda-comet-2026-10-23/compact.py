from anvil_read import Region
r = Region('r.0.0.mca')
CODE = {'stone': 'S', 'cobblestone': 'C', 'dirt': 'D', 'granite': 'G', 'diorite': 'd', 'andesite': 'A', 'copper_ore': 'Cu',
        'air': '.', 'cave_air': '.', 'ladder': 'L', 'crafting_table': 'T', 'cobbled_deepslate': 'k', 'oak_planks': 'P',
        'dripstone_block': 'B', 'pointed_dripstone': 'p'}
def c(b):
    n = b['Name'].replace('minecraft:', '')
    if n == 'water':
        lv = int(b['Properties']['level'])
        return 'w0' if lv == 0 else ('wf' if lv >= 8 else 'w%d' % lv)
    return CODE.get(n, n[:3])
X, Y, Z = 359, 40, 187
print('cols x=356..362 left->right, rows z=184..190 top->bottom (north at top); [] = the bot column 359,_,187')
for dy in range(6, -5, -1):
    y = Y + dy
    print('y=%d (%+d)' % (y, dy))
    for z in range(184, 191):
        cells = []
        for x in range(356, 363):
            s = c(r.block(x, y, z))
            cells.append(('[%s]' % s) if (x, z) == (X, Z) else ' %s ' % s)
        print('  z%d ' % z + ''.join('%-5s' % t for t in cells))
