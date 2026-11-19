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

INSTALL ON THE SHOWCASE VM (.40) -- the control session's conditions (r6):
  * Cron (Linux), minutes 10, 20 and 30 only -- never beside the tripwire's hourly read (~:35 to ~:05); nice 19, a hard 120 s
    wall clock, and a non-blocking flock on its OWN file (not --lock: flock(1)'s lock and the script's are separate descriptions
    of one file and would refuse each other):
      10,20,30 * * * * cd <tree>/scripts/host && flock -n /tmp/overseer.cron.lock timeout 120 nice -n 19 python3 overseer.py \
        --pool <town dir> --home 0,70,0 --radius 128 --state /home/<user>/digest/overseer --switch /home/<user>/digest/overseer/LIVE \
        --scratch /home/<user>/digest/overseer/dry --zones <tree>/infra/showcase/protected-zones.showcase.json \
        --logs /var/log/mcai --ship /var/log/showcase/heartbeat.jsonl --mem-cap-mb 300 >> /home/<user>/digest/overseer/cron.log 2>&1 # overseer
  * THE FIRST CYCLE reads the day's live files once (up to ~500 MB at 23:00Z). The control session runs it BY HAND, dry (no LIVE
    file), at a quiet minute between :10 and :30 -- the same command as the cron line, which takes the same script lock
    (--lock /tmp/overseer.lock) and makes the same tripwire check (a hand run beside the read exits at once, skipped).
  * AT LEAST THREE DRY CYCLES are read (<state>/cycles.jsonl, <state>/dry/worklist-*.json) before LIVE is created.
  * The script itself: its own lock (--lock); exits 0 with one `op=skipped why=tripwire_read` row while
    `python ... showcase_trip.py read` runs (trip_reading: matched on the command's words, never on itself or a pgrep);
    --mem-cap-mb (300): the python step's address space is capped and its peak RSS checked; the node step runs with
    --max-old-space-size=<cap-44>, under a measuring parent: a non-zero exit or a measured peak RSS over the cap is a failed
    cycle. The node step only STAGES its writes (<state>/stage/manifest.json); they are published (book first) only after that
    check (r7: fail closed -- an error row, nothing published). r8: each run stages into its own stage/<time>-<pid>-<rand>, its
    manifest names that run, and only that run's plan from that directory is published; older stages are removed. The node child
    runs in its own process group, killed as a group on a timeout, on every exit, and on SIGTERM/SIGINT to this script (cron's
    `timeout 120`), so no node outlives its cycle. The log read streams in 8 MB chunks, so the first cycle of the
    day or a re-read from 0 stays inside the cap.
  * Lists live 60 min (overseer.mjs OVERSEER.listTtlMs): the longest gap between slots is :30 -> :10 (40 min), 50 min when the :10
    slot is skipped for an overrunning read; 60 covers one skipped slot. The stall (30 min of no progress) and unstick (10 min) clocks
    are measured from the bots' rows, not from the cycle, and the bot's own 3 h stale-save check is longer than 60: none assumed 30.

THE INPUTS: roster = every bot with a row in the last --window-min (default 180); online = a row in the last --online-min (10);
pos = its newest row's bot.pos; the `_worklist` rows (the bots' per-job reports). Rate and last progress are measured by the cycle
from those rows. ONE summary row a cycle: appended to <state>/cycles.jsonl and shipped as kind `showcase_overseer`.
The set-aside (quarantined) jobs: <state>/setaside.json (for the status page).
"""
import signal
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


FP_HEAD, FP_TAIL = 4096, 256


def _sha(b):
    import hashlib
    return hashlib.sha1(b).hexdigest()


def fingerprint(path, off):
    """r6: what identifies the bytes already read -> {hl, head, tail}: the first min(4096, off) bytes and the 256 before `off`."""
    hl = min(FP_HEAD, off)
    with open(path, 'rb') as fh:
        head = fh.read(hl)
        fh.seek(max(0, off - FP_TAIL))
        tail = fh.read(off - max(0, off - FP_TAIL))
    return {'hl': hl, 'head': _sha(head), 'tail': _sha(tail)}


def fingerprint_ok(path, was):
    """r6: does the file still hold the bytes the saved offset was taken over? (an old state without a fingerprint: no -- read again)"""
    if not was or 'head' not in was:
        return False
    try:
        return fingerprint(path, was['off']) == {'hl': was['hl'], 'head': was['head'], 'tail': was['tail']}
    except OSError:
        return False


# overseer-02show: the replay's classes (docs/reports/overseer-replay-2026-11-19.md section 1; ~/ovreplay/pull_min.py on .31).
# WORK PROGRESS: a work skill's success, or a town placement by a skill. ANY ACTION: work progress or a successful move/errand.
WORK_SKILLS = frozenset(['gather', 'mine', 'deep_mine', 'craft', 'smelt', 'smelt_town', 'place', 'deposit', 'town_deposit', 'make_material',
                         'build_shop', 'dispose_well', 'compost', 'build_plinth', 'build_well', 'build_composter', 'prune_town',
                         '_build_visit', '_structure_complete', '_sort_deposit', '_junk_pickup', 'collect', 'dig', 'build', 'farm', 'plant',
                         'harvest', 'craft_tools', 'store', 'smelt_ore', 'chop', 'build_house', 'build_shelter', 'till', 'breed'])
ACTION_SKILLS = frozenset(['explore', 'goto', 'home', 'surface', 'withdraw_pick', 'toolkit', 'crew_up', 'sky_descend', 'market_trip', 'market_run',
                           'village_feed', 'withdraw', 'eat', 'wear_out', 'board', 'found_store'])
import re as _re  # noqa: E402
_NAME = _re.compile(rb'"skill":\{"name":"([^"]+)"')
_TS = _re.compile(rb'"@timestamp":"([^"]+)"')
_VER = _re.compile(rb'"code":\{"version":"([^"]+)"')


def classify(line):
    """overseer-02show -- PURE. One raw log line -> 'work' | 'act' | None (bytes regex: no json parse for the ~18k rows/h)."""
    m = _NAME.search(line)
    if not m:
        return None
    name = m.group(1).decode('utf-8', 'replace')
    if name == '_place_town':
        return 'work' if b'reason=skill' in line and b'outcome=placed' in line else None
    if b'"status":"success"' not in line:
        return None
    return 'work' if name in WORK_SKILLS else 'act' if name in ACTION_SKILLS else None


def tail_read(files, prev, now_ms, window_ms=180 * 60000, stat=os.stat, chunk_bytes=8 << 20):
    """r5 (cost): THE INCREMENTAL READ -> (state, bytes_read). Only the bytes appended to each live (plain) log since the last
    cycle are read; a .gz is rotated history and is never read here (read_problems validates it once). Per file the state keeps
    {ino, off}; a file is followed by its INODE, so a live file renamed by the rotation is finished under its new name, and a new
    inode (or a file shorter than its offset) is read from 0. Only whole lines are consumed. From the new bytes it keeps, rolling
    over `window_ms`: each bot's newest row (time, position) and the `_worklist` rows -- nothing else is parsed (a line is
    json-parsed only when it names `_worklist`, or is the newest of its chunk). An unreadable file raises (fail closed)."""
    st = {'files': {}, 'bots': dict(prev.get('bots', {})), 'wl': list(prev.get('wl', []))}
    old_by_ino = {v['ino']: v for v in prev.get('files', {}).values()}
    have = {(r['bot'], r['t'], r['detail']) for r in st['wl']}
    nbytes = 0
    for f in sorted(files):
        if f.endswith('.gz'):
            continue
        s_ = stat(f)
        was = old_by_ino.get(s_.st_ino)
        off = was['off'] if was and was['off'] <= s_.st_size else 0
        # r6 (Codex B): the same inode is the same file only while its fingerprint holds -- its first bytes and the bytes just before
        # the offset. Truncated and regrown past the offset, or a deleted file's inode reused: read again from 0 (the row
        # identities make a re-read harmless)
        if off and not fingerprint_ok(f, was):
            off = 0
        if off < s_.st_size:
            # r7: STREAMED in CHUNK-byte reads, a partial last line carried over -- memory is bounded whatever the backlog (the first
            # cycle of the day, a re-read from 0, an outage)
            last, last_pos, carry, pos, todo = None, None, b'', off, s_.st_size - off
            work_t = act_t = None
            with open(f, 'rb') as fh:
                fh.seek(off)
                while todo > 0:
                    chunk = fh.read(min(chunk_bytes, todo))
                    if not chunk:
                        break
                    todo -= len(chunk)
                    data = carry + chunk
                    cut = data.rfind(b'\n') + 1
                    carry = data[cut:]
                    for line in data[:cut].splitlines():
                        if b'"_worklist"' in line:
                            try:
                                d = json.loads(line)
                            except ValueError:
                                continue
                            t = _ts_ms(d.get('@timestamp'))
                            name = (d.get('bot') or {}).get('name')
                            if t is not None and name and t >= now_ms - window_ms:
                                r = {'bot': name, 't': t, 'detail': (d.get('skill') or {}).get('detail') or ''}
                                if (name, t, r['detail']) not in have:
                                    have.add((name, t, r['detail']))
                                    st['wl'].append(r)
                        k = classify(line)
                        if k:
                            mt = _TS.search(line)
                            tt = _ts_ms(mt.group(1).decode()) if mt else None
                            if tt is not None:
                                act_t = max(act_t or 0, tt)            # work is an action too
                                if k == 'work':
                                    work_t = max(work_t or 0, tt)
                        if line.strip():
                            last = line
                            if b'"pos":{' in line or b'"pos": {' in line:
                                last_pos = line   # overseer-02show: ~8% of rows carry no bot.pos (scans, probes); the position is the newest that has one
                    pos += cut
                    del data
            end = pos - off
            nbytes += end
            if last is not None:
                try:
                    d = json.loads(last)
                    b, t = d.get('bot') or {}, _ts_ms(d.get('@timestamp'))
                    p = None
                    if last_pos is not None:
                        dp = json.loads(last_pos)
                        pp = (dp.get('bot') or {}).get('pos')
                        if isinstance(pp, dict) and (dp.get('bot') or {}).get('name') == b.get('name'):
                            p = pp
                    if b.get('name') and t is not None and t >= st['bots'].get(b['name'], {}).get('t', 0):
                        was_b = st['bots'].get(b['name'], {})
                        mv = _VER.search(last)
                        st['bots'][b['name']] = {'t': t, 'pos': [p.get('x'), p.get('y'), p.get('z')] if p else was_b.get('pos'),
                                                 'work': max(was_b.get('work') or 0, work_t or 0) or None,
                                                 'act': max(was_b.get('act') or 0, act_t or 0) or None,
                                                 'ver': mv.group(1).decode() if mv else was_b.get('ver')}
                except ValueError:
                    pass
            off = pos
        st['files'][f] = {'ino': s_.st_ino, 'off': off, **fingerprint(f, off)}
    lo = now_ms - window_ms
    st['wl'] = [r for r in st['wl'] if r['t'] >= lo]
    st['bots'] = {n: v for n, v in st['bots'].items() if v['t'] >= lo}
    return st, nbytes


def roster_from_tail(st, now_ms, online_min=10):
    """PURE. The tail state -> (bots, worklist rows) in the cycle's input shape."""
    bots = [{'name': n, 'online': now_ms - v['t'] <= online_min * 60000, 'pos': v.get('pos'), 'seen': v['t'],
             'workAt': v.get('work'), 'actAt': v.get('act'), 'ver': v.get('ver')} for n, v in sorted(st['bots'].items())]
    return bots, sorted(st['wl'], key=lambda r: r['t'])


def release_of(bots):
    """overseer-02show -- PURE. The bots' release: the code version most online bots run (ties: the smallest), or None."""
    from collections import Counter
    c = Counter(b['ver'] for b in bots if b.get('online') and b.get('ver'))
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if c else None


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


TRIP_READ = 'showcase_trip.py read'   # r6: the showcase tripwire's hourly read (~:35 to ~:05); the overseer never runs beside it


def trip_reading(ps_lines, self_pids=()):
    """r6 -- PURE. `ps -eo pid=,args=` lines -> True when the tripwire's read is running. Matched on the command's own words (an
    interpreter then a path ending showcase_trip.py, then `read`), never on a line that merely CONTAINS the pattern -- a
    `pgrep -f "showcase_trip.py read"` or a shell whose script names it would match itself (the known trap); this process and
    its parents (`self_pids`) are never counted."""
    for ln in ps_lines:
        parts = ln.strip().split(None, 1)
        if len(parts) < 2 or not parts[0].isdigit() or int(parts[0]) in set(self_pids):
            continue
        argv = parts[1].split()
        for i, w in enumerate(argv[:-1]):
            if os.path.basename(w) == 'showcase_trip.py' and argv[i + 1] == 'read' and any(os.path.basename(x).startswith('python') for x in argv[:i]):
                return True
    return False


def trip_reading_now():
    """The live check: one `ps` listing (no pgrep -f: it can match itself)."""
    out = subprocess.run(['ps', '-eo', 'pid=,args='], capture_output=True, text=True, timeout=20).stdout.splitlines()
    return trip_reading(out, (os.getpid(), os.getppid()))


def over_cap(maxrss_kb, cap_mb, linux=sys.platform.startswith('linux')):
    """r6 -- PURE. ru_maxrss (kB on Linux, bytes on macOS) over the cap?"""
    mb = maxrss_kb / 1024 if linux else maxrss_kb / (1024 * 1024)
    return mb > cap_mb


MEASURE = (
    "import json, resource, subprocess, sys\n"
    "p = subprocess.run(sys.argv[1:], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)\n"
    "sys.stderr.write('\\nOVERSEER_PEAK %d %d\\n' % (resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, p.returncode))\n"
    "sys.exit(p.returncode)\n")


CHILD = None


def kill_group(p, grace=2.0):
    """r8: SIGTERM the child's whole process group, SIGKILL whatever is left after `grace` s. Safe to call twice."""
    import signal
    try:
        pg = os.getpgid(p.pid)
    except (ProcessLookupError, OSError):
        pg = p.pid
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pg, sig)
        except (ProcessLookupError, PermissionError, OSError):
            return
        t_end = time.time() + grace
        while time.time() < t_end:
            try:
                os.killpg(pg, 0)
            except (ProcessLookupError, OSError):
                try:
                    p.wait(timeout=0.1)
                except Exception:
                    pass
                return
            time.sleep(0.05)
    try:
        p.wait(timeout=1)
    except Exception:
        pass


def run_child(cmd, payload, cap_mb, timeout=110, linux=sys.platform.startswith('linux')):
    """r6/r7: the node step under its heap cap AND its measured peak RSS -> (summary dict) with `error` on any failure: a non-zero
    exit (an out-of-memory abort included), no summary, a timeout, or a peak RSS over cap_mb (V8's heap cap does not bound buffers).
    The child runs under a fresh measuring parent (its RUSAGE_CHILDREN is this child alone). The caller publishes nothing on an
    error (the child only STAGES its writes)."""
    # r8: the child and everything under it in their OWN process group, killed as a group on a timeout and on every exit path
    # (and by the SIGTERM/SIGINT handler main installs), so no node outlives this cycle's lock
    global CHILD
    # r9 (Codex r7): a SIGTERM/SIGINT between the Popen and `CHILD = p` would exit with CHILD unset and leave the group alive.
    # The two signals are held blocked across creation + registration (the child unblocks them for itself before exec), then
    # released: a signal that arrived in that window is delivered here, with CHILD set, and the handler kills the group.
    held = {signal.SIGTERM, signal.SIGINT}
    signal.pthread_sigmask(signal.SIG_BLOCK, held)
    try:
        p = subprocess.Popen([sys.executable, '-c', MEASURE] + list(cmd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, start_new_session=True, preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_UNBLOCK, held))
        CHILD = p
    finally:
        signal.pthread_sigmask(signal.SIG_UNBLOCK, held)
    try:
        stdout, stderr = p.communicate(payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_group(p)
        return {'error': 'node: timeout %ss (group killed)' % timeout}
    finally:
        kill_group(p)
        CHILD = None
    p.stdout, p.stderr = stdout, stderr
    peak = None
    for ln in p.stderr.splitlines():
        if ln.startswith('OVERSEER_PEAK '):
            peak = int(ln.split()[1])
    if peak is None:
        return {'error': 'node: no peak measured (exit %s) %s' % (p.returncode, p.stderr.strip()[-200:])}
    peak_mb = round(peak / 1024 if linux else peak / (1024 * 1024))
    if p.returncode != 0:
        said = ''   # overseer-02show: the cycle's own error (overseer-cycle.mjs prints {error} on stdout before it exits 2)
        try:
            said = json.loads(p.stdout.strip().splitlines()[-1]).get('error') or ''
        except Exception:
            pass
        return {'error': 'node: exit %s (cap %s MB, peak %s MB) %s %s' % (p.returncode, cap_mb, peak_mb, said[:200], p.stderr.strip()[-200:]), 'peak_mb': peak_mb}
    if over_cap(peak, cap_mb, linux):
        return {'error': 'node: peak RSS %s MB over the cap %s MB' % (peak_mb, cap_mb), 'peak_mb': peak_mb}
    try:
        out = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return {'error': 'node: no summary', 'peak_mb': peak_mb}
    out['peak_mb'] = peak_mb
    return out


def under(path, root):
    """overseer-02show -- PURE but for realpath: is `path` inside directory `root`?"""
    r = os.path.realpath(root)
    return os.path.commonpath([os.path.realpath(path), r]) == r


def apply_stage(stage, run_id, confine=None):
    """r7: publish what the node step staged, in its order (the book first) -> the number of operations. A write is copied beside
    its destination and renamed over it (atomic; the stage may be on another filesystem than the town); an append adds the staged
    lines to its log. overseer-02show: with `confine` (the --dry run's --state), a plan with ANY destination outside it is refused
    whole before anything is applied -- a dry cycle writes nothing but the overseer's own state, whatever the node step planned."""
    import shutil
    with open(os.path.join(stage, 'manifest.json')) as fh:
        man = json.load(fh)
    # r8: only this run's own plan, from this run's own directory
    if man.get('run') != run_id or os.path.basename(os.path.normpath(stage)) != run_id:
        raise ValueError('stage run mismatch: %s != %s' % (man.get('run'), run_id))
    plan = man['plan']
    for op in plan:
        if op['op'] in ('write', 'append') and os.path.dirname(os.path.abspath(op['src'])) != os.path.abspath(stage):
            raise ValueError('stage source outside its run: %s' % op['src'])
        if op['op'] not in ('write', 'append', 'unlink'):
            raise ValueError('unknown stage op: %s' % op['op'])
        if confine is not None and not under(op['dest'], confine):
            raise ValueError('dry: a %s outside the state dir refused: %s' % (op['op'], op['dest']))
    for op in plan:
        if op['op'] == 'write':
            os.makedirs(os.path.dirname(op['dest']) or '.', exist_ok=True)
            tmp = op['dest'] + '.tmp-%d' % os.getpid()
            shutil.copyfile(op['src'], tmp)
            os.replace(tmp, op['dest'])
        elif op['op'] == 'append':
            os.makedirs(os.path.dirname(op['dest']) or '.', exist_ok=True)
            with open(op['src'], 'rb') as src, open(op['dest'], 'ab') as dst:
                shutil.copyfileobj(src, dst)
        elif op['op'] == 'unlink':
            try:
                os.unlink(op['dest'])
            except FileNotFoundError:
                pass
    return len(plan)


def new_run_id(now_ms):
    import secrets
    return '%013d-%d-%s' % (now_ms, os.getpid(), secrets.token_hex(4))


def prune_stages(root, run_id):
    """r8: every stage directory OLDER than this run (by its time prefix) is removed."""
    import shutil
    try:
        names = os.listdir(root)
    except OSError:
        return 0
    n = 0
    for d in names:
        if d < run_id and d != run_id:
            shutil.rmtree(os.path.join(root, d), ignore_errors=True)
            n += 1
    return n


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--pool', required=True)
    ap.add_argument('--home', required=True, help='x,y,z')
    ap.add_argument('--state', required=True)
    ap.add_argument('--switch', default=None, help='the LIVE switch file (required unless --dry)')
    ap.add_argument('--scratch', default=None, help='dry lists (not --dry); default <state>/dry')
    ap.add_argument('--dry', action='store_true', help='overseer-02show: HARD dry -- never live, no list or order file anywhere, '
                    'nothing written outside --state (its log decisions.jsonl, cycles.jsonl, its book)')
    ap.add_argument('--zones', required=True)   # r1 C4: protection never fails open
    ap.add_argument('--logs', default='/var/log/mcai')
    ap.add_argument('--radius', type=int, default=128)
    ap.add_argument('--window-min', type=int, default=180)
    ap.add_argument('--online-min', type=int, default=10)
    ap.add_argument('--ship', default=None)
    ap.add_argument('--lock', default=None, help='default /tmp/overseer.lock; with --dry <state>/overseer.lock')
    ap.add_argument('--node', default='node')
    ap.add_argument('--rules', default=None, help='overseer-02show: JSON over the rules, e.g. {"base": "v1"} or {"unstickAfterMs": 1800000}')
    ap.add_argument('--now', default=None, help='overseer-02show: the cycle\'s clock (ISO, e.g. 2026-11-19T02:10:00Z) -- replays and tests only')
    ap.add_argument('--mem-cap-mb', type=int, default=300, help='r6: the python step and the node step each abort above this')
    a = ap.parse_args(argv)
    if not a.dry and not a.switch:
        ap.error('--switch is required unless --dry')
    if a.dry and a.ship:
        ap.error('--dry writes nothing outside --state: no --ship')
    a.lock = a.lock or (os.path.join(a.state, 'overseer.lock') if a.dry else '/tmp/overseer.lock')
    a.scratch = a.scratch or os.path.join(a.state, 'dry')
    os.makedirs(a.state, exist_ok=True)
    lk = open(a.lock, 'w')
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print('overseer: another cycle holds the lock; this one is skipped')
        return 0
    # r8: a SIGTERM (cron's `timeout 120`) or SIGINT kills the node child's group before this process goes
    import signal

    def _die(signum, _frame):
        if CHILD is not None:
            kill_group(CHILD, grace=1.0)
        sys.exit(128 + signum)
    signal.signal(signal.SIGTERM, _die)
    signal.signal(signal.SIGINT, _die)
    now = dt.datetime.fromisoformat(a.now.replace('Z', '+00:00')) if a.now else dt.datetime.now(dt.timezone.utc)
    # r6: NEVER BESIDE THE TRIPWIRE'S READ -- a skipped cycle, not a failure; the row is the only thing written
    if trip_reading_now():
        row = {'kind': 'showcase_overseer', 'op': 'skipped', 'why': 'tripwire_read', 'at': now.isoformat(), 'wrote': 'nothing'}
        with open(os.path.join(a.state, 'cycles.jsonl'), 'a') as fh:
            fh.write(json.dumps(row, sort_keys=True) + '\n')
        print(json.dumps(row, sort_keys=True))
        return 0
    # r6: the python step's memory cap (the address space; the node child gets its own heap cap below)
    import resource
    try:
        hard = resource.getrlimit(resource.RLIMIT_AS)[1]
        resource.setrlimit(resource.RLIMIT_AS, (a.mem_cap_mb * 1024 * 1024, hard))
    except (ValueError, OSError):
        pass
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
    now_ms = int(now.timestamp() * 1000)
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
    except MemoryError:
        row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'error': 'python: over %s MB' % a.mem_cap_mb, 'wrote': 'nothing'}
        log_row(row)
        print(json.dumps(row, sort_keys=True))
        return 1
    if over_cap(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, a.mem_cap_mb):
        row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'error': 'python: peak RSS over %s MB' % a.mem_cap_mb, 'wrote': 'nothing'}
        log_row(row)
        print(json.dumps(row, sort_keys=True))
        return 1
    bots, wl = roster_from_tail(tail, now_ms, a.online_min)
    # kept whatever the cycle does next: its rows stay in the window, and the book's cursor ingests each report once
    with open(tail_file + '.tmp', 'w') as fh:
        json.dump(tail, fh)
    os.replace(tail_file + '.tmp', tail_file)
    live = False if a.dry else switch_live(a.switch)   # overseer-02show: --dry never reads the switch
    # r8: this run's own stage directory; older runs' stages (an orphan's included) are removed first
    run_id = new_run_id(now_ms)
    prune_stages(os.path.join(a.state, 'stage'), run_id)
    inp = {'now': now_ms if a.now else int(time.time() * 1000), 'home': [int(v) for v in a.home.split(',')], 'radius': a.radius, 'pool': a.pool,
           'state': a.state, 'zones': a.zones, 'live': live, 'scratch': a.scratch, 'bots': bots, 'rows': wl,
           'stage': os.path.join(a.state, 'stage', run_id), 'run': run_id, 'dry': bool(a.dry), 'release': release_of(bots),
           'rules': json.loads(a.rules) if a.rules else None}
    # the child must not inherit the python step's address-space cap (V8 reserves far more than it uses): the soft limit goes back
    # to the HARD one (RLIM_INFINITY is refused when the hard limit is finite); node's own heap cap bounds it
    try:
        resource.setrlimit(resource.RLIMIT_AS, (resource.getrlimit(resource.RLIMIT_AS)[1], resource.getrlimit(resource.RLIMIT_AS)[1]))
    except (ValueError, OSError) as e:
        row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'error': 'rlimit: cannot lift the cap for node: %s' % e, 'wrote': 'nothing'}
        log_row(row)
        print(json.dumps(row, sort_keys=True))
        return 1
    out = run_child([a.node, '--max-old-space-size=%d' % max(16, a.mem_cap_mb - 44), CYCLE], json.dumps(inp), a.mem_cap_mb)
    if 'error' not in out:   # r7: published only now, after the child's peak memory was checked
        try:
            out['published'] = apply_stage(inp['stage'], run_id, confine=a.state if a.dry else None)
        except (OSError, ValueError, KeyError) as e:
            out = {**out, 'error': 'publish: %s' % e}
    # the denominator beside the result: the rows and bots the cycle was given
    row = {'kind': 'showcase_overseer', 'at': now.isoformat(), 'mode': 'live' if live else 'dry', 'hard_dry': bool(a.dry), 'bytes_read': nbytes,
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
