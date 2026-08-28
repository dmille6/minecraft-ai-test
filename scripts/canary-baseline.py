#!/usr/bin/env python3
"""
THE PRE-PERIOD HALF OF A DIFFERENCE-IN-DIFFERENCES.

A canary read as "pool vs the rest, after" is biased by whatever made the pool
worth choosing: placebo-c was picked for the water canary BECAUSE it had 2-3x
the fleet's water exposure, which flatters any water fix measured that way.
The only honest read is the pool's own before-vs-after against every other
pool's before-vs-after, so the "before" has to be captured with the SAME code
that will capture the "after".

Run it once before the deploy and once after the window. Identical invocation,
identical arithmetic, two files.

  canary-baseline.py --since 2026-08-28T12:00:00Z --until 2026-08-28T22:30:00Z

NEVER SEEK. A full walk of the fleet's telemetry is ~4 seconds; seeking to the
tail silently truncates the OLDEST end of the window, which is the baseline,
and every such truncation has flattered the recent change.
"""
import argparse, collections, datetime, glob, json, re, sys

Y_RE = re.compile(r'(?:reached|stopped at) y=(-?\d+)')


def parse(ts):
    return datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', required=True)
    ap.add_argument('--until', default='')
    ap.add_argument('--paths', default='/var/log/mcai/*/skill-*.jsonl')
    ap.add_argument('--json', default='')
    a = ap.parse_args()
    since = parse(a.since)
    until = parse(a.until) if a.until else datetime.datetime.now(datetime.timezone.utc)

    per = collections.defaultdict(lambda: {
        'mine': 0, 'mine_ok': 0, 'mine_unknown': 0, 'mine_failed': 0,
        'dx': 0.0, 'dy': 0.0, 'ratio_n': 0, 'deepest': None,
        'holds': 0, 'hold_ended_ok': 0, 'hold_ended_bad': 0,
        'surface_first': 0, 'route_out': 0, 'blocked': 0,
        'reentry': 0, 'water_ev': 0, 'deaths_drown': 0,
        'bots': set(), 'first': None, 'last': None,
        'fail': collections.Counter(),
    })

    for f in glob.glob(a.paths):
        try: fh = open(f, errors='replace')
        except OSError: continue
        with fh:
            for line in fh:
                if '"@timestamp"' not in line:
                    continue
                try:
                    d = json.loads(line); t = parse(d['@timestamp'])
                except Exception:
                    continue
                if t < since or t > until:
                    continue
                pool = (d.get('exp') or {}).get('pool')
                if not pool:
                    continue
                p = per[pool]
                bot = (d.get('bot') or {}).get('name')
                p['bots'].add(bot)
                if p['first'] is None or t < p['first']: p['first'] = t
                if p['last'] is None or t > p['last']: p['last'] = t
                sk = d.get('skill') or {}
                name, status = sk.get('name') or '', sk.get('status')

                if name.startswith('_drowning') or name.startswith('_water'):
                    p['water_ev'] += 1
                if name == '_water_surface_hold': p['holds'] += 1
                elif name == '_water_surface_hold_ended':
                    p['hold_ended_ok' if status == 'success' else 'hold_ended_bad'] += 1
                elif name == '_water_surface_first_ended': p['surface_first'] += 1
                elif name == '_water_route_out_ended': p['route_out'] += 1
                elif name == '_water_blocked_surface_ended': p['blocked'] += 1
                elif name == '_drowning_reentry': p['reentry'] += 1

                if name == 'mine':
                    p['mine'] += 1
                    p[{'success': 'mine_ok', 'unknown': 'mine_unknown'}
                      .get(status, 'mine_failed')] += 1
                    if status != 'success':
                        p['fail'][sk.get('fail_class') or '?'] += 1
                    # DESCENT ACHIEVED, NOT "SHAPE RATIO".
                    #
                    # I tried horizontal-over-vertical off `distance_moved`
                    # first. It read 9.29 for placebo-d, which is not a shaft
                    # (0.25) or a staircase (1.0) or anything else -- because
                    # `distance_moved` is the WHOLE skill's movement, including
                    # walking to the site, and only 10 of 494 mine calls
                    # descended at all. A ratio over ten travel-contaminated
                    # samples is a confident number about nothing.
                    #
                    # What the record can honestly support is how far down the
                    # bot actually got. The shaft stalls at y~56 because the
                    # exit contract prices pillaring out; a walkable staircase
                    # should reach deeper and abort less. `dist` is still
                    # summed, but reported as what it is.
                    m = Y_RE.search(sk.get('detail') or '')
                    y0 = ((d.get('bot') or {}).get('pos') or {}).get('y')
                    dist = sk.get('distance_moved')
                    if m and y0 is not None and dist is not None:
                        drop = y0 - int(m.group(1))
                        # A WHOLE BLOCK, NOT A ROUNDING ARTIFACT. `pos.y` is a
                        # float and the detail's y is an int, so `drop > 0`
                        # counted 0.5-block differences as descents and produced
                        # a mean drop of 0.3 -- a number that cannot describe
                        # digging, since the smallest real step is 1.
                        if drop >= 1:
                            p['dx'] += float(dist); p['dy'] += drop; p['ratio_n'] += 1
                        yy = int(m.group(1))
                        if p['deepest'] is None or yy < p['deepest']: p['deepest'] = yy

    rows = []
    for pool in sorted(per):
        p = per[pool]
        hours = ((p['last'] - p['first']).total_seconds() / 3600.0
                 * max(1, len(p['bots']))) if p['first'] and p['last'] else 0.0
        rows.append({
            'pool': pool, 'bots': len(p['bots']), 'bot_hours': round(hours, 1),
            'mine': p['mine'], 'mine_ok': p['mine_ok'],
            'mine_unknown': p['mine_unknown'], 'mine_failed': p['mine_failed'],
            # Descents, not attempts: a mine call that aborts at its start y
            # never tested the staircase and must not dilute the denominator.
            'descents': p['ratio_n'],
            'descent_rate': round(p['ratio_n'] / p['mine'], 3) if p['mine'] else None,
            'blocks_down': int(p['dy']),
            'mean_drop': round(p['dy'] / p['ratio_n'], 1) if p['ratio_n'] else None,
            'deepest_y': p['deepest'],
            'dist_per_drop_CONTAMINATED': round(p['dx'] / p['dy'], 2) if p['dy'] else None,
            'holds': p['holds'], 'hold_ok': p['hold_ended_ok'],
            'hold_bad': p['hold_ended_bad'],
            'surface_first': p['surface_first'], 'route_out': p['route_out'],
            'blocked_surface': p['blocked'],
            'water_ev': p['water_ev'], 'reentry': p['reentry'],
            'top_mine_fail': p['fail'].most_common(2),
        })

    print(f"\n  CANARY BASELINE  {since.isoformat()} .. {until.isoformat()}\n")
    print(f"  {'POOL':<12}{'BOTS':>5}{'BOT-H':>8}{'MINE':>6}{'DESC':>6}{'DESC%':>7}"
          f"{'DOWN':>7}{'MEAN':>6}{'DEEP':>6}{'HOLDS':>7}{'H-BAD':>7}{'WATER':>8}")
    for r in rows:
        print(f"  {r['pool']:<12}{r['bots']:>5}{r['bot_hours']:>8}{r['mine']:>6}"
              f"{r['descents']:>6}{str(r['descent_rate']):>7}{r['blocks_down']:>7}"
              f"{str(r['mean_drop']):>6}{str(r['deepest_y']):>6}"
              f"{r['holds']:>7}{r['hold_bad']:>7}{r['water_ev']:>8}")
    if a.json:
        with open(a.json, 'w') as fh:
            json.dump({'since': since.isoformat(), 'until': until.isoformat(),
                       'rows': rows}, fh, indent=1)
        print(f"\n  wrote {a.json}")
    if not rows:
        print("  NO DATA -- this reads the fleet host's logs. Run it there.")
        return 4
    return 0


if __name__ == '__main__':
    sys.exit(main())
