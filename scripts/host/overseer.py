#!/usr/bin/env python3
"""overseer.py -- the host's overseer for the showcase town (overseer-01show, owner 11-17, phase 1: clean-up REMOVALS within 128).

Every 15 minutes (cron) it reads the bots' telemetry with lib.telemetry (a full walk of the window, rotated files included), and
hands it to `node overseer-cycle.mjs`, which runs bots/src/overseer.mjs overseerCycle -- the ONE implementation of the rules -- over
the town's directory and the overseer's book, and writes one `worklist-<bot>.json` a bot. Design:
docs/reports/overseer-design-2026-11-17.md.

    python3 overseer.py --pool <town dir> --home 0,70,0 --state ~/digest/overseer --switch ~/digest/overseer/LIVE \
        --scratch ~/digest/overseer/dry --zones <protected-zones.json> [--logs /var/log/mcai] [--radius 128] \
        [--ship /var/log/showcase/heartbeat.jsonl] [--lock /tmp/overseer.lock]

LIVE OR DRY (scarjobs.py's pattern): the lists go into the town's directory only while the --switch file exists and does not say
`off`; without it they go to --scratch and every list in the town's directory is removed, so switching off stops the bots at once.
The bots also stop reading at once when `worklist.OFF` stands in the town's directory (bot-side switch).

THE INPUTS: roster = every bot with a row in the last --window-min (default 180); online = a row in the last --online-min (10);
pos = its newest row's bot.pos; the `_worklist` rows (the bots' per-job reports). Rate and last progress are measured by the cycle
from those rows. ONE summary row a cycle: appended to <state>/cycles.jsonl and shipped as kind `showcase_overseer`.
The set-aside (quarantined) jobs: <state>/setaside.json (for the status page).
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib.telemetry import Events, canon  # noqa: E402

CYCLE = os.path.join(HERE, 'overseer-cycle.mjs')


def switch_live(path):
    """PURE but for the read: the switch file exists and does not say off -> live."""
    try:
        with open(path) as fh:
            body = fh.read().strip().lower()
    except OSError:
        return False
    return body not in ('off', '0', 'false', 'no')


def inputs_from_rows(rows, now, online_min=10):
    """PURE. Telemetry rows ({t, name, detail, bot}) -> (bots, worklist rows). A bot is any name seen; online when seen within
    online_min; pos its newest row's bot.pos."""
    seen = {}
    wl = []
    for r in rows:
        b = r.get('bot') or {}
        name = b.get('name')
        if not name:
            continue
        t = r['t']
        cur = seen.get(name)
        p = b.get('pos')
        if cur is None or t >= cur['t']:
            seen[name] = {'t': t, 'pos': [p.get('x'), p.get('y'), p.get('z')] if isinstance(p, dict) and p.get('x') is not None else (cur or {}).get('pos')}
        if canon(r['name']) == 'worklist':
            wl.append({'bot': name, 't': int(t.timestamp() * 1000), 'detail': r.get('detail') or ''})
    bots = [{'name': n, 'online': (now - v['t']).total_seconds() <= online_min * 60, 'pos': v['pos']} for n, v in sorted(seen.items())]
    return bots, wl


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--pool', required=True)
    ap.add_argument('--home', required=True, help='x,y,z')
    ap.add_argument('--state', required=True)
    ap.add_argument('--switch', required=True)
    ap.add_argument('--scratch', required=True)
    ap.add_argument('--zones', default=None)
    ap.add_argument('--logs', default='/var/log/mcai')
    ap.add_argument('--radius', type=int, default=128)
    ap.add_argument('--window-min', type=int, default=180)
    ap.add_argument('--online-min', type=int, default=10)
    ap.add_argument('--ship', default=None)
    ap.add_argument('--lock', default='/tmp/overseer.lock')
    ap.add_argument('--node', default='node')
    a = ap.parse_args(argv)
    os.makedirs(a.state, exist_ok=True)
    lk = open(a.lock, 'w')
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('overseer: another cycle holds the lock; this one is skipped')
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    ev = Events.load(paths=os.path.join(a.logs, '*', 'skill-*.jsonl*'), since_minutes=a.window_min)
    bots, wl = inputs_from_rows(ev.rows, now, a.online_min)
    live = switch_live(a.switch)
    inp = {'now': int(time.time() * 1000), 'home': [int(v) for v in a.home.split(',')], 'radius': a.radius, 'pool': a.pool,
           'state': a.state, 'zones': a.zones, 'live': live, 'scratch': a.scratch, 'bots': bots, 'rows': wl}
    p = subprocess.run([a.node, CYCLE], input=json.dumps(inp), capture_output=True, text=True, timeout=300)
    try:
        out = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        out = {'error': 'no summary: rc=%s %s' % (p.returncode, p.stderr.strip()[-300:])}
    # the denominator beside the result: the rows and bots the cycle was given
    row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'mode': 'live' if live else 'dry', 'telemetry_rows': len(ev.rows),
           'bots': len(bots), 'online': sum(1 for b in bots if b['online']), 'worklist_rows': len(wl), **out}
    with open(os.path.join(a.state, 'cycles.jsonl'), 'a') as fh:
        fh.write(json.dumps(row, sort_keys=True, default=str) + '\n')
    if a.ship:
        try:
            from lib.alarm import ship_row
            ship_row(a.ship, row)
        except Exception:
            pass
    print(json.dumps(row, sort_keys=True, default=str))
    return 1 if 'error' in out else 0


if __name__ == '__main__':
    sys.exit(main())
