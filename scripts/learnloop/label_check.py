#!/usr/bin/env python3
"""learning-loop prototype: do the extracted labels track the fleet's own outcomes? (read-only, scratch only)

    nice -n 19 python3 label_check.py ~/learnloop-scratch-1021/day-20261020

1. Per label: mean items gained in the 120 s / 600 s windows, deaths and stagnation per 1k decisions (denominators printed).
2. Per bot (the unit the fleet's reads use): good-share, refused-share and success-share against the bot's items per
   decision-hour over the day; Spearman rho across bots, with the bot count. A label that does not rank bots the way
   their output does is not a training target.
3. Split readiness: decisions per world (pool unit) and per code version, so held-out sets by pool AND by date are sized.
4. Hard-decision pool for the teacher pilot: refused or failed decisions whose prompt is complete, by skill.
"""
import collections, glob, gzip, json, os, statistics as st, sys
from datetime import datetime

D = sys.argv[1]
lab = collections.defaultdict(lambda: collections.Counter()); n_lab = collections.Counter()
bot = collections.defaultdict(collections.Counter); hours = {}
world = collections.Counter(); ver = collections.Counter(); hard = collections.Counter(); hard_n = 0
P = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))
for f in sorted(glob.glob(os.path.join(D, 'triples', '*.jsonl.gz'))):
    b = os.path.basename(f)[:-9]; ts = []
    for line in gzip.open(f, 'rt'):
        r = json.loads(line); L = r['label']; w = r['window']
        n_lab[L] += 1
        c = lab[L]; c['items120'] += w['120']['items']; c['items600'] += w['600']['items']
        c['deaths600'] += w['600']['deaths']; c['stag120'] += w['120']['stagnation']
        c['ms120'] += w['120']['milestones']
        B = bot[b]; B['n'] += 1; B[L] += 1; B['refused'] += r['gate']['refused']
        B['success'] += (r['outcome']['status'] == 'success' and not r['gate']['refused'])
        B['own_items'] += sum(v for v in (r['outcome']['inventory_delta'] or {}).values() if isinstance(v, (int, float)) and v > 0)
        ts.append(r['ts'])
        pool = r['pool'] or '?'
        world[pool.replace('self-', '').rsplit('-', 1)[0] if pool.startswith('self-') else pool] += 1
        ver[r['code_version']] += 1
        if r['prompt_complete'] and (r['gate']['refused'] or r['outcome']['status'] in ('failed', 'aborted')):
            hard[r['action']['skill']] += 1; hard_n += 1
    if ts:
        hours[b] = (P(max(ts)) - P(min(ts))).total_seconds() / 3600

print('== per label (denominator = model decisions with that label)')
for L in ('good', 'neutral', 'bad'):
    n = n_lab[L]; c = lab[L]
    print('%-8s n=%7d  items/dec 120s %.2f 600s %.2f | deaths/1k (600s) %.2f | stagnation/1k (120s) %.1f | milestones/1k (120s) %.1f'
          % (L, n, c['items120'] / n, c['items600'] / n, 1000 * c['deaths600'] / n, 1000 * c['stag120'] / n, 1000 * c['ms120'] / n))


def rank(xs):
    o = sorted(range(len(xs)), key=lambda i: xs[i]); r = [0.0] * len(xs); i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and xs[o[j + 1]] == xs[o[i]]: j += 1
        for k in range(i, j + 1): r[o[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rank(a), rank(b); ma, mb = st.mean(ra), st.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** .5
    return num / den if den else float('nan')


bs = [b for b in bot if hours.get(b, 0) > 6]
items_h = [bot[b]['own_items'] / hours[b] for b in bs]
print('\n== per bot (n=%d bots with > 6 h of decisions); outcome = items gained by its own admitted skills per hour' % len(bs))
print('items/bot-h: median %.1f, p10 %.1f, p90 %.1f' % (st.median(items_h), sorted(items_h)[len(bs) // 10], sorted(items_h)[9 * len(bs) // 10]))
for k in ('good', 'success', 'refused', 'bad'):
    sh = [bot[b][k] / bot[b]['n'] for b in bs]
    print('rho(%-7s share, items/bot-h) = %+.2f   (share median %.3f)' % (k, spearman(sh, items_h), st.median(sh)))
print('\n== decisions per world (pool unit for held-out splits)')
print(dict(sorted(world.items())))
print('== per code version', dict(ver.most_common()))
print('\n== hard decisions (complete prompt, refused or failed/aborted): %d' % hard_n)
print(dict(hard.most_common(12)))
