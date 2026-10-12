"""orderveto read 3: the bag-full craft failures -- which remedy did craftroom name, and what did the bots do with the
model's decisions in that state (control behaviour for a yield). Today's llm rows, 00:00-13:28Z, full walk."""
import json, glob, collections, re
SINCE, UNTIL = '2026-10-10T00:00:00', '2026-10-10T13:28:00'
adv = collections.Counter(); ex = {}
after = collections.Counter()      # the model's NEXT decision after a bag-full craft-order failure: (skill, admitted/refused reason)
after_ex = {}
dep_ref = collections.Counter()
n_model_after = 0
for f in sorted(glob.glob('/var/log/mcai/*/llm-*.jsonl')):
    rows = []
    for l in open(f, errors='replace'):
        if '"@timestamp":"2026-10-10' not in l[:40]:
            continue
        try:
            d = json.loads(l)
        except Exception:
            continue
        t = d.get('@timestamp', '')
        if not (SINCE <= t < UNTIL):
            continue
        llm = d.get('llm') or {}; o = d.get('outcome') or {}
        tc = (d.get('tool_calls') or [None])[0] or {}
        resp = ((d.get('response') or {}).get('text') or '')
        src = 'order' if (llm.get('latency_ms') or 0) == 0 and not resp and tc.get('skill') else 'model'
        rows.append((t, src, tc.get('skill'), tc.get('args'), llm.get('admission') is not None, o.get('status'), o.get('detail') or '', llm.get('error')))
    rows.sort(key=lambda r: r[0])
    pending = False
    for t, src, sk, args, adm, st, det, err in rows:
        if src == 'order' and sk == 'craft' and adm and st == 'failed' and re.search(r'frees slots|No room|no room', det):
            k = det.split(' -- ')[0].split(' ')[0] if ' -- ' in det else det[:30]
            adv[k] += 1; ex.setdefault(k, det[:200])
            pending = True
            continue
        if pending and src == 'model':
            n_model_after += 1
            v = 'admitted' if adm else ('refused ' + str(err))
            after[(sk, v)] += 1; after_ex.setdefault((sk, v), det[:140])
            pending = False
        if src == 'model' and sk == 'deposit' and not adm:
            dep_ref[err] += 1
print('BAG-FULL craft-order failures by the remedy craftroom named (first word):')
for k, v in adv.most_common(12):
    print('  %6d  %-12s e.g. %s' % (v, k, ex[k]))
print('\nThe FIRST model decision after a bag-full craft-order failure (n=%d):' % n_model_after)
for (s, v), c in after.most_common(20):
    print('  %6d  %-14s %-28s e.g. %s' % (c, s, v, after_ex[(s, v)]))
print('\nModel deposit proposals refused, by reason (all bots):', dict(dep_ref.most_common()))
