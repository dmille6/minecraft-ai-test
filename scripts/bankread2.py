#!/usr/bin/env python3
"""SIZING THE DEPOSIT-TRUTH CHANGE BEFORE BUILDING IT.

Three questions, each with its denominator printed:
 1. How often is the named item NOT already lowercase (would normalisation fire)?
 2. Is the refusal a LOOP -- does the same bot re-propose the same item?
 3. What is the EFFECT CEILING: if every repeat after the first vanished,
    how much of the deposit path is freed?
"""
import sys, os, glob, collections
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=1440)
tags = sorted({os.path.basename(p).split('-')[-1]
               for p in glob.glob('/var/log/mcai/*/skill-*.jsonl-*.gz')})[-2:]
for tag in tags:
    ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}',
                               since_minutes=1440).rows)

runs = [r for r in ev.rows
        if str(r['name']) == 'deposit'
        and (r['bot'] or {}).get('name')
        and not (r['bot'] or {}).get('name', '').startswith(('isolated', 'self-isolated'))]
print(f"positive control: {len(ev.rows)} rows walked; {len(runs)} deposit runs, "
      f"{len({(r['bot'] or {}).get('name') for r in runs})} bots, 24 h")

# --- 1. the argument as the MODEL typed it -------------------------------------
args, noarg, nonlower = collections.Counter(), 0, collections.Counter()
for r in runs:
    sk = r['raw'].get('skill') or {}
    a = sk.get('args')
    v = None
    if isinstance(a, dict):
        v = a.get('item') or a.get('0') or None
    elif isinstance(a, list) and a:
        v = a[0]
    elif isinstance(a, str):
        v = a
    if v is None or str(v).strip() == '':
        noarg += 1
        continue
    v = str(v)
    args[v] += 1
    if v != v.strip().lower():
        nonlower[v] += 1
print(f"\n=== 1. the item argument, as typed ===")
print(f"  runs with NO item (deposit everything): {noarg}/{len(runs)} = {100*noarg/max(len(runs),1):.1f}%")
print(f"  runs with an item: {sum(args.values())}; distinct spellings {len(args)}")
print(f"  NOT already lowercase/trimmed: {sum(nonlower.values())} "
      f"= {100*sum(nonlower.values())/max(sum(args.values()),1):.2f}% of named runs"
      f"  {dict(nonlower.most_common(5)) if nonlower else '(none)'}")
print(f"  POSITIVE CONTROL for that check — top spellings seen: {dict(args.most_common(5))}")

# --- 2 & 3. the loop -----------------------------------------------------------
seq = collections.defaultdict(list)
for r in sorted(runs, key=lambda x: x['t']):
    sk = r['raw'].get('skill') or {}
    d = sk.get('detail') or ''
    if (sk.get('status') or '') != 'no_effect' or not d.startswith('nothing matching '):
        continue
    name = d[len('nothing matching '):].split(' to hand over')[0].strip()
    seq[(r['bot'] or {}).get('name')].append(name)

tot = sum(len(v) for v in seq.values())
pairs = collections.Counter()
for b, names in seq.items():
    for nm in names:
        pairs[(b, nm)] += 1
firsts = len(pairs)
repeats = tot - firsts
print(f"\n=== 2. is it a loop? ===")
print(f"  false refusals: {tot} over {len(seq)} bots")
print(f"  distinct (bot, item) pairs: {firsts}")
print(f"  REPEATS of a pair the bot was already told about: {repeats} "
      f"= {100*repeats/max(tot,1):.1f}% of the refusals")
worst = pairs.most_common(8)
print(f"  worst pairs: " + ", ".join(f"{b.split('-')[-1]}@{b[:8]}/{nm} x{c}" for (b, nm), c in worst))

print(f"\n=== 3. effect ceiling (E/N) ===")
print(f"  N = all deposit runs                      {len(runs)}")
print(f"  E = refusal repeats a truthful message could remove   {repeats}")
print(f"  ceiling = {100*repeats/max(len(runs),1):.1f} pp of the deposit path")
