#!/usr/bin/env python3
"""overseer.py -- the host's overseer for the showcase town (overseer-01show, owner 11-17, phase 1: clean-up REMOVALS within 128).

Every 15 minutes (cron) it reads the bots' telemetry with lib.telemetry (a full walk of the window, rotated files included), and
hands it to `node overseer-cycle.mjs`, which runs bots/src/overseer.mjs overseerCycle -- the ONE implementation of the rules -- over
the town's directory and the overseer's book, and writes one `worklist-<bot>.json` a bot. Design:
docs/reports/overseer-design-2026-11-17.md.

    python3 overseer.py --pool <town dir> --home 0,70,0 --state ~/digest/overseer --switch ~/digest/overseer/LIVE \
        --scratch ~/digest/overseer/dry --zones <protected-zones.json> [--logs /var/log/mcai] [--radius 128] \
        [--ship /var/log/showcase/heartbeat.jsonl] [--lock /tmp/overseer.lock]

LIVE OR DRY: the lists go into the town's directory only while the --switch file exists and does not say `off`; without it they
go to --scratch and the town's directory is never written or deleted from (r1 C6) -- except ONCE, on the switch going off: the
live book says lists were published, they are removed, and the book records it (`stoppedAt`). --zones is required (r1 C4); a log
file that cannot be read, or a log directory gone since the last cycle, is no cycle at all (r1 C3).
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
from lib.telemetry import Events, canon, open_log  # noqa: E402
import glob  # noqa: E402

CYCLE = os.path.join(HERE, 'overseer-cycle.mjs')


def switch_live(path):
    """PURE but for the read: the switch file exists and does not say off -> live."""
    try:
        with open(path) as fh:
            body = fh.read().strip().lower()
    except OSError:
        return False
    return body not in ('off', '0', 'false', 'no')


RETIRE_GRACE_MS = 60 * 60 * 1000   # r2: a log directory gone this long is a retired bot, not an unreadable one


def gz_ok(path):
    """r2: a .gz is read to its end (a truncated one raises EOFError / BadGzipFile here, where Events.load would swallow it)."""
    import gzip
    with gzip.open(path, 'rb') as fh:
        while fh.read(1 << 20):
            pass


def plain_ok(path):
    with open(path, 'rb') as fh:
        fh.read(1)


def read_problems(files, prev, now_ms, gz_cache=None, stat=os.stat, check_gz=gz_ok, check_plain=plain_ok, grace_ms=RETIRE_GRACE_MS):
    """r1 C3 / r2 -- PURE but for the checks it is given. Events.load skips a file it cannot read, so a bot whose log fails looks
    ABSENT and its work would be handed on. Fail closed instead.
      files     the log files of the walk
      prev      {dir: last ms a log was seen there} from the last cycle (a list from before r2: seen now)
      gz_cache  {"path|size|mtime": True}: a rotated .gz read to its end once is not read again
    -> (problems, seen, retired, gz_cache). Every plain file must open and read; every .gz must decompress to its end (once per
    path, size and mtime); a directory seen before and gone for less than grace_ms is a problem (no cycle), gone longer it is
    RETIRED (dropped from `seen`: its bot has no rows, so the cycle's roster releases its jobs with notBefore)."""
    if isinstance(prev, list):
        prev = {d: now_ms for d in prev}
    cache = dict(gz_cache or {})
    problems, here, keep = [], set(), {}
    for f in sorted(files):
        try:
            if f.endswith('.gz'):
                st = stat(f)
                key = '%s|%d|%d' % (f, st.st_size, int(st.st_mtime))
                if key not in cache:
                    check_gz(f)
                    cache[key] = True
                keep[key] = True   # only files still on disk stay in the cache
            else:
                check_plain(f)
            here.add(os.path.basename(os.path.dirname(f)))
        except Exception as e:  # noqa: BLE001 -- any failure to read is a reason to write nothing
            problems.append('unreadable %s: %s' % (f, type(e).__name__))
    seen = {d: now_ms for d in here}
    retired = []
    for d, last in sorted(prev.items()):
        if d in here:
            continue
        if now_ms - last < grace_ms:
            problems.append('no log for %s (seen %d min ago)' % (d, (now_ms - last) // 60000))
            seen[d] = last
        else:
            retired.append(d)
    return problems, seen, retired, keep


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
    ap.add_argument('--zones', required=True)   # r1 C4: protection never fails open
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
    # r1 C3: a log that cannot be read (or one gone since the last cycle) is no cycle: nothing is written, the row says why
    dirs_file, gz_file = os.path.join(a.state, 'logdirs.json'), os.path.join(a.state, 'gzcheck.json')

    def jread(f, dflt):
        try:
            with open(f) as fh:
                return json.load(fh)
        except OSError:
            return dflt

    def jwrite(f, obj):
        with open(f + '.tmp', 'w') as fh:
            json.dump(obj, fh, sort_keys=True)
        os.replace(f + '.tmp', f)

    def log_row(row):
        with open(os.path.join(a.state, 'cycles.jsonl'), 'a') as fh:
            fh.write(json.dumps(row, sort_keys=True, default=str) + '\n')
        if a.ship:
            try:
                from lib.alarm import ship_row
                ship_row(a.ship, row)
            except Exception:
                pass
    now_ms = int(time.time() * 1000)
    problems, seen, retired, gzc = read_problems(glob.glob(os.path.join(a.logs, '*', 'skill-*.jsonl*')), jread(dirs_file, {}), now_ms,
                                                 jread(gz_file, {}))
    jwrite(gz_file, gzc)
    if problems:
        # r1 C3: a log that cannot be read (or one gone less than the grace) is no cycle: nothing is written, the row says why
        row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'error': 'logs: ' + '; '.join(problems)[:600], 'wrote': 'nothing'}
        log_row(row)
        print(json.dumps(row, sort_keys=True))
        return 1
    for d in retired:   # r2: one row a retirement; the directory leaves logdirs.json, so the next cycles run
        log_row({'kind': 'showcase_overseer', 'op': 'retired', 'at': now.isoformat(), 'dir': d})
    jwrite(dirs_file, seen)
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
