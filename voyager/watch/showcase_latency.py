#!/usr/bin/env python3
"""voyager-01 §6.3: the showcase brain's latency (read-only, on the showcase VM). Arm B shares its GPU.

  showcase_latency.py --minutes 180            baseline: n, p50, p95 of llm.latency_ms (>0) over all showcase bots
  showcase_latency.py --minutes 10 --by-minute  per-minute p95 (the probe's abort test)
Full walk of the current files (+ .1 rotation is not needed for windows under a day after 00:00Z).
"""
import argparse, datetime as dt, glob, json, collections

ap = argparse.ArgumentParser()
ap.add_argument('--minutes', type=int, default=180)
ap.add_argument('--by-minute', action='store_true')
a = ap.parse_args()
since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=a.minutes)
lat, per = [], collections.defaultdict(list)
rows = 0
for p in glob.glob('/var/log/mcai/showcase-*/llm-*.jsonl'):
    with open(p, 'rb') as f:
        for line in f:
            if b'latency_ms' not in line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            t = dt.datetime.fromisoformat(str(r.get('@timestamp')).replace('Z', '+00:00'))
            if t < since:
                continue
            rows += 1
            ms = (r.get('llm') or {}).get('latency_ms') or 0
            if ms > 0:
                lat.append(ms)
                per[t.strftime('%H:%M')].append(ms)
q = lambda xs, f: sorted(xs)[min(len(xs) - 1, int(f * len(xs)))] if xs else None
print(json.dumps({'since': since.isoformat()[:16], 'rows': rows, 'timed': len(lat), 'p50': q(lat, .5), 'p95': q(lat, .95)}))
if a.by_minute:
    for m in sorted(per):
        print(m, len(per[m]), q(per[m], .95))
