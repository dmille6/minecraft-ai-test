# NULL FOR THE DIVERSITY MEASURES, on identical code, pre-deploy data only.
# The repeat share is the most direct measurement of B2's mechanism, so it needs the same
# treatment as the veto rates: every same-shape assignment enumerated, C(12,2)=66.
import sys, os, json, itertools, statistics
import datetime as dt
from collections import defaultdict, Counter
sys.path.insert(0, "/srv/mcb-analysis-lib")
from lib.telemetry import Events

END = dt.datetime.fromisoformat("2026-09-26T06:02:47+00:00")   # the deploy instant
HOURS = 6.0
CUT = END - dt.timedelta(hours=HOURS / 2); PRE0 = END - dt.timedelta(hours=HOURS)
now = dt.datetime.now(dt.timezone.utc)
ev = Events.load(since_minutes=int((now - PRE0).total_seconds() / 60) + 5)
pool_of = lambda b: b.rsplit('-', 1)[0]
span = defaultdict(dict); keys = defaultdict(lambda: defaultdict(set)); seq = defaultdict(list); n = Counter()
for r in ev.rows:
    raw = r.get('raw') or {}; sk = raw.get('skill') or {}
    nm = sk.get('name'); b = (raw.get('bot') or {}).get('name'); t = r.get('t')
    if not (nm and b and t) or nm.startswith('_'): continue
    if t < PRE0 or t >= END: continue
    e = 'pre' if t < CUT else 'post'
    s = span[e].get(b); span[e][b] = (t if s is None else min(s[0], t), t if s is None else max(s[1], t))
    key = nm + ':' + json.dumps(sk.get('args') or {}, sort_keys=True)
    keys[e][b].add(key); seq[(e, b)].append((t, key)); n[e] += 1
print("positive control: %d rows; admitted decisions pre %d post %d; bots pre %d post %d"
      % (len(ev.rows), n['pre'], n['post'], len(span['pre']), len(span['post'])))
pools = sorted({pool_of(b) for b in span['post'] if not pool_of(b).startswith('isolated')})
combos = list(itertools.combinations(pools, 2))
print("pools %d; same-shape assignments C(%d,2)=%d, EXHAUSTIVE" % (len(pools), len(pools), len(combos)))

def bh(bots, e):
    return sum((span[e][b][1] - span[e][b][0]).total_seconds() / 3600.0
               for b in bots if b in span[e] and span[e][b][1] > span[e][b][0])

def cell(bots, e, which):
    if which == 'distinct':
        h = bh(bots, e)
        return (sum(len(keys[e].get(b, ())) for b in bots) / h) if h > 0 else None
    tot = rep = 0
    for b in bots:
        L = sorted(seq.get((e, b), []))
        for i in range(1, len(L)):
            tot += 1
            if L[i][1] == L[i - 1][1]: rep += 1
    return (rep / tot) if tot else None

def did_for(treat, which):
    tb = {b for b in span['post'] if pool_of(b) in treat}
    cb = {b for b in span['post'] if pool_of(b) in set(pools) - set(treat)}
    v = [cell(tb, 'post', which), cell(tb, 'pre', which), cell(cb, 'post', which), cell(cb, 'pre', which)]
    if any(x is None for x in v): return None
    return (v[0] - v[1]) - (v[2] - v[3])

for label, which in (("distinct keys/bot-h", 'distinct'), ("repeat share", 'repeat')):
    pairs = [(t, did_for(t, which)) for t in combos]
    pairs = [(t, d) for t, d in pairs if d is not None]
    vals = sorted(d for _, d in pairs); m = len(vals)
    q = lambda p: vals[min(m - 1, int(p * m))]
    print("  %-20s n=%d mean %+.4f sd %.4f | p5 %+.4f MEDIAN %+.4f p95 %+.4f | min %+.4f max %+.4f"
          % (label, m, statistics.mean(vals), statistics.pstdev(vals), q(.05), q(.5), q(.95), vals[0], vals[-1]))
    hv = sorted(d for t, d in pairs if all(x.startswith('hive') for x in t))
    if hv:
        print("      HIVE-ONLY (n=%d): mean %+.4f  range %+.4f..%+.4f" % (len(hv), statistics.mean(hv), hv[0], hv[-1]))
