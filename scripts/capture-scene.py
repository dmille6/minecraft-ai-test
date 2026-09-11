#!/usr/bin/env python3
"""capture-scene.py -- read a box of blocks around a point over RCON, read-only, as a scene fixture.

    python3 capture-scene.py <arm> <x> <y> <z> [--r 6] [--dy 3] [--name hbd-pocket] > scene.json

Runs ON THE WORLDS HOST (rcon is 127.0.0.1:<port from /srv/block2/<arm>/server.properties>).
Every probe is `execute if block ...`, which changes nothing. Output is the fixture format
test/fixtures/scenes/*.json expects: {name, arm, captured_at, origin, cells:{"x,y,z":name}}.
Unknown cells (not in the kind list) are recorded as "?" so a replay can refuse rather than guess.
"""
import socket, struct, subprocess, sys, json, datetime, argparse
ap = argparse.ArgumentParser()
ap.add_argument('arm'); ap.add_argument('x', type=int); ap.add_argument('y', type=int); ap.add_argument('z', type=int)
ap.add_argument('--r', type=int, default=6); ap.add_argument('--dy', type=int, default=3); ap.add_argument('--name', default=None)
ap.add_argument('--bot', default=None, help='bot name, to record its exact Pos/OnGround')
a = ap.parse_args()
def prop(k): return subprocess.run(['sudo','grep','-h','^'+k, f'/srv/block2/{a.arm}/server.properties'], capture_output=True, text=True).stdout.split('=')[1].strip()
P = int(prop('rcon.port')); W = prop('rcon.password')
pkt = lambda i,t,b: (lambda x: struct.pack('<i', len(x)) + x)(struct.pack('<ii', i, t) + b.encode() + b'\x00\x00')
s = socket.create_connection(('127.0.0.1', P), timeout=15)
def rv():
    ln = struct.unpack('<i', s.recv(4))[0]; d = b''
    while len(d) < ln: d += s.recv(ln - len(d))
    return d[8:-2].decode('utf-8', 'replace')
s.send(pkt(1, 3, W)); rv()
def cmd(c): s.send(pkt(2, 2, c)); return rv()
KINDS = ['air','cave_air','water','lava','stone','dirt','grass_block','cobblestone','sand','gravel','oak_log','birch_log','oak_leaves','birch_leaves','oak_planks','birch_planks','coal_ore','iron_ore','copper_ore','deepslate','andesite','diorite','granite','tuff','clay','crafting_table','furnace','chest','torch','ladder','oak_sapling','short_grass','tall_grass','kelp','kelp_plant','seagrass','lily_pad','snow','ice','sandstone','red_sand','terracotta','mossy_cobblestone','stone_bricks','glass','obsidian','bedrock','magma_block','bamboo','sugar_cane','dead_bush','fern','vine','moss_block','mud','packed_mud','dripstone_block','pointed_dripstone','amethyst_block','calcite','smooth_basalt','cobbled_deepslate','deepslate_coal_ore','deepslate_iron_ore','coarse_dirt','rooted_dirt','podzol','mycelium','gravel','oak_fence','cobblestone_slab','oak_slab','oak_stairs','cobblestone_stairs','dirt_path','farmland','wheat','poppy','dandelion','pink_petals','wildflowers','leaf_litter','bush','firefly_bush','cactus_flower','spruce_log','spruce_leaves','jungle_log','jungle_leaves','acacia_log','dark_oak_log','cherry_log','cherry_leaves','mangrove_log','pale_oak_log']
cells = {}; unknown = 0
for dy in range(-a.dy, a.dy + 1):
    for dx in range(-a.r, a.r + 1):
        for dz in range(-a.r, a.r + 1):
            x, y, z = a.x + dx, a.y + dy, a.z + dz
            name = '?'
            for k in KINDS:
                if 'passed' in cmd(f'execute if block {x} {y} {z} minecraft:{k}').lower(): name = k; break
            if name == '?': unknown += 1
            cells[f'{x},{y},{z}'] = name
out = {'name': a.name or f'{a.arm}-{a.x}-{a.y}-{a.z}', 'arm': a.arm, 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
       'origin': [a.x, a.y, a.z], 'radius': a.r, 'dy': a.dy, 'unknown_cells': unknown, 'cells': cells}
if a.bot:
    out['bot'] = {'name': a.bot, 'pos': cmd(f'data get entity {a.bot} Pos')[-60:], 'on_ground': cmd(f'data get entity {a.bot} OnGround')[-6:]}
json.dump(out, sys.stdout); print(file=sys.stderr, end='')
print(f"\n# {out['name']}: {len(cells)} cells, {unknown} unknown", file=sys.stderr)
