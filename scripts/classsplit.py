#!/usr/bin/env python3
"""Failure-class histogram split CANARY vs CONTROL, using the typed vocabulary.

This read was impossible yesterday: the library indexed only event names, so every
fail_class question had to be answered by regexing prose. It is difference-in-differences
on the classes themselves -- not a verdict (the canary loop owns that), an independent
second pair of eyes on whether the change moves what it claims and nothing else.

Usage: MCAI_REPO=/opt/minecraft-ai python3 classsplit.py <pool,pool,...> [minutes]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from telemetry import Events   # noqa: E402

pools = set((sys.argv[1] if len(sys.argv) > 1 else '').split(','))
mins = int(sys.argv[2]) if len(sys.argv) > 2 else 60
if not pools or pools == {''}:
    print('need a comma-separated pool list'); sys.exit(2)

ev = Events.load(since_minutes=mins)
print(f"positive control: {len(ev.rows)} rows, {len(ev.bots())} bots, {mins} min")
print(f"versions: {ev.versions()}")

def arm(r):
    return 'canary' if (r['raw'].get('exp') or {}).get('pool') in pools else 'control'

cnt = {'canary': {}, 'control': {}}
runs = {'canary': 0, 'control': 0}
dep = {'canary': {'n': 0, 'ok': 0}, 'control': {'n': 0, 'ok': 0}}
for r in ev.rows:
    b = r['bot'].get('name', '')
    if not b or b.startswith('isolated') or b.startswith('self-isolated'):
        continue
    a = arm(r)
    n = str(r['name'])
    if not n.startswith('_'):
        runs[a] += 1
    if n == 'deposit':
        dep[a]['n'] += 1
        if (r.get('status') or '') == 'success':
            dep[a]['ok'] += 1
    fc = r.get('fail_class')
    if fc:
        cnt[a][str(fc).lower()] = cnt[a].get(str(fc).lower(), 0) + 1

print(f"\ndecisions: canary {runs['canary']}  control {runs['control']}")
for a in ('canary', 'control'):
    d = dep[a]
    pc = f"{100.0*d['ok']/d['n']:.1f}%" if d['n'] else '-'
    print(f"  {a:8s} deposit runs {d['n']:5d}  success {d['ok']:4d} ({pc})")

keys = sorted(set(cnt['canary']) | set(cnt['control']))
print(f"\n{'fail_class':28s} {'canary':>8s} {'/1k dec':>8s} {'control':>8s} {'/1k dec':>8s} {'DIFF/1k':>8s}")
rows = []
for k in keys:
    c, t = cnt['canary'].get(k, 0), cnt['control'].get(k, 0)
    cr = 1000.0 * c / runs['canary'] if runs['canary'] else 0
    tr = 1000.0 * t / runs['control'] if runs['control'] else 0
    rows.append((abs(cr - tr), k, c, cr, t, tr))
for _, k, c, cr, t, tr in sorted(rows, reverse=True)[:18]:
    print(f"{k:28s} {c:8d} {cr:8.1f} {t:8d} {tr:8.1f} {cr-tr:+8.1f}")
