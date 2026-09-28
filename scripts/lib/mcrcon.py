"""RCON client that can address ANY of our worlds, and never truncates silently.

The existing infra/minecraft/rcon.py hardcodes port 25575 and reads the password from
/srv/minecraft/server/.rcon.env -- a different server from the block2 fleet, so it cannot
talk to the 16 live worlds or the 4 sandboxes at all. This takes host/port/password and
reads them from each world's own server.properties.

The multi-packet sentinel is carried over verbatim from that file, because the lesson it
encodes was expensive: RCON has no last-packet flag, so a reply the server splits is
silently truncated to its first fragment. `data get entity <bot> Inventory` came back
ending mid-item and was read as "this bot owns two items". A tool that truncates without
saying so is worse than one that fails.

Read-only by construction is NOT claimed -- this can run any command. Callers touching a
LIVE world must stick to queries; `changing the world to fix a bot` is forbidden outside
the sandbox.
"""
import os
import re
import socket
import struct

SANDBOX_WORLDS = ('sandbox', 'sandbox2', 'sandbox3', 'sandbox4')


class RconError(RuntimeError):
    pass


class Truncated(RuntimeError):
    """The server split a reply and the tail is missing. Never returned as a value."""


def _pkt(rid, typ, body):
    p = struct.pack('<ii', rid, typ) + body.encode('utf8') + b'\x00\x00'
    return struct.pack('<i', len(p)) + p


def _recv_one(s):
    head = b''
    while len(head) < 4:
        c = s.recv(4 - len(head))
        if not c:
            return None, None, ''
        head += c
    ln = struct.unpack('<i', head)[0]
    d = b''
    while len(d) < ln:
        c = s.recv(ln - len(d))
        if not c:
            break
        d += c
    rid, typ = struct.unpack('<ii', d[:8])
    return rid, typ, d[8:-2].decode('utf8', 'replace')


def world_conf(world, root='/srv/block2'):
    """(host, port, password) from that world's own server.properties."""
    path = os.path.join(root, world, 'server.properties')
    try:
        txt = open(path).read()
    except PermissionError as e:
        raise RconError(f'cannot read {path} ({e}) — run as a user that can, or sudo') from e
    except FileNotFoundError as e:
        raise RconError(f'no such world: {path}') from e
    if not re.search(r'^enable-rcon=true', txt, re.M):
        raise RconError(f'{world}: enable-rcon is not true')
    port = re.search(r'^rcon\.port=(\d+)', txt, re.M)
    pw = re.search(r'^rcon\.password=(.*)$', txt, re.M)
    if not port or not pw:
        raise RconError(f'{world}: rcon.port/rcon.password missing')
    return '127.0.0.1', int(port.group(1)), pw.group(1).strip()


def run(cmd, host='127.0.0.1', port=25575, password=None, timeout=15):
    """One command, whole reply. Raises Truncated rather than returning a partial answer."""
    if password is None:
        raise RconError('password is required; use world_conf(world)')
    s = socket.create_connection((host, port), timeout=timeout)
    try:
        s.sendall(_pkt(1, 3, password))
        rid, typ, _ = _recv_one(s)
        if rid == -1:
            raise RconError('rcon auth failed')
        s.sendall(_pkt(2, 2, cmd))
        s.sendall(_pkt(3, 2, ''))          # sentinel: its reply ends the real one
        body = ''
        while True:
            rid, typ, part = _recv_one(s)
            if rid is None or rid == 3:
                break
            body += part
        if body.rstrip().endswith('...'):
            raise Truncated(
                f'the server truncated the reply to {cmd!r} (ends with "..."). Query it in '
                f'pieces — e.g. Inventory[0], Inventory[1] — rather than trusting this.')
        return body
    finally:
        s.close()


def on(world, cmd, root='/srv/block2', **kw):
    """Run `cmd` on a named world."""
    h, p, pw = world_conf(world, root)
    return run(cmd, host=h, port=p, password=pw, **kw)


def assert_sandbox(world):
    """Refuse a mutating command outside the sandbox. Callers that change blocks call this.

    The standing constraint is `do not change the world to fix a bot`, sandbox excepted.
    A helper that can reach 16 live worlds needs the guard next to the capability.
    """
    if world not in SANDBOX_WORLDS:
        raise RconError(
            f'{world!r} is a LIVE world: world-mutating RCON is forbidden outside '
            f'{SANDBOX_WORLDS}. Queries are fine; setblock/give/tp are not.')
    return world
