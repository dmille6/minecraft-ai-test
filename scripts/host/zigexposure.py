# exposure.py SITES.json SINCE UNTIL -- bot-minutes within R of each site (distinct bot x minute with a position there).
import sys, glob, gzip, json
from collections import defaultdict
S = json.load(open(sys.argv[1])); SINCE, UNTIL = sys.argv[2], sys.argv[3]
mins = defaultdict(set)
for bdir in sorted(glob.glob('/var/log/mcai/*-*-*/')):
    fs = sorted(f for f in glob.glob(bdir + 'skill-*.jsonl-*.gz') if f[-11:-3] >= '20261015') + glob.glob(bdir + 'skill-*.jsonl')
    for f in fs:
        op = gzip.open if f.endswith('.gz') else open
        for line in op(f, 'rt', errors='ignore'):
            if '"pos"' not in line: continue
            try: r = json.loads(line)
            except Exception: continue
            t = r.get('@timestamp', '')
            if not (SINCE <= t < UNTIL): continue
            b = r.get('bot') or {}; n = b.get('name') or ''; pos = b.get('pos')
            pool = '-'.join(n.split('-')[:2])
            if pool not in S or not pos: continue
            s = S[pool]; m = (n, t[:16])
            mins[(pool, 'all')].add(m)
            h = s['home']; d = lambda c: max(abs(pos['x'] - c['x']), abs(pos['z'] - c['z']))
            if d(h) <= 32: mins[(pool, 'home32')].add(m)
            if s['zig'] and d(s['zig']) <= 32: mins[(pool, 'zig32')].add(m)
            if s['shaft'] and d(s['shaft']) <= 16: mins[(pool, 'shaft16')].add(m)
for p in S:
    a = len(mins[(p, 'all')]) / 60
    print('%-10s bot-h %6.1f | home<=32 %5.1f (%4.1f%%) | zig<=32 %5.1f (%4.1f%%) | shaft<=16 %5.1f (%4.1f%%)' % (p, a, len(mins[(p,'home32')])/60, 100*len(mins[(p,'home32')])/60/max(a,1e-9), len(mins[(p,'zig32')])/60, 100*len(mins[(p,'zig32')])/60/max(a,1e-9), len(mins[(p,'shaft16')])/60, 100*len(mins[(p,'shaft16')])/60/max(a,1e-9)))
