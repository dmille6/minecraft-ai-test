#!/usr/bin/env python3
"""Shadow mayor: observe-only, long-running, resource-bounded. Plan: docs/reports/shadow-mayor-plan-2026-10-03.md

Every --interval seconds (default 300) it folds the NEW bytes of every bot's skill log into a
bounded per-bot state, builds one immutable snapshot per world, runs the deterministic mayor
(mayor_core.decide) and appends:

    <out>/snap-<world>.jsonl     the snapshot (bots, resources, shortages, candidates)
    <out>/assign-<world>.jsonl   would_assign (new/held leases) + unstaffed with reasons + releases
    <out>/mayor-ticks.jsonl      one line per tick: cpu ms, max RSS, bytes read, lag, rotations
    <out>/mayor-state.json       simulated leases/cooldowns (atomic replace), so a restart resumes them

IT NEVER WRITES ANYWHERE ELSE, AND NEVER TALKS TO A BOT.

WHY IT TAILS INSTEAD OF A FULL WALK. CLAUDE.md's full-walk rule is for ANALYSIS: seeking to the
tail eats the baseline. This process is not an analysis; it needs only each bot's current state,
and it runs on the bots' own host every 5 minutes, so re-reading 7 GB per tick would be the wrong
cost in the wrong place. It reads each file incrementally by byte offset; the SCORER does full
reads. At start-up it reads the last --bootstrap-bytes of each current file to learn state.

ROTATION. logrotate uses copytruncate here (the file shrinks under us) and may also rename: a
size below our offset or a new inode both reset the offset to 0.
"""
import argparse
import glob
import heapq
import json
import os
import resource
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mayor_core as core  # noqa: E402


class Tail:
    """Incremental line reader for one append-only file. Bounded: at most max_bytes per read."""

    def __init__(self, path, bootstrap_bytes):
        self.path, self.bootstrap = path, bootstrap_bytes
        self.ino = self.off = None
        self.buf = b''
        self.rotations = 0
        self.lag = 0

    def read(self, max_bytes):
        try:
            st = os.stat(self.path)
        except FileNotFoundError:
            return []
        skip_first = False
        if self.ino is None:
            self.ino, self.off = st.st_ino, max(0, st.st_size - self.bootstrap)
            skip_first = self.off > 0            # landed mid-line
        elif st.st_ino != self.ino or st.st_size < self.off:
            self.ino, self.off, self.buf = st.st_ino, 0, b''
            self.rotations += 1
        n = min(st.st_size - self.off, max_bytes)
        if n <= 0:
            self.lag = 0
            return []
        with open(self.path, 'rb') as f:
            f.seek(self.off)
            data = f.read(n)
        self.off += len(data)
        self.lag = st.st_size - self.off
        data = self.buf + data
        lines = data.split(b'\n')
        self.buf = lines.pop()
        if len(self.buf) > (1 << 20):           # a 1 MB line is not telemetry; drop it rather than grow
            self.buf = b''
        if skip_first and lines:
            lines.pop(0)
        return lines


def load_facts(facts_root, world, bot_names, cache):
    """world-facts for one world: the shared pool file, or every isolated bot's own file."""
    paths = [os.path.join(facts_root, '_pool-%s' % world, 'world-facts-%s.json' % world)]
    if not os.path.exists(paths[0]):
        paths = [os.path.join(facts_root, b, 'world-facts-%s.json' % b) for b in sorted(bot_names)]
    out, used = [], []
    for p in paths:
        try:
            mt = os.stat(p).st_mtime
        except OSError:
            continue
        hit = cache.get(p)
        if hit is None or hit[0] != mt:
            try:
                with open(p) as f:
                    hit = cache[p] = (mt, json.load(f))
            except (OSError, ValueError):
                continue
        out.append(hit[1])
        used.append(os.path.basename(p))
    return out, used


def snapshot_all(bots, worlds_ev, facts_root, now_ms, cfg, cache, mode):
    """{world: snapshot} from the current bounded state."""
    by_world = {}
    for st in bots.values():
        if st.world and st.full is not None:
            by_world.setdefault(st.world, []).append(st)
    out = {}
    for world, sts in sorted(by_world.items()):
        facts, used = load_facts(facts_root, world, [s.name for s in sts], cache)
        res = core.merge_resources(facts, now_ms, cfg)
        views = [core.bot_view(s, now_ms, cfg) for s in sts]
        bank = core.bank_view(worlds_ev.get(world), now_ms, cfg)
        out[world] = core.build_snapshot(world, views, res, now_ms, bank, cfg,
                                         meta={'facts_files': used, 'mode': mode})
    return out


def append(path, obj):
    with open(path, 'a') as f:
        f.write(json.dumps(obj, separators=(',', ':')) + '\n')


def write_state(path, state):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f)
    os.replace(tmp, path)


def emit(out_dir, snaps, states, cfg):
    n_assign = 0
    for world, snap in snaps.items():
        rec, states[world] = core.decide(snap, states.get(world), cfg)
        append(os.path.join(out_dir, 'snap-%s.jsonl' % world), snap)
        append(os.path.join(out_dir, 'assign-%s.jsonl' % world), rec)
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


def run_live(args):
    cfg = cfg_from(args)
    os.makedirs(args.out_dir, exist_ok=True)
    state_path = os.path.join(args.out_dir, 'mayor-state.json')
    try:
        with open(state_path) as f:
            states = json.load(f)
    except (OSError, ValueError):
        states = {}
    tails, bots, worlds_ev, cache = {}, {}, {}, {}
    while True:
        t0, c0 = time.time(), cpu_s()
        for p in glob.glob(args.logs):
            if p not in tails:
                tails[p] = Tail(p, args.bootstrap_bytes)
        nbytes, nrows, bad = 0, 0, 0
        for tail in tails.values():
            for line in tail.read(args.max_bytes_per_file):
                nbytes += len(line) + 1
                try:
                    row = json.loads(line)
                except ValueError:
                    bad += 1
                    continue
                if core.ingest(row, bots, worlds_ev):
                    nrows += 1
        now_ms = int(time.time() * 1000)
        if args.now_from_data:
            now_ms = max((b.last_ms for b in bots.values() if b.last_ms), default=now_ms)
        snaps = snapshot_all(bots, worlds_ev, args.facts_root, now_ms, cfg, cache, 'live')
        n_assign = emit(args.out_dir, snaps, states, cfg)
        write_state(state_path, states)
        tick = {'t': core.iso(now_ms), 'files': len(tails), 'bytes': nbytes, 'rows': nrows, 'bad_lines': bad,
                'bots': len(bots), 'worlds': len(snaps), 'assignments': n_assign,
                'lag_bytes': sum(t.lag for t in tails.values()), 'rotations': sum(t.rotations for t in tails.values()),
                'cpu_ms': round((cpu_s() - c0) * 1000), 'wall_ms': round((time.time() - t0) * 1000),
                'max_rss_mb': round(rss_mb(), 1)}
        append(os.path.join(args.out_dir, 'mayor-ticks.jsonl'), tick)
        print(json.dumps(tick), flush=True)
        if tick['max_rss_mb'] > args.max_rss_mb:
            print('max RSS %.0f MB > --max-rss-mb %d: exiting so the supervisor restarts a clean process'
                  % (tick['max_rss_mb'], args.max_rss_mb), file=sys.stderr)
            return 3
        if args.once:
            return 0
        time.sleep(max(1.0, args.interval - (time.time() - t0)))


def run_replay(args):
    """Step a virtual clock through COMPLETE files (rotated .gz included) and emit a snapshot every
    --interval. For dry runs and for back-filling the scorer. World facts are the CURRENT files, so a
    replayed snapshot can see sightings made after its own time; the snapshot's meta says so."""
    import gzip
    cfg = cfg_from(args)
    os.makedirs(args.out_dir, exist_ok=True)
    c0, t0 = cpu_s(), time.time()
    rows = []
    for p in sorted(glob.glob(args.logs)):
        op = gzip.open if p.endswith('.gz') else open
        with op(p, 'rt', errors='replace') as f:
            for line in f:
                # keep the raw line (parse at ingest): a slice of dicts costs ~10x its bytes
                i = line.find('"@timestamp":"')
                t = core.parse_ts(line[i + 14:line.find('"', i + 14)]) if i >= 0 else None
                if t is not None:
                    rows.append((t, len(rows), line))
    if not rows:
        print('replay: no rows matched %s' % args.logs, file=sys.stderr)
        return 2
    heapq.heapify(rows)
    first, last = rows[0][0], max(r[0] for r in rows)
    start = last - args.replay_minutes * 60000 if args.replay_minutes else first
    bots, worlds_ev, cache, states = {}, {}, {}, {}
    step = start + args.interval * 1000
    n_snap = 0
    while True:
        while rows and rows[0][0] <= step:
            try:
                core.ingest(json.loads(heapq.heappop(rows)[2]), bots, worlds_ev)
            except ValueError:
                pass
        if step >= start + args.warmup_s * 1000:
            snaps = snapshot_all(bots, worlds_ev, args.facts_root, step, cfg, cache, 'replay:facts are current files')
            emit(args.out_dir, snaps, states, cfg)
            n_snap += len(snaps)
        if step >= last:
            break
        step = min(last, step + args.interval * 1000)
    print(json.dumps({'replay_from': core.iso(start), 'to': core.iso(last), 'snapshots': n_snap,
                      'bots': len(bots), 'cpu_ms': round((cpu_s() - c0) * 1000),
                      'wall_ms': round((time.time() - t0) * 1000), 'max_rss_mb': round(rss_mb(), 1)}))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--logs', default='/var/log/mcai/*/skill-*.jsonl',
                    help='live: CURRENT files only (no .gz). replay: may include rotated .gz')
    ap.add_argument('--facts-root', default='/var/lib/mcai')
    ap.add_argument('--out-dir', default='/var/lib/mcai-mayor')
    ap.add_argument('--interval', type=int, default=300)
    ap.add_argument('--bootstrap-bytes', type=int, default=1 << 20, help='per file, at start-up')
    ap.add_argument('--max-bytes-per-file', type=int, default=16 << 20, help='per tick; the rest is read next tick')
    ap.add_argument('--max-rss-mb', type=int, default=400, help='exit 3 above this (let systemd restart)')
    ap.add_argument('--mem-limit-mb', type=int, default=768, help='RLIMIT_AS on Linux (0 = none)')
    ap.add_argument('--nice', type=int, default=10)
    ap.add_argument('--once', action='store_true', help='one tick, then exit')
    ap.add_argument('--now-from-data', action='store_true', help='clock = newest row (for copied slices)')
    ap.add_argument('--replay', action='store_true', help='virtual clock through whole files')
    ap.add_argument('--replay-minutes', type=int, default=0, help='replay only the last N minutes of data')
    ap.add_argument('--warmup-s', type=int, default=0, help='replay: no snapshot before this much data')
    ap.add_argument('--composter', action='store_true', help='FREE_BAG may compost (only once it ships)')
    args = ap.parse_args(argv)
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
