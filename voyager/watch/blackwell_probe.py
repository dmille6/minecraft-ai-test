#!/usr/bin/env python3
"""voyager-01 arm B-general on the Blackwell (owner 11-07 ~03:30Z: the already-loaded qwen2.5:32b, nothing loaded or unloaded): a latency probe of OUR OWN against the resident qwen2.5:32b as a
proxy for its other users, plus an eviction check. Read-only toward the other models except this one tiny request a minute,
sent with keep_alive -1 (the value it already has), so nothing about them changes.

  blackwell_probe.py baseline --minutes 20     before arm B
  blackwell_probe.py during --minutes 20 --baseline-p95 MS    with arm B: exit 3 if p95 > 1.25 x baseline or a pinned model is gone
Each minute also reads /api/ps and records the resident set.
"""
import json, sys, time, urllib.request

URL = 'http://ai.ticrcorp.com:11438'
def _opt(name, default, cast):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default
FACTOR = _opt('--factor', 1.25, float)      # owner 11-10: 1.5 x baseline is acceptable for their project
CONSEC = _opt('--consecutive', 1, int)      # minutes in a row over the limit before a trip
WINDOW = _opt('--window', 30, int)          # p95 over the last N readings (a rolling view, so a trip can clear)
breaches = 0
OURS = {'qwen3.8:27b', 'qwen3-coder:30b', 'devstral-small-2:24b', 'laguna-xs-2.1:latest'}   # stage 3 B + stage 4; all else = THEIRS
TARGET = 'qwen2.5:32b'              # the latency stand-in for their users; pinged ONLY while it is resident (a ping would load it)
LOG = '/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/voy/blackwell-probe.jsonl'


def ps():
    """{name: (context_length, size_vram, expires_forever)} of the resident models."""
    with urllib.request.urlopen(f'{URL}/api/ps', timeout=10) as r:
        return {m['name']: (m.get('context_length'), m.get('size_vram'), str(m.get('expires_at', ''))[:4] >= '2300') for m in json.load(r)['models']}


def ping():
    body = json.dumps({'model': 'qwen2.5:32b', 'prompt': 'Reply with the word ok.', 'stream': False, 'keep_alive': -1,
                       'options': {'num_predict': 4, 'temperature': 0, 'num_ctx': 8192}}).encode()   # = the loaded context: no reload
    t0 = time.time()
    with urllib.request.urlopen(urllib.request.Request(f'{URL}/api/generate', data=body, headers={'content-type': 'application/json'}), timeout=120) as r:
        d = json.load(r)
    return int((time.time() - t0) * 1000), int((d.get('load_duration') or 0) / 1e6)


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(0.95 * len(xs)))] if xs else None


def main():
    global breaches
    mode = sys.argv[1]
    minutes = int(sys.argv[sys.argv.index('--minutes') + 1]) if '--minutes' in sys.argv else 20
    base = int(sys.argv[sys.argv.index('--baseline-p95') + 1]) if '--baseline-p95' in sys.argv else None
    lat = []
    first = ps()
    PINNED = sorted(m for m in first if m not in OURS)
    print(json.dumps({'kind': 'watching', 'theirs': PINNED, 'ours': sorted(OURS)}), flush=True)
    fails = 0
    for i in range(minutes):
        # a network error is NOT a reading: retry next minute; 5 in a row stops arm B like a trip (11-09: the probe died on
        # one timeout at 11-07 19:23Z and arm B ran unguarded for ~30 h)
        try:
            res = ps()
        except Exception as e:
            fails += 1
            print(json.dumps({'kind': 'probe_error', 'i': i, 'error': str(e)[:120], 'consecutive': fails}), flush=True)
            if fails >= 5:
                print(json.dumps({'kind': 'abort', 'why': '5 consecutive probe errors'}), flush=True)
                sys.exit(3)
            time.sleep(60)
            continue
        fails = 0
        missing = [m for m in PINNED if m not in res]
        # expires_at moves on every use (now + forever), so the check is: still pinned forever, same context, same size
        changed = [m for m in PINNED if m in res and m in first and (res[m][0] != first[m][0] or res[m][1] != first[m][1] or not res[m][2])]
        if missing or changed:
            print(json.dumps({'kind': 'evicted_or_changed', 'missing': missing, 'changed': changed, 'before': first, 'now': res}), flush=True)
            sys.exit(3)
        if TARGET in res:
            try:
                ms, load = ping()
                lat.append(ms)
            except Exception as e:
                print(json.dumps({'kind': 'ping_error', 'i': i, 'error': str(e)[:120]}), flush=True)
                ms, load = 60_000, 0
                lat.append(ms)
        else:
            ms, load = 0, 0
        row = {'kind': mode, 'i': i, 't': time.strftime('%H:%M:%S', time.gmtime()), 'ms': ms, 'load_ms': load, 'resident': {k: v[:2] for k, v in res.items()}, 'p95': p95(lat)}
        open(LOG, 'a').write(json.dumps(row) + '\n')
        print(json.dumps(row), flush=True)
        over = mode == 'during' and base and len(lat) >= 5 and p95(lat[-WINDOW:]) > FACTOR * base
        breaches = breaches + 1 if over else 0
        if breaches >= CONSEC:
            print(json.dumps({'kind': 'abort', 'p95': p95(lat[-WINDOW:]), 'limit': FACTOR * base, 'consecutive': breaches}), flush=True)
            sys.exit(3)
        time.sleep(max(0, 60 - ms / 1000))   # one reading a minute
    print(json.dumps({'kind': f'{mode}_done', 'n': len(lat), 'p50': sorted(lat)[len(lat) // 2], 'p95': p95(lat)}), flush=True)


if __name__ == '__main__':
    main()
