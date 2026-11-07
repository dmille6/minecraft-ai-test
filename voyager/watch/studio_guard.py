#!/usr/bin/env python3
"""voyager-01 THE SHOWCASE GUARD (owner 11-07). The two local coder arms share the Studio GPU with the showcase brain.

Every minute: read the showcase brain's latency on the showcase VM (showcase_latency.py: llm.latency_ms > 0 over all
showcase bots), decide a level, and write it to the worlds host's /etc/voyager/guard.json, which the proxy reads every 15 s:
  level 0  normal
  level 1  backed off: the guarded arms wait 4x their duty gap between calls
  level 2  paused: the guarded arms get no model calls
Baseline (11-06 21:24 - 11-07 01:24Z, 4 h across the rotation, 2,943 timed calls, nothing of voyager's on the Studio GPU):
p50 2.26 s, p95 5.66 s. Threshold = baseline p95 x 1.10 = 6.22 s. (The 11-06 figure p95 4.1 s was a READ ERROR: its "3 h" window crossed the
23:59Z log rotation and saw only 9 minutes, 87 calls. Re-measured over the rotation-free hour before the run.)
Rolling window 20 min; under 5 timed calls it widens to 60 min (the showcase makes ~0.5 timed calls a minute).
Up: p95 over the threshold -> level 1; still over 3 checks later, or over 6 s -> level 2.
Down: one level after 10 consecutive checks at or under the baseline p95.
A guard that stops writing is treated by the proxy as level 1 after 5 min (fail safe).

  studio_guard.py run                  the loop (runs on the controller: two ssh calls a minute, nothing heavy)
  studio_guard.py probe --minutes 10   the pre-run probe: per-minute p95; exit 3 at the first minute over the threshold
  studio_guard.py selftest
"""
import datetime as dt
import json
import subprocess
import sys
import time

SHOWCASE = 'mike@10.0.0.40'
WORLDS = 'mike@10.0.0.30'
READER = '/tmp/showcase_latency.py'
BASE_P95, BASE_P50 = 5656, 2260
THRESH = int(BASE_P95 * 1.10)
HARD = 9000      # 1.5x the baseline p95: straight to a pause
LOG = '/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/voy/studio-guard.jsonl'


def now():
    return dt.datetime.now(dt.timezone.utc)


def read(minutes, by_minute=False):
    cmd = ['ssh', '-o', 'ConnectTimeout=10', SHOWCASE, f'nice python3 {READER} --minutes {minutes}' + (' --by-minute' if by_minute else '')]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120).stdout.strip().splitlines()
    head = json.loads(out[0])
    mins = [l.split() for l in out[1:]] if by_minute else []
    return head, mins


def decide(level, p95, n, over_streak, under_streak):
    """(new level, over_streak, under_streak, reason). Pure."""
    if p95 is None or n < 3:
        return level, over_streak, under_streak, f'too few showcase calls (n={n}); level held'
    if p95 > HARD:
        return 2, over_streak + 1, 0, f'p95 {p95} ms > {HARD} ms'
    if p95 > THRESH:
        over_streak += 1
        if level == 0:
            return 1, over_streak, 0, f'p95 {p95} ms > {THRESH} ms (baseline {BASE_P95} +10%)'
        if over_streak >= 3:
            return 2, over_streak, 0, f'p95 {p95} ms still > {THRESH} ms after backing off'
        return level, over_streak, 0, f'p95 {p95} ms > {THRESH} ms (backed off, watching)'
    if p95 <= BASE_P95:
        under_streak += 1
        if level > 0 and under_streak >= 10:
            return level - 1, 0, 0, f'p95 {p95} ms at or under baseline for 10 checks'
        return level, 0, under_streak, f'p95 {p95} ms ok'
    return level, 0, 0, f'p95 {p95} ms between baseline and threshold'


def write(level, reason, head):
    g = {'at': now().isoformat(), 'level': level, 'reason': reason, 'p95': head.get('p95'), 'p50': head.get('p50'), 'n': head.get('timed'),
         'window_since': head.get('since'), 'threshold_ms': THRESH}
    subprocess.run(['ssh', '-o', 'ConnectTimeout=10', WORLDS,
                    'sudo sh -c "cat > /etc/voyager/guard.json.new && chown root:voyager-proxy /etc/voyager/guard.json.new && chmod 0640 /etc/voyager/guard.json.new && mv /etc/voyager/guard.json.new /etc/voyager/guard.json"'],
                   input=json.dumps(g), text=True, timeout=60)
    return g


def log(o):
    with open(LOG, 'a') as f:
        f.write(json.dumps(o) + '\n')
    print(json.dumps(o), flush=True)


def run(until=None):
    level, over, under = 0, 0, 0
    while until is None or now() < until:
        try:
            head, _ = read(20)
            if (head.get('timed') or 0) < 5:
                head, _ = read(60)
            new, over, under, reason = decide(level, head.get('p95'), head.get('timed') or 0, over, under)
            g = write(new, reason, head)
            if new != level:
                log({'kind': 'guard_change', 'from': level, 'to': new, **g})
            else:
                log({'kind': 'guard_tick', **g})
            level = new
        except Exception as e:
            log({'kind': 'guard_error', 'at': now().isoformat(), 'error': str(e)[:200]})
        time.sleep(60)


def probe(minutes):
    """POOLED test (11-07): the showcase makes ~10 timed calls a minute, and at baseline 19 % of single minutes already
    have a p95 over the threshold, so the first probe's per-minute rule fired on its first (model-loading) minute. Here:
    abort when the p95 POOLED since the probe began is over the threshold after >= 3 min and >= 20 calls, or any single
    minute is over HARD."""
    t0 = time.time()
    t_end = t0 + minutes * 60
    while time.time() < t_end:
        time.sleep(60)
        elapsed = int((time.time() - t0) / 60) + 1
        head, mins = read(elapsed, by_minute=True)
        last = mins[-1] if mins else None
        log({'kind': 'probe_minute', 'at': now().isoformat(), 'pooled': head, 'last_minute': last})
        if last and int(last[2]) > HARD:
            log({'kind': 'probe_abort', 'at': now().isoformat(), 'why': f'minute p95 {last[2]} > {HARD}'})
            sys.exit(3)
        if elapsed >= 3 and (head.get('timed') or 0) >= 20 and (head.get('p95') or 0) > THRESH:
            log({'kind': 'probe_abort', 'at': now().isoformat(), 'why': f"pooled p95 {head['p95']} > {THRESH} over {head['timed']} calls"})
            sys.exit(3)
    log({'kind': 'probe_pass', 'at': now().isoformat(), 'minutes': minutes})


def selftest():
    T, B = THRESH, BASE_P95
    assert decide(0, B - 500, 10, 0, 0)[0] == 0
    assert decide(0, T + 100, 10, 0, 0)[0] == 1
    assert decide(1, T + 100, 10, 1, 0)[0] == 1
    assert decide(1, T + 100, 10, 2, 0)[0] == 2
    assert decide(0, HARD + 1, 10, 0, 0)[0] == 2
    assert decide(1, B - 100, 10, 0, 9)[0] == 0
    assert decide(1, B - 100, 10, 0, 3)[0] == 1
    assert decide(1, (B + T) // 2, 10, 0, 0)[0] == 1          # between baseline and threshold: hold
    assert decide(2, None, 0, 0, 0)[0] == 2                    # no data: hold
    print('studio_guard selftest: 9 checks passed')


if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else 'selftest'
    if c == 'run':
        u = sys.argv[sys.argv.index('--until') + 1] if '--until' in sys.argv else None
        run(dt.datetime.fromisoformat(u.replace('Z', '+00:00')) if u else None)
    elif c == 'probe':
        probe(int(sys.argv[sys.argv.index('--minutes') + 1]) if '--minutes' in sys.argv else 10)
    else:
        selftest()
