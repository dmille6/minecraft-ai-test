#!/usr/bin/env python3
"""IS THE `nothing matching X to hand over` REFUSAL TRUE OR FALSE?

The claim under test is NEGATIVE ("the bot holds none of it"), so it carries a
positive control: the same field, same rows, must be shown finding something.
Denominator is printed before every number.
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

runs = []
for r in ev.rows:
    if str(r['name']) != 'deposit':
        continue
    b = (r['bot'] or {}).get('name', '')
    if not b or b.startswith('isolated') or b.startswith('self-isolated'):
        continue
    runs.append(r)

print(f"positive control: {len(ev.rows)} rows walked; {len(runs)} deposit runs, "
      f"{len({(r['bot'] or {}).get('name') for r in runs})} bots, 24 h")

# POSITIVE CONTROL ON THE INSTRUMENT ITSELF: bot.inventory must be present and non-empty
# on these rows, or every 'the bot held none' below is an artefact of a missing field.
have_inv = [r for r in runs if (r['raw'].get('bot') or {}).get('inventory')]
print(f"  rows carrying a non-empty bot.inventory: {len(have_inv)}/{len(runs)} "
      f"= {100*len(have_inv)/max(len(runs),1):.1f}%   <-- if this is low, stop reading")
if have_inv:
    ex = (have_inv[0]['raw']['bot']['inventory'])
    print(f"  example inventory: {dict(list(ex.items())[:6])}")

held = collections.Counter()      # refusal name -> times the bot DID hold it
notheld = collections.Counter()   # refusal name -> times it truly held none
noinv = collections.Counter()
byname_total = collections.Counter()
versions = collections.Counter()
for r in runs:
    sk = r['raw'].get('skill') or {}
    if (sk.get('status') or '') != 'no_effect':
        continue
    d = sk.get('detail') or ''
    if not d.startswith('nothing matching '):
        continue
    name = d[len('nothing matching '):].split(' to hand over')[0].strip()
    byname_total[name] += 1
    versions[((r['raw'].get('code') or {}).get('version') or '?')] += 1
    inv = (r['raw'].get('bot') or {}).get('inventory')
    if not inv:
        noinv[name] += 1
    elif inv.get(name, 0) > 0:
        held[name] += 1
    else:
        notheld[name] += 1

tot = sum(byname_total.values())
print(f"\n=== `nothing matching X to hand over` : {tot} runs "
      f"= {100*tot/max(len(runs),1):.1f}% of all deposit runs ===")
print(f"  code versions in this window: {dict(versions)}")
print(f"\n{'item':<18}{'runs':>7}{'HELD IT':>9}{'held %':>8}{'held none':>11}{'no inv':>8}")
for name, n in byname_total.most_common(12):
    h = held[name]
    print(f"{name:<18}{n:>7}{h:>9}{100*h/max(n,1):>7.1f}%{notheld[name]:>11}{noinv[name]:>8}")
H, N, X = sum(held.values()), sum(notheld.values()), sum(noinv.values())
print(f"{'TOTAL':<18}{tot:>7}{H:>9}{100*H/max(tot,1):>7.1f}%{N:>11}{X:>8}")
print(f"\nFALSE refusals (bot demonstrably held the item it was told it had none of): "
      f"{H} = {100*H/max(tot,1):.1f}% of these refusals, "
      f"{100*H/max(len(runs),1):.1f}% of ALL {len(runs)} deposit runs")
