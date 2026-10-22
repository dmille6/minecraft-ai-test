#!/usr/bin/env python3
"""Positions at each stagnation verdict (level 1/2, both arms) and each canary `_watchdog_rescue requested` row."""
import sys, json, re, datetime as dt
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events
SINCE = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
UNTIL = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
CANARY = set(sys.argv[3].split(','))
ev = Events.load(since=SINCE, until=UNTIL)
n = 0
for r in ev.rows:
    raw = r['raw']; name = r['name']
    if name not in ('_stagnation', '_watchdog_rescue'): continue
    args = (raw.get('skill') or {}).get('args') or {}
    pool = (raw.get('exp') or {}).get('pool') or ''
    if name == '_stagnation':
        lv = args.get('escalation')
        if lv is None:
            m = re.search(r'escalation (\d+)', r['detail']); lv = int(m.group(1)) if m else None
        kind = 'verdict'
    else:
        if args.get('phase') != 'requested': continue
        lv = args.get('level'); kind = 'requested'
    p = (raw.get('bot') or {}).get('pos')
    if not p: continue
    n += 1
    print(json.dumps({'id': f's{n}', 'kind': kind, 'level': lv, 'remedy': args.get('remedy'), 'arm': 'canary' if pool in CANARY else 'control',
                      'pool': pool, 'bot': (raw.get('bot') or {}).get('name'), 't': r['t'].isoformat(), 'pos': p}))
