#!/usr/bin/env python3
"""Watch the Studio's shared load while a bench job runs; kill the job on a hard stop. Python 3.9+, stdlib only.

    python3 studio_guard.py --pid <shim pid> [--also-pid <engine pid>] [--log guard.jsonl]
    python3 studio_guard.py --once            # print one sample (baseline)

Every --every s: memory_pressure's free %, and the showcase proxy's (~/showcase/proxy.jsonl) last-5-min decisions
(count, p50/p95 ms) plus every decision SINCE THE GUARD STARTED that was non-200 or not served by the primary
(gemma4) path -- the proxy's timeouts and errors land there as a fallback or a non-200. HARD STOPS (owner 10-29;
showcase slowness itself is accepted for the run):
  - memory free % < --min-free (35)
  - any showcase decision since start that fell back off the primary or was not 200 (--max-bad 0)
  - the 5-min p95 > --p95-ms (30 s) continuously for --sustain-s (300 s)
  - two samples running fail (fail safe: a guard that cannot see is not a guard)
A kill is SIGTERM, then SIGKILL, to --pid and each --also-pid, each only while it still runs the same command line.
Bot counts and deaths come from fleetstatus on 10.0.0.31, which the Studio cannot reach: fleet_watch.sh on the
controller polls those. This script only reads; it never touches the proxy, LM Studio or Ollama.
"""
import argparse, json, os, re, signal, subprocess, sys, time
from datetime import datetime, timezone, timedelta

PROXY = os.environ.get('GUARD_PROXY') or os.path.expanduser('~/showcase/proxy.jsonl')  # override: tests


def free_pct():
    out = subprocess.run(['memory_pressure'], capture_output=True, text=True, timeout=30).stdout
    m = re.search(r'free percentage: (\d+)%', out)
    return int(m.group(1)) if m else None


def proxy_window(minutes=5, path=PROXY, since=None):
    """The last `minutes` of decisions (n, p50, p95); non200 / non_primary count decisions at or after `since`."""
    cut = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    with open(path, 'rb') as fh:
        fh.seek(0, 2); size = fh.tell(); off = max(0, size - 4_000_000); fh.seek(off)
        lines = fh.read().decode('utf-8', 'replace').splitlines()
    if off > 0:
        lines = lines[1:]  # a partial first line only when the read starts mid-file
    ms, bad, fb = [], 0, 0
    for l in lines:
        try:
            r = json.loads(l)
            t = datetime.strptime(r['t'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if since is not None and t >= since:
            bad += r.get('status') != 200
            fb += r.get('path') != 'primary'
        if t < cut:
            continue
        if r.get('ms') is not None:
            ms.append(r['ms'])
    ms.sort()
    q = lambda p: ms[min(len(ms) - 1, int(p * (len(ms) - 1) + 0.5))] if ms else None
    return {'n': len(ms), 'p50': q(0.5), 'p95': q(0.95), 'non200': bad, 'non_primary': fb}


def sample(minutes=5, since=None):
    return dict(t=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), free=free_pct(),
                **proxy_window(minutes, since=since))


def cmdline(pid):
    r = subprocess.run(['ps', '-o', 'command=', '-p', str(pid)], capture_output=True, text=True, timeout=10)
    return r.stdout.strip() or None


def kill_job(pid, cmd):
    """SIGTERM, wait up to 10 s, SIGKILL -- each signal only while the pid still runs the SAME command."""
    if cmdline(pid) != cmd:
        return
    os.kill(pid, signal.SIGTERM)
    for _ in range(20):
        time.sleep(0.5)
        if cmdline(pid) != cmd:
            return
    os.kill(pid, signal.SIGKILL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pid', type=int)
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--minutes', type=int, default=5)
    ap.add_argument('--log')
    ap.add_argument('--every', type=int, default=30)
    ap.add_argument('--min-free', type=int, default=35)
    ap.add_argument('--also-pid', type=int, action='append', default=[])
    ap.add_argument('--p95-ms', type=int, default=30000)
    ap.add_argument('--sustain-s', type=int, default=300)
    ap.add_argument('--max-bad', type=int, default=0)
    a = ap.parse_args()
    if a.once:
        print(json.dumps(sample(a.minutes))); return
    errs, slow_since = 0, None
    since = datetime.now(timezone.utc).replace(microsecond=0)
    cmd = cmdline(a.pid)
    if not cmd:
        print('no such pid', file=sys.stderr); return
    also = [(p, cmdline(p)) for p in a.also_pid]
    while True:
        if cmdline(a.pid) != cmd:
            print('job gone', file=sys.stderr); return
        try:
            s = sample(a.minutes, since)
            if s['free'] is None:
                raise RuntimeError('memory_pressure gave no free percentage')
            errs = 0
        except Exception as e:  # fail safe: a guard that cannot see is not a guard
            errs += 1
            s = {'t': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'error': str(e)[:200], 'free': None,
                 'n': 0, 'p50': None, 'p95': None, 'non200': 0, 'non_primary': 0}
        now = time.time()
        if s['p95'] is not None and s['p95'] > a.p95_ms:
            slow_since = slow_since or now
        elif s.get('error') is None:
            slow_since = None
        why = None
        if s['free'] is not None and s['free'] < a.min_free:
            why = 'free %s%% < %d' % (s['free'], a.min_free)
        elif s['non200'] + s['non_primary'] > a.max_bad:
            why = 'showcase decisions since start: %d non-200, %d off the primary' % (s['non200'], s['non_primary'])
        elif slow_since is not None and now - slow_since >= a.sustain_s:
            why = 'showcase p95 > %d ms for %d s' % (a.p95_ms, now - slow_since)
        elif errs >= 2:
            why = 'sampling failed twice: %s' % s.get('error')
        s['kill'] = why
        try:
            if a.log:
                with open(a.log, 'a') as fh:
                    fh.write(json.dumps(s) + '\n')
        except Exception:
            pass  # a log write never stands between a trip and the kill
        if why:
            print('KILL %d: %s' % (a.pid, why), file=sys.stderr)
            for p, c in [(a.pid, cmd)] + also:
                kill_job(p, c)
            return
        time.sleep(a.every)


if __name__ == '__main__':
    main()
