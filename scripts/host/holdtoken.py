#!/usr/bin/env python3
"""holdtoken.py claim <token> <minutes> | release <token> | owner  -- an installer's OWN scheduler install-hold.

`canary-sched.py install-hold` overwrites any existing hold, and `install-release` deletes whatever hold is there
(round 2, Codex P1). Calling them separately from a claim left a window between two acquisitions of the tick lock in
which another operation's hold could be overwritten and then deleted (round 3, Codex P1, reproduced). So this helper
does the WHOLE acquisition under ONE hold of the scheduler's tick lock, using canary-sched.py's own code (loaded as a
module: its paths(), gather(), ancestors() and slot_blockers(), exactly what cmd_install_hold runs):
  claim    lock; refuse (rc 3) if ANY hold file exists (readable or not); write {owner: <token>}; run the scheduler's
           slot checks (S1-S5, S7, this process's ancestors excluded); if the slot is not free, DELETE OUR OWN hold
           (still under the lock) and return 2; else rc 0. canary-sched.py install-hold is never called.
  release  lock; delete the hold ONLY if its owner is <token>; otherwise leave it (rc 0, says so).
  owner    read-only: the current hold's owner, or nothing.
The token must be unique per run (the installer uses its name, PID and nanosecond clock)."""
import datetime as dt, fcntl, importlib.util, json, os, sys

SCHED = os.environ.get('HOLDTOKEN_SCHED', os.path.join(os.environ.get('SCHED_HOME', '/home/mike'), 'canary-sched.py'))
LIVE_CODES = ('S1', 'S2', 'S3', 'S4', 'S5', 'S7')       # cmd_install_hold's own set


def _sched():
    spec = importlib.util.spec_from_file_location('canary_sched_holdtoken', SCHED)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def sched_slot_check(m):
    """The scheduler's own slot test, as cmd_install_hold runs it. -> [(code, reason)] of live blockers."""
    def check(P):
        st = m.gather(P, full=False)
        anc = m.ancestors(P, os.getpid())
        st['procs'] = [x for x in st['procs'] if x['pid'] not in anc]
        busy, block = m.slot_blockers(st)
        return [x for x in busy + block if x[0] in LIVE_CODES]
    return check


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


def claim(P, token, minutes, slot_check):
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
        try:
            live = slot_check(P)
        except Exception as e:
            live = [('ERR', 'slot check failed: %s: %s' % (type(e).__name__, str(e)[:200]))]
        if live:
            os.remove(P['install_hold'])           # ours: written above under this same lock
            print('REFUSED: the slot is NOT free (our hold withdrawn):')
            for c, r in live:
                print('  %s %s' % (c, r))
            return 2
        print('INSTALL-HOLD by %s until %s; the slot is free (checked under the same tick lock)' %
              (token, (now + dt.timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%SZ')))
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
    m = _sched(); P = m.paths()
    if len(a) == 3 and a[0] == 'claim':
        sys.exit(claim(P, a[1], int(a[2]), sched_slot_check(m)))
    if len(a) == 2 and a[0] == 'release':
        sys.exit(release(P, a[1]))
    if a == ['owner']:
        print(owner_of(P['install_hold']) or ''); sys.exit(0)
    print(__doc__); sys.exit(2)
