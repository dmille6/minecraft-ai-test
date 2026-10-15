#!/usr/bin/env python3
"""Ziggurat timelapse: read-only region snapshots -> BlueMap render -> fixed-camera frame.

Runs on the world host (10.0.0.30) under ~/bluemap-tl. It NEVER writes under
source_root (/srv/block2): region files are read with rsync, level.dat with
`sudo -n cat` (it is mode 600 minecraft:minecraft). The live BlueMap in
~/bluemap is not touched; this uses its own config/data/webroot and port 8101.

  tl.py snapshot [--world W ...]          copy the site regions, one dated dir per world
  tl.py frame    [--world W ...] [--stamp S | --all-missing]
                                          render snapshot(s) and capture a PNG frame
  tl.py report                            snapshot/frame counts and sizes

Layout under out_root (default /var/tmp/timelapse):
  snapshots/<world>/<YYYYmmddTHHMMZ>/{level.dat,region/r.X.Z.mca}
  frames/<world>/<YYYYmmddTHHMMZ>.png
  video/<world>.mp4 / .gif                (tl_assemble.sh)
  logs/tl.log
"""
import argparse, json, os, shutil, signal, socket, subprocess, sys, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TL_HOME = os.environ.get('TL_HOME', os.path.expanduser('~/bluemap-tl'))
CONF = os.environ.get('TL_SITES', os.path.join(TL_HOME, 'sites.json'))
JAR = os.path.join(TL_HOME, 'bluemap-cli.jar')
BM_CONF = os.path.join(TL_HOME, 'config')
WEB = os.path.join(TL_HOME, 'web')
PORT = 8101
NICE = ['nice', '-n', '19', 'ionice', '-c3']


def load_cfg():
    with open(CONF) as f:
        return json.load(f)


def log(cfg, msg):
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}"
    print(line, flush=True)
    d = os.path.join(cfg['out_root'], 'logs')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'tl.log'), 'a') as f:
        f.write(line + '\n')


def map_id(world):
    return world.replace('-', '_')


def box(site, pad=0):
    cx, cz = site['center']
    h = site['half'] + pad
    return cx - h, cx + h, cz - h, cz + h


def regions_for(site, pad):
    x0, x1, z0, z1 = box(site, pad)
    return [f"r.{rx}.{rz}.mca"
            for rx in range(x0 // 512, x1 // 512 + 1)
            for rz in range(z0 // 512, z1 // 512 + 1)]


def free_gb(path):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1e9


def stamps(cfg, world):
    d = os.path.join(cfg['out_root'], 'snapshots', world)
    if not os.path.isdir(d):
        return []
    return sorted(s for s in os.listdir(d)
                  if os.path.isfile(os.path.join(d, s, 'COMPLETE')))


def dir_bytes(path, only_unlinked=False):
    tot = 0
    for root, _, files in os.walk(path):
        for fn in files:
            st = os.lstat(os.path.join(root, fn))
            if only_unlinked and st.st_nlink > 1:
                continue
            tot += st.st_size
    return tot


# ---------------------------------------------------------------- snapshot
def cmd_snapshot(cfg, args):
    out = cfg['out_root']
    os.makedirs(out, exist_ok=True)
    fg = free_gb(out)
    if fg < cfg['min_free_gb']:
        log(cfg, f"snapshot STOP: {fg:.1f} GB free < min_free_gb {cfg['min_free_gb']}; nothing copied")
        return 2
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%MZ')
    worlds = args.world or sorted(cfg['sites'])
    tot_new = tot_logical = 0
    rc = 0
    for w in worlds:
        site = cfg['sites'][w]
        src = os.path.join(cfg['source_root'], w, 'world')
        dest = os.path.join(out, 'snapshots', w, stamp)
        if os.path.exists(dest):
            log(cfg, f"snapshot {w} {stamp}: already exists, skipped")
            continue
        prev = stamps(cfg, w)
        files = [r for r in regions_for(site, cfg.get('region_pad', 16))
                 if os.path.isfile(os.path.join(src, 'region', r))]
        if not files:
            log(cfg, f"snapshot {w} {stamp}: FAIL no region file intersects the box {box(site)}")
            rc = 1
            continue
        os.makedirs(os.path.join(dest, 'region'))
        cmd = NICE + ['rsync', '-a', '--files-from=-']
        if prev:
            cmd.append(f"--link-dest={os.path.join(out, 'snapshots', w, prev[-1], 'region')}")
        cmd += [os.path.join(src, 'region') + '/', os.path.join(dest, 'region') + '/']
        # Two passes: the server may write a region while we copy it; the second
        # pass re-copies anything whose size/mtime moved under the first.
        for _ in range(2):
            p = subprocess.run(cmd, input='\n'.join(files) + '\n', text=True,
                               capture_output=True)
            if p.returncode != 0:
                break
        if p.returncode != 0:
            log(cfg, f"snapshot {w} {stamp}: FAIL rsync rc={p.returncode} {p.stderr.strip()[:300]}")
            shutil.rmtree(dest, ignore_errors=True)
            rc = 1
            continue
        with open(os.open(os.path.join(dest, 'level.dat'), os.O_WRONLY | os.O_CREAT, 0o600), 'wb') as f:
            q = subprocess.run(['sudo', '-n', 'cat', os.path.join(src, 'level.dat')],
                               stdout=f, stderr=subprocess.PIPE)
        if q.returncode != 0:
            log(cfg, f"snapshot {w} {stamp}: FAIL level.dat {q.stderr.decode().strip()[:200]}")
            shutil.rmtree(dest, ignore_errors=True)
            rc = 1
            continue
        new_b = dir_bytes(dest, only_unlinked=True)
        logical = dir_bytes(dest)
        tot_new += new_b
        tot_logical += logical
        with open(os.path.join(dest, 'COMPLETE'), 'w') as f:
            json.dump({'world': w, 'stamp': stamp, 'regions': files, 'site': site,
                       'new_bytes': new_b, 'logical_bytes': logical,
                       'linked_from': prev[-1] if prev else None}, f)
        log(cfg, f"snapshot {w} {stamp}: {len(files)} regions, new {new_b/1e6:.1f} MB "
                 f"(logical {logical/1e6:.1f} MB, hardlinked vs {prev[-1] if prev else 'none'})")
    log(cfg, f"snapshot {stamp} DONE {len(worlds)} worlds: new {tot_new/1e6:.1f} MB on disk, "
             f"logical {tot_logical/1e6:.1f} MB, free after {free_gb(out):.1f} GB")
    prune(cfg)
    return rc


def prune(cfg):
    """Delete snapshot dirs older than snapshot_keep_days ONLY once their frame exists.
    Frames are the product and are never pruned here."""
    keep = cfg.get('snapshot_keep_days', 14)
    cutoff = time.time() - keep * 86400
    for w in cfg['sites']:
        ss = stamps(cfg, w)
        for s in ss[:-1]:  # always keep the newest (the next --link-dest base)
            t = datetime.strptime(s, '%Y%m%dT%H%MZ').replace(tzinfo=timezone.utc).timestamp()
            frame = os.path.join(cfg['out_root'], 'frames', w, s + '.png')
            if t < cutoff and os.path.isfile(frame):
                shutil.rmtree(os.path.join(cfg['out_root'], 'snapshots', w, s))
                log(cfg, f"prune {w} {s}: snapshot removed (frame kept)")


# ---------------------------------------------------------------- render
MAP_CONF = """\
world: "{world_path}"
dimension: "minecraft:overworld"
name: "{world} timelapse"
sorting: 0
start-pos: {{ x: {cx}, z: {cz} }}
sky-color: "#7dabff"
void-color: "#000000"
sky-light: 1
ambient-light: 0.1
remove-caves-below-y: 55
cave-detection-ocean-floor: 10
cave-detection-uses-block-light: false
min-inhabited-time: 0
render-mask: [
  {{ min-x: {x0}, max-x: {x1}, min-z: {z0}, max-z: {z1}, min-y: {y0}, max-y: 320 }}
]
render-edges: true
edge-light-strength: 8
enable-perspective-view: true
enable-flat-view: true
enable-free-flight-view: false
enable-hires: true
storage: "file"
ignore-missing-light-data: false
marker-sets: {{}}
"""


def write_map_conf(cfg, world, stamp):
    site = cfg['sites'][world]
    x0, x1, z0, z1 = box(site)
    cx, cz = site['center']
    path = os.path.join(cfg['out_root'], 'snapshots', world, stamp)
    os.makedirs(os.path.join(BM_CONF, 'maps'), exist_ok=True)
    with open(os.path.join(BM_CONF, 'maps', map_id(world) + '.conf'), 'w') as f:
        # min-y: cut the slab a little below the site so the frame is the surface and the
        # build, not 130 blocks of stone wall under it.
        y0 = site.get('min_y', site.get('y', 70) - cfg['camera'].get('slab_below', 24))
        f.write(MAP_CONF.format(world_path=path, world=world, cx=cx, cz=cz,
                                x0=x0, x1=x1, z0=z0, z1=z1, y0=y0))


def camera_hash(cfg, world):
    import math
    site, cam = cfg['sites'][world], cfg['camera']
    cx, cz = site['center']
    dist = site.get('distance', round(site['half'] * cam['distance_per_half']))
    rot = math.radians(site.get('rotation_deg', cam['rotation_deg']))
    ang = math.radians(cam['angle_deg'])
    # Aim a little beyond the centre, away from the camera: at 45 deg the near slab wall is
    # short and the far side carries the tall stuff (trees, the build), so a centred target
    # leaves an empty band at the bottom of the frame. BlueMap snaps the target's y to the
    # terrain, so y here is nominal; framing is moved with this offset instead.
    off = site.get('aim_beyond', cam.get('aim_beyond_frac', 0.0) * site['half'])
    tx = cx + 0.5 - math.sin(rot) * off
    tz = cz + 0.5 - math.cos(rot) * off
    # BlueMap 5 hash: map:x:y:z:distance:rotation:angle:tilt:ortho:mode
    return (f"#{map_id(world)}:{tx:.1f}:{site.get('y', 70)}:{tz:.1f}:{dist}:"
            f"{rot:.4f}:{ang:.4f}:0:0:perspective")


def port_open():
    try:
        with socket.create_connection(('127.0.0.1', PORT), timeout=1):
            return True
    except OSError:
        return False


def render_and_capture(cfg, jobs):
    """jobs: list of (world, stamp), at most one stamp per world."""
    ids = []
    for w, s in jobs:
        write_map_conf(cfg, w, s)
        shutil.rmtree(os.path.join(WEB, 'maps', map_id(w)), ignore_errors=True)
        ids.append(map_id(w))
    t0 = time.time()
    with open(os.path.join(TL_HOME, 'logs', 'render.log'), 'a') as lf:
        p = subprocess.run(NICE + ['java', '-Xmx3G', '-jar', JAR, '-c', BM_CONF,
                                   '-r', '-f', '-m', ','.join(ids)],
                           cwd=TL_HOME, stdout=lf, stderr=subprocess.STDOUT)
    log(cfg, f"render {','.join(ids)} rc={p.returncode} in {time.time()-t0:.0f}s")
    if p.returncode != 0:
        return 1
    # Drop the lowres levels (tiles/1..n). Lowres is a heightmap mesh that ignores the
    # render-mask's min-y, so it draws green "legs" hanging under the cut slab. At a
    # fixed close camera every visible tile is hires anyway.
    for i in ids:
        td = os.path.join(WEB, 'maps', i, 'tiles')
        for lvl in os.listdir(td) if os.path.isdir(td) else []:
            if lvl != '0':
                shutil.rmtree(os.path.join(td, lvl))
    if port_open():
        log(cfg, f"frame FAIL: port {PORT} already in use (stale timelapse webserver?)")
        return 1
    ws = subprocess.Popen(NICE + ['java', '-Xmx1G', '-jar', JAR, '-c', BM_CONF, '-w'],
                          cwd=TL_HOME, stdout=open(os.path.join(TL_HOME, 'logs', 'webserver.log'), 'a'),
                          stderr=subprocess.STDOUT, start_new_session=True)
    try:
        for _ in range(120):
            if port_open():
                break
            time.sleep(0.5)
        else:
            log(cfg, "frame FAIL: timelapse webserver did not open its port")
            return 1
        cam = cfg['camera']
        spec = []
        for w, s in jobs:
            out = os.path.join(cfg['out_root'], 'frames', w, s + '.png')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            spec.append({'url': f"http://127.0.0.1:{PORT}/{camera_hash(cfg, w)}",
                         'out': out, 'width': cam['width'], 'height': cam['height'],
                         'fov': cam.get('fov'),
                         'settle_ms': cam['settle_ms']})
        env = dict(os.environ, PUPPETEER_CACHE_DIR=os.path.join(TL_HOME, 'capture', '.cache'))
        t0 = time.time()
        c = subprocess.run(NICE + ['node', os.path.join(TL_HOME, 'capture', 'capture.mjs')],
                           input=json.dumps(spec), text=True, capture_output=True, env=env,
                           cwd=os.path.join(TL_HOME, 'capture'))
        for line in (c.stdout + c.stderr).strip().splitlines():
            log(cfg, f"capture: {line}")
        log(cfg, f"capture {len(spec)} frames rc={c.returncode} in {time.time()-t0:.0f}s")
        return c.returncode
    finally:
        os.killpg(ws.pid, signal.SIGTERM)
        try:
            ws.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(ws.pid, signal.SIGKILL)


def cmd_frame(cfg, args):
    import fcntl
    os.makedirs(os.path.join(TL_HOME, 'logs'), exist_ok=True)
    # one renderer at a time: map confs, the webroot and port 8101 are shared state
    lock = open(os.path.join(TL_HOME, 'logs', 'frame.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log(cfg, "frame SKIP: another frame run holds the lock")
        return 0
    worlds = args.world or sorted(cfg['sites'])
    todo = {}
    for w in worlds:
        ss = stamps(cfg, w)
        if args.stamp:
            ss = [s for s in ss if s == args.stamp]
        elif not args.all_missing:
            ss = ss[-1:]
        ss = [s for s in ss if args.redo or not os.path.isfile(
            os.path.join(cfg['out_root'], 'frames', w, s + '.png'))]
        if ss:
            todo[w] = ss
    if not todo:
        log(cfg, "frame: nothing to do")
        return 0
    rc = 0
    # one BlueMap pass per "round": the webserver serves one state per map,
    # so a world with several missing stamps takes several rounds.
    while todo:
        jobs = [(w, ss.pop(0)) for w, ss in todo.items()]
        todo = {w: ss for w, ss in todo.items() if ss}
        rc |= render_and_capture(cfg, jobs)
    return rc


def cmd_report(cfg, args):
    out = cfg['out_root']
    tot_s = tot_f = 0
    for w in sorted(cfg['sites']):
        sd = os.path.join(out, 'snapshots', w)
        fd = os.path.join(out, 'frames', w)
        ss = stamps(cfg, w)
        fs = sorted(os.listdir(fd)) if os.path.isdir(fd) else []
        sb = dir_bytes(sd) if os.path.isdir(sd) else 0
        fb = dir_bytes(fd) if os.path.isdir(fd) else 0
        tot_f += fb
        print(f"{w:10s} snapshots {len(ss):4d}  frames {len(fs):4d}  frames {fb/1e6:7.1f} MB  "
              f"latest {ss[-1] if ss else '-'}")
    du = subprocess.run(['du', '-sb', os.path.join(out, 'snapshots')], capture_output=True, text=True)
    if du.returncode == 0:
        tot_s = int(du.stdout.split()[0])
    print(f"TOTAL snapshots on disk {tot_s/1e9:.2f} GB (hardlinks counted once), "
          f"frames {tot_f/1e9:.2f} GB, free {free_gb(out):.1f} GB")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('snapshot'); s.add_argument('--world', action='append')
    f = sub.add_parser('frame'); f.add_argument('--world', action='append')
    f.add_argument('--stamp'); f.add_argument('--all-missing', action='store_true')
    f.add_argument('--redo', action='store_true')
    sub.add_parser('report')
    a = ap.parse_args()
    cfg = load_cfg()
    for w in (getattr(a, 'world', None) or []):
        if w not in cfg['sites']:
            sys.exit(f"unknown world {w}; configured: {sorted(cfg['sites'])}")
    return {'snapshot': cmd_snapshot, 'frame': cmd_frame, 'report': cmd_report}[a.cmd](cfg, a)


if __name__ == '__main__':
    sys.exit(main())
