#!/usr/bin/env python3
"""routewatch.py / regiondump.py / routereplay.mjs (11-14): can the bots still walk to it. The verdicts are pure and tested on
built inputs; the region reader is tested on a region file WRITTEN here (anvil, 4-bit and 5-bit palettes); the replay runs
the REAL mineflayer-pathfinder A* (node, bots/node_modules) over the showcase well's stair as it was -- with its step, and
after the tidy cut it. Every "no alarm" sits beside the same input WITH the alarm; mutants at the end."""
import datetime as dt, json, math, os, struct, subprocess, sys, tempfile, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..'))
import routewatch as RW  # noqa: E402
import regiondump as RD  # noqa: E402
from lib import alarm as AL  # noqa: E402

MODULES = os.environ.get('ROUTE_MODULES') or os.path.join(REPO, 'bots')
fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1

NOW = dt.datetime(2026, 11, 13, 19, 50, tzinfo=dt.timezone.utc)
BOTS = ['showcase-%s' % n for n in ('Alpha', 'Bravo', 'Comet', 'Delta')]
def row(name, pos, status='success', bot=0, mins=60):
    return {'t': NOW - dt.timedelta(minutes=mins), 'name': name, 'status': status, 'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]}, 'bot': BOTS[bot % 4]}

# ---- where the services are -------------------------------------------------------------------------------------------
check(RW.feet_cell({'x': 0.3, 'y': 69.9375, 'z': 8.7}) == (0, 70, 8), 'a bot on a dirt path (y .9375) has its feet in the cell above the path')
check(RW.feet_cell({'x': 12.48, 'y': 74.0, 'z': 6.5}) == (12, 74, 6) and RW.feet_cell({'x': -0.05, 'y': 66, 'z': 5.6}) == (-1, 66, 5), 'whole blocks and negative x floor as cells')
check(RW.feet_cell(None) is None and RW.feet_cell({'x': 1}) is None, 'no position is no cell')
rows = [row('home', (2.4, 70, 0.5), bot=i) for i in range(8)] + [row('home', (-0.5, 71, -0.5), bot=i) for i in range(3)] + \
       [row('dispose_well', (12.5, 74, 6.5), bot=i) for i in range(5)] + [row('town_deposit', (-4.5, 71, 6.5), bot=i % 2) for i in range(3)] + \
       [row('dispose_well', (12.5, 74, 6.5), 'failed', bot=i) for i in range(9)] + \
       [row('compost', (0.5, 70, 8.5), bot=0) for i in range(6)] + [row('smelt_town', (25.5, 32, -38.5), bot=i) for i in range(6)] + \
       [row('deposit', (300.5, 70, 6.5), bot=i) for i in range(6)] + [row('explore', (5.5, 70, 6.5), bot=i) for i in range(6)] + \
       [row('withdraw_pick', (14.5, 71, -55.5), bot=i) for i in range(2)]
homes = RW.find_home(rows)
check(homes == [(2, 70, 0), (-1, 71, -1)], f'the starts are where `home` ends, most used first ({homes})')
sv = RW.services(rows, homes[0])
check([d['key'] for d in sv] == ['dispose_well@12,74,6', 'town_deposit@-5,71,6'], f"the services are the cells town skills SUCCEEDED on ({[d['key'] for d in sv]})")
check(sv[0]['uses'] == 5 and sv[0]['bots'] == 4, 'with their uses and bots (failures are not uses)')
check(all('compost' not in d['key'] for d in sv), 'one bot alone is not a service')
check(all('smelt_town' not in d['key'] for d in sv), 'a furnace in a mine (y 32) is not the town\'s')
check(all('300' not in d['key'] for d in sv), 'a chest 300 blocks out is not the town\'s')
check(all('explore' not in d['key'] and 'withdraw_pick' not in d['key'] for d in sv), 'other skills and a cell used twice are not listed')
check(RW.services(rows, None) == [], 'no home, no services')

# ---- the ground: a region file written here ---------------------------------------------------------------------------
def nbt(v, name=None, top=False):
    def s(x): b = x.encode(); return struct.pack('>H', len(b)) + b
    def tag(x):
        return 10 if isinstance(x, dict) else 9 if isinstance(x, list) else 8 if isinstance(x, str) else 12 if isinstance(x, tuple) else 3
    def pay(x):
        if isinstance(x, dict): return b''.join(bytes([tag(v)]) + s(k) + pay(v) for k, v in x.items()) + b'\x00'
        if isinstance(x, list): return bytes([tag(x[0]) if x else 0]) + struct.pack('>i', len(x)) + b''.join(pay(e) for e in x)
        if isinstance(x, str): return s(x)
        if isinstance(x, tuple): return struct.pack('>i', len(x)) + b''.join(struct.pack('>q', e) for e in x)
        return struct.pack('>i', x)
    return bytes([10]) + s('') + pay(v)
def pack(indices, n_pal):
    bits = max(4, math.ceil(math.log2(n_pal))); per = 64 // bits; longs = []
    for i in range(0, 4096, per):
        v = 0
        for j, ix in enumerate(indices[i:i + per]): v |= ix << (j * bits)
        longs.append(v - (1 << 64) if v >= (1 << 63) else v)
    return tuple(longs)
def write_region(d, chunks):
    """chunks: {(cx, cz): [(section Y, palette [(name, props)], {(x, y, z) local: palette index})]} into r.0.0.mca"""
    head = bytearray(8192); body = b''; sector = 2
    for (cx, cz), secs in chunks.items():
        sections = []
        for sy, pal, cells in secs:
            ix = [0] * 4096
            for (x, y, z), p in cells.items(): ix[y * 256 + z * 16 + x] = p
            bs = {'palette': [dict({'Name': n}, **({'Properties': pr} if pr else {})) for n, pr in pal]}
            if len(pal) > 1: bs['data'] = pack(ix, len(pal))
            sections.append({'Y': sy, 'block_states': bs})
        raw = zlib.compress(nbt({'sections': sections}))
        blob = struct.pack('>IB', len(raw) + 1, 2) + raw
        blob += b'\x00' * (-len(blob) % 4096)
        struct.pack_into('>I', head, 4 * (cx + cz * 32), (sector << 8) | (len(blob) // 4096))
        sector += len(blob) // 4096; body += blob
    open(os.path.join(d, 'r.0.0.mca'), 'wb').write(bytes(head) + body)
with tempfile.TemporaryDirectory() as d:
    many = [('minecraft:air', None)] + [('minecraft:stone', None), ('minecraft:dirt', None), ('minecraft:grass_block', {'snowy': 'false'})] + \
           [('minecraft:oak_trapdoor', {'half': 'top', 'open': 'true', 'facing': f}) for f in ('north', 'south', 'east', 'west')] + \
           [('minecraft:wool_%d' % i, None) for i in range(12)]           # 20 entries: a 5-bit palette
    write_region(d, {(0, 0): [(4, [('minecraft:air', None), ('minecraft:stone', None), ('minecraft:cobblestone', None)], {(1, 0, 2): 1, (15, 15, 15): 2, (3, 9, 4): 1}),
                              (5, many, {(0, 0, 0): 3, (5, 1, 6): 5, (7, 2, 7): 19, (8, 3, 8): 1}),
                              (6, [('minecraft:stone', None)], {})],
                     (1, 0): [(4, [('minecraft:air', None), ('minecraft:dirt', None)], {(0, 5, 0): 1})]})
    out = RD.dump(d, 0, 31, 0, 15, 64, 95)
    got = {(x, y, z): (out['palette'][i]['name'], out['palette'][i]['props']) for x, y, z, i in out['cells']}
    check(out['chunks'] == 2 and out['missing_chunks'] == 0 and out['saved'], f"both chunks read ({out['chunks']}, saved {out['saved']})")
    check(got.get((1, 64, 2)) == ('stone', {}) and got.get((15, 79, 15)) == ('cobblestone', {}) and got.get((3, 73, 4)) == ('stone', {}), 'a 4-bit section: x, y, z and names come back where they were put')
    check(got.get((0, 80, 0)) == ('grass_block', {'snowy': 'false'}) and got.get((5, 81, 6)) == ('oak_trapdoor', {'half': 'top', 'open': 'true', 'facing': 'south'}), 'a 5-bit section: properties come back with the block')
    check(got.get((7, 82, 7)) == ('wool_11', {}) and got.get((8, 83, 8)) == ('stone', {}), 'the last palette entry and a block after it')
    check(got.get((16, 69, 0)) == ('dirt', {}), 'the next chunk is offset by 16')
    check(len(got) == 8, f'air is never listed, and a one-entry section above the box is not read ({len(got)} blocks)')
    check(len(RD.dump(d, 0, 31, 0, 15, 64, 79)['cells']) == 4 and len(RD.dump(d, 0, 15, 0, 15, 64, 95)['cells']) == 7, 'the box is cut in y and in x')
    solid = RD.dump(d, 0, 15, 0, 15, 96, 97)
    check(len(solid['cells']) == 2 * 256 and solid['palette'] == [{'name': 'stone', 'props': {}}], 'a section of one block kind (no data array) is all that block')
    miss = RD.dump(d, 0, 47, 0, 15, 64, 95)
    check(miss['missing_chunks'] == 1 and miss['chunks'] == 2, 'a chunk that is not in the file is counted missing, never read as empty ground')
    check(RD.dump(os.path.join(d, 'nowhere'), 0, 15, 0, 15, 64, 95)['missing_chunks'] == 1, 'a region file that is not there too')

# ---- the walk: the REAL A* over the well's stair (the showcase's, in small) --------------------------------------------
def stair_dump(step=True):
    """ground top y 69 over x -4..10, z -4..4; a one-wide stair along z = 0 rising a block a step (tops 70, 71, 72 at x 3, 4, 5)
    to the stand's block at x 6 (top 72, feet 73). step=False: the first tread (3,70,0) is cut -- a two-block rise."""
    cells = [[x, y, z, 0] for x in range(-4, 11) for z in range(-4, 5) for y in (68, 69)]
    cells += [[4, y, 0, 0] for y in (70, 71)] + [[x, y, 0, 0] for x in (5, 6) for y in (70, 71, 72)]
    if step: cells.append([3, 70, 0, 1])
    return {'palette': [{'name': 'stone', 'props': {}}, {'name': 'grass_block', 'props': {'snowy': 'false'}}], 'cells': cells, 'floor_y': 68}
D = [{'key': 'dispose_well@6,73,0', 'cell': [6, 73, 0], 'uses': 210, 'bots': 14}, {'key': 'town_deposit@-2,70,2', 'cell': [-2, 70, 2], 'uses': 20, 'bots': 9},
     {'key': 'smelt_town@5,60,0', 'cell': [5, 60, 0], 'uses': 6, 'bots': 3}]
def run(dump):
    return RW.replay(dump, [(0, 70, 0)], D, 'node', os.path.join(HERE, 'routereplay.mjs'), MODULES, timeout_ms=1500)
whole, unknown = run(stair_dump(True))
check(whole['dispose_well@6,73,0']['status'] == 'success' and whole['dispose_well@6,73,0']['path'][-1] == [6, 73, 0], f"with its step the stand is walked to ({len(whole['dispose_well@6,73,0']['path'])} steps)")
check([3, 71, 0] in whole['dispose_well@6,73,0']['path'], 'over the tread at 3,70,0')
check(whole['town_deposit@-2,70,2']['status'] == 'success' and unknown == [], 'and so is a chest on the flat')
check(whole['smelt_town@5,60,0']['status'] == 'bad_cell', 'a cell inside stone is named as not standable, never searched')
cut, _ = run(stair_dump(False))
check(cut['dispose_well@6,73,0']['status'] in ('noPath', 'timeout', 'partial') and cut['dispose_well@6,73,0']['path'] == [], f"LIVE 11-13 18:12Z shape: the tread cut, an empty bag has no way up ({cut['dispose_well@6,73,0']['status']})")
check(cut['town_deposit@-2,70,2']['status'] == 'success', 'POSITIVE CONTROL: the same run still walks to the chest')

# ---- the verdicts -----------------------------------------------------------------------------------------------------
w_whole, w_cut = RW.world_of(stair_dump(True)), RW.world_of(stair_dump(False))
al, st1 = RW.judge(D, whole, {}, w_whole, NOW)
check(st1['dispose_well@6,73,0']['status'] == 'walk' and st1['dispose_well@6,73,0']['route'][0][:3] and set(al) == {'nowalk:smelt_town@5,60,0'}, f'first run: the walks are kept; only the unreachable cell is said ({sorted(al)})')
check('not standable in the save' in al['nowalk:smelt_town@5,60,0'] and '6 uses by 3 bots' in al['nowalk:smelt_town@5,60,0'], 'with its uses and why')
tread = [f for f in st1['dispose_well@6,73,0']['route'] if f[:3] == [3, 71, 0]]
check(tread and tread[0][3] == 'grass_block', 'the kept route knows what each step stands on')
later = NOW + dt.timedelta(hours=1)
al2, st2 = RW.judge(D, cut, st1, w_cut, later)
line = al2.get('lost:dispose_well@6,73,0', '')
check('lost:dispose_well@6,73,0' in al2 and 'under 3,71,0: grass_block -> air' in line, 'THE CUT IS NAMED: ' + line[:150])
check('210 uses by 14 bots' in line and 'GONE (since 2026-11-13T20:50:00Z' in line, 'with who used it and since when')
check(st2['dispose_well@6,73,0']['status'] == 'lost' and st2['dispose_well@6,73,0']['route'] == st1['dispose_well@6,73,0']['route'], 'the kept route is held while the walk is lost')
al3, st3 = RW.judge(D, cut, st2, w_cut, later + dt.timedelta(hours=5))
check('GONE (since 2026-11-13T20:50:00Z' in al3['lost:dispose_well@6,73,0'], 'five hours on it is still lost, since the same time')
al4, st4 = RW.judge(D, whole, st3, w_whole, later + dt.timedelta(hours=6))
check('lost:dispose_well@6,73,0' not in al4 and st4['dispose_well@6,73,0']['status'] == 'walk' and st4['dispose_well@6,73,0']['since'] == AL._iso(later + dt.timedelta(hours=6)), 'the walk back, the alarm is gone and the route is kept anew')
aln, stn = RW.judge(D, cut, {}, w_cut, NOW)
check('nowalk:dispose_well@6,73,0' in aln and 'lost:dispose_well@6,73,0' not in aln, 'POSITIVE CONTROL: never seen walked is `nowalk` (digest), not `lost`')
quiet_d = [d for d in D if 'dispose_well' not in d['key']]
_, stq = RW.judge(quiet_d, whole, st1, w_whole, later)
check(stq['dispose_well@6,73,0'].get('quiet') and stq['dispose_well@6,73,0']['route'], 'a service nobody used today keeps its route')
_, sto = RW.judge(quiet_d, whole, {'dispose_well@6,73,0': dict(st1['dispose_well@6,73,0'], seen='2026-11-01T00:00:00Z')}, w_whole, later)
check('dispose_well@6,73,0' not in sto, 'for a week, then it is forgotten')
check(RW.what_changed([[3, 71, 0, 'grass_block', '', '']], {(3, 71, 0): 'dirt', (3, 72, 0): 'cobblestone'}) == ['under 3,71,0: grass_block -> air', 'at 3,71,0: air -> dirt', 'above 3,71,0: air -> cobblestone'], 'what_changed names a block gone from under, and a block put in the way')
for k in ('lost:dispose_well@6,73,0', 'routewatch:showcase'):
    check(AL.tier_of('routewatch-showcase', k) == AL.TIER_PAGE, f'{k} pages')
for k in ('nowalk:smelt_town@5,60,0', 'blind:save'):
    check(AL.tier_of('routewatch-showcase', k) == AL.TIER_DIGEST, f'{k} goes to the digest')

# ---- mutants (the anchor must be present and unique) ---------------------------------------------------------------------
SRC = open(os.path.join(HERE, 'routewatch.py')).read()
def mutant(old, new):
    assert SRC.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    ns = {'__name__': 'routewatch_mutant', '__file__': os.path.join(HERE, 'routewatch.py')}
    exec(compile(SRC.replace(old, new), 'routewatch_mutant', 'exec'), ns)
    return ns
def killed(name, got):
    check(got, 'MUTANT KILLED: ' + name)
m = mutant("        had = p.get('route')\n", "        had = None\n")
killed('without the kept route a lost walk is only a to-do', 'lost:dispose_well@6,73,0' not in m['judge'](D, cut, st1, w_cut, later)[0])
m = mutant("since = p.get('since') if p.get('status') == 'lost' else AL._iso(now)", "since = AL._iso(now)")
killed('a loss that forgets when it began', 'GONE (since 2026-11-13T20:50:00Z' not in m['judge'](D, cut, st2, w_cut, later + dt.timedelta(hours=5))[0]['lost:dispose_well@6,73,0'])
m = mutant("if r['name'] not in TOWN_SKILLS or r['status'] != 'success':", "if r['name'] not in TOWN_SKILLS:")
killed('failures counted as uses', m['services'](rows, homes[0])[0]['uses'] == 14)
m = mutant("        return (math.floor(pos['x']), math.floor(pos['y'] + 0.5), math.floor(pos['z']))", "        return (math.floor(pos['x']), math.floor(pos['y']), math.floor(pos['z']))")
killed('a floor without the half block puts the feet inside the path block', m['feet_cell']({'x': 0.3, 'y': 69.9375, 'z': 8.7}) == (0, 69, 8))
m = mutant("if n >= MIN_USES and len(who[(s, c)]) >= MIN_BOTS]", "if n >= MIN_USES]")
killed('without the bot floor one bot is a service', any('compost' in d['key'] for d in m['services'](rows, homes[0])))
sys.exit(1 if fails else 0)
