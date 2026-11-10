"""timelapse2-1110: the hourly pair, the event trigger's decisions, the verified-only thin, the reel's placement windows.
Run: python3 -m unittest infra/showcase/test_tl2.py (from the repo root)."""
import datetime as dt, json, os, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'tl2'))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'scripts', 'lib'))
import tl_showcase as TL     # noqa: E402
import tl_event as EV        # noqa: E402
import tl_video as TV        # noqa: E402
import tl2                   # noqa: E402

U = dt.timezone.utc


class SlotPair(unittest.TestCase):
    def test_topdown_only_on_the_hour(self):
        cfg = {'pair_hourly': ['topdown'], 'capture_min': 15}
        self.assertEqual(TL.slot_pair(cfg, dt.datetime(2026, 11, 10, 17, 0, 4, tzinfo=U)), ('topdown', 'angled'))
        for m in (15, 30, 45):
            self.assertEqual(TL.slot_pair(cfg, dt.datetime(2026, 11, 10, 17, m, 2, tzinfo=U)), ('angled',))
        self.assertEqual(TL.base_pair(cfg), ('angled',))

    def test_no_knob_keeps_the_pair(self):
        self.assertEqual(TL.slot_pair({}, dt.datetime(2026, 11, 10, 17, 30, tzinfo=U)), TL.VIEWS)
        self.assertEqual(TL.base_pair({}), TL.VIEWS)

    def test_plan_uses_the_slot_pair_and_never_schedules_topdown_or_event_cameras(self):
        cams = {'topdown': {}, 'angled': {}, 'projectev': {'event_only': True, 'interval_min': 15}, 'hall': {'interval_min': 15}}
        v, _, _ = TL.plan_views({'cameras': cams}, {}, dt.datetime(2026, 11, 10, 17, 30, tzinfo=U), {}, 690, pair=('angled',))
        self.assertEqual(v, ['angled', 'hall'])

    def test_mutant_minute_rule(self):
        src = open(os.path.join(HERE, 'tl_showcase.py')).read()
        old = "t.minute < int(cfg.get('capture_min') or 15)"
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE'
        ns = {}
        mut = src.replace(old, 'True')
        code = mut[mut.index('def slot_pair'):mut.index('def base_pair')]
        exec(code, {'VIEWS': TL.VIEWS}, ns)
        self.assertNotEqual(ns['slot_pair']({'pair_hourly': ['topdown']}, dt.datetime(2026, 11, 10, 17, 30, tzinfo=U)),
                            ('angled',), 'the mutant must change the answer (killed)')


class EventTrigger(unittest.TestCase):
    EC = dict(EV.DEFAULTS)
    NOW = dt.datetime(2026, 11, 10, 17, 5, 30, tzinfo=U)

    def test_gap_slow_and_fast(self):
        self.assertEqual(EV.gap_min(self.EC, [self.NOW] * 150, self.NOW), 5.0)
        self.assertEqual(EV.gap_min(self.EC, [self.NOW] * 151, self.NOW), 2.0)
        old = self.NOW - dt.timedelta(hours=2)
        self.assertEqual(EV.gap_min(self.EC, [old] * 400, self.NOW), 5.0, 'only the last hour counts')

    def test_due(self):
        P = {'cottage1': {'pending': 3, 'last': self.NOW - dt.timedelta(minutes=6), 'recent': []},
             'hall': {'pending': 9, 'last': self.NOW - dt.timedelta(minutes=3), 'recent': []},
             'fast': {'pending': 1, 'last': self.NOW - dt.timedelta(minutes=3), 'recent': [self.NOW] * 200},
             'idle': {'pending': 0, 'last': None, 'recent': []},
             'tidy': {'pending': 50, 'last': None, 'recent': []}}
        self.assertEqual(EV.due_projects(self.EC, P, self.NOW), ['cottage1', 'fast'])

    def test_secs_to_slot_and_guard(self):
        self.assertEqual(EV.secs_to_slot(dt.datetime(2026, 11, 10, 17, 11, 30, tzinfo=U)), 210)
        self.assertEqual(EV.secs_to_slot(dt.datetime(2026, 11, 10, 17, 0, 0, tzinfo=U)), 900)

    def test_parse_place(self):
        row = {'@timestamp': '2026-11-10T17:00:01.2Z', 'skill': {'name': '_build',
               'detail': 'project=cottage1 op=place seg=wall-B cell=-8,67,-37 block=spruce_log'}}
        self.assertEqual(EV.parse_place(json.dumps(row)), ('2026-11-10T17:00:01', 'cottage1', (-8, 67, -37)))
        row['skill']['detail'] = 'project=yard op=clear cell=-57,72,7 block=cobblestone'
        self.assertIsNone(EV.parse_place(json.dumps(row)))

    def test_camera_for(self):
        cfg = {'cameras': {'copperhall': {'project': ['hall']}, 'project4k': {'follow': True, 'heavy': True},
                           'projectev': {'follow': True, 'event_only': True, 'y': 69, 'fit': 2.2, 'min_distance': 40}}}
        self.assertEqual(EV.camera_for(cfg, self.EC, 'hall', {})[0], 'copperhall')
        v, cam = EV.camera_for(cfg, self.EC, 'cottage1', {'cottage1': {'box': [-9, -38, -3, -32], 'g': 66}})
        self.assertEqual((v, cam['x'], cam['z'], cam['distance']), ('projectev', -5.5, -34.5, 40))
        self.assertIsNone(EV.camera_for(cfg, self.EC, 'nobox', {}))


class VerifiedThin(unittest.TestCase):
    def test_marker_must_match_count(self):
        files = ['a.png', 'b.png', 'a.json', '.nas-verified']
        self.assertTrue(TV.nas_verified('/d', listdir=lambda d: files, read=lambda p: '2 2026-11-11T06:41Z'))
        self.assertFalse(TV.nas_verified('/d', listdir=lambda d: files, read=lambda p: '1 x'))
        def nofile(p):
            raise OSError
        self.assertFalse(TV.nas_verified('/d', listdir=lambda d: files, read=nofile))

    def test_thin_keeps_unverified_days(self):
        with tempfile.TemporaryDirectory() as root:
            for day, verified in (('20261001', True), ('20261002', False)):
                d = os.path.join(root, 'frames', 'angled', day)
                os.makedirs(d)
                for m in ('00', '15', '30'):
                    open(os.path.join(d, f'{day}T10{m}Z.png'), 'w').write('x')
                if verified:
                    open(os.path.join(d, '.nas-verified'), 'w').write('3 t')
            old = TV.ROOT
            TV.ROOT = root
            try:
                TV.thin(apply=True, today=dt.date(2026, 11, 10), below_gb=1e9, retain_days=7)
            finally:
                TV.ROOT = old
            self.assertEqual(sorted(os.listdir(os.path.join(root, 'frames', 'angled', '20261001'))), ['.nas-verified', '20261001T1000Z.png'])
            self.assertEqual(len(os.listdir(os.path.join(root, 'frames', 'angled', '20261002'))), 3, 'unverified day untouched')


class ReelWindows(unittest.TestCase):
    def test_placements_pick_the_window(self):
        day = dt.datetime(2026, 11, 9, tzinfo=U)
        rows = [(day + dt.timedelta(hours=10, minutes=k), 'A', 'hall', 'place') for k in range(30)] + \
               [(day + dt.timedelta(hours=20), 'A', 'tidy', 'place')] * 50
        cams = {'copperhall': {'project': ['hall']}, 'project4k': {'follow': True, 'exclude': ['tidy']},
                'grounds': {'project': ['tidy']}}
        w = tl2.reel_windows(cams, rows, day)
        self.assertEqual(set(w), {'copperhall', 'project4k'}, 'grounds is not a reel camera')
        self.assertEqual(w['copperhall'][0], 30)
        self.assertTrue(w['copperhall'][1] <= day + dt.timedelta(hours=10) < w['copperhall'][2])


if __name__ == '__main__':
    unittest.main()
