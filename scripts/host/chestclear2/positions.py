# positions.py (runs on 10.0.0.31): candidate container positions per pool = the 10-04 census containers + every
# container coordinate named in bot logs since 10-04 (deposit/town deposit/withdraw rows: "x,y,z" tokens near "contain"/"tried").
import json, glob, re, gzip, os, sys
old = json.load(open(sys.argv[1]))
pos = {w: {'home': v['home'], 'pos': {tuple(c['pos']) for c in v['containers']}} for w, v in old['worlds'].items()}
PAT = re.compile(r'(-?\d+),(-?\d+),(-?\d+)(?==|:|;|\])')
files = glob.glob('/var/log/mcai/*/skill-*.jsonl') + glob.glob('/var/log/mcai/*/skill-*.jsonl-2026100[5-9].gz') + glob.glob('/var/log/mcai/*/skill-*.jsonl-2026101*.gz')
n = 0
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    try:
        fh = op(f, 'rt', errors='ignore')
    except Exception:
        continue
    for l in fh:
        if not any(k in l for k in ('"deposit"', '_town_deposit', '_withdraw_pick', '"withdraw_pick"', 'chest')): continue
        try: r = json.loads(l)
        except Exception: continue
        pool = (r.get('exp') or {}).get('pool')
        if pool not in pos: continue
        d = (r.get('skill') or {}).get('detail') or ''
        for m in PAT.finditer(d):
            x, y, z = map(int, m.groups()); h = pos[pool]['home']
            if abs(x - h[0]) <= 48 and abs(z - h[2]) <= 48 and abs(y - h[1]) <= 12:
                pos[pool]['pos'].add((x, y, z)); n += 1
out = {w: {'home': v['home'], 'pos': sorted(v['pos'])} for w, v in pos.items()}
json.dump(out, open('/tmp/cc2_positions.json', 'w'))
print('mentions', n, {w: len(v['pos']) for w, v in out.items()})
