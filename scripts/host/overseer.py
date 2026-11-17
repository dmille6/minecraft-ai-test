#!/usr/bin/env python3
"""overseer.py -- the host's overseer for the showcase town (overseer-01show, owner 11-17, phase 1: clean-up REMOVALS within 128).

Every 15 minutes (cron) it reads ONLY THE NEW BYTES of the bots' live skill logs since its last cycle (r5: tail_read, offsets
by inode in <state>/tail.json, a rolling 180-min state of each bot's newest row and the `_worklist` rows), and hands it to `node overseer-cycle.mjs`, which runs bots/src/overseer.mjs overseerCycle -- the ONE implementation of the rules -- over
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

COST (r5, measured on ci2, synthetic showcase volume: 14 bots, 18k rows/h, ~1.2 KB rows): the full walk it replaced parsed the
whole live file every cycle (128 MB at 6 h into the day, ~500 MB at 24 h; 410 MB RSS, 1.5-4.3 s CPU). Incremental: one cycle
reads ~5 MB (15 min of rows). It runs anywhere the logs are: --logs is a path, so a synced copy on another host works.

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
from lib.telemetry import canon, open_log  # noqa: E402
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


def observe(state, files, now_ms, **kw):
    """r3: ONE CYCLE'S LOOK AT THE LOGS -> (problems, retired). The observation (logdirs.json: each directory's last-seen time;
    gzcheck.json) is written EVERY cycle, a failed one too: a legacy list entry gets its first-seen time once and keeps it, and
    a healthy directory's time advances while cycles are blocked. A failed cycle still publishes nothing (the caller returns)."""
    dirs_file, gz_file = os.path.join(state, 'logdirs.json'), os.path.join(state, 'gzcheck.json')

    def jread(f, dflt):
        try:
            with open(f) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return dflt

    def jwrite(f, obj):
        with open(f + '.tmp', 'w') as fh:
            json.dump(obj, fh, sort_keys=True)
        os.replace(f + '.tmp', f)
    problems, seen, retired, gzc = read_problems(files, jread(dirs_file, {}), now_ms, jread(gz_file, {}), **kw)
    jwrite(gz_file, gzc)
    jwrite(dirs_file, seen)
    return problems, retired


def _ts_ms(s):
    try:
        return int(dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None


def tail_read(files, prev, now_ms, window_ms=180 * 60000, stat=os.stat):
    """r5 (cost): THE INCREMENTAL READ -> (state, bytes_read). Only the bytes appended to each live (plain) log since the last
    cycle are read; a .gz is rotated history and is never read here (read_problems validates it once). Per file the state keeps
    {ino, off}; a file is followed by its INODE, so a live file renamed by the rotation is finished under its new name, and a new
    inode (or a file shorter than its offset) is read from 0. Only whole lines are consumed. From the new bytes it keeps, rolling
    over `window_ms`: each bot's newest row (time, position) and the `_worklist` rows -- nothing else is parsed (a line is
    json-parsed only when it names `_worklist`, or is the newest of its chunk). An unreadable file raises (fail closed)."""
    st = {'files': {}, 'bots': dict(prev.get('bots', {})), 'wl': list(prev.get('wl', []))}
    old_by_ino = {v['ino']: v for v in prev.get('files', {}).values()}
    nbytes = 0
    for f in sorted(files):
        if f.endswith('.gz'):
            continue
        s_ = stat(f)
        was = old_by_ino.get(s_.st_ino)
        off = was['off'] if was and was['off'] <= s_.st_size else 0
        if off < s_.st_size:
            with open(f, 'rb') as fh:
                fh.seek(off)
                buf = fh.read(s_.st_size - off)
            end = buf.rfind(b'\n') + 1
            nbytes += end
            last = None
            for line in buf[:end].splitlines():
                if b'"_worklist"' in line:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    t = _ts_ms(d.get('@timestamp'))
                    name = (d.get('bot') or {}).get('name')
                    if t is not None and name:
                        st['wl'].append({'bot': name, 't': t, 'detail': (d.get('skill') or {}).get('detail') or ''})
                if line.strip():
                    last = line
            if last is not None:
                try:
                    d = json.loads(last)
                    b, t = d.get('bot') or {}, _ts_ms(d.get('@timestamp'))
                    p = b.get('pos') if isinstance(b.get('pos'), dict) else None
                    if b.get('name') and t is not None and t >= st['bots'].get(b['name'], {}).get('t', 0):
                        st['bots'][b['name']] = {'t': t, 'pos': [p.get('x'), p.get('y'), p.get('z')] if p else st['bots'].get(b['name'], {}).get('pos')}
                except ValueError:
                    pass
            off += end
        st['files'][f] = {'ino': s_.st_ino, 'off': off}
    lo = now_ms - window_ms
    st['wl'] = [r for r in st['wl'] if r['t'] >= lo]
    st['bots'] = {n: v for n, v in st['bots'].items() if v['t'] >= lo}
    return st, nbytes


def roster_from_tail(st, now_ms, online_min=10):
    """PURE. The tail state -> (bots, worklist rows) in the cycle's input shape."""
    bots = [{'name': n, 'online': now_ms - v['t'] <= online_min * 60000, 'pos': v.get('pos')} for n, v in sorted(st['bots'].items())]
    return bots, sorted(st['wl'], key=lambda r: r['t'])


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
    problems, retired = observe(a.state, glob.glob(os.path.join(a.logs, '*', 'skill-*.jsonl*')), now_ms)
    if problems:
        # r1 C3: a log that cannot be read (or one gone less than the grace) is no cycle: nothing is written, the row says why
        row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'error': 'logs: ' + '; '.join(problems)[:600], 'wrote': 'nothing'}
        log_row(row)
        print(json.dumps(row, sort_keys=True))
        return 1
    for d in retired:   # r2: one row a retirement; the directory leaves logdirs.json, so the next cycles run
        log_row({'kind': 'showcase_overseer', 'op': 'retired', 'at': now.isoformat(), 'dir': d})
    # r5: incremental -- only the bytes appended since the last cycle (tail.json: offsets by inode, the rolling window's state)
    tail_file = os.path.join(a.state, 'tail.json')
    try:
        with open(tail_file) as fh:
            prev_tail = json.load(fh)
    except (OSError, ValueError):
        prev_tail = {}
    try:
        tail, nbytes = tail_read(glob.glob(os.path.join(a.logs, '*', 'skill-*.jsonl*')), prev_tail, now_ms, a.window_min * 60000)
    except OSError as e:
        row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'error': 'logs: unreadable %s' % e, 'wrote': 'nothing'}
        log_row(row)
        print(json.dumps(row, sort_keys=True))
        return 1
    bots, wl = roster_from_tail(tail, now_ms, a.online_min)
    # kept whatever the cycle does next: its rows stay in the window, and the book's cursor ingests each report once
    with open(tail_file + '.tmp', 'w') as fh:
        json.dump(tail, fh)
    os.replace(tail_file + '.tmp', tail_file)
    live = switch_live(a.switch)
    inp = {'now': int(time.time() * 1000), 'home': [int(v) for v in a.home.split(',')], 'radius': a.radius, 'pool': a.pool,
           'state': a.state, 'zones': a.zones, 'live': live, 'scratch': a.scratch, 'bots': bots, 'rows': wl}
    p = subprocess.run([a.node, CYCLE], input=json.dumps(inp), capture_output=True, text=True, timeout=300)
    try:
        out = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        out = {'error': 'no summary: rc=%s %s' % (p.returncode, p.stderr.strip()[-300:])}
    # the denominator beside the result: the rows and bots the cycle was given
    row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'mode': 'live' if live else 'dry', 'bytes_read': nbytes,
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
