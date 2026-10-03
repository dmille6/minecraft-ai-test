#!/usr/bin/env python3
# SANDBOX-ONLY RCON helper: rcon.py <sandbox|sandbox2|sandbox3|sandbox4> "cmd" ["cmd" ...]   (or - to read cmds from stdin)
import socket, struct, subprocess, sys
srv = sys.argv[1]
assert srv in ('sandbox', 'sandbox2', 'sandbox3', 'sandbox4'), 'sandbox servers only'
def prop(k):
    out = subprocess.run(['sudo', 'grep', '-h', '^' + k + '=', f'/srv/block2/{srv}/server.properties'], capture_output=True, text=True).stdout
    return out.split('=', 1)[1].strip()
s = socket.create_connection(('127.0.0.1', int(prop('rcon.port'))), timeout=20)
def send(t, body):
    p = struct.pack('<ii', 0, t) + body.encode() + b'\0\0'; s.sendall(struct.pack('<i', len(p)) + p)
    ln = struct.unpack('<i', s.recv(4))[0]; d = b''
    while len(d) < ln: d += s.recv(ln - len(d))
    return d[8:-2].decode(errors='replace')
send(3, prop('rcon.password'))
cmds = sys.argv[2:]
if cmds == ['-']: cmds = [l.rstrip('\n') for l in sys.stdin if l.strip()]
for c in cmds:
    print(f'> {c}\n{send(2, c)}', flush=True)
