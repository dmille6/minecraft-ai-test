#!/usr/bin/env python3
# SANDBOX-ONLY, RCON-ONLY furnace fuel check (peacefulkit revision, 10-07): a furnace with 3 raw_iron and ONE fuel item
# in its fuel slot; read the slots after 25 s. A wooden sword should smelt exactly one ingot (200 ticks) and be consumed;
# a stone sword is not fuel; one coal smelts all three (control).
import subprocess, sys, re, time
SERVER = sys.argv[1] if len(sys.argv) > 1 else 'sandbox3'
assert SERVER in ('sandbox', 'sandbox2', 'sandbox3', 'sandbox4')
FUELS = ['wooden_sword', 'wooden_sword', 'stone_sword', 'coal', 'oak_planks']


def rcon(cmds):
    out = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py %s -' % SERVER],
                         input='\n'.join(cmds) + '\n', capture_output=True, text=True, timeout=120).stdout
    res, cur = [], None
    for line in out.split('\n'):
        if line.startswith('> '):
            cur = {'cmd': line[2:], 'reply': ''}; res.append(cur)
        elif cur is not None:
            cur['reply'] += line
    return res


X0, Y, Z = 920, 121, 920
cmds = ['forceload add %d %d %d %d' % (X0 - 2, Z - 2, X0 + 12, Z + 2)]
for i, f in enumerate(FUELS):
    x = X0 + 2 * i
    cmds.append('setblock %d %d %d minecraft:air' % (x, Y, Z))
    cmds.append('setblock %d %d %d minecraft:furnace{Items:[{Slot:0b,id:"minecraft:raw_iron",count:3},{Slot:1b,id:"minecraft:%s",count:1}]}' % (x, Y, Z, f))
r = rcon(cmds)
assert all('Changed' in x['reply'] or 'forceload' in x['cmd'] or 'air' in x['cmd'] for x in r), r
time.sleep(25)
q = []
for i in range(len(FUELS)):
    for sl in range(3):
        q += ['data get block %d %d %d Items[{Slot:%db}].id' % (X0 + 2 * i, Y, Z, sl), 'data get block %d %d %d Items[{Slot:%db}].count' % (X0 + 2 * i, Y, Z, sl)]
r = rcon(q)
def val(x):
    m = re.search(r'block data: "?([\w:]+)"?', x['reply'])
    return m.group(1) if m else None
for i, f in enumerate(FUELS):
    got = []
    for sl in range(3):
        name, cnt = val(r[i * 6 + 2 * sl]), val(r[i * 6 + 2 * sl + 1])
        got.append('%s x%s' % (name.replace('minecraft:', ''), cnt) if name else '-')
    print('%-14s input %-16s fuel %-18s output %s' % (f, got[0], got[1], got[2]))
rcon(['setblock %d %d %d minecraft:air' % (X0 + 2 * i, Y, Z) for i in range(len(FUELS))] + ['forceload remove %d %d %d %d' % (X0 - 2, Z - 2, X0 + 12, Z + 2)])
