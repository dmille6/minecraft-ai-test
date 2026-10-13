"""rcon3.py -- the chest clear's RCON client (runs on the worlds host 10.0.0.30 as root: the password is read from the
world's own server.properties and never leaves the host). Every command is checked against the caller's grammar
before it is sent. One reply packet per command, matched by request id; a reply that fills a packet (>= 4000 bytes)
raises Truncated instead of being parsed (an empty-command sentinel, the 10-04 trick, makes Paper 1.21.11 close the
connection: measured on sandbox 10-13)."""
import re, socket, struct, time

ROOT = '/srv/block2'


def props(world):
    out = {}
    for l in open('%s/%s/server.properties' % (ROOT, world)).read().splitlines():
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1); out[k.strip()] = v.strip()
    return out


class Truncated(Exception):
    pass


class Rcon:
    def __init__(self, world, grammar, timeout=10, min_gap=0.0):
        p = props(world)
        assert p.get('enable-rcon') == 'true', '%s: rcon disabled' % world
        self.world, self.grammar, self.min_gap = world, grammar, min_gap
        self.s = socket.create_connection(('127.0.0.1', int(p.get('rcon.port', 25575))), timeout=timeout)
        self.i = 0; self.n = 0; self.lat = []; self.t_last = 0.0
        self.i += 1; self._send(self.i, 3, p['rcon.password'])
        rid, _ = self._recv()
        if rid == -1: raise RuntimeError('%s: rcon auth failed' % world)

    def _send(self, rid, typ, body):
        pk = struct.pack('<ii', rid, typ) + body.encode() + b'\x00\x00'
        self.s.sendall(struct.pack('<i', len(pk)) + pk)

    def _exact(self, n):
        b = b''
        while len(b) < n:
            c = self.s.recv(n - len(b))
            if not c: raise ConnectionError('rcon closed')
            b += c
        return b

    def _recv(self):
        ln = struct.unpack('<i', self._exact(4))[0]
        d = self._exact(ln)
        rid, _typ = struct.unpack('<ii', d[:8])
        return rid, d[8:-2].decode('utf-8', 'replace')

    def cmd(self, c):
        if not self.grammar.match(c):
            raise AssertionError('refusing a command outside the grammar: %r' % c)
        gap = self.min_gap - (time.time() - self.t_last)
        if gap > 0: time.sleep(gap)
        t0 = time.time()
        self.i += 1; sent = self.i; self._send(sent, 2, c)
        while True:
            rid, body = self._recv()
            if rid == sent: break
        if len(body.encode()) >= 4000:
            raise Truncated('%s: reply of %d bytes to %r' % (self.world, len(body.encode()), c))
        self.t_last = time.time(); self.lat.append(self.t_last - t0); self.n += 1
        return body.strip()

    def close(self):
        try: self.s.close()
        except Exception: pass
