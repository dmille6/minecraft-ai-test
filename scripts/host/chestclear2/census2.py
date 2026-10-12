# census2.py -- READ-ONLY town container census over each fleet world's own RCON (run on 10.0.0.30 with sudo; the
# password is read from that world's server.properties on this host and never leaves it). Commands sent: only
# "data get block X Y Z id" and "data get block X Y Z Items". Output /tmp/cc2_census.json.
import json, re, socket, struct, time, sys
P = json.load(open('/tmp/cc2_positions.json'))
CMD_OK = re.compile(r'^data get block -?\d+ -?\d+ -?\d+ (id|Items\[\d{1,2}\])$')
def conn(port, pw):
    s = socket.create_connection(('127.0.0.1', port), timeout=8)
    def send(t, body):
        p = struct.pack('<ii', 1, t) + body.encode() + b'\x00\x00'; s.sendall(struct.pack('<i', len(p)) + p)
        ln = struct.unpack('<i', s.recv(4))[0]; d = b''
        while len(d) < ln: d += s.recv(ln - len(d))
        return d[8:-2].decode(errors='replace')
    send(3, pw)
    return s, send
def items(txt):
    i = txt.find('['); out = []
    if i < 0: return out
    depth = 0; start = None
    for j, ch in enumerate(txt[i:], i):
        if ch == '{':
            if depth == 0: start = j
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                e = txt[start:j + 1]
                idm = re.search(r'id: "minecraft:([a-z0-9_]+)"', e); cm = re.search(r'count: (\d+)', e)
                sm = re.search(r'Slot: (\d+)b', e); dm = re.search(r'"minecraft:damage": (\d+)', e)
                if idm: out.append({'id': idm.group(1), 'count': int(cm.group(1)) if cm else 1,
                                    'slot': int(sm.group(1)) if sm else None, 'damage': int(dm.group(1)) if dm else None})
    return out
res = {'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'worlds': {}}
for w, v in sorted(P.items()):
    props = dict(l.split('=', 1) for l in open('/srv/block2/%s/server.properties' % w).read().splitlines() if '=' in l and not l.startswith('#'))
    s, send = conn(int(props.get('rcon.port', 25575)), props['rcon.password'].strip())
    cont = []
    for (x, y, z) in v['pos']:
        c1 = 'data get block %d %d %d id' % (x, y, z); assert CMD_OK.match(c1)
        r = send(2, c1); time.sleep(0.02)
        m = re.search(r'"minecraft:([a-z_]+)"', r)
        if not m or m.group(1) not in ('chest', 'trapped_chest', 'barrel'): continue
        it = []
        for k in range(54):
            c2 = 'data get block %d %d %d Items[%d]' % (x, y, z, k); assert CMD_OK.match(c2)
            r2 = send(2, c2); time.sleep(0.005)
            if 'has the following block data' not in r2: break
            e = r2.split('block data:', 1)[1]
            idm = re.search(r'id: "minecraft:([a-z0-9_]+)"', e); cm = re.search(r'count: (\d+)', e)
            sm = re.search(r'Slot: (\d+)b', e); dm = re.search(r'"minecraft:damage": (\d+)', e)
            if idm: it.append({'id': idm.group(1), 'count': int(cm.group(1)) if cm else 1,
                               'slot': int(sm.group(1)) if sm else None, 'damage': int(dm.group(1)) if dm else None})
        cont.append({'kind': m.group(1), 'pos': [x, y, z], 'items': it})
    s.close()
    res['worlds'][w] = {'home': v['home'], 'containers': cont}
    print(w, len(cont), 'containers', sum(len(c['items']) for c in cont), 'slots used', flush=True)
json.dump(res, open('/tmp/cc2_census.json', 'w'))
