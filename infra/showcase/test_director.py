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


FILES = {'TL': 'tl_showcase.py', 'EV': 'tl_event.py', 'TV': 'tl_video.py'}
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
        self.old = {k: getattr(self.mod, k) for k in self.kw}
        for k, v in self.kw.items():
            setattr(self.mod, k, v)
        return self

    def __exit__(self, *a):
        for k, v in self.old.items():
            setattr(self.mod, k, v)
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
