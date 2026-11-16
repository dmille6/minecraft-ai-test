"""camunder-01: the underground pictures (tl_under.py). The scene finder, the choice of the cut, the block colours, the
PNG writer, a framing that holds still between two slots, and the time a frame costs.
Run: python3 -m unittest infra/showcase/test_tl_under.py (from the repo root). Mutants: test_tl_under_mutants.py."""
import base64, contextlib, datetime as dt, io, json, os, struct, sys, tempfile, time, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tl_under as U     # noqa: E402
import tl_region as R    # noqa: E402

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
        self.assertEqual(sd['bots'], ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost'])
        self.assertEqual(sd['bot_pos']['Alpha']['skill'], 'mine')
        self.assertEqual(sd['scene'], 'syn')
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
                self.assertEqual((side['bots'], side['bot_pos']), ([], {}))
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


# ====================================================================== the production step (slot, boxes, thinning)
def moved_world(w, dx=0, dz=0, cells=None):
    """The synthetic world at another place (negative coordinates cross chunk and region borders)."""
    b = w.box
    return U.World([b[0] + dx, b[1] + dz, b[2] + dx, b[3] + dz], w.yr, w.palette, w.cells if cells is None else cells, 8, 'moved')


def iso_z(t):
    return dt.datetime.fromtimestamp(t, UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def slot_out(args):
    """`tl_under.py slot ...` -> (exit status, the summary object, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = U.main(['slot'] + args)
    lines = out.getvalue().strip().splitlines()
    return code, (json.loads(lines[-1]) if lines else None), err.getvalue()


class Region(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        w, cls.f = U.synthetic_world()
        cls.w = moved_world(w, -40, -70)                    # x -40..55, z -70..25: four region files
        cls.rd = os.path.join(cls.tmp.name, 'region')
        cls.files = R.write_regions(cls.rd, cls.w.box, cls.w.yr, cls.w.palette, cls.w.cells)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def classes(self, raw):
        return U.box_world(raw).block(*raw['box'], *raw['y'])

    def test_the_reader_is_the_original_and_the_fallbacks_are_tl2trails(self):
        """Structural: tl_region's three copied functions are scripts/host/townplan_blockdump.py's, text for text,
        and tl_under's fallback colours and limits are tl2trails' (the showcase VM has neither file)."""
        src = os.path.join(HERE, '..', '..', 'scripts', 'host', 'townplan_blockdump.py')
        if not os.path.exists(src):
            self.skipTest('scripts/host is not in this tree (a flat install)')
        import importlib.util, inspect
        spec = importlib.util.spec_from_file_location('townplan_blockdump', src)
        orig = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(orig)
        for fn in ('read_nbt', 'section_values', 'name_of'):
            self.assertEqual(inspect.getsource(getattr(R, fn)), inspect.getsource(getattr(orig, fn)), fn)
        sys.path.insert(0, os.path.join(HERE, 'tl2'))
        import tl2trails
        self.assertEqual(U.FB_COLORS, tl2trails.COLORS)
        self.assertEqual(U.FB_LIMITS, (tl2trails.GAP_S, tl2trails.MAX_V, tl2trails.MAX_JUMP, tl2trails.ONLINE.total_seconds()))
        for p in ((0, -5), (5, -5), (5, 0), (5, 5), (0, 5), (-5, 5), (-5, 0), (-5, -5), (1, -9)):
            self.assertEqual(U.fb_compass(*p), tl2trails.compass(*p), p)

    def test_section_bytes_is_section_values_for_every_bit_width(self):
        seed = 12345
        for n_pal in (2, 5, 16, 17, 32, 33, 64, 65, 128, 129, 200, 256):
            vals = bytearray()
            for _ in range(4096):
                seed = (seed * 1103515245 + 12345) & 0x7fffffff
                vals.append((seed >> 8) % n_pal)
            bs = {'palette': [{'Name': f'b{i}'} for i in range(n_pal)], 'data': R.pack_section(vals, n_pal)}
            want = R.section_values(bs)
            self.assertEqual(want[:4096], list(vals), f'the packer and the original reader agree at {n_pal} names')
            self.assertEqual(R.section_bytes(bs), bytes(vals), f'{n_pal} names')
        self.assertIsNone(R.section_bytes({'palette': [{'Name': 'air'}]}))
        big = {'palette': [{'Name': f'b{i}'} for i in range(300)], 'data': tuple(range(1, 587))}   # 9 bits: 7 per word
        self.assertEqual(R.section_bytes(big), R.section_values(big), 'past 256 names it is the original list')

    def test_a_box_reads_back_what_was_written(self):
        w = self.w
        self.assertEqual(len(self.files), 4)
        raw = R.read_box(self.rd, *w.box, *w.yr)
        self.assertEqual((raw['missing'], raw['chunks'], raw['bits']), ([], 49, 8))
        self.assertEqual(len(raw['cells']), len(w.cells))
        self.assertEqual(self.classes(raw), w.block(*w.box, *w.yr), 'every cell of the whole box')
        self.assertEqual(sorted(set(raw['palette']) - {'?'}), sorted(set(w.palette) - {'?'}))
        part = R.read_box(self.rd, -37, -19, 7, 3, 5, 31)     # across the x = 0 and z = 0 region borders, mid-chunk
        self.assertEqual(self.classes(part), w.block(-37, -19, 7, 3, 5, 31))
        self.assertLess(part['bytes_read'], sum(os.path.getsize(p) for p in self.files), 'it seeks: not the whole files')

    def test_states_and_what_is_not_there(self):
        with tempfile.TemporaryDirectory() as d:
            pal = ['?', 'air', 'stone', 'glow_lichen[waterlogged]', 'snow[layers=3]', 'oak_log']
            cells = bytes([2] * 256 + [3, 4, 5] + [1] * 253)          # a 16 x 16 x 2 box at y 64..65
            R.write_regions(d, [0, 0, 15, 15], [64, 65], pal, cells, sections=(4, 4))
            raw = R.read_box(d, 0, 0, 15, 15, 64, 65)
            names = [raw['palette'][v] for v in raw['cells']]
            self.assertEqual(names[256:259], ['glow_lichen[waterlogged]', 'snow[layers=3]', 'oak_log'])
            self.assertEqual(names[0], 'stone')
            out = R.read_box(d, 0, 0, 31, 15, 64, 65)                 # the chunk to the east was never written
            self.assertEqual(out['missing'], [[1, 0]])
            self.assertEqual(out['palette'][out['cells'][16]], '?')
            up = R.read_box(d, 0, 0, 15, 15, 64, 81)                  # section 5 is not in the chunk
            self.assertEqual(up['palette'][up['cells'][16 * 256]], '?', 'the planner must never take unknown for air')
            up = R.read_box(d, 0, 0, 15, 15, 64, 81, absent='air')
            self.assertEqual(up['palette'][up['cells'][16 * 256]], 'air', 'a picture reads a section that is not stored as air')
            self.assertEqual(R.read_box(os.path.join(d, 'nowhere'), 0, 0, 15, 15, 64, 65)['missing'], [[0, 0]])

    def test_a_torn_region_file_costs_chunks_not_the_call(self):
        with tempfile.TemporaryDirectory() as d:
            w = self.w
            files = R.write_regions(d, w.box, w.yr, w.palette, w.cells)
            p = [f for f in files if f.endswith('r.0.0.mca')][0]
            size = os.path.getsize(p)
            with open(p, 'r+b') as f:
                f.truncate(size // 2)                                 # as if the copy were still running
                f.seek(8192 + 100)
                f.write(b'\xff' * 400)                                # and a chunk's bytes were garbage
            try:
                raw = R.read_box(d, *w.box, *w.yr)
            except Exception as e:
                self.fail(f'a torn file raised {type(e).__name__}: {e}')
            self.assertGreater(len(raw['missing']), 0)
            self.assertLess(len(raw['missing']), 49, 'the other three files still read')
            self.assertTrue(all(cx >= 0 and cz >= 0 for cx, cz in raw['missing']), raw['missing'])

    def test_a_full_palette_folds_names_to_their_class(self):
        w = self.w
        plain = R.read_box(self.rd, -37, -19, 7, 3, 5, 31)
        tight = R.read_box(self.rd, -37, -19, 7, 3, 5, 31, fold=U.fold_name, max_real=3)
        self.assertGreater(tight['folded'], 0)
        self.assertTrue(any(n.startswith('#') for n in tight['palette']), tight['palette'])
        self.assertEqual(self.classes(tight), self.classes(plain), 'it draws the same')
        self.assertEqual(U.classify('#ore_gold'), 'ore_gold')
        self.assertEqual(U.classify('#nonsense'), 'other')


class Snapshot(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        w, self.f = U.synthetic_world()
        self.raw = {'box': list(w.box), 'y': list(w.yr), 'palette': list(w.palette), 'cells': w.cells, 'missing': [], 'folded': 0}

    def tearDown(self):
        self.tmp.cleanup()

    def changed(self, n, new_name=None):
        cells = bytearray(self.raw['cells'])
        pal = list(self.raw['palette'])
        v = pal.index('air')
        if new_name:
            pal.append(new_name)
            v = len(pal) - 1
        for i in range(n):
            cells[1000 + i * 37] = v
        return dict(self.raw, palette=pal, cells=bytes(cells))

    def test_a_box_round_trips_whole_and_as_a_delta(self):
        p1, n1, h1 = U.write_box_file(self.root, 'd1', '20261116T0400Z', self.raw, {'layer': 'deep'})
        self.assertEqual(os.path.relpath(p1, self.root), 'under-box/d1/20261116/20261116T0400Z.box.z')
        self.assertEqual((h1['kind'], h1['v'], h1['base'], h1['layer']), ('full', 1, None, 'deep'))
        back = U.read_box_file(p1)
        self.assertEqual((back['box'], back['y'], back['palette'], back['cells']),
                         (self.raw['box'], self.raw['y'], self.raw['palette'], self.raw['cells']))
        with open(p1, 'rb') as f:
            self.assertEqual(f.read(5), b'UBOX\x01')
        later = self.changed(40, new_name='torch')
        p2, n2, h2 = U.write_box_file(self.root, 'd1', '20261116T0415Z', later)
        self.assertEqual((h2['kind'], h2['base'], h2['changed']), ('delta', '20261116T0400Z', 40))
        self.assertLess(n2 * 20, n1, f'40 changed cells: {n2} bytes against {n1} for the whole box')
        b2 = U.read_box_file(p2)
        self.assertEqual([b2['palette'][v] for v in b2['cells'][900:3000]], [later['palette'][v] for v in later['cells'][900:3000]])
        self.assertEqual(U.box_world(b2).token, U.box_world(later).token, 'the same picture')
        n = len(later['palette'])
        mirror = dict(later, palette=later['palette'][::-1], cells=later['cells'].translate(bytes(n - 1 - i if i < n else 0 for i in range(256))))
        self.assertEqual(U.box_world(mirror).token, U.box_world(later).token, 'the order the names were met in is not the picture')
        self.assertNotEqual(U.box_world(self.raw).token, U.box_world(later).token)
        p3, n3, h3 = U.write_box_file(self.root, 'd1', '20261116T0430Z', self.changed(41))
        self.assertEqual((h3['kind'], h3['base']), ('delta', '20261116T0400Z'), 'a delta is written against the full box, not a delta')
        self.assertEqual(U.first_box_of_day(self.root, 'd1', '20261116T0430Z'), p1)
        self.assertIsNone(U.first_box_of_day(self.root, 'd1', '20261117T0000Z'))

    def test_when_a_box_is_written_whole_again(self):
        U.write_box_file(self.root, 'd1', '20261116T0400Z', self.raw)
        ny = self.raw['y'][1] - self.raw['y'][0]
        shorter = dict(self.raw, y=[self.raw['y'][0], self.raw['y'][1] - 1], cells=self.raw['cells'][:96 * 96 * ny])
        self.assertEqual(U.write_box_file(self.root, 'd1', '20261116T0415Z', shorter)[2]['kind'], 'full', 'another shape')
        self.assertEqual(U.write_box_file(self.root, 'd1', '20261116T0430Z', self.changed(5))[2]['base'], '20261116T0400Z',
                         'the newest full box OF THIS SHAPE')
        half = dict(self.raw, cells=bytes(len(self.raw['cells'])))
        self.assertEqual(U.write_box_file(self.root, 'd1', '20261116T0445Z', half)[2]['kind'], 'full', 'most cells differ')
        self.assertEqual(U.write_box_file(self.root, 'd1', '20261117T0000Z', self.changed(5))[2]['kind'], 'full', 'a new day')
        self.assertEqual(U.write_box_file(self.root, 'd2', '20261116T0500Z', self.changed(5))[2]['kind'], 'full', 'another scene')

    def test_a_damaged_or_foreign_snapshot_is_refused(self):
        p1, _, _ = U.write_box_file(self.root, 'd1', '20261116T0400Z', self.raw)
        p2, _, _ = U.write_box_file(self.root, 'd1', '20261116T0415Z', self.changed(9))
        data = raw(p1)
        for name, bad in (('version', data[:4] + b'\x02' + data[5:]), ('magic', b'XBOX' + data[4:]),
                          ('a flipped byte', data[:-40] + bytes([data[-40] ^ 0x55]) + data[-39:]), ('cut short', data[:200])):
            q = os.path.join(self.root, 'bad.box.z')
            with open(q, 'wb') as f:
                f.write(bad)
            with self.assertRaises(ValueError, msg=name):
                U.read_box_file(q)
        other = dict(self.raw, cells=bytes([self.raw['cells'][0] ^ 1]) + self.raw['cells'][1:])
        os.remove(p1)
        with self.assertRaises(ValueError, msg='a delta whose base is gone'):
            U.read_box_file(p2)
        U.write_box_file(self.root, 'd1', '20261116T0400Z', other)
        with self.assertRaises(ValueError, msg='a delta whose base was replaced by another box'):
            U.read_box_file(p2)
        for sid, stamp in (('../x', '20261116T0400Z'), ('d1', '../../x'), ('d1', '2026')):
            with self.assertRaises(ValueError):
                U.write_box_file(self.root, sid, stamp, self.raw)

    def test_what_was_dug_between_two_boxes(self):
        w, f = U.synthetic_world()
        cells = bytearray(w.cells)
        P = {n: i for i, n in enumerate(w.palette)}
        at = lambda x, y, z: ((y - w.yr[0]) * w.nz + z) * w.nx + x
        dug = [(60 + i, f['tunnel_y'] + 5, f['tunnel_z']) for i in range(6)]
        for c in dug:
            self.assertIn(U.KIND[w.class_at(*c)], 're')
            cells[at(*c)] = P['air']
        cells[at(40, f['tunnel_y'], f['tunnel_z'])] = P['cobblestone']          # open -> built: not dug
        cells[at(44, f['cave_y'][0] - 1, f['tunnel_z'])] = P['air']             # water -> open: not dug
        cells[at(13, f['tunnel_y'] - 1, f['tunnel_z'])] = P['air']              # planks taken up: built -> open counts
        self.assertIn(U.KIND[w.class_at(70, f['tunnel_y'] + 2, f['tunnel_z'])], 're')
        cells[at(70, f['tunnel_y'] + 2, f['tunnel_z'])] = P['torch']            # rock -> a torch: drawn as the torch it is
        cells[at(71, f['tunnel_y'] + 2, f['tunnel_z'])] = P['ladder']
        now = U.World(w.box, w.yr, w.palette, bytes(cells))
        self.assertEqual(sorted(U.dug_cells(w, now)), sorted(dug + [(13, f['tunnel_y'] - 1, f['tunnel_z'])]))
        self.assertEqual(U.dug_cells(w, w), [])
        part = U.World([62, 0, 95, 95], w.yr, w.palette, b''.join(
            now.cells[(yi * w.nz + z) * w.nx + 62:(yi * w.nz + z) * w.nx + 96] for yi in range(w.ny) for z in range(w.nz)))
        self.assertEqual(sorted(U.dug_cells(w, part)), sorted(c for c in dug if c[0] >= 62), 'only where the two boxes overlap')


class Framing2(unittest.TestCase):
    def test_a_tiny_scene_is_framed_wide(self):
        p = U.pad_scene({'id': 'e1', 'box': [50, 46, 52, 50], 'y': [-2, -1]})
        self.assertEqual((p['box'][2] - p['box'][0] + 1, p['box'][3] - p['box'][1] + 1), (48, 48))
        self.assertTrue(p['box'][0] <= 50 and p['box'][2] >= 52 and p['box'][1] <= 46 and p['box'][3] >= 50)
        self.assertEqual(U.pad_scene({'box': [0, 0, 99, 9], 'y': [1, 2]})['box'], [0, -19, 99, 28], 'a wide side is left alone')

    def test_a_framing_holds_until_the_scene_outgrows_it(self):
        fr = {'style': 'side', 'axis': 'x', 'slab': [46, 50], 'depth': [24, 71], 'u': [9, 82], 'y': [-10, 60], 'box': [22, 24, 69, 71]}
        sc = lambda box, y=(23, 27): {'box': list(box), 'y': list(y)}
        self.assertIsNone(U.framing_holds(fr, sc([30, 44, 60, 52])))
        self.assertIsNone(U.framing_holds(fr, sc([8, 40, 86, 56])), 'four blocks over the edge is not outgrown')
        self.assertIn('wider than the picture', str(U.framing_holds(fr, sc([30, 44, 87, 52]))))
        self.assertIn('wider than the picture', str(U.framing_holds(fr, sc([4, 44, 60, 52]))))
        self.assertIn('levels', str(U.framing_holds(fr, sc([30, 44, 60, 52], (-15, 27)))))
        self.assertIsNone(U.framing_holds(fr, sc([30, 60, 60, 66])), 'the cut is 10 blocks beside the scene: still its cut')
        self.assertIn('beside the scene', str(U.framing_holds(fr, sc([30, 67, 60, 90]))))
        self.assertIn('beside the scene', str(U.framing_holds(fr, sc([30, 0, 60, 29]))))
        held = U.held_framing(fr, sc([30, 20, 60, 52], (20, 30)))
        self.assertEqual((held['depth'], held['scene_y'], held['u'], held['slab']), ([20, 71], [20, 30], [9, 82], [46, 50]))
        far = U.held_framing(fr, sc([30, -300, 60, 400]))
        self.assertEqual(far['depth'], [46 - U.DEPTH_MAX, 50 + U.DEPTH_MAX], 'never more than 64 blocks from the cut')
        self.assertEqual(U.held_framing(held, sc([30, 44, 60, 52]))['depth'], [20, 71], 'and it does not shrink back')
        plan = {'style': 'plan', 'x': [0, 95], 'z': [10, 80], 'y': [13, 32], 'band': [19, 31]}
        self.assertIsNone(U.framing_holds(plan, sc([30, 44, 60, 52])))
        self.assertIn('wider than the map', str(U.framing_holds(plan, sc([30, 44, 60, 90]))))
        self.assertIn('band', str(U.framing_holds(plan, sc([30, 44, 60, 52], (23, 40)))))

    def test_the_box_to_read(self):
        scene = {'id': 'd1', 'box': [30, 44, 60, 52], 'y': [23, 27]}
        pos = {'Alpha': [(T0 + 10 * k, 30.5 + k * 0.5, 25.0, 48.5, 'mine') for k in range(60)]}
        r = U.slot_region(U.pad_scene(scene), None, (1920, 1080), pos, 'trails')
        x0, z0, x1, z1 = r['rect']
        p = U.pad_scene(scene)['box']
        self.assertEqual(p, [22, 25, 69, 72])
        self.assertEqual((z0, z1), (p[1] - 8, p[3] + 8), 'eight blocks to the sides of a cut along x')
        self.assertTrue(x0 <= p[0] - 30 and x1 >= p[2] + 30, 'and the margin that fills the picture along it')
        self.assertEqual((r['y0'], r['clipped'], r['top_min']), (8, False, None))
        fr = {'style': 'side', 'axis': 'x', 'slab': [46, 50], 'depth': [24, 71], 'u': [9, 82], 'y': [12, 60]}
        k = U.slot_region(scene, fr, (1920, 1080), pos, 'trails')
        self.assertEqual((k['rect'], k['y0'], k['top_min']), ([9, 24, 82, 71], 12, 60), 'a kept framing: exactly what it shows')
        drift = dict(scene, box=[7, 20, 60, 52], y=[20, 27])
        self.assertEqual(U.slot_region(drift, fr, (1920, 1080), pos, 'trails'), k, 'a scene that pokes out of its picture reads the same box')
        k = U.slot_region(drift, U.held_framing(fr, drift), (1920, 1080), pos, 'trails')
        self.assertEqual(k['rect'], [9, 20, 82, 71], 'the depth the framing lists bots over grows with the scene, and stays')
        pl = {'style': 'plan', 'x': [0, 95], 'z': [10, 80], 'y': [13, 32], 'band': [19, 31]}
        k = U.slot_region(scene, pl, (1920, 1080), pos, 'plan')
        self.assertEqual((k['rect'], k['y0'], k['top_min']), ([0, 10, 95, 80], 13, None))
        deep = U.slot_region(dict(scene, y=[-70 + 10, -40]), None, (1920, 1080), pos, 'trails')
        self.assertEqual(deep['y0'], -64, "never under the world's floor")

    def test_a_scene_box_has_sky_over_it_not_unknown(self):
        w, f = U.synthetic_world()
        with tempfile.TemporaryDirectory() as d:
            R.write_regions(d, w.box, w.yr, w.palette, w.cells, sections=(-1, 3))         # nothing stored above y 63
            raw = U.read_scene_box(d, {'rect': [16, 16, 47, 47], 'y0': 20, 'top_min': None})
            self.assertEqual(raw['y'], [20, f['ground_y'] + U.SKY_ROWS], 'the levels the file does not store are air')
            self.assertNotIn(U.UNKNOWN, U.box_world(raw).block(16, 16, 47, 47, *raw['y']))
            raw = U.read_scene_box(d, {'rect': [16, 16, 47, 47], 'y0': 20, 'top_min': 100})
            self.assertEqual(raw['y'], [20, 100])

    def test_a_box_too_large_is_cut_back_around_the_scene(self):
        rect, cut = U.cap_rect([0, 0, 99, 99], 100, max_cells=10 ** 7)
        self.assertEqual((rect, cut), ([0, 0, 99, 99], False))
        (x0, z0, x1, z1), cut = U.cap_rect([0, 0, 199, 99], 100, max_cells=1_000_000)
        self.assertTrue(cut and (x1 - x0 + 1) * (z1 - z0 + 1) * 100 <= 1_000_000)
        self.assertTrue(abs(x0 - (199 - x1)) <= 1 and z0 <= 1 and z1 >= 98, f'no scene named: around the middle ({x0} {z0} {x1} {z1})')
        rect, cut = U.cap_rect([-100, -20, 199, 79], 200, max_cells=4_000_000, keep=[40, 20, 60, 40])
        self.assertTrue(cut)
        self.assertLessEqual((rect[2] - rect[0] + 1) * (rect[3] - rect[1] + 1) * 200, 4_000_000)
        self.assertTrue(rect[0] <= 40 and rect[2] >= 60 and rect[1] <= 20 and rect[3] >= 40, 'the scene itself is all there')
        self.assertTrue(abs((40 - rect[0]) - (rect[2] - 60)) <= 1, f'the margin is cut evenly: {rect}')
        rect, cut = U.cap_rect([0, 0, 399, 399], 200, max_cells=1_000_000, keep=[0, 0, 399, 399])
        self.assertTrue(cut and (rect[2] - rect[0] + 1) * (rect[3] - rect[1] + 1) * 200 <= 1_000_000, 'then the scene, evenly')
        self.assertEqual((rect[0], rect[1]), (399 - rect[2], 399 - rect[3]))
        r = U.slot_region({'id': 'x', 'box': [0, 0, 400, 400], 'y': [0, 10]}, None, (1920, 1080), {}, 'trails')
        self.assertTrue(r['clipped'])
        x0, z0, x1, z1 = r['rect']
        self.assertLessEqual((x1 - x0 + 1) * (z1 - z0 + 1) * (U.Y_TOP - r['y0'] + 1), U.MAX_BOX_CELLS)
        big = {'style': 'side', 'axis': 'x', 'slab': [46, 50], 'depth': [-18, 114], 'u': [-200, 299], 'y': [-60, 90]}
        a = U.slot_region({'id': 'x', 'box': [0, 0, 40, 40], 'y': [0, 10]}, big, (1920, 1080), {}, 'trails')
        b = U.slot_region({'id': 'x', 'box': [200, 60, 280, 90], 'y': [0, 10]}, big, (1920, 1080), {}, 'trails')
        self.assertTrue(a['clipped'])
        self.assertEqual(a, b, 'a kept framing reads one box, wherever in it the scene is this slot')

    def test_the_top_of_a_box_is_the_sky_it_needs(self):
        w, f = U.synthetic_world()
        raw = {'box': list(w.box), 'y': list(w.yr), 'palette': list(w.palette), 'cells': w.cells + bytes([1]) * (96 * 96 * 40)}
        raw['y'] = [w.yr[0], w.yr[1] + 40]                              # forty more levels of air on top
        t = U.trim_top(raw)
        self.assertEqual(t['y'], [w.yr[0], f['ground_y'] + U.SKY_ROWS], 'twelve levels above the highest block')
        self.assertEqual(len(t['cells']), 96 * 96 * (t['y'][1] - t['y'][0] + 1))
        self.assertEqual(U.trim_top(raw, top_min=f['ground_y'] + 30)['y'][1], f['ground_y'] + 30, "never under a kept picture's top")
        c = U.crop_box(t, [10, 20, 40, 60])
        self.assertEqual((c['box'], c['y']), ([10, 20, 40, 60], t['y']))
        self.assertEqual(U.box_world(c).block(10, 20, 40, 60, *w.yr), w.block(10, 20, 40, 60, *w.yr))
        self.assertEqual(U.crop_box(t, [-5, 20, 40, 60]), t, 'a rectangle that is not inside the box crops nothing')
        c = U.crop_box(t, [10, 20, 40, 60], y0=5)
        self.assertEqual(c['y'], [5, t['y'][1]])
        self.assertEqual(U.box_world(c).block(10, 20, 40, 60, 5, w.yr[1]), w.block(10, 20, 40, 60, 5, w.yr[1]))


class Roster(unittest.TestCase):
    NOW = {'Alpha': (1.0, 20.0, 1.0, 'mine', True), 'Bravo': (2.0, 14.5, 9.0, 'goto', False), 'Echo': (3.0, 68.0, 1.0, 'home', True)}

    def test_the_caption_and_the_roster_count_the_same_bots(self):
        auto = {'id': 'a', 'box': [0, 0, 9, 9], 'y': [10, 30], 'auto': True, 'caption': 'the finder wrote this'}
        self.assertEqual(U.counted_bots(auto, self.NOW), ['Alpha', 'Bravo'], 'underground in the picture; Echo is at y 68')
        director = {'id': 'd', 'box': [0, 0, 9, 9], 'y': [10, 30], 'caption': '3 bots mining', 'bots': ['Bravo', 'Alpha', 'Gale']}
        self.assertEqual(U.counted_bots(director, self.NOW), ['Bravo', 'Alpha', 'Gale'], "the director's own list and order")
        self.assertEqual(U.counted_bots(dict(director, bots=[]), self.NOW), [], 'an empty list is a list')
        self.assertEqual(U.counted_bots({'id': 'n', 'box': [0, 0, 9, 9], 'y': [1, 2], 'bots': ['Echo']}, self.NOW), ['Alpha', 'Bravo'],
                         'no caption: the caption is made here, so the count is too')
        rows = U.roster_rows(self.NOW, ['Bravo', 'Alpha', 'Gale'])
        self.assertEqual(rows, [('Bravo', 'walking  y 14', 'near'), ('Alpha', 'mining  y 20', 'in'), ('Gale', 'not in the picture', 'away')])

    def test_a_drawn_frame_counts_once(self):
        w, f = U.synthetic_world()
        pos = U.synthetic_positions(f)
        pos['Gale'] = [(r[0], r[1], U.UNDER_Y + 0.5, r[3], 'goto') for r in pos['Alpha']]                # above the line
        scene = {'id': 'syn', 'box': list(w.box), 'y': [f['tunnel_y'] - 6, f['tunnel_y'] + 6], 'auto': True}
        cv, sd = U.render(w, pos, scene, 'trails', U.last_time(pos))
        self.assertEqual(sd['bots'], ['Alpha', 'Bravo', 'Comet', 'Delta', 'Echo', 'Frost'])
        self.assertTrue(sd['label'].startswith(f"{len(sd['bots'])} bots "), sd['label'])
        self.assertEqual(len(U.roster_rows({b: tuple(v.values()) for b, v in sd['bot_pos'].items()}, sd['bots'])), 6)
        self.assertEqual(sd['others'], ['Gale'], 'in view, drawn, named under the roster, not counted')
        self.assertEqual(sorted(sd['bot_pos']), sorted(sd['bots'] + sd['others']))

    def test_the_legend_fits_both_frame_sizes(self):
        w, f = U.synthetic_world()
        fr = {'style': 'side'}
        counts = {U.CID[n]: 1 for n in U.CLASSES}
        items = U._legend_items(fr, counts, True, 'dug since 08:15')
        self.assertEqual(len(items), 11, [lab for _, lab in items])
        for size in ((1920, 1080), (1440, 1440)):
            L = U.layout(*size)
            ax0, ay0, ax1, ay1 = L['panel']
            rect = [ax0, ay0 + (ay1 - ay0) * 58 // 100, ax1, ay1] if L['wide'] else [ax0 + (ax1 - ax0) * 67 // 100, ay0, ax1, ay1]
            rows = U.legend_rows(items, rect, L['u'])
            self.assertEqual(len(rows), len(items), f'{size}: every item has a row')
            for (x, y, ks, sw, lab, sc) in rows:
                self.assertTrue(rect[1] <= y and y + ks <= rect[3], (size, lab))
                self.assertLessEqual(x + len(sw) * (ks + L['u']) + L['u'] + U.text_w(lab, sc), rect[2], (size, lab))
                self.assertGreaterEqual(7 * sc, 14, 'no tiny text')
                self.assertGreaterEqual(len(sw), 1)
            self.assertEqual(len({y for _, y, *_ in rows}), len(rows))


class Slot(unittest.TestCase):
    """`tl_under.py slot`: the hand-off file in, frames + sidecars + box snapshots out, never a failure."""
    @classmethod
    def setUpClass(cls):
        cls.w, cls.f = U.synthetic_world()
        cls.pos = U.synthetic_positions(cls.f)
        cls.t = U.last_time(cls.pos)
        cls.stamp = U.stamp_of(dt.datetime.fromtimestamp(cls.t, UTC))
        cls.slot_t = U.parse_stamp(cls.stamp).timestamp()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, 'tl')
        self.rd = os.path.join(self.tmp.name, 'mirror', 'region')
        os.makedirs(os.path.join(self.root, 'logs'))
        R.write_regions(self.rd, self.w.box, self.w.yr, self.w.palette, self.w.cells)
        U._BG.clear()

    def tearDown(self):
        self.tmp.cleanup()
        U._BG.clear()

    def trail(self, bots, t):
        return {b: [[iso_z(r[0]), r[1], r[2], r[3], r[4]] for r in U.window(self.pos.get(b, []), t - 2700, t)][-300:] for b in bots}

    def scene_a(self, t=None, **kw):
        t = self.t if t is None else t
        bots = ['Alpha', 'Bravo', 'Comet', 'Echo']
        s = {'id': 'd20261116T0415a', 'layer': 'deep', 'kind': 'activity', 'box': [30, 44, 60, 52], 'y': [25, 26], 'g': 25,
             'score': 31.5, 'active': True, 'bots': bots, 'caption': '4 bots mining under the town, y 25-26', 'project': None,
             'skill': 'mine', 'opened': iso_z(t), 'camera': None, 'frames': 'frames/under-d20261116T0415a',
             'trail': self.trail(bots, t)}
        s.update(kw)
        return s

    def scene_b(self):
        return {'id': 'e20261116T0430b', 'layer': 'shallow', 'kind': 'death', 'box': [50, 46, 52, 50], 'y': [-2, -1], 'g': -2,
                'score': 0, 'active': True, 'bots': ['Delta'], 'caption': 'Delta died in a cave under the town', 'project': None,
                'skill': None, 'opened': iso_z(self.t), 'camera': None, 'frames': 'frames/under-e20261116T0430b'}

    def others(self):
        return [{'id': 's20261116T0415c', 'layer': 'surface', 'box': [0, 0, 20, 20], 'y': [50, 52], 'bots': ['Gale'],
                 'caption': 'x', 'camera': 'scene-s20261116T0415c', 'frames': 'frames/scene-s20261116T0415c'},
                {'id': 'n1', 'layer': 'nether', 'box': [0, 0, 20, 20], 'y': [5, 9], 'bots': [], 'caption': 'x', 'camera': None},
                {'id': '../../evil', 'layer': 'deep', 'box': [0, 0, 20, 20], 'y': [5, 9], 'bots': [], 'caption': 'x', 'camera': None},
                {'id': 'u9', 'layer': 'shallow', 'box': [0, 0, 20, 20], 'y': [5, 9], 'bots': [], 'caption': 'x', 'camera': 'scene-u9'},
                {'id': 'd8', 'layer': 'deep', 'box': [0, 0, 9000, 20], 'y': [5, 9], 'bots': [], 'caption': 'x', 'camera': None}]

    def hand_off(self, scenes, stamp=None, t=None):
        put(os.path.join(self.root, 'logs', 'scenes-slot.json'),
            {'v': 1, 't': iso_z((self.t if t is None else t) + 7), 'stamp': stamp or self.stamp, 'window_min': 45, 'scenes': scenes})

    def run_slot(self, *extra, stamp=None):
        return slot_out(['--root', self.root, '--region-dir', self.rd, '--stamp', stamp or self.stamp] + list(extra))

    def side(self, sid, stamp=None):
        stamp = stamp or self.stamp
        return get(os.path.join(self.root, 'frames', 'under-' + sid, stamp[:8], stamp + '.json'))

    def test_a_slot_draws_its_underground_scenes_and_only_those(self):
        self.hand_off([self.scene_a(), self.scene_b()] + self.others())
        code, out, err = self.run_slot()
        self.assertEqual(code, 0)
        self.assertEqual({k: out[k] for k in ('scenes', 'drawn', 'skipped', 'errors')},
                         {'scenes': 2, 'drawn': 2, 'skipped': 4, 'errors': 0}, (out, err))
        self.assertEqual(out['why'], {'surface': 1, 'unknown_layer': 1, 'invalid': 2, 'has_camera': 1})
        day, st = self.stamp[:8], self.stamp
        got = tree(self.root)
        want = []
        for sid in ('d20261116T0415a', 'e20261116T0430b'):
            want += [f'frames/under-{sid}/{day}/{st}.json', f'frames/under-{sid}/{day}/{st}.png',
                     f'under-box/{sid}/{day}/{st}.box.z', f'under-framing/under-{sid}.gray', f'under-framing/under-{sid}.json']
        self.assertEqual(got, sorted(want + ['logs/scenes-slot.json']), 'these files and no others')
        self.assertEqual(out['bytes_written'], sum(os.path.getsize(os.path.join(self.root, p)) for p in got
                                                   if p.startswith(('frames/', 'under-box/'))))
        self.assertEqual(sorted(os.listdir(self.tmp.name)), ['mirror', 'tl'], 'nothing beside the root and the mirror')
        a = self.side('d20261116T0415a')
        self.assertEqual({k: a[k] for k in ('label', 'project', 'changed', 'scene', 'caption', 'bots', 'layer', 'score', 'kind')},
                         {'label': '4 bots mining under the town, y 25-26', 'project': None, 'changed': None,
                          'scene': 'd20261116T0415a', 'caption': '4 bots mining under the town, y 25-26',
                          'bots': ['Alpha', 'Bravo', 'Comet', 'Echo'], 'layer': 'deep', 'score': 31.5, 'kind': 'activity'})
        self.assertEqual((a['stamp'], a['style'], a['camera'], a['framing_kept'], a['framing_change']),
                         (st, 'trails', 'under-d20261116T0415a', False, None))
        self.assertEqual(sorted(a['bot_pos']), ['Alpha', 'Bravo', 'Comet', 'Echo'])
        self.assertGreater(a['trail_segments'], 100)
        self.assertEqual(a['dug'], {'since': st, 'cells': 0, 'drawn': 0})
        self.assertEqual((a['framing']['axis'], a['framing']['style']), ('x', 'side'))
        self.assertTrue(a['framing']['slab'][0] <= self.f['tunnel_z'] <= a['framing']['slab'][1])
        W, H, rgb = U.png_decode(raw(os.path.join(self.root, 'frames', 'under-d20261116T0415a', day, st + '.png')))
        self.assertEqual((W, H), (1920, 1080))
        x, y, z = self.pos['Alpha'][-1][1:4]
        px, py = (int(v) for v in U.to_px(a['framing'], x, y + 0.9, z))
        self.assertEqual(tuple(rgb[(py * W + px) * 3:(py * W + px) * 3 + 3]), U.COLORS['Alpha'])
        box = U.read_box_file(os.path.join(self.root, a['block_box']['snapshot']))
        self.assertEqual((box['header']['kind'], box['header']['id'], box['header']['stamp']), ('full', 'd20261116T0415a', st))
        fr = a['framing']
        self.assertEqual(box['box'], [fr['u'][0], fr['depth'][0], fr['u'][1], fr['depth'][1]], 'the box is what the picture shows')
        self.assertEqual(box['y'][0], fr['y'][0], 'from its bottom level')
        self.assertEqual(U.box_world(box).block(*box['box'], box['y'][0], self.w.yr[1]),
                         self.w.block(*box['box'], box['y'][0], self.w.yr[1]), 'and it holds the blocks of the region files')
        self.assertEqual(box['y'][1], self.f['ground_y'] + U.SKY_ROWS, 'up to twelve levels of sky')

    def test_a_tiny_scene_with_no_trail_is_framed_wide_and_drawn_without_bots(self):
        self.hand_off([self.scene_b()])
        code, out, err = self.run_slot()
        self.assertEqual((code, out['drawn'], out['errors']), (0, 1, 0), err)
        b = self.side('e20261116T0430b')
        fr = b['framing']
        self.assertGreaterEqual(fr['u'][1] - fr['u'][0] + 1, 48, 'a three-block scene is at least 48 blocks wide')
        self.assertEqual(fr['depth'][1] - fr['depth'][0] + 1, 48, 'and 48 deep: the bots it lists, the cut it may choose')
        self.assertEqual(fr['box'], U.pad_scene(self.scene_b())['box'])
        self.assertLessEqual(fr['y'][0], -2 - 8, 'eight below its lowest level')
        self.assertGreaterEqual(fr['y'][1], self.f['ground_y'] + 8, 'and the surface with sky over it')
        self.assertEqual((b['bots'], b['bot_pos'], b['trail_segments'], b['label']), (['Delta'], {}, 0, 'Delta died in a cave under the town'))
        self.assertEqual(b['kind'], 'death')

    def test_the_second_slot_keeps_the_framing_and_shows_what_was_dug(self):
        f, w = self.f, self.w
        self.hand_off([self.scene_a(t=self.t - 900)], t=self.t - 900)
        s1 = U.stamp_of(dt.datetime.fromtimestamp(self.slot_t - 900, UTC))
        code, out, err = self.run_slot(stamp=s1)
        self.assertEqual((out['drawn'], out['errors']), (1, 0), err)
        cells = bytearray(w.cells)
        P = {n: i for i, n in enumerate(w.palette)}
        dug = [(40 + i, f['tunnel_y'] + 2, f['tunnel_z']) for i in range(7)] + [(40, f['tunnel_y'], f['tunnel_z'] + 20)]
        for (x, y, z) in dug:
            self.assertIn(U.KIND[w.class_at(x, y, z)], 're')
            cells[((y - w.yr[0]) * w.nz + z) * w.nx + x] = P['air']
        cells[((f['tunnel_y'] - w.yr[0]) * w.nz + f['tunnel_z']) * w.nx + 45] = P['cobblestone']      # built, not dug
        R.write_regions(self.rd, w.box, w.yr, w.palette, bytes(cells))
        U._BG.clear()
        self.hand_off([self.scene_a(box=[32, 45, 62, 53], y=[24, 27])])          # the cluster drifted two blocks
        code, out, err = self.run_slot()
        self.assertEqual((out['drawn'], out['errors']), (1, 0), err)
        a1, a2 = self.side('d20261116T0415a', s1), self.side('d20261116T0415a')
        f1, f2 = dict(a1['framing']), dict(a2['framing'])
        self.assertEqual((a2['framing_kept'], a2['framing_change']), (True, None))
        self.assertEqual(f2.pop('scene_y'), [24, 27], 'the marked levels follow the scene')
        f1.pop('scene_y')
        self.assertEqual(f1, f2, 'the same cut, the same scale, the same place on the picture')
        self.assertEqual(a2['dug'], {'since': s1, 'cells': 8, 'drawn': 7}, 'eight cells dug; seven of them in the cut')
        self.assertEqual((a2['block_box']['snapshot_kind'], a1['block_box']['snapshot_kind']), ('delta', 'full'))
        self.assertLess(a2['block_box']['snapshot_bytes'], 2500)
        self.assertEqual(a2['block_box']['rect'], a1['block_box']['rect'])
        self.assertIsInstance(a2['changed'], float)
        self.assertGreater(a2['changed'], 0.0)
        W, H, rgb = U.png_decode(raw(os.path.join(self.root, 'frames', 'under-d20261116T0415a', self.stamp[:8], self.stamp + '.png')))
        px, py = (int(v) for v in U.to_px(a2['framing'], 43.5, f['tunnel_y'] + 2.5, f['tunnel_z']))
        self.assertEqual(tuple(rgb[(py * W + px) * 3:(py * W + px) * 3 + 3]), U.FRESH_RGB, 'a dug cell is in the highlight colour')
        back = U.read_box_file(os.path.join(self.root, a2['block_box']['snapshot']))
        self.assertEqual(U.KIND[U.box_world(back).class_at(*dug[0])], 'a', 'the delta snapshot reads back the new blocks')

    def test_a_scene_that_outgrows_its_framing_is_framed_anew_and_says_so(self):
        self.hand_off([self.scene_a(t=self.t - 900)], t=self.t - 900)
        s1 = U.stamp_of(dt.datetime.fromtimestamp(self.slot_t - 900, UTC))
        self.run_slot(stamp=s1)
        a1 = self.side('d20261116T0415a', s1)
        self.assertLess(a1['framing']['u'][1], 91)
        self.hand_off([self.scene_a(box=[30, 44, 95, 52])])
        code, out, err = self.run_slot()
        self.assertEqual((out['drawn'], out['errors']), (1, 0), err)
        a2 = self.side('d20261116T0415a')
        self.assertFalse(a2['framing_kept'])
        self.assertIn('wider than the picture', a2['framing_change']['why'])
        self.assertEqual(a2['framing_change']['was']['u'], a1['framing']['u'])
        self.assertTrue(a2['framing']['u'][0] <= 30 and a2['framing']['u'][1] >= 95, a2['framing']['u'])
        self.assertEqual(a2['block_box']['snapshot_kind'], 'full', 'a new shape is a whole box')

    def test_the_budget_and_one_scene_that_fails(self):
        self.hand_off([self.scene_a(), self.scene_b()])
        code, out, err = self.run_slot('--budget-s', '0')
        self.assertEqual((code, out['drawn'], out['skipped'], out['errors'], out['why']), (0, 0, 2, 0, {'budget': 2}))
        self.assertEqual([p for p in tree(self.root) if p.startswith('frames/')], [])
        real = U.render

        def flaky(world, pos, scene, *a, **k):
            if scene['id'].startswith('d'):
                raise RuntimeError('boom')
            return real(world, pos, scene, *a, **k)
        U.render = flaky
        try:
            code, out, err = self.run_slot()
        finally:
            U.render = real
        self.assertEqual((code, out['scenes'], out['drawn'], out['skipped'], out['errors']), (0, 2, 1, 0, 1))
        self.assertIn("scene 'd20261116T0415a': RuntimeError: boom", err)
        self.assertEqual([p for p in tree(self.root) if p.startswith('frames/') and p.endswith('.png')],
                         [f'frames/under-e20261116T0430b/{self.stamp[:8]}/{self.stamp}.png'])
        self.assertEqual(sorted(out), sorted(['scenes', 'drawn', 'skipped', 'errors', 'seconds', 'bytes_written', 'why', 'stamp', 'rows']))

    def test_slot_never_fails_the_capture(self):
        for args in (['--root', self.root, '--region-dir', self.rd],                      # no hand-off file at all
                     ['--root', self.root, '--budget-s', 'soon'],                         # a bad argument
                     ['--no-such-flag'], ['--root', self.root, '--size', '../1x1', '--stamp', self.stamp]):
            try:
                code, out, err = slot_out(args)
            except BaseException as e:
                self.fail(f'slot {args} raised {type(e).__name__}: {e}')
            self.assertEqual(code, 0, args)
            self.assertEqual((out['drawn'], out['errors']), (0, 1), (args, out))
            self.assertIn('error', out)
        put(os.path.join(self.root, 'logs', 'scenes-slot.json'), ['not', 'an', 'object'])
        code, out, err = self.run_slot()
        self.assertEqual((code, out['drawn']), (0, 0))
        put(os.path.join(self.root, 'logs', 'scenes-slot.json'), {'scenes': [self.scene_a()], 'stamp': '../../x'})
        code, out, err = slot_out(['--root', self.root, '--region-dir', self.rd])
        self.assertEqual((code, out['drawn'], out['errors']), (0, 0, 1))
        self.assertIn('no usable stamp', out['error'])
        self.hand_off([self.scene_a()])
        code, out, err = self.run_slot('--region-dir', os.path.join(self.tmp.name, 'no-mirror'))
        self.assertEqual((code, out['drawn'], out['errors']), (0, 1, 0), 'no region file: every chunk missing, still a frame')
        self.assertGreater(self.side('d20261116T0415a')['block_box']['missing_chunks'], 0)

    def test_a_stale_hand_off_file_is_not_drawn(self):
        self.hand_off([self.scene_a(), self.scene_b()])
        a = U.slot_args(['--root', self.root, '--region-dir', self.rd])
        out = U.run_slot(a, now=self.slot_t + 31 * 60)
        self.assertEqual((out['drawn'], out['skipped'], out['why']), (0, 2, {'stale': 2}))
        out = U.run_slot(a, now=self.slot_t + 29 * 60)
        self.assertEqual((out['drawn'], out['skipped'], out['stamp']), (2, 0, self.stamp), 'the stamp is the one in the file')

    def test_what_a_hand_off_scene_may_say(self):
        ok = self.scene_b()
        self.assertIsNone(U.check_scene(ok))
        bare = {k: v for k, v in ok.items() if k != 'frames'}
        self.assertIsNone(U.check_scene(bare))
        for bad in ('../x', 'a b', 'x' * 61, 7, '', None):
            self.assertIn('id', str(U.check_scene(dict(bare, id=bad))), repr(bad))
        for k, v in (('box', [0, 0, 1]), ('box', [5, 0, 1, 9]),
                     ('box', [0, 0, 'a', 9]), ('box', [0, 0, 900, 9]), ('y', [9, 1]), ('y', [-200, 0]), ('y', [0, float('nan')]),
                     ('frames', 'frames/elsewhere'), ('frames', '../frames/under-e20261116T0430b')):
            self.assertIsNotNone(U.check_scene(dict(ok, **{k: v})), (k, v))
        self.assertIsNotNone(U.check_scene('a string'))
        pos, bad = U.trail_positions({'Alpha': [['2026-11-16T04:00:10Z', 1, 2, 3, 'mine'], ['2026-11-16T04:00:00Z', 1.5, 2, 3, None],
                                                ['yesterday', 1, 2, 3, 'mine'], ['2026-11-16T04:00:20Z', 'x', 2, 3], [1, 2]],
                                      'Bravo': [], 'Comet': 'what'})
        self.assertEqual((sorted(pos), bad, [r[0] for r in pos['Alpha']], pos['Alpha'][0][4]), (['Alpha'], 3, [1794801600.0, 1794801610.0], '?'))
        self.assertEqual(U.trail_positions(None), ({}, 0))
        self.assertEqual(U.parse_iso('2026-11-16T04:00:00.250+01:00'), 1794801600.0 - 3600)
        self.assertIsNone(U.parse_iso('2026-13-40T04:00:00Z'))

    def test_a_slot_can_be_drawn_again_from_its_box_in_another_style(self):
        self.hand_off([self.scene_a()])
        self.run_slot()
        out = os.path.join(self.tmp.name, 'again')
        code, err = run_cli(['redraw', '--root', self.root, '--id', 'd20261116T0415a', '--stamp', self.stamp, '--style', 'plan',
                             '--out', out])
        self.assertIsNone(code, err)
        side = get(os.path.join(out, f'redraw-d20261116T0415a-{self.stamp}-plan.json'))
        self.assertEqual((side['framing']['style'], side['caption']), ('plan', '4 bots mining under the town, y 25-26'))
        W, H, _ = U.png_decode(raw(os.path.join(out, f'redraw-d20261116T0415a-{self.stamp}-plan.png')))
        self.assertEqual((W, H), (1920, 1080))
        code, _ = run_cli(['redraw', '--root', self.root, '--id', '../x', '--stamp', self.stamp, '--out', out])
        self.assertIn('--id', str(code))

    def test_it_runs_from_a_flat_install(self):
        """The showcase VM: the tools lie flat in one folder, with tl_showcase.py and showcasestatus.py and WITHOUT tl2
        or scripts/. `slot` must start there (and say it found no hand-off file), exit status 0."""
        import shutil, subprocess
        flat = os.path.join(self.tmp.name, 'bin')
        os.makedirs(flat)
        for f in ('tl_under.py', 'tl_region.py', 'tl_showcase.py'):
            shutil.copy(os.path.join(HERE, f), flat)
        shutil.copy(os.path.join(HERE, '..', '..', 'scripts', 'lib', 'showcasestatus.py'), flat)
        self.hand_off([self.scene_a()])
        r = subprocess.run([sys.executable, os.path.join(flat, 'tl_under.py'), 'slot', '--root', self.root, '--region-dir', self.rd,
                            '--stamp', self.stamp], capture_output=True, text=True, cwd=flat, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual((out['drawn'], out['errors']), (1, 0), r.stderr[-400:])
        r = subprocess.run([sys.executable, os.path.join(flat, 'tl_under.py'), 'slot', '--root', os.path.join(self.tmp.name, 'none')],
                           capture_output=True, text=True, cwd=flat, timeout=120)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(json.loads(r.stdout.strip().splitlines()[-1])['errors'], 1)

    def test_two_scenes_fit_the_budget_many_times_over(self):
        """Measured 11-16 on the Mac mini, region files made from the real 23-million-cell dump: 0.26 s for two scenes
        (0.05 s of it reading 60 chunks). The bound is the whole default budget: 20 s."""
        self.hand_off([self.scene_a(), self.scene_b()])
        code, out, err = self.run_slot()
        self.assertEqual(out['drawn'], 2, err)
        self.assertLess(out['seconds'], 20.0)
        for r in out['rows']:
            self.assertLess(r['read_s'], 5.0, r)


class Thin(unittest.TestCase):
    def test_which_snapshots_go(self):
        E = [('s', '20261101', '20261101T0000Z', None), ('s', '20261101', '20261101T0015Z', '20261101T0000Z')]
        day = '20261117'
        E += [('s', day, f'{day}T{hm}Z', None if hm in ('0000', '0130') else ('20261117T0130Z' if hm > '0130' else '20261117T0000Z'))
              for hm in ('0000', '0015', '0030', '0045', '0100', '0115', '0130', '0145', '0200', '0215')]
        E += [('s', '20261119', '20261119T0000Z', None), ('s', '20261119', '20261119T0015Z', '20261119T0000Z')]
        E += [('t', day, f'{day}T0005Z', None), ('t', day, f'{day}T0020Z', f'{day}T0005Z')]
        gone = U.thin_plan(E, dt.date(2026, 11, 20))
        self.assertEqual([g[2][9:13] for g in gone if g[:2] == ('s', day)], ['0015', '0030', '0045', '0115', '0145', '0215'],
                         'the first of each hour stays, and 01:30, the box 02:00 is written against')
        self.assertEqual([g[2] for g in gone if g[1] == '20261101'], ['20261101T0000Z', '20261101T0015Z'], 'older than 14 days: all')
        self.assertEqual([g for g in gone if g[1] == '20261119'], [], 'the last two days are whole')
        self.assertEqual([g[2] for g in gone if g[0] == 't'], [f'{day}T0020Z'], 'each scene on its own')
        self.assertEqual(U.thin_plan(E, dt.date(2026, 11, 20), days=1, hourly_after=0)[:1], [('s', '20261101', '20261101T0000Z')])
        self.assertEqual(len(U.thin_plan(E, dt.date(2026, 11, 20), days=2, hourly_after=2)), 2 + 10 + 2)

    def test_thin_deletes_boxes_and_never_frames(self):
        w, f = U.synthetic_world()
        rawb = {'box': list(w.box), 'y': list(w.yr), 'palette': list(w.palette), 'cells': w.cells, 'missing': [], 'folded': 0}
        with tempfile.TemporaryDirectory() as root:
            for day in ('20261101', '20261117', '20261119'):
                for hm in ('0000', '0015', '0100'):
                    U.write_box_file(root, 'd1', f'{day}T{hm}Z', rawb)
            frames = os.path.join(root, 'frames', 'under-d1', '20261101')
            os.makedirs(frames)
            for n in ('20261101T0000Z.png', '20261101T0000Z.json', '20261101T0000Z.box.z'):
                put(os.path.join(frames, n), {})
            U.keep_framing(root, 'under-d1', {'style': 'side'})
            U.keep_framing(root, 'under-old', {'style': 'side'})
            os.utime(os.path.join(root, 'under-framing', 'under-old.json'), (1, 1))
            before = tree(root)
            code, _ = run_cli(['thin', '--root', root, '--today', '20261120', '--dry-run'])
            self.assertEqual((code, tree(root)), (None, before), 'a dry run deletes nothing')
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                U.main(['thin', '--root', root, '--today', '20261120'])
            res = json.loads(out.getvalue())
            self.assertEqual((res['snapshots'], res['deleted'], res['state_files_deleted']), (9, 4, 1))
            after = tree(root)
            self.assertEqual([p for p in after if p.startswith('under-box/')],
                             ['under-box/d1/20261117/20261117T0000Z.box.z', 'under-box/d1/20261117/20261117T0100Z.box.z',
                              'under-box/d1/20261119/20261119T0000Z.box.z', 'under-box/d1/20261119/20261119T0015Z.box.z',
                              'under-box/d1/20261119/20261119T0100Z.box.z'])
            self.assertFalse(os.path.exists(os.path.join(root, 'under-box', 'd1', '20261101')), 'an emptied day folder goes too')
            self.assertEqual([p for p in after if p.startswith('frames/')], [p for p in before if p.startswith('frames/')])
            self.assertEqual([p for p in after if p.startswith('under-framing/')], ['under-framing/under-d1.json'])
            for p in after:
                if p.startswith('under-box/'):
                    U.read_box_file(os.path.join(root, p))            # what is left still reads (a kept delta has its base)


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
