#!/usr/bin/env python3
"""CENSUS THE TOWN CHESTS over RCON. Read-only. No plugin, no deploy, no canary.

THE QUESTION. The server's own ledger says the fleet has mined 260,960 logs, and
`stock returned/bot-h` is 0.80 against a target of >=20. Acquisition works; the stock is
not arriving. One hypothesis has never been checked and one command settles it:

  the town chest is a BOUNDED SINK of 27 slots shared by 5 bots, and the recovery that
  would enlarge it -- craft another chest -- costs 2 logs, which the bot has just banked.

Verified in source before writing this: `bankableInventory` reserves tools, stations and 8
scaffold blocks, but the scaffold reserve is gated on /cobblestone|cobbled_deepslate|stone|
dirt/ -- logs and planks match NOTHING, so a successful deposit hands over every log. And
the storage_full recovery crafts a chest, which needs the wood that just went in. Two
individually-correct policies meeting where the bot has no legal move.

THREE OUTCOMES, and they point in different directions:
  (a) slots full, stacks PARTIAL  -> the constraint is slot count vs item VARIETY.
                                     More chests will not fix it; fewer names per deposit will.
  (b) slots full, stacks FULL     -> volume. Nothing withdraws; the sink needs a drain.
  (c) slots mostly EMPTY          -> `storage_full` is a FALSE refusal, and the bug is the
                                     silent `catch { /* chest full */ }` in skills.mjs
                                     mislabelling every chest.deposit exception as fullness.

Usage: sudo python3 chestcensus.py [world ...]
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import mcrcon  # noqa: E402

# ALL 16 WORLDS. The first version listed 12 and omitted isolated-a..d, then printed its
# totals as fleet figures -- "the fleet has mined 260,960 logs" was 60 of 80 bots. The
# positive control said "12 of 12 worlds answered", which cannot detect its own truncation
# because the denominator IS the truncated list. This project's own rule is to say the
# denominator before the number; the instrument built to enforce it broke it.
LIVE = ['board-a', 'board-b', 'board-c', 'board-d',
        'hive-a', 'hive-b', 'hive-c', 'hive-d',
        'placebo-a', 'placebo-b', 'placebo-c', 'placebo-d',
        'isolated-a', 'isolated-b', 'isolated-c', 'isolated-d']
SLOTS = 27


def home_of(world, root='/srv/mcbots/harness/env'):
    """HOME_X/Y/Z for a world's town.

    The env files live on the BOTS host and this script runs on the WORLDS host, so the
    first version read nothing on all 12 worlds and said so rather than inventing a
    coordinate. `homes.txt` (world x y z, one per line) is the cross-host hand-off.
    """
    side = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'homes.txt')
    if os.path.exists(side):
        for line in open(side):
            f = line.split()
            if len(f) == 4 and f[0] == world:
                return (int(f[1]), int(f[2]), int(f[3]))
    for suf in ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo'):
        p = os.path.join(root, f'{world}-{suf}.env')
        if not os.path.exists(p):
            continue
        t = open(p).read()
        g = {k: re.search(rf'^HOME_{k}=(-?\d+)', t, re.M) for k in 'XYZ'}
        if all(g.values()):
            return tuple(int(g[k].group(1)) for k in 'XYZ')
    return None


def chest_at(world, x, y, z):
    """None if not a chest; else list of (name, count)."""
    try:
        out = mcrcon.on(world, f'data get block {x} {y} {z} Items')
    except Exception as e:
        return ('error', str(e)[:70])
    if 'no block' in out.lower() or 'not have' in out.lower() or 'Items' not in out:
        return None
    items = re.findall(r'id:\s*"([a-z_:]+)".*?count:\s*(\d+)', out) \
        or re.findall(r'count:\s*(\d+)b?,\s*id:\s*"([a-z_:]+)"', out)
    if items and items[0][0].isdigit():
        items = [(b, a) for a, b in items]
    return [(n.split(':')[-1], int(c)) for n, c in items]


def main():
    worlds = [a for a in sys.argv[1:] if not a.startswith('--')] or LIVE
    print(f"{'world':11s} {'home x,y,z':>18s} {'slots':>7s} {'/27':>5s} {'items':>7s} "
          f"{'names':>6s} {'full stacks':>11s}  verdict")
    found = 0
    agg = []
    for w in worlds:
        h = home_of(w)
        if not h:
            print(f"{w:11s} {'no HOME in env':>18s}")
            continue
        # search a small column around home: bots place their own chest near it
        best = None
        for dy in (0, 1, -1, 2, -2):
            for dx, dz in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1)):
                r = chest_at(w, h[0] + dx, h[1] + dy, h[2] + dz)
                if isinstance(r, tuple):
                    continue
                if r is not None:
                    best = (h[0] + dx, h[1] + dy, h[2] + dz, r)
                    break
            if best:
                break
        if not best:
            print(f"{w:11s} {str(h):>18s} {'no chest found near home':>7s}")
            continue
        found += 1
        x, y, z, items = best
        n_slots = len(items)
        n_items = sum(c for _, c in items)
        names = len({n for n, _ in items})
        fulls = sum(1 for _, c in items if c >= 64)
        verdict = ('EMPTY-ish' if n_slots <= 13 else
                   'FULL/partial' if fulls < n_slots / 2 else 'FULL/stacked')
        agg.append((n_slots, n_items, names, fulls))
        print(f"{w:11s} {f'{x},{y},{z}':>18s} {n_slots:7d} {100*n_slots//SLOTS:4d}% "
              f"{n_items:7d} {names:6d} {fulls:11d}  {verdict}")

    print(f"\npositive control: {found} of {len(worlds)} worlds had a readable chest near home")
    if not agg:
        print("  NOTHING READ -- wrong coordinates, or bots place chests away from home.")
        print("  That is a finding about the tool, not about the fleet.")
        return 1
    s = sum(a[0] for a in agg) / len(agg)
    f = sum(a[3] for a in agg) / len(agg)
    nm = sum(a[2] for a in agg) / len(agg)
    print(f"  mean occupied slots {s:.1f}/27 ({100*s/SLOTS:.0f}%), mean full stacks {f:.1f}, "
          f"mean distinct names {nm:.1f}")
    if s >= 24:
        print("  -> (a)/(b): the sink IS full. Slot count is binding; nothing drains it.")
    elif s <= 13:
        print("  -> (c): the sink is NOT full, so `storage_full` is a false refusal and the")
        print("     silent catch in chest.deposit is mislabelling exceptions as fullness.")
    else:
        print("  -> partially filled; read again after a window to get the FILL RATE, which")
        print("     is the number that says whether this is asymptotic.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
