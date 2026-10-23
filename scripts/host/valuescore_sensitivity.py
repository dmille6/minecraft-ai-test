#!/usr/bin/env python3
"""Weight sensitivity for valuescore.py: re-price two days' intake (valuescore --json outputs) under alternative weights
and show whether the day-to-day comparison keeps its direction. No ES access.

    python3 valuescore_sensitivity.py vs-2026-10-09.json vs-2026-10-22.json
"""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import valuescore as v

A, B = (json.load(open(p)) for p in sys.argv[1:3])


def units(res):
    """Weighted items' units back from by_item (value / weight)."""
    return {i: val / v.weight(i) for i, val in res['by_item'].items() if v.weight(i)}


ua, ub = units(A), units(B)
SCEN = {
    'v1 as shipped': {},
    'iron x0.5 (raw_iron 4)': {'raw_iron': 4.0, 'iron_ore': 4.0, 'deepslate_iron_ore': 4.0},
    'iron x2 (raw_iron 16)': {'raw_iron': 16.0, 'iron_ore': 16.0, 'deepslate_iron_ore': 16.0},
    'cobble 0.1': {'cobblestone': 0.1, 'cobbled_deepslate': 0.1, 'stone': 0.1},
    'cobble 0.5': {'cobblestone': 0.5, 'cobbled_deepslate': 0.5, 'stone': 0.5},
    'copper 1 / 4': None,
    'saplings 0': {'_sapling': 0.0},
}


def price(u, over):
    tot = 0.0
    for i, n in u.items():
        w = v.weight(i)
        for k, x in over.items():
            if k == i or (k.startswith('_') and i.endswith(k)):
                w = x
        tot += n * w
    return tot


print(f'{"scenario":28s} {"day A /bot-h":>13s} {"day B /bot-h":>13s} {"change":>8s}')
for name, over in SCEN.items():
    for o in ([{'raw_copper': 1.0}, {'raw_copper': 4.0}] if over is None else [over]):
        a, b = price(ua, o) / A['bot_hours'], price(ub, o) / B['bot_hours']
        label = name if over is not None else f'copper {o["raw_copper"]:g}'
        print(f'{label:28s} {a:13.2f} {b:13.2f} {100 * (b - a) / a:+7.1f}%')
print(f'(old count, gather ok/bot-h: {A["old"]["gather_ok"] / A["bot_hours"]:.2f} -> {B["old"]["gather_ok"] / B["bot_hours"]:.2f}, '
      f'{100 * (B["old"]["gather_ok"] / B["bot_hours"] / (A["old"]["gather_ok"] / A["bot_hours"]) - 1):+.1f}%)')
