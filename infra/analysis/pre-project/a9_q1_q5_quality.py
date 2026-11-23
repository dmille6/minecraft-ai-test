"""a9 Q1 (release vs decision quality) and Q5 (latency vs quality), from the Opus v3 answer key.
Input ~/mcai9/labels.parquet (a9_labels.py). Pure python + duckdb (no numpy on the VM).
sensible = decision_ok=='yes'; denominator = yes+no+unclear.
Adjustment: within-cell comparisons with the month field dropped from the cell key
(cell = month|world|skill|status|trigger|place|load|has_pick|flag); bootstrap over cells.
"""
import duckdb, math, random, collections, json, os
random.seed(9)
c = duckdb.connect(); c.execute("set threads=2")
L = c.sql("""select id, slice, cell, run, code, world, latency_ms, prompt_tokens, completion_tokens, model,
   mts, (decision_ok='yes')::int ok, gate_error, status from read_parquet('~/mcai9/labels.parquet')""").fetchall()
cols = ['id','slice','cell','run','code','world','lat','pt','ct','model','ts','ok','gate','status']
L = [dict(zip(cols, r)) for r in L]
for r in L: r['k'] = '|'.join(r['cell'].split('|')[1:])
out = {}
def wilson(k, n, z=1.96):
    if n == 0: return (float('nan'),)*3
    p = k/n; d = 1+z*z/n; m = (p+z*z/(2*n))/d; h = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return p, m-h, m+h
print('== total labeled', len(L), 'sensible', sum(r['ok'] for r in L))
# --- trend on the simple random slice
print('\n== Q1a SRS slice0 sensible rate by month')
by = collections.defaultdict(list)
for r in L:
    if r['slice'] == 0: by[r['ts'][:7]].append(r['ok'])
for m in sorted(by):
    v = by[m]; p, lo, hi = wilson(sum(v), len(v)); print(f'{m}: {sum(v)}/{len(v)} = {p:.3f} [{lo:.3f},{hi:.3f}]')
def adj_diff(A, B, nboot=400):
    """weighted within-cell diff mean(A)-mean(B), weights = n_A in cell; bootstrap cells."""
    ga = collections.defaultdict(list); gb = collections.defaultdict(list)
    for r in A: ga[r['k']].append(r['ok'])
    for r in B: gb[r['k']].append(r['ok'])
    cells = [k for k in ga if k in gb]
    def est(cs):
        num = den = 0
        for k in cs:
            a, b = ga[k], gb[k]; num += len(a)*(sum(a)/len(a)-sum(b)/len(b)); den += len(a)
        return num/den if den else float('nan'), den
    e, n = est(cells)
    if not cells: return None
    bs = sorted(est([random.choice(cells) for _ in cells])[0] for _ in range(nboot))
    return e, bs[int(.025*nboot)], bs[int(.975*nboot)], n, len(cells)
# --- eras: runs ordered by first ts; fleet world only, runs with >=120 labels
runs = collections.defaultdict(list)
for r in L:
    if r['world'] != 'showcase': runs[r['run']].append(r)
era = sorted([k for k, v in runs.items() if len(v) >= 120], key=lambda k: min(x['ts'] for x in runs[k]))
print('\n== Q1b sequential eras (fleet, runs with >=120 labels): era vs previous era, within-cell (month dropped)')
res = []
for i in range(1, len(era)):
    a, b = era[i], era[i-1]
    d = adj_diff(runs[a], runs[b])
    raw = sum(x['ok'] for x in runs[a])/len(runs[a])
    if d: res.append((a, b, len(runs[a]), raw) + d)
for a, b, n, raw, e, lo, hi, m, nc in res:
    flag = ' *' if lo > 0 or hi < 0 else ''
    print(f'{a:38s} vs {b:34s} n={n:4d} raw={raw:.3f} adj={e:+.3f} [{lo:+.3f},{hi:+.3f}] matched={m} cells={nc}{flag}')
print(f'eras compared: {len(res)}; CI excludes 0: {sum(1 for x in res if x[5]>0 or x[6]<0)} (expect ~{0.05*len(res):.1f} by chance)')
# --- each run vs all concurrent other runs (same cell, ts within run window)
print('\n== Q1c each run (>=150 labels) vs everything else, within-cell incl. month (controls time coarsely)')
allr = [r for r in L]
res2 = []
for k, v in runs.items():
    if len(v) < 150: continue
    others = [r for r in allr if r['run'] != k and r['cell'].split('|')[0] in {x['cell'].split('|')[0] for x in v}]
    for r in v: r['k2'] = r['cell']
    A = [dict(r, k=r['cell']) for r in v]; B = [dict(r, k=r['cell']) for r in others]
    d = adj_diff(A, B, 300)
    if d: res2.append((k, len(v)) + d)
res2.sort(key=lambda x: x[2])
for k, n, e, lo, hi, m, nc in res2:
    flag = ' *' if lo > 0 or hi < 0 else ''
    print(f'{k:38s} n={n:4d} adj={e:+.3f} [{lo:+.3f},{hi:+.3f}] matched={m}{flag}')
print(f'runs: {len(res2)}; CI excludes 0: {sum(1 for x in res2 if x[3]>0 or x[4]<0)} (expect ~{0.05*len(res2):.1f})')
# --- by model (context)
print('\n== by model (all slices, raw; stratified sample so raw is not prevalence)')
bm = collections.defaultdict(list)
for r in L: bm[r['model']].append(r['ok'])
for m, v in sorted(bm.items(), key=lambda x: -len(x[1])):
    p, lo, hi = wilson(sum(v), len(v)); print(f'{m}: {sum(v)}/{len(v)} {p:.3f} [{lo:.3f},{hi:.3f}]')
# --- Q5 latency
print('\n== Q5 latency vs sensible')
def quint(vals, q=5):
    s = sorted(vals); return [s[int(len(s)*i/q)] for i in range(1, q)]
def bucket(x, cuts):
    for i, ct in enumerate(cuts):
        if x < ct: return i
    return len(cuts)
for sl, name in ((0, 'SRS slice0'), (None, 'all slices')):
    R = [r for r in L if r['lat'] is not None and (sl is None or r['slice'] == sl)]
    cuts = quint([r['lat'] for r in R])
    g = collections.defaultdict(list)
    for r in R: g[bucket(r['lat'], cuts)].append(r['ok'])
    print(name, 'latency quintile cuts ms', [int(x) for x in cuts])
    for b in sorted(g):
        v = g[b]; p, lo, hi = wilson(sum(v), len(v)); print(f'  Q{b+1}: {sum(v)}/{len(v)} {p:.3f} [{lo:.3f},{hi:.3f}]')
# within model+cell: slowest vs fastest half (latency quintile computed within model)
bymodel = collections.defaultdict(list)
for r in L:
    if r['lat'] is not None: bymodel[r['model']].append(r)
A = []; B = []
for m, v in bymodel.items():
    if len(v) < 200: continue
    cuts = quint([r['lat'] for r in v])
    for r in v:
        q = bucket(r['lat'], cuts); r2 = dict(r, k=r['cell']+'|'+str(m))
        if q == 4: A.append(r2)
        elif q == 0: B.append(r2)
d = adj_diff(A, B)
print('slowest-quintile minus fastest-quintile (within model, within cell):', d)
# controlling completion tokens: within model x completion-token tercile x cell
A = []; B = []
for m, v in bymodel.items():
    if len(v) < 200: continue
    ccuts = quint([r['ct'] or 0 for r in v], 3)
    for t in range(3):
        vv = [r for r in v if bucket(r['ct'] or 0, ccuts) == t]
        if len(vv) < 50: continue
        cuts = quint([r['lat'] for r in vv])
        for r in vv:
            q = bucket(r['lat'], cuts); r2 = dict(r, k=r['cell']+'|'+str(m)+'|'+str(t))
            if q == 4: A.append(r2)
            elif q == 0: B.append(r2)
print('same, also within completion-token tercile:', adj_diff(A, B))
# by model, raw slow vs fast
for m, v in sorted(bymodel.items(), key=lambda x: -len(x[1]))[:6]:
    cuts = quint([r['lat'] for r in v]); g = collections.defaultdict(list)
    for r in v: g[bucket(r['lat'], cuts)].append(r['ok'])
    print(f'  {m} n={len(v)} cuts={[int(x) for x in cuts]} ' + ' '.join(f'Q{b+1}={sum(g[b])/len(g[b]):.3f}' for b in sorted(g)))
