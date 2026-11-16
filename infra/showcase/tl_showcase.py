#!/usr/bin/env python3
"""Showcase timelapse: incremental BlueMap render -> two fixed-camera frames, every CAPTURE_MIN minutes.

Runs ON THE SHOWCASE VM (docs/reports/showcase-2026-10-20.md section 6), from a systemd timer, as user `mike`.
Under the one save-pause lock (rcon.SaveHold: save-off + save-all flush ... save-on) it copies the masked region files
and level.dat into a persistent MIRROR (BlueMap never reads a file Paper is writing; the world is never edited),
renders ONLY the chunks modified since the last render (`-r` without `-f`, from the mirror), and photographs the persistent BlueMap webserver (127.0.0.1:8100,
showcase-bluemap-web.service) with the same puppeteer capture.mjs the .30 timelapse uses.

    tl_showcase.py capture [--event LABEL] [--frame0]   render + both frames + one heartbeat row
    tl_showcase.py render-full                          the ONE full render before frame 0 (never from the timer)
    tl_showcase.py status                               the heartbeat line fleetstatus prints
    tl_showcase.py shoot --views a,b --out DIR [--wait-s 900] [--render]
                                                        a VERIFICATION capture: same renderer, same lock, never frames/
    tl_showcase.py plan                                 what the next slot would shoot and why (read-only)

THE RENDERER LOCK (tlvideo-01; audit 11-02 flag 8: a 14-view verification run shared the BlueMap web server and the
13:30Z slot was killed): logs/renderer.lock, flock, held from the snapshot through the last screenshot by `capture`,
`render-full` and `shoot`. The timer's capture never waits (a busy renderer is a `skip` row naming the holder); `shoot`
waits up to --wait-s for the slot to finish.
THE SCHEDULE (tlvideo-01): every slot shoots the pair; each other camera is DUE when its interval has passed since its
last frame -- `interval_min` while ACTIVE (its `project` record placed a block, or its own last frames changed, within
`active_hours`), `idle_min` otherwise. Due cameras are shot most-overdue first, active first, until the slot's BUDGET
(budget_s from the run's start); capture.mjs itself skips a job that would end past the deadline, so a slot is never
killed wholesale and the rest waits for the next slot. logs/views.json keeps each camera's last frame, last change and
per-frame cost.

THE DIRECTOR (camdirector-01, owner 11-16 "show what the bots are working on"): while tl.conf says
"director": {"on": true}, tl_director.py reads the tail of the bots' logs each slot, finds the live SCENES (where the
bots are, in three layers), and hands this slot one camera per live surface scene (`scene-<id>`, framed like a follow
camera). They are shot right after the pair, AHEAD of every fixed camera, inside the same budget_s and inside
director.scene_budget_s; the cameras in director.replaces give up their slot to them, the cameras in
director.idle_only keep their idle interval, and a slot that shoots a scene camera plans no more than
director.slot_s in all (a fixed camera that no longer fits waits a slot; one that has waited overdue_n of its own
intervals has its seconds set aside before the scene cameras get theirs -- plan_views). Underground scenes go to
logs/scenes-slot.json for tl_under.py. With "on": false (or no `director` key) none of this runs and the plan is
exactly the one above. THE DIRECTOR CAN ADD FRAMES TO A SLOT, NEVER TAKE THE ORDINARY ONES AWAY: its whole
contribution is fenced (slot_plan, director_done) -- any exception, any value the slot cannot use, a repaired
scenes.json, and the slot is planned and shot as with the director off; the heartbeat row says why once, in
`director_error`.

A FAILED STEP IS A ROW, NOT A CRASH: the heartbeat records ok:false and the failed step; no frame is written for
that slot; the next timer run tries again. Two captures never overlap (flock -n; an overrun is a `skip` row).
The two views are published together or not at all, and each must be a rendered frame (size + terrain check).

Config: /srv/showcase/timelapse/tl.conf (JSON; CAPTURE_MIN lives in the systemd timer AND here, and the status
line warns if they differ).
"""
import argparse, datetime as dt, fcntl, json, os, re, resource, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts', 'lib'))
from showcasestatus import missing_slots       # noqa: E402  (one implementation, shared with fleetstatus)

CONF = os.environ.get('TL_CONF', '/srv/showcase/timelapse/tl.conf')
NICE = ['nice', '-n', '19', 'ionice', '-c3']
VIEWS = ('topdown', 'angled')        # the PAIR: published together or not at all; the missing-slot count reads it
DEFAULT_INTERVAL_MIN = 15            # an ACTIVE camera: every slot
DEFAULT_IDLE_MIN = 120               # a quiet camera: every 2 h
DEFAULT_ACTIVE_HOURS = 3.0
DEFAULT_BUDGET_S = 690               # 11.5 min of the 13-min TimeoutStartSec backstop; the timer is every 15 min
DEFAULT_FRAME_S = 60.0               # the cost guess for a camera with no measured frame yet
CHANGE_FRAC = 0.002                  # = tl_video MIN_CHANGED_FRAC: a frame "changed" when this share of pixels moved
CHANGE_LEVEL = 12


def slot_pair(cfg, t):
    """The views published together this slot. A view in tl.conf `pair_hourly` (timelapse2-1110: topdown) is in the
    pair only in the slot that starts on the hour (minute < capture_min); every other slot publishes the rest of the
    pair alone. Pure (tested)."""
    hourly = set(cfg.get('pair_hourly') or ())
    return tuple(v for v in VIEWS if v not in hourly or t.minute < int(cfg.get('capture_min') or 15))


def base_pair(cfg):
    """The views in EVERY slot's pair: the missing-slot count reads these. Pure (tested)."""
    hourly = set(cfg.get('pair_hourly') or ())
    return tuple(v for v in VIEWS if v not in hourly) or VIEWS


def extra_views(cfg, stamp=None):
    """Cameras beyond the pair (owner 10-25: `town`, a close-up on home). Each is captured in the SAME browser run and
    published on its own -- a failed extra frame never costs the pair, and the pair's slot accounting is unchanged.
    Sorted, so the order is stable. Pure.

    A camera may name a CADENCE (expedition-01, 10-31: the eleventh camera pushed the run past the service's 13-minute
    TimeoutStartSec and four slots were killed): `every` N slots (a slot is a 15-minute stamp), on the slots whose index
    (minutes of the day // 15) is `phase` mod N. With a stamp, only the cameras due in that slot; without one, all."""
    out = []
    t = parse_stamp(stamp) if stamp else None
    slot = (t.hour * 60 + t.minute) // 15 if t else None
    for v, cam in (cfg.get('cameras') or {}).items():
        if v in VIEWS:
            continue
        n = int((cam or {}).get('every') or 1)
        if slot is not None and n > 1 and slot % n != int((cam or {}).get('phase') or 0) % n:
            continue
        out.append(v)
    return sorted(out)


# Marker sets a camera shows unless it names its own `markers` list (11-02): the `town` home pin every camera carried
# before 11-01. The whole-map route layer (wm-*: trails, zone boxes, expedition pins) belongs to the `expeditions`
# camera only; on any other view it buried the frame.
DEFAULT_MARKERS = ('town',)


def camera_markers(cam):
    """The marker-set ids capture.mjs leaves visible for this camera; every other set is hidden. Pure (tested)."""
    m = (cam or {}).get('markers')
    return [str(x) for x in m] if isinstance(m, list) else list(DEFAULT_MARKERS)


# QUALITY + HERO CAMERAS (tlpolish-1106, owner 11-07 "as nice as possible"; picks: 4K hero cameras only, the other
# cameras keep their size with BlueMap's hi-detail distance raised to 500).
#   Per camera (else the tl.conf top-level default): `dpr` (device scale factor), `hires`/`lowres` (BlueMap's loaded
#   view distances), `sun`/`ambient` (a fixed daytime light). capture.mjs applies them per job.
#   `heavy`: a 4K camera. At most heavy_per_slot of them per slot (two 4K cameras alternate instead of doubling one
#   slot), and they are shot after every other camera (a scale change costs a fresh page).
#   `follow`: the camera frames the ACTIVE PROJECT -- the boxed project record that placed a block most recently,
#   kept while it is still active (no flip-flop between two busy sites), framed from its box (follow_camera).
#   camdirector-01 (owner 11-16: "projects that are finished"): a target must have placed within follow_max_age_h
#   (tl.conf, default 6 h; the camera's own `max_age_h` wins) -- with none, the camera takes NO frame that slot (it
#   used to frame the last project for days). A COMPLETED record (structure_complete / state "complete") gets ONE
#   final frame after its completion and is then dropped as a target (views.json <camera>.finals remembers which).
#   Each published frame of a follow/labelled camera gets a <stamp>.json sidecar {label, project} for the video captions.
DEFAULT_HEAVY_PER_SLOT = 1
DEFAULT_FOLLOW_MAX_AGE_H = 6.0       # a follow camera's target must have placed within this (0 / null: no limit)
DEFAULT_OVERDUE_N = 2.0              # a fixed camera not shot for this many of its intervals goes before the scene cameras
DEFAULT_SCENE_WAIT_SLOTS = 2         # after this many slots in a row with scenes live and no scene frame: one goes first
QUALITY_KEYS = ('dpr', 'hires', 'lowres', 'sun', 'ambient')


def cam_quality(cfg, cam):
    """The render settings capture.mjs gets for one camera: the camera's own value, else tl.conf's top-level default,
    else absent (the page default). Pure (tested)."""
    out = {}
    for k in QUALITY_KEYS:
        v = (cam or {}).get(k, cfg.get(k))
        if v is not None:
            out[k] = v
    return out


def final_key(site):
    """What views.json records once a completed site has had its final frame: the record's completeAt (a rebuilt and
    re-completed project gets a final frame again), else True. Pure (tested)."""
    return (site or {}).get('complete_at') or True


def follow_target(cam, sites, progress, prev, now, hours, max_age_h=DEFAULT_FOLLOW_MAX_AGE_H, finals=None):
    """The project a `follow` camera frames this slot. sites: {name: {'box': [x0, z0, x1, z1], ...}} (boxed project
    records only; a completed one carries 'complete': True); progress: {name: last placement datetime}. A candidate
    placed within max_age_h (falsy: no limit) and is not in cam['exclude']. A COMPLETED candidate is a target for one
    frame only: while finals (views.json <camera>.finals: {name: final_key}) does not name its completion it goes
    FIRST (the final frame is owed), afterwards it is never a target. Otherwise: keep `prev` while it placed within
    `hours`, else the candidate with the most recent placement. None when there is no candidate: the camera takes no
    frame. Pure (tested)."""
    lim = now - dt.timedelta(hours=hours)
    excl = set((cam or {}).get('exclude') or ())
    cands = {n: progress[n] for n in sites if n not in excl and progress.get(n)}
    if max_age_h:
        oldest = now - dt.timedelta(hours=float(max_age_h))
        cands = {n: t for n, t in cands.items() if t >= oldest}
    done = {n for n in cands if (sites[n] or {}).get('complete')}
    owed = {n: cands[n] for n in done if (finals or {}).get(n) != final_key(sites[n])}
    if owed:
        return max(sorted(owed), key=lambda n: owed[n])
    cands = {n: t for n, t in cands.items() if n not in done}
    if prev in cands and cands[prev] >= lim:
        return prev
    if not cands:
        return None
    return max(sorted(cands), key=lambda n: cands[n])


def note_final(vstate, target, site):
    """The follow camera's state after a published frame of `target`: a completed site's final frame is recorded in
    `finals` (so follow_target drops it); anything else is unchanged. Pure (tested)."""
    if not target or not (site or {}).get('complete'):
        return vstate
    vs = dict(vstate or {})
    vs['finals'] = dict(vs.get('finals') or {}, **{target: final_key(site)})
    return vs


def follow_camera(cam, name, site):
    """The concrete camera for a follow camera on one site: the box centre at ground level, a distance that fits the
    box in the frame (fov 32: about 2.6x its larger side, never closer than min_distance), the camera's own rotation /
    angle / fov, and any per-site override from cam['sites'][name]. Pure (tested)."""
    x0, z0, x1, z1 = site['box']
    lo_x, hi_x, lo_z, hi_z = min(x0, x1), max(x0, x1), min(z0, z1), max(z0, z1)
    size = max(hi_x - lo_x, hi_z - lo_z) + 1
    c = {k: v for k, v in cam.items() if k not in ('follow', 'sites', 'exclude')}
    c.update(x=round((lo_x + hi_x + 1) / 2, 1), z=round((lo_z + hi_z + 1) / 2, 1),
             y=int(site.get('g') or cam.get('y') or 69),
             distance=int(max(cam.get('min_distance', 45), round(cam.get('fit', 2.6) * size))))
    c.update(((cam.get('sites') or {}).get(name) or {}))
    c['label'] = (((cam.get('sites') or {}).get(name) or {}).get('label')) or name
    c['project'] = [name]
    return c


def record_completion(rec):
    """{} for an open project record, {'complete': True, 'complete_at': ms or None} for a completed one: the record's
    own `structure_complete` (true) or `state` ('complete'), and its `completeAt`. Pure (tested)."""
    if not isinstance(rec, dict) or not (rec.get('structure_complete') is True or rec.get('state') == 'complete'):
        return {}
    at = rec.get('completeAt')
    return {'complete': True, 'complete_at': at if isinstance(at, (int, float)) and not isinstance(at, bool) else None}


def project_sites(cfg):
    """{name: {'box': [...], 'g': ground}} from the newest live (not .released) project-<town>.<name>.g<N>.json record
    that carries a box (read-only). Unreadable or boxless records are absent. A COMPLETED record (bots/src/skills.mjs
    publishes `structure_complete: true, state: 'complete', completeAt: <ms>`) also carries 'complete': True and
    'complete_at' (the ms, or None)."""
    import glob, re
    d = cfg.get('project_dir', '/var/lib/mcai/_pool-showcase')
    best = {}
    for p in glob.glob(os.path.join(d, 'project-*.g*.json')):
        m = re.match(r'project-[^.]+\.([^.]+)\.g(\d+)\.json$', os.path.basename(p))
        if not m:
            continue
        name, gen = m.group(1), int(m.group(2))
        if name in best and best[name][0] >= gen:
            continue
        try:
            j = json.load(open(p))
        except (OSError, ValueError):
            continue
        box = j.get('box') if isinstance(j, dict) else None
        if isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box):
            g = (j.get('site') or {}).get('g') if isinstance(j.get('site'), dict) else None
            best[name] = (gen, dict({'box': box, 'g': g}, **record_completion(j)))
    return {n: v for n, (_, v) in best.items()}


def resolve_cameras(cfg, state, now, progress, sites):
    """tl.conf's cameras with every `follow` camera made concrete for this slot (follow_target + follow_camera); a follow
    camera with no target (nothing placed within follow_max_age_h, or only finished projects whose final frame is
    taken) is `off` this slot. -> (cameras, {view: target}). Pure (tested)."""
    hours = float(cfg.get('active_hours') or DEFAULT_ACTIVE_HOURS)
    cams, targets = {}, {}
    for v, cam in (cfg.get('cameras') or {}).items():
        if not (cam or {}).get('follow'):
            cams[v] = cam
            continue
        vs = state.get(v) or {}
        age = cam.get('max_age_h', cfg.get('follow_max_age_h', DEFAULT_FOLLOW_MAX_AGE_H))
        t = follow_target(cam, sites, progress, vs.get('target'), now, hours, max_age_h=age, finals=vs.get('finals'))
        if t is None:
            cams[v] = dict(cam, off=True)
            continue
        cams[v] = follow_camera(cam, t, sites[t])
        targets[v] = t
    return cams, targets


def cam_interval(cfg, cam, active):
    """Minutes between frames for one camera: interval_min while active, idle_min otherwise. A legacy `every` N
    (slots of 15 min) is the idle interval when idle_min is absent. A camera marked `idle_only` (the director sets it
    on director.idle_only cameras while it is on) never gets the active interval. Pure (tested)."""
    cam = cam or {}
    if active and not cam.get('idle_only'):
        return float(cam.get('interval_min') or cfg.get('interval_min') or DEFAULT_INTERVAL_MIN)
    if cam.get('idle_min'):
        return float(cam['idle_min'])
    if cam.get('every'):
        return float(int(cam['every']) * 15)
    return float(cfg.get('idle_min') or DEFAULT_IDLE_MIN)


def _iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def _t(s):
    try:
        return dt.datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=dt.timezone.utc)
    except (TypeError, ValueError):
        return None


def cam_active(cfg, cam, vstate, now, progress):
    """ACTIVE when the camera's `project` record(s) placed a block within active_hours (progress: {name: datetime}),
    or its own last change is that recent. -> (bool, why). Pure (tested)."""
    hours = float(cfg.get('active_hours') or DEFAULT_ACTIVE_HOURS)
    lim = now - dt.timedelta(hours=hours)
    names = (cam or {}).get('project') or []
    names = [names] if isinstance(names, str) else list(names)
    for n in names:
        if progress.get(n) and progress[n] >= lim:
            return True, f'project {n} placed {_iso(progress[n])}'
    ch = _t((vstate or {}).get('last_change'))
    if ch and ch >= lim:
        return True, f'frame changed {_iso(ch)}'
    return False, 'quiet'


def plan_views(cfg, state, now, progress, budget_s, spent_s=0.0, pair=VIEWS, first=(), first_budget_s=None, slot_s=None,
               first_wait=0):
    """The cameras this slot shoots, in order: the pair always first, then every DUE camera (its interval has passed
    since its last frame, 2 min of slack for timer jitter), active before idle, most overdue first, until the estimated
    cost reaches the budget. -> (views, why {view: reason}, deferred [views]). Pure (tested).

    `first` (camdirector-01: the director's scene cameras, in its order) are shot right after the pair, AHEAD of every
    due camera: each one that fits what is left of the slot AND of first_budget_s (their own ceiling per slot; None:
    no ceiling of their own); they are never in the due list. A slot that shoots one plans no more than slot_s in all
    (plan_budget). With first=() the plan is the plan it always was: nothing below applies.

    NO FIXED CAMERA STARVES BEHIND THEM (Codex r1, 11-16: with 120 s of snapshot + render, the pair and two 40-s scene
    frames, the 150-s hero4k never fitted again). A due camera not shot for overdue_n (tl.conf director.overdue_n,
    default 2) of its own intervals is OWED: its seconds are set aside BEFORE the scene cameras get theirs, most
    overdue first, one 4K camera per slot as ever, and it is shot this slot; the scene cameras take what is left (one
    fewer, or none). So with scenes live in every slot a fixed camera's longest gap is overdue_n x its interval
    (hero4k, every 30 min: 60 min), plus one slot for each camera owed ahead of it that the slot could not also hold.
    When an owed camera does not fit under slot_s even with no scene frame at all (a slow render), the slot shoots NO
    scene camera and is planned under budget_s alone, as a slot without a director is: slot_s is the ceiling of slots
    that carry scene frames, never a reason to drop a fixed camera for good.

    AND NO SCENE STARVES BEHIND THE OWED CAMERAS (Codex r2, 11-16: three 210-s cameras on 15-min intervals are owed in
    turn for ever and took every slot's seconds; no scene frame was ever shot). first_wait: the slots in a row, up to
    now, in which scene cameras were live and none got a frame (the director counts them: scenes.json scene_wait).
    At scene_wait_slots (tl.conf director.scene_wait_slots, default 2) ONE scene frame -- the first in the director's
    order -- is set aside FIRST, ahead of the owed fixed cameras, and the slot stays under slot_s; the owed cameras
    get what is left, or the next slot.
    THE BOUNDS, both sides, while the frame in question fits the slot at all (a scene frame under slot_s; a fixed
    camera under budget_s):
      scenes   never more than scene_wait_slots (2) slots in a row without a scene frame: with a scene live, at most
               (2 + 1) x 15 = 45 min between scene frames;
      fixed    a camera that would be shot within G slots with no scene frame set aside waits one more slot for each
               one that is, and there is at most one of those in every scene_wait_slots + 1 slots: at most
               G + ceil(G / scene_wait_slots) slots. Three 210-s cameras taking turns (G = 3): 5 slots, 75 min.
               The template's hero4k (G = 4 slots, 60 min): its bound would be 6 slots, but there the reservation
               never fires -- scene frames are shot in 3 slots of 4 -- and its longest gap stays 60 min (tested)."""
    cams = cfg.get('cameras') or {}
    est = lambda v: float((state.get(v) or {}).get('frame_s') or (cams.get(v) or {}).get('est_s') or cfg.get('frame_s')
                          or DEFAULT_FRAME_S)
    heavy_left = int(cfg.get('heavy_per_slot', DEFAULT_HEAVY_PER_SLOT))
    left = budget_s - spent_s - sum(est(v) for v in pair)
    due, why = [], {v: 'pair' for v in pair}
    first = [v for v in first if v in cams and v not in VIEWS and not (cams[v] or {}).get('off')]
    # the director's own settings are read ONLY while its cameras are in the slot: a slot without them never depends
    # on anything the director wrote or was configured with
    owed_n = float((cfg.get('director') or {}).get('overdue_n') or DEFAULT_OVERDUE_N) if first else None
    owed = []
    for v in sorted(cams):
        if v in VIEWS or v in first or (cams[v] or {}).get('off') or (cams[v] or {}).get('event_only'):
            continue
        vs = state.get(v) or {}
        act, aw = cam_active(cfg, cams[v], vs, now, progress)
        iv = cam_interval(cfg, cams[v], act)
        last = _t(vs.get('last'))
        age = (now - last).total_seconds() / 60 if last else 1e9
        if age + 2 >= iv:
            due.append((0 if act else 1, -age / iv, v, f'{"active" if act else "idle"} every {iv:g} min; '
                                                       f'{"never shot" if not last else f"last {age:.0f} min ago"}; {aw}'))
            if first and age + 2 >= owed_n * iv:
                owed.append((-age / iv, v))
    lead, late, held = [], [], []
    if first:                       # the director's scene cameras: before every fixed camera, inside the slot's ceilings
        capped = plan_budget(budget_s, slot_s) - spent_s - sum(est(v) for v in pair)
        room = float('inf') if first_budget_s is None else float(first_budget_s)
        wait_n = int((cfg.get('director') or {}).get('scene_wait_slots') or DEFAULT_SCENE_WAIT_SLOTS)
        scene_owed = first_wait >= wait_n and est(first[0]) <= capped and est(first[0]) <= room
        if not scene_owed and any(capped < est(v) <= left for _, v in owed):
            late = list(first)      # an owed camera cannot fit under slot_s at all: no scene frame, budget_s alone
        else:
            left = capped
            keep, heavy_keep = left, heavy_left
            if scene_owed:          # the scenes have waited scene_wait_slots slots: ONE scene frame before anything owed
                lead.append(first[0])
                why[first[0]] = (f'scene (no scene frame for {first_wait} slots: before the owed cameras): '
                                 + str(((cams[first[0]] or {}).get('scene') or {}).get('caption') or ''))
                keep, left, room = keep - est(first[0]), left - est(first[0]), room - est(first[0])
            for _, v in sorted(owed):               # set aside the owed cameras' seconds, most overdue first
                is_heavy = bool((cams[v] or {}).get('heavy'))
                if est(v) <= keep and (not is_heavy or heavy_keep > 0):
                    held.append(v)
                    keep -= est(v)
                    heavy_keep -= is_heavy
            for v in first[len(lead):]:
                if est(v) <= keep and est(v) <= room:
                    lead.append(v)
                    why[v] = 'scene: ' + str(((cams[v] or {}).get('scene') or {}).get('caption') or 'ahead of the fixed cameras')
                    keep -= est(v)
                    left -= est(v)
                    room -= est(v)
                else:
                    late.append(v)
    out, deferred, heavy = list(pair), [], []
    out += lead
    deferred += late
    ordered = sorted(due)
    for _, _, v, w in [d for d in ordered if d[2] in held] + [d for d in ordered if d[2] not in held]:
        is_heavy = bool((cams[v] or {}).get('heavy'))
        if est(v) <= left and (not is_heavy or heavy_left > 0):
            (heavy if is_heavy else out).append(v)
            why[v] = w + ('; owed: its seconds were set aside before the scene cameras' if v in held else '')
            left -= est(v)
            heavy_left -= is_heavy
        else:
            deferred.append(v)
    return out + heavy, why, deferred


def plan_budget(budget_s, slot_s):
    """The seconds a slot that shoots a scene camera may plan: budget_s, or the director's slot_s when that is lower.
    Pure (tested)."""
    return min(float(budget_s), float(slot_s)) if slot_s else budget_s


def director_on(cfg):
    """The activity director runs only under an explicit tl.conf "director": {"on": true}. Pure (tested)."""
    return bool(((cfg or {}).get('director') or {}).get('on'))


class DirectorRefused(Exception):
    """Something the director handed the slot cannot be used as it is (or its state had to be repaired)."""


def _finite(v, lo, hi):
    return not isinstance(v, bool) and isinstance(v, (int, float)) and v == v and lo <= v <= hi


SCENE_VIEW_RX = re.compile(r'scene-[A-Za-z0-9]{1,40}')
DIRECTOR_MARKS = ('idle_only', 'off', 'off_why')      # the only keys the director may set on a fixed camera


def check_scene_camera(cfg, v, cam):
    """A camera the director supplies is used ONLY IF the slot can use every value of it: its name is a safe frames
    directory, every number capture.mjs and the plan read is a finite number in range, its `scene` block is what the
    sidecar needs, and the capture job builds (job_spec). Anything else raises DirectorRefused. Pure (tested)."""
    if not (isinstance(v, str) and SCENE_VIEW_RX.fullmatch(v)) or not isinstance(cam, dict):
        raise DirectorRefused(f'scene camera {str(v)[:60]!r}: not a usable name or not an object')
    for k, lo, hi in (('x', -3e7, 3e7), ('z', -3e7, 3e7), ('y', -2048, 4096), ('distance', 1, 5000), ('rotation', -10, 10),
                      ('angle', -10, 10), ('est_s', 0.001, 600), ('fov', 1, 179), ('width', 16, 8192), ('height', 16, 8192),
                      ('settle_ms', 0, 120000)):
        if k in ('est_s', 'fov', 'width', 'height', 'settle_ms') and cam.get(k) is None:
            continue
        if not _finite(cam.get(k), lo, hi):
            raise DirectorRefused(f'scene camera {v}: {k} = {str(cam.get(k))[:40]!r} is not a number in {lo}..{hi}')
    sc = cam.get('scene')
    if (cam.get('ortho') not in (0, 1) or cam.get('mode') not in ('perspective', 'flat') or cam.get('heavy')
            or not isinstance(cam.get('label'), str) or not isinstance(sc, dict) or 'scene-' + str(sc.get('id')) != v
            or not isinstance(sc.get('caption'), str) or not isinstance(sc.get('bots'), list)
            or not all(isinstance(b, str) for b in sc['bots']) or not isinstance(sc.get('layer'), str)):
        raise DirectorRefused(f'scene camera {v}: ortho, mode, label or its scene block is not usable')
    json.dumps(job_spec(cfg, v, cam, 'x.png'), allow_nan=False)
    json.dumps(frame_sidecar(cam, None), allow_nan=False)


def director_plan(cfg, cams, targets, state, now, progress, sites, budget_s, spent, pair, stamp=None, write=True):
    """THE DIRECTOR'S WHOLE CONTRIBUTION TO THE PLAN, in one place so slot_plan can fence it: the pass
    (tl_director.run), its cameras (apply_cameras), every planning input it supplies (the scene cameras in order,
    scene_budget_s, slot_s, scene_wait), the plan made with them, and the heartbeat summary. Every value is checked
    before the plan may use it; anything unusable raises (DirectorRefused, or whatever tl_director raised) and
    slot_plan plans the slot without the director. A scenes.json that had to be repaired raises too -- the pass has
    by then rewritten it clean, so the next slot is normal. -> the plan dict of slot_plan."""
    import tl_director as D
    res = D.run(cfg, now, sites, stamp=stamp, frame=follow_camera, write=write)
    if not isinstance(res, dict) or not isinstance(res.get('dc'), dict):
        raise DirectorRefused('tl_director.run returned no result')
    if res.get('repaired'):
        raise DirectorRefused('scenes.json had to be repaired (the slot\'s pass leaves it clean): ' + '; '.join(map(str, res['repaired']))[:300])
    scene_cams, first = res.get('cameras'), res.get('first')
    if not isinstance(scene_cams, dict) or not isinstance(first, (list, tuple)) or sorted(first) != sorted(scene_cams):
        raise DirectorRefused('the scene cameras and their shooting order do not match')
    dcams = D.apply_cameras(cams, res['dc'], scene_cams)
    if not isinstance(dcams, dict) or set(dcams) != set(cams) | set(first):
        raise DirectorRefused('apply_cameras added or lost a camera')
    for v in cams:                          # a fixed camera comes back as it went in, but for the director's marks
        if {k: x for k, x in (dcams[v] or {}).items() if k not in DIRECTOR_MARKS} != \
                {k: x for k, x in (cams[v] or {}).items() if k not in DIRECTOR_MARKS}:
            raise DirectorRefused(f'apply_cameras changed the fixed camera {v}')
    for v in first:
        check_scene_camera(cfg, v, dcams[v])
    limits = {}
    for k in ('scene_budget_s', 'slot_s'):
        limits[k] = res['dc'].get(k)
        if limits[k] is not None and not _finite(limits[k], 0, 86400):
            raise DirectorRefused(f'director.{k} = {str(limits[k])[:40]!r} is not a number of seconds')
    wait = (res.get('state') or {}).get('scene_wait') or 0
    if not _finite(wait, 0, 10 ** 6):
        raise DirectorRefused(f'scene_wait = {str(wait)[:40]!r} is not a count')
    views, why, deferred = plan_views(dict(cfg, cameras=dcams), state, now, progress, budget_s, spent(), pair=pair,
                                      first=tuple(first), first_budget_s=limits['scene_budget_s'], slot_s=limits['slot_s'],
                                      first_wait=int(wait))
    if list(views[:len(pair)]) != list(pair) or len(set(views)) != len(views) or not set(views) <= set(dcams):
        raise DirectorRefused('the plan made with the scene cameras is not a plan')
    summary = D.summary(res)
    if not isinstance(summary, dict):       # Codex r4: ['broken'] is valid JSON and no heartbeat object
        raise DirectorRefused(f'tl_director.summary returned a {type(summary).__name__}, not an object')
    json.dumps(summary, allow_nan=False)
    # the sidecar of every scene frame, made HERE: after this function returns, nothing the slot does calls into the
    # director's objects again outside director_done's own try
    sidecars = {v: frame_sidecar(dcams[v], None) for v in first}
    json.dumps(sidecars, allow_nan=False)
    return {'cams': dcams, 'targets': targets, 'views': views, 'why': why, 'deferred': deferred, 'director': res,
            'summary': summary, 'sidecars': sidecars, 'director_error': None}


def slot_plan(cfg, state, now, progress, sites, budget_s, spent, pair, stamp=None, write=True):
    """EVERYTHING a slot decides before the browser runs -> {'cams': the slot's cameras, 'targets': {follow camera:
    project}, 'views', 'why', 'deferred', 'director': the director's result or None, 'summary': its heartbeat object,
    'director_error': None or "<ExceptionType>: <message>"}. spent(): the seconds the slot has used so far.

    THE FENCE (Codex r3, 11-16). With the director off (director_on) this is resolve_cameras + plan_views, nothing
    else, and tl_director.py is not imported. With it on, the director's whole contribution is director_plan, inside
    ONE try: whatever it raises -- tl_director missing or failing anywhere, a value the slot cannot use, a repaired
    scenes.json -- the slot is planned by that same director-off path, from cameras the director never touched, and
    the reason goes ONCE into the heartbeat row as `director_error`. The capture then shoots that plan: the director
    can add frames to a slot, it cannot take the ordinary ones away. write False (the `plan` command): the director
    writes nothing."""
    cams, targets = resolve_cameras(cfg, state, now, progress, sites)

    def without_director(error=None):
        views, why, deferred = plan_views(dict(cfg, cameras=cams), state, now, progress, budget_s, spent(), pair=pair)
        return {'cams': cams, 'targets': targets, 'views': views, 'why': why, 'deferred': deferred, 'director': None,
                'summary': None, 'sidecars': {}, 'director_error': error}
    if not director_on(cfg):
        return without_director()
    try:
        return director_plan(cfg, cams, targets, state, now, progress, sites, budget_s, spent, pair, stamp, write)
    except Exception as e:
        return without_director(f'{type(e).__name__}: {str(e)[:300]}')


def director_done(cfg, plan, published, timings, now, state):
    """After the slot's frames are published: tell the director which scene cameras got theirs (and how long a scene
    frame took), and drop the schedule memory (views.json entry, gray file) of scene cameras that are no longer live,
    so neither grows without bound. -> (the director's heartbeat object or None, None or the error). Fenced like
    slot_plan: the frames are on disk by now, so whatever fails here -- tl_director.finish, or any object the
    director left in the plan turning out not to be what it should -- the slot still saves its own state and writes
    its heartbeat row, with the error in `director_error`. Nothing in here is used outside the try, and what goes
    into the row is a dict that is known to serialise."""
    if not plan.get('director'):
        return None, None
    row, err = {}, None
    try:
        import tl_director as D
        cams, shots = plan['cams'], {}
        for v in published:
            sc = (cams.get(v) or {}).get('scene')
            if sc:
                shots[sc['id']] = timings.get(v) if isinstance(timings.get(v), (int, float)) else None
        row = dict(plan['summary'], shot=sorted(shots))
        json.dumps(row, allow_nan=False)
        for v in [k for k in state if k.startswith('scene-') and k not in cams]:
            del state[v]
            try:
                os.remove(os.path.join(cfg['root'], 'logs', 'gray', v + '.gray'))
            except OSError:
                pass
        D.finish(cfg, plan['director'], shots, now)
    except Exception as e:
        err = f'{type(e).__name__}: {str(e)[:300]}'
        try:                                # whatever is put in the heartbeat row can be written there
            json.dumps(row, allow_nan=False)
        except Exception:
            row = {}
    return (row if isinstance(row, dict) and row else None), err


def project_progress(cfg):
    """{project name: last placement time} from the showcase pool's project-<town>.<name>.progress.json records
    (read-only). A missing or unreadable record is simply absent."""
    import glob
    d = cfg.get('project_dir', '/var/lib/mcai/_pool-showcase')
    out = {}
    for p in glob.glob(os.path.join(d, 'project-*.progress.json')):
        name = os.path.basename(p).split('.')[1] if os.path.basename(p).count('.') >= 3 else None
        try:
            at = json.load(open(p)).get('at')
            t = dt.datetime.fromtimestamp(at / 1000, dt.timezone.utc)
        except (OSError, ValueError, TypeError, AttributeError):
            continue
        if name and (name not in out or t > out[name]):
            out[name] = t
    return out


def state_path(cfg):
    return os.path.join(cfg['root'], 'logs', 'views.json')


def load_state(cfg):
    try:
        return json.load(open(state_path(cfg)))
    except (OSError, ValueError):
        return {}


def save_state(cfg, st):
    p = state_path(cfg)
    with open(p + '.part', 'w') as f:
        json.dump(st, f, indent=1, sort_keys=True)
    os.replace(p + '.part', p)


def changed_fraction(a, b, level=CHANGE_LEVEL):
    """Share of pixels (two equal-length grayscale byte strings) that moved by more than level. Pure (tested)."""
    if len(a) != len(b) or not a:
        return 1.0
    return sum(1 for x, y in zip(a, b) if abs(x - y) > level) / len(a)


def update_view_state(vs, now, gray, prev_gray, frame_s, frac=CHANGE_FRAC):
    """One published frame -> the camera's new state: last, last_change (when it moved >= frac vs the previous frame),
    an EWMA of its per-frame seconds, the last changed fraction. Pure (tested)."""
    vs = dict(vs or {})
    vs['last'] = _iso(now)
    f = changed_fraction(prev_gray, gray) if prev_gray else None
    vs['changed'] = None if f is None else round(f, 5)
    if f is not None and f >= frac:
        vs['last_change'] = _iso(now)
    if frame_s:
        old = vs.get('frame_s')
        vs['frame_s'] = round(frame_s if not old else 0.6 * old + 0.4 * frame_s, 1)
    return vs


class RendererBusy(Exception):
    pass


class renderer_lock:
    """The ONE renderer lock (logs/renderer.lock): BlueMap CLI render + web server + capture.mjs. wait_s=0 -> raise
    RendererBusy at once (naming the holder); otherwise wait up to wait_s."""
    def __init__(self, cfg, owner, wait_s=0):
        self.path, self.owner, self.wait_s = os.path.join(cfg['root'], 'logs', 'renderer.lock'), owner, wait_s

    def __enter__(self):
        self.f = open(self.path, 'a+')
        t0 = time.time()
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.time() - t0 >= self.wait_s:
                    self.f.seek(0)
                    holder = self.f.read().strip()[:200]
                    self.f.close()
                    raise RendererBusy(holder or 'unknown holder')
                time.sleep(2)
        self.f.seek(0)
        self.f.truncate()
        self.f.write(json.dumps({'owner': self.owner, 'pid': os.getpid(), 't': _iso(now_utc())}))
        self.f.flush()
        return self

    def __exit__(self, *a):
        try:
            self.f.seek(0)
            self.f.truncate()
        finally:
            self.f.close()
        return False


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def stamp_of(t):
    return t.strftime('%Y%m%dT%H%MZ')


def parse_stamp(s):
    """'20261020T1315Z' or '20261020T1315Z-event-label' -> aware datetime, else None."""
    try:
        return dt.datetime.strptime(s[:14], '%Y%m%dT%H%MZ').replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def camera_hash(map_id, cam):
    """BlueMap 5 URL hash: map:x:y:z:distance:rotation:angle:tilt:ortho:mode. Pure (tested)."""
    return (f"#{map_id}:{cam['x']:.1f}:{cam['y']}:{cam['z']:.1f}:{cam['distance']}:"
            f"{cam['rotation']:.4f}:{cam['angle']:.4f}:0:{cam['ortho']}:{cam['mode']}")


def load_conf():
    with open(CONF) as f:
        return json.load(f)


def heartbeat(cfg, row):
    f0 = frame0_time(cfg)
    row = dict(row, t=now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), kind='showcase_timelapse',
               capture_min=cfg['capture_min'], frame0_t=f0.strftime('%Y-%m-%dT%H:%M:%SZ') if f0 else None,
               brain=cfg.get('_brain'))
    os.makedirs(os.path.dirname(cfg['heartbeat']), exist_ok=True)
    with open(cfg['heartbeat'], 'a') as f:
        f.write(json.dumps(row) + '\n')
    print(json.dumps(row), flush=True)


def child_cpu_s():
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


def regions_for(cx, cz, half):
    """Region file names whose 512 x 512 area intersects the square [cx-half, cx+half]. Pure (tested)."""
    return [f'r.{rx}.{rz}.mca'
            for rx in range((cx - half) // 512, (cx + half) // 512 + 1)
            for rz in range((cz - half) // 512, (cz + half) // 512 + 1)]


def free_gb(path):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1e9


def snapshot(cfg):
    """Copy the masked region files + level.dat from the live world into the persistent mirror BlueMap reads, so it
    never reads a file Paper is writing (.30 tl.py's method). ONE pass, under the exclusive save-pause lock with saving
    off and flushed, so the copy is consistent; if another owner holds the pause for 120 s the slot is skipped.
    -> (ok, why, n_files)."""
    src = os.path.join(cfg['world'], 'region')
    dst = os.path.join(cfg['mirror'], 'region')
    os.makedirs(dst, exist_ok=True)
    cx, cz = cfg['home'][0], cfg['home'][2]
    try:
        os.listdir(src)          # a permission problem must say so, not read as "no region file"
    except OSError as e:
        return False, f'cannot read the world: {type(e).__name__}: {e}', 0
    files = [r for r in regions_for(cx, cz, cfg['mask_half']) if os.path.isfile(os.path.join(src, r))]
    if not files:
        return False, f'no region file intersects the mask around {cx},{cz}', 0
    # SAVE HOLD: save-off + save-all flush, copy, save-on -- a consistent copy of what Paper has written. The world
    # is the showcase's own; this pauses saving for seconds and edits nothing. save-on runs in `finally`, and every
    # capture also starts with save-on (below), so a killed capture cannot leave saving off for more than one slot.
    import rcon            # infra/showcase/rcon.py, installed beside this file
    try:
        # ONE save-pause owner at a time (rcon.SaveHold): wait up to 120 s for the exclusive pause (the nightly backup
        # stage holds it ~1-3 min); if it is still held, SKIP this slot -- never copy under someone else's pause.
        with (rcon.SaveHold(wait_s=cfg.get('save_wait_s', 120)) if cfg.get('save_hold', True) else _Owned()) as h:
            if not h.held:
                return False, 'save-pause lock held by another owner (the backup stage?) for 120 s; slot skipped', 0
            p = subprocess.run(NICE + ['rsync', '-a', '--files-from=-', src + '/', dst + '/'],
                               input='\n'.join(files) + '\n', text=True, capture_output=True)
            if p.returncode != 0:
                return False, f'rsync rc={p.returncode} {p.stderr.strip()[:200]}', 0
            # level.dat is rewritten by Paper through a 0600 temp file (no ACL reaches it): read it with `sudo -n cat`,
            # exactly as .30's tl.py does; written here 0600 too.
            with open(os.open(os.path.join(cfg['mirror'], 'level.dat.part'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
                              0o600), 'wb') as f:
                p = subprocess.run(['sudo', '-n', 'cat', os.path.join(cfg['world'], 'level.dat')], stdout=f,
                                   stderr=subprocess.PIPE)
            if p.returncode != 0:
                return False, f'level.dat read rc={p.returncode} {p.stderr.decode(errors="replace").strip()[:200]}', 0
            os.replace(os.path.join(cfg['mirror'], 'level.dat.part'), os.path.join(cfg['mirror'], 'level.dat'))
    except Exception as e:
        return False, f'snapshot: {type(e).__name__}: {str(e)[:160]}', 0
    return True, None, len(files)


class _Owned:
    held = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def brain_target(cfg, brain):
    """Where the heartbeat asks whether the bots' brain is up -> (url, model or None). Pure. brain: make_env.load_brain's
    reading of the one brain setting. An Ollama is asked for its model list; the designed proxy (no owner setting) keeps
    tl.conf's brain_healthz (tripbrain-01, 11-16: the heartbeat asked the Studio tunnel for two days after the owner moved
    the bots to the 5080, and fleetstatus said SHOWCASE BRAIN DOWN the whole time)."""
    if brain['kind'] == 'ollama':
        return brain['url'] + '/api/tags', brain['model']
    if brain.get('owner'):
        return brain['url'] + '/healthz', None
    return cfg.get('brain_healthz', brain['url'] + '/healthz'), None


def brain_report(d, model):
    """The answer of brain_target's url -> the heartbeat's `brain` object. Pure. Ollama (model set): ok when the model is
    listed, else an error that names it. The proxy: its own fields, as before."""
    d = d if isinstance(d, dict) else {'error': f'the brain answered {type(d).__name__}, not an object'}
    if model is not None and not d.get('error'):
        names = [m.get('name') for m in d['models'] if isinstance(m, dict)] if isinstance(d.get('models'), list) else None
        d = {'ok': True} if names is not None and model in names else \
            {'error': 'no model list' if names is None else f'{model} is not on the endpoint ({len(names)} models listed)'}
    return {'ok': bool(d.get('ok')), 'paused_by': d.get('paused_by'), 'paused_since': d.get('paused_since'), 'fault': d.get('fault'),
            'error': d.get('error')}


def brain_health(cfg, load=None, get=None):
    """The health of the brain the bots are set to: {'ok', 'paused_by', 'error', ...} -- carried in every heartbeat so a
    stale pause holder (the proxy) or a dark endpoint is visible in fleetstatus. Never raises."""
    import urllib.request, urllib.error

    def fetch(url):
        try:
            return json.loads(urllib.request.urlopen(url, timeout=8).read() or b'{}')
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read() or b'{}')
            except ValueError:
                return {'error': f'http {e.code}'}
    try:
        if load is None:
            import make_env                 # beside this file, in the repo and in /srv/showcase/bin
            load = make_env.load_brain
        url, model = brain_target(cfg, load())
    except Exception as e:
        return brain_report({'error': f'the brain setting is unreadable ({type(e).__name__}: {str(e)[:100]})'}, None)
    try:
        return brain_report((get or fetch)(url), model)
    except Exception as e:
        return brain_report({'error': f'{type(e).__name__}: {str(e)[:120]}'}, None)


def render(cfg, full=False):
    cmd = NICE + ['java', f"-Xmx{cfg.get('render_heap', '3G')}", '-jar', cfg['jar'], '-c', cfg['bm_conf'],
                  '-r', '-m', cfg['map_id']]
    if full:
        cmd.append('-f')
    c0, t0 = child_cpu_s(), time.time()
    with open(os.path.join(cfg['root'], 'logs', 'render.log'), 'a') as lf:
        try:
            p = subprocess.run(cmd, cwd=cfg['bm_home'], stdout=lf, stderr=subprocess.STDOUT,
                               timeout=cfg.get('render_timeout_s', 600) if not full else None)
            rc = p.returncode
        except subprocess.TimeoutExpired:
            rc = 'timeout'
    return rc, round(time.time() - t0, 1), round(child_cpu_s() - c0, 1)


MIN_PNG_BYTES = 20_000      # a blank/black 1920x1080 PNG is a few KB; a rendered town frame is hundreds of KB


TERRAIN_FRAC = 0.30
TERRAIN_LEVEL = 12


def terrain_ok(gray, frac=TERRAIN_FRAC, level=TERRAIN_LEVEL):
    """A rendered frame, not sky: >= frac of the (downscaled grayscale) pixels differ from the frame's most common
    value by more than `level`. A sky-only, black, or barely loaded frame fails. Pure (tested)."""
    if not gray:
        return False
    hist = [0] * 256
    for b in gray:
        hist[b] += 1
    mode = max(range(256), key=lambda v: hist[v])
    differ = sum(hist[v] for v in range(256) if abs(v - mode) > level)
    return differ / len(gray) >= frac


def small_gray(path):
    p = subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-i', path, '-vf', 'scale=320:180,format=gray',
                               '-f', 'rawvideo', '-'], capture_output=True)
    return p.stdout if p.returncode == 0 else b''


def publish_pair(staged, finals, min_bytes=MIN_PNG_BYTES, size=os.path.getsize, exists=os.path.isfile,
                 replace=os.replace, content_ok=lambda p: True):
    """Publish the views TOGETHER or not at all: every staged file must exist, be >= min_bytes and pass content_ok
    (terrain_ok on its grayscale reduction), then each is renamed into place. Readers additionally use only stamps
    present in BOTH views. -> (published, why). Pure given the fs callables (tested)."""
    bad = [s for s in staged if not exists(s) or size(s) < min_bytes or not content_ok(s)]
    if bad:
        return False, 'invalid frame(s): ' + ', '.join(f'{os.path.basename(b)}' for b in bad)
    for s, f in zip(staged, finals):
        replace(s, f)
    return True, None


def job_spec(cfg, v, cam, out, deadline=None, est_s=None):
    """The capture.mjs job of one camera (check_scene_camera builds it too: a director camera whose job cannot be
    built never reaches the browser run). Pure (tested)."""
    return {'url': f"{cfg['web']}/{camera_hash(cfg['map_id'], cam)}", 'out': out,
            'width': cam.get('width', cfg['width']), 'height': cam.get('height', cfg['height']), 'fov': cam.get('fov'),
            'settle_ms': cam.get('settle_ms', cfg.get('settle_ms', 6000)), 'markers': camera_markers(cam),
            'reuse': bool(cfg.get('reuse_page', True)), 'pin': bool(cfg.get('pin_height', True)),
            **cam_quality(cfg, cam),
            'deadline_ms': int(deadline * 1000) if deadline else None,
            'est_ms': int(1000 * float(est_s or DEFAULT_FRAME_S))}


def capture(cfg, stamp, views=None, deadline=None, est=None, pair=VIEWS):
    """Shoot `views` (default: the pair + every extra camera due by the legacy cadence) in one browser run. deadline: an
    epoch second capture.mjs must not run a job past (each job carries its estimated cost est[view] s)."""
    spec, finals = [], []
    stage = os.path.join(cfg['root'], 'frames', '.staging')
    os.makedirs(stage, exist_ok=True)
    views = list(views) if views else list(VIEWS) + extra_views(cfg, stamp)
    for v in views:
        cam = cfg['cameras'][v]
        final = frame_path(cfg['root'], v, stamp)
        os.makedirs(os.path.dirname(final), exist_ok=True)
        finals.append(final)
        out = os.path.join(stage, f'{v}-{stamp}.png')
        if os.path.exists(out):
            os.remove(out)
        spec.append(job_spec(cfg, v, cam, out, deadline, (est or {}).get(v)))
    env = dict(os.environ, PUPPETEER_CACHE_DIR=os.path.join(cfg['capture_dir'], '.cache'))
    c0, t0 = child_cpu_s(), time.time()
    tmo = cfg.get('capture_timeout_s', 400)
    if deadline:
        tmo = max(60, min(tmo, deadline - time.time() + 60))
    out_txt = ''
    try:
        c = subprocess.run(NICE + ['node', os.path.join(cfg['capture_dir'], 'capture.mjs')],
                           input=json.dumps(spec), text=True, capture_output=True, env=env,
                           cwd=cfg['capture_dir'], timeout=tmo)
        rc, msg, out_txt = c.returncode, (c.stdout + c.stderr).strip()[-400:], c.stdout
    except subprocess.TimeoutExpired:
        rc, msg = 'timeout', 'capture timed out'
    capture.timings = job_timings(out_txt)
    got, extra = [], []
    raw_rc = rc
    n = len(pair)
    # the pair is judged on its own result; capture.mjs exits non-zero when ANY job failed, so the pair cannot use rc
    # alone once extra cameras share the run -- each staged file is checked instead (it exists only if its job wrote it)
    pair_ok = rc == 0 or all(os.path.exists(s['out']) for s in spec[:n])
    if pair_ok:
        ok, why = publish_pair([s['out'] for s in spec[:n]], finals[:n],
                               content_ok=lambda p: terrain_ok(small_gray(p)))
        if ok:
            got = finals[:n]
            if rc != 0:
                rc, msg = 0, 'pair ok; an extra camera failed: ' + msg
        else:
            rc, msg = 'invalid', why
    extra_err = {}
    for v, s, f in zip(views[n:], spec[n:], finals[n:]):          # each extra on its own
        ok, why = publish_pair([s['out']], [f], content_ok=lambda p: terrain_ok(small_gray(p)))
        if ok:
            extra.append(f)
        else:
            extra_err[v] = why if os.path.exists(s['out']) else 'not written (see capture_msg)'
    for s in spec:                                   # nothing half-published is left behind
        if os.path.exists(s['out']):
            os.remove(s['out'])
    return rc, msg, got, round(time.time() - t0, 1), round(child_cpu_s() - c0, 1), extra, extra_err, raw_rc


def frame_sidecar(cam, target, site=None):
    """The <stamp>.json written beside a published frame: the camera's caption label and the followed project, or None
    for a camera with neither (no file: the video draws its old caption). `final`: True on the one frame a follow
    camera takes of a COMPLETED project (site: its project_sites entry). A director scene camera's frame also carries
    `scene` (its id), `caption`, `bots` (names), `layer`, `score` and `kind`. Pure (tested)."""
    label = (cam or {}).get('label')
    if not label and not target:
        return None
    side = {'label': label or target, 'project': target}
    if target and (site or {}).get('complete'):
        side['final'] = True
    sc = (cam or {}).get('scene')
    if sc:                              # a director scene camera: what the frame shows, for the scene videos
        side.update(scene=sc.get('id'), caption=sc.get('caption'), bots=list(sc.get('bots') or ()),
                    layer=sc.get('layer'), score=sc.get('score'), kind=sc.get('kind'),
                    project=target or sc.get('project'))
    return side


STAGED_RX = re.compile(r'(.+)-\d{8}T\d{4}Z')      # <view>-<stamp>[-event-<label>].png


def job_timings(stdout):
    """capture.mjs `ok <out> ms=<n>` / `skip <out> deadline` lines -> {view: seconds or 'deadline'}. Staged files are
    <stage>/<view>-<stamp>.png; the view is what precedes the stamp (a director camera is `scene-<id>`: a name may
    carry a '-'). Pure (tested)."""
    out = {}
    for line in (stdout or '').splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[0] not in ('ok', 'skip'):
            continue
        base = os.path.basename(parts[1])
        m = STAGED_RX.match(base)
        v = m.group(1) if m else base.split('-', 1)[0]
        if parts[0] == 'skip':
            out[v] = 'deadline'
            continue
        ms = [p for p in parts[2:] if p.startswith('ms=')]
        out[v] = round(int(ms[0][3:]) / 1000, 1) if ms else None
    return out


def frame_path(root, view, stamp):
    """frames/<view>/<YYYYmmdd>/<stamp>.png -- one directory per UTC day, so the nightly NAS sync pulls only the
    newest days and .30's staging can be pruned without re-pulling history. Pure (tested)."""
    return os.path.join(root, 'frames', view, stamp[:8], stamp + '.png')


def list_stamps(root, view):
    d = os.path.join(root, 'frames', view)
    out = []
    if os.path.isdir(d):
        for day in os.listdir(d):
            dd = os.path.join(d, day)
            if os.path.isdir(dd):
                out += [f[:-4] for f in os.listdir(dd) if f.endswith('.png')]
    return sorted(out)


def frame_stamps(cfg, view='angled'):
    return list_stamps(cfg['root'], view)


def frame0_time(cfg):
    p = os.path.join(cfg['root'], 'FRAME0.json')
    if os.path.isfile(p):
        return parse_stamp(json.load(open(p))['stamp'])
    return None


def cmd_capture(cfg, a):
    t = now_utc()
    stamp = stamp_of(t) + (f'-event-{a.event}' if a.event else '')
    try:
        with renderer_lock(cfg, f'capture {stamp}', wait_s=0):
            return _capture_locked(cfg, a, t, stamp)
    except RendererBusy as e:
        heartbeat(cfg, {'ok': False, 'step': 'skip', 'stamp': stamp, 'why': f'renderer busy: {e}'})
        return 0


def _capture_locked(cfg, a, t, stamp):
    start = time.time()
    budget = float(cfg.get('budget_s') or DEFAULT_BUDGET_S)
    if cfg.get('save_hold', True):
        try:
            import rcon
            rcon.save_on_if_unowned()     # a holder killed mid-pause released the lock on death; repair, never steal
        except Exception:
            pass
    cfg['_brain'] = brain_health(cfg)
    disk = round(free_gb(cfg['root']), 1)
    if disk < cfg.get('min_free_gb', 20):
        heartbeat(cfg, {'ok': False, 'step': 'disk', 'stamp': stamp, 'disk_free_gb': disk,
                        'why': f'{disk} GB free < min_free_gb {cfg.get("min_free_gb", 20)}; nothing written'})
        return 0
    t0 = time.time()
    sok, swhy, nreg = snapshot(cfg)
    if not sok:
        heartbeat(cfg, {'ok': False, 'step': 'snapshot', 'stamp': stamp, 'why': swhy, 'disk_free_gb': disk})
        return 0
    snap_s = round(time.time() - t0, 1)
    rc, rs, rcpu = render(cfg)
    row = {'stamp': stamp, 'render_s': rs, 'render_cpu_s': rcpu, 'render_rc': rc, 'event': a.event,
           'snapshot_s': snap_s, 'regions': nreg, 'disk_free_gb': disk}
    if rc != 0:
        heartbeat(cfg, dict(row, ok=False, step='render', why=f'bluemap rc={rc} (see logs/render.log)'))
        return 0
    state = load_state(cfg)
    progress = project_progress(cfg)
    sites = project_sites(cfg)
    pair = slot_pair(cfg, t)
    # the whole plan, the director's part fenced (slot_plan): on ANY director failure this is the director-off plan
    plan = slot_plan(cfg, state, t, progress, sites, budget, lambda: time.time() - start, pair, stamp)
    cams, targets, views, why, deferred = plan['cams'], plan['targets'], plan['views'], plan['why'], plan['deferred']
    rcfg = dict(cfg, cameras=cams)           # follow cameras made concrete for this slot (+ the scene cameras)
    est = {v: (state.get(v) or {}).get('frame_s') or (cams.get(v) or {}).get('est_s') for v in views}
    crc, msg, got, cs, ccpu, extra, extra_err, raw_rc = capture(rcfg, stamp, views, deadline=start + budget, est=est,
                                                               pair=pair)
    timings = getattr(capture, 'timings', {})
    for p in got + extra:             # the schedule's memory: last frame, last change, per-frame cost
        v = os.path.basename(os.path.dirname(os.path.dirname(p)))
        prev = state.get(v) or {}
        gpath = os.path.join(cfg['root'], 'logs', 'gray', v + '.gray')
        gray = small_gray(p)
        try:
            prev_gray = open(gpath, 'rb').read()
        except OSError:
            prev_gray = b''
        sec = timings.get(v) if isinstance(timings.get(v), (int, float)) else None
        state[v] = update_view_state(prev, t, gray, prev_gray, sec)
        if v in targets:
            state[v]['target'] = targets[v]
            # the framing, for the nightly Chunky beauty render of the same project (chunky_beauty.project_view)
            state[v]['camera'] = {k: cams[v].get(k) for k in ('x', 'y', 'z', 'distance', 'rotation', 'angle', 'fov', 'label')}
            state[v] = note_final(state[v], targets[v], sites.get(targets[v]))   # a finished project: this was its last
        side = plan['sidecars'].get(v) or frame_sidecar(cams.get(v), targets.get(v), sites.get(targets.get(v)))
        side = dict(side or {}, changed=state[v].get('changed'))      # a scene frame's: made and checked in director_plan
        with open(p[:-4] + '.json', 'w') as f:
            json.dump(side, f)
        if gray:
            os.makedirs(os.path.dirname(gpath), exist_ok=True)
            with open(gpath + '.part', 'wb') as f:
                f.write(gray)
            os.replace(gpath + '.part', gpath)
    drow, derr = director_done(cfg, plan, [os.path.basename(os.path.dirname(os.path.dirname(p))) for p in got + extra],
                               timings, t, state)
    derr = plan['director_error'] or derr        # one line: the first thing that went wrong with the director
    save_state(cfg, state)
    skipped = sorted(v for v, x in timings.items() if x == 'deadline')
    row.update(capture_s=cs, capture_cpu_s=ccpu, capture_rc=crc, frames=len(got),
               bytes=sum(os.path.getsize(p) for p in got + extra),
               extra={os.path.basename(os.path.dirname(os.path.dirname(p))): os.path.getsize(p) for p in extra},
               extra_expected=[v for v in views if v not in pair], deferred=deferred, deadline_skipped=skipped, pair=list(pair),
               frame_s={v: x for v, x in timings.items() if x != 'deadline'}, budget_s=budget,
               active=sorted(v for v in why if why[v].startswith('active')))
    if drow is not None:
        row['director'] = drow
    if derr:
        row['director_error'] = derr
    if extra_err or raw_rc != 0:     # the diagnostics of an extra camera survive a published pair (review P3)
        row.update(extra_errors=extra_err, capture_raw_rc=raw_rc, capture_msg=msg[-300:])
    if a.frame0:
        if len(got) == len(pair):
            import hashlib, re as _re
            seed = None
            try:
                props = open(os.path.join(os.path.dirname(cfg['world']), 'server.properties')).read()
                seed = _re.search(r'^level-seed=(.*)$', props, _re.M).group(1).strip()
            except (OSError, AttributeError):
                pass
            lvl = os.path.join(cfg['mirror'], 'level.dat')
            with open(os.path.join(cfg['root'], 'FRAME0.json'), 'w') as f:
                json.dump({'stamp': stamp, 'frames': got, 'seed': seed,
                           'level_dat_sha256': hashlib.sha256(open(lvl, 'rb').read()).hexdigest() if os.path.exists(lvl) else None,
                           'note': 'the empty world, before the town stamp and before any bot joined'}, f, indent=1)
        else:
            heartbeat(cfg, dict(row, ok=False, step='frame0', why=msg))
            return 1
    f0 = frame0_time(cfg) or t
    paired = set.intersection(*[set(frame_stamps(cfg, v)) for v in base_pair(cfg)])   # a slot counts only as a PAIR
    regular = [parse_stamp(s) for s in sorted(paired) if '-event-' not in s]
    miss, exp = missing_slots([x for x in regular if x], t, cfg['capture_min'], f0)
    ok = crc == 0 and len(got) == len(pair)
    heartbeat(cfg, dict(row, ok=ok, step='done' if ok else 'capture', why=None if ok else msg,
                        missing_24h=miss, expected_24h=exp))
    return 0


def cmd_render_full(cfg, a):
    with renderer_lock(cfg, 'render-full', wait_s=900):
        sok, swhy, _ = snapshot(cfg)
        if not sok:
            print(json.dumps({'full_render_rc': 'snapshot', 'why': swhy}))
            return 1
        rc, rs, rcpu = render(cfg, full=True)
    print(json.dumps({'full_render_rc': rc, 'render_s': rs, 'render_cpu_s': rcpu}))
    return 0 if rc == 0 else 1


def cmd_shoot(cfg, a):
    """A VERIFICATION capture: the named cameras into --out, under the renderer lock (waits for a running slot), never
    into frames/, no heartbeat row, no schedule state. --render first renders the changed chunks (as a slot does)."""
    views = [v for v in a.views.split(',') if v]
    bad = [v for v in views if v not in (cfg.get('cameras') or {})]
    if bad:
        print(json.dumps({'shoot': 'refused', 'why': f'unknown camera(s) {bad}'}))
        return 2
    os.makedirs(a.out, exist_ok=True)
    try:
        with renderer_lock(cfg, f'shoot {",".join(views)} -> {a.out}', wait_s=a.wait_s):
            if a.render:
                sok, swhy, _ = snapshot(cfg)
                if not sok:
                    print(json.dumps({'shoot': 'snapshot', 'why': swhy}))
                    return 1
                rc, _, _ = render(cfg)
                if rc != 0:
                    print(json.dumps({'shoot': 'render', 'rc': rc}))
                    return 1
            stamp = stamp_of(now_utc())
            cams, _ = resolve_cameras(cfg, load_state(cfg), now_utc(), project_progress(cfg), project_sites(cfg))
            vcfg = dict(cfg, root=a.out, cameras=cams)   # staging + "frames" land under --out, never the timelapse root
            views = [v for v in views if not (cams.get(v) or {}).get('off')]     # a follow camera with no project
            crc, msg, got, cs, _, extra, err, _ = capture(vcfg, stamp, views, deadline=time.time() + a.budget_s)
    except RendererBusy as e:
        print(json.dumps({'shoot': 'busy', 'why': str(e)}))
        return 3
    print(json.dumps({'shoot': 'done', 'rc': crc, 'files': got + extra, 'errors': err, 'capture_s': cs,
                      'timings': getattr(capture, 'timings', {})}))
    return 0


def cmd_plan(cfg, a):
    """`plan`: what the next slot would shoot and why (read-only).
    DIRECTOR OFF: exactly the object this command has always printed (Codex r4: it is an operator's diagnostic, its
    output does not change under him) -- which plans the FULL pair (VIEWS) in every slot. That was never quite what a
    slot shoots since timelapse2-1110: with tl.conf pair_hourly the slot's pair is slot_pair (topdown only in the slot
    on the hour), so off the hour `views` lists a topdown the slot will not take and counts its seconds against the
    budget. The object stays as it was; the slot's real pair is said in one extra line on STDERR when it differs.
    DIRECTOR ON: the plan the slot will really make (slot_plan with the slot's own pair, the director's pass run
    read-only), with `pair`, `director` and, when the director failed, `director_error`."""
    t = now_utc()
    state, progress, sites = load_state(cfg), project_progress(cfg), project_sites(cfg)
    budget = float(cfg.get('budget_s') or DEFAULT_BUDGET_S)
    pair = slot_pair(cfg, t)
    if not director_on(cfg):
        plan = slot_plan(cfg, state, t, progress, sites, budget, lambda: 75.0, VIEWS)
        print(json.dumps({'t': _iso(t), 'views': plan['views'], 'why': plan['why'], 'deferred': plan['deferred'],
                          'follow': plan['targets']}, indent=1))
        if tuple(pair) != tuple(VIEWS):
            print(f"note: `views` above plans the full pair {list(VIEWS)}, as `plan` always has; the slot at {_iso(t)} "
                  f"shoots the pair {list(pair)} (tl.conf pair_hourly)", file=sys.stderr)
        return 0
    plan = slot_plan(cfg, state, t, progress, sites, budget, lambda: 75.0, pair, stamp_of(t), write=False)   # read-only
    out = {'t': _iso(t), 'pair': list(pair), 'views': plan['views'], 'why': plan['why'], 'deferred': plan['deferred'],
           'follow': plan['targets']}
    if plan['summary'] is not None:
        out['director'] = plan['summary']
    if plan['director_error']:
        out['director_error'] = plan['director_error']
    print(json.dumps(out, indent=1))
    return 0


def cmd_status(cfg, a):
    from showcasestatus import timelapse_line      # scripts/lib/showcasestatus.py, installed beside this file
    rows = []
    if os.path.isfile(cfg['heartbeat']):
        for line in open(cfg['heartbeat']).read().splitlines()[-5000:]:
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    rows = [r for r in rows if r.get('kind') == 'showcase_timelapse']
    print(timelapse_line(rows, now_utc(), frame0=frame0_time(cfg), capture_min=cfg['capture_min']))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('capture')
    c.add_argument('--event')
    c.add_argument('--frame0', action='store_true')
    sub.add_parser('render-full')
    sub.add_parser('status')
    sub.add_parser('plan')
    sh = sub.add_parser('shoot')
    sh.add_argument('--views', required=True)
    sh.add_argument('--out', required=True)
    sh.add_argument('--wait-s', type=float, default=900)
    sh.add_argument('--budget-s', type=float, default=1800)
    sh.add_argument('--render', action='store_true')
    a = ap.parse_args()
    cfg = load_conf()
    os.makedirs(os.path.join(cfg['root'], 'logs'), exist_ok=True)
    return {'capture': cmd_capture, 'render-full': cmd_render_full, 'status': cmd_status, 'shoot': cmd_shoot,
            'plan': cmd_plan}[a.cmd](cfg, a)


if __name__ == '__main__':
    sys.exit(main())
