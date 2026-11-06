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

ONE PAGER (phase 1, 11-06). (1) PUSHED: every pinned bot is an alarm key pin:<bot> through lib/alarm.raise_alarms
(tier 1: NEW now, re-pushed every 2 h until acknowledged, CLEARED when it moves; one message per run). It used to write
only this log and BOTS-PINNED.txt, read by a hand-run header (about 700 pinned bot-h in 14 days, never pushed).
(2) ROTATION FALSE PINS FIXED: the walk read '/var/log/mcai/*/skill-*.jsonl' -- the live files only -- so the 00:17Z and
00:47Z runs saw only the rows since the 23:59Z rotation and a bot with <= 3 positions in those minutes read as pinned for
240 (measured 14 d: mean 4.6 pinned at 00:xx, max 15, against 1.8-2.4 at every other hour). The walk now loads the
rotated files too (telemetry's default glob), and a bot is judged only when its rows COVER the window (a first row within
COVER_MIN of its start): a bot that restarted or was down cannot be called pinned on half a window.
"""
import collections
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, '/opt/minecraft-ai/scripts')  # fallback: the deploy checkout's lib/ (the old import path)
sys.path.insert(0, os.path.join(HERE, '..'))    # first: this install's lib/ (telemetry + the pager's alarm.py)

WINDOW_MIN = int(os.environ.get('STUCKWATCH_MIN', '240'))
MAX_POS = 3          # distinct integer positions in the window
COVER_MIN = 30       # a bot's first row must be within this of the window start to be judged
FRESH_MIN = 15       # ... and its newest row within this of now
MARKER = os.path.expanduser('~/digest/BOTS-PINNED.txt')
LOGS = '/var/log/mcai/*/skill-*.jsonl*'      # live AND rotated (.jsonl-YYYYMMDD.gz)


def judge_pins(facts, since, now, max_pos=MAX_POS, cover=dt.timedelta(minutes=COVER_MIN),
               fresh=dt.timedelta(minutes=FRESH_MIN)):
    """PURE. facts: {bot: {'first': datetime, 'last': datetime, 'pos': set, ...}} -> (pinned, moved, unjudged) bot lists.
    A bot is PINNED when its rows cover the window -- the first within `cover` of its start AND the newest within `fresh`
    of now -- and it occupied <= max_pos distinct integer positions; it MOVED with more; otherwise it is UNJUDGED (not
    observed for the whole window: restarted, down, or a log gap -- never a pin on half a window)."""
    pinned, moved, unjudged = [], [], []
    for b, f in sorted(facts.items()):
        if not f.get('pos'):
            continue
        if len(f['pos']) > max_pos:
            moved.append(b)
        elif f.get('first') is None or f['first'] > since + cover or f.get('last') is None or f['last'] < now - fresh:
            unjudged.append(b)
        else:
            pinned.append(b)
    return pinned, moved, unjudged


def collect(rows):
    """rows: telemetry Events rows -> {bot: {'first', 'pos', 'kinds', 'items'}}."""
    facts = collections.defaultdict(lambda: {'first': None, 'last': None, 'pos': set(), 'kinds': collections.Counter(),
                                             'items': 0})
    for r in rows:
        b = (r['bot'] or {}).get('name')
        if not b or b.startswith('self-'):
            continue
        f = facts[b]
        t = r.get('t')
        if t is not None and (f['first'] is None or t < f['first']):
            f['first'] = t
        if t is not None and (f['last'] is None or t > f['last']):
            f['last'] = t
        f['kinds'][r['name']] += 1
        p = (r['bot'] or {}).get('pos') or {}
        if p.get('x') is not None:
            f['pos'].add((round(p['x']), round(p['y']), round(p['z'])))
        for _i, v in (((r['raw'].get('skill') or {}).get('inventory_delta')) or {}).items():
            if isinstance(v, (int, float)) and v > 0:
                f['items'] += v
    return facts


def main(argv=None):
    from lib.telemetry import Events
    from lib import alarm as AL
    push = '--no-push' not in (argv if argv is not None else sys.argv[1:])
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    since = now - dt.timedelta(minutes=WINDOW_MIN)
    ev = Events.load(paths=LOGS, since=since)
    facts = collect(ev.rows)
    pinned, moved, unjudged = judge_pins(facts, since, now)
    stamp = AL._iso(now)
    # POSITIVE CONTROL. "no bot is pinned" is an absence claim on 80 bots, which is
    # exactly the shape that has been wrong here before, so prove the walk can see
    # movement at all before believing it saw none.
    if not facts or not moved:
        print('stuckwatch REFUSED: %d bots, %d with movement -- the walk looks broken, '
              'so "nothing is pinned" would be meaningless' % (len(facts), len(moved)))
        return 1
    digest = os.path.expanduser('~/digest')
    active = {}
    if not pinned:
        if os.path.exists(MARKER):
            os.remove(MARKER)
        print('%s stuckwatch OK (%d bots, %d moving, none pinned over %d min; %d not judged: rows do not cover the window)'
              % (stamp, len(facts), len(moved), WINDOW_MIN, len(unjudged)))
    else:
        lines = ['%s %d of %d bots PINNED for >= %d min (<= %d distinct positions; %d not judged):'
                 % (stamp, len(pinned), len(facts), WINDOW_MIN, MAX_POS, len(unjudged))]
        for b in pinned:
            f = facts[b]
            top = ', '.join('%s x%d' % (k.lstrip('_'), n) for k, n in f['kinds'].most_common(3))
            where = sorted(f['pos'])[0]
            lines.append('  %-22s at %-18s items %-5d | %s' % (b, str(where), f['items'], top))
            active[f'pin:{b}'] = (f'{b} PINNED >= {WINDOW_MIN} min at {where} ({len(f["pos"])} position(s), {f["items"]} items '
                                  f'in the window; top: {top})')
        lines.append('  (an operations alarm about individual bots -- NOT a fleet mechanism, '
                     'and not a canary endpoint)')
        body = '\n'.join(lines)
        print(body)
        try:
            os.makedirs(os.path.dirname(MARKER), exist_ok=True)
            open(MARKER, 'w').write(body + '\n')
        except Exception:
            pass
    AL.raise_alarms('stuckwatch', active, now, os.path.join(digest, 'stuckwatch.pushstate.json'),
                    log_path=os.path.join(digest, 'ALARMS.log'), push=push)
    return 2 if pinned else 0


if __name__ == '__main__':
    raise SystemExit(main())
