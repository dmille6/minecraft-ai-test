#!/usr/bin/env python3
"""Fixed A1 SCREEN subset (seeded): 120 brain items proportional to the 420-item 10-05 strata, 24 stuck
(8 from the all-day stranded bots), 24 overseer (8 per stratum). Writes data/screen_ids.txt.
The screen is a SUBSET of the A2 selection set, so a full A2 run always contains the screen."""
import collections, json, os, random
HERE = os.path.dirname(os.path.abspath(__file__))
rng = random.Random(1005)
L = [json.loads(l) for l in open(os.path.join(HERE, 'data', 'mbench-sample.jsonl'))]
O = [json.loads(l) for l in open(os.path.join(HERE, 'data', 'mbench-overseer.jsonl'))]
by = collections.defaultdict(list)
for it in L:
    by[(it['set'], it['stratum'])].append(it['id'])
ids = []
brain = {k: v for k, v in by.items() if k[0] == 'brain'}
tot = sum(len(v) for v in brain.values())
for k in sorted(brain):
    v = sorted(brain[k]); rng.shuffle(v); ids += v[:round(120 * len(v) / tot)]
ALLDAY = ('board-a-Comet', 'placebo-c-Bravo', 'placebo-c-Echo', 'board-c-Bravo')
st = sorted([it for it in L if it['set'] == 'stuck'], key=lambda i: i['id']); rng.shuffle(st)
ids += [i['id'] for i in st if i['bot'] in ALLDAY][:8] + [i['id'] for i in st if i['bot'] not in ALLDAY][:16]
ob = collections.defaultdict(list)
for o in sorted(O, key=lambda o: o['id']):
    ob[o['stratum']].append(o['id'])
for k in sorted(ob):
    v = ob[k]; rng.shuffle(v); ids += v[:8]
open(os.path.join(HERE, 'data', 'screen_ids.txt'), 'w').write('\n'.join(ids) + '\n')
print(len(ids), collections.Counter(i.split('-')[0] for i in ids))
