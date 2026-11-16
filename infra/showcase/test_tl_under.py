"""camunder-01: the underground pictures (tl_under.py). The scene finder, the choice of the cut, the block colours, the
PNG writer, a framing that holds still between two slots, and the time a frame costs.
Run: python3 -m unittest infra/showcase/test_tl_under.py (from the repo root). Mutants: test_tl_under_mutants.py."""
import base64, contextlib, datetime as dt, io, json, os, struct, sys, tempfile, time, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tl_under as U     # noqa: E402

UTC = dt.timezone.utc
T0 = 1794800000          # 2026-11-16, a whole 10 s


def walk(bot_rows, bot, x, y, z, skill, minutes, t0=T0, dx=0.0, dz=0.0):
    """`minutes` of 10-s samples of one bot around (x, y, z), drifting dx/dz blocks per sample."""
    rows = bot_rows.setdefault(bot, [])
    for k in range(int(minutes * 6)):
        rows.append((t0 + k * 10, x + dx * k, float(y), z + dz * k, skill))
    rows.sort()


def put(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f)


def get(path):
    with open(path) as f:
        return json.load(f)


def raw(path):
    with open(path, 'rb') as f:
        return f.read()


def lum(c):
    return sum(c)


class Blocks(unittest.TestCase):
    def test_names_fall_in_the_right_class(self):
        want = {'stone': 'stone', 'deepslate': 'deepslate', 'cave_air': 'air', 'air': 'air', '?': 'unknown',
                'coal_ore': 'ore_coal', 'deepslate_diamond_ore': 'dore_diamond', 'raw_iron_block': 'ore_iron',
                'water': 'water', 'glow_lichen[waterlogged]': 'water', 'ladder[waterlogged]': 'water', 'lava': 'lava',
                'snow[layers=1]': 'air', 'short_grass': 'air', 'oak_sapling': 'air', 'spruce_wall_sign': 'air',
                'wall_torch': 'torch', 'lantern': 'torch', 'ladder': 'ladder', 'rail': 'rail', 'glow_lichen': 'glow',
                'spruce_leaves': 'leaves', 'oak_fence': 'planks', 'spruce_planks': 'planks', 'spruce_log': 'log',
                'cobblestone': 'cobble', 'cobblestone_stairs': 'cobble', 'cobbled_deepslate': 'cobble_deep',
                'stone_bricks': 'stone_bricks', 'tuff_bricks': 'tuff_bricks', 'waxed_oxidized_copper': 'copper_green',
                'waxed_copper_block': 'copper', 'chest': 'chest', 'barrel': 'chest', 'furnace': 'furnace',
                'crafting_table': 'station', 'trial_spawner': 'cage', 'grass_block': 'grass', 'minecraft:granite': 'granite',
                'some_block_from_a_later_version': 'other'}
        for name, cls in want.items():
            self.assertEqual(U.classify(name), cls, name)
            self.assertIn(U.classify(name), U.CID)

    def test_ores_stand_out_from_their_rock_and_from_each_other(self):
        ores = [c for c in U._C if c[1] == 'e']
        self.assertEqual(len(ores), 16, 'eight minerals in stone and in deepslate')
        for c in ores:
            base, fg = c[6], c[7]
            self.assertGreaterEqual(sum(abs(a - b) for a, b in zip(base, fg)), 150, c[0])
        fgs = {c[7] for c in ores}
        self.assertEqual(len(fgs), 8, 'one colour per mineral, the same in stone and deepslate')
        t = U.Tiles(9)
        gold, stone = t.solid(U.CID['ore_gold']), t.solid(U.CID['stone'])
        self.assertIn(bytes((255, 218, 40)), [gold[4][i:i + 3] for i in range(0, 27, 3)], 'the ore colour is IN the tile')
        self.assertNotIn(bytes((255, 218, 40)), [stone[4][i:i + 3] for i in range(0, 27, 3)])
        dia = t.solid(U.CID['dore_diamond'], light=4, ghost=3)
        self.assertIn(bytes((90, 244, 232)), [dia[4][i:i + 3] for i in range(0, 27, 3)], 'no shading dims an ore')

    def test_open_space_is_darker_than_rock(self):
        solids = [c for c in U._C if c[1] in 'rep']
        self.assertLess(lum(U.OPEN_RGB[3]), min(lum(c[6]) for c in solids))
        for lvl in (1, 2, 3):
            for rock in ('stone', 'deepslate', 'dirt', 'tuff', 'andesite'):
                self.assertLess(lum(U.OPEN_RGB[lvl]) * 1.8, lum(U._C[U.CID[rock]][6]), (lvl, rock))
        self.assertGreater(lum(U.OPEN_RGB[4]), 2 * lum(U.OPEN_RGB[1]), 'shade under an overhang is not a cave')

    def test_water_lava_torch_and_built_blocks_differ(self):
        seen = {}
        for name in ('water', 'lava', 'cobble', 'planks', 'chest', 'furnace', 'stone', 'deepslate', 'dirt'):
            rows = U.Tiles(9).solid(U.CID[name])
            seen[name] = b''.join(rows)
        self.assertEqual(len(set(seen.values())), len(seen), 'nine blocks, nine different tiles')
        torch = U.Tiles(9).solid(U.CID['torch'])
        self.assertEqual(torch[4][12:15], bytes((255, 236, 130)), 'a torch is a bright centre')


class WorldBox(unittest.TestCase):
    def setUp(self):
        self.w, self.f = U.synthetic_world()

    def test_block_reads_the_dump_and_pads_what_is_outside(self):
        f = self.f
        self.assertEqual(self.w.class_at(40, f['tunnel_y'], f['tunnel_z']), U.AIR)
        self.assertEqual(self.w.class_at(36, f['tunnel_y'] + 1, f['tunnel_z']), U.TORCH)
        self.assertEqual(self.w.class_at(40, f['ground_y'], 10), U.CID['grass'])
        self.assertEqual(self.w.class_at(-1, 0, 0), U.UNKNOWN)
        b = self.w.block(-2, 47, 3, 49, f['tunnel_y'], f['tunnel_y'])
        self.assertEqual(len(b), 6 * 3)
        self.assertEqual(b[0:2], bytes([U.UNKNOWN, U.UNKNOWN]), 'two columns west of the dump')
        self.assertEqual(b[6 + 2], self.w.class_at(0, f['tunnel_y'], 48))
        self.assertEqual(self.w.surface_top(0, 0, 20, 20), f['ground_y'])

    def test_a_16_bit_dump_reads_the_same(self):
        w8 = self.w
        w16 = U.World(w8.box, w8.yr, w8.palette, struct.pack('<%dH' % len(w8.cells), *w8.cells), 16)
        self.assertEqual(w16.block(30, 40, 50, 55, 20, 30), w8.block(30, 40, 50, 55, 20, 30))


class Scenes(unittest.TestCase):
    def crowd(self):
        pos = {}
        for i, b in enumerate(('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')):       # five miners under the town
            walk(pos, b, 10 + 3 * i, 12 + i, 14 + 2 * i, 'mine', 30)
        for b in ('Frost', 'Gale'):                                                # two explorers far to the south-east
            walk(pos, b, 205, 30, 210, 'explore', 30)
        for b in ('Haven', 'Iris', 'Juno', 'Kite', 'Lumen', 'Maple'):              # six on the surface, same place
            walk(pos, b, 12, 70, 16, 'mine', 30)
        return pos

    def test_the_busiest_underground_place_comes_first(self):
        sc = U.find_scenes(self.crowd(), n=3)
        self.assertEqual(len(sc), 2, 'two places underground, and the surface crowd is not a third')
        a, b = sc
        self.assertEqual(a['bots'], ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'])
        self.assertTrue(a['box'][0] <= 10 and a['box'][2] >= 22 and a['box'][1] <= 14 and a['box'][3] >= 22, a['box'])
        self.assertTrue(a['y'][0] <= 12 and a['y'][1] >= 16, a['y'])
        self.assertEqual(a['caption'], f"5 bots mining under the town, y {a['y'][0]} to {a['y'][1]}")
        self.assertEqual(a['bot_minutes'], 150.0)
        self.assertEqual(b['bots'], ['Frost', 'Gale'])
        self.assertIn('2 bots exploring caves', b['caption'])
        self.assertIn('south-east of the town', b['caption'])
        self.assertEqual({a['layer'], b['layer']}, {'under'})
        self.assertNotEqual(a['id'], b['id'])

    def test_surface_bots_are_not_underground(self):
        pos = {}
        walk(pos, 'Alpha', 0, 70, 0, 'mine', 60)
        self.assertEqual(U.find_scenes(pos), [], 'a bot at y 70 is not underground however long it mines')

    def test_miners_outrank_walkers(self):
        pos = {}
        for b in ('Alpha', 'Bravo'):
            walk(pos, b, 10, 20, 10, 'mine', 10)                # 20 bot-minutes of mining: 60 points
        for b in ('Comet', 'Delta', 'Echo', 'Frost', 'Gale'):
            walk(pos, b, 300, 20, 300, 'goto', 10)              # 50 bot-minutes of walking: 25 points
        sc = U.find_scenes(pos, n=2)
        self.assertEqual(sc[0]['bots'], ['Alpha', 'Bravo'])
        self.assertEqual((sc[0]['score'], sc[1]['score']), (60.0, 25.0))

    def test_scenes_do_not_overlap(self):
        pos = {}
        for i in range(8):                                      # one long gallery, 8 cells of 24 in a row
            walk(pos, f'B{i}', 12 + 24 * i, 20, 12, 'mine', 20 - i)
        sc = U.find_scenes(pos, n=3)
        self.assertGreaterEqual(len(sc), 2)
        for i, a in enumerate(sc):
            for b in sc[i + 1:]:
                self.assertTrue(a['box'][2] < b['box'][0] or b['box'][2] < a['box'][0] or
                                a['box'][3] < b['box'][1] or b['box'][3] < a['box'][1], (a['box'], b['box']))

    def test_bounds_and_window(self):
        pos = self.crowd()
        for s in U.find_scenes(pos, n=3, bounds=[0, 0, 100, 100]):
            self.assertTrue(0 <= s['box'][0] and s['box'][2] <= 100 and 0 <= s['box'][1] and s['box'][3] <= 100)
        self.assertEqual(len(U.find_scenes(pos, n=3, bounds=[0, 0, 100, 100])), 1, 'the far place is outside the dump')
        walk(pos, 'Nova', -200, 10, -200, 'mine', 20, t0=T0 - 7200)
        self.assertEqual(len(U.find_scenes(pos, n=5)), 3)
        self.assertEqual(len(U.find_scenes(pos, n=5, window_min=60)), 2, 'two hours ago is outside a one-hour window')

    def test_densest_band(self):
        self.assertEqual(U.densest_band([(0, 1), (10, 1), (11, 1), (12, 1), (40, 1)], 0.6), (10, 12))
        self.assertEqual(U.densest_band([(5, 2.0)], 0.7), (5, 5))
        self.assertIsNone(U.densest_band([]))

    def test_the_directors_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'scenes-slot.json')
            good = {'id': 'mine1', 'layer': 'under', 'box': [0, 0, 95, 95], 'y': [12, 30], 'caption': 'x', 'bots': ['Alpha']}
            put(p, {'scenes': [good, {'id': 'nobox', 'y': [1, 2]}, 'junk']})
            self.assertEqual(U.load_scenes(p), [good])
            put(p, [good])
            self.assertEqual(U.load_scenes(p), [good], 'a bare list reads the same')

    def test_caption_words(self):
        self.assertEqual(U.caption_for(5, {'mine': 9, 'goto': 3}, [-10, -10, 30, 30], [12, 30]),
                         '5 bots mining under the town, y 12 to 30')
        self.assertEqual(U.caption_for(1, {'gather': 2}, [0, -200, 40, -160], [8, 20]),
                         '1 bot gathering 180 blocks north of the town, y 8 to 20')
        self.assertIn('no bots', U.caption_for(0, {}, [0, 0, 9, 9], [1, 2]))


class Plane(unittest.TestCase):
    BOX = [0, 0, 95, 95]

    def test_the_axis_is_the_one_the_bots_spread_along(self):
        along_x = [(x, 20, 50.5, 1.0) for x in range(5, 90)]
        p = U.choose_plane(along_x, self.BOX)
        self.assertEqual(p['axis'], 'x')
        self.assertTrue(p['slab'][0] <= 50 <= p['slab'][1], p)
        self.assertEqual(p['slab'][1] - p['slab'][0] + 1, U.SLAB)
        self.assertEqual(p['share'], 1.0)
        along_z = [(20.5, 20, z, 1.0) for z in range(5, 90)]
        p = U.choose_plane(along_z, self.BOX)
        self.assertEqual(p['axis'], 'z')
        self.assertTrue(p['slab'][0] <= 20 <= p['slab'][1], p)

    def test_the_slab_is_the_busiest_one(self):
        two = [(x, 20, 40.5, 1.0) for x in range(5, 90)] + [(x, 20, 52.5, 3.0) for x in range(5, 90)]
        p = U.choose_plane(two, self.BOX)
        self.assertEqual(p['axis'], 'x')
        self.assertTrue(p['slab'][0] <= 52 <= p['slab'][1], 'the corridor with three times the weight')
        self.assertEqual(p['share'], 0.75)

    def test_no_samples_and_edges(self):
        p = U.choose_plane([], [0, 0, 95, 40])
        self.assertEqual((p['axis'], p['share']), ('x', 0.0))
        self.assertTrue(0 <= p['slab'][0] <= 20 <= p['slab'][1] <= 40)
        self.assertEqual(U.choose_plane([], [0, 0, 40, 95])['axis'], 'z')
        edge = U.choose_plane([(x, 20, 0.5, 1.0) for x in range(5, 90)], self.BOX)
        self.assertEqual(edge['slab'], [0, U.SLAB - 1], 'a slab never leaves the box')

    def test_plan_band(self):
        S = [(0, y, 0, 1.0) for y in (-20, -19, 5, 6, 7, 8, 9)]
        self.assertEqual(U.plan_band(S, [10, 30]), [10, 30], 'a short range is kept whole')
        b = U.plan_band(S, [-28, 24])
        self.assertEqual(b[1] - b[0] + 1, U.PLAN_BAND)
        self.assertTrue(b[0] <= 5 and b[1] >= 9, b)
        self.assertEqual(U.plan_band([], [-28, 24]), [1, 24], 'no positions: the top levels')
        deep = [(0, y, 0, 1.0) for y in range(-20, -13)] + [(0, 20, 0, 1.0)]
        self.assertEqual(U.plan_band(deep, [-28, 24]), [-20, 3], 'seven samples low down beat one near the top')


class Pictures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w, cls.f = U.synthetic_world()
        cls.pos = U.synthetic_positions(cls.f)
        cls.t = U.last_time(cls.pos)
        cls.scene = {'id': 'syn', 'box': list(cls.w.box), 'y': [cls.f['tunnel_y'] - 6, cls.f['tunnel_y'] + 6], 'auto': True}
        cls.fr = U.make_framing(cls.w, cls.pos, cls.scene, 'side', (1920, 1080), cls.t)
        cls.g = U.side_grid(cls.w, cls.fr)

    def at(self, g, fr, x, y):
        return g['cls'][(fr['y'][1] - y) * g['nu'] + (x - fr['u'][0])]

    def test_the_cut_follows_the_bots(self):
        fr, f = self.fr, self.f
        self.assertEqual((fr['axis'], fr['look']), ('x', 'north'))
        self.assertTrue(fr['slab'][0] <= f['tunnel_z'] <= fr['slab'][1], fr['slab'])
        self.assertGreaterEqual(fr['y'][1], f['ground_y'] + 8, 'the surface and some sky are in the picture')
        self.assertLessEqual(fr['y'][0], self.scene['y'][0] - 8)

    def test_a_tunnel_reads_as_open_space_and_rock_as_rock(self):
        g, fr, f = self.g, self.fr, self.f
        self.assertEqual(self.at(g, fr, 40, f['tunnel_y']), U.OPEN)
        self.assertEqual(self.at(g, fr, 40, f['tunnel_y'] + 1), U.OPEN)
        self.assertIn(U.KIND[self.at(g, fr, 40, f['tunnel_y'] + 8)], 're')
        self.assertEqual(self.at(g, fr, 36, f['tunnel_y'] + 1), U.TORCH)
        self.assertEqual(self.at(g, fr, f['shaft_x'], f['tunnel_y'] + 5), U.LADDER)
        self.assertEqual(self.at(g, fr, 50, f['cave_y'][0]), U.CID['chest'])
        self.assertEqual(self.at(g, fr, 45, f['cave_y'][1]), U.OPEN)
        self.assertEqual(self.at(g, fr, 20, self.w.yr[0] + 3), U.LAVA)
        self.assertEqual(self.at(g, fr, 12, f['tunnel_y'] - 1), U.CID['cobble'])
        i = (fr['y'][1] - (f['tunnel_y'] - 1)) * g['nu'] + 40 - fr['u'][0]
        self.assertTrue(g['floor'][i], 'the rock under a tunnel is a floor')
        self.assertGreater(g['light'][i], 0, 'and a torch four blocks away lights it')

    def test_sky_is_on_top_and_the_surface_under_it(self):
        g, fr, f = self.g, self.fr, self.f
        self.assertEqual(self.at(g, fr, 40, fr['y'][1]), U.SKY)
        self.assertEqual(self.at(g, fr, 40, f['ground_y'] + 1), U.SKY)
        self.assertEqual(self.at(g, fr, 40, f['ground_y']), U.CID['grass'])
        self.assertEqual(self.at(g, fr, 40, f['ground_y'] - 1), U.CID['dirt'])

    def test_nearest_wins_hides_a_tunnel_inside_the_slab(self):
        """Why the default is the open-space projection: with nearest-block-wins a one-wide tunnel in the middle of
        the slab is behind two blocks of rock."""
        fr = dict(self.fr, mode='near')
        g = U.side_grid(self.w, fr)
        self.assertNotEqual(self.at(g, fr, 40, self.f['tunnel_y']), U.OPEN)
        self.assertEqual(self.at(g, fr, 40, fr['y'][1]), U.SKY)

    def test_roof_off(self):
        f = self.f
        fr = U.make_framing(self.w, self.pos, self.scene, 'plan', (1920, 1080), self.t)
        self.assertEqual(fr['band'], self.scene['y'])
        g = U.plan_grid(self.w, fr)
        at = lambda x, z: (z - fr['z'][0]) * g['nx'] + (x - fr['x'][0])
        self.assertEqual(g['kind'][at(40, f['tunnel_z'])], 'f')
        self.assertEqual(g['kind'][at(40, f['tunnel_z'] + 6)], 'h', 'six blocks beside the tunnel is solid rock')
        self.assertEqual(g['kind'][at(f['branch_x'], f['tunnel_z'] + 10)], 'f', 'the side branch is on the map')
        self.assertEqual(g['cls'][at(36, f['tunnel_z'])], U.TORCH)
        self.assertEqual(g['cls'][at(f['shaft_x'], f['tunnel_z'])], U.LADDER)
        self.assertEqual(g['cls'][at(13, f['tunnel_z'])], U.CID['planks'], 'a floor is coloured by its block')
        open_cols = sum(1 for k in g['kind'] if k != 'h')
        self.assertTrue(80 <= open_cols <= 140, f'{open_cols} columns open: the tunnel, its branch and the shaft')

    def test_who_is_in_the_picture(self):
        now = U.bots_now(self.pos, self.fr, self.t)
        self.assertEqual(sorted(now), ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost'])
        self.assertEqual({b: v[4] for b, v in now.items()},
                         {'Alpha': True, 'Bravo': True, 'Comet': True, 'Echo': True, 'Delta': False, 'Frost': False},
                         'Delta and Frost walk nine blocks in front of and behind the cut')
        self.assertEqual(now['Alpha'][3], 'mine')

    def test_a_bot_gone_quiet_is_left_out(self):
        pos = dict(self.pos)
        pos['Alpha'] = [r for r in pos['Alpha'] if r[0] < self.t - 3600 + 60]      # its last sample is 59 min old
        self.assertNotIn('Alpha', U.bots_now(pos, self.fr, self.t))
        self.assertIn('Bravo', U.bots_now(pos, self.fr, self.t))

    def test_trail_breaks(self):
        a = (T0, 10.0, 20.0, 10.0, 'mine')
        self.assertTrue(U.connected(a, (T0 + 10, 14.0, 20.0, 10.0, 'mine')))
        self.assertFalse(U.connected(a, (T0 + 300, 14.0, 20.0, 10.0, 'mine')), 'five minutes with no sample')
        self.assertFalse(U.connected(a, (T0 + 10, 90.0, 20.0, 10.0, 'mine')), 'eighty blocks in ten seconds')

    def test_cells_dug_since_the_scan(self):
        f = self.f
        z = f['tunnel_z'] + 0.5
        pos = {'Alpha': [(T0, 40.5, float(f['tunnel_y']), z, 'mine')],                # in the tunnel: nothing new
               'Bravo': [(T0, 60.5, float(f['tunnel_y'] + 10), z, 'mine')],           # standing where the scan has rock
               'Comet': [(T0, 60.5, float(f['tunnel_y'] + 10), z - 30, 'mine')],      # in rock too, but far behind the cut
               'Delta': [(T0 + 600, 70.5, float(f['tunnel_y'] + 10), z, 'mine')]}     # later than the frame
        got = U.fresh_cells(self.w, pos, self.fr, T0 + 60)
        self.assertEqual(got, {(60, f['tunnel_y'] + 10, f['tunnel_z']), (60, f['tunnel_y'] + 11, f['tunnel_z'])})

    def test_a_frame_shows_the_bots(self):
        cv, sd = U.render(self.w, self.pos, self.scene, 'trails', self.t, framing=self.fr)
        x, y, z = self.pos['Alpha'][-1][1:4]
        px, py = U.to_px(self.fr, x, y + 0.9, z)
        self.assertEqual(cv.pixel(int(px), int(py)), U.COLORS['Alpha'], "Alpha's marker is in Alpha's colour")
        self.assertEqual(sd['label'], f"6 bots mining under the town, y {self.scene['y'][0]} to {self.scene['y'][1]}")
        self.assertEqual(sorted(sd['bots']), ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost'])
        self.assertEqual(sd['bots']['Alpha']['skill'], 'mine')
        self.assertGreater(sd['trail_segments'], 100)
        self.assertEqual(sd['framing'], self.fr)


class Framing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w, cls.f = U.synthetic_world()
        cls.pos = U.synthetic_positions(cls.f)
        cls.t = U.last_time(cls.pos)
        cls.scene = {'id': 'syn', 'box': list(cls.w.box), 'y': [cls.f['tunnel_y'] - 6, cls.f['tunnel_y'] + 6], 'auto': True}

    def test_world_to_pixel(self):
        fr = U.make_framing(self.w, self.pos, self.scene, 'side', (1920, 1080), self.t)
        k, (ox, oy) = fr['ppb'], fr['origin']
        self.assertEqual(U.to_px(fr, fr['u'][0], fr['y'][1] + 1, 0), (ox, oy), 'the top-left corner of the top-left block')
        self.assertEqual(U.to_px(fr, fr['u'][0] + 1, fr['y'][1], 0), (ox + k, oy + k), 'east is right, down is down')
        x0, y0, x1, y1 = U.pic_rect(fr)
        ax0, ay0, ax1, ay1 = U.layout(1920, 1080)['area']
        self.assertTrue(ax0 <= x0 and x1 <= ax1 and ay0 <= y0 and y1 <= ay1, 'the picture is inside its area')
        self.assertGreaterEqual(k, 8, 'a 96-block scene is at least 8 pixels a block at 1080p')
        pl = U.make_framing(self.w, self.pos, self.scene, 'plan', (1440, 1440), self.t)
        self.assertEqual(U.to_px(pl, pl['x'][0], 0, pl['z'][0]), tuple(pl['origin']), 'north-west corner: north is up')
        self.assertEqual(pl['size'], [1440, 1440])

    def test_two_slots_of_one_scene_share_one_framing(self):
        """The same scene five minutes apart: same framing, and every pixel of the block picture identical (only the
        title's clock moves). With the trails on, the framing still holds and the picture changes."""
        cv1, sd1 = U.render(self.w, self.pos, self.scene, 'side', self.t - 300)
        cv2, sd2 = U.render(self.w, self.pos, self.scene, 'side', self.t, framing=sd1['framing'])
        self.assertEqual(sd1['framing'], sd2['framing'])
        self.assertEqual(json.loads(json.dumps(sd1['framing'])), sd1['framing'], 'the framing is plain data')
        x0, y0, x1, y1 = U.pic_rect(sd1['framing'])
        W = cv1.W
        self.assertEqual(cv1.b[y0 * W * 3:y1 * W * 3], cv2.b[y0 * W * 3:y1 * W * 3])
        self.assertNotEqual(cv1.b[:y0 * W * 3], cv2.b[:y0 * W * 3], 'the clock in the title moved')
        a, sa = U.render(self.w, self.pos, self.scene, 'trails', self.t - 300, framing=sd1['framing'])
        b, sb = U.render(self.w, self.pos, self.scene, 'trails', self.t, framing=sd1['framing'])
        self.assertEqual(sa['framing'], sb['framing'])
        self.assertNotEqual(a.b[y0 * W * 3:y1 * W * 3], b.b[y0 * W * 3:y1 * W * 3], 'the bots moved')
        self.assertEqual(a.pixel(x0 + 3, y1 - 3), b.pixel(x0 + 3, y1 - 3), 'the rock did not')

    def test_the_kept_framing_is_for_one_scene_box(self):
        with tempfile.TemporaryDirectory() as root:
            fr = U.make_framing(self.w, self.pos, self.scene, 'side', (1920, 1080), self.t)
            U.keep_framing(root, 'syn_side', fr)
            self.assertEqual(U.kept_framing(root, 'syn_side', self.scene, (1920, 1080), 'side'), fr)
            moved = dict(self.scene, box=[8, 0, 95, 95])
            self.assertIsNone(U.kept_framing(root, 'syn_side', moved, (1920, 1080), 'side'), 'a moved box is a new framing')
            self.assertIsNone(U.kept_framing(root, 'syn_side', self.scene, (1440, 1440), 'side'))
            self.assertIsNone(U.kept_framing(root, 'other_side', self.scene, (1920, 1080), 'side'))

    def test_the_cli_writes_frames_where_tl_showcase_does(self):
        w = self.w
        with tempfile.TemporaryDirectory() as d:
            dump, posf, scf = (os.path.join(d, n) for n in ('dump.json', 'pos.json', 'scenes-slot.json'))
            put(dump, {'box': w.box, 'y': w.yr, 'bits': 8, 'palette': w.palette, 'cells': base64.b64encode(w.cells).decode()})
            iso = lambda t: dt.datetime.fromtimestamp(t, UTC).strftime('%Y-%m-%dT%H:%M:%S')
            put(posf, {'pos': {b: {iso(r[0]): [r[1], r[2], r[3], r[4]] for r in rows} for b, rows in self.pos.items()}})
            put(scf, {'scenes': [{'id': 'mine-1', 'layer': 'under', 'box': w.box, 'y': self.scene['y'],
                                  'caption': 'the director said so', 'bots': ['Alpha']}]})
            root = os.path.join(d, 'tl')
            s1 = U.stamp_of(dt.datetime.fromtimestamp(self.t - 900, UTC))
            s2 = U.stamp_of(dt.datetime.fromtimestamp(self.t, UTC))
            for s in (s1, s2):
                U._BG.clear()                               # each slot is a new process in production
                with contextlib.redirect_stdout(io.StringIO()):
                    U.main(['frame', '--dump', dump, '--pos', posf, '--scenes', scf, '--style', 'trails', '--at', s,
                            '--root', root, '--cache', os.path.join(d, 'cache')])
            day = os.path.join(root, 'frames', 'mine_1_trails', s1[:8])
            self.assertEqual(sorted(os.listdir(day)), sorted([s1 + '.json', s1 + '.png', s2 + '.json', s2 + '.png']))
            a, b = (get(os.path.join(day, s + '.json')) for s in (s1, s2))
            self.assertEqual((a['framing_kept'], b['framing_kept']), (False, True))
            self.assertEqual(a['framing'], b['framing'])
            self.assertEqual(a['label'], 'the director said so')
            self.assertEqual(a['camera'], 'mine_1_trails')
            self.assertEqual(b['background'], 'disk', 'the second slot (a new process in production) reads the cached rock')
            Wd, Hd, _ = U.png_decode(raw(os.path.join(day, s2 + '.png')))
            self.assertEqual((Wd, Hd), (1920, 1080))


class Png(unittest.TestCase):
    def test_round_trip(self):
        W, H = 37, 11
        rgb = bytearray((x * 7 + y * 13 + c * 29) % 256 for y in range(H) for x in range(W) for c in range(3))
        rgb[5 * W * 3:6 * W * 3] = rgb[4 * W * 3:5 * W * 3]           # one row repeats the row above
        data = U.png_encode(W, H, rgb)
        self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(data[12:16], b'IHDR')
        self.assertEqual(struct.unpack('>IIBBBBB', data[16:29]), (W, H, 8, 2, 0, 0, 0))
        self.assertEqual(data[-12:-4], b'\x00\x00\x00\x00IEND')
        w, h, back = U.png_decode(data)
        self.assertEqual((w, h), (W, H))
        self.assertEqual(back, bytes(rgb))
        self.assertEqual(back[(5 * W + 9) * 3:(5 * W + 10) * 3], bytes(rgb[(4 * W + 9) * 3:(4 * W + 10) * 3]))

    def test_a_damaged_file_is_refused(self):
        data = bytearray(U.png_encode(4, 4, bytes(48)))
        self.assertEqual(U.png_decode(bytes(data))[:2], (4, 4))
        data[-1] ^= 1                                     # one bit of the last chunk's checksum
        with self.assertRaises(AssertionError):
            U.png_decode(bytes(data))

    def test_a_frame_file_decodes_to_the_canvas(self):
        w, f = U.synthetic_world()
        pos = U.synthetic_positions(f)
        scene = {'id': 'syn', 'box': list(w.box), 'y': [f['tunnel_y'] - 6, f['tunnel_y'] + 6], 'auto': True}
        cv, sd = U.render(w, pos, scene, 'plan', U.last_time(pos), size=(1440, 1440))
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'f.png')
            U.write_frame(cv, sd, p, d)
            W, H, rgb = U.png_decode(raw(p))
            self.assertEqual((W, H), (1440, 1440))
            for (x, y) in ((0, 0), (700, 700), (1439, 1439), (200, 900)):
                self.assertEqual(tuple(rgb[(y * W + x) * 3:(y * W + x) * 3 + 3]), cv.pixel(x, y))
            side = get(p[:-4] + '.json')
            self.assertEqual(side['framing']['style'], 'plan')
            self.assertEqual(side['bytes'], os.path.getsize(p))

    def test_text(self):
        self.assertEqual(set(U.GLYPHS), {chr(c) for c in range(32, 127)}, 'every printable ASCII character')
        self.assertEqual(U.text_w('abc', 3), 3 * 18 - 3)
        cv = U.Canvas(40, 12, (0, 0, 0))
        cv.text(1, 1, 'T', (255, 255, 255), 1)
        self.assertEqual([cv.pixel(x, 1) for x in range(1, 6)], [(255, 255, 255)] * 5, 'the bar of a T')
        self.assertEqual([cv.pixel(x, 5) for x in range(1, 6)], [(0, 0, 0)] * 2 + [(255, 255, 255)] + [(0, 0, 0)] * 2)


def run_cli(args):
    """The CLI, quietly. -> (exit status or None, stderr text). A SystemExit is a refusal, not a crash."""
    out, err = io.StringIO(), io.StringIO()
    code = None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            U.main(args)
        except SystemExit as e:
            code = e.code
    return code, err.getvalue() + (str(code) if isinstance(code, str) else '')


def tree(root):
    return sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs)


class Blockers(unittest.TestCase):
    """The five blockers of the 11-16 review of 57b9365c, one test each (each with a mutant)."""
    @classmethod
    def setUpClass(cls):
        cls.w, cls.f = U.synthetic_world()
        cls.pos = U.synthetic_positions(cls.f)
        cls.t = U.last_time(cls.pos)
        cls.scene = {'id': 'syn', 'box': list(cls.w.box), 'y': [cls.f['tunnel_y'] - 6, cls.f['tunnel_y'] + 6], 'auto': True}

    def inputs(self, d, pos=None, scenes=None):
        w = self.w
        dump, posf, scf = (os.path.join(d, n) for n in ('dump.json', 'pos.json', 'scenes-slot.json'))
        put(dump, {'box': w.box, 'y': w.yr, 'bits': 8, 'palette': w.palette, 'cells': base64.b64encode(w.cells).decode()})
        iso = lambda t: dt.datetime.fromtimestamp(t, UTC).strftime('%Y-%m-%dT%H:%M:%S')
        pos = self.pos if pos is None else pos
        put(posf, {'pos': {b: {iso(r[0]): [r[1], r[2], r[3], r[4]] for r in rows} for b, rows in pos.items()}})
        if scenes is None:
            scenes = [{'id': 'mine1', 'layer': 'deep', 'box': w.box, 'y': self.scene['y']}]
        put(scf, {'scenes': scenes})
        return ['--dump', dump, '--pos', posf, '--scenes', scf]

    # 1 ------------------------------------------------------------------ the disk cache is bounded
    def test_the_disk_cache_is_pruned_by_count_bytes_and_age(self):
        now = 2_000_000_000
        with tempfile.TemporaryDirectory() as d:
            def entry(i, age_s, size=1000):
                p = os.path.join(d, f'under-{i:020x}.bg')
                with open(p, 'wb') as f:
                    f.write(bytes(size))
                os.utime(p, (now - age_s, now - age_s))
                return os.path.basename(p)
            names = [entry(i, 60 * i) for i in range(30)]                    # 0 to 29 minutes old
            with open(os.path.join(d, 'notes.txt'), 'w') as f:
                f.write('not ours')
            gone = U.prune_cache(d, max_files=24, max_bytes=10 ** 9, now=now)
            self.assertEqual(sorted(gone), sorted(names[24:]), 'the six least recently used go')
            gone = U.prune_cache(d, max_files=24, max_bytes=10_000, now=now)
            self.assertEqual(sorted(gone), sorted(names[10:24]), 'ten 1000-byte entries fit in 10 000 bytes')
            old = entry(99, 2 * 86400)
            dead = old + '.tmp4242'
            os.rename(os.path.join(d, old), os.path.join(d, dead))
            old = entry(98, 86400 + 60)
            self.assertEqual(sorted(U.prune_cache(d, now=now)), sorted([old, dead]), 'unused for a day; a dead writer')
            live = names[0] + '.tmp77'
            with open(os.path.join(d, live), 'wb') as f:
                f.write(b'being written')
            os.utime(os.path.join(d, live), (now - 5, now - 5))
            self.assertEqual(sorted(U.prune_cache(d, max_files=0, now=now, keep=(names[0],))), sorted(names[1:10]),
                             'the entry just written stays, and so does a file another process is writing')
            os.remove(os.path.join(d, live))
            self.assertEqual(sorted(os.listdir(d)), sorted([names[0], 'notes.txt']), 'and nothing that is not ours is touched')

    def test_rendering_keeps_the_disk_cache_bounded(self):
        old = U.CACHE_MAX_FILES
        U.CACHE_MAX_FILES = 3
        try:
            with tempfile.TemporaryDirectory() as d:
                fr = U.make_framing(self.w, self.pos, self.scene, 'side', (1920, 1080), self.t)
                for i in range(6):
                    U.render(self.w, self.pos, self.scene, 'side', self.t, framing=dict(fr, note=i), cache=d)
                self.assertEqual(len(os.listdir(d)), 3, 'six framings were drawn, three backgrounds stay on disk')
        finally:
            U.CACHE_MAX_FILES = old

    # 2 ------------------------------------------------------------------ the memory cache is bounded on a disk hit too
    def test_backgrounds_read_from_disk_do_not_pile_up_in_memory(self):
        with tempfile.TemporaryDirectory() as d:
            fr = U.make_framing(self.w, self.pos, self.scene, 'plan', (1920, 1080), self.t)
            frs = [dict(fr, note=i) for i in range(U.BG_MEM_MAX + 4)]
            for f in frs:
                U.background(self.w, f, d)
            U._BG.clear()
            for f in frs:
                self.assertEqual(U.background(self.w, f, d)[1]['cache'], 'disk')
            self.assertEqual(len(U._BG), U.BG_MEM_MAX, f'{len(frs)} backgrounds were read back from disk')
            self.assertEqual(U.background(self.w, frs[-1], d)[1]['cache'], 'memory', 'the newest is the one kept')
        U._BG.clear()

    # 3 ------------------------------------------------------------------ nobody there, nothing to draw
    def test_a_scene_with_no_bots_is_drawn_as_rock_and_says_so(self):
        for at in ('latest', 'busiest'):
            with tempfile.TemporaryDirectory() as d:
                out = os.path.join(d, 'out')
                try:
                    code, err = run_cli(['frame'] + self.inputs(d, pos={}) + ['--style', 'trails', '--at', at, '--out', out])
                except Exception as e:                              # a crash is the bug this test is for
                    self.fail(f'--at {at} with no positions crashed: {type(e).__name__}: {e}')
                self.assertIsNone(code, err)
                side = get(os.path.join(out, 'scene1-trails.json'))
                self.assertTrue(side['label'].startswith('no bots under the town right now'), side['label'])
                self.assertEqual(side['bots'], {})
                self.assertGreater(os.path.getsize(os.path.join(out, 'scene1-trails.png')), 10000)
        self.assertIsNone(U.busiest_slot({}, self.scene, 45))
        self.assertEqual(U._when('latest', {}, self.scene, 45, now=1794800123), 1794800100)

    def test_no_scene_is_a_refusal_before_anything_is_written(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, 'out')
            args = self.inputs(d, scenes=[])
            try:
                code, err = run_cli(['seq'] + args + ['--out', out])
            except Exception as e:
                self.fail(f'seq with no scene crashed: {type(e).__name__}: {e}')
            self.assertIn('the input has 0 scene(s)', str(code))
            try:
                code, err = run_cli(['frame'] + args + ['--out', out])
            except Exception as e:
                self.fail(f'frame with no scene crashed: {type(e).__name__}: {e}')
            self.assertIsNone(code)
            self.assertIn('no scenes', err)
            code, _ = run_cli(['seq'] + self.inputs(d) + ['--pick', '3', '--out', out])
            self.assertIn('the input has 1 scene(s)', str(code))
            self.assertFalse(os.path.exists(out), 'nothing was written')

    # 4 ------------------------------------------------------------------ seq --root
    def test_seq_writes_under_root_when_root_is_given(self):
        with tempfile.TemporaryDirectory() as d:
            root = os.path.join(d, 'tl')
            cwd = os.getcwd()
            os.makedirs(os.path.join(d, 'cwd'))
            os.chdir(os.path.join(d, 'cwd'))
            try:
                code, err = run_cli(['seq'] + self.inputs(d) + ['--root', root, '--frames', '3', '--step-min', '15'])
            finally:
                os.chdir(cwd)
            self.assertIsNone(code, err)
            self.assertEqual(os.listdir(os.path.join(d, 'cwd')), [], 'nothing in the default --out')
            got = tree(root)
            pngs = [p for p in got if p.endswith('.png')]
            self.assertEqual(len(pngs), 3, got)
            for p in pngs:
                self.assertRegex(p, r'^frames/mine1_trails/\d{8}/\d{8}T\d{4}Z\.png$')
            self.assertIn('under-framing/mine1_trails.json', got)
            sides = [get(os.path.join(root, p[:-4] + '.json')) for p in pngs]
            self.assertEqual(sides[0]['framing'], sides[2]['framing'])
            code, _ = run_cli(['seq'] + self.inputs(d) + ['--root', root, '--out', os.path.join(d, 'elsewhere')])
            self.assertEqual(code, 2, '--root and --out together are refused')

    # 5 ------------------------------------------------------------------ names cannot leave the output folder
    def test_a_path_must_stay_inside_its_folder(self):
        with tempfile.TemporaryDirectory() as d:
            base = os.path.join(d, 'base')
            os.makedirs(os.path.join(base, 'sub'))
            self.assertEqual(U.inside(base, os.path.join(base, 'sub', 'f.png')), os.path.join(base, 'sub', 'f.png'))
            self.assertEqual(U.inside(base, os.path.join(base, 'new', 'deeper', 'f.png')), os.path.join(base, 'new', 'deeper', 'f.png'))
            for bad in (os.path.join(base, '..', 'f.png'), os.path.join(base, 'sub', '..', '..', 'f.png'), '/etc/f.png',
                        os.path.join(d, 'base2', 'f.png'), base):
                with self.assertRaises(ValueError, msg=bad):
                    U.inside(base, bad)
            os.symlink(d, os.path.join(base, 'link'))
            with self.assertRaises(ValueError, msg='through a link that points out'):
                U.inside(base, os.path.join(base, 'link', 'f.png'))
            cv = U.Canvas(8, 8)
            with self.assertRaises(ValueError):
                U.write_frame(cv, {'render_s': {}}, os.path.join(base, '..', 'escaped.png'), base)
            self.assertFalse(os.path.exists(os.path.join(d, 'escaped.png')))

    def test_tag_style_and_scene_id_cannot_escape(self):
        with tempfile.TemporaryDirectory() as d:
            outer = os.path.join(d, 'outer')
            out = os.path.join(outer, 'inner', 'out')
            ins = os.path.join(d, 'in')
            os.makedirs(ins)
            args = self.inputs(ins, scenes=[{'id': '../../evil', 'layer': 'deep', 'box': self.w.box, 'y': self.scene['y']}])
            for flag, val in (('--tag', '../../x'), ('--tag', '/abs'), ('--tag', 'a/b'), ('--style', '../../x'),
                              ('--style', '/abs/side'), ('--size', '../1x1')):
                extra = [flag, val] + ([] if flag == '--style' else ['--style', 'side'])
                for cmd in (['frame'], ['seq', '--frames', '1']):
                    try:
                        code, err = run_cli(cmd + args + ['--out', out] + extra)
                    except Exception as e:                      # caught late (the containment check, the OS): a miss
                        self.fail(f'{cmd[0]} {flag} {val!r} was not refused up front: {type(e).__name__}: {e}')
                    self.assertTrue(str(code).startswith('tl_under: ' + flag), (cmd[0], flag, val, code))
            self.assertFalse(os.path.exists(outer), 'a refused name writes nothing, not even a folder')
            root = os.path.join(outer, 'inner', 'root')
            try:
                code, err = run_cli(['frame'] + args + ['--root', root, '--style', 'side', '--tag', 'ok-1'])
            except ValueError as e:
                self.fail(f'the scene id reached the path unsanitised: {e}')
            self.assertIsNone(code, err)
            self.assertEqual(os.listdir(outer), ['inner'])
            self.assertEqual(os.listdir(os.path.join(outer, 'inner')), ['root'])
            got = tree(root)
            self.assertEqual(len(got), 3, got)
            for p in got:
                self.assertTrue(p.startswith(('frames/______evil_side/', 'under-framing/______evil_side.json')), p)
            self.assertEqual(U.camera_name({'id': '/etc/passwd'}, 'side'), '_etc_passwd_side')
            self.assertLessEqual(len(U.camera_name({'id': 'x' * 500}, 'plantrails')), 80)


class Budget(unittest.TestCase):
    def test_a_frame_of_a_96_by_96_by_70_box_is_cheap(self):
        """The capture host is CPU-starved and this runs every 15 minutes: a frame must cost seconds, not minutes.
        Measured 11-16 on the Mac mini: under 0.1 s a frame. The bound is 50 times that."""
        t0 = time.time()
        r = U.bench(repeat=1)
        self.assertEqual(sorted(r), ['plan', 'side', 'trails'])
        for st, v in r.items():
            self.assertLess(v['cold_s'] + v['png_s'], 5.0, (st, v))
            self.assertLessEqual(v['warm_s'], v['cold_s'] + 0.5, (st, v))
            self.assertGreater(v['png_bytes'], 10000, 'a real picture, not an empty one')
        self.assertLess(time.time() - t0, 30.0)


if __name__ == '__main__':
    unittest.main()
