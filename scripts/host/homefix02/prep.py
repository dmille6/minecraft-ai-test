import json, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
R = [json.loads(l) for l in open('wetpos.jsonl')]
n = 0
with open('positions.jsonl', 'w') as out:
    for i, r in enumerate(R):
        if r['kind'] in ('rescue', 'ambient') and r.get('pos'):
            out.write(json.dumps({'id': i, 'pool': r['pool'], 'pos': r['pos']}) + '\n'); n += 1
        if r['kind'] == 'rescue' and r.get('target') and 'x' in r['target']:
            t = r['target']
            out.write(json.dumps({'id': f't{i}', 'pool': r['pool'], 'pos': {'x': t['x'], 'y': t.get('y', 64), 'z': t['z']}}) + '\n'); n += 1
print(n)
