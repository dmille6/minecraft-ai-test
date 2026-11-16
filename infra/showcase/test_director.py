#!/usr/bin/env python3
"""camdirector-01 (owner 11-16: "most of the videos show areas that aren't useful, and projects that are finished"):
behaviour tests for the three parts -- the waste that stops (tl_video / tl_event / tl_showcase follow cameras), the
activity director (tl_director + its wiring in tl_showcase), and the videos that follow the scenes (tl_video).

    cd infra/showcase && python3 -m unittest test_director.py        # seconds; no network, no hosts, no ffmpeg

EVERY RULE IS A `check_*` FUNCTION that takes the modules under test (M). The test classes run each check on the real
modules; `Mutants` re-runs THE SAME check on a mutated copy of one file and must see it fail BY ASSERTION (an error
for any other reason is not a kill). Every mutant asserts its anchor is present exactly once before it is applied
(CLAUDE.md: a mutant that silently fails to apply reads as killed). Its last line prints "N of N mutants killed".
"""
import datetime as dt
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'scripts', 'lib'))
U = dt.timezone.utc
_N = [0]


def load(fn, text=None):
    """Import infra/showcase/<fn> (or `text`, a mutated copy of it) as a module of its own."""
    _N[0] += 1
    name = f"{fn[:-3]}_ut{_N[0]}"
    if text is None:
        path = os.path.join(HERE, fn)
    else:
        d = tempfile.mkdtemp(prefix='camdir-mut-')
        path = os.path.join(d, name + '.py')
        with open(path, 'w') as f:
            f.write(text)
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    if text is not None:
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)
    return m


FILES = {'TL': 'tl_showcase.py', 'EV': 'tl_event.py', 'TV': 'tl_video.py', 'D': 'tl_director.py'}
REAL = {k: load(fn) for k, fn in FILES.items()}
with open(os.path.join(HERE, 'files', 'tl.conf')) as _f:
    CONF = json.load(_f)                                              # the tracked template of the live tl.conf
NOW = dt.datetime(2026, 11, 16, 12, 45, tzinfo=U)


def ago(**kw):
    return NOW - dt.timedelta(**kw)


def jload(path):
    with open(path) as f:
        return json.load(f)


class quiet:
    """The jobs under test print their rows; a test's verdict is its assertions."""
    def __enter__(self):
        self.out, self.null = sys.stdout, open(os.devnull, 'w')
        sys.stdout = self.null

    def __exit__(self, *a):
        sys.stdout = self.out
        self.null.close()
        return False


class swap:
    """Set attributes on a module for the length of a block, then put them back."""
    def __init__(self, mod, **kw):
        self.mod, self.kw = mod, kw

    def __enter__(self):
        self.old = {k: getattr(self.mod, k) for k in self.kw if hasattr(self.mod, k)}
        for k, v in self.kw.items():
            setattr(self.mod, k, v)
        return self

    def __exit__(self, *a):
        for k in self.kw:
            if k in self.old:
                setattr(self.mod, k, self.old[k])
            else:
                delattr(self.mod, k)
        return False


# =================================================================================== PART 1: stop the waste
def check_off_camera_gets_no_rebuild(t, M):
    TV = M['TV']
    off = TV.off_views(CONF)
    t.assertTrue({'workshop', 'house1', 'ziggurat', 'paths', 'wall', 'treefarm', 'storehouse', 'copperhall'} <= off,
                 'the eight finished projects\' cameras are off in the template')
    t.assertFalse(off & {'town', 'angled', 'topdown', 'hero4k', 'expeditions'}, 'positive control: live cameras are not')
    t.assertEqual(TV.off_views({}), set())
    t.assertEqual(TV.off_views({'cameras': {'a': None, 'b': {'off': True}}}), {'b'})
    side = {'newest_frame': '20261114T0900Z', 'last': '20261114T0900Z', 'candidates': 3}
    for kind in ('history', 'weekly', 'monthly'):
        skip, why, back = TV.rebuild_skip(kind, 'workshop', off, '20261116T0900Z', ['a'], side, True)
        t.assertTrue(skip, f'{kind}: an off camera is never rebuilt, new frames or not')
        t.assertIn('off', why)
        t.assertIsNone(back)
        t.assertFalse(TV.rebuild_skip(kind, 'town', off, '20261116T0900Z', ['a'], side, True)[0],
                      f'{kind}: a live camera with a newer frame is rebuilt')


def check_daily_is_never_skipped(t, M):
    TV = M['TV']
    same = {'newest_frame': '20261116T0900Z'}
    t.assertEqual(TV.rebuild_skip('daily', 'workshop', {'workshop'}, '20261116T0900Z', ['x'], same, True),
                  (False, None, None), 'daily behaviour is unchanged: not for an off camera, not for an unchanged one')
    t.assertTrue(TV.rebuild_skip('history', 'workshop', {'workshop'}, '20261116T0900Z', ['x'], same, True)[0],
                 'positive control: the same call as history is skipped')


def check_no_new_frames_no_reencode(t, M):
    TV = M['TV']
    new = '20261116T0900Z'
    t.assertTrue(TV.rebuild_skip('history', 'town', set(), new, ['a', new], {'newest_frame': new}, True)[0],
                 'the sidecar records the same newest frame: nothing to encode')
    t.assertFalse(TV.rebuild_skip('history', 'town', set(), new, ['a', new], {'newest_frame': '20261116T0845Z'}, True)[0],
                  'a newer frame on disk: rebuilt')
    t.assertFalse(TV.rebuild_skip('history', 'town', set(), new, ['a', new], {'newest_frame': new}, False)[0],
                  'the sidecar matches but the video file is gone: rebuilt')
    t.assertFalse(TV.rebuild_skip('history', 'town', set(), new, ['a', new], None, True)[0], 'no sidecar: rebuilt')
    # a sidecar from before the field existed: same last sampled frame and count -> skipped, and the field is recorded
    old = {'last': new, 'candidates': 2}
    t.assertEqual(TV.rebuild_skip('history', 'town', set(), new, ['a', new], old, True)[::2], (True, new))
    t.assertFalse(TV.rebuild_skip('history', 'town', set(), new, ['a', 'b', new], old, True)[0], 'one more sampled frame')
    t.assertFalse(TV.rebuild_skip('history', 'town', set(), new, ['a', 'c'], old, True)[0], 'another last frame')
    # the newest REGULAR frame of the window: event frames and frames outside the window do not count
    st = ['20261115T2300Z', '20261116T0900Z', '20261116T0915Z-event-hall', '20261117T0000Z']
    lo, hi = dt.datetime(2026, 11, 16, tzinfo=U), dt.datetime(2026, 11, 17, tzinfo=U)
    t.assertEqual(TV.newest_stamp(st, lo, hi), '20261116T0900Z')
    t.assertEqual(TV.newest_stamp(st), '20261117T0000Z')
    t.assertIsNone(TV.newest_stamp(['20261116T0915Z-event-hall']))


def _video_root(frames):
    """A temp timelapse root: {view: [stamps]} as empty .png files, a tl.conf with `workshop` off, video/ and logs/."""
    root = tempfile.mkdtemp(prefix='camdir-root-')
    for v, stamps in frames.items():
        for s in stamps:
            os.makedirs(os.path.join(root, 'frames', v, s[:8]), exist_ok=True)
            open(os.path.join(root, 'frames', v, s[:8], s + '.png'), 'wb').close()
    for d in ('video/daily', 'logs'):
        os.makedirs(os.path.join(root, d))
    conf = os.path.join(root, 'tl.conf')
    json.dump({'cameras': {'workshop': {'off': True}, 'town': {}, 'iso': {}, 'patina': {}}}, open(conf, 'w'))
    return root, conf


def _run_video(TV, root, conf, argv):
    calls = []

    def fake_build(v, st, out, name, **kw):
        calls.append((v, list(st), kw.get('extra')))
        return {'view': v, 'included': len(st)}
    old_argv = sys.argv
    sys.argv = ['tl_video.py'] + argv
    try:
        with swap(TV, ROOT=root, TL_CONF=conf, build=fake_build), quiet():
            TV.main()
    finally:
        sys.argv = old_argv
    return calls


def check_the_history_job_skips_them(t, M):
    """The real main(): of four cameras with frames, `history` encodes only the one with a new frame."""
    TV = M['TV']
    a, b = '20261114T0900Z', '20261116T0900Z'
    root, conf = _video_root({'workshop': [a, b], 'town': [a, b], 'iso': [a, b], 'patina': [a, b]})
    try:
        vid = lambda v: os.path.join(root, 'video', f'history-{v}.mp4')
        for v, side in (('town', {'newest_frame': b}), ('iso', {'newest_frame': a}),
                        ('patina', {'last': b, 'candidates': 2}), ('workshop', {'newest_frame': a})):
            open(vid(v), 'wb').close()
            json.dump(side, open(vid(v) + '.json', 'w'))
        calls = _run_video(TV, root, conf, ['history'])
        t.assertEqual([c[0] for c in calls], ['iso'],
                      'workshop is off, town and patina have no new frame: one encode, not four')
        t.assertEqual(calls[0][1:], ([a, b], {'newest_frame': b}), 'the build records the newest frame for the next night')
        t.assertEqual(jload(vid('patina') + '.json'), {'last': b, 'candidates': 2, 'newest_frame': b},
                      'an older sidecar gains the field without an encode')
        t.assertEqual(jload(vid('workshop') + '.json'), {'newest_frame': a}, 'the off camera\'s files are left alone')
        daily = _run_video(TV, root, conf, ['daily', '--day', '2026-11-16'])
        t.assertEqual(sorted(c[0] for c in daily), ['iso', 'patina', 'town', 'workshop'],
                      'daily is unchanged: every camera with frames is offered its day (an off one has none in practice)')
        t.assertTrue(all(c[2] is None for c in daily), 'and daily passes no extra field')
    finally:
        shutil.rmtree(root)


def check_event_frames_never_go_to_an_off_camera(t, M):
    EV = M['EV']
    ec = dict(EV.DEFAULTS)
    evcam = {'follow': True, 'event_only': True, 'y': 69, 'fit': 2.2, 'min_distance': 40}
    cams = {'copperhall': {'project': ['hall']}, 'projectev': evcam}
    site = {'hall': {'box': [-21, 21, -7, 33], 'g': 66}}
    t.assertEqual(EV.camera_for({'cameras': cams}, ec, 'hall', site)[0], 'copperhall', 'positive control: a live fixed camera')
    cams['copperhall'] = {'project': ['hall'], 'off': True}
    t.assertEqual(EV.camera_for({'cameras': cams}, ec, 'hall', site)[0], 'projectev',
                  'its fixed camera is off: the event camera frames the box instead')
    t.assertIsNone(EV.camera_for({'cameras': cams}, ec, 'hall', {}), 'off camera and no box: no frame')
    cams['projectev'] = dict(evcam, off=True)
    t.assertIsNone(EV.camera_for({'cameras': cams}, ec, 'hall', site), 'the event camera switched off is off too')
    # the template: every finished project's own camera is off, so none of them is ever returned
    for v, cam in CONF['cameras'].items():
        for p in (cam.get('project') or []) if cam.get('off') else []:
            got = EV.camera_for(CONF, ec, p, {})
            t.assertTrue(got is None or not CONF['cameras'][got[0]].get('off'), f'{p} -> {got and got[0]}')


def check_follow_target_has_an_age_limit(t, M):
    TL = M['TL']
    sites = {'hall': {'box': [0, 0, 10, 10]}, 'yard': {'box': [20, 20, 30, 30]}}
    cam = {}
    t.assertEqual(TL.follow_target(cam, sites, {'hall': ago(hours=5)}, None, NOW, 3), 'hall', 'placed 5 h ago: inside 6 h')
    t.assertIsNone(TL.follow_target(cam, sites, {'hall': ago(hours=7)}, None, NOW, 3),
                   'placed 7 h ago: no target, although it is the last project that placed')
    t.assertIsNone(TL.follow_target(cam, sites, {'hall': ago(hours=7)}, 'hall', NOW, 3), 'not even as the previous target')
    t.assertEqual(TL.follow_target(cam, sites, {'hall': ago(hours=7)}, None, NOW, 3, max_age_h=12), 'hall', 'configurable')
    t.assertEqual(TL.follow_target(cam, sites, {'hall': ago(days=9)}, None, NOW, 3, max_age_h=0), 'hall', '0: no limit')
    t.assertEqual(TL.follow_target(cam, sites, {'hall': ago(hours=7), 'yard': ago(hours=2)}, 'hall', NOW, 3), 'yard')
    # through resolve_cameras: tl.conf follow_max_age_h, the camera's own max_age_h, and "no frame that slot"
    cfg = {'cameras': {'project4k': {'follow': True, 'heavy': True}}, 'active_hours': 3}
    prog = {'hall': ago(hours=7)}
    cams, tg = TL.resolve_cameras(cfg, {'project4k': {'target': 'hall'}}, NOW, prog, sites)
    t.assertEqual((tg, cams['project4k'].get('off')), ({}, True), 'default 6 h: the camera sits the slot out')
    t.assertNotIn('project4k', TL.plan_views(dict(cfg, cameras=cams), {}, NOW, prog, 690)[0])
    t.assertEqual(TL.resolve_cameras(dict(cfg, follow_max_age_h=8), {}, NOW, prog, sites)[1], {'project4k': 'hall'})
    own = {'cameras': {'project4k': {'follow': True, 'max_age_h': 8}}, 'follow_max_age_h': 1}
    t.assertEqual(TL.resolve_cameras(own, {}, NOW, prog, sites)[1], {'project4k': 'hall'}, 'the camera\'s own value wins')
    t.assertEqual(CONF.get('follow_max_age_h'), 6, 'the template names the default')


def check_a_finished_project_gets_one_final_frame(t, M):
    TL = M['TL']
    done = {'box': [0, 0, 10, 10], 'g': 66, 'complete': True, 'complete_at': 1794800000000}
    sites = {'hall': done, 'yard': {'box': [20, 20, 30, 30], 'g': 64}}
    prog = {'hall': ago(hours=1), 'yard': ago(minutes=5)}
    cfg = {'cameras': {'project4k': {'follow': True, 'heavy': True}}, 'active_hours': 3}
    state = {'project4k': {'target': 'yard'}}
    shot = []
    for _ in range(4):                  # four slots: resolve, "publish" the frame, record it as _capture_locked does
        cams, tg = TL.resolve_cameras(cfg, state, NOW, prog, sites)
        target = tg.get('project4k')
        shot.append(target)
        if target:
            vs = dict(state.get('project4k') or {}, target=target)
            state['project4k'] = TL.note_final(vs, target, sites.get(target))
    t.assertEqual(shot, ['hall', 'yard', 'yard', 'yard'],
                  'the finished hall goes first for ONE frame (although yard is the busier, previous target), then never')
    t.assertEqual(state['project4k']['finals'], {'hall': 1794800000000})
    only = {'hall': done}
    t.assertEqual(TL.follow_target({}, only, prog, None, NOW, 3), 'hall', 'final frame owed')
    t.assertIsNone(TL.follow_target({}, only, prog, 'hall', NOW, 3, finals={'hall': 1794800000000}),
                   'final frame taken: a finished project is no target, and with no other the camera takes no frame')
    again = {'hall': dict(done, complete_at=1794900000000)}
    t.assertEqual(TL.follow_target({}, again, prog, None, NOW, 3, finals={'hall': 1794800000000}), 'hall',
                  'rebuilt and completed again: one more final frame')
    t.assertIsNone(TL.follow_target({}, only, {'hall': ago(hours=9)}, None, NOW, 3), 'no final frame for a stale completion')
    t.assertEqual(TL.note_final({'target': 'yard'}, 'yard', sites['yard']), {'target': 'yard'}, 'an open project: nothing recorded')
    t.assertEqual(TL.final_key({'complete': True, 'complete_at': None}), True)
    t.assertEqual(TL.frame_sidecar({'label': 'copper hall'}, 'hall', done),
                  {'label': 'copper hall', 'project': 'hall', 'final': True})
    t.assertEqual(TL.frame_sidecar({'label': 'yard'}, 'yard', sites['yard']), {'label': 'yard', 'project': 'yard'})


def check_completion_is_read_from_the_record(t, M):
    TL = M['TL']
    t.assertEqual(TL.record_completion({'structure_complete': True, 'state': 'complete', 'completeAt': 1794800000000}),
                  {'complete': True, 'complete_at': 1794800000000}, 'what skills.mjs publishes on completion')
    t.assertEqual(TL.record_completion({'structure_complete': True}), {'complete': True, 'complete_at': None})
    t.assertEqual(TL.record_completion({'state': 'complete'}), {'complete': True, 'complete_at': None})
    t.assertEqual(TL.record_completion({'structure_complete': False, 'state': 'open', 'sitedAt': 5}), {}, 'an open record')
    t.assertEqual(TL.record_completion({'structure_complete': 'yes'}), {}, 'only a real true')
    t.assertEqual(TL.record_completion({'ext': {'state': 'complete', 'completeAt': 9}}), {}, 'a mine extension is not the project')
    t.assertEqual(TL.record_completion(None), {})
    d = tempfile.mkdtemp(prefix='camdir-pool-')
    try:
        w = lambda n, j: json.dump(j, open(os.path.join(d, n), 'w'))
        w('project-0_70_0.hall.g7.json', {'box': [1, 2, 3, 4], 'structure_complete': True, 'state': 'complete',
                                          'completeAt': 1794800000000, 'site': {'g': 66}})
        w('project-0_70_0.yard.g2.json', {'box': [5, 6, 7, 8], 'structure_complete': False, 'state': 'open'})
        t.assertEqual(TL.project_sites({'project_dir': d}),
                      {'hall': {'box': [1, 2, 3, 4], 'g': 66, 'complete': True, 'complete_at': 1794800000000},
                       'yard': {'box': [5, 6, 7, 8], 'g': None}})
    finally:
        shutil.rmtree(d)


class StopTheWaste(unittest.TestCase):
    def test_off_camera_gets_no_rebuild(self):
        check_off_camera_gets_no_rebuild(self, REAL)

    def test_daily_is_never_skipped(self):
        check_daily_is_never_skipped(self, REAL)

    def test_no_new_frames_no_reencode(self):
        check_no_new_frames_no_reencode(self, REAL)

    def test_the_history_job_skips_them(self):
        check_the_history_job_skips_them(self, REAL)

    def test_event_frames_never_go_to_an_off_camera(self):
        check_event_frames_never_go_to_an_off_camera(self, REAL)

    def test_follow_target_has_an_age_limit(self):
        check_follow_target_has_an_age_limit(self, REAL)

    def test_a_finished_project_gets_one_final_frame(self):
        check_a_finished_project_gets_one_final_frame(self, REAL)

    def test_completion_is_read_from_the_record(self):
        check_completion_is_read_from_the_record(self, REAL)


# ============================================================================ PART 2: the activity director
TNOW = NOW.timestamp()
STAMP = '20261116T1245Z'


def stand(x, y, z, skill, minutes, until=None, step=10):
    """Position samples of a bot standing at one spot for `minutes`, the last one `step` s before `until` (default:
    now, so its bot-minutes are exactly `minutes`)."""
    until = TNOW if until is None else until
    n = int(minutes * 60 / step)
    return [(until - step * (n - i), x, y, z, skill) for i in range(n)]


def town(D):
    """A synthetic town at 12:45: 2 builders in one cell, 4 miners deep under the town, 3 walkers far north, 1 idler."""
    return {'Alpha': stand(10, 65, 10, 'build_shop', 20), 'Bravo': stand(12, 65, 14, 'place', 20),
            'Comet': stand(20, 12, -30, 'mine', 20), 'Delta': stand(22, 20, -32, 'deep_mine', 20),
            'Echo': stand(25, 25, -28, 'mine', 20), 'Frost': stand(18, 29.5, -35, 'mine', 20),
            'Gale': stand(0, 65, -200, 'goto', 20), 'Haven': stand(2, 66, -201, 'explore', 20),
            'Iris': stand(4, 64, -199, 'home', 20), 'Juno': stand(-200, 70, -200, 'status', 40)}


def check_layers_and_skill_classes(t, M):
    D = M['D']
    dc = D.dconf({})
    t.assertEqual([D.layer_of(y, dc) for y in (120, 58, 57.9, 30, 29.9, -50)],
                  ['surface', 'surface', 'shallow', 'shallow', 'deep', 'deep'], 'surface y >= 58, shallow 30 <= y < 58, deep y < 30')
    t.assertEqual(D.layer_of(40, D.dconf({'director': {'surface_y': 40}})), 'surface', 'configurable')
    want = {'build_shop': 'build', 'place': 'build', 'mine': 'mine', 'deep_mine': 'mine', 'gather': 'gather',
            'goto': 'walk', 'explore': 'walk', 'home': 'walk', 'status': 'idle', '?': 'idle', None: 'idle',
            'craft': 'work', 'smelt': 'work', 'town_deposit': 'work'}
    t.assertEqual({k: D.skill_class(k, dc) for k in want}, want)
    t.assertEqual(D.skill_class('craft', D.dconf({'director': {'skill_class': {'craft': 'build'}}})), 'build')
    w = dc['weights']
    t.assertTrue(w['build'] > w['mine'] == w['gather'] > w['work'] > w['walk'] > w['idle'] > 0,
                 'building and placing highest, mining and gathering next, walking lowest, idle near zero')
    t.assertLess(w['idle'], 0.1)
    t.assertEqual(D.dconf({'director': {'weights': {'walk': 1}}})['weights'].get('build'), 4.0, 'a partial weights object merges')


def check_scenes_score_bot_minutes_by_skill(t, M):
    D = M['D']
    dc = D.dconf({})
    sc = D.cluster(town(D), [], {}, TNOW, dc)
    t.assertEqual([(s['layer'], s['score'], s['bot_min'], len(s['bots']), s['skill']) for s in sc],
                  [('deep', 200.0, 80.0, 4, 'mine'),          # 4 bots x 20 min x 2.5
                   ('surface', 160.0, 40.0, 2, 'build'),      # 2 bots x 20 min x 4.0: fewer bot-minutes, more weight
                   ('surface', 18.0, 60.0, 3, 'walk')],       # 3 bots x 20 min x 0.3: the most bot-minutes of the three surface... ranked last
                  'ranked by weighted bot-minutes; the idle bot (40 min x 0.05 = 2) makes no scene')
    t.assertEqual(sc[0]['caption'], '4 bots mining under the town, y 12-30')
    t.assertEqual((sc[0]['box'], sc[0]['y'], sc[0]['bots'], sc[0]['cells']),
                  ([18, -35, 25, -28], [12, 30], ['Comet', 'Delta', 'Echo', 'Frost'], [[0, -2], [1, -2]]),
                  'Echo stands across a cell border (x 25): one scene all the same')
    t.assertEqual(sc[1]['caption'], '2 bots building in the town')
    t.assertEqual((sc[1]['box'], sc[1]['g'], sc[1]['cells'], sc[1]['fresh']), ([10, 10, 12, 14], 65, [[0, 0]], 120.0),
                  'the box is the bots\' own extent; fresh = the last 15 of the 20 minutes')
    t.assertEqual(sc[2]['caption'], '3 bots on the move 200 blocks north of the town')
    # a bot heard from once, 30 minutes ago, holds its spot for max_gap_s (60 s), not for 30 minutes
    lone = {'Kite': [(TNOW - 1800, 300, 10, 300, 'mine')]}
    t.assertEqual(D.cluster(lone, [], {}, TNOW, dc), [], '1 min x 2.5 is no scene')
    # activity that ended 20 minutes ago still scores in the 45-min window but none of it is fresh
    past = D.cluster({'Alpha': stand(10, 65, 10, 'build_shop', 20, until=TNOW - 1200)}, [], {}, TNOW, dc)
    t.assertEqual((len(past), past[0]['fresh']), (1, 0.0))
    t.assertGreater(past[0]['score'], 80)
    t.assertEqual(len(D.cluster(town(D), [], {}, TNOW, dict(dc, top=2))), 2, 'the top scenes only')
    t.assertEqual(D.cluster({'Lumen': stand(0, 65, 0, 'goto', 25)}, [], {}, TNOW, dc), [], '7.5 < min_scene_score 8')
    t.assertEqual(len(D.cluster({'Lumen': stand(0, 65, 0, 'goto', 30)}, [], {}, TNOW, dc)), 1, 'positive control: 9.0')
    brief = D.cluster({'Maple': stand(0, 65, 0, 'build_shop', 1)}, [(TNOW - 30, 'place', None, 0, 65, 0)] * 20, {}, TNOW, dc)
    t.assertEqual([(x['score'], x['bots']) for x in brief], [(9.0, ['Maple'])],
                  'one minute there is under min_bot_s (2 min): a scene still names its busiest bot')


def check_block_changes_add_to_the_score_and_name_the_scene(t, M):
    D = M['D']
    dc = D.dconf({})
    two = {'Alpha': stand(10, 65, 10, 'build_shop', 20), 'Bravo': stand(12, 65, 14, 'place', 20)}
    ch = [(TNOW - 60 * k, 'place' if k % 4 else 'clear', 'yard', 5 + k % 8, 66, 9) for k in range(40)]
    s = D.cluster(two, ch, {}, TNOW, dc)[0]
    t.assertEqual((s['score'], s['changes'], s['project']), (170.0, 40, 'yard'), '160 + 40 blocks x 0.25')
    t.assertEqual(s['caption'], '2 bots building the yard')
    t.assertEqual(s['box'], [5, 9, 12, 14], 'the changed blocks widen the box')
    # blocks changed with no bot position in the cell still make a scene there (the bot stood next door)
    far = [(TNOW - 30 * k, 'place', 'cottage1', 500, 70, 500) for k in range(40)]
    alone = D.cluster({}, far, {}, TNOW, dc)
    t.assertEqual([(x['layer'], x['score'], x['project'], x['g']) for x in alone], [('surface', 10.0, 'cottage1', 70)])
    # naming rules: at least name_min_changes of one project; never an area-wide job
    t.assertIsNone(D.cluster(two, ch[:2], {}, TNOW, dc)[0]['project'], '2 blocks do not name a scene')
    tidy = [(c[0], c[1], 'tidy') + c[3:] for c in ch]
    t.assertEqual(D.cluster(two, tidy, {}, TNOW, dc)[0]['caption'], '2 bots building in the town', 'tidy is everywhere: no name')


def check_scene_named_by_project_box_else_skill(t, M):
    D = M['D']
    dc = D.dconf({'director': {'names': {'hall': 'copper hall'}}})
    S = town(D)
    name = lambda sites, i=1: D.cluster(S, [], sites, TNOW, dc)[i]['caption']
    t.assertEqual(name({'cottage1': {'box': [8, 8, 16, 16]}}), '2 bots building the cottage1', 'its box overlaps a project box')
    t.assertEqual(name({'cottage1': {'box': [16, 16, 8, 8]}}), '2 bots building the cottage1', 'corners in any order')
    t.assertEqual(name({'hall': {'box': [8, 8, 16, 16]}}), '2 bots building the copper hall', 'the names map')
    t.assertEqual(name({'cottage1': {'box': [13, 15, 20, 20]}}), '2 bots building in the town', 'no overlap: the dominant skill')
    t.assertEqual(name({'cottage1': {'box': [12, 14, 20, 20]}, 'yard': {'box': [0, 0, 11, 11]}}), '2 bots building the yard',
                  'two overlap: the larger overlap')
    t.assertEqual(name({'wall': {'box': [8, 8, 16, 16]}}), '2 bots building in the town', 'an excluded area-wide project')
    t.assertEqual(name({'plaza': {'box': [-70, -70, 70, 70]}}), '2 bots building in the town', 'a box wider than name_max_side')
    under = D.cluster(S, [], {'shop': {'box': [15, -40, 30, -20]}}, TNOW, dc)[0]
    t.assertEqual((under['layer'], under['project']), ('deep', None), 'a box on the map does not name what is under it')
    gather = {'Alpha': stand(10, 65, 10, 'gather', 20)}
    t.assertEqual(D.cluster(gather, [], {'yard': {'box': [0, 0, 11, 11]}}, TNOW, dc)[0]['caption'], '1 bot gathering at the yard')
    t.assertEqual(D.caption_of(1, 'mine', 'deep', [200, 0, 220, 10], [-40, 5], None, dc),
                  '1 bot mining underground, 210 blocks east of the town, y -40 to 5')
    t.assertEqual(D.caption_of(3, 'gather', 'surface', [-10, 95, 10, 105], [64, 70], None, dc, home=(0, 0)),
                  '3 bots gathering 100 blocks south of the town')


def check_adjacent_cells_merge_within_one_layer(t, M):
    D = M['D']
    dc = D.dconf({})
    b = lambda x, y=65, z=5, skill='build_shop', m=20: stand(x, y, z, skill, m)
    two = D.cluster({'A': b(20), 'B': b(30)}, [], {}, TNOW, dc)
    t.assertEqual([(s['cells'], s['box'], s['score']) for s in two], [([[0, 0], [1, 0]], [20, 5, 30, 5], 160.0)],
                  'cells 0 and 1 are adjacent: ONE scene with one bounding box')
    diag = D.cluster({'A': b(20), 'B': stand(30, 65, 30, 'build_shop', 20)}, [], {}, TNOW, dc)
    t.assertEqual(len(diag), 1, 'a diagonal neighbour is adjacent')
    apart = D.cluster({'A': b(20), 'B': b(130)}, [], {}, TNOW, dc)
    t.assertEqual([s['cells'] for s in apart], [[[0, 0]], [[5, 0]]], 'five cells apart: two scenes')
    layers = D.cluster({'A': b(20), 'B': b(20, y=20, skill='mine')}, [], {}, TNOW, dc)
    t.assertEqual(sorted((s['layer'], s['cells']) for s in layers), [('deep', [[0, 0]]), ('surface', [[0, 0]])],
                  'the same column in two layers is two scenes')
    row = D.cluster({k: b(12 + 24 * i) for i, k in enumerate('ABCDE')}, [], {}, TNOW, dc)
    t.assertEqual([len(s['cells']) for s in row], [3, 2], 'a scene is at most max_span_cells (3) across')
    # a busy cell does not swallow a merely walked-through neighbour (join_frac of the seed's score)
    lop = D.cluster({'A': b(20), 'B': b(22), 'W': b(30, skill='goto')}, [], {}, TNOW, dc)
    t.assertEqual([(s['cells'], s['box']) for s in lop], [([[0, 0]], [20, 5, 22, 5])], 'the walker\'s cell (6.0) stays out')
    even = D.cluster({'A': b(20), 'B': b(30, skill='gather')}, [], {}, TNOW, dc)
    t.assertEqual(len(even[0]['cells']), 2, 'positive control: a neighbour at 50 of 80 joins')


def fixture_samples(D):
    fx = jload(os.path.join(HERE, 'fixtures', 'director-pos-20261116.json'))
    t0 = D.epoch(fx['t0'])
    S = {}
    for b, sec, x, y, z, s in fx['rows']:
        S.setdefault(fx['bots'][b], []).append((t0 + sec, x, y, z, fx['skills'][s]))
    return t0, S


def check_the_real_town_sample(t, M):
    """90 minutes of the live town (11-16 11:15-12:45Z, 14 bots): four passes, 15 minutes apart."""
    D = M['D']
    dc = D.dconf({})
    t0, S = fixture_samples(D)
    t.assertEqual((len(S), sum(len(v) for v in S.values())), (14, 4549), 'denominator: 14 bots, 4,549 position rows')
    prev, top_ids, seen_ids = None, [], set()
    for minute in (45, 60, 75, 90):
        now = t0 + minute * 60
        win = {b: [p for p in pts if now - 2700 <= p[0] <= now] for b, pts in S.items()}
        cl = D.cluster(win, [], {}, now, dc)
        t.assertEqual(len(cl), 8, 'the top 8')
        t.assertEqual([c['score'] for c in cl], sorted((c['score'] for c in cl), reverse=True), 'ranked')
        t.assertEqual({c['layer'] for c in cl} & {'shallow', 'deep'} != set(), True)
        t.assertTrue({'surface', 'deep'} <= {c['layer'] for c in cl}, 'bots are on the surface AND deep underground')
        for c in cl:
            t.assertLessEqual(max(c['box'][2] - c['box'][0], c['box'][3] - c['box'][1]), 3 * 24, 'no scene wider than 3 cells')
            t.assertTrue(c['bots'] and c['caption'].startswith(f"{len(c['bots'])} bot"))
        st = D.continuity(prev, cl, [], now, dc)
        live = st['scenes']
        t.assertLessEqual(sum(1 for s in live if s['layer'] == 'surface'), 3, 'cap: 3 surface')
        t.assertLessEqual(sum(1 for s in live if s['layer'] != 'surface'), 2, 'cap: 2 underground')
        t.assertEqual(len({s['id'] for s in live}), len(live))
        t.assertTrue(any(s['layer'] != 'surface' for s in live), 'an underground scene is live in every pass')
        seen_ids |= {s['id'] for s in live}
        top_ids.append({s['id'] for s in live})
        prev = st
    first = D.cluster({b: [p for p in pts if p[0] <= t0 + 2700] for b, pts in S.items()}, [], {}, t0 + 2700, dc)[0]
    t.assertEqual((first['layer'], first['caption'].split(',')[0]), ('deep', '6 bots mining under the town'),
                  'the busiest scene of the first window is the mine under the town, where no fixed camera looks')
    kept = set.intersection(*top_ids)
    t.assertGreaterEqual(len(kept), 3, f'at least three scenes keep their id through all four passes ({sorted(kept)})')
    t.assertTrue(any(i.startswith('s') for i in kept) and any(i[0] in 'ud' for i in kept), 'a surface one and an underground one')
    t.assertLessEqual(len(seen_ids), 8, 'no id churn: few scenes over 45 minutes')


def row(D, t, pos, name, detail='', dur=0.0, bot=None):
    return {'t': t, 'bot': bot, 'pos': pos, 'name': name, 'dur': dur, 'detail': detail}


def logline(bot, t, pos, name, detail='', dur_ms=0, pad=0):
    """One line as bots/src/logger.mjs writes it (the fields the director reads, plus padding like the real rows)."""
    ts = dt.datetime.fromtimestamp(t, U).strftime('%Y-%m-%dT%H:%M:%S.') + f'{int(t * 1000) % 1000:03d}Z'
    rec = {'@timestamp': ts, 'run_id': 'r', 'trigger': 'reflex',
           'bot': {'name': f'showcase-{bot}', 'role': 'builder', 'health': 20, 'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]},
                   'inventory': {'cobblestone': 64, 'pad': 'x' * pad}},
           'skill': {'name': name, 'args': {}, 'status': 'success', 'duration_ms': dur_ms, 'detail': detail}}
    return json.dumps(rec, separators=(',', ':'))        # compact, as JSON.stringify writes it


def check_rows_become_samples(t, M):
    D = M['D']
    dc = D.dconf({})
    r = D.parse_row(logline('Juno', TNOW - 100.25, (1.5, 64, -3.5), 'mine', 'ok', dur_ms=30000))
    t.assertEqual(r, {'t': TNOW - 100.25, 'bot': 'Juno', 'pos': (1.5, 64.0, -3.5), 'name': 'mine', 'dur': 30.0, 'detail': 'ok'})
    t.assertEqual(D.parse_row(logline('Juno', TNOW, (1, 2, 3), '_build', 'x').encode())['name'], '_build', 'bytes too')
    t.assertIsNone(D.parse_row('{not json'))
    t.assertIsNone(D.parse_row('[1, 2]'))
    t.assertIsNone(D.parse_row(json.dumps({'skill': {'name': 'mine'}})), 'no timestamp')
    t.assertIsNone(D.parse_row(json.dumps({'@timestamp': '2026-11-16T12:00:00Z', 'bot': {'name': 'showcase-A'}}))['pos'])
    # a skill row is stamped at its START and carries the END position; the events written during it are stamped live
    lo = TNOW - 2700
    rows = [row(D, TNOW - 600, (0, 64, 0), 'goto', dur=60),            # walked 60 s, arrived at 0,64,0 at -540
            row(D, TNOW - 530, (0, 40, 0), '_dig'),                    # during the mine skill below
            row(D, TNOW - 480, (0, 20, 0), '_dig'),
            row(D, TNOW - 538, (0, 12, 0), 'mine', dur=238),           # started -538, ended -300 at y 12
            row(D, TNOW - 200, (0, 12, 5), '_ore')]                    # after it: the next skill is not logged yet
    got = D.samples_of(rows, lo, TNOW, dc)
    t.assertEqual(got, [(TNOW - 540, 0, 64, 0, 'goto'), (TNOW - 530, 0, 40, 0, 'mine'), (TNOW - 480, 0, 20, 0, 'mine'),
                        (TNOW - 300, 0, 12, 0, 'mine'), (TNOW - 200, 0, 12, 5, 'mine')],
                 'positions in the order they happened, each with the skill in hand at that moment')
    two = D.samples_of([row(D, TNOW - 104, (1, 64, 1), '_a'), row(D, TNOW - 101, (2, 64, 2), '_b')], lo, TNOW, dc)
    t.assertEqual(two, [(TNOW - 101, 2, 64, 2, '?')], 'one sample per 10-s bin: the last row of the bin; no skill yet: ?')
    t.assertEqual(D.samples_of([row(D, lo - 5, (1, 64, 1), '_a'), row(D, TNOW - 50, None, '_b')], lo, TNOW, dc), [],
                  'outside the window, or no position: no sample')
    late = D.samples_of([row(D, lo - 100, (9, 64, 9), 'explore', dur=400)], lo, TNOW, dc)
    t.assertEqual(late, [(lo + 300, 9, 64, 9, 'explore')], 'a skill that started before the window and ended inside it counts')
    # _build rows -> block changes
    b = lambda op, extra='': row(D, TNOW - 60, (3, 64, 3), '_build', f'project=yard op={op} seg=s1 cell=-57,72,7 block=cobblestone{extra}')
    t.assertEqual(D.changes_of([b('place'), b('clear'), b('waived'), row(D, TNOW - 60, (3, 64, 3), 'place', 'op=place cell=1,2,3'),
                                row(D, lo - 60, (3, 64, 3), '_build', 'project=yard op=place cell=1,2,3')], lo, TNOW),
                  [(TNOW - 60, 'place', 'yard', -57, 72, 7), (TNOW - 60, 'clear', 'yard', -57, 72, 7)],
                  'place and clear rows of the window; not other ops, not a skill named place, not an old row')


class counting_open:
    """open() for a module under test, adding up every byte it reads."""
    def __init__(self):
        self.read = 0

    def __call__(self, path, mode='r', *a, **kw):
        f = open(path, mode, *a, **kw)
        outer, inner = self, f.read

        class F:
            def __enter__(s):
                return s

            def __exit__(s, *e):
                f.close()
                return False

            def read(s, *n):
                data = inner(*n)
                outer.read += len(data)
                return data

            def __getattr__(s, k):
                return getattr(f, k)
        return F() if 'b' in mode else f


def check_the_tail_read_is_bounded(t, M):
    """A 50 MB log is not read whole: 2 MB from its end, counted at the file object."""
    D = M['D']
    d = tempfile.mkdtemp(prefix='camdir-logs-')
    try:
        os.makedirs(os.path.join(d, 'showcase-Alpha'))
        os.makedirs(os.path.join(d, 'showcase-FIXTURE'))
        p = os.path.join(d, 'showcase-Alpha', 'skill-showcase-Alpha.jsonl')
        old = (logline('Alpha', TNOW - 5 * 86400, (0, 64, 0), 'mine', pad=900) + '\n').encode()
        with open(p, 'wb') as f:
            f.write(old * (50_000_000 // len(old) + 1))                      # 50 MB of last week's rows
            for k in range(300, 0, -1):                                       # then 300 rows of the last 50 minutes
                f.write((logline('Alpha', TNOW - 10 * k, (10, 12, 10), '_dig', pad=900) + '\n').encode())
            f.write(b'{"@timestamp":"2026-11-16T12:44:59.000Z","bot":{"na')    # a line still being written
        size = os.path.getsize(p)
        t.assertGreater(size, 50_000_000)
        with open(os.path.join(d, 'showcase-FIXTURE', 'skill-showcase-FIXTURE.jsonl'), 'w') as f:
            f.write(logline('FIXTURE', TNOW - 5, (0, 64, 0), '_dig') + '\n')
        dc = D.dconf({'director': {'log_glob': os.path.join(d, 'showcase-*', 'skill-showcase-*.jsonl')}})
        cnt, parsed, real_parse = counting_open(), [], D.parse_row
        with swap(D, open=cnt, parse_row=lambda line: parsed.append(1) or real_parse(line)):
            by_bot, stats = D.load_rows(dc, TNOW)
        t.assertEqual(cnt.read, dc['tail_bytes'], 'exactly the tail was read from the file')
        t.assertLessEqual(cnt.read, 2_000_000)
        t.assertLess(cnt.read, size / 25)
        t.assertEqual((stats['files'], stats['bytes']), (1, cnt.read), 'the stats report the bytes really read; FIXTURE is no bot')
        t.assertEqual(list(by_bot), ['Alpha'])
        t.assertEqual(len(by_bot['Alpha']), 300, 'every row of the window, the half-written last line dropped')
        t.assertEqual(len(parsed), 300, 'last week\'s lines in the tail were skipped by their stamp, not JSON-parsed')
        t.assertGreater(stats['bytes'] // len(old), 1000, 'positive control: the tail held >1,000 old lines')
        lines, n = D.read_tail(p, 5000)
        t.assertTrue(lines and all(x.startswith(b'{"@timestamp"') and x.endswith(b'}') for x in lines), 'only whole lines')
        t.assertEqual(n, 5000)
        small = os.path.join(d, 'small.jsonl')
        with open(small, 'w') as f:
            f.write(logline('A', TNOW - 20, (0, 1, 2), '_x') + '\n' + logline('A', TNOW - 10, (0, 1, 2), '_y') + '\n')
        lines, n = D.read_tail(small, 2_000_000)
        t.assertEqual((len(lines), n), (2, os.path.getsize(small)), 'a small file: all of it, its first line kept')
        t.assertEqual(len(D.read_tail(small, 2_000_000, D.iso(TNOW - 15)[:19])[0]), 1, 'since: an ISO prefix')
        t.assertEqual(D.bot_of(p), 'Alpha')
        # the line the seek cut in two is dropped even when what is left of it still carries a timestamp
        cut = os.path.join(d, 'cut.jsonl')
        whole = logline('A', TNOW - 10, (0, 1, 2), '_y')
        with open(cut, 'w') as f:
            f.write('{"pad":"' + 'x' * 3000 + '","@timestamp":"2026-11-16T12:44:00.000Z","bot":{}}\n' + whole + '\n')
        t.assertEqual(D.read_tail(cut, len(whole) + 200)[0], [whole.encode()])
    finally:
        shutil.rmtree(d)


def cl(layer, cells, score, fresh=None, bots=('Alpha',), caption=None):
    """A cluster as cluster() returns it, for the continuity tests."""
    xs, zs = [c[0] for c in cells], [c[1] for c in cells]
    return {'layer': layer, 'cells': [list(c) for c in cells], 'score': score, 'fresh': score if fresh is None else fresh,
            'box': [min(xs) * 24, min(zs) * 24, max(xs) * 24 + 23, max(zs) * 24 + 23], 'y': [64, 70], 'g': 65,
            'bots': list(bots), 'skill': 'build', 'project': None, 'caption': caption or f'{len(bots)} bots at {cells[0]}'}


def check_a_scene_keeps_its_id_then_holds_then_closes(t, M):
    D = M['D']
    dc = D.dconf({})
    m = lambda k: TNOW + 900 * k
    s1 = D.continuity(None, [cl('surface', [(0, 0)], 50)], [], m(0), dc)
    sid = s1['scenes'][0]['id']
    t.assertRegex(sid, r'^s20261116T1245[a-z]$', 'a stable string: layer letter, the minute it opened, a letter')
    t.assertEqual((s1['scenes'][0]['active'], s1['scenes'][0]['opened']), (True, '2026-11-16T12:45:00Z'))
    s2 = D.continuity(s1, [cl('surface', [(0, 0), (1, 0)], 70, caption='moved on')], [], m(1), dc)
    t.assertEqual([(s['id'], s['score'], s['caption'], s['box']) for s in s2['scenes']], [(sid, 70, 'moved on', [0, 0, 47, 23])],
                  'an overlapping cluster of the same layer: same id, the new box, caption and score')
    s3 = D.continuity(s2, [], [], m(2), dc)
    t.assertEqual([(s['id'], s['active'], s['score'], s['box']) for s in s3['scenes']], [(sid, False, 0, [0, 0, 47, 23])],
                  'no cluster: HELD -- still live, score 0, its last box')
    s4 = D.continuity(s3, [], [], m(3), dc)
    t.assertEqual([s['id'] for s in s4['scenes']], [sid], '30 min after it was last busy: still held')
    s5 = D.continuity(s4, [], [], m(4), dc)
    t.assertEqual((s5['scenes'], [(c['id'], c['why']) for c in s5['closed']]), ([], [(sid, 'quiet for more than 30 min')]))
    back = D.continuity(s4, [cl('surface', [(1, 0)], 30)], [], m(4), dc)
    t.assertEqual([(s['id'], s['active']) for s in back['scenes']], [(sid, True)], 'the bots come back inside the hold: same id')
    touch = D.continuity(s2, [dict(cl('surface', [(2, 0)], 30), box=[40, 0, 71, 23])], [], m(2), dc)
    t.assertEqual([s['id'] for s in touch['scenes']], [sid], 'no shared cell, but its box overlaps the scene\'s box: continued')
    beside = D.continuity(s2, [cl('surface', [(2, 0)], 30)], [], m(2), dc)
    t.assertEqual(len(beside['scenes']), 2, 'next to it without overlapping: a new scene')
    far = D.continuity(s2, [cl('surface', [(9, 9)], 30)], [], m(2), dc)
    t.assertEqual([(s['id'] == sid, s['active']) for s in far['scenes']], [(False, True), (True, False)],
                  'a cluster elsewhere is a NEW scene; the old one is held')
    deep = D.continuity(s2, [cl('deep', [(0, 0), (1, 0)], 90)], [], m(2), dc)
    t.assertEqual(sorted((s['id'][0], s['active']) for s in deep['scenes']), [('d', True), ('s', False)],
                  'the same cells in another layer do not continue it')
    stale = D.continuity(s2, [cl('surface', [(0, 0)], 60, fresh=0)], [], m(2), dc)
    t.assertEqual([(s['id'], s['active']) for s in stale['scenes']], [(sid, False)],
                  'a cluster with nothing in the last 15 minutes is not busy: it keeps no scene active')
    t.assertEqual(D.continuity(None, [cl('surface', [(0, 0)], 60, fresh=0)], [], m(0), dc)['scenes'], [], 'and opens none')
    # a scene that splits follows the busier part
    split = D.continuity(s2, [cl('surface', [(0, 0)], 20), cl('surface', [(1, 0)], 90)], [], m(2), dc)
    t.assertEqual(next(s['cells'] for s in split['scenes'] if s['id'] == sid), [[1, 0]])
    # the state file's shape: JSON, the closed scenes of the pass reported apart
    json.dumps(s5)
    t.assertEqual(sorted(s5), ['closed', 'scenes', 't', 'v'])


def check_live_scenes_are_capped(t, M):
    D = M['D']
    dc = D.dconf({})
    surf = [cl('surface', [(10 * k, 0)], 100 - k) for k in range(5)]
    under = [cl('deep', [(10 * k, 5)], 90 - k) for k in range(2)] + [cl('shallow', [(10 * k, 9)], 80 - k) for k in range(2)]
    st = D.continuity(None, sorted(surf + under, key=lambda c: -c['score']), [], TNOW, dc)
    live = st['scenes']
    t.assertEqual([s['score'] for s in live if s['layer'] == 'surface'], [100, 99, 98], '3 surface: the top three')
    t.assertEqual([(s['layer'], s['score']) for s in live if s['layer'] != 'surface'], [('deep', 90), ('deep', 89)],
                  '2 underground, shallow and deep together')
    t.assertEqual(sorted(s['id'] for s in live), ['d20261116T1245a', 'd20261116T1245b', 's20261116T1245a', 's20261116T1245b',
                                                  's20261116T1245c'], 'ids opened in one minute differ by their letter')
    t.assertEqual(len(D.continuity(None, surf, [], TNOW, dict(dc, max_surface=5))['scenes']), 5, 'configurable')
    # at the cap, a HELD scene gives its place to a new busy cluster; a busy one never does
    now2 = TNOW + 900
    newc = cl('surface', [(77, 0)], 500)
    full = D.continuity(st, surf[:3] + [newc], [], now2, dc)
    t.assertEqual(sorted(s['score'] for s in full['scenes'] if s['layer'] == 'surface'), [98, 99, 100],
                  'three busy scenes: the newcomer, however busy, waits')
    one_held = D.continuity(st, surf[:2] + [newc], [], now2, dc)
    t.assertEqual(sorted(s['score'] for s in one_held['scenes'] if s['layer'] == 'surface'), [99, 100, 500])
    t.assertEqual([(c['score'], c['why']) for c in one_held['closed'] if c['layer'] == 'surface'],
                  [(0, 'gave its place to a busier scene')])
    t.assertEqual(len({s['id'] for s in one_held['scenes']}), len(one_held['scenes']))


def check_events_open_short_scenes(t, M):
    D = M['D']
    dc = D.dconf({})
    since = TNOW - 900
    died = {'Juno': [row(D, TNOW - 300, (5.5, 64, 5.5), '_death', 'drowned; was running gather'),
                     row(D, TNOW - 2000, (5, 64, 5), '_death', 'an old death, before the last pass')]}
    ev, tr, seen = D.find_events(died, {}, [], since, TNOW, dc)
    t.assertEqual([(e['kind'], e['bot'], e['caption'], e['pos']) for e in ev], [('death', 'Juno', 'Juno died here', [5.5, 64, 5.5])])
    busy = cl('surface', [(3, 3)], 200)
    st = D.continuity(None, [busy], ev, TNOW, dc)
    t.assertEqual([s['kind'] for s in st['scenes']], ['death', 'activity'], 'the event is shot first')
    e = st['scenes'][0]
    t.assertEqual((e['kind'], e['id'], e['caption'], e['layer'], e['box'], e['bots'], e['until']),
                  ('death', 'e20261116T1245a', 'Juno died here', 'surface', [-5, -5, 15, 15], ['Juno'], '2026-11-16T13:00:00Z'),
                  'a 15-minute scene at the spot, AHEAD of a scene scoring 200')
    shot = D.note_shots(st, {e['id']: 30.0}, TNOW)
    t.assertEqual([s['id'] for s in sorted(shot['scenes'], key=D.scene_rank)], [st['scenes'][1]['id'], e['id']],
                  'its priority is spent with its first frame')
    again, _, seen2 = D.find_events(died, tr, seen, since, TNOW + 60, dc)
    t.assertEqual(again, [], 'the same row read again is not a second event')
    t.assertEqual(seen2, ['death:Juno:%d' % (TNOW - 300)])
    later = D.continuity(st, [busy], [], TNOW + 900, dc)
    t.assertEqual(([s['kind'] for s in later['scenes']], [c['why'] for c in later['closed']]), (['activity'], ['event over']))
    # a project completion: the project's own box, and its name
    done = {'Kite': [row(D, TNOW - 60, (40, 66, 40), '_structure_complete', 'project=yard op=complete kind=yard gen=4'),
                     row(D, TNOW - 50, (40, 66, 40), '_structure_complete', 'project=yard op=waived')]}
    ev, _, _ = D.find_events(done, {}, [], since, TNOW, dc, {'yard': {'box': [50, 50, 30, 30]}})
    t.assertEqual([(e['kind'], e['caption'], e['project'], e.get('box')) for e in ev],
                  [('complete', 'the yard is finished', 'yard', [30, 30, 50, 50])])
    t.assertEqual(D.continuity(None, [], ev, TNOW, dc)['scenes'][0]['box'], [30, 30, 50, 50])
    deep = {'Onyx': [row(D, TNOW - 60, (0, 11, 0), '_death', 'lava')]}
    under = D.continuity(None, [], D.find_events(deep, {}, [], since, TNOW, dc)[0], TNOW, dc)['scenes'][0]
    t.assertEqual((under['layer'], under['y']), ('deep', [11, 11]), 'an underground event is an underground scene')
    # at most max_events (2) at once: the oldest gives way
    three = {b: [row(D, TNOW - 100 + 10 * i, (i * 50, 64, 0), '_death', 'x')] for i, b in enumerate(('A', 'B', 'C'))}
    many = D.continuity(None, [], D.find_events(three, {}, [], since, TNOW, dc)[0], TNOW, dc)
    t.assertEqual(([s['bots'] for s in many['scenes']], [(c['bots'], c['why']) for c in many['closed']]),
                  ([['B'], ['C']], [(['A'], 'a newer event took its place')]))


def check_a_still_bot_that_moves_again_is_an_event(t, M):
    D = M['D']
    dc = D.dconf({})
    spot, m = (50, 64, 50), lambda k: TNOW + 60 * k
    still = [row(D, m(k), spot, '_tick') for k in range(-40, -5)]          # 35 minutes on one spot
    ev, tr, seen = D.find_events({'Kite': still}, {}, [], m(-15), m(-6), dc)
    t.assertEqual((ev, tr['Kite']['since'], tr['Kite']['last']), ([], m(-40), m(-6)), 'standing still is no event; it is tracked')
    moved = still + [row(D, m(-2), (70, 64, 50), 'goto')]
    ev, tr2, seen = D.find_events({'Kite': moved}, tr, seen, m(-6), TNOW, dc)       # the next pass re-reads the same rows
    t.assertEqual([(e['kind'], e['caption'], e['pos']) for e in ev],
                  [('moved', 'Kite is moving again after 34 min still', [70, 64, 50])])
    t.assertEqual(D.find_events({'Kite': moved}, tr2, seen, TNOW, m(15), dc)[0], [], 'once')
    t.assertEqual(tr2['Kite']['pos'], [70, 64, 50], 'the tracker now stands at the new spot')
    short = [row(D, m(k), spot, '_tick') for k in range(-25, -5)] + [row(D, m(-2), (70, 64, 50), 'goto')]
    t.assertEqual(D.find_events({'Kite': short}, {}, [], m(-6), TNOW, dc)[0], [], '20 minutes still is not 30')
    step = still + [row(D, m(-2), (55, 64, 50), 'goto')]
    t.assertEqual(D.find_events({'Kite': step}, {}, [], m(-6), TNOW, dc)[0], [], 'five blocks is a shuffle, not a move')
    jitter = [row(D, m(k), (50 + k % 3, 64, 50), '_tick') for k in range(-40, -5)] + [row(D, m(-2), (70, 64, 50), 'goto')]
    t.assertEqual(len(D.find_events({'Kite': jitter}, {}, [], m(-6), TNOW, dc)[0]), 1, 'within still_r (3) is still')
    # a skill row is stamped at its start: a 15-minute craft that ENDED on the spot at -5 extends the stillness to then
    craft = ([row(D, m(k), spot, '_tick') for k in range(-40, -11)] + [row(D, m(-20), spot, 'craft', dur=900),
                                                                      row(D, m(-2), (70, 64, 50), 'goto')])
    t.assertEqual([e['caption'] for e in D.find_events({'Kite': craft}, {}, [], m(-6), TNOW, dc)[0]],
                  ['Kite is moving again after 35 min still'], '28 minutes of ticks + the craft that ended at -5')


def check_surface_scenes_get_a_follow_style_camera(t, M):
    D, TL = M['D'], M['TL']
    dc = D.dconf({})
    st = D.continuity(None, [cl('deep', [(0, -2)], 300, bots=('Onyx', 'Kite')),
                             dict(cl('surface', [(0, 0)], 100, bots=('Delta', 'Juno'), caption='2 bots building the yard'),
                                  box=[-23, 0, 22, 20], g=70, project='yard')], [], TNOW, dc)
    cams, order = D.scene_cameras(st['scenes'], dc, TL.follow_camera)
    sid = next(s['id'] for s in st['scenes'] if s['layer'] == 'surface')
    t.assertEqual((list(cams), order), (['scene-' + sid], ['scene-' + sid]), 'a camera for the surface scene only')
    c = cams['scene-' + sid]
    t.assertEqual((c['x'], c['z'], c['y'], c['distance']), (0.0, 10.5, 70, 101),
                  'the box centre, the bots\' ground, 2.2 x the 46-block side (follow_camera\'s rule)')
    ref = TL.follow_camera(dc['scene_camera'], sid, {'box': [-23, 0, 22, 20], 'g': 70})
    t.assertEqual({k: c[k] for k in ('x', 'y', 'z', 'distance', 'rotation', 'angle', 'fov', 'ortho', 'mode', 'width', 'height')},
                  {k: ref[k] for k in ('x', 'y', 'z', 'distance', 'rotation', 'angle', 'fov', 'ortho', 'mode', 'width', 'height')})
    t.assertEqual((c['rotation'], c['angle'], c['fov'], c['markers']), (0.7854, 0.6, 32, []), 'fixed rotation / angle / fov')
    t.assertEqual((c['label'], c['project']), ('yard', ['yard']))
    t.assertEqual(c['scene'], {'id': sid, 'caption': '2 bots building the yard', 'bots': ['Delta', 'Juno'], 'layer': 'surface',
                               'score': 100, 'kind': 'activity', 'project': 'yard'})
    t.assertTrue(TL.camera_hash('showcase', c).startswith('#showcase:0.0:70:10.5:101:0.7854:0.6000:0:0:perspective'))
    small = D.scene_cameras([dict(st['scenes'][1], box=[5, 5, 9, 9])], dc, TL.follow_camera)[0]['scene-' + sid]
    t.assertEqual(small['distance'], 40, 'never closer than min_distance')
    t.assertEqual(D.scene_cameras(st['scenes'], dc, TL.follow_camera, est_s=27.5)[0]['scene-' + sid]['est_s'], 27.5)
    t.assertEqual(c['est_s'], 40)
    # shooting order: an unshot event, then busy scenes (the longest unshot first, then the busier), then held ones
    mk = lambda i, **kw: dict(st['scenes'][1], id=i, **kw)
    scenes = [mk('sa', score=90, last_shot='2026-11-16T12:30:00Z'), mk('sb', score=50, last_shot=None),
              mk('sc', score=70, last_shot='2026-11-16T12:15:00Z'), mk('sh', score=0, active=False, last_shot=None),
              mk('ev', kind='death', score=0, shots=0), mk('ex', kind='death', score=0, shots=1, last_shot='2026-11-16T12:30:00Z')]
    t.assertEqual(D.scene_cameras(scenes, dc, TL.follow_camera)[1],
                  ['scene-ev', 'scene-sb', 'scene-sc', 'scene-sa', 'scene-ex', 'scene-sh'])
    t.assertEqual(D.scene_label({'kind': 'death', 'skill': None}, dc), 'a death')
    t.assertEqual(D.scene_label({'kind': 'activity', 'skill': 'mine'}, dc), 'mining')


def plan_cfg():
    cam = lambda **kw: dict({'x': 0.5, 'y': 70, 'z': 0.5, 'distance': 95, 'rotation': 0.0, 'angle': 0.0, 'ortho': 1,
                             'mode': 'flat', 'fov': None}, **kw)
    cams = {'topdown': cam(), 'angled': cam(), 'town': cam(interval_min=15, idle_min=60),
            'grounds': cam(project=['tidy'], interval_min=15, idle_min=120), 'iso': cam(interval_min=30, idle_min=60),
            'patina': cam(interval_min=120, idle_min=360), 'hero4k': cam(heavy=True, est_s=150, interval_min=30, idle_min=30),
            'project4k': cam(heavy=True, est_s=150, interval_min=30, idle_min=60, project=['cottage1'], label='cottage1')}
    state = {v: {'frame_s': 30, 'last': '2026-11-16T12:25:00Z', 'last_change': '2026-11-16T12:25:00Z'}
             for v in ('topdown', 'angled', 'town', 'grounds', 'iso', 'patina')}
    state['hero4k'] = {'last': '2026-11-16T12:30:00Z'}
    state['project4k'] = {'last': '2026-11-16T12:00:00Z'}
    return {'cameras': cams, 'interval_min': 15}, state, {'tidy': NOW, 'cottage1': NOW}


def scene_cams(D, TL, n, est=40):
    dc = D.dconf({'director': {'scene_camera': {'est_s': est}}})
    st = D.continuity(None, [cl('surface', [(10 * k, 0)], 100 - k) for k in range(n)], [], TNOW, dict(dc, max_surface=9))
    return dc, D.scene_cameras(st['scenes'], dc, TL.follow_camera)


def check_scene_cameras_go_first_and_displace_fixed_ones(t, M):
    D, TL = M['D'], M['TL']
    cfg, state, prog = plan_cfg()
    base, _, _ = TL.plan_views(cfg, state, NOW, prog, 690)
    t.assertEqual(base, ['topdown', 'angled', 'grounds', 'town', 'project4k'],
                  'today: grounds and town are due (20 min, active), iso and patina are not, project4k is the 4K camera due')
    dc, (sc, order) = scene_cams(D, TL, 2)
    cams = D.apply_cameras(cfg['cameras'], dc, sc)
    views, why, deferred = TL.plan_views(dict(cfg, cameras=cams), state, NOW, prog, 690, first=order,
                                         first_budget_s=dc['scene_budget_s'])
    t.assertEqual(views, ['topdown', 'angled'] + order + ['town'],
                  'the scene cameras right after the pair, AHEAD of the fixed cameras; project4k gave up its slot; '
                  'grounds is idle-only (120 min) and not due')
    t.assertTrue(why[order[0]].startswith('scene: '))
    est = lambda v: 150 if v.endswith('4k') else 40 if v.startswith('scene-') else 30
    t.assertLessEqual(sum(est(v) for v in views), sum(est(v) for v in base), 'and the slot costs less than it did (200 s <= 270 s)')
    # the same cameras with no scene: project4k keeps its slot, grounds is still idle-only
    quiet = TL.plan_views(dict(cfg, cameras=D.apply_cameras(cfg['cameras'], dc, {})), state, NOW, prog, 690)[0]
    t.assertEqual(quiet, ['topdown', 'angled', 'town', 'project4k'])
    t.assertEqual(TL.cam_interval(cfg, dict(cfg['cameras']['grounds'], idle_only=True), True), 120.0)
    t.assertEqual(TL.cam_interval(cfg, cfg['cameras']['grounds'], True), 15.0, 'positive control: not marked, the active interval')
    t.assertNotIn('idle_only', cfg['cameras']['grounds'], 'apply_cameras does not change its input')
    t.assertNotIn('off', cfg['cameras']['project4k'])
    t.assertEqual({v for v, c in cams.items() if c.get('idle_only')}, {'grounds', 'patina', 'iso'})
    # the scene cameras' own ceiling per slot: 90 s holds two 40-s cameras; the third waits, most overdue next time
    dc3, (sc3, order3) = scene_cams(D, TL, 3)
    cams3 = D.apply_cameras(cfg['cameras'], dc3, sc3)
    v3, _, d3 = TL.plan_views(dict(cfg, cameras=cams3), state, NOW, prog, 690, first=order3, first_budget_s=90)
    t.assertEqual(([v for v in v3 if v.startswith('scene-')], [v for v in d3 if v.startswith('scene-')]), (order3[:2], order3[2:]))
    t.assertEqual(len([v for v in TL.plan_views(dict(cfg, cameras=cams3), state, NOW, prog, 690, first=order3)[0]
                       if v.startswith('scene-')]), 3, 'positive control: with no ceiling all three fit the budget')
    # a tight slot: what today went to a fixed camera goes to the scene camera
    tight_base = TL.plan_views(cfg, state, NOW, prog, 110)[0]
    tight = TL.plan_views(dict(cfg, cameras=cams), state, NOW, prog, 110, first=order, first_budget_s=90)
    t.assertEqual((tight_base, tight[0]), (['topdown', 'angled', 'grounds'], ['topdown', 'angled', order[0]]))
    t.assertIn('town', tight[2], 'the fixed camera is deferred, not dropped')
    t.assertEqual(TL.plan_views(dict(cfg, cameras=cams), state, NOW, prog, 90, first=order)[0::2],
                  (['topdown', 'angled', 'town'], order), '30 s left: a 40-s scene camera does not overdraw; a 30-s camera fits')
    t.assertEqual(TL.plan_views(dict(cfg, cameras=cams), state, NOW, prog, 20, first=order)[0], ['topdown', 'angled'],
                  'the pair is never dropped')


def check_the_budget_is_never_exceeded(t, M):
    D, TL = M['D'], M['TL']
    cfg, state, prog = plan_cfg()
    est = lambda v, cams: float((state.get(v) or {}).get('frame_s') or (cams[v] or {}).get('est_s') or 60)
    n = 0
    for k in range(4):
        dc, (sc, order) = scene_cams(D, TL, k)
        cams = D.apply_cameras(cfg['cameras'], dc, sc)
        for budget in range(0, 900, 37):
            for spent in (0, 75, 150, 300):
                for fb in (None, 90, 45):
                    views, _, deferred = TL.plan_views(dict(cfg, cameras=cams), state, NOW, prog, budget, spent,
                                                       first=order, first_budget_s=fb)
                    extra = [v for v in views if v not in TL.VIEWS]
                    room = budget - spent - sum(est(v, cams) for v in TL.VIEWS)
                    t.assertLessEqual(sum(est(v, cams) for v in extra), max(0, room), (k, budget, spent, fb, views))
                    if fb is not None:
                        t.assertLessEqual(sum(est(v, cams) for v in extra if v.startswith('scene-')), fb)
                    t.assertEqual(views[:2], list(TL.VIEWS))
                    t.assertFalse(set(views) & set(deferred))
                    n += 1
    t.assertEqual(n, 4 * 25 * 4 * 3, 'denominator: 1,200 plans')


def check_frames_carry_the_scene(t, M):
    TL = M['TL']
    cam = {'label': 'yard', 'scene': {'id': 's20261116T1245a', 'caption': '2 bots building the yard', 'bots': ['Delta', 'Juno'],
                                      'layer': 'surface', 'score': 100, 'kind': 'activity', 'project': 'yard'}}
    t.assertEqual(TL.frame_sidecar(cam, None),
                  {'label': 'yard', 'project': 'yard', 'scene': 's20261116T1245a', 'caption': '2 bots building the yard',
                   'bots': ['Delta', 'Juno'], 'layer': 'surface', 'score': 100, 'kind': 'activity'})
    t.assertEqual(TL.frame_sidecar({'label': 'town'}, None), {'label': 'town', 'project': None}, 'a fixed camera: as before')
    out = ('ok /r/frames/.staging/scene-s20261116T1245a-20261116T1245Z.png ms=31000\n'
           'skip /r/frames/.staging/scene-e20261116T1245a-20261116T1245Z.png deadline\n'
           'ok /r/frames/.staging/angled-20261116T1245Z-event-x.png ms=9000\n'
           'ok /r/frames/.staging/topdown-20261116T1245Z.png ms=21500 reused\n')
    t.assertEqual(TL.job_timings(out), {'scene-s20261116T1245a': 31.0, 'scene-e20261116T1245a': 'deadline', 'angled': 9.0,
                                        'topdown': 21.5}, 'a camera name may carry a dash; the stamp ends it')


def slot_root(extra_conf=None, deaths=True):
    """A temp timelapse root + bot logs: 3 bots building on the surface, 2 mining deep, for 30 minutes; one death."""
    root = tempfile.mkdtemp(prefix='camdir-slot-')
    os.makedirs(os.path.join(root, 'logs'))
    with open(os.path.join(root, 'logs', 'views.json'), 'w') as f:        # both fixed cameras were shot 20 minutes ago
        json.dump({v: {'last': '2026-11-16T12:25:00Z', 'last_change': '2026-11-16T12:25:00Z', 'frame_s': 30}
                   for v in ('grounds', 'town')}, f)
    for bot, pos, skill in (('Alpha', (10, 65, 10), 'build_shop'), ('Bravo', (12, 65, 14), 'build_shop'),
                            ('Comet', (14, 66, 12), 'place'), ('Delta', (20, 12, -30), 'mine'), ('Echo', (22, 14, -32), 'mine')):
        d = os.path.join(root, 'botlogs', f'showcase-{bot}')
        os.makedirs(d)
        with open(os.path.join(d, f'skill-showcase-{bot}.jsonl'), 'w') as f:
            for k in range(60, 0, -1):
                f.write(logline(bot, TNOW - 30 * k, pos, skill, 'ok', dur_ms=29000) + '\n')
                if skill != 'mine':
                    f.write(logline(bot, TNOW - 30 * k + 5, pos, '_build',
                                    f'project=yard op=place seg=a cell={pos[0]},{pos[1]},{pos[2]} block=cobblestone') + '\n')
            if deaths and bot == 'Comet':
                f.write(logline(bot, TNOW - 20, (200, 64, 200), '_death', 'fell') + '\n')
    cam = {'x': 0.5, 'y': 70, 'z': 0.5, 'distance': 95, 'rotation': 0.0, 'angle': 0.0, 'ortho': 1, 'mode': 'flat', 'fov': None}
    cfg = {'root': root, 'heartbeat': os.path.join(root, 'hb.jsonl'), 'capture_min': 15, 'save_hold': False, 'min_free_gb': 0,
           'home': [0, 70, 0], 'budget_s': 690, 'project_dir': os.path.join(root, 'pool'), 'world': os.path.join(root, 'world'),
           'mirror': os.path.join(root, 'mirror'), 'web': 'http://x', 'map_id': 'm', 'width': 1920, 'height': 1080,
           'cameras': {'topdown': cam, 'angled': cam, 'town': dict(cam, interval_min=15),
                       'grounds': dict(cam, interval_min=15, idle_min=120, project=['tidy'])},
           'director': dict({'on': True, 'log_glob': os.path.join(root, 'botlogs', 'showcase-*', 'skill-showcase-*.jsonl')},
                            **(extra_conf or {}))}
    return root, cfg


def run_slot(M, cfg, now=NOW, stamp=STAMP):
    """tl_showcase._capture_locked with the world, BlueMap and the browser faked: every planned view gets its frame.
    The wiring imports `tl_director` by name: it gets the module under test."""
    import argparse
    TL = M['TL']
    shot = []

    def fake_capture(rcfg, stamp, views, deadline=None, est=None, pair=TL.VIEWS):
        paths = []
        for v in views:
            p = TL.frame_path(rcfg['root'], v, stamp)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(b'png')
            paths.append(p)
        shot[:] = list(views)
        n = len(pair)
        return 0, '', paths[:n], 1.0, 1.0, paths[n:], {}, 0
    fake_capture.timings = {}
    real_plan = TL.plan_views

    def plan(*a, **kw):
        views, why, deferred = real_plan(*a, **kw)
        fake_capture.timings = {v: 31.0 for v in views}
        return views, why, deferred
    with swap(TL, snapshot=lambda cfg: (True, None, 1), render=lambda cfg, full=False: (0, 1.0, 1.0),
              brain_health=lambda cfg: {}, small_gray=lambda p: b'\x01' * 64, capture=fake_capture, plan_views=plan,
              free_gb=lambda p: 500.0, project_sites=lambda cfg: {'yard': {'box': [8, 8, 16, 16], 'g': 65}},
              project_progress=lambda cfg: {'tidy': now}), quiet():
        had = sys.modules.get('tl_director')
        sys.modules['tl_director'] = M['D']
        try:
            TL._capture_locked(cfg, argparse.Namespace(event=None, frame0=False), now, stamp)
        finally:
            sys.modules.pop('tl_director')
            if had is not None:
                sys.modules['tl_director'] = had
    with open(cfg['heartbeat']) as f:
        hb = [json.loads(x) for x in f.read().splitlines()]
    return shot, hb[-1]


def check_a_whole_slot_with_the_director_on(t, M):
    """The wiring: real log files -> tl_director.run -> the plan -> frames + sidecars -> the three files."""
    TL = M['TL']
    root, cfg = slot_root()
    try:
        logs = os.path.join(root, 'logs')
        dry = M['D'].run(cfg, NOW, {}, stamp=STAMP, frame=TL.follow_camera, write=False)       # what `plan` does
        t.assertEqual((len(dry['slot']['scenes']), os.listdir(logs)), (3, ['views.json']), 'a dry pass sees the scenes and writes nothing')
        shot, hb = run_slot(M, cfg)
        t.assertEqual(sorted(f for f in os.listdir(logs) if f.startswith('scenes')),
                      ['scenes-20261116.jsonl', 'scenes-slot.json', 'scenes.json'], 'the director\'s three files')
        slot = jload(os.path.join(logs, 'scenes-slot.json'))
        t.assertEqual((slot['v'], slot['stamp'], slot['t'], slot['window_min']), (1, STAMP, '2026-11-16T12:45:00Z', 45))
        by = {s['kind'] + ':' + s['layer']: s for s in slot['scenes']}
        t.assertEqual(sorted(by), ['activity:deep', 'activity:surface', 'death:surface'])
        t.assertEqual(slot['scenes'][0]['kind'], 'death', 'the event first')
        surf, deep, death = by['activity:surface'], by['activity:deep'], by['death:surface']
        t.assertEqual((surf['caption'], surf['bots'], surf['project'], surf['box'], surf['active']),
                      ('3 bots building the yard', ['Alpha', 'Bravo', 'Comet'], 'yard', [10, 10, 14, 14], True))
        t.assertEqual((deep['caption'], deep['camera'], deep['frames'], deep['y']),
                      ('2 bots mining under the town, y 12-14', None, 'frames/under-' + deep['id'], [12, 14]),
                      'the underground scene: no BlueMap camera, handed to tl_under with its box and layer')
        t.assertEqual(sorted(deep), ['active', 'bots', 'box', 'camera', 'caption', 'frames', 'g', 'id', 'kind', 'layer',
                                     'opened', 'project', 'score', 'skill', 'y'], 'the documented hand-off fields')
        t.assertEqual((surf['camera'], surf['frames']), ('scene-' + surf['id'], 'frames/scene-' + surf['id']))
        t.assertEqual(shot, ['topdown', 'angled', 'scene-' + death['id'], 'scene-' + surf['id'], 'town'],
                      'pair, the death, the yard, then the fixed camera; grounds (shot 20 min ago) is idle-only now')
        side = jload(os.path.join(root, 'frames', 'scene-' + surf['id'], '20261116', STAMP + '.json'))
        t.assertEqual({k: side[k] for k in ('scene', 'caption', 'bots', 'layer', 'label', 'project')},
                      {'scene': surf['id'], 'caption': '3 bots building the yard', 'bots': ['Alpha', 'Bravo', 'Comet'],
                       'layer': 'surface', 'label': 'yard', 'project': 'yard'})
        t.assertIn('changed', side)
        t.assertEqual(jload(os.path.join(root, 'frames', 'scene-' + death['id'], '20261116', STAMP + '.json'))['caption'],
                      'Comet died here')
        t.assertNotIn('scene', jload(os.path.join(root, 'frames', 'town', '20261116', STAMP + '.json')), 'a fixed camera\'s sidecar is as before')
        st = jload(os.path.join(logs, 'scenes.json'))
        t.assertEqual({s['id']: s['shots'] for s in st['scenes']}, {death['id']: 1, surf['id']: 1, deep['id']: 0})
        t.assertEqual(st['cam_s'], 31.0, 'the measured cost of a scene frame is remembered')
        with open(os.path.join(logs, 'scenes-20261116.jsonl')) as f:
            day = [json.loads(x) for x in f.read().splitlines()]
        t.assertEqual(day, [slot], 'the day log holds the same object, one line per slot')
        d = hb.get('director')
        t.assertTrue(d, 'the heartbeat row carries the director\'s part')
        t.assertEqual((d['cameras'], d['shot'], d['files'], len(d['scenes'])),
                      (['scene-' + death['id'], 'scene-' + surf['id']], sorted([death['id'], surf['id']]), 5, 3))
        t.assertTrue(0 < d['bytes'] <= 5 * 2_000_000)
        t.assertTrue(hb['ok'])
        # 30 minutes on with silent logs: the scenes are held, then gone; their schedule memory goes with them
        views = jload(os.path.join(logs, 'views.json'))
        t.assertIn('scene-' + surf['id'], views)
        later = NOW + dt.timedelta(minutes=60)
        run_slot(M, cfg, later, '20261116T1345Z')
        views = jload(os.path.join(logs, 'views.json'))
        t.assertEqual([k for k in views if k.startswith('scene-')], [], 'closed scenes leave views.json')
        t.assertEqual(jload(os.path.join(logs, 'scenes-slot.json'))['scenes'], [])
        t.assertFalse(os.path.exists(os.path.join(logs, 'gray', 'scene-' + surf['id'] + '.gray')))
        t.assertTrue(os.path.exists(os.path.join(logs, 'gray', 'town.gray')), 'positive control: a fixed camera keeps its gray file')
    finally:
        shutil.rmtree(root)


def check_the_slot_ceiling_reaches_the_plan(t, M):
    """director.slot_s through the real wiring: with a scene camera in the slot the plan stops at slot_s."""
    root, cfg = slot_root({'slot_s': 215})       # the pair is 2 x 60 s (never measured here): 95 s left
    try:
        shot, hb = run_slot(M, cfg)
        t.assertEqual([v.split('-')[0] for v in shot], ['topdown', 'angled', 'scene', 'scene'],
                      'two 40-s scene cameras fit; the 30-s town camera waits for the next slot')
        t.assertIn('town', hb['deferred'])
    finally:
        shutil.rmtree(root)
    root, cfg = slot_root()
    try:
        t.assertEqual(run_slot(M, cfg)[0][-1], 'town', 'positive control: under the default 360 s it is shot')
    finally:
        shutil.rmtree(root)
    root, cfg = slot_root({'slot_s': 130, 'log_glob': '/nonexistent/showcase-*/x.jsonl'})
    try:
        shot, hb = run_slot(M, cfg)
        t.assertEqual(shot, ['topdown', 'angled', 'town'],
                      'no scene camera in the slot: budget_s alone, the fixed cameras as before (grounds idle-only)')
        t.assertEqual((hb['director']['scenes'], hb['director']['files']), ([], 0))
    finally:
        shutil.rmtree(root)


def check_a_failing_director_costs_the_slot_nothing(t, M):
    TL = M['TL']
    root, cfg = slot_root({'weights': 'not an object'})
    try:
        try:
            shot, hb = run_slot(M, cfg)
        except Exception as e:
            t.fail(f'a director error crashed the slot: {type(e).__name__}: {e}')
        t.assertEqual(shot, ['topdown', 'angled', 'grounds', 'town'], 'exactly the plan without a director')
        t.assertTrue(hb['ok'])
        t.assertIn('error', hb.get('director') or {}, 'and the heartbeat row says why')
        t.assertFalse(os.path.exists(os.path.join(root, 'logs', 'scenes.json')))
    finally:
        shutil.rmtree(root)


def check_director_off_plans_exactly_as_before(t, M):
    """`director: {on: false}` (or no key): the cameras, the plan and the files are those of a tl.conf without it."""
    TL = M['TL']
    t.assertFalse(TL.director_on({}))
    t.assertFalse(TL.director_on({'director': {'on': False, 'idle_only': ['town']}}))
    t.assertFalse(TL.director_on({'director': {}}), 'only an explicit on: true')
    t.assertTrue(TL.director_on({'director': {'on': True}}))
    cams = {'town': {'x': 1}}
    had = sys.modules.pop('tl_director', None)
    got = TL.director_slot({'director': {'on': False}}, cams, NOW, {})
    t.assertTrue(got[0] is cams and got[1:] == ((), None, None, None), 'the cameras untouched, nothing first, no ceiling')
    t.assertNotIn('tl_director', sys.modules, 'tl_director.py is not even imported')
    if had is not None:
        sys.modules['tl_director'] = had
    shots = {}
    for label, dconf_ in (('absent', None), ('off', {'on': False, 'idle_only': ['town', 'grounds'], 'replaces': ['town']})):
        root, cfg = slot_root()
        try:
            if dconf_ is None:
                del cfg['director']
            else:
                cfg['director'] = dict(cfg['director'], **dconf_)
            shot, hb = run_slot(M, cfg)
            shots[label] = shot
            t.assertEqual(sorted(os.listdir(os.path.join(root, 'logs'))), ['gray', 'views.json'], f'{label}: no director file is written')
            t.assertNotIn('director', hb)
            t.assertEqual(sorted(os.listdir(os.path.join(root, 'frames'))), ['.staging', 'angled', 'grounds', 'topdown', 'town'][1:]
                          if not os.path.isdir(os.path.join(root, 'frames', '.staging')) else ['.staging', 'angled', 'grounds', 'topdown', 'town'])
        finally:
            shutil.rmtree(root)
    t.assertEqual(shots['absent'], ['topdown', 'angled', 'grounds', 'town'], 'grounds at its active interval: not idle-only')
    t.assertEqual(shots['off'], shots['absent'])
    root, cfg = slot_root()
    try:
        t.assertNotEqual(run_slot(M, cfg)[0], shots['absent'], 'positive control: the same slot with on: true differs')
    finally:
        shutil.rmtree(root)
    # a simulated day of the TEMPLATE's cameras: off and absent give the same plan in all 96 slots
    off = simulate_day(TL, dict(CONF, director=dict(CONF['director'], on=False)))
    absent = simulate_day(TL, {k: v for k, v in CONF.items() if k != 'director'})
    t.assertEqual(off, absent)
    t.assertEqual(len(off), 96)
    t.assertGreater(len({tuple(v) for v in off}), 3, 'positive control: the day has different slots')


SPENT_S = 75.0          # snapshot + render before the plan (what `tl_showcase.py plan` assumes)


def simulate_day(TL, cfg, scene_plan=None, slots=96):
    """Plan every 15-min slot of a day with every project active, marking each planned view shot. scene_plan(cams, t)
    -> (cameras, first, first_budget_s, slot_s) stands in for the director. -> [views per slot]."""
    state, out = {}, []
    sites = {'cottage1': {'box': [30, 30, 40, 40], 'g': 66}}
    t0 = dt.datetime(2026, 11, 16, tzinfo=U)
    for k in range(slots):
        now = t0 + dt.timedelta(minutes=15 * k)
        prog = {'tidy': now, 'grounds': now, 'cottage1': now}
        cams, targets = TL.resolve_cameras(cfg, state, now, prog, sites)
        first, fb, slot_s = (), None, None
        if scene_plan:
            cams, first, fb, slot_s = scene_plan(cams, now)
        budget = TL.plan_budget(float(cfg.get('budget_s') or 690), slot_s)
        views, _, _ = TL.plan_views(dict(cfg, cameras=cams), state, now, prog, budget, SPENT_S,
                                    pair=TL.slot_pair(cfg, now), first=first, first_budget_s=fb)
        for v in views:
            heavy = (cams.get(v) or {}).get('heavy')
            state[v] = dict(state.get(v) or {}, last=TL._iso(now), last_change=TL._iso(now),
                            frame_s=150 if heavy else 40 if v.startswith('scene-') else 30)
            if v in targets:
                state[v]['target'] = targets[v]
        out.append(views)
    return out


def check_the_template_day_costs_no_more(t, M):
    """The template tl.conf, every camera active all day (today's most expensive day), three surface scenes live in
    every slot: the planned capture seconds with the director on are not more than with it off."""
    D, TL = M['D'], M['TL']
    t.assertTrue(CONF['director']['on'])
    t.assertEqual((CONF['director']['idle_only'], CONF['director']['replaces']), (['grounds', 'patina', 'iso'], ['project4k']))
    for v in ('grounds', 'patina', 'iso', 'project4k'):
        t.assertFalse(CONF['cameras'][v].get('off'), f'{v} is kept in the template, not deleted or switched off')
    dc = D.dconf(CONF)
    cost = lambda day: [sum(150 if v.endswith('4k') else 40 if v.startswith('scene-') else 30 for v in views) for views in day]

    def scenes(cams, now):
        st = D.continuity(None, [cl('surface', [(10 * k, 0)], 100 - k) for k in range(3)], [], now.timestamp(), dc)
        for s in st['scenes']:
            s['id'] = 'sfixed' + s['id'][-1]              # the same three scenes all day
        sc, order = D.scene_cameras(st['scenes'], dc, TL.follow_camera)
        return D.apply_cameras(cams, dc, sc), order, dc['scene_budget_s'], dc['slot_s']
    off = cost(simulate_day(TL, dict(CONF, director=dict(CONF['director'], on=False))))
    on_day = simulate_day(TL, CONF, scenes)
    on = cost(on_day)
    t.assertEqual((sum(off), max(off)), (27000, 360), 'today: 281 s of frames per slot on average, 360 s at most')
    t.assertLessEqual(sum(on), sum(off), f'on {sum(on)} s <= off {sum(off)} s over 96 slots')
    t.assertLessEqual(max(on), max(off), 'and no slot costs more than today\'s most expensive slot')
    t.assertTrue(all(c + SPENT_S <= dc['slot_s'] <= CONF['budget_s'] for c in on),
                 'every slot with a scene camera inside slot_s (360 s from its start), itself inside budget_s')
    t.assertEqual(TL.plan_budget(690, None), 690, 'no scene camera in the slot: budget_s alone, as before')
    t.assertEqual((TL.plan_budget(690, 360), TL.plan_budget(300, 360)), (360, 300))
    n_scene = sum(1 for views in on_day for v in views if v.startswith('scene-'))
    t.assertEqual(n_scene, 96 * 2, 'two 40-s scene frames in every slot (the 90-s ceiling)')
    t.assertEqual(sum(1 for views in on_day if 'project4k' in views), 0, 'project4k yields in every slot that has a scene')
    t.assertEqual(sum(1 for views in on_day if 'grounds' in views), 12, 'grounds: every 2 h, not every slot')
    t.assertGreater(sum(1 for views in on_day if 'hero4k' in views), 40, 'positive control: the town overview is untouched')


class Director(unittest.TestCase):
    def test_layers_and_skill_classes(self):
        check_layers_and_skill_classes(self, REAL)

    def test_scenes_score_bot_minutes_by_skill(self):
        check_scenes_score_bot_minutes_by_skill(self, REAL)

    def test_block_changes_add_to_the_score_and_name_the_scene(self):
        check_block_changes_add_to_the_score_and_name_the_scene(self, REAL)

    def test_scene_named_by_project_box_else_skill(self):
        check_scene_named_by_project_box_else_skill(self, REAL)

    def test_adjacent_cells_merge_within_one_layer(self):
        check_adjacent_cells_merge_within_one_layer(self, REAL)

    def test_the_real_town_sample(self):
        check_the_real_town_sample(self, REAL)

    def test_rows_become_samples(self):
        check_rows_become_samples(self, REAL)

    def test_the_tail_read_is_bounded(self):
        check_the_tail_read_is_bounded(self, REAL)

    def test_a_scene_keeps_its_id_then_holds_then_closes(self):
        check_a_scene_keeps_its_id_then_holds_then_closes(self, REAL)

    def test_live_scenes_are_capped(self):
        check_live_scenes_are_capped(self, REAL)

    def test_events_open_short_scenes(self):
        check_events_open_short_scenes(self, REAL)

    def test_a_still_bot_that_moves_again_is_an_event(self):
        check_a_still_bot_that_moves_again_is_an_event(self, REAL)

    def test_surface_scenes_get_a_follow_style_camera(self):
        check_surface_scenes_get_a_follow_style_camera(self, REAL)


class DirectorInTheSlot(unittest.TestCase):
    def test_scene_cameras_go_first_and_displace_fixed_ones(self):
        check_scene_cameras_go_first_and_displace_fixed_ones(self, REAL)

    def test_the_budget_is_never_exceeded(self):
        check_the_budget_is_never_exceeded(self, REAL)

    def test_frames_carry_the_scene(self):
        check_frames_carry_the_scene(self, REAL)

    def test_a_whole_slot_with_the_director_on(self):
        check_a_whole_slot_with_the_director_on(self, REAL)

    def test_the_slot_ceiling_reaches_the_plan(self):
        check_the_slot_ceiling_reaches_the_plan(self, REAL)

    def test_a_failing_director_costs_the_slot_nothing(self):
        check_a_failing_director_costs_the_slot_nothing(self, REAL)

    def test_the_template_day_costs_no_more(self):
        check_the_template_day_costs_no_more(self, REAL)


class DirectorOff(unittest.TestCase):
    def test_director_off_plans_exactly_as_before(self):
        check_director_off_plans_exactly_as_before(self, REAL)


# =================================================================================================== mutants
MUTANTS = [
    # ---- part 1
    ('tl_video.py', "    if view in off:\n        return True, 'camera is off", "    if False:\n        return True, 'camera is off",
     'check_off_camera_gets_no_rebuild'),
    ('tl_video.py', "if isinstance(cam, dict) and cam.get('off')}", "if isinstance(cam, dict)}", 'check_off_camera_gets_no_rebuild'),
    ('tl_video.py', "    if kind not in REBUILD_KINDS:\n        return False, None, None", "    if False:\n        return False, None, None",
     'check_daily_is_never_skipped'),
    ('tl_video.py', "        if prev_side['newest_frame'] == newest:", "        if False:", 'check_no_new_frames_no_reencode'),
    ('tl_video.py', "        if prev_side['newest_frame'] == newest:", "        if True:", 'check_no_new_frames_no_reencode'),
    ('tl_video.py', "    if not have_mp4 or not isinstance(prev_side, dict) or newest is None:",
     "    if not isinstance(prev_side, dict) or newest is None:", 'check_no_new_frames_no_reencode'),
    ('tl_video.py', "prev_side.get('last') == candidates[-1] and prev_side.get('candidates') == len(candidates):",
     "prev_side.get('last') == candidates[-1]:", 'check_no_new_frames_no_reencode'),
    ('tl_video.py', "        if t is None or (lo is not None and t < lo) or (hi is not None and t >= hi):",
     "        if t is None or (lo is not None and t < lo):", 'check_no_new_frames_no_reencode'),
    ('tl_video.py', "            if skip:\n", "            if False:\n", 'check_the_history_job_skips_them'),
    ('tl_video.py', "                if backfill:\n", "                if False:\n", 'check_the_history_job_skips_them'),
    ('tl_video.py', "            extra = {'newest_frame': newest}\n", "            extra = None\n", 'check_the_history_job_skips_them'),
    ('tl_event.py', " and not cam.get('follow') and not cam.get('off')\n", " and not cam.get('follow')\n",
     'check_event_frames_never_go_to_an_off_camera'),
    ('tl_event.py', "    if evc and not evc.get('off') and project in sites:", "    if evc and project in sites:",
     'check_event_frames_never_go_to_an_off_camera'),
    ('tl_showcase.py', "        cands = {n: t for n, t in cands.items() if t >= oldest}", "        cands = dict(cands)",
     'check_follow_target_has_an_age_limit'),
    ('tl_showcase.py', "        age = cam.get('max_age_h', cfg.get('follow_max_age_h', DEFAULT_FOLLOW_MAX_AGE_H))",
     "        age = cfg.get('follow_max_age_h', DEFAULT_FOLLOW_MAX_AGE_H)", 'check_follow_target_has_an_age_limit'),
    ('tl_showcase.py', "DEFAULT_FOLLOW_MAX_AGE_H = 6.0 ", "DEFAULT_FOLLOW_MAX_AGE_H = 0 ", 'check_follow_target_has_an_age_limit'),
    ('tl_showcase.py', "    if owed:\n", "    if False:\n", 'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "    cands = {n: t for n, t in cands.items() if n not in done}", "    cands = dict(cands)",
     'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "if (finals or {}).get(n) != final_key(sites[n])}", "if True}",
     'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "if (finals or {}).get(n) != final_key(sites[n])}", "if n not in (finals or {})}",
     'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "max_age_h=age, finals=vs.get('finals'))", "max_age_h=age)", 'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "    if not target or not (site or {}).get('complete'):\n        return vstate",
     "    if True:\n        return vstate", 'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "    if target and (site or {}).get('complete'):\n        side['final'] = True",
     "    if target:\n        side['final'] = True", 'check_a_finished_project_gets_one_final_frame'),
    ('tl_showcase.py', "rec.get('structure_complete') is True or rec.get('state') == 'complete'):",
     "rec.get('structure_complete') is True):", 'check_completion_is_read_from_the_record'),
    ('tl_showcase.py', "rec.get('structure_complete') is True or rec.get('state') == 'complete'):",
     "rec.get('structure_complete') or rec.get('state') == 'complete'):", 'check_completion_is_read_from_the_record'),
    ('tl_showcase.py', "dict({'box': box, 'g': g}, **record_completion(j)))", "{'box': box, 'g': g})",
     'check_completion_is_read_from_the_record'),
    # ---- part 2: the director's rules (tl_director.py)
    ('tl_director.py', "    return 'surface' if y >= dc['surface_y'] else", "    return 'surface' if y > dc['surface_y'] else",
     'check_layers_and_skill_classes'),
    ('tl_director.py', "('shallow' if y >= dc['deep_y'] else 'deep')", "('shallow' if y > dc['deep_y'] else 'deep')",
     'check_layers_and_skill_classes'),
    ('tl_director.py', "    if name.startswith('build'):\n        return 'build'", "    if name.startswith('build'):\n        return 'work'",
     'check_layers_and_skill_classes'),
    ('tl_director.py', "        out[k] = dict(DEFAULTS[k], **(d.get(k) or {}))", "        out[k] = d.get(k) or DEFAULTS[k]",
     'check_layers_and_skill_classes'),
    ('tl_director.py', "            pts_score = dwell / 60.0 * float(dc['weights'].get(cls, 1.0))", "            pts_score = dwell / 60.0",
     'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "            dwell = min(max(0.0, nxt - t), dc['max_gap_s'])", "            dwell = max(0.0, nxt - t)",
     'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "            a['fresh'] += pts_score if t >= fresh_lo else 0.0", "            a['fresh'] += pts_score",
     'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "        if score < dc['min_scene_score']:\n            continue", "        if False:\n            continue",
     'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "    return scenes[:int(dc['top'])]", "    return scenes", 'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "    scenes.sort(key=lambda s: (-s['score'], LAYERS.index(s['layer']), s['cells']))",
     "    scenes.sort(key=lambda s: (-s['bot_min'], LAYERS.index(s['layer']), s['cells']))", 'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "        names = [b for b in order if bots[b] >= dc['min_bot_s']] or order[:1]",
     "        names = [b for b in order if bots[b] >= dc['min_bot_s']]", 'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "    under = layer != 'surface'\n", "    under = False\n", 'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "        if dist <= dc['town_r']:", "        if True:", 'check_scenes_score_bot_minutes_by_skill'),
    ('tl_director.py', "        a['score'] += dc['change_weight']\n", "        a['score'] += 0\n",
     'check_block_changes_add_to_the_score_and_name_the_scene'),
    ('tl_director.py', "if p and p not in excl and n >= dc['name_min_changes']}", "if p and p not in excl}",
     'check_block_changes_add_to_the_score_and_name_the_scene'),
    ('tl_director.py', "if p and p not in excl and n >= dc['name_min_changes']}", "if p and n >= dc['name_min_changes']}",
     'check_block_changes_add_to_the_score_and_name_the_scene'),
    ('tl_director.py', "        ys = ys or cys\n", "        ys = ys or [0]\n", 'check_block_changes_add_to_the_score_and_name_the_scene'),
    ('tl_director.py', "    if layer != 'surface':\n        return None", "    if False:\n        return None",
     'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "        if name in excl or not b:", "        if not b:", 'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "        if max(x1 - x0, z1 - z0) + 1 > dc['name_max_side']:", "        if False:",
     'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "if w > 0 and h > 0 and (best is None or w * h > best[0]):", "if w > 0 and h > 0 and best is None:",
     'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "if w > 0 and h > 0 and (best is None or w * h > best[0]):", "if best is None or w * h > best[0]:",
     'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "        where = f'the {label}' if skill == 'build' else f'at the {label}'", "        where = f'the {label}'",
     'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "        label = (dc.get('names') or {}).get(project) or project\n        where", "        label = project\n        where",
     'check_scene_named_by_project_box_else_skill'),
    ('tl_director.py', "for dx in (-1, 0, 1) for dz in (-1, 0, 1) if dx or dz]", "for dx in (-1, 0, 1) for dz in (0,) if dx or dz]",
     'check_adjacent_cells_merge_within_one_layer'),
    ('tl_director.py', "for dx in (-1, 0, 1) for dz in (-1, 0, 1) if dx or dz]", "for dx in () for dz in () if dx or dz]",
     'check_adjacent_cells_merge_within_one_layer'),
    ('tl_director.py', "                if x1 - x0 + 1 > span or z1 - z0 + 1 > span:", "                if False:",
     'check_adjacent_cells_merge_within_one_layer'),
    ('tl_director.py', " and n not in taken and hot[n]['score'] >= floor), key=rank):", " and n not in taken), key=rank):",
     'check_adjacent_cells_merge_within_one_layer'),
    ('tl_director.py', "        k = (layer, int(math.floor(x / size)), int(math.floor(z / size)))",
     "        k = ('surface', int(math.floor(x / size)), int(math.floor(z / size)))", 'check_adjacent_cells_merge_within_one_layer'),
    ('tl_director.py', "'min_fresh_score': 1.0, 'max_span_cells': 3,", "'min_fresh_score': 1.0, 'max_span_cells': 9,",
     'check_the_real_town_sample'),
    ('tl_director.py', "    'hold_min': 30, 'max_surface': 3, 'max_under': 2,", "    'hold_min': 30, 'max_surface': 3, 'max_under': 9,",
     'check_the_real_town_sample'),
    ('tl_director.py', "    return r['t'] + (r['dur'] if r['name'] and not r['name'].startswith('_') else 0.0)", "    return r['t']",
     'check_rows_become_samples'),
    ('tl_director.py', "        bins[int(t // dc['bin_s'])] = (t, p)", "        bins[t] = (t, p)", 'check_rows_become_samples'),
    ('tl_director.py', "        out.append((t, p[0], p[1], p[2], names[i] if i >= 0 else '?'))",
     "        out.append((t, p[0], p[1], p[2], names[-1] if names else '?'))", 'check_rows_become_samples'),
    ('tl_director.py', "        if lo <= t <= hi:\n            pts.append((t, r['pos']))", "        if True:\n            pts.append((t, r['pos']))",
     'check_rows_become_samples'),
    ('tl_director.py', "        if not (o and c) or o.group(1) not in ('place', 'clear'):", "        if not (o and c):",
     'check_rows_become_samples'),
    ('tl_director.py', "        if r['name'] != '_build' or not (lo <= r['t'] <= hi):", "        if not (lo <= r['t'] <= hi):",
     'check_rows_become_samples'),
    ('tl_director.py', "        if r['name'] != '_build' or not (lo <= r['t'] <= hi):", "        if r['name'] != '_build':",
     'check_rows_become_samples'),
    ('tl_director.py', "        off = max(0, size - int(max_bytes))", "        off = 0", 'check_the_tail_read_is_bounded'),
    ('tl_director.py', "        f.seek(off)\n        data = f.read(int(max_bytes))", "        data = f.read()",
     'check_the_tail_read_is_bounded'),
    ('tl_director.py', "        f.seek(off)\n", "        f.seek(0)\n", 'check_the_tail_read_is_bounded'),
    ('tl_director.py', "        if i < 0 or (lo is not None and raw[i + 14:i + 14 + len(lo)] < lo):", "        if i < 0:",
     'check_the_tail_read_is_bounded'),
    ('tl_director.py', "    data = data[:data.rfind(b'\\n') + 1]\n", "", 'check_the_tail_read_is_bounded'),
    ('tl_director.py', "        data = data[cut + 1:] if cut >= 0 else b''", "        pass", 'check_the_tail_read_is_bounded'),
    ('tl_director.py', "        if 'FIXTURE' in f:\n            continue", "        if False:\n            continue",
     'check_the_tail_read_is_bounded'),
    ('tl_director.py', "            if i in claimed or c['layer'] != s['layer']:", "            if i in claimed:",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "    busy = [c for c in clusters if c.get('fresh', 0) >= dc['min_fresh_score']]", "    busy = list(clusters)",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "        elif now - (_ts(s.get('last_active')) or 0) > hold:", "        elif True:",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "        elif now - (_ts(s.get('last_active')) or 0) > hold:", "        elif False:",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "        elif now - (_ts(s.get('last_active')) or 0) > hold:", "        elif now - (_ts(s.get('last_active')) or 0) >= hold:",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "            s.update(active=False, score=0, fresh=0)", "            s.update(active=False)",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "            key = (ov >= 1, c['score'], ov)", "            key = (ov,)", 'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "            if ov > 0 and (best is None or key > best[0]):", "            if best is None or key > best[0]:",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "    return 0.5 if a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3] else 0.0", "    return 0.0",
     'check_a_scene_keeps_its_id_then_holds_then_closes'),
    ('tl_director.py', "        if len(mine) >= int(dc['max_surface'] if group == 'surface' else dc['max_under']):", "        if False:",
     'check_live_scenes_are_capped'),
    ('tl_director.py', "            if not held:\n                continue", "            if True:\n                continue",
     'check_live_scenes_are_capped'),
    ('tl_director.py', "            held = [s for s in mine if not s.get('active')]", "            held = list(mine)",
     'check_live_scenes_are_capped'),
    ('tl_director.py', "        if sid not in used:\n", "        if True:\n", 'check_live_scenes_are_capped'),
    ('tl_director.py', "        mine = [s for s in live if not _is_event(s) and GROUP[s['layer']] == group]",
     "        mine = [s for s in live if not _is_event(s) and s['layer'] == c['layer']]", 'check_live_scenes_are_capped'),
    ('tl_director.py', "            if (_ts(s.get('until')) or 0) <= now:", "            if False:", 'check_events_open_short_scenes'),
    ('tl_director.py', "    for s in evs[:max(0, len(evs) - int(dc['max_events']))]:", "    for s in []:", 'check_events_open_short_scenes'),
    ('tl_director.py', "    return (0 if _is_event(s) and not s.get('shots') else 1,", "    return (1,", 'check_events_open_short_scenes'),
    ('tl_director.py', "    return (0 if _is_event(s) and not s.get('shots') else 1,", "    return (0 if _is_event(s) else 1,",
     'check_events_open_short_scenes'),
    ('tl_director.py', "            if not (since < r['t'] <= now) or r['pos'] is None:", "            if not (r['t'] <= now) or r['pos'] is None:",
     'check_events_open_short_scenes'),
    ('tl_director.py', "            elif r['name'] == '_structure_complete' and 'op=complete' in r['detail']:",
     "            elif r['name'] == '_structure_complete':", 'check_events_open_short_scenes'),
    ('tl_director.py', "        if ev['key'] in known:\n            continue", "        if False:\n            continue",
     'check_events_open_short_scenes'),
    ('tl_director.py', "                     'until': iso(now + dc['event_min'] * 60),", "                     'until': iso(now + 3600),",
     'check_events_open_short_scenes'),
    ('tl_director.py', "            s['shots'] = int(s.get('shots') or 0) + 1", "            s['shots'] = int(s.get('shots') or 0)",
     'check_events_open_short_scenes'),
    ('tl_director.py', "                if b:\n                    ev['box'] =", "                if False:\n                    ev['box'] =",
     'check_events_open_short_scenes'),
    ('tl_director.py', "            if d >= dc['moved_r'] and still >= dc['still_min'] * 60 and since < t <= now:",
     "            if d >= dc['moved_r'] and since < t <= now:", 'check_a_still_bot_that_moves_again_is_an_event'),
    ('tl_director.py', "            if d >= dc['moved_r'] and still >= dc['still_min'] * 60 and since < t <= now:",
     "            if still >= dc['still_min'] * 60 and since < t <= now:", 'check_a_still_bot_that_moves_again_is_an_event'),
    ('tl_director.py', "            if d <= dc['still_r']:\n", "            if d <= 0:\n", 'check_a_still_bot_that_moves_again_is_an_event'),
    ('tl_director.py', "        for t, r in sorted(((when(r), r) for r in rows if r['pos'] is not None), key=lambda x: x[0]):",
     "        for t, r in sorted(((r['t'], r) for r in rows if r['pos'] is not None), key=lambda x: x[0]):",
     'check_a_still_bot_that_moves_again_is_an_event'),
    ('tl_director.py', "        if s['layer'] != 'surface':\n            continue\n        cam = frame(", "        if False:\n            continue\n        cam = frame(",
     'check_surface_scenes_get_a_follow_style_camera'),
    ('tl_director.py', "        cam = frame(base, s['id'], {'box': s['box'], 'g': s.get('g')})", "        cam = frame(base, s['id'], {'box': s['box'], 'g': None})",
     'check_surface_scenes_get_a_follow_style_camera'),
    ('tl_director.py', "    if est_s:\n        base['est_s'] = est_s", "    if False:\n        base['est_s'] = est_s",
     'check_surface_scenes_get_a_follow_style_camera'),
    ('tl_director.py', "        order.append((scene_rank(s)[:2] + (s.get('last_shot') or '',) + scene_rank(s)[2:], 'scene-' + s['id']))",
     "        order.append((scene_rank(s), 'scene-' + s['id']))", 'check_surface_scenes_get_a_follow_style_camera'),
    ('tl_director.py', "    if scene_cams:\n        for v in dc.get('replaces') or ():", "    if True:\n        for v in dc.get('replaces') or ():",
     'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_director.py', "                out[v] = dict(out[v] or {}, off=True, off_why='director: a scene camera has its slot')",
     "                pass", 'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_director.py', "            out[v] = dict(out[v], idle_only=True)", "            out[v] = dict(out[v])",
     'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_director.py', "                       'camera': 'scene-' + s['id'] if surface else None,", "                       'camera': 'scene-' + s['id'],",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_director.py', "    if write:\n        save_state(cfg, state)", "    if False:\n        save_state(cfg, state)",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_director.py', "    if write:\n        save_state(cfg, state)", "    if True:\n        save_state(cfg, state)",
     'check_a_whole_slot_with_the_director_on'),
    # ---- part 2: the wiring (tl_showcase.py)
    ('tl_showcase.py', "    if active and not cam.get('idle_only'):", "    if active:", 'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "    out += lead\n", "    heavy += lead\n", 'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "        if v in VIEWS or v in first or (cams[v] or {}).get('off') or (cams[v] or {}).get('event_only'):",
     "        if v in VIEWS or (cams[v] or {}).get('off') or (cams[v] or {}).get('event_only'):",
     'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "        if est(v) <= left and est(v) <= room:", "        if est(v) <= left:",
     'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "    deferred += late\n", "", 'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "        if est(v) <= left and est(v) <= room:", "        if est(v) <= room:", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "            left -= est(v)\n            room -= est(v)", "            room -= est(v)", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "            left -= est(v)\n            room -= est(v)", "            left -= est(v)", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "    if sc:     ", "    if False:  ", 'check_frames_carry_the_scene'),
    ('tl_showcase.py', "        v = m.group(1) if m else base.split('-', 1)[0]", "        v = base.split('-', 1)[0]", 'check_frames_carry_the_scene'),
    ('tl_showcase.py', "    return bool(((cfg or {}).get('director') or {}).get('on'))", "    return True",
     'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "    return bool(((cfg or {}).get('director') or {}).get('on'))", "    return bool((cfg or {}).get('director'))",
     'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "    if not director_on(cfg):\n        return cams, (), None, None, None", "    if False:\n        return cams, (), None, None, None",
     'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "    except Exception as e:\n        return cams, (), None, None, {'error'", "    except ZeroDivisionError as e:\n        return cams, (), None, None, {'error'",
     'check_a_failing_director_costs_the_slot_nothing'),
    ('tl_showcase.py', "    if res.get('error'):\n        return {'error': res['error']}", "    if res.get('error'):\n        return None",
     'check_a_failing_director_costs_the_slot_nothing'),
    ('tl_showcase.py', "                res['dc'].get('slot_s') if first else None, res)", "                None, res)",
     'check_the_slot_ceiling_reaches_the_plan'),
    ('tl_showcase.py', "                res['dc'].get('slot_s') if first else None, res)", "                res['dc'].get('slot_s'), res)",
     'check_the_slot_ceiling_reaches_the_plan'),
    ('tl_showcase.py', "    views, why, deferred = plan_views(rcfg, state, t, progress, plan_budget(budget, slot_s), time.time() - start,",
     "    views, why, deferred = plan_views(rcfg, state, t, progress, budget, time.time() - start,",
     'check_the_slot_ceiling_reaches_the_plan'),
    ('tl_showcase.py', "    return min(float(budget_s), float(slot_s)) if slot_s else budget_s", "    return budget_s",
     'check_the_template_day_costs_no_more'),
    ('tl_showcase.py', "                                      pair=pair, first=first, first_budget_s=first_budget)\n    est = {v:",
     "                                      pair=pair, first=(), first_budget_s=first_budget)\n    est = {v:",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "    for v in [k for k in state if k.startswith('scene-') and k not in cams]:", "    for v in []:",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "    D.finish(cfg, res, shots, now)", "    D.finish(cfg, res, {}, now)", 'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "    if drow is not None:\n        row['director'] = drow", "    if False:\n        row['director'] = drow",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "        res = D.run(cfg, now, sites, stamp=stamp, frame=follow_camera, write=write)",
     "        res = D.run(cfg, now, sites, stamp=None, frame=follow_camera, write=write)", 'check_a_whole_slot_with_the_director_on'),
]
KEY = {fn: k for k, fn in FILES.items()}


class Mutants(unittest.TestCase):
    def test_every_mutant_is_killed_by_its_own_check(self):
        survived, killed = [], 0
        for fn, old, new, check in MUTANTS:
            src = open(os.path.join(HERE, fn)).read()
            assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE in {fn}: {old[:70]!r} ({src.count(old)})'
            assert old != new
            mods = dict(REAL, **{KEY[fn]: load(fn, src.replace(old, new, 1))})
            try:
                globals()[check](self, mods)
            except AssertionError:
                killed += 1
                continue
            except Exception as e:      # an unrelated crash is NOT a kill
                survived.append(f'{fn}: {old.strip()[:60]!r} ERRORED in {check}: {type(e).__name__}: {e}')
                continue
            survived.append(f'{fn}: {old.strip()[:60]!r} SURVIVED {check}')
        print(f'{killed} of {len(MUTANTS)} mutants killed')
        self.assertEqual(survived, [])


if __name__ == '__main__':
    unittest.main()
