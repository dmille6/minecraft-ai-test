#!/usr/bin/env python3
"""Did the fresh WORLD restore gather, or did the fresh BOT STATE?

placebo-a's +48 h read shows gather success 13.0% -> 42.7% against clean controls
24.2% -> 21.8%: a +32.1 pp DiD. The registration calls the 48 h read attributable
to the seed. It is not, because the reseed wiped TWO things at once:

  (a) the terrain      -- a fresh, well-sited, un-excavated, un-flooded world
  (b) the bot state    -- state dirs, inventories, AND the learned-avoid store

(b) is not a footnote. This project has already measured 70 of 80 bots forbidden
to craft a wooden pickaxe by accumulated avoid rules, and hive pools running
109-185 learned_avoid vetoes per 1k decisions. A state wipe clears all of it.

The two causes have opposite remedies. (a) implies reseeding worlds, which the
owner forbids as a fix for a bot ("do not change the world to fix a bot"), so it
would have to become a world-rotation policy. (b) implies expiring avoid rules --
a cheap code change that needs no new terrain at all.

DISCRIMINATOR: if (b) is the cause, the treatment pool's veto/refusal rate must
collapse at T0 and stay down, and the gather recovery must track it. If (a) is the
cause, vetoes should be roughly unchanged while the TERRAIN-shaped refusals
(no_path, nothing_found, no_safe_target) move.

Every number carries its denominator, and a positive control runs first.
"""
import sys, glob as _g, datetime as dt, collections
sys.path.insert(0, '/home/mike/mcai-analysis')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

POOL = 'placebo-a'
T0 = dt.datetime.fromisoformat('2026-09-19T00:00:44Z'.replace('Z', '+00:00'))
HOURS = 48.0
PRE0, POST1 = T0 - dt.timedelta(hours=24), T0 + dt.timedelta(hours=HOURS)
CLEAN_CONTROL = {'hive-b', 'hive-c', 'hive-d', 'placebo-c'}
now = dt.datetime.now(dt.timezone.utc)


def load(span):
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=span)
    start = now - dt.timedelta(minutes=span)
    d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if _g.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz',
                                       since_minutes=span).rows)
        d += dt.timedelta(days=1)
    return ev


span = int((now - PRE0).total_seconds() / 60) + 90
ev = load(span)
kinds = collections.Counter(r['name'] for r in ev.rows)
print("positive control: %d rows, %d bots, %d kinds, span %.1f h"
      % (len(ev.rows), len({(r['bot'] or {}).get('name') for r in ev.rows}), len(kinds), span / 60))
print("avoid-ish kinds present:",
      {k: v for k, v in kinds.items() if 'avoid' in k or 'veto' in k or 'refus' in k})
print()

cells = collections.defaultdict(set)
cnt = collections.defaultdict(collections.Counter)
fails = collections.defaultdict(collections.Counter)
decs = collections.Counter()
for r in ev.rows:
    b = (r['bot'] or {}).get('name')
    if not b:
        continue
    p = b.rsplit('-', 1)[0]
    arm = 'treatment' if p == POOL else ('control' if p in CLEAN_CONTROL else None)
    if arm is None:
        continue
    t = r['t']
    era = 'pre' if PRE0 <= t < T0 else ('post' if T0 <= t < POST1 else None)
    if era is None:
        continue
    k = (arm, era)
    cells[k].add((b, t.replace(minute=0, second=0, microsecond=0)))
    nm = r['name'].lstrip('_')
    sk = (r['raw'].get('skill') or {})
    det = str(sk.get('detail') or '')
    if 'avoid' in nm or 'veto' in nm:
        cnt[k]['avoid_rows'] += 1
    if str(r['raw'].get('trigger', '')).startswith('llm') and not r['name'].startswith('_'):
        decs[k] += 1
    # terrain-shaped gather refusals, read from the fail class in the detail
    for cls in ('no_safe_target', 'no_path', 'nothing_found', 'unreachable',
                'arrived_out_of_reach', 'collect_budget'):
        if cls in det:
            fails[k][cls] += 1

print("%-22s %8s %9s %11s %12s" % ("arm/era", "bot-h", "decisions", "avoid rows", "avoid/1k dec"))
print("-" * 68)
for arm in ('treatment', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era)
        bh = len(cells[k])
        d = decs[k]
        a = cnt[k]['avoid_rows']
        print("%-22s %8d %9d %11d %12.1f"
              % ("%s/%s" % (arm, era), bh, d, a, 1000.0 * a / d if d else 0))

print()
print("TERRAIN-SHAPED GATHER REFUSALS, per 1k decisions")
allcls = sorted({c for k in fails for c in fails[k]})
print("%-22s %s" % ("arm/era", "  ".join("%-20s" % c for c in allcls)))
print("-" * (24 + 22 * len(allcls)))
rate = {}
for arm in ('treatment', 'control'):
    for era in ('pre', 'post'):
        k = (arm, era)
        d = decs[k] or 1
        row = []
        for c in allcls:
            v = 1000.0 * fails[k][c] / d
            rate[(arm, era, c)] = v
            row.append("%-20.2f" % v)
        print("%-22s %s" % ("%s/%s" % (arm, era), "  ".join(row)))

print()
print("DiD per 1k decisions (treatment change minus control change)")
for c in allcls:
    t = rate[('treatment', 'post', c)] - rate[('treatment', 'pre', c)]
    k_ = rate[('control', 'post', c)] - rate[('control', 'pre', c)]
    print("  %-22s %+8.2f" % (c, t - k_))
dt_a = (1000.0 * cnt[('treatment', 'post')]['avoid_rows'] / (decs[('treatment', 'post')] or 1)
        - 1000.0 * cnt[('treatment', 'pre')]['avoid_rows'] / (decs[('treatment', 'pre')] or 1))
dc_a = (1000.0 * cnt[('control', 'post')]['avoid_rows'] / (decs[('control', 'post')] or 1)
        - 1000.0 * cnt[('control', 'pre')]['avoid_rows'] / (decs[('control', 'pre')] or 1))
print("  %-22s %+8.2f" % ('avoid rows', dt_a - dc_a))
print()
print("READING IT: a large negative DiD on avoid rows points at the STATE WIPE (b).")
print("A large negative DiD on no_safe_target / no_path / nothing_found with avoid")
print("roughly flat points at the TERRAIN (a). Both moving means the reseed cannot")
print("separate them and a state-only reset is the experiment that can.")
