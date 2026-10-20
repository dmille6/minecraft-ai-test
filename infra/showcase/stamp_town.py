#!/usr/bin/env python3
"""ON THE SHOWCASE VM, as root, ONCE, before any bot joins: stamp the bench's minimal town at the siting file's home
(place-town.town_plan: 13 x 13 stone platform, two deposit chests, a stocked torch chest, the lectern, a torch
perimeter, forceloaded home) with TEN beds instead of five. Not run if the town plan builds its own core
(`builds_core: true` in /srv/showcase/town-site.json). Refuses a second stamp, a world other than frame 0's, and a
running bot.   stamp_town.py [--dry-run]
"""
import argparse, hashlib, importlib.util, json, os, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts' / 'lib'))
spec = importlib.util.spec_from_file_location('pt', REPO / 'scripts' / 'place-town.py')
pt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pt)
S = Path('/srv/showcase/server')
MARK = S / 'TOWN-PLACED.json'


def ten_beds(x, y, z):
    """place-town's plan, beds extended from 5 to 10 (two rows on the south side, 2 blocks apart). Pure."""
    plan, board = pt.town_plan(x, y, z)
    plan = [c for c in plan if 'red_bed' not in c]
    for row, zz in ((0, z + 4), (1, z + 6)):
        for i in range(5):
            bx = x - 4 + i * 2
            plan.append(f'setblock {bx} {y} {zz} minecraft:red_bed[part=foot,facing=north]')
            plan.append(f'setblock {bx} {y} {zz - 1} minecraft:red_bed[part=head,facing=north]')
    return plan, board


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    if MARK.exists():
        sys.exit(f'refusing: {MARK} exists (the town is stamped)')
    site = json.load(open('/srv/showcase/town-site.json'))
    if site.get('builds_core'):
        sys.exit('refusing: the town plan builds its own core (builds_core: true)')
    f0 = json.load(open('/srv/showcase/timelapse/FRAME0.json'))
    seed = re.search(r'^level-seed=(.*)$', (S / 'server.properties').read_text(), re.M).group(1).strip()
    if str(f0.get('seed')) != seed:
        sys.exit(f'refusing: the world seed {seed} is not frame 0\'s ({f0.get("seed")})')
    running = subprocess.run(['systemctl', 'list-units', 'mcshow@*', '--state=active', '--no-legend'],
                             capture_output=True, text=True).stdout.strip()
    if running:
        sys.exit('refusing: a showcase bot is running')
    x, y, z = site['home'][0], site['home'][1] - 1, site['home'][2]
    plan, board = ten_beds(x, y, z)
    conf = dict(l.split('=', 1) for l in (S / 'server.properties').read_text().splitlines() if '=' in l)
    rcon = None if a.dry_run else pt.Rcon('127.0.0.1', int(conf['rcon.port']), conf['rcon.password'].strip())
    bad = []
    for c in plan:
        if a.dry_run:
            print('  would:', c)
            continue
        out = rcon.run(c)
        if re.search(r'error|failed|Unknown|cannot|expected', out, re.I):
            bad.append((c, out))
    if a.dry_run:
        return 0
    rec = {'home': [x, y + 1, z], 'board': list(board), 'beds': 10, 'commands': len(plan), 'refused': bad,
           'seed': seed}
    MARK.write_text(json.dumps(rec, indent=1))
    print(json.dumps(rec))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
