#!/usr/bin/env python3
"""timelapse2-1110: EVENT-DRIVEN project frames on the showcase, OUTSIDE the 15-min slot (showcase-tl-event.timer, every
2 min). A project gets a frame only when its `_build` place rows arrived since its last event frame:
  * at most every `min_gap_min` (5) minutes, or `fast_gap_min` (2) while it places more than `fast_per_h` (150) an hour;
  * never within `guard_s` (240 s) of the next quarter-hour slot, and never while the slot holds the renderer lock
    (the slot is never delayed: it takes the lock with wait_s=0 and would skip, so this side always yields);
  * at most `max_cams` (2) cameras per tick, each 1440^2 (no 4K `heavy` camera here).
The camera is the project's own fixed camera (tl.conf `project` lists) when one exists, else the `event_camera`
(a follow framing of the project's box, steeper than project4k so the canopy hides less). Frames are
frames/<camera>/<day>/<stamp>-event-<project>.png (+ .json sidecar: label, project, placed, changed): tl_video skips
event frames; .30's tl2 builds the project clip from them at project_done.
State: logs/event-state.json (log offsets, per-project last frame + recent place times). Log: logs/event.jsonl.
Read-only on the world and the bots; the snapshot is tl_showcase's (save-hold, mirror copy)."""
import datetime as dt, glob, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl_showcase as T          # noqa: E402

DEFAULTS = {'min_gap_min': 5, 'fast_gap_min': 2, 'fast_per_h': 150, 'guard_s': 240, 'budget_s': 200, 'max_cams': 2,
            'log_glob': '/var/log/mcai/showcase-*/skill-showcase-*.jsonl', 'event_camera': 'projectev',
            'exclude': ['tidy', 'paths', 'forest', 'decor', 'dress', 'road', 'wall', 'wallext', 'walldemo', 'grounds',
                        'yard', 'shopchest', 'shaft']}
RX_P, RX_O = re.compile(r'project=(\S+)'), re.compile(r'op=(\S+)')
RX_C = re.compile(r'cell=(-?\d+),(-?\d+),(-?\d+)')


def ev_conf(cfg):
    return dict(DEFAULTS, **(cfg.get('event') or {}))


def parse_place(line):
    """One skill-log line -> (iso time, project, (x, y, z)) for a `_build` op=place row, else None. Pure (tested)."""
    if '"_build"' not in line or 'op=place' not in line:
        return None
    try:
        r = json.loads(line)
    except ValueError:
        return None
    sk = r.get('skill') or {}
    if sk.get('name') != '_build':
        return None
    d = sk.get('detail') or ''
    o, p, c = RX_O.search(d), RX_P.search(d), RX_C.search(d)
    if not (o and p and c) or o.group(1) != 'place':
        return None
    return r.get('@timestamp', '')[:19], p.group(1), tuple(int(v) for v in c.groups())


def gap_min(ec, recent, now):
    """Minutes between this project's event frames: fast_gap_min while it placed more than fast_per_h in the last hour
    (recent: place times), else min_gap_min. Pure (tested)."""
    hour = sum(1 for t in recent if now - t <= dt.timedelta(hours=1))
    return float(ec['fast_gap_min'] if hour > ec['fast_per_h'] else ec['min_gap_min'])


def due_projects(ec, projects, now):
    """Projects due an event frame: placed since their last event frame, the gap has passed, not excluded. Most
    pending first. projects: {name: {'pending': n, 'last': datetime|None, 'recent': [datetime]}}. Pure (tested)."""
    out = []
    for p, st in projects.items():
        if p in ec['exclude'] or st.get('pending', 0) <= 0:
            continue
        last = st.get('last')
        if last is None or (now - last).total_seconds() / 60 + 0.25 >= gap_min(ec, st.get('recent') or [], now):
            out.append(p)
    return sorted(out, key=lambda p: (-projects[p]['pending'], p))


def secs_to_slot(now, capture_min=15):
    """Seconds until the next quarter-hour slot boundary. Pure (tested)."""
    m = capture_min * 60
    s = (now.minute * 60 + now.second) % m
    return m - s


def camera_for(cfg, ec, project, sites):
    """(view, camera dict) for a project: its own fixed, non-heavy camera, else the event follow camera framed on its
    box, else None (no camera, no box). Pure (tested)."""
    for v, cam in sorted((cfg.get('cameras') or {}).items()):
        names = (cam or {}).get('project') or []
        names = [names] if isinstance(names, str) else names
        if project in names and not cam.get('heavy') and not cam.get('follow') and v not in T.VIEWS:
            return v, cam
    evc = (cfg.get('cameras') or {}).get(ec['event_camera'])
    if evc and project in sites:
        return ec['event_camera'], T.follow_camera(evc, project, sites[project])
    return None


def state_path(cfg):
    return os.path.join(cfg['root'], 'logs', 'event-state.json')


def load_state(cfg):
    try:
        st = json.load(open(state_path(cfg)))
    except (OSError, ValueError):
        st = {}
    st.setdefault('offsets', {})
    st.setdefault('projects', {})
    return st


def tail(st, pattern, now):
    """New `_build` place rows since the last tick, per live log file (offset + inode; a rotated or truncated file
    restarts at 0 but only rows newer than the last tick count). -> [(datetime, project, cell)]."""
    rows, since = [], st.get('last_tick')
    for f in sorted(glob.glob(pattern)):
        try:
            sb = os.stat(f)
        except OSError:
            continue
        ino, off = st['offsets'].get(f, [None, None])
        if off is None:                       # first sight: start at the end (no back-fill of old days)
            st['offsets'][f] = [sb.st_ino, sb.st_size]
            continue
        if ino != sb.st_ino or sb.st_size < off:
            off = 0
        with open(f, 'rb') as fh:
            fh.seek(off)
            data = fh.read()
        end = data.rfind(b'\n') + 1
        for line in data[:end].decode('utf-8', 'replace').splitlines():
            r = parse_place(line)
            if r and (since is None or r[0] > since[:19]):
                rows.append((dt.datetime.strptime(r[0], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=dt.timezone.utc), r[1], r[2]))
        st['offsets'][f] = [sb.st_ino, off + end]
    return rows


def log(cfg, row):
    with open(os.path.join(cfg['root'], 'logs', 'event.jsonl'), 'a') as f:
        f.write(json.dumps(dict(row, t=T._iso(T.now_utc()))) + '\n')


def save_state(cfg, st):
    p = state_path(cfg)
    with open(p + '.part', 'w') as f:
        json.dump(st, f)
    os.replace(p + '.part', p)


def tick(cfg):
    ec, now = ev_conf(cfg), T.now_utc()
    st = load_state(cfg)
    rows = tail(st, ec['log_glob'], now)
    st['last_tick'] = T._iso(now)
    for t, p, c in rows:
        ps = st['projects'].setdefault(p, {'pending': 0, 'last': None, 'recent': []})
        ps['pending'] += 1
        ps['recent'].append(T._iso(t))
    for ps in st['projects'].values():          # keep one hour of place times
        ps['recent'] = [x for x in ps['recent'] if now - T._t(x) <= dt.timedelta(hours=1)]
    view = {p: {'pending': ps['pending'], 'last': T._t(ps['last']) if ps.get('last') else None,
                'recent': [T._t(x) for x in ps['recent']]} for p, ps in st['projects'].items()}
    due = due_projects(ec, view, now)
    left = secs_to_slot(now, int(cfg.get('capture_min') or 15))
    if not due or left < ec['guard_s']:
        save_state(cfg, st)
        if due:
            log(cfg, {'ok': True, 'step': 'guard', 'due': due, 'secs_to_slot': left})
        return 0
    sites = T.project_sites(cfg)
    cams, shoot = {}, []
    for p in due:
        cv = camera_for(cfg, ec, p, sites)
        if not cv or cv[0] in cams:
            continue
        cams[cv[0]] = dict(cv[1], label=cv[1].get('label') or p)
        shoot.append((cv[0], p))
        if len(shoot) >= ec['max_cams']:
            break
    if not shoot:
        save_state(cfg, st)
        log(cfg, {'ok': True, 'step': 'nocamera', 'due': due})
        return 0
    try:
        with T.renderer_lock(cfg, 'event ' + ','.join(p for _, p in shoot), wait_s=0):
            t0 = time.time()
            sok, swhy, _ = T.snapshot(cfg)
            if not sok:
                save_state(cfg, st)
                log(cfg, {'ok': False, 'step': 'snapshot', 'why': swhy})
                return 0
            rc, rs, _ = T.render(cfg)
            if rc != 0:
                save_state(cfg, st)
                log(cfg, {'ok': False, 'step': 'render', 'rc': rc})
                return 0
            deadline = min(t0 + ec['budget_s'], time.time() + secs_to_slot(T.now_utc()) - 45)
            stamp = T.stamp_of(now)
            got_all, err_all = [], {}
            for v, p in shoot:          # one capture per project: the stamp carries the project name
                s = f'{stamp}-event-{p}'
                rcfg = dict(cfg, cameras=dict(cfg.get('cameras') or {}, **cams))
                crc, msg, got, cs, _, extra, err, _ = T.capture(rcfg, s, [v], deadline=deadline, pair=())
                for f in extra:
                    gpath = os.path.join(cfg['root'], 'logs', 'gray', f'ev-{p}.gray')
                    gray = T.small_gray(f)
                    try:
                        prev = open(gpath, 'rb').read()
                    except OSError:
                        prev = b''
                    side = {'label': cams[v].get('label') or p, 'project': p, 'event': True,
                            'placed': st['projects'][p]['pending'],
                            'changed': round(T.changed_fraction(prev, gray), 5) if prev and gray else None}
                    with open(f[:-4] + '.json', 'w') as fh:
                        json.dump(side, fh)
                    if gray:
                        os.makedirs(os.path.dirname(gpath), exist_ok=True)
                        open(gpath, 'wb').write(gray)
                    st['projects'][p].update(pending=0, last=T._iso(now))
                got_all += extra
                err_all.update(err)
            log(cfg, {'ok': not err_all, 'step': 'done', 'shot': [f'{v}:{p}' for v, p in shoot], 'files': got_all,
                      'errors': err_all, 'render_s': rs, 'took_s': round(time.time() - t0, 1),
                      'secs_to_slot_after': secs_to_slot(T.now_utc())})
    except T.RendererBusy as e:
        log(cfg, {'ok': True, 'step': 'busy', 'due': due, 'holder': str(e)[:120]})
    save_state(cfg, st)
    return 0


def main():
    cfg = T.load_conf()
    os.makedirs(os.path.join(cfg['root'], 'logs'), exist_ok=True)
    if not (cfg.get('event') or {}).get('on'):
        return 0
    return tick(cfg)


if __name__ == '__main__':
    sys.exit(main())
