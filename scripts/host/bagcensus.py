# bagcensus.py -- latest inventory snapshot per bot (newest row in each live skill log), slots per item (ceil(count/stack)).
import glob, json, math, os, sys
from collections import Counter, defaultdict
stack = json.load(open(os.path.expanduser('~/stack.json')))
bots = {}
for f in glob.glob('/var/log/mcai/*/skill-*.jsonl'):
    try:
        with open(f, 'rb') as fh:
            fh.seek(0, 2); n = fh.tell(); fh.seek(max(0, n - 200000)); tail = fh.read().decode('utf-8', 'ignore').splitlines()
    except OSError:
        continue
    for line in reversed(tail):
        try:
            r = json.loads(line)
        except Exception:
            continue
        b = r.get('bot') or {}; inv = b.get('inventory')
        if isinstance(inv, dict) and b.get('name'):
            if r['@timestamp'] >= '2026-10-07T16:30':
                bots[b['name']] = (r['@timestamp'], inv, (r.get('exp') or {}).get('pool'))
            break
print('bots with a snapshot since 16:30Z:', len(bots))
slots = Counter(); count = Counter(); holders = Counter(); perbot = []
for name, (t, inv, pool) in bots.items():
    s = 0
    for it, c in inv.items():
        k = math.ceil(c / stack.get(it, 64)) if c > 0 else 0
        slots[it] += k; count[it] += c; holders[it] += 1; s += k
    perbot.append((s, name))
perbot.sort()
S = [s for s, _ in perbot]
print('slots used per bot: min %d median %d max %d | >= 34: %d of %d | full (36): %d' % (S[0], S[len(S)//2], S[-1], sum(x >= 34 for x in S), len(S), sum(x >= 36 for x in S)))
tot = sum(slots.values())
print('total slots used %d of %d (%.0f%%)' % (tot, 36 * len(bots), 100 * tot / (36 * len(bots))))
print('%-26s %6s %6s %8s %8s' % ('item', 'slots', 'share', 'holders', 'count'))
for it, k in slots.most_common(60):
    print('%-26s %6d %5.1f%% %8d %8d' % (it, k, 100 * k / tot, holders[it], count[it]))
json.dump({'bots': {n: v[1] for n, v in bots.items()}}, open(os.path.expanduser('~/bagcensus-latest.json'), 'w'))
