#!/usr/bin/env python3
"""goalcensus.py <positions.json> <census-out.json> -- READ-ONLY town chest census for goalboard.py (run on the worlds host
10.0.0.30 with sudo: region files and server.properties are owned by minecraft/root; nothing is written to any world).

WHY THIS EXISTS. census3.py reads only the positions it is GIVEN, and the only positions file (positions-run-20261014T0221Z)
lists the containers known on 10-14. A container placed later is invisible to it: an instrument that cannot see a
presence. This wrapper DISCOVERS containers first, from each world's saved region files (regionscan.py's reader), then
hands the union to census3.census_world, which reads each one over RCON with census3's read-only grammar (`list`,
`data get block X Y Z id|Items[k]`).

  bank box     |dx|,|dz| <= 48 and |dy| <= 12 from home -- census3's BOX, the scope the bots, the chest clear and
               every earlier census call "town". These are READ (RCON) and are what goalboard reports as town chests.
  outside      every other chest/barrel within RING blocks (Chebyshev, any y within +-RING_DY) -- COUNTED, not read,
               split into unopened loot chests (a LootTable tag: generated mineshaft/village chests no bot has
               opened) and the rest (bot-placed, or natural ones a bot opened). Reported as a coverage figure, so
               "the census misses containers" is a number, not a guess.

Region files lag the live world by up to one autosave (~5 min, measured fresh at 12:37Z 10-19). A chunk the scan could
not read is a HOLE, listed in discovery.holes, never an empty chunk.
"""
import json, os, struct, sys, time, zlib, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import census3
from regionscan import nbt, KINDS

RING, RING_DY = 96, 40


def scan(world, home, radius=RING):
    """-> ({(x,y,z): {'loot': bool}}, stats). Every chest/barrel/trapped_chest within `radius` (Chebyshev) of home."""
    hx, hy, hz = home
    found, st = {}, {'chunks': 0, 'errors': 0, 'external': 0, 'missing_region': 0, 'absent': 0}
    for cx in range((hx - radius) >> 4, ((hx + radius) >> 4) + 1):
        for cz in range((hz - radius) >> 4, ((hz + radius) >> 4) + 1):
            rf = '/srv/block2/%s/world/region/r.%d.%d.mca' % (world, cx >> 5, cz >> 5)
            if not os.path.exists(rf):
                st['missing_region'] += 1; continue
            with open(rf, 'rb') as f:
                f.seek(4 * ((cx & 31) + (cz & 31) * 32)); e = f.read(4)
                off = (e[0] << 16 | e[1] << 8 | e[2]) * 4096
                if not off:
                    st['absent'] += 1; continue
                f.seek(off); ln, comp = struct.unpack('>iB', f.read(5)); data = f.read(ln - 1)
            if comp & 128:
                st['external'] += 1; continue
            try:
                raw = zlib.decompress(data) if comp == 2 else gzip.decompress(data) if comp == 1 else data if comp == 3 else None
                if raw is None:
                    st['errors'] += 1; continue
                root = nbt(raw)
            except Exception:
                st['errors'] += 1; continue
            st['chunks'] += 1
            for be in root.get('block_entities') or []:
                if be.get('id') in KINDS:
                    x, y, z = be['x'], be['y'], be['z']
                    if max(abs(x - hx), abs(z - hz)) <= radius and abs(y - hy) <= RING_DY:
                        found[(x, y, z)] = {'loot': 'LootTable' in be}
    return found, st


def in_bank(p, home):
    return abs(p[0] - home[0]) <= census3.BOX[0] and abs(p[2] - home[2]) <= census3.BOX[0] and abs(p[1] - home[1]) <= census3.BOX[1]


def main():
    P = json.load(open(sys.argv[1]))
    disc, todo = {}, {}
    for w, v in sorted(P.items()):
        home = v['home']
        found, st = scan(w, home)
        bank = {p for p in found if in_bank(p, home)}
        known = {tuple(p) for p in v['pos'] if in_bank(p, home)}
        outside = {p: f for p, f in found.items() if p not in bank}
        disc[w] = {'home': home, 'region_bank_containers': len(bank), 'region_only_bank': sorted(bank - known),
                   'list_only_bank_positions': len(known - bank),
                   'outside_bank_loot_unopened': sum(f['loot'] for f in outside.values()),
                   'outside_bank_other': sum(not f['loot'] for f in outside.values()),
                   'region_stats': st}
        # the union: a listed position the region file does not hold is still asked (census3 records it as
        # not_container), so a container the autosave has not written yet is not lost if the list knows it
        todo[w] = {'home': home, 'pos': sorted(bank | known)}
    res = {'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'positions_file': sys.argv[1],
           'discovery': {'method': 'region files (regionscan.nbt) + positions list; bank box %s; outside ring %d (dy %d)'
                                   % (list(census3.BOX), RING, RING_DY), 'worlds': disc}, 'worlds': {}}
    out = {}
    import threading
    th = [threading.Thread(target=census3.census_world, args=(w, v, out)) for w, v in sorted(todo.items())]
    for t in th: t.start()
    for t in th: t.join()
    res['finished_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    res['worlds'] = {w: out[w] for w in sorted(out)}
    holes = {w: d['region_stats'] for w, d in disc.items()
             if any(d['region_stats'][k] for k in ('errors', 'external', 'missing_region', 'absent'))}
    res['discovery']['holes'] = holes
    json.dump(res, open(sys.argv[2], 'w'))
    bad = 0
    for w, rec in res['worlds'].items():
        d = disc[w]; n = len(rec['containers'])
        bad += bool(rec.get('error') or rec['incomplete'])
        print('%-11s bank containers read %3d (region %3d, region-only %2d) incomplete %d err %s | outside: other %3d loot %3d'
              % (w, n, d['region_bank_containers'], len(d['region_only_bank']), len(rec['incomplete']), rec.get('error'),
                 d['outside_bank_other'], d['outside_bank_loot_unopened']), flush=True)
    print('goalcensus', res['started_utc'], '->', res['finished_utc'], 'worlds', len(res['worlds']), 'with problems', bad,
          'discovery', 'PASS' if not holes else 'HOLES %s' % holes)
    sys.exit(1 if bad or holes else 0)


if __name__ == '__main__':
    main()
