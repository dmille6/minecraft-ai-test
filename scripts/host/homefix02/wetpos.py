#!/usr/bin/env python3
"""homefix-01 window: where watchdog rescues ended (canary vs control), and where bots stand in general.
Output: JSON lines on stdout (kind=rescue|ambient|summary). Files only (lib/telemetry.py), full walk."""
import sys, json, datetime as dt, collections
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events

SINCE = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
UNTIL = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00'))
CANARY = set(sys.argv[3].split(','))
ev = Events.load(since=SINCE, until=UNTIL)
rows = ev.rows
print(json.dumps({'kind': 'walk', 'rows': len(rows), 'bots': len({r['bot'].get('name') for r in rows if r['bot'].get('name')})}), flush=True)

WATER = {'_water_float', '_water_surface', '_water_no_air_route', '_air_drowning_observed', '_oxygen_critical_state',
         '_drowning_route', '_reflex_drowning', '_drowning_ceiling_no_air'}
DROWN = {'_air_drowning_observed', '_oxygen_critical_state', '_drowning_route', '_reflex_drowning', '_drowning_ceiling_no_air'}
by_bot = collections.defaultdict(list)
for r in rows:
    raw = r['raw']; b = (raw.get('bot') or {}).get('name')
    if b: by_bot[b].append(r)
for b in by_bot: by_bot[b].sort(key=lambda r: r['t'])

def pool(raw):
    return (raw.get('exp') or {}).get('pool') or ''

def ver(raw):
    return ((raw.get('code') or {}).get('version') or '')[:8]

def after(b, t0, secs, names):
    out = collections.Counter()
    for r in by_bot[b]:
        if r['t'] < t0: continue
        if (r['t'] - t0).total_seconds() > secs: break
        if r['name'] in names: out[r['name']] += 1
    return out

def end_time(r):
    d = (r['raw'].get('skill') or {}).get('duration_ms') or 0
    return r['t'] + dt.timedelta(milliseconds=d)

deaths = []
for b, L in by_bot.items():
    for r in L:
        raw = r['raw']; n = r['name']; trig = raw.get('trigger') or ''; p = (raw.get('bot') or {}).get('pos')
        arm = 'canary' if pool(raw) in CANARY else 'control'
        if n == '_death':
            deaths.append({'bot': b, 't': r['t'].isoformat(), 'pos': p, 'detail': r['detail'][:120], 'arm': arm})
        # SKILL rows of a watchdog rescue that ended uninterrupted (both arms log these the same way)
        if n in ('goto', 'home') and trig in ('watchdog_relocate', 'watchdog_home'):
            te = end_time(r)
            a = after(b, te, 120, WATER)
            args = (raw.get('skill') or {}).get('args') or {}
            print(json.dumps({'kind': 'rescue', 'src': 'skill_row', 'arm': arm, 'pool': pool(raw), 'bot': b, 'v': ver(raw),
                              'skill': n, 'trigger': trig, 'status': r['status'], 'fail_class': r['fail_class'],
                              't': r['t'].isoformat(), 'end': te.isoformat(), 'pos': p, 'target': args or None,
                              'detail': r['detail'][:100], 'water120': sum(a.values()), 'drown120': sum(a[k] for k in DROWN)}))
        # canary terminal rows (cover interrupted rescues, whose skill row trigger is overwritten)
        if n == '_watchdog_rescue':
            args = (raw.get('skill') or {}).get('args') or {}
            ph = args.get('phase') or ''
            if ph.startswith(('completed:', 'interrupted:')):
                a = after(b, r['t'], 120, WATER)
                print(json.dumps({'kind': 'rescue', 'src': 'terminal', 'arm': arm, 'pool': pool(raw), 'bot': b, 'v': ver(raw),
                                  'skill': args.get('skill'), 'level': args.get('level'), 'phase': ph,
                                  't': r['t'].isoformat(), 'pos': p, 'water120': sum(a.values()), 'drown120': sum(a[k] for k in DROWN)}))
    # AMBIENT: one position per bot per 5 min, from rows that carry a position
    last = None
    for r in L:
        p = (r['raw'].get('bot') or {}).get('pos')
        if not p or 'x' not in p: continue
        if last is None or (r['t'] - last).total_seconds() >= 300:
            last = r['t']
            a = after(b, r['t'], 120, WATER)
            print(json.dumps({'kind': 'ambient', 'arm': 'canary' if pool(r['raw']) in CANARY else 'control', 'pool': pool(r['raw']),
                              'bot': b, 'v': ver(r['raw']), 't': r['t'].isoformat(), 'pos': p,
                              'water120': sum(a.values()), 'drown120': sum(a[k] for k in DROWN)}))
print(json.dumps({'kind': 'deaths', 'deaths': deaths}))
stag = collections.Counter()
for r in rows:
    if r['name'] == '_stagnation':
        e = ((r['raw'].get('skill') or {}).get('args') or {}).get('escalation')
        if e is None:
            import re
            m = re.search(r'escalation (\d+)', r['detail']); e = int(m.group(1)) if m else None
        stag[('canary' if pool(r['raw']) in CANARY else 'control', e)] += 1
print(json.dumps({'kind': 'summary', 'stagnation_by_arm_level': {f'{k[0]}:{k[1]}': v for k, v in stag.items()}}))
