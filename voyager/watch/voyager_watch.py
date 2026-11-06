#!/usr/bin/env python3
"""voyager-01 THE LIGHT WATCHER (docs/reports/voyager-01-design-2026-11-06.md §5, §12 B5).

Runs every minute as root on the worlds host. Reads only voyager files. Stops a bot (`systemctl stop voyager-bot@<arm>`)
on: 2 deaths in a rolling 6 h; any command attempt (server or bot side); any sandbox violation; 3 process starts in 30
min (a crash loop); 10 minutes of executing skills with no world change. Stops EVERY voyager unit (Paper included) when
the host is under pressure. It never touches a unit whose name does not start with `voyager-`.

A stopped arm stays stopped: a STOPPED-<arm> marker is written, and the watcher re-stops the arm while it exists. A human
reads the cause, removes the marker and restarts it (logged).

  voyager_watch.py run [--dry-run]     one pass (the timer's call)
  voyager_watch.py selftest            the decision functions against fixtures
"""
import datetime as dt
import json
import os
import shutil
import subprocess
import sys

ROOT = os.environ.get('VOYAGER_ROOT', '/srv/voyager')
ARMS = os.environ.get('VOYAGER_ARMS', 'a,b,c,ctl').split(',')
OUT = os.environ.get('VOYAGER_WATCH_LOG', '/var/log/voyager/watch.jsonl')
DEATHS_6H = 2
STARTS_30M = 3
STILL_MIN = 10
HOST = {'load5': 24.0, 'mem_avail_gb': 8.0, 'root_free_gb': 60.0, 'voyager_gb': 40.0}


def now():
    return dt.datetime.now(dt.timezone.utc)


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def rows(path, since):
    """JSON rows of a jsonl file (and its .1 rotation) newer than `since`. Never raises."""
    out = []
    for p in (path + '.1', path):
        try:
            with open(p, 'rb') as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    t = ts(r.get('t'))
                    if t and t >= since:
                        out.append(r)
        except FileNotFoundError:
            pass
    return out


# ---- decisions (pure) -----------------------------------------------------------------------------------------
def decide_arm(vrows, grows, t):
    """The stop reason for one arm, or None. vrows: voyager log rows (last 6 h); grows: VoyagerGuard rows (last 6 h)."""
    deaths = [r for r in grows if r.get('kind') == 'death']
    if len(deaths) >= DEATHS_6H:
        return f'{len(deaths)} deaths in 6 h (server record): ' + '; '.join(str(d.get('message'))[:60] for d in deaths[-2:])
    cmd = [r for r in grows if r.get('kind') == 'command_denied'] + [r for r in vrows if r.get('kind') == 'command_attempt']
    if cmd:
        c = cmd[-1]
        return f"command attempt ({c.get('source', 'server')}): {str(c.get('command') or c.get('text'))[:60]}"
    v = [r for r in vrows if r.get('kind') == 'sandbox_violation']
    if v:
        return f"sandbox violation: generated code touched {v[-1].get('name')}"
    starts = [r for r in vrows if r.get('kind') == 'process_start' and ts(r['t']) >= t - dt.timedelta(minutes=30)]
    if len(starts) >= STARTS_30M:
        return f'{len(starts)} process starts in 30 min (crash loop)'
    win = t - dt.timedelta(minutes=STILL_MIN)
    hb = [r for r in vrows if r.get('kind') == 'heartbeat' and r.get('connected') and ts(r['t']) >= win]
    exe = [r for r in vrows if r.get('kind') == 'execution' and ts(r['t']) >= win]
    world = [r for r in grows if r.get('kind') in ('place', 'break') and ts(r['t']) >= win]
    if len(hb) >= STILL_MIN - 1 and exe and not world:
        xs = [h['pos'] for h in hb if h.get('pos')]
        moved = max((abs(a['x'] - b['x']) + abs(a['y'] - b['y']) + abs(a['z'] - b['z'])) for a in xs for b in xs) if xs else 0
        bags = {h.get('inv_hash') for h in hb}
        if moved < 2 and len(bags) == 1:
            return f'{STILL_MIN} min of executing skills ({len(exe)} runs) with no world change (moved {moved:.1f}, bag unchanged, no place/break)'
    return None


def decide_host(m):
    """A host-pressure reason, or None. m: measured host numbers."""
    if m.get('load5', 0) > HOST['load5']:
        return f"host load5 {m['load5']:.1f} > {HOST['load5']}"
    if m.get('mem_avail_gb', 99) < HOST['mem_avail_gb']:
        return f"available memory {m['mem_avail_gb']:.1f} GB < {HOST['mem_avail_gb']}"
    if m.get('root_free_gb', 999) < HOST['root_free_gb']:
        return f"root disk free {m['root_free_gb']:.0f} GB < {HOST['root_free_gb']}"
    if m.get('voyager_gb', 0) > HOST['voyager_gb']:
        return f"/srv/voyager uses {m['voyager_gb']:.1f} GB > {HOST['voyager_gb']}"
    return None


# ---- effects ------------------------------------------------------------------------------------------------------
def host_numbers():
    m = {}
    try:
        m['load5'] = os.getloadavg()[1]
    except Exception:
        pass
    try:
        with open('/proc/meminfo') as f:
            for line in f:
                if line.startswith('MemAvailable:'):
                    m['mem_avail_gb'] = int(line.split()[1]) / 1048576
    except Exception:
        pass
    try:
        m['root_free_gb'] = shutil.disk_usage('/').free / 1e9
    except Exception:
        pass
    try:
        out = subprocess.run(['du', '-sb', ROOT], capture_output=True, text=True, timeout=60).stdout.split()
        m['voyager_gb'] = int(out[0]) / 1e9 if out else 0
    except Exception:
        pass
    return m


def unit_active(u):
    return subprocess.run(['systemctl', 'is-active', '--quiet', u]).returncode == 0


def stop(units, dry):
    for u in units:
        assert u.startswith('voyager-'), u
        if not dry:
            subprocess.run(['systemctl', 'stop', u], timeout=180)


def emit(o):
    o = {'t': now().isoformat(), **o}
    print(json.dumps(o))
    try:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'a') as f:
            f.write(json.dumps(o) + '\n')
    except Exception:
        pass


def run(dry=False):
    t = now()
    since = t - dt.timedelta(hours=6)
    m = host_numbers()
    hr = decide_host(m)
    if hr:
        units = [f'voyager-bot@{a}' for a in ARMS] + [f'voyager-paper@{a}' for a in ARMS]
        live = [u for u in units if unit_active(u)]
        if live:
            stop(live, dry)
            emit({'kind': 'stop_all', 'reason': hr, 'units': live, 'host': m, 'dry': dry})
        return
    for a in ARMS:
        unit = f'voyager-bot@{a}'
        marker = os.path.join(ROOT, f'STOPPED-{a}')
        if os.path.exists(marker):
            if unit_active(unit):
                stop([unit], dry)
                emit({'kind': 'restop', 'arm': a, 'reason': 'STOPPED marker present', 'dry': dry})
            continue
        if not unit_active(unit):
            continue
        vrows = rows(os.path.join(ROOT, 'logs', a, f'voyager-{a}.jsonl'), since)
        grows = rows(os.path.join(ROOT, 'worlds', a, 'plugins', 'VoyagerGuard', 'events.jsonl'), since)
        # rows from before the arm's last operator restart do not count again
        try:
            rs = ts(open(os.path.join(ROOT, f'RESTARTED-{a}')).read().strip())
            if rs:
                vrows = [r for r in vrows if ts(r['t']) >= rs]
                grows = [r for r in grows if ts(r['t']) >= rs]
        except FileNotFoundError:
            pass
        why = decide_arm(vrows, grows, t)
        if why:
            stop([unit], dry)
            if not dry:
                with open(marker, 'w') as f:
                    f.write(json.dumps({'t': t.isoformat(), 'reason': why}) + '\n')
            emit({'kind': 'stop', 'arm': a, 'reason': why, 'dry': dry})


def selftest():
    t = now()
    iso = lambda m: (t - dt.timedelta(minutes=m)).isoformat()
    hb = lambda m, x=0, h=1: {'t': iso(m), 'kind': 'heartbeat', 'connected': True, 'pos': {'x': x, 'y': 64, 'z': 0}, 'inv_hash': h}
    ok = 0
    assert decide_arm([], [], t) is None; ok += 1
    assert decide_arm([], [{'t': iso(100), 'kind': 'death', 'message': 'a'}], t) is None; ok += 1
    assert 'deaths' in decide_arm([], [{'t': iso(100), 'kind': 'death'}, {'t': iso(5), 'kind': 'death'}], t); ok += 1
    assert 'command' in decide_arm([], [{'t': iso(1), 'kind': 'command_denied', 'command': '/op x'}], t); ok += 1
    assert 'command' in decide_arm([{'t': iso(1), 'kind': 'command_attempt', 'source': 'facade.say', 'text': '/give'}], [], t); ok += 1
    assert 'violation' in decide_arm([{'t': iso(1), 'kind': 'sandbox_violation', 'name': 'require'}], [], t); ok += 1
    assert 'crash' in decide_arm([{'t': iso(m), 'kind': 'process_start'} for m in (1, 9, 20)], [], t); ok += 1
    assert decide_arm([{'t': iso(m), 'kind': 'process_start'} for m in (1, 40, 50)], [], t) is None; ok += 1
    still = [hb(m) for m in range(0, 10)] + [{'t': iso(3), 'kind': 'execution'}]
    assert 'no world change' in decide_arm(still, [], t); ok += 1
    assert decide_arm(still, [{'t': iso(2), 'kind': 'place'}], t) is None; ok += 1              # placed a block: changing
    assert decide_arm([hb(m, x=m) for m in range(0, 10)] + [{'t': iso(3), 'kind': 'execution'}], [], t) is None; ok += 1  # moving
    assert decide_arm([hb(m, h=m) for m in range(0, 10)] + [{'t': iso(3), 'kind': 'execution'}], [], t) is None; ok += 1  # bag changing
    assert decide_arm([hb(m) for m in range(0, 10)], [], t) is None; ok += 1                      # idle, not looping
    assert decide_host({'load5': 3, 'mem_avail_gb': 40, 'root_free_gb': 200, 'voyager_gb': 2}) is None; ok += 1
    assert 'load5' in decide_host({'load5': 30}); ok += 1
    assert 'memory' in decide_host({'mem_avail_gb': 5}); ok += 1
    assert 'disk' in decide_host({'root_free_gb': 10}); ok += 1
    assert 'srv/voyager' in decide_host({'voyager_gb': 41}); ok += 1
    try:
        stop(['mcbot@hive-a-Alpha'], dry=True)
        raise SystemExit('FAIL: stop accepted a non-voyager unit')
    except AssertionError:
        ok += 1
    print(f'selftest: {ok} checks passed')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'run'
    if cmd == 'selftest':
        selftest()
    else:
        run(dry='--dry-run' in sys.argv)
