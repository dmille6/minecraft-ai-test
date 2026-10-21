import json, os, collections
os.chdir(os.path.dirname(os.path.abspath(__file__)))
R = [json.loads(l) for l in open('wetpos.jsonl')]
B = {str(b['id']): b for b in map(json.loads, open('blocks.jsonl'))}
FL = ('wet_feet', 'on_ice', 'ice_over_water', 'water_r2')

def tab(name, rows, key=lambda r, b: b):
    n = 0; c = collections.Counter(); miss = 0
    for i, r in rows:
        b = key(i, r)
        if not b or b.get('err'): miss += 1; continue
        n += 1
        for f in FL:
            c[f] += bool(b.get(f))
        c['any_wet'] += bool(b.get('wet_feet') or b.get('on_ice') or b.get('water_r2'))
    pct = {f: f'{c[f]}/{n} ({100 * c[f] / n:.1f}%)' if n else '-' for f in FL + ('any_wet',)}
    print(f'{name:58s} n={n:5d} miss={miss}', pct)

ix = list(enumerate(R))
res = [(i, r) for i, r in ix if r['kind'] == 'rescue']
amb = [(i, r) for i, r in ix if r['kind'] == 'ambient']
end = lambda i, r: B.get(str(i))
tgt = lambda i, r: B.get(f't{i}')
print('== END positions (the snapshot of the row) ==')
tab('canary  terminal: all rescues', [x for x in res if x[1]['arm'] == 'canary' and x[1]['src'] == 'terminal'], end)
tab('canary  terminal: L1 relocate completed:success', [x for x in res if x[1]['arm'] == 'canary' and x[1]['src'] == 'terminal' and x[1].get('skill') == 'goto' and x[1].get('phase') == 'completed:success'], end)
tab('canary  terminal: L2 home', [x for x in res if x[1]['arm'] == 'canary' and x[1]['src'] == 'terminal' and x[1].get('skill') == 'home'], end)
tab('canary  skill row goto watchdog_relocate success', [x for x in res if x[1]['arm'] == 'canary' and x[1]['src'] == 'skill_row' and x[1]['skill'] == 'goto' and x[1]['status'] == 'success'], end)
tab('control skill row goto watchdog_relocate success', [x for x in res if x[1]['arm'] == 'control' and x[1]['skill'] == 'goto' and x[1]['status'] == 'success'], end)
tab('canary  skill row goto watchdog_relocate (all)', [x for x in res if x[1]['arm'] == 'canary' and x[1]['src'] == 'skill_row' and x[1]['skill'] == 'goto'], end)
tab('control skill row goto watchdog_relocate (all)', [x for x in res if x[1]['arm'] == 'control' and x[1]['skill'] == 'goto'], end)
tab('canary  ambient (1 per bot per 5 min)', [x for x in amb if x[1]['arm'] == 'canary'], end)
tab('control ambient (1 per bot per 5 min)', [x for x in amb if x[1]['arm'] == 'control'], end)
print('== TARGETS (the random relocation point, at the start y) ==')
tab('canary  relocation targets', [x for x in res if x[1]['arm'] == 'canary' and x[1]['src'] == 'skill_row' and x[1]['skill'] == 'goto'], tgt)
tab('control relocation targets', [x for x in res if x[1]['arm'] == 'control' and x[1]['skill'] == 'goto'], tgt)
print('== per pool, canary arm: relocation success ends vs ambient ==')
for pool in ('hive-d', 'placebo-d', 'placebo-b', 'board-c'):
    tab(f'  {pool} relocate success ends', [x for x in res if x[1]['pool'] == pool and x[1]['src'] == 'skill_row' and x[1]['skill'] == 'goto' and x[1]['status'] == 'success'], end)
    tab(f'  {pool} ambient', [x for x in amb if x[1]['pool'] == pool], end)
print('== ice-over-water END positions (all rows) ==')
for i, r in res:
    b = B.get(str(i))
    if b and (b.get('ice_over_water') or b.get('wet_feet')):
        print('  ', r['arm'], r['src'], r['pool'], r['bot'], r['t'][11:19], r.get('skill'), r.get('phase') or r.get('status'), r['pos'],
              'feet', b['feet'], 'below', b['below'], 'head', b['head'], 'ice/water' if b.get('ice_over_water') else '', 'water120', r['water120'], 'drown120', r['drown120'])
