#!/usr/bin/env python3
"""lavasight-01 population: would the per-seed hazard map have known the lava a guard refused?

Read-only. Run on 10.0.0.31 at nice 19:
    nice -n 19 python3 -B scripts/host/lavasight_population.py [--map ~/hazardmap/out/hazardmap.json]

OUT-OF-SAMPLE BY CONSTRUCTION: only rows AFTER the map's own `window.until` are judged, so no judged row is evidence the
map was built from. A row is a guard refusal that NAMED a lava cell (`_lava_corridor`, `_explore_blind_step_refused` with
"lava", `_reflex_danger_block`); the cell is parsed from `at X,Y,Z`. For each, in the row's world (exp.pool):
  map    -- some map cell of that world's seed (lava hazards not `absent` in the world; sightings.cells + deaths.cells)
            within Chebyshev 1 of the named cell (also reported at 0 and 2);
  own    -- the SAME bot named a lava cell within Chebyshev 1 in the 60 min before (the in-process ring's coverage);
  either -- map or own.
Positive controls: the totals of rows walked, bots and the span; the parse rate of the refusal rows; the map's cell count
per world. A zero here raises (lib.telemetry ZeroLooksWrong) unless the totals prove the query sees rows.
"""
import argparse, datetime, json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lib.telemetry import Events  # noqa: E402

AT = re.compile(r'at (-?\d+),(-?\d+),(-?\d+)')
KINDS = ('lava_corridor', 'explore_blind_step_refused', 'reflex_danger_block')


def world_cells(m, world):
    """The per-world view of section 7 of the hazardmap report: lava hazards of the world's seed, not absent in it."""
    for seed, s in m['seeds'].items():
        if world in s.get('worlds', {}):
            out = set()
            for h in s['hazards']:
                if h['kind'] != 'lava':
                    continue
                st = ((h.get('exists') or {}).get('by_world') or {}).get(world, {}).get('state')
                if st == 'absent':
                    continue
                for c in (h.get('sightings') or {}).get('cells') or []:
                    out.add((c[0], c[1], c[2]))
                for c in (h.get('deaths') or {}).get('cells') or []:
                    out.add((c[0], c[1], c[2]))
            return seed, out
    return None, set()


def near(cells, c, r):
    x, y, z = c
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            for dz in range(-r, r + 1):
                if (x + dx, y + dy, z + dz) in cells:
                    return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map', default=os.path.expanduser('~/hazardmap/out/hazardmap.json'))
    a = ap.parse_args()
    m = json.load(open(a.map))
    until = datetime.datetime.fromisoformat(m['window']['until'].replace('Z', '+00:00'))
    now = datetime.datetime.now(datetime.timezone.utc)
    since_min = int((now - until).total_seconds() / 60) + 61
    # THE LIVE FILES ONLY: the window starts after the map's until (today), and logs rotate ~23:59Z, so every row in the
    # window is in a live file (the rotated set would trip the walk-size cap; reads-must-load-rotated-logs applies to a
    # window that crosses a rotation, which this refuses below).
    if until.date() != now.date():
        raise SystemExit('the window crosses a log rotation: load the rotated files too')
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=since_min)
    print(f"map generated {m['generated_at']} until {m['window']['until']}; walked {len(ev.rows)} rows, "
          f"{len({(r['bot'] or {}).get('name') for r in ev.rows})} bots, span {ev.span:.2f} h")
    cells_by_world, seed_of = {}, {}
    rows = []
    for k in KINDS:
        for r in ev.of(k):
            d = r['detail']
            if k == 'explore_blind_step_refused' and 'lava' not in d:
                continue
            if k == 'reflex_danger_block' and not any(n in d for n in ('lava', 'magma', 'fire')):
                continue
            rows.append((k, r))
    parsed, unparsed = [], 0
    for k, r in rows:
        w = (r['raw'].get('exp') or {}).get('pool')
        if k == 'reflex_danger_block':
            # the detail is the FEET block's name and the row has no `at`: the feet cell (lava-like by the filter above)
            pos = (r['bot'] or {}).get('pos') or {}
            try:
                cell = tuple(int(math.floor(pos[a])) for a in ('x', 'y', 'z'))
            except (KeyError, TypeError):
                unparsed += 1
                continue
            parsed.append((r['t'], (r['bot'] or {}).get('name'), w, k, cell))
            continue
        mm = AT.search(r['detail'])
        if not mm:
            unparsed += 1
            continue
        parsed.append((r['t'], (r['bot'] or {}).get('name'), w, k, tuple(int(v) for v in mm.groups())))
    print(f"refusal rows naming lava: {len(rows)}; parsed {len(parsed)}; unparsed {unparsed}")
    for w in sorted({p[2] for p in parsed if p[2]}):
        seed_of[w], cells_by_world[w] = world_cells(m, w)
    hist = {}
    for t, b, w, k, c in sorted(parsed):
        hist.setdefault(b, []).append((t, c))
    judged = [p for p in parsed if p[0] >= until]
    tot = {}
    for t, b, w, k, c in judged:
        cells = cells_by_world.get(w, set())
        mp = {r: near(cells, c, r) for r in (0, 1, 2)}
        # NEGATIVE CONTROL: the same world's map cells moved 48 east and 48 south (the hazardmap report's null offset)
        mp['null'] = near(cells, (c[0] - 48, c[1], c[2] - 48), 1)
        own = any((t - datetime.timedelta(minutes=60)) <= t0 < t and max(abs(c[i] - c0[i]) for i in range(3)) <= 1
                  for t0, c0 in hist.get(b, []))
        for key in (k, 'ALL'):
            s = tot.setdefault(key, {'n': 0, 'map0': 0, 'map1': 0, 'map2': 0, 'own': 0, 'either': 0, 'neither_cells': set(),
                                     'cells': set(), 'map1_cells': set(), 'null': 0})
            s['n'] += 1
            s['null'] += mp['null']
            s['cells'].add((w, c))
            if mp[1]:
                s['map1_cells'].add((w, c))
            s['map0'] += mp[0]; s['map1'] += mp[1]; s['map2'] += mp[2]; s['own'] += own; s['either'] += (mp[1] or own)
            if not (mp[1] or own):
                s['neither_cells'].add((w, c))
    print(f"judged (after the map's until): {len(judged)} rows")
    for key, s in tot.items():
        n = s['n'] or 1
        print(f"  {key:28s} n={s['n']:5d}  map@0 {s['map0']/n:6.1%}  map@1 {s['map1']/n:6.1%}  map@2 {s['map2']/n:6.1%}  "
              f"own60 {s['own']/n:6.1%}  either {s['either']/n:6.1%}  uncovered distinct cells {len(s['neither_cells'])}")
        print(f"  {'':28s} distinct (world, cell) {len(s['cells'])}; map@1 {len(s['map1_cells'])} "
              f"({len(s['map1_cells']) / max(1, len(s['cells'])):.1%}); null (map moved 48,48) @1 {s['null'] / n:.1%}")
    print('map cells per world:', {w: len(c) for w, c in sorted(cells_by_world.items())})
    print('rows per world (judged):', {w: sum(1 for p in judged if p[2] == w) for w in sorted(cells_by_world)})


if __name__ == '__main__':
    main()
