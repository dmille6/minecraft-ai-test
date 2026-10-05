#!/usr/bin/env python3
"""Re-attach a longer body log (last 150 rows before the decision) to the STUCK items of an existing
sample, without redrawing it. READ-ONLY on the bots host.   python3 refresh_stuck_context.py IN OUT"""
import json, sys
items = [json.loads(l) for l in open(sys.argv[1])]
for g in items:
    if g['set'] != 'stuck':
        continue
    prev = []
    for line in open('/var/log/mcai/%s/skill-%s.jsonl' % (g['bot'], g['bot']), errors='replace'):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get('@timestamp', '') >= g['t']:
            continue
        sk = r.get('skill') or {}
        prev.append({'t': r.get('@timestamp'), 'trigger': r.get('trigger'), 'name': sk.get('name'),
                     'args': sk.get('args'), 'status': sk.get('status'), 'detail': (sk.get('detail') or '')[:220],
                     'pos': (r.get('bot') or {}).get('pos')})
    prev.sort(key=lambda x: x['t'])
    g['recent_rows'] = prev[-150:]
with open(sys.argv[2], 'w') as fh:
    for g in items:
        fh.write(json.dumps(g) + '\n')
print('refreshed', sum(1 for g in items if g['set'] == 'stuck'))
