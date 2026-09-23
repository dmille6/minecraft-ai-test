#!/usr/bin/env python3
"""PER-WORLD TPS/MSPT across the fleet, over each world's own RCON.

WHY THIS MATTERS AND WHY IT IS NEW. `block2-decision-record.md` pre-registers check C-17:
"per-world 1-minute TPS within 5% across all worlds for >=95% of samples", marked
CONTINUOUS. It has never been collected -- the decision record says so in its own words,
"a tool that can be run, not evidence that was collected". Meanwhile
endpoint-noise-floor-2026-09-19.md attributes an unexplained 217% MDE to "differential
drift" without naming a cause, and 16 Paper servers + 80 Node processes + Ollama share
hardware. If one pool's world runs at 14 TPS and another's at 20, items/bot-hour differs
by ~40% with no code change -- which is exactly the -45% to +77% six-hour swing that the
canary design was built to tolerate rather than explain.

Read-only: `tps` and `mspt` are queries. Nothing here mutates a world.

Usage: sudo python3 worldhealth.py [--json] [world ...]
"""
import json
import re
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import mcrcon  # noqa: E402

LIVE = ['board-a', 'board-b', 'board-c', 'board-d',
        'hive-a', 'hive-b', 'hive-c', 'hive-d',
        'placebo-a', 'placebo-b', 'placebo-c', 'placebo-d']
C17_LIMIT_PCT = 5.0


def strip_colour(s):
    return re.sub('§.', '', s or '').strip()


def nums(s):
    return [float(x.replace(',', '.')) for x in re.findall(r'\d+[.,]\d+', s)]


def sample(world):
    out = {'world': world}
    try:
        out['tps'] = nums(strip_colour(mcrcon.on(world, 'tps')))[:3]
    except Exception as e:
        out['error'] = f'{type(e).__name__}: {e}'
        return out
    try:
        m = strip_colour(mcrcon.on(world, 'mspt'))
        out['mspt_raw'] = m.splitlines()[-1][:70] if m else ''
        out['mspt'] = nums(m)[:3]
    except Exception as e:
        out['mspt_error'] = str(e)[:60]
    return out


def main():
    as_json = '--json' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    worlds = args or LIVE
    rows = [sample(w) for w in worlds]

    if as_json:
        print(json.dumps(rows, indent=1))
        return 0

    print(f"{'world':11s} {'TPS 1m':>7s} {'5m':>7s} {'15m':>7s}   mspt")
    for r in rows:
        if 'error' in r:
            print(f"{r['world']:11s}   ERROR  {r['error'][:52]}")
            continue
        t = r.get('tps') or []
        t = (t + [float('nan')] * 3)[:3]
        print(f"{r['world']:11s} {t[0]:7.2f} {t[1]:7.2f} {t[2]:7.2f}   {r.get('mspt_raw','')[:46]}")

    vals = [r['tps'][0] for r in rows if r.get('tps')]
    print(f"\npositive control: {len(vals)} of {len(worlds)} worlds answered")
    if len(vals) < 2:
        print("  not enough worlds answered to evaluate C-17")
        return 1
    spread = 100.0 * (max(vals) - min(vals)) / max(vals)
    print(f"  1-minute TPS: min {min(vals):.2f}  max {max(vals):.2f}  spread {spread:.1f}%")
    print(f"  C-17 (within {C17_LIMIT_PCT:.0f}% across all worlds): "
          f"{'PASS' if spread <= C17_LIMIT_PCT else 'FAIL'}  <-- one sample, not the >=95% series")
    worst = sorted(((r['tps'][0], r['world']) for r in rows if r.get('tps')))[:3]
    print("  slowest worlds: " + ", ".join(f"{w} {v:.2f}" for v, w in worst))
    return 0


if __name__ == '__main__':
    sys.exit(main())
