#!/usr/bin/env python3
"""sandbox-scenario.py -- rebuild a scene fixture in the SANDBOX world and watch a bot try to get out.

Runs ON THE WORLDS HOST against /srv/block2/sandbox (rcon from its server.properties).
The sandbox is a test rig: tp/setblock/give are allowed HERE and nowhere else.

  python3 sandbox-scenario.py <fixture.json> --bot sandbox-Delta [--minutes 15] [--no-load]

Steps: forceload the fixture box -> setblock every recorded cell -> wait for the bot to
join -> tp it to the recorded position, clear and give its recorded inventory -> poll
Pos/OnGround/feet-in-water every 5 s -> verdict {escaped, seconds, final} on stdout.
Escaped = dry AND on ground AND > 5 blocks from the fixture origin, held for 30 s.
"""
import socket, struct, subprocess, sys, json, time, math, argparse, datetime, re

ap = argparse.ArgumentParser()
ap.add_argument('fixture'); ap.add_argument('--bot', required=True)
ap.add_argument('--minutes', type=float, default=15); ap.add_argument('--no-load', action='store_true')
ap.add_argument('--server', default='sandbox'); ap.add_argument('--join-wait', type=int, default=180)
ap.add_argument('--verify', action='store_true', help='re-probe every cell after loading and report mismatches')
ap.add_argument('--give', default='', help='inventory override for old fixtures: item:count,item:count')
ap.add_argument('--at', default='', help='place the bot at x,y,z instead of the fixture position (boundary cases)')
ap.add_argument('--no-bot', action='store_true', help='load and verify only')
a = ap.parse_args()

def prop(k):
    out = subprocess.run(['sudo', 'grep', '-h', '^' + k + '=', f'/srv/block2/{a.server}/server.properties'], capture_output=True, text=True).stdout
    return out.split('=', 1)[1].strip()
PORT = int(prop('rcon.port')); PW = prop('rcon.password')
s = socket.create_connection(('127.0.0.1', PORT), timeout=20)
def send(t, body):
    p = struct.pack('<ii', 0, t) + body.encode() + b'\0\0'; s.sendall(struct.pack('<i', len(p)) + p)
    ln = struct.unpack('<i', s.recv(4))[0]; d = b''
    while len(d) < ln: d += s.recv(ln - len(d))
    return d[8:-2].decode(errors='replace')
send(3, PW)
cmd = lambda c: send(2, c)

fx = json.load(open(a.fixture))
ox, oy, oz = [float(v) for v in fx['origin']]; r = int(fx.get('radius', 6)); dy = int(fx.get('dy', 3))
name = fx.get('name', a.fixture)
log = lambda m: print(f"[{datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S')}] {m}", flush=True)

# 1. forceload the chunk box so setblock and reads never answer "not loaded"
x0, x1 = int(ox - r) >> 4, int(ox + r) >> 4; z0, z1 = int(oz - r) >> 4, int(oz + r) >> 4
log(f"forceload chunks x{x0}..{x1} z{z0}..{z1}: " + cmd(f'forceload add {x0*16} {z0*16} {x1*16+15} {z1*16+15}')[:80])

# 2. rebuild the trap cell for cell
if not a.no_load:
    n = 0; bad = 0
    for key, kind in fx['cells'].items():
        x, y, z = key.split(','); out = cmd(f'setblock {x} {y} {z} minecraft:{kind}')
        n += 1
        if 'Could not set' in out and 'same' not in out: bad += 1
    log(f"setblock {n} cells ({bad} refused; 'already that block' is not a refusal)")

# 2b. verify the geometry after the world settled (falling blocks, fluids): a cell the
# world refuses to hold is a fidelity gap the fixture must record, not a surprise later
if a.verify:
    time.sleep(3); mism = []
    for key, kind in fx['cells'].items():
        x, y, z = key.split(',')
        if 'passed' not in cmd(f'execute if block {x} {y} {z} minecraft:{kind}'): mism.append((key, kind))
    log(f"verify: {len(fx['cells']) - len(mism)}/{len(fx['cells'])} cells hold; mismatches: {mism[:12]}{' ...' if len(mism) > 12 else ''}")
if a.no_bot:
    print(json.dumps({'fixture': name, 'loaded': not a.no_load, 'verified': a.verify})); sys.exit(0)

# 3. wait for the bot
t0 = time.time()
while a.bot not in cmd('list'):
    if time.time() - t0 > a.join_wait: log(f"{a.bot} did not join in {a.join_wait}s"); sys.exit(2)
    time.sleep(3)
log(f"{a.bot} joined")

# 4. put it where the fixture recorded it, holding what it held
b = fx.get('bot') or {}
import re
def parse_pos(v):
    if isinstance(v, dict): return [float(v['x']), float(v['y']), float(v['z'])]
    if isinstance(v, (list, tuple)) and len(v) == 3: return [float(x) for x in v]
    m = re.findall(r'(-?\d+\.?\d*)d', str(v or ''))          # an old fixture kept the raw RCON reply
    return [float(x) for x in m[:3]] if len(m) >= 3 else None
pos = parse_pos(b.get('pos')) or [ox + 0.5, oy, oz + 0.5]
if a.at: pos = [float(v) for v in a.at.split(',')]
time.sleep(4)   # the name shows in `list` a moment before the entity accepts commands
log('gamemode: ' + cmd(f'gamemode survival {a.bot}')[:80])
import re
def where():
    out = cmd(f'data get entity {a.bot} Pos'); og = cmd(f'data get entity {a.bot} OnGround')
    xyz = [float(v) for v in re.findall(r'(-?\d+\.?\d*)d', out)]
    if len(xyz) != 3: return None
    fx_, fy_, fz_ = [math.floor(v) for v in xyz]
    wet = 'passed' in cmd(f'execute if block {fx_} {fy_} {fz_} minecraft:water')
    return dict(pos=xyz, on_ground='1b' in og, wet=wet, dist=math.dist(xyz, [ox, oy, oz]))
placed = False
for i in range(6):
    rep = cmd(f'execute as {a.bot} run tp @s {pos[0]:.2f} {pos[1]:.2f} {pos[2]:.2f}')
    time.sleep(2); w = where()
    log(f"tp try {i + 1}: reply={rep[:60]!r} now={['%.1f' % v for v in w['pos']] if w else None}")
    if w and math.dist(w['pos'], pos) <= 3: placed = True; break
if not placed:
    print(json.dumps({'fixture': name, 'bot': a.bot, 'error': 'bot could not be placed at the fixture position; no verdict'})); sys.exit(3)
cmd(f'clear {a.bot}')
inv = b.get('inventory') or {}
if a.give: inv = {kv.split(':')[0]: int(kv.split(':')[1]) for kv in a.give.split(',') if ':' in kv}
if isinstance(inv, dict) and inv and all(isinstance(v, dict) for v in inv.values()):   # per-slot capture -> totals
    tot = {}
    for slot in inv.values():
        if slot.get('id'): tot[slot['id'].replace('minecraft:', '')] = tot.get(slot['id'].replace('minecraft:', ''), 0) + int(slot.get('count', 1))
    inv = tot
for item, count in (inv.items() if isinstance(inv, dict) else []):
    left = int(count)
    while left > 0:
        k = min(64, left); cmd(f'give {a.bot} minecraft:{item} {k}'); left -= k
log(f"inventory given: {len(inv)} kinds")

# 5. watch (the bot was verified at the fixture position above, so 'far from origin' means it MOVED)
held = None; escaped = None; t1 = time.time()
while time.time() - t1 < a.minutes * 60:
    w = where()
    if w:
        # ESCAPED means AWAY, not DOWN: a bot that rode its own furniture six blocks down the
        # same column (Bravo, 18:12) is still on the bridge. Horizontal distance only.
        hdist = math.dist(w['pos'][::2], [ox, oz])
        ok = (not w['wet']) and w['on_ground'] and hdist > 5
        if ok and held is None: held = time.time()
        if not ok: held = None
        if held and time.time() - held >= 30: escaped = time.time() - t1 - 30; break
        log(f"pos={['%.1f' % v for v in w['pos']]} on_ground={w['on_ground']} wet={w['wet']} dist={w['dist']:.1f}")
    time.sleep(5)
final = where()
print(json.dumps({'fixture': name, 'bot': a.bot, 'escaped': escaped is not None, 'seconds': round(escaped, 1) if escaped is not None else None, 'minutes_watched': a.minutes, 'final': final, 'dy_from_start': round(final['pos'][1] - pos[1], 1) if final else None}, default=str))
cmd(f'forceload remove {x0*16} {z0*16} {x1*16+15} {z1*16+15}')
