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
    _run_video.kws = []

    def fake_build(v, st, out, name, **kw):
        calls.append((v, list(st), kw.get('extra')))
        _run_video.kws.append(dict(kw, out=out))
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


def run_slot(M, cfg, now=NOW, stamp=STAMP, module='under test'):
    """tl_showcase._capture_locked with the world, BlueMap and the browser faked: every planned view gets its frame.
    The wiring imports `tl_director` by name: it gets the module under test (module=None: the import fails, as on a
    VM where the file was never installed)."""
    import argparse
    TL = M['TL']
    shot = []
    module = M['D'] if module == 'under test' else module

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
        sys.modules['tl_director'] = module
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
        fields = ['active', 'bots', 'box', 'camera', 'caption', 'frames', 'g', 'id', 'kind', 'layer', 'opened', 'project',
                  'score', 'skill', 'y']
        t.assertEqual(sorted(deep), sorted(fields + ['trail']), 'the documented hand-off fields; underground: + trail')
        t.assertEqual((sorted(surf), sorted(death)), (fields, fields), 'a surface scene has no trail')
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
        t.assertEqual(day, [dict(slot, scenes=[{k: v for k, v in x.items() if k != 'trail'} for x in slot['scenes']])],
                      'the day log holds the same object, one line per slot, without the trails')
        t.assertNotIn('trail', json.dumps(day))
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


def starve_cfg():
    """Codex r1's slot: the angled frame (30 s), the 150-s hero4k every 30 min, a 30-s town camera, two 40-s scenes."""
    cam = lambda **kw: dict({'x': 0.5, 'y': 70, 'z': 0.5, 'distance': 95, 'rotation': 0.0, 'angle': 0.0, 'ortho': 1,
                             'mode': 'flat', 'fov': None}, **kw)
    cams = {'topdown': cam(), 'angled': cam(), 'town': cam(interval_min=15, idle_min=60),
            'hero4k': cam(heavy=True, est_s=150, interval_min=30, idle_min=30)}
    ago_ = lambda m: (NOW - dt.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%SZ')
    state = lambda hero, town=15: {'angled': {'frame_s': 30}, 'topdown': {'frame_s': 30},
                                   'town': {'frame_s': 30, 'last': ago_(town), 'last_change': ago_(town)},
                                   'hero4k': {'frame_s': 150, 'last': ago_(hero)}}
    return {'cameras': cams, 'interval_min': 15}, state


def check_no_fixed_camera_starves_behind_the_scene_cameras(t, M):
    D, TL = M['D'], M['TL']
    cfg, state = starve_cfg()
    dc, (sc, order) = scene_cams(D, TL, 2)
    cams = D.apply_cameras(cfg['cameras'], dc, sc)
    rcfg = dict(cfg, cameras=cams)
    plan = lambda st, spent=120, **kw: TL.plan_views(rcfg, st, NOW, {}, 690, spent, pair=('angled',), first=order,
                                                     first_budget_s=90, slot_s=360, **kw)
    cost = lambda views: sum(150 if v == 'hero4k' else 40 if v.startswith('scene-') else 30 for v in views)
    # 360 - 120 (snapshot + render) - 30 (angled) = 210 s. Merely DUE (30 min), the 4K camera waits behind two scenes:
    views, why, deferred = plan(state(30))
    t.assertEqual((views, deferred), (['angled'] + order + ['town'], ['hero4k']), 'two scenes (80 s) leave 130 s: no room for 150')
    t.assertEqual(plan(state(45))[0], ['angled'] + order + ['town'], '45 min: still waiting (one missed interval is ordinary)')
    # not shot for TWO of its intervals (60 min): it is owed -- its 150 s are set aside before the scenes take theirs
    views, why, deferred = plan(state(60))
    t.assertEqual((views, deferred), (['angled', order[0], 'hero4k'], [order[1], 'town']),
                  'the 4K camera is shot; ONE scene frame fits beside it (60 s were left); the other waits')
    t.assertIn('owed', why['hero4k'])
    t.assertLessEqual(cost(views) + 120, 360, 'inside slot_s')
    t.assertEqual(plan(state(58))[0][-1], 'hero4k', 'the 2 minutes of timer slack apply to "owed" as to "due"')
    # on the hour the pair is two frames (60 s): 180 s left, 150 set aside, no scene frame fits, a 30-s camera does
    hour = TL.plan_views(rcfg, state(60), NOW, {}, 690, 120, pair=('topdown', 'angled'), first=order, first_budget_s=90, slot_s=360)
    t.assertEqual((hour[0], sorted(hour[2])), (['topdown', 'angled', 'town', 'hero4k'], sorted(order)))
    t.assertLessEqual(cost(hour[0]) + 120, 360)
    # an owed camera keeps its seconds although an ACTIVE camera sorts before it in the due list
    both = plan(state(60, town=30))
    t.assertEqual(both[0], ['angled', 'town', 'hero4k'], 'town (30 min = 2 of its 15-min intervals) and hero4k are both owed: '
                  '180 of the 210 s; no 40-s scene frame fits the 30 s left')
    busy = dict(state(60), town={'frame_s': 30, 'last': state(16)['town']['last'], 'last_change': state(16)['town']['last']})
    t.assertEqual(plan(busy)[0], ['angled', order[0], 'hero4k'], 'town is due and active (first in the due order) but not owed: '
                  'it does not take the seconds set aside for the 4K camera')
    # one 4K camera per slot, as ever: of two owed ones the more overdue is set aside, the other is next
    two = dict(rcfg, cameras=dict(cams, other4k=dict(cams['hero4k'])))
    st2 = dict(state(60), other4k={'frame_s': 150, 'last': state(90)['hero4k']['last']})
    v2 = TL.plan_views(two, st2, NOW, {}, 690, 0, pair=('angled',), first=order, first_budget_s=90, slot_s=360)[0]
    t.assertEqual(v2, ['angled'] + order + ['town', 'other4k'], '330 s: one 4K camera set aside (the 90-min one), two scenes, town')
    # an owed camera that does not fit what is left is NOT set aside: the scene cameras keep those seconds
    wide = dict(rcfg, cameras=dict(cams, big=dict(cams['town'], est_s=60)))
    st3 = dict(state(15, town=45), big={'frame_s': 60, 'last': state(30)['hero4k']['last'], 'last_change': state(30)['hero4k']['last']})
    v3 = TL.plan_views(wide, st3, NOW, {}, 690, 250, pair=('angled',), first=order, first_budget_s=90, slot_s=360)
    t.assertEqual((v3[0], sorted(v3[2])), (['angled', order[0], 'town'], sorted(['big', order[1]])),
                  '80 s: town (owed, 30) is set aside; big (owed, 60) no longer fits and waits; a 40-s scene frame takes the rest')
    # the knob
    t.assertEqual(TL.plan_views(dict(rcfg, director={'overdue_n': 1}), state(30), NOW, {}, 690, 120, pair=('angled',), first=order,
                                first_budget_s=90, slot_s=360)[0], ['angled', 'town', 'hero4k'],
                  'overdue_n 1: owed as soon as due -- hero4k (30 min) and town (15 min) both, and no scene frame fits')
    # a slow render (200 s): 130 s under slot_s cannot hold the 150-s camera with or without scenes -> no scene frame,
    # and the slot is planned under budget_s alone, as a slot without a director is
    slow = plan(state(60), spent=200)
    t.assertEqual((slow[0], sorted(slow[2])), (['angled', 'town', 'hero4k'], sorted(order)))
    t.assertEqual(plan(state(30), spent=200)[0], ['angled'] + order + ['town'], 'not owed yet: the scenes, inside slot_s')
    # without scene cameras nothing here applies: the plan a tl.conf without a director gets
    t.assertEqual(TL.plan_views(cfg, state(60), NOW, {}, 690, 120, pair=('angled',), slot_s=360),
                  TL.plan_views(cfg, state(60), NOW, {}, 690, 120, pair=('angled',)))

    # ---- A SIMULATED DAY of the template's cameras, every camera active, TWO scenes live in every slot, 120 s of
    # snapshot + render in every slot (Codex r1's numbers)
    dcT = D.dconf(CONF)

    def scenes(cams_, now):
        st = D.continuity(None, [cl('surface', [(10 * k, 0)], 100 - k) for k in range(2)], [], now.timestamp(), dcT)
        for x in st['scenes']:
            x['id'] = 'sfixed' + x['id'][-1]
        c, o = D.scene_cameras(st['scenes'], dcT, TL.follow_camera)
        return D.apply_cameras(cams_, dcT, c), o, dcT['scene_budget_s'], dcT['slot_s']

    def longest_gap_min(day, v):
        at = [k for k, views in enumerate(day) if v in views]
        if not at:
            return float('inf')
        return 15 * max([at[0]] + [b - a for a, b in zip(at, at[1:])] + [len(day) - 1 - at[-1]])
    day = simulate_day(TL, CONF, scenes, spent=120, measured=True)
    costs = [cost(v) for v in day]
    t.assertTrue(all('angled' in v for v in day), 'the pair is in every slot')
    t.assertEqual(sum(1 for v in day if 'topdown' in v), 24, 'and its hourly half on every hour')
    t.assertTrue(all(c + 120 <= dcT['slot_s'] for c in costs), f'no slot plans more than slot_s (max {max(costs) + 120} s)')
    t.assertLessEqual(longest_gap_min(day, 'hero4k'), 60, 'hero4k (every 30 min): never more than 60 min between frames')
    # every other fixed camera, idle-only or not: never more than overdue_n (2) of its intervals between frames
    interval = {'town': 15, 'expeditions': 30, 'hero4k': 30, 'iso': 60, 'grounds': 120, 'patina': 360}
    live = sorted(v for v, c in CONF['cameras'].items() if v not in TL.VIEWS and not c.get('off') and not c.get('event_only')
                  and v != 'project4k')
    t.assertEqual(live, sorted(interval), 'denominator: every fixed camera of the template that the slot can schedule')
    gaps = {v: longest_gap_min(day, v) for v in live}
    for v in live:
        t.assertLessEqual(gaps[v], 2 * interval[v], f'{v}: longest gap {gaps[v]} min > 2 x {interval[v]} ({gaps})')
    t.assertEqual(gaps['hero4k'], 60)
    t.assertEqual(longest_gap_min(day, 'project4k'), float('inf'), 'project4k is replaced while a scene camera is planned (by design)')
    n_scene = sum(1 for views in day for v in views if v.startswith('scene-'))
    t.assertGreaterEqual(n_scene, 96, f'positive control: the scenes are still filmed ({n_scene} scene frames in 96 slots)')
    # the same day with a slow render (200 s in every slot): still bounded; a slot with a scene frame is inside slot_s
    slow_day = simulate_day(TL, CONF, scenes, spent=200, measured=True)
    t.assertLessEqual(longest_gap_min(slow_day, 'hero4k'), 60)
    t.assertTrue(all('angled' in v for v in slow_day))
    for views in slow_day:
        if any(v.startswith('scene-') for v in views):
            t.assertLessEqual(cost(views) + 200, dcT['slot_s'], views)
        else:
            t.assertLessEqual(cost(views) + 200, CONF['budget_s'], views)
    t.assertGreater(sum(1 for views in slow_day for v in views if v.startswith('scene-')), 60, 'and scenes are still filmed')


def longest_gap_slots(day, hit):
    """The longest run of slots between two slots where hit(views) holds (the day's start and end count as edges)."""
    at = [k for k, views in enumerate(day) if hit(views)]
    if not at:
        return float('inf')
    return max([at[0]] + [b - a for a, b in zip(at, at[1:])] + [len(day) - 1 - at[-1]])


def check_owed_cameras_do_not_starve_the_scenes(t, M):
    """Codex r2: three ~210-s cameras on 15-min intervals are owed in turn for ever. The scenes get a bounded wait."""
    D, TL = M['D'], M['TL']
    has_scene = lambda views: any(v.startswith('scene-') for v in views)
    cam = lambda **kw: dict({'x': 0.5, 'y': 70, 'z': 0.5, 'distance': 95, 'rotation': 0.0, 'angle': 0.0, 'ortho': 1,
                             'mode': 'flat', 'fov': None}, **kw)
    dcA = D.dconf({})

    def scenes(cams_, now):
        st = D.continuity(None, [cl('surface', [(10 * k, 0)], 100 - k) for k in range(2)], [], now.timestamp(), dcA)
        for x in st['scenes']:
            x['id'] = 'sfixed' + x['id'][-1]
        c, o = D.scene_cameras(st['scenes'], dcA, TL.follow_camera)
        return D.apply_cameras(cams_, dcA, c), o, dcA['scene_budget_s'], dcA['slot_s']
    for heavy in (False, True):
        big = lambda: cam(est_s=210, interval_min=15, idle_min=15, **({'heavy': True} if heavy else {}))
        cfg = {'cameras': {'topdown': cam(), 'angled': cam(), 'bigA': big(), 'bigB': big(), 'bigC': big()},
               'pair_hourly': ['topdown'], 'capture_min': 15, 'budget_s': 690, 'interval_min': 15}
        day = simulate_day(TL, cfg, scenes, spent=120, measured=True)
        cost = lambda views: sum(210 if v.startswith('big') else 40 if v.startswith('scene-') else 30 for v in views)
        n_scene = sum(1 for views in day for v in views if v.startswith('scene-'))
        t.assertGreater(n_scene, 0, f'heavy={heavy}: scene frames are shot at all (none before the fix)')
        runs, run = [], 0
        for views in day:
            run = 0 if has_scene(views) else run + 1
            runs.append(run)
        t.assertLessEqual(max(runs), 2, f'heavy={heavy}: never more than scene_wait_slots (2) slots in a row without a scene frame')
        t.assertLessEqual(longest_gap_slots(day, has_scene) * 15, 45, 'so at most 45 min between scene frames')
        t.assertEqual(max(runs), 2, 'positive control: the owed cameras do take two slots in a row')
        for v in ('bigA', 'bigB', 'bigC'):
            gap = longest_gap_slots(day, lambda views, v=v: v in views)
            t.assertLessEqual(gap, 5, f'heavy={heavy}: {v} waits at most G + ceil(G / 2) = 5 slots (75 min), G = 3 cameras taking '
                              f'turns; got {gap}')
            t.assertGreaterEqual(sum(1 for views in day if v in views), 96 // 5, f'{v} is still filmed')
        t.assertTrue(all('angled' in views for views in day), 'the pair is in every slot')
        t.assertEqual(sum(1 for views in day if 'topdown' in views), 24)
        t.assertTrue(all(cost(views) + 120 <= 690 for views in day), 'no slot above budget_s')
        t.assertTrue(all(cost(views) + 120 <= 360 for views in day if has_scene(views)), 'a slot with a scene frame is inside slot_s')
        t.assertTrue(any(cost(views) + 120 > 360 for views in day), 'positive control: slots WITHOUT a scene frame use budget_s')
    # one slot, by hand: 360 - 120 - 30 = 210 s; bigA is owed and takes all of it
    cfgu = {'cameras': {'topdown': cam(), 'angled': cam(), 'bigA': cam(est_s=210, interval_min=15, idle_min=15)}, 'interval_min': 15}
    dc, (sc, order) = scene_cams(D, TL, 2)
    rcfg = dict(cfgu, cameras=D.apply_cameras(cfgu['cameras'], dc, sc))
    st = {'angled': {'frame_s': 30}, 'bigA': {'frame_s': 210, 'last': '2026-11-16T12:15:00Z'}}
    plan = lambda wait, **kw: TL.plan_views(dict(rcfg, **kw), st, NOW, {}, 690, 120, pair=('angled',), first=order,
                                            first_budget_s=90, slot_s=360, first_wait=wait)
    t.assertEqual((plan(0)[0], plan(1)[0]), (['angled', 'bigA'], ['angled', 'bigA']), 'the owed camera first: no scene frame fits')
    views, why, deferred = plan(2)
    t.assertEqual((views, deferred), (['angled'] + order, ['bigA']),
                  'two slots without a scene frame: ONE is set aside first; bigA no longer fits under slot_s and waits a slot; '
                  'the second scene frame takes seconds nothing else can use')
    t.assertIn('no scene frame for 2 slots', why[order[0]])
    t.assertEqual(plan(1, director={'scene_wait_slots': 1})[0], ['angled'] + order, 'the knob')
    t.assertEqual(plan(3, director={'scene_wait_slots': 5})[0], ['angled', 'bigA'])
    # a slow render: the owed camera cannot fit under slot_s at all (the scene-less, budget_s slot) -- unless a scene is owed
    slow = lambda wait: TL.plan_views(rcfg, st, NOW, {}, 690, 150, pair=('angled',), first=order, first_budget_s=90,
                                      slot_s=360, first_wait=wait)[0]
    t.assertEqual((slow(1), slow(2)), (['angled', 'bigA'], ['angled'] + order))
    # the scene frame set aside is still one that fits: with 30 s left under slot_s there is none to set aside
    t.assertEqual(TL.plan_views(rcfg, st, NOW, {}, 690, 300, pair=('angled',), first=order, first_budget_s=90, slot_s=360,
                                first_wait=9)[0], ['angled', 'bigA'])
    # the scene frame set aside counts against slot_s like any other: a 180-s camera does not slip in beside it
    cfgm = {'cameras': {'topdown': cam(), 'angled': cam(), 'mid': cam(est_s=180, interval_min=15, idle_min=15)}, 'interval_min': 15}
    stm = {'angled': {'frame_s': 30}, 'mid': {'frame_s': 180, 'last': '2026-11-16T12:29:00Z'}}
    for wait in (0, 2):
        vm = TL.plan_views(dict(cfgm, cameras=D.apply_cameras(cfgm['cameras'], dc, sc)), stm, NOW, {}, 690, 120, pair=('angled',),
                           first=order, first_budget_s=40, slot_s=360, first_wait=wait)
        t.assertEqual((vm[0], sorted(vm[2])), (['angled', order[0]], sorted(['mid', order[1]])), f'wait {wait}: 30 + 40 + 120 s; 170 left')
    # without scene cameras the count is not even read
    t.assertEqual(TL.plan_views(cfgu, st, NOW, {}, 690, 120, pair=('angled',), first_wait=9),
                  TL.plan_views(cfgu, st, NOW, {}, 690, 120, pair=('angled',)))
    # the director's count: one more for a slot that offered scene cameras and shot none; back to 0 otherwise
    base = {'scenes': [{'id': 'sa', 'shots': 0}], 'scene_wait': 1}
    t.assertEqual(D.note_shots(base, {}, TNOW, wanted=2)['scene_wait'], 2)
    t.assertEqual(D.note_shots(base, {'sa': 30.0}, TNOW, wanted=2)['scene_wait'], 0, 'a scene frame was shot')
    t.assertEqual(D.note_shots(base, {}, TNOW, wanted=0)['scene_wait'], 0, 'no scene camera was live: nothing is waiting')
    t.assertEqual(D.note_shots({'scenes': []}, {}, TNOW, wanted=1)['scene_wait'], 1)
    # ---- the live template (Codex r1's day: two scenes live, 120 s spent): the reservation does not move hero4k
    dcT = D.dconf(CONF)

    def scenesT(cams_, now):
        stT = D.continuity(None, [cl('surface', [(10 * k, 0)], 100 - k) for k in range(2)], [], now.timestamp(), dcT)
        for x in stT['scenes']:
            x['id'] = 'sfixed' + x['id'][-1]
        c, o = D.scene_cameras(stT['scenes'], dcT, TL.follow_camera)
        return D.apply_cameras(cams_, dcT, c), o, dcT['scene_budget_s'], dcT['slot_s']
    costT = lambda views: sum(150 if v.endswith('4k') else 40 if v.startswith('scene-') else 30 for v in views)
    for spent in (120, 200):
        dayT = simulate_day(TL, CONF, scenesT, spent=spent, measured=True)
        t.assertLessEqual(longest_gap_slots(dayT, lambda views: 'hero4k' in views) * 15, 60, f'spent {spent}: hero4k within 60 min')
        t.assertTrue(all(costT(views) + spent <= dcT['slot_s'] for views in dayT if has_scene(views)),
                     f'spent {spent}: a slot with a scene frame never exceeds slot_s')
        t.assertLessEqual(longest_gap_slots(dayT, has_scene), 3, 'and its scenes never wait more than 45 min either')


def check_the_scene_wait_count_through_the_wiring(t, M):
    """Three real slots: two owed 210-s cameras take the first two; the third shoots a scene frame first."""
    root, cfg = slot_root({'slot_s': 275}, deaths=False)
    try:
        cam = cfg['cameras']['angled']
        cfg['cameras'] = {'topdown': cam, 'angled': cam, 'bigA': dict(cam, est_s=210, interval_min=15, idle_min=15),
                          'bigB': dict(cam, est_s=210, interval_min=15, idle_min=15)}
        with open(os.path.join(root, 'logs', 'views.json'), 'w') as f:
            json.dump({'topdown': {'frame_s': 30}, 'angled': {'frame_s': 30}}, f)        # the pair: 60 s; 215 s are left
        waits, shots = [], []
        for k in range(3):
            now = NOW + dt.timedelta(minutes=15 * k)
            shot, hb = run_slot(M, cfg, now, now.strftime('%Y%m%dT%H%MZ'))
            st = jload(os.path.join(root, 'logs', 'views.json'))
            for v in ('bigA', 'bigB'):                      # the fake browser reports 31 s a frame: keep the cameras at 210 s
                if v in st:
                    st[v]['frame_s'] = 210
            for v in ('topdown', 'angled'):
                st[v]['frame_s'] = 30
            with open(os.path.join(root, 'logs', 'views.json'), 'w') as f:
                json.dump(st, f)
            shots.append([v.split('-')[0] for v in shot])
            waits.append(jload(os.path.join(root, 'logs', 'scenes.json')).get('scene_wait'))
        t.assertEqual(shots, [['topdown', 'angled', 'bigA'], ['topdown', 'angled', 'bigB'], ['topdown', 'angled', 'scene']],
                      'bigA then bigB are owed and take the 215 s; in the third slot the scene goes first (bigA, owed again, waits)')
        t.assertEqual(waits, [1, 2, 0], 'scenes.json counts the slots without a scene frame and starts again with one')
    finally:
        shutil.rmtree(root)


def check_underground_scenes_carry_their_bots_trail(t, M):
    """logs/scenes-slot.json: every underground scene has `trail`, its bots' samples, from the rows already read."""
    D, TL = M['D'], M['TL']
    dc = D.dconf({})
    S = {'Delta': stand(20, 12, -30, 'mine', 20) + stand(5, 66, 5, 'goto', 5, until=TNOW - 1200),
         'Echo': [(TNOW - 3000, 22, 14, -32, 'mine')] + stand(22, 14.26, -32.5, 'mine', 10), 'Alpha': stand(10, 65, 10, 'build_shop', 20)}
    tr = D.trail_of(S, ['Delta', 'Echo', 'Gale'], TNOW - 45 * 60, 300)
    t.assertEqual(sorted(tr), ['Delta', 'Echo', 'Gale'], 'exactly the scene\'s bots: not Alpha, and a bot with no sample is an empty list')
    t.assertEqual((len(tr['Delta']), len(tr['Echo']), tr['Gale']), (150, 60, []), 'the 45 minutes only: Echo\'s 50-min-old sample is out')
    t.assertEqual(tr['Echo'][-1], ['2026-11-16T12:44:50Z', 22, 14.3, -32.5, 'mine'], '[t, x, y, z, skill]: UTC seconds, one decimal')
    t.assertEqual(tr['Delta'][0], ['2026-11-16T12:20:00Z', 5, 66, 5, 'goto'], 'all of the bot\'s samples, also those on the surface')
    for b in tr:
        t.assertEqual([p[0] for p in tr[b]], sorted(p[0] for p in tr[b]), 'oldest first')
    few = D.trail_of(S, ['Delta'], TNOW - 45 * 60, 5)['Delta']
    t.assertEqual([p[0][11:19] for p in few], ['12:44:10', '12:44:20', '12:44:30', '12:44:40', '12:44:50'], 'bounded: the NEWEST max_n')
    t.assertEqual(D.trail_of(S, ['Delta'], TNOW - 60, 300)['Delta'][0][0], '2026-11-16T12:44:00Z', 'trail_min')
    # through a whole pass: real log files, read ONCE; only the underground scene carries a trail
    root, cfg = slot_root()
    try:
        reads, real = [], D.read_tail
        with swap(D, read_tail=lambda *a, **k: reads.append(a[0]) or real(*a, **k)):
            res = D.run(cfg, NOW, {'yard': {'box': [8, 8, 16, 16], 'g': 65}}, stamp=STAMP, frame=TL.follow_camera)
        t.assertEqual(len(reads), 5, 'five log files, each read once: the trail costs no extra read')
        slot = jload(os.path.join(root, 'logs', 'scenes-slot.json'))
        t.assertEqual(slot, json.loads(json.dumps(res['slot'])))
        deep = [x for x in slot['scenes'] if x['layer'] != 'surface']
        t.assertEqual(([x['bots'] for x in deep], [sorted(x.get('trail') or {}) for x in deep]), ([['Delta', 'Echo']], [['Delta', 'Echo']]))
        t.assertFalse([x for x in slot['scenes'] if x['layer'] == 'surface' and 'trail' in x], 'no trail on a surface scene')
        t.assertEqual(len([x for x in slot['scenes'] if x['layer'] == 'surface']), 2, 'positive control: there are surface scenes')
        trail = deep[0]['trail']['Delta']
        t.assertEqual((len(trail), trail[0], trail[-1]), (60, ['2026-11-16T12:15:29Z', 20, 12, -30, 'mine'],
                                                         ['2026-11-16T12:44:59Z', 20, 12, -30, 'mine']),
                      'one sample per 30-s skill row of the 30 minutes, each where and when the skill ended')
        with open(os.path.join(root, 'logs', f'scenes-{DAY}.jsonl')) as f:
            line = f.read()
        t.assertNotIn('trail', line, 'the day log does not carry the trails')
        t.assertEqual(json.loads(line), D.without_trails(slot))
        size = os.path.getsize(os.path.join(root, 'logs', 'scenes-slot.json'))
        t.assertLess(size, 20_000, f'{size} bytes for 2 bots x 60 samples')
        capped = D.run(dict(cfg, director=dict(cfg['director'], trail_max=7, trail_min=10)), NOW, {}, stamp=STAMP,
                       frame=TL.follow_camera, write=False)['slot']
        got = [x for x in capped['scenes'] if x['layer'] != 'surface'][0]['trail']
        t.assertEqual({b: len(v) for b, v in got.items()}, {'Delta': 7, 'Echo': 7}, 'trail_max from tl.conf')
        ten = D.run(dict(cfg, director=dict(cfg['director'], trail_min=10)), NOW, {}, stamp=STAMP, frame=TL.follow_camera,
                    write=False)['slot']
        t.assertEqual(len([x for x in ten['scenes'] if x['layer'] != 'surface'][0]['trail']['Delta']), 20, 'trail_min from tl.conf')
        long = D.run(dict(cfg, director=dict(cfg['director'], trail_min=600)), NOW, {}, stamp=STAMP, frame=TL.follow_camera,
                     write=False)['slot']
        t.assertEqual(len([x for x in long['scenes'] if x['layer'] != 'surface'][0]['trail']['Delta']), 60,
                      'a trail_min beyond the window gives what the pass holds, no more')
    finally:
        shutil.rmtree(root)
    # an underground EVENT scene carries its bot's trail too
    rows = {'Onyx': [row(D, TNOW - 600 + 20 * k, (3, 11, 3), '_tick') for k in range(20)] + [row(D, TNOW - 60, (3, 11, 3), '_death', 'lava')]}
    res = D.run({'root': tempfile.gettempdir(), 'director': {'on': True}}, NOW, {}, stamp=STAMP, write=False, rows=(rows, {}))
    ev = res['slot']['scenes'][0]
    t.assertEqual((ev['kind'], ev['layer'], sorted(ev.get('trail') or {}), len((ev.get('trail') or {}).get('Onyx') or ())),
                  ('death', 'deep', ['Onyx'], 21))


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
        t.assertIn('TypeError', hb.get('director_error') or '', 'and the heartbeat row says why')
        t.assertNotIn('director', hb)
        t.assertFalse(os.path.exists(os.path.join(root, 'logs', 'scenes.json')))
    finally:
        shutil.rmtree(root)
    # the director failing AFTER the frames are published (its state cannot be saved): the slot still closes
    root, cfg = slot_root()

    def boom(*a, **k):
        raise OSError('disk full')
    try:
        try:
            with swap(M['D'], finish=boom):
                shot, hb = run_slot(M, cfg)
        except Exception as e:
            t.fail(f'a director error after the capture crashed the slot: {type(e).__name__}: {e}')
        t.assertEqual((hb['ok'], hb.get('director_error')), (True, 'OSError: disk full'))
        t.assertEqual(len((hb.get('director') or {}).get('shot') or ()), 2, 'the summary of what was shot is still there')
        t.assertIn('town', jload(os.path.join(root, 'logs', 'views.json')), 'the schedule state is saved all the same')
        t.assertEqual(len([v for v in shot if v.startswith('scene-')]), 2)
    finally:
        shutil.rmtree(root)


def off_shot(M):
    """What the slot of slot_root() shoots with the director off: the plan every fenced failure must fall back to."""
    root, cfg = slot_root({'on': False})
    try:
        return run_slot(M, cfg)[0]
    finally:
        shutil.rmtree(root)


def fenced(t, M, what, shot, hb, off, root, expect=None):
    """The three things every director failure must leave true, and no scene frame on disk."""
    t.assertEqual(shot, off, f'{what}: the plan is the director-off plan')
    t.assertTrue({'topdown', 'angled'} <= set(shot), f'{what}: the pair is shot')
    t.assertTrue(hb['ok'], f'{what}: the slot is a good slot')
    err = hb.get('director_error')
    t.assertTrue(isinstance(err, str) and ': ' in err, f'{what}: the heartbeat row carries director_error (got {err!r})')
    if expect:
        t.assertIn(expect, err, what)
    t.assertNotIn('director', hb, f'{what}: no director summary of a plan that was not used')
    t.assertFalse([d for d in os.listdir(os.path.join(root, 'frames')) if d.startswith('scene-')], f'{what}: no scene frame')
    for v in ('topdown', 'angled', 'town', 'grounds'):
        t.assertTrue(os.path.isfile(os.path.join(root, 'frames', v, '20261116', STAMP + '.png')), f'{what}: {v} has its frame')


def check_every_director_entry_point_is_fenced(t, M):
    """FAULT INJECTION: each call tl_showcase makes into tl_director raises in turn, and each value the director hands
    the slot is made unusable in turn. The slot is planned and shot as with the director off, every time."""
    D = M['D']
    off = off_shot(M)
    t.assertEqual(off, ['topdown', 'angled', 'grounds', 'town'], 'the director-off plan of this slot')
    real = {k: getattr(D, k) for k in ('run', 'apply_cameras', 'summary', 'finish')}

    def boom(*a, **k):
        raise RuntimeError('injected')

    def tweak(fn):
        """D.run, its result changed by fn before tl_showcase sees it."""
        def run(*a, **k):
            res = real['run'](*a, **k)
            fn(res)
            return res
        return run

    def cam0(res):
        return res['cameras'][res['first'][0]]
    faults = [
        # ---- every entry point raising
        ('tl_director.run raises', {'run': boom}, 'RuntimeError: injected'),
        ('tl_director.apply_cameras raises', {'apply_cameras': boom}, 'RuntimeError: injected'),
        ('tl_director.summary raises', {'summary': boom}, 'RuntimeError: injected'),
        ('tl_director.run raises a KeyError', {'run': lambda *a, **k: {}['missing']}, 'KeyError'),
        # ---- run() returning something unusable
        ('run returns None', {'run': lambda *a, **k: None}, 'DirectorRefused'),
        ('run returns a list', {'run': lambda *a, **k: [1, 2]}, 'DirectorRefused'),
        ('run returns an empty object', {'run': lambda *a, **k: {}}, 'DirectorRefused'),
        ('run reports a repaired state', {'run': tweak(lambda r: r.update(repaired=['cam_s is not usable; reset']))}, 'repaired'),
        # ---- a scene camera the slot cannot use (the r3 blocker: its cost was the string "broken")
        ('a scene camera costs "broken"', {'run': tweak(lambda r: cam0(r).update(est_s='broken'))}, 'est_s'),
        ('a scene camera costs NaN', {'run': tweak(lambda r: cam0(r).update(est_s=float('nan')))}, 'est_s'),
        ('a scene camera costs 1e12 s', {'run': tweak(lambda r: cam0(r).update(est_s=1e12))}, 'est_s'),
        ('a scene camera at x = NaN', {'run': tweak(lambda r: cam0(r).update(x=float('nan')))}, 'x ='),
        ('a scene camera at x = "12"', {'run': tweak(lambda r: cam0(r).update(x='12'))}, 'x ='),
        ('a scene camera 1e9 blocks away', {'run': tweak(lambda r: cam0(r).update(distance=1e9))}, 'distance'),
        ('a scene camera with no y', {'run': tweak(lambda r: cam0(r).pop('y'))}, 'y ='),
        ('a scene camera 20000 px wide', {'run': tweak(lambda r: cam0(r).update(width=20000))}, 'width'),
        ('a scene camera marked heavy', {'run': tweak(lambda r: cam0(r).update(heavy=True))}, 'not usable'),
        ('a scene camera with no scene block', {'run': tweak(lambda r: cam0(r).pop('scene'))}, 'not usable'),
        ('a scene camera whose bots are a number', {'run': tweak(lambda r: cam0(r)['scene'].update(bots=5))}, 'not usable'),
        ('a scene camera that is a string', {'run': tweak(lambda r: r['cameras'].update({r['first'][0]: 'cam'}))}, 'DirectorRefused'),
        ('a camera named like a path', {'run': tweak(lambda r: (r['cameras'].update({'scene-../../x': cam0(r)}),
                                                              r['first'].append('scene-../../x')))}, 'DirectorRefused'),
        ('a "scene" camera named angled', {'run': tweak(lambda r: (r['cameras'].update(angled=cam0(r)), r['first'].append('angled')))},
         'DirectorRefused'),
        # ---- planning inputs
        ('first names a camera that is not there', {'run': tweak(lambda r: r['first'].append('scene-ghost'))}, 'do not match'),
        ('first is a number', {'run': tweak(lambda r: r.update(first=7))}, 'do not match'),
        ('cameras is a list', {'run': tweak(lambda r: r.update(cameras=[]))}, 'do not match'),
        ('scene_budget_s is "ninety"', {'run': tweak(lambda r: r['dc'].update(scene_budget_s='ninety'))}, 'scene_budget_s'),
        ('slot_s is NaN', {'run': tweak(lambda r: r['dc'].update(slot_s=float('nan')))}, 'slot_s'),
        ('slot_s is negative', {'run': tweak(lambda r: r['dc'].update(slot_s=-5))}, 'slot_s'),
        ('scene_wait is "two"', {'run': tweak(lambda r: r['state'].update(scene_wait='two'))}, 'scene_wait'),
        ('scene_wait is NaN', {'run': tweak(lambda r: r['state'].update(scene_wait=float('nan')))}, 'scene_wait'),
        ('dc is gone', {'run': tweak(lambda r: r.pop('dc'))}, 'DirectorRefused'),
        # ---- apply_cameras handing back something else than it was given
        ('apply_cameras moves a fixed camera', {'apply_cameras': lambda cams, dc, sc: dict(real['apply_cameras'](cams, dc, sc),
                                                                                         town=dict(cams['town'], x=999))}, 'town'),
        ('apply_cameras loses a fixed camera', {'apply_cameras': lambda cams, dc, sc: {k: v for k, v in real['apply_cameras'](
            cams, dc, sc).items() if k != 'grounds'}}, 'added or lost'),
        ('apply_cameras returns None', {'apply_cameras': lambda cams, dc, sc: None}, 'added or lost'),
        ('summary cannot be written as JSON', {'summary': lambda res: {'ms': float('nan')}}, 'ValueError'),
        # ---- Codex r4: a summary that is valid JSON and no object, or an object that cannot be written
        ('summary is a list', {'summary': lambda res: ['broken']}, 'not an object'),
        ('summary is a string', {'summary': lambda res: 'broken'}, 'not an object'),
        ('summary is None', {'summary': lambda res: None}, 'not an object'),
        ('summary is a number', {'summary': lambda res: 5}, 'not an object'),
        ('summary holds a set', {'summary': lambda res: {'cameras': {1, 2}}}, 'TypeError'),
        ('summary holds an object()', {'summary': lambda res: {'x': object()}}, 'TypeError'),
        ('summary has a key that is no text', {'summary': lambda res: {(1, 2): 'x'}}, 'TypeError'),
    ]
    for what, patch, expect in faults:
        root, cfg = slot_root()
        try:
            try:
                with swap(D, **patch):
                    shot, hb = run_slot(M, cfg)
            except Exception as e:
                t.fail(f'{what}: the director took the slot down: {type(e).__name__}: {e}')
            fenced(t, M, what, shot, hb, off, root, expect)
        finally:
            shutil.rmtree(root)
    t.assertEqual(len(faults), 42, 'denominator: 42 injected faults')
    # ---- tl_director.py is not there to import; a tl.conf setting the plan cannot use
    for what, extra, module, expect in (('tl_director cannot be imported', None, None, 'Error'),
                                        ('director.overdue_n is "often"', {'overdue_n': 'often'}, 'under test', 'ValueError'),
                                        ('director.scene_wait_slots is a list', {'scene_wait_slots': [2]}, 'under test', 'TypeError'),
                                        ('director.weights is a word', {'weights': 'heavy'}, 'under test', 'Error'),
                                        ('director.scene_camera is a number', {'scene_camera': 5}, 'under test', 'Error'),
                                        ('director.tail_bytes is a word', {'tail_bytes': 'all'}, 'under test', 'Error')):
        root, cfg = slot_root(extra)
        try:
            try:
                shot, hb = run_slot(M, cfg, module=module)
            except Exception as e:
                t.fail(f'{what}: the director took the slot down: {type(e).__name__}: {e}')
            fenced(t, M, what, shot, hb, off, root, expect)
        finally:
            shutil.rmtree(root)
    # ---- AFTER the capture (the frames are on disk; the plan cannot be taken back): the slot still closes
    for what, patch in (('tl_director.finish raises', {'finish': boom}),
                        ('finish returns, the state cannot be saved', {'save_state': boom})):
        root, cfg = slot_root()
        try:
            try:
                with swap(D, **(patch if 'finish' in patch else {'finish': lambda *a, **k: (_ for _ in ()).throw(OSError('no space'))})):
                    shot, hb = run_slot(M, cfg)
            except Exception as e:
                t.fail(f'{what}: the director took the slot down: {type(e).__name__}: {e}')
            t.assertTrue({'topdown', 'angled', 'town'} <= set(shot), f'{what}: the pair and the fixed camera are shot')
            t.assertTrue(hb['ok'] and isinstance(hb.get('director_error'), str), what)
            t.assertTrue(jload(os.path.join(root, 'logs', 'views.json')).get('town', {}).get('last'), 'the slot\'s own state is saved')
        finally:
            shutil.rmtree(root)
    # positive control: nothing injected -> the director's plan, no director_error
    root, cfg = slot_root()
    try:
        shot, hb = run_slot(M, cfg)
        t.assertEqual(([v.split('-')[0] for v in shot], 'director_error' in hb), (['topdown', 'angled', 'scene', 'scene', 'town'], False))
    finally:
        shutil.rmtree(root)


CORRUPT_STATES = [                     # (what, the bytes of logs/scenes.json or None for a directory in its place)
    ('cam_s is the string "broken" (Codex r3)', b'{"cam_s": "broken"}'),
    ('cam_s is NaN', b'{"cam_s": NaN}'),
    ('cam_s is 1e999', b'{"cam_s": 1e999}'),
    ('cam_s is negative', b'{"cam_s": -3}'),
    ('cam_s is true', b'{"cam_s": true}'),
    ('cam_s is a week', b'{"cam_s": 604800}'),
    ('scene_wait is a string', b'{"scene_wait": "2"}'),
    ('scene_wait is 2.5', b'{"scene_wait": 2.5}'),
    ('scene_wait is a 400-digit number', b'{"scene_wait": ' + b'9' * 400 + b'}'),
    ('t is a number', b'{"t": 5}'),
    ('scenes is an object', b'{"scenes": {"a": 1}}'),
    ('a scene is a number', b'{"scenes": [5]}'),
    ('a scene id is a number', b'{"scenes": [{"id": 5}]}'),
    ('a scene id is a path', b'{"scenes": [{"id": "../../etc", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70]}]}'),
    ('a scene box is text', b'{"scenes": [{"id": "sx", "layer": "surface", "box": "0,0,9,9", "y": [64, 70]}]}'),
    ('a scene box holds NaN', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, NaN, 9], "y": [64, 70]}]}'),
    ('a scene box is beyond the world', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 1e15, 9], "y": [64, 70]}]}'),
    ('a scene box is inside out', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [9, 0, 0, 9], "y": [64, 70]}]}'),
    ('a scene y is 1e30', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 1e30]}]}'),
    ('a scene layer is unknown', b'{"scenes": [{"id": "sx", "layer": "sky", "box": [0, 0, 9, 9], "y": [64, 70]}]}'),
    ('a scene score is Infinity', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70], "score": Infinity}]}'),
    ('a scene score is text', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70], "score": "9"}]}'),
    ('a scene bots is a number', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70], "bots": 3}]}'),
    ('a scene caption is a list', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70], "caption": [1]}]}'),
    ('a scene time is nonsense', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70], "last_active": "soon"}]}'),
    ('a scene cells is text', b'{"scenes": [{"id": "sx", "layer": "surface", "box": [0, 0, 9, 9], "y": [64, 70], "cells": "0,0"}]}'),
    ('the tracker is a list', b'{"bots": [1, 2]}'),
    ('a tracker position is text', b'{"bots": {"Alpha": {"pos": "here", "since": 1, "last": 2}}}'),
    ('seen is a number', b'{"seen": 9}'),
    ('the file is a list', b'[]'),
    ('the file is a string', b'"scenes"'),
    ('the file is null', b'null'),
    ('truncated JSON', b'{"scenes": [{"id": "s2026'),
    ('an empty file', b''),
    ('binary junk', bytes(range(256))),
    ('a directory in its place', None),
]


def check_a_corrupt_state_file_never_reaches_the_slot(t, M):
    """logs/scenes.json holding anything at all: the slot is the director-off slot, the heartbeat says so once, the
    file is rewritten clean by the same pass, and the NEXT slot is an ordinary director slot."""
    D = M['D']
    off = off_shot(M)
    for what, content in CORRUPT_STATES:
        root, cfg = slot_root()
        path = os.path.join(root, 'logs', 'scenes.json')
        try:
            if content is None:
                os.makedirs(path)
            else:
                with open(path, 'wb') as f:
                    f.write(content)
            try:
                shot, hb = run_slot(M, cfg)
            except Exception as e:
                t.fail(f'{what}: a corrupt scenes.json took the slot down: {type(e).__name__}: {e}')
            fenced(t, M, what, shot, hb, off, root, None if content is None else 'scenes.json')
            if content is None:
                continue                     # a directory cannot be rewritten: the error stays until someone removes it
            state, problems = D.read_state(cfg)
            t.assertEqual(problems, [], f'{what}: the pass rewrote the file clean')
            t.assertTrue(state['scenes'], f'{what}: and the clean state holds this slot\'s scenes')
            shot2, hb2 = run_slot(M, cfg, NOW + dt.timedelta(minutes=15), '20261116T1300Z')
            t.assertTrue(any(v.startswith('scene-') for v in shot2) and 'director_error' not in hb2,
                         f'{what}: the next slot is an ordinary director slot ({shot2}, {hb2.get("director_error")})')
        finally:
            shutil.rmtree(root)
    t.assertEqual(len(CORRUPT_STATES), 36, 'denominator: 36 corrupt states')
    # ---- the hand-off file and the day log are WRITTEN, never read back: junk in them is simply replaced ...
    for what, content in (('wrong types', b'{"scenes": 5, "t": []}'), ('NaN', b'{"scenes": [{"score": NaN}]}'),
                          ('truncated JSON', b'{"scenes": [{"id"'), ('an empty file', b'')):
        root, cfg = slot_root()
        try:
            with open(os.path.join(root, 'logs', 'scenes-slot.json'), 'wb') as f:
                f.write(content)
            with open(os.path.join(root, 'logs', f'scenes-{DAY}.jsonl'), 'wb') as f:
                f.write(content + b'\n')
            shot, hb = run_slot(M, cfg)
            t.assertTrue(any(v.startswith('scene-') for v in shot) and 'director_error' not in hb, f'scenes-slot.json {what}')
            slot, problems = D.clean_slot(jload(os.path.join(root, 'logs', 'scenes-slot.json')))
            t.assertEqual((problems, len(slot['scenes'])), ([], 3), f'scenes-slot.json {what}: rewritten whole')
        finally:
            shutil.rmtree(root)
    # ... and a directory in the place of either cannot be written: the slot is the director-off slot
    for name in ('scenes-slot.json', f'scenes-{DAY}.jsonl'):
        root, cfg = slot_root()
        try:
            os.makedirs(os.path.join(root, 'logs', name))
            try:
                shot, hb = run_slot(M, cfg)
            except Exception as e:
                t.fail(f'a directory in the place of {name} took the slot down: {type(e).__name__}: {e}')
            fenced(t, M, f'a directory in the place of {name}', shot, hb, off, root, 'Error')
        finally:
            shutil.rmtree(root)


def check_what_is_read_back_is_checked(t, M):
    """clean_state / clean_scene / clean_slot: every persisted value is a finite number in its range, the right type,
    a time that parses -- or it is reset / dropped, and the problem is named."""
    D, TL = M['D'], M['TL']
    num = D._num
    t.assertEqual([num(v, 0, 10) for v in (5, 5.5, 0, 10)], [5, 5.5, 0, 10])
    t.assertEqual([num(v, 0, 10) for v in (True, '5', None, [5], float('nan'), float('inf'), -1, 11, 10 ** 400)], [None] * 9,
                  'a bool, text, null, a list, NaN, Infinity, out of range, a number too big for a float')
    good = {'id': 'sx', 'layer': 'surface', 'kind': 'activity', 'box': [0, 0, 9, 9], 'y': [64, 70], 'g': 66, 'score': 12.5,
            'fresh': 3, 'peak': 20, 'shots': 2, 'bots': ['Alpha'], 'cells': [[0, 0]], 'caption': '1 bot building', 'project': None,
            'skill': 'build', 'opened': '2026-11-16T12:00:00Z', 'last_active': '2026-11-16T12:30:00Z', 'until': None,
            'last_shot': None, 'active': True}
    bad = []
    t.assertEqual((D.clean_scene(dict(good, extra='x'), bad), bad), (good, []), 'a sound scene comes back as it was; unknown keys go')
    for what, change, kept in (('score', {'score': float('nan')}, {'score': 0}), ('score', {'score': -1}, {'score': 0}),
                               ('peak', {'peak': 1e300}, {'peak': 0}), ('shots', {'shots': 1.5}, {'shots': 0}),
                               ('g', {'g': 'high'}, {'g': 67}), ('bots', {'bots': ['Alpha', 7]}, {'bots': []}),
                               ('bots', {'bots': 'Alpha'}, {'bots': []}), ('cells', {'cells': [[0]]}, {'cells': []}),
                               ('cells', {'cells': [[0, 0.5]]}, {'cells': []}), ('caption', {'caption': 5}, {'caption': ''}),
                               ('caption', {'caption': 'x' * 500}, {'caption': ''}), ('skill', {'skill': 5}, {'skill': None}),
                               ('until', {'until': 'later'}, {'until': None}), ('opened', {'opened': 20261116}, {'opened': None}),
                               ('active', {'active': 'yes'}, {'active': False})):
        bad = []
        got = D.clean_scene(dict(good, **change), bad)
        t.assertEqual((got, len(bad), what in bad[0] if bad else None), (dict(good, **kept), 1, True), f'{change}: reset and named')
    for change in ({'id': 'a/b'}, {'id': ''}, {'id': 5}, {'layer': 'sky'}, {'kind': 'party'}, {'box': [0, 0, 4e7, 9]}, {'box': [0, 0, 9]},
                   {'box': [9, 0, 0, 9]}, {'box': [0, 0, '9', 9]}, {'y': [70, 64]}, {'y': [64, float('inf')]}, {'y': None}):
        bad = []
        t.assertEqual((D.clean_scene(dict(good, **change), bad), len(bad)), (None, 1), f'{change}: a scene that cannot be placed is dropped')
    t.assertEqual(D.clean_scene({k: good[k] for k in ('id', 'layer', 'box', 'y')}, bad := []),
                  dict(good, kind='activity', g=67, score=0, fresh=0, peak=0, shots=0, bots=[], cells=[], caption='', skill=None,
                       opened=None, last_active=None, active=False), 'missing optional values take their defaults ...')
    t.assertEqual(bad, [], '... silently: a state written by an older version is not corrupt')
    # the whole state
    sound = {'t': '2026-11-16T12:45:00Z', 'cam_s': 31.0, 'scene_wait': 1, 'seen': ['death:Juno:5'], 'scenes': [good],
             'bots': {'Kite': {'pos': [1, 64, 2.5], 'since': 1794830000.0, 'last': 1794832000.0}}}
    t.assertEqual(D.clean_state(dict(sound, v=1, unknown=5)), (sound, []), 'a sound state: unchanged, no problem')
    t.assertEqual(D.clean_state({}), ({'t': None, 'cam_s': None, 'scene_wait': 0, 'seen': [], 'scenes': [], 'bots': {}}, []))
    for change, key, value in (({'cam_s': 'broken'}, 'cam_s', None), ({'cam_s': float('nan')}, 'cam_s', None), ({'cam_s': 0}, 'cam_s', None),
                               ({'cam_s': 601}, 'cam_s', None), ({'cam_s': True}, 'cam_s', None),
                               ({'scene_wait': -1}, 'scene_wait', 0), ({'scene_wait': '3'}, 'scene_wait', 0),
                               ({'scene_wait': 1.5}, 'scene_wait', 0), ({'t': 'now'}, 't', None), ({'seen': [1]}, 'seen', []),
                               ({'seen': 'x'}, 'seen', []), ({'scenes': 'x'}, 'scenes', []), ({'scenes': [good, good]}, 'scenes', [good]),
                               ({'scenes': [good, 5]}, 'scenes', [good]), ({'bots': 5}, 'bots', {}),
                               ({'bots': {'Kite': {'pos': [1, 2], 'since': 1, 'last': 2}}}, 'bots', {}),
                               ({'bots': {'Kite': {'pos': [1, 2, 3], 'since': 'x', 'last': 2}}}, 'bots', {}),
                               ({'bots': {'Kite': 7}}, 'bots', {})):
        state, problems = D.clean_state(dict(sound, **change))
        t.assertEqual((state[key], len(problems)), (value, 1), f'{change}: reset to its default and named ({problems})')
        t.assertEqual({k: v for k, v in state.items() if k != key}, {k: v for k, v in sound.items() if k != key}, 'the rest is kept')
    for raw in ([], 'x', 5, None):
        t.assertEqual(D.clean_state(raw), ({}, ['scenes.json is not an object']))
    # what a real pass writes reads back with no problem, and as it was written (no rule rejects the director's own output)
    root, cfg = slot_root()
    try:
        run_slot(M, cfg)
        raw = jload(os.path.join(root, 'logs', 'scenes.json'))
        state, problems = D.clean_state(raw)
        t.assertEqual(problems, [])
        t.assertEqual({k: v for k, v in state.items() if k != 'scenes'}, {k: v for k, v in raw.items() if k not in ('v', 'scenes')})
        for r, c in zip(raw['scenes'], state['scenes']):
            t.assertEqual(c, dict(r, until=r.get('until')), 'every scene as it was written (+ an explicit until)')
        t.assertEqual(D.clean_state(state), (state, []), 'and checking it again changes nothing')
        t.assertEqual((len(state['scenes']), state['cam_s'], len(state['bots'])), (3, 31.0, 5), 'positive control: a full state')
        slot_raw = jload(os.path.join(root, 'logs', 'scenes-slot.json'))
        t.assertEqual(D.clean_slot(slot_raw), (slot_raw, []), 'and so does the hand-off file, trails included')
        os.remove(os.path.join(root, 'logs', 'scenes.json'))
        t.assertEqual(D.read_state(cfg), ({}, []), 'no file yet (the first slot ever) is not a problem')
    finally:
        shutil.rmtree(root)
    with tempfile.TemporaryDirectory(prefix='camdir-w-') as d:
        with t.assertRaises(ValueError, msg='a NaN is never written to disk'):
            D._write(os.path.join(d, 'x.json'), {'cam_s': float('nan')})
        t.assertFalse(os.path.exists(os.path.join(d, 'x.json')))
    # only a sane measured cost is remembered
    base = {'scenes': [{'id': 'sa', 'shots': 0}]}
    t.assertEqual([D.note_shots(base, {'sa': v}, TNOW).get('cam_s') for v in (30.0, float('nan'), -1, 1e9, 'x', None)],
                  [30.0, None, None, None, None, None])
    # the reader's check of the hand-off
    trail = {'Delta': [['2026-11-16T12:44:50Z', 1, 2, 3, 'mine'], ['x', 1, 2, 3, 'mine'], ['2026-11-16T12:44:50Z', float('nan'), 2, 3, 'mine'],
                       [1, 2], 'row'], 'Other': [['2026-11-16T12:44:50Z', 1, 2, 3, 'mine']]}
    deep = dict(good, id='dx', layer='deep', bots=['Delta'], trail=trail)
    slot, problems = D.clean_slot({'v': 1, 't': '2026-11-16T12:45:00Z', 'stamp': STAMP, 'window_min': 45, 'scenes': [deep, 5, good]})
    t.assertEqual([x['id'] for x in slot['scenes']], ['dx', 'sx'])
    t.assertEqual((slot['scenes'][0]['trail'], slot['scenes'][0]['camera'], slot['scenes'][1]['camera'], 'trail' in slot['scenes'][1]),
                  ({'Delta': [['2026-11-16T12:44:50Z', 1, 2, 3, 'mine']]}, None, 'scene-sx', False),
                  'only well-formed samples of the scene\'s own bots')
    t.assertEqual(len(problems), 2, problems)
    for raw in ([], None, 'x'):
        t.assertEqual(D.clean_slot(raw)[0]['scenes'], [])
    t.assertEqual(D.clean_slot({'stamp': '../x', 't': 5, 'window_min': 'x', 'scenes': 'x'})[0],
                  {'v': 1, 't': None, 'stamp': None, 'window_min': None, 'scenes': []})
    # a scene camera is used only if the slot can use every value of it
    dc, (sc, order) = scene_cams(D, TL, 1)
    cfg_ = {'web': 'http://x', 'map_id': 'm', 'width': 1920, 'height': 1080}
    TL.check_scene_camera(cfg_, order[0], sc[order[0]])                      # a real one passes
    for change in ({'est_s': 'broken'}, {'est_s': 0}, {'x': None}, {'z': float('inf')}, {'y': 1e6}, {'distance': 0}, {'rotation': 'east'},
                   {'angle': float('nan')}, {'fov': 0}, {'height': 5}, {'settle_ms': -1}, {'ortho': 2}, {'mode': 'vr'}, {'label': 5},
                   {'heavy': True}, {'scene': None}, {'scene': dict(sc[order[0]]['scene'], id='other')},
                   {'scene': dict(sc[order[0]]['scene'], caption=None)}, {'scene': dict(sc[order[0]]['scene'], bots=['A', 5])}):
        with t.assertRaises(TL.DirectorRefused, msg=str(change)):
            TL.check_scene_camera(cfg_, order[0], dict(sc[order[0]], **change))
    for name in ('angled', 'scene-', 'scene-a/b', 'scene-' + 'x' * 50, 5):
        with t.assertRaises(TL.DirectorRefused, msg=str(name)):
            TL.check_scene_camera(cfg_, name, sc[order[0]])


def check_the_videos_do_not_trust_the_day_log(t, M):
    TV = M['TV']
    rows = [{'stamp': '20261116T0900Z', 'scenes': [{'id': SA, 'score': 'broken', 'caption': 5, 'bots': 7},
                                                   {'id': SB, 'score': float('nan'), 'bots': ['Onyx', 3]},
                                                   {'id': 12, 'score': 5}, {'id': [1], 'score': 5}, 'row', {'score': 5}]},
            {'stamp': 5, 'scenes': [{'id': SA, 'score': 40, 'caption': 'two bots', 'bots': ['Delta']}, {'id': SB, 'score': float('inf')}]}]
    try:
        got = TV.day_scenes({'scene-' + SA: ['20261116T0900Z'], 'under-' + SB: ['20261116T0900Z']}, rows,
                            lambda v, s: {'score': 'x', 'bots': 'Echo', 'caption': 9})
    except Exception as e:
        t.fail(f'a corrupt day log stopped the scene videos: {type(e).__name__}: {e}')
    t.assertEqual([(s['id'], s['score'], s['caption'], s['bots']) for s in got], [(SA, 40.0, 'two bots', ['Delta']), (SB, 0.0, '', ['Onyx'])],
                  'a score that is no finite number counts 0; bots that are no list of names are no names; an id that is no text is skipped')
    t.assertEqual(got[0]['by_stamp'], {'20261116T0900Z': {'caption': '', 'bots': []}})
    t.assertEqual((TV.bots_line(5), TV.bots_line('Echo'), TV.bots_line(['A', 3, 'B'])), ('', '', 'A, B'))
    try:
        caps = TV.scene_captions(got[0], ['20261116T0900Z', '20261116T0915Z'], lambda v, s: ['not', 'an', 'object'])
    except Exception as e:
        t.fail(f'a sidecar that is no object stopped the scene captions: {type(e).__name__}: {e}')
    t.assertEqual(caps,
                  [['two bots', 'Delta'], ['two bots', 'Delta']], 'a sidecar that is no object is no sidecar: the scene\'s own lines')
    nolog = TV.day_scenes({'scene-' + SA: ['20261116T0900Z']}, [], lambda v, s: {'score': 'x', 'bots': 'Echo', 'caption': 9, 'layer': 4})
    t.assertEqual([(s['score'], s['caption'], s['bots'], s['layer']) for s in nolog], [(0.0, '', [], 'surface')])
    t.assertEqual([TV._score(v) for v in (5, 2.5, True, '5', None, float('nan'), float('inf'), -1)], [5.0, 2.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    d = tempfile.mkdtemp(prefix='camdir-side-')
    try:
        os.makedirs(os.path.join(d, 'frames', 'scene-x', '20261116'))
        base = os.path.join(d, 'frames', 'scene-x', '20261116', '20261116T0900Z')
        with swap(TV, ROOT=d):
            for content, want in (('{"caption": "ok"}', {'caption': 'ok'}), ('[1, 2]', None), ('"text"', None), ('{"cap', None), ('', None)):
                with open(base + '.json', 'w') as f:
                    f.write(content)
                t.assertEqual(TV.frame_side('scene-x', '20261116T0900Z'), want, f'sidecar {content!r}')
            t.assertEqual(TV.stamp_text('scene-x', '20261116T0900Z', TV.frame_side('scene-x', '20261116T0900Z')),
                          'showcase scene-x  2026-11-16 09\\:00 UTC')
    finally:
        shutil.rmtree(d)


def check_nothing_of_the_director_is_used_unfenced_after_the_plan(t, M):
    """The post-plan path. director_done takes whatever the plan holds and never raises; what it returns for the
    heartbeat row is None or a dict that serialises. The scene sidecars are made inside the fence."""
    D, TL = M['D'], M['TL']
    dc, (sc, order) = scene_cams(D, TL, 1)
    v = order[0]
    good = {'director': {'state': {'scenes': []}, 'first': [v]}, 'summary': {'cameras': [v]}, 'cams': {v: sc[v], 'town': {}}}
    hostile = [('a summary that is a list', dict(good, summary=['broken'])), ('a summary that is a string', dict(good, summary='x')),
               ('a summary that is None', dict(good, summary=None)), ('a summary holding a set', dict(good, summary={'x': {1}})),
               ('a summary holding NaN', dict(good, summary={'x': float('nan')})), ('no summary key at all', {k: x for k, x in good.items() if k != 'summary'}),
               ('cameras that are a list', dict(good, cams=[1, 2])), ('a scene block that is a string', dict(good, cams={v: {'scene': 'x'}})),
               ('a scene id that is a list', dict(good, cams={v: {'scene': {'id': [1]}}})), ('no cameras at all', {'director': {'x': 1}}),
               ('a director result that is a string', dict(good, director='res')), ('a director result with no state', dict(good, director={'first': 5}))]
    root = tempfile.mkdtemp(prefix='camdir-done-')
    had = sys.modules.get('tl_director')
    sys.modules['tl_director'] = D
    try:
        os.makedirs(os.path.join(root, 'logs'))
        for what, plan in hostile:
            state = {'scene-old': {'last': 'x'}, 'town': {}}
            try:
                row, err = TL.director_done({'root': root}, plan, [v, 'town'], {v: 31.0}, NOW, state)
            except Exception as e:
                t.fail(f'{what}: director_done raised {type(e).__name__}: {e}')
            t.assertTrue(isinstance(err, str) and ': ' in err, f'{what}: the error is reported ({err!r})')
            t.assertTrue(row is None or isinstance(row, dict), f'{what}: the heartbeat object is a dict or nothing ({row!r})')
            json.dumps(row, allow_nan=False)
        row, err = TL.director_done({'root': root}, good, [v, 'town'], {v: 31.0}, NOW, {'scene-old': {}, 'town': {}})
        t.assertEqual((row, err), ({'cameras': [v], 'shot': [sc[v]['scene']['id']]}, None), 'positive control: a sound plan')
        t.assertEqual(jload(os.path.join(root, 'logs', 'scenes.json'))['scene_wait'], 0)
        t.assertEqual(TL.director_done({'root': root}, {'director': None}, [v], {}, NOW, {}), (None, None), 'no director in the plan')
    finally:
        sys.modules.pop('tl_director')
        if had is not None:
            sys.modules['tl_director'] = had
        shutil.rmtree(root)
    # the sidecar of a scene frame is the one made (and checked) inside the fence, not rebuilt from the camera later
    root, cfg = slot_root(deaths=False)
    try:
        seen = []
        real = TL.frame_sidecar

        def spy(cam, target, site=None):
            seen.append(bool((cam or {}).get('scene')))
            return real(cam, target, site)
        calls = []
        real_plan = TL.director_plan

        def plan_spy(*a, **k):
            out = real_plan(*a, **k)
            calls.append((len(seen), dict(out['sidecars'])))
            return out
        with swap(TL, frame_sidecar=spy, director_plan=plan_spy):
            shot, hb = run_slot(M, cfg)
        n_in_plan, sidecars = calls[0]
        scene = [x for x in shot if x.startswith('scene-')]
        t.assertEqual((len(scene), sorted(sidecars)), (1, scene), 'the plan carries one ready sidecar per scene camera')
        t.assertFalse(any(seen[n_in_plan:]), 'after director_plan returned, frame_sidecar is never called on a scene camera again')
        t.assertTrue(any(seen[:n_in_plan]), 'positive control: it was called on one inside the fence')
        side = jload(os.path.join(root, 'frames', scene[0], '20261116', STAMP + '.json'))
        t.assertEqual({k: x for k, x in side.items() if k != 'changed'}, sidecars[scene[0]], 'and that is what is written beside the frame')
    finally:
        shutil.rmtree(root)


PLAN_BASE = 'c75a5e51d6eb66270205599ae512b818aca9fbe7'      # origin/main when camdirector-01 was cut
PLAN_GOLDEN = os.path.join(HERE, 'fixtures', 'plan-director-off-c75a5e51d.json')


def plan_root(fx):
    """A temp timelapse root from the golden fixture: its views.json, its project records, the template tl.conf."""
    root = tempfile.mkdtemp(prefix='camdir-plan-')
    os.makedirs(os.path.join(root, 'logs'))
    os.makedirs(os.path.join(root, 'pool'))
    with open(os.path.join(root, 'logs', 'views.json'), 'w') as f:
        json.dump(fx['views'], f)
    for name, body in fx['pool'].items():
        with open(os.path.join(root, 'pool', name), 'w') as f:
            json.dump(body, f)
    cfg = dict({k: v for k, v in CONF.items() if k != 'director'}, root=root, project_dir=os.path.join(root, 'pool'))
    return root, cfg


def plan_output(TL, cfg, when):
    """What `tl_showcase.py plan` prints at a given UTC time -> (stdout, stderr)."""
    import contextlib, gc, io, warnings
    out, err = io.StringIO(), io.StringIO()
    # tl_showcase reads its state with `json.load(open(...))`; when the collector happens to run inside the redirect, Python
    # prints a ResourceWarning for the unclosed file on stderr, which is not the tool's output (seen on 3.14 after a rebase)
    gc.collect()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', ResourceWarning)
        with swap(TL, now_utc=lambda: when), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = TL.cmd_plan(cfg, None)
        gc.collect()
    assert rc == 0
    return out.getvalue(), err.getvalue()


def check_plan_with_the_director_off_prints_what_it_always_printed(t, M):
    """`tl_showcase.py plan`, director off: stdout byte-identical to origin/main's (c75a5e51d) at :00, :15, :30, :45."""
    TL = M['TL']
    fx = jload(PLAN_GOLDEN)
    t.assertEqual(fx['base'], PLAN_BASE)
    times = sorted(fx['stdout'])
    t.assertTrue({'00', '15', '30', '45'} <= {x[14:16] for x in times} and len(times) >= 7, f'the clock times cover every quarter ({times})')
    root, cfg = plan_root(fx)
    try:
        for iso_ in times:
            when = dt.datetime.strptime(iso_, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=U)
            for label, c in (('no director key', cfg), ('on: false', dict(cfg, director=dict(CONF['director'], on=False))),
                             ('on: false, junk settings', dict(cfg, director={'on': False, 'overdue_n': 'x', 'slot_s': []}))):
                out, err = plan_output(TL, c, when)
                t.assertEqual(out.encode(), fx['stdout'][iso_].encode(), f'{iso_}, {label}: stdout is origin/main\'s, byte for byte')
                on_the_hour = iso_[14:16] == '00'
                t.assertEqual(err == '', on_the_hour, f'{iso_}: off the hour, ONE extra line on stderr says the slot\'s real pair')
                if not on_the_hour:
                    t.assertEqual((err.count('\n'), "['angled']" in err, 'topdown' in json.loads(out)['views']), (1, True, True),
                                  'the object still plans topdown (as it always did); the note says the slot shoots angled alone')
        t.assertGreater(len({fx['stdout'][x].replace(x, '') for x in times}), 1, 'positive control: the plans differ between the times')
        t.assertTrue(all(json.loads(fx['stdout'][x])['follow'].get('project4k') == 'cottage1' for x in times),
                     'positive control: a follow camera has its target in every one')
        # the golden really is origin/main's: where the repository is at hand, run c75a5e51d's own cmd_plan on the same root
        import subprocess
        r = subprocess.run(['git', '-C', HERE, 'show', f'{PLAN_BASE}:infra/showcase/tl_showcase.py'], capture_output=True, text=True)
        if r.returncode == 0 and 'def cmd_plan' in r.stdout:
            old = load('tl_showcase.py', r.stdout)
            for iso_ in times:
                when = dt.datetime.strptime(iso_, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=U)
                t.assertEqual(plan_output(old, cfg, when), (fx['stdout'][iso_], ''), f'{iso_}: the golden is what c75a5e51d prints')
        # director ON: the plan the slot will really make -- the slot's own pair, said in the object
        on = dict(cfg, director=dict(CONF['director'], on=True, log_glob=os.path.join(root, 'none', '*.jsonl')))
        out, err = plan_output(TL, on, dt.datetime(2026, 11, 16, 12, 15, tzinfo=U))
        got = json.loads(out)
        t.assertEqual((got['pair'], got['views'][0], 'topdown' in got['views'], err), (['angled'], 'angled', False, ''))
        t.assertIn('director', got)
        t.assertFalse(os.path.exists(os.path.join(root, 'logs', 'scenes.json')), '`plan` writes nothing')
    finally:
        shutil.rmtree(root)


def check_director_off_plans_exactly_as_before(t, M):
    """`director: {on: false}` (or no key): the cameras, the plan and the files are those of a tl.conf without it."""
    TL = M['TL']
    t.assertFalse(TL.director_on({}))
    t.assertFalse(TL.director_on({'director': {'on': False, 'idle_only': ['town']}}))
    t.assertFalse(TL.director_on({'director': {}}), 'only an explicit on: true')
    t.assertTrue(TL.director_on({'director': {'on': True}}))
    pcfg, pstate, pprog = plan_cfg()
    had = sys.modules.pop('tl_director', None)
    for dconf_ in (None, {'on': False}, {'on': False, 'overdue_n': 'not a number', 'scene_wait_slots': [], 'weights': 7}):
        cfg_ = dict(pcfg, **({'director': dconf_} if dconf_ is not None else {}))
        try:
            got = TL.slot_plan(cfg_, pstate, NOW, pprog, {}, 690, lambda: 0.0, TL.VIEWS)
        except Exception as e:
            t.fail(f'a director setting broke a slot with the director off: {type(e).__name__}: {e}')
        t.assertEqual((got['views'], got['why'], got['deferred']), TL.plan_views(pcfg, pstate, NOW, pprog, 690, 0.0),
                      f'{dconf_}: resolve_cameras + plan_views, nothing else')
        t.assertEqual((got['cams'], got['director'], got['summary'], got['director_error']), (pcfg['cameras'], None, None, None))
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


def simulate_day(TL, cfg, scene_plan=None, slots=96, spent=None, measured=False):
    """Plan every 15-min slot of a day with every project active, marking each planned view shot. scene_plan(cams, t)
    -> (cameras, first, first_budget_s, slot_s) stands in for the director. spent: the seconds of snapshot + render
    before the plan (default SPENT_S). measured: every camera already has its measured frame cost (30 s, a 4K one
    150 s), so the plan's estimates are the costs the tests add up. -> [views per slot]."""
    spent = SPENT_S if spent is None else spent
    state, out, wait = {}, [], 0
    cost_of = lambda v, c: (c or {}).get('est_s') or (150 if (c or {}).get('heavy') else 40 if v.startswith('scene-') else 30)
    if measured:
        state = {v: {'frame_s': cost_of(v, c)} for v, c in cfg['cameras'].items()}
    sites = {'cottage1': {'box': [30, 30, 40, 40], 'g': 66}}
    t0 = dt.datetime(2026, 11, 16, tzinfo=U)
    for k in range(slots):
        now = t0 + dt.timedelta(minutes=15 * k)
        prog = {'tidy': now, 'grounds': now, 'cottage1': now}
        cams, targets = TL.resolve_cameras(cfg, state, now, prog, sites)
        first, fb, slot_s = (), None, None
        if scene_plan:
            cams, first, fb, slot_s = scene_plan(cams, now)
        views, _, _ = TL.plan_views(dict(cfg, cameras=cams), state, now, prog, float(cfg.get('budget_s') or 690), spent,
                                    pair=TL.slot_pair(cfg, now), first=first, first_budget_s=fb, slot_s=slot_s,
                                    first_wait=wait)
        # the director's count (tl_director.note_shots): slots in a row with scene cameras live and no scene frame
        wait = wait + 1 if first and not any(v.startswith('scene-') for v in views) else 0
        for v in views:
            state[v] = dict(state.get(v) or {}, last=TL._iso(now), last_change=TL._iso(now), frame_s=cost_of(v, cams.get(v)))
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
    t.assertEqual(TL.plan_budget(690, None), 690, 'no slot_s: budget_s alone')
    t.assertEqual((TL.plan_budget(690, 360), TL.plan_budget(300, 360)), (360, 300))
    n_scene = sum(1 for views in on_day for v in views if v.startswith('scene-'))
    t.assertEqual(n_scene, 96 * 2 - 4, 'two 40-s scene frames in every slot (the 90-s ceiling), but for the first two '
                  'slots of the day, where the never-shot fixed cameras are owed their first frame')
    t.assertEqual(sum(1 for views in on_day if 'project4k' in views), 0, 'project4k yields in every slot that has a scene')
    t.assertEqual(sum(1 for views in on_day if 'grounds' in views), 12, 'grounds: every 2 h, not every slot')
    hero = [k for k, views in enumerate(on_day) if 'hero4k' in views]
    t.assertGreaterEqual(len(hero), 32, 'positive control: the town overview is still filmed (48 a day without scenes)')
    t.assertLessEqual(max(b - a for a, b in zip(hero, hero[1:])) * 15, 60, 'and never more than 60 min apart')


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

    def test_no_fixed_camera_starves_behind_the_scene_cameras(self):
        check_no_fixed_camera_starves_behind_the_scene_cameras(self, REAL)

    def test_owed_cameras_do_not_starve_the_scenes(self):
        check_owed_cameras_do_not_starve_the_scenes(self, REAL)

    def test_the_scene_wait_count_through_the_wiring(self):
        check_the_scene_wait_count_through_the_wiring(self, REAL)

    def test_underground_scenes_carry_their_bots_trail(self):
        check_underground_scenes_carry_their_bots_trail(self, REAL)

    def test_every_director_entry_point_is_fenced(self):
        check_every_director_entry_point_is_fenced(self, REAL)

    def test_a_corrupt_state_file_never_reaches_the_slot(self):
        check_a_corrupt_state_file_never_reaches_the_slot(self, REAL)

    def test_what_is_read_back_is_checked(self):
        check_what_is_read_back_is_checked(self, REAL)

    def test_the_videos_do_not_trust_the_day_log(self):
        check_the_videos_do_not_trust_the_day_log(self, REAL)

    def test_nothing_of_the_director_is_used_unfenced_after_the_plan(self):
        check_nothing_of_the_director_is_used_unfenced_after_the_plan(self, REAL)

    def test_a_failing_director_costs_the_slot_nothing(self):
        check_a_failing_director_costs_the_slot_nothing(self, REAL)

    def test_the_template_day_costs_no_more(self):
        check_the_template_day_costs_no_more(self, REAL)


class DirectorOff(unittest.TestCase):
    def test_director_off_plans_exactly_as_before(self):
        check_director_off_plans_exactly_as_before(self, REAL)

    def test_plan_with_the_director_off_prints_what_it_always_printed(self):
        check_plan_with_the_director_off_prints_what_it_always_printed(self, REAL)


# ================================================================== PART 3: videos that follow the scenes
DAY = '20261116'
SA, SB, SC, SZ = 's20261116T0900a', 'd20261116T0900a', 's20261116T1000a', 's20261116T1100a'


def scene_log():
    """Three slots of the director's day log: a surface scene (held in the third slot), a deep one, a small one."""
    sc = lambda i, layer, score, caption, bots: {'id': i, 'layer': layer, 'score': score, 'caption': caption, 'bots': bots}
    return [{'stamp': '20261116T0900Z', 'scenes': [sc(SB, 'deep', 200, '4 bots mining under the town, y 12-30', ['Onyx', 'Kite', 'Gale', 'Iris']),
                                                   sc(SA, 'surface', 50, '2 bots building the yard', ['Delta', 'Juno'])]},
            {'stamp': '20261116T0915Z', 'scenes': [sc(SB, 'deep', 180, '3 bots mining under the town, y 12-28', ['Onyx', 'Kite', 'Gale']),
                                                   sc(SA, 'surface', 70, "3 bots building the yard", ['Delta', 'Juno', 'Lumen']),
                                                   sc(SC, 'surface', 10, '1 bot gathering in the town', ['Maple'])]},
            {'stamp': '20261116T0930Z', 'scenes': [sc(SA, 'surface', 0, '3 bots building the yard', ['Delta', 'Juno', 'Lumen'])]}]


def check_scene_directories_are_not_cameras(t, M):
    TV = M['TV']
    d = tempfile.mkdtemp(prefix='camdir-views-')
    try:
        for v in ('angled', 'topdown', 'town', 'scene-' + SA, 'under-' + SB, '.staging'):
            os.makedirs(os.path.join(d, 'frames', v))
        vv = TV.video_views(d)
        t.assertIn('town', vv, 'positive control: a camera directory is a view')
        t.assertFalse([v for v in vv if v.startswith(('scene-', 'under-'))],
                      'a scene directory gets no daily / weekly / history video of its own')
        t.assertEqual(TV.scene_views(d), ['scene-' + SA, 'under-' + SB])
        t.assertEqual((TV.scene_id('scene-' + SA), TV.scene_id('under-' + SB), TV.scene_id('town')), (SA, SB, None))
        t.assertTrue(TV.is_scene_view('under-x') and not TV.is_scene_view('grounds'))
    finally:
        shutil.rmtree(d)


def check_the_days_scenes_are_ranked_by_score(t, M):
    TV = M['TV']
    stamps = {'scene-' + SA: ['20261116T0930Z', '20261116T0900Z', '20261116T0915Z'], 'under-' + SB: ['20261116T0900Z', '20261116T0915Z'],
              'scene-' + SC: ['20261116T0915Z'], 'scene-' + SZ: ['20261116T1100Z', '20261116T1115Z'], 'scene-empty': []}
    sides = {('scene-' + SZ, '20261116T1100Z'): {'score': 5, 'caption': 'early', 'bots': ['Echo'], 'layer': 'surface'},
             ('scene-' + SZ, '20261116T1115Z'): {'score': 6.5, 'caption': 'late', 'bots': ['Echo', 'Frost'], 'layer': 'surface'}}
    got = TV.day_scenes(stamps, scene_log(), lambda v, s: sides.get((v, s)))
    t.assertEqual([(s['id'], s['view'], s['score'], s['slots'], s['layer']) for s in got],
                  [(SB, 'under-' + SB, 380.0, 2, 'deep'), (SA, 'scene-' + SA, 120.0, 3, 'surface'),
                   (SZ, 'scene-' + SZ, 11.5, 2, 'surface'), (SC, 'scene-' + SC, 10.0, 1, 'surface')],
                  'the day\'s score is the sum over its slots; a scene the log does not know is scored from its frames\' sidecars')
    t.assertEqual((got[0]['caption'], got[0]['bots']), ('4 bots mining under the town, y 12-30', ['Onyx', 'Kite', 'Gale', 'Iris']),
                  'caption and bots of its BUSIEST slot (200), not of its last (180)')
    a = got[1]
    t.assertEqual((a['caption'], a['bots'], a['stamps']), ('3 bots building the yard', ['Delta', 'Juno', 'Lumen'],
                                                         ['20261116T0900Z', '20261116T0915Z', '20261116T0930Z']),
                  'caption and bots of its busiest slot; its frames in order')
    t.assertEqual(a['by_stamp']['20261116T0900Z'], {'caption': '2 bots building the yard', 'bots': ['Delta', 'Juno']})
    t.assertEqual((got[2]['caption'], got[2]['bots']), ('late', ['Echo', 'Frost']))
    t.assertEqual(TV.day_scenes({'scene-' + SA: []}, scene_log()), [], 'a scene with no frame that day has no clip to rank')
    d = tempfile.mkdtemp(prefix='camdir-log-')
    try:
        os.makedirs(os.path.join(d, 'logs'))
        with open(os.path.join(d, 'logs', f'scenes-{DAY}.jsonl'), 'w') as f:
            f.write(json.dumps(scene_log()[0]) + '\n{broken\n[1]\n' + json.dumps(scene_log()[1]) + '\n')
        rows = TV.load_scene_log(DAY, d)
        t.assertEqual(len(rows), 2, 'a broken line and a line that is no slot object are skipped')
        t.assertEqual([r['stamp'] for r in rows], ['20261116T0900Z', '20261116T0915Z'])
        t.assertEqual(TV.load_scene_log('20261117', d), [], 'no log that day: nothing, no error')
    finally:
        shutil.rmtree(d)


def check_each_frame_carries_its_own_caption_and_bots(t, M):
    TV = M['TV']
    scene = TV.day_scenes({'scene-' + SA: ['20261116T0900Z', '20261116T0915Z', '20261116T0930Z']}, scene_log())[0]
    sides = {'20261116T0915Z': {'caption': 'from the sidecar', 'bots': ['Delta', 'Juno', 'Lumen', 'Maple', 'Nova', 'Onyx', 'Kite', 'Gale']}}
    caps = TV.scene_captions(scene, ['20261116T0900Z', '20261116T0915Z', '20261116T0930Z', '20261116T0945Z'],
                             lambda v, s: sides.get(s))
    t.assertEqual(caps, [['2 bots building the yard', 'Delta, Juno'],                       # the slot's row in the day log
                         ['from the sidecar', 'Delta, Juno, Lumen, Maple, Nova, Onyx +2'],  # the frame's own sidecar first
                         ['3 bots building the yard', 'Delta, Juno, Lumen'],
                         ['3 bots building the yard', 'Delta, Juno, Lumen']],               # neither: the busiest slot
                 'the caption and the bots as they were at that frame')
    t.assertEqual(TV.bots_line(['A', 'B']), 'A, B')
    t.assertEqual(TV.bots_line([]), '')
    t.assertEqual(TV.scene_captions({'view': 'scene-x', 'caption': '', 'bots': []}, ['20261116T0900Z']), [[]], 'nothing known: no line')
    long = TV.caption_line('café ' + 'x' * 200)
    t.assertEqual((len(long), long[-3:], 'é' in long), (96, '...', False), 'ASCII and capped, like the chat captions')


def _png(w, h):
    import struct, zlib
    raw = b''.join(b'\x00' + b'\x00' * (w * 3) for _ in range(h))
    chunk = lambda k, b: struct.pack('>I', len(b)) + k + b + struct.pack('>I', zlib.crc32(k + b) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class fake_ffmpeg:
    """subprocess.run for tl_video: writes each command's output file and, at every encode, records the numbered
    input frames (the symlinks' targets, in order) and the text files of the overlay."""
    def __init__(self):
        self.cmds, self.encodes = [], []

    def __call__(self, cmd, *a, **k):
        import subprocess
        line = ' '.join(map(str, cmd))
        self.cmds.append(line)
        out = cmd[-1]
        if 'libx264' in line and '-filter_complex' in cmd and '%06d' in line:
            tmp = os.path.dirname(cmd[cmd.index('-i') + 1])
            names = sorted(os.listdir(tmp))
            self.encodes.append({'out': out, 'cmd': cmd,
                                 'frames': [os.path.basename(os.readlink(os.path.join(tmp, n))) for n in names if n.startswith('s')],
                                 'text': {n: open(os.path.join(tmp, n)).read() for n in names if n.endswith('.txt')}})
        if isinstance(out, str) and out.endswith(('.mp4', '.png')):
            open(out, 'wb').close()
        return subprocess.CompletedProcess(cmd, 0, b'', b'')


def scene_root():
    """A temp timelapse root with the frames of three scenes and two cameras on 11-16, and the director's day log."""
    root = tempfile.mkdtemp(prefix='camdir-video-')
    frames = {'scene-' + SA: ['20261116T0900Z', '20261116T0915Z', '20261116T0930Z'], 'under-' + SB: ['20261116T0900Z', '20261116T0915Z'],
              'scene-' + SC: ['20261116T0915Z'], 'hero4k': [f'20261116T{h:02d}00Z' for h in range(6, 12)],
              'workshop': [f'20261116T{h:02d}00Z' for h in range(6, 12)]}
    for v, stamps in frames.items():
        for s in stamps:
            os.makedirs(os.path.join(root, 'frames', v, s[:8]), exist_ok=True)
            with open(os.path.join(root, 'frames', v, s[:8], s + '.png'), 'wb') as f:
                f.write(_png(8, 8))
    with open(os.path.join(root, 'frames', 'scene-' + SA, DAY, '20261116T0915Z.json'), 'w') as f:
        json.dump({'label': 'yard', 'scene': SA, 'caption': '3 bots building the yard', 'bots': ['Delta', 'Juno', 'Lumen'],
                   'layer': 'surface', 'score': 70}, f)
    for d in ('video/daily', 'logs'):
        os.makedirs(os.path.join(root, d))
    with open(os.path.join(root, 'logs', f'scenes-{DAY}.jsonl'), 'w') as f:
        f.write(''.join(json.dumps(r) + '\n' for r in scene_log()))
    conf = os.path.join(root, 'tl.conf')
    with open(conf, 'w') as f:
        json.dump({'cameras': {'workshop': {'off': True}, 'hero4k': {}}}, f)
    return root, conf


def check_a_scene_clip_per_live_scene(t, M):
    """The real build() with ffmpeg faked: the clip's name, its frames in order, the caption and bots burned in."""
    TV = M['TV']
    root, conf = scene_root()
    ff = fake_ffmpeg()
    chat = [(dt.datetime(2026, 11, 16, 9, 10, tzinfo=U), 'showcase-Echo', 1, 'project_done', 'The yard is finished!')]
    counter = [0]

    def gray(path):                         # every frame differs from the one before: none is dropped as unchanged
        counter[0] += 1
        return bytes([counter[0] * 37 % 251]) * 64
    try:
        lo = dt.datetime(2026, 11, 16, tzinfo=U)
        with swap(TV, ROOT=root, TL_CONF=conf, small_gray=gray, load_lines=lambda *a: chat), swap(TV.subprocess, run=ff), quiet():
            sides = TV.build_scene_clips('daily/2026-11-16', lo, lo + dt.timedelta(days=1))
        vid = os.path.join(root, 'video', 'daily')
        t.assertEqual(sorted(f for f in os.listdir(vid) if f.endswith('.mp4')),
                      [f'2026-11-16-scene-{SB}.mp4', f'2026-11-16-scene-{SA}.mp4'],
                      'daily/<day>-scene-<id>.mp4 for the surface AND the underground scene; the one-frame scene gets none')
        t.assertEqual([(s['scene'], s['score'], s['layer'], s['title']) for s in sides],
                      [(SB, 380.0, 'deep', '4 bots mining under the town, y 12-30'), (SA, 120.0, 'surface', '3 bots building the yard')])
        enc = {os.path.basename(e['out']).replace('.part.mp4', ''): e for e in ff.encodes}
        a = enc[f'2026-11-16-scene-{SA}.mp4']
        t.assertEqual(a['frames'], ['20261116T0900Z.png', '20261116T0915Z.png', '20261116T0930Z.png', '20261116T0930Z.png'],
                      'its frames in order, the last one held')
        t.assertEqual((a['text'].get('cap000001_1.txt'), a['text'].get('cap000001_0.txt')), ('2 bots building the yard', 'Delta, Juno'),
                      'frame 1: the caption above the bots\' names (the lowest line), from the day log')
        t.assertEqual((a['text']['cap000002_1.txt'], a['text']['cap000002_0.txt']), ('3 bots building the yard', 'Delta, Juno, Lumen'))
        t.assertFalse([n for n in a['text'] if n.startswith('tally')], 'a scene clip carries no chat tally')
        t.assertFalse([x for x in a['text'].values() if 'finished!' in x], 'and no chat line')
        cmd = a['cmd']
        t.assertEqual(cmd[cmd.index('-framerate') + 1], '1.0', 'three frames play at 1 per second, not 2')
        t.assertIn('[b][t]overlay', cmd[cmd.index('-filter_complex') + 1], 'the same text layer the chat captions use')
        b = enc[f'2026-11-16-scene-{SB}.mp4']
        t.assertEqual(sorted(set(b['frames'])), ['20261116T0900Z.png', '20261116T0915Z.png'])
        t.assertEqual(b['text']['cap000001_1.txt'], '4 bots mining under the town, y 12-30')
        side = jload(os.path.join(vid, f'2026-11-16-scene-{SA}.mp4.json'))
        t.assertEqual((side['view'], side['scene'], side['included'], side['bots']), ('scene-' + SA, SA, 3, ['Delta', 'Juno', 'Lumen']))
        # the chat captions of an ordinary camera are untouched
        ff.encodes.clear()
        with swap(TV, ROOT=root, small_gray=gray, load_lines=lambda *a: chat), swap(TV.subprocess, run=ff), quiet():
            TV.build('hero4k', [f'20261116T{h:02d}00Z' for h in range(8, 11)], os.path.join(vid, 'x-hero4k.mp4'), 'daily/x')
        t.assertIn('Echo: The yard is finished!', ff.encodes[0]['text'].values(), 'positive control: a camera clip has the chat line')
        t.assertTrue([n for n in ff.encodes[0]['text'] if n.startswith('tally')])
    finally:
        shutil.rmtree(root)


def check_the_reel_is_the_top_scenes_then_the_overview(t, M):
    TV = M['TV']
    d = tempfile.mkdtemp(prefix='camdir-reel-')
    try:
        def mk(v, inc, act=0.0, **kw):
            open(os.path.join(d, v), 'w').close()
            return dict({'view': v, 'included': inc, 'activity': act, 'out': os.path.join(d, v), 'duration_s': 12.0}, **kw)
        cams = [mk('hero4k', 40, 0.5), mk('angled', 40, 0.6), mk('topdown', 40, 0.9), mk('workshop', 30, 5.0), mk('town', 20, 0.4),
                mk('iso', 20, 0.35)]
        sc = lambda i, score, title, inc=4: mk('scene-' + i if i[0] == 's' else 'under-' + i, inc, scene=i, score=score, title=title)
        scenes = [sc('sa', 120, '3 bots building the yard'), sc('db', 380, '4 bots mining under the town, y 12-30'), sc('sc', 60, 'c'),
                  sc('sd', 50, 'd'), sc('se', 40, 'e'), sc('sf', 999, 'one frame', inc=1)]
        scenes.append({'view': 'scene-gone', 'included': 9, 'score': 9999, 'out': os.path.join(d, 'nope'), 'scene': 'gone'})
        plan = TV.plan_reel(cams, scenes=scenes, off={'workshop'})
        t.assertEqual(plan, ['under-db', 'scene-sa', 'scene-sc', 'scene-sd', 'hero4k'],
                      'the four top scenes by score, underground included, THEN the town overview; a one-frame scene and '
                      'a clip that is not on disk are left out')
        t.assertEqual(TV.plan_reel(cams, scenes=scenes[:1], off={'workshop'}), ['scene-sa', 'hero4k'])
        t.assertEqual(TV.plan_reel(cams, off={'workshop'}), ['hero4k', 'angled', 'town', 'iso'],
                      'no scene clip that day: the reel as it was, without the finished project\'s camera')
        t.assertEqual(TV.plan_reel(cams)[:2], ['hero4k', 'workshop'], 'positive control: not off, the most active camera is in')
        t.assertNotIn('workshop', TV.plan_reel(cams, scenes=scenes, off={'workshop'}))
        t.assertEqual(TV.plan_reel([c for c in cams if c['view'] not in ('hero4k', 'angled')], scenes=scenes[:2]), ['under-db', 'scene-sa'],
                      'no overview clip: the scenes alone')
        mixed = cams + [mk('scene-stray', 30, 9.0)]
        t.assertNotIn('scene-stray', TV.plan_reel(mixed), 'a scene directory is never taken for a camera')
        by = {s['view']: s for s in cams + scenes}
        cmd = TV.reel_cmd('daily/2026-11-16', plan[:2] + ['hero4k'], by, '/o/reel.part.mp4')
        t.assertEqual([cmd[i + 1] for i, x in enumerate(cmd) if x == '-i'], [by['under-db']['out'], by['scene-sa']['out'], by['hero4k']['out']])
        fc = cmd[cmd.index('-filter_complex') + 1]
        t.assertIn("text='4 bots mining under the town, y 12-30  2026-11-16'", fc, 'a scene segment is titled with its caption')
        t.assertIn("text='hero4k  2026-11-16'", fc, 'a camera segment with its name, as before')
        t.assertIn('concat=n=3:v=1:a=0[out]', fc)
        t.assertIn('setpts=PTS/1.3333', fc, '12 s sped up to the 9-s segment')
        t.assertEqual(cmd[-1], '/o/reel.part.mp4')
        t.assertEqual(TV.reel_title('scene-x', {'title': "it's 100%: a 'test'\\"}, 'daily/2026-11-16'), 'its 100 a test  2026-11-16',
                      'nothing that could break the quoted filter text survives')
        # the whole reel job, ffmpeg faked
        ff = fake_ffmpeg()
        with swap(TV.subprocess, run=ff):
            side = TV.build_reel('daily/2026-11-16', cams, os.path.join(d, 'reel.mp4'), scenes=scenes, off={'workshop'})
        t.assertEqual((side['views'], side['scenes']), (plan, ['db', 'sa', 'sc', 'sd']))
        t.assertEqual(len([c for c in ff.cmds if 'concat=n=5' in c]), 1)
    finally:
        shutil.rmtree(d)


def check_daily_builds_the_scene_clips_and_the_reel(t, M):
    """main('daily') end to end, ffmpeg faked: camera clips, scene clips, the reel from the scenes."""
    TV = M['TV']
    root, conf = scene_root()
    ff = fake_ffmpeg()
    n = [0]

    def gray(path):
        n[0] += 1
        return bytes([n[0] * 37 % 251]) * 64
    old_argv = sys.argv
    sys.argv = ['tl_video.py', 'daily', '--day', '2026-11-16']
    try:
        with swap(TV, ROOT=root, TL_CONF=conf, small_gray=gray, load_lines=lambda *a: []), swap(TV.subprocess, run=ff), quiet():
            TV.main()
        vid = os.path.join(root, 'video', 'daily')
        t.assertEqual(sorted(f for f in os.listdir(vid) if f.endswith('.mp4')),
                      [f'2026-11-16-{x}.mp4' for x in sorted(['hero4k', 'workshop', 'reel', 'scene-' + SA, 'scene-' + SB])],
                      'no clip named after a scene DIRECTORY (under-<id>), one per scene id')
        reel = jload(os.path.join(vid, '2026-11-16-reel.mp4.json'))
        t.assertEqual(reel['views'], ['under-' + SB, 'scene-' + SA, 'hero4k'], 'top scenes, then the overview; workshop is off')
        t.assertEqual(reel['scenes'], [SB, SA])
        # `reel` alone, from the clips already built: the same reel
        os.remove(os.path.join(vid, '2026-11-16-reel.mp4.json'))
        sys.argv = ['tl_video.py', 'reel', '--day', '2026-11-16']
        with swap(TV, ROOT=root, TL_CONF=conf), swap(TV.subprocess, run=ff), quiet():
            TV.main()
        t.assertEqual(jload(os.path.join(vid, '2026-11-16-reel.mp4.json'))['views'], ['under-' + SB, 'scene-' + SA, 'hero4k'])
        sys.argv = ['tl_video.py', 'daily', '--day', '2026-11-16']
        # a day with no scene at all: the reel as it was -- and still without the finished project's camera
        for v in os.listdir(os.path.join(root, 'frames')):
            if v.startswith(('scene-', 'under-')):
                shutil.rmtree(os.path.join(root, 'frames', v))
        with swap(TV, ROOT=root, TL_CONF=conf, small_gray=gray, load_lines=lambda *a: []), swap(TV.subprocess, run=ff), quiet():
            TV.main()
        t.assertEqual(jload(os.path.join(vid, '2026-11-16-reel.mp4.json'))['views'], ['hero4k'],
                      'workshop has the same six changing frames as hero4k; it is off in tl.conf')
        os.remove(os.path.join(vid, '2026-11-16-reel.mp4.json'))
        sys.argv = ['tl_video.py', 'reel', '--day', '2026-11-16']
        with swap(TV, ROOT=root, TL_CONF=conf), swap(TV.subprocess, run=ff), quiet():
            TV.main()
        t.assertEqual(jload(os.path.join(vid, '2026-11-16-reel.mp4.json'))['views'], ['hero4k'], 'and the same from `reel` alone')
        # a failure while building the scene clips never costs the day's reel
        def boom(*a, **k):
            raise RuntimeError('scene clips broke')
        os.remove(os.path.join(vid, '2026-11-16-reel.mp4.json'))
        sys.argv = ['tl_video.py', 'daily', '--day', '2026-11-16']
        try:
            with swap(TV, ROOT=root, TL_CONF=conf, small_gray=gray, load_lines=lambda *a: [], build_scene_clips=boom), \
                    swap(TV.subprocess, run=ff), quiet():
                rc = TV.main()
        except RuntimeError as e:
            t.fail(f'the daily job died with the scene clips: {e}')
        t.assertEqual((rc, jload(os.path.join(vid, '2026-11-16-reel.mp4.json'))['views']), (1, ['hero4k']),
                      'the reel is built all the same; the job reports the failure in its exit code')
    finally:
        sys.argv = old_argv
        shutil.rmtree(root)


def check_the_progress_clip(t, M):
    TV = M['TV']
    import argparse
    now = dt.datetime(2026, 11, 16, 1, 40, tzinfo=U)
    lo, hi, bucket, name = TV.window('progress', argparse.Namespace(day=None, week_ending=None, month=None), now)
    t.assertEqual((bucket, name, hi), (360, 'progress', now), 'one clip, one frame per 6 h, up to now')
    hourly = [f'202611{d:02d}T{h:02d}00Z' for d in (14, 15) for h in range(24)] + ['20261115T0615Z-event-hall']
    t.assertEqual(TV.sample(hourly, lo, hi, bucket), [f'202611{d:02d}T{h:02d}00Z' for d in (14, 15) for h in (0, 6, 12, 18)],
                  'the 00, 06, 12 and 18 UTC frames; never an event frame')
    has = lambda *v: (lambda x: x in v)
    t.assertEqual(TV.progress_view({}, has('expeditions', 'grounds', 'topdown')), 'expeditions', 'the whole-area top-down camera first')
    t.assertEqual(TV.progress_view({}, has('grounds', 'topdown')), 'grounds')
    t.assertEqual(TV.progress_view({}, has('topdown')), 'topdown')
    t.assertEqual(TV.progress_view({'progress': {'view': 'grounds'}}, has('expeditions', 'grounds')), 'grounds', 'tl.conf progress.view')
    t.assertEqual(TV.progress_view({'progress': {'view': 'gone'}}, has('expeditions')), 'expeditions', 'a named view with no frames')
    t.assertIsNone(TV.progress_view({}, has('town')))
    d = tempfile.mkdtemp(prefix='camdir-data-')
    try:
        for day, build, chat in (('20261110', [('2026-11-10T08:00:00', 'place'), ('2026-11-10T09:00:00', 'clear'),
                                               ('2026-11-10T10:00:00', 'place')],
                                  [('2026-11-10T11:00:00.000Z', 'project_done'), ('2026-11-10T11:05:00.000Z', 'section')]),
                                 ('20261112', [('2026-11-12T08:00:00', 'place')] * 1500, [('2026-11-12T09:00:00.000Z', 'project_done')])):
            os.makedirs(os.path.join(d, 'data', day))
            with open(os.path.join(d, 'data', day, 'build.tsv'), 'w') as f:
                f.write(''.join(f'{ts}\tJuno\tyard\t{op}\t1\t64\t2\tcobblestone\n' for ts, op in build) + 'short\tline\n')
            with open(os.path.join(d, 'data', day, 'chat.jsonl'), 'w') as f:
                f.write(''.join(json.dumps({'t': ts, 'bot': 'showcase-Juno', 'tier': 1, 'cat': cat, 'text': 'x'}) + '\n' for ts, cat in chat)
                        + '{broken\n')
        os.makedirs(os.path.join(d, 'data', 'notaday'))
        os.makedirs(os.path.join(d, 'data', '20261109'))          # a day directory with no extract in it yet
        counts = TV.load_progress_counts(d)
        t.assertEqual((len(counts['placed']), len(counts['done']), counts['from']), (1502, 2, dt.date(2026, 11, 10)),
                      'build.tsv rows whose op is place (not clear); chat.jsonl lines whose cat is project_done')
        day0 = dt.date(2026, 10, 20)
        at = lambda s: dt.datetime.strptime(s, '%Y-%m-%d %H:%M').replace(tzinfo=U)
        t.assertEqual(TV.progress_text(at('2026-10-20 06:00'), day0, counts), 'Day 1', 'before the extracts begin: the day counter only')
        t.assertEqual(TV.progress_text(at('2026-11-09 18:00'), day0, counts), 'Day 21')
        t.assertEqual(TV.progress_text(at('2026-11-10 09:30'), day0, counts), 'Day 22   1 block placed, 0 projects finished since Nov 10')
        t.assertEqual(TV.progress_text(at('2026-11-10 12:00'), day0, counts), 'Day 22   2 blocks placed, 1 project finished since Nov 10')
        t.assertEqual(TV.progress_text(at('2026-11-16 00:00'), day0, counts), 'Day 28   1,502 blocks placed, 2 projects finished since Nov 10')
        t.assertEqual(TV.progress_text(at('2026-11-16 00:00'), dt.date(2026, 11, 10), counts), 'Day 7   1,502 blocks placed, 2 projects finished',
                      'the extracts cover the clip from its first day: no "since"')
        none = TV.load_progress_counts(os.path.join(d, 'nowhere'))
        t.assertEqual(none, {'placed': [], 'done': [], 'from': None})
        t.assertEqual(TV.progress_text(at('2026-11-16 00:00'), day0, none), 'Day 28', 'no data on the VM: it degrades to the counter')
        t.assertEqual(TV.progress_captions(['20261110T1200Z', '20261020T0000Z'], day0, counts),
                      [['Day 22   2 blocks placed, 1 project finished since Nov 10'], ['Day 1']])
        with open(os.path.join(d, 'FRAME0.json'), 'w') as f:
            json.dump({'stamp': '20261020T1315Z'}, f)
        t.assertEqual((TV.frame0_day(d), TV.frame0_day(os.path.join(d, 'nowhere'))), (dt.date(2026, 10, 20), None))
    finally:
        shutil.rmtree(d)


def check_the_progress_job(t, M):
    """main('progress'): one build, of the whole-area camera, every 6 h; not again while that camera has no new frame."""
    TV = M['TV']
    hourly = [f'202611{d:02d}T{h:02d}00Z' for d in (14, 15) for h in range(24)]
    root, conf = _video_root({'expeditions': hourly, 'topdown': hourly, 'town': hourly})
    try:
        with open(os.path.join(root, 'FRAME0.json'), 'w') as f:
            json.dump({'stamp': '20261020T1315Z'}, f)
        os.makedirs(os.path.join(root, 'data', '20261114'))
        with open(os.path.join(root, 'data', '20261114', 'build.tsv'), 'w') as f:
            f.write('2026-11-14T05:00:00\tJuno\tyard\tplace\t1\t64\t2\tcobblestone\n' * 7)
        calls = _run_video(TV, root, conf, ['progress'])
        t.assertEqual(len(calls), 1, 'ONE clip')
        view, stamps, extra = calls[0]
        t.assertEqual((view, stamps), ('expeditions', [f'202611{d:02d}T{h:02d}00Z' for d in (14, 15) for h in (0, 6, 12, 18)]))
        t.assertEqual((extra['newest_frame'], extra['day0'], extra['counts_from'], extra['blocks_placed'], extra['bucket_min']),
                      ('20261115T2300Z', '2026-10-20', '2026-11-14', 7, 360))
        kw = _run_video.kws[0]
        t.assertTrue(kw['out'].endswith('/video/progress.mp4'))
        t.assertTrue(kw.get('captions_for'), 'the clip draws its own lines')
        t.assertEqual(kw['captions_for'](['20261114T0000Z', '20261114T0600Z']),
                      [['Day 26   0 blocks placed, 0 projects finished since Nov 14'],
                       ['Day 26   7 blocks placed, 0 projects finished since Nov 14']], 'the day counter and the running count on every frame')
        out = os.path.join(root, 'video', 'progress.mp4')
        open(out, 'wb').close()
        with open(out + '.json', 'w') as f:
            json.dump({'newest_frame': '20261115T2300Z'}, f)
        t.assertEqual(_run_video(TV, root, conf, ['progress']), [], 'no new frame since: not encoded again')
        os.makedirs(os.path.join(root, 'frames', 'expeditions', '20261116'))
        open(os.path.join(root, 'frames', 'expeditions', '20261116', '20261116T0000Z.png'), 'wb').close()
        t.assertEqual(len(_run_video(TV, root, conf, ['progress'])), 1, 'a new frame: rebuilt')
    finally:
        shutil.rmtree(root)
    root, conf = _video_root({'topdown': hourly, 'town': hourly})
    try:
        calls = _run_video(TV, root, conf, ['progress'])
        t.assertEqual([(c[0], c[2]['day0'], c[2]['counts_from']) for c in calls], [('topdown', '2026-11-14', None)],
                      'no whole-area camera and no data: the town top-down, days counted from its first frame')
        t.assertEqual(_run_video.kws[0]['captions_for'](['20261115T0600Z']), [['Day 2']])
    finally:
        shutil.rmtree(root)
    with open(os.path.join(HERE, 'files', 'timers.txt')) as f:
        t.assertIn('progress', [line.split()[0] for line in f if line.strip() and not line.startswith('#')],
                   'the job has a timer line (provision-vm.sh writes showcase-video-progress.timer from it)')


class SceneVideos(unittest.TestCase):
    def test_scene_directories_are_not_cameras(self):
        check_scene_directories_are_not_cameras(self, REAL)

    def test_the_days_scenes_are_ranked_by_score(self):
        check_the_days_scenes_are_ranked_by_score(self, REAL)

    def test_each_frame_carries_its_own_caption_and_bots(self):
        check_each_frame_carries_its_own_caption_and_bots(self, REAL)

    def test_a_scene_clip_per_live_scene(self):
        check_a_scene_clip_per_live_scene(self, REAL)

    def test_the_reel_is_the_top_scenes_then_the_overview(self):
        check_the_reel_is_the_top_scenes_then_the_overview(self, REAL)

    def test_daily_builds_the_scene_clips_and_the_reel(self):
        check_daily_builds_the_scene_clips_and_the_reel(self, REAL)

    def test_the_progress_clip(self):
        check_the_progress_clip(self, REAL)

    def test_the_progress_job(self):
        check_the_progress_job(self, REAL)


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
    ('tl_director.py', "               'camera': 'scene-' + s['id'] if surface else None,", "               'camera': 'scene-' + s['id'],",
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
    ('tl_showcase.py', "                if est(v) <= keep and est(v) <= room:", "                if est(v) <= keep:",
     'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "    deferred += late\n", "", 'check_scene_cameras_go_first_and_displace_fixed_ones'),
    ('tl_showcase.py', "                if est(v) <= keep and est(v) <= room:", "                if est(v) <= room:", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "                    keep -= est(v)\n                    left -= est(v)\n                    room -= est(v)",
     "                    left -= est(v)\n                    room -= est(v)", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "                    keep -= est(v)\n                    left -= est(v)\n                    room -= est(v)",
     "                    keep -= est(v)\n                    room -= est(v)", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "                    keep -= est(v)\n                    left -= est(v)\n                    room -= est(v)",
     "                    keep -= est(v)\n                    left -= est(v)", 'check_the_budget_is_never_exceeded'),
    ('tl_showcase.py', "    if sc:     ", "    if False:  ", 'check_frames_carry_the_scene'),
    ('tl_showcase.py', "        v = m.group(1) if m else base.split('-', 1)[0]", "        v = base.split('-', 1)[0]", 'check_frames_carry_the_scene'),
    ('tl_showcase.py', "    return bool(((cfg or {}).get('director') or {}).get('on'))", "    return True",
     'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "    return bool(((cfg or {}).get('director') or {}).get('on'))", "    return bool((cfg or {}).get('director'))",
     'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "    if not director_on(cfg):\n        return without_director()", "    if False:\n        return without_director()",
     'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "slot_s=limits['slot_s'],", "slot_s=None,", 'check_the_slot_ceiling_reaches_the_plan'),
    ('tl_showcase.py', "    if first:                       # the director's scene cameras", "    if True:                       # the director's scene cameras",
     'check_the_slot_ceiling_reaches_the_plan'),
    ('tl_showcase.py', "    return min(float(budget_s), float(slot_s)) if slot_s else budget_s", "    return budget_s",
     'check_the_template_day_costs_no_more'),
    ('tl_showcase.py', "first=tuple(first), first_budget_s=limits['scene_budget_s']", "first=(), first_budget_s=limits['scene_budget_s']",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "    for v in [k for k in state if k.startswith('scene-') and k not in cams]:", "    for v in []:",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "        D.finish(cfg, plan['director'], shots, now)", "        D.finish(cfg, plan['director'], {}, now)",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "    if drow is not None:\n        row['director'] = drow", "    if False:\n        row['director'] = drow",
     'check_a_whole_slot_with_the_director_on'),
    ('tl_showcase.py', "    res = D.run(cfg, now, sites, stamp=stamp, frame=follow_camera, write=write)",
     "    res = D.run(cfg, now, sites, stamp=None, frame=follow_camera, write=write)", 'check_a_whole_slot_with_the_director_on'),
    # ---- part 3: the scene videos and the progress clip (tl_video.py)
    ('tl_video.py', "             if not x.startswith('.') and not is_scene_view(x) and os.path.isdir(os.path.join(d, x))]",
     "             if not x.startswith('.') and os.path.isdir(os.path.join(d, x))]", 'check_scene_directories_are_not_cameras'),
    ('tl_video.py', "    return str(name).startswith(SCENE_PREFIXES)", "    return str(name).startswith('scene-')",
     'check_scene_directories_are_not_cameras'),
    ('tl_video.py', "            a['score'] += _score(sc.get('score'))", "            a['score'] = _score(sc.get('score'))",
     'check_the_days_scenes_are_ranked_by_score'),
    ('tl_video.py', "            if a['best'] is None or _score(sc.get('score')) > _score(a['best'].get('score')):",
     "            if True:", 'check_the_days_scenes_are_ranked_by_score'),
    ('tl_video.py', "    return sorted(out, key=lambda s: (-s['score'], s['id']))", "    return sorted(out, key=lambda s: s['id'])",
     'check_the_days_scenes_are_ranked_by_score'),
    ('tl_video.py', "            score, slots, by_stamp = sum(_score(x.get('score')) for x in sides), len(sides), {}",
     "            score, slots, by_stamp = 0.0, len(sides), {}", 'check_the_days_scenes_are_ranked_by_score'),
    ('tl_video.py', "        if not stamps or not sid:\n            continue", "        if not sid:\n            continue",
     'check_the_days_scenes_are_ranked_by_score'),
    ('tl_video.py', "            if isinstance(r, dict) and isinstance(r.get('scenes'), list):", "            if True:",
     'check_the_days_scenes_are_ranked_by_score'),
    ('tl_video.py', "        cap = _words(side.get('caption')) or slot.get('caption') or scene.get('caption')",
     "        cap = slot.get('caption') or scene.get('caption')", 'check_each_frame_carries_its_own_caption_and_bots'),
    ('tl_video.py', "        cap = _words(side.get('caption')) or slot.get('caption') or scene.get('caption')",
     "        cap = _words(side.get('caption')) or scene.get('caption')", 'check_each_frame_carries_its_own_caption_and_bots'),
    ('tl_video.py', "        bots = _names(side.get('bots')) or slot.get('bots') or scene.get('bots')", "        bots = scene.get('bots')",
     'check_each_frame_carries_its_own_caption_and_bots'),
    ('tl_video.py', "(f' +{len(bots) - shown}' if len(bots) > shown else '')", "''", 'check_each_frame_carries_its_own_caption_and_bots'),
    ('tl_video.py', "        out.append([x for x in (caption_line(cap), caption_line(bots_line(bots))) if x])",
     "        out.append([caption_line(cap), caption_line(bots_line(bots))])", 'check_each_frame_carries_its_own_caption_and_bots'),
    ('tl_video.py', "        if len(sc['stamps']) < SCENE_MIN_FRAMES:\n            continue", "        if False:\n            continue",
     'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', '''        mp4 = os.path.join(ROOT, 'video', f"{name}-scene-{sc['id']}.mp4")''',
     '''        mp4 = os.path.join(ROOT, 'video', f"{name}-{sc['view']}.mp4")''', 'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', "extra=extra, captions_for=lambda kept, sc=sc: scene_captions(sc, kept, frame_side))", "extra=extra)",
     'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', "    lines = load_lines() if captions_for is None else []", "    lines = load_lines()", 'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', "    caps = captions(kept, lines) if captions_for is None else captions_for(kept)", "    caps = captions(kept, lines)",
     'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', "    src = src_fps_for(len(kept), lo=min(min_src_fps, max_src_fps), hi=max_src_fps)",
     "    src = src_fps_for(len(kept), hi=max_src_fps)", 'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', "    for sc in day_scenes(stamps, rows, frame_side)[:SCENE_CLIPS_MAX]:", "    for sc in day_scenes(stamps, rows, frame_side)[1:SCENE_CLIPS_MAX]:",
     'check_a_scene_clip_per_live_scene'),
    ('tl_video.py', "          and s['view'] not in off and not is_scene_view(s['view'])}", "          and not is_scene_view(s['view'])}",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "          and s['view'] not in off and not is_scene_view(s['view'])}", "          and s['view'] not in off}",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "    if top:\n        return [s['view'] for s in top] + ([overview] if overview in ok else [])",
     "    if False:\n        return [s['view'] for s in top] + ([overview] if overview in ok else [])",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "    if top:\n        return [s['view'] for s in top] + ([overview] if overview in ok else [])",
     "    if top:\n        return ([overview] if overview in ok else []) + [s['view'] for s in top]",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "                 key=lambda s: (-(s.get('score') or 0), s['view']))[:n]", "                 key=lambda s: s['view'])[:n]",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "                 key=lambda s: (-(s.get('score') or 0), s['view']))[:n]", "                 key=lambda s: (-(s.get('score') or 0), s['view']))",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "    top = sorted((s for s in scenes if s.get('included', 0) >= SCENE_MIN_FRAMES and os.path.exists(s.get('out') or '')),",
     "    top = sorted((s for s in scenes if os.path.exists(s.get('out') or '')),", 'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "    top = sorted((s for s in scenes if s.get('included', 0) >= SCENE_MIN_FRAMES and os.path.exists(s.get('out') or '')),",
     "    top = sorted((s for s in scenes if s.get('included', 0) >= SCENE_MIN_FRAMES),", 'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "if ch.isalnum() or ch in ' -_,.')[:70] or view", "if True)[:70] or view", 'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "    what = ''.join(ch for ch in str((side or {}).get('title') or view)", "    what = ''.join(ch for ch in str(view)",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "    plan = plan_reel(sides, scenes=scenes, off=off)", "    plan = plan_reel(sides, off=off)",
     'check_the_reel_is_the_top_scenes_then_the_overview'),
    ('tl_video.py', "            scenes = build_scene_clips(name, lo, hi, sj)       # one clip per scene live that day (camdirector-01)",
     "            scenes = []", 'check_daily_builds_the_scene_clips_and_the_reel'),
    ('tl_video.py', "        except Exception as e:          # the scene clips are an addition", "        except ZeroDivisionError as e:          # the scene clips are an addition",
     'check_daily_builds_the_scene_clips_and_the_reel'),
    ('tl_video.py', "            scenes, rc = [], 1\n", "            scenes = []\n", 'check_daily_builds_the_scene_clips_and_the_reel'),
    ('tl_video.py', "                scenes.append(dict(read_side(out), out=out))", "                pass",
     'check_daily_builds_the_scene_clips_and_the_reel'),
    ('tl_video.py', "scenes=scenes,\n                                    off=off_views(load_tl_conf()))))", "scenes=scenes)))",
     'check_daily_builds_the_scene_clips_and_the_reel'),
    ('tl_video.py', "print(json.dumps(build_reel(name, sides, os.path.join(ROOT, 'video', f'{name}-reel.mp4'), scenes=scenes,\n                                        off=off)))",
     "print(json.dumps(build_reel(name, sides, os.path.join(ROOT, 'video', f'{name}-reel.mp4'), scenes=scenes)))",
     'check_daily_builds_the_scene_clips_and_the_reel'),
    ('tl_video.py', "PROGRESS_BUCKET_MIN = 360 ", "PROGRESS_BUCKET_MIN = 60 ", 'check_the_progress_clip'),
    ('tl_video.py', "    for v in ([want] if want else []) + list(PROGRESS_VIEWS):", "    for v in list(PROGRESS_VIEWS):", 'check_the_progress_clip'),
    ('tl_video.py', "PROGRESS_VIEWS = ('expeditions', 'grounds', 'topdown') ", "PROGRESS_VIEWS = ('topdown', 'grounds', 'expeditions') ",
     'check_the_progress_clip'),
    ('tl_video.py', "                    if len(c) >= 4 and c[3] == 'place':", "                    if len(c) >= 4:", 'check_the_progress_clip'),
    ('tl_video.py', "if isinstance(r, dict) and r.get('cat') == 'project_done' and r.get('t'):", "if isinstance(r, dict) and r.get('t'):",
     'check_the_progress_clip'),
    ('tl_video.py', "    if first is None or t.date() < first:\n        return text", "    if first is None:\n        return text",
     'check_the_progress_clip'),
    ('tl_video.py', "    text = f'Day {(t.date() - day0).days + 1}'", "    text = f'Day {(t.date() - day0).days}'", 'check_the_progress_clip'),
    ('tl_video.py', "    n, k = bisect.bisect_right(counts['placed'], upto), bisect.bisect_right(counts['done'], upto)",
     "    n, k = len(counts['placed']), len(counts['done'])", 'check_the_progress_clip'),
    ('tl_video.py', '''    since = '' if first <= day0 else f" since {first.strftime('%b %d')}"''', "    since = ''", 'check_the_progress_clip'),
    ('tl_video.py', "        if seen and first is None:", "        if first is None:", 'check_the_progress_clip'),
    ('tl_video.py', "REBUILD_KINDS = ('history', 'weekly', 'monthly', 'progress') ", "REBUILD_KINDS = ('history', 'weekly', 'monthly') ",
     'check_the_progress_job'),
    ('tl_video.py', "    st = sample(stamps, lo, hi, bucket)\n    out = os.path.join(ROOT, 'video', f'{name}.mp4')",
     "    st = sample(stamps, lo, hi, 60)\n    out = os.path.join(ROOT, 'video', f'{name}.mp4')", 'check_the_progress_job'),
    ('tl_video.py', "    day0 = frame0_day() or parse_stamp(stamps[0]).date()", "    day0 = parse_stamp(stamps[0]).date()", 'check_the_progress_job'),
    ('tl_video.py', "                     captions_for=lambda kept: progress_captions(kept, day0, counts))", "                     )",
     'check_the_progress_job'),
    # ---- Codex r1: no fixed camera starves behind the scene cameras (tl_showcase.plan_views)
    ('tl_showcase.py', "            if first and age + 2 >= owed_n * iv:\n", "            if False:\n",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "            if first and age + 2 >= owed_n * iv:\n", "            if first and age >= owed_n * iv:\n",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "            if first and age + 2 >= owed_n * iv:\n", "            if first:\n",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "DEFAULT_OVERDUE_N = 2.0 ", "DEFAULT_OVERDUE_N = 3.0 ", 'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "    owed_n = float((cfg.get('director') or {}).get('overdue_n') or DEFAULT_OVERDUE_N)", "    owed_n = DEFAULT_OVERDUE_N",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "                    held.append(v)\n                    keep -= est(v)", "                    held.append(v)",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "                if est(v) <= keep and (not is_heavy or heavy_keep > 0):", "                if est(v) <= keep:",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "                if est(v) <= keep and (not is_heavy or heavy_keep > 0):", "                if not is_heavy or heavy_keep > 0:",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "            for _, v in sorted(owed):               # set aside", "            for _, v in sorted(owed, reverse=True):               # set aside",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "    for _, _, v, w in [d for d in ordered if d[2] in held] + [d for d in ordered if d[2] not in held]:",
     "    for _, _, v, w in ordered:", 'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "        if not scene_owed and any(capped < est(v) <= left for _, v in owed):", "        if False:",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "        if not scene_owed and any(capped < est(v) <= left for _, v in owed):", "        if not scene_owed and owed:",
     'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "            left = capped\n", "            pass\n", 'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    ('tl_showcase.py', "            why[v] = w + ('; owed: its seconds were set aside before the scene cameras' if v in held else '')",
     "            why[v] = w", 'check_no_fixed_camera_starves_behind_the_scene_cameras'),
    # ---- the underground trail in the hand-off (tl_director.trail_of, slot_file, run)
    ('tl_director.py', "    for b in bots:\n        pts = sorted(", "    for b in samples:\n        pts = sorted(",
     'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "        pts = sorted(p for p in samples.get(b) or () if p[0] >= lo)[-int(max_n):]",
     "        pts = sorted(p for p in samples.get(b) or ())[-int(max_n):]", 'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "        pts = sorted(p for p in samples.get(b) or () if p[0] >= lo)[-int(max_n):]",
     "        pts = sorted(p for p in samples.get(b) or () if p[0] >= lo)[:int(max_n)]", 'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "        pts = sorted(p for p in samples.get(b) or () if p[0] >= lo)[-int(max_n):]",
     "        pts = sorted(p for p in samples.get(b) or () if p[0] >= lo)", 'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "        pts = sorted(p for p in samples.get(b) or () if p[0] >= lo)[-int(max_n):]",
     "        pts = [p for p in samples.get(b) or () if p[0] >= lo][-int(max_n):]", 'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "[[iso(t), round(x, 1), round(y, 1), round(z, 1), skill] for t, x, y, z, skill in pts]",
     "[[iso(t), x, y, z, skill] for t, x, y, z, skill in pts]", 'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "        if not surface and samples is not None and now is not None:", "        if samples is not None and now is not None:",
     'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "        if not surface and samples is not None and now is not None:", "        if False:",
     'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "now - float(dc['trail_min']) * 60, dc['trail_max'])", "now - float(dc['trail_min']) * 60, 300)",
     'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "now - float(dc['trail_min']) * 60, dc['trail_max'])", "now - 45 * 60, dc['trail_max'])",
     'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "            f.write(json.dumps(without_trails(slot), sort_keys=True) + '\\n')", "            f.write(json.dumps(slot, sort_keys=True) + '\\n')",
     'check_underground_scenes_carry_their_bots_trail'),
    ('tl_director.py', "    slot = slot_file(state, stamp, dc, samples, now)", "    slot = slot_file(state, stamp, dc)",
     'check_underground_scenes_carry_their_bots_trail'),
    # ---- Codex r2: the owed fixed cameras do not starve the scenes (plan_views first_wait, note_shots scene_wait)
    ('tl_showcase.py', "        scene_owed = first_wait >= wait_n and est(first[0]) <= capped and est(first[0]) <= room",
     "        scene_owed = False", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "        scene_owed = first_wait >= wait_n and est(first[0]) <= capped and est(first[0]) <= room",
     "        scene_owed = first_wait > wait_n and est(first[0]) <= capped and est(first[0]) <= room",
     'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "        scene_owed = first_wait >= wait_n and est(first[0]) <= capped and est(first[0]) <= room",
     "        scene_owed = first_wait >= wait_n and est(first[0]) <= room", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "        scene_owed = first_wait >= wait_n and est(first[0]) <= capped and est(first[0]) <= room",
     "        scene_owed = est(first[0]) <= capped and est(first[0]) <= room", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "        if not scene_owed and any(capped < est(v) <= left for _, v in owed):",
     "        if any(capped < est(v) <= left for _, v in owed):", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "        wait_n = int((cfg.get('director') or {}).get('scene_wait_slots') or DEFAULT_SCENE_WAIT_SLOTS)",
     "        wait_n = DEFAULT_SCENE_WAIT_SLOTS", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "DEFAULT_SCENE_WAIT_SLOTS = 2 ", "DEFAULT_SCENE_WAIT_SLOTS = 4 ", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "                keep, left, room = keep - est(first[0]), left - est(first[0]), room - est(first[0])",
     "                keep, left, room = keep, left - est(first[0]), room - est(first[0])", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "                keep, left, room = keep - est(first[0]), left - est(first[0]), room - est(first[0])",
     "                keep, left, room = keep - est(first[0]), left, room - est(first[0])", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "            for v in first[len(lead):]:", "            for v in first:", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_director.py', "        out['scene_wait'] = int(out.get('scene_wait') or 0) + 1 if wanted and not shots else 0",
     "        out['scene_wait'] = int(out.get('scene_wait') or 0) + 1 if not shots else 0", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_director.py', "        out['scene_wait'] = int(out.get('scene_wait') or 0) + 1 if wanted and not shots else 0",
     "        out['scene_wait'] = int(out.get('scene_wait') or 0) + 1 if wanted else 0", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_director.py', "        out['scene_wait'] = int(out.get('scene_wait') or 0) + 1 if wanted and not shots else 0",
     "        out['scene_wait'] = 1 if wanted and not shots else 0", 'check_owed_cameras_do_not_starve_the_scenes'),
    ('tl_showcase.py', "                                      first_wait=int(wait))", "                                      first_wait=0)",
     'check_the_scene_wait_count_through_the_wiring'),
    ('tl_director.py', "    state = note_shots(res['state'], shots, now, wanted=len(res['first']))", "    state = note_shots(res['state'], shots, now)",
     'check_the_scene_wait_count_through_the_wiring'),
    ('tl_director.py', "cam_s=prev.get('cam_s'), scene_wait=prev.get('scene_wait') or 0)", "cam_s=prev.get('cam_s'))",
     'check_the_scene_wait_count_through_the_wiring'),
    # ---- Codex r3: the fence (tl_showcase.slot_plan / director_plan / director_done)
    ('tl_showcase.py', "    except Exception as e:\n        return without_director(f'", "    except ZeroDivisionError as e:\n        return without_director(f'",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    except Exception as e:\n        return without_director(f'", "    except Exception as e:\n        return without_director(None and f'",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    except Exception as e:\n        err = f'{type(e).__name__}: {str(e)[:300]}'\n        try:",
     "    except ZeroDivisionError as e:\n        err = f'{type(e).__name__}: {str(e)[:300]}'\n        try:",
     'check_every_director_entry_point_is_fenced'),
    # ---- Codex r4: a summary that is no object; nothing of the director's unfenced after the plan; `plan` as it was
    ('tl_showcase.py', "    if not isinstance(summary, dict):       # Codex r4", "    if False:       # Codex r4",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    json.dumps(summary, allow_nan=False)\n    # the sidecar of every scene frame", "    # the sidecar of every scene frame",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    except Exception as e:\n        err = f'{type(e).__name__}: {str(e)[:300]}'\n        try:",
     "    except OSError as e:\n        err = f'{type(e).__name__}: {str(e)[:300]}'\n        try:",
     'check_nothing_of_the_director_is_used_unfenced_after_the_plan'),
    ('tl_showcase.py', "        row = dict(plan['summary'], shot=sorted(shots))\n        json.dumps(row, allow_nan=False)\n",
     "        row = dict(plan['summary'], shot=sorted(shots))\n", 'check_nothing_of_the_director_is_used_unfenced_after_the_plan'),
    ('tl_showcase.py', "        except Exception:\n            row = {}", "        except ZeroDivisionError:\n            row = {}",
     'check_nothing_of_the_director_is_used_unfenced_after_the_plan'),
    ('tl_showcase.py', "        side = plan['sidecars'].get(v) or frame_sidecar(", "        side = frame_sidecar(",
     'check_nothing_of_the_director_is_used_unfenced_after_the_plan'),
    ('tl_showcase.py', "    sidecars = {v: frame_sidecar(dcams[v], None) for v in first}", "    sidecars = {}",
     'check_nothing_of_the_director_is_used_unfenced_after_the_plan'),
    ('tl_showcase.py', "        plan = slot_plan(cfg, state, t, progress, sites, budget, lambda: 75.0, VIEWS)",
     "        plan = slot_plan(cfg, state, t, progress, sites, budget, lambda: 75.0, pair)",
     'check_plan_with_the_director_off_prints_what_it_always_printed'),
    ('tl_showcase.py', "        if tuple(pair) != tuple(VIEWS):\n            print(f\"note:", "        if False:\n            print(f\"note:",
     'check_plan_with_the_director_off_prints_what_it_always_printed'),
    ('tl_showcase.py', "as `plan` always has; the slot at {_iso(t)} \"\n                  f\"shoots the pair {list(pair)} (tl.conf pair_hourly)\", file=sys.stderr)",
     "as `plan` always has; the slot at {_iso(t)} \"\n                  f\"shoots the pair {list(pair)} (tl.conf pair_hourly)\")",
     'check_plan_with_the_director_off_prints_what_it_always_printed'),
    ('tl_showcase.py', "    out = {'t': _iso(t), 'pair': list(pair), 'views': plan['views'],", "    out = {'t': _iso(t), 'pair': list(VIEWS), 'views': plan['views'],",
     'check_plan_with_the_director_off_prints_what_it_always_printed'),
    ('tl_showcase.py', "lambda: 75.0, pair, stamp_of(t), write=False)   # read-only", "lambda: 75.0, VIEWS, stamp_of(t), write=False)   # read-only",
     'check_plan_with_the_director_off_prints_what_it_always_printed'),
    ('tl_showcase.py', "lambda: 75.0, pair, stamp_of(t), write=False)   # read-only", "lambda: 75.0, pair, stamp_of(t))   # read-only",
     'check_plan_with_the_director_off_prints_what_it_always_printed'),
    ('tl_showcase.py', "    derr = plan['director_error'] or derr ", "    derr = derr ", 'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    if derr:\n        row['director_error'] = derr", "    if False:\n        row['director_error'] = derr",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    if not isinstance(res, dict) or not isinstance(res.get('dc'), dict):", "    if False:",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    if not isinstance(scene_cams, dict) or not isinstance(first, (list, tuple)) or sorted(first) != sorted(scene_cams):",
     "    if False:", 'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    if not isinstance(dcams, dict) or set(dcams) != set(cams) | set(first):", "    if False:",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    for v in cams:                          # a fixed camera comes back", "    for v in []:                          # a fixed camera comes back",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    for v in first:\n        check_scene_camera(cfg, v, dcams[v])", "    for v in []:\n        check_scene_camera(cfg, v, dcams[v])",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "        if limits[k] is not None and not _finite(limits[k], 0, 86400):", "        if False:",
     'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    if not _finite(wait, 0, 10 ** 6):", "    if False:", 'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "        if not _finite(cam.get(k), lo, hi):", "        if False:", 'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', " or cam.get('heavy')\n", "\n", 'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "    json.dumps(summary, allow_nan=False)\n", "", 'check_every_director_entry_point_is_fenced'),
    ('tl_showcase.py', "        if not _finite(cam.get(k), lo, hi):", "        if cam.get(k) is None:", 'check_what_is_read_back_is_checked'),
    ('tl_showcase.py', "or not isinstance(sc.get('caption'), str) or not isinstance(sc.get('bots'), list)", "or not isinstance(sc.get('bots'), list)",
     'check_what_is_read_back_is_checked'),
    ('tl_showcase.py', "    owed_n = float((cfg.get('director') or {}).get('overdue_n') or DEFAULT_OVERDUE_N) if first else None",
     "    owed_n = float((cfg.get('director') or {}).get('overdue_n') or DEFAULT_OVERDUE_N)", 'check_director_off_plans_exactly_as_before'),
    ('tl_showcase.py', "    if res.get('repaired'):\n", "    if False:\n", 'check_a_corrupt_state_file_never_reaches_the_slot'),
    # ---- Codex r3: what is read back is checked (tl_director.clean_state / clean_scene / read_state)
    ('tl_director.py', "    prev, repaired = read_state(cfg)", "    prev, repaired = read_state(cfg)[0], []",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "    if not isinstance(raw, dict):\n        return {}, ['scenes.json is not an object']", "    if False:\n        return {}, []",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "    except (OSError, ValueError) as e:\n        return {}, [f'scenes.json cannot be read", "    except ZeroDivisionError as e:\n        return {}, [f'scenes.json cannot be read",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "        return {}, [f'scenes.json cannot be read ({type(e).__name__}); started from an empty state']", "        return {}, []",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "        if ok:\n            out['bots'][name] = {'pos': list(pos), 'since': tr['since'], 'last': tr['last']}",
     "        if isinstance(tr, dict) and isinstance(pos, (list, str)):\n            out['bots'][name] = {'pos': list(pos), 'since': tr.get('since'), 'last': tr.get('last')}",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "    take('cam_s', _num(raw.get('cam_s'), 0.001, CAM_S_MAX), None)", "    out['cam_s'] = raw.get('cam_s')",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "    take('cam_s', _num(raw.get('cam_s'), 0.001, CAM_S_MAX), None)", "    take('cam_s', _num(raw.get('cam_s'), 0.001, 1e12), None)",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    take('scene_wait', _int(raw.get('scene_wait'), 0, 10 ** 5), 0)", "    out['scene_wait'] = raw.get('scene_wait') or 0",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    return int(n) if n is not None and n == int(n) else None", "    return n", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    if isinstance(v, bool) or not isinstance(v, (int, float)):\n        return None", "    if not isinstance(v, (int, float)):\n        return None",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    except (OverflowError, ValueError):\n        return None", "    except ZeroDivisionError:\n        return None",
     'check_a_corrupt_state_file_never_reaches_the_slot'),
    ('tl_director.py', "    return v if isinstance(v, str) and len(v) <= 40 and epoch(v) is not None else None", "    return v if isinstance(v, str) else None",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    return v if isinstance(v, str) and len(v) <= cap else None", "    return v if isinstance(v, str) else None",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    if not (isinstance(sid, str) and RX_ID.fullmatch(sid)):", "    if not isinstance(sid, str):", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "              and box[0] <= box[2] and box[1] <= box[3])", "              )", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "all(_num(v, -COORD_MAX, COORD_MAX) is not None for v in box)", "True", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "and all(_num(v, *Y_RANGE) is not None for v in y) and y[0] <= y[1]", "and all(_num(v, *Y_RANGE) is not None for v in y)",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    if s.get('layer') not in LAYERS or s.get('kind', 'activity') not in KINDS or not ok_box or not ok_y:",
     "    if not ok_box or not ok_y:", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    if s.get('layer') not in LAYERS or s.get('kind', 'activity') not in KINDS or not ok_box or not ok_y:",
     "    if s.get('layer') not in LAYERS or s.get('kind', 'activity') not in KINDS or not ok_box:", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "        if value is None and present and s.get(key) is not None:\n            bad.append(", "        if False:\n            bad.append(",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "        take(k, _num(s.get(k), 0, SCORE_MAX), 0)", "        out[k] = s.get(k) or 0", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "if isinstance(bots, list) and all(_text(b, 40) for b in bots) else None, [])", "if isinstance(bots, list) else None, [])",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "        if c and c['id'] in ids:", "        if False:", 'check_what_is_read_back_is_checked'),
    ('tl_director.py', "        if value is None and raw.get(key) is not None:\n            bad.append(f'{key} is not usable; reset')", "        if False:\n            pass",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "    except FileNotFoundError:\n        return {}, []", "    except FileNotFoundError:\n        return {}, ['no scenes.json']",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "        if _num(sec, 0.001, CAM_S_MAX) is not None:       # what is written", "        if isinstance(sec, (int, float)) and sec > 0:       # what is written",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "sort_keys=True, allow_nan=False)      # never a NaN on disk", "sort_keys=True)      # never a NaN on disk",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "                good = [p for p in pts if isinstance(p, list) and len(p) == 5 and _time(p[0])", "                good = [p for p in pts if isinstance(p, list) and len(p) == 5",
     'check_what_is_read_back_is_checked'),
    ('tl_director.py', "            for b in c['bots']:\n                pts = trail.get(b)", "            for b in trail:\n                pts = trail.get(b)",
     'check_what_is_read_back_is_checked'),
    # ---- Codex r3: the videos do not trust the day log either (tl_video)
    ('tl_video.py', "    ok = not isinstance(v, bool) and isinstance(v, (int, float)) and v == v and 0 <= v <= 1e9", "    ok = isinstance(v, (int, float)) and v == v",
     'check_the_videos_do_not_trust_the_day_log'),
    ('tl_video.py', "    return [b for b in v if isinstance(b, str)] if isinstance(v, list) else []", "    return list(v or ())",
     'check_the_videos_do_not_trust_the_day_log'),
    ('tl_video.py', "            if not isinstance(sc, dict) or not isinstance(sc.get('id'), str) or not sc['id']:", "            if not isinstance(sc, dict) or not sc.get('id'):",
     'check_the_videos_do_not_trust_the_day_log'),
    ('tl_video.py', "        side = side if isinstance(side, dict) else {}\n", "", 'check_the_videos_do_not_trust_the_day_log'),
    ('tl_video.py', "            if isinstance(row.get('stamp'), str):", "            if row.get('stamp'):", 'check_the_videos_do_not_trust_the_day_log'),
    ('tl_video.py', "    return side if isinstance(side, dict) else None", "    return side", 'check_the_videos_do_not_trust_the_day_log'),
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
