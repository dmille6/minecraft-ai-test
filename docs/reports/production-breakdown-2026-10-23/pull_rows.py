"""Pull compact rows of the production, travel and reflex skills from ES, one UTC day at a time,
into out/rows/<day>.jsonl.gz. Read-only (ES read-only key). Run with nice -n 19.

Every kind's row count is checked against the server-side count of the same window (rows()
already raises if the stream and its PIT count disagree); the per-kind totals are written to
out/rows/<day>.counts.json as the positive control for any later absence.

    python3 pull_rows.py 2026-10-08 2026-10-23
"""
import sys, os, json, gzip, datetime as dt
sys.path.insert(0, '/home/mike/estel/scripts')
from lib.estelemetry import EsEvents

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'rows')
os.makedirs(OUT, exist_ok=True)

KINDS = ['gather', 'mine', 'craft', 'town_deposit', 'deposit', 'explore', 'goto', 'home', 'surface',
         'smelt', 'smelt_town', 'furnace_drain', 'toolkit', 'withdraw_pick', 'withdraw', 'dispose_well',
         'compost', 'place', 'keepout_exit', 'wear_out', 'board',
         '_water_float_ended', '_water_surface_ended', '_water_no_air_route_ended', '_water_surface_out_ended',
         '_redundant_craft', '_death', '_entombed', '_marooned', '_stagnation', '_livelock_escape',
         '_loop_restart', '_watchdog_rescue', '_keepout', '_protect_zone', '_stranded_escape_try']
FIELDS = ['@timestamp', 'bot.name', 'bot.pos', 'exp.pool', 'skill.name', 'skill.status', 'skill.fail_class',
          'skill.detail', 'skill.args', 'skill.duration_ms', 'skill.distance_moved', 'skill.inventory_delta',
          'trigger', 'code.version', 'game.tick']


def compact(r):
    s = r.get('skill') or {}
    b = r.get('bot') or {}
    p = b.get('pos') or {}
    a = s.get('args') or {}
    # keep only small scalar args (block/item/y/count/level/remedy/phase/...)
    a = {k: v for k, v in a.items() if isinstance(v, (int, float, str)) and len(str(v)) < 60}
    return {'t': r.get('@timestamp'), 'b': b.get('name'), 'p': (r.get('exp') or {}).get('pool'),
            'k': s.get('name'), 's': s.get('status'), 'fc': s.get('fail_class'),
            'd': (s.get('detail') or '')[:240], 'a': a, 'ms': s.get('duration_ms'),
            'mv': s.get('distance_moved'), 'inv': s.get('inventory_delta') or None,
            'x': p.get('x'), 'y': p.get('y'), 'z': p.get('z'), 'tr': r.get('trigger'),
            'v': ((r.get('code') or {}).get('version') or '')[:8], 'tick': (r.get('game') or {}).get('tick')}


def days(a, b):
    d = dt.date.fromisoformat(a)
    while d <= dt.date.fromisoformat(b):
        yield d
        d += dt.timedelta(days=1)


start, end = sys.argv[1], sys.argv[2]
for d in days(start, end):
    s = f'{d}T00:00:00Z'
    u = f'{d + dt.timedelta(days=1)}T00:00:00Z'
    now = dt.datetime.now(dt.timezone.utc)
    if dt.datetime.fromisoformat(u.replace('Z', '+00:00')) > now:
        u = (now - dt.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    path = os.path.join(OUT, f'{d}.jsonl.gz')
    if os.path.exists(path) and str(d) != str(now.date()):
        print(d, 'exists, skipped', flush=True)
        continue
    ev = EsEvents.load('skill', since=s, until=u)
    counts = {'window': [s, u], 'caveats': ev.caveats, 'kinds': {}}
    tmp = path + '.tmp'
    with gzip.open(tmp, 'wt') as f:
        for k in KINDS:
            n = 0
            for r in ev.rows(k, fields=FIELDS, max_rows=600_000, allow_zero=True):
                f.write(json.dumps(compact(r), separators=(',', ':')) + '\n')
                n += 1
            counts['kinds'][k] = n
    os.replace(tmp, path)
    with open(os.path.join(OUT, f'{d}.counts.json'), 'w') as f:
        json.dump(counts, f, indent=1)
    print(d, sum(counts['kinds'].values()), 'rows', flush=True)
