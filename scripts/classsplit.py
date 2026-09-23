#!/usr/bin/env python3
"""Failure-class rates, CANARY vs CONTROL, before and after a declared_at.

CORRECTED after an independent review: the first version called itself
difference-in-differences and computed a single-window canary-minus-control rate. That is a
CROSS-SECTION, which CLAUDE.md forbids by name -- "Canary results are
difference-in-differences, never canary-vs-fleet. A good deploy was rolled back once on
cross-sectional noise, because the pool happened to contain two chronic emitters." I then
used it to read a live canary. It now takes declared_at and computes a real DiD:

    (canary_post - canary_pre) - (control_post - control_pre)

and prints all four cells, so the reader can see a parallel-trends violation rather than
trusting one differenced number.

This is still NOT a verdict -- the canary loop owns that. It is a second pair of eyes.

Usage: MCAI_REPO=/opt/minecraft-ai python3 classsplit.py <pools> <declared_at_iso> [minutes_each_side]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from telemetry import Events   # noqa: E402

import datetime

pools = set((sys.argv[1] if len(sys.argv) > 1 else '').split(','))
if not pools or pools == {''}:
    print('need a comma-separated pool list'); sys.exit(2)
if len(sys.argv) < 3:
    print('need declared_at (ISO, e.g. 2026-09-23T12:10:07Z) -- a DiD needs a pre-period')
    sys.exit(2)
declared = datetime.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
mins = int(sys.argv[3]) if len(sys.argv) > 3 else 60

now = datetime.datetime.now(datetime.timezone.utc)
span_needed = (now - declared).total_seconds() / 60.0 + mins + 5
ev = Events.load(since_minutes=int(span_needed))
print(f"positive control: {len(ev.rows)} rows, {len(ev.bots())} bots, {mins} min")
print(f"versions: {ev.versions()}")

def arm(r):
    return 'canary' if (r['raw'].get('exp') or {}).get('pool') in pools else 'control'

def era(r):
    return 'post' if r['t'] >= declared else 'pre'

cnt = {('canary', 'pre'): {}, ('canary', 'post'): {},
       ('control', 'pre'): {}, ('control', 'post'): {}}
runs = {('canary', 'pre'): 0, ('canary', 'post'): 0,
        ('control', 'pre'): 0, ('control', 'post'): 0}
dep = {('canary','pre'):{'n':0,'ok':0}, ('canary','post'):{'n':0,'ok':0},
       ('control','pre'):{'n':0,'ok':0}, ('control','post'):{'n':0,'ok':0}}
lo = declared - datetime.timedelta(minutes=mins)
hi = declared + datetime.timedelta(minutes=mins)
for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated') or b.startswith('self-isolated'):
        continue
    if r['t'] < lo or r['t'] > hi:
        continue                      # SYMMETRIC windows, or pre and post are not comparable
    cell = (arm(r), era(r))
    n = str(r['name'])
    if not n.startswith('_'):
        runs[cell] += 1
    if n == 'deposit':
        dep[cell]['n'] += 1
        if (r.get('status') or '') == 'success':
            dep[cell]['ok'] += 1
    fc = r.get('fail_class')
    if fc:
        k2 = str(fc).lower()
        cnt[cell][k2] = cnt[cell].get(k2, 0) + 1

print(f"declared_at {declared.isoformat()}  +/- {mins} min (symmetric)")
print(f"{'cell':16s} {'decisions':>10s} {'deposit runs':>13s} {'deposit ok':>11s}")
for cell in (('canary','pre'),('canary','post'),('control','pre'),('control','post')):
    d = dep[cell]
    pc = f"{100.0*d['ok']/d['n']:.1f}%" if d['n'] else '-'
    print(f"{cell[0]+'/'+cell[1]:16s} {runs[cell]:10d} {d['n']:13d} {d['ok']:5d} {pc:>5s}")

if min(runs.values()) == 0:
    print("\n  A CELL IS EMPTY -- a DiD needs all four. Widen the window or check the pools.")
    sys.exit(1)

def rate(cell, k):
    return 1000.0 * cnt[cell].get(k, 0) / runs[cell]

keys = sorted({k for c in cnt.values() for k in c})
print(f"\nper 1,000 decisions. DiD = (canary post-pre) - (control post-pre)")
print(f"{'fail_class':26s} {'can pre':>8s} {'can post':>9s} {'ctl pre':>8s} {'ctl post':>9s} {'DiD':>8s}")
rows = []
for k in keys:
    cp, cq = rate(('canary','pre'), k), rate(('canary','post'), k)
    tp, tq = rate(('control','pre'), k), rate(('control','post'), k)
    did = (cq - cp) - (tq - tp)
    rows.append((abs(did), k, cp, cq, tp, tq, did))
for _, k, cp, cq, tp, tq, did in sorted(rows, reverse=True)[:16]:
    print(f"{k:26s} {cp:8.1f} {cq:9.1f} {tp:8.1f} {tq:9.1f} {did:+8.1f}")
print("\n  Read the PRE columns first: if canary-pre and control-pre already differ a lot,")
print("  parallel trends is violated and the DiD is not interpretable, however big it is.")
