#!/usr/bin/env python3
"""Showcase timelapse: incremental BlueMap render -> two fixed-camera frames, every CAPTURE_MIN minutes.

Runs ON THE SHOWCASE VM (docs/reports/showcase-2026-10-20.md section 6), from a systemd timer, as user `mike`.
It reads the live world (BlueMap reads region files; Paper is never touched), renders ONLY the chunks modified
since the last render (`-r` without `-f`), and photographs the persistent BlueMap webserver (127.0.0.1:8100,
showcase-bluemap-web.service) with the same puppeteer capture.mjs the .30 timelapse uses.

    tl_showcase.py capture [--event LABEL] [--frame0]   render + both frames + one heartbeat row
    tl_showcase.py render-full                          the ONE full render before frame 0 (never from the timer)
    tl_showcase.py status                               the heartbeat line fleetstatus prints

A FAILED STEP IS A ROW, NOT A CRASH: the heartbeat records ok:false and the failed step; no frame is written for
that slot; the next timer run tries again. Two captures never overlap (flock -n; an overrun is a `skip` row).

Config: /srv/showcase/timelapse/tl.conf (JSON; CAPTURE_MIN lives in the systemd timer AND here, and the status
line warns if they differ).
"""
import argparse, datetime as dt, fcntl, json, os, resource, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts', 'lib'))
from showcasestatus import missing_slots       # noqa: E402  (one implementation, shared with fleetstatus)

CONF = os.environ.get('TL_CONF', '/srv/showcase/timelapse/tl.conf')
NICE = ['nice', '-n', '19', 'ionice', '-c3']
VIEWS = ('topdown', 'angled')


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
    row = dict(row, t=now_utc().strftime('%Y-%m-%dT%H:%M:%SZ'), kind='showcase_timelapse',
               capture_min=cfg['capture_min'])
    os.makedirs(os.path.dirname(cfg['heartbeat']), exist_ok=True)
    with open(cfg['heartbeat'], 'a') as f:
        f.write(json.dumps(row) + '\n')
    print(json.dumps(row), flush=True)


def child_cpu_s():
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


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


def publish_pair(staged, finals, min_bytes=MIN_PNG_BYTES, size=os.path.getsize, exists=os.path.isfile,
                 replace=os.replace):
    """Publish the views TOGETHER or not at all: every staged file must exist and be >= min_bytes, then each is
    renamed into place. -> (published, why). Pure given the fs callables (tested)."""
    bad = [s for s in staged if not exists(s) or size(s) < min_bytes]
    if bad:
        return False, 'invalid frame(s): ' + ', '.join(f'{os.path.basename(b)}' for b in bad)
    for s, f in zip(staged, finals):
        replace(s, f)
    return True, None


def capture(cfg, stamp):
    spec, finals = [], []
    stage = os.path.join(cfg['root'], 'frames', '.staging')
    os.makedirs(stage, exist_ok=True)
    for v in VIEWS:
        cam = cfg['cameras'][v]
        final = os.path.join(cfg['root'], 'frames', v, stamp + '.png')
        os.makedirs(os.path.dirname(final), exist_ok=True)
        finals.append(final)
        out = os.path.join(stage, f'{v}-{stamp}.png')
        if os.path.exists(out):
            os.remove(out)
        spec.append({'url': f"{cfg['web']}/{camera_hash(cfg['map_id'], cam)}", 'out': out,
                     'width': cfg['width'], 'height': cfg['height'], 'fov': cam.get('fov'),
                     'settle_ms': cfg.get('settle_ms', 6000)})
    env = dict(os.environ, PUPPETEER_CACHE_DIR=os.path.join(cfg['capture_dir'], '.cache'))
    c0, t0 = child_cpu_s(), time.time()
    try:
        c = subprocess.run(NICE + ['node', os.path.join(cfg['capture_dir'], 'capture.mjs')],
                           input=json.dumps(spec), text=True, capture_output=True, env=env,
                           cwd=cfg['capture_dir'], timeout=cfg.get('capture_timeout_s', 400))
        rc, msg = c.returncode, (c.stdout + c.stderr).strip()[-400:]
    except subprocess.TimeoutExpired:
        rc, msg = 'timeout', 'capture timed out'
    got = []
    if rc == 0:
        ok, why = publish_pair([s['out'] for s in spec], finals)
        if ok:
            got = finals
        else:
            rc, msg = 'invalid', why
    for s in spec:                                   # nothing half-published is left behind
        if os.path.exists(s['out']):
            os.remove(s['out'])
    return rc, msg, got, round(time.time() - t0, 1), round(child_cpu_s() - c0, 1)


def frame_stamps(cfg, view='angled'):
    d = os.path.join(cfg['root'], 'frames', view)
    return sorted(f[:-4] for f in os.listdir(d) if f.endswith('.png')) if os.path.isdir(d) else []


def frame0_time(cfg):
    p = os.path.join(cfg['root'], 'FRAME0.json')
    if os.path.isfile(p):
        return parse_stamp(json.load(open(p))['stamp'])
    return None


def cmd_capture(cfg, a):
    lock = open(os.path.join(cfg['root'], 'logs', 'capture.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        heartbeat(cfg, {'ok': False, 'step': 'skip', 'why': 'previous capture still running'})
        return 0
    t = now_utc()
    stamp = stamp_of(t) + (f'-event-{a.event}' if a.event else '')
    rc, rs, rcpu = render(cfg)
    row = {'stamp': stamp, 'render_s': rs, 'render_cpu_s': rcpu, 'render_rc': rc, 'event': a.event}
    if rc != 0:
        heartbeat(cfg, dict(row, ok=False, step='render', why=f'bluemap rc={rc} (see logs/render.log)'))
        return 0
    crc, msg, got, cs, ccpu = capture(cfg, stamp)
    row.update(capture_s=cs, capture_cpu_s=ccpu, capture_rc=crc, frames=len(got),
               bytes=sum(os.path.getsize(p) for p in got))
    if a.frame0:
        if len(got) == len(VIEWS):
            with open(os.path.join(cfg['root'], 'FRAME0.json'), 'w') as f:
                json.dump({'stamp': stamp, 'frames': got, 'note': 'the empty world, before the town stamp and '
                           'before any bot joined'}, f, indent=1)
        else:
            heartbeat(cfg, dict(row, ok=False, step='frame0', why=msg))
            return 1
    f0 = frame0_time(cfg) or t
    regular = [parse_stamp(s) for s in frame_stamps(cfg) if '-event-' not in s]
    miss, exp = missing_slots([x for x in regular if x], t, cfg['capture_min'], f0)
    ok = crc == 0 and len(got) == len(VIEWS)
    heartbeat(cfg, dict(row, ok=ok, step='done' if ok else 'capture', why=None if ok else msg,
                        missing_24h=miss, expected_24h=exp))
    return 0


def cmd_render_full(cfg, a):
    rc, rs, rcpu = render(cfg, full=True)
    print(json.dumps({'full_render_rc': rc, 'render_s': rs, 'render_cpu_s': rcpu}))
    return 0 if rc == 0 else 1


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
    a = ap.parse_args()
    cfg = load_conf()
    os.makedirs(os.path.join(cfg['root'], 'logs'), exist_ok=True)
    return {'capture': cmd_capture, 'render-full': cmd_render_full, 'status': cmd_status}[a.cmd](cfg, a)


if __name__ == '__main__':
    sys.exit(main())
