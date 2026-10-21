#!/usr/bin/env python3
"""learning-loop prototype: do the extracted labels track the fleet's own outcomes? (read-only, scratch only)

    nice -n 19 python3 label_check.py ~/learnloop-scratch-1021/day-20261020

1. Per label, over decisions whose 600 s window is OBSERVED (censored windows excluded and counted): items that ENDED
   in the window -- all, and `items_other` (the decision's own skill row excluded: the non-circular check) -- and the
   share of decisions followed by a death / stagnation / milestone. Windows overlap: one death is seen by every
   decision in the 600 s before it, so these are "decisions followed by", never event counts.
2. Per bot: the label shares against the bot's INDEPENDENT production (summary.json per_bot: brainread's items over
   every skill row, and gathered items excluding transfer skills), per decision-hour. Spearman rho across bots with a
   world-cluster bootstrap 95% interval (16 worlds resampled; a bot is not an independent unit, its world is).
3. Join misses by outcome status; decisions per world (the held-out unit) and per code version; the pilot pool.
"""
import collections, glob, gzip, json, os, random, statistics as st, sys

D = sys.argv[1]
summ = json.load(open(os.path.join(D, 'summary.json')))
lab = collections.defaultdict(collections.Counter); n_lab = collections.Counter(); cens = collections.Counter()
bot = collections.defaultdict(collections.Counter)
world = collections.Counter(); ver = collections.Counter(); hard = collections.Counter(); hard_n = 0
miss = collections.Counter(); joined = collections.Counter(); jq = collections.Counter()
for f in sorted(glob.glob(os.path.join(D, 'triples', '*.jsonl.gz'))):
    b = os.path.basename(f)[:-9]
    for line in gzip.open(f, 'rt'):
        r = json.loads(line); L = r['label']; w = r['window']
        B = bot[b]; B['n'] += 1; B[L] += 1; B['refused'] += r['gate']['refused']
        B['success'] += (r['outcome']['status'] == 'success' and not r['gate']['refused'])
        world[r['world']] += 1; ver[r['code_version']] += 1
        if not r['gate']['refused']:
            (joined if r['outcome']['join'] != 'none' else miss)[r['outcome']['status']] += 1
            jq[r['outcome']['join']] += 1
        if r['prompt_complete'] and L != 'void' and (r['gate']['refused'] or r['outcome']['status'] in ('failed', 'aborted')):
            hard[r['action']['skill']] += 1; hard_n += 1
        if not w['600']['observed']:
            cens[L] += 1; continue
        n_lab[L] += 1; c = lab[L]
        for k in ('items', 'items_other'):
            c[k + '120'] += w['120'][k]; c[k + '600'] += w['600'][k]
        c['death600'] += w['600']['deaths'] > 0; c['stag120'] += w['120']['stagnation'] > 0; c['ms120'] += w['120']['milestones'] > 0

print('== per label: decisions with an OBSERVED 600 s window (censored, excluded: %s)' % dict(cens))
for L in ('good', 'neutral', 'bad', 'void'):
    n = n_lab[L]; c = lab[L]
    if not n: continue
    print('%-8s n=%7d | items/dec 120s %.2f (other %.2f) 600s %.2f (other %.2f) | per 1k decisions followed by: death<=600s %.1f, '
          'stagnation<=120s %.0f, milestone<=120s %.0f' % (L, n, c['items120'] / n, c['items_other120'] / n, c['items600'] / n,
                                                           c['items_other600'] / n, 1000 * c['death600'] / n, 1000 * c['stag120'] / n, 1000 * c['ms120'] / n))


def rank(xs):
    o = sorted(range(len(xs)), key=lambda i: xs[i]); r = [0.0] * len(xs); i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and xs[o[j + 1]] == xs[o[i]]: j += 1
        for k in range(i, j + 1): r[o[k]] = (i + j) / 2
        i = j + 1
    return r


def rho(a, b):
    ra, rb = rank(a), rank(b); ma, mb = st.mean(ra), st.mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb)); den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** .5
    return num / den if den else float('nan')


pb = summ['per_bot']
bs = [b for b in bot if pb.get(b, {}).get('bot_h', 0) > 6]
worlds = sorted({pb[b]['world'] for b in bs}); rng = random.Random(1021)
print('\n== per bot: n=%d bots with > 6 h of decisions, %d worlds; production from ALL skill rows (independent of the joins)' % (len(bs), len(worlds)))
for prod in ('items_all', 'items_gathered'):
    y = {b: pb[b].get(prod, 0) / pb[b]['bot_h'] for b in bs}
    v = sorted(y.values())
    print('%s/bot-h: median %.1f, p10 %.1f, p90 %.1f' % (prod, st.median(v), v[len(v) // 10], v[9 * len(v) // 10]))
    for k in ('good', 'success', 'refused', 'bad'):
        sh = {b: bot[b][k] / bot[b]['n'] for b in bs}
        est = rho([sh[b] for b in bs], [y[b] for b in bs]); boots = []
        for _ in range(1000):
            ws = [rng.choice(worlds) for _ in worlds]; sel = [b for w in ws for b in bs if pb[b]['world'] == w]
            if len(sel) > 5: boots.append(rho([sh[b] for b in sel], [y[b] for b in sel]))
        boots.sort()
        print('  rho(%-7s share, %s/bot-h) = %+.2f  [%+.2f, %+.2f] world-cluster bootstrap' % (k, prod, est, boots[25], boots[975]))
print('\n== join of admitted decisions to their executed skill row, by outcome status')
print('join quality (exact = unique status+detail match; ambiguous = >1 exact, earliest taken; none = no exact match):', dict(jq))
print('joined (exact or ambiguous) by status', dict(joined.most_common())); print('missed by status', dict(miss.most_common()))
print('\n== decisions per world (pool unit for held-out splits)'); print(dict(sorted(world.items())))
print('== per code version', dict(ver.most_common()))
print('\n== hard decisions (complete prompt, refused or failed/aborted, void excluded): %d' % hard_n); print(dict(hard.most_common(12)))
