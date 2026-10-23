"""Positive controls for sample_state.py's feature extraction, and the iron/wood/cobble the bags
carry. No ES access.

Control: on a decision whose milestone IS stockpile_wood, the bag cannot already hold 64 wood
(else the rung would be done); on gather_iron_ore_3, iron must be in reach (its hasMeans gate),
the bot must hold a trip pickaxe, and must hold < 3 iron. If those shares are not ~0/~100%,
the features are wrong (or the rung label lags the bag by one decision).
"""
import os, sys, gzip, json, glob
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sample_state import feats, LOGS, COBBLE  # noqa: E402
from analyze import world, HOMES  # noqa: E402

for path in sorted(glob.glob(os.path.join(HERE, 'out', 'llm_sample', '*.jsonl.gz'))):
    day = os.path.basename(path)[:10]
    ctl = defaultdict(lambda: [0, 0, 0, 0])
    carry = defaultdict(float)
    n = 0
    with gzip.open(path, 'rt') as f:
        for l in f:
            r = json.loads(l)
            if world(r['p']) not in HOMES:
                continue
            F, _ = feats(r)
            m = (r['m'] or '').replace('+prereq', '')
            if m == 'stockpile_wood':
                ctl['wood'][0] += 1
                ctl['wood'][1] += F['wood64']
            if m == 'stockpile_stone':
                ctl['stone'][0] += 1
                ctl['stone'][1] += F['stone64']
            if m == 'gather_iron_ore_3':
                c = ctl['iron']
                c[0] += 1
                c[1] += F['iron3']
                c[2] += F['iron32']
                c[3] += F['trip']
            inv = r['inv'] or {}
            n += 1
            for k in ('raw_iron', 'iron_ingot', 'cobblestone', 'oak_log', 'dirt', 'iron_pickaxe', 'stone_pickaxe'):
                carry[k] += int(inv.get(k, 0) or 0)
    w, s, i = ctl['wood'], ctl['stone'], ctl['iron']
    print(f"{day} wood-rung n={w[0]:5d} wood64 {100 * w[1] / max(1, w[0]):5.1f}% | stone-rung n={s[0]:5d} stone64 "
          f"{100 * s[1] / max(1, s[0]):5.1f}% | iron-rung n={i[0]:5d} iron3 {100 * i[1] / max(1, i[0]):5.1f}% "
          f"iron32 {100 * i[2] / max(1, i[0]):5.1f}% trip {100 * i[3] / max(1, i[0]):5.1f}% || mean carried per decision: "
          + ' '.join(f'{k} {v / n:6.1f}' for k, v in carry.items()))
