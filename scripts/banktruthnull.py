#!/usr/bin/env python3
"""CALIBRATE THE GATE BEFORE IT CAN REVERT (rule v16).

THE ENDPOINT IS DEFINED ON TYPED FIELDS, NOT PROSE, AND THAT IS NOT A STYLE
CHOICE. The change under test REWRITES the refusal string. An endpoint that
counted rows matching "nothing matching <item> to hand over" would fall to zero
in the canary arm BY CONSTRUCTION -- a -100% read caused by the wording, not by
the bots. That is `consequence-rows-are-not-linkage` with a new face.

So: a false refusal is  skill.status == 'no_effect'  AND  skill.args.item named.
Both builds emit exactly that. A repeat is the same (bot, item) pair seen again
inside the window. Endpoint = repeats / all deposit runs, as a percentage.

This script measures the NULL: the same statistic on random 4-pool splits of a
fleet on ONE code version with NOTHING deployed. Every draw is a placebo.

Usage: banktruthnull.py [n_draws] [window_min]
"""
import sys, os, glob, random, statistics as st, collections, datetime as dt
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

NDRAW = int(sys.argv[1]) if len(sys.argv) > 1 else 200
W     = float(sys.argv[2]) if len(sys.argv) > 2 else 360.0
PRE   = 180.0
SETTLED = dt.datetime(2026, 9, 22, 18, 20, tzinfo=dt.timezone.utc)

ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=1440)
tags = sorted({os.path.basename(p).split('-')[-1]
               for p in glob.glob('/var/log/mcai/*/skill-*.jsonl-*.gz')})[-2:]
for tag in tags:
    ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}',
                               since_minutes=1440).rows)

rows = [r for r in ev.rows
        if (r['bot'] or {}).get('name')
        and not (r['bot'] or {}).get('name', '').startswith(('isolated', 'self-isolated'))
        and r['t'] >= SETTLED]
vers = collections.Counter(((r['raw'].get('code') or {}).get('version') or '?') for r in rows)
print(f"positive control: {len(rows)} rows after {SETTLED:%d %b %H:%M}Z; versions {dict(vers)}")
assert len(vers) == 1, f"NOT ONE VERSION -- a null across a deploy boundary is not a null: {dict(vers)}"

def named_item(sk):
    a = sk.get('args')
    v = a.get('item') if isinstance(a, dict) else (a[0] if isinstance(a, list) and a else a)
    v = None if v is None else str(v).strip()
    return v if v and v.lower() not in ('', 'none', 'null', 'any', 'all', 'everything',
                                        'items', 'inventory', 'undefined') else None

dep = [r for r in rows if str(r['name']) == 'deposit']
# POSITIVE CONTROL ON THE TYPED DEFINITION: it must find the population the prose
# version found, or the whole calibration is measuring an empty set.
noop_named = [r for r in dep
              if ((r['raw'].get('skill') or {}).get('status') or '') == 'no_effect'
              and named_item(r['raw'].get('skill') or {})]
print(f"  {len(dep)} deposit runs; typed no_effect+named = {len(noop_named)} "
      f"({100*len(noop_named)/max(len(dep),1):.1f}%)")
assert noop_named, 'the typed definition finds nothing -- stop'

pools = sorted({(r['bot'] or {}).get('name', '').rsplit('-', 1)[0] for r in rows} - {''})
tmin, tmax = min(r['t'] for r in rows), max(r['t'] for r in rows)
span = (tmax - tmin).total_seconds() / 60
print(f"  {len(pools)} pools, {span:.0f} min of single-version fleet")
assert span >= PRE + W, f"only {span:.0f} min available, need {PRE+W:.0f}"

def share(sub, hours):
    """REPEATS PER BOT-HOUR, not a share of runs.

    The share version conditioned on attempts: its denominator is deposit runs,
    which is exactly what the treatment moves. `metric-must-not-condition-on-
    attempts` -- escape rate rose while deaths tripled, on that same mistake.
    A rate per bot-hour has a denominator the change cannot touch."""
    if hours <= 0: return None
    seen, rep = set(), 0
    for r in sorted(sub, key=lambda x: x['t']):
        sk = r['raw'].get('skill') or {}
        if (sk.get('status') or '') != 'no_effect': continue
        it = named_item(sk)
        if not it: continue
        key = ((r['bot'] or {}).get('name'), it)
        if key in seen: rep += 1
        seen.add(key)
    return rep / hours

rng = random.Random(20260923)
dids, skipped = [], 0
for _ in range(NDRAW):
    off = rng.uniform(PRE, span - W)
    cut = tmin + dt.timedelta(minutes=off)
    can = set(rng.sample(pools, 4))
    buckets = {('c','pre'): [], ('c','post'): [], ('k','pre'): [], ('k','post'): []}
    # bot-hours per arm/era from the SPAN OF ALL ROWS, not deposit rows: a bot
    # that stopped depositing entirely must still count its hours, or the rate
    # silently re-acquires the denominator the share version had.
    botspan = {k: {} for k in buckets}
    for r in rows:
        d = (r['t'] - cut).total_seconds() / 60
        if d < -PRE or d > W: continue
        b = (r['bot'] or {}).get('name','')
        k = ('c' if b.rsplit('-',1)[0] in can else 'k', 'post' if d >= 0 else 'pre')
        lo_hi = botspan[k].get(b)
        botspan[k][b] = (r['t'], r['t']) if lo_hi is None else (min(lo_hi[0], r['t']), max(lo_hi[1], r['t']))
    hrs = {k: sum((hi - lo).total_seconds()/3600 for lo, hi in v.values()) for k, v in botspan.items()}
    for r in dep:
        d = (r['t'] - cut).total_seconds() / 60
        if d < -PRE or d > W: continue
        arm = 'c' if (r['bot'] or {}).get('name','').rsplit('-',1)[0] in can else 'k'
        buckets[(arm, 'post' if d >= 0 else 'pre')].append(r)
    vals = {k: share(v, hrs[k]) for k, v in buckets.items()}
    if any(v is None for v in vals.values()): skipped += 1; continue
    dids.append((vals[('c','post')] - vals[('c','pre')]) - (vals[('k','post')] - vals[('k','pre')]))

print(f"\n=== NULL of the repeat-refusal RATE DiD (typed, per bot-hour), k=4 pools / 20 bots, pre {PRE:.0f} / post {W:.0f} min ===")
print(f"  usable draws {len(dids)} of {NDRAW} (skipped {skipped})")
if len(dids) >= 20:
    m, s = st.mean(dids), st.pstdev(dids); q = sorted(dids)
    pc = lambda p: q[min(len(q)-1, int(p*len(q)))]
    print(f"  mean {m:+.3f} /bot-h   sd {s:.3f} /bot-h")
    print(f"  p01 {pc(.01):+.3f}  p05 {pc(.05):+.3f}  p50 {pc(.50):+.3f}  p95 {pc(.95):+.3f}  p99 {pc(.99):+.3f}")
    for x in (0.2, 0.3, 0.4, 0.5, 0.75, 1.0):
        print(f"  a gate at -{x:.2f}/bot-h fires on {100*sum(1 for d in dids if d <= -x)/len(dids):5.1f}% of NO-CHANGE draws")
    print(f"  MDE at 2 sd = {2*s:.3f}/bot-h;  one-sided 5% threshold = {pc(.05):.3f}/bot-h")
