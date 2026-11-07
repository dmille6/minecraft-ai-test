#!/usr/bin/env python3
"""Tests for chunky_beauty.py (tlpolish-1106).    python3 infra/showcase/visuals/test_chunky_beauty.py"""
import importlib.util, math, os, shutil, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('chunky_beauty', os.path.join(HERE, 'chunky_beauty.py'))
CB = importlib.util.module_from_spec(spec)
spec.loader.exec_module(CB)


class Beauty(unittest.TestCase):
    def test_bm_eye_matches_the_bluemap_page(self):
        # read back from the BlueMap page 11-07: target (-8,70,10) d105 r0.7854 a1.2 -> (-77.198, 108.057, 79.198)
        e = CB.bm_eye((-8, 70, 10), 105, 0.7854, 1.2)
        for got, want in zip(e, (-77.198, 108.057, 79.198)):
            self.assertAlmostEqual(got, want, delta=0.05)
        e = CB.bm_eye((-14.5, 68, 27.5), 52, 0.7854, 0.85)      # the copper hall camera: (-42.12, 102.32, 55.12)
        for got, want in zip(e, (-42.122, 102.323, 55.122)):
            self.assertAlmostEqual(got, want, delta=0.05)

    def test_sun_is_front_light_25_deg_off_behind_unless_named(self):
        self.assertEqual(CB.sun_for({'rotation': 0.7854}), (110.0, 32.0),
                         'camera at -x,+z of its target: behind = 135 deg (the 11-07 proof render), 25 deg off = 110')
        self.assertEqual(CB.sun_for({'rotation': 0.0}), (65.0, 32.0), 'camera at +z: behind = 90 deg')
        self.assertEqual(CB.sun_for({'rotation': 0.7854, 'sun': (135, 18)}), (135.0, 18.0))
        self.assertEqual(CB.sun_for(CB.TOWN), (135.0, 18.0), 'the town hero keeps its proven low sun')
        # the direction Chunky lights from points back toward the camera side of the subject
        az = math.radians(CB.sun_for({'rotation': 0.7854})[0])
        sun = (math.cos(az), math.sin(az))
        eye = (-math.sin(0.7854), math.cos(0.7854))
        self.assertGreater(sun[0] * eye[0] + sun[1] * eye[1], math.cos(math.radians(30)))

    def test_project_view_from_views_json(self):
        self.assertIsNone(CB.project_view({}))
        self.assertIsNone(CB.project_view({'project4k': {'target': 'hall'}}), 'no framing recorded yet')
        st = {'project4k': {'target': 'hall', 'camera': {'x': -13.5, 'y': 69, 'z': 27.5, 'distance': 45,
                                                          'rotation': 0.7854, 'angle': 0.85, 'fov': 32, 'label': 'copper hall'}}}
        v = CB.project_view(st)
        self.assertEqual((v['target'], v['distance'], v['label'], v['radius']), ((-13.5, 69.0, 27.5), 45.0, 'copper hall', 144))
        self.assertEqual(sorted(CB.views_for(st)), ['project', 'town'])
        self.assertEqual(sorted(CB.views_for({})), ['town'])

    def test_scene_carries_the_look(self):
        s = CB.scene('town', CB.TOWN, '/w', 320, 1920, 1080)
        self.assertEqual((s['sppTarget'], s['postprocess'], s['fog']['mode'], s['sky']['simulatedSky']),
                         (320, 'TONEMAP3', 'UNIFORM', 'Nishita'))
        self.assertTrue(s['emittersEnabled'])
        self.assertFalse(s['stillWater'])
        self.assertAlmostEqual(math.degrees(s['sun']['altitude']), 18.0)
        self.assertEqual(len(s['chunkList']), 613)

    def test_score_and_best(self):
        grey = bytes([120, 120, 120]) * 100
        colour = b''.join(bytes([200, 80, 40]) if i % 2 else bytes([40, 120, 200]) for i in range(100))
        dark = b''.join(bytes([40, 10, 5]) if i % 2 else bytes([5, 20, 40]) for i in range(100))
        self.assertEqual(CB.colourfulness(grey), 0.0)
        self.assertGreater(CB.frame_score(colour), CB.frame_score(grey))
        self.assertLess(CB.frame_score(dark), CB.colourfulness(dark), 'a dark frame is cut')
        self.assertEqual(CB.frame_score(b''), 0.0)
        self.assertEqual(CB.pick_best({'town': 3.0, 'project': 5.0}), 'project')
        self.assertEqual(CB.pick_best({'b': 1.0, 'a': 1.0}), 'a')
        self.assertIsNone(CB.pick_best({}))

    def test_history_days_and_slideshow(self):
        d = tempfile.mkdtemp()
        try:
            for day, views in (('2026-11-07', ('town', 'project')), ('2026-11-08', ('town',)), ('2026-11-09', ())):
                os.makedirs(os.path.join(d, 'frames', day))
                for v in views:
                    open(os.path.join(d, 'frames', day, v + '.png'), 'w').close()
            self.assertEqual(CB.history_days(d, 'town'), ['2026-11-07', '2026-11-08'])
            self.assertEqual(CB.history_days(d, 'project'), ['2026-11-07'])
        finally:
            shutil.rmtree(d)
        cmd = CB.slideshow_cmd('/t/%05d.png', '/o.mp4', hold_s=2.0)
        self.assertEqual(cmd[cmd.index('-framerate') + 1], '0.5000')
        self.assertIn('interp_start=64', cmd[cmd.index('-vf') + 1])


if __name__ == '__main__':
    r = unittest.main(exit=False, verbosity=1).result
    sys.exit(0 if r.wasSuccessful() else 1)
