#!/usr/bin/env python3
"""floatclean-01show, survey step 1: the cells a BOT placed last, from a CoreProtect COPY (read-only).

    python3 scripts/host/floatclean_cp.py --db <copy of plugins/CoreProtect/database.db> --world world \
        --box x0,y0,z0,x1,y1,z1 --bot-re '^showcase-[A-Z][a-z]+$' --out cp.json \
        [--control x,y,z=user ...]

For every cell in the box: the block rows of the LAST second CoreProtect holds for it, break or place. The cell is listed
when that second holds a PLACEMENT (action 1) not rolled back and every such placement is by a user matching --bot-re (the
survey then requires the world to still hold the block, which settles a place and a break in the same second). Out: JSON
{ "cells": { "x,y,z": { "user", "t", "block" } }, "rows", "cells_seen", "users", "window": [t0, t1], "controls": [...] }.

NEVER run it on the showcase VM or against a live server's database: copy the file first (the survey is host side).

POSITIVE CONTROL (CLAUDE.md, control session 11-20): every --control x,y,z=user must find that user's PLACEMENT row on the
cell in the window (whatever the last row is); the script exits 3 if one does not, so a dead or wrong copy can never read as
"nothing bot-placed". The default control is Maple's 11-16 17:35:40Z bridge dirt at -58,70,-74 (stepwell trace 11-20) when
the box holds it.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lib.coreprotect import changes, PLACE  # noqa: E402

DEFAULT_CONTROL = '-58,70,-74=showcase-Maple'


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--world', default='world')
    ap.add_argument('--box', required=True)
    ap.add_argument('--bot-re', default=r'^showcase-[A-Z][a-z]+$')
    ap.add_argument('--since', type=int, default=0)
    ap.add_argument('--control', action='append', default=None)
    ap.add_argument('--out', required=True)
    a = ap.parse_args(argv)
    x0, y0, z0, x1, y1, z1 = (int(v) for v in a.box.split(','))
    box = ((x0, y0, z0), (x1, y1, z1))
    rows = changes(a.db, a.since, world=a.world, box=box)   # raises NotRecording on an empty window
    bot = re.compile(a.bot_re)
    last = {}
    placed_by = {}
    users = {}
    for r in rows:
        if r.action not in (0, 1):
            continue
        k = f'{r.x},{r.y},{r.z}'
        # the rows of the cell's LAST second (CoreProtect stamps whole seconds, and the query has no order): a place and a break
        # in one second are told apart by the world read the survey makes (a cell listed here must still hold the block)
        prev = last.get(k)
        if prev is None or r.ts > prev[0].ts:
            last[k] = [r]
        elif r.ts == prev[0].ts:
            prev.append(r)
        if r.action == PLACE:
            placed_by.setdefault(k, set()).add(r.actor)
        users[r.actor] = users.get(r.actor, 0) + 1
    cells = {}
    for k, rs in last.items():
        places = [r for r in rs if r.action == PLACE and not r.rolled_back]
        # listed: the last second holds a bot's placement and no one else's
        if places and all(bot.match(str(r.actor)) for r in places):
            r = places[-1]
            cells[k] = {'user': r.actor, 't': int(r.ts), 'block': str(r.material).replace('minecraft:', '')}
    controls = []
    ctl = a.control if a.control is not None else []
    if a.control is None:
        cx, cy, cz = (int(v) for v in DEFAULT_CONTROL.split('=')[0].split(','))
        if x0 <= cx <= x1 and y0 <= cy <= y1 and z0 <= cz <= z1:
            ctl = [DEFAULT_CONTROL]
    bad = 0
    for c in ctl:
        at, user = c.split('=')
        ok = user in placed_by.get(at, set())
        controls.append({'at': at, 'user': user, 'found': ok, 'listed': at in cells})
        if not ok:
            bad += 1
    ts = [r.ts for r in rows]
    doc = {'cells': cells, 'rows': len(rows), 'cells_seen': len(last), 'users': users,
           'window': [min(ts), max(ts)] if ts else None, 'controls': controls, 'box': [x0, y0, z0, x1, y1, z1],
           'bot_re': a.bot_re}
    with open(a.out, 'w') as f:
        json.dump(doc, f)
    print(f'_floatclean op=cp rows={len(rows)} cells_seen={len(last)} bot_last_placed={len(cells)} '
          f'controls={sum(1 for c in controls if c["found"])}/{len(controls)} out={a.out}')
    for c in controls:
        print(f'  control {c["at"]} {c["user"]}: placement found={c["found"]} listed_now={c["listed"]}')
    if bad:
        print('POSITIVE CONTROL FAILED: the copy does not show a placement it must show', file=sys.stderr)
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main())
