# waterstate.py <fixture.json> <arm> -- for every water cell ask the LIVE world whether it is a SOURCE (level=0);
# flowing water becomes air in the fixture (sources regenerate it), so a replay does not flood the pocket.
import json, sys, socket, struct, subprocess
fx, arm = sys.argv[1], sys.argv[2]
d = json.load(open(fx))
def prop(k): return subprocess.run(['sudo','grep','-h','^'+k, f'/srv/block2/{arm}/server.properties'], capture_output=True, text=True).stdout.split('=')[1].strip()
P = int(prop('rcon.port')); W = prop('rcon.password')
pkt = lambda i,t,b: (lambda x: struct.pack('<i', len(x)) + x)(struct.pack('<ii', i, t) + b.encode() + b'\x00\x00')
s = socket.create_connection(('127.0.0.1', P), timeout=15)
def rv():
    ln = struct.unpack('<i', s.recv(4))[0]; b = b''
    while len(b) < ln: b += s.recv(ln - len(b))
    return b[8:-2].decode('utf-8', 'replace')
s.send(pkt(1, 3, W)); rv()
def cmd(c): s.send(pkt(2, 2, c)); return rv()
src = flow = 0
for k, v in d['cells'].items():
    if v != 'water': continue
    x, y, z = k.split(',')
    if 'passed' in cmd(f'execute if block {x} {y} {z} minecraft:water[level=0]').lower(): src += 1
    else: d['cells'][k] = 'air'; flow += 1
d['water_sources'] = src; d['flowing_water_made_air'] = flow
json.dump(d, open(fx, 'w'))
print(fx, 'sources', src, 'flowing->air', flow)
