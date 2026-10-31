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

A FAILED STEP IS A ROW, NOT A CRASH: the heartbeat records ok:false and the failed step; no frame is written for
that slot; the next timer run tries again. Two captures never overlap (flock -n; an overrun is a `skip` row).
The two views are published together or not at all, and each must be a rendered frame (size + terrain check).

Config: /srv/showcase/timelapse/tl.conf (JSON; CAPTURE_MIN lives in the systemd timer AND here, and the status
line warns if they differ).
"""
import argparse, datetime as dt, fcntl, json, os, resource, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts', 'lib'))
from showcasestatus import missing_slots       # noqa: E402  (one implementation, shared with fleetstatus)

CONF = os.environ.get('TL_CONF', '/srv/showcase/timelapse/tl.conf')
NICE = ['nice', '-n', '19', 'ionice', '-c3']
VIEWS = ('topdown', 'angled')        # the PAIR: published together or not at all; the missing-slot count reads it


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


def brain_health(cfg):
    """The showcase proxy's /healthz through the tunnel: {'ok', 'paused_by', 'error'} -- carried in every heartbeat
    so a stale pause holder is visible in fleetstatus."""
    import urllib.request, urllib.error
    url = cfg.get('brain_healthz', 'http://127.0.0.1:11612/healthz')
    try:
        r = urllib.request.urlopen(url, timeout=8)
        d = json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            d = json.loads(e.read() or b'{}')
        except ValueError:
            d = {'error': f'http {e.code}'}
    except Exception as e:
        d = {'error': f'{type(e).__name__}: {str(e)[:120]}'}
    return {'ok': bool(d.get('ok')), 'paused_by': d.get('paused_by'), 'paused_since': d.get('paused_since'), 'fault': d.get('fault'),
            'error': d.get('error')}


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


def capture(cfg, stamp):
    spec, finals = [], []
    stage = os.path.join(cfg['root'], 'frames', '.staging')
    os.makedirs(stage, exist_ok=True)
    views = list(VIEWS) + extra_views(cfg, stamp)
    for v in views:
        cam = cfg['cameras'][v]
        final = frame_path(cfg['root'], v, stamp)
        os.makedirs(os.path.dirname(final), exist_ok=True)
        finals.append(final)
        out = os.path.join(stage, f'{v}-{stamp}.png')
        if os.path.exists(out):
            os.remove(out)
        spec.append({'url': f"{cfg['web']}/{camera_hash(cfg['map_id'], cam)}", 'out': out,
                     'width': cam.get('width', cfg['width']), 'height': cam.get('height', cfg['height']), 'fov': cam.get('fov'),
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
    got, extra = [], []
    raw_rc = rc
    n = len(VIEWS)
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
    lock = open(os.path.join(cfg['root'], 'logs', 'capture.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        heartbeat(cfg, {'ok': False, 'step': 'skip', 'why': 'previous capture still running'})
        return 0
    t = now_utc()
    stamp = stamp_of(t) + (f'-event-{a.event}' if a.event else '')
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
    crc, msg, got, cs, ccpu, extra, extra_err, raw_rc = capture(cfg, stamp)
    row.update(capture_s=cs, capture_cpu_s=ccpu, capture_rc=crc, frames=len(got),
               bytes=sum(os.path.getsize(p) for p in got + extra),
               extra={os.path.basename(os.path.dirname(os.path.dirname(p))): os.path.getsize(p) for p in extra},
               extra_expected=extra_views(cfg, stamp))
    if extra_err or raw_rc != 0:     # the diagnostics of an extra camera survive a published pair (review P3)
        row.update(extra_errors=extra_err, capture_raw_rc=raw_rc, capture_msg=msg[-300:])
    if a.frame0:
        if len(got) == len(VIEWS):
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
    paired = set(frame_stamps(cfg, 'angled')) & set(frame_stamps(cfg, 'topdown'))   # a slot counts only as a PAIR
    regular = [parse_stamp(s) for s in sorted(paired) if '-event-' not in s]
    miss, exp = missing_slots([x for x in regular if x], t, cfg['capture_min'], f0)
    ok = crc == 0 and len(got) == len(VIEWS)
    heartbeat(cfg, dict(row, ok=ok, step='done' if ok else 'capture', why=None if ok else msg,
                        missing_24h=miss, expected_24h=exp))
    return 0


def cmd_render_full(cfg, a):
    sok, swhy, _ = snapshot(cfg)
    if not sok:
        print(json.dumps({'full_render_rc': 'snapshot', 'why': swhy}))
        return 1
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
