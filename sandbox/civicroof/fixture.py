#!/usr/bin/env python3
"""SANDBOX-ONLY (civicroof-01show rig): civicP AS THE SHOWCASE HOLDS IT, as setblock commands for a RIG world copy (never a live world).
The T11 rig world is the showcase of 11-18; civicP was sited and built on 11-19. Every record cell's block comes from the project's own
intents (the settled state each builder's click left), else -- below the roof only -- the role's first palette name; a roof or lights cell
with no settled intent is left open (air). A state-bearing cell gets its recorded state (`ws`).
    python3 fixture.py <pool dir> [plot]   -> one command a line (`setblock x y z minecraft:name[k=v,...]`), a summary on stderr"""
import glob, json, os, sys
pool, plot = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'civicP')
heads = sorted(glob.glob(os.path.join(pool, f'project-0_70_0.{plot}.g*.json')), key=lambda p: int(p.rsplit('.g', 1)[1].split('.')[0]))
rec = json.load(open(heads[-1]))
opens, settled = {}, {}
for f in sorted(glob.glob(os.path.join(pool, f'project-0_70_0.{plot}.intents.*.jsonl'))):
    for line in open(f):
        r = json.loads(line)
        if r['op'] == 'open': opens[r['id']] = r
        elif r['op'] == 'settled' and r['id'] in opens and r.get('state'): settled[tuple(opens[r['id']]['cell'])] = (r['state'], r['at'])
n = {'intent': 0, 'first': 0, 'open': 0}
names = {}
for c in rec['cells']:
    at = tuple(c['at'])
    if at in settled: name = settled[at][0]; n['intent'] += 1
    elif c['seg'] in ('roof', 'lights'): n['open'] += 1; continue
    else: name = rec['palette'][c['role']][0]; n['first'] += 1
    st = ','.join(f'{k}={v}' for k, v in (c.get('ws') or {}).items())
    print(f"setblock {at[0]} {at[1]} {at[2]} minecraft:{name}{'[' + st + ']' if st else ''}")
    names[name] = names.get(name, 0) + 1
print(f'{plot} {os.path.basename(heads[-1])}: {len(rec["cells"])} cells; from intents {n["intent"]}, first name {n["first"]}, left open {n["open"]}; {names}', file=sys.stderr)
