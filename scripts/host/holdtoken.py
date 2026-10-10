#!/usr/bin/env python3
"""holdtoken.py claim <token> <minutes> | release <token> | owner  --an installer's OWN scheduler install-hold.

`canary-sched.py install-hold` overwrites any existing hold, and `install-release` deletes whatever hold is there
(round 2, Codex P1). An installer that called them blind could erase a hold another operation owns. This helper uses the
scheduler's own path table (`paths()`, loaded from canary-sched.py, so SCHED_HOME fixtures apply) and its tick lock:
  claim    under the tick lock: refuse (rc 3) if ANY hold file exists; else write {owner: <token>} atomically (rc 0).
           The caller then runs `canary-sched.py install-hold <token> <m>` for the slot checks. That rewrites the
           file with the same owner, and a second installer's claim meanwhile is refused, because the file exists.
  release  under the tick lock: delete the hold ONLY if its owner is <token>. Otherwise leave it (rc 0, says so).
The token must be unique per run (the installer uses its name, PID and nanosecond clock)."""
import datetime as dt, fcntl, importlib.util, json, os, sys

SCHED = os.environ.get('HOLDTOKEN_SCHED', os.path.join(os.environ.get('SCHED_HOME', '/home/mike'), 'canary-sched.py'))


def _paths():
    spec = importlib.util.spec_from_file_location('canary_sched_paths', SCHED)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.paths()


def _locked(P, fn):
    os.makedirs(os.path.dirname(P['tick_lock']) or '.', exist_ok=True)
    fd = os.open(P['tick_lock'], os.O_RDWR | os.O_CREAT, 0o664)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        return fn()
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)


def owner_of(path):
    """The hold's owner, '?' for an unreadable hold, None for no hold."""
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return str(json.load(f).get('owner'))
    except Exception:
        return '?'


def claim(P, token, minutes):
    def go():
        cur = owner_of(P['install_hold'])
        if cur is not None:
            print('REFUSED: an install-hold already exists (owner %s): %s -- not overwriting it' % (cur, P['install_hold']))
            return 3
        now = dt.datetime.now(dt.timezone.utc)
        tmp = P['install_hold'] + '.claim-tmp'
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        with open(tmp, 'w') as f:
            json.dump({'owner': token, 'until': (now + dt.timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                       'at': now.strftime('%Y-%m-%dT%H:%M:%SZ')}, f)
        os.replace(tmp, P['install_hold'])
        print('claimed install-hold as %s' % token)
        return 0
    return _locked(P, go)


def release(P, token):
    def go():
        cur = owner_of(P['install_hold'])
        if cur is None:
            print('no install-hold to release'); return 0
        if cur != token:
            print('install-hold owned by %s, not %s: left in place' % (cur, token)); return 0
        os.remove(P['install_hold'])
        print('released install-hold %s' % token); return 0
    return _locked(P, go)


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == 'claim':
        sys.exit(claim(_paths(), a[1], int(a[2])))
    if len(a) == 2 and a[0] == 'release':
        sys.exit(release(_paths(), a[1]))
    if a == ['owner']:                      # read-only: the current hold's owner, or nothing (dry runs)
        print(owner_of(_paths()['install_hold']) or ''); sys.exit(0)
    print(__doc__); sys.exit(2)
