#!/usr/bin/env python3
"""timelapse2-1110 driver ON 10.0.0.30 (mike's crontab, nice 19). Installed in ~/tl2/bin with tl2.py + tl2trails.py.
  daily        00:50Z  yesterday: map trails + heat (daily; weekly on Mondays), the 60-s reel
  beforeafter  17:25Z  yesterday 17:00Z vs today 17:00Z (CoreProtect)
  projects     */20    a clip per project_done (event + slot frames); landmark -> beauty queue
  beauty       05:50Z  Chunky golden hour of each queued landmark (after the nightly beauty run, its world copy)
  film         Sun 02:30Z  the master "from day 1" film from the NAS (hourly frames)
Inputs come from the showcase VM through the EXISTING read-only key (rrsync -ro /srv/showcase/timelapse/): data/<day>/
(tl_extract.py) and frames. Outputs: ~/tl2/out/<format>/<date>/ and the NAS /mnt/nas-tl/showcase/video/<format>/<date>/
(sudo -n: the share is root-only). One run at a time per job (flock). Logs: ~/tl2/run.log."""
import datetime as dt, fcntl, glob, json, math, os, shutil, subprocess, sys

H = os.path.expanduser('~/tl2')
BIN = os.path.join(H, 'bin')
CACHE = os.path.join(H, 'cache')                 # frames/<view>/<day>/ + data/<day>/
OUT = os.path.join(H, 'out')
NAS = '/mnt/nas-tl/showcase/video'
KEY = os.path.expanduser('~/.ssh/id_showcase_tl')
VM = 'showbak@10.0.0.40'
RS = ['nice', '-n', '19', 'rsync', '-rt', '-e', f'ssh -o BatchMode=yes -o ConnectTimeout=20 -i {KEY}']
UTC = dt.timezone.utc


def log(*a):
    line = dt.datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ') + ' ' + ' '.join(str(x) for x in a)
    print(line, flush=True)
    with open(os.path.join(H, 'run.log'), 'a') as f:
        f.write(line + '\n')


def pull(includes, dst):
    """rsync from the VM's timelapse root with include patterns (directories always traversed)."""
    args = RS + ['-m', '--include=*/'] + [f'--include={i}' for i in includes] + ['--exclude=*', f'{VM}:./', dst + '/']
    return subprocess.run(args, capture_output=True, text=True).returncode


def pull_data(days):
    pull([f'data/{d}/**' for d in days], CACHE)


def ymd(d):
    return d.strftime('%Y%m%d')


def workdir(name, days):
    """A job dir: src -> the cache, and the days' extracts concatenated under tl2.py's file names."""
    w = os.path.join(H, 'work', name)
    shutil.rmtree(w, ignore_errors=True)
    os.makedirs(w)
    os.symlink(CACHE, os.path.join(w, 'src'))
    for src, dst in (('build.tsv', 'build.tsv'), ('cp.tsv', 'cp.tsv'), ('pos.tsv', 'posfull.tsv'), ('chat.jsonl', 'showchat-lines.jsonl')):
        with open(os.path.join(w, dst), 'w') as f:
            for d in days:
                p = os.path.join(CACHE, 'data', ymd(d), src)
                if os.path.exists(p):
                    f.write(open(p).read())
    open(os.path.join(w, 'pos.tsv'), 'w').close()
    last = [os.path.join(CACHE, 'data', ymd(d)) for d in days if os.path.exists(os.path.join(CACHE, 'data', ymd(d), 'cameras.json'))]
    for f in ('cameras.json', 'sites.json'):
        if last:
            shutil.copy(os.path.join(last[-1], f), os.path.join(w, f))
    return w


def run(w, *args):
    p = subprocess.run(['nice', '-n', '19', 'ionice', '-c3', 'python3', os.path.join(BIN, args[0])] + list(args[1:]),   # not -I: it drops BIN (tl2trails imports tl2)
                       cwd=w, capture_output=True, text=True, env=dict(os.environ, PYTHONPATH=BIN, TL2_THREADS='4'))
    tail = (p.stdout.strip().splitlines() or [''])[-1][:300]
    log('  ', args[0], args[1] if len(args) > 1 else '', 'rc', p.returncode, tail if p.returncode == 0 else p.stderr[-400:])
    return p.returncode == 0


def publish(fmt, date, files):
    """~/tl2/out/<fmt>/<date>/ + the NAS copy (root-only share)."""
    o = os.path.join(OUT, fmt, date)
    os.makedirs(o, exist_ok=True)
    got = [f for f in files if os.path.exists(f)]
    for f in got:
        shutil.copy(f, o)
    n = os.path.join(NAS, fmt, date)
    rc = subprocess.run(['sudo', '-n', 'install', '-d', n], capture_output=True).returncode
    if rc == 0:
        rc = subprocess.run(['sudo', '-n', 'cp'] + [os.path.join(o, os.path.basename(f)) for f in got] + [n + '/'],
                            capture_output=True).returncode
    log('  publish', fmt, date, [os.path.basename(f) for f in got], 'nas' if rc == 0 else f'NAS FAIL rc={rc}')
    return [os.path.join(o, os.path.basename(f)) for f in got]


def size_cap(path, mb=29):
    """Re-encode an mp4 two-pass under `mb` MB (the chat upload limit) when it is bigger."""
    if not os.path.exists(path) or os.path.getsize(path) <= mb * 1e6:
        return
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                             capture_output=True, text=True).stdout or 1)
    kbps = int(mb * 8e3 / max(d, 1) * 0.95)
    tmp = path + '.cap.mp4'
    base = ['nice', '-n', '19', 'ffmpeg', '-loglevel', 'error', '-y', '-threads', '4', '-i', path, '-c:v', 'libx264',
            '-preset', 'slow', '-b:v', f'{kbps}k', '-passlogfile', path + '.p2']
    subprocess.run(base + ['-pass', '1', '-an', '-f', 'mp4', '/dev/null'], check=True)
    subprocess.run(base + ['-pass', '2', '-movflags', '+faststart', tmp], check=True)
    os.replace(tmp, path)
    for f in glob.glob(path + '.p2*'):
        os.remove(f)


def prune_cache(keep_days=9):
    cut = ymd(dt.datetime.now(UTC) - dt.timedelta(days=keep_days))
    for d in glob.glob(os.path.join(CACHE, 'frames', '*', '2*')) + glob.glob(os.path.join(CACHE, 'data', '2*')):
        if os.path.basename(d) < cut:
            shutil.rmtree(d, ignore_errors=True)


def job_daily(day=None):
    today = dt.datetime.now(UTC).date()
    D = day or today - dt.timedelta(days=1)
    week = [D - dt.timedelta(days=k) for k in range(6, -1, -1)]
    pull_data([ymd(d) for d in week])
    pull([f'frames/topdown/{ymd(d)}/*T??00Z.png' for d in week], CACHE)
    w = workdir('daily', week)
    files = []
    for kind in ('trails', 'heat'):
        o = os.path.join(w, f'map-{kind}-{D.isoformat()}.mp4')
        if run(w, 'tl2trails.py', kind, ymd(D), ymd(D), o, o[:-4] + '.png'):
            size_cap(o)
            files += [o, o[:-4] + '.png']
        if D.weekday() == 6:                            # the week ending Sunday, built Monday 00:50Z
            ow = os.path.join(w, f'map-{kind}-week-ending-{D.isoformat()}.mp4')
            if run(w, 'tl2trails.py', kind, ymd(week[0]), ymd(D), ow, ow[:-4] + '.png'):
                size_cap(ow)
                files += [ow, ow[:-4] + '.png']
    publish('map', D.isoformat(), files)
    # the reel: the day's frames + sidecars of the reel cameras (the sidecar `changed` score: no PNG decode)
    cams = json.load(open(os.path.join(w, 'cameras.json'))) if os.path.exists(os.path.join(w, 'cameras.json')) else {}
    views = [v for v in cams if v not in ('topdown', 'angled', 'town', 'expeditions', 'patina', 'projectev', 'grounds')]
    pull([f'frames/{v}/{ymd(D)}/*' for v in views], CACHE)
    o = os.path.join(w, f'reel-{D.isoformat()}.mp4')
    trails = os.path.join(w, f'map-trails-{D.isoformat()}.mp4')
    if run(w, 'tl2.py', 'reel', ymd(D), o, trails):
        size_cap(o)
        publish('reel', D.isoformat(), [o, o + '.json'])
    prune_cache()


def job_beforeafter(day=None):
    T = day or dt.datetime.now(UTC).date()
    Y = T - dt.timedelta(days=1)
    pull_data([ymd(Y), ymd(T)])
    a, b = f'{ymd(Y)}T1700Z', f'{ymd(T)}T1700Z'
    pull([f'frames/topdown/{ymd(Y)}/{a}.png', f'frames/topdown/{ymd(T)}/{b}.png'], CACHE)
    w = workdir('beforeafter', [Y, T])
    png, mp4 = os.path.join(w, f'beforeafter-{T.isoformat()}.png'), os.path.join(w, f'beforeafter-{T.isoformat()}.mp4')
    if run(w, 'tl2.py', 'beforeafter', 'topdown', a, b, '95', png, mp4, '1920', '1080'):
        publish('beforeafter', T.isoformat(), [png, mp4, mp4 + '.json'])


def follow_framing(cam, site):
    """tl_showcase.follow_camera, for a Chunky view of a project box."""
    x0, z0, x1, z1 = site['box']
    size = max(abs(x1 - x0), abs(z1 - z0)) + 1
    return {'x': (min(x0, x1) + max(x0, x1) + 1) / 2, 'z': (min(z0, z1) + max(z0, z1) + 1) / 2,
            'y': int(site.get('g') or cam.get('y') or 69), 'distance': int(max(cam.get('min_distance', 45), round(cam.get('fit', 2.6) * size))),
            'rotation': cam.get('rotation', 0.7854), 'angle': cam.get('angle', 0.85), 'fov': cam.get('fov', 32)}


def job_projects():
    today = dt.datetime.now(UTC).date()
    days = [today - dt.timedelta(days=1), today]
    pull_data([ymd(d) for d in days])
    stp = os.path.join(H, 'projects-state.json')
    st = json.load(open(stp)) if os.path.exists(stp) else {'done': [], 'beauty_queue': []}
    w = workdir('projects', [today - dt.timedelta(days=k) for k in range(8, -1, -1)])
    cams = json.load(open(os.path.join(w, 'cameras.json'))) if os.path.exists(os.path.join(w, 'cameras.json')) else {}
    sites = json.load(open(os.path.join(w, 'sites.json'))) if os.path.exists(os.path.join(w, 'sites.json')) else {}
    ev = cams.get('projectev') or {}
    for line in open(os.path.join(w, 'showchat-lines.jsonl')):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get('cat') != 'project_done' or r['t'] in st['done']:
            continue
        st['done'].append(r['t'])
        if r['t'][:10] < days[0].isoformat():
            continue
        rows = [l.split('\t') for l in open(os.path.join(w, 'build.tsv')) if '\tplace\t' in l]
        names = {x[2] for x in rows}
        proj = next((p for p in sorted(names, key=len, reverse=True) if f'The {p} is' in r['text'] or p in r['text']), None)
        if not proj or proj in set(ev.get('exclude') or ()):
            continue
        cam = next((v for v, c in sorted(cams.items()) if proj in ((c or {}).get('project') or []) and not c.get('heavy')
                    and not c.get('follow')), 'projectev')
        span = sorted({x[0][:10].replace('-', '') for x in rows if x[2] == proj})
        pull([f'frames/{cam}/{d}/*' for d in span], CACHE)
        o = os.path.join(w, f'{proj}.mp4')
        if run(w, 'tl2.py', 'project', cam, proj, proj, f'{proj} - finished {r["t"][:16].replace("T", " ")} UTC', o, '5'):
            size_cap(o)
            publish('project', r['t'][:10], [o, o + '.json'])
        if proj in sites and ev:                       # a boxed (landmark) project: a beauty shot tonight
            st['beauty_queue'].append({'project': proj, 'camera': dict(follow_framing(ev, sites[proj]), label=proj),
                                       'done': r['t']})
    st['done'] = st['done'][-500:]
    json.dump(st, open(stp, 'w'), indent=1)


def job_beauty():
    stp = os.path.join(H, 'projects-state.json')
    st = json.load(open(stp)) if os.path.exists(stp) else {'beauty_queue': []}
    q = st.get('beauty_queue') or []
    if not q:
        return
    CB = os.path.expanduser('~/chunky-beauty')
    lockf = open(os.path.join(CB, '.lock'), 'a+')
    fcntl.flock(lockf, fcntl.LOCK_EX)                 # never beside the nightly beauty run (same kit, same world copy)
    day = dt.datetime.now(UTC).date().isoformat()
    left = []
    for item in q:
        sd = os.path.join(H, 'work', 'beauty', item['project'])
        shutil.rmtree(sd, ignore_errors=True)
        os.makedirs(sd)
        vj = os.path.join(sd, 'views.json')
        json.dump({'project4k': {'camera': item['camera']}}, open(vj, 'w'))
        if subprocess.run(['python3', '-I', os.path.join(CB, 'bin', 'chunky_beauty.py'), 'scenes', os.path.join(sd, 'scenes'),
                           os.path.join(CB, 'world'), '--views-json', vj, '--spp', '320'], capture_output=True).returncode:
            left.append(item)
            continue
        K = os.path.join(CB, 'kit')
        rc = subprocess.run(['timeout', '60m', 'nice', '-n', '19', 'ionice', '-c3', 'java', '-Xmx6G', f'-Dchunky.home={K}/home',
                             '-cp', f'{K}/lib/*', 'se.llbit.chunky.main.Chunky', '-scene-dir', os.path.join(sd, 'scenes'),
                             '-texture', f'{K}/packs/faithful32x-1.21.8.zip', '-render', 'project', '-threads', '12',
                             '-target', '320', '-f'], capture_output=True).returncode
        png = sorted(glob.glob(os.path.join(sd, 'scenes', 'project', 'snapshots', '*.png')), key=os.path.getmtime)
        if rc == 0 and png:
            dst = os.path.join(sd, f"{item['project']}.png")
            shutil.copy(png[-1], dst)
            publish('beauty', day, [dst])
        else:
            log('  beauty FAIL', item['project'], 'rc', rc)
    st['beauty_queue'] = left
    json.dump(st, open(stp, 'w'), indent=1)


def job_film():
    """The master film from the NAS: hourly angled + hero4k frames since day 1 (sudo: the share is root-only)."""
    fc = os.path.join(H, 'filmcache')
    os.makedirs(fc, exist_ok=True)
    rc = subprocess.run(['sudo', '-n', 'nice', '-n', '19', 'rsync', '-rt', '-m', '--include=*/', '--include=angled/*/*T??00Z.png',
                         '--include=hero4k/*/*T??00Z.png', '--exclude=*', '/mnt/nas-tl/showcase/frames/', fc + '/frames/'],
                        capture_output=True).returncode
    subprocess.run(['sudo', '-n', 'chown', '-R', f'{os.getuid()}:{os.getgid()}', fc], capture_output=True)
    today = dt.datetime.now(UTC).date()
    w = workdir('film', [today - dt.timedelta(days=1)])
    os.remove(os.path.join(w, 'src'))
    os.symlink(fc, os.path.join(w, 'src'))
    # the milestones: every chat line archived on the NAS data/ (project_done), concatenated
    subprocess.run(f"sudo -n sh -c 'cat /mnt/nas-tl/showcase/data/2*/chat.jsonl 2>/dev/null' >> {w}/showchat-lines.jsonl", shell=True)
    o = os.path.join(w, f'from-day1-{today.isoformat()}.mp4')
    log('  film nas rsync rc', rc)
    if run(w, 'tl2.py', 'film', o):
        size_cap(o)
        publish('film', today.isoformat(), [o, o + '.json'])


def main():
    job = sys.argv[1]
    day = dt.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else None
    os.makedirs(H, exist_ok=True)
    lock = open(os.path.join(H, f'.{job}.lock'), 'a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log(job, 'SKIP: already running')
        return 0
    log(job, 'start', day or '')
    {'daily': lambda: job_daily(day), 'beforeafter': lambda: job_beforeafter(day), 'projects': job_projects,
     'beauty': job_beauty, 'film': job_film}[job]()
    log(job, 'done')
    return 0


if __name__ == '__main__':
    sys.exit(main())
