#!/usr/bin/env python3
# SANDBOX-ONLY orchestrator for scaffold-01show's rig (Mac side; light: ssh and RCON only). Under the caller's sandbox lock
# (sandbox/sbxlock.sh take <server> scaffold01 ...). The bot runs on a test host (sandbox/scaffold/scafrig-bot.mjs, one per checkout);
# this builds each scene in an arena far from everything by RCON (sandbox setup only: fill, setblock, tp, give -- the owner's
# no-admin-edit rule is for the bots' worlds), writes the trial for the bot, waits for its result, then counts on the SERVER the
# dirt left in the arena (`fill ... air replace dirt`: the bot's scaffold is the only dirt there; the count is the server's).
#   scafrig.py <server> <bot host> <rig dir on that host> <label> <rounds> <out.jsonl>
import json, re, subprocess, sys, time
SERVER, BH, BDIR, LABEL, ROUNDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), sys.argv[6]
WH = 'mike@10.0.0.30'
X, G, Z, H = 7600, 100, 7600, 20
assert SERVER in ('sandbox2', 'sandbox3')

def rcon(*cmds):
    out = subprocess.run(['ssh', '-o', 'BatchMode=yes', WH, f'python3 /tmp/sbx-rcon.py {SERVER} -'], input='\n'.join(cmds) + '\n', capture_output=True, text=True, timeout=300).stdout
    res, cur = [], None
    for line in out.split('\n'):
        if line.startswith('> '): cur = {'cmd': line[2:], 'reply': ''}; res.append(cur)
        elif cur is not None: cur['reply'] += line
    return res

def lock_ok():
    o = subprocess.run(['bash', 'sandbox/sbxlock.sh', 'status'], capture_output=True, text=True).stdout
    return any(l.startswith('HELD') and f'.{SERVER}:' in l and ': scaffold01 ' in l for l in o.split('\n'))

A = lambda x, y, z: f'{X + x} {G + y} {Z + z}'
def base():
    return [f'fill {A(-H, -8, -H)} {A(H, 0, H)} minecraft:stone', f'fill {A(-H, 1, -H)} {A(H, 14, H)} minecraft:air']
SCENES = {
    # a 4-high cliff with no way up but a tower; then on along its top, away from the tower
    'cliff': (lambda: [f'fill {A(4, 1, -H)} {A(12, 4, H)} minecraft:stone'], [0, 1, 0],
              [{'goal': {'x': 8, 'y': 5, 'z': 0}}, {'goal': {'x': 11, 'y': 5, 'z': 18}}]),
    # a 3-high shelf with one-high stairs 14 along (the price's scene); then along the shelf
    'ledge': (lambda: [f'fill {A(4, 1, -H)} {A(9, 3, H)} minecraft:stone', f'setblock {A(1, 1, 14)} minecraft:stone', f'fill {A(2, 1, 14)} {A(2, 2, 14)} minecraft:stone', f'fill {A(3, 1, 14)} {A(3, 3, 14)} minecraft:stone'],
              [0, 1, 0], [{'goal': {'x': 6, 'y': 4, 'z': 0}}, {'goal': {'x': 6, 'y': 4, 'z': -18}}]),
    # a 1x1 pit 3 deep: out, then away
    'pit': (lambda: [f'fill {A(0, -2, 0)} {A(0, 0, 0)} minecraft:air'], [0, -2, 0],
            [{'goal': {'x': 5, 'y': 1, 'z': 0}}, {'goal': {'x': -15, 'y': 1, 'z': 10}}]),
    # gather's tower beside a trunk (a log pole): up to a stand 5 over the ground, then away
    'tree5': (lambda: [f'fill {A(3, 1, 0)} {A(3, 7, 0)} minecraft:oak_log'], [0, 1, 0],
              [{'goal': {'x': 2, 'y': 6, 'z': 0}, 'profile': 'gather'}, {'goal': {'x': -16, 'y': 1, 'z': 8}}]),
    # the same, 8 over the ground (a drop past maxDropDown 6)
    'tree8': (lambda: [f'fill {A(3, 1, 0)} {A(3, 10, 0)} minecraft:oak_log'], [0, 1, 0],
              [{'goal': {'x': 2, 'y': 9, 'z': 0}, 'profile': 'gather'}, {'goal': {'x': -16, 'y': 1, 'z': 8}}]),
    # the sea route: a channel 12 wide and 3 deep, swum across, then along the far shore
    'sea': (lambda: [f'fill {A(3, -2, -H)} {A(14, 0, H)} minecraft:water'], [0, 1, 0],
            [{'goal': {'x': 18, 'y': 1, 'z': 0}}, {'goal': {'x': 18, 'y': 1, 'z': 15}}]),
}
ORDER = ['cliff', 'ledge', 'pit', 'tree5', 'tree8', 'sea']

def ssh_bh(cmd):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', BH, cmd], capture_output=True, text=True, timeout=120).stdout

def main():
    assert lock_ok(), f'not holding the {SERVER} lock as scaffold01'
    rcon(f'forceload add {X - 48} {Z - 48} {X + 48} {Z + 48}', 'time set 1000', 'gamerule doDaylightCycle false', 'difficulty peaceful', 'gamerule doTileDrops false', 'gamerule fallDamage true', 'gamerule drowningDamage true')
    n = 0
    for rnd in range(ROUNDS):
        for scene in ORDER:
            n += 1
            build, start, legs = SCENES[scene]
            setup = base() + build()
            bad = [q for q in rcon(*setup) if not any(w in q['reply'] for w in ('filled', 'placed', 'Changed the block', 'No blocks were filled'))]
            assert not bad, f'arena setup failed: {bad}'
            rcon(f'clear sbx-Scaf', f'give sbx-Scaf minecraft:dirt 64', f'tp sbx-Scaf {X + start[0] + 0.5} {G + start[1]} {Z + start[2] + 0.5}', 'effect give sbx-Scaf minecraft:instant_health 1 10', 'effect give sbx-Scaf minecraft:saturation 1 10')
            tr = {'scene': scene, 'legs': [{'goal': {**l['goal'], 'x': X + l['goal']['x'], 'y': G + l['goal']['y'], 'z': Z + l['goal']['z']}, **({'profile': l['profile']} if l.get('profile') else {}), 'ms': 60000} for l in legs]}
            ssh_bh(f"cat > {BDIR}/trial-{n}.json.tmp <<'EOF'\n{json.dumps(tr)}\nEOF\nmv {BDIR}/trial-{n}.json.tmp {BDIR}/trial-{n}.json")
            t0 = time.time(); res = None
            while time.time() - t0 < 200:
                o = ssh_bh(f'cat {BDIR}/result-{n}.json 2>/dev/null')
                if o.strip(): res = json.loads(o); break
                time.sleep(3)
            left = 0   # two fills: one is capped at 32,768 blocks
            for q in rcon(f'fill {A(-H, -8, -H)} {A(H, 3, H)} minecraft:air replace minecraft:dirt', f'fill {A(-H, 4, -H)} {A(H, 14, H)} minecraft:air replace minecraft:dirt'):
                m = re.search(r'filled (\d+)', q['reply']); left += int(m.group(1)) if m else 0
            row = {'label': LABEL, 'round': rnd + 1, 'n': n, 'scene': scene, 'left': left, 'result': res}
            open(OUT, 'a').write(json.dumps(row) + '\n')
            print(LABEL, rnd + 1, scene, 'left', left, 'legs', [(l['ok'], l['ms']) for l in (res or {}).get('legs', [])], 'deaths', (res or {}).get('deaths'), 'placed', (res or {}).get('dirtUsed'), flush=True)
    ssh_bh(f'touch {BDIR}/quit')

main()
