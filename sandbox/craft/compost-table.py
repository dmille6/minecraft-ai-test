#!/usr/bin/env python3
# SANDBOX-ONLY, RCON-ONLY compostability table on the real Paper server (peacefulkit, 10-07).
# For each item: a hopper (64 of the item, facing down) above a composter above an empty hopper. The top hopper feeds the
# composter (Paper/vanilla: a hopper inserts only what ComposterBlock accepts; at levels 0-6 every accepted item is
# consumed), the bottom hopper pulls the bone meal out at level 8, so the column keeps cycling. Read back: items left in
# the top hopper (consumed = 64 - left), bone meal in the bottom hopper, the composter's level. Rough chance estimate:
# levels raised = 7 * bone_meal + final level; chance ~= levels / consumed (level 0 always rises, so it is biased up).
import subprocess, sys, re, time, json
SERVER = sys.argv[1] if len(sys.argv) > 1 else 'sandbox2'
assert SERVER in ('sandbox', 'sandbox2', 'sandbox3'), 'sandbox servers only (sandbox4 is in use)'
ITEMS = sys.argv[2].split(',') if len(sys.argv) > 2 else []
X0, Y, Z = 900, 121, 900


def rcon(cmds):
    out = subprocess.run(['ssh', '-o', 'BatchMode=yes', 'mike@10.0.0.30', 'python3 /tmp/sbx-rcon.py %s -' % SERVER],
                         input='\n'.join(cmds) + '\n', capture_output=True, text=True, timeout=300).stdout
    res, cur = [], None
    for line in out.split('\n'):
        if line.startswith('> '):
            cur = {'cmd': line[2:], 'reply': ''}; res.append(cur)
        elif cur is not None:
            cur['reply'] += line
    return res


STACK1 = re.compile(r'_sword$')
STACK16 = re.compile(r'^(egg|brown_egg|blue_egg)$')
n = len(ITEMS)
x1 = X0 + 2 * n
setup = ['forceload add %d %d %d %d' % (X0 - 2, Z - 2, x1 + 2, Z + 2),
         'fill %d %d %d %d %d %d minecraft:air' % (X0 - 1, Y - 2, Z - 1, x1 + 1, Y + 2, Z + 1),
         'fill %d %d %d %d %d %d minecraft:stone' % (X0 - 1, Y - 3, Z - 1, x1 + 1, Y - 3, Z + 1)]
counts = {}
for i, it in enumerate(ITEMS):
    x = X0 + 2 * i
    c = 1 if STACK1.search(it) else 16 if STACK16.search(it) else 64
    counts[it] = c
    setup += ['setblock %d %d %d minecraft:hopper[facing=down]' % (x, Y - 2, Z),
              'setblock %d %d %d minecraft:composter[level=0]' % (x, Y - 1, Z),
              'setblock %d %d %d minecraft:hopper[facing=down]{Items:[{Slot:0b,id:"minecraft:%s",count:%d}]}' % (x, Y, Z, it, c)]
r = rcon(setup)
bad = [x for x in r if 'setblock' in x['cmd'] and 'Changed the block' not in x['reply']]
if bad:
    print('SETUP FAILED', bad[:3]); sys.exit(1)
time.sleep(float(sys.argv[3]) if len(sys.argv) > 3 else 75)
q = []
for i, it in enumerate(ITEMS):
    x = X0 + 2 * i
    q += ['data get block %d %d %d Items' % (x, Y, Z), 'data get block %d %d %d Items' % (x, Y - 2, Z),
          ]
    for lv in range(0, 9):
        q.append('execute if block %d %d %d minecraft:composter[level=%d]' % (x, Y - 1, Z, lv))
r = rcon(q)
rows = []
per = 11
for i, it in enumerate(ITEMS):
    top, bot = r[i * per]['reply'], r[i * per + 1]['reply']
    left = sum(int(m) for m in re.findall(r'count: (\d+)', top))
    bm = sum(int(m) for m in re.findall(r'count: (\d+)', bot)) if 'bone_meal' in bot else 0
    lvl = next((lv for lv in range(9) if 'passed' in r[i * per + 2 + lv]['reply']), None)
    consumed = counts[it] - left
    levels = 7 * bm + (min(lvl, 7) if lvl is not None else 0)
    rows.append({'item': it, 'given': counts[it], 'consumed': consumed, 'bone_meal': bm, 'level': lvl,
                 'chance_est': round(levels / consumed, 2) if consumed else None})
    print('%-22s given %2d consumed %2d bone_meal %d level %s chance~%s' % (it, counts[it], consumed, bm, lvl, rows[-1]['chance_est']))
rcon(['fill %d %d %d %d %d %d minecraft:air' % (X0 - 1, Y - 2, Z - 1, x1 + 1, Y + 2, Z + 1),
      'kill @e[type=item,x=%d,y=%d,z=%d,distance=..%d]' % (X0 + n, Y, Z, n + 10),
      'forceload remove %d %d %d %d' % (X0 - 2, Z - 2, x1 + 2, Z + 2)])
json.dump(rows, open(sys.argv[4] if len(sys.argv) > 4 else '/dev/null', 'w'))
