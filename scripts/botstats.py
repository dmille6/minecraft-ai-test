#!/usr/bin/env python3
"""SERVER-AUTHORED per-bot statistics: the one ledger a bot cannot bias.

WHY THIS IS DIFFERENT FROM EVERYTHING ELSE WE READ. All 865k telemetry rows/day are written
BY THE BOT, about itself, from its own cache -- and mineflayer completes a dig on a local
timer and writes air into that cache, so `bot.dig()` resolving is a prediction. Minecraft
writes world/stats/<uuid>.json itself. `minecraft:mined` only increments when the SERVER
applied the break; `minecraft:picked_up` only when the item actually entered the inventory.

So mined - picked_up on the same material is the retrieval gap, measured by the server,
with no plugin and no packet work. That gap is the thing five separate readings argued
about tonight.

Offline-mode UUIDs are deterministic: UUID v3 over MD5 of "OfflinePlayer:<name>", so bot
name -> file is computable rather than guessed.

Read-only. Usage: sudo python3 botstats.py [world ...]
"""
import hashlib
import json
import os
import sys
import uuid as _uuid

ROOT = '/srv/block2'
# ALL 16 WORLDS. The first version listed 12 and omitted isolated-a..d, then printed its
# totals as fleet figures -- "the fleet has mined 260,960 logs" was 60 of 80 bots. The
# positive control said "12 of 12 worlds answered", which cannot detect its own truncation
# because the denominator IS the truncated list. This project's own rule is to say the
# denominator before the number; the instrument built to enforce it broke it.
LIVE = ['board-a', 'board-b', 'board-c', 'board-d',
        'hive-a', 'hive-b', 'hive-c', 'hive-d',
        'placebo-a', 'placebo-b', 'placebo-c', 'placebo-d',
        'isolated-a', 'isolated-b', 'isolated-c', 'isolated-d']
SUFFIXES = ('Alpha', 'Bravo', 'Comet', 'Delta', 'Echo')


def offline_uuid(name):
    """Minecraft's offline UUID: version-3 (MD5) over 'OfflinePlayer:<name>'."""
    h = bytearray(hashlib.md5(('OfflinePlayer:' + name).encode('utf8')).digest())
    h[6] = (h[6] & 0x0f) | 0x30      # version 3
    h[8] = (h[8] & 0x3f) | 0x80      # RFC 4122 variant
    return str(_uuid.UUID(bytes=bytes(h)))


def read(world, bot):
    p = os.path.join(ROOT, world, 'world', 'stats', offline_uuid(bot) + '.json')
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f).get('stats', {})


def g(stats, cat, item):
    return (stats.get('minecraft:' + cat) or {}).get('minecraft:' + item, 0)


def logs_of(stats, cat):
    d = stats.get('minecraft:' + cat) or {}
    return sum(v for k, v in d.items() if k.endswith('_log'))


def main():
    worlds = [a for a in sys.argv[1:] if not a.startswith('--')] or LIVE
    rows, missing = [], []
    for w in worlds:
        for s in SUFFIXES:
            bot = f'{w}-{s}'
            st = read(w, bot)
            if st is None:
                missing.append(bot)
                continue
            rows.append((bot, st))

    print(f"positive control: {len(rows)} stats files found, {len(missing)} bots with none")
    if missing[:5]:
        print(f"  no file for: {', '.join(missing[:5])}{' ...' if len(missing) > 5 else ''}")
    if not rows:
        print("  NOTHING READ -- wrong root, wrong names, or no permission. Not a finding.")
        return 1

    print(f"\n{'bot':22s} {'logs mined':>10s} {'logs got':>9s} {'gap':>6s} "
          f"{'picks broken':>12s} {'walk km':>8s} {'deaths':>6s}")
    tm = tp = 0
    for bot, st in sorted(rows):
        lm, lp = logs_of(st, 'mined'), logs_of(st, 'picked_up')
        picks = sum(v for k, v in (st.get('minecraft:broken') or {}).items()
                    if k.endswith('_pickaxe') or k.endswith('_axe'))
        km = g(st, 'custom', 'walk_one_cm') / 100000.0
        deaths = g(st, 'custom', 'deaths')
        tm += lm; tp += lp
        gap = (100.0 * (lm - lp) / lm) if lm else 0.0
        print(f"{bot:22s} {lm:10d} {lp:9d} {gap:5.0f}% {picks:12d} {km:8.1f} {deaths:6d}")

    print(f"\n=== FLEET: logs the SERVER says were mined {tm}, logs that reached an inventory {tp} ===")
    if tm:
        print(f"  retrieval gap: {tm - tp} logs, {100.0*(tm-tp)/tm:.1f}% of everything broken")
        print("  NOTE a positive gap is not proof of a lost drop: another bot may have")
        print("  collected it, and picked_up also counts logs taken from a chest. It is a")
        print("  bound on retrieval loss, not a measurement of it.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
