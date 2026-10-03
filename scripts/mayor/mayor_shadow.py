#!/usr/bin/env python3
"""Shadow mayor: observe-only, long-running, resource-bounded. Plan: docs/reports/shadow-mayor-plan-2026-10-03.md

Every --interval seconds (default 300) it folds the NEW bytes of every bot's skill log into a
bounded per-bot state, builds one immutable snapshot per world, runs the deterministic mayor
(mayor_core.decide) and appends:

    <out>/snap-<world>.jsonl     the snapshot (bots, resources, shortages, candidates)
    <out>/assign-<world>.jsonl   would_assign (new/held leases) + unstaffed with reasons + releases
    <out>/mayor-ticks.jsonl      one line per tick: cpu ms, max RSS, bytes read, lag, rotations
    <out>/mayor-state.json       simulated leases/cooldowns (atomic replace), so a restart resumes them

IT NEVER WRITES ANYWHERE ELSE, AND NEVER TALKS TO A BOT. --out-dir is resolved with realpath and
refused if it is inside the bots' trees or outside an allowlisted mayor dir (mayor_io); files are
created O_NOFOLLOW; past --max-out-mb it stops (exit 6) with a message instead of filling the disk.

WHY IT TAILS INSTEAD OF A FULL WALK. CLAUDE.md's full-walk rule is for ANALYSIS: seeking to the
tail eats the baseline. This process is not an analysis; it needs only each bot's current state,
and it runs on the bots' own host every 5 minutes. It reads each file incrementally by byte
offset; the SCORER does full reads. At start-up it reads the last --bootstrap-bytes of each file.

ROTATION. logrotate uses copytruncate here (the file shrinks under us) and may also rename. A new
inode, a size below our offset, or a changed FIRST BYTES fingerprint (a truncate that regrew past
our offset between two ticks) all reset the offset to 0 and drop any partial line.

REPLAY (--replay) steps a virtual clock through whole files and ingests each row only once it was
AVAILABLE (start + duration_ms: rows are stamped at START and written at the END), drops every
facts sighting whose `last` is after the snapshot time, and marks every snapshot `replay: true`
(the scorer refuses those unless --replay-only). It streams: memory is bounded by files x a small
reorder buffer, not by the size of the logs.
"""
import argparse
import glob
import gzip
import heapq
import json
import os
import re
import resource
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402
import mayor_io  # noqa: E402

HEAD = 128


class Tail:
    """Incremental line reader for one append-only file. Bounded: at most max_bytes per read."""

    def __init__(self, path, bootstrap_bytes):
        self.path, self.bootstrap = path, bootstrap_bytes
        self.ino = self.off = None
        self.head = b''
        self.buf = b''
        self.rotations = 0
        self.lag = 0
        self.missing_ms = None

    def read(self, max_bytes, now_ms=None):
        try:
            st = os.stat(self.path)
            f = open(self.path, 'rb')
        except FileNotFoundError:
            if self.missing_ms is None:
                self.missing_ms = now_ms if now_ms is not None else int(time.time() * 1000)
            return []
        self.missing_ms = None
        with f:
            skip_first = False
            if self.ino is None:
                self.ino, self.off = st.st_ino, max(0, st.st_size - self.bootstrap)
                skip_first = self.off > 0            # landed mid-line
            else:
                rotated = st.st_ino != self.ino or st.st_size < self.off
                if not rotated and self.head:
                    rotated = f.read(len(self.head)) != self.head
                if rotated:
                    self.ino, self.off, self.buf, self.head = st.st_ino, 0, b'', b''
                    self.rotations += 1
            if len(self.head) < HEAD:
                f.seek(0)
                self.head = f.read(min(st.st_size, HEAD))
            n = min(st.st_size - self.off, max_bytes)
            if n <= 0:
                self.lag = 0
                return []
            f.seek(self.off)
            data = f.read(n)
        self.off += len(data)
        self.lag = st.st_size - self.off
        lines = (self.buf + data).split(b'\n')
        self.buf = lines.pop()
        if len(self.buf) > (1 << 20):           # a 1 MB line is not telemetry; drop it rather than grow
            self.buf = b''
        if skip_first and lines:
            lines.pop(0)
        return lines


def load_facts(facts_root, world, bot_names, cache, used):
    """world-facts for one world: the shared pool file, or every isolated bot's own file."""
    paths = [os.path.join(facts_root, '_pool-%s' % world, 'world-facts-%s.json' % world)]
    if not os.path.exists(paths[0]):
        paths = [os.path.join(facts_root, b, 'world-facts-%s.json' % b) for b in sorted(bot_names)]
    out, names = [], []
    for p in paths:
        try:
            mt = os.stat(p).st_mtime
        except OSError:
            continue
        hit = cache.get(p)
        if hit is None or hit[0] != mt:
            try:
                with open(p) as f:
                    hit = (mt, json.load(f))
            except (OSError, ValueError):
                continue
        used[p] = hit
        out.append(hit[1])
        names.append(os.path.basename(p))
    return out, names


def snapshot_all(bots, worlds_ev, facts_root, now_ms, cfg, cache, meta, replay=False):
    """({world: snapshot}, new_cache). The cache keeps only the facts files used this tick."""
    by_world = {}
    for st in bots.values():
        if st.world and st.full is not None:
            by_world.setdefault(st.world, []).append(st)
    out, used = {}, {}
    for world, sts in sorted(by_world.items()):
        facts, names = load_facts(facts_root, world, [s.name for s in sts], cache, used)
        res = core.merge_resources(facts, now_ms, cfg)
        views = [core.bot_view(s, now_ms, cfg) for s in sts]
        bank = core.bank_view(worlds_ev.get(world), now_ms, cfg)
        snap = core.build_snapshot(world, views, res, now_ms, bank, cfg, meta=dict(meta, facts_files=names))
        if replay:
            snap['replay'] = True
        out[world] = snap
    return out, used


def emit(out_dir, snaps, states, cfg):
    n_assign = 0
    for world, snap in snaps.items():
        rec, states[world] = core.decide(snap, states.get(world), cfg)
        if snap.get('replay'):
            rec['replay'] = True
        mayor_io.append_line(os.path.join(out_dir, 'snap-%s.jsonl' % world), json.dumps(snap, separators=(',', ':')))
        mayor_io.append_line(os.path.join(out_dir, 'assign-%s.jsonl' % world), json.dumps(rec, separators=(',', ':')))
        n_assign += len(rec['assignments'])
    return n_assign


def rss_mb():
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / (1 << 20) if sys.platform == 'darwin' else r / 1024     # bytes on macOS, KiB on Linux


def cpu_s():
    r = resource.getrusage(resource.RUSAGE_SELF)
    return r.ru_utime + r.ru_stime


def cfg_from(args):
    cfg = dict(core.DEFAULTS)
    cfg['composter'] = bool(args.composter)
    return cfg


class OutputCap(Exception):
    pass


class Shadow:
    """The live process, one tick at a time (so the tests can drive the clock)."""

    def __init__(self, args):
        self.args, self.cfg = args, cfg_from(args)
        self.out = mayor_io.safe_out_dir(args.out_dir, args.allow_out_root)    # raises UnsafeOutput
        mayor_io.make_dir(self.out)
        self.state_path = os.path.join(self.out, 'mayor-state.json')
        try:
            with open(self.state_path) as f:
                self.states = json.load(f)
        except (OSError, ValueError):
            self.states = {}
        self.tails, self.bots, self.worlds_ev, self.cache, self.stats = {}, {}, {}, {}, {}
        self.world_seen = {}                      # world -> last tick it had a snapshot (restart: grace from now)

    def tick(self, now_ms=None):
        a = self.args
        t0, c0 = time.time(), cpu_s()
        wall = int(time.time() * 1000) if now_ms is None else now_ms
        cap = a.max_out_mb << 20
        used = mayor_io.dir_bytes(self.out)
        if used > cap:
            raise OutputCap('output cap reached: %.1f MB of mayor files in %s > --max-out-mb %d. Nothing was written. '
                            'Archive or remove the files, then restart.' % (used / 2 ** 20, self.out, a.max_out_mb))
        for p in glob.glob(a.logs):
            if p not in self.tails:
                self.tails[p] = Tail(p, a.bootstrap_bytes)
        nbytes = nrows = bad = 0
        for p in list(self.tails):
            tail = self.tails[p]
            for line in tail.read(a.max_bytes_per_file, wall):
                nbytes += len(line) + 1
                try:
                    row = json.loads(line)
                except ValueError:
                    bad += 1
                    continue
                if core.ingest(row, self.bots, self.worlds_ev, now_ms=wall, stats=self.stats):
                    nrows += 1
            if tail.missing_ms is not None and wall - tail.missing_ms > a.evict_file_min * 60000:
                del self.tails[p]                 # the file is gone: forget its offset and fingerprint
        now = wall
        if a.now_from_data:
            now = max((b.last_ms for b in self.bots.values() if b.last_ms), default=wall)
        # evict on the SNAPSHOT clock: with --now-from-data the wall clock emptied any copied slice older than
        # evict_bot_h before it was snapshotted (test_once_over_real_rows went red 6 h after its fixture rows)
        for name in [n for n, st in self.bots.items() if st.last_ms is not None and now - st.last_ms > a.evict_bot_h * 3.6e6]:
            del self.bots[name]                   # silent for hours: not a member of the world any more
        snaps, self.cache = snapshot_all(self.bots, self.worlds_ev, a.facts_root, now, self.cfg, self.cache, {'mode': 'live'})
        n_assign = emit(self.out, snaps, self.states, self.cfg)
        for w in snaps:
            self.world_seen[w] = now
        for w in set(self.states) | set(self.worlds_ev):
            self.world_seen.setdefault(w, now)
            if w not in snaps and now - self.world_seen[w] > a.evict_world_h * 3.6e6:
                self.states.pop(w, None)          # absent for hours: its leases and cooldowns go with it
                self.worlds_ev.pop(w, None)
                self.world_seen.pop(w, None)
        mayor_io.write_atomic(self.state_path, json.dumps(self.states))
        tick = {'t': core.iso(now), 'mayor_rev': core.MAYOR_REV, 'files': len(self.tails), 'bytes': nbytes, 'rows': nrows, 'bad_lines': bad,
                'future_rows': self.stats.get('future', 0), 'bots': len(self.bots), 'worlds': len(snaps),
                'assignments': n_assign, 'lag_bytes': sum(t.lag for t in self.tails.values()),
                'rotations': sum(t.rotations for t in self.tails.values()),
                'cpu_ms': round((cpu_s() - c0) * 1000), 'wall_ms': round((time.time() - t0) * 1000),
                'max_rss_mb': round(rss_mb(), 1), 'out_mb': round(used / 2 ** 20, 2)}
        mayor_io.append_line(os.path.join(self.out, 'mayor-ticks.jsonl'), json.dumps(tick))
        return tick


def run_live(args):
    sh = Shadow(args)
    while True:
        t0 = time.time()
        try:
            tick = sh.tick()
        except OutputCap as e:
            print('STOPPED: %s' % e, file=sys.stderr)
            return 6
        print(json.dumps(tick), flush=True)
        if tick['max_rss_mb'] > args.max_rss_mb:
            print('max RSS %.0f MB > --max-rss-mb %d: exiting so the supervisor restarts a clean process'
                  % (tick['max_rss_mb'], args.max_rss_mb), file=sys.stderr)
            return 3
        if args.once:
            return 0
        time.sleep(max(1.0, args.interval - (time.time() - t0)))


_TS = re.compile(r'"@timestamp":\s*"([^"]+)"')
_DUR = re.compile(r'"duration_ms":\s*(\d+)')


def available_ms(line):
    """When a row became readable: its START stamp plus duration_ms (it is written at the end)."""
    m = _TS.search(line)
    t = core.parse_ts(m.group(1)) if m else None
    if t is None:
        return None
    d = _DUR.search(line)
    return t + (int(d.group(1)) if d else 0)


def file_stream(path, reorder):
    """(avail_ms, seq, line) from one file in availability order, give or take `reorder` rows.
    A row that arrives later than the buffer can fix is ingested LATE, never early."""
    op = gzip.open if path.endswith('.gz') else open
    h, seq = [], 0
    with op(path, 'rt', errors='replace') as f:
        for line in f:
            t = available_ms(line)
            if t is None:
                continue
            seq += 1
            heapq.heappush(h, (t, seq, line))
            if len(h) > reorder:
                yield heapq.heappop(h)
    while h:
        yield heapq.heappop(h)


def run_replay(args):
    cfg = cfg_from(args)
    c0, t0 = cpu_s(), time.time()
    paths = sorted(glob.glob(args.logs))
    first = last = None
    for p in paths:                                   # pass 1: the time range, streaming
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', errors='replace') as f:
            for line in f:
                t = available_ms(line)
                if t is not None:
                    first = t if first is None else min(first, t)
                    last = t if last is None else max(last, t)
    if first is None:
        print('replay: no rows matched %s' % args.logs, file=sys.stderr)
        return 2
    start = max(first, last - args.replay_minutes * 60000) if args.replay_minutes else first
    stream = heapq.merge(*(file_stream(p, args.reorder) for p in paths))
    nxt = next(stream, None)
    bots, worlds_ev, cache, states = {}, {}, {}, {}
    step, n_snap = start + args.interval * 1000, 0
    meta = {'mode': 'replay', 'facts': 'current files; sightings with last > snapshot time dropped, sightings '
                                       'evicted from the 200-cap before today are missing'}
    while True:
        while nxt is not None and nxt[0] <= step:     # only what had been WRITTEN by `step`
            try:
                core.ingest(json.loads(nxt[2]), bots, worlds_ev)
            except ValueError:
                pass
            nxt = next(stream, None)
        if step >= start + args.warmup_s * 1000:
            used = mayor_io.dir_bytes(args.out_dir)
            if used > args.max_out_mb << 20:
                print('STOPPED: output cap reached: %.1f MB of mayor files in %s > --max-out-mb %d. Archive or remove '
                      'the files, then rerun.' % (used / 2 ** 20, args.out_dir, args.max_out_mb), file=sys.stderr)
                return 6
            snaps, cache = snapshot_all(bots, worlds_ev, args.facts_root, step, cfg, cache, meta, replay=True)
            emit(args.out_dir, snaps, states, cfg)
            n_snap += len(snaps)
        if step >= last:
            break
        step = min(last, step + args.interval * 1000)
    print(json.dumps({'replay_from': core.iso(start), 'to': core.iso(last), 'snapshots': n_snap, 'bots': len(bots),
                      'cpu_ms': round((cpu_s() - c0) * 1000), 'wall_ms': round((time.time() - t0) * 1000),
                      'max_rss_mb': round(rss_mb(), 1)}))
    return 0


def parser():
    ap = argparse.ArgumentParser(description='shadow mayor (observe-only)')
    ap.add_argument('--logs', default='/var/log/mcai/*/skill-*.jsonl',
                    help='live: CURRENT files only (no .gz). replay: may include rotated .gz')
    ap.add_argument('--facts-root', default='/var/lib/mcai')
    ap.add_argument('--out-dir', default='/var/lib/mcai-mayor')
    ap.add_argument('--allow-out-root', action='append',
                    help='allowlisted root for --out-dir (repeatable; default /var/lib/mcai-mayor). Bot trees are '
                         'refused regardless.')
    ap.add_argument('--interval', type=int, default=300)
    ap.add_argument('--bootstrap-bytes', type=int, default=1 << 20, help='per file, at start-up')
    ap.add_argument('--max-bytes-per-file', type=int, default=16 << 20, help='per tick; the rest is read next tick')
    ap.add_argument('--max-out-mb', type=int, default=1024, help='stop (exit 6) when the mayor files exceed this')
    ap.add_argument('--evict-file-min', type=int, default=30, help='forget a vanished file after this')
    ap.add_argument('--evict-bot-h', type=float, default=6, help='forget a bot silent this long')
    ap.add_argument('--evict-world-h', type=float, default=6, help='forget a world (and its leases) absent this long')
    ap.add_argument('--max-rss-mb', type=int, default=400, help='exit 3 above this (let systemd restart)')
    ap.add_argument('--mem-limit-mb', type=int, default=768, help='RLIMIT_AS on Linux (0 = none)')
    ap.add_argument('--nice', type=int, default=10)
    ap.add_argument('--once', action='store_true', help='one tick, then exit')
    ap.add_argument('--now-from-data', action='store_true', help='clock = newest row (for copied slices)')
    ap.add_argument('--replay', action='store_true', help='virtual clock through whole files')
    ap.add_argument('--replay-minutes', type=int, default=0, help='replay only the last N minutes of data')
    ap.add_argument('--warmup-s', type=int, default=0, help='replay: no snapshot before this much data')
    ap.add_argument('--reorder', type=int, default=64, help='replay: per-file reorder buffer (rows)')
    ap.add_argument('--composter', action='store_true', help='FREE_BAG may compost (only once it ships)')
    return ap


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        args.out_dir = mayor_io.safe_out_dir(args.out_dir, args.allow_out_root)
        mayor_io.make_dir(args.out_dir)
    except (mayor_io.UnsafeOutput, OSError) as e:
        print('REFUSING: %s' % e, file=sys.stderr)
        return 2
    if args.nice:
        try:
            os.nice(args.nice)
        except OSError:
            pass
    if args.mem_limit_mb and sys.platform.startswith('linux'):
        lim = args.mem_limit_mb << 20
        resource.setrlimit(resource.RLIMIT_AS, (lim, lim))
    return run_replay(args) if args.replay else run_live(args)


if __name__ == '__main__':
    sys.exit(main())
