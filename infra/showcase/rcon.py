#!/usr/bin/env python3
"""RCON to the SHOWCASE server only (127.0.0.1:25575; the port is firewalled to loopback).

    rcon.py "whitelist add <name>"         # prints the server's answer
    rcon.py --save-hold on|off              # save-off + save-all flush  |  save-on   (snapshot consistency)

The password lives in /srv/showcase/secrets/rcon.json (root:showops 0640; the operator `mike` is in showops) and is
never printed. This is the showcase world's own admin channel; it is never pointed at a bench world.
"""
import json, socket, struct, sys

SECRET = '/srv/showcase/secrets/rcon.json'


class Rcon:
    def __init__(self, host, port, password, timeout=30):
        self.sock = socket.create_connection((host, port), timeout)
        self.rid = 0
        if self._cmd(3, password) is None:
            raise SystemExit('rcon auth failed')

    def _cmd(self, kind, body):
        self.rid += 1
        payload = struct.pack('<ii', self.rid, kind) + body.encode() + b'\x00\x00'
        self.sock.sendall(struct.pack('<i', len(payload)) + payload)
        size = struct.unpack('<i', self._read(4))[0]
        resp_id, _ = struct.unpack('<ii', self._read(8))
        data = self._read(size - 8)[:-2].decode(errors='replace')
        return None if resp_id == -1 else data

    def _read(self, n):
        buf = b''
        while len(buf) < n:
            c = self.sock.recv(n - len(buf))
            if not c:
                raise SystemExit('rcon connection closed mid-read')
            buf += c
        return buf

    def run(self, cmd):
        return self._cmd(2, cmd) or ''


def connect():
    s = json.load(open(SECRET))
    if s.get('host') not in ('127.0.0.1', 'localhost'):
        raise SystemExit('refusing: the showcase RCON is loopback only')
    return Rcon(s['host'], int(s['port']), s['password'])


SAVE_LOCK = '/srv/showcase/save.lock'


class SaveHold:
    """ONE owner of Paper's save pause at a time (the 15-min timelapse snapshot and the nightly backup stage both
    pause saving). `with SaveHold(wait_s=N) as h:` waits up to N s for the EXCLUSIVE lock. h.held True: this process
    paused saving and turns it back on at exit, always. h.held False: someone else owns the pause -- the caller must
    NOT copy (the owner may save-on mid-copy) and must report a skip. A failure after save-off inside __enter__ is
    unwound here (save-on, unlock) before the exception propagates."""

    def __init__(self, wait_s=0, path=SAVE_LOCK):
        self.wait_s, self.path, self.held, self.f = wait_s, path, False, None

    def __enter__(self):
        import fcntl, time
        self.f = open(self.path, 'a')
        t0 = time.time()
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.time() - t0 >= self.wait_s:
                    return self
                time.sleep(1)
        try:
            save_hold(True)
        except BaseException:
            try:
                save_hold(False)
            except Exception:
                pass
            fcntl.flock(self.f, fcntl.LOCK_UN)
            self.f.close()
            raise
        self.held = True
        return self

    def __exit__(self, *exc):
        import fcntl
        try:
            if self.held:
                save_hold(False)
        finally:
            if self.held:
                fcntl.flock(self.f, fcntl.LOCK_UN)
            self.f.close()
        return False


def save_on_if_unowned(path=SAVE_LOCK):
    """The idempotent repair: save-on only if NOBODY holds the save lock (a killed holder released it on death)."""
    import fcntl
    with open(path, 'a') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'held by another process; not touched'
        try:
            return save_hold(False)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def save_hold(on):
    r = connect()
    if on:
        a = r.run('save-off')
        b = r.run('save-all flush')
        return f'{a.strip()} | {b.strip()}'
    return r.run('save-on').strip()


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--save-hold' and sys.argv[2] in ('on', 'off'):
        print(save_hold(sys.argv[2] == 'on'))
        return 0
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    print(connect().run(sys.argv[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
