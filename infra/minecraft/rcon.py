#!/usr/bin/env python3
"""Minimal Minecraft RCON client.  rcon.py "<command>"

Reads MULTI-PACKET responses. The previous version called _recv() exactly once,
so any reply the server split across packets was silently truncated to its first
fragment -- `data get entity <bot> Inventory` came back as 136 bytes ending
mid-item, which read as "this bot owns two items" rather than "this answer is
incomplete". A tool that truncates without saying so is worse than one that
fails, and this one was used to conclude that a crafted pickaxe had vanished.

The protocol has no "last packet" flag, so the standard trick is to send a
second, empty command after the real one: the server answers in order, and the
sentinel's reply marks the end of the real one.
"""
import socket, struct, sys, re

def _pkt(rid, typ, body):
    p = struct.pack('<ii', rid, typ) + body.encode('utf8') + b'\x00\x00'
    return struct.pack('<i', len(p)) + p

def _recv_one(s):
    head = b''
    while len(head) < 4:
        c = s.recv(4 - len(head))
        if not c: return None, None, ''
        head += c
    ln = struct.unpack('<i', head)[0]
    d = b''
    while len(d) < ln:
        c = s.recv(ln - len(d))
        if not c: break
        d += c
    rid, typ = struct.unpack('<ii', d[:8])
    return rid, typ, d[8:-2].decode('utf8', 'replace')

def run(cmd, host='127.0.0.1', port=25575):
    pw = re.search(r'RCON_PASSWORD=(.*)', open('/srv/minecraft/server/.rcon.env').read()).group(1).strip()
    s = socket.create_connection((host, port), timeout=15)
    try:
        s.sendall(_pkt(1, 3, pw))
        if _recv_one(s)[0] == -1:
            raise SystemExit('RCON auth failed')
        s.sendall(_pkt(2, 2, cmd))
        s.sendall(_pkt(99, 2, ''))          # sentinel: its reply ends the real one
        out = []
        while True:
            rid, _typ, body = _recv_one(s)
            if rid is None or rid == 99: break
            out.append(body)
        body = ''.join(out)
        # THE SERVER TRUNCATES. Minecraft cuts long NBT in command feedback and
        # marks it with a literal ellipsis, so `data get entity <bot> Inventory`
        # returns ~146 bytes ending "count..." no matter how much the bot is
        # carrying. Read naively that says "this player owns two items", and it
        # was read naively -- it is how a crafted stone_pickaxe was reported
        # missing when the bot was holding it the whole time.
        #
        # A truncated answer must never look like a complete one. Query
        # Inventory[0], Inventory[1], ... one slot at a time to get all of it.
        if body.rstrip().endswith('...'):
            sys.stderr.write(
                'rcon: WARNING server truncated this response (ends with "..."); '
                'the result is INCOMPLETE. For inventories query slot-wise, '
                'e.g. data get entity <name> Inventory[0]\n')
        return body
    finally:
        s.close()

if __name__ == '__main__':
    print(run(' '.join(sys.argv[1:])))
