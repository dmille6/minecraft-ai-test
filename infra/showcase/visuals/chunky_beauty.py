#!/usr/bin/env python3
"""tlpolish-1106: the nightly Chunky golden-hour BEAUTY renders of the showcase, on 10.0.0.30 (owner 11-07: "both" --
the polished BlueMap timelapse every 15 min AND a daily path-traced beauty video; 320 spp; the sun chosen per camera so
the subject is never in tree shadow; rendered from the world copy .30 already pulls at 04:15Z).

    chunky_beauty.py scenes SCENE_DIR WORLD [--views-json logs/views.json] [--spp 320] [--width 1920 --height 1080]
    chunky_beauty.py best DAY_DIR                    score the day's frames, write best.png + best.json
    chunky_beauty.py video ROOT DAY                  the day's beauty video + each view's beauty history

THE VIEWS are the BlueMap 4K hero cameras, so a Chunky frame and a BlueMap frame of one camera line up: `town` is the
fixed town hero; `project` is the camera tl_showcase's follow camera framed last (views.json project4k.camera: the active
project). A camera is given as BlueMap gives it (target, distance, rotation, angle from vertical, vertical fov);
bm_eye turns it into the eye point (read back from the BlueMap page 11-07).
THE SUN: a view may name its own (az, alt); otherwise sun_for() puts it 25 deg left of straight behind the camera at
32 deg -- front light, so shadows fall away from the camera and behind the subject (the 11-07 copper-hall proof: straight
behind at 18 deg left the hall in a tree's shadow; 25 deg off at 32 deg lit it).
CADENCE: one world copy a day (the 04:15Z pull) -> one frame per view per night; the beauty history grows a frame a day.
Chunky conventions (measured 11-05/11-07): yaw 0 = -x, PI/2 = +z; pitch 0 = straight down, -PI/2 = level; the sun
direction is (cos az, sin alt, sin az).
"""
import argparse, json, math, os, shutil, subprocess, sys

TOWN = dict(target=(-8, 70, 10), distance=105, rotation=0.7854, angle=1.2, fov=32, radius=208,
            sun=(135.0, 18.0), label='town')
PROJECT_DEFAULT = dict(rotation=0.7854, angle=0.85, fov=32, radius=144)
SUN_OFFSET_DEG, SUN_ALT_DEG = -25.0, 32.0
SPP = 320                      # the measured sweet spot (11-07: PSNR 41 dB vs 1024 spp; 1080p ~16 min at 12 threads)
NICE = ['nice', '-n', '19', 'ionice', '-c3']


def bm_eye(target, distance, rotation, angle):
    """BlueMap's camera position for a target/distance/rotation/angle. Pure (tested)."""
    h = distance * math.sin(angle)
    return (target[0] - math.sin(rotation) * h, target[1] + distance * math.cos(angle), target[2] + math.cos(rotation) * h)


def sun_for(view):
    """(azimuth deg, altitude deg) of the sun for a view: its own `sun`, else 25 deg left of straight behind the camera
    at 32 deg. Behind the camera = the direction from the target to the eye. Pure (tested)."""
    if view.get('sun'):
        return tuple(float(x) for x in view['sun'])
    r = view['rotation']
    behind = math.degrees(math.atan2(math.cos(r), -math.sin(r)))      # the eye offset is (-sin r, cos r) in (x, z)
    return (round((behind + SUN_OFFSET_DEG) % 360.0, 3), SUN_ALT_DEG)


def chunky_camera(eye, look, fov):
    dx, dy, dz = (look[i] - eye[i] for i in range(3))
    yaw = math.atan2(dz, -dx)
    below = math.atan2(-dy, math.hypot(dx, dz))
    return {'name': 'camera 1', 'position': {'x': eye[0], 'y': eye[1], 'z': eye[2]},
            'orientation': {'roll': 0.0, 'pitch': -(math.pi / 2 - below), 'yaw': yaw},
            'projectionMode': 'PINHOLE', 'fov': fov, 'dof': 'Infinity', 'focalOffset': 2.0}


def chunks(look, radius):
    cx0, cz0 = int(math.floor(look[0])) >> 4, int(math.floor(look[2])) >> 4
    r = radius // 16 + 1
    return [[cx, cz] for cx in range(cx0 - r, cx0 + r + 1) for cz in range(cz0 - r, cz0 + r + 1)
            if math.hypot((cx - cx0) * 16, (cz - cz0) * 16) <= radius + 16]


def project_view(views_state):
    """The `project` view from tl_showcase's views.json (project4k.camera: the follow camera's last framing), or None
    when the BlueMap follow camera has not framed a project yet. Pure (tested)."""
    cam = ((views_state or {}).get('project4k') or {}).get('camera')
    if not isinstance(cam, dict) or not all(k in cam for k in ('x', 'y', 'z', 'distance')):
        return None
    v = dict(PROJECT_DEFAULT)
    v.update(target=(float(cam['x']), float(cam['y']), float(cam['z'])), distance=float(cam['distance']),
             rotation=float(cam.get('rotation', v['rotation'])), angle=float(cam.get('angle', v['angle'])),
             fov=float(cam.get('fov') or v['fov']), label=str(cam.get('label') or 'project'))
    v['radius'] = int(max(v['radius'], v['distance'] * 2))
    return v


def views_for(views_state):
    """{name: view}: the town hero, plus the active project when there is one. Pure (tested)."""
    out = {'town': dict(TOWN)}
    p = project_view(views_state)
    if p:
        out['project'] = p
    return out


def scene(name, v, world, spp, w, h):
    eye = bm_eye(v['target'], v['distance'], v['rotation'], v['angle'])
    az, alt = sun_for(v)
    return {
        'sdfVersion': 9, 'name': name, 'width': w, 'height': h,
        'world': {'path': world, 'dimension': 0},
        'chunkList': chunks(v['target'], v['radius']),
        'camera': chunky_camera(eye, v['target'], v['fov']),
        'sppTarget': spp, 'spp': 0, 'renderTime': 0,
        'exposure': 1.0, 'postprocess': 'TONEMAP3', 'outputMode': 'PNG', 'saveSnapshots': False,
        'rayDepth': 6, 'branchCount': 10,
        'emittersEnabled': True, 'emitterIntensity': 8.0, 'emitterSamplingStrategy': 'ONE',
        'sunEnabled': True, 'transparentSky': False, 'renderActors': True,
        'stillWater': False, 'waterShadingStrategy': 'SIMPLEX', 'waterOpacity': 0.42,
        'biomeColorsEnabled': True, 'fancierTranslucency': True,
        'yClipMin': 40, 'yClipMax': 200,
        'sun': {'altitude': math.radians(alt), 'azimuth': math.radians(az), 'intensity': 1.6,
                'color': {'red': 1.0, 'green': 0.80, 'blue': 0.58}, 'drawTexture': True},
        'sky': {'skyYaw': 0.0, 'skyMirrored': True, 'skyLight': 0.85, 'skyExposure': 1.0, 'mode': 'SIMULATED',
                'simulatedSky': 'Nishita', 'horizonOffset': 0.0, 'cloudsEnabled': False},
        'fog': {'mode': 'UNIFORM', 'uniformDensity': 0.0035, 'skyFogDensity': 1.0, 'layers': [],
                'color': {'red': 0.98, 'green': 0.86, 'blue': 0.72}, 'fastFog': True},
    }


def colourfulness(rgb):
    """Hasler-Suesstrunk colourfulness of packed rgb24 bytes. Pure (tested)."""
    n = len(rgb) // 3
    if not n:
        return 0.0
    rg = [rgb[3 * i] - rgb[3 * i + 1] for i in range(n)]
    yb = [(rgb[3 * i] + rgb[3 * i + 1]) / 2 - rgb[3 * i + 2] for i in range(n)]
    m = lambda a: sum(a) / len(a)
    sd = lambda a, mu: math.sqrt(sum((x - mu) ** 2 for x in a) / len(a))
    mrg, myb = m(rg), m(yb)
    return math.hypot(sd(rg, mrg), sd(yb, myb)) + 0.3 * math.hypot(mrg, myb)


def frame_score(rgb):
    """A frame's beauty score: colourfulness, cut when the frame is too dark or blown out (mean luma outside 60..190)
    or flat (luma spread < 25). Pure (tested)."""
    n = len(rgb) // 3
    if not n:
        return 0.0
    luma = [0.299 * rgb[3 * i] + 0.587 * rgb[3 * i + 1] + 0.114 * rgb[3 * i + 2] for i in range(n)]
    mu = sum(luma) / n
    spread = math.sqrt(sum((x - mu) ** 2 for x in luma) / n)
    s = colourfulness(rgb)
    if mu < 60 or mu > 190:
        s *= 0.5
    if spread < 25:
        s *= 0.5
    return round(s, 3)


def pick_best(scores):
    """{view: score} -> the best view (ties: name order), or None. Pure (tested)."""
    return max(sorted(scores), key=lambda v: scores[v]) if scores else None


def small_rgb(path, w=160, h=90):
    p = subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-i', path, '-vf', f'scale={w}:{h}', '-f', 'rawvideo',
                               '-pix_fmt', 'rgb24', '-'], capture_output=True)
    return p.stdout if p.returncode == 0 else b''


def cmd_scenes(a):
    try:
        st = json.load(open(a.views_json)) if a.views_json else {}
    except (OSError, ValueError):
        st = {}
    out = []
    for name, v in views_for(st).items():
        d = os.path.join(a.scene_dir, name)
        os.makedirs(d, exist_ok=True)
        s = scene(name, v, os.path.abspath(a.world), a.spp, a.width, a.height)
        with open(os.path.join(d, f'{name}.json'), 'w') as f:
            json.dump(s, f, indent=1)
        out.append({'view': name, 'label': v['label'], 'sun': sun_for(v), 'chunks': len(s['chunkList'])})
    with open(os.path.join(a.scene_dir, 'views.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print(json.dumps(out))
    return 0


def cmd_best(a):
    pngs = sorted(f for f in os.listdir(a.day_dir) if f.endswith('.png') and f != 'best.png')
    scores = {f[:-4]: frame_score(small_rgb(os.path.join(a.day_dir, f))) for f in pngs}
    b = pick_best(scores)
    if b:
        shutil.copyfile(os.path.join(a.day_dir, b + '.png'), os.path.join(a.day_dir, 'best.png'))
    with open(os.path.join(a.day_dir, 'best.json'), 'w') as f:
        json.dump({'best': b, 'scores': scores}, f, indent=1)
    print(json.dumps({'best': b, 'scores': scores}))
    return 0 if b else 1


def history_days(root, view):
    """The dates (YYYY-MM-DD dirs under root/frames) holding a frame of this view, oldest first. Pure given the fs."""
    d = os.path.join(root, 'frames')
    return sorted(x for x in (os.listdir(d) if os.path.isdir(d) else [])
                  if os.path.isfile(os.path.join(d, x, view + '.png')))


def slideshow_cmd(listfile, out, hold_s=2.0, fps=30):
    """ffmpeg: the numbered frames at 1/hold_s per second, a dissolve over the middle half of each step, graded the way
    the BlueMap clips are not (the path tracer's tone map is the grade). Pure (tested)."""
    return NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-framerate', f'{1.0 / hold_s:.4f}', '-i', listfile,
                   '-vf', f'framerate=fps={fps}:interp_start=64:interp_end=192:scene=100,format=yuv420p',
                   '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-threads', '4', '-movflags', '+faststart', out]


def _caption(src, dst, text):
    f = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    t = ''.join(ch for ch in text if ch.isalnum() or ch in ' -_.')[:60]
    subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf',
                           f"drawtext=fontfile={f}:text='{t}':x=w-tw-28:y=h-th-28:fontsize=34:fontcolor=white:"
                           "box=1:boxcolor=black@0.5:boxborderw=12", dst], check=True)


def _slideshow(items, out, tmp):
    """items: [(png, caption)] -> out.mp4; the last frame is held twice as long."""
    os.makedirs(tmp, exist_ok=True)
    seq = items + items[-1:]
    for i, (png, cap) in enumerate(seq, 1):
        _caption(png, os.path.join(tmp, f'{i:05d}.png'), cap)
    subprocess.run(slideshow_cmd(os.path.join(tmp, '%05d.png'), out + '.part.mp4'), check=True)
    os.replace(out + '.part.mp4', out)


def cmd_video(a):
    import tempfile
    day_dir = os.path.join(a.root, 'frames', a.day)
    labels = {}
    try:
        labels = {x['view']: x['label'] for x in json.load(open(os.path.join(day_dir, 'views.json')))}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    vids = os.path.join(a.root, 'video')
    os.makedirs(vids, exist_ok=True)
    made = {}
    with tempfile.TemporaryDirectory(dir=a.root) as tmp:
        day = [(os.path.join(day_dir, f), f"{labels.get(f[:-4], f[:-4])}  {a.day}  golden hour")
               for f in sorted(os.listdir(day_dir)) if f.endswith('.png') and f != 'best.png']
        if day:
            out = os.path.join(vids, f'beauty-{a.day}.mp4')
            _slideshow(day, out, os.path.join(tmp, 'day'))
            made['day'] = out
        for v in sorted({f[:-4] for f in os.listdir(day_dir) if f.endswith('.png') and f != 'best.png'}):
            days = history_days(a.root, v)
            out = os.path.join(vids, f'beauty-history-{v}.mp4')
            _slideshow([(os.path.join(a.root, 'frames', d, v + '.png'), f'{v}  {d}') for d in days], out,
                       os.path.join(tmp, 'h-' + v))
            made['history-' + v] = out
    print(json.dumps(made))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('scenes')
    s.add_argument('scene_dir'); s.add_argument('world')
    s.add_argument('--views-json', default='')
    s.add_argument('--spp', type=int, default=SPP)
    s.add_argument('--width', type=int, default=1920); s.add_argument('--height', type=int, default=1080)
    b = sub.add_parser('best')
    b.add_argument('day_dir')
    v = sub.add_parser('video')
    v.add_argument('root'); v.add_argument('day')
    a = ap.parse_args()
    return {'scenes': cmd_scenes, 'best': cmd_best, 'video': cmd_video}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
