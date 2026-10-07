#!/usr/bin/env python3
# SANDBOX-ONLY persistent RCON pipe: rconpipe.py <sandbox|sandbox2|sandbox3>
# stdin:  one JSON per line {"id": n, "cmds": ["...", ...]}
# stdout: one JSON per line {"id": n, "ts": [epoch_ms per reply], "replies": ["...", ...]}
# sandbox4 is refused (benchmark in use). Reads the password itself from server.properties; never prints it.
import json, socket, struct, subprocess, sys, time
srv = sys.argv[1]
assert srv in ('sandbox', 'sandbox2', 'sandbox3'), 'sandbox, sandbox2, sandbox3 only'
def prop(k):
    out = subprocess.run(['sudo', 'grep', '-h', '^' + k + '=', f'/srv/block2/{srv}/server.properties'], capture_output=True, text=True).stdout
    return out.split('=', 1)[1].strip()
s = socket.create_connection(('127.0.0.1', int(prop('rcon.port'))), timeout=20)
def send(t, body):
    p = struct.pack('<ii', 0, t) + body.encode() + b'\0\0'; s.sendall(struct.pack('<i', len(p)) + p)
    hdr = b''
    while len(hdr) < 4: hdr += s.recv(4 - len(hdr))
    ln = struct.unpack('<i', hdr)[0]; d = b''
    while len(d) < ln: d += s.recv(ln - len(d))
    return d[8:-2].decode(errors='replace')
send(3, prop('rcon.password'))
FORBID = ('op ', 'deop', 'stop', 'whitelist', 'ban', 'pardon', 'save-off', 'reload', 'setworldspawn')
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    req = json.loads(line)
    ts, rep = [], []
    for c in req['cmds']:
        if c.lower().startswith(FORBID):
            rep.append('REFUSED by rconpipe'); ts.append(time.time() * 1000); continue
        r = send(2, c); ts.append(time.time() * 1000); rep.append(r)
    sys.stdout.write(json.dumps({'id': req['id'], 'ts': ts, 'replies': rep}) + '\n'); sys.stdout.flush()
