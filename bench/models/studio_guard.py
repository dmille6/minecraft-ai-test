#!/usr/bin/env python3
"""Watch the Studio's shared load while a bench job runs; kill the job on pressure. Python 3.9+, stdlib only.

    python3 studio_guard.py --pid <bench pid> [--log guard.jsonl] [--min-free 35] [--p95-ms 6750] [--p50-ms 3150]
    python3 studio_guard.py --once            # print one sample (baseline)

Every --every s: memory_pressure's free %, and the showcase proxy's (~/showcase/proxy.jsonl) last-5-min decisions:
count, p50/p95 ms, non-200 count, fallback count. It KILLS --pid (SIGTERM, then SIGKILL) when free % < --min-free, or
when two samples running fail (fail safe), or when the 5-min p95 > --p95-ms or p50 > --p50-ms (defaults: 1.5x the 10-29 05Z baseline 2.1/4.5 s) on >= 10 decisions for two samples running. It only reads; it never touches the
proxy, LM Studio or Ollama.
"""
import argparse, json, os, re, signal, subprocess, sys, time
from datetime import datetime, timezone, timedelta

PROXY = os.path.expanduser('~/showcase/proxy.jsonl')


def free_pct():
    out = subprocess.run(['memory_pressure'], capture_output=True, text=True, timeout=30).stdout
    m = re.search(r'free percentage: (\d+)%', out)
    return int(m.group(1)) if m else None


def proxy_window(minutes=5, path=PROXY):
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
        if t < cut:
            continue
        if r.get('status') != 200:
            bad += 1
        if r.get('path') != 'primary':
            fb += 1
        if r.get('ms') is not None:
            ms.append(r['ms'])
    ms.sort()
    q = lambda p: ms[min(len(ms) - 1, int(p * (len(ms) - 1) + 0.5))] if ms else None
    return {'n': len(ms), 'p50': q(0.5), 'p95': q(0.95), 'non200': bad, 'non_primary': fb}


def sample(minutes=5):
    return dict(t=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), free=free_pct(), **proxy_window(minutes))


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
    ap.add_argument('--p95-ms', type=int, default=6750)
    ap.add_argument('--p50-ms', type=int, default=3150)
    a = ap.parse_args()
    if a.once:
        print(json.dumps(sample(a.minutes))); return
    slow = errs = 0
    cmd = cmdline(a.pid)
    if not cmd:
        print('no such pid', file=sys.stderr); return
    while True:
        if cmdline(a.pid) != cmd:
            print('job gone', file=sys.stderr); return
        try:
            s = sample(a.minutes)
            if s['free'] is None:
                raise RuntimeError('memory_pressure gave no free percentage')
            errs = 0
        except Exception as e:  # fail safe: a guard that cannot see is not a guard
            errs += 1
            s = {'t': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'error': str(e)[:200], 'free': None,
                 'n': 0, 'p50': None, 'p95': None}
        slow = slow + 1 if (s['n'] >= 10 and ((s['p95'] or 0) > a.p95_ms or (s['p50'] or 0) > a.p50_ms)) else 0
        why = 'free %s%% < %d' % (s['free'], a.min_free) if (s['free'] is not None and s['free'] < a.min_free) else (
            'showcase p50/p95 %s/%s ms > %d/%d twice' % (s['p50'], s['p95'], a.p50_ms, a.p95_ms) if slow >= 2 else (
            'sampling failed twice: %s' % s.get('error') if errs >= 2 else None))
        s['kill'] = why
        try:
            if a.log:
                with open(a.log, 'a') as fh:
                    fh.write(json.dumps(s) + '\n')
        except Exception:
            pass  # a log write never stands between a trip and the kill
        if why:
            print('KILL %d: %s' % (a.pid, why), file=sys.stderr)
            kill_job(a.pid, cmd)
            return
        time.sleep(a.every)


if __name__ == '__main__':
    main()
