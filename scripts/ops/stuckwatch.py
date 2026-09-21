#!/usr/bin/env python3
"""stuckwatch -- page when a bot has been pinned for hours and nobody noticed.

2026-09-21: isolated-d-Alpha occupied exactly ONE integer position (492, 51, 218)
for at least nineteen hours, at full health, emitting ~100 drowning routes an hour,
sealed in water where the pathfinder found no route and the flood guard refused the
only dig. Nothing paged. The fleet digest reports aggregates, and one bot in eighty
does not move an aggregate.

Deliberately NOT a canary endpoint. Measured over 6 h, the full composed trap
(sealed_in_liquid AND a flood-guard refusal AND <= 3 distinct positions) was 1 of
80 bots, ~0.9% of fleet items, while 15 other bots hit sealed_in_liquid and kept
moving. It is an operations alarm about individual bots, not evidence of a fleet
mechanism, and it must not be quoted as one.

Thresholds are deliberately loose: this exists to catch a bot stuck for HOURS, not
to opine on minutes. Immobility here is episodic -- the same bots travelled tens of
thousands of blocks over 72 h -- so a short-window alarm would be noise.
"""
import sys, os, collections, datetime as dt
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

WINDOW_MIN = int(os.environ.get('STUCKWATCH_MIN', '240'))
MAX_POS = 3          # distinct integer positions in the window
MARKER = '/home/mike/digest/BOTS-PINNED.txt'


def main():
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=WINDOW_MIN)
    pos = collections.defaultdict(set)
    items = collections.Counter()
    kinds = collections.defaultdict(collections.Counter)
    bots = set()
    for r in ev.rows:
        b = (r['bot'] or {}).get('name')
        if not b or b.startswith('self-'):
            continue
        bots.add(b)
        kinds[b][r['name']] += 1
        p = (r['bot'] or {}).get('pos') or {}
        if p.get('x') is not None:
            pos[b].add((round(p['x']), round(p['y']), round(p['z'])))
        for _i, v in (((r['raw'].get('skill') or {}).get('inventory_delta')) or {}).items():
            if v > 0:
                items[b] += v

    # POSITIVE CONTROL. "no bot is pinned" is an absence claim on 80 bots, which is
    # exactly the shape that has been wrong here before, so prove the walk can see
    # movement at all before believing it saw none.
    moved = [b for b in bots if len(pos[b]) > MAX_POS]
    if not bots or not moved:
        print('stuckwatch REFUSED: %d bots, %d with movement -- the walk looks broken, '
              'so "nothing is pinned" would be meaningless' % (len(bots), len(moved)))
        return 1

    pinned = sorted(b for b in bots if pos[b] and len(pos[b]) <= MAX_POS)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if not pinned:
        if os.path.exists(MARKER):
            os.remove(MARKER)
        print('%s stuckwatch OK (%d bots, %d moving, none pinned over %d min)'
              % (stamp, len(bots), len(moved), WINDOW_MIN))
        return 0

    lines = ['%s %d of %d bots PINNED for >= %d min (<= %d distinct positions):'
             % (stamp, len(pinned), len(bots), WINDOW_MIN, MAX_POS)]
    for b in pinned:
        top = ', '.join('%s x%d' % (k.lstrip('_'), n) for k, n in kinds[b].most_common(3))
        where = sorted(pos[b])[0] if pos[b] else '?'
        lines.append('  %-22s at %-18s items %-5d | %s' % (b, str(where), items[b], top))
    lines.append('  (an operations alarm about individual bots -- NOT a fleet mechanism, '
                 'and not a canary endpoint)')
    body = '\n'.join(lines)
    print(body)
    try:
        os.makedirs(os.path.dirname(MARKER), exist_ok=True)
        open(MARKER, 'w').write(body + '\n')
    except Exception:
        pass
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
