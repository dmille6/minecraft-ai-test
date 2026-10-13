"""Why do decisions abort or fail? Today's llm-*.jsonl (rotation: today's rows live in the current files; logs rotate
at 23:59Z), rows sorted by time per bot. Every bucket is a pattern on outcome.detail plus llm.admission
(null + aborted = refused at admission; non-null + aborted = admitted, then interrupted). Each bucket prints its count
and one example: the positive control that the pattern matches something real."""
import json, glob, collections, re, sys
since = sys.argv[1] if len(sys.argv) > 1 else '2026-10-10T00:00:00'
REFUSED = [
 ('veto:repeat_loop', r'chose the identical action'),
 ('veto:learned_avoid', r'has failed \d+x across runs'),
 ('veto:cooldown', r'failed recently; \d+s left'),
 ('veto:bank_gate(no storage in reach)', r'bankable items and no storage'),
 ('args:not held / not real item', r'you hold no |is not a real item|no .* in inventory to place|needs a block name|needs numeric'),
 ('args:impossible y (climb/downward/bedrock)', r'ABOVE your y|only digs DOWNWARD|below bedrock|descending would strand'),
 ('args:count out of range', r'count .* outside'),
 ('args:redundant (already hold/carry)', r'you already (hold|carry)'),
 ('model output:truncation sentinel', r'truncation sentinel'),
]
INTERRUPT = [
 ('reflex:entombed', r'^entombed'), ('reflex:stagnation', r'^stagnation'), ('reflex:stuck/stranded', r'^(stuck|stranded)'),
 ('reflex:danger/low_health/flood/death', r'^(danger_block|low_health|flooded_pocket|death)'),
 ('runner:timeout', r'^timeout'), ('runner:superseded', r'superseded'), ('runner:aborted (no reason)', r'^aborted$'),
]
FAILED = [
 ('fail:runner paused (repeated failures)', r'paused after repeated failures'),
 ('fail:target buried (needs mine)', r'every candidate is buried|use mine to dig'),
 ('fail:cannot stand within reach / candidates refused', r'could not stand within reach|candidate\\(s\\) in range refused|candidates? refused'),
 ('fail:no target in range', r'no \S+ within \d+|not found|none (visible|nearby)|no .* (nearby|in range)'),
 ('fail:unreachable / no path', r'unreachable|no route|empty path|pathfind|no path|could not reach|too far|cannot reach'),
 ('fail:time ran out', r'ran out of time|timed out|time limit'),
 ('fail:bag full', r'bag is \d+/36|no room|inventory (is )?full|full bag'),
 ('fail:missing ingredients/tool', r'missing|need(s)? \d+ more|requires|no (suitable )?(pickaxe|tool)|without a'),
 ('fail:storage/chest', r'chest|storage|deposit'),
 ('fail:beside water/falling/unsafe', r'beside water|falling|unsafe|lava'),
]
def bucket(rules, text):
    for name, pat in rules:
        if re.search(pat, text, re.I): return name
    return None
tot = collections.Counter(); b = collections.Counter(); ex = {}
for f in sorted(glob.glob('/var/log/mcai/*/llm-*.jsonl')):
    rows = []
    for l in open(f, errors='replace'):
        try: d = json.loads(l)
        except Exception: continue
        if d.get('@timestamp', '') >= since: rows.append(d)
    rows.sort(key=lambda d: d['@timestamp'])
    for d in rows:
        llm = d.get('llm') or {}; o = d.get('outcome') or {}; s = o.get('status'); det = o.get('detail') or ''
        kind = 'model' if (llm.get('latency_ms') or 0) > 0 else 'workorder'
        tot[(kind, s)] += 1
        if s == 'aborted':
            k = (bucket(REFUSED, det) or 'veto:other') if llm.get('admission') is None else (bucket(INTERRUPT, det) or 'interrupt:other')
            k = ('refused at admission | ' if llm.get('admission') is None else 'admitted, then interrupted | ') + k
        elif s == 'failed':
            k = 'failed | ' + (bucket(FAILED, det) or 'fail:other')
        else:
            continue
        b[(kind, k)] += 1; ex.setdefault((kind, k), det[:110])
for kind in ('model', 'workorder'):
    n = sum(v for (kk, s), v in tot.items() if kk == kind)
    print('== %s decisions: %d  (%s)' % (kind, n, ', '.join('%s %d (%.0f%%)' % (s, v, 100 * v / n) for (kk, s), v in sorted(tot.items(), key=lambda kv: -kv[1]) if kk == kind)))
    for (kk, k), v in sorted(b.items(), key=lambda kv: -kv[1]):
        if kk == kind: print('  %6d %5.1f%%  %-72s | e.g. %s' % (v, 100 * v / n, k, ex[(kk, k)]))
