#!/usr/bin/env python3
"""INSTRUMENT HEALTH: which of this build's failure classes actually fire, and which are
silent code paths. Run it before trusting any zero.

A silent instrument is not a fleet fact, it is an unfalsifiable reading. This report is
the positive control for every `count_class` in every other script.

Usage: MCAI_REPO=/opt/minecraft-ai python3 instruments.py [minutes]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from telemetry import Events          # noqa: E402
import vocabulary                     # noqa: E402

mins = int(sys.argv[1]) if len(sys.argv) > 1 else 180
repo = os.environ.get('MCAI_REPO', '/opt/minecraft-ai')

ev = Events.load(since_minutes=mins)
print(f"positive control: {len(ev.rows)} rows, {len(ev.bots())} bots, {mins} min window")
vs = ev.versions()
print(f"versions in window: {', '.join(f'{k} ({n})' for k, n in sorted(vs.items(), key=lambda x: -x[1]))}")
live = [v for v in vs if v and v != '?']
if len(live) != 1:
    print("  !! more than one build in this window -- a silent-instrument report is per build")
    sys.exit(2)

seen = {k: n for n, k in ev.classes()}
vocab = vocabulary.extract(repo, live[0])
can = vocab['fail_class']

print(f"\nthis build can emit {len(can)} fail_class values; {len(seen)} of them fired\n")
print(f"  {'rows':>7s}  fail_class")
for n, k in ev.classes():
    print(f"  {n:7d}  {k}")

silent = sorted(can - set(seen))
print(f"\n=== SILENT: {len(silent)} live code paths that fired ZERO times ===")
print("    (a query for any of these must not be read as 'it does not happen')")
for k in silent:
    print(f"    {k}")

unknown = sorted(set(seen) - can)
if unknown:
    print(f"\n=== UNEXPLAINED: {len(unknown)} classes in the data that this build's source does not contain ===")
    print("    (a build/registry mismatch -- the read may be spanning an upgrade)")
    for k in unknown:
        print(f"    {k}  ({seen[k]} rows)")

kinds = set()
for r in ev.rows:
    kinds.add(str(r['name']))
silent_kinds = sorted({('_' + k) for k in vocab['kind']} - kinds)
print(f"\n=== event KINDS the build declares but never emitted: {len(silent_kinds)} ===")
for k in silent_kinds[:25]:
    print(f"    {k}")
if len(silent_kinds) > 25:
    print(f"    ... and {len(silent_kinds)-25} more")
