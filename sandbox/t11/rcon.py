# SANDBOX-ONLY rcon (runs ON the worlds host 10.0.0.30): python3 rcon.py <server dir name> <command>...  -- one command per argument,
# each reply printed. The password is read from the server's properties with sudo and never printed.
import sys, socket, struct, subprocess
arm = sys.argv[1]
def prop(k): return subprocess.run(['sudo', '-n', 'grep', '-h', '^' + k, f'/srv/block2/{arm}/server.properties'], capture_output=True, text=True).stdout.split('=', 1)[1].strip()
P = int(prop('rcon.port')); W = prop('rcon.password')
pkt = lambda i, t, b: (lambda x: struct.pack('<i', len(x)) + x)(struct.pack('<ii', i, t) + b.encode() + b'\x00\x00')
s = socket.create_connection(('127.0.0.1', P), timeout=30)
def rv():
    ln = struct.unpack('<i', s.recv(4))[0]; b = b''
    while len(b) < ln: b += s.recv(ln - len(b))
    return b[8:-2].decode('utf-8', 'replace')
s.send(pkt(1, 3, W)); rv()
for c in sys.argv[2:]:
    s.send(pkt(2, 2, c)); print(c[:60], '->', rv()[:300])
